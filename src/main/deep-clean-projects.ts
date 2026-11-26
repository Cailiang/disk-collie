import {lstat,readdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import type {DeepCleanFile} from '../shared/deep-clean-types'
import {privacyAccessFailure,privacyPathSnapshot,validatePrivacyPath,type PrivacyPathSnapshot} from './privacy-resource'
import {validateProjectArtifactCleanupTarget,type ProjectArtifact} from './project-artifacts'
import {assertDeepNotCancelled} from './deep-clean-context'
import type {DeepCleanSnapshot} from './deep-clean-resource'

interface CapturedProjectPath extends PrivacyPathSnapshot {link:boolean}
const protectedName=(name:string):boolean=>name==='.git'||name==='.hg'||name==='.svn'||name==='.ssh'||name==='.aws'||name==='.gnupg'||/^\.env(?:\.|$)/i.test(name)||/^id_(rsa|ed25519|ecdsa)(\.pub)?$/i.test(name)||/\.(pem|key|p12|pfx|mobileprovision)$/i.test(name)
export async function projectArtifactSnapshot(artifact:ProjectArtifact,home:string,trash:(target:string)=>Promise<void>,maximum=200000,signal?:AbortSignal):Promise<DeepCleanSnapshot>{
  assertDeepNotCancelled(signal)
  const captured:CapturedProjectPath[]=[],files:DeepCleanFile[]=[],pending=[artifact.target]
  let denied=false,limited=false,protectedContent=false
  const root=await privacyPathSnapshot(artifact.target)
  while(pending.length&&captured.length<maximum){
    assertDeepNotCancelled(signal)
    const batch=pending.splice(Math.max(0,pending.length-32),Math.min(32,maximum-captured.length))
    await Promise.all(batch.map(async(target)=>{
      if(target!==artifact.target&&protectedName(path.basename(target))){protectedContent=true;return}
      try{
        const value=await lstat(target),link=value.isSymbolicLink()
        if(!value.isDirectory()&&!value.isFile()&&!link){limited=true;return}
        captured.push({path:target,dev:value.dev,ino:value.ino,size:value.size,modified:value.mtimeMs,directory:value.isDirectory(),link})
        if(value.isDirectory()){for(const name of await readdir(target))pending.push(path.join(target,name))}
        else files.push({id:randomUUID(),name:path.basename(target),path:target,size:link?0:value.size,modified:value.mtimeMs})
      }catch(error){if(privacyAccessFailure(error))denied=true;else limited=true}
    }))
  }
  limited ||= pending.length>0
  const size=files.reduce((sum,file)=>sum+file.size,0),status=denied?'permission-required':limited?'limited':protectedContent?'review-only':files.length?'ready':'empty'
  files.sort((a,b)=>b.size-a.size||a.path.localeCompare(b.path))
  const validate=async():Promise<void>=>{
    if(!['ready','empty'].includes(status))throw new Error('deep.sourceUnavailable')
    try{
      await validateProjectArtifactCleanupTarget(artifact.target,artifact.projectRoot,root.modified,'directory',home)
      await validatePrivacyPath(root)
      for(const old of captured){
        if(old.link){
          await privacyPathSnapshot(path.dirname(old.path))
          const current=await lstat(old.path)
          if(!current.isSymbolicLink()||current.dev!==old.dev||current.ino!==old.ino||current.mtimeMs!==old.modified||current.size!==old.size)throw new Error('deep.sourceChanged')
        }else await validatePrivacyPath(old)
      }
    }catch{throw new Error('deep.sourceChanged')}
  }
  return {count:files.length,size,modified:files.reduce((value,file)=>Math.max(value,file.modified),root.modified),status,files,validate,clean:async(progress)=>{
    await validate();if(!files.length)return {count:0,size:0,changed:false,removedPaths:[]}
    await trash(artifact.target)
    try{await lstat(artifact.target);throw new Error('deep.verificationFailed')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    progress?.(files.length,files.length)
    return {count:files.length,size,changed:true,removedPaths:[artifact.target]}
  }}
}
