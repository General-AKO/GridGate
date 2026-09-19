export const MODES = Object.freeze({ CLASSIC: 'classic', RACE: 'race', CENTER: 'center', SURVIVAL: 'survival' });
export const PLAYER_COLORS = Object.freeze({ P1: 'blue', P2: 'red', P3: 'green', P4: 'orange', S: 'snake' });
export const SNAKE_ID = 'S';
export const SNAKE_MODES = Object.freeze({ AI: 'ai', PLAYER: 'player' });
// Survival mode tuning. The AI snake fires its freeze ability after a random 7-12 snake turns,
// a player-controlled snake gets it every 6 turns. A frozen survivor loses 2 of his own turns.
export const SURVIVAL_RULES = Object.freeze({ freezeTurns: 2, aiIntervalMin: 7, aiIntervalMax: 12, playerInterval: 6, wallsPerSurvivor: 8 });

export function getGameConfig(playerCount = 2, mode = MODES.CLASSIC, snakeMode = SNAKE_MODES.AI) {
  const count = Math.min(4, Math.max(2, Number(playerCount) || 2));
  const safeMode = Object.values(MODES).includes(mode) ? mode : MODES.CLASSIC;
  if (safeMode === MODES.SURVIVAL) {
    const safeSnake = Object.values(SNAKE_MODES).includes(snakeMode) ? snakeMode : SNAKE_MODES.AI;
    // Odd sizes so the snake starts on an exact centre cell. playerCount = number of survivors (the snake is an extra seat).
    return { playerCount: count, mode: safeMode, boardSize: count === 2 ? 7 : count === 3 ? 9 : 11, wallsPerPlayer: SURVIVAL_RULES.wallsPerSurvivor, snakeMode: safeSnake };
  }
  if (safeMode === MODES.CENTER) {
    return { playerCount: count, mode: safeMode, boardSize: count === 2 ? 9 : count === 3 ? 11 : 13, wallsPerPlayer: 8 };
  }
  return { playerCount: count, mode: safeMode, boardSize: count === 2 ? 9 : count === 3 ? 12 : 14, wallsPerPlayer: 10 };
}

function evenlySpacedColumns(size, count) {
  if (count === 2) return [Math.floor(size * .28), Math.ceil(size * .72) - 1];
  if (count === 3) return [Math.floor(size * .18), Math.floor((size - 1) / 2), Math.ceil(size * .82) - 1];
  return [1, Math.floor(size * .36), Math.ceil(size * .64) - 1, size - 2];
}

export function rollSnakeInterval(snakeMode, rng = Math.random) {
  if (snakeMode === SNAKE_MODES.PLAYER) return SURVIVAL_RULES.playerInterval;
  const lo = SURVIVAL_RULES.aiIntervalMin, hi = SURVIVAL_RULES.aiIntervalMax;
  return lo + Math.min(hi - lo, Math.floor(rng() * (hi - lo + 1)));
}

function createPlayers(config, rng = Math.random) {
  const { boardSize: size, playerCount: count, mode, wallsPerPlayer: walls } = config;
  const midLow = Math.floor((size - 1) / 2);
  const midHigh = Math.ceil((size - 1) / 2);
  if (mode === MODES.SURVIVAL) {
    const starts = [
      { row: size - 1, col: midLow, home: 'bottom' }, { row: 0, col: midLow, home: 'top' },
      { row: midLow, col: 0, home: 'left' }, { row: midLow, col: size - 1, home: 'right' },
    ];
    const survivors = starts.slice(0, count).map((pos, i) => ({ id: `P${i + 1}`, ...pos, goal: 'survive', walls, color: PLAYER_COLORS[`P${i + 1}`], alive: true, frozen: 0 }));
    const centre = Math.floor(size / 2);
    const snake = { id: SNAKE_ID, row: centre, col: centre, goal: 'hunt', role: 'snake', walls: 0, color: PLAYER_COLORS.S, alive: true, frozen: 0, facing: 'right', targetId: null, ability: { charge: 0, need: rollSnakeInterval(config.snakeMode, rng) } };
    return [...survivors, snake];
  }
  if (mode === MODES.RACE) {
    return evenlySpacedColumns(size, count).map((col, i) => ({ id: `P${i + 1}`, row: size - 1, col, goal: 'top', walls, color: PLAYER_COLORS[`P${i + 1}`] }));
  }
  if (mode === MODES.CENTER) {
    const starts = [
      { row: size - 1, col: midLow, home: 'bottom' }, { row: 0, col: midLow, home: 'top' },
      { row: midLow, col: 0, home: 'left' }, { row: midLow, col: size - 1, home: 'right' },
    ];
    return starts.slice(0, count).map((pos, i) => ({ id: `P${i + 1}`, ...pos, goal: 'center', walls, color: PLAYER_COLORS[`P${i + 1}`] }));
  }
  const starts = [
    { row: size - 1, col: midLow, goal: 'top' },
    { row: 0, col: midHigh, goal: 'bottom' },
    { row: midLow, col: 0, goal: 'right' },
    { row: midHigh, col: size - 1, goal: 'left' },
  ];
  return starts.slice(0, count).map((p, i) => ({ id: `P${i + 1}`, ...p, walls, color: PLAYER_COLORS[`P${i + 1}`] }));
}

export function createInitialState(options = {}) {
  const config = getGameConfig(options.playerCount, options.mode, options.snakeMode);
  const state = {
    version: 2,
    mode: config.mode,
    playerCount: config.playerCount,
    boardSize: config.boardSize,
    wallsPerPlayer: config.wallsPerPlayer,
    players: createPlayers(config, options.rng || Math.random),
    turn: 0,
    walls: [],
    winner: null,
    moveNumber: 1,
  };
  if (config.mode === MODES.SURVIVAL) { state.snakeMode = config.snakeMode; state.lastEvent = null; }
  return state;
}

// ---- Survival helpers -----------------------------------------------------------------------
export const isSnake = (p) => p?.role === 'snake';
export const isAlive = (p) => p?.alive !== false;
export function getSnake(state) { return state.players.find(isSnake) || null; }
export function getSurvivors(state, aliveOnly = true) { return state.players.filter((p) => !isSnake(p) && (!aliveOnly || isAlive(p))); }

/** Seat ids that are controlled by the server-side AI for a freshly created room. */
export function getAiSeatIds(state, requestedAiCount = 0) {
  if (state.mode === MODES.SURVIVAL) return state.snakeMode === SNAKE_MODES.AI ? [SNAKE_ID] : [];
  const max = state.playerCount === 3 ? 1 : state.playerCount === 4 ? 2 : 0;
  const count = Math.max(0, Math.min(max, Math.floor(Number(requestedAiCount) || 0)));
  return count ? state.players.map((p) => p.id).slice(-count) : [];
}

/** True once the snake has waited long enough to use its freeze ability on this turn. */
export function isAbilityReady(state) {
  const snake = getSnake(state);
  return Boolean(snake && !state.winner && snake.ability && snake.ability.charge + 1 >= snake.ability.need);
}
export function getAbilityTargets(state) { return getSurvivors(state).filter((p) => !(p.frozen > 0)); }
export function canUseAbility(state) { return isAbilityReady(state) && getAbilityTargets(state).length > 0; }
/** Snake turns left until the ability is ready (0 when ready). */
export function abilityTurnsLeft(state) {
  const snake = getSnake(state);
  return snake?.ability ? Math.max(0, snake.ability.need - snake.ability.charge - 1) : 0;
}

/** Alive survivors standing orthogonally next to the snake with no wall between them. */
export function getSnakeAttackTargets(state) {
  const snake = getSnake(state);
  if (!snake || state.winner) return [];
  return getSurvivors(state)
    .filter((p) => Math.abs(p.row - snake.row) + Math.abs(p.col - snake.col) === 1 && !isEdgeBlocked(snake, p, state.walls))
    .map((p) => p.id);
}

function directionName(r0, c0, r1, c1) {
  const dr = r1 - r0, dc = c1 - c0;
  if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? 'right' : 'left';
  return dr >= 0 ? 'down' : 'up';
}

/** Ends the current turn: moves on to the next living player and burns the turns of frozen ones. */
function endTurn(next) {
  next.moveNumber += 1;
  const n = next.players.length;
  for (let guard = 0; guard < n * 4; guard++) {
    next.turn = (next.turn + 1) % n;
    const q = next.players[next.turn];
    if (!isAlive(q)) continue;
    if (q.frozen > 0) { q.frozen -= 1; next.moveNumber += 1; continue; }
    return;
  }
}
function commitTurn(next) { if (next.winner) next.moveNumber += 1; else endTurn(next); }

export function cloneState(state) { return structuredClone(state); }
export function inBounds(row, col, size) { return row >= 0 && row < size && col >= 0 && col < size; }
const cellKey = (row, col) => `${row},${col}`;
const sameCell = (a, b) => a.row === b.row && a.col === b.col;

export function isEdgeBlocked(a, b, walls) {
  const dr = b.row - a.row, dc = b.col - a.col;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return true;
  for (const wall of walls) {
    if (wall.orientation === 'H') {
      const cross = (a.row === wall.row && b.row === wall.row + 1) || (b.row === wall.row && a.row === wall.row + 1);
      if (cross && a.col === b.col && (a.col === wall.col || a.col === wall.col + 1)) return true;
    } else if (wall.orientation === 'V') {
      const cross = (a.col === wall.col && b.col === wall.col + 1) || (b.col === wall.col && a.col === wall.col + 1);
      if (cross && a.row === b.row && (a.row === wall.row || a.row === wall.row + 1)) return true;
    }
  }
  return false;
}

export function getBoardNeighbors(state, row, col) {
  const out = [], from = { row, col };
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const to = { row: row + dr, col: col + dc };
    if (inBounds(to.row, to.col, state.boardSize) && !isEdgeBlocked(from, to, state.walls)) out.push(to);
  }
  return out;
}

export function reachedGoal(state, player, row = player.row, col = player.col) {
  if (player.goal === 'center') {
    const center = Math.floor(state.boardSize / 2);
    return row === center && col === center;
  }
  if (player.goal === 'top') return row === 0;
  if (player.goal === 'bottom') return row === state.boardSize - 1;
  if (player.goal === 'left') return col === 0;
  if (player.goal === 'right') return col === state.boardSize - 1;
  return false;
}

export function hasPathToGoal(state, playerId) { return Number.isFinite(shortestPathLength(state, playerId)); }

// Survival: a survivor "reaches" the snake and the snake "reaches" its nearest living survivor (walls only, pawns ignored).
function survivalDistance(state, player) {
  const snake = getSnake(state);
  if (!snake || !isAlive(player)) return 0;
  const targets = new Set((isSnake(player) ? getSurvivors(state) : [snake]).map((p) => cellKey(p.row, p.col)));
  if (!targets.size) return 0;
  const queue = [{ row: player.row, col: player.col, d: 0 }], visited = new Set([cellKey(player.row, player.col)]);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (targets.has(cellKey(cur.row, cur.col))) return cur.d;
    for (const n of getBoardNeighbors(state, cur.row, cur.col)) {
      const k = cellKey(n.row, n.col);
      if (!visited.has(k)) { visited.add(k); queue.push({ ...n, d: cur.d + 1 }); }
    }
  }
  return Infinity;
}

export function shortestPathLength(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return Infinity;
  if (state.mode === MODES.SURVIVAL) return survivalDistance(state, player);
  const queue = [{ row: player.row, col: player.col, d: 0 }], visited = new Set([cellKey(player.row, player.col)]);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (reachedGoal(state, player, cur.row, cur.col)) return cur.d;
    for (const n of getBoardNeighbors(state, cur.row, cur.col)) {
      const k = cellKey(n.row, n.col);
      if (!visited.has(k)) { visited.add(k); queue.push({ ...n, d: cur.d + 1 }); }
    }
  }
  return Infinity;
}

export function getLegalPawnMoves(state, playerId) {
  if (state.winner) return [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];
  const occupied = new Map(state.players.filter(p => p.id !== playerId && isAlive(p)).map(p => [cellKey(p.row,p.col), p]));
  const result = [], seen = new Set();
  const add = (r,c) => { const k=cellKey(r,c); if (!seen.has(k) && !occupied.has(k)) { seen.add(k); result.push({row:r,col:c}); } };

  for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const adj = { row: player.row + dr, col: player.col + dc };
    if (!inBounds(adj.row, adj.col, state.boardSize) || isEdgeBlocked(player, adj, state.walls)) continue;
    const blockingPawn = occupied.get(cellKey(adj.row, adj.col));
    if (!blockingPawn) { add(adj.row, adj.col); continue; }
    if (isSnake(player)) continue; // the snake never jumps: it attacks instead

    const behind = { row: adj.row + dr, col: adj.col + dc };
    const straightFree = inBounds(behind.row, behind.col, state.boardSize) && !isEdgeBlocked(adj, behind, state.walls) && !occupied.has(cellKey(behind.row, behind.col));
    if (straightFree) { add(behind.row, behind.col); continue; }

    const perps = dr ? [[0,-1],[0,1]] : [[-1,0],[1,0]];
    for (const [pr,pc] of perps) {
      const diag = { row: adj.row + pr, col: adj.col + pc };
      if (inBounds(diag.row, diag.col, state.boardSize) && !isEdgeBlocked(adj, diag, state.walls)) add(diag.row, diag.col);
    }
  }
  return result;
}

export function validateWallPlacement(state, wall) {
  const slots = state.boardSize - 1;
  if (!wall || !Number.isInteger(wall.row) || !Number.isInteger(wall.col)) return { ok:false, error:'Invalid wall position.' };
  if (!['H','V'].includes(wall.orientation)) return { ok:false, error:'Invalid wall orientation.' };
  if (wall.row < 0 || wall.row >= slots || wall.col < 0 || wall.col >= slots) return { ok:false, error:'Wall is outside the board.' };
  for (const e of state.walls) {
    if (e.orientation === wall.orientation) {
      if (wall.orientation === 'H' && e.row === wall.row && Math.abs(e.col-wall.col)<=1) return {ok:false,error:'This wall overlaps another wall.'};
      if (wall.orientation === 'V' && e.col === wall.col && Math.abs(e.row-wall.row)<=1) return {ok:false,error:'This wall overlaps another wall.'};
    } else if (e.row === wall.row && e.col === wall.col) return {ok:false,error:'Walls cannot cross.'};
  }
  const test = cloneState(state); test.walls.push({row:wall.row,col:wall.col,orientation:wall.orientation});
  for (const p of test.players) {
    if (!isAlive(p)) continue;
    if (!hasPathToGoal(test, p.id)) return { ok: false, error: state.mode === MODES.SURVIVAL ? 'A wall must leave the snake a path to every survivor.' : 'A wall must leave a path to the goal for every player.' };
  }
  return {ok:true};
}

export function skipCurrentTurn(state) {
  if (!state || state.winner) return state;
  const next = cloneState(state);
  const cur = next.players[next.turn];
  if (isSnake(cur) && cur.ability) cur.ability.charge += 1; // a skipped snake turn still counts as a round
  endTurn(next);
  return next;
}

function applySnakeAction(state, next, snake, action, options) {
  const rng = options.rng || Math.random;
  if (action.type === 'move') {
    const row = Number(action.row), col = Number(action.col);
    if (!getLegalPawnMoves(state, snake.id).some(m => m.row === row && m.col === col)) return { ok: false, error: 'Illegal snake move.' };
    snake.facing = directionName(snake.row, snake.col, row, col);
    snake.row = row; snake.col = col;
    if (typeof action.intent === 'string' && getSurvivors(state).some(p => p.id === action.intent)) snake.targetId = action.intent;
    snake.ability.charge += 1;
    commitTurn(next);
    return { ok: true, state: next };
  }
  if (action.type === 'attack') {
    const id = String(action.target || '');
    if (!getSnakeAttackTargets(state).includes(id)) return { ok: false, error: 'No prey within reach.' };
    const prey = next.players.find(p => p.id === id);
    prey.alive = false; prey.frozen = 0;
    snake.facing = directionName(snake.row, snake.col, prey.row, prey.col);
    snake.targetId = null;
    snake.ability.charge += 1;
    next.lastEvent = { n: state.moveNumber, type: 'kill', target: id, by: snake.id, row: prey.row, col: prey.col };
    const alive = getSurvivors(next);
    if (alive.length <= 1) next.winner = alive[0]?.id || snake.id;
    commitTurn(next);
    return { ok: true, state: next };
  }
  if (action.type === 'ability') {
    if (!isAbilityReady(state)) return { ok: false, error: 'The freeze ability is not ready yet.' };
    const candidates = getAbilityTargets(state);
    if (!candidates.length) return { ok: false, error: 'No survivor can be frozen right now.' };
    // The victim is always random and always picked here (server side), never by the client.
    const chosen = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
    const victim = next.players.find(p => p.id === chosen.id);
    victim.frozen = SURVIVAL_RULES.freezeTurns;
    snake.facing = directionName(snake.row, snake.col, victim.row, victim.col);
    snake.ability.charge = 0;
    snake.ability.need = rollSnakeInterval(state.snakeMode, rng);
    next.lastEvent = { n: state.moveNumber, type: 'freeze', target: victim.id, by: snake.id, turns: SURVIVAL_RULES.freezeTurns };
    commitTurn(next); // like placing a wall: using the ability ends the snake's turn
    return { ok: true, state: next };
  }
  if (action.type === 'wall') return { ok: false, error: 'The snake cannot build walls.' };
  return { ok: false, error: 'Unknown action.' };
}

export function applyAction(state, playerId, action, options = {}) {
  if (!state || !action || typeof action.type !== 'string') return {ok:false,error:'Malformed action.'};
  if (state.winner) return {ok:false,error:'The game is already finished.'};
  const current = state.players[state.turn];
  if (!current || current.id !== playerId) return {ok:false,error:'It is not your turn.'};
  const next = cloneState(state), p = next.players[next.turn];
  if (isSnake(p)) return applySnakeAction(state, next, p, action, options);

  if (action.type === 'move') {
    const row=Number(action.row), col=Number(action.col);
    if (!getLegalPawnMoves(state,playerId).some(m=>m.row===row&&m.col===col)) return {ok:false,error:'Illegal pawn move.'};
    p.row=row; p.col=col;
    if (reachedGoal(next,p)) next.winner=playerId;
    commitTurn(next);
    return {ok:true,state:next};
  }
  if (action.type === 'wall') {
    if (p.walls<=0) return {ok:false,error:'You have no walls left.'};
    const wall={row:Number(action.row),col:Number(action.col),orientation:action.orientation,owner:playerId};
    const valid=validateWallPlacement(state,wall); if(!valid.ok) return valid;
    next.walls.push(wall); p.walls-=1;
    commitTurn(next);
    return {ok:true,state:next};
  }
  return {ok:false,error:'Unknown action.'};
}
