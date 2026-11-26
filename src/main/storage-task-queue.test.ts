import {describe,expect,it} from 'vitest'
import {StorageTaskQueue} from './storage-task-queue'
function deferred(){let resolve!:()=>void;const promise=new Promise<void>((done)=>{resolve=done});return {promise,resolve}}
describe('storage task scheduling',()=>{
  it('runs privacy discovery and cleanup while an independent file scan is still active',async()=>{
    const gate=deferred(),order:string[]=[],queue=new StorageTaskQueue()
    const scan=queue.run('large',async()=>{order.push('scan-start');await gate.promise;order.push('scan-end')})
    const privacy=queue.run('privacy',async()=>{order.push('privacy');return 7})
    expect(await privacy).toBe(7)
    await queue.run('privacy',async()=>{order.push('clean')},true)
    expect(order).toEqual(['scan-start','privacy','clean']);expect(queue.activeScopes).toContain('large')
    gate.resolve();await scan
  })
  it('orders same-scope work, cancels only its waiting job and recovers after errors',async()=>{
    const gate=deferred(),queue=new StorageTaskQueue();let ran=false
    const scan=queue.run('large',()=>gate.promise),waiting=queue.run('large',async()=>{ran=true})
    const rejected=expect(waiting).rejects.toThrow('cancelled');queue.cancelPending('large');await rejected
    expect(queue.activeScopes).toContain('large');expect(await queue.run('privacy',async()=>true)).toBe(true)
    gate.resolve();await scan;expect(ran).toBe(false)
    await expect(queue.run('apps',async()=>{throw new Error('fixture failure')})).rejects.toThrow('fixture failure')
    expect(await queue.run('apps',async()=>9)).toBe(9)
  })
  it('serializes mutations without blocking independent reads and limits heavy scans to two',async()=>{
    const gate=deferred(),events:unknown[]=[],queue=new StorageTaskQueue((...event)=>events.push(event));let updated=false
    const clean=queue.run('privacy',()=>gate.promise,true),update=queue.run('apps',async()=>{updated=true},true)
    expect(await queue.run('large',async()=>true)).toBe(true);expect(updated).toBe(false)
    gate.resolve();await Promise.all([clean,update]);expect(updated).toBe(true);expect(events).toContainEqual(['apps',true,'privacy'])
    const first=deferred(),second=deferred();const a=queue.run('large',()=>first.promise),b=queue.run('duplicates',()=>second.promise)
    let third=false;const c=queue.run('analysis',async()=>{third=true})
    await queue.run('privacy',async()=>true);expect(third).toBe(false);first.resolve();await a;await c;expect(third).toBe(true);second.resolve();await b
  })
})
