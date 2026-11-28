import {describe,expect,it,vi} from 'vitest'
import {baseItem,digest,type StartupAdapter,type StartupRecord,type StartupBatch} from './startup/common'
import type {StartupCoverage,StartupItem} from '../shared/startup-types'
const handlers=vi.hoisted(()=>new Map<string,Function>())
vi.mock('electron',()=>({app:{},ipcMain:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},shell:{trashItem:vi.fn(),showItemInFolder:vi.fn()}}))
vi.mock('./application-icon',()=>({readApplicationIcon:vi.fn()}))
import {StartupService} from './startup-service'
function harness(){
  const rows=new Map<string,StartupItem>([['one',baseItem({name:'One',kind:'agent',state:'enabled',canToggle:true,canRemove:true})],['two',baseItem({name:'Two',kind:'login',state:'disabled',canToggle:true,canRemove:true})],['system',baseItem({name:'Protected',kind:'daemon',scope:'system',state:'enabled',access:'protected'})]])
  const writes:string[]=[],fail=new Set<string>(),unchanged=new Set<string>()
  const coverage:StartupCoverage[]=[{source:'agent',status:'complete',message:'',count:1},{source:'login',status:'complete',message:'',count:1},{source:'daemon',status:'complete',message:'',count:1}]
  const adapter:StartupAdapter={scan:async()=>({coverage,records:[...rows].map(([key,item])=>({key,item:{...item},signature:digest(item),validate:async()=>digest(rows.get(key)),change:async action=>{writes.push(key+':'+action);if(fail.has(key))throw new Error('startup.permission');if(unchanged.has(key))return;if(action==='remove')rows.delete(key);else rows.set(key,{...item,state:action==='enable'?'enabled':'disabled'})}}))})}
  const service=new StartupService({profile:'/unused-fixture',language:()=> 'en-US',adapter})
  return {service,rows,writes,fail,unchanged,coverage}
}
describe('registered startup changes',()=>{
  it('rejects forged IDs, expired catalogs and protected selections before any write',async()=>{
    const {service,writes}=harness(),catalog=await service.scan()
    await expect(service.change({catalogId:'forged',ids:[catalog.items[0].id],action:'disable'})).rejects.toThrow(/expired/)
    await expect(service.change({catalogId:catalog.id,ids:[crypto.randomUUID()],action:'remove'})).rejects.toThrow(/expired/)
    await expect(service.change({catalogId:catalog.id,ids:[catalog.items.find(item=>item.name==='Protected')!.id],action:'disable'})).rejects.toThrow(/direct changes/)
    expect(writes).toEqual([])
  })
  it('preflights the entire batch and rejects changed configurations before the first mutation',async()=>{
    const {service,rows,writes}=harness(),catalog=await service.scan()
    rows.set('two',{...rows.get('two')!,configuration:'/changed-location'})
    await expect(service.change({catalogId:catalog.id,ids:catalog.items.slice(0,2).map(item=>item.id),action:'disable'})).rejects.toThrow(/has changed/)
    expect(writes).toEqual([])
  })
  it('rechecks configured states, preserves stable IDs, and reports only verified successes',async()=>{
    const {service,rows,unchanged}=harness(),catalog=await service.scan(),one=catalog.items[0]
    unchanged.add('one')
    const unverified=await service.change({catalogId:catalog.id,ids:[one.id],action:'disable'})
    expect(unverified.results[0]).toMatchObject({ok:false,changed:false});expect(unverified.results[0].message).toMatch(/could not be verified/)
    expect(unverified.catalog.items[0].id).toBe(one.id)
    unchanged.clear()
    const result=await service.change({catalogId:unverified.catalog.id,ids:[one.id],action:'disable'})
    expect(result.results[0]).toMatchObject({ok:true,changed:true});expect(rows.get('one')!.state).toBe('disabled')
    expect(result.catalog.items[0]).toMatchObject({id:one.id,state:'disabled'})
  })
  it('keeps per-item failures and successful removals separate in a batch',async()=>{
    const {service,rows,fail}=harness(),catalog=await service.scan();fail.add('two')
    const result=await service.change({catalogId:catalog.id,ids:catalog.items.slice(0,2).map(item=>item.id),action:'remove'})
    expect(result.results.map(item=>item.ok)).toEqual([true,false]);expect(rows.has('one')).toBe(false);expect(rows.has('two')).toBe(true)
    expect(result.results[1].message).toMatch(/Access was denied/)
  })
  it.each(['partial','unavailable','missing'] as const)('does not infer successful removal from an absent row when source coverage is %s',async status=>{
    const {service,rows,coverage}=harness(),catalog=await service.scan()
    if(status==='missing')coverage.splice(0,1);else coverage[0].status=status
    const result=await service.change({catalogId:catalog.id,ids:[catalog.items[0].id],action:'remove'})
    expect(rows.has('one')).toBe(false)
    expect(result.results[0]).toMatchObject({ok:false,changed:false})
    expect(result.results[0].message).toMatch(/could not be verified/)
  })
  it('keeps read-only rescans from expiring a displayed selection and still validates its original snapshot',async()=>{
    const {service,writes}=harness(),catalog=await service.scan()
    const refresh=service.scan(),change=service.change({catalogId:catalog.id,ids:[catalog.items[0].id],action:'disable'})
    await refresh;expect((await change).results[0].ok).toBe(true);expect(writes).toEqual(['one:disable'])
  })
  it('revalidates and removes an unchanged displayed item after the page has been open for hours',async()=>{
    const {service,writes}=harness(),catalog=await service.scan(),time=Date.now()
    const clock=vi.spyOn(Date,'now').mockReturnValue(time+24*60*60000)
    try{expect((await service.change({catalogId:catalog.id,ids:[catalog.items[0].id],action:'remove'})).results[0].ok).toBe(true);expect(writes).toEqual(['one:remove'])}finally{clock.mockRestore()}
  })
  it('rejects changed old selections after a newer scan instead of silently authorizing the new definition',async()=>{
    const {service,rows,writes}=harness(),catalog=await service.scan()
    rows.set('one',{...rows.get('one')!,target:'/different-program'});await service.scan()
    await expect(service.change({catalogId:catalog.id,ids:[catalog.items[0].id],action:'remove'})).rejects.toThrow(/has changed/)
    expect(writes).toEqual([])
  })
  it('accepts registered IDs only across IPC, never client-supplied paths or commands',async()=>{
    const {service}=harness();service.register()
    const invoke=handlers.get('diskcollie:startup:change')!
    expect(()=>invoke(null,{catalogId:crypto.randomUUID(),ids:[crypto.randomUUID()],action:'disable',path:'/outside'})).toThrow()
    expect(()=>invoke(null,{catalogId:crypto.randomUUID(),ids:[crypto.randomUUID()],action:'execute'})).toThrow()
  })
})

function batchedHarness(){
  const rows=new Map(['one','two','unchanged'].map(key=>[key,baseItem({name:key,kind:'agent',state:key==='unchanged'?'disabled':'enabled',access:'administrator',canRemove:true,canToggle:true})]))
  const failures=new Map<string,unknown>(),readFailures=new Set<string>(),unrelated=baseItem({name:'Background registration',kind:'background',access:'settings'})
  let cancel=false
  const batch:StartupBatch={token:{},apply:vi.fn<StartupBatch['apply']>(async(records,action)=>{
    if(cancel)throw new Error('User cancelled (-128)')
    return records.map(record=>{const error=failures.get(record.key)||null;if(!error){if(action==='remove')rows.delete(record.key);else rows.get(record.key)!.state=action==='enable'?'enabled':'disabled'}return {key:record.key,error}})
  })}
  const make=(key:string):StartupRecord=>{
    const item={...rows.get(key)!}
    return {key,item,signature:digest(item),batch,validate:async()=>digest(rows.get(key)),change:async()=>{throw new Error('Must use batch')},readBack:async()=>{if(readFailures.has(key))throw new Error('Permission denied');return rows.has(key)?make(key):null}}
  }
  const adapter:StartupAdapter={scan:vi.fn<StartupAdapter['scan']>(async()=>({records:[...rows.keys()].map(make).concat({key:'btm',item:unrelated,signature:'btm',validate:async()=> 'btm',change:async()=>{throw new Error('readonly')}}),coverage:[{source:'agent',status:'partial',count:3,message:'startup.partial'},{source:'background',status:'complete',count:8,message:''}]}))}
  const service=new StartupService({profile:'/unused-fixture',language:()=> 'en-US',adapter})
  return {service,adapter,rows,batch,failures,readFailures,cancel:()=>{cancel=true}}
}
describe('one authorization with targeted native verification',()=>{
  it('authorizes a batch once, excludes unchanged items, retains unrelated rows/coverage and verifies native states without a full scan',async()=>{
    const {service,adapter,batch}=batchedHarness(),catalog=await service.scan(),ids=catalog.items.filter(item=>item.canToggle).map(item=>item.id)
    const result=await service.change({catalogId:catalog.id,ids,action:'disable'})
    expect(batch.apply).toHaveBeenCalledTimes(1)
    expect(vi.mocked(batch.apply).mock.calls[0][0].map(record=>record.key)).toEqual(['one','two'])
    expect(result.results.map(item=>[item.ok,item.changed])).toEqual([[true,true],[true,true],[true,false]])
    expect(result.catalog.items.map(item=>[item.id,item.state])).toEqual(catalog.items.map(item=>[item.id,item.canToggle?'disabled':item.state]))
    expect(result.catalog.coverage).toEqual(catalog.coverage)
    expect(adapter.scan).toHaveBeenCalledTimes(1)
  })
  it('requires whole-selection preflight before authorizing any batch',async()=>{
    const {service,rows,batch}=batchedHarness(),catalog=await service.scan()
    rows.get('two')!.target='/changed'
    await expect(service.change({catalogId:catalog.id,ids:catalog.items.slice(0,2).map(item=>item.id),action:'remove'})).rejects.toThrow(/has changed/)
    expect(batch.apply).not.toHaveBeenCalled()
  })
  it('preserves per-item outcomes and order, using proven absence even with partial source coverage',async()=>{
    const {service,adapter,failures}=batchedHarness(),catalog=await service.scan();failures.set('one',new Error('startup.permission'))
    const result=await service.change({catalogId:catalog.id,ids:[catalog.items[1].id,catalog.items[0].id],action:'remove'})
    expect(result.results.map(item=>[item.name,item.ok])).toEqual([['two',true],['one',false]])
    expect(result.catalog.items.map(item=>item.name)).toEqual(['one','unchanged','Background registration'])
    expect(result.catalog.coverage[0]).toMatchObject({status:'partial',count:2})
    expect(result.catalog.coverage[1].count).toBe(8)
    expect(adapter.scan).toHaveBeenCalledTimes(1)
  })
  it('reports authorization cancellation for every batch item without rescanning or claiming changes',async()=>{
    const {service,cancel,rows,adapter}=batchedHarness(),catalog=await service.scan();cancel()
    const result=await service.change({catalogId:catalog.id,ids:catalog.items.slice(0,2).map(item=>item.id),action:'remove'})
    expect(result.results.every(item=>!item.ok&&!item.changed&&/cancelled/.test(item.message))).toBe(true)
    expect(rows.size).toBe(3);expect(adapter.scan).toHaveBeenCalledTimes(1)
  })
  it('does not claim success when native readback fails and never falls back to unrelated permission probes',async()=>{
    const {service,readFailures,adapter}=batchedHarness(),catalog=await service.scan();readFailures.add('two')
    const result=await service.change({catalogId:catalog.id,ids:catalog.items.slice(0,2).map(item=>item.id),action:'remove'})
    expect(result.results.every(item=>!item.ok&&!item.changed&&/could not be verified/.test(item.message))).toBe(true)
    expect(adapter.scan).toHaveBeenCalledTimes(1)
  })
})
