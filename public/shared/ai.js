import { applyAction, getLegalPawnMoves, shortestPathLength, validateWallPlacement } from './game-engine.js';

function allMoveActions(state, playerId) { return getLegalPawnMoves(state, playerId).map(m => ({type:'move',...m})); }
function candidateWalls(state, playerId, radius=2) {
  const opponents = state.players.filter(p=>p.id!==playerId);
  const anchors = [state.players.find(p=>p.id===playerId), ...opponents].filter(Boolean);
  const out=[]; const seen=new Set(); const slots=state.boardSize-1;
  for(const a of anchors) for(let r=Math.max(0,a.row-radius);r<=Math.min(slots-1,a.row+radius);r++) for(let c=Math.max(0,a.col-radius);c<=Math.min(slots-1,a.col+radius);c++) for(const orientation of ['H','V']) {
    const k=`${r},${c},${orientation}`; if(seen.has(k)) continue; seen.add(k);
    const w={row:r,col:c,orientation}; if(validateWallPlacement(state,w).ok) out.push({type:'wall',...w});
  }
  return out;
}
function evaluate(state, aiId) {
  if(state.winner===aiId) return 100000;
  if(state.winner) return -100000;
  const me=shortestPathLength(state,aiId);
  const others=state.players.filter(p=>p.id!==aiId).map(p=>shortestPathLength(state,p.id));
  const nearest=Math.min(...others);
  const myWalls=state.players.find(p=>p.id===aiId)?.walls||0;
  const otherWalls=Math.max(...state.players.filter(p=>p.id!==aiId).map(p=>p.walls));
  return (nearest-me)*18 + (myWalls-otherWalls)*1.5;
}
function chooseBestImmediate(state, aiId, includeWalls=true) {
  let actions=allMoveActions(state,aiId);
  if(includeWalls && state.players.find(p=>p.id===aiId)?.walls>0) actions=actions.concat(candidateWalls(state,aiId,1));
  let best=[], score=-Infinity;
  for(const a of actions){const r=applyAction(state,aiId,a);if(!r.ok)continue;const s=evaluate(r.state,aiId);if(s>score){score=s;best=[a]}else if(s===score)best.push(a)}
  return best[Math.floor(Math.random()*best.length)]||actions[0];
}
function minimax(state, aiId, depth, alpha, beta) {
  if(depth<=0||state.winner) return {score:evaluate(state,aiId)};
  const current=state.players[state.turn].id;
  let actions=allMoveActions(state,current);
  if(state.players.find(p=>p.id===current)?.walls>0) actions=actions.concat(candidateWalls(state,current,1).slice(0,10));
  if(!actions.length) return {score:evaluate(state,aiId)};
  const maximize=current===aiId;
  let bestAction=actions[0], bestScore=maximize?-Infinity:Infinity;
  for(const a of actions){const r=applyAction(state,current,a);if(!r.ok)continue;const child=minimax(r.state,aiId,depth-1,alpha,beta).score;
    if(maximize){if(child>bestScore){bestScore=child;bestAction=a}alpha=Math.max(alpha,bestScore)}
    else{if(child<bestScore){bestScore=child;bestAction=a}beta=Math.min(beta,bestScore)}
    if(beta<=alpha)break;
  }
  return {score:bestScore,action:bestAction};
}
export function chooseAiAction(state, playerId, difficulty='beginner') {
  const moves=allMoveActions(state,playerId); if(!moves.length) return null;
  if(difficulty==='beginner') {
    const wallChance=Math.random()<.12 && state.players.find(p=>p.id===playerId)?.walls>0;
    const pool=wallChance?candidateWalls(state,playerId,1):moves; return pool[Math.floor(Math.random()*pool.length)]||moves[0];
  }
  if(difficulty==='skilled') return chooseBestImmediate(state,playerId,true);
  if(difficulty==='veteran') return minimax(state,playerId,2,-Infinity,Infinity).action || chooseBestImmediate(state,playerId,true);
  return minimax(state,playerId,3,-Infinity,Infinity).action || chooseBestImmediate(state,playerId,true);
}
