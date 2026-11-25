// Read-only real-scope benchmark. No filesystem mutations or deletion commands.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import os from 'node:os'
import path from 'node:path'
const root=process.argv[2]||os.homedir(), mode=process.argv[3]||'duplicates'
const engine=spawn(path.resolve('build/native',process.platform==='win32'?'memento-engine.exe':'memento-engine'),[],{stdio:['pipe','pipe','inherit']})
let sequence=0;const pending=new Map()
createInterface({input:engine.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.event)return;const p=pending.get(m.request);if(p){pending.delete(m.request);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}})
const request=(command,args={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});engine.stdin.write(`${JSON.stringify({request:id,command,args})}\n`)})
try{
 const started=performance.now()
 const index=await request('scan',{root,mode,minimum:200*1024,excludePaths:mode!=='analysis'?[path.join(root,'Library'),path.join(root,'AppData')]:[]})
 console.log(JSON.stringify({stage:'scan',mode,...index,root:index.root.path}))
 if(mode==='analysis'){const children=await request('children',{id:0});console.log(JSON.stringify({stage:'rootChildren',items:children.items.filter(e=>e.directory).map(e=>({name:e.name,size:e.size}))}))}
 if(mode==='duplicates'){
  const result=await request('duplicates',{minimum:200*1024})
  console.log(JSON.stringify({stage:'duplicates',groups:result.groups.length,elapsedMs:result.elapsedMs,totalMs:Math.round(performance.now()-started)}))
  const repeat=await request('duplicates',{minimum:200*1024})
  console.log(JSON.stringify({stage:'repeat',groups:repeat.groups.length,elapsedMs:repeat.elapsedMs}))
 }
}finally{engine.stdin.end();engine.kill()}
