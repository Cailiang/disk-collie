import {playVisibleGame,readGame,settleGameViewport,verifyGameJourney} from './scan-game-player.mjs'
import assert from 'node:assert/strict'

async function verifySceneryControls(page,game,directory){
  const before=await readGame(game),scene=game.getByRole('combobox',{name:'游戏场景',exact:true}),light=game.getByRole('combobox',{name:'游戏光照',exact:true})
  for(const region of ['forest','river','village','meadow']){
    await scene.selectOption(region)
    assert.equal(await game.getAttribute('data-game-region'),region)
    assert.deepEqual(await game.locator('[data-panorama]').evaluateAll(items=>[...new Set(items.map(item=>item.dataset.panorama))]),[region],'Scene selection must change the panorama itself')
  }
  await light.selectOption('day');const day=await game.locator('.scan-game-canvas').evaluate(element=>getComputedStyle(element).backgroundColor)
  for(const value of ['dusk','night','dawn']){
    await light.selectOption(value);assert.equal(await game.getAttribute('data-game-light'),value)
    assert.notEqual(await game.locator('.scan-game-canvas').evaluate(element=>getComputedStyle(element).backgroundColor),day,'Lighting must change the canvas palette')
  }
  await scene.selectOption('village');await light.selectOption('night');await page.screenshot({path:`${directory}/game-manual-night.png`})
  const after=await readGame(game)
  for(const key of ['time','distance','score','objects'])assert.deepEqual(after[key],before[key],`Scenery selection must preserve ${key}`)
  assert.equal(after.phase,'paused','Scenery controls must not trigger a jump or resume')
  await scene.selectOption('auto');await light.selectOption('auto')
}

async function verifyTerminalGameLayout(browser,baseUrl,directory){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  try{
    await page.clock.install();await page.goto(baseUrl+'?demoScanMs=90000')
    await page.locator('.nav-button[title="终端优化"]').click()
    const terminal=page.locator('.terminal-cleanup'),game=terminal.locator('.scan-game')
    await game.waitFor();await page.clock.pauseAt(await page.evaluate(()=>Date.now())+100);await settleGameViewport(page,game)
    assert.equal(await terminal.locator('.cleanup-empty').count(),0,'An unfinished first scan must not report an empty result')
    for(const viewport of [{width:1440,height:900},{width:1024,height:768},{width:820,height:1180},{width:390,height:844}]){
      await page.setViewportSize(viewport);await settleGameViewport(page,game)
      const bounds=await terminal.evaluate(element=>{
        const selectors=['.cleanup-command-bar','.cleanup-summary-band','.terminal-scan-area'],rects=selectors.map(selector=>{const box=element.querySelector(selector).getBoundingClientRect();return {selector,top:box.top,bottom:box.bottom}})
        const status=element.querySelector('.terminal-scan-status').getBoundingClientRect(),game=element.querySelector('.scan-game').getBoundingClientRect(),canvas=element.querySelector('.scan-game-canvas').getBoundingClientRect()
        const borders=['.cleanup-summary-band','.terminal-scan-area'].map(selector=>{const style=getComputedStyle(element.querySelector(selector));return [style.borderTopWidth,style.borderBottomWidth]})
        return {rects,statusBottom:status.bottom,gameTop:game.top,canvasHeight:canvas.height,borders,overflow:element.scrollWidth>element.clientWidth+1}
      })
      for(let index=1;index<bounds.rects.length;index++)assert(bounds.rects[index].top>=bounds.rects[index-1].bottom-1,`Terminal sections overlap at ${viewport.width}px`)
      assert(bounds.gameTop>=bounds.statusBottom-1,'Game must not overlap scan status')
      assert(bounds.canvasHeight<=251,'Terminal game must retain its compact height')
      assert.equal(bounds.overflow,false);assert(bounds.borders.flat().every(width=>width==='0px'),'Terminal sections must not add horizontal separators')
      await page.screenshot({path:`${directory}/${viewport.width}-terminal-scanning.png`})
    }
    await page.clock.runFor(91000);await game.waitFor({state:'hidden'})
    assert(await terminal.locator('.terminal-cleanup-row').count()>0,'Scan completion must restore terminal findings')
    for(const viewport of [{width:1440,height:900},{width:1024,height:768},{width:820,height:1180},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(20);await page.clock.runFor(100)
      const results=await terminal.evaluate(element=>{
        const selectors=['.cleanup-summary-band','.cleanup-workspace','.cleanup-selection-bar']
        return selectors.map(selector=>{const node=element.querySelector(selector),box=node.getBoundingClientRect(),style=getComputedStyle(node);return {top:box.top,bottom:box.bottom,border:style.borderTopWidth}})
      })
      for(let index=1;index<results.length;index++)assert(results[index].top>=results[index-1].bottom-1,`Terminal results/footer must not overlap at ${viewport.width}px`)
      assert(results.every(result=>result.border==='0px'))
      await page.screenshot({path:`${directory}/${viewport.width}-terminal-completed.png`})
    }
    assert.deepEqual(errors,[])
  }finally{await page.close()}
}

export async function verifyScanGames(browser,baseUrl,directory){
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install();await page.goto(baseUrl+'?demoScanMs=90000')
  const nav=async name=>{await page.locator('.nav-button').filter({hasText:name}).filter({visible:true}).click();await page.clock.runFor(100)}
  await nav('大文件');await page.locator('.space-large .space-heading .space-button.primary').click()
  const game=page.locator('.space-large .scan-game'),field=game.locator('.scan-game-field'),phase=()=>game.getAttribute('data-game-phase')
  await game.waitFor();await page.clock.pauseAt(await page.evaluate(()=>Date.now())+100);await settleGameViewport(page,game);assert.equal(await phase(),'ready');await page.clock.runFor(1200);assert.equal(await game.getAttribute('data-game-time'),'0.000','Games must wait for user input')
  const ink=await game.evaluate(element=>getComputedStyle(element).color)
  await page.evaluate(()=>{document.documentElement.dataset.theme='klein'})
  assert.notEqual(await game.evaluate(element=>getComputedStyle(element).color),ink)
  assert(await game.locator('.scan-game-player svg').evaluate(svg=>getComputedStyle(svg).fill===getComputedStyle(svg.closest('.scan-game-canvas')).color),'The approved character must follow the game palette')
  await page.screenshot({path:`${directory}/game-theme.png`});await page.evaluate(()=>{document.documentElement.dataset.theme='mars'})
  await field.focus();await page.keyboard.press('Space');assert.equal(await phase(),'running')
  await page.keyboard.down('Space');await page.clock.runFor(150);assert(Number(await game.getAttribute('data-game-y'))<-20,'Space must make the dog jump')
  await page.screenshot({path:`${directory}/game-runner-jump.png`})
  await page.keyboard.down('Space');await page.clock.runFor(1000);await page.keyboard.up('Space');assert.equal(Number(await game.getAttribute('data-game-y')),0,'Holding Space must not jump again after landing')
  await game.getByRole('button',{name:'暂停游戏',exact:true}).click();assert.equal(await phase(),'paused')
  const pausedAt=await game.getAttribute('data-game-time');await page.clock.runFor(600);assert.equal(await game.getAttribute('data-game-time'),pausedAt)
  await verifySceneryControls(page,game,directory)
  await field.focus();await page.keyboard.press('Space');await page.clock.runFor(100);assert.equal(await phase(),'running')
  await nav('首页');assert.equal(await phase(),'paused');const hiddenAt=await game.getAttribute('data-game-time');await page.clock.runFor(500);assert.equal(await game.getAttribute('data-game-time'),hiddenAt)
  await nav('大文件');assert.equal(await phase(),'paused');await field.focus();await page.keyboard.press('Space');await page.clock.runFor(7000);assert.equal(await phase(),'over','A real obstacle ends the round')
  assert(Number(await game.getAttribute('data-game-score'))>0);await page.screenshot({path:`${directory}/game-runner-over.png`});await page.keyboard.press('Space');assert.equal(await phase(),'running');assert.equal(await game.getAttribute('data-game-score'),'0')
  for(const [mode,label]of [['runner','越障快跑'],['frisbee','接飞盘'],['pond','荷塘跳跃']]){
    await game.getByRole('button',{name:label,exact:true}).click();assert.equal(await game.getAttribute('data-game-mode'),mode);assert.equal(await phase(),'ready')
    let captured=false
    const result=await playVisibleGame(page,game,6.8,async state=>{if(!captured&&state.y<-20){captured=true;await page.screenshot({path:`${directory}/game-${mode}.png`})}})
    assert.equal(await phase(),'running',`${mode}: real timed jumps must succeed`);assert(captured,`${mode}: Space must produce a visible jump`)
    if(mode==='frisbee')assert(result.state.score>0,'Caught discs score points')
    assert(await page.locator('.space-large .space-progress-heading').getByRole('button',{name:'取消',exact:true}).isEnabled(),'Gameplay must leave scan cancellation available')
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(50);assert(await game.evaluate(element=>element.classList.contains('is-motion-reduced')))
  await game.getByRole('button',{name:'越障快跑',exact:true}).click();await page.clock.runFor(400);assert.equal(await phase(),'ready','Reduced motion never starts a game automatically');await page.keyboard.press('Space');await page.clock.runFor(150);assert.equal(await phase(),'running','User-started play remains available with reduced motion')
  await page.setViewportSize({width:390,height:844});await settleGameViewport(page,game);assert.equal(await phase(),'paused','Resizing an active game must pause the round');await page.screenshot({path:`${directory}/390-game.png`});assert(await game.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'The game must fit narrow windows')
  const beforeResize=await readGame(game),cameraWidths=[]
  for(const viewport of [{width:1920,height:1080},{width:1024,height:768},{width:820,height:1180},{width:390,height:844},{width:1440,height:900}]){
    await page.setViewportSize(viewport);const size=await settleGameViewport(page,game);cameraWidths.push(Math.round(size.actual))
    const afterResize=await readGame(game)
    for(const key of ['time','distance','score','objects'])assert.deepEqual(afterResize[key],beforeResize[key],`Resizing must preserve ${key}`)
    assert.equal(afterResize.phase,'paused')
  }
  assert(new Set(cameraWidths).size>=4,'The camera must adapt continuously to actual canvas proportions')
  if(await phase()==='running')await game.getByRole('button',{name:'暂停游戏',exact:true}).click()
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='owned-game-input';input.setAttribute('aria-label','Owned input fixture');document.body.append(input);input.focus()})
  await page.keyboard.press('Space');await page.clock.runFor(100);assert.equal(await page.locator('#owned-game-input').inputValue(),' ');assert.equal(await phase(),'paused','Typing a space must not resume the game');await page.locator('#owned-game-input').evaluate(input=>input.remove())
  await page.evaluate(()=>{const dialog=document.createElement('div');dialog.id='owned-game-modal';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.style.cssText='position:fixed;width:20px;height:20px';document.body.append(dialog)})
  await field.focus();await page.keyboard.press('Space');assert.equal(await phase(),'paused','Modal dialogs must isolate game keys');await page.locator('#owned-game-modal').evaluate(dialog=>dialog.remove())
  const cancel=page.locator('.space-large .space-progress-heading').getByRole('button',{name:'取消',exact:true});await cancel.evaluate(button=>button.addEventListener('click',()=>{button.dataset.keyActivated='true'},{once:true}));await cancel.focus();await page.keyboard.press('Space');assert.equal(await cancel.getAttribute('data-key-activated'),'true','Space must still activate a focused scan Cancel button');await page.clock.fastForward(90000);await game.waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);await page.close()
  const finished=await browser.newPage({viewport:{width:1440,height:900}});await finished.clock.install();await finished.goto(baseUrl+'?demoScanMs=1600');await finished.locator('.nav-button[title="大文件"]').click();await finished.locator('.space-large .space-heading .space-button.primary').click();await finished.locator('.scan-game-field').focus();await finished.keyboard.press('Space');await finished.clock.runFor(2200);assert.equal(await finished.locator('.scan-game').count(),0,'Scan completion must not wait for the game');assert(await finished.locator('.space-file-row').count()>0);assert(JSON.parse(await finished.evaluate(()=>localStorage.getItem('diskcollie.scan-games.best.v1'))).runner>0,'Completed scans save the local best score');await finished.close()
  await verifyGameJourney(browser,baseUrl,directory)
  await verifyTerminalGameLayout(browser,baseUrl,directory)
  console.log('Scan games passed: Space/tap, collisions/scoring, scenery/light controls, continuous resize and pause, Terminal layout at four viewports, theme, input isolation and scan completion')
}
