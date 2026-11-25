import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const baseUrl=process.argv[2]||'http://127.0.0.1:4178'
const directory='/tmp/memento-rebuild-ui'
mkdirSync(directory,{recursive:true})
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{channel:'chrome'})})
const failures=[]
const pages=['首页','智能清理','大文件','重复文件','空间分析','隐私清理','应用卸载','进程管理','终端优化','AI 助手','清理记录','设置']
const viewports=[{width:1440,height:900},{width:1024,height:768},{width:820,height:1180},{width:390,height:844}]
async function navigate(page,name){await page.locator('.nav-button').filter({hasText:name}).filter({visible:true}).click();await page.waitForTimeout(170)}
async function overflow(page,label){const amount=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);if(amount>1)failures.push(`${label}: document overflow ${amount}`);const stack=await page.locator('.page-stack').evaluate(e=>e.scrollWidth-e.clientWidth);if(stack>1)failures.push(`${label}: content overflow ${stack}`)}
try{
  for(const viewport of viewports){
    const p=await browser.newPage({viewport});p.on('pageerror',e=>failures.push(`${viewport.width}: ${e.message}`))
    await p.goto(baseUrl);await p.locator('.space-home-hero').waitFor()
    for(const [i,name]of pages.entries()){
      await navigate(p,name)
      if(name==='重复文件'){await p.getByRole('button',{name:'查找重复文件',exact:true}).click();await p.locator('.space-duplicate-group').first().waitFor()}
      if(name==='应用卸载'){await p.locator('.space-app-row').first().click();await p.locator('.space-related-row').first().waitFor();assert((await p.locator('.space-app-monogram').first().boundingBox()).width<=40)}
      if(name==='进程管理'){await p.locator('.space-process-row').first().click()}
      await overflow(p,`${viewport.width}/${name}`)
      await p.screenshot({path:`${directory}/${viewport.width}-${String(i).padStart(2,'0')}.png`})
    }
    await p.close()
  }
  const p=await browser.newPage({viewport:viewports[0]});p.on('pageerror',e=>failures.push(e.message));await p.goto(baseUrl)
  await navigate(p,'空间分析');
  const tree=p.getByRole('tree',{name:'文件夹内容'}),map=p.getByRole('group',{name:'空间分布图'})
  assert((await tree.boundingBox()).x<(await map.boundingBox()).x,'Directory tree must be left of the chart')
  await map.getByRole('button',{name:/Users/}).click();await p.locator('.space-breadcrumbs button').last().filter({hasText:'Users'}).waitFor()
  await map.getByRole('button',{name:/alex/}).click();await p.locator('.space-breadcrumbs button').last().filter({hasText:'alex'}).waitFor()
  await map.getByRole('button',{name:/Documents/}).click();await p.locator('.space-breadcrumbs button').last().filter({hasText:'Documents'}).waitFor()
  await p.getByRole('navigation',{name:'扫描起点'}).getByRole('button',{name:/Macintosh HD/}).click();await map.getByRole('button',{name:/Users/}).waitFor()
  await p.locator('.space-heading').getByRole('button',{name:'帮助',exact:true}).click();await p.getByRole('note').waitFor();assert.match(await p.getByRole('note').innerText(),/默认分析系统磁盘/);await p.keyboard.press('Escape')
  await navigate(p,'大文件');await p.getByRole('group',{name:'文件类型'}).getByRole('button',{name:/视频/}).click();await p.waitForTimeout(250);assert.equal(await p.locator('.space-file-row').count(),2);await p.getByRole('group',{name:'文件类型'}).getByRole('button',{name:/全部/}).click();await p.getByRole('searchbox',{name:'搜索文件'}).fill('Design');await p.waitForTimeout(250);assert.equal(await p.locator('.space-file-row').count(),1)
  await p.locator('.space-file-row input').check();await p.getByRole('button',{name:'检查所选项目',exact:true}).click();await p.getByRole('dialog').waitFor();assert.match(await p.getByRole('dialog').innerText(),/废纸篓/);await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await p.locator('.space-file-row').count(),1)
  await navigate(p,'重复文件');await p.getByRole('button',{name:'查找重复文件',exact:true}).click();await p.locator('.space-duplicate-group').first().waitFor();const group=p.locator('.space-duplicate-group').first();assert.equal(await group.locator('input:checked').count(),0);await group.getByRole('button',{name:'选择多余副本',exact:true}).click();assert.equal(await group.locator('input:checked').count(),1);assert.equal(await group.locator('input:disabled').count(),1)
  await group.getByRole('button',{name:'移走所选副本',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'移到废纸篓',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();await p.getByRole('button',{name:'开始扫描',exact:true}).click();await p.locator('.space-duplicate-group').first().waitFor();await navigate(p,'清理记录');assert.match(await p.locator('.space-activity').innerText(),/重复副本/)
  await navigate(p,'隐私清理');await p.locator('.space-cleanup-row').first().waitFor();assert.equal(await p.locator('.space-cleanup-row input:checked').count(),0);await p.locator('.space-cleanup-row').first().getByRole('button',{name:'帮助',exact:true}).click();await p.getByRole('note').waitFor();await overflow(p,'privacy-help');await p.keyboard.press('Escape');await p.locator('.space-cleanup-row').first().click();assert.match(await p.locator('.space-rule-paths').first().innerText(),/History/);await p.locator('.space-cleanup-row input').first().check();await p.getByRole('button',{name:'检查所选项目',exact:true}).click();assert.match(await p.getByRole('dialog').innerText(),/永久删除/);await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0)
  await navigate(p,'应用卸载');await p.locator('.space-app-row').first().click();await p.locator('.space-related-row').first().waitFor();assert.equal(await p.locator('.space-related-row input:checked').count(),1);await p.locator('.space-related-row input:not(:disabled)').first().check();await p.getByRole('button',{name:'卸载所选项目',exact:true}).click();assert.match(await p.getByRole('dialog').innerText(),/勾选的关联文件/);await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
  await navigate(p,'进程管理');await p.getByRole('columnheader',{name:/CPU/}).getByRole('button').click();assert.equal(await p.getByRole('columnheader',{name:/CPU/}).getAttribute('aria-sort'),'descending');await p.getByRole('columnheader',{name:/CPU/}).getByRole('button').click();assert.equal(await p.getByRole('columnheader',{name:/CPU/}).getAttribute('aria-sort'),'ascending');assert.equal(await p.locator('.space-process-detail').count(),0);await p.getByRole('button',{name:/让 AI 分析此进程/}).first().click();await p.locator('.message.user').last().waitFor();await p.locator('.agent-result-section').first().waitFor({timeout:15000})
  await navigate(p,'设置');await p.getByRole('combobox',{name:'Language',exact:true}).selectOption('en-US');await navigate(p,'Overview');assert.match(await p.locator('.space-heading').innerText(),/Storage overview/)
  await navigate(p,'Settings');await p.locator('.theme-graphite').click();await navigate(p,'Space explorer');await p.locator('.space-heading .space-button.primary').click();await p.getByRole('group',{name:'Space map'}).waitFor();await p.screenshot({path:`directory/english-dark.png`.replace('directory',directory)});await overflow(p,'english-dark');assert.equal(await p.locator('.space-workspace').evaluate(e=>/[\u4e00-\u9fff]/.test(e.innerText)),false)
  await p.close()
}finally{await browser.close()}
assert.deepEqual(failures,[])
console.log(`UI smoke passed: ${viewports.length*pages.length} viewport captures, cleanup/duplicate/uninstall confirmations, process AI, English and dark theme. ${directory}`)
