import {isScanPathExcluded,scanPathsOverlap} from '../shared/scan-exclusions'
import {lstat,readdir,realpath} from 'node:fs/promises'
import path from 'node:path'
import {homedir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {DeepCleanCopy,DeepCleanGroup,DeepCleanRisk} from '../shared/deep-clean-types'
import type {PrivacySource} from './privacy-resource'
import {assertDeepNotCancelled,type DeepCleanContext} from './deep-clean-context'
import {CLEANUP_RULES} from './cleanup-rules'
import {discoverProjectArtifacts} from './project-artifacts'
import {projectArtifactSnapshot} from './deep-clean-projects'
import {type DeepCleanSnapshot,type DeepFileOptions} from './deep-clean-resource'

export interface DeepCleanDefinition {
  key:string
  name:DeepCleanCopy
  description:DeepCleanCopy
  group:DeepCleanGroup
  risk:DeepCleanRisk
  recommended:boolean
  paths:string[]
  applications:string[]
  owner?:PrivacySource
  cleanupMethod?:'delete'|'trash'|'none'
  options?:DeepFileOptions
  snapshot?:(target:string,until:number)=>Promise<DeepCleanSnapshot>
}
export const supportsDeepCleanup=(definition:DeepCleanDefinition):boolean=>definition.risk!=='protected'&&!definition.options?.readOnly&&definition.cleanupMethod!=='none'
const rebuild:DeepCleanCopy={zh:'可重新生成的缓存。清理后首次启动或下载可能更慢，账号、设置和文档会保留。',en:'Regenerable cache. The next launch or download may be slower; accounts, settings and documents are kept.'}
const downloaded:DeepCleanCopy={zh:'已经下载的资源；清理后需要重新下载。请逐项确认，不会删除账号、配置或对话。',en:'Downloaded resources that must be downloaded again after cleanup. Review each source; accounts, settings and conversations are kept.'}
const protectedIdentity=(name:string):boolean=>/1password|agilebits|bitwarden|keychain|authenticator|authy|lastpass|dashlane|credential/i.test(name)
async function exists(target:string):Promise<boolean>{try{await lstat(target);return true}catch(error){return ['EACCES','EPERM'].includes(String((error as NodeJS.ErrnoException).code))}}
export async function deepCleanDefinitions(context:DeepCleanContext):Promise<DeepCleanDefinition[]>{
  assertDeepNotCancelled(context.signal)
  const {home,platform,env,applications}=context,p=platform==='win32'?path.win32:path.posix,mac=platform==='darwin',win=platform==='win32',result:DeepCleanDefinition[]=[]
  const cache=mac?p.join(home,'Library/Caches'):win?env.LOCALAPPDATA||p.join(home,'AppData/Local'):env.XDG_CACHE_HOME||p.join(home,'.cache')
  const config=mac?p.join(home,'Library/Application Support'):win?env.APPDATA||p.join(home,'AppData/Roaming'):env.XDG_CONFIG_HOME||p.join(home,'.config')
  const local=env.LOCALAPPDATA||p.join(home,'AppData/Local')
  const owner=(key:string,name:string,bundleIds:string[],appName=name):PrivacySource=>{const app=applications.find((app)=>bundleIds.includes(app.bundleId||'')||app.name===name);return {key,name:app?.name||name,bundleIds,iconPaths:app?[app.iconPath||app.location]:mac?[p.join('/Applications',appName+'.app'),p.join('/System/Applications',appName+'.app')]:[]}}
  const add=(key:string,group:DeepCleanGroup,zh:string,en:string,paths:string[],options:Partial<Omit<DeepCleanDefinition,'key'|'group'|'name'|'paths'>>={}):void=>{
    result.push({key,group,name:{zh,en},paths,description:rebuild,risk:'safe',recommended:true,applications:[],...options})
  }
  if(mac){
    for(const rule of CLEANUP_RULES){
      if(rule.category==='browsers'||rule.actionable===false||rule.risk==='protected')continue
      const group:DeepCleanGroup=rule.id.startsWith('xcode-')||rule.id.startsWith('ios-')?'xcode':/claude|codex|grok|antigravity/.test(rule.id)?'ai':rule.category==='developer'?'development':rule.category==='applications'?'application':'system'
      const runningNames:Record<string,string[]>={'claude-caches':['Claude'],'codex-caches':['Codex'],'antigravity-caches':['Antigravity'],'grok-caches':['Grok'],'work-app-caches':['Slack','Discord','Notion'],'editor-app-caches':['Visual Studio Code','Cursor'],'xcode-derived-data':['Xcode','xcodebuild','swift-frontend','clang'],'ios-device-support':['Xcode','xcodebuild'],'ios-simulator-caches':['Simulator','CoreSimulatorService'],'homebrew-downloads':['brew'],'npm-content-cache':['npm','npx'],'pnpm-store':['pnpm'],'yarn-cache':['yarn'],'gradle-cache':['gradle','GradleDaemon'],'cocoapods-cache':['pod'],'python-download-caches':['pip','pip3','uv'],'go-build-caches':['go'],'rust-download-caches':['cargo','rustc'],'android-cache':['gradle','GradleDaemon'],'maven-repository':['mvn']}
      add(rule.id,group,rule.name.zh,rule.name.en,rule.relativeTargets.filter((parts)=>!parts.includes('Service Worker')).map((parts)=>p.join(home,...parts)),{description:rule.id==='system-saved-state'?{zh:'可能包含窗口恢复和未保存工作记录。请先保存工作并退出应用，清理后无法恢复这些状态。',en:'May include restoration data and unsaved work. Save your work and quit applications first; these states cannot be recovered after cleanup.'}:rule.description,risk:rule.risk,recommended:rule.risk==='safe',applications:runningNames[rule.id]||[]})
    }
    add('system-old-logs','system','旧日志与诊断报告','Old logs and diagnostic reports',[p.join(home,'Library/Logs/DiagnosticReports'),p.join(home,'Library/Logs/CrashReporter')],{description:{zh:'七天前的诊断报告；保留近期记录和原始用户文件。',en:'Diagnostic reports older than seven days. Recent reports and original user files are kept.'},options:{olderThanDays:7}})
    if(home===homedir())for(const [flag,key,zh,en] of [['DARWIN_USER_TEMP_DIR','user-temporary','旧用户临时文件','Old user temporary files'],['DARWIN_USER_CACHE_DIR','darwin-user-cache','旧运行时缓存','Old runtime caches']] as const)try{const {stdout}=await promisify(execFile)('/usr/bin/getconf',[flag],{timeout:3000,maxBuffer:4096}),root=await realpath(stdout.trim()),stat=await lstat(root);if(root.startsWith('/private/var/folders/')&&stat.isDirectory()&&stat.uid===process.getuid?.())add(key,'system',zh,en,[root],{risk:'review',recommended:false,options:{olderThanDays:7},description:{zh:'当前用户七天前的临时文件和运行时缓存。请先退出相关应用；不会处理其他用户的目录。',en:'Temporary/runtime data for the current user older than seven days. Quit related applications first; other users’ directories are not processed.'}})}catch{/* Per-user runtime directories may be unavailable. */}
    add('system-cache','system','系统可重建缓存','Regenerable system caches',['com.apple.helpd','com.apple.QuickLook.thumbnailcache','com.apple.GeoServices','com.apple.parsecd'].map((name)=>p.join(cache,name)))
    add('ios-firmware','system','iOS 固件下载','iOS firmware downloads',[p.join(home,'Library/iTunes/iPhone Software Updates'),p.join(home,'Library/iTunes/iPad Software Updates')],{risk:'review',recommended:false,description:downloaded,options:{pattern:/\.ipsw$/i}})
  }
  const developer:[string,string,string,string[]][]=[
    ['npm','npm 下载缓存','npm download cache',[p.join(home,'.npm/_cacache'),...(win?[p.join(local,'npm-cache/_cacache')]:[])]],
    ['npx','npx 临时运行缓存','npx execution cache',[p.join(home,'.npm/_npx')]],
    ['yarn','Yarn 下载缓存','Yarn download cache',[p.join(cache,win?'Yarn/Cache':'Yarn'),p.join(cache,'yarn'),p.join(home,'.yarn/berry/cache')]],
    ['pnpm','pnpm 包存储','pnpm package store',[mac?p.join(home,'Library/pnpm/store'):win?p.join(local,'pnpm/store'):p.join(home,'.local/share/pnpm/store')]],
    ['bun','Bun 下载缓存','Bun download cache',[p.join(home,'.bun/install/cache')]],
    ['pip','Python 与 uv 下载缓存','Python and uv download caches',win?[p.join(local,'pip/Cache'),p.join(local,'uv/cache')]:[p.join(cache,'pip'),p.join(cache,'uv')]],
    ['gradle','Gradle 构建与依赖缓存','Gradle build and dependency cache',[p.join(home,'.gradle/caches')]],
    ['maven','Maven 依赖仓库','Maven dependency repository',[p.join(home,'.m2/repository')]],
    ['cargo','Cargo 下载缓存','Cargo download cache',[p.join(home,'.cargo/registry/cache'),p.join(home,'.cargo/git/db')]],
    ['go','Go 编译与模块下载缓存','Go build and module download cache',[p.join(cache,'go-build'),p.join(home,'go/pkg/mod/cache')]],
    ['ccache','C/C++ 编译缓存','C/C++ compiler cache',[p.join(cache,'ccache'),p.join(cache,'sccache'),p.join(home,'.ccache')]],
    ['node-gyp','Node 原生模块编译缓存','Node native module build cache',[p.join(cache,'node-gyp'),p.join(home,'.node-gyp')]],
    ['electron-builder','Electron 构建下载缓存','Electron build download cache',[p.join(cache,'electron'),p.join(cache,'electron-builder')]],
    ['browser-automation','浏览器自动化下载','Browser automation downloads',[p.join(cache,'puppeteer'),p.join(cache,'ms-playwright')]],
    ['android','Android 工具缓存','Android tool cache',[p.join(home,'.android/cache')]],
    ['jetbrains','JetBrains 编辑器缓存','JetBrains editor cache',[p.join(cache,'JetBrains')]]
  ]
  for(const [key,zh,en,paths] of developer)add(key,'development',zh,en,paths,{applications:({npm:['npm','npx'],npx:['npm','npx'],yarn:['yarn'],pnpm:['pnpm'],bun:['bun'],pip:['pip','pip3','uv'],gradle:['gradle','GradleDaemon'],maven:['mvn'],cargo:['cargo','rustc'],go:['go'],ccache:['clang','gcc','ccache','sccache'],'node-gyp':['node-gyp'],'electron-builder':['electron-builder','electron-rebuild'],'browser-automation':['playwright','puppeteer'],android:['gradle','GradleDaemon'],jetbrains:['idea','WebStorm','PyCharm','CLion','Rider','IntelliJ IDEA']} as Record<string,string[]>)[key]||[],risk:['maven','pnpm','browser-automation'].includes(key)?'review':'safe',recommended:!['maven','pnpm','browser-automation'].includes(key)})
  const browsers=[
    ['chrome','Google Chrome','com.google.Chrome',mac?'Google/Chrome':win?'Google/Chrome/User Data':'google-chrome'],
    ['edge','Microsoft Edge','com.microsoft.edgemac',mac?'Microsoft Edge':win?'Microsoft/Edge/User Data':'microsoft-edge'],
    ['brave','Brave Browser','com.brave.Browser',mac?'BraveSoftware/Brave-Browser':win?'BraveSoftware/Brave-Browser/User Data':'BraveSoftware/Brave-Browser'],
    ['chromium','Chromium','org.chromium.Chromium',mac?'Chromium':win?'Chromium/User Data':'chromium'],
    ['vivaldi','Vivaldi','com.vivaldi.Vivaldi',mac?'Vivaldi':win?'Vivaldi/User Data':'vivaldi'],
    ['opera','Opera','com.operasoftware.Opera',mac?'com.operasoftware.Opera':win?'Opera Software/Opera Stable':'opera'],
    ['arc','Arc','company.thebrowser.Browser','Arc/User Data']
  ] as const
  for(const [key,name,bundle,directory] of browsers){
    if(key==='arc'&&!mac)continue
    const root=p.join(win?local:config,directory),locations:string[]=[]
    if(!win)locations.push(p.join(cache,directory));if(mac&&key==='arc')locations.push(p.join(cache,'company.thebrowser.Browser'))
    try{for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isDirectory()&&/^(Default|Profile \d+|Guest Profile)$/.test(entry.name))for(const sub of ['Cache','Code Cache','GPUCache'])locations.push(p.join(root,entry.name,sub))}catch{/* Direct cache sources remain independently discoverable. */}
    for(const sub of ['Cache','Code Cache','GPUCache'])locations.push(p.join(root,sub))
    add('browser-'+key,'browser',name+' 网页缓存',name+' web cache',locations,{owner:owner(key,name,[bundle]),applications:[mac?name:key==='edge'?'msedge':key]})
  }
  add('browser-firefox','browser','Firefox 网页缓存','Firefox web cache',[p.join(cache,mac?'Firefox':'mozilla/firefox')],{owner:owner('firefox','Firefox',['org.mozilla.firefox']),applications:[mac?'Firefox':'firefox']})
  if(mac)add('browser-safari','browser','Safari 网页缓存','Safari web cache',[p.join(cache,'com.apple.Safari'),p.join(home,'Library/Containers/com.apple.Safari/Data/Library/Caches')],{owner:owner('safari','Safari',['com.apple.Safari']),applications:['Safari']})
  const apps=[
    ['Code','Visual Studio Code','com.microsoft.VSCode'],['Cursor','Cursor','com.todesktop.230313mzl4w4u92'],['Slack','Slack','com.tinyspeck.slackmacgap'],['discord','Discord','com.hnc.Discord'],['Notion','Notion','notion.id'],['Figma','Figma','com.figma.Desktop'],['Postman','Postman','com.postmanlabs.mac'],['ChatGPT','ChatGPT','com.openai.chat'],['Claude','Claude','com.anthropic.claudefordesktop'],['Codex','Codex','com.openai.codex'],['Antigravity','Antigravity','com.google.antigravity'],['Docker Desktop','Docker Desktop','com.docker.docker']
  ] as const
  for(const [directory,name,bundle] of apps){
    const group:DeepCleanGroup=['Code','Cursor'].includes(directory)?'development':['ChatGPT','Claude','Codex','Antigravity'].includes(directory)?'ai':directory==='Docker Desktop'?'container':'application'
    add('app-'+directory.toLowerCase().replaceAll(' ','-'),group,name+' 可重建缓存',name+' regenerable cache',[
      ...['Cache','Code Cache','GPUCache','CachedData','DawnCache'].map((child)=>p.join(config,directory,child)),p.join(cache,bundle)
    ],{owner:owner(bundle,name,[bundle]),applications:[name]})
  }
  const docker=owner('docker','Docker Desktop',['com.docker.docker'],'Docker')
  if(mac)add('docker-diagnostics','container','Docker 旧诊断日志','Old Docker diagnostic logs',[p.join(home,'Library/Containers/com.docker.docker/Data/log'),p.join(home,'Library/Containers/com.docker.docker/Data/vms/0/log')],{risk:'review',recommended:false,owner:docker,applications:['Docker Desktop','Docker','com.docker.backend','com.docker.virtualization','vpnkit'],options:{olderThanDays:7},description:{zh:'仅处理七天前的诊断日志，保留镜像、容器、卷、虚拟盘和配置。请先退出 Docker。',en:'Only diagnostic logs older than seven days. Images, containers, volumes, virtual disks and configuration are kept. Quit Docker first.'}})
  add('claude-code','ai','Claude Code 缓存','Claude Code cache',[p.join(home,'.claude/cache'),p.join(cache,'claude-cli-nodejs')])
  add('codex-diagnostics','ai','Codex 日志与临时缓存','Codex logs and temporary cache',[p.join(home,'.codex/log'),p.join(home,'.codex/tmp')],{description:{zh:'仅处理诊断日志和临时文件，保留凭据、配置、会话与工作树。',en:'Only diagnostic logs and temporary files; credentials, settings, sessions and worktrees are kept.'}})
  add('huggingface-downloads','ai','Hugging Face 下载缓存','Hugging Face download cache',[p.join(home,'.cache/huggingface/xet')])
  if(mac){
    for(const root of [p.join(home,'Library/Caches'),p.join(home,'Library/Logs')])try{for(const entry of await readdir(root,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink()||entry.name.startsWith('com.apple.')||protectedIdentity(entry.name))continue
      const target=p.join(root,entry.name),isLog=p.basename(root)==='Logs',app=applications.find((app)=>app.bundleId===entry.name||app.name===entry.name)
      add((isLog?'logs:':'user-cache:')+entry.name,isLog?'system':'user-cache',(app?.name||entry.name)+(isLog?' 日志':' 缓存'),(app?.name||entry.name)+(isLog?' logs':' cache'),[target],{risk:'review',recommended:false,owner:app?owner(app.bundleId||app.name,app.name,app.bundleId?[app.bundleId]:[]):undefined,applications:app?[app.name]:[],options:isLog?{olderThanDays:7}:undefined})
    }}catch{/* Fixed source probes report their own permission states. */}
    for(const app of applications){
      if(!app.bundleId||!/^[-a-zA-Z0-9.]+$/.test(app.bundleId)||protectedIdentity(app.bundleId))continue
      add('sandbox:'+app.bundleId,'application',app.name+' 沙盒缓存',app.name+' sandbox cache',[p.join(home,'Library/Containers',app.bundleId,'Data/Library/Caches'),p.join(home,'Library/Containers',app.bundleId,'Data/tmp')],{owner:owner(app.bundleId,app.name,[app.bundleId]),applications:[app.name]})
    }
  }
  for(const artifact of context.trash?await discoverProjectArtifacts(home,Date.now(),context.signal,context.excludedPaths):[])add('project:'+artifact.target,'project',artifact.projectName+' / '+artifact.artifactName,artifact.projectName+' / '+artifact.artifactName,[artifact.target],{risk:'review',recommended:false,applications:['npm','npx','pnpm','yarn','bun','gradle','GradleDaemon','mvn','cargo','rustc','swift','xcodebuild','cmake','ninja','make'],description:{zh:'已识别的构建目录或项目依赖会移到废纸篓；保留项目根目录和源码。包含 Git 或密钥、扫描不完整、内容变化时不处理。',en:'Recognized build output or dependencies move to Trash; project roots and source are kept. Git/key material, incomplete scans or changed contents block cleanup.'},cleanupMethod:context.trash?'trash':'none',snapshot:async()=>{const snapshot=await projectArtifactSnapshot(artifact,home,context.trash||(async()=>{throw new Error('deep.sourceUnavailable')}),200000,context.signal);return context.trash?snapshot:{...snapshot,status:'review-only'}}})
  // Deduplicate overlapping filesystem rules before traversal, keeping explicit rules ahead of generic caches.
  const accepted:string[]=[]
  for(const rule of result.filter(supportsDeepCleanup)){
    assertDeepNotCancelled(context.signal)
    const roots:string[]=[]
    for(const target of [...new Set(rule.paths.map((target)=>p.normalize(target)))]){
      const key=win?target.toLowerCase():target
      if(isScanPathExcluded(target,context.excludedPaths)||rule.group==='project'&&scanPathsOverlap(target,context.excludedPaths)||!await exists(target)||accepted.some((root)=>key===root||key.startsWith(root+p.sep)||root.startsWith(key+p.sep)))continue
      accepted.push(key);roots.push(target)
    }
    rule.paths=roots
  }
  return result.filter((rule)=>supportsDeepCleanup(rule)&&rule.paths.length)
}
