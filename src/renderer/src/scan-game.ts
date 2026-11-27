export const gameModes=['runner','frisbee','pond'] as const
export type GameMode=typeof gameModes[number]
export type GamePhase='ready'|'running'|'paused'|'over'
export const GAME_WIDTH=800,GROUND=244,PLAYER_X=160
export interface GameObject {id:number;x:number;width:number;height:number;y:number;kind:'log'|'disc'|'gap';resolved:boolean}
export interface GameState {
  mode:GameMode;phase:GamePhase;time:number;distance:number;y:number;velocity:number
  score:number;caught:number;missed:number;objects:GameObject[];spawnIn:number;seed:number;nextId:number;flash:number
}
export function createGame(mode:GameMode,seed=20261127):GameState {
  return {mode,phase:'ready',time:0,distance:0,y:0,velocity:0,score:0,caught:0,missed:0,objects:[],spawnIn:.65,seed:seed>>>0,nextId:0,flash:0}
}
/** One press starts, jumps, resumes or retries. Holding Space never queues a jump. */
export function gameAction(state:GameState):GameState {
  if(state.phase==='paused')return {...state,phase:'running'}
  if(state.phase==='ready'||state.phase==='over')return {...createGame(state.mode,state.seed),phase:'running'}
  return state.y===0?{...state,velocity:-610}:state
}
export function pauseGame(state:GameState):GameState {return state.phase==='running'?{...state,phase:'paused'}:state}
export function gameSpeed(state:GameState):number {return 220+Math.min(65,state.time*1.8)}
function random(state:GameState):number {state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296}
function tick(previous:GameState,dt:number):GameState {
  const state={...previous,objects:previous.objects.map(object=>({...object}))},speed=gameSpeed(state)
  state.time+=dt;state.distance+=speed*dt;state.flash=Math.max(0,state.flash-dt)
  if(state.y<0||state.velocity<0){state.y+=state.velocity*dt+725*dt*dt;state.velocity+=1450*dt;if(state.y>=0){state.y=0;state.velocity=0}}
  state.spawnIn-=dt
  if(state.spawnIn<=0){
    const width=state.mode==='pond'?86+random(state)*36:state.mode==='runner'?28+random(state)*16:38
    const height=state.mode==='runner'?27+random(state)*16:0
    state.objects.push({id:state.nextId++,kind:state.mode==='pond'?'gap':state.mode==='frisbee'?'disc':'log',x:GAME_WIDTH+45,width,height,y:125+random(state)*20,resolved:false})
    state.spawnIn=state.mode==='pond'?(width+245+random(state)*140)/speed:state.mode==='frisbee'?1.75+random(state)*.65:1.4+random(state)*.55
  }
  for(const object of state.objects){
    object.x-=speed*dt
    if(object.resolved)continue
    if(object.kind==='log'&&object.x<PLAYER_X+17&&object.x+object.width>PLAYER_X-17&&state.y>-object.height+5){state.phase='over';break}
    if(object.kind==='gap'&&object.x+8<PLAYER_X&&object.x+object.width-8>PLAYER_X&&state.y>=-3&&state.velocity>=0){state.phase='over';break}
    if(object.kind==='disc'){
      if(Math.abs(object.x-(PLAYER_X+25))<32&&Math.abs(object.y-(GROUND+state.y-58))<29){object.resolved=true;state.caught++;state.flash=.3}
      else if(object.x<PLAYER_X-22){object.resolved=true;state.missed++;if(state.missed>=3){state.phase='over';break}}
    }
  }
  state.objects=state.objects.filter(object=>object.x+object.width>-30)
  state.score=state.mode==='frisbee'?state.caught*10:Math.floor(state.distance/12)
  return state
}
/** Small physics steps prevent collision tunnelling; long frame stalls do not fast-forward a round. */
export function advanceGame(state:GameState,seconds:number):GameState {
  if(state.phase!=='running'||!Number.isFinite(seconds)||seconds<=0)return state
  let remaining=Math.min(seconds,.1),next=state
  while(remaining>1e-8&&next.phase==='running'){const step=Math.min(remaining,1/120);next=tick(next,step);remaining-=step}
  return next
}
