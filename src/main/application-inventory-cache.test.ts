import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {ApplicationInventoryCache} from './application-inventory-cache'
describe('application inventory cache',()=>{
  it('restores display entries as unverified and serializes writes without persisting update authorizations',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'diskcollie-inventory-'))
    try{
      const filename=path.join(directory,'cache.json'),cache=new ApplicationInventoryCache(filename)
      const application={id:crypto.randomUUID(),name:'Fixture',location:'/Applications/Fixture.app',bundleId:'test.fixture',version:'1',size:12,protected:false,method:'trash' as const,updateAvailable:true}
      await Promise.all([cache.write([{application,fingerprint:'first'}],'2026-11-26T00:00:00.000Z'),cache.write([{application:{...application,version:'2'},fingerprint:'second'}],'2026-11-26T00:01:00.000Z')])
      const restored=await cache.read();expect(restored?.updatedAt).toBe('2026-11-26T00:01:00.000Z');expect(restored?.entries[0].application).toMatchObject({version:'2',cached:true});expect(restored?.entries[0].application.updateAvailable).toBeUndefined()
      expect(await new ApplicationInventoryCache(filename,'other' as NodeJS.Platform).read()).toBeNull()
      await writeFile(filename,'{"entries":"invalid"}');expect(await cache.read()).toBeNull()
    }finally{await rm(directory,{recursive:true,force:true})}
  })
})
