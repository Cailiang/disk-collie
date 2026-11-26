import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {StorageEntry,StorageIndex} from '../shared/storage-types'
const state=vi.hoisted(()=>({profile:'',root:'',fail:'',engines:[] as any[],progress:[] as any[],handlers:new Map<string,(event:unknown,input?:unknown)=>any>()}))
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
      return this.index
    }
    if(command==='entry')return this.entries.find((e)=>e.id===args.id)
    if(command==='forget'){this.entries=this.entries.filter((e)=>!args.paths.includes(e.path));return this.index}
    if(command==='large')return {count:this.entries.length,items:this.entries}
    throw new Error(`Unexpected fixture command ${command}`)
  }
  stop(){this.stopped=true}
}}))
import {StorageService} from './storage-service'
const call=(name:string,input?:unknown)=>state.handlers.get(`memento:storage:${name}`)!(null,input)
describe('storage scan sessions and partial cleanup',()=>{
  let fixture:string
  beforeEach(async()=>{
    fixture=await mkdtemp(path.join(os.homedir(),'memento-service-test-'))
    state.root=path.join(fixture,'files');state.profile=path.join(fixture,'profile')
    await mkdir(state.root);for(const name of ['a.mov','b.mov','c.mov'])await writeFile(path.join(state.root,name),Buffer.alloc(2048))
    state.fail='';state.engines=[];state.progress=[];state.handlers.clear()
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
    expect(JSON.parse(await readFile(path.join(state.profile,'storage-history.json'),'utf8'))[0]).toEqual(result)
    const restored=new StorageService();await restored.init();restored.register()
    expect((await call('state')).history[0]).toEqual(result)
  })
  it('rescanning one purpose expires only that purpose',async()=>{
    const service=new StorageService();service.register()
    const large=await service.scan({mode:'large'}),duplicates=await service.scan({mode:'duplicates'})
    await service.scan({mode:'large'})
    expect(()=>call('large',{generation:large!.generation,minimum:1,search:'',offset:0})).toThrow(/scan has changed/)
    expect((await call('large',{generation:duplicates!.generation,minimum:1,search:'',offset:0})).count).toBe(3)
    expect(state.engines[1].stopped).toBe(true)
    expect(state.engines[2].stopped).toBe(false)
  })
})
