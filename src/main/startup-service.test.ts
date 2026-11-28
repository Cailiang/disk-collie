import {describe,expect,it,vi} from 'vitest'
import {baseItem,digest,type StartupAdapter} from './startup/common'
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
