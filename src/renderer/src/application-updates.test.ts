import {describe,expect,it} from 'vitest'
import type {StorageApplication,StorageApplicationUpdateResult} from '../../shared/storage-types'
import {ApplicationOperations} from '../../shared/application-operations'
import {mergeApplicationUpdate} from './application-updates'
const app=(id:string):StorageApplication=>({id,name:id,version:'1',location:`/Applications/${id}.app`,bundleId:`com.example.${id}`,size:100,protected:false,method:'trash',updateAvailable:true,latestVersion:'2'})
function deferred(){let resolve!:(result:StorageApplicationUpdateResult)=>void,reject!:(reason:Error)=>void;const promise=new Promise<StorageApplicationUpdateResult>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
describe('parallel update inventory reconciliation',()=>{
  it('preserves both completions when an update finishes after another and keeps unrelated live metadata',async()=>{
    const operations=new ApplicationOperations(),first=deferred(),second=deferred();let inventory=[app('A'),app('B')]
    const run=(id:string,work:()=>Promise<StorageApplicationUpdateResult>)=>operations.run(id,'update',work).then((result)=>{inventory=mergeApplicationUpdate(inventory,id,result)})
    const a=run('A',()=>first.promise),b=run('B',()=>second.promise)
    inventory=inventory.map((value)=>value.id==='B'?{...value,size:12345,lastUsedAt:'2026-11-26T00:00:00.000Z'}:value)
    second.resolve({status:'updated'});await b;expect(inventory.find((value)=>value.id==='B')).toMatchObject({version:'2',size:12345,updateAvailable:false})
    first.resolve({status:'updated',application:{...app('A'),version:'2.1',updateAvailable:false,latestVersion:null}});await a
    expect(inventory.map((value)=>value.version)).toEqual(['2.1','2']);expect(inventory.every((value)=>!value.updateAvailable)).toBe(true)
    expect(inventory.find((value)=>value.id==='B')).toMatchObject({size:12345,lastUsedAt:'2026-11-26T00:00:00.000Z'})
  })
  it('does not revive a removed app or mark an updater handoff as installed',()=>{
    const original=[app('A')]
    expect(mergeApplicationUpdate(original,'B',{status:'updated',application:app('B')})).toEqual(original)
    expect(mergeApplicationUpdate(original,'A',{status:'opened',destination:'app-store'})).toBe(original)
    expect(original[0].version).toBe('1');expect(original[0].updateAvailable).toBe(true)
  })
  it('keeps a failed app available for retry while a different update succeeds',async()=>{
    const operations=new ApplicationOperations(),first=deferred(),second=deferred();let inventory=[app('A'),app('B')]
    const a=operations.run('A','update',()=>first.promise).then((result)=>{inventory=mergeApplicationUpdate(inventory,'A',result)})
    const b=operations.run('B','update',()=>second.promise).then((result)=>{inventory=mergeApplicationUpdate(inventory,'B',result)})
    const failure=expect(a).rejects.toThrow('fixture failure');first.reject(new Error('fixture failure'));await failure
    second.resolve({status:'updated'});await b
    expect(inventory.map((value)=>({id:value.id,version:value.version,available:value.updateAvailable}))).toEqual([{id:'A',version:'1',available:true},{id:'B',version:'2',available:false}])
    expect(operations.has('A')).toBe(false);expect(operations.has('B')).toBe(false)
  })
})
