// Survival mode AI: one module for the hunting snake and for AI-controlled survivors.
// Only the public engine API is used; the survivor search runs on a tiny internal model
// (grid + positions) instead of cloning full game states, so it stays cheap on the servers too.
import {
  canUseAbility,
  getLegalPawnMoves,
  getSnake,
  getSnakeAttackTargets,
  getSnakeDashMoves,
  getSurvivors,
  isAlive,
  isSnake,
  validateWallPlacement,
} from './game-engine.js';

// ---------------------------------------------------------------------------------------------
// Fast grid helpers (walls only, pawns are handled by the callers)
// ---------------------------------------------------------------------------------------------
function makeGrid(state) {
  const size = state.boardSize;
  const n = size * size;
  const blocked = new Set();
  const grid = { size, n, blocked };
  for (const w of state.walls) addWall(grid, w);
  return grid;
}

function addWall(grid, w) {
  const { size, n, blocked } = grid;
  const add = (r1, c1, r2, c2) => {
    const a = r1 * size + c1;
    const b = r2 * size + c2;
    blocked.add(a * n + b);
    blocked.add(b * n + a);
  };
  if (w.orientation === 'H') { add(w.row, w.col, w.row + 1, w.col); add(w.row, w.col + 1, w.row + 1, w.col + 1); }
  else { add(w.row, w.col, w.row, w.col + 1); add(w.row + 1, w.col, w.row + 1, w.col + 1); }
}

function gridWithWall(grid, wall) {
  const copy = { size: grid.size, n: grid.n, blocked: new Set(grid.blocked) };
  addWall(copy, wall);
  return copy;
}

function bfs(grid, start, parents = null) {
  const { size, n, blocked } = grid;
  const dist = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
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

/** Orthogonal neighbours of cell `a` that no wall separates from it. */
function openNeighbours(grid, a) {
  const { size, n, blocked } = grid;
  const r = (a / size) | 0;
  const c = a % size;
  const out = [];
  if (r > 0 && !blocked.has(a * n + a - size)) out.push(a - size);
  if (r < size - 1 && !blocked.has(a * n + a + size)) out.push(a + size);
  if (c > 0 && !blocked.has(a * n + a - 1)) out.push(a - 1);
  if (c < size - 1 && !blocked.has(a * n + a + 1)) out.push(a + 1);
  return out;
}

function areAdjacent(grid, a, b) {
  const { size } = grid;
  return Math.abs(((a / size) | 0) - ((b / size) | 0)) + Math.abs((a % size) - (b % size)) === 1 && !grid.blocked.has(a * grid.n + b);
}

/** Number of cells that `me` reaches strictly before `rival` (the rival's distances are divided by `rivalSpeed`). */
function territory(distMe, distRival, rivalSpeed = 1) {
  let count = 0;
  for (let i = 0; i < distMe.length; i++) {
    if (distMe[i] < 0) continue;
    if (distRival[i] < 0 || distMe[i] < Math.ceil(distRival[i] / rivalSpeed)) count++;
  }
  return count;
}

const cellIndex = (state, p) => p.row * state.boardSize + p.col;
const playerById = (state, id) => state.players.find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------
// Snake
// ---------------------------------------------------------------------------------------------
/**
 * The snake never runs blindly after one player. Each turn it re-evaluates every living survivor:
 * path distance to the survivor's *current* cell, a bonus for petrified (helpless) prey, a bonus for
 * prey with little room to escape, and a small loyalty bonus so it does not flip-flop between two
 * equally distant targets. Then it steps towards the chosen prey, preferring the step that also
 * shrinks the space that prey can still run to. While golden it looks at every two-step move too.
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

  const golden = snake.gold > 0;
  // Golden snakes prefer the double move; the freeze ability simply stays ready for a later turn.
  if (!golden && canUseAbility(state)) return { type: 'ability' };

  const singles = getLegalPawnMoves(state, snake.id).map((m) => ({ ...m, kind: 'move' }));
  const dashes = golden ? getSnakeDashMoves(state).map((m) => ({ row: m.row, col: m.col, kind: 'dash' })) : [];
  const options = [...singles, ...dashes];
  if (!options.length) return canUseAbility(state) ? { type: 'ability' } : null;

  const size = state.boardSize;
  const grid = makeGrid(state);
  const distFromSnake = bfs(grid, cellIndex(state, snake));
  const survivors = getSurvivors(state);

  let prey = null;
  let bestScore = Infinity;
  for (const p of survivors) {
    const d = distFromSnake[cellIndex(state, p)];
    if (d < 0) continue;
    let score = d;
    if (smart) {
      score -= Math.min(p.frozen || 0, 2) * 1.6;
      score += territory(bfs(grid, cellIndex(state, p)), distFromSnake, golden ? 2 : 1) * 0.12;
      if (snake.targetId === p.id) score -= 1.5;
    } else {
      score += Math.random() * 2.5;
    }
    if (score < bestScore) { bestScore = score; prey = p; }
  }

  if (!prey || (!smart && Math.random() < 0.15)) {
    const o = options[Math.floor(Math.random() * options.length)];
    return { type: o.kind, row: o.row, col: o.col, intent: prey?.id };
  }

  const distFromPrey = bfs(grid, cellIndex(state, prey));
  const facing = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[snake.facing] || [0, 0];
  let best = null;
  let bestValue = Infinity;
  for (const o of options) {
    const idx = o.row * size + o.col;
    const d = distFromPrey[idx];
    if (d < 0) continue;
    let value = d * 3;
    if (smart) value += territory(distFromPrey, bfs(grid, idx), 1) * 0.35;
    // Tiny bias to keep going straight instead of zig-zagging on ties.
    if (o.kind === 'move' && o.row - snake.row === facing[0] && o.col - snake.col === facing[1]) value -= 0.01;
    if (value < bestValue) { bestValue = value; best = o; }
  }
  best = best || options[0];
  return { type: best.kind, row: best.row, col: best.col, intent: prey.id };
}

// ---------------------------------------------------------------------------------------------
// Survivors: a small adversarial search. The snake is assumed to hunt *me* with its best move
// (worst case), other survivors stand still. Leaves are scored by distance, the space I can still
// reach first (dead ends and corners shrink it) and my mobility.
// ---------------------------------------------------------------------------------------------
const LOSS = 100000;
const WALL_COST = 28; // a wall costs a tempo and shrinks the board: only worth it when it clearly helps
const BACKTRACK_COST = 4;

/**
 * Size of the "2-core" of the area I reach first: cells that lie on a loop (or between loops) after repeatedly
 * pruning dead ends. A lone hunter can never catch a runner who owns a loop, while a tree-shaped area is a trap.
 */
function loopSpace(grid, inTerritory) {
  const { n } = grid;
  const degree = new Int8Array(n);
  const queue = [];
  const alive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!inTerritory[i]) continue;
    alive[i] = 1;
    let d = 0;
    for (const nb of openNeighbours(grid, i)) if (inTerritory[nb]) d++;
    degree[i] = d;
    if (d <= 1) queue.push(i);
  }
  let remaining = 0;
  for (let i = 0; i < n; i++) remaining += alive[i];
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    if (!alive[i]) continue;
    alive[i] = 0; remaining--;
    for (const nb of openNeighbours(grid, i)) {
      if (alive[nb] && --degree[nb] <= 1) queue.push(nb);
    }
  }
  return remaining;
}

function leafEval(model) {
  const { grid } = model;
  const fromMe = bfs(grid, model.me);
  const fromSnake = bfs(grid, model.snake);
  const speed = model.gold > 0 ? 2 : 1;
  const d = fromSnake[model.me];
  const effective = d < 0 ? 30 : Math.ceil(d / speed);
  const mine = new Uint8Array(grid.n);
  let room = 0;
  for (let i = 0; i < grid.n; i++) {
    if (fromMe[i] < 0 || model.occupied.has(i)) continue;
    if (fromSnake[i] < 0 || fromMe[i] < Math.ceil(fromSnake[i] / speed)) { mine[i] = 1; room++; }
  }
  const loops = loopSpace(grid, mine);
  let mobility = 0;
  for (const nb of openNeighbours(grid, model.me)) if (nb !== model.snake && !model.occupied.has(nb)) mobility++;
  let score = 12 * Math.min(effective, 10) + 0.9 * room + 2 * mobility + 2 * loops;
  if (room < 8) score -= (8 - room) * 12; // trapped in a pocket
  if (loops < 4) score -= (4 - loops) * 15; // no loop to run around: the snake will corner me sooner or later
  return score;
}

function snakeOptions(model) {
  const { grid } = model;
  const blockedCell = (c) => model.occupied.has(c) || c === model.me;
  const out = new Set();
  for (const a of openNeighbours(grid, model.snake)) {
    if (blockedCell(a)) continue;
    out.add(a);
    if (model.gold > 0) for (const b of openNeighbours(grid, a)) if (b !== model.snake && !blockedCell(b)) out.add(b);
  }
  return [...out];
}

function snakeTurn(model, depth, ctx, alpha, ply) {
  ctx.nodes++;
  if (areAdjacent(model.grid, model.snake, model.me)) return -LOSS + ply; // eaten: the later the better
  if (depth <= 0 || ctx.nodes > ctx.budget) return leafEval(model);
  const options = snakeOptions(model);
  if (!options.length) return leafEval(model);
  let best = Infinity;
  for (const dest of options) {
    const v = myTurn({ ...model, snake: dest, gold: Math.max(0, model.gold - 1) }, depth - 1, ctx, best, ply + 1);
    if (v < best) best = v;
    if (best <= alpha) break;
  }
  return best;
}

function myTurn(model, depth, ctx, beta, ply) {
  ctx.nodes++;
  if (depth <= 0 || ctx.nodes > ctx.budget) return leafEval(model);
  const moves = openNeighbours(model.grid, model.me).filter((c) => c !== model.snake && !model.occupied.has(c));
  if (!moves.length) return leafEval(model) - 40; // boxed in
  let best = -Infinity;
  for (const dest of moves) {
    const v = snakeTurn({ ...model, me: dest }, depth - 1, ctx, best, ply + 1);
    if (v > best) best = v;
    if (best >= beta) break;
  }
  return best;
}

const SEARCH = {
  beginner: { depth: 0, budget: 1, noise: 22, walls: 0 },
  skilled: { depth: 1, budget: 400, noise: 0, walls: 4 },
  veteran: { depth: 3, budget: 2500, noise: 0, walls: 6 },
  expert: { depth: 5, budget: 9000, noise: 0, walls: 8 },
};

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

/** Legal walls that cut across the snake's current shortest route to `me`; walls near either end of the route first. */
function survivalWallCandidates(state, me, limit) {
  const snake = getSnake(state);
  const grid = makeGrid(state);
  const size = state.boardSize;
  const parents = new Int32Array(grid.n).fill(-1);
  const from = snake.row * size + snake.col;
  bfs(grid, from, parents);
  const path = [];
  for (let cur = me.row * size + me.col; cur !== -1 && cur !== from; cur = parents[cur]) path.push({ row: (cur / size) | 0, col: cur % size });
  path.push({ row: snake.row, col: snake.col });
  path.reverse(); // snake -> me
  const seen = new Set();
  const found = [];
  for (let i = 0; i + 1 < path.length; i++) {
    for (const w of wallSlots(path[i], path[i + 1], size - 1)) {
      const key = `${w.orientation}${w.row},${w.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ w, i });
    }
  }
  found.sort((x, y) => Math.min(x.i, path.length - 2 - x.i) - Math.min(y.i, path.length - 2 - y.i));
  const out = [];
  for (const { w } of found) {
    if (out.length >= limit) break;
    if (validateWallPlacement(state, w).ok) out.push({ type: 'wall', ...w });
  }
  return out;
}

export function chooseSurvivorAction(state, playerId, difficulty = 'skilled') {
  const me = playerById(state, playerId);
  const snake = getSnake(state);
  if (!me || !isAlive(me) || !snake) return null;
  const cfg = SEARCH[difficulty] || SEARCH.skilled;
  const size = state.boardSize;
  const grid = makeGrid(state);
  const occupied = new Set(getSurvivors(state).filter((p) => p.id !== playerId).map((p) => cellIndex(state, p)));
  const base = { grid, me: cellIndex(state, me), snake: cellIndex(state, snake), gold: snake.gold || 0, occupied };
  const stiff = me.frozen === 1; // petrified second turn: walls or pass only

  const candidates = [];
  if (stiff) candidates.push({ action: { type: 'pass' }, model: base, cost: 0 });
  else {
    for (const m of getLegalPawnMoves(state, playerId)) {
      const idx = m.row * size + m.col;
      const back = me.prev && me.prev.row === m.row && me.prev.col === m.col;
      candidates.push({ action: { type: 'move', row: m.row, col: m.col }, model: { ...base, me: idx }, cost: back ? BACKTRACK_COST : 0 });
    }
  }
  if (me.walls > 0 && (stiff || cfg.walls > 0)) {
    for (const w of survivalWallCandidates(state, me, stiff ? 8 : cfg.walls)) {
      candidates.push({ action: w, model: { ...base, grid: gridWithWall(grid, w) }, cost: WALL_COST });
    }
  }
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const ctx = { nodes: 0, budget: cfg.budget };
    let score = snakeTurn(c.model, cfg.depth, ctx, -Infinity, 0) - c.cost;
    score += Math.random() * (cfg.noise || 0.15); // tiny jitter: equal options are not always resolved the same way
    if (score > bestScore) { bestScore = score; best = c.action; }
  }
  return best;
}

export function chooseSurvivalAction(state, playerId, difficulty = 'skilled') {
  const player = playerById(state, playerId);
  if (!player || !isAlive(player)) return null;
  return isSnake(player) ? chooseSnakeAction(state, difficulty) : chooseSurvivorAction(state, playerId, difficulty);
}
