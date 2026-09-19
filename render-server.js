import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createInitialState, applyAction, skipCurrentTurn, getGameConfig, getAiSeatIds } from './public/shared/game-engine.js';
import { chooseAiAction } from './public/shared/ai.js';

const APP_VERSION = '0.11.0';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND = 'render-node';
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const TURN_MS = 32_000;
const AI_DELAY_MS = 520;
const AI_DIFFICULTY = 'veteran';
const RECLAIM_GRACE_MS = 15_000;
const ROOM_IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

function requestMeta(req) {
  return { requestId: crypto.randomUUID(), now: Date.now(), backend: BACKEND, renderRegion: process.env.RENDER_REGION || null, renderService: process.env.RENDER_SERVICE_NAME || null, forwardedProto: req.headers['x-forwarded-proto'] || null };
}
function normalizeRoomCode(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH); }
function sanitizeName(value) { return String(value || '').trim().replace(/[<>]/g, '').slice(0, 18) || 'Player'; }
function normalizeAiCount(playerCount, value) {
  const count = Number(playerCount) || 2;
  const max = count === 3 ? 1 : count === 4 ? 2 : 0;
  return Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
}
function makeRoomCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''; const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a room code.');
}
function seatIds(room) { return room.game.players.map(p => p.id); } // survivors P1..Pn, plus S (the snake) in Survival mode
function aiIds(room) { return room.aiIds || []; }
function humanSeatIds(room) { const ai = new Set(aiIds(room)); return seatIds(room).filter(id => !ai.has(id)); }
function isAiSeat(room, id) { return aiIds(room).includes(id); }
function currentPlayerId(room) { return room.game.players[room.game.turn]?.id || null; }
function currentTurnIsAi(room) { const id = currentPlayerId(room); return Boolean(id && isAiSeat(room, id)); }
function presence(room) {
  const out = {};
  for (const id of seatIds(room)) out[id] = isAiSeat(room, id) ? true : room.sockets.get(id)?.readyState === WebSocket.OPEN;
  return out;
}
function isEliminated(room, id) { return room.game.players.find(p => p.id === id)?.alive === false; }
function isReady(room) {
  const online = presence(room);
  // An eliminated survivor may leave without stopping the match for everybody else.
  return humanSeatIds(room).every(id => room.players[id] && (online[id] || isEliminated(room, id)));
}
function findSeatByToken(room, token) {
  if (!token) return null;
  for (const id of humanSeatIds(room)) if (room.players[id]?.token === token) return { playerId: id, token };
  return null;
}
function resolveSeat(room, token, name) {
  const exact = findSeatByToken(room, token);
  if (exact) { const p = room.players[exact.playerId]; p.name = name || p.name; p.disconnectedAt = null; room.lastActivityAt = Date.now(); return exact; }
  const online = presence(room), now = Date.now();
  for (const id of humanSeatIds(room)) {
    const existing = room.players[id];
    if (!existing) { const newToken = crypto.randomUUID(); room.players[id] = { token: newToken, name, ai: false, disconnectedAt: null, connectedAt: null, joinReservedAt: now }; room.lastActivityAt = now; return { playerId: id, token: newToken }; }
    const leaseAge = existing.joinReservedAt ? now - existing.joinReservedAt : Infinity;
    const disconnectAge = existing.disconnectedAt ? now - existing.disconnectedAt : Infinity;
    const reclaimable = !online[id] && ((!existing.connectedAt && leaseAge >= RECLAIM_GRACE_MS) || (existing.disconnectedAt && disconnectAge >= RECLAIM_GRACE_MS));
    if (reclaimable) { const newToken = crypto.randomUUID(); room.players[id] = { token: newToken, name, ai: false, disconnectedAt: null, connectedAt: null, joinReservedAt: now }; room.lastActivityAt = now; return { playerId: id, token: newToken }; }
  }
  return null;
}
function retryAfterMs(room) {
  const now = Date.now(); let best = RECLAIM_GRACE_MS;
  for (const id of humanSeatIds(room)) { const p = room.players[id]; if (!p) return 0; const base = p.disconnectedAt || p.joinReservedAt; if (base) best = Math.min(best, Math.max(0, RECLAIM_GRACE_MS - (now - base))); }
  return best;
}
function snapshot(room, forId = null) {
  const online = presence(room), players = {};
  for (const id of seatIds(room)) {
    const p = room.players[id];
    players[id] = p ? { name: p.name, connected: online[id], ai: Boolean(p.ai) } : null;
  }
  return { roomCode: room.code, you: forId, players, game: room.game, ready: isReady(room), aiCount: room.aiCount || 0, aiDifficulty: AI_DIFFICULTY, humanCount: humanSeatIds(room).length, rematchVotes: room.rematchVotes, turnDeadline: room.turnDeadline, turnDurationMs: TURN_MS, serverNow: Date.now(), timerRevision: room.timerRevision || 0, backend: BACKEND };
}
function send(ws, payload) { if (ws?.readyState === WebSocket.OPEN) try { ws.send(JSON.stringify(payload)); } catch {} }
function broadcastState(room, extra = {}) { for (const [playerId, ws] of room.sockets) send(ws, { type: 'state', ...snapshot(room, playerId), ...extra }); }
function clearTurnTimer(room) { if (room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer = null; room.turnDeadline = null; }
function scheduleTurn(room, reset = false) {
  if (room.game.winner || !isReady(room)) { clearTurnTimer(room); return; }
  if (currentTurnIsAi(room)) {
    clearTurnTimer(room);
    room.timerRevision = (room.timerRevision || 0) + 1;
    const revision = room.timerRevision;
    room.turnTimer = setTimeout(() => performAiTurn(room, revision), AI_DELAY_MS);
    return;
  }
  if (!reset && room.turnDeadline && room.turnDeadline > Date.now() && room.turnTimer) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnDeadline = Date.now() + TURN_MS;
  room.timerRevision = (room.timerRevision || 0) + 1;
  const revision = room.timerRevision;
  room.turnTimer = setTimeout(() => handleTurnTimeout(room, revision), TURN_MS + 20);
}
function performAiTurn(room, revision) {
  if (!rooms.has(room.code) || revision !== room.timerRevision || room.game.winner || !isReady(room) || !currentTurnIsAi(room)) return;
  room.turnTimer = null; room.turnDeadline = null;
  const playerId = currentPlayerId(room);
  let action = null;
  try { action = chooseAiAction(room.game, playerId, AI_DIFFICULTY); } catch (error) { console.error('AI error', error); }
  if (action) {
    const result = applyAction(room.game, playerId, action);
    room.game = result.ok ? result.state : skipCurrentTurn(room.game);
  } else room.game = skipCurrentTurn(room.game);
  room.lastActivityAt = Date.now(); room.rematchVotes = [];
  scheduleTurn(room, true);
  broadcastState(room, { aiActionPlayer: playerId });
}
function handleTurnTimeout(room, revision) {
  if (!rooms.has(room.code) || revision !== room.timerRevision) return;
  if (room.game.winner || !isReady(room)) { clearTurnTimer(room); broadcastState(room); return; }
  if (currentTurnIsAi(room)) return scheduleTurn(room, true);
  if (!room.turnDeadline || Date.now() < room.turnDeadline) { const remaining = Math.max(5, room.turnDeadline - Date.now()); room.turnTimer = setTimeout(() => handleTurnTimeout(room, revision), remaining + 10); return; }
  const skipped = currentPlayerId(room);
  room.game = skipCurrentTurn(room.game); room.lastActivityAt = Date.now();
  scheduleTurn(room, true);
  broadcastState(room, { timeoutPlayer: skipped });
}
function createRoom(config) {
  const code = makeRoomCode();
  const game = createInitialState(config);
  const selectedAiIds = getAiSeatIds(game, config.aiCount);
  const aiCount = selectedAiIds.length;
  const players = {};
  for (const p of game.players) players[p.id] = selectedAiIds.includes(p.id) ? { name: game.mode === 'survival' ? 'Snake AI' : aiCount === 1 ? 'Veteran AI' : `Veteran AI ${selectedAiIds.indexOf(p.id) + 1}`, ai: true } : null;
  const now = Date.now();
  const room = { code, createdAt: now, lastActivityAt: now, players, sockets: new Map(), game, aiCount, aiIds: selectedAiIds, rematchVotes: [], turnDeadline: null, turnTimer: null, timerRevision: 0 };
  rooms.set(code, room); return room;
}

app.get('/api/health', (req, res) => { res.set('cache-control', 'no-store'); res.json({ ok: true, service: 'GridGate', version: APP_VERSION, backend: BACKEND, roomsInMemory: rooms.size, ...requestMeta(req) }); });
app.post('/api/rooms', (req, res) => {
  const config = getGameConfig(req.body?.playerCount, req.body?.mode, req.body?.snakeMode);
  config.aiCount = normalizeAiCount(config.playerCount, req.body?.aiCount);
  const room = createRoom(config);
  res.status(201).set('cache-control', 'no-store').json({ ok: true, code: room.code, config: { ...config, aiCount: room.aiCount, humanCount: humanSeatIds(room).length }, ...requestMeta(req) });
});
app.get('/api/rooms/:code', (req, res) => {
  const code = normalizeRoomCode(req.params.code), room = rooms.get(code); res.set('cache-control', 'no-store');
  if (!room) return res.status(404).json({ ok: false, exists: false, error: 'Room not found. It may have been lost after a free-server restart or spin-down.', backend: BACKEND, ...requestMeta(req) });
  const online = presence(room), seats = {}; for (const id of seatIds(room)) seats[id] = Boolean(room.players[id]);
  res.json({ ok: true, exists: true, roomCode: room.code, roomAgeMs: Date.now() - room.createdAt, seats, connected: online, ready: isReady(room), config: { playerCount: room.game.playerCount, mode: room.game.mode, boardSize: room.game.boardSize, wallsPerPlayer: room.game.wallsPerPlayer, aiCount: room.aiCount, humanCount: humanSeatIds(room).length }, turnDeadline: room.turnDeadline, serverNow: Date.now(), backend: BACKEND, ...requestMeta(req) });
});
app.post('/api/rooms/:code/join', (req, res) => {
  const code = normalizeRoomCode(req.params.code), room = rooms.get(code); res.set('cache-control', 'no-store');
  if (!room) return res.status(404).json({ ok: false, error: 'Room not found. It may have been lost after a free-server restart or spin-down.', stage: 'join', backend: BACKEND, ...requestMeta(req) });
  const seat = resolveSeat(room, String(req.body?.token || '').trim(), sanitizeName(req.body?.name));
  if (!seat) return res.status(409).json({ ok: false, error: 'Room is full or human seats are still reserved.', stage: 'join', retryAfterMs: retryAfterMs(room), connected: presence(room), backend: BACKEND, ...requestMeta(req) });
  room.players[seat.playerId].joinReservedAt = Date.now(); room.lastActivityAt = Date.now();
  res.json({ ok: true, stage: 'join', playerId: seat.playerId, token: seat.token, roomCode: room.code, config: { playerCount: room.game.playerCount, mode: room.game.mode, aiCount: room.aiCount, humanCount: humanSeatIds(room).length }, connected: presence(room), serverNow: Date.now(), backend: BACKEND, ...requestMeta(req) });
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

server.on('upgrade', (req, socket, head) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { socket.destroy(); return; }
  const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})\/ws$/); if (!match) { socket.destroy(); return; }
  const code = normalizeRoomCode(match[1]), room = rooms.get(code), token = String(url.searchParams.get('token') || '').trim(), seat = room ? findSeatByToken(room, token) : null;
  if (!room || !seat) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { ws.gridgate = { roomCode: code, playerId: seat.playerId, token: seat.token }; wss.emit('connection', ws, req); });
});

wss.on('connection', ws => {
  const { roomCode, playerId, token } = ws.gridgate, room = rooms.get(roomCode);
  if (!room || room.players[playerId]?.token !== token || isAiSeat(room, playerId)) return ws.close(4003, 'Invalid session');
  const old = room.sockets.get(playerId); if (old && old !== ws && old.readyState === WebSocket.OPEN) old.close(4001, 'Reconnected from another tab');
  room.sockets.set(playerId, ws); const player = room.players[playerId]; player.disconnectedAt = null; player.connectedAt = Date.now(); player.joinReservedAt = null; room.lastActivityAt = Date.now();
  send(ws, { type: 'welcome', playerId, token, roomCode, serverNow: Date.now(), backend: BACKEND });
  scheduleTurn(room, false); send(ws, { type: 'state', ...snapshot(room, playerId) }); broadcastState(room);
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    room.lastActivityAt = Date.now(); let data; try { data = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', error: 'Invalid message.' }); }
    if (room.players[playerId]?.token !== token) return send(ws, { type: 'error', error: 'Invalid player session.' });
    if (data.type === 'ping') return send(ws, { type: 'pong', nonce: data.nonce || null, serverNow: Date.now(), backend: BACKEND });
    if (data.type === 'action') {
      if (!isReady(room)) return send(ws, { type: 'error', error: 'Waiting for all human players to be connected.' });
      if (currentTurnIsAi(room)) return send(ws, { type: 'error', error: 'The AI is taking its turn.' });
      if (room.turnDeadline && Date.now() >= room.turnDeadline) { handleTurnTimeout(room, room.timerRevision); return send(ws, { type: 'error', error: 'Your turn already expired.' }); }
      const result = applyAction(room.game, playerId, data.action); if (!result.ok) return send(ws, { type: 'error', error: result.error });
      room.game = result.state; room.rematchVotes = []; scheduleTurn(room, true); broadcastState(room); return;
    }
    if (data.type === 'rematch') {
      if (!room.game.winner) return send(ws, { type: 'error', error: 'The game is not finished.' });
      if (!room.rematchVotes.includes(playerId)) room.rematchVotes.push(playerId);
      if (humanSeatIds(room).every(id => room.rematchVotes.includes(id))) { room.game = createInitialState({ playerCount: room.game.playerCount, mode: room.game.mode, snakeMode: room.game.snakeMode }); room.rematchVotes = []; scheduleTurn(room, true); broadcastState(room); }
      else broadcastState(room);
      return;
    }
    if (data.type === 'sync') return send(ws, { type: 'state', ...snapshot(room, playerId) });
    send(ws, { type: 'error', error: 'Unknown message type.' });
  });
  ws.on('close', () => {
    if (!rooms.has(roomCode)) return;
    if (room.sockets.get(playerId) === ws) { room.sockets.delete(playerId); const p = room.players[playerId]; if (p?.token === token) p.disconnectedAt = Date.now(); if (isReady(room)) scheduleTurn(room, false); else clearTurnTimer(room); broadcastState(room); }
  });
});

const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} } }, 25_000); heartbeat.unref?.();
const cleanup = setInterval(() => { const now = Date.now(); for (const [code, room] of rooms) if (room.sockets.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) { clearTurnTimer(room); rooms.delete(code); } }, 10 * 60 * 1000); cleanup.unref?.();
server.listen(PORT, HOST, () => console.log(`GridGate ${APP_VERSION} Render backend listening on http://${HOST}:${PORT}`));
function shutdown(signal) { console.log(`${signal}: closing GridGate server`); clearInterval(heartbeat); clearInterval(cleanup); for (const ws of wss.clients) try { ws.close(1012, 'Server restarting'); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25_000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
