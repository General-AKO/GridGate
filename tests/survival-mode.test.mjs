import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, applyAction, skipCurrentTurn, getGameConfig, getLegalPawnMoves, validateWallPlacement,
  getSnake, getSurvivors, getSnakeAttackTargets, getSnakeDashMoves, isAbilityReady, canUseAbility, abilityTurnsLeft,
  getAiSeatIds, maxAiPlayers, SNAKE_ID, SURVIVAL_RULES,
} from '../public/shared/game-engine.js';
import { chooseAiAction } from '../public/shared/ai.js';

const fresh = (playerCount = 2, snakeMode = 'ai', rng = () => 0) => createInitialState({ playerCount, mode: 'survival', snakeMode, rng });
const give = (s, id, patch) => Object.assign(s.players.find((p) => p.id === id), patch);
const place = (s, id, row, col) => give(s, id, { row, col });
const turnOf = (s, id) => { s.turn = s.players.findIndex((p) => p.id === id); return s; };
const dist = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const at = (s, id) => s.players.find((p) => p.id === id);

test('survival setup: sizes, snake start cell, survivors on the edges', () => {
  const expected = { 2: 7, 3: 9, 4: 9 };
  for (const count of [2, 3, 4]) {
    const s = fresh(count);
    assert.equal(s.mode, 'survival');
    assert.equal(s.boardSize, expected[count]);
    assert.equal(s.players.length, count + 1);
    const snake = getSnake(s);
    const mid = Math.floor((s.boardSize - 1) / 2);
    assert.deepEqual([snake.row, snake.col], [mid, mid]);
    assert.equal(snake.walls, 0);
    assert.equal(snake.gold, 0);
    assert.equal(getSurvivors(s).length, count);
    assert.equal(s.players.at(-1).id, SNAKE_ID, 'the snake plays after all survivors');
    for (const p of getSurvivors(s)) {
      assert.equal(p.walls, 8, 'exactly 8 walls per survivor');
      assert.ok(p.row === 0 || p.col === 0 || p.row === s.boardSize - 1 || p.col === s.boardSize - 1);
    }
  }
  assert.equal(getGameConfig(2, 'survival', 'player').snakeMode, 'player');
  assert.equal(getGameConfig(2, 'survival', 'nonsense').snakeMode, 'ai');
  assert.equal(getGameConfig(2, 'classic').snakeMode, undefined);
});

test('3 and 4 players share one board size: 11x11 in Classic/Race/Center, 9x9 in Survival (the snake is not counted)', () => {
  for (const mode of ['classic', 'race', 'center', 'survival']) {
    const size = mode === 'survival' ? 9 : 11;
    for (const count of [3, 4]) {
      assert.equal(getGameConfig(count, mode).boardSize, size, `${mode} ${count} players`);
      assert.equal(createInitialState({ playerCount: count, mode }).boardSize, size);
    }
    assert.equal(getGameConfig(2, mode).boardSize, mode === 'survival' ? 7 : 9, `${mode} 2 players are unchanged`);
  }
});

test('the AI snake interval is random in 7..12, the player snake uses a fixed 6', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(fresh(2, 'ai', Math.random).players.at(-1).ability.need);
  assert.deepEqual([...seen].sort((a, b) => a - b), [7, 8, 9, 10, 11, 12]);
  assert.equal(fresh(2, 'player').players.at(-1).ability.need, SURVIVAL_RULES.playerInterval);
});

test('the snake cannot build walls and never jumps over a survivor', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  assert.equal(applyAction(s, SNAKE_ID, { type: 'wall', row: 0, col: 0, orientation: 'H' }).ok, false);
  const c = getSnake(s).row;
  place(s, 'P1', c + 1, c);
  const moves = getLegalPawnMoves(s, SNAKE_ID);
  assert.ok(!moves.some((m) => m.row === c + 1 && m.col === c), 'cannot walk onto the survivor');
  assert.ok(!moves.some((m) => m.row === c + 2 && m.col === c), 'cannot jump over the survivor');
  assert.deepEqual(getSnakeAttackTargets(s), ['P1']);
});

test('a wall between the snake and a survivor prevents the attack; diagonals are safe', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const c = getSnake(s).row;
  place(s, 'P1', c + 1, c);
  s.walls.push({ row: c, col: c, orientation: 'H', owner: 'P2' });
  assert.deepEqual(getSnakeAttackTargets(s), []);
  place(s, 'P1', c + 1, c + 1);
  s.walls.length = 0;
  assert.deepEqual(getSnakeAttackTargets(s), []);
});

test('survivors may still jump over the snake like over any pawn', () => {
  const s = fresh(2);
  const c = getSnake(s).row;
  place(s, 'P1', c + 1, c);
  assert.ok(getLegalPawnMoves(s, 'P1').some((m) => m.row === c - 1 && m.col === c));
});

test('attack kills the pawn, leaves an event, frees the cell and turns the snake golden', () => {
  const s = turnOf(fresh(3), SNAKE_ID);
  const c = getSnake(s).row;
  place(s, 'P1', c, c + 1);
  const r = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P1' });
  assert.ok(r.ok);
  assert.equal(at(r.state, 'P1').alive, false);
  assert.deepEqual(r.state.lastEvent, { n: s.moveNumber, type: 'kill', target: 'P1', by: SNAKE_ID, row: c, col: c + 1 });
  assert.equal(getSnake(r.state).gold, SURVIVAL_RULES.goldTurns);
  assert.equal(r.state.winner, null);
  assert.equal(r.state.players[r.state.turn].id, 'P2');
  assert.equal(applyAction(s, SNAKE_ID, { type: 'attack', target: 'P2' }).ok, false, 'P2 is not adjacent');
});

test('the last survivor wins and the dead are skipped in the turn order', () => {
  let s = turnOf(fresh(3), SNAKE_ID);
  const c = getSnake(s).row;
  place(s, 'P1', c, c + 1);
  s = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P1' }).state;
  assert.equal(s.players[s.turn].id, 'P2');
  s = applyAction(s, 'P2', { type: 'move', ...getLegalPawnMoves(s, 'P2')[0] }).state;
  s = applyAction(s, 'P3', { type: 'move', ...getLegalPawnMoves(s, 'P3')[0] }).state;
  assert.equal(s.players[s.turn].id, SNAKE_ID);
  s = applyAction(s, SNAKE_ID, { type: 'move', ...getLegalPawnMoves(s, SNAKE_ID)[0] }).state;
  assert.equal(s.players[s.turn].id, 'P2', 'P1 is dead and skipped');
  const snake = getSnake(s);
  place(s, 'P3', snake.row, snake.col + 1);
  turnOf(s, SNAKE_ID);
  const end = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P3' });
  assert.ok(end.ok);
  assert.equal(end.state.winner, 'P2');
  assert.equal(applyAction(end.state, 'P2', { type: 'move', row: 0, col: 0 }).ok, false, 'no actions after the game ends');
});

test('freeze ability: readiness, random victim, lost snake turn', () => {
  let s = fresh(2, 'player');
  turnOf(s, SNAKE_ID);
  assert.equal(isAbilityReady(s), false);
  assert.equal(applyAction(s, SNAKE_ID, { type: 'ability' }).ok, false);
  assert.equal(abilityTurnsLeft(s), 5);
  give(s, SNAKE_ID, { ability: { charge: 5, need: 6 } });
  assert.equal(isAbilityReady(s), true);
  assert.equal(canUseAbility(s), true);
  assert.equal(abilityTurnsLeft(s), 0);
  const before = { row: getSnake(s).row, col: getSnake(s).col };
  const r = applyAction(s, SNAKE_ID, { type: 'ability', target: 'P1' }, { rng: () => 0.99 }); // a client-supplied target is ignored
  assert.ok(r.ok);
  s = r.state;
  assert.equal(at(s, 'P2').frozen, 2, 'the random pick (rng 0.99 -> last candidate) was frozen');
  assert.equal(at(s, 'P1').frozen, 0);
  assert.deepEqual({ row: getSnake(s).row, col: getSnake(s).col }, before, 'using the ability costs the snake its turn');
  assert.equal(s.lastEvent.type, 'freeze');
  assert.equal(s.lastEvent.target, 'P2');
  assert.equal(getSnake(s).ability.charge, 0);
  assert.equal(getSnake(s).ability.need, 6);
});

test('petrified survivor: first turn is lost completely, second turn allows walls (or passing) but no moving', () => {
  let s = fresh(2, 'player');
  turnOf(s, SNAKE_ID);
  give(s, SNAKE_ID, { ability: { charge: 5, need: 6 } });
  s = applyAction(s, SNAKE_ID, { type: 'ability' }, { rng: () => 0.99 }).state; // P2 frozen (2)
  const order = [];
  // P1 acts, P2's first turn vanishes, snake, P1, then P2 gets its stiff turn
  let stiffState = null;
  for (let i = 0; i < 4; i++) {
    const cur = s.players[s.turn];
    order.push(cur.id);
    if (cur.id === 'P2') { stiffState = s; break; }
    const a = chooseAiAction(s, cur.id, 'skilled');
    const res = applyAction(s, cur.id, a);
    assert.ok(res.ok, res.error);
    s = res.state;
  }
  assert.deepEqual(order, ['P1', SNAKE_ID, 'P1', 'P2']);
  assert.equal(at(stiffState, 'P2').frozen, 1, 'first frozen turn was consumed automatically');
  assert.deepEqual(getLegalPawnMoves(stiffState, 'P2'), [], 'no movement while petrified');
  const move = applyAction(stiffState, 'P2', { type: 'move', row: 1, col: 3 });
  assert.equal(move.ok, false);
  assert.match(move.error, /petrified/);
  // a wall is fine and ends the petrification
  const walled = applyAction(stiffState, 'P2', { type: 'wall', row: 2, col: 2, orientation: 'H' });
  assert.ok(walled.ok, walled.error);
  assert.equal(at(walled.state, 'P2').frozen, 0);
  assert.equal(at(walled.state, 'P2').walls, 7);
  assert.equal(walled.state.players[walled.state.turn].id, SNAKE_ID);
  // so is passing, but only while petrified
  const passed = applyAction(stiffState, 'P2', { type: 'pass' });
  assert.ok(passed.ok);
  assert.equal(at(passed.state, 'P2').frozen, 0);
  assert.equal(applyAction(fresh(2), 'P1', { type: 'pass' }).ok, false);
});

test('a stiff turn is skipped automatically when the player has no walls left; timeouts end the petrification', () => {
  let s = fresh(2);
  give(s, 'P2', { frozen: 1, walls: 0 });
  s = applyAction(s, 'P1', { type: 'move', ...getLegalPawnMoves(s, 'P1')[0] }).state;
  assert.equal(s.players[s.turn].id, SNAKE_ID, 'P2 had nothing to do and was skipped');
  assert.equal(at(s, 'P2').frozen, 0);

  const t = fresh(2);
  give(t, 'P1', { frozen: 1 });
  const skipped = skipCurrentTurn(t);
  assert.equal(at(skipped, 'P1').frozen, 0);
});

test('a frozen victim cannot be picked again and the ability needs a valid target', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { ability: { charge: 9, need: 7 } });
  give(s, 'P1', { frozen: 1 });
  give(s, 'P2', { frozen: 2 });
  assert.equal(canUseAbility(s), false);
  assert.equal(applyAction(s, SNAKE_ID, { type: 'ability' }).ok, false);
});

test('golden snake: two-cell dash, walls and pawns still block, no returning to the start', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const c = getSnake(s).row;
  assert.deepEqual(getSnakeDashMoves(s), [], 'no dash while not golden');
  assert.equal(applyAction(s, SNAKE_ID, { type: 'dash', row: c + 2, col: c }).ok, false);
  give(s, SNAKE_ID, { gold: 2 });
  const dashes = getSnakeDashMoves(s);
  assert.ok(dashes.length >= 8);
  assert.ok(dashes.every((d) => dist(d, { row: c, col: c }) === 2), 'exactly two cells away');
  assert.ok(!dashes.some((d) => d.row === c && d.col === c), 'never back onto the start cell');
  // a wall right below the snake blocks the straight dash south, but the sideways routes still work
  s.walls.push({ row: c, col: c, orientation: 'H', owner: 'P1' });
  const blocked = getSnakeDashMoves(s);
  assert.ok(!blocked.some((d) => d.row === c + 2 && d.col === c), 'cannot go through a wall');
  assert.ok(blocked.some((d) => d.row === c - 2 && d.col === c));
  // a pawn in the way blocks the straight line too
  s.walls.length = 0;
  place(s, 'P1', c + 1, c);
  assert.ok(!getSnakeDashMoves(s).some((d) => d.row === c + 2 && d.col === c), 'cannot pass through a survivor');
  place(s, 'P1', 6, 3);
  const r = applyAction(s, SNAKE_ID, { type: 'dash', row: c + 2, col: c });
  assert.ok(r.ok, r.error);
  assert.deepEqual([getSnake(r.state).row, getSnake(r.state).col], [c + 2, c]);
  assert.equal(getSnake(r.state).gold, 1, 'one golden turn used');
  assert.equal(getSnake(r.state).ability.charge, 1);
  assert.equal(applyAction(s, SNAKE_ID, { type: 'dash', row: c, col: c }).ok, false, 'no null move');
  assert.equal(applyAction(s, SNAKE_ID, { type: 'dash', row: c + 1, col: c }).ok, false, 'one cell is not a dash');
});

test('gold lasts two snake turns whatever it does, a single step is still allowed, and eating renews it', () => {
  let s = turnOf(fresh(3), SNAKE_ID);
  give(s, SNAKE_ID, { gold: 2 });
  const single = applyAction(s, SNAKE_ID, { type: 'move', ...getLegalPawnMoves(s, SNAKE_ID)[0] });
  assert.ok(single.ok);
  assert.equal(getSnake(single.state).gold, 1);
  const second = turnOf(single.state, SNAKE_ID);
  const again = applyAction(second, SNAKE_ID, { type: 'move', ...getLegalPawnMoves(second, SNAKE_ID)[0] });
  assert.equal(getSnake(again.state).gold, 0);
  const third = turnOf(again.state, SNAKE_ID);
  assert.equal(applyAction(third, SNAKE_ID, { type: 'dash', row: 0, col: 0 }).ok, false);

  // eating while golden restarts the two golden turns
  const eater = turnOf(fresh(3), SNAKE_ID);
  give(eater, SNAKE_ID, { gold: 1 });
  const c = getSnake(eater).row;
  place(eater, 'P2', c, c - 1);
  const ate = applyAction(eater, SNAKE_ID, { type: 'attack', target: 'P2' });
  assert.equal(getSnake(ate.state).gold, 2);
  // a skipped (timed out) snake turn also uses up a golden turn
  const idle = turnOf(fresh(2), SNAKE_ID);
  give(idle, SNAKE_ID, { gold: 2 });
  assert.equal(getSnake(skipCurrentTurn(idle)).gold, 1);
});

test('walls must always leave the snake a path to every living survivor', () => {
  const s = fresh(2);
  const mid = s.boardSize >> 1;
  const top = s.players.find((p) => p.id === 'P2');
  assert.equal(top.row, 0);
  for (const w of [{ row: 0, col: mid - 1, orientation: 'V' }, { row: 0, col: mid, orientation: 'V' }]) {
    assert.ok(validateWallPlacement(s, w).ok);
    s.walls.push({ ...w, owner: 'P1' });
  }
  const verdict = validateWallPlacement(s, { row: 1, col: mid - 1, orientation: 'H' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /snake a path/);
});

test('eliminated survivors no longer need a path', () => {
  const s = fresh(3);
  give(s, 'P2', { alive: false });
  assert.equal(getSurvivors(s).length, 2);
});

test('a skipped snake turn still counts as a round for the ability', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const next = skipCurrentTurn(s);
  assert.equal(getSnake(next).ability.charge, 1);
  assert.notEqual(next.players[next.turn].id, SNAKE_ID);
});

test('AI seats: survivors follow the same rule as the other modes, the snake is a separate seat', () => {
  assert.equal(maxAiPlayers(2), 0);
  assert.equal(maxAiPlayers(3), 1);
  assert.equal(maxAiPlayers(4), 2);
  assert.deepEqual(getAiSeatIds(fresh(3, 'ai'), 0), [SNAKE_ID]);
  assert.deepEqual(getAiSeatIds(fresh(3, 'player'), 0), []);
  assert.deepEqual(getAiSeatIds(fresh(3, 'ai'), 1), ['P3', SNAKE_ID]);
  assert.deepEqual(getAiSeatIds(fresh(3, 'player'), 5), ['P3'], 'clamped to the maximum');
  assert.deepEqual(getAiSeatIds(fresh(4, 'player'), 2), ['P3', 'P4']);
  assert.deepEqual(getAiSeatIds(fresh(4, 'ai'), 2), ['P3', 'P4', SNAKE_ID]);
  assert.deepEqual(getAiSeatIds(fresh(2, 'player'), 2), []);
  const classic = createInitialState({ playerCount: 4, mode: 'classic' });
  assert.deepEqual(getAiSeatIds(classic, 2), ['P3', 'P4']);
  assert.deepEqual(getAiSeatIds(classic, 0), []);
});

test('snake AI: attacks when adjacent, freezes when ready, otherwise hunts the closest prey', () => {
  let s = turnOf(fresh(2), SNAKE_ID);
  const c = getSnake(s).row;
  place(s, 'P1', c, c + 1);
  assert.deepEqual(chooseAiAction(s, SNAKE_ID, 'veteran'), { type: 'attack', target: 'P1' });

  s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { ability: { charge: 20, need: 7 } });
  assert.deepEqual(chooseAiAction(s, SNAKE_ID, 'veteran'), { type: 'ability' });

  s = turnOf(fresh(2), SNAKE_ID);
  place(s, 'P1', c + 2, c);
  const a = chooseAiAction(s, SNAKE_ID, 'veteran');
  assert.equal(a.type, 'move');
  assert.equal(a.intent, 'P1');
  assert.deepEqual([a.row, a.col], [c + 1, c]);
});

test('golden snake AI takes the double move towards its prey, but still eats first when it can', () => {
  let s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { gold: 2 });
  const c = getSnake(s).row;
  place(s, 'P1', c + 3, c);
  place(s, 'P2', 0, 0);
  const a = chooseAiAction(s, SNAKE_ID, 'veteran');
  assert.equal(a.type, 'dash');
  assert.equal(a.intent, 'P1');
  assert.equal(dist(a, at(s, 'P1')), 1, 'two cells closer');
  assert.ok(applyAction(s, SNAKE_ID, a).ok);

  s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { gold: 2 });
  place(s, 'P1', c, c + 1);
  assert.deepEqual(chooseAiAction(s, SNAKE_ID, 'veteran'), { type: 'attack', target: 'P1' });
});

test('snake AI switches to a frozen (helpless) prey of similar distance', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const c = getSnake(s).row;
  place(s, 'P1', c + 3, c);
  place(s, 'P2', c - 3, c);
  give(s, 'P2', { frozen: 2 });
  const a = chooseAiAction(s, SNAKE_ID, 'veteran');
  assert.equal(a.intent, 'P2');
  assert.deepEqual([a.row, a.col], [c - 1, c]);
});

test('survivor AI never ends its turn next to the snake when it has a safe move', () => {
  const s = fresh(2);
  const c = getSnake(s).row;
  place(s, 'P1', c + 3, c);
  place(s, SNAKE_ID, c + 1, c);
  for (const level of ['skilled', 'veteran', 'expert']) {
    const a = chooseAiAction(s, 'P1', level);
    const r = applyAction(s, 'P1', a);
    assert.ok(r.ok);
    assert.ok(dist(at(r.state, 'P1'), getSnake(r.state)) > 1, `${level} kept a safe distance`);
  }
});

test('survivor AI never leaves an open square and runs away from a golden snake that can dash', () => {
  const s = fresh(3);
  const c = getSnake(s).row;
  place(s, 'P1', c + 4, c);
  give(s, SNAKE_ID, { gold: 2 });
  for (const level of ['veteran', 'expert']) {
    const a = chooseAiAction(s, 'P1', level);
    const r = applyAction(s, 'P1', a);
    assert.ok(r.ok, r.error);
    const after = at(r.state, 'P1');
    assert.ok(dist(after, getSnake(r.state)) >= 4, `${level} did not walk into the dash range (${JSON.stringify(a)})`);
  }
});

test('survivor AI on a petrified stiff turn only builds a wall or passes', () => {
  const s = fresh(2);
  const c = getSnake(s).row;
  place(s, 'P1', c + 2, c);
  give(s, 'P1', { frozen: 1 });
  for (const level of ['beginner', 'skilled', 'veteran', 'expert']) {
    const a = chooseAiAction(s, 'P1', level);
    assert.ok(a && (a.type === 'wall' || a.type === 'pass'), `${level}: ${JSON.stringify(a)}`);
    assert.ok(applyAction(s, 'P1', a).ok);
  }
});

test('survivor AI does not dither: it keeps circulating instead of shuffling between two cells', () => {
  let total = 0, reversals = 0;
  for (let game = 0; game < 4; game++) {
    let s = createInitialState({ playerCount: 2, mode: 'survival', snakeMode: 'ai' });
    const hist = { P1: [], P2: [] };
    for (let ply = 0; ply < 150 && !s.winner; ply++) {
      const cur = s.players[s.turn];
      const a = chooseAiAction(s, cur.id, 'veteran');
      if (!a) { s = skipCurrentTurn(s); continue; }
      if (cur.id !== SNAKE_ID && a.type === 'move') {
        const h = hist[cur.id]; total++;
        if (h.length >= 2 && h.at(-2) === `${a.row},${a.col}`) reversals++;
        h.push(`${cur.row},${cur.col}`);
      }
      s = applyAction(s, cur.id, a).state;
    }
  }
  assert.ok(total > 60);
  assert.ok(reversals / total < 0.12, `too many immediate reversals: ${reversals}/${total}`);
});

test('fuzz: random survivors against the AI snake never produce an illegal or stuck state', () => {
  for (let game = 0; game < 24; game++) {
    const count = 2 + (game % 3);
    let s = createInitialState({ playerCount: count, mode: 'survival', snakeMode: 'ai' });
    let kills = 0;
    for (let ply = 0; ply < 2500 && !s.winner; ply++) {
      const cur = s.players[s.turn];
      assert.ok(cur.alive !== false, 'turn never lands on a dead player');
      assert.ok(cur.frozen < 2, 'turn never lands on a fully petrified player');
      let action;
      if (cur.id === SNAKE_ID) action = chooseAiAction(s, cur.id, 'veteran');
      else if (cur.frozen === 1) action = Math.random() < 0.5 ? { type: 'pass' } : chooseAiAction(s, cur.id, 'skilled');
      else {
        const moves = getLegalPawnMoves(s, cur.id);
        action = moves.length ? { type: 'move', ...moves[Math.floor(Math.random() * moves.length)] } : null;
      }
      if (!action) { s = skipCurrentTurn(s); continue; }
      const r = applyAction(s, cur.id, action);
      assert.ok(r.ok, `${cur.id} ${JSON.stringify(action)} -> ${r.error}`);
      if (r.state.lastEvent?.type === 'kill' && r.state.lastEvent.n === s.moveNumber) kills++;
      s = r.state;
    }
    assert.ok(s.winner, `game ${game} should end against random survivors`);
    assert.equal(kills, count - 1);
    assert.equal(getSurvivors(s).length, 1);
    assert.equal(s.winner, getSurvivors(s)[0].id);
  }
});

test('AI versus AI (2 survivors) plays legal actions only, at every level', () => {
  for (const level of ['beginner', 'skilled', 'veteran']) {
    let s = createInitialState({ playerCount: 2, mode: 'survival', snakeMode: 'ai' });
    for (let ply = 0; ply < 700 && !s.winner; ply++) {
      const cur = s.players[s.turn];
      const action = chooseAiAction(s, cur.id, level);
      if (!action) { s = skipCurrentTurn(s); continue; }
      const r = applyAction(s, cur.id, action);
      assert.ok(r.ok, `${level}: ${cur.id} ${JSON.stringify(action)} -> ${r.error}`);
      s = r.state;
    }
  }
});

test('AI survivors work in bigger games too (3 and 4 survivors, AI seats mixed with the snake)', () => {
  for (const count of [3, 4]) {
    let s = createInitialState({ playerCount: count, mode: 'survival', snakeMode: 'ai' });
    for (let ply = 0; ply < 250 && !s.winner; ply++) {
      const cur = s.players[s.turn];
      const action = chooseAiAction(s, cur.id, 'veteran');
      if (!action) { s = skipCurrentTurn(s); continue; }
      const r = applyAction(s, cur.id, action);
      assert.ok(r.ok, `${cur.id} ${JSON.stringify(action)} -> ${r.error}`);
      s = r.state;
    }
  }
});

test('centre mode remembers the starting side of each pawn (stable board rotation)', () => {
  const s = createInitialState({ playerCount: 4, mode: 'center' });
  assert.deepEqual(s.players.map((p) => p.home), ['bottom', 'top', 'left', 'right']);
});
