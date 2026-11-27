import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {lstat,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {StorageEntry,StorageIndex,StorageMode} from '../shared/storage-types'
const state=vi.hoisted(()=>({home:'',profile:'',trash:'',fail:false,calls:[] as string[],excluded:[] as string[],handlers:new Map<string,(event:unknown,input:unknown)=>Promise<any>>()}))
vi.mock('electron',()=>({
  app:{getPath:()=>state.profile,on:vi.fn()},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:(name:string,handler:any)=>state.handlers.set(name,handler)},
  shell:{trashItem:vi.fn(async(target:string)=>{state.calls.push(target);if(state.fail)throw new Error('Owned Trash failure');await rename(target,path.join(state.trash,path.basename(target)))}),showItemInFolder:vi.fn()}
}))
vi.mock('./native-engine',()=>({NativeEngine:class{async request(){throw new Error('Unexpected unused native request')}stop(){}}}))
import {StorageService} from './storage-service'
import {StorageLedger} from './storage-ledger'
let service:StorageService,folder:string,entries:StorageEntry[]
const inside=(target:string,root:string)=>target===root||target.startsWith(root+path.sep)
function session(mode:StorageMode,generation:number){
  const remaining=[...entries],index:StorageIndex={generation,mode,root:{...entries[0],id:0,path:state.home,name:'Owned fixture',parent:null},entries:remaining.length+1,errors:0,skipped:0,limited:false,elapsedMs:0}
  const engine={request:async(command:string,args:any):Promise<any>=>{
    if(command==='entry'){const value=remaining.find((entry)=>entry.id===args.id);if(!value)throw new Error('Entry is no longer available');return value}
    if(command==='children')return {parent:index.root,items:remaining}
    if(command==='forget'){for(let position=remaining.length-1;position>=0;position--)if(args.paths.some((root:string)=>inside(remaining[position].path,root)))remaining.splice(position,1);index.entries=remaining.length+1;return index}
    if(command==='large')return {items:remaining.filter((entry)=>!entry.directory),count:remaining.filter((entry)=>!entry.directory).length}
    throw new Error('Unexpected fixture request '+command)
  }}
  const value={index,engine,groups:new Map(),removed:new Set()};(service as any).sessions.set(mode,value);return value
}
beforeEach(async()=>{
  state.home=await mkdtemp(path.join(os.homedir(),'diskcollie-directory-service-'));state.profile=path.join(state.home,'profile');state.trash=path.join(state.home,'owned-trash');state.fail=false;state.calls=[];state.excluded=[];state.handlers.clear()
  folder=path.join(state.home,'Downloads/archive');await mkdir(path.join(folder,'.hidden'),{recursive:true});await mkdir(state.trash)
  await writeFile(path.join(folder,'visible.txt'),'visible');await writeFile(path.join(folder,'.hidden/extra.txt'),'hidden')
  entries=await Promise.all([folder,path.join(folder,'visible.txt'),path.join(folder,'.hidden'),path.join(folder,'.hidden/extra.txt')].map(async(target,index)=>{const stat=await lstat(target);return {id:index+1,parent:index===0?0:index===3?3:1,path:target,name:path.basename(target),directory:stat.isDirectory(),size:stat.isDirectory()?13:stat.size,allocated:stat.isDirectory()?8192:stat.blocks*512,modified:stat.mtimeMs*1e6,identity:`${stat.dev}:${stat.ino}`,links:stat.nlink}}))
  service=new StorageService(()=>'en-US',()=>state.excluded);await service.init();service.register()
})
afterEach(async()=>{await rm(state.home,{recursive:true,force:true})})
describe('registered directory Trash plans',()=>{
  it('reviews the complete hidden tree, requires its exact token, and reconciles every retained index after Trash',async()=>{
    const analysis=session('analysis',31),large=session('large',32)
    const plan=await service.directoryPlan({generation:31,id:1})
    expect(plan).toMatchObject({generation:31,entryId:1,path:folder,size:13,files:2,directories:1,hiddenFiles:1})
    await expect(service.trash({generation:31,ids:[1],kind:'analysis'})).rejects.toThrow()
    await expect(service.trash({generation:31,ids:[1],kind:'analysis',directoryPlanId:crypto.randomUUID()})).rejects.toThrow()
    expect(state.calls).toEqual([])
    const result=await service.trash({generation:31,ids:[1],kind:'analysis',directoryPlanId:plan.id})
    expect(result).toMatchObject({kind:'analysis',items:1,bytes:plan.allocated,failures:0,locations:[folder],removedPaths:[folder]})
    expect(state.calls).toEqual([folder]);expect((await analysis.engine.request('large',{})).count).toBe(0);expect((await large.engine.request('large',{})).count).toBe(0)
    expect(await readFile(path.join(state.trash,'archive/.hidden/extra.txt'),'utf8')).toBe('hidden')
    const ledger=new StorageLedger(state.profile);expect(ledger.list()[0]).toEqual(result);ledger.close()
  })
  it('rejects directory plans from other purposes, different targets and expired generations before any Trash call',async()=>{
    session('analysis',41);session('large',42)
    await expect(service.directoryPlan({generation:42,id:1})).rejects.toThrow()
    const plan=await service.directoryPlan({generation:41,id:1})
    await expect(service.trash({generation:41,ids:[3],kind:'analysis',directoryPlanId:plan.id})).rejects.toThrow()
    await expect(service.trash({generation:42,ids:[1],kind:'large',directoryPlanId:plan.id})).rejects.toThrow()
    session('analysis',43)
    await expect(service.trash({generation:41,ids:[1],kind:'analysis',directoryPlanId:plan.id})).rejects.toThrow()
    expect(state.calls).toEqual([])
  })
  it('rejects a changed hidden descendant before journaling or moving the reviewed folder',async()=>{
    session('analysis',51)
    const plan=await service.directoryPlan({generation:51,id:1})
    await writeFile(path.join(folder,'.hidden/after-review.txt'),'must remain')
    await expect(service.trash({generation:51,ids:[1],kind:'analysis',directoryPlanId:plan.id})).rejects.toThrow('storage.directoryChanged')
    expect(state.calls).toEqual([]);expect((service as any).history).toEqual([])
    expect(await readFile(path.join(folder,'.hidden/after-review.txt'),'utf8')).toBe('must remain')
  })
  it('retains the directory and index when the OS Trash operation fails',async()=>{
    const analysis=session('analysis',61),plan=await service.directoryPlan({generation:61,id:1});state.fail=true
    const result=await service.trash({generation:61,ids:[1],kind:'analysis',directoryPlanId:plan.id})
    expect(result).toMatchObject({items:0,bytes:0,failures:1,removedPaths:[],locations:[]})
    expect((await analysis.engine.request('large',{})).count).toBe(2)
    expect(await readFile(path.join(folder,'visible.txt'),'utf8')).toBe('visible')
  })
  it('honors new scan exclusions and explicit plan invalidation after review',async()=>{
    session('analysis',71);state.excluded=[path.join(folder,'.hidden')]
    await expect(service.directoryPlan({generation:71,id:1})).rejects.toThrow()
    state.excluded=[];const plan=await service.directoryPlan({generation:71,id:1})
    state.excluded=[path.join(folder,'.hidden')]
    await expect(service.trash({generation:71,ids:[1],kind:'analysis',directoryPlanId:plan.id})).rejects.toThrow()
    expect(state.calls).toEqual([]);expect((service as any).history).toEqual([])
    state.excluded=[];const refreshed=await service.directoryPlan({generation:71,id:1});service.invalidateDirectoryPlan()
    await expect(service.trash({generation:71,ids:[1],kind:'analysis',directoryPlanId:refreshed.id})).rejects.toThrow()
    expect(state.calls).toEqual([])
  })
  it('rechecks exclusions immediately before the OS move even when settings change after preflight',async()=>{
    session('analysis',81);const plan=await service.directoryPlan({generation:81,id:1})
    const save=(service as any).save.bind(service)
    vi.spyOn(service as any,'save').mockImplementation(async()=>{state.excluded=[path.join(folder,'.hidden')];await save()})
    const result=await service.trash({generation:81,ids:[1],kind:'analysis',directoryPlanId:plan.id})
    expect(result).toMatchObject({items:0,bytes:0,failures:1,removedPaths:[]})
    expect(state.calls).toEqual([]);expect(await readFile(path.join(folder,'.hidden/extra.txt'),'utf8')).toBe('hidden')
  })
})
