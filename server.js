import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { openDatabase } from './server/database.js';
import { GameError, GameService } from './server/game-service.js';

const root = dirname(fileURLToPath(import.meta.url));
const db = openDatabase();
const games = new GameService(db);
const removed = games.cleanup();
console.log(`[jl-bingo] Datenbank bereit; ${removed} abgelaufene Räume bereinigt.`);
const cleanupTimer = setInterval(() => {
  try { const count = games.cleanup(); if (count) console.log(`[jl-bingo] ${count} abgelaufene Räume gelöscht.`); }
  catch (error) { console.error('[jl-bingo] Bereinigung fehlgeschlagen:', error); }
}, 15 * 60 * 1000);
cleanupTimer.unref();

const app = express();
const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 100_000 });
const publicFiles = ['index.html', 'app.js', 'styles.css'];
publicFiles.forEach(file => app.get(file === 'index.html' ? '/' : `/${file}`, (_req,res) => res.sendFile(join(root,file))));
app.get('/health', (_req,res) => res.json({ status: 'ok' }));

const replyError = (ack, error) => {
  if (!(error instanceof GameError)) console.error('[jl-bingo] Unerwarteter Socket-Fehler:', error);
  ack?.({ ok: false, code: error.code || 'SERVER_ERROR', message: error instanceof GameError ? error.message : 'Ein Serverfehler ist aufgetreten. Bitte versuche es erneut.' });
};
const sendState = (socket, state) => { socket.join(state.code); socket.data = { code: state.code, playerId: socket.data.playerId }; return state; };
const broadcast = code => {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.rooms.has(code) && socket.data.playerId) {
      try { socket.emit('room:state', games.getState(code, socket.data.playerId)); }
      catch (error) { socket.emit('room:error', { message: error.message }); socket.leave(code); }
    }
  }
};
const drawTimer = setInterval(() => {
  try { games.dueRooms().forEach(({ code }) => { if (games.drawDue(code)) broadcast(code); }); }
  catch (error) { console.error('[jl-bingo] Automatische Ziehung fehlgeschlagen:', error); }
}, 500);
drawTimer.unref();
const action = (socket, event, handler, { broadcastRoom = true } = {}) => socket.on(event, (payload = {}, ack) => {
  try {
    const result = handler(payload);
    if (result?.code) sendState(socket, result);
    ack?.({ ok: true, state: result });
    if (broadcastRoom && result?.code) broadcast(result.code);
  } catch (error) { replyError(ack, error); }
});

io.on('connection', socket => {
  action(socket, 'room:create', payload => { socket.data.playerId = payload.playerId; return games.createRoom(payload); });
  action(socket, 'room:join', payload => { socket.data.playerId = payload.playerId; return games.joinRoom(payload); });
  action(socket, 'room:resume', payload => { socket.data.playerId = payload.playerId; return games.getState(payload.code, payload.playerId); });
  action(socket, 'room:configure', payload => games.configure(socket.data.code, socket.data.playerId, payload.drawInterval));
  action(socket, 'room:kick', payload => games.kick(socket.data.code, socket.data.playerId, payload.playerId));
  action(socket, 'game:start', () => games.start(socket.data.code, socket.data.playerId));
  action(socket, 'card:mark', payload => games.mark(socket.data.code, socket.data.playerId, payload.index, payload.marked));
  action(socket, 'game:bingo', () => games.bingo(socket.data.code, socket.data.playerId));
  action(socket, 'game:new-round', () => games.newRound(socket.data.code, socket.data.playerId));
  socket.on('room:leave', (_payload = {}, ack) => {
    try {
      const code = socket.data.code;
      if (!code) return ack?.({ ok: true });
      const wasHost = games.getState(code, socket.data.playerId).isHost;
      games.leave(code, socket.data.playerId);
      socket.leave(code); socket.data.code = undefined;
      ack?.({ ok: true });
      if (wasHost) io.to(code).emit('room:error', { message: 'Der Gastgeber hat die Raumstation geschlossen.' });
      else broadcast(code);
    } catch (error) { replyError(ack, error); }
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`[jl-bingo] Server läuft auf Port ${port}.`));
const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
