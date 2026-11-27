import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, link } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'

const fixture=await mkdtemp(path.join(os.tmpdir(),'diskcollie-native-smoke-'))
const count=Number(process.env.DISKCOLLIE_BENCHMARK_FILES||20000)
try {
  for(let folder=0;folder<100;folder++) {
    const directory=path.join(fixture,`folder-${folder}`);await mkdir(directory)
    await Promise.all(Array.from({length:Math.floor(count/100)},(_,i)=>writeFile(path.join(directory,`file-${i}`),`${folder}:${i}`)))
  }
  await writeFile(path.join(fixture,'copy-a'),Buffer.alloc(1024*1024,7))
  await writeFile(path.join(fixture,'copy-b'),Buffer.alloc(1024*1024,7))
  async function measure(standard,mode='analysis') {
    const engine=spawn(path.resolve('build/native',process.platform==='win32'?'disk-collie-engine.exe':'disk-collie-engine'),[],{env:{...process.env,...(standard?{DISKCOLLIE_STANDARD_READDIR:'1'}:{})},stdio:['pipe','pipe','inherit']})
    let sequence=0;const pending=new Map()
    createInterface({input:engine.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.event)return;const p=pending.get(v.request);if(p){pending.delete(v.request);v.error?p.reject(new Error(v.error)):p.resolve(v.result)}})
    engine.on('exit',()=>{for(const p of pending.values())p.reject(new Error('Native engine exited'))})
    const request=(command,args={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});engine.stdin.write(`${JSON.stringify({request:id,command,args})}\n`)})
    try {
      const index=await request('scan',{root:fixture,mode});assert.equal(index.errors,0);assert.equal(index.entries,Math.floor(count/100)*100+(mode==='large'?107:103))
      if(mode==='large'){
        const result=await request('large',{minimum:10*1024*1024,search:'',offset:0})
        assert.deepEqual(result.items.map(file=>file.name).sort(),['large-a','large-b'])
        assert.equal(index.retained,103,'Keep directories and large candidates, without retaining small files')
        for(const file of result.items){const verified=await request('entry',{id:file.id});assert.equal(verified.identity,file.identity);assert.equal(verified.modified,file.modified)}
        const changed=result.items.find(file=>file.name==='large-b')
        await writeFile(path.join(fixture,'large-b'),'changed')
        await assert.rejects(request('entry',{id:changed.id}),/changed/)
        await writeFile(path.join(fixture,'large-b'),Buffer.alloc(12*1024*1024,9))
        return {entries:index.entries,retained:index.retained,size:index.root.size,allocated:index.root.allocated,elapsedMs:index.elapsedMs}
      }
      const large=await request('large',{minimum:1024*1024,search:'',offset:0});assert.equal(large.count,2)
      const duplicate=await request('duplicates');assert.equal(duplicate.groups.length,1);assert.equal(duplicate.groups[0].files.length,2)
      const id=duplicate.groups[0].files.find(f=>f.name==='copy-b').id
      await writeFile(path.join(fixture,'copy-b'),'changed')
      await assert.rejects(request('entry',{id}),/changed/)
      await writeFile(path.join(fixture,'copy-b'),Buffer.alloc(1024*1024,7))
      return {entries:index.entries,elapsedMs:index.elapsedMs,duplicateGroups:duplicate.groups.length}
    } finally { engine.stdin.end();engine.kill() }
  }
  const standard=await measure(true),native=await measure(false)
  await writeFile(path.join(fixture,'large-a'),Buffer.alloc(12*1024*1024,8))
  await writeFile(path.join(fixture,'large-b'),Buffer.alloc(12*1024*1024,9))
  await writeFile(path.join(fixture,'hardlink-a'),'shared small-file data')
  await link(path.join(fixture,'hardlink-a'),path.join(fixture,'hardlink-b'))
  const largeStandard=await measure(true,'large'),largeNative=await measure(false,'large')
  for(const key of ['entries','retained','size','allocated'])assert.equal(largeNative[key],largeStandard[key],`Large-file ${key} must match standard traversal, including small hardlinks`)
  console.log(JSON.stringify({platform:process.platform,architecture:process.arch,fixtureFiles:count,standard,native,largeStandard,largeNative,note:'Warm local fixture, not a full-disk or competitor benchmark.'},null,2))
} finally {await rm(fixture,{recursive:true,force:true})}
