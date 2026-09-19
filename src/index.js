import { createInitialState, applyAction, skipCurrentTurn, getGameConfig } from '../public/shared/game-engine.js';
import { chooseAiAction } from '../public/shared/ai.js';

const ROOM_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',ROOM_CODE_LENGTH=6,TURN_MS=32000,AI_DELAY_MS=520,AI_DIFFICULTY='veteran',RECLAIM_GRACE_MS=15000,APP_VERSION='0.10.0';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, no-cache, must-revalidate'}});
function makeRoomCode(){const b=new Uint8Array(ROOM_CODE_LENGTH);crypto.getRandomValues(b);let c='';for(const x of b)c+=ROOM_CODE_ALPHABET[x%ROOM_CODE_ALPHABET.length];return c}
const normalizeRoomCode=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,ROOM_CODE_LENGTH);
const sanitizeName=v=>(String(v||'').trim().replace(/[<>]/g,'').slice(0,18)||'Player');
const meta=request=>({requestId:crypto.randomUUID(),now:Date.now(),colo:request.cf?.colo||null,country:request.cf?.country||null,httpProtocol:request.cf?.httpProtocol||null});
const normalizeAiCount=(playerCount,value)=>{const count=Number(playerCount)||2,max=count===3?1:count===4?2:0;return Math.max(0,Math.min(max,Math.floor(Number(value)||0)))};

export default{async fetch(request,env){const url=new URL(request.url),m=meta(request);
  if(url.pathname==='/api/health')return json({ok:true,service:'GridGate',version:APP_VERSION,...m});
  if(url.pathname==='/api/rooms'&&request.method==='POST'){
    let body={};try{body=await request.json()}catch{}const cfg=getGameConfig(body.playerCount,body.mode);cfg.aiCount=normalizeAiCount(cfg.playerCount,body.aiCount);
    for(let i=0;i<8;i++){const code=makeRoomCode(),stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));const r=await stub.fetch('https://room.internal/internal/create',{method:'POST',headers:{'content-type':'application/json','x-room-code':code},body:JSON.stringify(cfg)});if(r.status===201){const created=await r.json().catch(()=>({}));return json({ok:true,code,config:{...cfg,aiCount:created.aiCount??cfg.aiCount,humanCount:created.humanCount??cfg.playerCount-cfg.aiCount},...m},201)}}
    return json({ok:false,error:'Could not create a unique room.',...m},503);
  }
  const status=url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})$/);if(status&&request.method==='GET'){const code=normalizeRoomCode(status[1]),stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code)),r=await stub.fetch('https://room.internal/internal/status'),p=await r.json().catch(()=>({ok:false,error:'Invalid room status response.'}));return json({...p,edge:m},r.status)}
  const join=url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})\/join$/);if(join&&request.method==='POST'){const code=normalizeRoomCode(join[1]);let body={};try{body=await request.json()}catch{}const stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code)),r=await stub.fetch('https://room.internal/internal/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:sanitizeName(body.name),token:String(body.token||'')})}),p=await r.json().catch(()=>({ok:false,error:'Invalid join response.'}));return json({...p,edge:m},r.status)}
  const ws=url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{6})\/ws$/);if(ws){if((request.headers.get('Upgrade')||'').toLowerCase()!=='websocket')return json({ok:false,error:'WebSocket upgrade required.',...m},426);const code=normalizeRoomCode(ws[1]),stub=env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code)),f=new URL(request.url);f.pathname='/internal/ws';f.searchParams.set('room',code);f.searchParams.set('edgeRequestId',m.requestId);return stub.fetch(new Request(f.toString(),request))}
  return json({ok:false,error:'Not found.',...m},404);
}};

export class GameRoom{
  constructor(state,env){this.state=state;this.env=env;this.room=null;this.state.blockConcurrencyWhile(async()=>{this.room=await this.state.storage.get('room')})}
  seatIds(){return Array.from({length:this.room?.game?.playerCount||2},(_,i)=>`P${i+1}`)}
  aiIds(){return this.room?.aiIds||[]}
  humanSeatIds(){const ai=new Set(this.aiIds());return this.seatIds().filter(id=>!ai.has(id))}
  isAiSeat(id){return this.aiIds().includes(id)}
  currentPlayerId(){return this.room?.game?.players?.[this.room.game.turn]?.id||null}
  currentTurnIsAi(){const id=this.currentPlayerId();return Boolean(id&&this.isAiSeat(id))}
  async fetch(request){const url=new URL(request.url);
    if(url.pathname==='/internal/create'&&request.method==='POST'){
      if(this.room)return json({ok:false,error:'Room already exists.'},409);
      const code=normalizeRoomCode(request.headers.get('x-room-code'));if(code.length!==6)return json({ok:false,error:'Bad room code.'},400);
      let cfg={};try{cfg=await request.json()}catch{}
      const game=createInitialState(cfg),aiCount=normalizeAiCount(game.playerCount,cfg.aiCount),allIds=game.players.map(p=>p.id),selectedAiIds=aiCount?allIds.slice(-aiCount):[],players={};
      for(const p of game.players)players[p.id]=selectedAiIds.includes(p.id)?{name:aiCount===1?'Veteran AI':`Veteran AI ${selectedAiIds.indexOf(p.id)+1}`,ai:true}:null;
      this.room={code,createdAt:Date.now(),players,game,aiCount,aiIds:selectedAiIds,rematchVotes:[],turnDeadline:null,timerRevision:0};
      await this.persist();return json({ok:true,created:true,aiCount,humanCount:this.humanSeatIds().length},201)
    }
    if(url.pathname==='/internal/status'){
      if(!this.room)return json({ok:false,exists:false,error:'Room not found.'},404);
      const presence=this.presence(),seats={};for(const id of this.seatIds())seats[id]=Boolean(this.room.players[id]);
      return json({ok:true,exists:true,roomCode:this.room.code,roomAgeMs:Date.now()-this.room.createdAt,seats,connected:presence,ready:this.isReady(),config:{playerCount:this.room.game.playerCount,mode:this.room.game.mode,boardSize:this.room.game.boardSize,wallsPerPlayer:this.room.game.wallsPerPlayer,aiCount:this.room.aiCount||0,humanCount:this.humanSeatIds().length},turnDeadline:this.room.turnDeadline,serverNow:Date.now()})
    }
    if(url.pathname==='/internal/join'&&request.method==='POST'){
      if(!this.room)return json({ok:false,error:'Room not found.',stage:'join'},404);let b={};try{b=await request.json()}catch{}
      const seat=this.resolveSeat(String(b.token||'').trim(),sanitizeName(b.name));
      if(!seat)return json({ok:false,error:'Room is full or human seats are still reserved.',stage:'join',retryAfterMs:this.retryAfterMs(),connected:this.presence()},409);
      this.room.players[seat.playerId].joinReservedAt=Date.now();await this.persist();
      return json({ok:true,stage:'join',playerId:seat.playerId,token:seat.token,roomCode:this.room.code,config:{playerCount:this.room.game.playerCount,mode:this.room.game.mode,aiCount:this.room.aiCount||0,humanCount:this.humanSeatIds().length},connected:this.presence(),serverNow:Date.now()})
    }
    if(url.pathname==='/internal/ws'){
      if((request.headers.get('Upgrade')||'').toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});if(!this.room)return new Response('Room not found',{status:404});
      const token=String(url.searchParams.get('token')||'').trim(),seat=this.findSeatByToken(token);if(!seat)return new Response('Invalid or expired session token',{status:401});
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.state.acceptWebSocket(server);server.serializeAttachment({playerId:seat.playerId,token:seat.token});
      const p=this.room.players[seat.playerId];p.disconnectedAt=null;p.connectedAt=Date.now();p.joinReservedAt=null;await this.persist();this.closeDuplicateSocket(seat.playerId,seat.token,server);
      await this.ensureTurnTimer();server.send(JSON.stringify({type:'welcome',playerId:seat.playerId,token:seat.token,roomCode:this.room.code,serverNow:Date.now(),edgeRequestId:url.searchParams.get('edgeRequestId')||null}));server.send(JSON.stringify({type:'state',...this.publicSnapshot(seat.playerId)}));this.broadcastState();return new Response(null,{status:101,webSocket:client})
    }
    return new Response('Not found',{status:404});
  }
  findSeatByToken(token){if(!token)return null;for(const id of this.humanSeatIds())if(this.room.players[id]?.token===token)return{playerId:id,token};return null}
  resolveSeat(token,name){
    const exact=this.findSeatByToken(token);if(exact){const p=this.room.players[exact.playerId];p.name=name||p.name;p.disconnectedAt=null;return exact}
    const presence=this.presence(),now=Date.now();for(const id of this.humanSeatIds()){
      const e=this.room.players[id];if(!e){const t=crypto.randomUUID();this.room.players[id]={token:t,name,ai:false,disconnectedAt:null,connectedAt:null,joinReservedAt:now};return{playerId:id,token:t}}
      const lease=e.joinReservedAt?now-e.joinReservedAt:Infinity,disc=e.disconnectedAt?now-e.disconnectedAt:Infinity;
      if(!presence[id]&&((!e.connectedAt&&lease>=RECLAIM_GRACE_MS)||(e.disconnectedAt&&disc>=RECLAIM_GRACE_MS))){const t=crypto.randomUUID();this.room.players[id]={token:t,name,ai:false,disconnectedAt:null,connectedAt:null,joinReservedAt:now};return{playerId:id,token:t}}
    }return null
  }
  retryAfterMs(){const now=Date.now();let best=RECLAIM_GRACE_MS;for(const id of this.humanSeatIds()){const p=this.room.players[id];if(!p)return 0;const base=p.disconnectedAt||p.joinReservedAt;if(base)best=Math.min(best,Math.max(0,RECLAIM_GRACE_MS-(now-base)))}return best}
  closeDuplicateSocket(pid,token,except){for(const ws of this.state.getWebSockets()){if(ws===except)continue;const a=ws.deserializeAttachment();if(a?.playerId===pid&&a?.token===token)try{ws.close(4001,'Reconnected from another tab')}catch{}}}
  presence(){const r={};for(const id of this.seatIds())r[id]=this.isAiSeat(id);for(const ws of this.state.getWebSockets()){const a=ws.deserializeAttachment();if(a?.playerId in r&&!this.isAiSeat(a.playerId))r[a.playerId]=true}return r}
  isReady(){const p=this.presence();return this.humanSeatIds().every(id=>this.room.players[id]&&p[id])}
  publicSnapshot(forId=null){const presence=this.presence(),players={};for(const id of this.seatIds()){const p=this.room.players[id];players[id]=p?{name:p.name,connected:presence[id],ai:Boolean(p.ai)}:null}return{roomCode:this.room.code,you:forId,players,game:this.room.game,ready:this.isReady(),aiCount:this.room.aiCount||0,aiDifficulty:AI_DIFFICULTY,humanCount:this.humanSeatIds().length,rematchVotes:this.room.rematchVotes,turnDeadline:this.room.turnDeadline,turnDurationMs:TURN_MS,serverNow:Date.now(),timerRevision:this.room.timerRevision||0}}
  send(ws,p){try{ws.send(JSON.stringify(p))}catch{}}
  broadcastState(extra={}){for(const ws of this.state.getWebSockets()){const a=ws.deserializeAttachment();this.send(ws,{type:'state',...this.publicSnapshot(a?.playerId||null),...extra})}}
  async persist(){await this.state.storage.put('room',this.room)}
  async clearAlarm(){this.room.turnDeadline=null;await this.state.storage.deleteAlarm();await this.persist()}
  async ensureTurnTimer(reset=false){
    if(!this.room||this.room.game.winner||!this.isReady()){await this.clearAlarm();return}
    const now=Date.now(),delay=this.currentTurnIsAi()?AI_DELAY_MS:TURN_MS,target=now+delay;
    if(reset||!this.room.turnDeadline||this.room.turnDeadline<=now||this.currentTurnIsAi()){
      this.room.turnDeadline=this.currentTurnIsAi()?null:target;this.room.timerRevision=(this.room.timerRevision||0)+1;await this.state.storage.setAlarm(target);await this.persist()
    }
  }
  async performAiTurn(){
    if(!this.room||this.room.game.winner||!this.isReady()||!this.currentTurnIsAi()){await this.ensureTurnTimer(false);return}
    const pid=this.currentPlayerId();let action=null;try{action=chooseAiAction(this.room.game,pid,AI_DIFFICULTY)}catch{}
    if(action){const r=applyAction(this.room.game,pid,action);this.room.game=r.ok?r.state:skipCurrentTurn(this.room.game)}else this.room.game=skipCurrentTurn(this.room.game);
    this.room.rematchVotes=[];await this.persist();await this.ensureTurnTimer(true);this.broadcastState({aiActionPlayer:pid})
  }
  async webSocketMessage(ws,message){
    let d;try{d=JSON.parse(typeof message==='string'?message:new TextDecoder().decode(message))}catch{return this.send(ws,{type:'error',error:'Invalid message.'})}
    const a=ws.deserializeAttachment(),pid=a?.playerId;if(!pid||this.room.players[pid]?.token!==a.token||this.isAiSeat(pid))return this.send(ws,{type:'error',error:'Invalid player session.'});
    if(d.type==='ping')return this.send(ws,{type:'pong',nonce:d.nonce||null,serverNow:Date.now()});
    if(d.type==='action'){
      if(!this.isReady())return this.send(ws,{type:'error',error:'Waiting for all human players to be connected.'});if(this.currentTurnIsAi())return this.send(ws,{type:'error',error:'The AI is taking its turn.'});
      if(this.room.turnDeadline&&Date.now()>=this.room.turnDeadline){await this.handleTurnTimeout();return this.send(ws,{type:'error',error:'Your turn already expired.'})}
      const r=applyAction(this.room.game,pid,d.action);if(!r.ok)return this.send(ws,{type:'error',error:r.error});this.room.game=r.state;this.room.rematchVotes=[];
      if(this.room.game.winner)await this.clearAlarm();else{await this.persist();await this.ensureTurnTimer(true)}this.broadcastState();return
    }
    if(d.type==='rematch'){
      if(!this.room.game.winner)return this.send(ws,{type:'error',error:'The game is not finished.'});if(!this.room.rematchVotes.includes(pid))this.room.rematchVotes.push(pid);
      if(this.humanSeatIds().every(id=>this.room.rematchVotes.includes(id))){this.room.game=createInitialState({playerCount:this.room.game.playerCount,mode:this.room.game.mode});this.room.rematchVotes=[];await this.persist();await this.ensureTurnTimer(true)}else await this.persist();this.broadcastState();return
    }
    if(d.type==='sync')return this.send(ws,{type:'state',...this.publicSnapshot(pid)});this.send(ws,{type:'error',error:'Unknown message type.'})
  }
  async handleTurnTimeout(){
    if(!this.room||this.room.game.winner||!this.isReady()){await this.ensureTurnTimer(false);return}
    if(this.currentTurnIsAi()){await this.performAiTurn();return}
    if(!this.room.turnDeadline||Date.now()<this.room.turnDeadline)return;
    const skipped=this.currentPlayerId();this.room.game=skipCurrentTurn(this.room.game);await this.persist();await this.ensureTurnTimer(true);this.broadcastState({timeoutPlayer:skipped})
  }
  async alarm(){if(this.currentTurnIsAi())await this.performAiTurn();else await this.handleTurnTimeout()}
  async webSocketClose(ws){const a=ws.deserializeAttachment(),pid=a?.playerId,token=a?.token;let replacement=false;for(const other of this.state.getWebSockets()){if(other===ws)continue;const oa=other.deserializeAttachment();if(oa?.playerId===pid&&oa?.token===token){replacement=true;break}}if(!replacement&&pid&&!this.isAiSeat(pid)&&this.room?.players[pid]?.token===token){this.room.players[pid].disconnectedAt=Date.now();await this.clearAlarm()}this.broadcastState()}
  async webSocketError(ws){await this.webSocketClose(ws)}
}
