/* ============ 数独单机版 · 界面逻辑 ============ */
'use strict';

const LEVELS = {
  easy:   { name: '简单', desc: '简单：约 40 个提示数字，适合入门热身。', clues: 40 },
  medium: { name: '中等', desc: '中等：约 32 个提示数字，适合大多数玩家。', clues: 32 },
  hard:   { name: '困难', desc: '困难：约 26 个提示数字，挑战高手。', clues: 26 },
};
const STATS_KEY = 'sudoku_offline_stats_v1';
const PROGRESS_KEY = 'sudoku_offline_progress_v1';

const $ = id => document.getElementById(id);

const G = {
  level: 'medium',
  puzzle: [], solution: [], board: [], fixed: [],
  selected: -1,          // 当前选中格
  notes: [],             // 候选笔记（不对外主推，保留扩展）
  mistakes: 0,
  seconds: 0,
  timerId: null,
  paused: false,
  over: false,
  undoStack: [],         // {idx, prev}
  startTime: null,
};

/* ---------- 工具 ---------- */
function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveStats(st) { localStorage.setItem(STATS_KEY, JSON.stringify(st)); }

/* ---------- 开始界面 ---------- */
function renderStats() {
  const st = loadStats();
  const box = $('statsBox');
  const lines = Object.keys(LEVELS).map(lv => {
    const s = st[lv] || { win: 0, best: 0, bestErr: null };
    const best = s.best ? `${fmt(s.best)}${s.bestErr !== null ? ` / 错${s.bestErr}` : ''}` : '—';
    return `<div class="stat-line"><span>${LEVELS[lv].name}</span><span>胜场 <b class="w">${s.win}</b> · 最佳 <b>${best}</b></span></div>`;
  });
  box.innerHTML = `<h3>📊 战绩统计</h3>` + lines.join('');
}

$('levelSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  G.level = b.dataset.level;
  [...$('levelSeg').children].forEach(x => x.classList.toggle('on', x === b));
  $('levelDesc').textContent = LEVELS[G.level].desc;
});

$('newBtn').addEventListener('click', () => {
  $('menuMain').classList.add('hidden');
  $('setupCard').classList.remove('hidden');
});
$('backBtn').addEventListener('click', () => {
  $('setupCard').classList.add('hidden');
  $('menuMain').classList.remove('hidden');
});
$('startBtn').addEventListener('click', () => newGame(G.level));
$('clearStatsBtn').addEventListener('click', () => {
  localStorage.removeItem(STATS_KEY);
  renderStats();
  toast('战绩已清空');
});

/* ---------- 游戏流程 ---------- */
function newGame(level) {
  showScreen('gameScreen');
  $('endOverlay').classList.add('hidden');
  $('pauseOverlay').classList.add('hidden');
  G.paused = false;
  G.level = level;
  const { puzzle, solution, clues } = generateSudoku(level);
  G.puzzle = puzzle;
  G.solution = solution;
  G.board = puzzle.slice();
  G.fixed = puzzle.map(v => v !== 0);
  G.notes = new Array(81).fill('').map(() => new Set());
  G.selected = -1;
  G.mistakes = 0;
  G.seconds = 0;
  G.paused = false;
  G.over = false;
  G.undoStack = [];
  buildBoard();
  buildNumpad();
  $('modeInfo').textContent = `${LEVELS[level].name} · ${clues} 提示`;
  updateHud();
  startTimer();
  saveProgress();
  toast('新局开始，加油！');
}

function startTimer() {
  clearInterval(G.timerId);
  G.timerId = setInterval(() => {
    if (!G.paused && !G.over) {
      G.seconds++;
      updateHud();
    }
  }, 1000);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(name).classList.add('active');
}

function goHome(save = true) {
  clearInterval(G.timerId);
  if (save && !G.over && G.board.some((v, i) => v !== G.puzzle[i])) saveProgress();
  if (save && !G.over) $('resumeBtn').classList.remove('hidden');
  showScreen('menuScreen');
  renderStats();
}

/* ---------- 棋盘渲染 ---------- */
function buildBoard() {
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.idx = i;
    const r = Math.floor(i / 9), c = i % 9;
    if (c === 2 || c === 5) cell.classList.add('br3');
    if (r === 2 || r === 5) cell.classList.add('bb3');
    if (G.fixed[i]) cell.classList.add('fixed');
    cell.textContent = G.board[i] || '';
    board.appendChild(cell);
  }
  board.addEventListener('click', onCellClick);
}

function onCellClick(e) {
  const cell = e.target.closest('.cell');
  if (!cell || G.paused || G.over) return;
  const idx = +cell.dataset.idx;
  if (G.fixed[idx]) { G.selected = -1; refreshBoard(); return; }
  G.selected = G.selected === idx ? -1 : idx;
  refreshBoard();
}

// 冲突检测：与同行/列/宫的其它相同数字
function conflictsOf(board) {
  const set = new Set();
  const groups = [];
  for (let r = 0; r < 9; r++) groups.push([...Array(9).keys()].map(c => r * 9 + c));
  for (let c = 0; c < 9; c++) groups.push([...Array(9).keys()].map(r => r * 9 + c));
  for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++) {
    const g = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) g.push((br * 3 + dr) * 9 + bc * 3 + dc);
    groups.push(g);
  }
  for (const g of groups) {
    const seen = {};
    for (const i of g) {
      const v = board[i];
      if (!v) continue;
      (seen[v] = seen[v] || []).push(i);
    }
    for (const v in seen) if (seen[v].length > 1) seen[v].forEach(i => set.add(i));
  }
  return set;
}

function refreshBoard() {
  const conf = conflictsOf(G.board);
  const selVal = G.selected >= 0 ? G.board[G.selected] : 0;
  const selR = G.selected >= 0 ? Math.floor(G.selected / 9) : -1;
  const selC = G.selected >= 0 ? G.selected % 9 : -1;
  const selB = G.selected >= 0 ? Math.floor(selR / 3) * 3 + Math.floor(selC / 3) : -1;

  document.querySelectorAll('#board .cell').forEach(cell => {
    const i = +cell.dataset.idx;
    const v = G.board[i];
    cell.classList.toggle('sel', i === G.selected);
    cell.classList.toggle('conflict', conf.has(i));
    const r = Math.floor(i / 9), c = i % 9;
    const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    cell.classList.toggle('peer', G.selected >= 0 && i !== G.selected && (r === selR || c === selC || b === selB));
    cell.classList.toggle('same', G.selected >= 0 && i !== G.selected && v !== 0 && v === selVal);
    cell.classList.remove('user');
    if (v && !G.fixed[i]) cell.classList.add('user');
    cell.textContent = v || '';
  });
}

function updateHud() {
  $('timeInfo').textContent = '⏱ ' + fmt(G.seconds);
  const e = $('errInfo');
  e.textContent = '✖ ' + G.mistakes;
  e.classList.toggle('zero', G.mistakes === 0);
}

/* ---------- 数字键盘 ---------- */
function remainingCount(v) {
  let placed = 0;
  for (let i = 0; i < 81; i++) if (G.board[i] === v) placed++;
  return 9 - placed;
}

function buildNumpad() {
  const pad = $('numpad');
  pad.innerHTML = '';
  for (let v = 1; v <= 9; v++) {
    const b = document.createElement('button');
    b.className = 'num';
    b.dataset.v = v;
    b.innerHTML = `${v}<span class="rem"></span>`;
    b.addEventListener('click', () => inputNumber(v));
    pad.appendChild(b);
  }
  const undo = document.createElement('button');
  undo.className = 'num act';
  undo.textContent = '⌫ 擦除';
  undo.addEventListener('click', eraseCell);
  pad.appendChild(undo);
  refreshNumpad();
}

function refreshNumpad() {
  document.querySelectorAll('#numpad .num[data-v]').forEach(b => {
    const v = +b.dataset.v;
    const rem = remainingCount(v);
    b.querySelector('.rem').textContent = rem > 0 ? rem : '';
    b.classList.toggle('done', rem <= 0);
  });
}

function inputNumber(v) {
  if (G.paused || G.over) return;
  if (G.selected < 0) { toast('请先点击一个空格'); return; }
  const idx = G.selected;
  if (G.fixed[idx]) return;
  const prev = G.board[idx];
  if (prev === v) return;
  G.undoStack.push({ idx, prev });
  G.board[idx] = v;
  // 实时校验：与当前盘面其他数字冲突 => 记一次错误
  if (conflictsOf(G.board).has(idx)) {
    G.mistakes++;
    toast('⚠ 该数字与同行/列/宫冲突');
  }
  updateHud();
  refreshBoard();
  refreshNumpad();
  saveProgress();
  checkWin();
}

function eraseCell() {
  if (G.paused || G.over) return;
  if (G.selected < 0) return;
  const idx = G.selected;
  if (G.fixed[idx] || !G.board[idx]) return;
  G.undoStack.push({ idx, prev: G.board[idx] });
  G.board[idx] = 0;
  refreshBoard();
  refreshNumpad();
  saveProgress();
}

/* ---------- 操作按钮 ---------- */
$('numpad'); // 占位

$('undoBtn').addEventListener('click', () => {
  if (G.paused || G.over) return;
  const op = G.undoStack.pop();
  if (!op) { toast('没有可撤销的操作'); return; }
  G.board[op.idx] = op.prev;
  refreshBoard();
  refreshNumpad();
  saveProgress();
});

$('checkBtn').addEventListener('click', () => {
  if (G.paused || G.over) return;
  const filled = G.board.every(v => v !== 0);
  const wrong = [];
  for (let i = 0; i < 81; i++) {
    if (G.board[i] && !G.fixed[i] && G.board[i] !== G.solution[i]) wrong.push(i);
  }
  if (wrong.length === 0) {
    if (filled) { checkWin(); return; }
    toast('✔ 目前填写的数字全部正确，继续！');
  } else {
    // 标记错误格
    document.querySelectorAll('#board .cell').forEach(cell => {
      if (wrong.includes(+cell.dataset.idx)) cell.classList.add('wrong-mark');
    });
    toast(`✘ 有 ${wrong.length} 处与答案不符（已划线标记）`, 2500);
    setTimeout(() => {
      document.querySelectorAll('.wrong-mark').forEach(c => c.classList.remove('wrong-mark'));
    }, 3000);
  }
});

$('resetBtn').addEventListener('click', () => {
  if (G.paused || G.over) return;
  if (!confirm('清空所有已填数字，恢复到初始题目？')) return;
  G.board = G.puzzle.slice();
  G.undoStack = [];
  G.selected = -1;
  refreshBoard();
  refreshNumpad();
  saveProgress();
  toast('已清空重填');
});

$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeGameBtn').addEventListener('click', () => setPaused(false));
$('pauseHomeBtn').addEventListener('click', () => { setPaused(false); goHome(true); });
$('homeBtn').addEventListener('click', () => goHome(true));
$('newGameBtn').addEventListener('click', () => { if (confirm('放弃当前进度，开一局新的？')) newGame(G.level); });
$('againBtn').addEventListener('click', () => newGame(G.level));
$('endHomeBtn').addEventListener('click', () => goHome(false));

function setPaused(p) {
  G.paused = p;
  $('pauseOverlay').classList.toggle('hidden', !p);
  if (p) saveProgress();
}

document.addEventListener('keydown', e => {
  if (!$('gameScreen').classList.contains('active')) return;
  if (e.key === 'Escape') { setPaused(!G.paused); return; }
  if (G.paused || G.over) return;
  if (e.key >= '1' && e.key <= '9') { inputNumber(+e.key); return; }
  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { eraseCell(); return; }
  if (e.key.startsWith('Arrow') && G.selected >= 0) {
    const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    let n = G.selected + moves[e.key];
    if (e.key === 'ArrowLeft' && G.selected % 9 === 0) return;
    if (e.key === 'ArrowRight' && G.selected % 9 === 8) return;
    if (n >= 0 && n < 81) { G.selected = n; if (G.fixed[n]) refreshBoard(); else refreshBoard(); }
    e.preventDefault();
  }
});

/* ---------- 胜利与结算 ---------- */
function checkWin() {
  if (G.over) return;
  const done = G.board.every((v, i) => v === G.solution[i]);
  if (!done) return;
  G.over = true;
  clearInterval(G.timerId);
  localStorage.removeItem(PROGRESS_KEY);

  const st = loadStats();
  const s = st[G.level] || { win: 0, best: 0, bestErr: null };
  s.win++;
  if (!s.best || G.seconds < s.best) { s.best = G.seconds; s.bestErr = G.mistakes; }
  st[G.level] = s;
  saveStats(st);

  setTimeout(() => {
    $('endTitle').textContent = G.mistakes === 0 ? '🎉 完美通关！' : '🎉 完成！';
    $('endDetail').textContent = `难度：${LEVELS[G.level].name} · 用时 ${fmt(G.seconds)} · 错误 ${G.mistakes} 次`;
    $('endStats').innerHTML = `
      <div class="stat-line"><span>本难度胜场</span><b class="w">${s.win}</b></div>
      <div class="stat-line"><span>最佳纪录</span><b>${fmt(s.best)}${s.bestErr !== null ? ` / 错${s.bestErr}` : ''}</b></div>`;
    $('endOverlay').classList.remove('hidden');
  }, 400);
}

/* ---------- 进度存档 ---------- */
function saveProgress() {
  if (G.over) return;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({
    level: G.level, board: G.board, puzzle: G.puzzle, solution: G.solution,
    mistakes: G.mistakes, seconds: G.seconds, undo: G.undoStack, ts: Date.now(),
  }));
}

function tryResume() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (!p || !p.board) return false;
    // 超过 24 小时的进度不恢复
    if (Date.now() - p.ts > 86400000) { localStorage.removeItem(PROGRESS_KEY); return false; }
    G.level = p.level; G.board = p.board; G.puzzle = p.puzzle; G.solution = p.solution;
    G.fixed = p.puzzle.map(v => v !== 0);
    G.notes = new Array(81).fill('').map(() => new Set());
    G.mistakes = p.mistakes; G.seconds = p.seconds; G.undoStack = p.undo || [];
    G.selected = -1; G.paused = false; G.over = false;
    buildBoard(); buildNumpad();
    $('modeInfo').textContent = `${LEVELS[G.level].name} · 继续上局`;
    updateHud(); startTimer();
    return true;
  } catch (e) { return false; }
}

$('resumeBtn').addEventListener('click', () => {
  if (tryResume()) { showScreen('gameScreen'); toast('已恢复上局进度'); }
  else { $('resumeBtn').classList.add('hidden'); toast('没有可恢复的进度'); }
});

/* ---------- PWA 安装 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBtn').classList.remove('hidden');
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('installBtn').classList.add('hidden');
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- 启动 ---------- */
renderStats();
if (localStorage.getItem(PROGRESS_KEY)) $('resumeBtn').classList.remove('hidden');
window.addEventListener('pagehide', () => { if (!G.over && document.querySelector('#gameScreen.active')) saveProgress(); });
