import {isScanPathExcluded,scanPathsOverlap} from '../shared/scan-exclusions'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import {translate} from '../shared/localization'
import {watch,type FSWatcher} from 'node:fs'
import {ApplicationInventoryCache} from './application-inventory-cache'
import {storageScanScope} from './storage-scan-scope'
import {duplicateRemovalGroups} from '../shared/duplicate-selection'
import type {ApplicationInventoryState} from '../shared/storage-types'
import type { CleanupItem, DuplicateGroup, RelatedApplicationFile, StorageActivity, StorageApplication, StorageEntry, StorageIndex, StorageMode } from '../shared/storage-types'
import { fileCategories } from '../shared/file-categories'
import type { StorageScanOptions } from '../shared/storage-types'
import { NativeEngine } from './native-engine'
import type { AppLanguage } from '../shared/app-settings'
import { discoverApplicationUpdates, findApplications, inspectApplication, type ApplicationMetadata, type ApplicationUpdate } from './scanner'
import { updateRegisteredApplication } from './storage-application-actions'
import { storageRules } from './storage-rules'
import { StorageTaskQueue } from './storage-task-queue'
import { isStorageMutationAllowed } from './storage-policy'
import {StorageLedger} from './storage-ledger'
import {readApplicationIcon} from './application-icon'
import {PrivacyService} from './privacy-service'
import {ApplicationOperations} from '../shared/application-operations'
import {DeepCleanService} from './deep-clean-service'
import {storageProcessMatcher} from './storage-process-match'
import type {DeepCleanScan} from '../shared/deep-clean-types'
import type {StorageDirectoryPlan} from '../shared/storage-directory-types'
import {isStorageDirectoryCandidate,prepareStorageDirectoryTrash,type DirectoryTrashSnapshot} from './storage-directory-trash'
import type {PrivacyItem,PrivacyTimeRange} from '../shared/privacy-types'
import {PrivacyCleanupError,type PrivacyOutcome} from './privacy-resource'

const exec = promisify(execFile)
const home = os.homedir()
const int = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const scope = z.object({ generation: z.number().int().positive() })
const entryInput = scope.extend({ id: int })
interface Snapshot { path: string; dev: number; ino: number; modified: number; size: number; directory: boolean }
async function snapshot(target: string): Promise<Snapshot> {
  for (let current = target;; current = path.dirname(current)) {
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error('A path component is a symbolic link. Scan the real folder instead.')
    if (path.dirname(current) === current) break
  }
  const stat = await lstat(target)
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('Unsupported file type')
  return { path: target, dev: stat.dev, ino: stat.ino, modified: stat.mtimeMs, size: stat.size, directory: stat.isDirectory() }
}
async function unchanged(old: Snapshot): Promise<void> {
  const fresh = await snapshot(old.path)
  if (old.dev !== fresh.dev || old.ino !== fresh.ino || old.modified !== fresh.modified || (!old.directory && old.size !== fresh.size)) throw new Error('The item changed since it was inspected. Scan again.')
}

export class StorageService {
  constructor(private readonly language:()=>AppLanguage=()=> 'zh-CN',private readonly excludedDirectories:()=>string[]=()=>[]) {}
  getScanExclusions():string[]{return this.excludedDirectories()}
  private scopeEpoch=0
  invalidateScanScope():void {
    ++this.scopeEpoch
    this.invalidateDirectoryPlan()
    this.deepScanCancellation?.abort()
    for(const engine of this.activeEngines.values())engine.stop()
    for(const session of this.sessions.values())session.engine.stop()
    this.sessions.clear();this.latest=null
    this.cleanupEngines.cleanup.stop();this.cleanupEngines.privacy.stop()
    this.rules.clear();this.privacyService=new PrivacyService();this.deepCleanService=new DeepCleanService()
    for(const window of BrowserWindow.getAllWindows())window.webContents.send('diskcollie:storage:scope-changed')
  }
  private metadata=new Map<string,ApplicationMetadata>()
  private updates=new Map<string,ApplicationUpdate>()
  private engine = new NativeEngine((progress) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('diskcollie:storage:progress', progress) })
  private sessions = new Map<StorageMode,{index:StorageIndex;engine:NativeEngine;groups:Map<string,DuplicateGroup>;removed:Set<string>}>()
  private latest: StorageMode | null = null
  private activeEngines=new Map<import('../shared/storage-types').StorageMode,NativeEngine>()
  private scanRemovals=new Map<StorageMode,Set<string>>()
  private cleanupEngines={cleanup:new NativeEngine(),privacy:new NativeEngine()}
  private systemEngine=new NativeEngine()
  private privacyService=new PrivacyService()
  private applicationOperations=new ApplicationOperations()
  private deepCleanService=new DeepCleanService()
  private deepScanCancellation:AbortController|null=null
  private directoryTrashPlan:{plan:StorageDirectoryPlan;snapshot:DirectoryTrashSnapshot}|null=null
  private queue=new StorageTaskQueue((scope,queued,blockedBy)=>this.progress({scope,phase:queued?'queued':'indexing',blockedBy:blockedBy||undefined,entries:0,elapsedMs:0}))
  private progress(progress: import('../shared/storage-types').StorageProgress):void {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('diskcollie:storage:progress',{...progress,scope:progress.scope})
  }
  private history: StorageActivity[] = []
  private rules = new Map<string, { item: CleanupItem; snapshots: Snapshot[]; browser?: string;source?:import('./storage-rules').StorageRule['source'] }>()
  private applications = new Map<string, StorageApplication>()
  private applicationCache=new ApplicationInventoryCache(path.join(app.getPath('userData'),'application-inventory.json'))
  private applicationFingerprints=new Map<string,string>()
  private measuredApplicationFingerprints=new Map<string,string>()
  private applicationRefresh:Promise<StorageApplication[]>|null=null
  private applicationsRefreshing=false
  private applicationsSizing=false
  private applicationsUpdatedAt:string|null=null
  private applicationsError:string|null=null
  private applicationSizeEngine=new NativeEngine()
  private applicationSizeEpoch=0
  private applicationWatchers:FSWatcher[]=[]
  private applicationTimer:ReturnType<typeof setInterval>|null=null
  private applicationDebounce:ReturnType<typeof setTimeout>|null=null
  private inventoryStopped=false
  private readonly applicationRoots=process.platform==='darwin'?['/Applications',path.join(home,'Applications'),'/System/Applications']:process.platform==='linux'?['/usr/share/applications',path.join(home,'.local/share/applications')]:[]
  applicationState():ApplicationInventoryState {return {applications:[...this.applications.values()].sort((a,b)=>a.name.localeCompare(b.name)),refreshing:this.applicationsRefreshing,measuringSizes:this.applicationsSizing,updatedAt:this.applicationsUpdatedAt,error:this.applicationsError}}
  private publishApplications():void {for(const window of BrowserWindow.getAllWindows())window.webContents.send('diskcollie:storage:applications-changed',this.applicationState())}
  private persistApplications():Promise<void> {return this.applicationCache.write([...this.applications.values()].map((application)=>({application,fingerprint:this.measuredApplicationFingerprints.get(application.id)||''})),this.applicationsUpdatedAt||new Date().toISOString())}
  startApplicationInventory():void {
    if(this.applicationTimer)return
    this.inventoryStopped=false
    const refresh=():void=>{void this.listApplications(true).catch(()=>undefined)}
    refresh()
    this.applicationTimer=setInterval(refresh,5*60_000);this.applicationTimer.unref()
    for(const root of this.applicationRoots)try{const watcher=watch(root,()=>{if(this.applicationDebounce)clearTimeout(this.applicationDebounce);this.applicationDebounce=setTimeout(refresh,1500);this.applicationDebounce.unref()});watcher.on('error',()=>undefined);this.applicationWatchers.push(watcher)}catch{/* Missing optional application roots are retried by periodic discovery. */}
  }
  stopApplicationInventory():void {
    this.inventoryStopped=true;this.applicationSizeEpoch++;this.applicationSizeEngine.stop()
    if(this.applicationTimer)clearInterval(this.applicationTimer)
    if(this.applicationDebounce)clearTimeout(this.applicationDebounce)
    this.applicationTimer=null;this.applicationDebounce=null
    for(const watcher of this.applicationWatchers)watcher.close()
    this.applicationWatchers=[]
  }
  private async registeredApplication(id:string):Promise<StorageApplication> {
    let application=this.applications.get(id)
    if(application?.cached){
      const displayed=application
      await this.listApplications(true);application=this.applications.get(id)
      if(application&&(displayed.version!==application.version||displayed.bundleId!==application.bundleId||displayed.name!==application.name))throw new Error(translate(this.language(),'apps.changed'))
    }
    if(!application||application.cached)throw new Error('Application selection expired')
    const expected=this.applicationFingerprints.get(id)
    if(process.platform==='darwin'&&expected){
      const stat=await snapshot(application.location);let infoModified=0
      try{infoModified=(await lstat(path.join(application.location,'Contents/Info.plist'))).mtimeMs}catch{/* Discovery uses the same metadata fallback. */}
      if([stat.dev,stat.ino,stat.modified,infoModified,application.version].join(':')!==expected){void this.listApplications(true).catch(()=>undefined);throw new Error(translate(this.language(),'apps.changed'))}
    }
    return application
  }
  private applicationId(location:string,name:string):string {return [...this.applications.values()].find((item)=>location?item.location===location&&(process.platform!=='win32'||item.name===name):item.name===name)?.id||randomUUID()}
  private async measureApplicationSizes(epoch:number):Promise<void> {
    const jobs=[...this.applications.values()].filter((application)=>!application.system&&this.applicationFingerprints.has(application.id)&&this.applicationFingerprints.get(application.id)!==this.measuredApplicationFingerprints.get(application.id))
    this.applicationsSizing=jobs.length>0;this.publishApplications()
    try{for(const job of jobs){
      if(epoch!==this.applicationSizeEpoch||this.inventoryStopped)return
      const fingerprint=this.applicationFingerprints.get(job.id)
      const timeout=setTimeout(()=>this.applicationSizeEngine.stop('Application size measurement timed out'),8_000);timeout.unref()
      try{
        const [result]=await this.applicationSizeEngine.request<Array<{path:string;size:number;errors:number}>>('measure',{paths:[job.location]})
        const current=this.applications.get(job.id)
        if(epoch!==this.applicationSizeEpoch||!current||fingerprint!==this.applicationFingerprints.get(job.id))continue
        if(result&&!result.errors){current.size=result.size;this.measuredApplicationFingerprints.set(job.id,fingerprint!);this.publishApplications();await this.persistApplications().catch(()=>undefined)}
      }catch{/* The list remains available when a bundle cannot be measured. */}finally{clearTimeout(timeout)}
    }}finally{if(epoch===this.applicationSizeEpoch){this.applicationsSizing=false;this.publishApplications()}}
  }
  private related = new Map<string, { file: RelatedApplicationFile; snapshot: Snapshot; applicationId: string }>()
  private generation = 0
  private ledger:StorageLedger|null=null
  async init(): Promise<void> {
    const cached=await this.applicationCache.read()
    if(cached){
      this.applicationsUpdatedAt=cached.updatedAt
      for(const entry of cached.entries){
        const application=entry.application
        if(process.platform==='darwin'&&!this.applicationRoots.some((root)=>application.location.startsWith(root+path.sep)&&application.location.endsWith('.app')))continue
        this.applications.set(application.id,application);this.measuredApplicationFingerprints.set(application.id,entry.fingerprint)
      }
    }
    this.ledger?.close();this.ledger=new StorageLedger(app.getPath('userData'));this.history=this.ledger.list()
  }
  private async save(): Promise<void> {
    this.ledger??=new StorageLedger(app.getPath('userData'))
    if(this.history[0])this.ledger.save(this.history[0])
  }
  private exclusive<T>(scope:import('../shared/storage-types').StorageTaskScope,work:()=>Promise<T>,mutation=false):Promise<T> {return this.queue.run(scope,work,mutation)}
  private session(generation:number) {
    const session=[...this.sessions.values()].find((s)=>s.index.generation===generation)
    if(!session)throw new Error('The scan has changed. Refresh this view.')
    return session
  }
  private async reconcile(locations:string[]):Promise<void> {
    if(!locations.length)return
    const pending:Promise<void>[]=[]
    for(const [mode,session] of this.sessions){
      for(const location of locations)session.removed.add(location)
      for(const [id,group] of session.groups){
        group.files=group.files.filter((file)=>!locations.some((location)=>file.path===location||file.path.startsWith(location+path.sep)))
        group.reclaimable=group.files.slice(1).reduce((sum,file)=>sum+file.allocated,0)
        if(group.files.length<2)session.groups.delete(id)
      }
      const work=session.engine.request<StorageIndex>('forget',{paths:locations}).then((summary)=>{session.index={...session.index,...summary,generation:session.index.generation}})
      // Hash replies are filtered below while their queued index reconciliation finishes.
      if(this.activeEngines.get(mode)===session.engine)void work.catch(()=>undefined);else pending.push(work)
    }
    await Promise.all(pending)
  }
  private async activity(kind: StorageActivity['kind'], jobs: Array<{ path: string; size: number; run: () => Promise<void|PrivacyOutcome>;privacyId?:string;deepCleanId?:string }>,skipped=0,deep=false): Promise<StorageActivity> {
    const epoch=this.scopeEpoch
    const record: StorageActivity = { id: randomUUID(), date: new Date().toISOString(), kind, items: 0, bytes: 0, failures: 0, locations: [],removedPaths:[],...(deep||jobs.some((job)=>job.deepCleanId)?{deepCleanIds:[],skipped,unchanged:0}:{}),...(kind==='privacy'?{privacyIds:[],traces:0,skipped,unchanged:0}:{}) }
    this.history.unshift(record); await this.save()
    const started=Date.now();let processed=0
    for (const job of jobs) {
      this.progress({scope:kind==='uninstall'?'apps':kind,phase:'cleaning',entries:processed,total:jobs.length,elapsedMs:Date.now()-started,path:job.path})
      const accept=(outcome:void|PrivacyOutcome):void=>{
        const changed=outcome?outcome.changed:true
        if(changed){record.items++;record.bytes+=outcome?outcome.size:job.size;record.locations.push(job.path)}else record.unchanged=(record.unchanged||0)+1
        if(outcome)record.traces=(record.traces||0)+outcome.count
        if(job.privacyId)record.privacyIds?.push(job.privacyId)
        if(job.deepCleanId)record.deepCleanIds?.push(job.deepCleanId)
        const removedPaths=outcome?outcome.removedPaths||[]:[job.path]
        record.removedPaths!.push(...removedPaths)
        for(const location of removedPaths)for(const removed of this.scanRemovals.values())removed.add(location)
      }
      try{if(kind!=='uninstall'&&epoch!==this.scopeEpoch)throw new Error('storage.scopeChanged');accept(await job.run())}
      catch(error) {if(error instanceof PrivacyCleanupError)accept(error.outcome);record.failures++;const message=error instanceof Error?error.message:String(error);(record.errors??=[]).push({path:job.path,message:message.startsWith('privacy.')||message.startsWith('deep.')||message.startsWith('storage.')?translate(this.language(),message):message})}
      processed++;await this.save()
      this.progress({scope:kind==='uninstall'?'apps':kind,phase:'cleaning',entries:processed,total:jobs.length,elapsedMs:Date.now()-started,path:job.path})
    }
    await this.reconcile(record.removedPaths!)
    return record
  }
  async scan(options: StorageScanOptions): Promise<StorageIndex | null> {
    return this.exclusive(options.mode||'analysis',async () => {
      const epoch=this.scopeEpoch
      const root = process.env.DISKCOLLIE_TEST_RUN === '1' && process.env.DISKCOLLIE_TEST_STORAGE_ROOT ? process.env.DISKCOLLIE_TEST_STORAGE_ROOT : path.parse(home).root
      const mode=options.mode||'analysis'
      const scanScope=storageScanScope(home,options.includeHidden??false,process.platform,process.env,mode);scanScope.excludePaths.push(...this.getScanExclusions())
      const engine=new NativeEngine((p)=>this.progress({...p,scope:mode}))
      this.activeEngines.set(mode,engine);const removed=new Set<string>();this.scanRemovals.set(mode,removed)
      try {
        let index=await engine.request<StorageIndex>('scan',{root,...options,mode,...scanScope})
        while(removed.size){const paths=[...removed];removed.clear();index=await engine.request<StorageIndex>('forget',{paths})}
        if(epoch!==this.scopeEpoch)throw new Error('storage.scopeChanged')
        index.generation=++this.generation;index.includeHidden=scanScope.includeHidden
        this.sessions.get(mode)?.engine.stop()
        this.sessions.set(mode,{index,engine,groups:new Map(),removed:new Set()});this.latest=mode
        return index
      } catch(e) {engine.stop();throw e} finally {this.activeEngines.delete(mode);this.scanRemovals.delete(mode)}
    })
  }
  async cleanup(privacy: boolean,refresh=true): Promise<CleanupItem[]> {
    if(privacy)return this.scanPrivacy('all')
    const retained=[...this.rules.values()].filter((value)=>(value.item.category==='privacy')===privacy).map((value)=>value.item)
    if(!refresh&&retained.length)return retained
    return this.exclusive(privacy?'privacy':'cleanup',async () => {
      const epoch=this.scopeEpoch
      // Invalidate only this kind so an unrelated scan cannot authorize stale IDs.
      for (const [id, value] of this.rules) if ((value.item.category === 'privacy') === privacy) this.rules.delete(id)
      const available: Array<{ rule: ReturnType<typeof storageRules>[number]; snapshots: Snapshot[]; path:string }> = []
      for (const rule of storageRules(process.platform,home).filter((rule)=>rule.category!=='privacy')) {
        const target = path.resolve(home, rule.relative)
        if(scanPathsOverlap(target,this.getScanExclusions()))continue
        const snapshots:Snapshot[]=[]
        for(const item of rule.sqlite||rule.category==='privacy'&&rule.effect==='history'?[target,`${target}-wal`,`${target}-shm`,`${target}-journal`]:[target]) {
          try { snapshots.push(await snapshot(item)) } catch { /* Absent or redirected targets are inapplicable. */ }
        }
        if(snapshots.length)available.push({rule,snapshots,path:target})
      }
      const measured = await this.cleanupEngines[privacy?'privacy':'cleanup'].request<Array<{ path: string; size: number; errors: number }>>('measure', { paths: available.flatMap((v) => v.snapshots.map((s)=>s.path)) })
      if(epoch!==this.scopeEpoch)throw new Error('storage.scopeChanged')
      const result: CleanupItem[] = []
      for (const value of available) {
        const measurements=value.snapshots.map((s)=>measured.find((v)=>v.path===s.path))
        if(measurements.some((m)=>!m||m.errors))continue
        const size=measurements.reduce((sum,m)=>sum+(m?.size||0),0);if(!size)continue
        const item: CleanupItem = { id: randomUUID(), nameKey: value.rule.key, path: value.path, paths:value.snapshots.map((s)=>s.path), size, category: value.rule.category, effectKey: value.rule.effect, browser: value.rule.browser,privacyCategory:value.rule.privacyCategory,profile:value.rule.profile,source:value.rule.source?{key:value.rule.source.key,name:value.rule.source.name}:undefined }
        this.rules.set(item.id, { item, snapshots: value.snapshots, browser: value.rule.browser,source:value.rule.source }); result.push(item)
      }
      return result.sort((a,b) => b.size-a.size)
    })
  }
  private async requireBrowserClosed(browser?: string): Promise<void> {
    if (!browser) return
    const result = await this.systemEngine.request<{ processes: Array<{ name: string; command: string }>; processNames: string[]; processCommands:string[] }>('system')
    if (result.processCommands.some((p)=>p.toLowerCase().includes(browser.toLowerCase())) || result.processNames.some((p) => p.toLowerCase().includes(browser.toLowerCase())) || result.processes.some((p) => `${p.name} ${p.command}`.toLowerCase().includes(browser.toLowerCase()))) throw new Error(translate(this.language(),'privacy.closeBrowser',{browser}))
  }
  async clean(ids: string[]): Promise<StorageActivity> {
    if(this.privacyService.has(ids[0]))return this.cleanPrivacy({ids,skipRunning:false})
    return this.exclusive(this.rules.get(ids[0])?.item.category==='privacy'?'privacy':'cleanup',async () => {
      const values = ids.map((id) => { const v=this.rules.get(id); if (!v) throw new Error('Cleanup selection expired. Scan again.'); return v })
      if (new Set(values.map((v) => v.item.category === 'privacy')).size !== 1) throw new Error('Review privacy and caches separately')
      // Preflight the whole selection before making any changes.
      for(const value of values){if(scanPathsOverlap(value.item.path,this.getScanExclusions()))throw new Error('storage.excludedPath');for(const snapshot of value.snapshots)await unchanged(snapshot)}
      for(const browser of new Set(values.map((value)=>value.browser).filter(Boolean)))await this.requireBrowserClosed(browser)
      const result = await this.activity(values[0].item.category === 'privacy' ? 'privacy' : 'cleanup', values.map((value) => ({ path: value.item.path, size: value.item.size, run: async () => {
        for(const s of value.snapshots)await unchanged(s)
        // Never follow links: rm unlinks nested symlinks rather than traversing them.
        for(const s of value.snapshots)await rm(s.path, { recursive: true, force: false }); this.rules.delete(value.item.id)
      } })))
      return result
    },true)
  }
  private async privacyProcesses():Promise<(browser:string)=>boolean>{
    const result=await this.systemEngine.request<{processes:Array<{name:string;command:string}>;processNames:string[];processCommands:string[]}>('system')
    const names=[...(result.processCommands||[]),...(result.processNames||[]),...(result.processes||[]).map((process)=>`${process.name} ${process.command}`)].map((name)=>name.toLowerCase())
    return (browser)=>names.some((name)=>name.includes(browser.toLowerCase()))
  }
  private async deepProcesses():Promise<(name:string)=>boolean>{
    const result=await this.systemEngine.request<{processes:Array<{name:string;command:string}>;processNames:string[];processCommands:string[]}>('system')
    const names=[...(result.processCommands||[]),...(result.processNames||[]),...(result.processes||[]).flatMap((process)=>[process.name,process.command])]
    // Inspect command names locally so Node/Java launchers can be attributed to their tools.
    try{
      const {stdout}=process.platform==='win32'?await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine'],{timeout:5000,maxBuffer:4*1024*1024,windowsHide:true}):await exec('/bin/ps',['-axo','command='],{timeout:5000,maxBuffer:4*1024*1024})
      names.push(...stdout.split('\n'))
    }catch{/* Native executable identities remain available when command arguments cannot be read. */}
    return storageProcessMatcher(names)
  }
  async scanDeep():Promise<DeepCleanScan>{
    return this.exclusive('cleanup',async()=>{
      const started=Date.now(),cancellation=new AbortController();this.deepScanCancellation=cancellation
      try{
        if(this.applicationRefresh)await this.applicationRefresh.catch(()=>undefined)
        if(cancellation.signal.aborted)throw new Error('deep.cancelled')
        const fixtureHome=process.env.DISKCOLLIE_TEST_RUN==='1'?process.env.DISKCOLLIE_TEST_DEEP_HOME:undefined,selectedHome=fixtureHome||home
        const env=fixtureHome?{...process.env,LOCALAPPDATA:path.join(fixtureHome,'AppData/Local'),APPDATA:path.join(fixtureHome,'AppData/Roaming'),XDG_CONFIG_HOME:path.join(fixtureHome,'.config'),XDG_DATA_HOME:path.join(fixtureHome,'.local/share'),XDG_CACHE_HOME:path.join(fixtureHome,'.cache')}:process.env
        return await this.deepCleanService.scan({platform:process.platform,home:selectedHome,env,excludedPaths:this.getScanExclusions(),applications:fixtureHome?[]:[...this.applications.values()],trash:(target:string)=>shell.trashItem(target),signal:cancellation.signal},await this.deepProcesses(),(done,total,target)=>{if(cancellation.signal.aborted)throw new Error('deep.cancelled');this.progress({scope:'cleanup',phase:'indexing',entries:done,total,elapsedMs:Date.now()-started,path:target})})
      }finally{if(this.deepScanCancellation===cancellation)this.deepScanCancellation=null}
    })
  }
  async cleanDeep(input:{ids:string[];skipRunning:boolean}):Promise<StorageActivity>{
    return this.exclusive('cleanup',async()=>{
      const {entries,skipped}=await this.deepCleanService.prepare(input.ids,await this.deepProcesses(),input.skipRunning)
      return this.activity('cleanup',entries.map((entry)=>({path:entry.source.path,size:entry.source.size,deepCleanId:entry.source.id,run:async()=>{if(scanPathsOverlap(entry.source.path,this.getScanExclusions()))throw new Error('storage.excludedPath');const result=await entry.snapshot.clean();this.deepCleanService.forget(entry.source.id);return result}})),skipped,true)
    },true)
  }
  async scanPrivacy(range:PrivacyTimeRange):Promise<PrivacyItem[]>{
    return this.exclusive('privacy',async()=>{
      if(this.applicationRefresh)await this.applicationRefresh.catch(()=>undefined)
      const running=await this.privacyProcesses()
      const fixtureHome=process.env.DISKCOLLIE_TEST_RUN==='1'?process.env.DISKCOLLIE_TEST_PRIVACY_HOME:undefined
      return this.privacyService.scan({platform:process.platform,home:fixtureHome||home,excludedPaths:this.getScanExclusions(),env:fixtureHome?{...process.env,LOCALAPPDATA:path.join(fixtureHome,'AppData/Local'),APPDATA:path.join(fixtureHome,'AppData/Roaming'),XDG_CONFIG_HOME:path.join(fixtureHome,'.config'),XDG_DATA_HOME:path.join(fixtureHome,'.local/share'),XDG_CACHE_HOME:path.join(fixtureHome,'.cache')}:process.env,applications:fixtureHome?[]:[...this.applications.values()]},range,running)
    })
  }
  async cleanPrivacy(input:{ids:string[];skipRunning:boolean}):Promise<StorageActivity>{
    return this.exclusive('privacy',async()=>{
      const {entries,skipped}=await this.privacyService.prepare(input.ids,await this.privacyProcesses(),input.skipRunning)
      return this.activity('privacy',entries.map((entry)=>({path:entry.item.path,size:entry.item.size,privacyId:entry.item.id,run:async()=>{
        if(entry.resource.paths.some((target)=>scanPathsOverlap(target,this.getScanExclusions())))throw new Error('storage.excludedPath');const outcome=await entry.snapshot.clean();this.privacyService.forget(entry.item.id);return outcome
      }})),skipped)
    },true)
  }
  invalidateDirectoryPlan():void {this.directoryTrashPlan=null}
  async directoryPlan(input:{generation:number;id:number}):Promise<StorageDirectoryPlan>{
    return this.exclusive('analysis',async()=>{
      const epoch=this.scopeEpoch
      this.directoryTrashPlan=null
      const {index,engine}=this.session(input.generation)
      const entry=await engine.request<StorageEntry>('entry',{id:input.id})
      const options={excludedPaths:this.getScanExclusions()}
      if(index.mode!=='analysis'||!entry.directory||!index.root||!isStorageDirectoryCandidate(entry.path,index.root.path,options))throw new Error(translate(this.language(),'storage.directoryProtected'))
      const directory=await prepareStorageDirectoryTrash(entry.path,index.root.path,options)
      const plan:StorageDirectoryPlan={id:randomUUID(),generation:input.generation,entryId:entry.id,...directory.summary}
      if(epoch!==this.scopeEpoch)throw new Error('storage.scopeChanged')
      this.directoryTrashPlan={plan,snapshot:directory}
      return plan
    })
  }
  async trash(input: { generation: number; ids: number[]; kind: StorageMode; groupId?: string;directoryPlanId?:string }): Promise<StorageActivity> {
    return this.exclusive(input.kind,async () => {
      const session=this.session(input.generation)
      const {index,engine}=session
      if(index.mode!==input.kind)throw new Error('The selected files belong to another scan')
      const entries = await Promise.all(input.ids.map((id) => engine.request<StorageEntry>('entry', { id })))
      if(entries.some((entry)=>entry.directory)){
        if(input.kind!=='analysis'||entries.length!==1||!input.directoryPlanId)throw new Error(translate(this.language(),'storage.protectedPath',{path:entries.find((entry)=>entry.directory)!.path}))
        const reviewed=this.directoryTrashPlan,entry=entries[0]
        if(!reviewed||reviewed.plan.id!==input.directoryPlanId||reviewed.plan.generation!==input.generation||reviewed.plan.entryId!==entry.id||reviewed.plan.path!==entry.path)throw new Error(translate(this.language(),'storage.directoryPlanExpired'))
        const assertCurrentPolicy=():void=>{if(!index.root||!isStorageDirectoryCandidate(entry.path,index.root.path,{excludedPaths:this.getScanExclusions()}))throw new Error(translate(this.language(),'storage.directoryProtected'))}
        assertCurrentPolicy();await reviewed.snapshot.validate()
        const result=await this.activity('analysis',[{path:entry.path,size:reviewed.plan.allocated,run:()=>reviewed.snapshot.trash(async(target)=>{assertCurrentPolicy();await shell.trashItem(target)})}])
        this.directoryTrashPlan=null
        return result
      }
      if(input.directoryPlanId)throw new Error(translate(this.language(),'storage.directoryPlanExpired'))
      for (const entry of entries) if (!index.root || !isStorageMutationAllowed(entry.path, index.root.path) || isScanPathExcluded(entry.path,this.getScanExclusions()) || entry.directory) throw new Error(translate(this.language(),'storage.protectedPath',{path:entry.path}))
      if (input.kind === 'duplicates') {
        const batches=duplicateRemovalGroups([...session.groups.values()],new Set(input.ids),input.groupId)
        for(const {group,keep,files} of batches)for(const entry of [keep,...files]) {
          const fresh=await engine.request<{hash:string}>('hash',{id:entry.id})
          if(fresh.hash!==group.id)throw new Error('Duplicate contents changed. Scan again.')
        }
      }
      const snapshots = await Promise.all(entries.map((e) => snapshot(e.path)))
      const result = await this.activity(input.kind, entries.map((entry,i) => ({ path: entry.path, size: entry.allocated, run: async () => {
        if(isScanPathExcluded(entry.path,this.getScanExclusions()))throw new Error('storage.excludedPath');await unchanged(snapshots[i]); await shell.trashItem(entry.path)
      } })))
      return result
    },true)
  }
  async listApplications(refresh=false):Promise<StorageApplication[]> {
    if(!refresh&&this.applications.size)return this.applicationState().applications
    if(this.applicationRefresh)return this.applicationRefresh
    this.applicationsRefreshing=true;this.applicationsError=null;this.publishApplications()
    const epoch=++this.applicationSizeEpoch;this.applicationSizeEngine.stop()
    const work=this.exclusive('apps',async()=>{
      const seen=new Set<string>(this.applicationOperations.activeIds())
      if(process.platform==='darwin'){
        const locations=[...new Set((await Promise.all(this.applicationRoots.map((root)=>findApplications(root,2,true)))).flat())]
        for(let offset=0;offset<locations.length;offset+=8){
          await Promise.all(locations.slice(offset,offset+8).map(async(location)=>{
            try{
              const stat=await snapshot(location),info=await inspectApplication(location,this.language(),false,false)
              if(!info||info.bundleId==='com.fcl.diskcollie')return
              let infoModified=0;try{infoModified=(await lstat(path.join(location,'Contents/Info.plist'))).mtimeMs}catch{/* Metadata fallback remains usable. */}
              const id=this.applicationId(location,info.name),previous=this.applications.get(id),system=location.startsWith('/System/')
              if(this.applicationOperations.has(id)){seen.add(id);return}
              const fingerprint=[stat.dev,stat.ino,stat.modified,infoModified,info.version].join(':')
              const changed=Boolean(previous&&(previous.version!==info.version||previous.bundleId!==info.bundleId||this.applicationFingerprints.has(id)&&this.applicationFingerprints.get(id)!==fingerprint))
              if(changed){this.updates.delete(id);for(const [key,value] of this.related)if(value.applicationId===id)this.related.delete(key)}
              this.applicationFingerprints.set(id,fingerprint);this.metadata.set(id,info);seen.add(id)
              const measured=this.measuredApplicationFingerprints.get(id)===fingerprint
              this.applications.set(id,{...previous,...(changed?{updateAvailable:false,latestVersion:null,updateSource:undefined,updateMode:undefined,updateCheckedAt:null}:{}),id,name:info.name,version:info.version,bundleId:info.bundleId,location,size:measured?previous?.size||info.sizeBytes:info.sizeBytes,lastUsedAt:info.lastUsedAt?.toISOString()||null,system,protected:system||location===app.getPath('exe').split('.app/')[0]+'.app',method:'trash',cached:false})
            }catch{/* Unreadable or redirected bundles are excluded from live registration. */}
          }))
          this.publishApplications()
        }
      } else if (process.platform === 'win32') {
        const script = "$p=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName} | Select-Object DisplayName,DisplayVersion,InstallLocation,EstimatedSize,DisplayIcon,SystemComponent) | ConvertTo-Json -Compress"
        const { stdout } = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:15000,maxBuffer:8*1024*1024,windowsHide:true})
        const parsed=JSON.parse(stdout || '[]')
        for (const p of Array.isArray(parsed)?parsed:parsed?[parsed]:[]) { const id=this.applicationId(String(p.InstallLocation||''),String(p.DisplayName)); seen.add(id); this.applications.set(id,{id,name:String(p.DisplayName),version:String(p.DisplayVersion || ''),location:String(p.InstallLocation || ''),bundleId:null,size:Number(p.EstimatedSize || 0)*1024,protected:false,system:p.SystemComponent===1,iconPath:String(p.DisplayIcon||'').trim().replace(/,-?\d+$/,'').replace(/^"|"$/g,''),method:'system'}) }
      } else {
        for (const root of ['/usr/share/applications', path.join(home,'.local/share/applications')]) {
          let names: string[]=[]; try { names=await readdir(root) } catch { continue }
          for (const name of names.filter((v)=>v.endsWith('.desktop'))) {
            try {
              const location=path.join(root,name); const content=await readFile(location,'utf8');
              const display=/^Name=(.+)$/m.exec(content)?.[1]; if (!display || /^NoDisplay=true$/m.test(content)) continue
              const iconName=/^Icon=(.+)$/m.exec(content)?.[1]?.trim()
              let iconPath:string|undefined
              if(iconName){const candidates=path.isAbsolute(iconName)?[iconName]:[...['/usr/share/icons/hicolor',path.join(home,'.local/share/icons/hicolor')].flatMap((root)=>['512x512','256x256','128x128','64x64','48x48','scalable'].flatMap((size)=>['png','svg','xpm'].map((ext)=>path.join(root,size,'apps',`${iconName}.${ext}`)))),path.join('/usr/share/pixmaps',iconName+'.png'),path.join('/usr/share/pixmaps',iconName+'.svg')];for(const candidate of candidates)try{const resolved=await realpath(candidate);if((await lstat(resolved)).isFile()){iconPath=resolved;break}}catch{/* Try the next installed theme size. */}}
              const id=this.applicationId(location,display); seen.add(id); this.applications.set(id,{id,name:display,version:'',location,iconPath,bundleId:name.slice(0,-8),size:0,protected:false,method:'system'})
            } catch { /* Invalid desktop entries are skipped. */ }
          }
        }
      }

      for(const [id] of this.applications)if(!seen.has(id)){this.applications.delete(id);this.metadata.delete(id);this.updates.delete(id);this.applicationFingerprints.delete(id);this.measuredApplicationFingerprints.delete(id);for(const [key,value] of this.related)if(value.applicationId===id)this.related.delete(key)}
      this.applicationsUpdatedAt=new Date().toISOString()
      await this.persistApplications().catch(()=>undefined)
      return this.applicationState().applications
    })
    this.applicationRefresh=work
    try{const result=await work;if(!this.inventoryStopped)void this.measureApplicationSizes(epoch);return result}
    catch(error){this.applicationsError=error instanceof Error?error.message:String(error);throw error}
    finally{this.applicationRefresh=null;this.applicationsRefreshing=false;this.publishApplications()}
  }
  async checkApplicationUpdates():Promise<StorageApplication[]> {
    if([...this.applications.values()].some((application)=>application.cached)||!this.applications.size)await this.listApplications(true)
    return this.exclusive('apps',async()=>{
      const candidates=[...this.metadata].filter(([id])=>!this.applications.get(id)?.protected&&!this.applicationOperations.has(id))
      const expected=new Map(candidates.map(([id])=>{const application=this.applications.get(id)!;return [id,{version:application.version,location:application.location,fingerprint:this.applicationFingerprints.get(id)}]}))
      const found=process.platform==='darwin'?await discoverApplicationUpdates(candidates.map(([,metadata])=>metadata),this.language()):new Map<string,ApplicationUpdate>()
      for(const [id,before] of expected){
        const application=this.applications.get(id)
        if(!application||this.applicationOperations.has(id)||application.version!==before.version||application.location!==before.location||this.applicationFingerprints.get(id)!==before.fingerprint)continue
        const update=found.get(application.location)
        if(update)this.updates.set(id,update);else this.updates.delete(id)
        Object.assign(application,{updateAvailable:Boolean(update),latestVersion:update?.latestVersion||null,updateSource:update?.source,updateMode:update?.mode,updateCheckedAt:new Date().toISOString()})
      }
      this.publishApplications()
      return this.applicationState().applications
    })
  }
  async openApplication(id:string):Promise<void> {
    const application=await this.registeredApplication(id)
    if(process.platform==='linux'){await snapshot(application.location);await exec('/usr/bin/gio',['launch',application.location],{timeout:10_000});return}
    const target=process.platform==='win32'?application.iconPath:application.location
    if(!target||(process.platform==='win32'&&!target.toLowerCase().endsWith('.exe')))throw new Error('The application launch entry is unavailable. Open it from the system launcher.')
    await snapshot(target)
    const error=await shell.openPath(target);if(error)throw new Error(error)
  }
  async updateApplication(id:string) {
    return this.applicationOperations.run(id,'update',async()=>{
      const application=await this.registeredApplication(id)
      if(application.protected)throw new Error('This application is protected')
      if(process.platform!=='darwin'){
        await shell.openExternal(process.platform==='win32'?'ms-settings:appsfeatures':`appstream://${encodeURIComponent(application.bundleId||'')}`)
        return {status:'opened' as const,destination:'application' as const}
      }
      await snapshot(application.location)
      const update=this.updates.get(id)
      if(!update){await this.openApplication(id);return {status:'opened' as const,destination:'application' as const}}
      await this.requireBrowserClosed(application.location)
      const result=await updateRegisteredApplication(application.location,update)
      let current=this.applications.get(id)||application
      if(result.status==='updated') {
        const metadata=await inspectApplication(application.location,this.language(),false)
        current=this.applications.get(id)||current
        if(metadata){this.metadata.set(id,metadata);current={...current,version:metadata.version,size:metadata.sizeBytes||current.size,lastUsedAt:metadata.lastUsedAt?.toISOString()||null}}
        current={...current,updateAvailable:false,latestVersion:null};this.applications.set(id,current);this.updates.delete(id)
        for(const [key,value] of this.related)if(value.applicationId===id)this.related.delete(key)
        this.measuredApplicationFingerprints.delete(id)
        const stat=await snapshot(current.location);let infoModified=0
        try{infoModified=(await lstat(path.join(current.location,'Contents/Info.plist'))).mtimeMs}catch{/* Keep the same fallback as discovery. */}
        this.applicationFingerprints.set(id,[stat.dev,stat.ino,stat.modified,infoModified,current.version].join(':'))
        await this.persistApplications().catch(()=>undefined);this.publishApplications()
        if(this.applicationTimer){if(this.applicationDebounce)clearTimeout(this.applicationDebounce);this.applicationDebounce=setTimeout(()=>{void this.listApplications(true).catch(()=>undefined)},100)}
      }
      return {...result,application:current}
    })
  }
  async relatedChildren(input:{id:string;offset?:number}):Promise<{items:RelatedApplicationFile[];more:boolean}> {
    return this.exclusive('apps',async()=>{
      const parent=this.related.get(input.id)
      if(!parent||!parent.snapshot.directory)throw new Error('Folder selection expired')
      await unchanged(parent.snapshot)
      const names=(await readdir(parent.file.path)).sort(),offset=input.offset||0
      const valid:Array<{snapshot:Snapshot;path:string}>=[]
      for(const name of names.slice(offset,offset+100)){try{const target=path.join(parent.file.path,name);valid.push({snapshot:await snapshot(target),path:target})}catch{/* Links and inaccessible entries cannot authorize removal. */}}
      const measured=await this.engine.request<Array<{path:string;size:number;errors:number}>>('measure',{paths:valid.map((v)=>v.path)})
      const items=valid.flatMap((value)=>{
        const size=measured.find((m)=>m.path===value.path);if(!size||size.errors)return []
        const existing=[...this.related.values()].find((r)=>r.applicationId===parent.applicationId&&r.file.path===value.path)
        const file:RelatedApplicationFile={id:existing?.file.id||randomUUID(),path:value.path,size:size.size,kind:parent.file.kind,parentId:parent.file.id,directory:value.snapshot.directory}
        this.related.set(file.id,{file,snapshot:value.snapshot,applicationId:parent.applicationId});return [file]
      })
      return {items,more:offset+100<names.length}
    })
  }
  async inspectApplication(id: string): Promise<RelatedApplicationFile[]> {
    await this.registeredApplication(id)
    return this.exclusive('apps',async () => {
      const application=this.applications.get(id); if (!application) throw new Error('Application selection expired')
      for (const [key,v] of this.related) if (v.applicationId === id) this.related.delete(key)
      const targets: Array<{ path:string; kind:RelatedApplicationFile['kind'] }>=[{path:application.location,kind:'application'}]
      // Bundle identifier equality is evidence; names and substrings are deliberately insufficient.
      if (process.platform === 'darwin' && application.bundleId && /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(application.bundleId)) {
        const bundle=application.bundleId
        for (const [dir,suffix,kind] of [['Caches','','cache'],['Preferences','.plist','preferences'],['Application Support','','support'],['Logs','','logs'],['Saved Application State','.savedState','preferences']] as const) targets.push({path:path.join(home,'Library',dir,`${bundle}${suffix}`),kind})
        for (const dir of ['Containers','HTTPStorages','WebKit']) targets.push({path:path.join(home,'Library',dir,bundle),kind:'support'})
        const knownSupport:Record<string,string>={'com.microsoft.VSCode':'Code','com.microsoft.VSCodeInsiders':'Code - Insiders','com.figma.Desktop':'Figma','com.google.Chrome':'Google/Chrome','com.microsoft.edgemac':'Microsoft Edge','com.tinyspeck.slackmacgap':'Slack','com.hnc.Discord':'discord','com.spotify.client':'Spotify'}
        if (knownSupport[bundle]) targets.push({path:path.join(home,'Library/Application Support',knownSupport[bundle]),kind:'support'})
      }
      const valid: Array<{ path:string;kind:RelatedApplicationFile['kind'];snapshot:Snapshot }>=[]
      for (const target of targets) { if (!target.path) continue; try { valid.push({...target,snapshot:await snapshot(target.path)}) } catch { continue } }
      if(!valid.some((value)=>value.kind==='application'))throw new Error(translate(this.language(),'apps.filesUnavailable'))
      const data=valid.filter((value)=>value.kind!=='application')
      const timeout=setTimeout(()=>this.engine.stop('Application detail measurement timed out'),8000);timeout.unref()
      let measured:Array<{path:string;size:number;errors:number}>=[]
      try{if(data.length)measured=await this.engine.request('measure',{paths:data.map((value)=>value.path)})}catch{/* The application itself remains removable when related sizes cannot be read. */}finally{clearTimeout(timeout)}
      return valid.flatMap((v)=>{
        const size=measured.find((m)=>m.path===v.path)
        if(v.kind!=='application'&&(!size||size.errors))return []
        const file:RelatedApplicationFile={id:randomUUID(),path:v.path,kind:v.kind,size:v.kind==='application'?application.size:size!.size,directory:v.snapshot.directory}
        this.related.set(file.id,{file,snapshot:v.snapshot,applicationId:id}); return [file]
      })
    })
  }
  async uninstall(input: {applicationId:string;ids:string[]}): Promise<StorageActivity | null> {
    return this.applicationOperations.run(input.applicationId,'uninstall',async()=>{
    await this.registeredApplication(input.applicationId)
    return this.exclusive('apps',async () => {
      const application=this.applications.get(input.applicationId)
      if (!application || application.protected || application.system) throw new Error('This application is protected')
      if (application.method === 'system') {
        if (process.platform === 'win32') await shell.openExternal('ms-settings:appsfeatures')
        else await shell.openExternal(`appstream://${encodeURIComponent(application.bundleId || '')}`)
        return null
      }
      const requested=[...new Set(input.ids)].map((id)=>{const v=this.related.get(id); if (!v || v.applicationId!==application.id) throw new Error('Related file selection expired'); return v})
      const values=requested.filter((v)=>!requested.some((parent)=>parent!==v&&v.file.path.startsWith(parent.file.path+path.sep)))
      if (!values.some((v)=>v.file.kind==='application'&&v.file.path===application.location)) throw new Error('Select the application to uninstall')
      await this.requireBrowserClosed(application.location)
      for (const value of values) await unchanged(value.snapshot)
      const result=await this.activity('uninstall',values.map((v)=>({path:v.file.path,size:v.file.size,run:async()=>{await unchanged(v.snapshot); await shell.trashItem(v.file.path)}})))
      for(const [id,value] of this.related)if(result.locations.includes(value.file.path))this.related.delete(id)
      if(result.locations.includes(application.location)){this.applications.delete(application.id);this.metadata.delete(application.id);this.applicationFingerprints.delete(application.id);this.measuredApplicationFingerprints.delete(application.id);this.updates.delete(application.id);this.publishApplications();await this.persistApplications().catch(()=>undefined)}
      return result
    },true)
    })
  }
  async cleanupIcon(id:string):Promise<string|null> {
    const owner=this.rules.get(id)?.source||this.privacyService.source(id)||this.deepCleanService.owner(id)
    if(!owner)return null
    const installed=[...this.applications.values()].find((application)=>owner.bundleIds.some((bundle)=>application.bundleId?.toLowerCase()===bundle.toLowerCase())||application.name===owner.name)
    for(const target of [...(installed?[installed.iconPath||installed.location]:[]),...owner.iconPaths]){
      try{await lstat(target);const icon=await readApplicationIcon(target,installed?.version);if(icon)return icon}catch{/* Try the next installed location. */}
    }
    return null
  }
  register(): void {
    const handle=(name:string, fn:(input:any)=>unknown):void=>{ipcMain.handle(`diskcollie:storage:${name}`,async(_event,input)=>{try{return await fn(input)}catch(error){const message=error instanceof Error?error.message:String(error);if(message.startsWith('privacy.')||message.startsWith('deep.')||message.startsWith('storage.')||message==='apps.operationInProgress')throw new Error(translate(this.language(),message));if(/Item changed since scan|item changed since it was inspected|Path changed or became a link/.test(message))throw new Error(translate(this.language(),'storage.changed'));throw error}})}
    handle('state',()=>({index:this.latest?this.sessions.get(this.latest)?.index||null:null,indexes:Object.fromEntries([...this.sessions].map(([mode,s])=>[mode,s.index])),history:this.history,home}))
    handle('scan',(v)=>this.scan(z.object({mode:z.enum(['analysis','large','duplicates']).default('analysis'),minimum:z.number().int().min(10*1024**2).optional(),includeHidden:z.boolean().optional()}).parse(v||{})))
    handle('cancel',(v)=>{const scope=z.enum(['analysis','large','duplicates','cleanup','privacy','apps']).optional().parse(v)||this.queue.activeScopes[0];if(!scope)return false;this.queue.cancelPending(scope);if(scope==='cleanup'&&this.deepScanCancellation){this.deepScanCancellation.abort();return true}const engine=this.activeEngines.get(scope as StorageMode);if(!engine)return false;engine.stop();for(const [mode,session] of this.sessions)if(session.engine===engine)this.sessions.delete(mode);return true})
    handle('children',async(v)=>{const q=entryInput.extend({offset:int.optional()}).parse(v),session=this.session(q.generation);const result=await session.engine.request<{parent:StorageEntry;items:StorageEntry[]}>('children',q);const annotate=(entry:StorageEntry):StorageEntry=>({...entry,trashable:Boolean(session.index.root&&isStorageMutationAllowed(entry.path,session.index.root.path)&&(!entry.directory||session.index.mode==='analysis'&&isStorageDirectoryCandidate(entry.path,session.index.root.path,{excludedPaths:this.getScanExclusions()})))});return {...result,parent:annotate(result.parent),items:result.items.map(annotate)}})
    handle('large',(v)=>{const q=scope.extend({minimum:z.number().nonnegative(),search:z.string().max(500),offset:int,category:z.enum(['all','video','image','audio','archive','installer','document','other']).default('all')}).parse(v);return this.session(q.generation).engine.request('large',{...q,categories:fileCategories})})
    handle('duplicates',(v)=>this.exclusive('duplicates',async()=>{
      const q=typeof v==='number'?{generation:v,minimum:10*1024**2}:scope.extend({minimum:z.number().int().min(10*1024**2).default(10*1024**2)}).parse(v)
      const session=this.session(q.generation);this.activeEngines.set('duplicates',session.engine)
      try{
        const result=await session.engine.request<{groups:DuplicateGroup[];elapsedMs:number}>('duplicates',{minimum:q.minimum})
        result.groups=result.groups.map((group)=>{const files=group.files.filter((file)=>![...session.removed].some((location)=>file.path===location||file.path.startsWith(location+path.sep)));return {...group,files,reclaimable:files.slice(1).reduce((sum,file)=>sum+file.allocated,0)}}).filter((group)=>group.files.length>=2)
        session.groups=new Map(result.groups.map((group)=>[group.id,group]));return result
      }finally{this.activeEngines.delete('duplicates')}
    }))
    handle('directory-plan',(v)=>this.directoryPlan(entryInput.parse(v)))
    handle('trash',(v)=>this.trash(scope.extend({ids:z.array(int).min(1).max(500).transform((v)=>[...new Set(v)]),kind:z.enum(['analysis','large','duplicates']),groupId:z.string().max(100).optional(),directoryPlanId:z.string().uuid().optional()}).parse(v)))
    handle('reveal',async(v)=>{const q=entryInput.parse(v);const entry=await this.session(q.generation).engine.request<StorageEntry>('entry',q);shell.showItemInFolder(entry.path)})
    handle('reveal-target',async(v)=>{
      const q=z.discriminatedUnion('type',[
        entryInput.extend({type:z.literal('entry')}),
        z.object({type:z.literal('rule'),id:z.string().uuid(),path:z.string()}),
        z.object({type:z.literal('related'),id:z.string().uuid()}),
        z.object({type:z.literal('application'),id:z.string().uuid()})
      ]).parse(v)
      let location:string|undefined
      if(q.type==='entry')location=(await this.session(q.generation).engine.request<StorageEntry>('entry',q)).path
      else if(q.type==='rule'){const rule=this.rules.get(q.id);location=rule?.snapshots.find((s)=>s.path===q.path)?.path||this.privacyService.paths(q.id).find((target)=>target===q.path)}
      else if(q.type==='related')location=this.related.get(q.id)?.file.path
      else location=this.applications.get(q.id)?.location
      if(!location)throw new Error('The item is no longer available. Scan again.')
      shell.showItemInFolder(location)
    })
    handle('cleanup',(v)=>this.cleanup(z.boolean().parse(v)))
    handle('deep-scan',()=>this.scanDeep())
    handle('deep-preview',(v)=>{const q=z.object({id:z.string().uuid(),offset:int.max(200000).default(0)}).parse(v);return this.deepCleanService.preview(q.id,q.offset)})
    handle('deep-clean',(v)=>this.cleanDeep(z.object({ids:z.array(z.string().uuid()).min(1).max(500),skipRunning:z.boolean().default(false)}).parse(v)))
    handle('deep-icon',(v)=>this.cleanupIcon(z.string().uuid().parse(v)))
    handle('deep-reveal',async(v)=>{const q=z.object({id:z.string().uuid(),path:z.string().max(10000).optional()}).parse(v),entry=this.deepCleanService.get(q.id),target=q.path||entry.source.path;if(target!==entry.source.path&&!entry.snapshot.files.some((file)=>file.path===target))throw new Error('deep.selectionExpired');await snapshot(target);shell.showItemInFolder(target)})
    handle('privacy-scan',(v)=>this.scanPrivacy(z.enum(['hour','today','week','all']).parse(v)))
    handle('privacy-preview',(v)=>{const q=z.object({id:z.string().uuid(),offset:int.max(100000).default(0)}).parse(v);return this.privacyService.preview(q.id,q.offset)})
    handle('privacy-clean',(v)=>this.cleanPrivacy(z.object({ids:z.array(z.string().uuid()).min(1).max(500),skipRunning:z.boolean().default(false)}).parse(v)))
    handle('privacy-permissions',async()=>{if(process.platform==='darwin')await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');else if(process.platform==='win32')await shell.openExternal('ms-settings:privacy-broadfilesystemaccess');else throw new Error('privacy.permissionsManual')})
    handle('cleanup-icon',(value)=>this.cleanupIcon(z.string().uuid().parse(value)))
    handle('clean',(v)=>this.clean(z.array(z.string().uuid()).min(1).max(100).transform((ids)=>[...new Set(ids)]).parse(v)))
    handle('applications',(v)=>this.listApplications(z.boolean().optional().parse(v)||false))
    handle('application-state',()=>this.applicationState())
    handle('check-updates',()=>this.checkApplicationUpdates())
    handle('open-application',(v)=>this.openApplication(z.string().uuid().parse(v)))
    handle('update-application',(v)=>this.updateApplication(z.string().uuid().parse(v)))
    handle('related-children',(v)=>this.relatedChildren(z.object({id:z.string().uuid(),offset:int.optional()}).parse(v)))
    handle('application-icon',async(v)=>{
      const id=z.string().uuid().parse(v);const application=this.applications.get(id)
      if(!application||(!application.location&&!application.iconPath))return null
      return readApplicationIcon(application.iconPath||application.location,this.applicationFingerprints.get(id)||application.version)
    })
    handle('related',(v)=>this.inspectApplication(z.string().uuid().parse(v)))
    handle('uninstall',(v)=>this.uninstall(z.object({applicationId:z.string().uuid(),ids:z.array(z.string().uuid()).max(500)}).parse(v)))
    app.on('before-quit',()=>{this.ledger?.close();this.ledger=null;this.stopApplicationInventory();this.engine.stop();for(const engine of this.activeEngines.values())engine.stop();this.cleanupEngines.cleanup.stop();this.cleanupEngines.privacy.stop();this.systemEngine.stop();for(const session of this.sessions.values())session.engine.stop()})
  }
}
