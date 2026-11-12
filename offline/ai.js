// 五子棋 AI 引擎：基于棋型评分（连五/活四/冲四/活三/眠三/活二...）+ 攻防权重
// 难度：easy（偏随机）/ medium（基础攻防启发）/ hard（全盘棋型评估 + 立即胜/挡四/双威胁检测）
// （浏览器版，依赖 game.js 中的全局函数；BLACK/WHITE 常量由 app.js 定义）

// 单方向打分：以 (x,y) 为中心假设落下 color，统计该方向连子数与两端开放度
function lineScore(board, x, y, dx, dy, color) {
  let count = 1;
  let blocks = 0;
  let nx = x + dx, ny = y + dy;
  while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
    count++; nx += dx; ny += dy;
  }
  const openForward = nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === 0;
  if (!openForward && !(nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE)) blocks++;
  else if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) blocks++;

  nx = x - dx; ny = y - dy;
  while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
    count++; nx -= dx; ny -= dy;
  }
  const openBack = nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === 0;
  if (!openBack && !(nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE)) blocks++;
  else if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) blocks++;

  const open = 2 - blocks;
  if (count >= 5) return 10000000;         // 成五
  if (count === 4) {
    if (open === 2) return 1000000;        // 活四
    if (open === 1) return 100000;         // 冲四
    return 0;                              // 死四
  }
  if (count === 3) {
    if (open === 2) return 50000;          // 活三
    if (open === 1) return 3000;           // 眠三
    return 0;
  }
  if (count === 2) {
    if (open === 2) return 3000;           // 活二
    if (open === 1) return 500;            // 眠二
    return 0;
  }
  if (count === 1) {
    if (open === 2) return 200;            // 活一
    if (open === 1) return 30;
    return 0;
  }
  return 0;
}

// 评估在 (x,y) 落 color 的总进攻分
function pointAttackScore(board, x, y, color) {
  let s = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    s += lineScore(board, x, y, dx, dy, color);
  }
  return s;
}

// hard 难度：全盘格局分（已有棋型价值）
function boardShapeScore(board, color) {
  let s = 0;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== color) continue;
      for (const [dx, dy] of dirs) {
        const px = x - dx, py = y - dy;
        if (px >= 0 && px < SIZE && py >= 0 && py < SIZE && board[idx(px, py)] === color) continue;
        let count = 1, blocks = 0;
        let nx = x + dx, ny = y + dy;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
          count++; nx += dx; ny += dy;
        }
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || board[idx(nx, ny)] !== 0) blocks++;
        const open = 2 - blocks;
        if (count >= 4) s += open === 2 ? 500000 : 50000;
        else if (count === 3) s += open === 2 ? 25000 : 1500;
        else if (count === 2) s += open === 2 ? 1500 : 200;
      }
    }
  }
  return s;
}

function pickBest(board, color, level) {
  const opp = color === BLACK ? WHITE : BLACK;
  const cands = candidates(board, 2);
  if (cands.length === 0) return idx(7, 7);

  if (level === 'easy') {
    if (Math.random() < 0.8) {
      return cands[Math.floor(Math.random() * cands.length)];
    }
  }

  const scored = [];
  const centerBias = level === 'hard' ? 8 : 4;
  for (const i of cands) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const winNow = checkWin(board, x, y, color);
    board[i] = 0;
    let score;
    if (winNow) {
      score = 1e12;
    } else {
      const attack = pointAttackScore(board, x, y, color);
      const defend = pointAttackScore(board, x, y, opp);
      const defWeight = level === 'hard' ? 0.9 : level === 'medium' ? 0.8 : 0.25;
      score = attack + defend * defWeight;
      if (level === 'hard') {
        board[i] = color;
        const shape = boardShapeScore(board, color) - boardShapeScore(board, opp) * 0.5;
        board[i] = 0;
        score += shape * 0.02;
      }
      const cx = Math.abs(x - 7) + Math.abs(y - 7);
      score -= cx * centerBias;
      score += Math.random() * (level === 'hard' ? 10 : 60);
    }
    scored.push({ i, score });
  }

  scored.sort((a, b) => b.score - a.score);
  if (level === 'easy') {
    const top = scored.slice(0, Math.min(5, scored.length));
    return top[Math.floor(Math.random() * top.length)].i;
  }
  return scored[0].i;
}

function aiMove(board, color, level) {
  if (level === 'hell') return pickHell(board, color);
  if (level === 'world') return pickWorld(board, color);
  return pickBest(board, color, level);
}

/* ==================== 地狱模式：多路威胁构建 + 二层验证防守 ==================== */

const DIRS4 = [[1, 0], [0, 1], [1, 1], [1, -1]];

function sumDir(ds) { return ds.reduce((a, b) => a + b, 0); }

// 取 (x,y) 四个方向在 color 落子后的方向分（board 中 (x,y) 需已有该子）
function dirScores(board, x, y, color) {
  return DIRS4.map(([dx, dy]) => lineScore(board, x, y, dx, dy, color));
}

// color 在候选点中能立即成五的点
function winPointsOf(board, color, cands) {
  const out = [];
  for (const i of cands) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    if (checkWin(board, x, y, color)) out.push(i);
    board[i] = 0;
  }
  return out;
}

// color 落子能形成四（含活四/冲四）的点
function fourPointsOf(board, color, cands) {
  const out = [];
  for (const i of cands) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const ds = dirScores(board, x, y, color);
    board[i] = 0;
    if (ds.some(s => s >= 1e5 && s < 1e7)) out.push(i);
  }
  return out;
}

// 简化 VCF：连续冲四取胜搜索，返回第一手落点或 null
function vcfSearch(board, color, depth) {
  const cands = candidates(board, 2);
  if (cands.length === 0) return null;
  const opp = 3 - color;
  for (const i of fourPointsOf(board, color, cands)) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const wins = winPointsOf(board, color, candidates(board, 2));
    if (wins.length >= 2) { board[i] = 0; return i; }  // 双四点，必胜
    if (wins.length === 1 && depth > 1) {
      const blk = wins[0];
      board[blk] = opp;
      const bx = blk % SIZE, by = Math.floor(blk / SIZE);
      // 对方被迫挡子后若反成五威胁，此路不通
      const ok = !checkWin(board, bx, by, opp)
        && winPointsOf(board, opp, candidates(board, 2)).length === 0;
      if (ok) {
        const deeper = vcfSearch(board, color, depth - 1);
        if (deeper !== null) { board[blk] = 0; board[i] = 0; return i; }
      }
      board[blk] = 0;
    }
    board[i] = 0;
  }
  return null;
}

function pickHell(board, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  const cands = candidates(board, 2);
  if (!cands.length) return idx(7, 7);
  if (cands.length === 1) return cands[0];

  // 预计算：每个候选点我方/对方落子后的方向分
  const info = cands.map(i => {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const win = checkWin(board, x, y, color);
    const myDirs = win ? [1e9, 0, 0, 0] : dirScores(board, x, y, color);
    board[i] = 0;
    const oppDirs = dirScores(board, x, y, opp);
    return { i, x, y, win, myDirs, oppDirs };
  });

  // 1. 立即取胜
  const w = info.find(d => d.win);
  if (w) return w.i;

  // 2. 对方能成五 → 必挡（选自身进攻分最高的挡点）
  const oppWinPts = info.filter(d => d.oppDirs.some(s => s >= 1e7));
  if (oppWinPts.length) {
    return oppWinPts.reduce((a, b) => sumDir(b.myDirs) > sumDir(a.myDirs) ? b : a).i;
  }

  // 3. 我方能成活四且对方无四威胁 → 直接下（两步必胜）
  const myOpenFour = info.find(d => d.myDirs.some(s => s >= 1e6));
  const oppFourPts = info.filter(d => d.oppDirs.some(s => s >= 1e5 && s < 1e7));
  if (myOpenFour && oppFourPts.length === 0) return myOpenFour.i;

  // 4. 对方有四威胁（含活四点）→ 必封堵（兼顾自身进攻）
  if (oppFourPts.length) {
    return oppFourPts.reduce((a, b) => sumDir(b.myDirs) > sumDir(a.myDirs) ? b : a).i;
  }

  // 5. 通用评分：攻防 + 主动构建多路威胁（双活三 / 四三杀）
  for (const d of info) {
    const myThrees = d.myDirs.filter(s => s >= 5e4 && s < 1e5).length;  // 活三
    const myFours = d.myDirs.filter(s => s >= 1e5 && s < 1e6).length;   // 冲四
    let score = sumDir(d.myDirs) + sumDir(d.oppDirs) * 0.95;
    if (myFours >= 1 && myThrees >= 1) score += 600000;       // 四三双杀
    else if (myThrees + myFours >= 2) score += 350000;        // 双活三 / 双四
    else if (myThrees === 1) score += 80000;
    score -= (Math.abs(d.x - 7) + Math.abs(d.y - 7)) * 4;
    score += Math.random() * 8;
    d.score = score;
  }
  info.sort((a, b) => b.score - a.score);

  // 6. 二层验证：模拟我落子后对方最强回应，杜绝送出先手
  let best = info[0], bestVal = -Infinity;
  for (const d of info.slice(0, 6)) {
    board[d.i] = color;
    let oppBest = 0;
    for (const j of candidates(board, 2)) {
      const jx = j % SIZE, jy = Math.floor(j / SIZE);
      board[j] = opp;
      const v = checkWin(board, jx, jy, opp) ? 1e9 : sumDir(dirScores(board, jx, jy, opp));
      board[j] = 0;
      if (v > oppBest) oppBest = v;
    }
    board[d.i] = 0;
    const val = d.score - oppBest * 0.85;
    if (val > bestVal) { bestVal = val; best = d; }
  }
  return best.i;
}

/* ==================== 世界模式：VCF + 迭代加深 α-β 全盘搜索 ==================== */

// 全盘棋型评估（含组合威胁：四三 / 双活三）
function shapeScoreWorld(board, color) {
  let s = 0, live3 = 0, four = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== color) continue;
      for (const [dx, dy] of DIRS4) {
        const px = x - dx, py = y - dy;
        if (px >= 0 && px < SIZE && py >= 0 && py < SIZE && board[idx(px, py)] === color) continue;
        let count = 1, blocks = 0;
        let nx = x + dx, ny = y + dy;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
          count++; nx += dx; ny += dy;
        }
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || board[idx(nx, ny)] !== 0) blocks++;
        const open = 2 - blocks;
        if (count >= 5) s += 1e7;
        else if (count === 4) { s += open === 2 ? 3e5 : 2.5e4; four++; }
        else if (count === 3) { if (open === 2) { s += 3e4; live3++; } else s += 2500; }
        else if (count === 2) s += open === 2 ? 2500 : 350;
        else s += open === 2 ? 150 : 20;
      }
    }
  }
  if (four >= 1 && live3 >= 1) s += 5e5;   // 四三双杀结构
  else if (live3 >= 2) s += 2.5e5;          // 双活三结构
  return s;
}

function evalBoardWorld(board, aiColor) {
  return shapeScoreWorld(board, aiColor) - shapeScoreWorld(board, 3 - aiColor) * 1.15;
}

// 搜索节点走子生成：取胜手直接返回；必挡点保底；其余按静态分排序截断
function worldOrderedMoves(board, mover, limit) {
  const other = 3 - mover;
  const cands = candidates(board, 2);
  const scored = [];
  let winMove = null;
  const oppFivePts = [], oppFourPts = [];
  for (const i of cands) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = mover;
    const isWin = checkWin(board, x, y, mover);
    const myDirs = isWin ? null : dirScores(board, x, y, mover);
    board[i] = 0;
    if (isWin) { winMove = i; break; }
    const oppDirs = dirScores(board, x, y, other);
    if (oppDirs.some(s => s >= 1e7)) oppFivePts.push(i);
    else if (oppDirs.some(s => s >= 1e5)) oppFourPts.push(i);
    scored.push({ i, s: sumDir(myDirs) + sumDir(oppDirs) * 0.9 - (Math.abs(x - 7) + Math.abs(y - 7)) * 3 });
  }
  if (winMove !== null) return [winMove];
  scored.sort((a, b) => b.s - a.s);
  const list = scored.slice(0, limit).map(d => d.i);
  for (const i of oppFivePts) if (!list.includes(i)) list.push(i);       // 必挡成五点
  for (const i of oppFourPts.slice(0, 3)) if (!list.includes(i)) list.push(i); // 保底挡四
  return list;
}

function worldSearch(board, depth, alpha, beta, mover, aiColor, deadline, ply) {
  if (Date.now() > deadline) throw { timeout: true };
  if (depth <= 0) return evalBoardWorld(board, aiColor);
  const moves = worldOrderedMoves(board, mover, ply <= 2 ? 12 : 8);
  if (!moves.length) return evalBoardWorld(board, aiColor);
  if (mover === aiColor) {
    let best = -Infinity;
    for (const m of moves) {
      const x = m % SIZE, y = Math.floor(m / SIZE);
      board[m] = mover;
      const sc = checkWin(board, x, y, mover)
        ? 1e9 - ply
        : worldSearch(board, depth - 1, alpha, beta, 3 - mover, aiColor, deadline, ply + 1);
      board[m] = 0;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const x = m % SIZE, y = Math.floor(m / SIZE);
      board[m] = mover;
      const sc = checkWin(board, x, y, mover)
        ? -1e9 + ply
        : worldSearch(board, depth - 1, alpha, beta, 3 - mover, aiColor, deadline, ply + 1);
      board[m] = 0;
      if (sc < best) best = sc;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function worldRoot(board, aiColor, depth, deadline) {
  const moves = worldOrderedMoves(board, aiColor, 14);
  let bestMove = moves[0], bestScore = -Infinity, alpha = -Infinity;
  for (const m of moves) {
    const x = m % SIZE, y = Math.floor(m / SIZE);
    board[m] = aiColor;
    const sc = checkWin(board, x, y, aiColor)
      ? 1e9
      : worldSearch(board, depth - 1, alpha, Infinity, 3 - aiColor, aiColor, deadline, 1);
    board[m] = 0;
    if (sc > bestScore) { bestScore = sc; bestMove = m; }
    if (sc > alpha) alpha = sc;
  }
  return bestMove;
}

// 静态兜底（极端情况下才走到）
function staticBest(board, color) {
  const opp = 3 - color;
  let best = null, bestS = -Infinity;
  for (const i of candidates(board, 2)) {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const a = sumDir(dirScores(board, x, y, color));
    board[i] = 0;
    const s = a + sumDir(dirScores(board, x, y, opp)) * 0.9;
    if (s > bestS) { bestS = s; best = i; }
  }
  return best;
}

function pickWorld(board, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  const cands = candidates(board, 2);
  if (!cands.length) return idx(7, 7);
  if (cands.length === 1) return cands[0];

  // 1. 立即取胜
  const myWins = winPointsOf(board, color, cands);
  if (myWins.length) return myWins[0];

  // 2. VCF 连续冲四取胜
  const vcf = vcfSearch(board, color, 3);
  if (vcf !== null) return vcf;

  // 3. 对方成五点 → 必挡（无杀招时）
  const oppWins = winPointsOf(board, opp, cands);
  if (oppWins.length) {
    let best = oppWins[0], bestS = -Infinity;
    for (const i of oppWins) {
      const x = i % SIZE, y = Math.floor(i / SIZE);
      board[i] = color;
      const s = sumDir(dirScores(board, x, y, color));
      board[i] = 0;
      if (s > bestS) { bestS = s; best = i; }
    }
    return best;
  }

  // 4. 迭代加深 α-β：深度 2 → 4 → 6，时间预算 1.1 秒
  const deadline = Date.now() + 1100;
  let best = null;
  for (const depth of [2, 4, 6]) {
    try {
      best = worldRoot(board, color, depth, deadline);
    } catch (e) { break; }  // 超时沿用上一层完整结果
  }
  return best !== null ? best : staticBest(board, color);
}
