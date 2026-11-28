import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
import {lstat,readFile,readlink,realpath} from '../physical-fs'
import type {StartupItem,StartupAction,StartupCoverage} from '../../shared/startup-types'
const exec=promisify(execFile)
export async function command(file:string,args:string[],timeout=15000):Promise<string> {
  const {stdout}=await exec(file,args,{timeout,killSignal:'SIGKILL',maxBuffer:24*1024**2,windowsHide:true,encoding:'utf8',env:{...process.env,LC_ALL:'C'}})
  return stdout.replace(/^\uFEFF/,'')
}
export function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(value,(_key,current)=>current&&typeof current==='object'&&!Array.isArray(current)?Object.fromEntries(Object.keys(current).sort().map(key=>[key,current[key]])):current)).digest('hex')}
export async function fingerprint(file:string,allowAlias=false):Promise<string> {
  const stat=await lstat(file)
  if(allowAlias&&stat.isSymbolicLink()){
    const link=await readlink(file),target=await realpath(file)
    return digest(['alias',stat.dev,stat.ino,stat.mode,link,target,await fingerprint(target)])
  }
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024**2)throw new Error('startup.changed')
  return digest([stat.dev,stat.ino,stat.mode,stat.size,createHash('sha256').update(await readFile(file)).digest('hex')])
}
export async function existence(file:string):Promise<'present'|'missing'|'unknown'> {
  if(!file||!path.isAbsolute(file))return 'unknown'
  try{await lstat(file);return 'present'}catch(error){return ['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code||'')?'missing':'unknown'}
}
export function baseItem(value:Partial<StartupItem>&Pick<StartupItem,'name'|'kind'>):StartupItem {
  return {id:randomUUID(),owner:'',ownerId:'',publisher:'',description:'',scope:'user',state:'unknown',running:null,timing:['login'],configuration:'',target:'',orphan:false,issue:null,access:'readonly',canToggle:false,canRemove:false,icon:null,...value}
}
export interface StartupRecord {item:StartupItem;signature:string;key:string;change:(action:StartupAction)=>Promise<void>;validate:()=>Promise<string>}
export interface StartupDiscovery {records:StartupRecord[];coverage:StartupCoverage[]}
export interface StartupAdapter {scan:()=>Promise<StartupDiscovery>}
export const inertRecord=(item:StartupItem,key:string,signature=key):StartupRecord=>({item,key,signature,validate:async()=>signature,change:async()=>{throw new Error('startup.readonly')}})
export function shellQuote(value:string):string{return "'"+value.replaceAll("'","'\\''")+"'"}
export function errorKey(error:unknown):string {
  const value=error as NodeJS.ErrnoException
  if(['EACCES','EPERM'].includes(value.code||'')||/access.*denied|not permitted|unauthorized|requires elevation/i.test(String(error)))return 'startup.permission'
  if(/cancel|(-128)/i.test(String(error)))return 'startup.cancelled'
  return error instanceof Error&&error.message.startsWith('startup.')?error.message:'startup.failed'
}
