import {open,readdir} from 'node:fs/promises'
import path from 'node:path'
import type {DeepCleanContext} from './deep-clean-context'
import {assertDeepNotCancelled} from './deep-clean-context'
import {privacyPathSnapshot} from './privacy-resource'
import type {DeepCleanDefinition} from './deep-clean-rules'
/** Universal Mach-O files are measured only. Rewriting them would invalidate signatures. */
export async function applicationArchitectureDefinitions(context:DeepCleanContext):Promise<DeepCleanDefinition[]>{
  if(context.platform!=='darwin')return []
  const result:DeepCleanDefinition[]=[]
  for(const app of context.applications){
    assertDeepNotCancelled(context.signal)
    if(app.system||app.protected||!app.location.endsWith('.app'))continue
    try{
      const directory=path.join(app.location,'Contents/MacOS')
      await privacyPathSnapshot(directory)
      const binaries:string[]=[]
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(!entry.isFile()||entry.isSymbolicLink())continue
        const target=path.join(directory,entry.name);await privacyPathSnapshot(target)
        const reader=await open(target,'r')
        try{const bytes=Buffer.alloc(8);const {bytesRead}=await reader.read(bytes,0,8,0),magic=bytes.readUInt32BE(),count=[0xbebafeca,0xbfbafeca].includes(magic)?bytes.readUInt32LE(4):bytes.readUInt32BE(4);if(bytesRead===8&&[0xcafebabe,0xcafebabf,0xbebafeca,0xbfbafeca].includes(magic)&&count>=2&&count<=16)binaries.push(target)}finally{await reader.close()}
      }
      if(binaries.length)result.push({key:'architecture:'+app.location,group:'application-optimization',name:{zh:app.name+' 多架构体积',en:app.name+' universal binary storage'},description:{zh:'仅查看多架构可执行文件占用。修改应用会破坏签名或更新能力，本页不移除架构。',en:'Storage analysis only. Rewriting application binaries can invalidate signatures or updates; architecture removal is unavailable here.'},risk:'protected',recommended:false,applications:[],paths:binaries,cleanupMethod:'none',options:{readOnly:true},owner:{key:app.bundleId||app.name,name:app.name,bundleIds:app.bundleId?[app.bundleId]:[],iconPaths:[app.iconPath||app.location]}})
    }catch{/* Non-readable or non-Mach-O application files are not cleanup candidates. */}
  }
  return result
}
