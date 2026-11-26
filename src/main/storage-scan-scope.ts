import path from 'node:path'
import type {StorageMode} from '../shared/storage-types'
import {storageProtectedNames,storageProtectedPaths} from './storage-policy'

/** Default exploration skips hidden folders and application data on every scan page. */
export function storageScanScope(home:string,includeHidden=false,platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env,mode:StorageMode='analysis'):{includeHidden:boolean;excludePaths:string[];excludeNames?:string[]} {
  const paths=platform==='win32'?path.win32:path.posix
  const excluded=platform==='darwin'?[paths.join(home,'Library'),'/Library','/System/Library']
    :platform==='win32'?[paths.join(home,'AppData'),env.APPDATA,env.LOCALAPPDATA,env.ProgramData||'C:\\ProgramData']
    :[paths.join(home,'.config'),paths.join(home,'.local'),paths.join(home,'.cache')]
  const cleanup=mode!=='analysis'
  return {includeHidden,excludePaths:[...new Set([...(includeHidden?[]:excluded),...(cleanup?storageProtectedPaths(home,platform,env):[])].filter((value):value is string=>Boolean(value)))],...(cleanup?{excludeNames:storageProtectedNames}:{})}
}
