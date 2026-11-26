import {describe,it,expect} from 'vitest'
import {activityTimeline} from './storage-activity'
import type {StorageActivity} from '../../shared/storage-types'
const record=(date:Date,kind:StorageActivity['kind'],bytes:number,items=1,failures=0):StorageActivity=>({id:crypto.randomUUID(),date:date.toISOString(),kind,bytes,items,failures,locations:[]})
describe('cleanup activity timeline',()=>{
  it('includes earlier lifetime value, all cleanup kinds and partial successes exactly once',()=>{
    const now=new Date(2026,10,26,18)
    const days=activityTimeline([
      record(new Date(2026,9,1),'cleanup',100),
      record(new Date(2026,10,25,23,59),'large',200),
      record(new Date(2026,10,26,0,1),'duplicates',300,1,2),
      record(new Date(2026,10,26,12),'privacy',40),
      record(new Date(2026,10,26,13),'uninstall',50),
      record(new Date(2026,10,26,14),'large',0,0,2),
      record(new Date(2026,10,27),'cleanup',999)
    ],now)
    expect(days).toHaveLength(14)
    expect(days[0].cumulative).toBe(100)
    expect(days.at(-2)).toMatchObject({bytes:200,tasks:1,cumulative:300})
    expect(days.at(-1)).toMatchObject({bytes:390,tasks:3,cumulative:690})
    expect(days.slice(0,-2).every((day)=>day.bytes===0&&day.tasks===0)).toBe(true)
  })
  it('uses local calendar boundaries and shows zero rather than invented activity',()=>{
    const now=new Date(2026,2,12,12)
    const days=activityTimeline([],now)
    expect(days.every((day)=>day.bytes===0&&day.cumulative===0)).toBe(true)
    expect(new Set(days.map((day)=>day.key)).size).toBe(14)
    expect(days.at(-1)!.date.getHours()).toBe(0)
    const midnight=new Date(now);midnight.setHours(0,0,0,0)
    const previous=new Date(midnight.getTime()-1)
    const timeline=activityTimeline([record(previous,'large',10),record(midnight,'cleanup',20)],now)
    expect(timeline.at(-2)!.bytes).toBe(10)
    expect(timeline.at(-1)!.bytes).toBe(20)
  })
})
