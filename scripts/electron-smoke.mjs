import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { _electron as electronLauncher } from 'playwright-core'
import { verifyProviderKeyEditing } from './provider-key-smoke.mjs'
const profile=mkdtempSync(path.join(tmpdir(),'memento-electron-smoke-'))
const fixture=mkdtempSync(path.join(homedir(),'memento-smoke-'))
const first=path.join(fixture,'memento-smoke-copy-a.bin'), second=path.join(fixture,'memento-smoke-copy-b.bin')
writeFileSync(first,Buffer.alloc(12*1024*1024,23));writeFileSync(second,Buffer.alloc(12*1024*1024,23))
let electronApp
try{
  electronApp=await electronLauncher.launch({...(process.env.MEMENTO_SMOKE_EXECUTABLE?{executablePath:process.env.MEMENTO_SMOKE_EXECUTABLE}:{}),args:[...(process.env.MEMENTO_SMOKE_EXECUTABLE?[]:['.']),`--user-data-dir=${profile}`],env:{...process.env,MEMENTO_TEST_RUN:'1',MEMENTO_TEST_STORAGE_ROOT:fixture}})
  const p=await electronApp.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message))
  await p.locator('.nav-button[title="首页"]').waitFor({timeout:20000})
  assert(await p.evaluate(()=>Boolean(window.memento?.storageScan&&window.memento.storageDuplicates&&window.memento.storageUninstall&&window.memento.terminateOverviewProcess)))
  const initial=await p.evaluate(()=>window.memento.storageState());assert.equal(initial.index,null,'Launch must not silently scan the home directory')
  const version=await p.evaluate(()=>window.memento.getVersion());assert.match(await p.locator('.brand-version').innerText(),new RegExp(version.replaceAll('.','\\.')))
  const providers=await p.evaluate(()=>window.memento.listAgentProviders());assert(!providers.some(p=>'apiKey'in p))
  await p.locator('.nav-button[title="进程管理"]').click();await p.locator('.space-process-row').first().waitFor({timeout:20000});const metrics=await p.evaluate(()=>window.memento.getOverviewMetrics());assert(metrics.processes.length>0);assert(metrics.memory.totalBytes>0);assert(Number.isFinite(metrics.cpu.usagePercent))
  await p.locator('.space-process-row').first().click();await p.screenshot({path:'/tmp/memento-electron-processes.png'})
  await p.locator('.nav-button[title="空间分析"]').click();await p.getByRole('button',{name:'开始扫描',exact:true}).click();await p.locator('.space-treemap-cell').first().waitFor({timeout:30000});assert.equal(await p.locator('.space-folder-row').count(),2)
  const state=await p.evaluate(()=>window.memento.storageState());assert.equal(state.index.entries,3);assert.equal(state.index.errors,0)
  const large=await p.evaluate(generation=>window.memento.storageLarge({generation,minimum:1,search:'',offset:0}),state.index.generation);assert.equal(large.count,2)
  await p.locator('.nav-button[title="大文件"]').click();await p.getByRole('combobox',{name:'最小文件大小'}).selectOption(String(10*1024**2));await p.locator('.space-file-row').first().waitFor();assert.equal(await p.locator('.space-file-row input:checked').count(),0)
  await p.locator('.nav-button[title="重复文件"]').click();await p.getByRole('button',{name:'查找重复文件',exact:true}).click();await p.locator('.space-duplicate-group').first().waitFor({timeout:30000});const duplicates=await p.evaluate(g=>window.memento.storageDuplicates(g),state.index.generation);assert.equal(duplicates.groups.length,1)
  const g=duplicates.groups[0]
  const blocked=await p.evaluate(async({generation,group})=>{try{await window.memento.storageTrash({generation,ids:group.files.map(f=>f.id),kind:'duplicates',groupId:group.id});return false}catch(e){return /Keep at least one/.test(String(e))}},{generation:state.index.generation,group:g});assert(blocked,'Main process must prevent deleting every copy')
  await p.getByRole('button',{name:'选择多余副本',exact:true}).click();await p.getByRole('button',{name:'移走所选副本',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert(existsSync(first)&&existsSync(second),'Cancellation must preserve both files')
  await p.getByRole('button',{name:'移走所选副本',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'移到废纸篓',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();assert(existsSync(first)!==existsSync(second),'Exactly one verified duplicate must remain')
  await p.locator('.nav-button[title="清理记录"]').click();await p.locator('.space-activity-row').first().waitFor();assert.match(await p.locator('.space-activity').innerText(),/重复副本/)
  const after=await p.evaluate(()=>window.memento.storageState());assert.equal(after.history[0].items,1);assert.equal(after.history[0].failures,0);assert.equal(after.index,null)
  await p.locator('.nav-button[title="应用卸载"]').click();await p.locator('.space-app-row').first().waitFor({timeout:90000});const applicationCount=await p.locator('.space-app-row').count();assert(applicationCount>0)
  await p.locator('.nav-button[title="隐私清理"]').click();await p.locator('.space-cleanup-summary').waitFor({timeout:30000});assert.equal(await p.locator('.space-cleanup-row input:checked').count(),0)
  await verifyProviderKeyEditing(p)
  assert.deepEqual(errors,[])
  console.log(`Electron smoke passed: production IPC, native scan (${state.index.elapsedMs}ms), duplicate guard and real Trash operation on owned fixtures, persisted activity, ${metrics.processes.length} processes, ${applicationCount} applications, privacy opt-in, encrypted provider editing. Version ${version}.`)
}finally{
  await electronApp?.close().catch(()=>undefined)
  rmSync(profile,{recursive:true,force:true});rmSync(fixture,{recursive:true,force:true})
}
