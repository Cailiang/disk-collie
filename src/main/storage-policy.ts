import path from 'node:path'
import os from 'node:os'

/** Read-only exploration can be broader than mutation. Test with each platform's path rules. */
export function isStorageMutationAllowed(target:string,root:string,platform:NodeJS.Platform=process.platform,userHome=os.homedir(),env:NodeJS.ProcessEnv=process.env):boolean {
  const paths=platform==='win32'?path.win32:path.posix
  const normalize=(value:string):string=>platform==='win32'?paths.normalize(value.replace(/^\\\\\?\\/,'')).toLowerCase():paths.normalize(value)
  target=normalize(target);root=normalize(root);userHome=normalize(userHome)
  if(!paths.isAbsolute(target)||!paths.isAbsolute(root))return false
  const relative=paths.relative(root,target)
  if(!relative||relative==='..'||relative.startsWith(`..${paths.sep}`)||paths.isAbsolute(relative))return false
  const parts=paths.relative(userHome,target).split(paths.sep)
  if(parts.some((p)=>['.ssh','.gnupg','.aws','.kube','.memento'].includes(p)))return false
  if(['library','appdata','.config','.local'].includes(parts[0]?.toLowerCase()))return false
  const protectedRoots=platform==='win32'
    ? [env.SystemRoot||'C:\\Windows',env.ProgramFiles||'C:\\Program Files',env['ProgramFiles(x86)']||'C:\\Program Files (x86)',env.ProgramData||'C:\\ProgramData']
    : ['/System','/Library','/Applications','/bin','/sbin','/usr','/etc','/var','/private','/proc','/sys','/dev','/boot']
  return !protectedRoots.map(normalize).some((p)=>target===p||target.startsWith(`${p}${paths.sep}`))
}
