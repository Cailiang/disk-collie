import {describe,expect,it} from 'vitest'
import {advanceGame,createGame,gameAction,gameModes,pauseGame,PLAYER_X,type GameMode,type GameState} from './scan-game'
const run=(state:GameState,seconds:number,play?:(state:GameState)=>boolean):GameState=>{
  for(let frame=0;frame<seconds*120&&state.phase==='running';frame++){if(play?.(state))state=gameAction(state);state=advanceGame(state,1/120)}
  return state
}
describe('one-button scan games',()=>{
  it('waits for opt-in, supports one jump per landing, pause/resume and a fresh retry',()=>{
    let state=createGame('runner')
    expect(advanceGame(state,1)).toBe(state)
    state=gameAction(state);expect(state.phase).toBe('running')
    state=advanceGame(gameAction(state),.05);expect(state.y).toBeLessThan(0)
    expect(gameAction(state)).toBe(state)
    const paused=pauseGame(state);expect(advanceGame(paused,.1)).toBe(paused)
    expect(gameAction(paused)).toEqual({...state,phase:'running'})
    const retry=gameAction({...state,phase:'over',score:40});expect(retry.phase).toBe('running');expect(retry.score).toBe(0);expect(retry.objects).toEqual([])
  })
  it('ends unplayed rounds on an obstacle, three misses or water',()=>{
    for(const mode of gameModes){const state=run(gameAction(createGame(mode)),25);expect(state.phase,mode).toBe('over');if(mode==='frisbee')expect(state.missed).toBe(3)}
  })
  it('lets timed Space presses clear obstacles and cross every generated pond gap',()=>{
    for(const mode of ['runner','pond'] as GameMode[]){
      const trigger=mode==='runner'?92:37
      const state=run(gameAction(createGame(mode)),35,current=>current.y===0&&current.objects.some(object=>!object.resolved&&object.x>PLAYER_X&&object.x<PLAYER_X+trigger))
      expect(state.phase,mode).toBe('running');expect(state.score).toBeGreaterThan(600)
      if(mode==='pond')expect(state.objects.every(object=>object.width<=122)).toBe(true)
    }
  })
  it('requires a real jump to catch airborne discs, scores catches and allows misses',()=>{
    const state=run(gameAction(createGame('frisbee')),25,current=>current.y===0&&current.objects.some(object=>!object.resolved&&object.x>PLAYER_X&&object.x<PLAYER_X+78))
    expect(state.phase).toBe('running');expect(state.caught).toBeGreaterThan(5);expect(state.score).toBe(state.caught*10);expect(state.missed).toBe(0)
    const grounded=run(gameAction(createGame('frisbee')),5);expect(grounded.caught).toBe(0);expect(grounded.missed).toBeGreaterThan(0)
  })
  it('keeps 30 and 60 fps movement consistent and ignores invalid frame intervals',()=>{
    const start=gameAction(createGame('runner'))
    const simulate=(fps:number):GameState=>{let state=start;for(let index=0;index<fps*2;index++)state=advanceGame(state,1/fps);return state}
    const slow=simulate(30),fast=simulate(60)
    expect(slow.distance).toBeCloseTo(fast.distance,0);expect(slow.objects[0].x).toBeCloseTo(fast.objects[0].x,0)
    expect(advanceGame(start,NaN)).toBe(start);expect(advanceGame(start,-1)).toBe(start)
    expect(advanceGame(start,10).time).toBeCloseTo(.1)
  })
})
