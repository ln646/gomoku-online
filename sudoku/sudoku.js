/* ============ 数独生成与求解引擎 ============ */
/* 棋盘用长度 81 的数组表示，0 表示空格 */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 回溯填满棋盘（随机顺序 => 随机完整解）
function fillBoard(board) {
  const idx = board.indexOf(0);
  if (idx === -1) return true;
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const d of digits) {
    if (isValid(board, idx, d)) {
      board[idx] = d;
      if (fillBoard(board)) return true;
      board[idx] = 0;
    }
  }
  return false;
}

// 在 board 上于 idx 处放 d 是否合法（行列宫无重复）
function isValid(board, idx, d) {
  const r = Math.floor(idx / 9), c = idx % 9;
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let i = 0; i < 9; i++) {
    if (board[r * 9 + i] === d) return false;           // 行
    if (board[i * 9 + c] === d) return false;           // 列
  }
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      if (board[(br + dr) * 9 + bc + dc] === d) return false; // 宫
  return true;
}

// 统计解的数量，达到 limit 即停止
function countSolutions(board, limit = 2) {
  const idx = board.indexOf(0);
  if (idx === -1) return 1;
  let count = 0;
  for (let d = 1; d <= 9 && count < limit; d++) {
    if (isValid(board, idx, d)) {
      board[idx] = d;
      count += countSolutions(board, limit);
      board[idx] = 0;
    }
  }
  return count;
}

// 生成一局唯一解数独：返回 { puzzle, solution, clues }
function generateSudoku(difficulty) {
  const targets = { easy: 40, medium: 32, hard: 26 };
  const solution = new Array(81).fill(0);
  fillBoard(solution);

  const puzzle = solution.slice();
  let clues = 81;
  const target = targets[difficulty] || 32;
  const positions = shuffle([...Array(81).keys()]);

  for (const pos of positions) {
    if (clues <= target) break;
    const backup = puzzle[pos];
    if (backup === 0) continue;
    puzzle[pos] = 0;
    // 唯一性检查：挖掉后仍只有 1 个解才保留挖除
    const probe = puzzle.slice();
    if (countSolutions(probe, 2) === 1) {
      clues--;
    } else {
      puzzle[pos] = backup;
    }
  }
  return { puzzle, solution, clues };
}
