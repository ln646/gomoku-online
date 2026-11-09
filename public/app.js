/* ============ 联机五子棋 · 前端逻辑 ============ */
'use strict';

const SIZE = 15;
const BLACK = 1, WHITE = 2;
const EMPTY = 0;

// ---------- 全局状态 ----------
const S = {
  ws: null,
  playerId: null,
  roomCode: null,
  myColor: 0,        // 1 黑 2 白，观战为 0
  vsAi: false,
  state: null,       // 服务器下发的完整对局状态
  lastMoveIndex: -1,
  replayMode: false,
  replayStep: 0,
  replayTimer: null,
  pendingAction: null,
};

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const screens = { lobby: $('lobby'), game: $('game') };

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function confirmBox(text) {
  return new Promise(resolve => {
    $('modalText').textContent = text;
    $('modal').classList.remove('hidden');
    const done = v => {
      $('modal').classList.add('hidden');
      $('modalOk').onclick = $('modalCancel').onclick = null;
      resolve(v);
    };
    $('modalOk').onclick = () => done(true);
    $('modalCancel').onclick = () => done(false);
  });
}

// ---------- WebSocket ----------
function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return proto + '://' + location.host;
}

function connect() {
  return new Promise((resolve, reject) => {
    if (S.ws && S.ws.readyState === 1) return resolve();
    const ws = new WebSocket(getWsUrl());
    let opened = false;
    ws.onopen = () => { opened = true; resolve(); };
    ws.onerror = () => { if (!opened) reject(new Error('无法连接服务器')); };
    ws.onclose = () => {
      if (!opened) reject(new Error('无法连接服务器'));
      if (S.roomCode && screens.game.classList.contains('active')) {
        toast('与服务器断开连接，正在重连…', 4000);
        setTimeout(() => tryRejoin().catch(() => toast('重连失败，请检查网络后刷新页面', 5000)), 1500);
      }
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      handleServerMsg(msg);
    };
    S.ws = ws;
  });
}

function send(obj) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
}

function saveSession() {
  localStorage.setItem('gomoku_session', JSON.stringify({
    playerId: S.playerId, roomCode: S.roomCode, name: playerName(),
  }));
}
function clearSession() { localStorage.removeItem('gomoku_session'); }

function playerName() {
  return $('playerName').value.trim() || localStorage.getItem('gomoku_name') || '';
}
function rememberName() {
  const n = $('playerName').value.trim();
  if (n) localStorage.setItem('gomoku_name', n);
}

// 断线重连
async function tryRejoin() {
  const saved = JSON.parse(localStorage.getItem('gomoku_session') || 'null');
  if (!saved || !saved.roomCode) return;
  await connect();
  S.playerId = saved.playerId;
  S.roomCode = saved.roomCode;
  send({ type: 'rejoin', playerId: saved.playerId, roomCode: saved.roomCode, name: saved.name });
}

// ---------- 大厅交互 ----------
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    $('joinPanel').classList.toggle('hidden', action !== 'join');
    $('pvePanel').classList.toggle('hidden', action !== 'pve');
    $('lobbyStatus').classList.add('hidden');
    if (action === 'pve' || action === 'join') return; // 等待二级操作
    rememberName();
    try {
      await connect();
    } catch (e) { toast('无法连接服务器，请稍后重试'); return; }
    if (action === 'create') {
      S.pendingAction = 'create';
      send({ type: 'create', name: playerName() });
    } else if (action === 'quick') {
      S.pendingAction = 'quick';
      send({ type: 'quickMatch', name: playerName() });
    }
  });
});

$('joinConfirmBtn').addEventListener('click', async () => {
  const code = $('roomCodeInput').value.trim();
  if (!/^\d{4}$/.test(code)) { toast('请输入 4 位数字房间号'); return; }
  rememberName();
  try { await connect(); } catch (e) { toast('无法连接服务器，请稍后重试'); return; }
  S.pendingAction = 'join';
  send({ type: 'join', code, name: playerName() });
});
$('roomCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinConfirmBtn').click(); });

document.querySelectorAll('.diff-group .btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    rememberName();
    try { await connect(); } catch (e) { toast('无法连接服务器，请稍后重试'); return; }
    send({ type: 'pve', level: btn.dataset.level, name: playerName() });
  });
});

// 页面加载时提示可恢复的对局
window.addEventListener('load', () => {
  $('wsHint').textContent = location.host;
  const saved = JSON.parse(localStorage.getItem('gomoku_session') || 'null');
  if (saved && saved.roomCode) {
    const st = $('lobbyStatus');
    st.classList.remove('hidden');
    st.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = `检测到未结束的对局（房间 ${saved.roomCode}）  `;
    const btn = document.createElement('button');
    btn.className = 'btn small primary';
    btn.textContent = '重新连接';
    btn.onclick = () => tryRejoin().catch(() => toast('重连失败'));
    st.appendChild(span); st.appendChild(btn);
  }
  const name = localStorage.getItem('gomoku_name');
  if (name) $('playerName').value = name;
});

// ---------- 服务器消息处理 ----------
function handleServerMsg(msg) {
  switch (msg.type) {
    case 'roomJoined':
      S.playerId = msg.playerId;
      S.roomCode = msg.roomCode;
      S.myColor = msg.color;
      S.vsAi = msg.vsAi;
      S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(msg.state.history);
      stopReplay();
      enterGame();
      saveSession();
      break;

    case 'waiting':
      if (screens.lobby.classList.contains('active')) {
        const st = $('lobbyStatus');
        st.classList.remove('hidden');
        st.innerHTML = '';
        st.textContent = msg.msg || '等待中…';
      }
      break;

    case 'gameStart':
      S.state = msg.state;
      S.lastMoveIndex = -1;
      stopReplay();
      enterGame();
      hideEndBanner();
      toast('对局开始！你执' + (S.myColor === BLACK ? '黑棋（先行）' : '白棋'));
      saveSession();
      break;

    case 'move':
      if (msg.state) S.state = msg.state;
      S.lastMoveIndex = msg.index;
      renderBoard();
      renderPlayers();
      renderTurnInfo();
      break;

    case 'gameOver':
      S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(S.state.history);
      stopReplay();
      renderBoard();
      renderPlayers();
      renderTurnInfo();
      showEndBanner(msg.winner, msg.reason);
      break;

    case 'undoRequest':
      if (msg.state) S.state = msg.state;
      renderPlayers(); renderTurnInfo();
      if (S.myColor && msg.by !== S.myColor) {
        $('undoPromptText').textContent = '对方请求悔棋，是否同意？';
        $('undoPrompt').classList.remove('hidden');
        toast('对方请求悔棋');
      } else {
        toast('悔棋请求已发送，等待对方回应…');
      }
      break;

    case 'undoResult':
      if (msg.state) S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(S.state.history);
      $('undoPrompt').classList.add('hidden');
      renderBoard(); renderPlayers(); renderTurnInfo();
      toast(msg.accepted ? '对方同意了悔棋请求' : '对方拒绝了悔棋请求');
      break;

    case 'undoApplied':
      if (msg.state) S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(S.state.history);
      $('undoPrompt').classList.add('hidden');
      renderBoard(); renderPlayers(); renderTurnInfo();
      break;

    case 'rematchWait':
      if (msg.state) S.state = msg.state;
      toast('已发出重赛请求，等待对方同意…');
      break;

    case 'opponentOffline':
      toast(msg.msg, 5000);
      if (msg.state) S.state = msg.state;
      renderPlayers();
      break;

    case 'opponentOnline':
      toast(msg.msg);
      if (msg.state) S.state = msg.state;
      renderPlayers();
      break;

    case 'opponentLeft':
      toast(msg.msg, 4000);
      break;

    case 'rejoined':
      S.roomCode = msg.roomCode;
      S.myColor = msg.color;
      S.vsAi = msg.vsAi;
      S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(S.state.history);
      enterGame();
      saveSession();
      toast('已重新连接到对局');
      if (S.state.status === 'ended') showEndBanner(S.state.winner, S.state.reason);
      break;

    case 'rejoinFailed':
      clearSession();
      toast(msg.msg, 4000);
      break;

    case 'spectator':
      S.roomCode = msg.roomCode;
      S.myColor = 0;
      S.vsAi = false;
      S.state = msg.state;
      S.lastMoveIndex = lastIndexOf(S.state.history);
      enterGame();
      toast('房间已满，你以观战身份进入');
      break;

    case 'chat':
      toast(`💬 ${msg.from}：${msg.text}`, 3000);
      break;

    case 'info':
      toast(msg.msg);
      break;

    case 'error':
      toast(msg.msg || '操作失败');
      if (screens.lobby.classList.contains('active')) {
        $('lobbyStatus').classList.add('hidden');
      }
      break;

    case 'left':
      clearSession();
      backToLobby();
      break;
  }
}

function lastIndexOf(history) {
  return history && history.length ? history[history.length - 1].index : -1;
}

// ---------- 进入对局界面 ----------
function enterGame() {
  showScreen('game');
  $('roomInfo').innerHTML = S.vsAi
    ? `🤖 人机对战 · <b>${({ easy: '简单', medium: '中等', hard: '困难' })[S.state && S.state.aiLevel] || '中等'}</b>`
    : `房间号 <b>${S.roomCode}</b>`;
  $('copyCodeBtn').classList.toggle('hidden', S.vsAi);
  hideEndBanner();
  stopReplay();
  renderBoard();
  renderPlayers();
  renderTurnInfo();
  $('undoPrompt').classList.add('hidden');
  $('replayPanel').classList.add('hidden');
}

function backToLobby() {
  S.roomCode = null; S.myColor = 0; S.state = null; S.vsAi = false;
  showScreen('lobby');
  $('lobbyStatus').classList.add('hidden');
  clearSession();
}

function hideEndBanner() { $('endBanner').classList.add('hidden'); }

function showEndBanner(winner, reason) {
  const banner = $('endBanner');
  const title = $('endTitle');
  const sub = $('endSub');
  let titleText, cls, subText;
  if (winner === 3) {
    titleText = '和棋'; cls = 'draw'; subText = '棋盘已下满，平分秋色';
  } else if (!S.myColor) {
    titleText = '对局结束'; cls = 'draw';
    subText = `${winner === BLACK ? '黑方' : '白方'}获胜 · ${reasonText(reason)}`;
  } else if (winner === S.myColor) {
    titleText = '你赢了！'; cls = 'win';
    subText = `${reasonText(reason)} · 干得漂亮`;
  } else {
    titleText = '你输了'; cls = 'lose';
    subText = `${reasonText(reason)} · 再接再厉`;
  }
  title.textContent = titleText;
  title.className = 'end-title ' + cls;
  sub.textContent = subText;
  banner.classList.remove('hidden');
}

function reasonText(r) {
  return { five: '五子连线', draw: '棋盘已满', resign: '对方认输', timeout: '对方超时离线', leave: '对方离开' }[r] || '';
}

// ---------- 渲染：玩家栏 ----------
function renderPlayers() {
  const st = S.state;
  if (!st) return;
  const myColor = S.myColor;
  const topColor = myColor ? (myColor === BLACK ? WHITE : BLACK) : BLACK;   // 对方
  const bottomColor = myColor || BLACK;                                      // 我（或观战看黑方）
  $('topPlayerBar').innerHTML = playerBarHtml(st, topColor, false);
  $('bottomPlayerBar').innerHTML = playerBarHtml(st, bottomColor, true);
}

function playerBarHtml(st, color, isMe) {
  const isBlack = color === BLACK;
  const name = isBlack ? st.blackName : st.whiteName;
  const online = isBlack ? st.blackOnline : st.whiteOnline;
  const isTurn = st.status === 'playing' && st.turn === color;
  const vsAiSide = S.vsAi && !isMe;
  const stateText = vsAiSide ? 'AI'
    : st.status === 'waiting' ? '等待加入…'
    : !online ? '⚠ 已断线' : isTurn ? '思考中…' : '等待对方';
  const badgeCls = isTurn && st.status === 'playing' ? 'badge active' : (online ? 'badge' : 'badge offline');
  return `
    <span class="stone ${isBlack ? 'black' : 'white'}"></span>
    <div class="pinfo">
      <div class="pname">${escapeHtml(name || '等待中…')}${isMe ? '（你）' : ''}</div>
      <div class="pstate">${st.status === 'ended' && st.winner === color ? '🏆 获胜' : stateText}</div>
    </div>
    <span class="${badgeCls}">${isTurn ? '回合中' : isBlack ? '黑方' : '白方'}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTurnInfo() {
  const st = S.state;
  if (!st) return;
  const map = { 1: '黑', 2: '白' };
  let html;
  if (st.status === 'waiting') html = '⏳ 等待对手加入…';
  else if (st.status === 'ended') html = '🏁 对局已结束';
  else if (S.myColor) {
    html = st.turn === S.myColor
      ? '<span class="stone black"></span>轮到你落子了'
      : `等待${st.turn === BLACK ? '黑方' : '白方'}落子…`;
  } else {
    html = `<span class="stone ${st.turn === BLACK ? 'black' : 'white'}"></span>${map[st.turn]}方回合`;
  }
  $('turnInfo').innerHTML = html;
  $('moveCount').textContent = `已落 ${st.history.length} 子 · 第 ${(st.history.length ? Math.ceil(st.history.length / 1) : 0)} 手`;
  // 操作按钮可用性
  const playing = st.status === 'playing';
  $('undoBtn').disabled = !playing || !S.myColor || st.history.length === 0;
  $('resignBtn').disabled = !playing || !S.myColor;
}

// ---------- 棋盘渲染（Canvas） ----------
const canvas = $('board');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = 600 * DPR; canvas.height = 600 * DPR;
ctx.scale(DPR, DPR);

const PAD = 24;               // 边距
const CELL = (600 - PAD * 2) / (SIZE - 1);

function renderBoard() {
  const st = S.state;
  const board = replayBoard() || (st ? st.board : null);
  if (!board) return;
  const lastIdx = S.replayMode
    ? (S.replayStep > 0 ? S.replayHistory[S.replayStep - 1].index : -1)
    : S.lastMoveIndex;
  const winLine = S.replayMode ? null : (st && st.winLine);

  // 底色
  const g = ctx.createLinearGradient(0, 0, 600, 600);
  g.addColorStop(0, '#e3b269');
  g.addColorStop(1, '#d09c4f');
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, 600, 600, 12);
  ctx.fill();

  // 网格
  ctx.strokeStyle = 'rgba(60,40,10,.75)';
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    const p = PAD + i * CELL;
    ctx.beginPath(); ctx.moveTo(PAD, p); ctx.lineTo(600 - PAD, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, PAD); ctx.lineTo(p, 600 - PAD); ctx.stroke();
  }
  // 外框加粗
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, PAD, 600 - PAD * 2, 600 - PAD * 2);

  // 星位
  ctx.fillStyle = 'rgba(60,40,10,.85)';
  for (const [sx, sy] of [[3,3],[11,3],[3,11],[11,11],[7,7]]) {
    ctx.beginPath();
    ctx.arc(PAD + sx * CELL, PAD + sy * CELL, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 坐标标注
  ctx.fillStyle = 'rgba(60,40,10,.65)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < SIZE; i++) {
    ctx.fillText(String.fromCharCode(65 + i), PAD + i * CELL, PAD - 12);
    ctx.fillText(String(i + 1), PAD - 13, PAD + i * CELL);
  }

  // 获胜连线高亮
  if (winLine && winLine.length >= 2) {
    const [x1, y1] = winLine[0];
    const [x2, y2] = winLine[winLine.length - 1];
    ctx.strokeStyle = 'rgba(232,80,80,.85)';
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PAD + x1 * CELL, PAD + y1 * CELL);
    ctx.lineTo(PAD + x2 * CELL, PAD + y2 * CELL);
    ctx.stroke();
  }

  // 棋子
  const stoneR = CELL * 0.44;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = board[i];
    if (!v) continue;
    const x = PAD + (i % SIZE) * CELL;
    const y = PAD + Math.floor(i / SIZE) * CELL;
    drawStone(x, y, v, stoneR);
  }

  // 最后一手标记
  if (lastIdx >= 0 && board[lastIdx]) {
    const x = PAD + (lastIdx % SIZE) * CELL;
    const y = PAD + Math.floor(lastIdx / SIZE) * CELL;
    ctx.strokeStyle = '#e84a4a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, stoneR * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStone(x, y, color, r) {
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  if (color === BLACK) {
    grad.addColorStop(0, '#6b6b6b');
    grad.addColorStop(0.5, '#2a2a2a');
    grad.addColorStop(1, '#050505');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.6, '#e8e8e8');
    grad.addColorStop(1, '#9aa4b0');
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 落子点击
canvas.addEventListener('pointerdown', (e) => {
  if (S.replayMode) return;
  const st = S.state;
  if (!st || st.status !== 'playing' || !S.myColor || st.turn !== S.myColor) return;
  const rect = canvas.getBoundingClientRect();
  const scale = 600 / rect.width;
  const px = (e.clientX - rect.left) * scale;
  const py = (e.clientY - rect.top) * scale;
  const gx = Math.round((px - PAD) / CELL);
  const gy = Math.round((py - PAD) / CELL);
  if (gx < 0 || gx >= SIZE || gy < 0 || gy >= SIZE) return;
  const index = gy * SIZE + gx;
  if (st.board[index] !== EMPTY) return;
  send({ type: 'move', index });
});

// ---------- 对局操作 ----------
$('undoBtn').addEventListener('click', () => send({ type: 'undoRequest' }));
$('undoAcceptBtn').addEventListener('click', () => { send({ type: 'undoResponse', accept: true }); $('undoPrompt').classList.add('hidden'); });
$('undoRejectBtn').addEventListener('click', () => { send({ type: 'undoResponse', accept: false }); $('undoPrompt').classList.add('hidden'); });

$('resignBtn').addEventListener('click', async () => {
  const ok = await confirmBox('确定要认输吗？认输后本局结束。');
  if (ok) send({ type: 'resign' });
});

$('rematchBtn').addEventListener('click', () => {
  hideEndBanner();
  send({ type: 'rematch' });
  if (S.vsAi) toast('准备新对局…');
});

$('backBtn').addEventListener('click', async () => {
  if (S.state && S.state.status === 'playing' && S.myColor) {
    const ok = await confirmBox('对局尚未结束，离开将视为认输，确定离开吗？');
    if (!ok) return;
  }
  send({ type: 'leave' });
});
$('exitBtn').addEventListener('click', () => {
  send({ type: 'leave' });
  setTimeout(backToLobby, 100);
});

$('copyCodeBtn').addEventListener('click', () => {
  if (!S.roomCode) return;
  const text = `来和我下五子棋！房间号：${S.roomCode}，地址：${location.origin}`;
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('邀请信息已复制，发给好友吧！'));
  else toast('房间号：' + S.roomCode);
});

document.querySelectorAll('.quick-chat .btn').forEach(btn => {
  btn.addEventListener('click', () => send({ type: 'chat', text: btn.dataset.text }));
});

// ---------- 回放 ----------
let replayHistory = [];
function replayBoard() {
  if (!S.replayMode) return null;
  const b = new Array(SIZE * SIZE).fill(0);
  for (let i = 0; i < S.replayStep; i++) {
    b[replayHistory[i].index] = replayHistory[i].color;
  }
  return b;
}

function startReplay() {
  if (!S.state || !S.state.history || S.state.history.length === 0) { toast('没有可回放的棋局'); return; }
  replayHistory = S.state.history;
  S.replayMode = true;
  S.replayStep = replayHistory.length;
  $('replayPanel').classList.remove('hidden');
  $('replaySlider').max = replayHistory.length;
  $('replaySlider').value = replayHistory.length;
  updateReplayLabel();
  renderBoard();
  hideEndBanner();
}

function stopReplay() {
  S.replayMode = false;
  clearInterval(S.replayTimer);
  S.replayTimer = null;
  $('replayPanel').classList.add('hidden');
  $('rpToggle').textContent = '▶ 播放';
}

function replayTo(step) {
  S.replayStep = Math.max(0, Math.min(replayHistory.length, step));
  $('replaySlider').value = S.replayStep;
  updateReplayLabel();
  renderBoard();
}

function updateReplayLabel() {
  $('rpLabel').textContent = `第 ${S.replayStep} / ${replayHistory.length} 手`;
}

$('replayBtn').addEventListener('click', startReplay);
$('rpFirst').addEventListener('click', () => replayTo(0));
$('rpLast').addEventListener('click', () => replayTo(replayHistory.length));
$('rpPrev').addEventListener('click', () => replayTo(S.replayStep - 1));
$('rpNext').addEventListener('click', () => replayTo(S.replayStep + 1));
$('rpSlider').addEventListener('input', e => replayTo(+e.target.value));
$('rpToggle').addEventListener('click', () => {
  if (S.replayTimer) {
    clearInterval(S.replayTimer);
    S.replayTimer = null;
    $('rpToggle').textContent = '▶ 播放';
  } else {
    if (S.replayStep >= replayHistory.length) replayTo(0);
    S.replayTimer = setInterval(() => {
      if (S.replayStep >= replayHistory.length) {
        clearInterval(S.replayTimer);
        S.replayTimer = null;
        $('rpToggle').textContent = '▶ 播放';
        return;
      }
      replayTo(S.replayStep + 1);
    }, 500);
    $('rpToggle').textContent = '⏸ 暂停';
  }
});
