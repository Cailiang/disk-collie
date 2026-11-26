import type {RelatedApplicationFile} from './storage-types'
export function pathContains(parent:string,child:string):boolean {
  return child===parent||child.startsWith(parent.endsWith('/')||parent.endsWith('\\')?parent:parent+(parent.includes('\\')?'\\':'/'))
}
/** Avoid counting or executing both a directory and its selected descendants. */
export function selectedApplicationFiles(files:RelatedApplicationFile[],selected:Set<string>):RelatedApplicationFile[] {
  const requested=files.filter((file)=>selected.has(file.id))
  return requested.filter((file)=>!requested.some((parent)=>parent.id!==file.id&&pathContains(parent.path,file.path)))
}
export function applicationUnusedDays(lastUsedAt:string|null|undefined,now=Date.now()):number|null {
  if(!lastUsedAt)return null
  const date=new Date(lastUsedAt).getTime()
  return Number.isFinite(date)&&date<=now?Math.floor((now-date)/86400_000):null
}
