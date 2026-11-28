import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {StartupIgnoredItem} from '../shared/startup-types'
export interface StoredStartupIgnore extends StartupIgnoredItem {key:string}
const schema=z.array(z.object({id:z.string().uuid(),key:z.string().min(1).max(20000),name:z.string().max(1000),configuration:z.string().max(10000)})).max(200)
export class StartupIgnoreStore {
  private entries:StoredStartupIgnore[]|null=null
  constructor(private readonly file:string){}
  async list():Promise<StoredStartupIgnore[]> {
    if(this.entries)return this.entries.map(item=>({...item}))
    try{const text=await readFile(this.file,'utf8');if(text.length>4*1024**2)throw new Error('oversized');this.entries=schema.parse(JSON.parse(text))}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')this.entries=[];else throw new Error('startup.ignoreUnavailable')}
    return this.entries.map(item=>({...item}))
  }
  async save(entries:StoredStartupIgnore[]):Promise<void> {
    if(entries.length>200)throw new Error('startup.ignoreLimit')
    const valid=schema.parse(entries),serialized=JSON.stringify(valid),temporary=this.file+'.'+randomUUID()+'.tmp'
    if(serialized.length>4*1024**2)throw new Error('startup.ignoreLimit')
    try{await mkdir(path.dirname(this.file),{recursive:true});await writeFile(temporary,serialized,{mode:0o600,flag:'wx'});await rename(temporary,this.file);this.entries=valid}
    catch{throw new Error('startup.ignoreUnavailable')}
    finally{await rm(temporary,{force:true}).catch(()=>undefined)}
  }
}
