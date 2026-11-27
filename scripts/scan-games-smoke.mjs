import assert from 'node:assert/strict'

export async function verifyScanGames(browser,baseUrl,directory){
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install();await page.goto(baseUrl+'?demoScanMs=90000')
  const nav=async name=>{await page.locator('.nav-button').filter({hasText:name}).filter({visible:true}).click();await page.clock.runFor(100)}
  await nav('大文件');await page.locator('.space-large .space-heading .space-button.primary').click()
  const game=page.locator('.space-large .scan-game'),field=game.locator('.scan-game-field'),phase=()=>game.getAttribute('data-game-phase')
  await game.waitFor();assert.equal(await phase(),'ready');await page.clock.runFor(1200);assert.equal(await game.getAttribute('data-game-time'),'0.000','Games must wait for user input')
  const ink=await game.evaluate(element=>getComputedStyle(element).color)
  await page.evaluate(()=>{document.documentElement.dataset.theme='klein'})
  assert.notEqual(await game.evaluate(element=>getComputedStyle(element).color),ink)
  assert(await game.locator('.scan-game-player svg').evaluate(svg=>getComputedStyle(svg).fill===getComputedStyle(svg.closest('.scan-game')).color),'The approved character must follow the theme')
  await page.screenshot({path:`${directory}/game-theme.png`});await page.evaluate(()=>{document.documentElement.dataset.theme='mars'})
  await field.focus();await page.keyboard.press('Space');assert.equal(await phase(),'running')
  await page.keyboard.down('Space');await page.clock.runFor(150);assert(Number(await game.getAttribute('data-game-y'))<-20,'Space must make the dog jump')
  await page.screenshot({path:`${directory}/game-runner-jump.png`})
  await page.keyboard.down('Space');await page.clock.runFor(1000);await page.keyboard.up('Space');assert.equal(Number(await game.getAttribute('data-game-y')),0,'Holding Space must not jump again after landing')
  await game.getByRole('button',{name:'暂停游戏',exact:true}).click();assert.equal(await phase(),'paused')
  const pausedAt=await game.getAttribute('data-game-time');await page.clock.runFor(600);assert.equal(await game.getAttribute('data-game-time'),pausedAt)
  await field.focus();await page.keyboard.press('Space');await page.clock.runFor(100);assert.equal(await phase(),'running')
  await nav('首页');assert.equal(await phase(),'paused');const hiddenAt=await game.getAttribute('data-game-time');await page.clock.runFor(500);assert.equal(await game.getAttribute('data-game-time'),hiddenAt)
  await nav('大文件');assert.equal(await phase(),'paused');await field.focus();await page.keyboard.press('Space');await page.clock.runFor(7000);assert.equal(await phase(),'over','A real obstacle ends the round')
  assert(Number(await game.getAttribute('data-game-score'))>0);await page.screenshot({path:`${directory}/game-runner-over.png`});await page.keyboard.press('Space');assert.equal(await phase(),'running');assert.equal(await game.getAttribute('data-game-score'),'0')
  for(const [mode,label,objectClass,trigger]of [['runner','越障快跑','.game-log',252],['frisbee','接飞盘','.game-disc',238],['pond','荷塘跳跃','.game-gap',197]]){
    await game.getByRole('button',{name:label,exact:true}).click();assert.equal(await game.getAttribute('data-game-mode'),mode);assert.equal(await phase(),'ready');await page.keyboard.press('Space')
    for(let step=0;step<100;step++){
      await page.clock.runFor(50)
      const object=game.locator(objectClass).first()
      const x=await object.count()?await object.evaluate(element=>element.classList.contains('game-gap')?Number(element.querySelector('path').getAttribute('d').match(/^M([\d.]+)/)[1]):Number(element.getAttribute('transform').match(/translate\(([\d.]+)/)[1])):Infinity
      if(x<trigger)break
    }
    assert.equal(await phase(),'running');await field.focus();await page.keyboard.press('Space');await page.clock.runFor(230);assert(Number(await game.getAttribute('data-game-y'))<-20)
    await page.screenshot({path:`${directory}/game-${mode}.png`});await page.clock.runFor(650);assert.equal(await phase(),'running',`${mode}: the timed jump must succeed`)
    if(mode==='frisbee')assert.equal(await game.getAttribute('data-game-score'),'10','A caught disc scores points')
    assert(await page.locator('.space-large .space-progress-heading').getByRole('button',{name:'取消',exact:true}).isEnabled(),'Gameplay must leave scan cancellation available')
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(50);assert(await game.evaluate(element=>element.classList.contains('is-motion-reduced')))
  await game.getByRole('button',{name:'越障快跑',exact:true}).click();await page.clock.runFor(400);assert.equal(await phase(),'ready','Reduced motion never starts a game automatically');await page.keyboard.press('Space');await page.clock.runFor(150);assert.equal(await phase(),'running','User-started play remains available with reduced motion')
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(100);await page.screenshot({path:`${directory}/390-game.png`});assert(await game.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'The game must fit narrow windows')
  await page.setViewportSize({width:1440,height:900});await page.clock.runFor(100)
  if(await phase()==='running')await game.getByRole('button',{name:'暂停游戏',exact:true}).click()
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='owned-game-input';input.setAttribute('aria-label','Owned input fixture');document.body.append(input);input.focus()})
  await page.keyboard.press('Space');await page.clock.runFor(100);assert.equal(await page.locator('#owned-game-input').inputValue(),' ');assert.equal(await phase(),'paused','Typing a space must not resume the game');await page.locator('#owned-game-input').evaluate(input=>input.remove())
  await page.evaluate(()=>{const dialog=document.createElement('div');dialog.id='owned-game-modal';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.style.cssText='position:fixed;width:20px;height:20px';document.body.append(dialog)})
  await field.focus();await page.keyboard.press('Space');assert.equal(await phase(),'paused','Modal dialogs must isolate game keys');await page.locator('#owned-game-modal').evaluate(dialog=>dialog.remove())
  const cancel=page.locator('.space-large .space-progress-heading').getByRole('button',{name:'取消',exact:true});await cancel.evaluate(button=>button.addEventListener('click',()=>{button.dataset.keyActivated='true'},{once:true}));await cancel.focus();await page.keyboard.press('Space');assert.equal(await cancel.getAttribute('data-key-activated'),'true','Space must still activate a focused scan Cancel button');await page.clock.fastForward(90000);await game.waitFor({state:'hidden'})
  assert.deepEqual(errors,[]);await page.close()
  const finished=await browser.newPage({viewport:{width:1440,height:900}});await finished.clock.install();await finished.goto(baseUrl+'?demoScanMs=1600');await finished.locator('.nav-button[title="大文件"]').click();await finished.locator('.space-large .space-heading .space-button.primary').click();await finished.locator('.scan-game-field').focus();await finished.keyboard.press('Space');await finished.clock.runFor(2200);assert.equal(await finished.locator('.scan-game').count(),0,'Scan completion must not wait for the game');assert(await finished.locator('.space-file-row').count()>0);assert(JSON.parse(await finished.evaluate(()=>localStorage.getItem('memento.scan-games.best.v1'))).runner>0,'Completed scans save the local best score');await finished.close()
  console.log('Scan games passed: Space/tap input, jumps/catches/collisions, retry, pause, hidden views, reduced motion, theme, mobile bounds, input isolation and scan completion')
}
