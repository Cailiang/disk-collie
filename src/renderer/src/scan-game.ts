export const gameModes=['runner','frisbee','pond'] as const
export type GameMode=typeof gameModes[number]
export type GamePhase='ready'|'running'|'paused'|'over'
export const GAME_WIDTH=800,GROUND=244,PLAYER_X=160
export const regions=['meadow','forest','river','village'] as const
export type GameRegion=typeof regions[number]
export const gameLights=['day','dusk','night','dawn'] as const
export type GameLight=typeof gameLights[number]
export type ObstacleVariant='stump'|'rocks'|'cones'|'hedge'|'hurdle'|'double-log'|'triple-log'|'ball'|'bird-low'|'bird-high'
export type DiscVariant='flat'|'loft'|'skim'|'wave'|'pair'
export type GapVariant='stream'|'wide'|'stones'|'islands'|'bridge'
export interface GameObject {
  id:number;group:number;x:number;width:number;height:number;y:number;baseY:number;altitude:number
  kind:'obstacle'|'disc'|'gap'|'bone';variant:ObstacleVariant|DiscVariant|GapVariant|'bone'
  resolved:boolean;collected:boolean;last:boolean;value:number;motion:number;born:number
}
export interface GameState {
  mode:GameMode;phase:GamePhase;time:number;distance:number;y:number;velocity:number;viewportWidth:number
  score:number;points:number;caught:number;missed:number;combo:number;treats:number
  objects:GameObject[];spawnIn:number;seed:number;nextId:number;nextGroup:number;flash:number;lastReward:number;recent:string[];bag:string[];pool:string
}
export interface GameEnvironment {region:GameRegion;next:GameRegion;blend:number;night:number;light:GameLight;level:number}
const clamp=(value:number,min=0,max=1):number=>Math.max(min,Math.min(max,value))
const smooth=(value:number):number=>{const x=clamp(value);return x*x*(3-2*x)}
export function gameEnvironment(distance:number):GameEnvironment {
  const route=Math.max(0,distance),section=route/1900,index=Math.floor(section)%regions.length
  const cycle=(route%11800)/11800
  const night=smooth((cycle-.29)/.16)*(1-smooth((cycle-.75)/.20))
  return {region:regions[index],next:regions[(index+1)%regions.length],blend:smooth((section%1-.82)/.18),night,light:cycle<.29?'day':cycle<.45?'dusk':cycle<.75?'night':'dawn',level:Math.min(6,1+Math.floor(route/1800))}
}
export function resolveGameEnvironment(distance:number,region:GameRegion|'auto'='auto',light:GameLight|'auto'='auto'):GameEnvironment {
  const environment=gameEnvironment(distance)
  if(region!=='auto'){environment.region=region;environment.next=region;environment.blend=0}
  if(light!=='auto'){environment.light=light;environment.night={day:0,dusk:.48,night:1,dawn:.23}[light]}
  return environment
}
export function createGame(mode:GameMode,seed=20261127,viewportWidth=GAME_WIDTH):GameState {
  return {mode,phase:'ready',time:0,distance:0,y:0,velocity:0,viewportWidth:Math.max(480,viewportWidth),score:0,points:0,caught:0,missed:0,combo:0,treats:0,objects:[],spawnIn:.35,seed:seed>>>0,nextId:0,nextGroup:0,flash:0,lastReward:0,recent:[],bag:[],pool:''}
}
/** A single press starts, jumps, resumes or retries. Holding Space never queues a jump. */
export function gameAction(state:GameState):GameState {
  if(state.phase==='paused')return {...state,phase:'running'}
  if(state.phase==='ready'||state.phase==='over')return {...createGame(state.mode,state.seed,state.viewportWidth),phase:'running'}
  return state.y===0?{...state,velocity:-610}:state
}
export function pauseGame(state:GameState):GameState {return state.phase==='running'?{...state,phase:'paused'}:state}
/** Resizing changes the camera and future spawn boundary, retaining the current round. */
export function resizeGame(state:GameState,width:number):GameState {
  if(!Number.isFinite(width))return state
  const viewportWidth=Math.max(480,width)
  return Math.abs(viewportWidth-state.viewportWidth)<.5?state:{...pauseGame(state),viewportWidth}
}
export function gameSpeed(state:GameState):number {return 220+Math.min(110,state.time*1.65)}
function random(state:GameState):number {state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296}
function choose<T extends string>(state:GameState,pool:T[]):T {
  const signature=pool.join('|')
  if(state.pool!==signature||!state.bag.length){state.bag=[...pool];state.pool=signature}
  const options=state.bag.filter(value=>!state.recent.includes(value)),available=options.length?options:state.bag
  const selected=available[Math.floor(random(state)*available.length)] as T
  state.bag=state.bag.filter(value=>value!==selected);state.recent=[...state.recent,selected].slice(-2)
  return selected
}
export function runnerVariants(distance:number):ObstacleVariant[] {
  return ['stump','rocks','cones',...(distance>950?['hedge','hurdle','double-log','ball'] as const:[]),...(distance>2800?['bird-low'] as const:[]),...(distance>4500?['bird-high'] as const:[]),...(distance>9000?['triple-log'] as const:[])]
}
function addObject(state:GameState,group:number,kind:GameObject['kind'],variant:GameObject['variant'],x:number,width:number,height=0,y=0,altitude=0,motion=0,value=0,last=true):void {
  state.objects.push({id:state.nextId++,group,kind,variant,x,width,height,y,baseY:y,altitude,motion,value,last,resolved:false,collected:false,born:state.time})
}
/** Each group reserves its complete span plus a landing/reaction interval. */
function spawnGroup(state:GameState):void {
  const group=state.nextGroup++,speed=gameSpeed(state),level=gameEnvironment(state.distance).level
  // Shrinking the camera must never spawn a new group on top of an existing one.
  const rightmost=Math.max(0,...state.objects.filter(object=>object.kind!=='bone').map(object=>object.x+object.width))
  const x=Math.max(state.viewportWidth+45,rightmost+speed*.96)
  let span=0,recovery=.95+random(state)*.5
  if(state.mode==='runner'){
    const variant=choose(state,runnerVariants(state.distance))
    const shapes:Record<ObstacleVariant,[number,number,number]>={stump:[32,32,0],rocks:[62,25,0],cones:[76,29,0],hedge:[43,48,0],hurdle:[26,59,0],'double-log':[87,33,0],'triple-log':[116,31,0],ball:[35,35,0],'bird-low':[46,21,22],'bird-high':[48,20,112]}
    const [width,height,altitude]=shapes[variant];span=width
    addObject(state,group,'obstacle',variant,x,width,height,0,altitude)
    if(variant==='bird-high')recovery=1.3+random(state)*.3
    else if(group%2===1||random(state)>.6)addObject(state,group,'bone','bone',x+width*.5,20,18,GROUND-103,0,0,5)
  }else if(state.mode==='frisbee'){
    const variant=choose<DiscVariant>(state,level===1?['flat','skim','loft']:['flat','skim','loft','wave','pair'])
    const heights={flat:139,skim:190,loft:104,wave:137,pair:130},y=heights[variant]
    addObject(state,group,'disc',variant,x,38,14,y,0,variant==='wave'?19:variant==='loft'?7:0,variant==='loft'?15:10,variant!=='pair')
    if(variant==='pair'){span=64;addObject(state,group,'disc',variant,x+64,38,14,y-43,0,0,10)}else span=38
    recovery=1.05+random(state)*.55
  }else{
    const variant=choose<GapVariant>(state,level===1?['stream','stones','bridge']:['stream','wide','stones','islands','bridge'])
    if(variant==='stones'){
      addObject(state,group,'gap',variant,x,48)
      addObject(state,group,'gap',variant,x+87,48);span=135
    }else if(variant==='islands'){
      const land=speed*.86+65
      addObject(state,group,'gap',variant,x,69)
      addObject(state,group,'gap',variant,x+69+land,82);span=151+land
    }else{
      const width=variant==='wide'?127+random(state)*18:variant==='bridge'?99+random(state)*12:78+random(state)*21
      addObject(state,group,'gap',variant,x,width);span=width
    }
    addObject(state,group,'bone','bone',x+30,20,18,GROUND-112,0,0,5)
    recovery=.95+random(state)*.5
  }
  state.spawnIn=span/speed+recovery
}
function tick(previous:GameState,dt:number):GameState {
  const state={...previous,objects:previous.objects.map(object=>({...object}))},speed=gameSpeed(state)
  state.time+=dt;state.distance+=speed*dt;state.flash=Math.max(0,state.flash-dt)
  if(state.y<0||state.velocity<0){state.y+=state.velocity*dt+725*dt*dt;state.velocity+=1450*dt;if(state.y>=0){state.y=0;state.velocity=0}}
  state.spawnIn-=dt
  if(state.spawnIn<=0)spawnGroup(state)
  for(const object of state.objects){
    object.x-=speed*dt
    if(object.motion)object.y=object.baseY+Math.sin((state.time-object.born)*2.6)*object.motion
    if(object.resolved)continue
    if(object.kind==='obstacle'){
      const bottom=GROUND-object.altitude,top=bottom-object.height
      const overlap=object.x<PLAYER_X+17&&object.x+object.width>PLAYER_X-17
      if(overlap&&GROUND+state.y-5>top+2&&GROUND+state.y-60<bottom-2){state.phase='over';break}
    }
    if(object.kind==='gap'&&object.x+8<PLAYER_X&&object.x+object.width-8>PLAYER_X&&state.y>=-3&&state.velocity>=0){state.phase='over';break}
    if(object.kind==='disc'||object.kind==='bone'){
      if(Math.abs(object.x-(PLAYER_X+25))<30&&Math.abs(object.y-(GROUND+state.y-58))<28){
        object.resolved=true;object.collected=true;state.flash=.3
        if(object.kind==='disc'){state.caught++;state.combo++;state.lastReward=object.value+(state.combo>=3?Math.min(10,state.combo-1)*2:0);state.points+=state.lastReward}
        else{state.treats++;state.lastReward=object.value;state.points+=object.value}
      }else if(object.x<PLAYER_X-22){
        object.resolved=true
        if(object.kind==='disc'&&object.last&&!state.objects.some(item=>item.group===object.group&&item.collected)){state.missed++;state.combo=0;if(state.missed>=3){state.phase='over';break}}
      }
    }
  }
  state.objects=state.objects.filter(object=>object.x+object.width>-40)
  state.score=(state.mode==='frisbee'?0:Math.floor(state.distance/12))+state.points
  return state
}
/** Small physics steps prevent tunnelling; long frame stalls do not fast-forward a round. */
export function advanceGame(state:GameState,seconds:number):GameState {
  if(state.phase!=='running'||!Number.isFinite(seconds)||seconds<=0)return state
  let remaining=Math.min(seconds,.1),next=state
  while(remaining>1e-8&&next.phase==='running'){const step=Math.min(remaining,1/120);next=tick(next,step);remaining-=step}
  return next
}
