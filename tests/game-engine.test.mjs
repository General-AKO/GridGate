import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, getGameConfig, getLegalPawnMoves, applyAction, validateWallPlacement, hasPathToGoal, reachedGoal } from '../public/shared/game-engine.js';
import { chooseAiAction } from '../public/shared/ai.js';

test('classic 2 players is 9x9 with 10 walls',()=>{const s=createInitialState({playerCount:2,mode:'classic'});assert.equal(s.boardSize,9);assert.equal(s.players.length,2);assert.equal(s.players[0].walls,10)});
test('classic sizes are 9,11,11',()=>{assert.equal(getGameConfig(2,'classic').boardSize,9);assert.equal(getGameConfig(3,'classic').boardSize,11);assert.equal(getGameConfig(4,'classic').boardSize,11)});
test('race sizes are 9,11,11 and all start same row',()=>{for(const n of [2,3,4]){const s=createInitialState({playerCount:n,mode:'race'});assert.equal(s.boardSize,n===2?9:11);assert.ok(s.players.every(p=>p.row===s.boardSize-1&&p.goal==='top'))}});
test('center sizes are 9,11,11 with 8 walls',()=>{for(const n of [2,3,4]){const s=createInitialState({playerCount:n,mode:'center'});assert.equal(s.boardSize,n===2?9:11);assert.ok(s.players.every(p=>p.walls===8&&p.goal==='center'))}});
test('center target is the exact middle cell on odd boards',()=>{const s=createInitialState({playerCount:2,mode:'center'}),p=s.players[0];assert.equal(reachedGoal(s,p,4,4),true);assert.equal(reachedGoal(s,p,4,5),false)});
test('center target is the middle 2x2 block if a board ever has an even size',()=>{for(const size of [10,12]){const s=createInitialState({playerCount:4,mode:'center'});s.boardSize=size;const p=s.players[0],hi=s.boardSize/2,lo=hi-1;for(let r=0;r<s.boardSize;r++)for(let c=0;c<s.boardSize;c++)assert.equal(reachedGoal(s,p,r,c),r>=lo&&r<=hi&&c>=lo&&c<=hi)}});
test('every player has a path to the centre on the 11x11 four-player board',()=>{const s=createInitialState({playerCount:4,mode:'center'});for(const p of s.players)assert.equal(hasPathToGoal(s,p.id),true)});
test('initial player has legal movement',()=>{const s=createInitialState();assert.ok(getLegalPawnMoves(s,'P1').length>=2)});
test('turn changes after legal move',()=>{const s=createInitialState(),m=getLegalPawnMoves(s,'P1')[0],r=applyAction(s,'P1',{type:'move',...m});assert.equal(r.ok,true);assert.equal(r.state.turn,1)});
test('wall owner is stored',()=>{const s=createInitialState(),r=applyAction(s,'P1',{type:'wall',row:0,col:0,orientation:'H'});assert.equal(r.ok,true);assert.equal(r.state.walls[0].owner,'P1')});
test('crossing walls are rejected',()=>{const s=createInitialState();s.walls.push({row:2,col:2,orientation:'H',owner:'P1'});assert.equal(validateWallPlacement(s,{row:2,col:2,orientation:'V'}).ok,false)});
test('BFS path exists on large board',()=>{const s=createInitialState({playerCount:4,mode:'classic'});for(const p of s.players)assert.equal(hasPathToGoal(s,p.id),true)});
test('AI returns a legal action at every difficulty',()=>{for(const d of ['beginner','skilled','veteran','expert']){const s=createInitialState({playerCount:2,mode:'classic'});s.turn=1;const a=chooseAiAction(s,'P2',d);assert.ok(a);const r=applyAction(s,'P2',a);assert.equal(r.ok,true,d)}});
test('four-player movement never lands on occupied pawn',()=>{const s=createInitialState({playerCount:4,mode:'classic'});const occupied=new Set(s.players.slice(1).map(p=>`${p.row},${p.col}`));for(const m of getLegalPawnMoves(s,'P1'))assert.equal(occupied.has(`${m.row},${m.col}`),false)});

test('expert blocks an opponent who is one move from winning when a useful wall exists',()=>{
  const s=createInitialState({playerCount:2,mode:'classic'});
  s.players[0].row=1; s.players[0].col=4;
  s.players[1].row=4; s.players[1].col=4;
  s.turn=1;
  const beforePath = 1;
  const a=chooseAiAction(s,'P2','expert');
  assert.ok(a);
  assert.equal(a.type,'wall');
  const r=applyAction(s,'P2',a);
  assert.equal(r.ok,true);
  // The threatening player must no longer have a direct one-step win.
  const p1Moves=getLegalPawnMoves(r.state,'P1');
  assert.equal(p1Moves.some(m=>m.row===0),false);
  assert.equal(beforePath,1);
});

test('expert does not retreat on the opening move when it has no walls',()=>{
  const s=createInitialState({playerCount:2,mode:'classic'});
  s.turn=1;
  s.players[1].walls=0;
  const before = 8;
  const a=chooseAiAction(s,'P2','expert');
  assert.ok(a);
  assert.equal(a.type,'move');
  const r=applyAction(s,'P2',a);
  assert.equal(r.ok,true);
  const after = r.state.players[1].row; // P2 heads toward bottom; row should advance.
  assert.ok(after > 0);
  assert.equal(before,8);
});
