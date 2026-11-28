import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs'

export async function verifyProjectDirectoryUi(page,directory,width){
  await page.locator('.nav-button[title="空间分析"]').click()
  const root=page.getByRole('navigation',{name:'扫描起点'}).getByRole('button').first()
  if(await root.isEnabled())await root.click()
  const map=page.getByRole('group',{name:'空间分布图'})
  for(const name of ['Users','alex','Projects','Downloader client'])await map.getByRole('button',{name:new RegExp(name)}).click()
  const remove=page.getByRole('tree').getByRole('button',{name:'移到废纸篓 Downloader client',exact:true})
  await remove.click()
  const dialog=page.getByRole('dialog'),note=dialog.locator('.space-directory-sensitive-note')
  assert.match(await note.innerText(),/包含 2 个/)
  assert.deepEqual(await note.locator('li').allTextContents(),['.env','build/.env'])
  assert(await dialog.getByRole('button',{name:'移到废纸篓',exact:true}).isEnabled())
  const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1)
  await page.screenshot({path:`${directory}/${width}-project-config-review.png`})
  await dialog.getByRole('button',{name:'取消',exact:true}).click()
  assert(await remove.isEnabled(),'Cancelling must leave the project available')
  await remove.click();await dialog.getByRole('button',{name:'移到废纸篓',exact:true}).click();await dialog.getByRole('button',{name:'完成',exact:true}).click()
  assert.equal(await remove.count(),0)
  assert.equal(await page.locator('.space-breadcrumbs button').last().innerText(),'Projects')
}

export async function verifyProjectDirectoryElectron(page,root){
  const name='owned-env-project-'+crypto.randomUUID(),project=path.join(root,name),sibling=path.join(root,'owned-env-project-sibling.txt')
  for(const relative of ['.env','build/flutter_assets/.env','build/flutter_assets/.env.jar','certificates/test.pem']){const file=path.join(project,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,'OWNED_CONFIGURATION_MUST_NOT_APPEAR_IN_REVIEW')}
  writeFileSync(sibling,'keep owned sibling')
  await page.locator('.nav-button[title="空间分析"]').click()
  const hidden=page.getByRole('checkbox',{name:'包含隐藏目录和应用数据',exact:true});if(await hidden.isChecked())await hidden.uncheck()
  await page.locator('.space-disk .space-heading .space-button.primary,.space-disk .space-start .space-button.primary').click();await page.locator('.space-disk .space-progress').waitFor({state:'hidden'})
  await page.locator('.tree-folder-name').filter({hasText:name}).click()
  const remove=page.getByRole('tree').getByRole('button',{name:'移到废纸篓 '+name,exact:true})
  await remove.click()
  const dialog=page.getByRole('dialog')
  assert.match(await dialog.locator('.space-directory-sensitive-note').innerText(),/包含 4 个/)
  assert(!(await dialog.innerText()).includes('OWNED_CONFIGURATION'))
  assert((await dialog.locator('.space-directory-sensitive-note').innerText()).includes('.env'))
  await dialog.getByRole('button',{name:'取消',exact:true}).click();assert(existsSync(path.join(project,'.env')))
  await remove.click();await dialog.getByRole('button',{name:'移到废纸篓',exact:true}).click();await dialog.getByRole('button',{name:'完成',exact:true}).click()
  assert(!existsSync(project));assert.equal(readFileSync(sibling,'utf8'),'keep owned sibling')
  console.log('Project directory Electron passed: hidden .env, built config copies and certificate reviewed without contents, cancelled review, complete owned-folder Trash and sibling preservation')
}
