import {execFile} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {lstat,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import type {PrivacyRecord,PrivacyTimeRange} from '../shared/privacy-types'
import {privacyAccessFailure,privacyFileResource,privacyPathSnapshot,privacySince,privacyUnavailable,validatePrivacyPath,type PrivacyContext,type PrivacyDefinition,type PrivacyPathSnapshot,type PrivacyResource,type PrivacySnapshot,type PrivacySource} from './privacy-resource'

const execute=promisify(execFile)
const maxBytes=32*1024*1024
type Plist=string|number|boolean|Plist[]|{[key:string]:Plist}
type Dict={[key:string]:Plist}
interface TextEntry {start:number;end:number;title:string;timestamp?:number;url?:string}
const dict=(value:Plist|undefined):Dict=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Dict:Object.create(null) as Dict
const array=(value:Plist|undefined):Plist[]=>Array.isArray(value)?value:[]
const xmlDecode=(value:string):string=>value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity:string)=>entity[0]==='#'?String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity]||''))
const xmlEncode=(value:string):string=>value.replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]!))

/** Parse data as a property-list graph, never as executable NSKeyedArchiver classes. */
function parsePlist(xml:string):Plist {
  const source=xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g,'').trim()
  const tokens=source.match(/<[^>]+>|[^<]+/g)||[]
  if(tokens.length>500000)throw new Error('privacy.sourceUnavailable')
  let index=0
  const whitespace=():void=>{while(tokens[index]?.trim()==='')index++}
  const value=(depth:number):Plist=>{
    if(depth>128)throw new Error('privacy.sourceUnavailable')
    whitespace();const tag=tokens[index++]?.trim()
    if(tag==='<dict/>'||tag==='<dict />')return Object.create(null) as Dict
    if(tag==='<array/>'||tag==='<array />')return []
    if(tag==='<true/>'||tag==='<true />')return true
    if(tag==='<false/>'||tag==='<false />')return false
    if(tag==='<dict>'){
      const result:Dict=Object.create(null) as Dict
      for(whitespace();tokens[index]!=='</dict>';whitespace()){
        if(tokens[index++]!=='<key>')throw new Error('privacy.sourceUnavailable')
        let key='';while(tokens[index]!==undefined&&tokens[index]!=='</key>')key+=tokens[index++]
        if(tokens[index++]!=='</key>')throw new Error('privacy.sourceUnavailable')
        result[xmlDecode(key)]=value(depth+1)
      }
      index++;return result
    }
    if(tag==='<array>'){const result:Plist[]=[];for(whitespace();tokens[index]!=='</array>';whitespace())result.push(value(depth+1));index++;return result}
    const match=/^<(string|integer|real|data|date)(\s*\/)?\s*>$/.exec(tag||'')
    if(!match)throw new Error('privacy.sourceUnavailable')
    let content=''
    if(!match[2]){while(tokens[index]!==undefined&&tokens[index]!==`</${match[1]}>`)content+=tokens[index++];if(tokens[index++]!==`</${match[1]}>`)throw new Error('privacy.sourceUnavailable')}
    if(match[1]==='data'||match[1]==='date')return {__plistType:match[1],value:match[1]==='data'?content.replace(/\s+/g,''):content.trim()}
    if(match[1]==='integer'||match[1]==='real'){const number=Number(content);if(!Number.isFinite(number))throw new Error('privacy.sourceUnavailable');return number}
    return xmlDecode(content)
  }
  whitespace();if(tokens[index++]!=='<plist version="1.0">')throw new Error('privacy.sourceUnavailable')
  const result=value(0);whitespace();if(tokens[index++]!=='</plist>')throw new Error('privacy.sourceUnavailable');return result
}
function plistXml(value:Plist):string {
  const serialize=(item:Plist):string=>{
    if(Array.isArray(item))return `<array>${item.map(serialize).join('')}</array>`
    if(typeof item==='object'){
      if(item.__plistType==='data'||item.__plistType==='date')return `<${item.__plistType}>${xmlEncode(String(item.value))}</${item.__plistType}>`
      return `<dict>${Object.entries(item).map(([key,value])=>`<key>${xmlEncode(key)}</key>${serialize(value)}`).join('')}</dict>`
    }
    if(typeof item==='boolean')return item?'<true/>':'<false/>'
    if(typeof item==='number')return Number.isInteger(item)?`<integer>${item}</integer>`:`<real>${item}</real>`
    return `<string>${xmlEncode(item)}</string>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${serialize(value)}</plist>`
}
async function plistRead(target:string):Promise<Plist>{
  const stat=await privacyPathSnapshot(target);if(stat.size>maxBytes)throw new Error('privacy.sourceUnavailable')
  const {stdout}=await execute('/usr/bin/plutil',['-convert','xml1','-o','-',target],{timeout:15000,maxBuffer:maxBytes*2})
  return parsePlist(stdout)
}
async function identity(target:string):Promise<{file:PrivacyPathSnapshot;hash:string}>{
  const file=await privacyPathSnapshot(target);if(file.size>maxBytes||file.directory)throw new Error('privacy.sourceUnavailable')
  const bytes=await readFile(target);await validatePrivacyPath(file)
  return {file,hash:createHash('sha256').update(bytes).digest('hex')}
}
async function validateIdentity(old:Awaited<ReturnType<typeof identity>>):Promise<void>{
  await validatePrivacyPath(old.file)
  if(createHash('sha256').update(await readFile(old.file.path)).digest('hex')!==old.hash)throw new Error('privacy.sourceChanged')
}
async function replaceFile(old:Awaited<ReturnType<typeof identity>>,content:string,plist=false):Promise<number>{
  const temporary=path.join(path.dirname(old.file.path),`.memento-privacy-${randomUUID()}`)
  const mode=(await lstat(old.file.path)).mode&0o777
  try{
    await writeFile(temporary,content,{flag:'wx',mode})
    if(plist)await execute('/usr/bin/plutil',['-convert','binary1',temporary],{timeout:15000,maxBuffer:4096})
    await validateIdentity(old);await rename(temporary,old.file.path)
    return (await privacyPathSnapshot(old.file.path)).size
  }finally{await rm(temporary,{force:true})}
}
function failed(error:unknown):PrivacySnapshot{
  if(privacyAccessFailure(error)||/not permitted|permission denied/i.test(String(error)))return privacyUnavailable('permission-required')
  if((error as NodeJS.ErrnoException).code==='ENOENT')return privacyUnavailable('empty')
  return privacyUnavailable('unavailable')
}
function uid(value:Plist|undefined):number|undefined {const entry=dict(value);return Object.keys(entry).length===1&&Number.isSafeInteger(entry['CF$UID'])?Number(entry['CF$UID']):undefined}
function archiveGraph(value:Plist):{objects:Plist[];root:Dict;resolve:(value:Plist|undefined)=>Plist;get:(value:Plist,key:string)=>Plist|undefined}{
  const archive=dict(value),objects=array(archive.$objects)
  if(archive.$archiver!=='NSKeyedArchiver'||!objects.length||objects.length>100000)throw new Error('privacy.sourceUnavailable')
  const resolve=(value:Plist|undefined):Plist=>{const reference=uid(value);if(reference!==undefined){if(reference<0||reference>=objects.length)throw new Error('privacy.sourceUnavailable');return objects[reference]}return value??''}
  const get=(value:Plist,key:string):Plist|undefined=>{
    const object=dict(resolve(value));if(Object.hasOwn(object,key))return object[key]
    const keys=array(object['NS.keys']),values=array(object['NS.objects'])
    const index=keys.findIndex((candidate)=>resolve(candidate)===key);return index>=0?values[index]:undefined
  }
  const top=dict(archive.$top),root=dict(resolve(top.root??top.NSKeyedArchiveRootObjectKey))
  if(!Object.keys(root).length)throw new Error('privacy.sourceUnavailable')
  return {objects,root,resolve,get}
}
/** Remove orphaned record objects as well as list references; retain reachable properties/classes. */
function pruneArchive(value:Plist):Plist{
  const original=dict(value),old=array(original.$objects),indices=new Map<number,number>([[0,0]]),objects:Plist[]=[old[0]]
  const copy=(item:Plist):Plist=>{
    const reference=uid(item)
    if(reference!==undefined){if(reference<0||reference>=old.length)throw new Error('privacy.sourceUnavailable');let next=indices.get(reference);if(next===undefined){next=objects.length;indices.set(reference,next);objects.push('');objects[next]=copy(old[reference])}return {'CF$UID':next}}
    if(Array.isArray(item))return item.map(copy)
    if(typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,value])=>[key,copy(value)]))
    return item
  }
  const result=Object.fromEntries(Object.entries(original).filter(([key])=>key!=='$objects').map(([key,value])=>[key,copy(value)]));result.$objects=objects;return result
}
const bookmarkScript=String.raw`ObjC.import('Foundation');function run(argv){return JSON.stringify(JSON.parse(argv[0]).map(function(encoded){try{var data=$.NSData.alloc.initWithBase64EncodedStringOptions($(encoded),0);var url=$.NSURL.URLByResolvingBookmarkDataOptionsRelativeToURLBookmarkDataIsStaleError(data,768,undefined,Ref(),Ref());if(!url||url.isNil())return null;return {title:ObjC.unwrap(url.lastPathComponent)||'',url:ObjC.unwrap(url.absoluteString)||'',path:ObjC.unwrap(url.path)||''}}catch(error){return null}}))}`
async function resolveBookmarks(values:string[]):Promise<({title:string;url:string;path:string}|null)[]>{
  if(!values.length)return []
  const payload=JSON.stringify(values);if(Buffer.byteLength(payload)>120000)return values.map(()=>null)
  try{const {stdout}=await execute('/usr/bin/osascript',['-l','JavaScript','-e',bookmarkScript,payload],{timeout:15000,maxBuffer:2*1024*1024});return JSON.parse(stdout) as ({title:string;url:string;path:string}|null)[]}catch{return values.map(()=>null)}
}
function recentResource(definition:PrivacyDefinition):PrivacyResource{return {...definition,scan:async(range)=>{
  if(range!=='all')return privacyUnavailable('range-unsupported')
  try{
    const old=await identity(definition.paths[0]),archive=await plistRead(old.file.path),graph=archiveGraph(archive)
    const itemsValue=graph.get(graph.root,'items'),items=dict(graph.resolve(itemsValue)),entries=array(items['NS.objects'])
    if(!itemsValue||!Array.isArray(items['NS.objects']))throw new Error('privacy.sourceUnavailable')
    await validateIdentity(old)
    return {count:entries.length,size:old.file.size,capability:entries.length?'ready':'empty',
      preview:async(offset,limit)=>{
        const selected=entries.slice(offset,offset+Math.min(limit,100)),bookmarks=selected.map((entry)=>{const raw=graph.resolve(graph.get(entry,'Bookmark'));let object=dict(raw);if(object['NS.data'])object=dict(graph.resolve(object['NS.data']));return object.__plistType==='data'?String(object.value):''}),resolved=await resolveBookmarks(bookmarks)
        return selected.map((entry,index)=>{const title=graph.resolve(graph.get(entry,'Name')??graph.get(entry,'name')??graph.get(entry,'title'));return {id:`${definition.key}:${offset+index}`,title:resolved[index]?.title||(typeof title==='string'&&title!=='$null'?title:`${definition.source.name} · ${offset+index+1}`),url:resolved[index]?.url||undefined,path:resolved[index]?.path||undefined}})
      },validate:()=>validateIdentity(old),
      clean:async(progress)=>{
        await validateIdentity(old);if(!entries.length)return {count:0,size:0,changed:false};items['NS.objects']=[]
        const size=await replaceFile(old,plistXml(pruneArchive(archive)),true)
        const check=archiveGraph(await plistRead(old.file.path)),left=dict(check.resolve(check.get(check.root,'items')))
        if(array(left['NS.objects']).length)throw new Error('privacy.verificationFailed')
        progress?.(entries.length,entries.length);return {count:entries.length,size:Math.max(0,old.file.size-size),changed:entries.length>0}
      }}
  }catch(error){return failed(error)}
}}}
function finderResource(definition:PrivacyDefinition,key:string):PrivacyResource{return {...definition,scan:async(range)=>{
  if(range!=='all')return privacyUnavailable('range-unsupported')
  try{
    const old=await identity(definition.paths[0]),plist=dict(await plistRead(old.file.path)),entries=array(plist[key]);await validateIdentity(old)
    const original=JSON.stringify(plist[key]),validate=async():Promise<void>=>{
      await privacyPathSnapshot(old.file.path)
      if(JSON.stringify(dict(await plistRead(old.file.path))[key])!==original)throw new Error('privacy.sourceChanged')
    }
    return {count:entries.length,size:old.file.size,capability:entries.length?'ready':'empty',
      preview:async(offset,limit)=>entries.slice(offset,offset+limit).map((value,index)=>{const item=dict(value);const title=typeof value==='string'?value:typeof item.name==='string'?item.name:array(item.values).filter((value)=>typeof value==='string').join(' ');return {id:`${definition.key}:${offset+index}`,title:title||`${definition.source.name} · ${offset+index+1}`}}),
      validate,clean:async(progress)=>{
        await validate()
        if(!entries.length)return {count:0,size:0,changed:false}
        // defaults coordinates with cfprefsd and changes only this key, preserving all settings.
        await execute('/usr/bin/defaults',['delete',old.file.path.replace(/\.plist$/,''),key],{timeout:15000,maxBuffer:4096})
        const check=dict(await plistRead(old.file.path));if(array(check[key]).length)throw new Error('privacy.verificationFailed')
        progress?.(entries.length,entries.length);return {count:entries.length,size:0,changed:entries.length>0}
      }}
  }catch(error){return failed(error)}
}}}
const clipboardReadScript=String.raw`ObjC.import('AppKit');function run(){var board=$.NSPasteboard.generalPasteboard;return JSON.stringify({change:Number(board.changeCount),count:Number(board.pasteboardItems.count),formats:Number(board.types.count)})}`
const clipboardClearScript=String.raw`ObjC.import('AppKit');function run(argv){var board=$.NSPasteboard.generalPasteboard;if(Number(board.changeCount)!==Number(argv[0]))throw Error('privacy.sourceChanged');board.clearContents;if(Number(board.pasteboardItems.count)!==0)throw Error('privacy.verificationFailed');return 'cleared'}`
function clipboardResource(source:PrivacySource):PrivacyResource {
  const read=async():Promise<{change:number;count:number;formats:number}>=>{const {stdout}=await execute('/usr/bin/osascript',['-l','JavaScript','-e',clipboardReadScript],{timeout:10000,maxBuffer:4096});const result=JSON.parse(stdout) as {change:number;count:number;formats:number};if(![result.change,result.count,result.formats].every(Number.isSafeInteger))throw new Error('privacy.sourceUnavailable');return result}
  return {key:'system-clipboard',kind:'clipboard',category:'system-activity',source,paths:[],risk:'recent',supportsRange:false,scan:async(range)=>{
    if(range!=='all')return privacyUnavailable('range-unsupported')
    try{const initial=await read(),validate=async():Promise<void>=>{if((await read()).change!==initial.change)throw new Error('privacy.sourceChanged')}
      return {count:initial.count,size:0,capability:initial.count?'ready':'empty',preview:async(offset,limit)=>initial.count&&offset===0&&limit>0?[{id:'clipboard-summary',title:'Clipboard',count:initial.count}]:[],validate,clean:async()=>{await validate();if(!initial.count)return {count:0,size:0,changed:false};await execute('/usr/bin/osascript',['-l','JavaScript','-e',clipboardClearScript,String(initial.change)],{timeout:10000,maxBuffer:4096});if((await read()).count)throw new Error('privacy.verificationFailed');return {count:initial.count,size:0,changed:initial.count>0}}}
    }catch(error){return failed(error)}
  }}
}
function shellEntries(content:string,kind:'zsh'|'bash'|'fish'):TextEntry[]{
  const lines=[...content.matchAll(/[^\n]*(?:\n|$)/g)].filter((match)=>match[0].length),result:TextEntry[]=[]
  for(let index=0;index<lines.length;index++){
    const line=lines[index],text=line[0].replace(/\r?\n$/,''),start=line.index!
    if(kind==='fish'){
      const match=/^- cmd: (.*)$/.exec(text);if(!match)continue
      let end=index+1;while(end<lines.length&&!/^- cmd: /.test(lines[end][0]))end++
      const raw=content.slice(start,end<lines.length?lines[end].index!:content.length),when=/^\s+when: (\d+)\s*$/m.exec(raw)
      result.push({start,end:end<lines.length?lines[end].index!:content.length,title:match[1].replace(/\\n/g,'\n').replace(/\\\\/g,'\\'),timestamp:when&&Number(when[1])>0?Number(when[1])*1000:undefined});index=end-1;continue
    }
    if(!text.trim())continue
    if(kind==='bash'&&/^#\d{9,}$/.test(text)){
      let end=index+1;while(end<lines.length&&!/^#\d{9,}\r?\n?$/.test(lines[end][0]))end++
      const body=lines.slice(index+1,end).map((line)=>line[0]).join('').replace(/\r?\n$/,'')
      if(body.trim())result.push({start,end:end<lines.length?lines[end].index!:content.length,title:body,timestamp:Number(text.slice(1))*1000});index=end-1;continue
    }
    const extended=kind==='zsh'?/^: (\d+):\d+;([\s\S]*)$/.exec(text):null
    let title=extended?extended[2]:text,end=index+1
    while(/\\$/.test(title)&&end<lines.length){title=title.slice(0,-1)+'\n'+lines[end][0].replace(/\r?\n$/,'');end++}
    result.push({start,end:end<lines.length?lines[end].index!:content.length,title,timestamp:extended&&Number(extended[1])>0?Number(extended[1])*1000:undefined});index=end-1
  }
  return result
}
function textResource(definition:PrivacyDefinition,parse:(content:string)=>TextEntry[]):PrivacyResource{return {...definition,scan:async(range,until)=>{
  try{
    const old=await identity(definition.paths[0]),content=await readFile(old.file.path,'utf8'),all=parse(content),since=privacySince(range,until)
    if(since!==null&&all.some((entry)=>entry.timestamp===undefined))return privacyUnavailable('range-unsupported')
    const entries=all.filter((entry)=>entry.timestamp===undefined?since===null:entry.timestamp<=until&&(since===null||entry.timestamp>=since))
    await validateIdentity(old)
    return {count:entries.length,size:entries.reduce((sum,entry)=>sum+Buffer.byteLength(content.slice(entry.start,entry.end)),0),capability:entries.length?'ready':'empty',
      preview:async(offset,limit)=>entries.slice(offset,offset+limit).map((entry,index)=>({id:`${definition.key}:${offset+index}`,title:entry.title,url:entry.url,timestamp:entry.timestamp!==undefined?new Date(entry.timestamp).toISOString():undefined})),validate:()=>validateIdentity(old),
      clean:async(progress)=>{
        await validateIdentity(old);if(!entries.length)return {count:0,size:0,changed:false};let remaining='',position=0
        for(const entry of entries){remaining+=content.slice(position,entry.start);position=entry.end}
        remaining+=content.slice(position)
        const size=await replaceFile(old,remaining)
        if(await readFile(old.file.path,'utf8')!==remaining)throw new Error('privacy.verificationFailed')
        progress?.(entries.length,entries.length);return {count:entries.length,size:Math.max(0,old.file.size-size),changed:entries.length>0}
      }}
  }catch(error){return failed(error)}
}}}
function xbelEntries(content:string):TextEntry[]{
  if(!/<xbel(?:\s|>)/.test(content)||/<!ENTITY/i.test(content))throw new Error('privacy.sourceUnavailable')
  return [...content.matchAll(/<bookmark\b([^>]*?)(?:\/>|>[\s\S]*?<\/bookmark\s*>)/g)].map((match)=>{
    const attribute=(name:string):string|undefined=>{const result=new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(match[1]);return result?xmlDecode(result[2]):undefined}
    const url=attribute('href'),title=/<title>([\s\S]*?)<\/title>/.exec(match[0])?.[1],date=attribute('visited')||attribute('modified')||attribute('added'),timestamp=date?Date.parse(date):NaN
    return {start:match.index!,end:match.index!+match[0].length,title:title?xmlDecode(title):url||'Recent document',url,timestamp:Number.isFinite(timestamp)?timestamp:undefined}
  })
}
async function present(target:string):Promise<boolean>{try{await lstat(target);return true}catch(error){return privacyAccessFailure(error)}}

/** Deterministic, narrowly scoped record adapters. No document contents are read or removed. */
export async function systemPrivacyResources(context:PrivacyContext):Promise<PrivacyResource[]>{
  const result:PrivacyResource[]=[],{platform,home,applications,env}=context,p=platform==='win32'?path.win32:path.posix
  const owner=(key:string,name:string,bundleId:string,iconPaths:string[]=[]):PrivacySource=>{const app=applications.find((app)=>app.bundleId?.toLowerCase()===bundleId.toLowerCase());return {key,name:app?.name||name,bundleIds:[bundleId],iconPaths:app?[app.location]:iconPaths}}
  const finder=owner('finder','Finder','com.apple.finder',['/System/Library/CoreServices/Finder.app'])
  const definition=(key:string,kind:PrivacyDefinition['kind'],category:PrivacyDefinition['category'],source:PrivacySource,paths:string[],risk:PrivacyDefinition['risk']='recent',supportsRange=false):PrivacyDefinition=>({key,kind,category,source,paths,risk,supportsRange})
  const addFiles=async(key:string,kind:PrivacyDefinition['kind'],source:PrivacySource,roots:string[],category:PrivacyDefinition['category']='app-activity'):Promise<void>=>{for(const target of roots)if(await present(target))result.push(privacyFileResource(definition(`${key}:${target}`,kind,category,source,[target],kind==='app-cache'||kind==='app-logs'?'low':'recent',false)))}
  if(platform==='darwin'){
    result.push(clipboardResource(finder))
    const recent=p.join(home,'Library/Application Support/com.apple.sharedfilelist')
    for(const [name,kind] of [['RecentApplications','recent-apps'],['RecentDocuments','recent-documents'],['RecentServers','recent-servers']] as const)for(const ext of ['sfl4','sfl3','sfl2']){
      const target=p.join(recent,`com.apple.LSSharedFileList.${name}.${ext}`)
      if(await present(target))result.push(recentResource(definition(`system-${name}-${ext}`,kind,'system-activity',finder,[target])))
    }
    const recentApps=p.join(recent,'com.apple.LSSharedFileList.ApplicationRecentDocuments')
    const builtInRecent:Record<string,{name:string;location:string}>={
      'com.apple.preview':{name:'Preview',location:'/System/Applications/Preview.app'},
      'com.apple.textedit':{name:'TextEdit',location:'/System/Applications/TextEdit.app'},
      'com.apple.quicktimeplayerx':{name:'QuickTime Player',location:'/System/Applications/QuickTime Player.app'},
      'com.microsoft.word':{name:'Microsoft Word',location:'/Applications/Microsoft Word.app'},
      'com.microsoft.excel':{name:'Microsoft Excel',location:'/Applications/Microsoft Excel.app'},
      'com.microsoft.powerpoint':{name:'Microsoft PowerPoint',location:'/Applications/Microsoft PowerPoint.app'},
      'com.microsoft.onenote.mac':{name:'Microsoft OneNote',location:'/Applications/Microsoft OneNote.app'}
    }
    try{for(const entry of await readdir(recentApps,{withFileTypes:true})){
      const match=/^([a-zA-Z0-9.-]+)\.sfl[234]$/.exec(entry.name);if(!entry.isFile()||!match)continue
      // Match installed bundle identity: unknown archives are not attributed to invented applications.
      const app=applications.find((app)=>app.bundleId?.toLowerCase()===match[1].toLowerCase()),known=builtInRecent[match[1].toLowerCase()]
      if(!app?.bundleId&&(!known||!await present(known.location)))continue
      const bundleId=app?.bundleId||match[1],source=owner(bundleId,app?.name||known.name,bundleId,known?[known.location]:[])
      result.push(recentResource(definition(`app-recent:${entry.name}`,'app-recent','app-activity',source,[p.join(recentApps,entry.name)])))
    }}catch(error){if(privacyAccessFailure(error))result.push({...definition('app-recent-permission','app-recent','app-activity',finder,[recentApps]),scan:async()=>privacyUnavailable('permission-required')})}
    const preferences=p.join(home,'Library/Preferences/com.apple.finder.plist')
    if(await present(preferences))for(const [key,kind] of [['SGTRecentFileSearches','search'],['GoToFieldHistory','recent-documents'],['RecentMoveAndCopyDestinations','recent-documents'],['FXRecentFolders','recent-documents']] as const)result.push(finderResource(definition(`finder-${key}`,kind,'system-activity',finder,[preferences]),key))
    for(const app of applications){
      if(!app.bundleId||!/^[a-zA-Z0-9.-]+$/.test(app.bundleId))continue
      const source=owner(app.bundleId,app.name,app.bundleId)
      await addFiles('app-cache','app-cache',source,[p.join(home,'Library/Caches',app.bundleId),p.join(home,'Library/Containers',app.bundleId,'Data/Library/Caches',app.bundleId)])
      await addFiles('app-logs','app-logs',source,[p.join(home,'Library/Logs',app.bundleId)])
      await addFiles('app-sessions','app-sessions',source,[p.join(home,'Library/Saved Application State',`${app.bundleId}.savedState`)])
    }
    // This per-user cache path cannot be derived from a synthetic or another user's home.
    if(home===homedir())try{const {stdout}=await execute('/usr/bin/getconf',['DARWIN_USER_CACHE_DIR'],{timeout:5000,maxBuffer:4096}),reported=stdout.trim();if(reported.startsWith('/var/folders/')||reported.startsWith('/private/var/folders/')){const cache=await realpath(reported);if(cache.startsWith('/private/var/folders/'))await addFiles('system-thumbnails','app-cache',finder,[p.join(cache,'com.apple.quicklook.ThumbnailsAgent/com.apple.QuickLook.thumbnailcache'),p.join(cache,'com.apple.QuickLook.thumbnailcache')],'system-activity')}}catch{/* No supported QuickLook cache on this system. */}
  }else if(platform==='win32'){
    const source=owner('explorer','Windows Explorer','windows.explorer',[p.join(env.SystemRoot||'C:\\Windows','explorer.exe')]),recent=p.join(env.APPDATA||p.join(home,'AppData/Roaming'),'Microsoft/Windows/Recent')
    try{const files=(await readdir(recent,{withFileTypes:true})).filter((entry)=>entry.isFile()&&entry.name.toLowerCase().endsWith('.lnk')).map((entry)=>p.join(recent,entry.name));if(files.length)result.push(privacyFileResource(definition('windows-recent-shortcuts','recent-documents','system-activity',source,files)))}catch(error){if(privacyAccessFailure(error))result.push({...definition('windows-recent-permission','recent-documents','system-activity',source,[recent]),scan:async()=>privacyUnavailable('permission-required')})}
  }else{
    const source=owner('files','Files','org.gnome.Nautilus'),data=env.XDG_DATA_HOME||p.join(home,'.local/share')
    for(const [name,kind] of [['recently-used.xbel','recent-documents'],['recent-applications.xbel','recent-apps']] as const){const target=p.join(data,name);if(await present(target))result.push(textResource(definition(`linux-${name}`,kind,'system-activity',source,[target],'recent',true),xbelEntries))}
  }
  const appRoot=platform==='darwin'?p.join(home,'Library/Application Support'):platform==='win32'?env.APPDATA||p.join(home,'AppData/Roaming'):env.XDG_CONFIG_HOME||p.join(home,'.config')
  for(const [directory,bundleId,name] of [['Code','com.microsoft.VSCode','Visual Studio Code'],['Code - Insiders','com.microsoft.VSCodeInsiders','Visual Studio Code - Insiders'],['VSCodium','com.vscodium','VSCodium']] as const){
    const source=owner(directory,name,bundleId),root=p.join(appRoot,directory)
    await addFiles('code-edit-history','app-edit-history',source,[p.join(root,'User/History')])
    await addFiles('code-workspaces','app-sessions',source,[p.join(root,'User/workspaceStorage'),p.join(root,'Backups')])
    await addFiles('code-logs','app-logs',source,[p.join(root,'logs')])
    await addFiles('code-cache','app-cache',source,['Cache','CachedData','Code Cache','GPUCache'].map((name)=>p.join(root,name)))
  }
  const slack=owner('slack','Slack','com.tinyspeck.slackmacgap');await addFiles('slack-logs','app-logs',slack,[p.join(appRoot,'Slack/logs')])
  if(platform!=='win32'){
    const terminal=owner('terminal','Terminal',platform==='darwin'?'com.apple.Terminal':'org.gnome.Terminal',platform==='darwin'?['/System/Applications/Utilities/Terminal.app']:[])
    const histories:[string,'zsh'|'bash'|'fish'][]=[[p.join(home,'.zsh_history'),'zsh'],[p.join(home,'.bash_history'),'bash'],[p.join(env.XDG_DATA_HOME||p.join(home,'.local/share'),'fish/fish_history'),'fish']]
    if(env.ZDOTDIR&&(env.ZDOTDIR===home||env.ZDOTDIR.startsWith(home+p.sep)))histories.push([p.join(env.ZDOTDIR,'.zsh_history'),'zsh'])
    for(const [target,kind] of histories.filter(([target],index,all)=>all.findIndex(([candidate])=>candidate===target)===index))if(await present(target))result.push(textResource(definition(`shell-${kind}:${target}`,'shell-history','system-activity',terminal,[target],'sensitive',true),(content)=>shellEntries(content,kind)))
  }
  return result
}
