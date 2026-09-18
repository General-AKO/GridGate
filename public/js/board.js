import { getLegalPawnMoves, validateWallPlacement, reachedGoal } from '../shared/game-engine.js';

const NS='http://www.w3.org/2000/svg';
const CELL=58,GAP=12,PAD=10,LONG_PRESS_MS=260;
const el=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};

export class BoardView{
  constructor(svg,callbacks){this.svg=svg;this.callbacks=callbacks;this.wallOrientation='H';this.wallModeEnabled=true;this.state=null;this.activePlayerId=null;this.interactive=false;this.touchGesture=null;this.suppressClickUntil=0;
    svg.addEventListener('contextmenu',e=>e.preventDefault());svg.addEventListener('dragstart',e=>e.preventDefault());svg.addEventListener('selectstart',e=>e.preventDefault());
    svg.addEventListener('click',e=>{if(performance.now()<this.suppressClickUntil){e.preventDefault();e.stopImmediatePropagation()}},true);
    svg.addEventListener('pointerdown',e=>this.onPointerDown(e));svg.addEventListener('pointermove',e=>this.onPointerMove(e));svg.addEventListener('pointerup',e=>this.onPointerUp(e));svg.addEventListener('pointercancel',e=>this.onPointerCancel(e));
  }
  metrics(){const size=this.state?.boardSize||9;return{size,total:PAD*2+CELL*size+GAP*(size-1)}}
  cellXY(row,col){return{x:PAD+col*(CELL+GAP),y:PAD+row*(CELL+GAP)}}
  wallRect(w){const b=this.cellXY(w.row,w.col);return w.orientation==='H'?{x:b.x,y:b.y+CELL,width:CELL*2+GAP,height:GAP}:{x:b.x+CELL,y:b.y,width:GAP,height:CELL*2+GAP}}
  setWallOrientation(v){if(!['H','V',null].includes(v))return;if(v===null)this.wallModeEnabled=false;else{this.wallOrientation=v;this.wallModeEnabled=true}if(this.state)this.render(this.state,this.activePlayerId,this.interactive)}
  getWallMode(){return this.wallModeEnabled?this.wallOrientation:null}
  render(state,activePlayerId,interactive){this.state=state;this.activePlayerId=activePlayerId;this.interactive=interactive;this.svg.replaceChildren();const{size,total}=this.metrics();this.svg.setAttribute('viewBox',`0 0 ${total} ${total}`);this.svg.append(el('rect',{x:0,y:0,width:total,height:total,rx:18,class:'board-bg'}));
    const legal=interactive&&activePlayerId?getLegalPawnMoves(state,activePlayerId):[],set=new Set(legal.map(m=>`${m.row},${m.col}`));
    for(let r=0;r<size;r++)for(let c=0;c<size;c++){const{x,y}=this.cellXY(r,c);const goal=state.players.some(p=>reachedGoal(state,p,r,c));const sq=el('rect',{x,y,width:CELL,height:CELL,rx:8,class:`board-cell ${goal?'goal-cell':''}`});sq.addEventListener('click',()=>{if(interactive&&set.has(`${r},${c}`))this.callbacks.onMove?.(r,c)});this.svg.append(sq);if(set.has(`${r},${c}`)){const m=el('circle',{cx:x+CELL/2,cy:y+CELL/2,r:8,class:'legal-move'});m.addEventListener('click',()=>this.callbacks.onMove?.(r,c));this.svg.append(m)}}
    for(const w of state.walls){this.svg.append(el('rect',{...this.wallRect(w),rx:5,class:`placed-wall owner-${(w.owner||'P1').toLowerCase()}`}))}
    if(interactive&&activePlayerId&&this.wallModeEnabled)this.renderDesktopWallTargets(state,activePlayerId);
    for(const p of state.players){const{x,y}=this.cellXY(p.row,p.col);this.svg.append(el('circle',{cx:x+CELL/2,cy:y+CELL/2+3,r:19,class:'pawn-shadow'}),el('circle',{cx:x+CELL/2,cy:y+CELL/2,r:19,class:`pawn ${p.id.toLowerCase()}`}))}
  }
  renderDesktopWallTargets(state,pid){const slots=state.boardSize-1,owner=`preview-${pid.toLowerCase()}`;for(let r=0;r<slots;r++)for(let c=0;c<slots;c++){const w={row:r,col:c,orientation:this.wallOrientation},valid=validateWallPlacement(state,w),t=el('rect',{...this.wallRect(w),rx:5,class:`wall-target ${owner} ${valid.ok?'wall-valid':'wall-invalid'}`});t.addEventListener('click',()=>{if(valid.ok)this.callbacks.onWall?.(w)});this.svg.append(t)}}
  eventToSvgPoint(e){const rect=this.svg.getBoundingClientRect(),{total}=this.metrics();if(!rect.width||!rect.height)return null;const x=(e.clientX-rect.left)*total/rect.width,y=(e.clientY-rect.top)*total/rect.height;return{x,y,inside:x>=0&&x<=total&&y>=0&&y<=total}}
  nearestWallAt(pt){if(!pt?.inside)return null;const slots=this.state.boardSize-1;let best=null,d=Infinity;for(let r=0;r<slots;r++)for(let c=0;c<slots;c++){const w={row:r,col:c,orientation:this.wallOrientation},q=this.wallRect(w),cx=q.x+q.width/2,cy=q.y+q.height/2,dd=(pt.x-cx)**2+(pt.y-cy)**2;if(dd<d){d=dd;best=w}}return best}
  removeTouchPreview(){this.svg.querySelector('.touch-wall-preview')?.remove()}
  updateTouchPreview(e){const g=this.touchGesture;if(!g?.active)return;const pt=this.eventToSvgPoint(e);g.inside=!!pt?.inside;g.wall=this.nearestWallAt(pt);this.removeTouchPreview();if(!g.wall)return;const v=validateWallPlacement(this.state,g.wall);g.valid=v.ok;this.svg.append(el('rect',{...this.wallRect(g.wall),rx:5,class:`wall-target touch-wall-preview preview-${this.activePlayerId.toLowerCase()} ${v.ok?'wall-valid':'wall-invalid'}`}))}
  onPointerDown(e){if(e.pointerType==='mouse'||!this.interactive||!this.activePlayerId||!this.wallModeEnabled)return;this.cancelTouchGesture();const g={pointerId:e.pointerId,active:false,wall:null,valid:false,inside:false,timer:null};this.touchGesture=g;g.timer=setTimeout(()=>{if(this.touchGesture!==g)return;g.active=true;this.suppressClickUntil=performance.now()+700;try{this.svg.setPointerCapture(e.pointerId)}catch{}this.updateTouchPreview(e)},LONG_PRESS_MS)}
  onPointerMove(e){const g=this.touchGesture;if(!g||g.pointerId!==e.pointerId||!g.active)return;e.preventDefault();this.updateTouchPreview(e)}
  onPointerUp(e){const g=this.touchGesture;if(!g||g.pointerId!==e.pointerId)return;clearTimeout(g.timer);if(g.active){e.preventDefault();this.updateTouchPreview(e);const w=g.wall,place=g.inside&&g.valid&&w;this.suppressClickUntil=performance.now()+700;this.removeTouchPreview();this.touchGesture=null;try{this.svg.releasePointerCapture(e.pointerId)}catch{}if(place)this.callbacks.onWall?.(w)}else this.touchGesture=null}
  onPointerCancel(e){if(this.touchGesture?.pointerId===e.pointerId)this.cancelTouchGesture()}
  cancelTouchGesture(){if(this.touchGesture?.timer)clearTimeout(this.touchGesture.timer);this.touchGesture=null;this.removeTouchPreview()}
}
