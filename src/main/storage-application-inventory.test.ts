import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,realpath,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {ApplicationInventoryCache} from './application-inventory-cache'
const fixture=vi.hoisted(()=>({profile:'',location:'',version:'1',calls:0,error:false,measurements:[] as Array<(value:unknown)=>void>}))
vi.mock('electron',()=>({app:{getPath:()=>fixture.profile,on:vi.fn()},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:vi.fn()},shell:{openPath:vi.fn()}}))
vi.mock('./scanner',()=>({
  findApplications:async()=>{fixture.calls++;if(fixture.error)throw new Error('Discovery failed');return fixture.location?[fixture.location]:[]},
  inspectApplication:async(target:string)=>({target,name:'Fixture',version:fixture.version,bundleId:'test.fixture',sizeBytes:12,lastUsedAt:null}),
  discoverApplicationUpdates:async()=>new Map()
}))
vi.mock('./native-engine',()=>({NativeEngine:class{async request(){return new Promise((resolve)=>fixture.measurements.push(resolve))}stop(){}}}))
import {StorageService} from './storage-service'
describe.skipIf(process.platform!=='darwin')('background application inventory',()=>{
  let directory:string,service:StorageService
  beforeEach(async()=>{
    directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-inventory-service-')));fixture.profile=path.join(directory,'profile');fixture.location=path.join(directory,'Fixture.app');fixture.version='1';fixture.calls=0;fixture.error=false;fixture.measurements=[]
    await mkdir(path.join(fixture.location,'Contents'),{recursive:true});await writeFile(path.join(fixture.location,'Contents/Info.plist'),'fixture')
    service=new StorageService(()=>'en-US');await service.init()
  })
  afterEach(async()=>{service.stopApplicationInventory();await rm(directory,{recursive:true,force:true})})
  it('starts discovery before opening Applications, coalesces reads and publishes the list before size measurement finishes',async()=>{
    service.startApplicationInventory()
    const [first,second]=await Promise.all([service.listApplications(),service.listApplications(true)])
    expect(fixture.calls).toBe(3);expect(first[0].id).toBe(second[0].id)
    expect(service.applicationState()).toMatchObject({refreshing:false,measuringSizes:true,applications:[{name:'Fixture',size:12}]})
    fixture.measurements[0]([{path:fixture.location,size:4096,errors:0}])
    await vi.waitFor(()=>expect(service.applicationState().measuringSizes).toBe(false))
    expect(service.applicationState().applications[0].size).toBe(4096)
    await service.listApplications(true)
    expect(fixture.measurements.length).toBe(1);expect(service.applicationState().applications[0].id).toBe(first[0].id)
    fixture.version='2';await writeFile(path.join(fixture.location,'Contents/Info.plist'),'updated application metadata')
    await expect(service.openApplication(first[0].id)).rejects.toThrow('application changed')
    await service.listApplications(true);expect(service.applicationState().applications[0].version).toBe('2')
    fixture.error=true;await expect(service.listApplications(true)).rejects.toThrow('Discovery failed')
    expect(service.applicationState().applications[0].id).toBe(first[0].id)
  })
  it('shows persisted entries immediately but rejects their actions until live discovery registers them',async()=>{
    const application={id:crypto.randomUUID(),name:'Cached',version:'1',location:'/Applications/Cached.app',bundleId:'test.cached',size:1024,protected:false,method:'trash' as const}
    await new ApplicationInventoryCache(path.join(fixture.profile,'application-inventory.json')).write([{application,fingerprint:'old'}],new Date().toISOString())
    await service.init();expect(service.applicationState().applications[0]).toMatchObject({name:'Cached',cached:true})
    expect((await service.listApplications())[0].id).toBe(application.id);expect(fixture.calls).toBe(0)
    fixture.location='';await expect(service.openApplication(application.id)).rejects.toThrow('expired')
    expect(service.applicationState().applications).toEqual([])
  })
})
