import {execFile} from 'node:child_process'
import {mkdir,rm} from 'node:fs/promises'
import {promisify} from 'node:util'
const run=promisify(execFile),iconset='.artifacts/Memento.iconset',source='.artifacts/Memento-1024.png'
await mkdir('.artifacts',{recursive:true});await mkdir('build',{recursive:true})
await rm(iconset,{recursive:true,force:true});await mkdir(iconset,{recursive:true})
await run('/usr/bin/sips',['-z','1024','1024','src/renderer/src/assets/mascot/app-icon.png','--out',source])
await run('/bin/cp',[source,'build/icon.png'])
const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

for (const [size, name] of sizes) {
  await run('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', `${iconset}/${name}`])
}
await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns'])
process.stdout.write('Generated build/icon.icns and build/icon.png\n')
