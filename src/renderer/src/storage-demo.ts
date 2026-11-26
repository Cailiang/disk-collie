import type { CleanupItem, DuplicateGroup, RelatedApplicationFile, StorageActivity, StorageApplication, StorageEntry, StorageIndex } from '../../shared/storage-types'
const GB=1024**3, MB=1024**2
function entry(id:number, name:string,size:number,directory=false,parent:number|null=0):StorageEntry {
  return {id,parent,name,path:`/Users/alex/${name}`,directory,size,allocated:size,modified:Date.now()*1e6,identity:String(id),links:1}
}
export const demoEntries = [entry(1,'Documents',28.4*GB,true),entry(2,'Movies',18.7*GB,true),entry(3,'Projects',14.3*GB,true),entry(4,'Downloads',9.8*GB,true),entry(5,'Pictures',8.4*GB,true),entry(6,'Music',3.2*GB,true),entry(7,'Desktop',1.4*GB,true)]
export const demoLarge=[entry(20,'Field notes — final.mov',5.8*GB),entry(21,'Design archive.zip',2.4*GB),entry(22,'Ubuntu 24.04.iso',1.9*GB),entry(23,'Weekend in Kyoto.mov',890*MB),entry(24,'Research collection.pdf',320*MB),entry(25,'Product explorations.fig',180*MB)]
export const demoIndex:StorageIndex={generation:1,root:{...entry(0,'Macintosh HD',141.2*GB,true,null),path:'/'},entries:126482,errors:2,skipped:18,limited:false,elapsedMs:1842}
export const demoCleanup:CleanupItem[]=[{id:'cache-1',nameKey:'xcode',path:'/Users/alex/Library/Developer/Xcode/DerivedData',size:3.2*GB,category:'developer',effectKey:'rebuild'},{id:'cache-2',nameKey:'npm',path:'/Users/alex/.npm/_cacache',size:1.4*GB,category:'developer',effectKey:'rebuild'},{id:'cache-3',nameKey:'chromeCache',path:'/Users/alex/Library/Caches/Google/Chrome',size:780*MB,category:'cache',effectKey:'rebuild'},{id:'cache-4',nameKey:'logs',path:'/Users/alex/Library/Logs',size:120*MB,category:'logs',effectKey:'logs'}]
export const demoPrivacy:CleanupItem[]=[
  {id:'privacy-1',nameKey:'chromeHistory',path:'/Users/alex/Library/Application Support/Google/Chrome/Default/History',size:42*MB,category:'privacy',effectKey:'history',browser:'Google Chrome',source:{key:'chrome',name:'Google Chrome'},privacyCategory:'browser-activity',profile:'Default'},
  {id:'privacy-2',nameKey:'safariHistory',path:'/Users/alex/Library/Safari/History.db',size:18*MB,category:'privacy',effectKey:'history',browser:'Safari',source:{key:'safari',name:'Safari'},privacyCategory:'browser-activity',profile:'Default'},
  {id:'privacy-3',nameKey:'privacyHistory',path:'/Users/alex/Library/Application Support/Google/Chrome/Profile 1/History',size:8*MB,category:'privacy',effectKey:'history',browser:'Google Chrome',source:{key:'chrome',name:'Google Chrome'},privacyCategory:'browser-activity',profile:'Profile 1'},
  {id:'privacy-4',nameKey:'privacyCookies',path:'/Users/alex/Library/Application Support/Google/Chrome/Default/Network/Cookies',size:2*MB,category:'privacy',effectKey:'accounts',browser:'Google Chrome',source:{key:'chrome',name:'Google Chrome'},privacyCategory:'browser-accounts',profile:'Default'},
  {id:'privacy-5',nameKey:'privacyAppRecent',path:'/Users/alex/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/com.microsoft.vscode.sfl3',size:210*1024,category:'privacy',effectKey:'recent',source:{key:'vscode',name:'Visual Studio Code'},privacyCategory:'app-activity'},
  {id:'privacy-6',nameKey:'privacyRecent',path:'/Users/alex/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.RecentDocuments.sfl3',size:96*1024,category:'privacy',effectKey:'recent',source:{key:'finder',name:'Finder'},privacyCategory:'system-activity'}
]
export const demoDuplicates:DuplicateGroup[]=[{id:'demo-hash',reclaimable:2.4*GB,files:[{...demoLarge[1],id:31,path:'/Users/alex/Documents/Design archive.zip'},{...demoLarge[1],id:32,path:'/Users/alex/Downloads/Design archive.zip'}]},{id:'demo-hash-2',reclaimable:320*MB,files:[{...demoLarge[4],id:33,path:'/Users/alex/Documents/Research collection.pdf'},{...demoLarge[4],id:34,path:'/Users/alex/Desktop/Research collection.pdf'}]}]
export const demoApps:StorageApplication[]=[
  {id:'app-1',name:'Visual Studio Code',version:'1.106',location:'/Applications/Visual Studio Code.app',bundleId:'com.microsoft.VSCode',size:580*MB,lastUsedAt:new Date(Date.now()-2*86400_000).toISOString(),protected:false,system:false,method:'trash',updateAvailable:true,latestVersion:'1.107',updateSource:'sparkle',updateMode:'direct'},
  {id:'app-2',name:'Figma',version:'126',location:'/Applications/Figma.app',bundleId:'com.figma.Desktop',size:320*MB,lastUsedAt:new Date(Date.now()-106*86400_000).toISOString(),protected:false,system:false,method:'trash'},
  {id:'app-3',name:'Safari',version:'26',location:'/System/Applications/Safari.app',bundleId:'com.apple.Safari',size:180*MB,lastUsedAt:null,protected:true,system:true,method:'trash'}]
export const demoRelated:RelatedApplicationFile[]=[{id:'related-1',path:'/Applications/Visual Studio Code.app',kind:'application',size:580*MB,directory:true},{id:'related-2',path:'/Users/alex/Library/Caches/com.microsoft.VSCode',kind:'cache',size:240*MB,directory:true},{id:'related-3',path:'/Users/alex/Library/Preferences/com.microsoft.VSCode.plist',kind:'preferences',size:20*1024,directory:false},{id:'related-4',path:'/Users/alex/Library/Application Support/Code',kind:'support',size:180*MB,directory:true}]
export function demoRelatedChildren(parent:RelatedApplicationFile):RelatedApplicationFile[]{return [{id:parent.id+'-child',parentId:parent.id,path:parent.path+'/'+(parent.kind==='application'?'Contents':parent.kind==='cache'?'Cache.data':'settings.json'),kind:parent.kind,size:parent.size,directory:false}]}

export const demoHistory:StorageActivity[]=[{id:'activity-1',date:new Date(Date.now()-86400_000).toISOString(),kind:'cleanup',items:8,bytes:6.4*GB,failures:0,locations:[]},{id:'activity-2',date:new Date(Date.now()-2*86400_000).toISOString(),kind:'large',items:3,bytes:4.2*GB,failures:0,locations:[]}]

export const demoRootEntries=[{...entry(100,'Users',84.2*GB,true),path:'/Users'}, {...entry(110,'Applications',26*GB,true),path:'/Applications'}, {...entry(111,'System',19*GB,true),path:'/System'}, {...entry(112,'Library',12*GB,true),path:'/Library'}]
const demoUser={...entry(101,'alex',84.2*GB,true,100),path:'/Users/alex'}
export function demoChildren(parent:StorageEntry):StorageEntry[]{
  if(parent.path==='/')return demoRootEntries
  if(parent.id===100)return [demoUser]
  if(parent.id===101)return demoEntries.map((e)=>({...e,parent:101}))
  if(parent.name==='Music')return [{...entry(301,'Studio recordings',3.2*GB-18*500*1024-220*1024,true,parent.id),path:parent.path+'/Studio recordings'},{...entry(302,'Playlists',200*1024,true,parent.id),path:parent.path+'/Playlists'},{...entry(303,'Notes.txt',20*1024,false,parent.id),path:parent.path+'/Notes.txt'},...Array.from({length:18},(_,index)=>({...entry(310+index,'Session '+String(index+1)+'.m4a',500*1024,false,parent.id),path:parent.path+'/Session '+String(index+1)+'.m4a'}))]
  return demoLarge.slice(0,4).map((e)=>({...e,parent:parent.id,path:`${parent.path}/${e.name}`,trashable:!['/System','/Library','/Applications'].some((root)=>parent.path===root||parent.path.startsWith(root+'/'))}))
}
