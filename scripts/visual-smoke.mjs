import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const baseUrl=process.argv[2]||'http://127.0.0.1:4178'
const directory='/tmp/memento-rebuild-ui'
mkdirSync(directory,{recursive:true})
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{channel:'chrome'})})
const failures=[]
const visible='.space-workspace:visible'
const pages=['首页','智能清理','大文件','重复文件','空间分析','隐私清理','应用管理','进程管理','终端优化','AI 助手','清理记录','设置']
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
      if(name==='应用管理'){await p.locator('.space-app-row').first().click();await p.locator('.space-related-row').first().waitFor();await p.locator('.manager-logo img').first().waitFor();assert((await p.locator('.space-app-monogram').first().boundingBox()).width<=40)}
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
  assert.equal(await p.locator(visible+' .space-heading').getByRole('button',{name:'帮助',exact:true}).count(),0)
  await map.getByRole('button',{name:/Users/}).click();await map.getByRole('button',{name:/alex/}).click();await map.getByRole('button',{name:/Music/}).click();await p.getByRole('button',{name:'返回上一级',exact:true}).waitFor();assert.match(await p.locator('.space-small-entries').innerText(),/Playlists/);assert.match(await p.locator('.space-small-entries').innerText(),/Notes.txt/);await p.getByRole('button',{name:'返回上一级',exact:true}).click();await map.getByRole('button',{name:/Music/}).waitFor()
  await navigate(p,'大文件');assert.equal(await p.getByRole('checkbox',{name:'包含隐藏目录和应用数据',exact:true}).isChecked(),true);const helpStyle=await p.locator(visible+' .space-heading .workspace-help>.icon-button').evaluate((e)=>({background:getComputedStyle(e).backgroundColor,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.equal(helpStyle.background,'rgba(0, 0, 0, 0)');assert(helpStyle.width<=22&&helpStyle.height<=22);await p.getByRole('group',{name:'文件类型'}).getByRole('button',{name:/视频/}).click();await p.waitForTimeout(250);assert.equal(await p.locator('.space-file-row').count(),2);await p.getByRole('group',{name:'文件类型'}).getByRole('button',{name:/全部/}).click();await p.getByRole('searchbox',{name:'搜索文件'}).fill('Design');await p.waitForTimeout(250);assert.equal(await p.locator('.space-file-row').count(),1)
  await p.locator('.space-file-row input').check();await p.getByRole('button',{name:'检查所选项目',exact:true}).click();await p.getByRole('dialog').waitFor();assert.match(await p.getByRole('dialog').innerText(),/废纸篓/);await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await p.locator('.space-file-row').count(),1)
  await navigate(p,'重复文件');assert.equal(await p.getByRole('combobox',{name:'最小文件大小'}).inputValue(),String(10*1024**2));assert.equal(await p.getByRole('combobox',{name:'最小文件大小'}).locator('option').count(),4);await navigate(p,'大文件');assert.equal(await p.getByRole('searchbox',{name:'搜索文件'}).inputValue(),'Design');assert.equal(await p.locator('.space-file-row input:checked').count(),1)
  const totalBefore=await p.getByTestId('organized-total').innerText()
  await p.getByRole('button',{name:'检查所选项目',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'移到废纸篓',exact:true}).click();await p.locator('.space-cleaning-animation').waitFor();await p.screenshot({path:`${directory}/cleanup-motion.png`});await p.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click()
  assert.equal(await p.getByRole('button',{name:'开始扫描',exact:true}).count(),0);assert.equal(await p.locator('.space-file-row').count(),0)
  await p.getByRole('searchbox',{name:'搜索文件'}).fill('');await p.locator('.space-file-row').first().waitFor();assert.equal(await p.locator('.space-file-row').count(),5)
  await navigate(p,'首页');assert.notEqual(await p.getByTestId('organized-total').innerText(),totalBefore);assert.equal(await p.getByRole('group',{name:'每日整理',exact:true}).getByRole('button').count(),14);assert.match(await p.getByRole('group',{name:'每日整理',exact:true}).getByRole('button').last().getAttribute('aria-label'),/完成 1 次/)
  await navigate(p,'大文件');const ask=p.locator('.space-file-row').first().getByRole('button',{name:/询问 AI/});await ask.click();await p.locator('.message.user').last().waitFor();assert.match(await p.locator('.message.user').last().innerText(),/路径/);await p.getByRole('button',{name:'返回大文件',exact:true}).click();assert.equal(await p.locator('.space-file-row').count(),5)
  assert.equal(await p.getByRole('button',{name:'选择文件夹',exact:true}).count(),0)
  await navigate(p,'重复文件');await p.getByRole('button',{name:'查找重复文件',exact:true}).click();await p.locator('.space-duplicate-group').first().waitFor();const group=p.locator('.space-duplicate-group').first();assert.equal(await group.getByRole('button',{name:/询问 AI/}).count(),2);assert.equal(await group.locator('input:checked').count(),0);await group.getByRole('button',{name:'选择多余副本',exact:true}).click();assert.equal(await group.locator('input:checked').count(),1);assert.equal(await group.locator('input:disabled').count(),1)
  await group.getByRole('button',{name:'移走所选副本',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'移到废纸篓',exact:true}).click();await p.locator('.space-cleaning-animation').waitFor();await p.getByRole('dialog').getByRole('button',{name:'完成',exact:true}).click();assert.equal(await p.getByRole('button',{name:'开始扫描',exact:true}).count(),0);await navigate(p,'清理记录');assert.match(await p.locator(visible+' .space-activity').innerText(),/重复副本/)
  await navigate(p,'隐私清理');await p.locator('.space-cleanup-row').first().waitFor();assert.equal(await p.locator('.space-cleanup-row input:checked').count(),0);await p.locator('.space-cleanup-row').first().getByRole('button',{name:'帮助',exact:true}).click();await p.getByRole('note').waitFor();await overflow(p,'privacy-help');await p.keyboard.press('Escape');await p.locator('.space-cleanup-row').first().click();assert.match(await p.locator('.space-rule-paths').first().innerText(),/History/);assert.equal(await p.locator('.space-rule-paths').first().getByRole('button',{name:/询问 AI/}).count(),1);await p.locator('.space-cleanup-row input').first().check();await p.getByRole('button',{name:'检查所选项目',exact:true}).click();assert.match(await p.getByRole('dialog').innerText(),/永久删除/);await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0)
  await navigate(p,'应用管理');assert.equal(await p.locator('.space-app-row').count(),2);assert.equal(await p.getByRole('checkbox',{name:'显示系统应用'}).isChecked(),false);assert.equal(await p.locator(visible+' .space-heading').getByRole('button',{name:'帮助',exact:true}).count(),0)
  await p.getByRole('checkbox',{name:'显示系统应用'}).check();assert.equal(await p.locator('.space-app-row').count(),3);assert.match(await p.locator('.manager-application').filter({hasText:'Safari'}).innerText(),/使用时间未知/);await p.getByRole('checkbox',{name:'显示系统应用'}).uncheck()
  await p.getByRole('searchbox',{name:'搜索应用'}).fill('Visual');await p.locator('.manager-logo img').waitFor();assert.match(await p.locator('.manager-row').innerText(),/2 天未使用/)
  await p.getByRole('button',{name:'打开应用 Visual Studio Code',exact:true}).click();assert.match(await p.locator('.space-apps .space-alert').innerText(),/已打开/)
  await p.getByRole('button',{name:'检查更新',exact:true}).click();await p.getByRole('group',{name:'应用筛选'}).getByRole('button',{name:'可更新',exact:true}).click();assert.equal(await p.locator('.space-app-row').count(),1)
  await p.getByRole('button',{name:'更新 Visual Studio Code',exact:true}).click();await p.getByRole('group',{name:'应用筛选'}).getByRole('button',{name:'全部应用',exact:true}).click();assert.match(await p.locator('.manager-row').innerText(),/1.107/)
  await p.getByRole('button',{name:'询问 AI Visual Studio Code',exact:true}).click();await p.getByRole('button',{name:'返回应用管理',exact:true}).click();assert.equal(await p.getByRole('searchbox',{name:'搜索应用'}).inputValue(),'Visual')
  await p.getByRole('button',{name:'查看卸载文件 Visual Studio Code',exact:true}).click();await p.locator('.space-related-row').first().waitFor();assert.equal(await p.locator('.space-related-row input:checked').count(),1);assert.match(await p.locator('.manager-files').innerText(),/可能包含个人数据/);assert.equal(await p.locator('.space-related-row').first().getByRole('button',{name:/询问 AI/}).count(),1)
  const cache=p.locator('.manager-file').filter({hasText:'可重新生成'});await cache.getByRole('button',{name:/展开/}).click();await p.locator('.manager-file-children .manager-file').waitFor();await p.locator('.manager-file-children input:not(:disabled)').check();await p.getByRole('button',{name:'卸载所选项目',exact:true}).click();assert.match(await p.getByRole('dialog').innerText(),/Cache.data/);assert.match(await p.getByRole('dialog').innerText(),/勾选的关联文件/);await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
  await navigate(p,'进程管理');await p.getByRole('columnheader',{name:/CPU/}).getByRole('button').click();assert.equal(await p.getByRole('columnheader',{name:/CPU/}).getAttribute('aria-sort'),'descending');await p.getByRole('columnheader',{name:/CPU/}).getByRole('button').click();assert.equal(await p.getByRole('columnheader',{name:/CPU/}).getAttribute('aria-sort'),'ascending');assert.equal(await p.locator('.space-process-detail').count(),0);await p.getByRole('button',{name:/让 AI 分析此进程/}).first().click();await p.locator('.message.user').last().waitFor();await p.locator('.agent-result-section').first().waitFor({timeout:15000})
  await navigate(p,'设置');await p.getByRole('combobox',{name:'Language',exact:true}).selectOption('en-US');await navigate(p,'Overview');assert.match(await p.locator(visible+' .space-heading').innerText(),/Storage overview/)
  await navigate(p,'Settings');await p.locator('.theme-graphite').click();await navigate(p,'Space explorer');await p.locator(visible+' .space-heading .space-button.primary').click();await p.getByRole('group',{name:'Space map'}).waitFor();await p.screenshot({path:`directory/english-dark.png`.replace('directory',directory)});await overflow(p,'english-dark');assert.equal(await p.locator(visible).evaluate(e=>/[\u4e00-\u9fff]/.test(e.innerText)),false)
  await p.close()
}finally{await browser.close()}
assert.deepEqual(failures,[])
console.log(`UI smoke passed: ${viewports.length*pages.length} viewport captures, cleanup/duplicate/uninstall confirmations, process AI, English and dark theme. ${directory}`)
