import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {lstat,mkdtemp,mkdir,readFile,realpath,rm,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {DeepCleanService} from './deep-clean-service'
import {deepCleanDefinitions,type DeepCleanDefinition} from './deep-clean-rules'
import type {DeepCleanContext} from './deep-clean-context'
import {deepFileSnapshot} from './deep-clean-resource'
let home:string,context:DeepCleanContext
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-deep-service-')));context={home,platform:'darwin',env:{},applications:[]}})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function file(relative:string,contents='owned cache'):Promise<string>{const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,contents);await utimes(target,new Date(Date.now()-10000),new Date(Date.now()-10000));return target}
function definition(key:string,target:string,applications:string[]=[]):DeepCleanDefinition{return {key,group:'application',name:{zh:key,en:key},description:{zh:'可重建',en:'Regenerable'},risk:'safe',recommended:true,paths:[target],applications}}
describe('deep clean registration and catalog',()=>{
  it('deduplicates overlapping static/dynamic rules before scanning and keeps real file totals',async()=>{
    const npm=await file('.npm/_cacache/content.bin','npm'),browser=await file('Library/Caches/Google/Chrome/Default/Cache/data.bin','chrome'),unknown=await file('Library/Caches/UnknownApp/cache.bin','unknown')
    const catalog=await deepCleanDefinitions(context),roots=catalog.flatMap((entry)=>entry.paths)
    for(let a=0;a<roots.length;a++)for(let b=a+1;b<roots.length;b++)expect(roots[a]===roots[b]||roots[a].startsWith(roots[b]+path.sep)||roots[b].startsWith(roots[a]+path.sep)).toBe(false)
    const scan=await new DeepCleanService().scan(context)
    expect(scan.items.reduce((total,item)=>total+item.size,0)).toBe(3+6+7)
    expect(scan.items.reduce((total,item)=>total+item.count,0)).toBe(3)
    expect(scan.items.find((item)=>item.sources.some((source)=>unknown.startsWith(source.path+path.sep)))).toMatchObject({risk:'review',recommended:false})
    expect(scan.items.flatMap((item)=>item.sources).filter((source)=>npm.startsWith(source.path+path.sep))).toHaveLength(1)
    expect(scan.items.flatMap((item)=>item.sources).filter((source)=>browser.startsWith(source.path+path.sep))).toHaveLength(1)
  })
  it('keeps entire model stores read-only and excludes Service Worker roots and credentials',async()=>{
    const model=await file('.ollama/models/imported-local-model','user trained weights'),manifest=await file('Library/Application Support/Code/Service Worker/CacheStorage/extension-script','extension cache'),secret=await file('.codex/auth.json','SECRET'),cache=await file('.codex/tmp/old.bin','temporary')
    const catalog=await deepCleanDefinitions(context)
    expect(catalog.some((entry)=>entry.paths.some((target)=>manifest.startsWith(target+path.sep)))).toBe(false)
    const service=new DeepCleanService(),scan=await service.scan(context),modelItem=scan.items.find((item)=>item.key==='ollama-models')!
    expect(modelItem).toMatchObject({risk:'protected',recommended:false,status:'review-only'})
    expect(modelItem.sources[0].cleanupMethod).toBe('none')
    await expect(service.prepare([modelItem.sources[0].id],()=>false)).rejects.toThrow('deep.sourceUnavailable')
    const cacheItem=scan.items.find((item)=>item.sources.some((source)=>cache.startsWith(source.path+path.sep)))!
    const prepared=await service.prepare(cacheItem.sources.map((source)=>source.id),()=>false)
    for(const entry of prepared.entries)await entry.snapshot.clean()
    expect(await readFile(secret,'utf8')).toBe('SECRET');expect(await readFile(model,'utf8')).toBe('user trained weights');expect(await readFile(manifest,'utf8')).toBe('extension cache')
  })
  it('retains stable opaque source IDs and pages 100 actual files',async()=>{
    const root=path.join(home,'cache');for(let index=0;index<103;index++)await file('cache/'+index)
    const service=new DeepCleanService(async()=>[definition('fixture',root)]),first=await service.scan(context),id=first.items[0].sources[0].id
    expect(id).toMatch(/^[0-9a-f]{8}-/)
    expect((await service.preview(id)).files).toHaveLength(100);expect((await service.preview(id)).nextOffset).toBe(100);expect((await service.preview(id,100)).files).toHaveLength(3);expect((await service.preview(id,100)).nextOffset).toBeNull()
    expect((await service.scan(context)).items[0].sources[0].id).toBe(id)
    await expect(service.preview(root)).rejects.toThrow('deep.selectionExpired')
    service.forget(id);await expect(service.preview(id)).rejects.toThrow('deep.selectionExpired')
  })
  it('checks running apps again and preflights every source before exposing the batch',async()=>{
    const first=await file('first/a'),second=await file('second/b')
    const service=new DeepCleanService(async()=>[definition('first',path.dirname(first),['Fixture']),definition('second',path.dirname(second))])
    const scan=await service.scan(context,(name)=>name==='Fixture'),ids=scan.items.flatMap((item)=>item.sources.map((source)=>source.id))
    expect(scan.items[0].sources[0].status).toBe('requires-close')
    await expect(service.prepare(ids,(name)=>name==='Fixture')).rejects.toThrow('deep.closeApplications')
    const skipped=await service.prepare(ids,(name)=>name==='Fixture',true)
    expect(skipped.skipped).toBe(1);expect(skipped.entries).toHaveLength(1)
    await writeFile(second,'changed')
    await expect(service.prepare(ids,()=>false)).rejects.toThrow('deep.sourceChanged');expect(await readFile(first,'utf8')).toBe('owned cache')
  })
  it('responds to cancellation and retains the previous registered scan',async()=>{
    const root=path.dirname(await file('cache/a')),service=new DeepCleanService(async()=>[definition('fixture',root)]),scan=await service.scan(context),id=scan.items[0].sources[0].id
    const controller=new AbortController();controller.abort()
    await expect(service.scan({...context,signal:controller.signal})).rejects.toThrow('deep.cancelled')
    expect(service.has(id)).toBe(true)
  })
  it('labels active build caches and does not recommend application recovery state',async()=>{
    await file('.npm/_cacache/cache');await file('Library/Developer/Xcode/DerivedData/Module/cache');await file('Library/Saved Application State/fixture.savedState/restore')
    const scan=await new DeepCleanService().scan(context,(name)=>['npm','xcodebuild'].includes(name))
    expect(scan.items.find((item)=>item.key==='npm-content-cache')?.status).toBe('requires-close');expect(scan.items.find((item)=>item.key==='xcode-derived-data')?.status).toBe('requires-close')
    const recovery=scan.items.find((item)=>item.key==='system-saved-state')!
    expect(recovery.recommended).toBe(false);expect(recovery.description.zh).toContain('未保存')
  })
})
