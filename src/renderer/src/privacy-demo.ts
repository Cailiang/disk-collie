import type {PrivacyItem,PrivacyKind,PrivacyPreview,PrivacyRecord,PrivacyTimeRange} from '../../shared/privacy-types'
const now=Date.now(),stamp=(hours:number):string=>new Date(now-hours*3600000).toISOString()
const chrome={key:'chrome',name:'Google Chrome'},finder={key:'finder',name:'Finder'},code={key:'vscode',name:'Visual Studio Code'}
const records:Record<string,PrivacyRecord[]>={
  'browser-history':Array.from({length:128},(_,index)=>({id:`visit-${index}`,title:`Reference article ${index+1}`,url:`https://example.com/articles/${index+1}`,timestamp:stamp(index*.5),count:1})),
  'browser-search':[{id:'search-1',title:'本地磁盘工具',subtitle:'example.com',timestamp:stamp(.2)},{id:'search-2',title:'TypeScript documentation',subtitle:'example.com',timestamp:stamp(30)}],
  'browser-downloads':[{id:'download-1',title:'project-report.pdf',path:'/Users/alex/Downloads/project-report.pdf',timestamp:stamp(2)},{id:'download-2',title:'photos.zip',path:'/Users/alex/Downloads/photos.zip',timestamp:stamp(240)}],
  'browser-sessions':[{id:'session-1',title:'Session_001',path:'/Users/alex/Library/Application Support/Google/Chrome/Default/Sessions/Session_001',timestamp:stamp(3)}],
  'browser-shortcuts':[{id:'shortcut-1',title:'example.com',timestamp:stamp(8)}],
  'browser-top-sites':[{id:'top-1',title:'Example',url:'https://example.com',count:4}],
  'browser-favicons':[{id:'favicon-1',title:'https://example.com',count:1}],
  'browser-cache':[{id:'cache-1',title:'data_0',path:'/Users/alex/Library/Caches/Google/Chrome/Default/Cache/data_0',timestamp:stamp(12)}],
  'profile-history':[{id:'profile-visit',title:'Design resources',url:'https://example.org/design',timestamp:stamp(4)}],
  'safari-history':[{id:'safari-visit',title:'Apple Developer',url:'https://developer.apple.com',timestamp:stamp(1)}],
  cookies:[{id:'cookie-site-1',title:'example.com',count:12},{id:'cookie-site-2',title:'example.org',count:3}],
  passwords:[{id:'login-site-1',title:'https://example.com',count:1}],
  autofill:[{id:'field-1',title:'email',count:3}],
  'site-data':[{id:'site-storage-1',title:'https_example.com_0.localstorage',timestamp:stamp(12)}],
  'site-permissions':[{id:'site-permission-1',title:'https://example.com',subtitle:'notifications',count:1}],
  'app-recent':[{id:'recent-code-1',title:'website',path:'/Users/alex/Projects/website'},{id:'recent-code-2',title:'notes.md',path:'/Users/alex/Documents/notes.md'}],
  'app-logs':[{id:'code-log',title:'main.log',path:'/Users/alex/Library/Application Support/Code/logs/main.log',timestamp:stamp(7)}],
  'app-work-recent':[{id:'recent-work-1',title:'prototype',path:'/Users/alex/Work/prototype'},{id:'recent-work-2',title:'review.md',path:'/Users/alex/Work/review.md'}],
  'app-figma-recent':[{id:'figma-recent-1',title:'Planning.fig',path:'/Users/alex/Documents/Planning.fig'}],
  'recent-documents':[{id:'recent-doc-1',title:'Planning.pdf',path:'/Users/alex/Documents/Planning.pdf'},{id:'recent-doc-2',title:'Sketch.fig',path:'/Users/alex/Documents/Sketch.fig'}],
  'recent-apps':[{id:'recent-app-1',title:'Visual Studio Code'},{id:'recent-app-2',title:'Safari'}],
  'system-network-history':[{id:'network-office',title:'Office NAS',url:'smb://office-nas.example.test/projects'},{id:'network-home',title:'Home Server',url:'smb://home-server.example.test/shared'}],
  'shell-history':[{id:'command-1',title:'git status',timestamp:stamp(.5)},{id:'command-2',title:'npm run build',timestamp:stamp(20)},{id:'command-3',title:'cargo test',timestamp:stamp(200)}],
  clipboard:[{id:'clipboard-summary',title:'当前剪贴板',count:1}]
}
const base:PrivacyItem[]=[]
function item(id:string,kind:PrivacyKind,category:PrivacyItem['privacyCategory'],source:PrivacyItem['source'],file:string,risk:PrivacyItem['risk']='low',profile?:string,size=8192):void{
  const effect=['cookies','site-data','site-permissions'].includes(kind)?'accounts':kind==='passwords'?'passwords':kind==='autofill'?'autofill':kind.includes('sessions')?'sessions':kind.includes('recent')?'recent':kind==='clipboard'?'clipboard':kind==='shell-history'?'shell':kind.includes('logs')?'logs':kind==='cache'?'rebuild':'history'
  base.push({id,kind,privacyCategory:category,source,profile,path:file,paths:file?[file]:[],nameKey:kind,size,category:'privacy',effectKey:effect,browser:source===chrome?'Google Chrome':source?.key==='safari'?'Safari':undefined,risk,capability:'ready',recommended:risk==='low',count:(records[id]||[]).reduce((sum,row)=>sum+(row.count||1),0),range:'all'})
}
for(const kind of ['history','search','downloads'] as const)item(`browser-${kind}`,kind,'browser-activity',chrome,'/Users/alex/Library/Application Support/Google/Chrome/Default/History','low','Default',5.3*1024**2)
for(const kind of ['sessions','shortcuts','top-sites','favicons','cache'] as const)item(`browser-${kind}`,kind,'browser-activity',chrome,`/Users/alex/Library/Application Support/Google/Chrome/Default/${kind}`,kind==='top-sites'?'recent':'low','Default',kind==='cache'?128*1024**2:24576)
item('profile-history','history','browser-activity',chrome,'/Users/alex/Library/Application Support/Google/Chrome/Profile 1/History','low','Profile 1')
item('safari-history','history','browser-activity',{key:'safari',name:'Safari'},'/Users/alex/Library/Safari/History.db','low','Default')
for(const kind of ['cookies','site-data','site-permissions','passwords','autofill'] as const)item(kind,kind,'browser-accounts',chrome,`/Users/alex/Library/Application Support/Google/Chrome/Default/${kind==='cookies'?'Network/Cookies':kind==='passwords'?'Login Data':kind==='autofill'?'Web Data':kind}`,kind==='passwords'||kind==='autofill'?'sensitive':'account','Default',kind==='cookies'?1024**2:16384)
item('app-recent','app-recent','app-activity',code,'/Users/alex/Library/Application Support/com.apple.sharedfilelist/Code.sfl4','recent')
item('app-logs','app-logs','app-activity',code,'/Users/alex/Library/Application Support/Code/logs','low',undefined,680*1024)
item('app-work-recent','app-recent','app-activity',code,'/Users/alex/Library/Application Support/Code/User/profiles/Work/storage.json','recent','Work')
item('app-figma-recent','app-recent','app-activity',{key:'figma',name:'Figma'},'/Users/alex/Library/Application Support/Figma/recent.json','recent')
item('app-empty','app-cache','app-activity',{key:'empty-app',name:'Archive Utility'},'/Users/alex/Library/Caches/com.apple.archiveutility','low',undefined,0)
base.push({...base.find((item)=>item.id==='app-recent')!,id:'app-permission',source:{key:'restricted-app',name:'Restricted App'},profile:'Private',path:'/Users/alex/Library/Application Support/Restricted/history.json',count:null,size:0,capability:'permission-required'})
item('recent-documents','recent-documents','system-activity',finder,'/Users/alex/Library/Application Support/com.apple.sharedfilelist/RecentDocuments.sfl4','recent')
item('recent-apps','recent-apps','system-activity',finder,'/Users/alex/Library/Application Support/com.apple.sharedfilelist/RecentApplications.sfl4','recent')
item('system-network-history','network-history','system-activity',finder,'/Users/alex/Library/Application Support/com.apple.sharedfilelist/RecentHosts.sfl4','recent')
item('shell-history','shell-history','system-activity',{key:'terminal',name:'Terminal'},'/Users/alex/.zsh_history','sensitive')
item('clipboard','clipboard','system-activity',finder,'','recent',undefined,0)
base.push({...base.find((item)=>item.id==='recent-documents')!,id:'recent-servers',kind:'recent-servers',path:'/Users/alex/Library/Application Support/com.apple.sharedfilelist/RecentServers.sfl4',count:null,size:0,capability:'permission-required'})
const noRange=new Set<PrivacyKind>(['top-sites','favicons','site-permissions','passwords','autofill','app-recent','recent-documents','recent-apps','recent-servers','network-history','clipboard'])
function rangeRecords(id:string,range:PrivacyTimeRange):PrivacyRecord[]{const start=range==='all'?0:range==='hour'?now-3600000:range==='week'?now-7*86400000:new Date(new Date(now).setHours(0,0,0,0)).getTime();return (records[id]||[]).filter((row)=>!row.timestamp||Date.parse(row.timestamp)>=start)}
export function demoPrivacyItems(range:PrivacyTimeRange,cleared:Set<string>=new Set()):PrivacyItem[]{return base.map((item)=>{
  if(range!=='all'&&noRange.has(item.kind))return {...item,range,count:null,size:0,capability:'range-unsupported'}
  if(item.capability!=='ready')return {...item,range}
  const rows=cleared.has(item.id)?[]:rangeRecords(item.id,range),count=rows.reduce((sum,row)=>sum+(row.count||1),0)
  return {...item,range,count,capability:count?'ready':'empty'}
})}
export function demoPrivacyPreview(id:string,range:PrivacyTimeRange,offset=0):PrivacyPreview{const item=base.find((item)=>item.id===id)!;const rows=rangeRecords(id,range);return {id,kind:item.kind,records:rows.slice(offset,offset+100),total:rows.reduce((sum,row)=>sum+(row.count||1),0),offset,nextOffset:offset+100<rows.length?offset+100:null}}
