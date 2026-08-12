import { randomInt } from 'node:crypto';

export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };
const cleanName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const validId = (id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
const validInterval = value => Number.isInteger(Number(value)) && Number(value) >= 3 && Number(value) <= 60;

export function generateCard() {
  const card = [];
  for (let column = 0; column < 5; column++) {
    const pool = Array.from({ length: 15 }, (_, i) => column * 15 + i + 1);
    for (let row = 0; row < 5; row++) card[row * 5 + column] = pool.splice(randomInt(pool.length), 1)[0];
  }
  card[12] = 'FREI';
  return card;
}

export class GameService {
  constructor(db, { now = () => Date.now(), codeGenerator = () => String(randomInt(1000, 10000)) } = {}) {
    this.db = db; this.now = now; this.codeGenerator = codeGenerator;
  }
  cleanup() { return this.db.prepare('DELETE FROM rooms WHERE expires_at <= ?').run(this.now()).changes; }
  validateIdentity(name, playerId) {
    const normalized = cleanName(name);
    if (normalized.length < 3 || normalized.length > 80 || !normalized.includes(' ')) fail('INVALID_NAME', 'Bitte gib deinen vollständigen Vor- und Nachnamen ein.');
    if (!validId(playerId)) fail('INVALID_SESSION', 'Deine Sitzungs-ID ist ungültig. Bitte lade die Seite neu.');
    return normalized;
  }
  createRoom({ name, playerId }) {
    name = this.validateIdentity(name, playerId); this.cleanup();
    let code;
    for (let tries = 0; tries < 100; tries++) {
      const candidate = this.codeGenerator();
      if (/^\d{4}$/.test(candidate) && !this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(candidate)) { code = candidate; break; }
    }
    if (!code) fail('NO_CODE', 'Derzeit kann kein freier Raumcode erzeugt werden.');
    const now = this.now(), expires = now + 24 * 60 * 60 * 1000;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO rooms(code,host_id,created_at,expires_at) VALUES(?,?,?,?)').run(code, playerId, now, expires);
      this.db.prepare('INSERT INTO players(id,room_code,name,card,marked,joined_at) VALUES(?,?,?,?,?,?)').run(playerId, code, name, JSON.stringify(generateCard()), '[12]', now);
    })();
    return this.getState(code, playerId);
  }
  joinRoom({ code, name, playerId }) {
    name = this.validateIdentity(name, playerId);
    if (!/^\d{4}$/.test(code || '')) fail('INVALID_CODE', 'Der Raumcode besteht aus genau 4 Ziffern.');
    this.cleanup();
    const room = this.db.prepare('SELECT * FROM rooms WHERE code=?').get(code);
    if (!room) fail('ROOM_NOT_FOUND', 'Dieser Raum ist unbekannt oder bereits abgelaufen.');
    if (this.db.prepare('SELECT 1 FROM banned_players WHERE room_code=? AND player_id=?').get(code, playerId)) fail('BANNED', 'Du wurdest aus dieser Lobby entfernt und kannst ihr nicht erneut beitreten.');
    const existing = this.db.prepare('SELECT * FROM players WHERE id=? AND room_code=?').get(playerId, code);
    if (!existing) {
      const count = this.db.prepare('SELECT count(*) count FROM players WHERE room_code=?').get(code).count;
      if (count >= 12) fail('ROOM_FULL', 'Dieser Raum ist bereits voll.');
      if (room.status !== 'lobby') fail('GAME_STARTED', 'Diese Runde läuft bereits. Ein neuer Beitritt ist nicht mehr möglich.');
      this.db.prepare('INSERT INTO players(id,room_code,name,card,marked,joined_at) VALUES(?,?,?,?,?,?)').run(playerId, code, name, JSON.stringify(generateCard()), '[12]', this.now());
    } else if (existing.name !== name) {
      this.db.prepare('UPDATE players SET name=? WHERE id=? AND room_code=?').run(name, playerId, code);
    }
    return this.getState(code, playerId);
  }
  getState(code, playerId) {
    const room = this.db.prepare('SELECT * FROM rooms WHERE code=? AND expires_at>?').get(code, this.now());
    if (!room) fail('ROOM_NOT_FOUND', 'Dieser Raum ist unbekannt oder bereits abgelaufen.');
    const me = this.db.prepare('SELECT * FROM players WHERE id=? AND room_code=?').get(playerId, code);
    if (!me) fail('NOT_MEMBER', 'Du bist kein Mitglied dieses Raums.');
    const players = this.db.prepare('SELECT id,name FROM players WHERE room_code=? ORDER BY joined_at').all(code);
    return { code, status: room.status, isHost: room.host_id === playerId, hostId: room.host_id, drawInterval: room.draw_interval, nextDrawAt: room.next_draw_at, drawn: JSON.parse(room.drawn), winnerId: room.winner_id, expiresAt: room.expires_at, players, card: JSON.parse(me.card), marked: JSON.parse(me.marked) };
  }
  requireHost(code, playerId) {
    const room = this.db.prepare('SELECT * FROM rooms WHERE code=? AND expires_at>?').get(code, this.now());
    if (!room) fail('ROOM_NOT_FOUND', 'Dieser Raum ist unbekannt oder bereits abgelaufen.');
    if (room.host_id !== playerId) fail('HOST_ONLY', 'Diese Aktion ist ausschließlich dem Gastgeber vorbehalten.');
    return room;
  }
  configure(code, playerId, drawInterval) {
    const room = this.requireHost(code, playerId);
    if (room.status !== 'lobby') fail('INVALID_ACTION', 'Die Einstellungen können nur in der Lobby geändert werden.');
    if (!validInterval(drawInterval)) fail('INVALID_INTERVAL', 'Wähle einen Abstand zwischen 3 und 60 Sekunden.');
    this.db.prepare('UPDATE rooms SET draw_interval=? WHERE code=?').run(Number(drawInterval), code);
    return this.getState(code, playerId);
  }
  kick(code, playerId, targetId) {
    const room = this.requireHost(code, playerId);
    if (room.status !== 'lobby') fail('INVALID_ACTION', 'Crewmitglieder können nur in der Lobby entfernt werden.');
    if (targetId === playerId) fail('INVALID_ACTION', 'Du kannst dich nicht selbst entfernen.');
    if (!this.db.prepare('SELECT 1 FROM players WHERE id=? AND room_code=?').get(targetId, code)) fail('NOT_MEMBER', 'Dieses Crewmitglied ist nicht mehr in der Lobby.');
    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO banned_players(room_code,player_id,banned_at) VALUES(?,?,?)').run(code, targetId, this.now());
      this.db.prepare('DELETE FROM players WHERE id=? AND room_code=?').run(targetId, code);
    })();
    return this.getState(code, playerId);
  }
  start(code, playerId) {
    const room = this.requireHost(code, playerId);
    if (room.status !== 'lobby') fail('INVALID_ACTION', 'Das Spiel wurde bereits gestartet.');
    this.db.prepare("UPDATE rooms SET status='playing',drawn='[]',winner_id=NULL,next_draw_at=? WHERE code=?").run(this.now() + room.draw_interval * 1000, code);
    return this.getState(code, playerId);
  }
  draw(code, playerId) {
    const room = this.requireHost(code, playerId);
    if (room.status !== 'playing') fail('INVALID_ACTION', 'Aktuell läuft keine Runde.');
    const drawn = JSON.parse(room.drawn), available = Array.from({length:75},(_,i)=>i+1).filter(n=>!drawn.includes(n));
    if (!available.length) fail('NO_NUMBERS', 'Alle Zahlen wurden bereits gezogen.');
    drawn.push(available[randomInt(available.length)]);
    this.db.prepare('UPDATE rooms SET drawn=?,next_draw_at=? WHERE code=?').run(JSON.stringify(drawn), available.length > 1 ? this.now() + room.draw_interval * 1000 : null, code);
    return this.getState(code, playerId);
  }
  drawDue(code) {
    const room = this.db.prepare("SELECT * FROM rooms WHERE code=? AND status='playing'").get(code);
    if (!room || !room.next_draw_at || room.next_draw_at > this.now()) return null;
    return this.draw(code, room.host_id);
  }
  dueRooms() { return this.db.prepare("SELECT code FROM rooms WHERE status='playing' AND next_draw_at IS NOT NULL AND next_draw_at<=?").all(this.now()); }
  mark(code, playerId, index, marked) {
    if (!Number.isInteger(index) || index < 0 || index > 24 || index === 12 || typeof marked !== 'boolean') fail('INVALID_MARK', 'Diese Markierung ist ungültig.');
    const state = this.getState(code, playerId);
    if (state.status !== 'playing') fail('INVALID_ACTION', 'Aktuell läuft keine Runde.');
    if (!state.drawn.includes(state.card[index])) fail('NOT_DRAWN', 'Diese Zahl wurde noch nicht gezogen.');
    const values = new Set(state.marked); marked ? values.add(index) : values.delete(index);
    this.db.prepare('UPDATE players SET marked=? WHERE id=? AND room_code=?').run(JSON.stringify([...values].sort((a,b)=>a-b)), playerId, code);
    return this.getState(code, playerId);
  }
  bingo(code, playerId) {
    const state = this.getState(code, playerId), marks = new Set(state.marked);
    const lines = [...Array(5)].flatMap((_, i) => [[0,1,2,3,4].map(c=>i*5+c),[0,1,2,3,4].map(r=>r*5+i)]).concat([[0,6,12,18,24],[4,8,12,16,20]]);
    if (!lines.some(line=>line.every(i=>marks.has(i)))) fail('NO_BINGO', 'Noch keine vollständige Reihe – weiter geht’s!');
    if (state.status !== 'playing') fail('INVALID_ACTION', 'Diese Runde ist bereits beendet.');
    this.db.prepare("UPDATE rooms SET status='finished',winner_id=?,next_draw_at=NULL WHERE code=?").run(playerId, code);
    return this.getState(code, playerId);
  }
  newRound(code, playerId) {
    this.requireHost(code, playerId);
    this.db.transaction(() => {
      const room = this.requireHost(code, playerId);
      this.db.prepare("UPDATE rooms SET status='playing',drawn='[]',winner_id=NULL,next_draw_at=? WHERE code=?").run(this.now() + room.draw_interval * 1000, code);
      const players = this.db.prepare('SELECT id FROM players WHERE room_code=?').all(code);
      const update = this.db.prepare("UPDATE players SET card=?,marked='[12]' WHERE id=? AND room_code=?");
      players.forEach(p=>update.run(JSON.stringify(generateCard()), p.id, code));
    })();
    return this.getState(code, playerId);
  }
  leave(code, playerId) {
    const room = this.db.prepare('SELECT host_id FROM rooms WHERE code=?').get(code);
    if (!room) return;
    if (room.host_id === playerId) this.db.prepare('DELETE FROM rooms WHERE code=?').run(code);
    else this.db.prepare('DELETE FROM players WHERE id=? AND room_code=?').run(playerId, code);
  }
}
