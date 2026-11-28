import {describe,expect,it} from 'vitest'
import {advanceGame,createGame,gameAction,gameEnvironment,gameModes,gameSpeed,GROUND,pauseGame,PLAYER_X,resizeGame,resolveGameEnvironment,runnerVariants,type GameState} from './scan-game'

// A player reacts to the visible geometry. No invincibility or state edits are used.
function shouldJump(state:GameState):boolean {
  if(state.y!==0)return false
  const speed=gameSpeed(state),objects=state.objects
  if(state.mode==='runner'){
    const next=objects.find(object=>object.kind==='obstacle'&&object.altitude<100&&object.x+object.width>PLAYER_X-17)
    return Boolean(next&&next.x-PLAYER_X<=speed*.421-next.width/2)
  }
  if(state.mode==='pond'){
    const gaps=objects.filter(object=>object.kind==='gap'&&object.x+object.width>PLAYER_X-8)
    if(!gaps.length)return false
    const start=gaps[0].x;let end=start+gaps[0].width
    for(const gap of gaps.slice(1)){if(gap.x-end>85)break;end=gap.x+gap.width}
    return start-PLAYER_X<=speed*.421-(end-start)/2
  }
  const next=objects.find(object=>object.kind==='disc'&&!object.resolved&&object.x>PLAYER_X-20)
  if(!next)return false
  const arrival=Math.max(0,(next.x-PLAYER_X-25)/speed)
  const futureY=next.baseY+Math.sin((state.time+arrival-next.born)*2.6)*next.motion
  const height=GROUND-58-futureY
  if(height<24)return false
  const ascent=(610-Math.sqrt(Math.max(0,610**2-2900*height)))/1450
  return next.x-PLAYER_X<=25+speed*ascent
}
function play(state:GameState,seconds:number,auto=false,onFrame?:(state:GameState)=>void):GameState {
  for(let frame=0;frame<seconds*120&&state.phase==='running';frame++){
    if(auto&&shouldJump(state))state=gameAction(state)
    state=advanceGame(state,1/120);onFrame?.(state)
  }
  return state
}
describe('varied one-button scan games',()=>{
  it('waits for input, allows one jump per landing, pauses and retries cleanly',()=>{
    let state=createGame('runner',1)
    expect(advanceGame(state,1)).toBe(state)
    state=advanceGame(gameAction(gameAction(state)),.05);expect(state.y).toBeLessThan(0);expect(gameAction(state)).toBe(state)
    const paused=pauseGame(state);expect(advanceGame(paused,.1)).toBe(paused);expect(gameAction(paused)).toEqual({...state,phase:'running'})
    const retry=gameAction({...state,phase:'over',score:40});expect(retry.phase).toBe('running');expect(retry.score).toBe(0);expect(retry.objects).toEqual([])
  })
  it('ends unplayed runner and pond rounds on obstacles or water',()=>{
    for(const mode of ['runner','pond'] as const){const state=play(gameAction(createGame(mode,1)),35);expect(state.phase,mode).toBe('over')}
  })
  it('keeps frisbee running beyond 30 seconds despite repeated misses and resumes scoring',()=>{
    let state=play({...gameAction(createGame('frisbee',42)),points:50,combo:4},65)
    expect(state.phase).toBe('running');expect(state.time).toBeCloseTo(65,1)
    expect(state.missed).toBeGreaterThan(3);expect(state.combo).toBe(0);expect(state.score).toBeGreaterThanOrEqual(50)
    const caught=state.caught
    state=play(state,55,true)
    expect(state.phase).toBe('running');expect(state.time).toBeCloseTo(120,1)
    expect(state.caught).toBeGreaterThan(caught);expect(state.score).toBeGreaterThan(50)
  })
  it('keeps two-minute rounds playable across seeds while introducing every pattern and scene',()=>{
    for(const mode of gameModes)for(const seed of [1,7,42,905,6001,20261127]){
      const seen=new Set<string>(),places=new Set<string>(),lights=new Set<string>();let maxCombo=0
      const state=play(gameAction(createGame(mode,seed)),120,true,frame=>{
        for(const object of frame.objects)if(object.kind!=='bone')seen.add(object.variant)
        const environment=gameEnvironment(frame.distance);places.add(environment.region);lights.add(environment.light);maxCombo=Math.max(maxCombo,frame.combo)
      })
      expect(state.phase,`${mode}, seed ${seed}, ${state.time.toFixed(2)}s, ${state.objects.map(object=>`${object.variant}:${object.x.toFixed(0)}`).join(',')}`).toBe('running')
      expect(state.time).toBeCloseTo(120,1);expect(places.size).toBe(4);expect(lights.size).toBe(4)
      expect(seen.size,mode).toBe(mode==='runner'?10:5)
      if(mode==='frisbee'){expect(state.caught).toBeGreaterThan(50);expect(maxCombo).toBeGreaterThan(5);expect(state.score).toBeGreaterThan(state.caught*10)}
      else expect(state.score).toBeGreaterThan(2000)
    }
  })
  it('changes early obstacles, avoids immediate repetition and reserves fair landing gaps',()=>{
    const groups=new Map<number,{variant:string;start:number;end:number;speed:number}>()
    play(gameAction(createGame('runner',7)),60,true,frame=>{
      for(const object of frame.objects)if(object.kind==='obstacle'&&!groups.has(object.group))groups.set(object.group,{variant:object.variant,start:frame.distance+object.x,end:frame.distance+object.x+object.width,speed:gameSpeed(frame)})
    })
    const ordered=[...groups.values()]
    expect(new Set(ordered.slice(0,4).map(group=>group.variant)).size).toBeGreaterThanOrEqual(3)
    expect(ordered.every((group,index)=>index===0||group.variant!==ordered[index-1].variant)).toBe(true)
    expect(ordered.every((group,index)=>index===0||group.start-ordered[index-1].end>190)).toBe(true)
    for(const variant of runnerVariants(10000))expect(ordered.some(group=>group.variant===variant)).toBe(true)
  })
  it('lets high birds pass overhead, but collides if the dog jumps into them',()=>{
    const running=gameAction(createGame('runner'))
    const bird={id:1,group:1,kind:'obstacle' as const,variant:'bird-high' as const,x:PLAYER_X+5,width:48,height:20,altitude:112,y:0,baseY:0,motion:0,value:0,last:true,resolved:false,collected:false,born:0}
    expect(advanceGame({...running,spawnIn:100,objects:[bird]},.05).phase).toBe('running')
    expect(advanceGame({...running,spawnIn:100,objects:[bird],y:-85},.01).phase).toBe('over')
  })
  it('awards optional treats and counts a paired frisbee formation as one missed chance',()=>{
    let state=gameAction(createGame('frisbee',1))
    const disc={id:1,group:1,kind:'disc' as const,variant:'pair' as const,x:PLAYER_X-24,width:38,height:14,altitude:0,y:80,baseY:80,motion:0,value:10,last:false,resolved:false,collected:false,born:0}
    state=advanceGame({...state,spawnIn:100,objects:[disc,{...disc,id:2,last:true,x:PLAYER_X+40}]},.01);expect(state.missed).toBe(0)
    state=play(state,.4);expect(state.missed).toBe(1)
    const collected=advanceGame({...gameAction(createGame('runner')),spawnIn:100,objects:[{...disc,kind:'bone',variant:'bone',x:PLAYER_X+25,y:GROUND-58,value:5}]},.01)
    expect(collected.treats).toBe(1);expect(collected.points).toBe(5)
  })
  it('blends four landscapes and a day/night cycle while decorative motion can stay frozen',()=>{
    const day=gameEnvironment(0),dusk=gameEnvironment(4000),night=gameEnvironment(6500),dawn=gameEnvironment(10000)
    expect([day.light,dusk.light,night.light,dawn.light]).toEqual(['day','dusk','night','dawn']);expect(night.night).toBeGreaterThan(.9)
    expect(gameEnvironment(1800).blend).toBeGreaterThan(.5);expect(gameEnvironment(1900).region).toBe('forest')
    expect(gameEnvironment(50000).level).toBe(6)
  })
  it('keeps 30 and 60 fps physics consistent and clamps stalled or invalid intervals',()=>{
    const start=gameAction(createGame('runner',42))
    const simulate=(fps:number):GameState=>{let state=start;for(let index=0;index<fps*2;index++)state=advanceGame(state,1/fps);return state}
    const slow=simulate(30),fast=simulate(60)
    expect(slow.distance).toBeCloseTo(fast.distance,0);expect(slow.objects[0].x).toBeCloseTo(fast.objects[0].x,0)
    expect(advanceGame(start,NaN)).toBe(start);expect(advanceGame(start,-1)).toBe(start);expect(advanceGame(start,10).time).toBeCloseTo(.1)
  })
  it('applies manual scenery/light choices immediately while keeping automatic progression available',()=>{
    for(const region of ['meadow','forest','river','village'] as const){
      const chosen=resolveGameEnvironment(6500,region,'day')
      expect(chosen.region).toBe(region);expect(chosen.next).toBe(region);expect(chosen.blend).toBe(0)
      expect(chosen.light).toBe('day');expect(chosen.night).toBe(0);expect(chosen.level).toBe(gameEnvironment(6500).level)
    }
    expect(resolveGameEnvironment(0,'auto','night').night).toBe(1)
    expect(resolveGameEnvironment(6500)).toEqual(gameEnvironment(6500))
  })
  it('preserves an active round on resize and keeps future groups playable after repeated size changes',()=>{
    for(const mode of gameModes){
      let state=gameAction(createGame(mode,42)),size=0
      for(let frame=0;frame<90*120&&state.phase==='running';frame++){
        if(frame>0&&frame%(8*120)===0){
          const before=state;state=resizeGame(state,[480,1300,650,900][size++%4])
          expect(state.phase).toBe('paused');expect(state.objects).toBe(before.objects)
          expect(state.score).toBe(before.score);expect(state.time).toBe(before.time);expect(state.distance).toBe(before.distance)
          state=gameAction(state)
        }
        if(shouldJump(state))state=gameAction(state)
        state=advanceGame(state,1/120)
      }
      expect(state.phase,`${mode} at ${state.time}s after resize`).toBe('running');expect(state.time).toBeCloseTo(90,1)
      expect(gameAction({...state,phase:'over'}).viewportWidth).toBe(state.viewportWidth)
    }
  })
})
