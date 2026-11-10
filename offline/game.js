// 五子棋核心规则：15×15 棋盘，黑先白后，五子（或以上）连线获胜，棋盘满为和棋
// （浏览器版，无模块依赖）
const SIZE = 15;

function newBoard() {
  return new Array(SIZE * SIZE).fill(0); // 0 空, 1 黑, 2 白
}

function idx(x, y) {
  return y * SIZE + x;
}

// 检查在 (x,y) 落子后 color 是否获胜，返回获胜连线的坐标数组（用于高亮），否则返回 null
function checkWin(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    const line = [[x, y]];
    let nx = x + dx, ny = y + dy;
    while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
      line.push([nx, ny]);
      nx += dx; ny += dy;
    }
    nx = x - dx; ny = y - dy;
    while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[idx(nx, ny)] === color) {
      line.unshift([nx, ny]);
      nx -= dx; ny -= dy;
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function isFull(board) {
  return board.every(v => v !== 0);
}

// 获取有效落子点（供 AI 使用）：距离已有棋子切比雪夫距离 <= radius 的空点
function candidates(board, radius = 2) {
  const set = new Set();
  let hasStone = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) continue;
    hasStone = true;
    const x = i % SIZE, y = Math.floor(i / SIZE);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
        const j = idx(nx, ny);
        if (board[j] === 0) set.add(j);
      }
    }
  }
  if (!hasStone) return [idx(7, 7)];
  return [...set];
}
