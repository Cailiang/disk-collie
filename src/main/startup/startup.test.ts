import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {macStartup,backgroundRecords,disabledServices,launchTarget} from './macos'
import {linuxStartup,desktopFields,hiddenDesktop} from './linux'
import {digest,command} from './common'
import {encodePowershell,startupWindowsProgram} from './windows'
import {windowsStartupScript} from './windows-script'
import {gunzipSync} from 'node:zlib'
const fixtures:string[]=[]
async function fixture():Promise<string>{const root=await mkdtemp(path.join(os.tmpdir(),'diskcollie-startup-test-'));fixtures.push(root);return root}
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
describe('startup source semantics',()=>{
  it('reads launchctl boolean and word overrides without equating loaded with enabled',()=>{
    expect([...disabledServices('"a" => true\n"b" => false\n"c" => disabled\n"d" => enabled')]).toEqual([['a',true],['b',false],['c',true],['d',false]])
    expect(launchTarget({ProgramArguments:['/bin/sh','/Users/owner/start.sh']})).toBe('/Users/owner/start.sh')
    expect(launchTarget({ProgramArguments:['/bin/sh','-c','echo /missing'] })).toBe('/bin/sh')
    expect(launchTarget({ProgramArguments:['/opt/tools/node','/Users/owner/missing-main.js']})).toBe('/Users/owner/missing-main.js')
    expect(launchTarget({ProgramArguments:['/usr/bin/env','PATH=/usr/bin','node','/Users/owner/missing-main.js']})).toBe('/Users/owner/missing-main.js')
    expect(launchTarget({ProgramArguments:['/usr/bin/env','-S','node /Users/owner/main.js']})).toBe('/usr/bin/env')
    expect(launchTarget({ProgramArguments:['relative-program']})).toBe('')
  })
  it('parses background records for the current user and machine without inventing missing states',()=>{
    const text='Records for UID 501 :\n#1:\n Name: Mail helper\n Type: login item\n Disposition: [enabled, allowed, visible]\n Identifier: mail.helper\n URL: file:///Applications/Mail%20Client.app/\n#2:\n Name: Disabled helper\n Disposition: [allowed, visible]\n Identifier: disabled\nRecords for UID 502 :\n#1:\n Name: Other user\n Disposition: [enabled, allowed]\nRecords for UID -2 :\n#1:\n Name: Machine helper\n Identifier: machine\n'
    const rows=backgroundRecords(text,501)
    expect(rows.map(row=>[row.name,row.state])).toEqual([['Mail helper','enabled'],['Disabled helper','disabled'],['Machine helper','unknown']])
    expect(rows[0].url).toContain('Mail%20Client')
  })
  it('toggles an owned launch registration using overrides, preserves the program and rejects changed configuration fingerprints',async()=>{
    const root=await fixture(),directory=path.join(root,'Library/LaunchAgents'),target=path.join(root,'owned-program'),config=path.join(directory,'dev.fixture.worker.plist'),overrides=new Map<string,boolean>()
    await mkdir(directory,{recursive:true});await writeFile(target,'owned program')
    const data={Label:'dev.fixture.worker',Program:target,RunAtLoad:true};await writeFile(config,JSON.stringify(data))
    const run=vi.fn<typeof command>(async(file,args)=>{
      if(file==='/usr/bin/osascript')return JSON.stringify(await Promise.all(args.slice(4).map(async file=>({path:file,data:JSON.parse(await readFile(file,'utf8'))}))))
      if(args[0]==='print-disabled')return [...overrides].map(([label,disabled])=>`"${label}" => ${disabled}`).join('\n')
      if(args[0]==='list')return 'PID Status Label\n- 0 dev.fixture.worker\n'
      if(args[0]==='disable'||args[0]==='enable'){overrides.set(args[1].split('/').at(-1)!,args[0]==='disable');return ''}
      throw new Error('Unexpected fixture command')
    })
    const trash=vi.fn(async(file:string)=>{await rm(file)})
    const adapter=macStartup({home:root,profile:path.join(root,'profile'),fixture:root,uid:501,run,trash})
    let record=(await adapter.scan()).records[0]
    expect(record.item).toMatchObject({state:'enabled',running:false,canToggle:true,canRemove:true,orphan:false})
    expect(await record.validate()).toBe(record.signature)
    await record.change('disable');expect(await readFile(config,'utf8')).toBe(JSON.stringify(data))
    expect(await readFile(target,'utf8')).toBe('owned program')
    record=(await adapter.scan()).records[0];expect(record.item.state).toBe('disabled');expect(await record.validate()).toBe(record.signature)
    await record.change('enable');record=(await adapter.scan()).records[0];expect(record.item.state).toBe('enabled')
    await writeFile(config,JSON.stringify({...data,Program:'/different'}));expect(await record.validate()).not.toBe(record.signature)
    await writeFile(config,JSON.stringify(data));record=(await adapter.scan()).records[0];await record.change('remove')
    expect(trash).toHaveBeenCalledWith(config);expect(await readFile(target,'utf8')).toBe('owned program')
  })
  it('snapshots a launch alias and removes the alias while preserving its target configuration',async()=>{
    const root=await fixture(),directory=path.join(root,'Library/LaunchAgents'),config=path.join(directory,'dev.fixture.link.plist'),real=path.join(root,'outside.plist'),program=path.join(root,'program')
    await mkdir(directory,{recursive:true});await writeFile(program,'owned program');await writeFile(real,JSON.stringify({Label:'dev.fixture.link',Program:program}));await symlink(real,config)
    const run:typeof command=async(file,args)=>file==='/usr/bin/osascript'?JSON.stringify([{path:config,data:JSON.parse(await readFile(real,'utf8'))}]):''
    const adapter=macStartup({home:root,profile:root,fixture:root,uid:501,run,trash:async file=>rm(file)})
    const [record]=(await adapter.scan()).records
    expect(record.item.canToggle).toBe(true);expect(record.item.canRemove).toBe(true)
    expect(await record.validate()).toBe(record.signature)
    await record.change('remove')
    expect(JSON.parse(await readFile(real,'utf8')).Program).toBe(program);expect(await readFile(program,'utf8')).toBe('owned program')
  })
  it('retains desktop keys, applies user overrides, and never deletes an executable',async()=>{
    const root=await fixture(),directory=path.join(root,'autostart'),target=path.join(root,'program'),file=path.join(directory,'fixture.desktop')
    await mkdir(directory);await writeFile(target,'owned executable')
    const source=`[Desktop Entry]\nType=Application\nName=Fixture\nExec="${target}" --flag\nOnlyShowIn=GNOME;\nX-Custom=retain\n[Other]\nHidden=retain\n`
    await writeFile(file,source)
    const adapter=linuxStartup({home:root,profile:root,fixture:root,env:{XDG_CURRENT_DESKTOP:'GNOME'},trash:async file=>rm(file)})
    let [record]=(await adapter.scan()).records
    expect(record.item.state).toBe('enabled');await record.change('disable')
    expect(desktopFields(await readFile(file,'utf8'))).toMatchObject({Hidden:'true','X-Custom':'retain'})
    expect(await readFile(file,'utf8')).toContain('[Other]\nHidden=retain')
    ;[record]=(await adapter.scan()).records;expect(record.item.state).toBe('disabled');await record.change('enable')
    ;[record]=(await adapter.scan()).records;expect(record.item.state).toBe('enabled');await record.change('remove')
    expect(await readFile(target,'utf8')).toBe('owned executable')
    expect(()=>hiddenDesktop('[Not Desktop]\nName=x',true)).toThrow('startup.invalid')
  })
  it('canonicalizes native snapshots independently of PowerShell object property order',()=>{
    expect(digest({state:1,data:{x:2,y:3}})).toBe(digest({data:{y:3,x:2},state:1}))
    expect(digest({state:1})).not.toBe(digest({state:2}))
  })
  it('packs the complete fixed Windows adapter below the native command-line limit without truncating its program',()=>{
    const encoded=encodePowershell(windowsStartupScript),wrapper=Buffer.from(encoded,'base64').toString('utf16le'),packed=/FromBase64String\('([^']+)'\)/.exec(wrapper)![1]
    expect(encoded.length).toBeLessThan(30000)
    expect(gunzipSync(Buffer.from(packed,'base64')).toString('utf8')).toBe(windowsStartupScript)
    for(const pickKind of ['registry','folder','task','service']){
      const request={mode:'change',pickKind,pickKey:'owned fixture',action:'disable',expected:{data:'owned value',state:'enabled'}}
      const single=encodePowershell(startupWindowsProgram(request))
      expect(encodePowershell(`Start-Process powershell.exe -Verb RunAs -ArgumentList @('-EncodedCommand','${single}') -Wait`).length).toBeLessThan(30000)
    }
  })
})
