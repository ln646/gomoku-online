// 联机五子棋服务器：HTTP 静态资源 + WebSocket 实时对战
// 功能：创建房间 / 房间号加入 / 快速匹配 / PVE、走子同步、悔棋协商、认输、重赛、断线重连
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { SIZE, newBoard, idx, checkWin, isFull } = require('./game');
const { aiMove } = require('./ai');

const PORT = process.env.PORT || 3000;
const BLACK = 1, WHITE = 2;

// ---------------- 静态文件服务 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, '..', 'public', path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(path.join(__dirname, '..', 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------- 房间管理 ----------------
const rooms = new Map();        // code -> room
const matchQueue = [];          // 快速匹配队列
const playerIndex = new Map();  // playerId -> room code

let roomSeq = 0;
function genRoomCode() {
  let code;
  do {
    code = String(1000 + (roomSeq++ % 9000) + Math.floor(Math.random() * 9000));
  } while (rooms.has(code) && rooms.size < 9000);
  return code.slice(0, 4).padStart(4, '0');
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createRoom(ws, name) {
  const code = genRoomCode();
  const room = {
    code,
    players: { black: null, white: null },
    spectators: new Set(),
    board: newBoard(),
    turn: BLACK,
    history: [],          // {index, color, by, time}
    status: 'waiting',    // waiting | playing | ended
    winner: 0,            // 0=无 1=黑 2=白 3=和棋
    reason: '',
    winLine: null,
    undoPending: null,    // {by(color), timeout}
    rematch: { 1: false, 2: false },
    vsAi: false,
    level: null,
    aiTimer: null,
    disconnectTimer: null,
  };
  rooms.set(code, room);
  joinRoom(ws, room, 'black', name);
  return room;
}

function joinRoom(ws, room, colorKey, name) {
  const color = colorKey === 'black' ? BLACK : WHITE; // 对外统一使用数字 1=黑 2=白
  const playerId = genId();
  const player = { ws, id: playerId, name: name || '玩家', color, online: true };
  room.players[colorKey] = player;
  playerIndex.set(playerId, room.code);
  try { ws._playerId = playerId; ws._roomCode = room.code; } catch (e) {}
  send(ws, {
    type: 'roomJoined',
    playerId, color, roomCode: room.code,
    vsAi: room.vsAi,
    state: publicState(room, color),
  });
  if (room.players.black && room.players.white) startGame(room);
  else if (!room.vsAi) sendToRoom(room, { type: 'waiting', msg: '等待对手加入…' });
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (e) {}
  }
}

function sendToRoom(room, msg, excludeWs) {
  for (const color of ['black', 'white']) {
    const p = room.players[color];
    if (p && p.ws && p.ws !== excludeWs) send(p.ws, msg);
  }
  for (const ws of room.spectators) {
    if (ws !== excludeWs) send(ws, msg);
  }
}

// 构造发给某个玩家的完整对局状态（保证数据同步准确）
function publicState(room, forColor) {
  return {
    board: room.board,
    turn: room.turn,
    status: room.status,
    history: room.history,
    winner: room.winner,
    reason: room.reason,
    winLine: room.winLine,
    undoPending: room.undoPending ? room.undoPending.by : 0,
    rematch: room.rematch,
    blackName: room.vsAi ? (forColor === BLACK ? '你' : 'AI') : (room.players.black ? room.players.black.name : '等待中…'),
    whiteName: room.vsAi ? 'AI·' + levelName(room.level) : (room.players.white ? room.players.white.name : '等待中…'),
    blackOnline: room.vsAi ? true : !!(room.players.black && room.players.black.online),
    whiteOnline: room.vsAi ? true : !!(room.players.white && room.players.white.online),
    roomCode: room.code,
  };
}

function levelName(level) {
  return { easy: '简单', medium: '中等', hard: '困难' }[level] || level;
}

function startGame(room) {
  room.board = newBoard();
  room.turn = BLACK;
  room.history = [];
  room.status = 'playing';
  room.winner = 0;
  room.reason = '';
  room.winLine = null;
  room.undoPending = null;
  room.rematch = { 1: false, 2: false };
  clearTimeout(room.aiTimer);
  sendToRoom(room, { type: 'gameStart', state: publicState(room) });
}

function endGame(room, winner, reason, winLine) {
  room.status = 'ended';
  room.winner = winner;
  room.reason = reason;
  room.winLine = winLine || null;
  room.undoPending = null;
  clearTimeout(room.aiTimer);
  sendToRoom(room, { type: 'gameOver', winner, reason, winLine: room.winLine, state: publicState(room) });
}

// ---------------- 走子逻辑 ----------------
function makeMove(room, color, index, byName) {
  if (room.status !== 'playing') return { ok: false, msg: '对局未在进行中' };
  if (room.turn !== color) return { ok: false, msg: '还没轮到你' };
  if (index < 0 || index >= SIZE * SIZE || room.board[index] !== 0) return { ok: false, msg: '此处不能落子' };

  const x = index % SIZE, y = Math.floor(index / SIZE);
  room.board[index] = color;
  room.history.push({ index, color, by: byName || '', time: Date.now() });
  room.undoPending = null;

  const winLine = checkWin(room.board, x, y, color);
  if (winLine) {
    endGame(room, color, 'five', winLine);
    return { ok: true };
  }
  if (isFull(room.board)) {
    endGame(room, 3, 'draw', null);
    return { ok: true };
  }
  room.turn = color === BLACK ? WHITE : BLACK;
  sendToRoom(room, {
    type: 'move', index, color, turn: room.turn, moveCount: room.history.length,
    state: publicState(room),
  });
  return { ok: true };
}

function aiTurn(room) {
  if (room.status !== 'playing' || !room.vsAi) return;
  const aiColor = room.players.black && room.players.black.isAi ? BLACK : WHITE;
  if (room.turn !== aiColor) return;
  clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    if (room.status !== 'playing' || room.turn !== aiColor) return;
    const index = aiMove(room.board, aiColor, room.level);
    makeMove(room, aiColor, index, 'AI');
  }, 350 + Math.floor(Math.random() * 500));
}

// ---------------- 悔棋协商 ----------------
function requestUndo(room, color) {
  if (room.status !== 'playing') return { ok: false, msg: '对局已结束，无法悔棋' };
  if (room.undoPending) return { ok: false, msg: '已有悔棋请求待处理' };
  if (room.history.length === 0) return { ok: false, msg: '还没有棋子可悔' };
  if (room.vsAi) {
    // 人机模式：直接撤销到请求方落子之前
    return applyUndo(room, color);
  }
  // 联机模式：需对方同意。撤销后必须轮到请求方
  const lastMove = room.history[room.history.length - 1];
  const afterUndoTurn = lastMove.color; // 撤一子后轮到刚落子一方
  const requesterIsLast = (color === BLACK ? lastMove.color === BLACK : lastMove.color === WHITE);
  const undoCount = requesterIsLast ? 1 : 2; // 若对方刚落子，需撤两子才轮到自己
  if (room.history.length < undoCount) return { ok: false, msg: '没有足够的棋子可悔' };

  room.undoPending = { by: color, count: undoCount };
  sendToRoom(room, { type: 'undoRequest', by: color, state: publicState(room) });
  return { ok: true };
}

function applyUndo(room, color, count) {
  // 撤销到轮到 color 为止
  let n = count;
  if (!n) {
    n = 0;
    for (let i = room.history.length - 1; i >= 0; i--) {
      n++;
      if (room.history[i].color === color) break;
    }
  }
  for (let k = 0; k < n && room.history.length > 0; k++) {
    const m = room.history.pop();
    room.board[m.index] = 0;
  }
  room.turn = color;
  room.undoPending = null;
  sendToRoom(room, { type: 'undoApplied', by: color, undoCount: n, state: publicState(room) });
}

function respondUndo(room, accept) {
  if (!room.undoPending) return { ok: false, msg: '没有待处理的悔棋请求' };
  const req = room.undoPending;
  room.undoPending = null;
  if (!accept) {
    sendToRoom(room, { type: 'undoResult', accepted: false, state: publicState(room) });
    return { ok: true };
  }
  applyUndo(room, req.by, req.count);
  sendToRoom(room, { type: 'undoResult', accepted: true, state: publicState(room) });
  return { ok: true };
}

// ---------------- 断线处理 ----------------
function handleDisconnect(ws) {
  const code = ws._roomCode;
  const pid = ws._playerId;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  for (const key of ['black', 'white']) {
    const p = room.players[key];
    if (p && p.id === pid) {
      const colorNum = key === 'black' ? BLACK : WHITE;
      p.online = false;
      p.ws = null;
      sendToRoom(room, { type: 'opponentOffline', color: colorNum, msg: `${p.name} 已断线，等待重连（60秒）…` });
      if (room.status === 'playing' && !room.vsAi) {
        clearTimeout(room.disconnectTimer);
        room.disconnectTimer = setTimeout(() => {
          if (room.status === 'playing' && !p.online) {
            const winner = colorNum === BLACK ? WHITE : BLACK;
            endGame(room, winner, 'timeout');
            cleanupRoomIfEmpty(room);
          }
        }, 60000);
      }
      setTimeout(() => {
        if (!p.online && room.status === 'ended') cleanupRoomIfEmpty(room);
      }, 30000);
    }
  }
  room.spectators.delete(ws);
  cleanupRoomIfEmpty(room);
}

function cleanupRoomIfEmpty(room) {
  const anyOnline = ['black', 'white'].some(c => room.players[c] && room.players[c].online)
    || room.spectators.size > 0;
  if (!anyOnline) {
    clearTimeout(room.aiTimer);
    clearTimeout(room.disconnectTimer);
    for (const c of ['black', 'white']) {
      if (room.players[c]) playerIndex.delete(room.players[c].id);
    }
    rooms.delete(room.code);
  }
}

// ---------------- WebSocket 消息处理 ----------------
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

function isAlive(ws) { return ws._alive !== false; }

wss.on('connection', (ws) => {
  ws._alive = true;
  ws.on('pong', () => { ws._alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    try { handleMessage(ws, msg); }
    catch (err) { send(ws, { type: 'error', msg: '服务器处理出错，请重试' }); }
  });

  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', () => {});
});

function handleMessage(ws, msg) {
  const code = ws._roomCode;
  const room = code && rooms.get(code);

  switch (msg.type) {
    // 断线重连
    case 'rejoin': {
      const pid = String(msg.playerId || '');
      const rc = String(msg.roomCode || '');
      const r = rc && rooms.get(rc);
      if (!r) { send(ws, { type: 'rejoinFailed', msg: '房间已解散或不存在' }); return; }
      let found = null;
      for (const c of ['black', 'white']) {
        const p = r.players[c];
        if (p && p.id === pid) found = { player: p, color: c };
      }
      if (!found) {
        // 已被系统判负等：作为观战加入
        r.spectators.add(ws);
        ws._roomCode = rc;
        send(ws, { type: 'rejoinFailed', msg: '你已不在对局中，以观战身份进入', state: publicState(r) });
        return;
      }
      clearTimeout(r.disconnectTimer);
      found.player.online = true;
      found.player.ws = ws;
      found.player.name = msg.name || found.player.name;
      ws._playerId = pid;
      ws._roomCode = rc;
      send(ws, { type: 'rejoined', color: found.color === 'black' ? BLACK : WHITE, roomCode: rc, vsAi: r.vsAi, state: publicState(r, found.color) });
      sendToRoom(r, { type: 'opponentOnline', color: found.color === 'black' ? BLACK : WHITE, msg: `${found.player.name} 已重新连接`, state: publicState(r) }, ws);
      aiTurn(r);
      return;
    }

    // 创建房间
    case 'create': {
      const r = createRoom(ws, sanitizeName(msg.name));
      send(ws, { type: 'waiting', msg: '房间已创建，等待对手加入…' });
      return;
    }

    // 房间号加入
    case 'join': {
      const rc = String(msg.code || '').trim();
      const r = rooms.get(rc);
      if (!r) { send(ws, { type: 'error', msg: '房间不存在，请检查房间号' }); return; }
      if (r.vsAi) { send(ws, { type: 'error', msg: '该房间不支持加入' }); return; }
      if (r.players.black && r.players.white) {
        r.spectators.add(ws);
        ws._roomCode = rc;
        send(ws, { type: 'spectator', roomCode: rc, state: publicState(r) });
        return;
      }
      const color = r.players.black ? 'white' : 'black';
      joinRoom(ws, r, color, sanitizeName(msg.name));
      return;
    }

    // 快速匹配
    case 'quickMatch': {
      const name = sanitizeName(msg.name);
      // 先尝试重连旧对局
      while (matchQueue.length > 0) {
        const other = matchQueue.shift();
        if (isAlive(other) && other.readyState === 1) {
          const r = createRoomPair(other, ws, name);
          return;
        }
      }
      matchQueue.push(ws);
      ws._pendingName = name;
      send(ws, { type: 'waiting', msg: '正在匹配对手…' });
      return;
    }

    // PVE
    case 'pve': {
      const level = ['easy', 'medium', 'hard'].includes(msg.level) ? msg.level : 'medium';
      const name = sanitizeName(msg.name) || '玩家';
      const code = genRoomCode();
      const r = {
        code, players: { black: null, white: null }, spectators: new Set(),
        board: newBoard(), turn: BLACK, history: [], status: 'playing',
        winner: 0, reason: '', winLine: null, undoPending: null,
        rematch: { 1: false, 2: false }, vsAi: true, level,
        aiTimer: null, disconnectTimer: null,
      };
      rooms.set(code, r);
      const humanColor = 'black'; // 人执黑先行
      const aiColor = 'white';
      const playerId = genId();
      r.players[humanColor] = { ws, id: playerId, name, color: BLACK, online: true };
      r.players[aiColor] = { isAi: true, id: 'ai', name: 'AI', color: WHITE, online: true };
      playerIndex.set(playerId, code);
      ws._playerId = playerId;
      ws._roomCode = code;
      send(ws, { type: 'roomJoined', playerId, color: BLACK, roomCode: code, vsAi: true, state: publicState(r, BLACK) });
      send(ws, { type: 'gameStart', state: publicState(r, humanColor) });
      return;
    }

    // 落子
    case 'move': {
      if (!room) return;
      const color = colorOf(room, ws);
      if (!color) return; // 观战者不能落子
      const res = makeMove(room, color, msg.index | 0, (room.players[keyOf(color)] || {}).name);
      if (!res.ok) send(ws, { type: 'error', msg: res.msg });
      else aiTurn(room);
      return;
    }

    // 悔棋
    case 'undoRequest': {
      if (!room) return;
      const color = colorOf(room, ws);
      if (!color) { send(ws, { type: 'error', msg: '观战者不能悔棋' }); return; }
      const res = requestUndo(room, color);
      if (!res.ok) send(ws, { type: 'error', msg: res.msg });
      return;
    }
    case 'undoResponse': {
      if (!room || !room.undoPending) return;
      const color = colorOf(room, ws);
      // 只有被请求方（非发起方）能响应
      if (color && room.undoPending.by !== color) {
        respondUndo(room, !!msg.accept);
      }
      return;
    }

    // 认输
    case 'resign': {
      if (!room || room.status !== 'playing') return;
      const color = colorOf(room, ws);
      if (!color) return;
      endGame(room, color === BLACK ? WHITE : BLACK, 'resign');
      return;
    }

    // 再来一局
    case 'rematch': {
      if (!room || room.status !== 'ended') return;
      const color = colorOf(room, ws);
      if (!color) return;
      room.rematch[color] = true;
      if (room.vsAi) {
        startGame(room);
      } else if (room.rematch[1] && room.rematch[2]) {
        // 双方同意则交换黑白重开
        const b = room.players.black, w = room.players.white;
        room.players.black = w; room.players.white = b;
        if (room.players.black) room.players.black.color = BLACK;
        if (room.players.white) room.players.white.color = WHITE;
        startGame(room);
        sendToRoom(room, { type: 'info', msg: '双方同意重赛，已交换黑白' });
      } else {
        sendToRoom(room, { type: 'rematchWait', rematch: room.rematch, state: publicState(room) });
      }
      return;
    }

    // 离开房间
    case 'leave': {
      if (room) {
        const color = colorOf(room, ws);
        if (color && room.players[keyOf(color)]) {
          room.players[keyOf(color)] = null;
          sendToRoom(room, { type: 'opponentLeft', msg: '对方已离开房间' });
          if (room.status === 'playing' && !room.vsAi) endGame(room, color === BLACK ? WHITE : BLACK, 'leave');
        }
        room.spectators.delete(ws);
        cleanupRoomIfEmpty(room);
      }
      ws._roomCode = null;
      ws._playerId = null;
      send(ws, { type: 'left' });
      return;
    }

    // 简单聊天
    case 'chat': {
      if (!room) return;
      const color = colorOf(room, ws);
      const name = color ? ((room.players[color] || {}).name || '玩家') : '观战者';
      const text = String(msg.text || '').slice(0, 100);
      if (text) sendToRoom(room, { type: 'chat', from: name, text });
      return;
    }
  }
}

function colorOf(room, ws) {
  // 返回数字颜色：1=黑 2=白，观战/未找到返回 0
  for (const key of ['black', 'white']) {
    const p = room.players[key];
    if (p && p.ws === ws && !p.isAi) return key === 'black' ? BLACK : WHITE;
  }
  return 0;
}

function keyOf(color) {
  return color === BLACK ? 'black' : 'white';
}

function createRoomPair(ws1, ws2, name2) {
  const code = genRoomCode();
  const r = {
    code, players: { black: null, white: null }, spectators: new Set(),
    board: newBoard(), turn: BLACK, history: [], status: 'playing',
    winner: 0, reason: '', winLine: null, undoPending: null,
    rematch: { 1: false, 2: false }, vsAi: false, level: null,
    aiTimer: null, disconnectTimer: null,
  };
  rooms.set(code, r);
  const name1 = sanitizeName(ws1._pendingName) || '玩家1';
  const id1 = genId(), id2 = genId();
  r.players.black = { ws: ws1, id: id1, name: name1, color: BLACK, online: true };
  r.players.white = { ws: ws2, id: id2, name: name2 || '玩家2', color: WHITE, online: true };
  playerIndex.set(id1, code);
  playerIndex.set(id2, code);
  ws1._playerId = id1; ws1._roomCode = code;
  ws2._playerId = id2; ws2._roomCode = code;
  send(ws1, { type: 'roomJoined', playerId: id1, color: BLACK, roomCode: code, vsAi: false, state: publicState(r, BLACK) });
  send(ws2, { type: 'roomJoined', playerId: id2, color: WHITE, roomCode: code, vsAi: false, state: publicState(r, WHITE) });
  startGame(r);
}

function sanitizeName(n) {
  return String(n || '').replace(/[<>{}]/g, '').trim().slice(0, 12);
}

// ---------------- 心跳保活 ----------------
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._alive === false) { try { ws.terminate(); } catch (e) {} return; }
    ws._alive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`五子棋服务器已启动: http://localhost:${PORT}`);
});
