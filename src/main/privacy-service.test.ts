import {describe,expect,it,vi} from 'vitest'
import {PrivacyService} from './privacy-service'
import type {PrivacyContext,PrivacyResource,PrivacySnapshot} from './privacy-resource'
import type {PrivacyRecord} from '../shared/privacy-types'

const context:PrivacyContext={platform:'linux',home:'/synthetic-test-home',env:{},applications:[]}
const source={key:'fixture',name:'Fixture',bundleIds:['com.example.fixture'],iconPaths:[]}
function snapshot(records:PrivacyRecord[]=[{id:'record',title:'Fixture record'}],count=records.length):PrivacySnapshot{
  return {count,size:128,capability:count?'ready':'empty',preview:vi.fn(async(offset,limit)=>records.slice(offset,offset+limit)),validate:vi.fn(async()=>undefined),clean:vi.fn(async()=>({count,size:0,changed:count>0}))}
}
function resource(key:string,value=snapshot(),browser?:string):PrivacyResource{
  return {key,kind:'history',category:'browser-activity',source,paths:[`/synthetic-test-home/${key}.sqlite`],risk:'low',supportsRange:true,browser,scan:vi.fn(async()=>value)}
}

describe('registered privacy plans',()=>{
  it('does not scan or register excluded resources',async()=>{
    const blocked=resource('private'),allowed=resource('public'),service=new PrivacyService(async()=>[blocked,allowed])
    const items=await service.scan({...context,excludedPaths:blocked.paths},'all')
    expect(items.map((item)=>item.path)).toEqual(allowed.paths);expect(blocked.scan).not.toHaveBeenCalled();expect(allowed.scan).toHaveBeenCalledOnce()
  })
  it('exposes opaque registered IDs, preserves IDs across refreshed keys, and expires missing selections',async()=>{
    const first=resource('first'),removed=resource('removed'),added=resource('added')
    const discover=vi.fn(async()=>[first,removed]),service=new PrivacyService(discover)
    const original=await service.scan(context,'all'),firstId=original[0].id,removedId=original[1].id
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
    expect(firstId).not.toBe(first.paths[0]);expect(service.has(firstId)).toBe(true)
    expect(service.source(firstId)).toEqual(source);expect(service.paths(firstId)).toEqual(first.paths)
    discover.mockResolvedValueOnce([first,added])
    const refreshed=await service.scan(context,'week')
    expect(refreshed[0].id).toBe(firstId);expect(refreshed[1].id).not.toBe(removedId)
    expect(service.has(removedId)).toBe(false)
    await expect(service.preview(removedId)).rejects.toThrow('privacy.selectionExpired')
    await expect(service.preview(first.paths[0])).rejects.toThrow('privacy.selectionExpired')
    await expect(service.prepare([firstId,'/etc/passwd'],()=>false)).rejects.toThrow('privacy.selectionExpired')
    service.forget(firstId);expect(service.has(firstId)).toBe(false)
    await expect(service.prepare([firstId],()=>false)).rejects.toThrow('privacy.selectionExpired')
  })

  it('pages bounded details independently from the number of grouped logical traces',async()=>{
    const records=Array.from({length:203},(_,index)=>({id:String(index),title:`Site ${index}`,count:3}))
    const value=snapshot(records,609),service=new PrivacyService(async()=>[resource('grouped',value)])
    const [item]=await service.scan(context,'all')
    const first=await service.preview(item.id)
    expect(first).toMatchObject({id:item.id,total:609,offset:0,nextOffset:100});expect(first.records).toHaveLength(100)
    const second=await service.preview(item.id,100)
    expect(second.records[0].id).toBe('100');expect(second.nextOffset).toBe(200)
    const last=await service.preview(item.id,200)
    expect(last.records.map((entry)=>entry.id)).toEqual(['200','201','202']);expect(last.nextOffset).toBeNull()
    expect(await service.preview(item.id,300)).toMatchObject({records:[],nextOffset:null})
    expect(value.preview).toHaveBeenCalledWith(0,100)
  })

  it('validates every selection before exposing any cleanup entry and rejects a changed later source',async()=>{
    const calls:string[]=[],first=snapshot(),second=snapshot()
    first.validate=vi.fn(async()=>{calls.push('validate:first')})
    second.validate=vi.fn(async()=>{calls.push('validate:second');throw new Error('privacy.sourceChanged')})
    const service=new PrivacyService(async()=>[resource('first',first),resource('second',second)])
    const items=await service.scan(context,'all')
    await expect(service.prepare(items.map((item)=>item.id),()=>false)).rejects.toThrow('privacy.sourceChanged')
    expect(calls).toEqual(['validate:first','validate:second'])
    expect(first.clean).not.toHaveBeenCalled();expect(second.clean).not.toHaveBeenCalled()
    second.validate=vi.fn(async()=>{calls.push('validate:second:fixed')})
    const prepared=await service.prepare([items[0].id,items[0].id,items[1].id],()=>false)
    expect(prepared.entries).toHaveLength(2)
    for(const entry of prepared.entries)await entry.snapshot.clean()
    expect(first.clean).toHaveBeenCalledTimes(1);expect(second.clean).toHaveBeenCalledTimes(1)
  })

  it('checks live browser activity at cleanup time and can skip it while retaining other selections',async()=>{
    const browser=snapshot(),local=snapshot(),service=new PrivacyService(async()=>[resource('browser',browser,'Fixture Browser'),resource('local',local)])
    const items=await service.scan(context,'all',()=>false),ids=items.map((item)=>item.id)
    expect(items[0].browserRunning).toBe(false)
    await expect(service.prepare(ids,(name)=>name==='Fixture Browser')).rejects.toThrow('privacy.browserMustClose')
    expect(browser.validate).not.toHaveBeenCalled();expect(local.validate).not.toHaveBeenCalled()
    const prepared=await service.prepare(ids,()=>true,true)
    expect(prepared.skipped).toBe(1);expect(prepared.entries.map((entry)=>entry.resource.key)).toEqual(['local'])
    expect(browser.validate).not.toHaveBeenCalled();expect(local.validate).toHaveBeenCalledTimes(1)
    const onlyBrowser=await service.prepare([ids[0]],()=>true,true)
    expect(onlyBrowser).toEqual({entries:[],skipped:1})
  })

  it('uses a common frozen range boundary and reports unavailable and permission sources without making them cleanable',async()=>{
    const ready=resource('ready'),empty=resource('empty',snapshot([])),unsupported=resource('unsupported',{...snapshot(),count:null,capability:'range-unsupported'})
    const denied=resource('denied'),broken=resource('broken')
    denied.scan=vi.fn(async()=>{throw Object.assign(new Error('Access denied'),{code:'EACCES'})})
    broken.scan=vi.fn(async()=>{throw new Error('Malformed database')})
    const resources=[ready,empty,unsupported,denied,broken],service=new PrivacyService(async()=>resources)
    const items=await service.scan(context,'hour',()=>true)
    const boundaries=resources.map((entry)=>(entry.scan as ReturnType<typeof vi.fn>).mock.calls[0][1])
    expect(new Set(boundaries).size).toBe(1)
    for(const entry of resources)expect(entry.scan).toHaveBeenCalledWith('hour',expect.any(Number))
    expect(items.map((item)=>item.capability)).toEqual(['ready','empty','range-unsupported','permission-required','unavailable'])
    for(const item of items.slice(1))await expect(service.prepare([item.id],()=>false)).rejects.toThrow('privacy.sourceUnavailable')
    await expect(service.preview(items[2].id)).rejects.toThrow('privacy.sourceUnavailable')
    expect((await service.preview(items[1].id)).records).toEqual([])
    await expect(service.prepare([],()=>false)).rejects.toThrow('privacy.selectionExpired')
  })
  it('explains app revisions and recovery records separately from browsing history',async()=>{
    const edit={...resource('edit'),kind:'app-edit-history' as const,risk:'sensitive' as const},sessions={...resource('sessions'),kind:'app-sessions' as const,risk:'sensitive' as const}
    const service=new PrivacyService(async()=>[edit,sessions]),items=await service.scan(context,'all')
    expect(items.map((item)=>item.effectKey)).toEqual(['editHistory','appSessions'])
    expect(items.every((item)=>item.risk==='sensitive'&&!item.recommended)).toBe(true)
  })

})
