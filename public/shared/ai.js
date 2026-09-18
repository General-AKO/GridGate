import {
  applyAction,
  getBoardNeighbors,
  getLegalPawnMoves,
  reachedGoal,
  shortestPathLength,
  validateWallPlacement,
} from './game-engine.js';

const WIN_SCORE = 1_000_000;
const INF = 1_000_000_000;

function playerById(state, id) {
  return state.players.find((p) => p.id === id);
}

function otherPlayers(state, id) {
  return state.players.filter((p) => p.id !== id);
}

function allMoveActions(state, playerId) {
  return getLegalPawnMoves(state, playerId).map((m) => ({ type: 'move', ...m }));
}

function shortestPathCells(state, playerId) {
  const player = playerById(state, playerId);
  if (!player) return [];
  const key = (r, c) => `${r},${c}`;
  const start = { row: player.row, col: player.col };
  const queue = [start];
  const prev = new Map();
  const seen = new Set([key(start.row, start.col)]);
  let goal = null;

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (reachedGoal(state, player, cur.row, cur.col)) {
      goal = cur;
      break;
    }
    for (const next of getBoardNeighbors(state, cur.row, cur.col)) {
      const k = key(next.row, next.col);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, cur);
      queue.push(next);
    }
  }

  if (!goal) return [];
  const path = [goal];
  let cur = goal;
  while (cur.row !== start.row || cur.col !== start.col) {
    const p = prev.get(key(cur.row, cur.col));
    if (!p) break;
    path.push(p);
    cur = p;
  }
  path.reverse();
  return path;
}

function wallKeysBlockingEdge(a, b, slots) {
  const result = [];
  if (a.row !== b.row) {
    const row = Math.min(a.row, b.row);
    const col = a.col;
    for (const c of [col - 1, col]) {
      if (row >= 0 && row < slots && c >= 0 && c < slots) result.push({ row, col: c, orientation: 'H' });
    }
  } else if (a.col !== b.col) {
    const row = a.row;
    const col = Math.min(a.col, b.col);
    for (const r of [row - 1, row]) {
      if (r >= 0 && r < slots && col >= 0 && col < slots) result.push({ row: r, col, orientation: 'V' });
    }
  }
  return result;
}

function collectWallCandidates(state, playerId, radius = 1) {
  const me = playerById(state, playerId);
  if (!me || me.walls <= 0) return [];
  const slots = state.boardSize - 1;
  const seen = new Set();
  const raw = [];
  const add = (wall) => {
    if (!wall || wall.row < 0 || wall.col < 0 || wall.row >= slots || wall.col >= slots) return;
    const k = `${wall.row},${wall.col},${wall.orientation}`;
    if (seen.has(k)) return;
    seen.add(k);
    raw.push(wall);
  };

  // Most useful candidates: walls that directly intersect the current shortest
  // path of an opponent, especially the opponent nearest to victory.
  const opponents = otherPlayers(state, playerId)
    .map((p) => ({ p, distance: shortestPathLength(state, p.id) }))
    .sort((a, b) => a.distance - b.distance);

  for (const { p } of opponents) {
    const path = shortestPathCells(state, p.id);
    for (let i = 0; i + 1 < path.length; i++) {
      for (const wall of wallKeysBlockingEdge(path[i], path[i + 1], slots)) add(wall);
    }
  }

  // Tactical local candidates around every pawn.
  for (const anchor of state.players) {
    for (let r = Math.max(0, anchor.row - radius); r <= Math.min(slots - 1, anchor.row + radius); r++) {
      for (let c = Math.max(0, anchor.col - radius); c <= Math.min(slots - 1, anchor.col + radius); c++) {
        add({ row: r, col: c, orientation: 'H' });
        add({ row: r, col: c, orientation: 'V' });
      }
    }
  }

  // Walls beside existing structures are often strategically meaningful and
  // let the AI extend corridors rather than only dropping isolated walls.
  for (const w of state.walls) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      add({ row: w.row + dr, col: w.col + dc, orientation: 'H' });
      add({ row: w.row + dr, col: w.col + dc, orientation: 'V' });
    }
  }

  return raw.filter((w) => validateWallPlacement(state, w).ok).map((w) => ({ type: 'wall', ...w }));
}

function wallImpact(state, playerId, action) {
  const beforeMe = shortestPathLength(state, playerId);
  const beforeOpp = otherPlayers(state, playerId).map((p) => ({ id: p.id, d: shortestPathLength(state, p.id) }));
  const result = applyAction(state, playerId, action);
  if (!result.ok) return -INF;
  const next = result.state;
  const afterMe = shortestPathLength(next, playerId);
  const selfDamage = Math.max(0, afterMe - beforeMe);

  let bestDelay = 0;
  let weightedDelay = 0;
  for (const opp of beforeOpp) {
    const after = shortestPathLength(next, opp.id);
    const delay = Math.max(0, after - opp.d);
    bestDelay = Math.max(bestDelay, delay);
    const urgency = opp.d <= 2 ? 6 : opp.d <= 4 ? 3 : 1;
    weightedDelay += delay * urgency;
  }

  return weightedDelay * 18 + bestDelay * 7 - selfDamage * 16;
}

function rankedWallActions(state, playerId, limit = 10, radius = 1) {
  const candidates = collectWallCandidates(state, playerId, radius);
  return candidates
    .map((action) => ({ action, score: wallImpact(state, playerId, action) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.action);
}

function moveProgressScore(state, playerId, action) {
  const before = shortestPathLength(state, playerId);
  const r = applyAction(state, playerId, action);
  if (!r.ok) return -INF;
  if (r.state.winner === playerId) return WIN_SCORE;
  const after = shortestPathLength(r.state, playerId);
  const delta = before - after;
  // Moving away from the goal is allowed, but must overcome a meaningful
  // penalty elsewhere in the search to be chosen.
  return delta >= 0 ? delta * 28 : delta * 52;
}

function nearestOpponentDistance(state, aiId) {
  const values = otherPlayers(state, aiId).map((p) => shortestPathLength(state, p.id));
  return values.length ? Math.min(...values) : INF;
}

function evaluate(state, aiId) {
  if (state.winner === aiId) return WIN_SCORE - state.moveNumber;
  if (state.winner) return -WIN_SCORE + state.moveNumber;

  const me = playerById(state, aiId);
  if (!me) return -WIN_SCORE;
  const myPath = shortestPathLength(state, aiId);
  const opponents = otherPlayers(state, aiId).map((p) => ({ p, path: shortestPathLength(state, p.id) }));
  const nearest = Math.min(...opponents.map((o) => o.path));
  const average = opponents.reduce((sum, o) => sum + o.path, 0) / Math.max(1, opponents.length);
  const maxOppWalls = Math.max(0, ...opponents.map((o) => o.p.walls));

  let score = (nearest - myPath) * 34;
  score += (average - myPath) * 7;
  score += (me.walls - maxOppWalls) * 1.7;

  // Endgame urgency: a one-step-away opponent is an emergency, while being
  // one step from our own goal is disproportionately valuable.
  if (myPath === 1) score += 260;
  if (nearest === 1) score -= 380;
  else if (nearest === 2) score -= 100;

  return score;
}

function emergencyBlockingWall(state, aiId) {
  const danger = otherPlayers(state, aiId)
    .map((p) => ({ p, d: shortestPathLength(state, p.id) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!danger || danger.d > 2 || playerById(state, aiId)?.walls <= 0) return null;

  const before = danger.d;
  const candidates = rankedWallActions(state, aiId, 16, 1);
  let best = null;
  let bestGain = 0;
  let bestSelfDamage = INF;
  const myBefore = shortestPathLength(state, aiId);

  for (const action of candidates) {
    const r = applyAction(state, aiId, action);
    if (!r.ok) continue;
    const gain = shortestPathLength(r.state, danger.p.id) - before;
    const selfDamage = shortestPathLength(r.state, aiId) - myBefore;
    if (gain > bestGain || (gain === bestGain && gain > 0 && selfDamage < bestSelfDamage)) {
      best = action;
      bestGain = gain;
      bestSelfDamage = selfDamage;
    }
  }
  return bestGain > 0 ? best : null;
}

function actionOrderingScore(state, playerId, action, perspectiveId) {
  if (action.type === 'wall') {
    const score = wallImpact(state, playerId, action);
    return playerId === perspectiveId ? score + 15 : score;
  }
  return moveProgressScore(state, playerId, action);
}

function orderedActions(state, playerId, perspectiveId, wallLimit = 8) {
  const moves = allMoveActions(state, playerId);
  const player = playerById(state, playerId);
  const walls = player?.walls > 0 ? rankedWallActions(state, playerId, wallLimit, 1) : [];
  return [...moves, ...walls]
    .map((action) => ({ action, score: actionOrderingScore(state, playerId, action, perspectiveId) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.action);
}

function stateKey(state, depth, aiId) {
  const players = state.players.map((p) => `${p.id}:${p.row},${p.col},${p.walls}`).join('|');
  const walls = state.walls.map((w) => `${w.row},${w.col},${w.orientation}`).sort().join(';');
  return `${aiId}/${depth}/${state.turn}/${players}/${walls}`;
}

function search(state, aiId, depth, alpha, beta, ctx) {
  ctx.nodes += 1;
  if (ctx.nodes > ctx.nodeBudget) {
    ctx.aborted = true;
    return { score: evaluate(state, aiId), action: null };
  }
  if (depth <= 0 || state.winner) return { score: evaluate(state, aiId), action: null };

  const key = stateKey(state, depth, aiId);
  const cached = ctx.table.get(key);
  if (cached) return cached;

  const current = state.players[state.turn]?.id;
  if (!current) return { score: evaluate(state, aiId), action: null };

  const maximize = current === aiId;
  const actions = orderedActions(state, current, aiId, ctx.wallLimit);
  if (!actions.length) return { score: evaluate(state, aiId), action: null };

  let bestAction = actions[0];
  let bestScore = maximize ? -INF : INF;

  for (const action of actions) {
    const r = applyAction(state, current, action);
    if (!r.ok) continue;
    let child = search(r.state, aiId, depth - 1, alpha, beta, ctx).score;

    // Root-independent anti-backtracking signal. It is deliberately modest in
    // minimax so a tactical retreat can still be selected when it prevents a loss.
    if (current === aiId && action.type === 'move') {
      const before = shortestPathLength(state, aiId);
      const after = shortestPathLength(r.state, aiId);
      if (after > before) child -= (after - before) * 18;
    }

    if (maximize) {
      if (child > bestScore) { bestScore = child; bestAction = action; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (child < bestScore) { bestScore = child; bestAction = action; }
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha || ctx.aborted) break;
  }

  const result = { score: bestScore, action: bestAction };
  if (!ctx.aborted) ctx.table.set(key, result);
  return result;
}

function iterativeSearch(state, aiId, options) {
  let best = null;
  const table = new Map();
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const ctx = {
      nodes: 0,
      nodeBudget: options.nodeBudget,
      wallLimit: options.wallLimit,
      table,
      aborted: false,
    };
    const result = search(state, aiId, depth, -INF, INF, ctx);
    if (!ctx.aborted && result.action) best = result.action;
    if (ctx.aborted) break;
    if (Math.abs(result.score) >= WIN_SCORE - 1000) break;
  }
  return best;
}


function chooseBestMoveOnly(state, aiId) {
  const moves = allMoveActions(state, aiId);
  let best = null;
  let bestScore = -INF;
  for (const move of moves) {
    const r = applyAction(state, aiId, move);
    if (!r.ok) continue;
    const score = evaluate(r.state, aiId) + moveProgressScore(state, aiId, move);
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return best || moves[0] || null;
}

function chooseImmediate(state, aiId, includeWalls = true, wallLimit = 8) {
  let actions = allMoveActions(state, aiId);
  if (includeWalls) actions = actions.concat(rankedWallActions(state, aiId, wallLimit, 1));
  let bestScore = -INF;
  let best = [];
  for (const action of actions) {
    const r = applyAction(state, aiId, action);
    if (!r.ok) continue;
    let score = evaluate(r.state, aiId);
    if (action.type === 'wall') score += wallImpact(state, aiId, action) * 0.65;
    else score += moveProgressScore(state, aiId, action) * 0.8;
    if (score > bestScore) { bestScore = score; best = [action]; }
    else if (Math.abs(score - bestScore) < 0.001) best.push(action);
  }
  return best[Math.floor(Math.random() * best.length)] || actions[0] || null;
}

export function chooseAiAction(state, playerId, difficulty = 'beginner') {
  const moves = allMoveActions(state, playerId);
  if (!moves.length) return null;

  // Always take a direct winning move, regardless of difficulty.
  for (const move of moves) {
    const r = applyAction(state, playerId, move);
    if (r.ok && r.state.winner === playerId) return move;
  }

  if (difficulty === 'beginner') {
    const shouldWall = Math.random() < 0.10 && playerById(state, playerId)?.walls > 0;
    if (shouldWall) {
      const walls = rankedWallActions(state, playerId, 4, 1);
      if (walls.length) return walls[Math.floor(Math.random() * walls.length)];
    }
    // Beginner still tends forward, but deliberately remains imperfect.
    const scored = moves.map((m) => ({ m, s: moveProgressScore(state, playerId, m) + Math.random() * 38 }));
    scored.sort((a, b) => b.s - a.s);
    return scored[0].m;
  }

  const emergency = emergencyBlockingWall(state, playerId);
  if (emergency) return emergency;

  // When comfortably ahead, convert the advantage instead of wasting walls.
  // This also keeps higher levels fast in positions where racing is clearly best.
  const myPath = shortestPathLength(state, playerId);
  const nearestOpp = nearestOpponentDistance(state, playerId);
  if (myPath + 4 <= nearestOpp) return chooseBestMoveOnly(state, playerId);

  if (difficulty === 'skilled') {
    return chooseImmediate(state, playerId, true, 7) || moves[0];
  }

  if (difficulty === 'veteran') {
    return iterativeSearch(state, playerId, { maxDepth: 2, nodeBudget: 420, wallLimit: 7 })
      || chooseImmediate(state, playerId, true, 8)
      || moves[0];
  }

  // Expert is intentionally bounded so it remains browser-friendly. Move
  // ordering + targeted walls make these nodes much more valuable than the old
  // brute-force depth-3 search.
  return iterativeSearch(state, playerId, { maxDepth: 3, nodeBudget: 460, wallLimit: 7 })
    || chooseImmediate(state, playerId, true, 10)
    || moves[0];
}
