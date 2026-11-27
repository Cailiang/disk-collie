import path from 'node:path'
import os from 'node:os'

export const storageProtectedNames=['.ssh','.gnupg','.aws','.kube','.diskcollie','.disk-collie','.memento','.Trash','.Trashes','$Recycle.Bin','System Volume Information']
/** One boundary for cleanup discovery and deletion; analysis may inspect these read-only. */
export function storageProtectedPaths(userHome:string,platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env):string[]{
  const paths=platform==='win32'?path.win32:path.posix
  const roots=platform==='win32'
    ?[env.SystemRoot||'C:\\Windows',env.ProgramFiles||'C:\\Program Files',env['ProgramFiles(x86)']||'C:\\Program Files (x86)',env.ProgramData||'C:\\ProgramData',paths.join(userHome,'AppData'),env.APPDATA,env.LOCALAPPDATA]
    :['/System','/Library','/Applications','/bin','/sbin','/usr','/etc','/var','/private','/tmp','/run','/opt','/proc','/sys','/dev','/boot','/snap','/nix',...(platform==='darwin'?[paths.join(userHome,'Library')]:[paths.join(userHome,'.config'),paths.join(userHome,'.local')])]
  return [...new Set(roots.filter((value):value is string=>Boolean(value)))]
}

/** Read-only exploration can be broader than mutation. Test with each platform's path rules. */
export function isStorageMutationAllowed(target:string,root:string,platform:NodeJS.Platform=process.platform,userHome=os.homedir(),env:NodeJS.ProcessEnv=process.env):boolean {
  const paths=platform==='win32'?path.win32:path.posix
  const normalize=(value:string):string=>platform==='win32'?paths.normalize(value.replace(/^\\\\\?\\/,'')).toLowerCase():paths.normalize(value)
  target=normalize(target);root=normalize(root);userHome=normalize(userHome)
  if(!paths.isAbsolute(target)||!paths.isAbsolute(root))return false
  const relative=paths.relative(root,target)
  if(!relative||relative==='..'||relative.startsWith(`..${paths.sep}`)||paths.isAbsolute(relative))return false
  const parts=paths.relative(userHome,target).split(paths.sep)
  if(parts.some((part)=>storageProtectedNames.some((name)=>platform==='win32'?name.toLowerCase()===part.toLowerCase():name===part)))return false
  if(['library','appdata','.config','.local'].includes(parts[0]?.toLowerCase()))return false
  const protectedRoots=storageProtectedPaths(userHome,platform,env)
  return !protectedRoots.map(normalize).some((p)=>target===p||target.startsWith(`${p}${paths.sep}`))
}
