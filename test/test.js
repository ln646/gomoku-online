// 自动化测试：模拟两名玩家联机对战 + 悔棋协商 + PVE
const WebSocket = require('ws');

const BLACK = 1, WHITE = 2;
const URL = 'ws://localhost:3000';
let failures = 0;

function assert(cond, name) {
  console.log((cond ? '✅' : '❌') + ' ' + name);
  if (!cond) failures++;
}

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], waiters: [] };
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    c.msgs.push(msg);
    c.waiters = c.waiters.filter(w => {
      if (w.pred(msg)) { w.resolve(msg); return false; }
      return true;
    });
  });
  ws.on('open', () => c.opened = true);
  c.send = o => ws.send(JSON.stringify(o));
  c.waitFor = (pred, timeout = 5000) => new Promise((resolve, reject) => {
    const found = c.msgs.find(pred);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(`${name} 等待超时`)), timeout);
    c.waiters.push({ pred, resolve: m => { clearTimeout(timer); resolve(m); } });
  });
  return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // ===== 场景1：创建房间 + 房间号加入 =====
  const alice = client('Alice');
  await new Promise(r => alice.ws.on('open', r));
  alice.send({ type: 'create', name: 'Alice' });
  const joined = await alice.waitFor(m => m.type === 'roomJoined');
  const code = joined.roomCode;
  assert(/^\d{4}$/.test(code), `创建房间成功，房间号=${code}`);

  const bob = client('Bob');
  await new Promise(r => bob.ws.on('open', r));
  bob.send({ type: 'join', code, name: 'Bob' });
  const bj = await bob.waitFor(m => m.type === 'roomJoined');
  const aj = await alice.waitFor(m => m.type === 'gameStart');
  assert(bj.color === WHITE, 'Bob 自动分配白棋');
  assert(aj.state.status === 'playing' && aj.state.turn === BLACK, '对局开始，黑先');
  assert(aj.state.blackName === 'Alice' && aj.state.whiteName === 'Bob', '玩家昵称同步正确');

  // ===== 场景2：走子与实时同步 =====
  // Alice(黑) 走 112，Bob(白) 应走 113
  alice.send({ type: 'move', index: 112 });
  const mvA = await bob.waitFor(m => m.type === 'move' && m.index === 112);
  assert(mvA.color === BLACK && mvA.turn === WHITE, '黑方落子后轮次切到白方，白方实时收到');
  // 非法落子（轮次错误）：现在轮到白方，黑方连续走两步应被拒
  alice.send({ type: 'move', index: 114 });
  await sleep(300);
  const err = alice.msgs.find(m => m.type === 'error' && /还没轮到你/.test(m.msg));
  assert(err, '轮次错误被服务器拒绝');
  bob.send({ type: 'move', index: 113 });
  const mvB = await alice.waitFor(m => m.type === 'move' && m.index === 113);
  assert(mvB.turn === BLACK, '白方落子后轮次切回黑方');

  // ===== 场景3：悔棋协商（拒绝 + 同意） =====
  alice.send({ type: 'undoRequest' });
  await bob.waitFor(m => m.type === 'undoRequest' && m.by === BLACK);
  assert(true, '白方收到悔棋请求');
  bob.send({ type: 'undoResponse', accept: false });
  const rej = await alice.waitFor(m => m.type === 'undoResult' && m.accepted === false);
  assert(rej.state.history.length === 2, '拒绝悔棋后棋局不变（仍2子）');

  alice.send({ type: 'undoRequest' });
  await bob.waitFor(m => m.type === 'undoRequest');
  bob.send({ type: 'undoResponse', accept: true });
  const acc = await alice.waitFor(m => m.type === 'undoResult' && m.accepted === true);
  assert(acc.state.history.length === 0 && acc.state.turn === BLACK, '同意悔棋后回到开局，轮到黑方');

  // ===== 场景4：五子连线获胜判定 =====
  const blackMoves = [112, 97, 82, 67, 52];
  const whiteMoves = [0, 1, 2, 3];
  alice.msgs.length = 0; bob.msgs.length = 0; // 清空历史消息，避免旧消息干扰断言
  for (let i = 0; i < 5; i++) {
    alice.send({ type: 'move', index: blackMoves[i] });
    if (i < 4) {
      await alice.waitFor(m => m.type === 'move' && m.index === blackMoves[i], 5000);
      bob.send({ type: 'move', index: whiteMoves[i] });
      await bob.waitFor(m => m.type === 'move' && m.index === whiteMoves[i], 5000);
    }
  }
  const win = await alice.waitFor(m => m.type === 'gameOver', 5000);
  const win2 = await bob.waitFor(m => m.type === 'gameOver', 5000);
  assert(win.winner === BLACK && win.reason === 'five', '黑方五子连线获胜');
  assert(win.winLine && win.winLine.length === 5, `返回获胜连线坐标(${win.winLine.length}点)`);
  assert(win.state.board[112] === BLACK && win.state.board[52] === BLACK, '获胜后完整棋盘状态同步');

  // ===== 场景5：重赛（双方同意交换黑白） =====
  alice.send({ type: 'rematch' });
  await bob.waitFor(m => m.type === 'rematchWait');
  bob.send({ type: 'rematch' });
  const gs = await bob.waitFor(m => m.type === 'gameStart');
  assert(gs.state.history.length === 0 && gs.state.status === 'playing', '双方同意后重赛，棋盘清空');

  // ===== 场景6：认输 =====
  bob.send({ type: 'resign' }); // Bob 现在是白？重赛交换过颜色
  const resignOver = await alice.waitFor(m => m.type === 'gameOver' && m.reason === 'resign');
  assert(resignOver.winner !== 0, `认输生效，获胜方=${resignOver.winner === 1 ? '黑' : '白'}`);

  alice.ws.close(); bob.ws.close();

  // ===== 场景7：快速匹配 =====
  const p1 = client('P1');
  await new Promise(r => p1.ws.on('open', r));
  p1.send({ type: 'quickMatch', name: 'P1' });
  const p2 = client('P2');
  await new Promise(r => p2.ws.on('open', r));
  p2.send({ type: 'quickMatch', name: 'P2' });
  const m1 = await p1.waitFor(m => m.type === 'gameStart', 5000);
  const m2 = await p2.waitFor(m => m.type === 'gameStart', 5000);
  assert(m1.state.blackName === 'P1' && m1.state.whiteName === 'P2', '快速匹配成功配对两名玩家');
  p1.send({ type: 'move', index: 112 });
  const sync = await p2.waitFor(m => m.type === 'move' && m.index === 112);
  assert(sync.turn === WHITE, '匹配对局走子同步正常');
  p1.ws.close(); p2.ws.close();

  // ===== 场景8：PVE（困难 AI 防守能力 + 悔棋） =====
  const ai = client('Human');
  await new Promise(r => ai.ws.on('open', r));
  ai.send({ type: 'pve', level: 'hard', name: 'Human' });
  const pveJoin = await ai.waitFor(m => m.type === 'roomJoined' && m.vsAi === true);
  assert(pveJoin.color === BLACK, '人机模式玩家执黑先行');

  // 自适应进攻：玩家在 x=7 纵列连续落子，困难 AI 应始终封堵，玩家永远连不成五
  const board = new Array(225).fill(0);
  const apply = (index, color) => { board[index] = color; };
  for (const m of pveJoin.state.history) apply(m.index, m.color);
  let humanMoves = 0, humanWon = false;
  for (let round = 0; round < 12 && humanMoves < 12; round++) {
    // 选列 x=7 上与己方棋子相邻的空点（优先延续连子）
    let best = -1, bestLen = -1;
    for (let y = 2; y <= 12; y++) {
      const i = 7 + y * 15;
      if (board[i] !== 0) continue;
      let len = 0;
      for (let d = -1; d <= 1; d++) { if (board[7 + (y + d) * 15] === BLACK) len++; }
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best < 0) break;
    ai.send({ type: 'move', index: best });
    const resp = await ai.waitFor(m =>
      (m.type === 'move' && (apply(m.index, m.color), true)) ||
      (m.type === 'gameOver' && (m.state.history.forEach(h => apply(h.index, h.color)), true)), 6000);
    if (resp.type === 'gameOver') {
      if (resp.winner === BLACK && resp.reason === 'five') humanWon = true;
      break;
    }
    humanMoves++;
  }
  assert(!humanWon, `困难 AI 防守有效：玩家连攻 ${humanMoves} 手也连不成五子`);
  ai.send({ type: 'undoRequest' });
  const undoAi = await ai.waitFor(m => m.type === 'undoApplied' || m.type === 'gameOver', 5000);
  if (undoAi.type === 'undoApplied') {
    assert(undoAi.undoCount === 1 && undoAi.state.turn === BLACK, '人机模式悔棋直接生效，回到玩家回合');
  } else {
    assert(true, '人机模式悔棋：对局已结束（跳过）');
  }
  ai.ws.close();

  // ===== 场景9：断线重连 =====
  const r1 = client('R1');
  await new Promise(r => r1.ws.on('open', r));
  r1.send({ type: 'create', name: 'R1' });
  const r1j = await r1.waitFor(m => m.type === 'roomJoined');
  const r1pid = r1j.playerId, r1code = r1j.roomCode;
  const r2 = client('R2');
  await new Promise(r => r2.ws.on('open', r));
  r2.send({ type: 'join', code: r1code, name: 'R2' });
  await r1.waitFor(m => m.type === 'gameStart');
  // R1 模拟断线
  r1.ws.close();
  await sleep(500);
  const r1b = client('R1-reconnect');
  await new Promise(r => r1b.ws.on('open', r));
  r1b.send({ type: 'rejoin', playerId: r1pid, roomCode: r1code, name: 'R1' });
  const re = await r1b.waitFor(m => m.type === 'rejoined');
  assert(re.state.status === 'playing' && re.state.board instanceof Array && re.state.board.length === 225, '断线后重连成功并恢复完整棋局状态');
  r1b.send({ type: 'move', index: 112 });
  const r2mv = await r2.waitFor(m => m.type === 'move' && m.index === 112);
  assert(r2mv.turn === WHITE, '重连后走子继续同步');
  r2.ws.close(); r1b.ws.close();

  console.log('\n========== 测试完成 ==========');
  console.log(failures === 0 ? '🎉 全部通过' : `⚠ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
