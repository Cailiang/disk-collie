import {createHash} from 'node:crypto'
import {lstat,readFile} from '../physical-fs'
import type {StartupAction} from '../../shared/startup-types'
import type {AppLanguage} from '../../shared/app-settings'
import {startupAuthorizationMessage} from '../../shared/startup-permissions'
import {command,shellQuote,type StartupRecord} from './common'

export const macStartupElevationScript=String.raw`on run argv
do shell script (item 1 of argv) with administrator privileges with prompt (item 2 of argv)
end run`
export interface MacAdminTarget {record:StartupRecord;file:string;label:string;domain:string}

/** A single authorized operation contains only registered, snapshot-checked configurations. */
export async function changeMacStartupBatch(targets:MacAdminTarget[],action:StartupAction,run:typeof command=command,language:AppLanguage='zh-CN'):Promise<Array<{key:string;error:unknown|null}>>{
  const commands:string[]=[]
  for(const [index,target] of targets.entries()){
    const stat=await lstat(target.file,{bigint:true}),hash=createHash('sha256').update(await readFile(target.file)).digest('hex')
    if(await target.record.validate()!==target.record.signature)throw new Error('startup.changed')
    const stamp=[stat.dev,stat.ino,stat.mode.toString(8),stat.size].join(':')
    const guard=`[ "$(/usr/bin/stat -f '%d:%i:%p:%z' ${shellQuote(target.file)} 2>/dev/null)" = ${shellQuote(stamp)} ] && [ "$(/usr/bin/shasum -a 256 ${shellQuote(target.file)} 2>/dev/null | /usr/bin/cut -d ' ' -f 1)" = ${shellQuote(hash)} ]`
    const service=shellQuote(target.domain+'/'+target.label)
    const operation=action==='remove'?`/bin/launchctl disable ${service} && /bin/rm -f ${shellQuote(target.file)}`:`/bin/launchctl ${action} ${service}`
    const marker=`DiskCollieStartupResult:${index}:`
    commands.push(`if ! (${guard}); then /usr/bin/printf '${marker}changed\\n'; elif (${operation}); then /usr/bin/printf '${marker}ok\\n'; else /usr/bin/printf '${marker}failed\\n'; fi`)
  }
  if(!commands.length)return []
  const script=`/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/sh -c ${shellQuote(commands.join('\n'))}`
  if(Buffer.byteLength(script,'utf8')>128*1024)throw new Error('startup.selectionInvalid')
  const prompt=startupAuthorizationMessage(targets.map(target=>target.record.item),action,language)
  const output=await run('/usr/bin/osascript',['-e',macStartupElevationScript,script,prompt],120000)
  return targets.map((target,index)=>{
    const state=new RegExp(`^DiskCollieStartupResult:${index}:(ok|changed|failed)$`,'m').exec(output)?.[1]
    return {key:target.record.key,error:state==='ok'?null:new Error(state==='changed'?'startup.changed':'startup.failed')}
  })
}
