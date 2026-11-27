import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {lstat,mkdtemp,mkdir,readFile,realpath,rm,truncate,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {DeepCleanService} from './deep-clean-service'
import type {DeepCleanContext} from './deep-clean-context'
import type {StorageApplication} from '../shared/storage-types'
let home:string
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'diskcollie-deep-readonly-')))})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function file(relative:string,content:string|Buffer):Promise<string>{const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);await utimes(target,new Date(Date.now()-10000),new Date(Date.now()-10000));return target}
const context=(applications:StorageApplication[]=[]):DeepCleanContext=>({home,platform:'darwin',env:{},applications})
describe('unsupported cleanup source exclusions',()=>{
  it('omits application architecture analysis and preserves signed binaries',async()=>{
    const header=Buffer.alloc(16);header.writeUInt32BE(0xcafebabe);header.writeUInt32BE(2,4)
    const binary=await file('Applications/Fixture.app/Contents/MacOS/Fixture',header)
    const java=Buffer.from(header);java.writeUInt32BE(61,4);await file('Applications/Fixture.app/Contents/MacOS/java-class',java)
    const application:StorageApplication={id:crypto.randomUUID(),name:'Fixture',version:'1',bundleId:'dev.fixture',location:path.join(home,'Applications/Fixture.app'),size:32,protected:false,method:'trash'}
    const service=new DeepCleanService(),scan=await service.scan(context([application])),item=scan.items.find((item)=>item.group==='application-optimization')
    expect(item).toBeUndefined()
    expect(await readFile(binary)).toEqual(header)
  })
  it('omits container disks and keys from cleanup discovery',async()=>{
    const docker=await file('Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw','disk header');await truncate(docker,16*1024*1024)
    const podman=await file('.local/share/containers/podman/machine/applehv/default.raw','podman disk'),key=await file('.local/share/containers/podman/machine/applehv/id_ed25519','PRIVATE SSH KEY')
    const service=new DeepCleanService(),scan=await service.scan(context()),disks=scan.items.filter((item)=>['docker-virtual-storage','podman-virtual-storage'].includes(item.key))
    expect(disks).toEqual([])
    expect(await readFile(key,'utf8')).toBe('PRIVATE SSH KEY');expect((await lstat(docker)).size).toBe(16*1024*1024)
  })
})
