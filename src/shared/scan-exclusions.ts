const windowsPath=(value:string):boolean=>/^[a-z]:[\\/]/i.test(value)||/^\\\\/.test(value)
function normalized(value:string):string {
  const windows=windowsPath(value),source=windows?value.replaceAll('\\','/'):value
  const drive=/^[a-z]:\//i.exec(source)?.[0]
  const prefix=drive?drive:windows&&source.startsWith('//')?'//':'/'
  const parts:string[]=[]
  for(const part of source.slice(prefix.length).split('/')){
    if(!part||part==='.')continue
    if(part==='..'){parts.pop();continue}
    parts.push(part)
  }
  const result=prefix+parts.join('/')
  return windows?result.toLowerCase():result
}
export function normalizeScanExcludedDirectories(value:unknown):string[]{
  if(!Array.isArray(value))return []
  const seen=new Set<string>(),result:string[]=[]
  for(const entry of value){
    if(typeof entry!=='string'||!entry||entry.length>10000||/[\u0000-\u001f\u007f]/.test(entry)||!entry.startsWith('/')&&!windowsPath(entry))continue
    const target=normalized(entry)
    if(!seen.has(target)){seen.add(target);result.push(target)}
    if(result.length===200)break
  }
  return result
}
/** Exclusions match complete path components, including the directory itself. */
export function isScanPathExcluded(target:string,excludedPaths:readonly string[]=[]):boolean {
  const current=normalized(target)
  return excludedPaths.some((excluded)=>{const root=normalized(excluded);return current===root||current.startsWith(root.endsWith('/')?root:root+'/')})
}
/** Whole-directory operations must also preserve excluded descendants. */
export function scanPathsOverlap(target:string,excludedPaths:readonly string[]=[]):boolean {
  return isScanPathExcluded(target,excludedPaths)||excludedPaths.some((entry)=>isScanPathExcluded(entry,[target]))
}
