import assert from 'node:assert/strict'
import {existsSync,mkdirSync,readFileSync,realpathSync,utimesSync,writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import path from 'node:path'

const groupNames={system:'系统垃圾','user-cache':'用户缓存',browser:'浏览器缓存',application:'应用数据',development:'开发工具',project:'项目依赖',xcode:'Xcode',ai:'AI 缓存',container:'容器缓存','application-optimization':'应用优化',custom:'其他位置'}
const within=(root,target)=>{const relative=path.relative(root,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}
const sorted=(values)=>[...values].sort()

/** All destructive smoke inputs are created beneath this explicit, owned home. */
export function createDeepFixture(root){
  mkdirSync(root,{recursive:true});root=realpathSync(root)
  assert(root!==path.parse(root).root&&root!==realpathSync(homedir()),'A real user home must never be used for the deep-clean fixture')
  const marker=path.join(root,'.diskcollie-deep-clean-smoke-owned')
  assert(!existsSync(marker),'Use a new empty deep-clean fixture home')
  writeFileSync(marker,'Owned deep-clean smoke fixture\n')
  const old=new Date(Date.now()-14*86400000),files=[]
  const write=(relative,value)=>{const target=path.join(root,relative);assert(within(root,target));mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,value);utimesSync(target,old,old);files.push(target);return target}
  const cache=process.platform==='darwin'?'Library/Caches':process.platform==='win32'?'AppData/Local':'.cache'
  const pip=process.platform==='win32'?path.join(cache,'pip/Cache'):path.join(cache,'pip')
  const uv=process.platform==='win32'?path.join(cache,'uv/cache'):path.join(cache,'uv')
  const pipFiles=Array.from({length:128},(_,index)=>write(path.join(pip,`deep-smoke-cache-${String(index).padStart(3,'0')}.bin`),Buffer.alloc(1024+index,17)))
  const keptUv=write(path.join(uv,'unselected-wheel.bin'),'unselected cached wheel')
  const pipCredentials=write(path.join(pip,'auth.json'),'{"token":"OWNED_AUTH_TOKEN"}')
  const unknownRoot=path.join(cache,'dev.diskcollie.unrecognized-cleanup')
  const unknownCache=write(path.join(unknownRoot,'unrecognized-cache.bin'),'explicitly reviewed cache')
  const unknownCredentials=write(path.join(unknownRoot,'credentials.json'),'{"token":"OWNED_UNKNOWN_CACHE_TOKEN"}')
  // The macOS scanner has generic user-cache discovery; other platforms use an explicit manual-review store.
  const manualRoot=process.platform==='darwin'?unknownRoot:'.m2/repository'
  const manualFile=process.platform==='darwin'?unknownCache:write(path.join(manualRoot,'reviewed-artifact.bin'),'explicitly reviewed dependency cache')
  const code=process.platform==='darwin'?'Library/Application Support/Code':process.platform==='win32'?'AppData/Roaming/Code':'.config/Code'
  const settings=write(path.join(code,'User/settings.json'),'{"editor.fontSize":14}')
  const codeAuth=write(path.join(code,'User/auth.json'),'{"token":"OWNED_CODE_AUTH"}')
  const source=write('Projects/owned-deep-project/src/index.js','export const ownedSource = true\n')
  const projectMarker=write('Projects/owned-deep-project/package.json','{"name":"owned-deep-project","private":true}')
  const projectEnv=write('Projects/owned-deep-project/.env','OWNED_SECRET=preserve\n')
  const output=write('Projects/owned-deep-project/dist/owned-output.js','owned regenerable build output\n')
  const projectRoot=path.dirname(projectMarker),projectArtifact=path.dirname(output)
  const protectedArtifact=write('Projects/owned-deep-project/build/private.key','OWNED_PRIVATE_KEY')
  const protectedOutput=write('Projects/owned-deep-project/build/output.bin','protected sibling build output')
  const sshKey=write('.ssh/id_ed25519','OWNED_SSH_KEY')
  const model=write('.ollama/models/owned-model.gguf','OWNED_MODEL_DATA')
  for(const directory of [projectArtifact,path.dirname(protectedArtifact),projectRoot])utimesSync(directory,old,old)
  return {root,pipRoot:path.join(root,pip),pipFiles,keptUv,pipCredentials,manualRoot:path.join(root,manualRoot),manualFile,unknownCache,unknownCredentials,settings,codeAuth,source,projectMarker,projectEnv,projectRoot,projectArtifact,output,protectedArtifact,protectedOutput,sshKey,model,files}
}

async function waitDeep(page){
  await page.locator('.deep-clean-page').waitFor()
  await page.waitForFunction(()=>document.querySelector('.deep-clean-page .deep-workspace')&&!document.querySelector('.deep-clean-page .deep-heading-actions button:last-child')?.disabled,null,{timeout:90000})
}
async function showSource(page,pair){
  const workspace=page.locator('.deep-clean-page')
  await workspace.locator('.deep-categories button').filter({hasText:groupNames[pair.item.group]}).click()
  const rule=workspace.locator(`[data-deep-rule=${JSON.stringify(pair.item.key)}]`)
  const toggle=rule.locator('.deep-rule-toggle')
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  const source=rule.locator(`[data-deep-source="${pair.source.id}"]`);await source.waitFor();return source
}
const readPreserved=(fixture)=>{
  assert.equal(readFileSync(fixture.settings,'utf8'),'{"editor.fontSize":14}')
  assert.equal(readFileSync(fixture.codeAuth,'utf8'),'{"token":"OWNED_CODE_AUTH"}')
  assert.equal(readFileSync(fixture.source,'utf8'),'export const ownedSource = true\n')
  assert.match(readFileSync(fixture.projectMarker,'utf8'),/owned-deep-project/)
  assert.equal(readFileSync(fixture.projectEnv,'utf8'),'OWNED_SECRET=preserve\n')
  assert.equal(readFileSync(fixture.protectedArtifact,'utf8'),'OWNED_PRIVATE_KEY')
  assert.equal(readFileSync(fixture.protectedOutput,'utf8'),'protected sibling build output')
  assert.equal(readFileSync(fixture.sshKey,'utf8'),'OWNED_SSH_KEY')
  assert.equal(readFileSync(fixture.model,'utf8'),'OWNED_MODEL_DATA')
  assert.equal(readFileSync(fixture.pipCredentials,'utf8'),'{"token":"OWNED_AUTH_TOKEN"}')
  assert.equal(readFileSync(fixture.unknownCredentials,'utf8'),'{"token":"OWNED_UNKNOWN_CACHE_TOKEN"}')
  assert.equal(readFileSync(fixture.keptUv,'utf8'),'unselected cached wheel')
}

/** Use the production IPC and UI. The caller must launch with both test roots pointing at fixture.root. */
export async function verifyDeepFixture(page,fixture){
  assert.equal(realpathSync(fixture.root),fixture.root)
  await page.locator('.nav-button[title="深度清理"]').click()
  const initial=page.locator('.deep-first-scan')
  if(await initial.count())await initial.getByRole('button',{name:'开始扫描',exact:true}).click()
  else await page.locator('.deep-heading-actions').getByRole('button',{name:'重新扫描',exact:true}).click()
  await waitDeep(page)
  assert.equal(await page.locator('.deep-source input:checked').count(),0,'Deep cleanup must start with no selected source')
  const scan=await page.evaluate(()=>window.diskCollie.storageDeepScan())
  const pairs=scan.items.flatMap((item)=>item.sources.map((source)=>({item,source})))
  assert(pairs.length>0)
  for(const {source} of pairs)assert(within(fixture.root,source.path),`A fixture scan must not register a source outside its owned home: ${source.path}`)
  const find=(target)=>pairs.find(({source})=>source.path===target)
  const pip=find(fixture.pipRoot),manual=find(fixture.manualRoot),project=find(fixture.projectArtifact),model=pairs.find(({source})=>within(source.path,fixture.model)||source.path===fixture.model)
  assert(pip&&manual&&project&&!model,'Expected actionable Python/cache/project sources, with model stores excluded')
  assert(scan.items.every((item)=>item.risk!=='protected'&&item.sources.every((source)=>source.cleanupMethod!=='none'&&source.status!=='review-only')),'Deep cleanup must not register inspection-only sources')
  assert(scan.items.every((item,index,items)=>index===0||items[index-1].size>=item.size),'Cleanup items must be largest first')
  assert.equal(pip.source.count,128);assert.equal(pip.source.status,'ready','Pip/uv must be stopped for this cleanup fixture')
  assert.equal(manual.item.risk,'review');assert.equal(manual.item.recommended,false);assert.equal(manual.source.status,'ready')
  assert.equal(project.item.risk,'review');assert.equal(project.source.cleanupMethod,'trash')
  assert(!find(path.dirname(fixture.protectedArtifact)),'A project build directory containing key material must not be a cleanup candidate')
  const first=await page.evaluate(id=>window.diskCollie.storageDeepPreview({id,offset:0}),pip.source.id)
  const second=await page.evaluate(id=>window.diskCollie.storageDeepPreview({id,offset:100}),pip.source.id)
  assert.equal(first.files.length,100);assert.equal(first.total,128);assert.equal(first.nextOffset,100);assert.equal(second.files.length,28);assert.equal(second.nextOffset,null)
  const previewed=[...first.files,...second.files]
  assert.deepEqual(sorted(previewed.map((file)=>file.path)),sorted(fixture.pipFiles));assert(previewed.every((file)=>within(fixture.root,file.path)))
  const invalid=await page.evaluate(async({cleanId,unregisteredId})=>{
    const unknown=await window.diskCollie.storageDeepPreview({id:crypto.randomUUID(),offset:0}).then(()=>false,()=>true)
    const unregisteredSelection=await window.diskCollie.storageDeepClean({ids:[cleanId,unregisteredId],skipRunning:false}).then(()=>false,()=>true)
    return {unknown,unregisteredSelection}
  },{cleanId:pip.source.id,unregisteredId:crypto.randomUUID()})
  assert(invalid.unknown&&invalid.unregisteredSelection,'IPC must reject unknown preview IDs and reject mixed selections containing unregistered IDs')
  assert(fixture.pipFiles.every(existsSync),'An unregistered mixed selection must leave every valid source intact')
  // Build a real retained index that contains these same files, then verify cleanup reconciles it.
  const index=await page.evaluate(()=>window.diskCollie.storageScan({mode:'analysis',includeHidden:true}))
  assert(index?.root&&(index.root.path===fixture.root||within(index.root.path,fixture.root)),'Set DISKCOLLIE_TEST_STORAGE_ROOT to contain the owned deep-clean home')
  const before=await page.evaluate(generation=>window.diskCollie.storageLarge({generation,minimum:1,search:'deep-smoke-cache-',offset:0}),index.generation)
  assert.equal(before.count,128)
  let source=await showSource(page,pip);await source.locator('.deep-source-details').click()
  const preview=page.getByRole('dialog');await page.locator('.deep-preview-file').first().waitFor();assert.equal(await page.locator('.deep-preview-file').count(),100)
  assert.match(await preview.innerText(),/deep-smoke-cache-/);await preview.locator('.deep-preview-pagination button').click();await page.waitForFunction(()=>document.querySelectorAll('.deep-preview-file').length===128)
  await preview.getByRole('button',{name:'选择此来源',exact:true}).click();await preview.getByRole('button',{name:'关闭',exact:true}).click()
  source=await showSource(page,manual);assert.equal(await source.locator('input').isChecked(),false);await source.locator('input').check()
  source=await showSource(page,project);await source.locator('input').check()
  const projectSkipped=project.source.status==='requires-close'
  if(projectSkipped){
    const blocked=await page.evaluate(id=>window.diskCollie.storageDeepClean({ids:[id],skipRunning:false}).then(()=>false,()=>true),project.source.id)
    assert(blocked,'Running build tools must block project removal before changes')
  }else assert.equal(project.source.status,'ready')
  const batch=page.locator('.deep-batch-actions');await batch.getByRole('button',{name:'清理所选项目',exact:true}).click()
  assert.match(await page.getByRole('dialog').innerText(),/废纸篓/);assert.match(await page.getByRole('dialog').innerText(),/永久删除/)
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert(fixture.pipFiles.every(existsSync));assert(existsSync(fixture.manualFile));assert(existsSync(fixture.output));readPreserved(fixture)
  await batch.getByRole('button',{name:'清理所选项目',exact:true}).click()
  if(projectSkipped)await page.getByRole('dialog').getByRole('checkbox',{name:'跳过正在使用的应用',exact:true}).check()
  await page.getByRole('dialog').getByRole('button',{name:'清理所选项目',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click()
  const state=await page.evaluate(()=>window.diskCollie.storageState()),activity=state.history.find((record)=>record.deepCleanIds?.includes(pip.source.id))
  assert(activity,'Deep-clean activity must be persisted')
  const cleaned=projectSkipped?[pip,manual]:[pip,manual,project],sourceIds=cleaned.map(({source})=>source.id)
  assert.equal(activity.kind,'cleanup');assert.equal(activity.items,cleaned.length);assert.equal(activity.failures,0);assert.equal(activity.skipped,projectSkipped?1:0)
  assert.equal(activity.bytes,cleaned.reduce((sum,{source})=>sum+source.size,0));assert.equal(activity.traces,cleaned.reduce((sum,{source})=>sum+source.count,0))
  assert.deepEqual(sorted(activity.deepCleanIds),sorted(sourceIds));assert.deepEqual(sorted(activity.locations),sorted(cleaned.map(({source})=>source.path)))
  const removed=[...fixture.pipFiles,fixture.manualFile,...(projectSkipped?[]:[fixture.projectArtifact])]
  assert.deepEqual(sorted(activity.removedPaths),sorted(removed));assert(activity.removedPaths.every((target)=>within(fixture.root,target)))
  assert(fixture.pipFiles.every((target)=>!existsSync(target)));assert(!existsSync(fixture.manualFile));readPreserved(fixture)
  if(projectSkipped)assert(existsSync(fixture.output),'Skipped project output must stay in place')
  else {assert(!existsSync(fixture.projectArtifact),'Owned project output must move to the actual OS Trash');assert(existsSync(fixture.projectRoot))}
  const after=await page.evaluate(generation=>window.diskCollie.storageLarge({generation,minimum:1,search:'deep-smoke-cache-',offset:0}),index.generation)
  assert.equal(after.count,0,'Confirmed cleanup must reconcile a retained analysis index without rescanning')
  assert.equal(await page.locator('.deep-clean-page .deep-first-scan').count(),0,'Cleanup must retain its result workspace')
  const refreshed=await page.evaluate(()=>window.diskCollie.storageDeepScan())
  for(const target of [fixture.pipRoot,fixture.manualRoot])assert.equal(refreshed.items.flatMap((item)=>item.sources).find((entry)=>entry.path===target)?.count||0,0)
  return {activityId:activity.id,sourceIds,removedCount:removed.length,projectSkipped}
}
