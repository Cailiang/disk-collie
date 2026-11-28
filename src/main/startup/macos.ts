import path from 'node:path'
import {mkdir,rename,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {lstat,readdir,readFile} from '../physical-fs'
import type {StartupAction,StartupCoverage,StartupItem,StartupState} from '../../shared/startup-types'
import type {AppLanguage} from '../../shared/app-settings'
import {applicationNamePlistPaths,plistApplicationName} from '../scanner'
import {baseItem,command,digest,existence,fingerprint,inertRecord,startupText,type StartupAdapter,type StartupBatch,type StartupRecord} from './common'
import {changeMacStartupBatch,type MacAdminTarget} from './macos-admin'

const plistReader=String.raw`ObjC.import('Foundation');function run(argv){return JSON.stringify(argv.map(function(p){try{var d=$.NSDictionary.dictionaryWithContentsOfFile($(p));return {path:p,data:d?ObjC.deepUnwrap(d):null}}catch(e){return {path:p,data:null}}}))}`
const loginReader=String.raw`function run(){return JSON.stringify(Application('System Events').loginItems().map(function(i){try{return {name:i.name(),path:i.path(),hidden:i.hidden()}}catch(e){return {name:i.name(),path:''}}}))}`
const loginWriter=String.raw`function run(argv){var app=Application('System Events'),target=argv[0],action=argv[1],items=app.loginItems();for(var i=items.length-1;i>=0;i--){try{if(items[i].path()===target){if(action==='enable')return;app.delete(items[i])}}catch(e){throw e}}if(action==='enable')app.loginItems.push(app.LoginItem({path:target,hidden:argv[2]==='true'}));}`

export function disabledServices(output:string):Map<string,boolean> {
  return new Map([...output.matchAll(/"([^"\n]+)"\s*=>\s*(true|false|enabled|disabled)/g)].map(match=>[match[1],match[2]==='true'||match[2]==='disabled']))
}
export interface BackgroundRecord {uid:number;name:string;publisher:string;identifier:string;parent:string;type:string;url:string;executable:string;state:StartupState}
export function backgroundRecords(text:string,uid:number):BackgroundRecord[] {
  const records:BackgroundRecord[]=[];let owner=-999,current:Record<string,string>|null=null
  const finish=():void=>{
    if(!current||![uid,0,-2].includes(owner))return
    const flags:string[]=(current.Disposition||'').toLowerCase().match(/\b(?:enabled|disabled|allowed|disallowed)\b/g)||[]
    const state:StartupState=flags.includes('enabled')&&!flags.includes('disabled')&&!flags.includes('disallowed')?'enabled':flags.includes('disabled')||flags.includes('disallowed')||flags.includes('allowed')&&!flags.includes('enabled')?'disabled':'unknown'
    records.push({uid:owner,name:current.Name||current.Identifier||'',publisher:current['Developer Name']||'',identifier:current.Identifier||'',parent:current['Parent Identifier']||'',type:current.Type||'',url:current.URL||'',executable:current['Executable Path']||'',state})
  }
  for(const line of text.split(/\r?\n/)){
    const user=/Records for UID\s+(-?\d+)/i.exec(line),start=/^\s*#\d+\s*:/.test(line)
    if(user){finish();current=null;owner=Number(user[1])}
    else if(start){finish();current={}}
    else if(current){const field=/^\s*([A-Za-z][A-Za-z ]+):\s*(.*)$/.exec(line);if(field)current[field[1].trim()]=startupText(field[2])}
  }
  finish();return records
}
function localPath(value:string):string {
  if(value.startsWith('file:'))try{return fileURLToPath(value)}catch{return ''}
  return path.isAbsolute(value)?value:''
}
export function launchTarget(data:Record<string,unknown>):string {
  const args=Array.isArray(data.ProgramArguments)?data.ProgramArguments.filter((value):value is string=>typeof value==='string'):[]
  const program=typeof data.Program==='string'?data.Program:args[0]||''
  const interpreter=(value:string):boolean=>/^(?:node|nodejs|python(?:\d+(?:\.\d+)?)?|perl|ruby|bash|sh|zsh|osascript)$/.test(path.basename(value))
  if(interpreter(program)&&args[1]&&!args[1].startsWith('-')&&path.isAbsolute(args[1]))return args[1]
  if(program==='/usr/bin/env'){
    const rest=args.slice(1)
    while(rest[0]&&/^[A-Za-z_]\w*=/.test(rest[0]))rest.shift()
    if(rest[0]==='--')rest.shift()
    if(rest[0]&&!rest[0].startsWith('-')){
      if(interpreter(rest[0])&&rest[1]&&path.isAbsolute(rest[1]))return rest[1]
      if(path.isAbsolute(rest[0]))return rest[0]
    }
  }
  return path.isAbsolute(program)?program:''
}
interface MacOptions {home:string;profile:string;trash:(file:string)=>Promise<void>;fixture?:string;run?:typeof command;uid?:number;self?:string;language?:()=>AppLanguage}
export function macStartup(options:MacOptions):StartupAdapter {
  const run=options.run||command,uid=options.uid??process.getuid!(),journal=path.join(options.profile,'disabled-login-items.json')
  type Login={name:string;path:string;hidden?:boolean}
  const savedLogins=async():Promise<Login[]>=>{try{const rows=JSON.parse(await readFile(journal,'utf8'));return Array.isArray(rows)?rows.filter(row=>typeof row.name==='string'&&typeof row.path==='string'&&path.isAbsolute(row.path)):[]}catch{return []}}
  const saveLogins=async(rows:Login[]):Promise<void>=>{await mkdir(options.profile,{recursive:true});const temp=journal+'.'+crypto.randomUUID();await writeFile(temp,JSON.stringify(rows),{mode:0o600,flag:'wx'});await rename(temp,journal)}
  const liveLogins=async():Promise<Login[]>=>JSON.parse(await run('/usr/bin/osascript',['-l','JavaScript','-e',loginReader],10000))
  const readPlists=async(files:string[]):Promise<Map<string,Record<string,unknown>|null>>=>{
    if(!files.length)return new Map()
    return new Map((JSON.parse(await run('/usr/bin/osascript',['-l','JavaScript','-e',plistReader,...files],20000)) as Array<{path:string;data:Record<string,unknown>|null}>).map(row=>[row.path,row.data]))
  }
  const appCache=new Map<string,string>()
  const preloadOwners=async(targets:string[],language:AppLanguage):Promise<void>=>{
    const applications=[...new Set(targets.flatMap(target=>/^(.+?\.app)(?:\/|$)/i.exec(target)?.[1]||[]))].filter(app=>!appCache.has(app))
    if(!applications.length)return
    try{
      const plists=await readPlists(applications.flatMap(app=>applicationNamePlistPaths(app,language)))
      for(const app of applications){
        const name=applicationNamePlistPaths(app,language).map(file=>{const data=plists.get(file);return startupText(data?plistApplicationName(data):'')}).find(Boolean)
        appCache.set(app,name||path.basename(app,'.app'))
      }
    }catch{for(const app of applications)appCache.set(app,path.basename(app,'.app'))}
  }
  const owner=async(target:string,language:AppLanguage):Promise<{owner:string;ownerId:string;icon:string|null}>=>{
    const app=/^(.+?\.app)(?:\/|$)/i.exec(target)?.[1]
    if(!app)return {owner:'',ownerId:target&&!target.startsWith('/usr/')&&!target.startsWith('/bin/')?digest(target):'',icon:null}
    if(!appCache.has(app))await preloadOwners([target],language)
    return {owner:appCache.get(app)!,ownerId:digest(app),icon:await existence(app)==='present'?app:null}
  }
  const adminTargets=new WeakMap<StartupRecord,MacAdminTarget>()
  const batch:StartupBatch={token:{},apply:async(records,action)=>changeMacStartupBatch(records.map(record=>{
    const target=adminTargets.get(record)
    if(!target)throw new Error('startup.readonly')
    return target
  }),action,run)}
  return {async scan(){
    appCache.clear()
    const records:StartupRecord[]=[],coverage:StartupCoverage[]=[],root=options.fixture||options.home,language=options.language?.()||'zh-CN'
    const roots:Array<{path:string;kind:'agent'|'daemon';scope:StartupItem['scope'];domain:string}>=[
      {path:path.join(root,'Library/LaunchAgents'),kind:'agent',scope:'user',domain:`gui/${uid}`},
      ...options.fixture?[{path:path.join(root,'Library/LaunchDaemons'),kind:'daemon' as const,scope:'machine' as const,domain:'system'}]:[{path:'/Library/LaunchAgents',kind:'agent' as const,scope:'machine' as const,domain:`gui/${uid}`},{path:'/Library/LaunchDaemons',kind:'daemon' as const,scope:'machine' as const,domain:'system'},{path:'/System/Library/LaunchAgents',kind:'agent' as const,scope:'system' as const,domain:`gui/${uid}`},{path:'/System/Library/LaunchDaemons',kind:'daemon' as const,scope:'system' as const,domain:'system'}]
    ]
    const overrides=new Map<string,Map<string,boolean>>()
    await Promise.all([...new Set(roots.map(root=>root.domain))].map(async domain=>{try{overrides.set(domain,disabledServices(await run('/bin/launchctl',['print-disabled',domain],5000)))}catch{/* Unknown overrides must not look enabled. */}}))
    let running:Map<string,boolean>|null=null;try{running=new Map((await run('/bin/launchctl',['list'],5000)).split('\n').flatMap(line=>{const match=/^\s*(\d+|-)\s+-?\d+\s+(\S+)\s*$/.exec(line);return match?[[match[2],match[1]!=='-'] as [string,boolean]]:[]}))}catch{/* Runtime state is optional. */}
    const files:Array<{file:string;root:typeof roots[number]}>=[]
    const sourceErrors=new Set<string>()
    for(const source of roots)try{for(const name of await readdir(source.path))if(name.endsWith('.plist'))files.push({file:path.join(source.path,name),root:source})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')sourceErrors.add(source.kind)}
    let dataByPath=new Map<string,Record<string,unknown>|null>()
    try{dataByPath=await readPlists(files.map(row=>row.file))}catch{sourceErrors.add('agent');sourceErrors.add('daemon')}
    await preloadOwners([...dataByPath.values()].flatMap(data=>data?[launchTarget(data)]:[]),language)
    for(const {file,root:source} of files){
      const data=dataByPath.get(file),label=startupText(data?.Label)||path.basename(file,'.plist'),target=data?launchTarget(data):''
      const isOwn=label.startsWith('com.fcl.diskcollie')||Boolean(options.self&&target.startsWith(options.self+'/'))
      const isProtected=source.scope==='system'||label.startsWith('com.apple.')
      const overridesForDomain=overrides.get(source.domain)
      const state:StartupState=data&&overridesForDomain?(overridesForDomain.get(label)??data.Disabled===true?'disabled':'enabled'):'unknown'
      const targetStatus=await existence(target),orphan=targetStatus==='missing'
      const item=baseItem({name:label,kind:source.kind,scope:isProtected?'system':source.scope,configuration:file,target,state,orphan,...await owner(target,language),running:source.domain.startsWith('gui/')&&running?(running.get(label)??false):null,timing:source.kind==='daemon'?['boot']:data?.KeepAlive?['login','background']:data?.StartCalendarInterval||data?.StartInterval?['scheduled']:['login'],access:isOwn?'settings':isProtected?'protected':source.scope==='machine'?'administrator':'user',issue:isOwn?'startup.selfManaged':!data?'startup.invalid':targetStatus==='unknown'?'startup.targetUnknown':orphan?'startup.targetMissing':null})
      let original:string;try{original=await fingerprint(file,true)}catch{item.access='readonly';item.issue='startup.invalid';original='unreadable'}
      const canChange=!isProtected&&!isOwn&&Boolean(data)&&/^[\w.@-]+$/.test(label)&&state!=='unknown'&&original!=='unreadable'
      item.canToggle=canChange&&targetStatus==='present';item.canRemove=canChange
      const fresh=async():Promise<string>=>{
        const hash=await fingerprint(file,true),current=disabledServices(await run('/bin/launchctl',['print-disabled',source.domain],5000)),disabled=current.get(label)??data?.Disabled===true
        return digest([hash,disabled,await existence(target)])
      }
      const makeRecord=(current:StartupItem,status:typeof targetStatus):StartupRecord=>{
        const record:StartupRecord={item:current,key:'launch:'+file,signature:digest([original,current.state==='disabled',status]),validate:fresh,change:async(action:StartupAction)=>{
          if(!canChange)throw new Error('startup.readonly')
          if(source.scope==='machine'){
            const [result]=await batch.apply([record],action)
            if(result.error)throw result.error
          }else if(action==='remove'){
            await run('/bin/launchctl',['disable',source.domain+'/'+label])
            try{await options.trash(file)}catch(error){if(current.state==='enabled')await run('/bin/launchctl',['enable',source.domain+'/'+label]).catch(()=>undefined);throw error}
          }else await run('/bin/launchctl',[action,source.domain+'/'+label])
        },readBack:async()=>{
          // Only absence of the registration itself proves removal. A broken alias is still a registration.
          try{await lstat(file)}catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code||''))return null;throw error}
          if(await fingerprint(file,true)!==original)throw new Error('startup.changed')
          const overrides=disabledServices(await run('/bin/launchctl',['print-disabled',source.domain],5000)),status=await existence(target)
          const state:StartupState=(overrides.get(label)??data?.Disabled===true)?'disabled':'enabled'
          return makeRecord({...record.item,state,orphan:status==='missing',canToggle:canChange&&status==='present',issue:isOwn?'startup.selfManaged':!data?'startup.invalid':status==='unknown'?'startup.targetUnknown':status==='missing'?'startup.targetMissing':null},status)
        }}
        if(canChange&&source.scope==='machine'){record.batch=batch;adminTargets.set(record,{record,file,label,domain:source.domain})}
        return record
      }
      records.push(makeRecord(item,targetStatus))
    }
    for(const kind of ['agent','daemon'] as const)coverage.push({source:kind,status:sourceErrors.has(kind)||roots.some(root=>root.kind===kind&&!overrides.has(root.domain))?'partial':'complete',message:sourceErrors.has(kind)?'startup.permission':'',count:records.filter(record=>record.item.kind===kind).length})

    if(!options.fixture){
      let logins:Login[]=[],available=false
      try{logins=await liveLogins();available=true}catch{/* Report Automation permission/timeout instead of pretending empty. */}
      const saved=await savedLogins(),all=new Map([...saved,...logins].filter(login=>path.isAbsolute(login.path)).map(login=>[login.path,login]))
      await preloadOwners([...all.keys()],language)
      for(const login of all.values()){
        const enabled=available?logins.some(item=>item.path===login.path):null,state:StartupState=enabled===null?'unknown':enabled?'enabled':'disabled',status=await existence(login.path)
        const self=options.self===login.path
        const item=baseItem({name:login.name||path.basename(login.path),kind:'login',configuration:'System Events / Login Items',target:login.path,...await owner(login.path,language),state,orphan:status==='missing',canToggle:!self&&available&&status==='present',canRemove:!self&&available,access:self?'settings':available?'user':'settings',issue:self?'startup.selfManaged':status==='missing'?'startup.targetMissing':null})
        const makeLogin=(current:StartupItem,status:Awaited<ReturnType<typeof existence>>,login:Login):StartupRecord=>{
          const record:StartupRecord={item:current,key:'login:'+login.path,signature:digest([login.path,current.state,status,Boolean(login.hidden)]),validate:async()=>{const live=await liveLogins(),found=live.find(row=>row.path===login.path),saved=(await savedLogins()).find(row=>row.path===login.path);return digest([login.path,found?'enabled':saved?'disabled':'missing',await existence(login.path),Boolean((found||saved)?.hidden)])},change:async action=>{
          await run('/usr/bin/osascript',['-l','JavaScript','-e',loginWriter,login.path,action,String(login.hidden===true)],30000)
          const next=(await savedLogins()).filter(row=>row.path!==login.path)
          if(action==='disable')next.push(login)
          await saveLogins(next)
          },readBack:async()=>{
            const live=await liveLogins(),found=live.find(row=>row.path===login.path),saved=(await savedLogins()).find(row=>row.path===login.path),next=found||saved
            if(!next)return null
            const status=await existence(login.path)
            return makeLogin({...record.item,state:found?'enabled':'disabled',orphan:status==='missing',canToggle:!self&&status==='present',issue:self?'startup.selfManaged':status==='missing'?'startup.targetMissing':status==='unknown'?'startup.targetUnknown':null},status,next)
          }}
          return record
        }
        records.push(makeLogin(item,status,login))
      }
      const unresolved=logins.filter(login=>!path.isAbsolute(login.path))
      for(const [index,login] of unresolved.entries())records.push(inertRecord(baseItem({name:login.name||'Login item',kind:'login',configuration:'System Events / Login Items',access:'settings',issue:'startup.targetUnknown'}),'unresolved-login:'+login.name+':'+index))
      coverage.push({source:'login',status:!available?'unavailable':unresolved.length?'partial':'complete',message:!available?'startup.automation':unresolved.length?'startup.partial':'',count:all.size+unresolved.length})
      let background:BackgroundRecord[]=[]
      try{background=backgroundRecords(await run('/usr/bin/sfltool',['dumpbtm'],6000),uid);coverage.push({source:'background',status:'complete',message:'',count:background.length})}catch{coverage.push({source:'background',status:'unavailable',message:'startup.backgroundPermission',count:0})}
      const byIdentifier=new Map(background.map(row=>[row.identifier,row]))
      await preloadOwners(background.map(row=>localPath(row.executable)||localPath(row.url)),language)
      for(const row of background){
        const configuration=localPath(row.url),target=localPath(row.executable)||configuration
        const matching=records.find(record=>record.item.configuration===configuration||record.item.kind==='login'&&record.item.target===target)
        if(matching){if(row.publisher)matching.item.publisher=row.publisher;if(matching.item.state==='unknown'&&row.state!=='unknown')matching.item.state=row.state;continue}
        const parent=row.parent?byIdentifier.get(row.parent):undefined,status=await existence(target),kind:StartupItem['kind']=/login item/i.test(row.type)?'login':/embedded|agent|daemon/i.test(row.type)?'embedded':'background'
        const owned=await owner(target,language),parentOwner=parent?await owner(localPath(parent.executable)||localPath(parent.url),language):null,self=Boolean(options.self&&(target===options.self||target.startsWith(options.self+'/')))
        const item=baseItem({...owned,name:row.name||row.identifier,owner:owned.owner||parentOwner?.owner||parent?.name||'',ownerId:owned.ownerId||parentOwner?.ownerId||(parent?digest(parent.identifier):''),publisher:row.publisher,kind,configuration,target,state:row.state,orphan:status==='missing',issue:self?'startup.selfManaged':status==='missing'?'startup.targetMissing':status==='unknown'?'startup.targetUnknown':null,scope:self||row.uid===uid?'user':'system',timing:kind==='login'?['login']:['background'],access:'settings'})
        records.push(inertRecord(item,'btm:'+row.uid+':'+row.identifier+':'+row.url))
      }
      // A bundled helper alone is not proof of a registered startup item.
      // Registered helpers are supplied by launchd or Background Task Management above.
    }
    return {records,coverage}
  }}
}
