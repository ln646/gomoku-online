/* ============ 五子棋单机版 · 主逻辑 ============ */
'use strict';

const BLACK = 1, WHITE = 2, EMPTY = 0;
const LS_STATS = 'gomoku_offline_stats_v1';
const LS_SAVE  = 'gomku_offline_save_v1';
const LS_SOUND = 'gomoku_offline_sound';

// ---------- 全局状态 ----------
const G = {
  mode: 'pve',            // pve | pvp
  level: 'medium',        // easy | medium | hard
  playerColor: BLACK,     // 人机模式下玩家颜色；pvp 模式无意义
  board: newBoard(),
  turn: BLACK,
  history: [],            // [{index, color}]
  status: 'playing',      // playing | paused | over
  winner: 0,              // 1/2 获胜方, 0=未结束, 3=和棋
  winLine: null,
  lastIdx: -1,
  aiTimer: null,
  moveSeq: 0,             // 用于保存进度时防竞态
};

const $ = id => document.getElementById(id);
const screens = { menu: $('menuScreen'), game: $('gameScreen') };

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let toastTimer = null;
function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- 音效（WebAudio，无外部资源） ----------
let audioCtx = null;
function soundEnabled() { return localStorage.getItem(LS_SOUND) !== 'off'; }
function beep(freq, dur = 0.08, type = 'sine', vol = 0.15) {
  if (!soundEnabled()) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = type;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
function sndPlace() { beep(520, 0.07); }
function sndWin()  { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'triangle'), i * 120)); }
function sndLose() { [400, 320, 240].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sawtooth', 0.08), i * 150)); }

// ---------- 本地存档：战绩统计 ----------
function loadStats() {
  try { return JSON.parse(localStorage.getItem(LS_STATS)) || defaultStats(); }
  catch (e) { return defaultStats(); }
}
function defaultStats() {
  return {
    pve: { easy: { w: 0, l: 0, d: 0 }, medium: { w: 0, l: 0, d: 0 }, hard: { w: 0, l: 0, d: 0 } },
    pvp: { b: 0, w: 0, d: 0 },
    streak: 0, bestStreak: 0,
  };
}
function saveStats(s) { localStorage.setItem(LS_STATS, JSON.stringify(s)); }

function recordResult(win) {
  const st = loadStats();
  if (G.mode === 'pve') {
    const r = st.pve[G.level];
    if (win === 1) { r.w++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); }
    else if (win === -1) { r.l++; st.streak = 0; }
    else r.d++;
  } else {
    if (win === 1) st.pvp.b++;       // 黑方胜
    else if (win === -1) st.pvp.w++; // 白方胜
    else st.pvp.d++;
  }
  saveStats(st);
  return st;
}

function renderStats() {
  const st = loadStats();
  const lvName = { easy: '简单', medium: '中等', hard: '困难' };
  let html = '<h3>📊 战绩统计</h3>';
  for (const lv of ['easy', 'medium', 'hard']) {
    const r = st.pve[lv];
    html += `<div class="stat-line"><span>${lvName[lv]}</span>
      <span><b class="w">胜${r.w}</b> · <b class="l">负${r.l}</b> · <b class="d">和${r.d}</b></span></div>`;
  }
  html += `<div class="stat-line"><span>双人对战</span>
    <span><b>黑胜${st.pvp.b}</b> · <b>白胜${st.pvp.w}</b> · <b>和${st.pvp.d}</b></span></div>`;
  html += `<div class="stat-line"><span>当前连胜 / 最高连胜</span><span><b>${st.streak}</b> / <b>${st.bestStreak}</b></span></div>`;
  $('statsBox').innerHTML = html;
}

// ---------- 本地存档：对局进度 ----------
function saveGame() {
  if (G.status !== 'playing') { localStorage.removeItem(LS_SAVE); return; }
  localStorage.setItem(LS_SAVE, JSON.stringify({
    mode: G.mode, level: G.level, playerColor: G.playerColor,
    board: G.board, history: G.history, turn: G.turn, seq: G.moveSeq,
  }));
}
function loadSavedGame() {
  try { return JSON.parse(localStorage.getItem(LS_SAVE)); } catch (e) { return null; }
}

// ---------- 菜单交互 ----------
$('pveBtn').addEventListener('click', () => {
  $('menuMain').classList.add('hidden');
  $('pveSetup').classList.remove('hidden');
});
$('pvpBtn').addEventListener('click', () => startGame('pvp'));
$('backBtn').addEventListener('click', () => {
  $('pveSetup').classList.add('hidden');
  $('menuMain').classList.remove('hidden');
});

const levelDesc = {
  easy: '简单：AI 经常犯错，适合新手熟悉规则。',
  medium: '中等：AI 有基本的攻防意识，适合练手。',
  hard: '困难：AI 全盘评估、主动封堵，不服来战。',
};
$('levelSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('levelSeg').querySelectorAll('button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  G.level = b.dataset.level;
  $('levelDesc').textContent = levelDesc[G.level];
});
$('colorSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('colorSeg').querySelectorAll('button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  G.playerColor = Number(b.dataset.color);
});
$('startPveBtn').addEventListener('click', () => startGame('pve'));

$('resumeBtn').addEventListener('click', () => {
  const s = loadSavedGame();
  if (!s) return;
  G.mode = s.mode; G.level = s.level; G.playerColor = s.playerColor;
  G.board = s.board.slice(); G.history = s.history.slice();
  G.turn = s.turn; G.status = 'playing';
  G.winner = 0; G.winLine = null;
  G.lastIdx = G.history.length ? G.history[G.history.length - 1].index : -1;
  enterGameScreen();
  renderAll();
  maybeAiTurn();
  toast('已恢复上局进度');
});

$('clearStatsBtn').addEventListener('click', () => {
  if (confirm('确定清空全部战绩统计吗？')) {
    saveStats(defaultStats());
    renderStats();
    toast('战绩已清空');
  }
});

// ---------- 开局 ----------
function startGame(mode) {
  clearTimeout(G.aiTimer);
  G.mode = mode;
  G.board = newBoard();
  G.turn = BLACK;
  G.history = [];
  G.status = 'playing';
  G.winner = 0; G.winLine = null; G.lastIdx = -1;
  enterGameScreen();
  renderAll();
  maybeAiTurn();   // 玩家执白时 AI 执黑先行
}

function enterGameScreen() {
  showScreen('game');
  $('pauseOverlay').classList.add('hidden');
  $('endOverlay').classList.add('hidden');
  $('modeInfo').textContent = G.mode === 'pve'
    ? `人机 · ${{ easy: '简单', medium: '中等', hard: '困难' }[G.level]} · 你执${G.playerColor === BLACK ? '黑' : '白'}`
    : '双人同屏 · 黑先白后';
}

// ---------- 落子 ----------
function placeStone(index) {
  if (G.status !== 'playing' || G.board[index] !== EMPTY) return false;
  const color = G.turn;
  G.board[index] = color;
  G.history.push({ index, color });
  G.lastIdx = index;
  G.moveSeq++;

  const x = index % SIZE, y = Math.floor(index / SIZE);
  const line = checkWin(G.board, x, y, color);
  if (line) {
    finishGame(color, line);
  } else if (isFull(G.board)) {
    finishGame(0, null); // 和棋
  } else {
    G.turn = color === BLACK ? WHITE : BLACK;
    maybeAiTurn();
  }
  sndPlace();
  saveGame();
  renderAll();
  return true;
}

// 人点击 / 触摸落子
const canvas = $('board');
canvas.addEventListener('pointerdown', (e) => {
  if (G.status !== 'playing') return;
  if (G.mode === 'pve' && G.turn !== G.playerColor) return; // AI 回合不可落子
  const rect = canvas.getBoundingClientRect();
  const scale = 600 / rect.width;
  const px = (e.clientX - rect.left) * scale;
  const py = (e.clientY - rect.top) * scale;
  const gx = Math.round((px - PAD) / CELL);
  const gy = Math.round((py - PAD) / CELL);
  if (gx < 0 || gx >= SIZE || gy < 0 || gy >= SIZE) return;
  placeStone(gy * SIZE + gx);
});

// ---------- AI ----------
function maybeAiTurn() {
  if (G.mode !== 'pve' || G.status !== 'playing') return;
  const aiColor = G.playerColor === BLACK ? WHITE : BLACK;
  if (G.turn !== aiColor) return;
  $('turnInfo').innerHTML = `<span class="dot ${aiColor === BLACK ? 'black' : 'white'}"></span>AI 思考中…`;
  const seqAtStart = G.moveSeq;
  G.aiTimer = setTimeout(() => {
    if (G.status !== 'playing' || G.moveSeq !== seqAtStart) return; // 局面已变化（悔棋/重开）
    const mv = aiMove(G.board, aiColor, G.level);
    placeStone(mv);
  }, 350 + Math.random() * 450);
}

// ---------- 悔棋 ----------
$('undoBtn').addEventListener('click', () => {
  if (G.status !== 'playing' || G.history.length === 0) return toast('当前不能悔棋');
  clearTimeout(G.aiTimer);
  if (G.mode === 'pvp') {
    popMove();
  } else {
    // 人机：撤回到玩家上一次落子之前（弹出 AI 的回应 + 玩家的落子）
    const aiColor = G.playerColor === BLACK ? WHITE : BLACK;
    if (G.history[G.history.length - 1].color === aiColor) popMove();
    popMove();
    G.turn = G.playerColor;
  }
  G.status = 'playing';
  G.winner = 0; G.winLine = null;
  G.lastIdx = G.history.length ? G.history[G.history.length - 1].index : -1;
  saveGame();
  renderAll();
  toast('已悔棋');
});

function popMove() {
  const m = G.history.pop();
  if (m) G.board[m.index] = EMPTY;
}

// ---------- 暂停 ----------
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeGameBtn').addEventListener('click', () => setPaused(false));
$('pauseRestartBtn').addEventListener('click', () => { setPaused(false); startGame(G.mode); });
$('pauseHomeBtn').addEventListener('click', () => goHome(true));
function setPaused(p) {
  if (p && G.status === 'playing') {
    G.status = 'paused';
    $('pauseOverlay').classList.remove('hidden');
  } else if (!p && G.status === 'paused') {
    G.status = 'playing';
    $('pauseOverlay').classList.add('hidden');
    renderAll();
    maybeAiTurn();
  }
}
// Esc 键暂停 / 继续
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (screens.game.classList.contains('active')) {
    if (G.status === 'playing') setPaused(true);
    else if (G.status === 'paused') setPaused(false);
  }
});

// ---------- 重开 / 返回 ----------
$('restartBtn').addEventListener('click', () => {
  if (G.history.length > 0 && G.status === 'playing' && !confirm('重新开始将放弃当前进度，确定吗？')) return;
  startGame(G.mode);
});
$('homeBtn').addEventListener('click', () => goHome(false));
$('endHomeBtn').addEventListener('click', () => goHome(false));

function goHome(force) {
  if (!force && G.history.length > 0 && G.status === 'playing' && !confirm('对局尚未结束，返回主菜单会保留进度吗？\n（确定=保留进度并返回）')) return;
  clearTimeout(G.aiTimer);
  showScreen('menu');
  renderStats();
  refreshResumeBtn();
}

// ---------- 结算 ----------
$('againBtn').addEventListener('click', () => startGame(G.mode));

function finishGame(winnerColor, line) {
  G.status = 'over';
  G.winner = winnerColor;
  G.winLine = line;
  clearTimeout(G.aiTimer);
  localStorage.removeItem(LS_SAVE); // 终局后清除进度存档

  const stats = recordResult(
    winnerColor === 0 ? 0
      : (G.mode === 'pve' ? (winnerColor === G.playerColor ? 1 : -1) : (winnerColor === BLACK ? 1 : -1))
  );
  renderAll();

  // 结算文案
  let title, detail;
  if (winnerColor === 0) {
    title = '🤝 和棋';
    detail = '棋盘已满，双方战成平局。';
    sndPlace();
  } else if (G.mode === 'pve') {
    const iWin = winnerColor === G.playerColor;
    title = iWin ? '🎉 你赢了！' : '💻 AI 获胜';
    detail = `${winnerColor === BLACK ? '黑方' : '白方'}五子连线。${
      iWin ? `击败${{ easy: '简单', medium: '中等', hard: '困难' }[G.level]} AI！当前连胜 ${stats.streak}。`
           : `再接再厉，试试换个开局策略。`}`;
    iWin ? sndWin() : sndLose();
  } else {
    title = `${winnerColor === BLACK ? '⚫ 黑方' : '⚪ 白方'}获胜！`;
    detail = `${winnerColor === BLACK ? '黑方' : '白方'}率先五子连线。`;
    sndWin();
  }
  $('endTitle').textContent = title;
  $('endDetail').textContent = detail;

  // 结算统计
  const lvName = { easy: '简单', medium: '中等', hard: '困难' };
  let es;
  if (G.mode === 'pve') {
    const r = stats.pve[G.level];
    es = `<div class="stat-line"><span>${lvName[G.level]}难度累计</span>
      <span><b class="w">胜${r.w}</b> · <b class="l">负${r.l}</b> · <b class="d">和${r.d}</b></span></div>
      <div class="stat-line"><span>当前连胜 / 最高连胜</span><span><b>${stats.streak}</b> / <b>${stats.bestStreak}</b></span></div>`;
  } else {
    es = `<div class="stat-line"><span>双人对战累计</span>
      <span><b>黑胜${stats.pvp.b}</b> · <b>白胜${stats.pvp.w}</b> · <b>和${stats.pvp.d}</b></span></div>`;
  }
  $('endStats').innerHTML = es;

  setTimeout(() => $('endOverlay').classList.remove('hidden'), line ? 650 : 200);
}

// ---------- 渲染 ----------
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = 600 * DPR; canvas.height = 600 * DPR;
ctx.scale(DPR, DPR);

const PAD = 24;
const CELL = (600 - PAD * 2) / (SIZE - 1);

function renderAll() {
  renderBoard();
  renderTurnInfo();
}

function renderTurnInfo() {
  if (G.status === 'over') {
    $('turnInfo').textContent = G.winner === 0 ? '和棋' : `${G.winner === BLACK ? '黑方' : '白方'}获胜`;
    return;
  }
  if (G.mode === 'pve') {
    if (G.turn === G.playerColor) $('turnInfo').innerHTML = `<span class="dot ${G.turn === BLACK ? 'black' : 'white'}"></span>轮到你走（${G.turn === BLACK ? '黑' : '白'}）`;
    // AI 思考文案由 maybeAiTurn 设置
  } else {
    $('turnInfo').innerHTML = `<span class="dot ${G.turn === BLACK ? 'black' : 'white'}"></span>${G.turn === BLACK ? '黑方' : '白方'}回合`;
  }
}

function renderBoard() {
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
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, PAD, 600 - PAD * 2, 600 - PAD * 2);

  // 星位
  ctx.fillStyle = 'rgba(60,40,10,.85)';
  for (const [sx, sy] of [[3,3],[11,3],[3,11],[11,11],[7,7]]) {
    ctx.beginPath();
    ctx.arc(PAD + sx * CELL, PAD + sy * CELL, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 坐标
  ctx.fillStyle = 'rgba(60,40,10,.65)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < SIZE; i++) {
    ctx.fillText(String.fromCharCode(65 + i), PAD + i * CELL, PAD - 12);
    ctx.fillText(String(i + 1), PAD - 13, PAD + i * CELL);
  }

  // 获胜连线
  if (G.winLine && G.winLine.length >= 2) {
    const [x1, y1] = G.winLine[0];
    const [x2, y2] = G.winLine[G.winLine.length - 1];
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
    const v = G.board[i];
    if (!v) continue;
    drawStone(PAD + (i % SIZE) * CELL, PAD + Math.floor(i / SIZE) * CELL, v, stoneR);
  }

  // 最后一手标记
  if (G.lastIdx >= 0 && G.board[G.lastIdx]) {
    const x = PAD + (G.lastIdx % SIZE) * CELL;
    const y = PAD + Math.floor(G.lastIdx / SIZE) * CELL;
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

// ---------- 音效开关 ----------
$('soundBtn').addEventListener('click', () => {
  const on = soundEnabled();
  localStorage.setItem(LS_SOUND, on ? 'off' : 'on');
  $('soundBtn').textContent = on ? '🔇 静音' : '🔊 音效';
  toast(on ? '音效已关闭' : '音效已开启');
});

// ---------- 启动 ----------
function refreshResumeBtn() {
  const s = loadSavedGame();
  $('resumeBtn').classList.toggle('hidden', !(s && s.history && s.history.length > 0));
}

$('soundBtn').textContent = soundEnabled() ? '🔊 音效' : '🔇 静音';
renderStats();
refreshResumeBtn();

// 防止离开页面丢失进度（已有自动存档，这里只是兜底提示）
window.addEventListener('beforeunload', () => saveGame());
