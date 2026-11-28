import path from 'node:path'
import os from 'node:os'

const systemSupport=new Set(['apple','app store','crashreporter','tcc','systempolicy','com.apple','applepushservicedaemon','coredevice','devicekit','mobilesync','clouddocs','icloud','addressbook','syncservices'])
/** Only individual macOS Application Support subtrees qualify for explicit data review. */
export function applicationDataRoot(target:string,home=os.homedir(),platform:NodeJS.Platform=process.platform):string|null {
  if(platform!=='darwin'||!path.posix.isAbsolute(target))return null
  const normalized=path.posix.normalize(target)
  for(const support of ['/Library/Application Support',path.posix.join(home,'Library/Application Support')]){
    const relative=path.posix.relative(support,normalized)
    if(!relative||relative==='..'||relative.startsWith('../')||path.posix.isAbsolute(relative))continue
    const owner=relative.split('/')[0],name=owner.toLowerCase()
    if(owner.startsWith('.')||name.startsWith('com.apple.')||systemSupport.has(name))return null
    return path.posix.join(support,owner)
  }
  return null
}
