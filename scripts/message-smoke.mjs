import assert from 'node:assert/strict'
export async function acknowledgeMessage(page,expected){
  const dialog=page.getByRole('alertdialog')
  await dialog.waitFor({timeout:90000})
  if(expected)assert.match(await dialog.innerText(),expected)
  const box=await dialog.boundingBox(),viewport=page.viewportSize()||await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
  assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'Messages must be visible inside the viewport')
  await dialog.getByRole('button',{name:/^(知道了|OK)$/}).click()
  await dialog.waitFor({state:'hidden'})
}
