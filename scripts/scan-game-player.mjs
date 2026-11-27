import assert from 'node:assert/strict'

export async function readGame(game){
  return game.evaluate(element=>({
    mode:element.dataset.gameMode,phase:element.dataset.gamePhase,time:Number(element.dataset.gameTime),y:Number(element.dataset.gameY),distance:Number(element.dataset.gameDistance),score:Number(element.dataset.gameScore),region:element.dataset.gameRegion,light:element.dataset.gameLight,
    objects:Array.from(element.querySelectorAll('.game-obstacle,.game-gap,.game-disc')).map(object=>({kind:object.classList.contains('game-gap')?'gap':object.classList.contains('game-disc')?'disc':'obstacle',variant:object.dataset.variant,x:Number(object.dataset.x),width:Number(object.dataset.width||38),height:Number(object.dataset.height||0),altitude:Number(object.dataset.altitude||0),baseY:Number(object.dataset.baseY||0),motion:Number(object.dataset.motion||0),born:Number(object.dataset.born||0)}))
  }))
}
// React to the displayed objects with normal keyboard input, without altering the game state.
export function needsJump(state){
  if(state.y!==0||state.phase!=='running')return false
  const speed=220+Math.min(110,state.time*1.65),objects=state.objects
  if(state.mode==='runner'){
    const next=objects.find(object=>object.kind==='obstacle'&&object.altitude<100&&object.x+object.width>143)
    return Boolean(next&&next.x-160<=speed*.421-next.width/2)
  }
  if(state.mode==='pond'){
    const gaps=objects.filter(object=>object.kind==='gap'&&object.x+object.width>152)
    if(!gaps.length)return false
    const start=gaps[0].x;let end=start+gaps[0].width
    for(const gap of gaps.slice(1)){if(gap.x-end>85)break;end=gap.x+gap.width}
    return start-160<=speed*.421-(end-start)/2
  }
  const next=objects.find(object=>object.kind==='disc'&&object.x>140)
  if(!next)return false
  const arrival=Math.max(0,(next.x-185)/speed),height=186-next.baseY-Math.sin((state.time+arrival-next.born)*2.6)*next.motion
  if(height<24)return false
  return next.x-160<=25+speed*(610-Math.sqrt(Math.max(0,610**2-2900*height)))/1450
}
export async function playVisibleGame(page,game,until,onFrame){
  const seen=new Set(),regions=new Set(),lights=new Set()
  await game.locator('.scan-game-field').focus()
  let state=await readGame(game)
  if(state.phase==='ready'){await page.keyboard.press('Space');state=await readGame(game)}
  while(state.time<until){
    assert.equal(state.phase,'running',`${state.mode} ended at ${state.time}s: ${JSON.stringify(state.objects)}`)
    for(const object of state.objects)seen.add(object.variant)
    regions.add(state.region);lights.add(state.light)
    if(needsJump(state))await page.keyboard.press('Space')
    await page.clock.runFor(50)
    state=await readGame(game)
    await onFrame?.(state)
  }
  return {seen,regions,lights,state}
}
export async function verifyGameJourney(browser,baseUrl,directory){
  for(const [mode,label,duration]of [['runner','越障快跑',58],['frisbee','接飞盘',45],['pond','荷塘跳跃',45]]){
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    try{
      await page.clock.install();await page.goto(baseUrl+'?demoScanMs=90000');await page.locator('.nav-button[title="大文件"]').click();await page.locator('.space-large .space-heading .space-button.primary').click()
      const game=page.locator('.space-large .scan-game');await game.waitFor();await page.clock.pauseAt(await page.evaluate(()=>Date.now())+100);await game.getByRole('button',{name:label,exact:true}).click()
      const captured=new Set()
      const result=await playVisibleGame(page,game,duration,async state=>{
        const key=state.region+'-'+state.light
        if(!captured.has(key)&&state.time>1){captured.add(key);await page.screenshot({path:`${directory}/journey-${mode}-${key}.png`})}
      })
      assert(result.seen.size>=(mode==='runner'?8:5),`${mode}: visible long play must include varied challenges`)
      assert.equal(result.regions.size,4);assert(result.lights.has('night'));assert(result.lights.has('dusk'));assert(result.state.score>0)
      assert.deepEqual(errors,[])
      if(mode==='runner'){
        await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(50);await page.setViewportSize({width:390,height:844});await page.clock.runFor(50);await page.screenshot({path:`directory/journey-mobile.png`.replace('directory',directory)});assert(await game.evaluate(element=>element.scrollWidth<=element.clientWidth+1))
      }
      console.log(`${mode} journey passed: ${duration}s, ${[...result.seen].join('/')}, ${result.regions.size} regions and ${[...result.lights].join('/')}`)
    }finally{await page.close()}
  }
}
