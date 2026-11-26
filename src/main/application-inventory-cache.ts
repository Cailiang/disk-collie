import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'
import type {StorageApplication} from '../shared/storage-types'

const application=z.object({id:z.string().uuid(),name:z.string(),version:z.string(),location:z.string(),bundleId:z.string().nullable(),size:z.number().finite().nonnegative(),protected:z.boolean(),method:z.enum(['trash','system']),system:z.boolean().optional(),lastUsedAt:z.string().datetime().nullable().optional(),iconPath:z.string().optional()})
const schema=z.object({version:z.literal(1),platform:z.string(),updatedAt:z.string().datetime(),entries:z.array(z.object({application,fingerprint:z.string()})).max(10000)})
export interface CachedApplication {application:StorageApplication;fingerprint:string}

/** Presentation cache only: restored entries require live registration before actions. */
export class ApplicationInventoryCache {
  private saving:Promise<void>=Promise.resolve()
  constructor(private readonly filename:string,private readonly platform=process.platform){}
  async read():Promise<{updatedAt:string;entries:CachedApplication[]}|null> {
    try {
      const value=schema.parse(JSON.parse(await readFile(this.filename,'utf8')))
      if(value.platform!==this.platform)return null
      return {updatedAt:value.updatedAt,entries:value.entries.map((entry)=>({...entry,application:{...entry.application,cached:true}}))}
    }catch{return null}
  }
  write(entries:CachedApplication[],updatedAt:string):Promise<void> {
    const data=JSON.stringify({version:1,platform:this.platform,updatedAt,entries:entries.map((entry)=>({application:application.parse(entry.application),fingerprint:entry.fingerprint}))})
    const next=this.saving.catch(()=>undefined).then(async()=>{
      await mkdir(path.dirname(this.filename),{recursive:true})
      await writeFile(this.filename+'.tmp',data,{mode:0o600})
      await rename(this.filename+'.tmp',this.filename)
    })
    this.saving=next
    return next
  }
}
