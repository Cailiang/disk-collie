import {directorySensitiveNames} from '../shared/directory-sensitive-files'
import {lstat,readdir,readlink} from './physical-fs'
import os from 'node:os'
import path from 'node:path'
import type {StorageDirectoryPlan} from '../shared/storage-directory-types'
import {isStorageMutationAllowed,storageProtectedNames,storageProtectedPaths} from './storage-policy'
import {applicationDataRoot} from './storage-application-data-policy'

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
  summary:Pick<StorageDirectoryPlan,'path'|'name'|'size'|'allocated'|'files'|'directories'|'links'|'hiddenFiles'|'sensitiveFiles'|'sensitiveExamples'>
  validate:()=>Promise<void>
  trash:(move:(target:string)=>Promise<void>)=>Promise<void>
}
type ProtectionReason='root'|'policy'|'excluded'|'application'|'volume'|'special'
export class StorageDirectoryProtectionError extends Error {
  constructor(readonly reason:ProtectionReason,readonly path:string){super('storage.directoryProtected')}
}
const equalOrInside=(target:string,root:string,p:typeof path.posix):boolean=>target===root||target.startsWith(root+p.sep)
function policy(options:DirectoryTrashOptions):{platform:NodeJS.Platform;home:string;env:NodeJS.ProcessEnv;p:typeof path.posix;normalize:(value:string)=>string}{
  const platform=options.platform||process.platform,p=platform==='win32'?path.win32:path.posix
  const normalize=(value:string):string=>platform==='win32'?p.normalize(value.replace(/^\\\\\?\\/,'' )).toLowerCase():p.normalize(value)
  return {platform,p,normalize,home:options.home||os.homedir(),env:options.env||process.env}
}
function protectionIssue(target:string,scanRoot:string,options:DirectoryTrashOptions):StorageDirectoryProtectionError|null {
  const {platform,p,normalize,home,env}=policy(options),normalized=normalize(target),root=normalize(scanRoot),user=normalize(home)
  const relative=p.relative(root,normalized)
  if(!relative||relative==='..'||relative.startsWith('..'+p.sep)||p.isAbsolute(relative))return new StorageDirectoryProtectionError('root',target)
  const applicationData=applicationDataRoot(normalized,home,platform)
  if(!applicationData&&!isStorageMutationAllowed(target,scanRoot,platform,home,env))return new StorageDirectoryProtectionError('policy',target)
  if(normalized===normalize(p.parse(target).root)||normalized===user||equalOrInside(user,normalized,p))return new StorageDirectoryProtectionError('root',target)
  if(normalized.toLowerCase().endsWith('.app'))return new StorageDirectoryProtectionError('application',target)
  const excluded=(options.excludedPaths||[]).find((location)=>equalOrInside(normalized,normalize(location),p)||equalOrInside(normalize(location),normalized,p))
  if(excluded)return new StorageDirectoryProtectionError('excluded',excluded)
  const protectedPath=(applicationData?[]:storageProtectedPaths(home,platform,env)).find((location)=>equalOrInside(normalized,normalize(location),p)||equalOrInside(normalize(location),normalized,p))
  if(protectedPath)return new StorageDirectoryProtectionError('policy',protectedPath)
  return null
}
/** This only controls whether a folder can be offered for review. The full tree is checked later. */
export function isStorageDirectoryCandidate(target:string,scanRoot:string,options:DirectoryTrashOptions={}):boolean {
  return protectionIssue(target,scanRoot,options)===null
}
export function assertStorageDirectoryCandidate(target:string,scanRoot:string,options:DirectoryTrashOptions={}):void {
  const issue=protectionIssue(target,scanRoot,options)
  if(issue)throw issue
}
async function nonLinkedAncestors(target:string):Promise<void>{
  for(let current=target;;current=path.dirname(current)){
    if((await lstat(current)).isSymbolicLink())throw new Error('storage.directoryChanged')
    if(path.dirname(current)===current)break
  }
}
function assertEntryAllowed(target:string,scanRoot:string,options:DirectoryTrashOptions,applicationDataScope?:string):void {
  const {platform,p,home,env}=policy(options),name=p.basename(target)
  // Explicit application-data review includes that app's own settings and account data.
  // Links remain physical entries; their destinations are never traversed or removed.
  if(applicationDataScope&&equalOrInside(target,applicationDataScope,p))return
  // An uninstalled bundle inside a reviewed project is part of that folder, like any other build output.
  // Installed locations and credential stores remain protected. A project's own
  // configuration/certificate files belong to its complete, explicitly reviewed Trash move.
  if(!isStorageMutationAllowed(target,scanRoot,platform,home,env)||storageProtectedNames.some((entry)=>entry.toLowerCase()===name.toLowerCase()))throw new StorageDirectoryProtectionError('policy',target)
}
/** Includes hidden entries and does not follow links, hydrate linked targets or cross mounted volumes. */
async function capture(target:string,scanRoot:string,options:DirectoryTrashOptions):Promise<Map<string,DirectoryPath>>{
  assertStorageDirectoryCandidate(target,scanRoot,options)
  await nonLinkedAncestors(target)
  const root=await lstat(target),parent=await lstat(path.dirname(target))
  if(!root.isDirectory()||root.isSymbolicLink())throw new Error('storage.directoryChanged')
  if(root.dev!==parent.dev)throw new StorageDirectoryProtectionError('volume',target)
  const applicationDataScope=applicationDataRoot(target,options.home||os.homedir(),options.platform||process.platform)?target:undefined
  const maximum=options.maximumEntries??500000,result=new Map<string,DirectoryPath>(),pending=[{path:target,hidden:path.basename(target).startsWith('.')}]
  while(pending.length){
    if(result.size+pending.length>maximum)throw new Error('storage.directoryIncomplete')
    const batch=pending.splice(Math.max(0,pending.length-32),32)
    await Promise.all(batch.map(async(entry)=>{
      assertEntryAllowed(entry.path,scanRoot,options,applicationDataScope)
      let value:Awaited<ReturnType<typeof lstat>>
      try{value=await lstat(entry.path)}catch{throw new Error('storage.directoryIncomplete')}
      const link=value.isSymbolicLink()
      if(value.dev!==root.dev)throw new StorageDirectoryProtectionError('volume',entry.path)
      if(!value.isDirectory()&&!value.isFile()&&!link)throw new StorageDirectoryProtectionError('special',entry.path)
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
    summary:{path:target,name:path.basename(target),size:files.reduce((sum,entry)=>sum+entry.size,0),allocated:files.reduce((sum,entry)=>sum+entry.allocated,0),files:files.length,directories:entries.filter((entry)=>entry.directory).length-1,links:links.length,hiddenFiles:[...files,...links].filter((entry)=>entry.hidden).length,...directorySensitiveNames([...files,...links].map((entry)=>path.relative(target,entry.path)))},
    validate,
    trash:async(move)=>{
      await validate();await move(target)
      try{await lstat(target);throw new Error('storage.directoryVerificationFailed')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    }
  }
}
