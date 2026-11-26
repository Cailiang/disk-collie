import {describe,expect,it} from 'vitest'
import {StorageTaskQueue} from './storage-task-queue'
function deferred(){let resolve!:()=>void;const promise=new Promise<void>((done)=>{resolve=done});return {promise,resolve}}
describe('storage task scheduling',()=>{
  it('queues privacy behind a file scan and recovers from a failed task',async()=>{
    const gate=deferred(),order:string[]=[],events:unknown[]=[]
    const queue=new StorageTaskQueue((...event)=>events.push(event))
    const scan=queue.run('large',async()=>{order.push('scan-start');await gate.promise;order.push('scan-end')})
    const privacy=queue.run('privacy',async()=>{order.push('privacy');return 7})
    await Promise.resolve();expect(order).toEqual(['scan-start']);expect(events).toContainEqual(['privacy',true,'large'])
    gate.resolve();await scan;expect(await privacy).toBe(7);expect(order).toEqual(['scan-start','scan-end','privacy'])
    await expect(queue.run('cleanup',async()=>{throw new Error('fixture failure')})).rejects.toThrow('fixture failure')
    expect(await queue.run('apps',async()=>9)).toBe(9)
  })
  it('cancels only the waiting source without interrupting the active scan or later work',async()=>{
    const gate=deferred(),queue=new StorageTaskQueue();let ran=false
    const scan=queue.run('large',()=>gate.promise),waiting=queue.run('duplicates',async()=>{ran=true})
    const rejected=expect(waiting).rejects.toThrow('cancelled')
    await Promise.resolve();queue.cancelPending('duplicates');await rejected;expect(queue.activeScope).toBe('large')
    const next=queue.run('privacy',async()=>true);gate.resolve();await scan;expect(await next).toBe(true);expect(ran).toBe(false)
  })
})
