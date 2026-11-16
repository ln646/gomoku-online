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

// 预计算每个候选点的落子信息（我方落子后的方向分 / 对方落子后的方向分）
function buildMoveInfo(board, color, cands) {
  const opp = 3 - color;
  return cands.map(i => {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    board[i] = color;
    const win = !!checkWin(board, x, y, color);
    const myDirs = win ? [1e9, 1e9, 1e9, 1e9] : dirScores(board, x, y, color);
    board[i] = 0;
    const oppDirs = dirScores(board, x, y, opp);
    return { i, x, y, win, myDirs, oppDirs, mySum: sumDir(myDirs), oppSum: sumDir(oppDirs) };
  });
}

// 假如 color 落在 i，之后能直接连五的点有几个（>=2 即活四/双四，两步必胜）
function countFivePoints(board, color, i) {
  if (board[i] !== 0) return 0;
  board[i] = color;
  const n = winPointsOf(board, color, candidates(board, 2)).length;
  board[i] = 0;
  return n;
}

// 硬规则（优先级严格，不可被任何进攻思路覆盖）：
//   1) 自己能连五 → 直接赢
//   2) 对方能连五 → 必须堵（冲四/活四面前，进攻一律让位）
//   3) 自己一手造出双成五点（活四 / 双四）→ 必胜
//   4) 对方一手能造出双成五点（活四 / 双四）→ 必须堵，返回全部候选点交给上层择优
// 返回 { move, kind, options }（options 为可接受的落点集合），没有强制手时返回 null
function forcedMove(board, color, info) {
  const opp = 3 - color;
  if (!info) {
    const cands = candidates(board, 2);
    if (!cands.length) return null;
    info = buildMoveInfo(board, color, cands);
  }

  // 1. 立即取胜
  const own = info.find(d => d.win);
  if (own) return { move: own.i, kind: 'win', options: [own.i] };

  // 2. 对方成五点：必挡（只挑自身进攻价值最高的挡点）
  const oppFive = info.filter(d => d.oppDirs.some(s => s >= 1e7));
  if (oppFive.length) {
    return {
      move: oppFive.reduce((a, b) => (b.mySum > a.mySum ? b : a)).i,
      kind: 'block-five',
      options: oppFive.map(d => d.i),
    };
  }

  // 3. 我方一手成双成五点 → 两步必胜
  let bestC = null, bestCv = -Infinity;
  for (const d of info) {
    if (!d.myDirs.some(s => s >= 1e5)) continue;
    if (countFivePoints(board, color, d.i) < 2) continue;
    const v = d.mySum + d.oppSum;
    if (v > bestCv) { bestCv = v; bestC = d; }
  }
  if (bestC) return { move: bestC.i, kind: 'make-live-four', options: [bestC.i] };

  // 4. 对方一手能成双成五点（活四/双四）→ 必须堵，候选点全部返回
  let bestD = null, bestDv = -Infinity;
  const defPts = [];
  for (const d of info) {
    if (!d.oppDirs.some(s => s >= 1e5)) continue;
    if (countFivePoints(board, opp, d.i) < 2) continue;
    defPts.push(d.i);
    if (d.mySum > bestDv) { bestDv = d.mySum; bestD = d; }
  }
  if (bestD) return { move: bestD.i, kind: 'block-live-four', options: defPts };

  return null;
}

// 简化 VCF：连续冲四取胜搜索，返回第一手落点或 null
function vcfSearch(board, color, depth) {
  const cands = candidates(board, 2);
  if (cands.length === 0) return null;
  const opp = 3 - color;
  // 对方已有成五点：任何冲四战术都来不及，对方会直接连五
  if (winPointsOf(board, opp, cands).length) return null;
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

// 地狱模式：硬规则 + 冲四连击 + 浅层搜索（评估偏进攻，主动造双威胁）
function pickHell(board, color) {
  const cands = candidates(board, 2);
  if (!cands.length) return idx(7, 7);
  if (cands.length === 1) return cands[0];

  // 1. 硬规则：立即取胜 / 挡对方连五 / 我方活四必胜 / 挡对方活四
  const info = buildMoveInfo(board, color, cands);
  const forced = forcedMove(board, color, info);
  if (forced) {
    if (forced.kind === 'block-live-four' && forced.options.length > 1) {
      const pick = worldSearchRoot(board, color, forced.options, 600, 1.05, 6);
      if (pick !== null) return pick;
    }
    return forced.move;
  }

  // 2. 冲四连击抢胜
  const vcf = vcfSearch(board, color, 3);
  if (vcf !== null) return vcf;

  // 3. 搜索：深度 2→4→6，对手权重 1.05（略偏抢攻），预算 700ms
  const pick = worldSearchRoot(board, color, null, 700, 1.05, 6);
  return pick !== null ? pick : staticBest(board, color);
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

// 攻防权重：>1 更重视对手威胁（稳健），<1 更敢抢攻（凶狠）。地狱模式用 0.95，世界模式用 1.15
let EVAL_OPP_W = 1.15;

function evalBoardWorld(board, aiColor) {
  return shapeScoreWorld(board, aiColor) - shapeScoreWorld(board, 3 - aiColor) * EVAL_OPP_W;
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
  const moves = worldOrderedMoves(board, mover, ply <= 2 ? 16 : 10);
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

function worldRoot(board, aiColor, depth, deadline, roots) {
  const moves = (roots && roots.length) ? roots.slice() : worldOrderedMoves(board, aiColor, 16);
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

// 迭代加深外壳：roots 不为空时只在这些点里选（用于多个必挡点之间择优）
function worldSearchRoot(board, color, roots, budgetMs, oppWeight, maxDepth) {
  const prevW = EVAL_OPP_W;
  if (typeof oppWeight === 'number') EVAL_OPP_W = oppWeight;
  const deadline = Date.now() + (budgetMs || 1200);
  const maxD = maxDepth || 6;
  let best = null;
  try {
    for (const depth of [2, 4, 6]) {
      if (depth > maxD) break;
      try {
        best = worldRoot(board, color, depth, deadline, roots);
      } catch (e) { break; }  // 超时沿用上一层完整结果
    }
  } finally {
    EVAL_OPP_W = prevW;
  }
  return best;
}

function pickWorld(board, color) {
  const cands = candidates(board, 2);
  if (!cands.length) return idx(7, 7);
  if (cands.length === 1) return cands[0];

  // 1. 硬规则（顺序严格不可调换）：立即连五 → 挡对方连五 → 我方活四必胜 → 挡对方活四
  //    必须在 VCF / 搜索之前执行，否则会出现「对方已能连五，AI 还在冲四」的致命失误
  const forced = forcedMove(board, color);
  if (forced) {
    // 有多个「对方能成活四」的点时，不靠单一指标拍板，交给搜索在候选点里择优
    if (forced.kind === 'block-live-four' && forced.options.length > 1) {
      const pick = worldSearchRoot(board, color, forced.options, 900, 1.15, 6);
      if (pick !== null) return pick;
    }
    return forced.move;
  }

  // 2. VCF 连续冲四取胜（此时对方已无成五/成活四的硬威胁，冲四才是真先手）
  const vcf = vcfSearch(board, color, 3);
  if (vcf !== null) return vcf;

  // 3. 迭代加深 α-β：深度 2 → 4 → 6，时间预算 1.2 秒
  const best = worldSearchRoot(board, color, null, 1200, 1.15, 6);
  return best !== null ? best : staticBest(board, color);
}
