import {execFile} from 'node:child_process'
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {promisify} from 'node:util'
import {chromium} from 'playwright-core'
const run=promisify(execFile),iconset='.artifacts/Memento.iconset',source='.artifacts/Memento-1024.png'
const mark=await readFile('src/renderer/src/assets/mascot/collie-mark.svg','utf8')
await mkdir('.artifacts',{recursive:true});await mkdir('build',{recursive:true})
await rm(iconset,{recursive:true,force:true});await mkdir(iconset,{recursive:true})
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try {
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1})
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:1024px;height:1024px;background:transparent}.tile{position:absolute;inset:62px;display:grid;place-items:center;background:#f1f5eb;border-radius:208px}.tile svg{width:760px;height:760px}</style><div class="tile">${mark}</div>`)
  await page.screenshot({path:source,omitBackground:true})
} finally {await browser.close()}
await run('/bin/cp',[source,'build/icon.png'])
for(const [size,name] of [[16,'icon_16x16.png'],[32,'icon_16x16@2x.png'],[32,'icon_32x32.png'],[64,'icon_32x32@2x.png'],[128,'icon_128x128.png'],[256,'icon_128x128@2x.png'],[256,'icon_256x256.png'],[512,'icon_256x256@2x.png'],[512,'icon_512x512.png'],[1024,'icon_512x512@2x.png']])await run('/usr/bin/sips',['-z',String(size),String(size),source,'--out',`${iconset}/${name}`])
await run('/usr/bin/iconutil',['-c','icns',iconset,'-o','build/icon.icns'])
// Keep the themed, pre-React startup mark on the same source paths.
const boot=mark.replace('width="96" height="96"','width="72" height="72"').replace('color="#355e49"','color="currentColor"')
const html=await readFile('src/renderer/index.html','utf8')
await writeFile('src/renderer/index.html',html.replace(/(<span class="boot-mark">)[\s\S]*?(<\/span>)/,`$1${boot.trim()}$2`))
process.stdout.write('Exported line-art build/icon.png, build/icon.icns and startup mark\n')
