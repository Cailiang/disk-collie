import {lstat,readdir,rm} from 'node:fs/promises'
import path from 'node:path'
import type {PrivacyCapability,PrivacyKind,PrivacyRecord,PrivacyRisk,PrivacyTimeRange} from '../shared/privacy-types'
import type {PrivacyCategory,StorageApplication} from '../shared/storage-types'
export interface PrivacyContext {platform:NodeJS.Platform;home:string;env:NodeJS.ProcessEnv;applications:StorageApplication[]}
export interface PrivacySource {key:string;name:string;bundleIds:string[];iconPaths:string[]}
export interface PrivacyDefinition {key:string;kind:PrivacyKind;category:PrivacyCategory;source:PrivacySource;profile?:string;browser?:string;paths:string[];risk:PrivacyRisk;supportsRange:boolean;recommended?:boolean}
export interface PrivacyOutcome {count:number;size:number;changed:boolean;removedPaths?:string[]}
/** Preserve confirmed removals when a later file in the same resource fails. */
export class PrivacyCleanupError extends Error {
  constructor(readonly outcome:PrivacyOutcome,cause:unknown){super(cause instanceof Error?cause.message:String(cause),{cause})}
}
export interface PrivacySnapshot {
  count:number|null;size:number;capability:PrivacyCapability;limited?:boolean
  preview:(offset:number,limit:number)=>Promise<PrivacyRecord[]>
  validate:()=>Promise<void>
  clean:(progress?:(done:number,total:number)=>void)=>Promise<PrivacyOutcome>
}
export interface PrivacyResource extends PrivacyDefinition {scan:(range:PrivacyTimeRange,until:number)=>Promise<PrivacySnapshot>}
export interface PrivacyPathSnapshot {path:string;dev:number;ino:number;size:number;modified:number;directory:boolean}
export function privacySince(range:PrivacyTimeRange,until:number):number|null {
  if(range==='all')return null
  if(range==='hour')return until-3600000
  if(range==='week')return until-7*86400000
  const date=new Date(until);date.setHours(0,0,0,0);return date.getTime()
}
export function privacyUnavailable(capability:PrivacyCapability):PrivacySnapshot{return {count:capability==='empty'?0:null,size:0,capability,preview:async()=>[],validate:async()=>{throw new Error('privacy.sourceUnavailable')},clean:async()=>{throw new Error('privacy.sourceUnavailable')}}}
export async function privacyPathSnapshot(target:string):Promise<PrivacyPathSnapshot>{
  for(let current=target;;current=path.dirname(current)){
    const value=await lstat(current)
    if(value.isSymbolicLink())throw new Error('privacy.sourceChanged')
    if(path.dirname(current)===current)break
  }
  const value=await lstat(target)
  if(!value.isFile()&&!value.isDirectory())throw new Error('privacy.sourceUnavailable')
  return {path:target,dev:value.dev,ino:value.ino,size:value.size,modified:value.mtimeMs,directory:value.isDirectory()}
}
export async function validatePrivacyPath(old:PrivacyPathSnapshot,identityOnly=false):Promise<void>{
  const current=await privacyPathSnapshot(old.path)
  if(current.dev!==old.dev||current.ino!==old.ino||current.directory!==old.directory||!identityOnly&&(current.modified!==old.modified||!old.directory&&current.size!==old.size))throw new Error('privacy.sourceChanged')
}
export function privacyAccessFailure(error:unknown):boolean{return ['EACCES','EPERM'].includes(String((error as NodeJS.ErrnoException)?.code))}
/** Known cache/session/log roots only; links are never traversed or removed. */
export function privacyFileResource(definition:PrivacyDefinition):PrivacyResource {
  return {...definition,scan:async(range,until)=>{
    if(range!=='all'&&!definition.supportsRange)return privacyUnavailable('range-unsupported')
    const files:PrivacyPathSnapshot[]=[],pending:string[]=[],seen=new Set<string>(),since=privacySince(range,until)
    let limited=false,denied=false,visited=0
    for(const target of definition.paths)try{await privacyPathSnapshot(target);pending.push(target)}catch(error){if(privacyAccessFailure(error))denied=true;else if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as Error).message!=='privacy.sourceChanged')throw error}
    while(pending.length&&visited<100000){
      const batch=pending.splice(Math.max(0,pending.length-32),Math.min(32,100000-visited));visited+=batch.length
      await Promise.all(batch.map(async(target)=>{
        if(seen.has(target))return
        seen.add(target)
        try{
          const value=await lstat(target)
          if(value.isSymbolicLink())return
          if(value.isDirectory()){for(const name of await readdir(target))pending.push(path.join(target,name));return}
          if(value.isFile()&&(since===null||value.mtimeMs>=since)&&value.mtimeMs<=until)files.push({path:target,dev:value.dev,ino:value.ino,size:value.size,modified:value.mtimeMs,directory:false})
        }catch(error){if(privacyAccessFailure(error))denied=true;else if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      }))
    }
    limited=pending.length>0
    files.sort((first,second)=>second.modified-first.modified||first.path.localeCompare(second.path))
    if(denied)return {...privacyUnavailable('permission-required'),count:files.length||null,size:files.reduce((sum,file)=>sum+file.size,0)}
    const size=files.reduce((sum,file)=>sum+file.size,0)
    return {count:files.length,size,capability:files.length?'ready':'empty',limited,
      preview:async(offset,limit)=>files.slice(offset,offset+limit).map((file)=>({id:file.path,title:path.basename(file.path),subtitle:file.path,path:file.path,timestamp:new Date(file.modified).toISOString()})),
      validate:async()=>{for(const file of files)await validatePrivacyPath(file)},
      clean:async(progress)=>{
        for(const file of files)await validatePrivacyPath(file)
        let count=0,bytes=0;const removedPaths:string[]=[]
        try{
          for(const file of files){
            await validatePrivacyPath(file);await rm(file.path)
            try{await lstat(file.path);throw new Error('privacy.verificationFailed')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
            count++;bytes+=file.size;removedPaths.push(file.path);progress?.(count,files.length)
          }
        }catch(error){if(count)throw new PrivacyCleanupError({count,size:bytes,changed:true,removedPaths},error);throw error}
        return {count,size:bytes,changed:count>0,removedPaths}
      }
    }
  }}
}
