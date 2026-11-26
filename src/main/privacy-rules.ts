import {readdir} from 'node:fs/promises'
import path from 'node:path'
import type {StorageApplication} from '../shared/storage-types'
import type {StorageRule} from './storage-rules'

type Source=NonNullable<StorageRule['source']>
/** Privacy records only. Bookmarks, saved passwords and complete browser preferences are excluded. */
export async function discoverPrivacyRules(platform:NodeJS.Platform,home:string,applications:StorageApplication[]=[],env:NodeJS.ProcessEnv=process.env):Promise<StorageRule[]> {
  const paths=platform==='win32'?path.win32:path.posix,result:StorageRule[]=[]
  const local=env.LOCALAPPDATA||paths.join(home,'AppData/Local'),config=env.XDG_CONFIG_HOME||paths.join(home,'.config')
  const source=(key:string,name:string,bundleId:string,appName=name):Source=>({key,name,bundleIds:[bundleId],iconPaths:platform==='darwin'?[paths.join('/Applications',appName+'.app'),paths.join(home,'Applications',appName+'.app')]:[]})
  const add=(key:string,location:string,owner:Source,category:NonNullable<StorageRule['privacyCategory']>,effect:string,profile?:string,browser?:string,sqlite=false):void=>{result.push({key,relative:location,category:'privacy',effect,source:owner,privacyCategory:category,profile,browser,sqlite})}
  const specs=[
    {source:source('chrome','Google Chrome','com.google.Chrome'),root:platform==='darwin'?paths.join(home,'Library/Application Support/Google/Chrome'):platform==='win32'?paths.join(local,'Google/Chrome/User Data'):paths.join(config,'google-chrome'),process:platform==='darwin'?'Google Chrome':'chrome'},
    {source:source('edge','Microsoft Edge','com.microsoft.edgemac'),root:platform==='darwin'?paths.join(home,'Library/Application Support/Microsoft Edge'):platform==='win32'?paths.join(local,'Microsoft/Edge/User Data'):paths.join(config,'microsoft-edge'),process:platform==='darwin'?'Microsoft Edge':'msedge'},
    {source:source('brave','Brave','com.brave.Browser','Brave Browser'),root:platform==='darwin'?paths.join(home,'Library/Application Support/BraveSoftware/Brave-Browser'):platform==='win32'?paths.join(local,'BraveSoftware/Brave-Browser/User Data'):paths.join(config,'BraveSoftware/Brave-Browser'),process:platform==='darwin'?'Brave Browser':'brave'},
    {source:source('chromium','Chromium','org.chromium.Chromium'),root:platform==='darwin'?paths.join(home,'Library/Application Support/Chromium'):platform==='win32'?paths.join(local,'Chromium/User Data'):paths.join(config,'chromium'),process:platform==='darwin'?'Chromium':'chromium'},
    ...(platform==='darwin'?[{source:source('arc','Arc','company.thebrowser.Browser'),root:paths.join(home,'Library/Application Support/Arc/User Data'),process:'Arc'}]:[])
  ]
  for(const spec of specs){
    let profiles=['Default']
    try{profiles=(await readdir(spec.root,{withFileTypes:true})).filter((entry)=>entry.isDirectory()&&/^(Default|Profile \d+)$/.test(entry.name)).map((entry)=>entry.name).sort()}catch{/* Absent profiles remain inapplicable after snapshot validation. */}
    for(const profile of profiles){
      const base=paths.join(spec.root,profile)
      for(const [key,file,effect,sqlite] of [['privacyHistory','History','history',true],['privacySessions','Sessions','sessions',false],['privacyTopSites','Top Sites','history',true]] as const)add(key,paths.join(base,file),spec.source,'browser-activity',effect,profile,spec.process,sqlite)
      for(const file of ['Network/Cookies','Cookies'])add('privacyCookies',paths.join(base,file),spec.source,'browser-accounts','accounts',profile,spec.process,true)
    }
  }
  if(platform==='darwin'){
    const safari=source('safari','Safari','com.apple.Safari');safari.iconPaths.push('/System/Applications/Safari.app')
    add('safariHistory',paths.join(home,'Library/Safari/History.db'),safari,'browser-activity','history','Default','Safari',true)
    add('privacyCookies',paths.join(home,'Library/Cookies/Cookies.binarycookies'),safari,'browser-accounts','accounts','Default','Safari')
    const recentRoot=paths.join(home,'Library/Application Support/com.apple.sharedfilelist')
    const finder=source('finder','Finder','com.apple.finder');finder.iconPaths=['/System/Library/CoreServices/Finder.app']
    for(const name of ['RecentApplications','RecentDocuments','RecentServers'])for(const extension of ['sfl2','sfl3'])add('privacyRecent',paths.join(recentRoot,`com.apple.LSSharedFileList.${name}.${extension}`),finder,'system-activity','recent')
    try{for(const entry of await readdir(paths.join(recentRoot,'com.apple.LSSharedFileList.ApplicationRecentDocuments'),{withFileTypes:true})){
      const match=/^([a-zA-Z0-9.-]+)\.sfl[23]$/.exec(entry.name);if(!entry.isFile()||!match)continue
      const bundleId=match[1],application=applications.find((app)=>app.bundleId?.toLowerCase()===bundleId.toLowerCase())
      const owner=source(bundleId,application?.name||bundleId,bundleId)
      if(application)owner.iconPaths=[application.location]
      add('privacyAppRecent',paths.join(recentRoot,'com.apple.LSSharedFileList.ApplicationRecentDocuments',entry.name),owner,'app-activity','recent')
    }}catch{/* Recent-document registries vary by macOS version and access permissions. */}
  }else if(platform==='win32'){
    const explorer=source('explorer','Windows Explorer','windows.explorer');explorer.iconPaths=[paths.join(env.SystemRoot||'C:\\Windows','explorer.exe')]
    const recent=paths.join(env.APPDATA||paths.join(home,'AppData/Roaming'),'Microsoft/Windows/Recent')
    try{for(const entry of await readdir(recent,{withFileTypes:true}))if(entry.isFile()&&entry.name.toLowerCase().endsWith('.lnk'))add('privacyRecent',paths.join(recent,entry.name),explorer,'system-activity','recent')}catch{/* No recent shortcuts. */}
  }else{
    add('recent',paths.join(env.XDG_DATA_HOME||paths.join(home,'.local/share'),'recently-used.xbel'),source('files','Files','org.gnome.Nautilus'),'system-activity','recent')
  }
  const code=source('vscode','Visual Studio Code','com.microsoft.VSCode')
  const slack=source('slack','Slack','com.tinyspeck.slackmacgap')
  const appRoot=platform==='darwin'?paths.join(home,'Library/Application Support'):platform==='win32'?env.APPDATA||paths.join(home,'AppData/Roaming'):config
  add('privacyAppLogs',paths.join(appRoot,'Code/logs'),code,'app-activity','logs')
  add('privacyAppLogs',paths.join(appRoot,'Slack/logs'),slack,'app-activity','logs')
  return result
}
