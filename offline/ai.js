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
  return pickBest(board, color, level);
}
