export const MODES = Object.freeze({ CLASSIC: 'classic', RACE: 'race', CENTER: 'center' });
export const PLAYER_COLORS = Object.freeze({ P1: 'blue', P2: 'red', P3: 'green', P4: 'orange' });

export function getGameConfig(playerCount = 2, mode = MODES.CLASSIC) {
  const count = Math.min(4, Math.max(2, Number(playerCount) || 2));
  const safeMode = Object.values(MODES).includes(mode) ? mode : MODES.CLASSIC;
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

function createPlayers(config) {
  const { boardSize: size, playerCount: count, mode, wallsPerPlayer: walls } = config;
  const midLow = Math.floor((size - 1) / 2);
  const midHigh = Math.ceil((size - 1) / 2);
  if (mode === MODES.RACE) {
    return evenlySpacedColumns(size, count).map((col, i) => ({ id: `P${i + 1}`, row: size - 1, col, goal: 'top', walls, color: PLAYER_COLORS[`P${i + 1}`] }));
  }
  if (mode === MODES.CENTER) {
    const starts = [
      { row: size - 1, col: midLow }, { row: 0, col: midLow },
      { row: midLow, col: 0 }, { row: midLow, col: size - 1 },
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
  const config = getGameConfig(options.playerCount, options.mode);
  return {
    version: 2,
    mode: config.mode,
    playerCount: config.playerCount,
    boardSize: config.boardSize,
    wallsPerPlayer: config.wallsPerPlayer,
    players: createPlayers(config),
    turn: 0,
    walls: [],
    winner: null,
    moveNumber: 1,
  };
}

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

export function shortestPathLength(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return Infinity;
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
  const occupied = new Map(state.players.filter(p => p.id !== playerId).map(p => [cellKey(p.row,p.col), p]));
  const result = [], seen = new Set();
  const add = (r,c) => { const k=cellKey(r,c); if (!seen.has(k) && !occupied.has(k)) { seen.add(k); result.push({row:r,col:c}); } };

  for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const adj = { row: player.row + dr, col: player.col + dc };
    if (!inBounds(adj.row, adj.col, state.boardSize) || isEdgeBlocked(player, adj, state.walls)) continue;
    const blockingPawn = occupied.get(cellKey(adj.row, adj.col));
    if (!blockingPawn) { add(adj.row, adj.col); continue; }

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
  for (const p of test.players) if (!hasPathToGoal(test,p.id)) return {ok:false,error:'A wall must leave a path to the goal for every player.'};
  return {ok:true};
}

export function skipCurrentTurn(state) {
  if (!state || state.winner) return state;
  const next = cloneState(state); next.turn = (next.turn + 1) % next.players.length; next.moveNumber += 1; return next;
}

export function applyAction(state, playerId, action) {
  if (!state || !action || typeof action.type !== 'string') return {ok:false,error:'Malformed action.'};
  if (state.winner) return {ok:false,error:'The game is already finished.'};
  const current = state.players[state.turn];
  if (!current || current.id !== playerId) return {ok:false,error:'It is not your turn.'};
  const next = cloneState(state), p = next.players[next.turn];

  if (action.type === 'move') {
    const row=Number(action.row), col=Number(action.col);
    if (!getLegalPawnMoves(state,playerId).some(m=>m.row===row&&m.col===col)) return {ok:false,error:'Illegal pawn move.'};
    p.row=row; p.col=col;
    if (reachedGoal(next,p)) next.winner=playerId; else next.turn=(next.turn+1)%next.players.length;
    next.moveNumber += 1; return {ok:true,state:next};
  }
  if (action.type === 'wall') {
    if (p.walls<=0) return {ok:false,error:'You have no walls left.'};
    const wall={row:Number(action.row),col:Number(action.col),orientation:action.orientation,owner:playerId};
    const valid=validateWallPlacement(state,wall); if(!valid.ok) return valid;
    next.walls.push(wall); p.walls-=1; next.turn=(next.turn+1)%next.players.length; next.moveNumber+=1; return {ok:true,state:next};
  }
  return {ok:false,error:'Unknown action.'};
}
