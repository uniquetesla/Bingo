const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  name: localStorage.getItem('bingo-name') || '',
  mode: 'create',
  code: '',
  isHost: true,
  numbers: [],
  drawn: [],
  marked: new Set([12]),
  playerId: sessionStorage.getItem('bingo-player-id') || crypto.randomUUID(),
};
sessionStorage.setItem('bingo-player-id', state.playerId);
const roomChannel = new BroadcastChannel('bingo-mission-rooms');
const roomKey = (code) => `bingo-room-${code}`;
const readRoom = (code = state.code) => JSON.parse(localStorage.getItem(roomKey(code)) || 'null');
const createPlayer = () => ({ id: state.playerId, name: state.name, joinedByUser: true });
const realPlayers = (room) => room.players.filter((player) => player.joinedByUser === true);
const writeRoom = (room) => {
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
  roomChannel.postMessage({ code: room.code });
};

const heroNumbers = [4, 18, 33, 51, 67, 12, 21, 40, 56, 73, 7, 29, '★', 48, 62, 9, 25, 44, 59, 70, 15, 30, 46, 60, 75];
$('#heroGrid').innerHTML = heroNumbers.map((n, i) => `<span class="${[1, 8, 13, 21].includes(i) ? 'hit' : ''}">${n}</span>`).join('');

function showScreen(id) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === id));
  window.scrollTo(0, 0);
}

function initials(name) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function updateProfile() {
  if (!state.name) return;
  $('#profilePill').hidden = false;
  $('#headerInitials').textContent = initials(state.name);
  $('#headerName').textContent = state.name.split(' ')[0];
}
updateProfile();

function begin(mode) {
  state.mode = mode;
  if (state.name) return openRoomChoice();
  showScreen('authScreen');
  setTimeout(() => $('#fullName').focus(), 50);
}

$('#createRoomBtn').addEventListener('click', () => begin('create'));
$('#joinRoomBtn').addEventListener('click', () => begin('join'));
$$('[data-back]').forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.back)));

$('#nameForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#fullName').value.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || !name.includes(' ')) {
    $('#nameError').textContent = 'Bitte gib deinen Vor- und Nachnamen ein.';
    return;
  }
  state.name = name;
  localStorage.setItem('bingo-name', name);
  $('#nameError').textContent = '';
  updateProfile();
  openRoomChoice();
});

function openRoomChoice() {
  const joining = state.mode === 'join';
  $('#choiceTitle').textContent = joining ? 'Raum beitreten' : 'Raum erstellen';
  $('#choiceSubtitle').textContent = joining ? 'Gib den Code deines Gastgebers ein.' : 'Dein persönlicher Bingo-Abend ist gleich bereit.';
  $('#joinForm').hidden = !joining;
  $('#createPanel').hidden = joining;
  showScreen('roomChoiceScreen');
  if (joining) setTimeout(() => $('#roomCode').focus(), 50);
}

$('#roomCode').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4); });
$('#joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $('#roomCode').value;
  if (!/^\d{4}$/.test(code)) { $('#codeError').textContent = 'Der Raumcode besteht aus genau 4 Ziffern.'; return; }
  const room = readRoom(code);
  if (!room) { $('#codeError').textContent = 'Diese Raumstation existiert nicht. Prüfe den Code noch einmal.'; return; }
  $('#codeError').textContent = '';
  state.code = code; state.isHost = room.hostId === state.playerId; enterLobby();
});
$('#confirmCreateBtn').addEventListener('click', () => {
  do { state.code = String(Math.floor(1000 + Math.random() * 9000)); } while (readRoom(state.code));
  state.isHost = true;
  writeRoom({ code: state.code, hostId: state.playerId, players: [createPlayer()], status: 'lobby', drawn: [] });
  enterLobby();
});

function enterLobby() {
  const room = readRoom();
  if (!room) return toast('Diese Raumstation ist nicht mehr verfügbar.');
  room.players = realPlayers(room);
  const existing = room.players.find((player) => player.id === state.playerId);
  if (existing) existing.name = state.name;
  else room.players.push(createPlayer());
  writeRoom(room);
  $('#lobbyCode').textContent = state.code;
  renderPlayers(room);
  $('.host-panel h3').textContent = state.isHost ? 'Du bist Gastgeber' : 'Warte auf den Gastgeber';
  $('.host-panel p').textContent = state.isHost ? 'Du bestimmst, wann die Runde beginnt und ziehst die Zahlen.' : 'Sobald der Gastgeber startet, erscheint hier deine Karte.';
  $('#startGameBtn').innerHTML = 'Mission starten <span>→</span>';
  $('#startGameBtn').hidden = !state.isHost;
  showScreen('lobbyScreen');
}

function renderPlayers(room) {
  $('#playerCount').textContent = room.players.length;
  $('#playersList').innerHTML = room.players.map((player) => `<div class="player-row"><span class="avatar">${escapeHtml(initials(player.name))}</span><div><p>${escapeHtml(player.name)}${player.id === state.playerId ? ' (Du)' : ''}</p><small>${player.id === room.hostId ? 'Kommandant' : 'Crewmitglied'}</small></div><span class="status">● Bereit</span></div>`).join('');
}

$('#copyCodeBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.code); } catch { /* Fallback is the visible code. */ }
  toast(`Raumcode ${state.code} kopiert`);
});
$('#startGameBtn').addEventListener('click', startGame);

function generateCard() {
  const columns = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  const result = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const [min,max] = columns[col];
      let number;
      do { number = Math.floor(Math.random() * (max-min+1))+min; } while (result.includes(number));
      result.push(number);
    }
  }
  result[12] = 'FREI';
  return result;
}

function startGame() {
  state.numbers = generateCard(); state.drawn = []; state.marked = new Set([12]);
  if (state.isHost) { const room = readRoom(); if (room) { room.status = 'playing'; room.drawn = []; writeRoom(room); } }
  $('#gameCode').textContent = state.code;
  $('#firstName').textContent = state.name.split(' ')[0];
  renderBoard(); updateDrawDisplay(); showScreen('gameScreen');
}

function renderBoard() {
  $('#bingoBoard').innerHTML = state.numbers.map((number,index) => `<button class="board-cell ${index===12?'free marked':''}" data-index="${index}"><span>${number}</span></button>`).join('');
  $$('.board-cell').forEach((cell) => cell.addEventListener('click', () => {
    const index = Number(cell.dataset.index), number = state.numbers[index];
    if (index === 12) return;
    if (!state.drawn.includes(number)) return toast('Diese Zahl wurde noch nicht gezogen.');
    state.marked.has(index) ? state.marked.delete(index) : state.marked.add(index);
    cell.classList.toggle('marked');
  }));
}

$('#drawBtn').addEventListener('click', () => {
  if (!state.isHost) return toast('Nur der Kommandant kann Zahlen ziehen.');
  const available = Array.from({length:75},(_,i)=>i+1).filter((n)=>!state.drawn.includes(n));
  if (!available.length) return toast('Alle Zahlen wurden bereits gezogen.');
  const number = available[Math.floor(Math.random()*available.length)];
  state.drawn.push(number); updateDrawDisplay();
  const room = readRoom(); if (room) { room.drawn = state.drawn; writeRoom(room); }
});

function updateDrawDisplay() {
  const current = state.drawn.at(-1);
  $('#currentBall').textContent = current ?? '?';
  $('#currentBall').classList.toggle('empty', !current);
  $('#drawnCount').textContent = state.drawn.length;
  $('#callStatus').textContent = current ? `${current} wurde gezogen` : 'Ziehe die erste Zahl!';
  $('#recentBalls').innerHTML = state.drawn.length ? state.drawn.slice(-8).reverse().map((n)=>`<span>${n}</span>`).join('') : '<span class="muted">Noch keine</span>';
}

function hasBingo() {
  const lines=[];
  for(let r=0;r<5;r++) lines.push([0,1,2,3,4].map(c=>r*5+c));
  for(let c=0;c<5;c++) lines.push([0,1,2,3,4].map(r=>r*5+c));
  lines.push([0,6,12,18,24],[4,8,12,16,20]);
  return lines.some(line=>line.every(i=>state.marked.has(i)));
}
$('#bingoBtn').addEventListener('click', () => {
  if (!hasBingo()) return toast('Noch keine vollständige Reihe – weiter geht’s!');
  $('#winnerName').textContent = state.name; $('#winnerDialog').showModal();
});

$('#newRoundBtn').addEventListener('click', () => { $('#winnerDialog').close(); startGame(); });
function leaveRoom() {
  const room = readRoom();
  if (room) {
    room.players = room.players.filter((player) => player.id !== state.playerId);
    if (!room.players.length || state.isHost) localStorage.removeItem(roomKey(state.code));
    else writeRoom(room);
    roomChannel.postMessage({ code: state.code });
  }
}
function goHome() { leaveRoom(); $$('#winnerDialog:modal').forEach(d=>d.close()); showScreen('landingScreen'); }
$('#winnerLeaveBtn').addEventListener('click', goHome);
$('#leaveLobbyBtn').addEventListener('click', goHome);
$('#leaveGameBtn').addEventListener('click', goHome);

$('#howBtn').addEventListener('click', () => $('#howDialog').showModal());
$('.dialog-close').addEventListener('click', () => $('#howDialog').close());
$('#howDialog').addEventListener('click', (event) => { if (event.target === $('#howDialog')) $('#howDialog').close(); });

let toastTimer;
function toast(message) { const node=$('#toast'); node.textContent=message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),2200); }

function syncRoom(code) {
  if (!state.code || code !== state.code) return;
  const room = readRoom();
  if (!room) { toast('Der Kommandant hat die Raumstation geschlossen.'); return showScreen('landingScreen'); }
  if ($('#lobbyScreen').classList.contains('active')) renderPlayers(room);
  if (room.status === 'playing' && !$('#gameScreen').classList.contains('active')) startGame();
  if (!state.isHost && room.status === 'playing') { state.drawn = room.drawn || []; updateDrawDisplay(); }
}
roomChannel.addEventListener('message', ({ data }) => syncRoom(data.code));
window.addEventListener('storage', (event) => { if (event.key?.startsWith('bingo-room-')) syncRoom(event.key.slice(11)); });
