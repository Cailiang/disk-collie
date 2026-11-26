import path from 'node:path'

/** Default exploration skips hidden folders and application data on every scan page. */
export function storageScanScope(home:string,includeHidden=false,platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env):{includeHidden:boolean;excludePaths:string[]} {
  if(includeHidden)return {includeHidden:true,excludePaths:[]}
  const paths=platform==='win32'?path.win32:path.posix
  const excluded=platform==='darwin'?[paths.join(home,'Library'),'/Library','/System/Library']
    :platform==='win32'?[paths.join(home,'AppData'),env.APPDATA,env.LOCALAPPDATA,env.ProgramData||'C:\\ProgramData']
    :[paths.join(home,'.config'),paths.join(home,'.local'),paths.join(home,'.cache')]
  return {includeHidden:false,excludePaths:[...new Set(excluded.filter((value):value is string=>Boolean(value)))]}
}
