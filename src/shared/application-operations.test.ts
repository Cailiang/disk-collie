import {describe,expect,it,vi} from 'vitest'
import {ApplicationOperations} from './application-operations'
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
describe('independent application operations',()=>{
  it('runs different applications at once and coalesces duplicate update requests',async()=>{
    const operations=new ApplicationOperations(),first=deferred<string>(),second=deferred<string>(),started:string[]=[]
    const a=operations.run('app-a','update',async()=>{started.push('a');return first.promise})
    const duplicate=operations.run('app-a','update',vi.fn(async()=>{throw new Error('Duplicate executor must not run')}))
    const b=operations.run('app-b','update',async()=>{started.push('b');return second.promise})
    expect(duplicate).toBe(a)
    await Promise.resolve();expect(started).toEqual(['a','b']);expect(operations.activeIds('update')).toEqual(new Set(['app-a','app-b']))
    second.resolve('B updated');expect(await b).toBe('B updated');expect(operations.activeIds()).toEqual(new Set(['app-a']))
    first.resolve('A updated');expect(await a).toBe('A updated');expect(await duplicate).toBe('A updated');expect(operations.activeIds().size).toBe(0)
  })
  it('isolates failures, releases only their application and permits retry',async()=>{
    const operations=new ApplicationOperations(),first=deferred<void>(),second=deferred<void>()
    const a=operations.run('app-a','update',()=>first.promise),b=operations.run('app-b','update',()=>second.promise)
    const failed=expect(a).rejects.toThrow('fixture download failed');first.reject(new Error('fixture download failed'));await failed
    expect(operations.has('app-a')).toBe(false);expect(operations.has('app-b','update')).toBe(true)
    expect(await operations.run('app-a','update',async()=>42)).toBe(42);expect(operations.has('app-b')).toBe(true)
    second.resolve();await b
  })
  it('blocks replacement and removal of the same app while unrelated removal remains available',async()=>{
    const operations=new ApplicationOperations(),gate=deferred<void>(),remove=vi.fn(async()=>undefined)
    const updating=operations.run('app-a','update',()=>gate.promise)
    await expect(operations.run('app-a','uninstall',remove)).rejects.toThrow('apps.operationInProgress');expect(remove).not.toHaveBeenCalled()
    await operations.run('app-b','uninstall',remove);expect(remove).toHaveBeenCalledTimes(1)
    gate.resolve();await updating;await operations.run('app-a','uninstall',remove);expect(remove).toHaveBeenCalledTimes(2)
  })
})
