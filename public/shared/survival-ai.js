// Survival mode AI: one module for the hunting snake and for AI-controlled survivors.
// Everything here is deterministic apart from the optional beginner noise, and it only uses the public engine API.
import {
  applyAction,
  canUseAbility,
  getLegalPawnMoves,
  getSnake,
  getSnakeAttackTargets,
  getSurvivors,
  isAlive,
  isSnake,
} from './game-engine.js';

// ---------------------------------------------------------------------------------------------
// Fast grid helpers (walls only, pawns are ignored)
// ---------------------------------------------------------------------------------------------
function makeGrid(state) {
  const size = state.boardSize;
  const n = size * size;
  const blocked = new Set();
  const add = (r1, c1, r2, c2) => {
    const a = r1 * size + c1;
    const b = r2 * size + c2;
    blocked.add(a * n + b);
    blocked.add(b * n + a);
  };
  for (const w of state.walls) {
    if (w.orientation === 'H') { add(w.row, w.col, w.row + 1, w.col); add(w.row, w.col + 1, w.row + 1, w.col + 1); }
    else { add(w.row, w.col, w.row, w.col + 1); add(w.row + 1, w.col, w.row + 1, w.col + 1); }
  }
  return { size, n, blocked };
}

function bfs(grid, row, col, parents = null) {
  const { size, n, blocked } = grid;
  const dist = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const start = row * size + col;
  dist[start] = 0;
  queue[tail++] = start;
  const visit = (a, b, d) => {
    if (dist[b] < 0 && !blocked.has(a * n + b)) { dist[b] = d; if (parents) parents[b] = a; queue[tail++] = b; }
  };
  while (head < tail) {
    const a = queue[head++];
    const r = (a / size) | 0;
    const c = a % size;
    const d = dist[a] + 1;
    if (r > 0) visit(a, a - size, d);
    if (r < size - 1) visit(a, a + size, d);
    if (c > 0) visit(a, a - 1, d);
    if (c < size - 1) visit(a, a + 1, d);
  }
  return dist;
}

/** Number of cells that `me` can reach strictly before `rival` can. */
function territory(distMe, distRival) {
  let count = 0;
  for (let i = 0; i < distMe.length; i++) {
    if (distMe[i] >= 0 && (distRival[i] < 0 || distMe[i] < distRival[i])) count++;
  }
  return count;
}

function cellIndex(state, p) { return p.row * state.boardSize + p.col; }
function playerById(state, id) { return state.players.find((p) => p.id === id); }

// ---------------------------------------------------------------------------------------------
// Snake
// ---------------------------------------------------------------------------------------------
/**
 * The snake never runs blindly after one player. Each turn it re-evaluates every living survivor:
 * path distance to the survivor's *current* cell, bonus for frozen (helpless) prey, bonus for prey
 * with little room to escape, and a small loyalty bonus so it does not flip-flop between two
 * equally distant targets. Then it steps towards the chosen prey, preferring the step that also
 * shrinks the space that prey can still run to.
 */
export function chooseSnakeAction(state, difficulty = 'veteran') {
  const snake = getSnake(state);
  if (!snake || state.winner) return null;
  const smart = difficulty !== 'beginner';

  const attackable = getSnakeAttackTargets(state).map((id) => playerById(state, id));
  if (attackable.length) {
    // Kill the survivor that could hurt the snake most (most walls left); ties by seat order.
    attackable.sort((a, b) => (b.walls - a.walls) || a.id.localeCompare(b.id));
    return { type: 'attack', target: attackable[0].id };
  }

  if (canUseAbility(state)) return { type: 'ability' };

  const moves = getLegalPawnMoves(state, snake.id);
  if (!moves.length) return null;

  const grid = makeGrid(state);
  const distFromSnake = bfs(grid, snake.row, snake.col);
  const survivors = getSurvivors(state);

  let prey = null;
  let bestScore = Infinity;
  for (const p of survivors) {
    const d = distFromSnake[cellIndex(state, p)];
    if (d < 0) continue;
    let score = d;
    if (smart) {
      score -= Math.min(p.frozen || 0, 2) * 1.6;
      score += territory(bfs(grid, p.row, p.col), distFromSnake) * 0.12;
      if (snake.targetId === p.id) score -= 1.5;
    } else {
      score += Math.random() * 2.5;
    }
    if (score < bestScore) { bestScore = score; prey = p; }
  }

  if (!prey || (!smart && Math.random() < 0.15)) {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { type: 'move', row: m.row, col: m.col, intent: prey?.id };
  }

  const distFromPrey = bfs(grid, prey.row, prey.col);
  const facing = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[snake.facing] || [0, 0];
  let best = null;
  let bestValue = Infinity;
  for (const m of moves) {
    const d = distFromPrey[m.row * state.boardSize + m.col];
    if (d < 0) continue;
    let value = d * 3;
    if (smart) value += territory(distFromPrey, bfs(grid, m.row, m.col)) * 0.35;
    // Tiny bias to keep going straight instead of zig-zagging on ties.
    if (m.row - snake.row === facing[0] && m.col - snake.col === facing[1]) value -= 0.01;
    if (value < bestValue) { bestValue = value; best = m; }
  }
  best = best || moves[0];
  return { type: 'move', row: best.row, col: best.col, intent: prey.id };
}

// ---------------------------------------------------------------------------------------------
// Survivors
// ---------------------------------------------------------------------------------------------
function evalSurvivor(state, meId) {
  const me = playerById(state, meId);
  const snake = getSnake(state);
  if (!me || !isAlive(me)) return -1e6;
  if (state.winner === meId) return 1e6;
  if (!snake) return 0;
  const grid = makeGrid(state);
  const fromSnake = bfs(grid, snake.row, snake.col);
  const fromMe = bfs(grid, me.row, me.col);
  const d = fromSnake[cellIndex(state, me)];
  const distance = d < 0 ? 12 : d;
  // Adjacent to the snake at the end of my turn is fatal (unless someone else is eaten first, which we do not count on).
  if (distance <= 1) return -50000 + distance;
  return 14 * Math.min(distance, 9) + 0.5 * territory(fromMe, fromSnake) + 0.2 * me.walls;
}

function lookaheadScore(after, meId) {
  const snake = getSnake(after);
  const snakeIndex = after.players.findIndex(isSnake);
  if (!snake || snakeIndex < 0 || after.winner) return evalSurvivor(after, meId);
  after.turn = snakeIndex; // pretend the snake answers right away (worst case for me)
  const reply = chooseSnakeAction(after, 'veteran');
  if (!reply || reply.type === 'ability') return evalSurvivor(after, meId);
  const result = applyAction(after, snake.id, reply, { rng: () => 0 });
  if (!result.ok) return evalSurvivor(after, meId);
  return evalSurvivor(result.state, meId);
}

function wallSlots(a, b, slots) {
  const out = [];
  if (a.row !== b.row) {
    const row = Math.min(a.row, b.row);
    for (const c of [a.col - 1, a.col]) if (row >= 0 && row < slots && c >= 0 && c < slots) out.push({ row, col: c, orientation: 'H' });
  } else if (a.col !== b.col) {
    const col = Math.min(a.col, b.col);
    for (const r of [a.row - 1, a.row]) if (r >= 0 && r < slots && col >= 0 && col < slots) out.push({ row: r, col, orientation: 'V' });
  }
  return out;
}

/** Walls that cut across the snake's current shortest route to `me`. */
function survivalWallCandidates(state, me, limit) {
  const snake = getSnake(state);
  const grid = makeGrid(state);
  const size = state.boardSize;
  const parents = new Int32Array(grid.n).fill(-1);
  bfs(grid, snake.row, snake.col, parents);
  const path = [];
  for (let cur = me.row * size + me.col; cur !== -1 && cur !== snake.row * size + snake.col; cur = parents[cur]) {
    path.push({ row: (cur / size) | 0, col: cur % size });
  }
  path.push({ row: snake.row, col: snake.col });
  path.reverse(); // snake -> me
  const seen = new Set();
  const out = [];
  for (let i = 0; i + 1 < path.length && out.length < limit * 3; i++) {
    for (const w of wallSlots(path[i], path[i + 1], size - 1)) {
      const key = `${w.orientation}${w.row},${w.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'wall', ...w });
    }
  }
  return out.slice(0, limit * 3);
}

export function chooseSurvivorAction(state, playerId, difficulty = 'skilled') {
  const me = playerById(state, playerId);
  if (!me || !isAlive(me) || !getSnake(state)) return null;
  const candidates = getLegalPawnMoves(state, playerId).map((m) => ({ type: 'move', row: m.row, col: m.col }));
  if (me.walls > 0 && difficulty !== 'beginner') {
    candidates.push(...survivalWallCandidates(state, me, difficulty === 'expert' ? 10 : 6));
  }
  if (!candidates.length) return null;

  const deep = difficulty === 'veteran' || difficulty === 'expert';
  const noise = difficulty === 'beginner' ? 16 : 0;
  let best = null;
  let bestScore = -Infinity;
  for (const action of candidates) {
    const result = applyAction(state, playerId, action);
    if (!result.ok) continue;
    let score = deep ? lookaheadScore(result.state, playerId) : evalSurvivor(result.state, playerId);
    if (action.type === 'wall') score -= 2.5; // walls are limited, so a wall must clearly beat a plain step
    score += Math.random() * noise;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return best; // null when every option is illegal (the caller then skips the turn)
}

export function chooseSurvivalAction(state, playerId, difficulty = 'skilled') {
  const player = playerById(state, playerId);
  if (!player || !isAlive(player)) return null;
  return isSnake(player) ? chooseSnakeAction(state, difficulty) : chooseSurvivorAction(state, playerId, difficulty);
}
