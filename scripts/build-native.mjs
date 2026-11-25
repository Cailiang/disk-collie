import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const target = process.env.MEMENTO_RUST_TARGET
const args = ['build', '--manifest-path', 'native/Cargo.toml', '--release', ...(target ? ['--target', target] : [])]
const result = spawnSync('cargo', args, { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
const executable = process.platform === 'win32' ? 'memento-engine.exe' : 'memento-engine'
const output=path.join('build/native',process.env.MEMENTO_NATIVE_ARCH||process.arch)
mkdirSync(output, { recursive: true })
for(const directory of [output,'build/native']) {
  copyFileSync(path.join('native/target', target || '', 'release', executable), path.join(directory, executable))
  if (process.platform !== 'win32') chmodSync(path.join(directory, executable), 0o755)
}
const commit=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()
const dirty=Boolean(spawnSync('git',['status','--porcelain'],{encoding:'utf8'}).stdout.trim())
writeFileSync(path.join(output,'source-revision.json'),JSON.stringify({commit,dirty,target:target||`${process.platform}-${process.arch}`}))
