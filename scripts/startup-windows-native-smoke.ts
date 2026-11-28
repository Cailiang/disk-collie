import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {startupWindowsProgram,encodePowershell,windowsStartup} from '../src/main/startup/windows'
import {startupFixture} from './startup-electron-smoke.mjs'

if(process.platform==='win32'){
  const fixture=startupFixture(),exec=promisify(execFile)
  try{
    const program=startupWindowsProgram({mode:'scan',pickKind:'registry'}).replaceAll('}catch{$partial=$true}',"}catch{$partial=$true;[Console]::Error.WriteLine($_.Exception.Message)}")
    const diagnostic=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encodePowershell(program)],{timeout:45000,encoding:'utf8',windowsHide:true,maxBuffer:24*1024**2})
    const data=JSON.parse(diagnostic.stdout.replace(/^\uFEFF/,''))
    console.log('Native registry diagnostics',JSON.stringify({coverage:data.coverage,owned:data.records.filter(row=>row.item.name.includes('dev.diskcollie.smoke.')).map(row=>row.item.name),errors:diagnostic.stderr}))
    const adapter=windowsStartup({profile:fixture.root})
    let catalog=await adapter.scan()
    const find=name=>catalog.records.find(record=>record.item.name===name)
    let live=find(fixture.names.live)
    assert(live,'The current-user Run fixture must be discovered: '+JSON.stringify(catalog.coverage))
    assert.equal(live.item.state,'enabled');assert(live.item.canToggle)
    await live.change('disable');catalog=await adapter.scan();live=find(fixture.names.live);assert.equal(live?.item.state,'disabled')
    await live!.change('enable');catalog=await adapter.scan();live=find(fixture.names.live);assert.equal(live?.item.state,'enabled')
    const orphan=find(fixture.names.orphan);assert(orphan?.item.orphan&&orphan.item.canRemove);await orphan.change('remove')
    catalog=await adapter.scan();assert(!find(fixture.names.orphan))
    assert.equal(find(fixture.names.protected)?.item.canRemove,false)
    console.log('Windows native startup smoke passed: real registry discovery, approval readback, orphan-only removal and protected entries')
  }finally{fixture.cleanup()}
}
