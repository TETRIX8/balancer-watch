const http = require('http');
const WebSocket = require('ws');

const HOST = '127.0.0.1';
const PORT = 8765;
const rooms = new Map();

function roomUsers(room) {
  return Object.fromEntries([...room.users].map(([id, u]) => [id, { name: u.name, isHost: id === room.hostId }]));
}
function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function broadcast(room, message, except) {
  for (const client of room.clients) if (client !== except) send(client, message);
}
function sendToUser(room, userId, message) {
  for (const client of room.clients) if (client.userId === userId) send(client, message);
}
function publishUsers(room) {
  const payload = { type: 'users', users: roomUsers(room), hostId: room.hostId };
  broadcast(room, payload);
}
function cleanRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.clients.size === 0) rooms.delete(roomId);
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  res.writeHead(404); res.end('not found');
});
const wss = new WebSocket.Server({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let roomId = null;
  let userId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      roomId = String(msg.roomId || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
      userId = String(msg.userId || '').slice(0, 128);
      const name = String(msg.name || 'Зритель').slice(0, 40);
      if (!roomId || !userId) return ws.close(1008, 'room and user are required');
      let room = rooms.get(roomId);
      if (!room) { room = { clients: new Set(), users: new Map(), hostId: null, state: {}, chat: [] }; rooms.set(roomId, room); }
      if (!room.hostId && msg.isHost) room.hostId = userId;
      if (msg.isHost && msg.movieId && msg.token) {
        room.state = { ...room.state, movieId: String(msg.movieId).slice(0, 32), token: String(msg.token).slice(0, 4096) };
      }
      room.clients.add(ws);
      room.users.set(userId, { name });
      ws.room = room;
      ws.userId = userId;
      send(ws, { type: 'state', roomId, isHost: room.hostId === userId, ...room.state });
      for (const item of room.chat) send(ws, item);
      publishUsers(room);
      if (msg.isHost && room.state.movieId && room.state.token) {
        broadcast(room, { type: 'changeMovie', movieId: room.state.movieId, token: room.state.token }, ws);
      }
      return;
    }

    const room = ws.room;
    if (!room || !userId) return;
    if (msg.type === 'rename') {
      const u = room.users.get(userId); if (u) u.name = String(msg.name || 'Зритель').slice(0, 40);
      broadcast(room, { type: 'rename', userId, name: u?.name || 'Зритель' }); publishUsers(room); return;
    }
    if (msg.type === 'chat') {
      const u = room.users.get(userId);
      const item = { type: 'chat', userId, name: u?.name || 'Зритель', text: String(msg.text || '').slice(0, 1000) };
      room.chat.push(item); if (room.chat.length > 100) room.chat.shift(); broadcast(room, item); return;
    }
    if (msg.type === 'becomeHost') {
      if (!room.hostId || !room.users.has(room.hostId)) room.hostId = userId;
      publishUsers(room); send(ws, { type: 'state', roomId, isHost: room.hostId === userId, ...room.state }); return;
    }
    if (msg.type === 'deleteRoom' && room.hostId === userId) {
      broadcast(room, { type: 'roomDeleted' });
      for (const client of room.clients) client.room = null;
      rooms.delete(roomId);
      for (const client of room.clients) client.close(1000, 'room deleted');
      return;
    }
    if (msg.type === 'voice-join') {
      for (const client of room.clients) {
        if (client === ws || !client.userId) continue;
        send(ws, { type: 'voice-peer', userId: client.userId, initiator: false });
        send(client, { type: 'voice-peer', userId, initiator: true });
      }
      return;
    }
    if (msg.type === 'voice-leave') {
      broadcast(room, { type: 'voice-left', userId }, ws); return;
    }
    if (['voice-offer', 'voice-answer', 'voice-ice'].includes(msg.type)) {
      const target = String(msg.target || '').slice(0, 128);
      if (!target) return;
      sendToUser(room, target, { type: msg.type, userId, offer: msg.offer, answer: msg.answer, candidate: msg.candidate });
      return;
    }
    if (msg.type === 'changeMovie' && room.hostId === userId) {
      room.state = { ...room.state, movieId: String(msg.movieId || '').slice(0, 32), token: String(msg.token || '').slice(0, 4096) };
      broadcast(room, { type: 'changeMovie', movieId: room.state.movieId, token: room.state.token }, ws); return;
    }
    if (['play', 'pause', 'seek', 'sync'].includes(msg.type) && room.hostId === userId) {
      const update = { type: msg.type, currentTime: Number(msg.currentTime) || 0, paused: !!msg.paused, playbackRate: Number(msg.playbackRate) || 1 };
      room.state = { ...room.state, ...update }; broadcast(room, update, ws); return;
    }
  });

  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    room.clients.delete(ws); room.users.delete(userId);
    if (room.hostId === userId) room.hostId = [...room.users.keys()][0] || null;
    publishUsers(room); cleanRoom(roomId);
  });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 30000);

httpServer.listen(PORT, HOST, () => console.log(`balancer-watch listening on http://${HOST}:${PORT}`));
