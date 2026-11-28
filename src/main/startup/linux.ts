import path from 'node:path'
import {mkdir,writeFile,rename,unlink} from 'node:fs/promises'
import {readdir,readFile,lstat} from '../physical-fs'
import {baseItem,command,digest,existence,fingerprint,inertRecord,type StartupAdapter,type StartupRecord} from './common'
import type {StartupCoverage,StartupItem,StartupState} from '../../shared/startup-types'

export function desktopFields(text:string):Record<string,string> {
  const result:Record<string,string>={};let active=false
  for(const line of text.split(/\r?\n/)){if(line.startsWith('['))active=line.trim()==='[Desktop Entry]';else if(active){const match=/^([\w-]+)=(.*)$/.exec(line);if(match)result[match[1]]=match[2].trim()}}
  return result
}
export function desktopCommand(value:string):string {
  const match=/^\s*(?:"((?:\\.|[^"\\])+)"|([^\s]+))/.exec(value)
  return (match?.[1]||match?.[2]||'').replace(/\\(["\\ ])/g,'$1')
}
export function hiddenDesktop(text:string,hidden:boolean):string {
  const lines=text.split(/\r?\n/),output:string[]=[];let active=false,wrote=false,found=false
  for(const line of lines){
    if(line.startsWith('[')){if(active&&!wrote){output.push('Hidden='+hidden);wrote=true}active=line.trim()==='[Desktop Entry]';found=found||active}
    if(active&&/^Hidden=/.test(line)){if(!wrote)output.push('Hidden='+hidden);wrote=true}else output.push(line)
  }
  if(active&&!wrote)output.push('Hidden='+hidden)
  if(!found)throw new Error('startup.invalid')
  return output.join('\n')
}
interface Options {home:string;profile:string;trash:(file:string)=>Promise<void>;fixture?:string;run?:typeof command;env?:NodeJS.ProcessEnv}
export function linuxStartup(options:Options):StartupAdapter {
  const run=options.run||command,env=options.env||process.env
  const config=options.fixture||env.XDG_CONFIG_HOME||path.join(options.home,'.config'),userRoot=path.join(config,'autostart')
  const resolve=async(program:string):Promise<string>=>{
    if(path.isAbsolute(program))return program
    if(!program||program.includes('/'))return ''
    for(const root of (env.PATH||'/usr/local/bin:/usr/bin:/bin').split(':'))if(path.isAbsolute(root)&&await existence(path.join(root,program))==='present')return path.join(root,program)
    return ''
  }
  return {async scan(){
    const records:StartupRecord[]=[],coverage:StartupCoverage[]=[],selected=new Map<string,string>(),desktopErrors:string[]=[]
    const roots=[userRoot,...options.fixture?[]:(env.XDG_CONFIG_DIRS||'/etc/xdg').split(':').filter(root=>path.isAbsolute(root)).map(root=>path.join(root,'autostart'))]
    for(const root of roots)try{for(const name of await readdir(root))if(name.endsWith('.desktop')&&!selected.has(name))selected.set(name,path.join(root,name))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')desktopErrors.push(root)}
    for(const [name,file] of selected){
      try{
        const text=await readFile(file,'utf8'),data=desktopFields(text),program=desktopCommand(data.TryExec||data.Exec||''),target=await resolve(program)
        const status=target?await existence(target):program&&!program.includes('/')?'missing':'unknown'
        const desktop=(env.XDG_CURRENT_DESKTOP||'').split(':').filter(Boolean)
        const notHere=desktop.length>0&&(Boolean(data.OnlyShowIn)&&!data.OnlyShowIn.split(';').some(value=>desktop.includes(value))||Boolean(data.NotShowIn)&&data.NotShowIn.split(';').some(value=>desktop.includes(value)))
        const state:StartupState=data.Type==='Application'&&data.Exec?(data.Hidden==='true'||data['X-GNOME-Autostart-enabled']==='false'?'disabled':'enabled'):'unknown'
        const user=file.startsWith(userRoot+path.sep),system=target.startsWith('/usr/lib/')||target.startsWith('/usr/libexec/')
        const shadowsSystem=(await Promise.all(roots.slice(1).map(root=>existence(path.join(root,name))))).some(value=>value!=='missing')
        const item=baseItem({name:data.Name||name,owner:data.Name||'',ownerId:digest(target||file),kind:'desktop',scope:system?'system':user?'user':'machine',configuration:file,target:target||program,state,orphan:status==='missing',description:data.Comment||'',access:system?'protected':user?'user':'user',canToggle:!system&&state!=='unknown'&&status!=='missing'&&!notHere,canRemove:!system&&user&&!shadowsSystem,issue:status==='missing'?'startup.targetMissing':notHere?'startup.otherDesktop':null,icon:target||null})
        const original=await fingerprint(file),override=path.join(userRoot,name)
        const overrideState=async():Promise<string>=>{try{return await fingerprint(override)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 'absent';throw error}}
        const signature=async():Promise<string>=>digest([await fingerprint(file),await overrideState(),await existence(target)])
        records.push({item,key:'desktop:'+name,signature:await signature(),validate:signature,change:async action=>{
          if(action==='remove'){await options.trash(file);return}
          await mkdir(userRoot,{recursive:true})
          const current=await readFile(file,'utf8'),next=hiddenDesktop(current,action==='disable').replace(/^X-GNOME-Autostart-enabled=.*$/m,'X-GNOME-Autostart-enabled='+(action==='enable'))
          const temp=override+'.'+crypto.randomUUID();await writeFile(temp,next,{mode:0o600,flag:'wx'})
          // A new user override must not overwrite an entry created after preflight.
          if(!user&&await existence(override)==='present'){await unlink(temp);throw new Error('startup.changed')}
          if(user&&await fingerprint(file)!==original){await unlink(temp);throw new Error('startup.changed')}
          await rename(temp,override)
        }})
      }catch{desktopErrors.push(file);records.push(inertRecord(baseItem({name,kind:'desktop',configuration:file,issue:'startup.invalid'}),'invalid-desktop:'+file))}
    }
    coverage.push({source:'desktop',status:desktopErrors.length?'partial':'complete',message:desktopErrors.length?'startup.partial':'',count:records.length})
    if(!options.fixture)for(const user of [true,false]){
      try{
        const prefix=user?['--user']:[],output=await run('/usr/bin/systemctl',[...prefix,'list-unit-files','--type=service','--no-legend','--no-pager'],8000)
        const units=output.split('\n').flatMap(line=>{const match=/^(\S+\.service)\s+(enabled(?:-runtime)?|disabled|masked(?:-runtime)?|static|indirect|generated|alias)\b/.exec(line.trim());return match?[{name:match[1],status:match[2]}]:[]})
        // One batched show avoids a subprocess for every unit.
        const details=units.length?await run('/usr/bin/systemctl',[...prefix,'show',...units.map(unit=>unit.name),'--property=Id,Description,FragmentPath,ExecStart,ActiveState','--no-pager'],15000):''
        const blocks=new Map(details.trim().split(/\n\s*\n/).map(block=>{const data=Object.fromEntries(block.split('\n').map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)]}));return [data.Id,data]}))
        for(const unit of units){
          const data=blocks.get(unit.name)||{},exec=/path=([^;]+)\s*;/.exec(data.ExecStart||'')?.[1]?.trim()||'',file=data.FragmentPath||'',status=await existence(exec)
          const state:StartupState=unit.status.startsWith('enabled')?'enabled':['disabled','masked','masked-runtime'].includes(unit.status)?'disabled':'unknown'
          const protectedItem=!user||unit.status.startsWith('masked')||!file.startsWith(path.join(options.home,'.config/systemd/user')+path.sep)
          const item=baseItem({name:unit.name,owner:data.Description||unit.name,ownerId:digest(unit.name),kind:'systemd',scope:protectedItem?'system':'user',target:exec,configuration:file,state,orphan:status==='missing',description:data.Description||'',running:data.ActiveState==='active',timing:user?['login']:['boot'],access:protectedItem?'protected':'user',canToggle:!protectedItem&&state!=='unknown'&&status==='present',canRemove:!protectedItem&&status==='missing'&&data.ActiveState!=='active',issue:status==='missing'?'startup.targetMissing':null,icon:status==='present'?exec:null})
          // is-enabled exits nonzero for disabled units; read list-unit-files instead.
          const fresh=async():Promise<string>=>digest([await fingerprint(file),(await run('/usr/bin/systemctl',[...prefix,'list-unit-files',unit.name,'--no-legend','--no-pager'])).trim().split(/\s+/)[1],await existence(exec)])
          if(protectedItem||!file){records.push(inertRecord(item,'systemd:'+user+':'+unit.name));continue}
          records.push({item,key:'systemd:'+user+':'+unit.name,signature:await fresh(),validate:fresh,change:async action=>{
            if(action==='remove'){await run('/usr/bin/systemctl',['--user','disable',unit.name]);await options.trash(file);await run('/usr/bin/systemctl',['--user','daemon-reload'])}
            else await run('/usr/bin/systemctl',['--user',action,unit.name])
          }})
        }
        coverage.push({source:'systemd',status:'complete',message:'',count:units.length})
      }catch{coverage.push({source:'systemd',status:'unavailable',message:'startup.systemdUnavailable',count:0})}
    }
    return {records,coverage}
  }}
}
