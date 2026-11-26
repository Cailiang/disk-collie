import {app} from 'electron'
import {execFile} from 'node:child_process'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
const exec=promisify(execFile)
const cache=new Map<string,Promise<string|null>>()
let active=0
const waiting:Array<()=>void>=[]
export function clearApplicationIconCache():void{cache.clear()}
/** Read bundle artwork first: Finder's generic file icon is not an application logo. */
export function readApplicationIcon(target:string,revision=''):Promise<string|null>{
  const key=target+'\0'+revision,existing=cache.get(key)
  if(existing)return existing
  const operation=(async()=>{
    if(active>=4)await new Promise<void>((resolve)=>waiting.push(resolve));else active++
    try{
      if(process.platform==='darwin'&&target.endsWith('.app')){
        const resources=path.join(target,'Contents/Resources'),candidates:string[]=[]
        try{
          const {stdout}=await exec('/usr/bin/plutil',['-extract','CFBundleIconFile','raw','-o','-',path.join(target,'Contents/Info.plist')],{timeout:5000})
          const name=stdout.trim()
          if(name&&path.basename(name)===name)candidates.push(path.join(resources,path.extname(name)?name:name+'.icns'))
        }catch{/* Asset-catalog applications may have only a fallback ICNS. */}
        try{for(const name of (await readdir(resources)).filter((name)=>/\.icns$/i.test(name)).sort())candidates.push(path.join(resources,name))}catch{/* Fall back to the OS icon. */}
        for(const filename of new Set(candidates)){
          const directory=await mkdtemp(path.join(os.tmpdir(),'memento-icon-'))
          try{
            const output=path.join(directory,'icon.png')
            await exec('/usr/bin/sips',['-Z','96','-s','format','png',filename,'--out',output],{timeout:8000})
            const png=await readFile(output)
            if(png.length)return `data:image/png;base64,${png.toString('base64')}`
          }catch{/* Try the bundle's next available icon. */}finally{await rm(directory,{recursive:true,force:true})}
        }
      }
      if(process.platform==='linux'&&/\.(png|svg)$/i.test(target)){
        const data=await readFile(target)
        if(data.length<=2*1024*1024)return `data:image/${/\.svg$/i.test(target)?'svg+xml':'png'};base64,${data.toString('base64')}`
      }
      const icon=await app.getFileIcon(target,{size:'normal'})
      return icon.isEmpty()?null:icon.toDataURL()
    }catch{return null}finally{const next=waiting.shift();if(next)next();else active--}
  })()
  cache.set(key,operation)
  void operation.then((value)=>{if(!value&&cache.get(key)===operation)cache.delete(key)})
  return operation
}
