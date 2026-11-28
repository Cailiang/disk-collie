import path from 'node:path'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {windowsStartupScript} from './windows-script'
import {baseItem,command,digest,type StartupAdapter,type StartupRecord} from './common'
import type {StartupCoverage,StartupItem} from '../../shared/startup-types'

interface NativeRow {key:string;native:Record<string,unknown>;snapshot:Record<string,unknown>;item:Partial<StartupItem>&Pick<StartupItem,'name'|'kind'>}
interface Discovery {records:NativeRow[];coverage:StartupCoverage[]}
export function startupWindowsProgram(request:Record<string,unknown>):string {
  const data=Buffer.from(JSON.stringify(request)).toString('base64')
  let program=windowsStartupScript
  const sources:Record<string,string>={registry:'RegistryRows',folder:'FolderRows',task:'TaskRows',service:'ServiceRows',package:'PackageRows',advanced:'AdvancedRows'}
  if(typeof request.pickKind==='string'&&sources[request.pickKind]){
    for(const [kind,name] of Object.entries(sources))if(kind!==request.pickKind){
      const start=program.indexOf(`function ${name} `),end=program.indexOf('\nfunction ',start+1)
      if(start>=0&&end>start)program=program.slice(0,start)+program.slice(end)
    }
  }
  return `$request=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')))\n`+program
}
export function encodePowershell(source:string):string {
  const packed=gzipSync(Buffer.from(source,'utf8')).toString('base64')
  const unpack=`$bytes=[Convert]::FromBase64String('${packed}');$stream=[IO.MemoryStream]::new($bytes,0,$bytes.Length);$zip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionMode]::Decompress);$reader=[IO.StreamReader]::new($zip,[Text.Encoding]::UTF8);try{& ([ScriptBlock]::Create($reader.ReadToEnd()))}finally{$reader.Dispose()}`
  return Buffer.from(unpack,'utf16le').toString('base64')
}
export function windowsStartup(options:{profile:string;run?:typeof command;env?:NodeJS.ProcessEnv;self?:string}):StartupAdapter {
  const run=options.run||command,env=options.env||process.env,executable=path.win32.join(env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
  const args=(request:Record<string,unknown>):string[]=>['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encodePowershell(startupWindowsProgram(request))]
  const discover=async(request:Record<string,unknown>={}):Promise<Discovery>=>JSON.parse(await run(executable,args({mode:'scan',...request}),45000))
  return {async scan(){
    const data=await discover(),records:StartupRecord[]=[]
    for(const row of data.records){
      const item=baseItem(row.item)
      if(options.self&&item.target.toLowerCase()===options.self.toLowerCase()){item.canToggle=false;item.canRemove=false;item.access='settings';item.issue='startup.selfManaged'}
      const request={pickKey:row.key,pickKind:item.kind,native:row.native}
      // Native configured-state evidence belongs in the snapshot; volatile runtime
      // fields are deliberately excluded from mutation authorization.
      const signature=(candidate:NativeRow):string=>digest(candidate.snapshot)
      const fresh=async():Promise<string>=>{const match=(await discover(request)).records.find(candidate=>candidate.key===row.key);if(!match)throw new Error('startup.changed');return signature(match)}
      records.push({item,key:row.key,signature:signature(row),validate:fresh,change:async action=>{
        const input={...request,mode:'change',action,expected:row.snapshot}
        if(item.access!=='administrator'){await run(executable,args(input),45000);return}
        await mkdir(options.profile,{recursive:true})
        const directory=await mkdtemp(path.join(options.profile,'startup-authorization-')),resultFile=path.join(directory,'result.json')
        try{
          const encoded=encodePowershell(startupWindowsProgram({...input,resultFile}))
          const launcher=`$ErrorActionPreference='Stop'; $child=Start-Process -FilePath '${executable.replaceAll("'","''")}' -Verb RunAs -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') -Wait -PassThru; if($child.ExitCode -ne 0){exit $child.ExitCode}`
          try{await run(executable,['-NoProfile','-NonInteractive','-EncodedCommand',encodePowershell(launcher)],120000)}catch(error){
            try{const result=JSON.parse(await readFile(resultFile,'utf8'));if(result.error?.includes('startup.changed'))throw new Error('startup.changed')}catch(problem){if(problem instanceof Error&&problem.message==='startup.changed')throw problem}
            throw error
          }
          const result=JSON.parse(await readFile(resultFile,'utf8'));if(!result.ok)throw new Error('startup.failed')
        }finally{await rm(directory,{recursive:true,force:true})}
      }})
    }
    return {records,coverage:data.coverage}
  }}
}
