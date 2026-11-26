import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink,lstat} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {StorageEntry,StorageIndex} from '../shared/storage-types'
const state=vi.hoisted(()=>({profile:'',root:'',fail:'',scanGate:null as Promise<void>|null,hashGate:null as Promise<void>|null,processCommands:[] as string[],engines:[] as any[],progress:[] as any[],hashes:new Map<number,string>(),handlers:new Map<string,(event:unknown,input?:unknown)=>any>()}))
vi.mock('electron',()=>({
  app:{getPath:()=>state.profile,on:vi.fn()},
  BrowserWindow:{getAllWindows:()=>[{webContents:{send:(_channel:string,p:unknown)=>state.progress.push(p)}}]},
  ipcMain:{handle:(name:string,fn:any)=>state.handlers.set(name,fn)},
  shell:{trashItem:vi.fn(async(location:string)=>{if(location===state.fail)throw new Error('Fixture failure')}),showItemInFolder:vi.fn()}
}))
vi.mock('./native-engine',()=>({NativeEngine:class {
  index:StorageIndex|null=null
  entries:StorageEntry[]=[]
  stopped=false
  constructor(){state.engines.push(this)}
  async request(command:string,args:any={}) {
    if(command==='scan'){
      this.entries=['a.mov','b.mov','c.mov'].map((name,id)=>({id:id+1,parent:0,name,path:path.join(state.root,name),directory:false,size:2048,allocated:2048,modified:0,identity:String(id),links:1}))
      this.index={generation:1,root:{id:0,parent:null,name:'fixture',path:state.root,directory:true,size:6144,allocated:6144,modified:0,identity:'root',links:1},entries:4,errors:0,skipped:0,limited:false,elapsedMs:1,mode:args.mode}
      if(state.scanGate)await state.scanGate
      return this.index
    }
    if(command==='duplicates'){const groups=[{id:'hash-a',files:this.entries.slice(0,2),reclaimable:2048}];if(state.hashGate)await state.hashGate;return {groups,elapsedMs:1}}
    if(command==='hash')return {hash:state.hashes.get(args.id)||'hash-a'}
    if(command==='entry')return this.entries.find((e)=>e.id===args.id)
    if(command==='children')return {parent:this.index!.root,items:this.entries}
    if(command==='forget'){this.entries=this.entries.filter((e)=>!args.paths.includes(e.path));return this.index}
    if(command==='system')return {processes:[],processCommands:state.processCommands,processNames:[]}
    if(command==='measure')return args.paths.map((path:string)=>({path,size:2048,errors:0}))
    if(command==='large')return {count:this.entries.length,items:this.entries}
    throw new Error(`Unexpected fixture command ${command}`)
  }
  stop(){this.stopped=true}
}}))
import {StorageService} from './storage-service'
import {StorageLedger} from './storage-ledger'
const call=(name:string,input?:unknown)=>state.handlers.get(`memento:storage:${name}`)!(null,input)
describe('storage scan sessions and partial cleanup',()=>{
  let fixture:string
  beforeEach(async()=>{
    fixture=await mkdtemp(path.join(os.homedir(),'memento-service-test-'))
    state.root=path.join(fixture,'files');state.profile=path.join(fixture,'profile')
    await mkdir(state.root);for(const name of ['a.mov','b.mov','c.mov'])await writeFile(path.join(state.root,name),Buffer.alloc(2048))
    state.fail='';state.processCommands=[];state.scanGate=null;state.hashGate=null;state.hashes.clear();state.engines=[];state.progress=[];state.handlers.clear()
    vi.stubEnv('MEMENTO_TEST_RUN','1');vi.stubEnv('MEMENTO_TEST_STORAGE_ROOT',state.root)
  })
  afterEach(async()=>{vi.unstubAllEnvs();await rm(fixture,{recursive:true,force:true})})
  it('retains independent generations, removes only successful files from every session, and journals progress',async()=>{
    const service=new StorageService();await service.init();service.register()
    const first=await service.scan({mode:'large'}),second=await service.scan({mode:'duplicates'})
    expect(first!.generation).not.toBe(second!.generation)
    expect((await call('large',{generation:first!.generation,minimum:1,search:'',offset:0})).count).toBe(3)
    state.fail=path.join(state.root,'b.mov')
    const result=await service.trash({generation:first!.generation,ids:[1,2],kind:'large'})
    expect(result).toMatchObject({items:1,failures:1,bytes:2048,locations:[path.join(state.root,'a.mov')]})
    for(const generation of [first!.generation,second!.generation]) {
      const remaining=await call('large',{generation,minimum:1,search:'',offset:0})
      expect(remaining.items.map((e:StorageEntry)=>e.name)).toEqual(['b.mov','c.mov'])
    }
    expect(state.progress.filter((p)=>p.phase==='cleaning').map((p)=>p.entries)).toEqual([0,1,1,2])
    const ledger=new StorageLedger(state.profile);expect(ledger.list()[0]).toEqual(result);ledger.close()
    const restored=new StorageService();await restored.init();restored.register()
    expect((await call('state')).history[0]).toEqual(result)
  })
  it('rescanning one purpose expires only that purpose',async()=>{
    const service=new StorageService();service.register()
    const large=await service.scan({mode:'large'}),duplicates=await service.scan({mode:'duplicates'})
    await service.scan({mode:'large'})
    await expect(call('large',{generation:large!.generation,minimum:1,search:'',offset:0})).rejects.toThrow(/scan has changed/)
    expect((await call('large',{generation:duplicates!.generation,minimum:1,search:'',offset:0})).count).toBe(3)
    expect(state.engines.filter((engine)=>engine.index)[0].stopped).toBe(true)
    expect(state.engines.filter((engine)=>engine.index)[1].stopped).toBe(false)
  })
  it('trashes a file from analysis, reconciles other scans, and rejects directories or a mismatched purpose',async()=>{
    const service=new StorageService(()=> 'en-US');service.register()
    const analysis=await service.scan({mode:'analysis'}),large=await service.scan({mode:'large'})
    await expect(service.trash({generation:analysis!.generation,ids:[1],kind:'duplicates'})).rejects.toThrow('another scan')
    const engine=state.engines.find((engine)=>engine.index?.mode==='analysis')
    engine.entries.push({...engine.entries[0],id:4,directory:true})
    await expect(service.trash({generation:analysis!.generation,ids:[4],kind:'analysis'})).rejects.toThrow('protected')
    const result=await service.trash({generation:analysis!.generation,ids:[1],kind:'analysis'})
    expect(result).toMatchObject({kind:'analysis',items:1,bytes:2048,failures:0})
    expect((await call('large',{generation:large!.generation,minimum:1,search:'',offset:0})).count).toBe(2)
  })
  it('marks system files read-only during analysis and rejects removal with a localized explanation',async()=>{
    const service=new StorageService();service.register();const index=await service.scan({mode:'analysis'}),engine=state.engines.find((engine)=>engine.index)
    engine.entries.push({...engine.entries[0],id:4,path:'/private/var/db/fixture',name:'fixture'})
    const result=await call('children',{generation:index!.generation,id:0})
    expect(result.items.find((entry:StorageEntry)=>entry.id===4).trashable).toBe(false)
    expect(result.items.find((entry:StorageEntry)=>entry.id===1).trashable).toBe(true)
    await expect(service.trash({generation:index!.generation,ids:[4],kind:'analysis'})).rejects.toThrow('受保护')
    expect((await call('state')).history).toEqual([])
  })
  it('finishes privacy cleanup during a file scan without publishing deleted entries afterward',async()=>{
    const service=new StorageService();service.register();let release!:()=>void
    state.scanGate=new Promise<void>((resolve)=>{release=resolve})
    const target=path.join(state.root,'b.mov'),stat=await lstat(target),id=crypto.randomUUID()
    ;(service as any).rules.set(id,{item:{id,path:target,paths:[target],size:2048,category:'privacy',nameKey:'recent',effectKey:'recent'},snapshots:[{path:target,dev:stat.dev,ino:stat.ino,modified:stat.mtimeMs,size:stat.size,directory:false}]})
    const scanning=service.scan({mode:'large'})
    try{
      await vi.waitFor(()=>expect(state.engines.some((engine)=>engine.index)).toBe(true))
      const cleaned=await service.clean([id]);expect(cleaned.items).toBe(1)
      expect((service as any).activeEngines.has('large')).toBe(true)
    }finally{state.scanGate=null;release()}
    const index=await scanning
    expect((await call('large',{generation:index!.generation,minimum:1,search:'',offset:0})).items.map((entry:StorageEntry)=>entry.name)).toEqual(['a.mov','c.mov'])
  })
  it('filters a hashing reply when an independent cleanup removed one of its copies',async()=>{
    const service=new StorageService();service.register();const index=await service.scan({mode:'duplicates'});let release!:()=>void
    state.hashGate=new Promise<void>((resolve)=>{release=resolve})
    const target=path.join(state.root,'b.mov'),stat=await lstat(target),id=crypto.randomUUID()
    ;(service as any).rules.set(id,{item:{id,path:target,paths:[target],size:2048,category:'privacy',nameKey:'recent',effectKey:'recent'},snapshots:[{path:target,dev:stat.dev,ino:stat.ino,modified:stat.mtimeMs,size:stat.size,directory:false}]})
    const hashing=call('duplicates',{generation:index!.generation,minimum:10*1024**2})
    try{await vi.waitFor(()=>expect((service as any).activeEngines.has('duplicates')).toBe(true));expect((await service.clean([id])).items).toBe(1)}finally{state.hashGate=null;release()}
    expect((await hashing).groups).toEqual([])
  })
  it('preflights all duplicate groups before a batch and keeps each survivor',async()=>{
    const service=new StorageService();service.register();const index=await service.scan({mode:'duplicates'})
    const engine=state.engines.find((engine)=>engine.index),extra={...engine.entries[2],id:4,name:'d.mov',path:path.join(state.root,'d.mov')}
    await writeFile(extra.path,Buffer.alloc(2048));engine.entries.push(extra)
    const session=(service as any).sessions.get('duplicates')
    session.groups=new Map([['hash-a',{id:'hash-a',files:engine.entries.slice(0,2),reclaimable:2048}],['hash-b',{id:'hash-b',files:engine.entries.slice(2),reclaimable:2048}]])
    state.hashes.set(3,'hash-b');state.hashes.set(4,'changed')
    await expect(service.trash({generation:index!.generation,ids:[2,4],kind:'duplicates'})).rejects.toThrow('contents changed')
    expect((await call('state')).history).toEqual([])
    await expect(service.trash({generation:index!.generation,ids:[2,3,4],kind:'duplicates'})).rejects.toThrow('Keep at least one')
    state.hashes.set(4,'hash-b')
    const result=await service.trash({generation:index!.generation,ids:[2,4],kind:'duplicates'})
    expect(result).toMatchObject({items:2,failures:0,locations:[path.join(state.root,'b.mov'),extra.path]})
    expect(engine.entries.map((entry:StorageEntry)=>entry.id)).toEqual([1,3])
  })
  it('requires the browser to exit before removing a cookie database and its sidecars, preserving passwords and bookmarks',async()=>{
    const service=new StorageService(()=> 'en-US');service.register();const target=path.join(state.root,'Cookies'),paths=[target,target+'-wal',target+'-shm']
    for(const filename of [...paths,path.join(state.root,'Login Data'),path.join(state.root,'Bookmarks')])await writeFile(filename,'owned fixture')
    const snapshots=await Promise.all(paths.map(async(filename)=>{const stat=await lstat(filename);return {path:filename,dev:stat.dev,ino:stat.ino,modified:stat.mtimeMs,size:stat.size,directory:false}})),id=crypto.randomUUID()
    ;(service as any).rules.set(id,{item:{id,path:target,paths,size:39,category:'privacy',nameKey:'privacyCookies',effectKey:'accounts'},snapshots,browser:'Fixture Browser'})
    state.processCommands=['/Applications/Fixture Browser.app/Contents/MacOS/Fixture Browser']
    await expect(service.clean([id])).rejects.toThrow('Close Fixture Browser')
    expect((await call('state')).history).toEqual([]);for(const filename of paths)expect(await readFile(filename,'utf8')).toBe('owned fixture')
    state.processCommands=[];expect((await service.clean([id])).items).toBe(1)
    for(const filename of paths)await expect(lstat(filename)).rejects.toThrow()
    expect(await readFile(path.join(state.root,'Login Data'),'utf8')).toBe('owned fixture');expect(await readFile(path.join(state.root,'Bookmarks'),'utf8')).toBe('owned fixture')
  })
  it('registers only inspected descendants, rejects redirects and requires the whole app for uninstall',async()=>{
    const service=new StorageService();service.register()
    const applicationPath=path.join(state.root,'Fixture.app'),contents=path.join(applicationPath,'Contents')
    await mkdir(contents,{recursive:true});await writeFile(path.join(contents,'data.bin'),'fixture')
    if(process.platform!=='win32')await symlink(state.profile,path.join(applicationPath,'redirect'))
    const id=crypto.randomUUID()
    const application={id,name:'Fixture',version:'1',location:applicationPath,bundleId:null,size:2048,protected:false,method:'trash' as const}
    ;(service as unknown as {applications:Map<string,typeof application>}).applications.set(id,application)
    expect((await service.listApplications(false))[0].id).toBe(id)
    const roots=await service.inspectApplication(id),children=await service.relatedChildren({id:roots[0].id})
    expect(children.items.map((f)=>f.path)).toEqual([contents])
    expect(children.items[0].parentId).toBe(roots[0].id)
    await expect(service.uninstall({applicationId:id,ids:[children.items[0].id]})).rejects.toThrow(/Select the application/)
    await expect(service.relatedChildren({id:crypto.randomUUID()})).rejects.toThrow(/expired/)
    const result=await service.uninstall({applicationId:id,ids:[roots[0].id,children.items[0].id,roots[0].id]})
    expect(result).toMatchObject({items:1,failures:0,locations:[applicationPath]})
  })
  it('keeps the app removable when related file measurement fails, but rejects system applications',async()=>{
    const service=new StorageService();service.register();const id=crypto.randomUUID()
    const applicationPath=path.join(state.root,'UnreadableData.app'),bundle='test.memento.'+crypto.randomUUID(),cache=path.join(os.homedir(),'Library/Caches',bundle)
    await mkdir(applicationPath);await mkdir(cache,{recursive:true});await writeFile(path.join(cache,'fixture.log'),'fixture')
    const application={id,name:'Fixture',version:'1',location:applicationPath,bundleId:bundle,size:2048,protected:false,method:'trash' as const,system:false}
    ;(service as any).applications.set(id,application)
    vi.spyOn((service as any).engine,'request').mockRejectedValue(new Error('Measurement failed'))
    try{
      const files=await service.inspectApplication(id)
      expect(files).toMatchObject([{kind:'application',path:applicationPath,size:2048}])
      application.system=true;await expect(service.uninstall({applicationId:id,ids:[files[0].id]})).rejects.toThrow('protected')
      application.system=false;expect(await service.uninstall({applicationId:id,ids:[files[0].id]})).toMatchObject({items:1,failures:0})
      expect(await readFile(path.join(cache,'fixture.log'),'utf8')).toBe('fixture')
    }finally{await rm(cache,{recursive:true,force:true})}
  })

})
