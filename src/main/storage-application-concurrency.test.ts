import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,realpath,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {StorageApplication} from '../shared/storage-types'
import type {ApplicationUpdate} from './scanner'
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
const state=vi.hoisted(()=>({profile:'',locations:[] as string[],versions:new Map<string,string>(),install:vi.fn(),discover:vi.fn(),open:vi.fn(),trash:vi.fn()}))
vi.mock('electron',()=>({app:{getPath:()=>state.profile,on:vi.fn()},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:vi.fn()},shell:{openPath:state.open,openExternal:vi.fn(),trashItem:state.trash}}))
vi.mock('./scanner',()=>({
  findApplications:async()=>state.locations,
  inspectApplication:async(target:string)=>({target,name:path.basename(target,'.app'),version:state.versions.get(target)||'1',bundleId:`dev.memento.${path.basename(target,'.app')}`,sizeBytes:1024,lastUsedAt:null}),
  discoverApplicationUpdates:state.discover
}))
vi.mock('./storage-application-actions',()=>({updateRegisteredApplication:state.install}))
vi.mock('./native-engine',()=>({NativeEngine:class{async request(command:string,args:{paths?:string[]}={}){if(command==='system')return {processes:[],processNames:[],processCommands:[]};if(command==='measure')return (args.paths||[]).map((target)=>({path:target,size:1024,errors:0}));throw new Error(`Unexpected fixture request ${command}`)}stop(){}}}))
import {StorageService} from './storage-service'

describe.skipIf(process.platform!=='darwin')('production application update concurrency',()=>{
  let directory:string,service:StorageService,apps:StorageApplication[]
  const update:ApplicationUpdate={source:'sparkle',token:'https://updates.fixture/feed',downloadUrl:'https://updates.fixture/app.zip',mode:'direct',latestVersion:'2'}
  beforeEach(async()=>{
    directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-app-updates-')));state.profile=path.join(directory,'profile');state.locations=[];state.versions.clear();vi.clearAllMocks();state.open.mockResolvedValue('');state.trash.mockResolvedValue(undefined)
    apps=[]
    for(const name of ['A','B','C']){
      const location=path.join(directory,`${name}.app`);await mkdir(path.join(location,'Contents'),{recursive:true});await writeFile(path.join(location,'Contents/Info.plist'),'owned synthetic application')
      apps.push({id:crypto.randomUUID(),name,version:'1',location,bundleId:`dev.memento.${name}`,size:1024,protected:false,method:'trash',updateAvailable:true,latestVersion:'2'});state.locations.push(location);state.versions.set(location,'1')
    }
    service=new StorageService(()=>'en-US')
    ;(service as any).persistApplications=async()=>undefined
    for(const application of apps){(service as any).applications.set(application.id,{...application});(service as any).metadata.set(application.id,{target:application.location,name:application.name,version:'1',bundleId:application.bundleId,sizeBytes:1024,lastUsedAt:null});(service as any).updates.set(application.id,{...update})}
    state.discover.mockResolvedValue(new Map(apps.map((application)=>[application.location,{...update}])))
  })
  afterEach(async()=>{service.stopApplicationInventory();await rm(directory,{recursive:true,force:true})})
  const installed=(id:string)=>service.applicationState().applications.find((application)=>application.id===id)
  it('starts two real update adapters concurrently, coalesces the same app, and keeps other app reads available',async()=>{
    const first=deferred<{status:'updated'}>(),second=deferred<{status:'updated'}>()
    state.install.mockImplementation((target:string)=>target===apps[0].location?first.promise:second.promise)
    const a=service.updateApplication(apps[0].id),duplicate=service.updateApplication(apps[0].id),b=service.updateApplication(apps[1].id)
    await vi.waitFor(()=>expect(state.install).toHaveBeenCalledTimes(2))
    expect(state.install.mock.calls.map(([target])=>target).sort()).toEqual([apps[0].location,apps[1].location].sort())
    await service.openApplication(apps[2].id);expect(state.open).toHaveBeenCalledWith(apps[2].location)
    const checked=await service.checkApplicationUpdates();expect(checked).toHaveLength(3)
    state.versions.set(apps[1].location,'2');second.resolve({status:'updated'});expect((await b).status).toBe('updated')
    expect(installed(apps[1].id)).toMatchObject({version:'2',updateAvailable:false});expect(installed(apps[0].id)).toMatchObject({version:'1'})
    state.versions.set(apps[0].location,'2');first.resolve({status:'updated'});await Promise.all([a,duplicate])
    expect(state.install).toHaveBeenCalledTimes(2);expect(installed(apps[0].id)).toMatchObject({version:'2',updateAvailable:false});expect(installed(apps[1].id)).toMatchObject({version:'2',updateAvailable:false})
  })
  it('rejects uninstalling an app being updated without blocking unrelated updates',async()=>{
    const first=deferred<{status:'updated'}>();state.install.mockImplementation((target:string)=>target===apps[0].location?first.promise:Promise.resolve({status:'updated'}))
    const updating=service.updateApplication(apps[0].id);await vi.waitFor(()=>expect(state.install).toHaveBeenCalledTimes(1))
    await expect(service.uninstall({applicationId:apps[0].id,ids:[]})).rejects.toThrow(/progress|operation|updat/i);expect(state.trash).not.toHaveBeenCalled()
    state.versions.set(apps[1].location,'2');await service.updateApplication(apps[1].id);expect(installed(apps[1].id)?.version).toBe('2')
    state.versions.set(apps[0].location,'2');first.resolve({status:'updated'});await updating
  })
  it('isolates an updater failure, preserves its registration and allows retry while another app completes',async()=>{
    const first=deferred<{status:'updated'}>(),second=deferred<{status:'updated'}>();state.install.mockImplementation((target:string)=>target===apps[0].location?first.promise:second.promise)
    const a=service.updateApplication(apps[0].id),b=service.updateApplication(apps[1].id);await vi.waitFor(()=>expect(state.install).toHaveBeenCalledTimes(2))
    const failed=expect(a).rejects.toThrow('owned fixture download failure');first.reject(new Error('owned fixture download failure'));await failed
    expect(installed(apps[0].id)).toMatchObject({version:'1',updateAvailable:true})
    state.versions.set(apps[1].location,'2');second.resolve({status:'updated'});await b
    state.install.mockResolvedValue({status:'updated'});state.versions.set(apps[0].location,'2');await service.updateApplication(apps[0].id)
    expect(installed(apps[0].id)).toMatchObject({version:'2',updateAvailable:false});expect(installed(apps[1].id)).toMatchObject({version:'2',updateAvailable:false})
  })
  it('does not let an update check started on an older version restore its stale update offer',async()=>{
    const checking=deferred<Map<string,ApplicationUpdate>>(),updating=deferred<{status:'updated'}>();state.discover.mockReturnValue(checking.promise);state.install.mockReturnValue(updating.promise)
    const check=service.checkApplicationUpdates();await vi.waitFor(()=>expect(state.discover).toHaveBeenCalledTimes(1))
    const install=service.updateApplication(apps[0].id);await vi.waitFor(()=>expect(state.install).toHaveBeenCalledTimes(1))
    state.versions.set(apps[0].location,'2');updating.resolve({status:'updated'});await install
    checking.resolve(new Map(apps.map((application)=>[application.location,{...update}])));await check
    expect(installed(apps[0].id)).toMatchObject({version:'2',updateAvailable:false,latestVersion:null});expect(installed(apps[1].id)?.updateAvailable).toBe(true)
  })
  it('keeps an active app registered when inventory discovery misses its bundle during replacement',async()=>{
    const gate=deferred<{status:'updated'}>();state.install.mockReturnValue(gate.promise)
    const updating=service.updateApplication(apps[0].id);await vi.waitFor(()=>expect(state.install).toHaveBeenCalledTimes(1))
    state.locations=apps.slice(1).map((application)=>application.location)
    await service.listApplications(true);expect(installed(apps[0].id)).toMatchObject({id:apps[0].id,location:apps[0].location})
    state.versions.set(apps[0].location,'2');gate.resolve({status:'updated'});await updating
    expect(installed(apps[0].id)).toMatchObject({version:'2',updateAvailable:false})
  })
})
