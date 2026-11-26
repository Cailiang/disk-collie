import {isScanPathExcluded} from '../shared/scan-exclusions'
import {lstat,readdir,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import type {DeepCleanFile,DeepCleanStatus} from '../shared/deep-clean-types'
import {assertDeepNotCancelled} from './deep-clean-context'
import {PrivacyCleanupError,privacyAccessFailure,privacyPathSnapshot,validatePrivacyPath,type PrivacyOutcome,type PrivacyPathSnapshot} from './privacy-resource'

export interface DeepCleanSnapshot {
  count:number
  size:number
  modified:number|null
  status:DeepCleanStatus
  files:DeepCleanFile[]
  validate:()=>Promise<void>
  clean:(progress?:(done:number,total:number)=>void)=>Promise<PrivacyOutcome>
}
export interface DeepFileOptions {excludedPaths?:string[];olderThanDays?:number;pattern?:RegExp;readOnly?:boolean;maximumFiles?:number;signal?:AbortSignal}
const protectedNames=new Set(['.git','.svn','.hg','.ssh','.aws','.azure','.kube','.gnupg','keychains','.env','.env.local','.env.production','auth.json','credentials.json','credentials','config.json','settings.json','history.jsonl'])
export function deepProtectedName(name:string):boolean{return protectedNames.has(name.toLowerCase())||/^id_(rsa|ed25519|ecdsa)(\.pub)?$/i.test(name)||/\.(pem|p12|pfx|mobileprovision|key)$/i.test(name)}
export async function deepFileSnapshot(root:string,until:number,options:DeepFileOptions={}):Promise<DeepCleanSnapshot>{
  assertDeepNotCancelled(options.signal)
  const captured:Array<PrivacyPathSnapshot&{id:string}>=[],files:DeepCleanFile[]=[],pending=[root],seen=new Set<string>()
  let denied=false,failed=false,visited=0,maximumModified:number|null=null
  const max=options.maximumFiles??150000,threshold=options.olderThanDays===undefined?until:until-options.olderThanDays*86400000
  try{await privacyPathSnapshot(root)}catch(error){
    const status:DeepCleanStatus=privacyAccessFailure(error)?'permission-required':(error as NodeJS.ErrnoException).code==='ENOENT'?'empty':'unavailable'
    return {count:0,size:0,modified:null,status,files:[],validate:async()=>{throw new Error('deep.sourceUnavailable')},clean:async()=>{throw new Error('deep.sourceUnavailable')}}
  }
  while(pending.length&&visited<max){
    assertDeepNotCancelled(options.signal)
    const batch=pending.splice(Math.max(0,pending.length-32),Math.min(32,max-visited));visited+=batch.length
    await Promise.all(batch.map(async(target)=>{
      if(seen.has(target)||isScanPathExcluded(target,options.excludedPaths))return;seen.add(target)
      if(target!==root&&deepProtectedName(path.basename(target)))return
      try{
        const value=await lstat(target)
        if(value.isSymbolicLink()){failed=true;return}
        if(!value.isDirectory()&&!value.isFile()){failed=true;return}
        if(value.isDirectory()){
          for(const entry of await readdir(target))if(!deepProtectedName(entry))pending.push(path.join(target,entry))
          return
        }
        if(!options.readOnly&&value.mtimeMs>threshold||options.pattern&&!options.pattern.test(path.basename(target)))return
        const id=randomUUID(),snapshot={path:target,dev:value.dev,ino:value.ino,size:value.size,modified:value.mtimeMs,directory:false,id}
        captured.push(snapshot);files.push({id,name:path.basename(target),path:target,size:value.size,modified:value.mtimeMs})
        maximumModified=Math.max(maximumModified||0,value.mtimeMs)
      }catch(error){if(privacyAccessFailure(error))denied=true;else if((error as NodeJS.ErrnoException).code!=='ENOENT')failed=true}
    }))
  }
  captured.sort((a,b)=>a.path.localeCompare(b.path))
  files.sort((a,b)=>b.size-a.size||a.path.localeCompare(b.path))
  const size=captured.reduce((sum,file)=>sum+file.size,0),status:DeepCleanStatus=denied?'permission-required':pending.length||failed?'limited':options.readOnly?'review-only':files.length?'ready':'empty'
  const validate=async():Promise<void>=>{
    if(!['ready','empty'].includes(status))throw new Error('deep.sourceUnavailable')
    for(const file of captured)try{await validatePrivacyPath(file)}catch{throw new Error('deep.sourceChanged')}
  }
  return {count:files.length,size,modified:maximumModified,status,files,validate,
    clean:async(progress)=>{
      await validate();let count=0,bytes=0;const removedPaths:string[]=[]
      try{
        for(const file of captured){
          try{await validatePrivacyPath(file)}catch{throw new Error('deep.sourceChanged')}
          await rm(file.path)
          try{await lstat(file.path);throw new Error('deep.verificationFailed')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
          count++;bytes+=file.size;removedPaths.push(file.path);progress?.(count,captured.length)
        }
      }catch(error){if(count)throw new PrivacyCleanupError({count,size:bytes,changed:true,removedPaths},error);throw error}
      return {count,size:bytes,changed:count>0,removedPaths}
    }
  }
}
