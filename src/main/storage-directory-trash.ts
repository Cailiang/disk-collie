import {lstat,readdir,readlink} from './physical-fs'
import os from 'node:os'
import path from 'node:path'
import type {StorageDirectoryPlan} from '../shared/storage-directory-types'
import {isStorageMutationAllowed,storageProtectedNames,storageProtectedPaths} from './storage-policy'

interface DirectoryPath {
  path:string
  dev:number
  ino:number
  size:number
  allocated:number
  modified:number
  changed:number
  mode:number
  directory:boolean
  link:boolean
  destination?:string
  hidden:boolean
}
export interface DirectoryTrashOptions {
  platform?:NodeJS.Platform
  home?:string
  env?:NodeJS.ProcessEnv
  excludedPaths?:string[]
  maximumEntries?:number
  progress?:(entries:number)=>void
}
export interface DirectoryTrashSnapshot {
  summary:Pick<StorageDirectoryPlan,'path'|'name'|'size'|'allocated'|'files'|'directories'|'links'|'hiddenFiles'>
  validate:()=>Promise<void>
  trash:(move:(target:string)=>Promise<void>)=>Promise<void>
}
const protectedFile=(name:string):boolean=>/^\.env(?:\.|$)/i.test(name)||/^(?:auth|credentials|secrets)\.json$/i.test(name)||/^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/i.test(name)||/\.(?:pem|p12|pfx|mobileprovision|key)$/i.test(name)
const equalOrInside=(target:string,root:string,p:typeof path.posix):boolean=>target===root||target.startsWith(root+p.sep)
function policy(options:DirectoryTrashOptions):{platform:NodeJS.Platform;home:string;env:NodeJS.ProcessEnv;p:typeof path.posix;normalize:(value:string)=>string}{
  const platform=options.platform||process.platform,p=platform==='win32'?path.win32:path.posix
  const normalize=(value:string):string=>platform==='win32'?p.normalize(value.replace(/^\\\\\?\\/,'' )).toLowerCase():p.normalize(value)
  return {platform,p,normalize,home:options.home||os.homedir(),env:options.env||process.env}
}
/** This only controls whether a folder can be offered for review. The full tree is checked later. */
export function isStorageDirectoryCandidate(target:string,scanRoot:string,options:DirectoryTrashOptions={}):boolean {
  const {platform,p,normalize,home,env}=policy(options),normalized=normalize(target),root=normalize(scanRoot),user=normalize(home)
  if(!isStorageMutationAllowed(target,scanRoot,platform,home,env))return false
  if(normalized===normalize(p.parse(target).root)||normalized===user||equalOrInside(user,normalized,p))return false
  if(normalized===root||normalized.toLowerCase().endsWith('.app'))return false
  const protectedPaths=[...storageProtectedPaths(home,platform,env),...(options.excludedPaths||[])].map(normalize)
  if(protectedPaths.some((protectedPath)=>equalOrInside(normalized,protectedPath,p)||equalOrInside(protectedPath,normalized,p)))return false
  return !p.basename(normalized).toLowerCase().endsWith('.app')&&!protectedFile(p.basename(normalized))
}
async function nonLinkedAncestors(target:string):Promise<void>{
  for(let current=target;;current=path.dirname(current)){
    if((await lstat(current)).isSymbolicLink())throw new Error('storage.directoryChanged')
    if(path.dirname(current)===current)break
  }
}
function assertEntryAllowed(target:string,scanRoot:string,options:DirectoryTrashOptions):void {
  const {platform,p,home,env}=policy(options),name=p.basename(target)
  // An uninstalled bundle inside a reviewed project is part of that folder, like any other build output.
  // Installed locations, credential files and the selected .app root remain protected by their own checks.
  if(!isStorageMutationAllowed(target,scanRoot,platform,home,env)||storageProtectedNames.some((entry)=>entry.toLowerCase()===name.toLowerCase())||protectedFile(name))throw new Error('storage.directoryProtected')
}
/** Includes hidden entries and does not follow links, hydrate linked targets or cross mounted volumes. */
async function capture(target:string,scanRoot:string,options:DirectoryTrashOptions):Promise<Map<string,DirectoryPath>>{
  if(!isStorageDirectoryCandidate(target,scanRoot,options))throw new Error('storage.directoryProtected')
  await nonLinkedAncestors(target)
  const root=await lstat(target),parent=await lstat(path.dirname(target))
  if(!root.isDirectory()||root.isSymbolicLink())throw new Error('storage.directoryChanged')
  if(root.dev!==parent.dev)throw new Error('storage.directoryProtected')
  const maximum=options.maximumEntries??500000,result=new Map<string,DirectoryPath>(),pending=[{path:target,hidden:path.basename(target).startsWith('.')}]
  while(pending.length){
    if(result.size+pending.length>maximum)throw new Error('storage.directoryIncomplete')
    const batch=pending.splice(Math.max(0,pending.length-32),32)
    await Promise.all(batch.map(async(entry)=>{
      assertEntryAllowed(entry.path,scanRoot,options)
      let value:Awaited<ReturnType<typeof lstat>>
      try{value=await lstat(entry.path)}catch{throw new Error('storage.directoryIncomplete')}
      const link=value.isSymbolicLink()
      if(value.dev!==root.dev||!value.isDirectory()&&!value.isFile()&&!link)throw new Error('storage.directoryProtected')
      const captured:DirectoryPath={path:entry.path,dev:value.dev,ino:value.ino,size:value.size,allocated:link?0:Number.isFinite(value.blocks)?Math.max(0,value.blocks*512):value.size,modified:value.mtimeMs,changed:value.ctimeMs,mode:value.mode,directory:value.isDirectory(),link,hidden:entry.hidden}
      if(link)captured.destination=await readlink(entry.path)
      result.set(entry.path,captured)
      if(value.isDirectory()){
        let names:string[]
        try{names=await readdir(entry.path)}catch{throw new Error('storage.directoryIncomplete')}
        for(const name of names)pending.push({path:path.join(entry.path,name),hidden:entry.hidden||name.startsWith('.')})
      }
    }))
    options.progress?.(result.size)
    await new Promise<void>((resolve)=>setImmediate(resolve))
  }
  return result
}
const same=(first:DirectoryPath,second:DirectoryPath):boolean=>first.dev===second.dev&&first.ino===second.ino&&first.size===second.size&&first.modified===second.modified&&first.changed===second.changed&&first.mode===second.mode&&first.directory===second.directory&&first.link===second.link&&first.destination===second.destination
export async function prepareStorageDirectoryTrash(target:string,scanRoot:string,options:DirectoryTrashOptions={}):Promise<DirectoryTrashSnapshot>{
  let captured:Map<string,DirectoryPath>
  try{captured=await capture(target,scanRoot,options)}catch(error){if((error as Error).message?.startsWith('storage.directory'))throw error;throw new Error('storage.directoryIncomplete')}
  const validate=async():Promise<void>=>{
    let current:Map<string,DirectoryPath>
    try{current=await capture(target,scanRoot,{...options,progress:undefined})}catch(error){if((error as Error).message==='storage.directoryProtected')throw error;throw new Error('storage.directoryChanged')}
    if(current.size!==captured.size||[...captured].some(([location,old])=>!current.has(location)||!same(old,current.get(location)!)))throw new Error('storage.directoryChanged')
  }
  await validate()
  const entries=[...captured.values()],files=entries.filter((entry)=>!entry.directory&&!entry.link),links=entries.filter((entry)=>entry.link)
  return {
    summary:{path:target,name:path.basename(target),size:files.reduce((sum,entry)=>sum+entry.size,0),allocated:files.reduce((sum,entry)=>sum+entry.allocated,0),files:files.length,directories:entries.filter((entry)=>entry.directory).length-1,links:links.length,hiddenFiles:[...files,...links].filter((entry)=>entry.hidden).length},
    validate,
    trash:async(move)=>{
      await validate();await move(target)
      try{await lstat(target);throw new Error('storage.directoryVerificationFailed')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    }
  }
}
