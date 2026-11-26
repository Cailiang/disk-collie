import type {RelatedApplicationFile,StorageApplication} from './storage-types'
export type ApplicationSort='name'|'used'|'size'
export function compareApplications(a:StorageApplication,b:StorageApplication,sort:ApplicationSort,direction:'ascending'|'descending',locale:string):number{
  const sign=direction==='ascending'?1:-1
  if(sort==='used'){
    const first=a.lastUsedAt?Date.parse(a.lastUsedAt):NaN,second=b.lastUsedAt?Date.parse(b.lastUsedAt):NaN
    if(Number.isFinite(first)!==Number.isFinite(second))return Number.isFinite(first)?-1:1
    if(Number.isFinite(first)&&first!==second)return (first-second)*sign
  }
  if(sort==='size'&&a.size!==b.size)return (a.size-b.size)*sign
  return a.name.localeCompare(b.name,locale)*(sort==='name'?sign:1)
}
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
