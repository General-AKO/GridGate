import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, applyAction, skipCurrentTurn, getGameConfig, getLegalPawnMoves, validateWallPlacement,
  getSnake, getSurvivors, getSnakeAttackTargets, isAbilityReady, canUseAbility, abilityTurnsLeft, getAiSeatIds,
  SNAKE_ID, SURVIVAL_RULES,
} from '../public/shared/game-engine.js';
import { chooseAiAction } from '../public/shared/ai.js';

const fresh = (playerCount = 2, snakeMode = 'ai', rng = () => 0) => createInitialState({ playerCount, mode: 'survival', snakeMode, rng });
const snakeIndex = (s) => s.players.findIndex((p) => p.id === SNAKE_ID);
const give = (s, id, patch) => Object.assign(s.players.find((p) => p.id === id), patch);
const place = (s, id, row, col) => give(s, id, { row, col });
const turnOf = (s, id) => { s.turn = s.players.findIndex((p) => p.id === id); return s; };

test('survival setup: odd board, snake in the exact centre, survivors on the edges', () => {
  for (const count of [2, 3, 4]) {
    const s = fresh(count);
    assert.equal(s.mode, 'survival');
    assert.equal(s.boardSize % 2, 1);
    assert.equal(s.players.length, count + 1);
    const snake = getSnake(s);
    assert.deepEqual([snake.row, snake.col], [(s.boardSize - 1) / 2, (s.boardSize - 1) / 2]);
    assert.equal(snake.walls, 0);
    assert.equal(getSurvivors(s).length, count);
    assert.equal(s.players.at(-1).id, SNAKE_ID, 'the snake plays after all survivors');
    for (const p of getSurvivors(s)) assert.ok(p.row === 0 || p.col === 0 || p.row === s.boardSize - 1 || p.col === s.boardSize - 1);
  }
  assert.equal(getGameConfig(2, 'survival', 'player').snakeMode, 'player');
  assert.equal(getGameConfig(2, 'survival', 'nonsense').snakeMode, 'ai');
  assert.equal(getGameConfig(2, 'classic').snakeMode, undefined);
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
  const c = s.boardSize >> 1;
  place(s, 'P1', c + 1, c); // right below the snake
  const moves = getLegalPawnMoves(s, SNAKE_ID);
  assert.ok(!moves.some((m) => m.row === c + 1 && m.col === c), 'cannot walk onto the survivor');
  assert.ok(!moves.some((m) => m.row === c + 2 && m.col === c), 'cannot jump over the survivor');
  assert.deepEqual(getSnakeAttackTargets(s), ['P1']);
});

test('a wall between the snake and a survivor prevents the attack; diagonals are safe', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const c = s.boardSize >> 1;
  place(s, 'P1', c + 1, c);
  s.walls.push({ row: c, col: c, orientation: 'H', owner: 'P2' });
  assert.deepEqual(getSnakeAttackTargets(s), []);
  place(s, 'P1', c + 1, c + 1);
  s.walls.length = 0;
  assert.deepEqual(getSnakeAttackTargets(s), []);
});

test('survivors may still jump over the snake like over any pawn', () => {
  const s = fresh(2);
  const c = s.boardSize >> 1;
  place(s, 'P1', c + 1, c);
  const moves = getLegalPawnMoves(s, 'P1');
  assert.ok(moves.some((m) => m.row === c - 1 && m.col === c));
});

test('attack kills the pawn, leaves an event and frees the cell', () => {
  const s = turnOf(fresh(3), SNAKE_ID);
  const c = s.boardSize >> 1;
  place(s, 'P1', c, c + 1);
  const r = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P1' });
  assert.ok(r.ok);
  const dead = r.state.players.find((p) => p.id === 'P1');
  assert.equal(dead.alive, false);
  assert.deepEqual(r.state.lastEvent, { n: s.moveNumber, type: 'kill', target: 'P1', by: SNAKE_ID, row: c, col: c + 1 });
  assert.equal(r.state.winner, null);
  assert.equal(r.state.players[r.state.turn].id, 'P2', 'turn continues with the next living survivor');
  // dead pawns no longer block movement
  assert.ok(getLegalPawnMoves(r.state, 'P2').every((m) => !(m.row === dead.row && m.col === dead.col && false)));
  assert.equal(applyAction(s, SNAKE_ID, { type: 'attack', target: 'P2' }).ok, false, 'P2 is not adjacent');
});

test('the last survivor wins and the dead are skipped in the turn order', () => {
  let s = turnOf(fresh(3), SNAKE_ID);
  const c = s.boardSize >> 1;
  place(s, 'P1', c, c + 1);
  s = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P1' }).state;
  assert.equal(s.winner, null);
  assert.equal(s.players[s.turn].id, 'P2');
  s = applyAction(s, 'P2', { type: 'move', ...getLegalPawnMoves(s, 'P2')[0] }).state;
  assert.equal(s.players[s.turn].id, 'P3');
  s = applyAction(s, 'P3', { type: 'move', ...getLegalPawnMoves(s, 'P3')[0] }).state;
  assert.equal(s.players[s.turn].id, SNAKE_ID);
  s = applyAction(s, SNAKE_ID, { type: 'move', ...getLegalPawnMoves(s, SNAKE_ID)[0] }).state;
  assert.equal(s.players[s.turn].id, 'P2', 'P1 is dead and skipped');
  const c2 = s.boardSize >> 1;
  const snake = getSnake(s);
  place(s, 'P3', snake.row, snake.col + 1);
  turnOf(s, SNAKE_ID);
  const end = applyAction(s, SNAKE_ID, { type: 'attack', target: 'P3' });
  assert.ok(end.ok);
  assert.equal(end.state.winner, 'P2');
  assert.equal(applyAction(end.state, 'P2', { type: 'move', row: 0, col: 0 }).ok, false, 'no actions after the game ends');
  assert.ok(c2 >= 0);
});

test('the freeze ability: readiness, random victim, lost snake turn and exactly two skipped turns', () => {
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
  assert.equal(s.players.find((p) => p.id === 'P2').frozen, 2, 'the random pick (rng 0.99 -> last candidate) was frozen');
  assert.equal(s.players.find((p) => p.id === 'P1').frozen, 0);
  assert.deepEqual({ row: getSnake(s).row, col: getSnake(s).col }, before, 'using the ability costs the snake its turn');
  assert.deepEqual(s.lastEvent, { n: r.state.lastEvent.n, type: 'freeze', target: 'P2', by: SNAKE_ID, turns: 2 });
  assert.equal(getSnake(s).ability.charge, 0);
  assert.equal(getSnake(s).ability.need, 6);

  const order = [];
  for (let i = 0; i < 6; i++) {
    const cur = s.players[s.turn];
    order.push(cur.id);
    const a = chooseAiAction(s, cur.id, 'skilled');
    const res = applyAction(s, cur.id, a);
    assert.ok(res.ok, res.error);
    s = res.state;
    if (s.winner) break;
  }
  // P1 plays, P2 (frozen) is skipped, snake, P1, P2 skipped, snake, P1, P2 finally plays again
  assert.deepEqual(order.slice(0, 6), ['P1', SNAKE_ID, 'P1', SNAKE_ID, 'P1', 'P2']);
});

test('a frozen victim cannot be picked again and ability needs a valid target', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { ability: { charge: 9, need: 7 } });
  give(s, 'P1', { frozen: 1 });
  give(s, 'P2', { frozen: 2 });
  assert.equal(canUseAbility(s), false);
  assert.equal(applyAction(s, SNAKE_ID, { type: 'ability' }).ok, false);
});

test('walls must always leave the snake a path to every living survivor', () => {
  const s = fresh(2);
  const mid = s.boardSize >> 1;
  const top = s.players.find((p) => p.id === 'P2');
  assert.equal(top.row, 0);
  // A two-cell pocket on the top edge: a vertical wall on each side, the roof is the board edge...
  for (const w of [{ row: 0, col: mid - 1, orientation: 'V' }, { row: 0, col: mid, orientation: 'V' }]) {
    assert.ok(validateWallPlacement(s, w).ok);
    s.walls.push({ ...w, owner: 'P1' });
  }
  // ...and a floor that would lock the survivor in must be refused.
  const sealing = { row: 1, col: mid - 1, orientation: 'H' };
  const verdict = validateWallPlacement(s, sealing);
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

test('AI seats: the survival snake is the only AI seat and only when configured as AI', () => {
  assert.deepEqual(getAiSeatIds(fresh(3, 'ai'), 2), [SNAKE_ID]);
  assert.deepEqual(getAiSeatIds(fresh(3, 'player'), 2), []);
  const classic = createInitialState({ playerCount: 4, mode: 'classic' });
  assert.deepEqual(getAiSeatIds(classic, 2), ['P3', 'P4']);
  assert.deepEqual(getAiSeatIds(classic, 0), []);
});

test('snake AI: attacks when adjacent, freezes when ready, otherwise hunts the closest prey', () => {
  let s = turnOf(fresh(2), SNAKE_ID);
  const c = s.boardSize >> 1;
  place(s, 'P1', c, c + 1);
  assert.deepEqual(chooseAiAction(s, SNAKE_ID, 'veteran'), { type: 'attack', target: 'P1' });

  s = turnOf(fresh(2), SNAKE_ID);
  give(s, SNAKE_ID, { ability: { charge: 20, need: 7 } });
  assert.deepEqual(chooseAiAction(s, SNAKE_ID, 'veteran'), { type: 'ability' });

  // P1 starts at the bottom edge, P2 at the top: put P1 much closer and the snake must step towards P1.
  s = turnOf(fresh(2), SNAKE_ID);
  place(s, 'P1', c + 2, c);
  const a = chooseAiAction(s, SNAKE_ID, 'veteran');
  assert.equal(a.type, 'move');
  assert.equal(a.intent, 'P1');
  assert.deepEqual([a.row, a.col], [c + 1, c]);
});

test('snake AI switches to a frozen (helpless) prey of similar distance', () => {
  const s = turnOf(fresh(2), SNAKE_ID);
  const c = s.boardSize >> 1;
  place(s, 'P1', c + 3, c);
  place(s, 'P2', c - 3, c);
  give(s, 'P2', { frozen: 2 });
  const a = chooseAiAction(s, SNAKE_ID, 'veteran');
  assert.equal(a.intent, 'P2');
  assert.deepEqual([a.row, a.col], [c - 1, c]);
});

test('survivor AI never ends its turn next to the snake when it has a safe move', () => {
  const s = fresh(2);
  const c = s.boardSize >> 1;
  place(s, 'P1', c + 3, c);
  place(s, SNAKE_ID, c + 1, c);
  for (const level of ['skilled', 'veteran', 'expert']) {
    const a = chooseAiAction(s, 'P1', level);
    const r = applyAction(s, 'P1', a);
    assert.ok(r.ok);
    const me = r.state.players.find((p) => p.id === 'P1');
    const snake = getSnake(r.state);
    assert.ok(Math.abs(me.row - snake.row) + Math.abs(me.col - snake.col) > 1, `${level} kept a safe distance`);
  }
});

test('fuzz: random survivors against the AI snake never produce an illegal or stuck state', () => {
  for (let game = 0; game < 25; game++) {
    const count = 2 + (game % 3);
    let s = createInitialState({ playerCount: count, mode: 'survival', snakeMode: 'ai' });
    let kills = 0;
    for (let ply = 0; ply < 700 && !s.winner; ply++) {
      const cur = s.players[s.turn];
      assert.ok(cur.alive !== false, 'turn never lands on a dead player');
      assert.ok(!(cur.frozen > 0), 'turn never lands on a frozen player');
      let action;
      if (cur.id === SNAKE_ID) action = chooseAiAction(s, cur.id, 'veteran');
      else {
        const moves = getLegalPawnMoves(s, cur.id);
        action = moves.length ? { type: 'move', ...moves[Math.floor(Math.random() * moves.length)] } : null;
      }
      if (!action) { s = skipCurrentTurn(s); continue; }
      const r = applyAction(s, cur.id, action);
      assert.ok(r.ok, `${cur.id} ${JSON.stringify(action)} -> ${r.error}`);
      if (r.state.lastEvent?.type === 'kill' && r.state.lastEvent.n === s.moveNumber) kills++;
      s = r.state;
      assert.ok(getSurvivors(s).length >= 1);
    }
    assert.ok(s.winner, `game ${game} should end against random survivors`);
    assert.equal(kills, count - 1);
    assert.equal(getSurvivors(s).length, 1);
    assert.equal(s.winner, getSurvivors(s)[0].id);
  }
});

test('AI versus AI (2 survivors) finishes with legal actions only', () => {
  let s = createInitialState({ playerCount: 2, mode: 'survival', snakeMode: 'ai' });
  for (let ply = 0; ply < 900 && !s.winner; ply++) {
    const cur = s.players[s.turn];
    const action = chooseAiAction(s, cur.id, 'skilled');
    if (!action) { s = skipCurrentTurn(s); continue; }
    const r = applyAction(s, cur.id, action);
    assert.ok(r.ok, `${cur.id} ${JSON.stringify(action)} -> ${r.error}`);
    s = r.state;
  }
  assert.ok(s.winner);
});

test('centre mode remembers the starting side of each pawn (stable board rotation)', () => {
  const s = createInitialState({ playerCount: 4, mode: 'center' });
  assert.deepEqual(s.players.map((p) => p.home), ['bottom', 'top', 'left', 'right']);
});
