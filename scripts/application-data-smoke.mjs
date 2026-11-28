import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

export async function verifyApplicationDataUi(browser,baseUrl,directory,viewports){
  for(const viewport of viewports){
    const page=await browser.newPage({viewport})
    try{
      await page.goto(baseUrl);await page.locator('.nav-button[title="空间分析"]').click()
      const map=page.getByRole('group',{name:'空间分布图'}),tree=page.getByRole('tree',{name:'文件夹内容'})
      for(const name of ['Library','Application Support','NoMachine'])await map.getByRole('button',{name:new RegExp('^'+name+' ')}).click()
      const remove=tree.getByRole('button',{name:'移到废纸篓 NoMachine',exact:true})
      assert(await remove.isEnabled(),'A selected third-party support folder must have a review action')
      await remove.click();const dialog=page.getByRole('dialog'),confirm=dialog.getByRole('button',{name:'移到废纸篓',exact:true}),ack=dialog.getByRole('checkbox',{name:'我确认不再需要所选目录中的应用数据',exact:true})
      assert.equal(await dialog.getByRole('heading').innerText(),'将应用数据移到废纸篓');assert.match(await dialog.innerText(),/配置、账户资料、数据库和文件/);assert(await confirm.isDisabled())
      await ack.check();assert(await confirm.isEnabled());await dialog.getByRole('button',{name:'取消',exact:true}).click()
      await remove.click();assert(await confirm.isDisabled());assert.equal(await ack.isChecked(),false)
      await ack.check();await page.screenshot({path:`${directory}/${viewport.width}-application-data-review.png`})
      await confirm.click();await dialog.getByRole('button',{name:'完成',exact:true}).click()
      assert.equal(await tree.getByRole('button',{name:'移到废纸篓 NoMachine',exact:true}).count(),0)
      const apple=tree.locator('.space-folder-row').filter({has:page.locator('.tree-folder-name[title="/Library/Application Support/com.apple.idleassetsd"]')})
      assert(await apple.locator('.file-trash').isDisabled(),'Apple-managed application data remains protected')
      assert.equal(await page.locator('.space-breadcrumbs button').last().innerText(),'Application Support')
      assert.equal(await page.getByRole('alertdialog').count(),0)
    }finally{await page.close()}
  }
  console.log('Application data UI passed: explicit review, required acknowledgement, cancel/reset, complete-folder Trash and protected Apple data at four viewports')
}

export async function verifyApplicationDataElectron(page,root){
  if(process.platform!=='darwin')return
  const name='DiskCollieOwnedNoMachine-'+randomUUID(),folder=path.join(root,'Library/Application Support',name),keep=path.join(root,'Library/Application Support/DiskCollieKeepOtherData/canary.txt')
  mkdirSync(path.join(folder,'var'),{recursive:true});mkdirSync(path.dirname(keep),{recursive:true})
  writeFileSync(path.join(folder,'var/server.log'),'owned application log');writeFileSync(path.join(folder,'private.key'),'owned app credential');writeFileSync(keep,'keep other data')
  await page.locator('.nav-button[title="空间分析"]').click()
  const scope=page.getByRole('checkbox',{name:'包含隐藏目录和应用数据',exact:true});if(!await scope.isChecked())await scope.check()
  await page.locator('.space-disk .space-heading .space-button.primary,.space-disk .space-start .space-button.primary').click()
  await page.locator('.space-disk .space-progress').waitFor({state:'hidden'})
  for(const directory of [path.join(root,'Library'),path.join(root,'Library/Application Support'),folder])await page.locator('.tree-folder-name[title="'+directory+'"]').click()
  const state=await page.evaluate(()=>window.diskCollie.storageState()),generation=state.indexes.analysis.generation
  let parent=state.indexes.analysis.root
  for(const directory of [path.join(root,'Library'),path.join(root,'Library/Application Support'),folder]){
    const children=await page.evaluate(input=>window.diskCollie.storageChildren(input),{generation,id:parent.id})
    parent=children.items.find(entry=>entry.path===directory);assert(parent,directory)
  }
  assert(parent.trashable&&parent.applicationData)
  const plan=await page.evaluate(input=>window.diskCollie.storageDirectoryPlan(input),{generation,id:parent.id})
  const blocked=await page.evaluate(async input=>{try{await window.diskCollie.storageTrash(input);return false}catch(error){return /确认|Confirm/.test(String(error))}},{generation,ids:[parent.id],kind:'analysis',directoryPlanId:plan.id})
  assert(blocked&&existsSync(folder),'IPC must reject missing application-data acknowledgement')
  const remove=page.getByRole('tree').getByRole('button',{name:'移到废纸篓 '+name,exact:true})
  await remove.click();const dialog=page.getByRole('dialog'),confirm=dialog.getByRole('button',{name:'移到废纸篓',exact:true})
  assert(await confirm.isDisabled());await dialog.getByRole('button',{name:'取消',exact:true}).click();assert(existsSync(folder))
  await remove.click();await dialog.getByRole('checkbox',{name:'我确认不再需要所选目录中的应用数据',exact:true}).check();await confirm.click();await dialog.getByRole('button',{name:'完成',exact:true}).click()
  assert(!existsSync(folder));assert.equal(readFileSync(keep,'utf8'),'keep other data');assert.equal(await page.getByRole('alertdialog').count(),0)
  console.log('Application data Electron passed: owned support-directory review, main-process acknowledgement, real Trash and sibling preservation')
}
