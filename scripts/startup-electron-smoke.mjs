import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

export function startupFixture(){
  const root=mkdtempSync(path.join(tmpdir(),'diskcollie-startup-smoke-')),prefix='dev.diskcollie.smoke.'+randomUUID().replaceAll('-',''),names={live:prefix+'.live',orphan:prefix+'.orphan',protected:prefix+'.protected'},program=path.join(root,process.platform==='win32'?'keep-program.txt':'keep-program.sh'),missing=path.join(root,'missing-program')
  writeFileSync(program,'#!/bin/sh\nexit 0\n');chmodSync(program,0o700)
  const files={}
  const ps=source=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';"+source,'utf16le').toString('base64')],{timeout:15000,windowsHide:true,encoding:'utf8'})
  const setRunRows=rows=>{
    const payload=Buffer.from(JSON.stringify(rows)).toString('base64')
    ps(`$rows=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')));$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run');try{foreach($r in $rows){$key.SetValue($r.name,$r.data,[Microsoft.Win32.RegistryValueKind]::String)}}finally{$key.Dispose()}`)
  }
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  const realTarget=process.platform==='win32'?process.execPath:program
  const writeLive=target=>{
    if(process.platform==='darwin')writeFileSync(files.live,`<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${names.live}</string><key>Program</key><string>${escape(target)}</string><key>RunAtLoad</key><false/></dict></plist>`)
    else if(process.platform==='linux')writeFileSync(files.live,`[Desktop Entry]\nType=Application\nName=${names.live}\nExec="${target}"\nX-Owned=retain\n`)
    else setRunRows([{name:names.live,data:'"'+target+'" --version'}])
  }
  if(process.platform==='darwin'){
    mkdirSync(path.join(root,'Library/LaunchAgents'),{recursive:true})
    for(const kind of ['live','orphan','protected']){
      files[kind]=path.join(root,'Library/LaunchAgents',names[kind]+'.plist')
      const label=kind==='protected'?'com.apple.'+names.protected:names[kind]
      const target=kind==='orphan'?missing:program
      writeFileSync(files[kind],`<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>Program</key><string>${escape(target)}</string><key>RunAtLoad</key><false/></dict></plist>`)
    }
  }else if(process.platform==='linux'){
    mkdirSync(path.join(root,'autostart'))
    for(const kind of ['live','orphan','protected']){files[kind]=path.join(root,'autostart',names[kind]+'.desktop');writeFileSync(files[kind],`[Desktop Entry]\nType=Application\nName=${names[kind]}\nExec="${kind==='orphan'?missing:kind==='protected'?'/usr/lib/diskcollie-protected-fixture':program}"\n`)}
  }else{
    setRunRows([{name:names.orphan,data:'"'+missing+'.exe"'},{name:names.protected,data:'"'+path.join(process.env.SystemRoot,'System32/cmd.exe')+'" /c exit'}])
  }
  writeLive(realTarget)
  return {root,names,program,files,realTarget,writeLive,cleanup(){
    if(process.platform==='win32'){
      const payload=Buffer.from(JSON.stringify(Object.values(names))).toString('base64')
      ps(`$names=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')));foreach($path in @('Software\\Microsoft\\Windows\\CurrentVersion\\Run','Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run')){$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$true);if($key){try{foreach($n in $names){$key.DeleteValue($n,$false)}}finally{$key.Dispose()}}}`)
    }else if(process.platform==='darwin')for(const name of [names.live,names.orphan])try{execFileSync('/bin/launchctl',['enable',`gui/${process.getuid()}/${name}`],{timeout:5000})}catch{}
    rmSync(root,{recursive:true,force:true})
  }}
}

export async function verifyStartupFixture(page,fixture){
  let catalog=await page.evaluate(()=>window.diskCollie.startupScan())
  const find=(name)=>catalog.items.find(item=>item.name.includes(name))
  let live=find(fixture.names.live),orphan=find(fixture.names.orphan),protectedItem=find(fixture.names.protected)
  assert(live&&orphan&&protectedItem,'All owned startup fixtures must be discovered: '+JSON.stringify({coverage:catalog.coverage,owned:catalog.items.filter(item=>item.name.includes('dev.diskcollie.smoke.')).map(item=>item.name)}))
  assert.equal(live.state,'enabled');assert(live.canToggle,'An enabled but non-running fixture must be manageable')
  assert(orphan.orphan&&orphan.canRemove&&!orphan.canToggle,'A missing exact target is a removable leftover')
  assert.equal(protectedItem.canToggle,false)
  const change=async(action,item)=>{const result=await page.evaluate(input=>window.diskCollie.startupChange(input),{catalogId:catalog.id,ids:[item.id],action});assert(result.results.every(item=>item.ok),JSON.stringify(result));catalog=result.catalog;return result}
  const source=process.platform==='win32'?null:readFileSync(fixture.files.live,'utf8')
  await change('disable',live);live=find(fixture.names.live);assert.equal(live.state,'disabled')
  if(source&&process.platform==='darwin')assert.equal(readFileSync(fixture.files.live,'utf8'),source,'launchctl overrides must preserve the plist')
  await change('enable',live);live=find(fixture.names.live);assert.equal(live.state,'enabled')
  fixture.writeLive(path.join(fixture.root,'changed-target'))
  const drift=await page.evaluate(async input=>{try{await window.diskCollie.startupChange(input);return false}catch(error){return /发生变化|has changed/.test(String(error))}},{catalogId:catalog.id,ids:[live.id],action:'disable'})
  assert(drift,'A configuration changed after scan must not authorize a mutation')
  fixture.writeLive(fixture.realTarget);catalog=await page.evaluate(()=>window.diskCollie.startupScan());orphan=find(fixture.names.orphan)
  await change('remove',orphan);assert(!find(fixture.names.orphan));assert(existsSync(fixture.realTarget));assert(existsSync(fixture.program),'Removing startup registrations must preserve program files')
  const protectedId=find(fixture.names.protected).id
  const blocked=await page.evaluate(async input=>{try{await window.diskCollie.startupChange(input);return false}catch{return true}},{catalogId:catalog.id,ids:[protectedId],action:'remove'})
  assert(blocked,'System-managed registrations must be rejected in main')
  await page.locator('.nav-button[title="启动项优化"]').click();await page.locator('.space-startup .startup-group').first().waitFor({timeout:60000})
  const workspace=page.locator('.space-startup');await workspace.getByRole('searchbox').fill(fixture.names.live)
  const group=workspace.locator('.startup-group');assert.equal(await group.count(),1)
  await group.locator('.startup-group-name').click();await group.locator('.startup-item').first().waitFor()
  const row=group.locator(`[data-startup-item="${find(fixture.names.live).id}"]`)
  assert.equal(await row.getByRole('switch').getAttribute('aria-checked'),'true')
  await row.getByRole('button',{name:'移除启动配置 '+fixture.names.live,exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'移除启动配置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden',timeout:60000})
  assert.equal(await workspace.locator('.startup-group').count(),0)
  assert(existsSync(fixture.program))
  const history=await page.evaluate(()=>window.diskCollie.listMaintenanceRuns());assert(history.some(run=>run.operations.some(operation=>operation.kind.startsWith('startup-')&&operation.status==='completed')),'Verified startup actions must persist in the local maintenance ledger')
  assert.equal(await page.getByRole('alertdialog').count(),0)
  console.log('Startup Electron passed: real source discovery, enable/disable readback, stale configuration rejection, protected entries, registration-only removal, Renderer and local operation history')
}
