import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { ApplicationUpdateResult } from '../shared/types'
import type { ApplicationUpdate } from './scanner'
import { appStoreUpdateUrl } from './app-store-updates'
import { installSparkleUpdate, runSparkleUpdater, sparkleUpdaterCommand } from './application-updater'
const exec=promisify(execFile)
/** Only main-process-discovered update sources enter this function. */
export async function updateRegisteredApplication(target:string,update:ApplicationUpdate):Promise<ApplicationUpdateResult> {
  if(update.source==='homebrew-cask') {
    if(!/^[a-z0-9][a-z0-9@._+-]*$/.test(update.token))throw new Error('Invalid Homebrew application ID')
    const brew=['/opt/homebrew/bin/brew','/usr/local/bin/brew'].find(existsSync)
    if(!brew)throw new Error('Homebrew is not installed')
    await exec(brew,['upgrade','--cask',update.token],{timeout:600_000,maxBuffer:4*1024*1024,env:{...process.env,HOMEBREW_NO_AUTO_UPDATE:'1',LC_ALL:'C'}})
    return {status:'updated'}
  }
  if(update.source==='mac-app-store') {
    const url=appStoreUpdateUrl(update.token)
    const mas=['/opt/homebrew/bin/mas','/usr/local/bin/mas','/usr/bin/mas'].find(existsSync)
    if(mas&&update.mode==='direct'){await exec(mas,['upgrade',update.token],{timeout:600_000,maxBuffer:4*1024*1024});return {status:'updated'}}
    await shell.openExternal(url);return {status:'opened',destination:'app-store'}
  }
  if(update.downloadUrl){await installSparkleUpdate({target,downloadUrl:update.downloadUrl,expectedVersion:update.latestVersion});return {status:'updated'}}
  const sparkle=sparkleUpdaterCommand(target)
  if(sparkle)await runSparkleUpdater(target,sparkle)
  else {const error=await shell.openPath(target);if(error)throw new Error(error)}
  return {status:'opened',destination:'application'}
}
