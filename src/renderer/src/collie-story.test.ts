import {describe,expect,it} from 'vitest'
import {COLLIE_STORY_DURATION,collieActivities,nextCollieActivity,sampleCollieStory,type MascotActivity} from './collie-story'
describe('continuous collie stories',()=>{
  it('gives each game a twenty-second story with distinct narrative phases',()=>{
    expect(COLLIE_STORY_DURATION).toBe(20000)
    for(const activity of collieActivities){
      const samples=Array.from({length:21},(_,second)=>sampleCollieStory(activity,second*1000))
      expect(new Set(samples.map(pose=>pose.phase)).size).toBeGreaterThanOrEqual(8)
      expect(samples[20].phase).not.toBe(samples[0].phase)
      expect(samples.some(pose=>pose.x!==samples[0].x&&pose.head!==samples[0].head)).toBe(true)
    }
  })
  it('includes the ball overshoot, frisbee catch, rope slip and second basketball shot',()=>{
    expect(sampleCollieStory('ball',12500).phase).toBe('skid')
    expect(sampleCollieStory('frisbee',12000).phase).toBe('catch')
    expect(sampleCollieStory('tug',14000).phase).toBe('rope-slips')
    expect(sampleCollieStory('basketball',15000).phase).toBe('second-chance')
    expect(sampleCollieStory('basketball',18000).phase).toBe('basket')
  })
  it('interpolates continuously through cue boundaries and keeps drawing coordinates bounded',()=>{
    let maxJump=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,finite=true
    for(const activity of collieActivities)for(let time=20;time<=20000;time+=20){
      const current=sampleCollieStory(activity,time),previous=sampleCollieStory(activity,time-1)
      maxJump=Math.max(maxJump,Math.abs(current.x-previous.x),Math.abs(current.y-previous.y))
      minX=Math.min(minX,current.x);maxX=Math.max(maxX,current.x);minY=Math.min(minY,current.y);maxY=Math.max(maxY,current.y)
      finite=finite&&Object.values(current).every(value=>typeof value!=='number'||Number.isFinite(value))
    }
    expect(maxJump).toBeLessThan(1);expect(minX).toBeGreaterThan(150);expect(maxX).toBeLessThan(610)
    expect(minY).toBeGreaterThan(100);expect(maxY).toBeLessThanOrEqual(246);expect(finite).toBe(true)
  })
  it('moves to a different story at each ending and visits all four before repeating',()=>{
    let activity:MascotActivity=collieActivities[0];const visited=[]
    for(let index=0;index<4;index++){visited.push(activity);const next=nextCollieActivity(activity);expect(next).not.toBe(activity);activity=next}
    expect(new Set(visited)).toEqual(new Set(collieActivities));expect(activity).toBe(collieActivities[0])
  })
  it('clamps invalid and out-of-range times instead of restarting a finished story',()=>{
    expect(sampleCollieStory('ball',-500)).toEqual(sampleCollieStory('ball',0))
    expect(sampleCollieStory('ball',NaN)).toEqual(sampleCollieStory('ball',0))
    expect(sampleCollieStory('ball',25000)).toEqual(sampleCollieStory('ball',20000))
  })
})
