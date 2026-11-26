import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
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
  constructor(private readonly language:()=>AppLanguage=()=> 'zh-CN') {}
  private metadata=new Map<string,ApplicationMetadata>()
  private updates=new Map<string,ApplicationUpdate>()
  private engine = new NativeEngine((progress) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('memento:storage:progress', progress) })
  private sessions = new Map<StorageMode,{index:StorageIndex;engine:NativeEngine;groups:Map<string,DuplicateGroup>}>()
  private latest: StorageMode | null = null
  private activeEngine: NativeEngine | null = null
  private queue=new StorageTaskQueue((scope,queued,blockedBy)=>this.progress({scope,phase:queued?'queued':'indexing',blockedBy:blockedBy||undefined,entries:0,elapsedMs:0}))
  private progress(progress: import('../shared/storage-types').StorageProgress):void {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('memento:storage:progress',{...progress,scope:progress.scope||this.queue.activeScope||undefined})
  }
  private history: StorageActivity[] = []
  private rules = new Map<string, { item: CleanupItem; snapshots: Snapshot[]; browser?: string }>()
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
  private publishApplications():void {for(const window of BrowserWindow.getAllWindows())window.webContents.send('memento:storage:applications-changed',this.applicationState())}
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
  private historyPath = path.join(app.getPath('userData'), 'storage-history.json')
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
    try {
      const data: unknown = JSON.parse(await readFile(this.historyPath, 'utf8'))
      const parsed = z.array(z.object({ id:z.string(), date:z.string(), kind:z.enum(['large','duplicates','cleanup','privacy','uninstall']), items:z.number().nonnegative(), bytes:z.number().nonnegative(), failures:z.number().nonnegative(), locations:z.array(z.string()) })).safeParse(data)
      if (parsed.success) this.history = parsed.data
    } catch { /* First launch has no ledger. */ }
  }
  private async save(): Promise<void> {
    await mkdir(path.dirname(this.historyPath), { recursive: true })
    await writeFile(`${this.historyPath}.tmp`, JSON.stringify(this.history), { mode: 0o600 })
    await rename(`${this.historyPath}.tmp`, this.historyPath)
  }
  private exclusive<T>(scope:import('../shared/storage-types').StorageTaskScope,work:()=>Promise<T>):Promise<T> {return this.queue.run(scope,work)}
  private session(generation:number) {
    const session=[...this.sessions.values()].find((s)=>s.index.generation===generation)
    if(!session)throw new Error('The scan has changed. Refresh this view.')
    return session
  }
  private async reconcile(locations:string[]):Promise<void> {
    if(!locations.length)return
    for(const session of this.sessions.values()) {
      const summary=await session.engine.request<StorageIndex>('forget',{paths:locations})
      session.index={...session.index,...summary,generation:session.index.generation}
      for(const [id,group] of session.groups) {
        group.files=group.files.filter((file)=>!locations.some((p)=>file.path===p||file.path.startsWith(p+path.sep)))
        group.reclaimable=group.files.slice(1).reduce((s,f)=>s+f.allocated,0)
        if(group.files.length<2)session.groups.delete(id)
      }
    }
  }
  private async activity(kind: StorageActivity['kind'], jobs: Array<{ path: string; size: number; run: () => Promise<void> }>): Promise<StorageActivity> {
    const record: StorageActivity = { id: randomUUID(), date: new Date().toISOString(), kind, items: 0, bytes: 0, failures: 0, locations: [] }
    this.history.unshift(record); await this.save()
    const started=Date.now()
    for (const job of jobs) {
      this.progress({phase:'cleaning',entries:record.items+record.failures,total:jobs.length,elapsedMs:Date.now()-started,path:job.path})
      try { await job.run(); record.items++; record.bytes += job.size; record.locations.push(job.path) }
      catch { record.failures++ }
      await this.save()
      this.progress({phase:'cleaning',entries:record.items+record.failures,total:jobs.length,elapsedMs:Date.now()-started,path:job.path})
    }
    await this.reconcile(record.locations)
    return record
  }
  async scan(options: StorageScanOptions): Promise<StorageIndex | null> {
    return this.exclusive(options.mode||'analysis',async () => {
      const root = process.env.MEMENTO_TEST_RUN === '1' && process.env.MEMENTO_TEST_STORAGE_ROOT ? process.env.MEMENTO_TEST_STORAGE_ROOT : path.parse(home).root
      const mode=options.mode||'analysis'
      const scanScope=storageScanScope(home,options.includeHidden??false)
      const engine=new NativeEngine((p)=>this.progress({...p,scope:mode}))
      this.activeEngine=engine
      try {
        const index=await engine.request<StorageIndex>('scan',{root,...options,mode,...scanScope})
        index.generation=++this.generation;index.includeHidden=scanScope.includeHidden
        this.sessions.get(mode)?.engine.stop()
        this.sessions.set(mode,{index,engine,groups:new Map()});this.latest=mode
        return index
      } catch(e) {engine.stop();throw e} finally {this.activeEngine=null}
    })
  }
  async cleanup(privacy: boolean,refresh=true): Promise<CleanupItem[]> {
    const retained=[...this.rules.values()].filter((value)=>(value.item.category==='privacy')===privacy).map((value)=>value.item)
    if(!refresh&&retained.length)return retained
    return this.exclusive(privacy?'privacy':'cleanup',async () => {
      // Invalidate only this kind so an unrelated scan cannot authorize stale IDs.
      for (const [id, value] of this.rules) if ((value.item.category === 'privacy') === privacy) this.rules.delete(id)
      const available: Array<{ rule: ReturnType<typeof storageRules>[number]; snapshots: Snapshot[]; path:string }> = []
      for (const rule of storageRules(process.platform, home).filter((r) => (r.category === 'privacy') === privacy)) {
        const target = path.resolve(home, rule.relative)
        const snapshots:Snapshot[]=[]
        for(const item of rule.category==='privacy'&&rule.effect==='history'?[target,`${target}-wal`,`${target}-shm`,`${target}-journal`]:[target]) {
          try { snapshots.push(await snapshot(item)) } catch { /* Absent or redirected targets are inapplicable. */ }
        }
        if(snapshots.length)available.push({rule,snapshots,path:target})
      }
      const measured = await this.engine.request<Array<{ path: string; size: number; errors: number }>>('measure', { paths: available.flatMap((v) => v.snapshots.map((s)=>s.path)) })
      const result: CleanupItem[] = []
      for (const value of available) {
        const measurements=value.snapshots.map((s)=>measured.find((v)=>v.path===s.path))
        if(measurements.some((m)=>!m||m.errors))continue
        const size=measurements.reduce((sum,m)=>sum+(m?.size||0),0);if(!size)continue
        const item: CleanupItem = { id: randomUUID(), nameKey: value.rule.key, path: value.path, paths:value.snapshots.map((s)=>s.path), size, category: value.rule.category, effectKey: value.rule.effect, browser: value.rule.browser }
        this.rules.set(item.id, { item, snapshots: value.snapshots, browser: value.rule.browser }); result.push(item)
      }
      return result.sort((a,b) => b.size-a.size)
    })
  }
  private async requireBrowserClosed(browser?: string): Promise<void> {
    if (!browser) return
    const result = await this.engine.request<{ processes: Array<{ name: string; command: string }>; processNames: string[]; processCommands:string[] }>('system')
    if (result.processCommands.some((p)=>p.toLowerCase().includes(browser.toLowerCase())) || result.processNames.some((p) => p.toLowerCase().includes(browser.toLowerCase())) || result.processes.some((p) => `${p.name} ${p.command}`.toLowerCase().includes(browser.toLowerCase()))) throw new Error(`Close ${browser} before cleaning its data.`)
  }
  async clean(ids: string[]): Promise<StorageActivity> {
    return this.exclusive(this.rules.get(ids[0])?.item.category==='privacy'?'privacy':'cleanup',async () => {
      const values = ids.map((id) => { const v=this.rules.get(id); if (!v) throw new Error('Cleanup selection expired. Scan again.'); return v })
      if (new Set(values.map((v) => v.item.category === 'privacy')).size !== 1) throw new Error('Review privacy and caches separately')
      // Preflight the whole selection before making any changes.
      for (const value of values) { for(const s of value.snapshots)await unchanged(s); await this.requireBrowserClosed(value.browser) }
      const result = await this.activity(values[0].item.category === 'privacy' ? 'privacy' : 'cleanup', values.map((value) => ({ path: value.item.path, size: value.item.size, run: async () => {
        for(const s of value.snapshots)await unchanged(s)
        // Never follow links: rm unlinks nested symlinks rather than traversing them.
        for(const s of value.snapshots)await rm(s.path, { recursive: true, force: false }); this.rules.delete(value.item.id)
      } })))
      return result
    })
  }
  async trash(input: { generation: number; ids: number[]; kind: 'large' | 'duplicates'; groupId?: string }): Promise<StorageActivity> {
    return this.exclusive(input.kind,async () => {
      const session=this.session(input.generation)
      const {index,engine}=session
      const entries = await Promise.all(input.ids.map((id) => engine.request<StorageEntry>('entry', { id })))
      for (const entry of entries) if (!index.root || !isStorageMutationAllowed(entry.path, index.root.path) || entry.directory) throw new Error('This location is protected. Only personal files can be moved here.')
      if (input.kind === 'duplicates') {
        const batches=duplicateRemovalGroups([...session.groups.values()],new Set(input.ids),input.groupId)
        for(const {group,keep,files} of batches)for(const entry of [keep,...files]) {
          const fresh=await engine.request<{hash:string}>('hash',{id:entry.id})
          if(fresh.hash!==group.id)throw new Error('Duplicate contents changed. Scan again.')
        }
      }
      const snapshots = await Promise.all(entries.map((e) => snapshot(e.path)))
      const result = await this.activity(input.kind, entries.map((entry,i) => ({ path: entry.path, size: entry.allocated, run: async () => {
        await unchanged(snapshots[i]); await shell.trashItem(entry.path)
      } })))
      return result
    })
  }
  async listApplications(refresh=false):Promise<StorageApplication[]> {
    if(!refresh&&this.applications.size)return this.applicationState().applications
    if(this.applicationRefresh)return this.applicationRefresh
    this.applicationsRefreshing=true;this.applicationsError=null;this.publishApplications()
    const epoch=++this.applicationSizeEpoch;this.applicationSizeEngine.stop()
    const work=this.exclusive('apps',async()=>{
      const seen=new Set<string>()
      if(process.platform==='darwin'){
        const locations=[...new Set((await Promise.all(this.applicationRoots.map((root)=>findApplications(root,2,true)))).flat())]
        for(let offset=0;offset<locations.length;offset+=8){
          await Promise.all(locations.slice(offset,offset+8).map(async(location)=>{
            try{
              const stat=await snapshot(location),info=await inspectApplication(location,this.language(),false,false)
              if(!info||info.bundleId==='com.fcl.memento')return
              let infoModified=0;try{infoModified=(await lstat(path.join(location,'Contents/Info.plist'))).mtimeMs}catch{/* Metadata fallback remains usable. */}
              const id=this.applicationId(location,info.name),previous=this.applications.get(id),system=location.startsWith('/System/')
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
      const candidates=[...this.metadata].filter(([id])=>!this.applications.get(id)?.protected)
      const found=process.platform==='darwin'?await discoverApplicationUpdates(candidates.map(([,metadata])=>metadata),this.language()):new Map<string,ApplicationUpdate>()
      this.updates.clear()
      for(const [id,application] of this.applications){
        const update=found.get(application.location)
        if(update)this.updates.set(id,update)
        Object.assign(application,{updateAvailable:Boolean(update),latestVersion:update?.latestVersion||null,updateSource:update?.source,updateMode:update?.mode,updateCheckedAt:new Date().toISOString()})
      }
      this.publishApplications()
      return [...this.applications.values()]
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
    await this.registeredApplication(id)
    return this.exclusive('apps',async()=>{
      const application=this.applications.get(id)
      if(!application||application.protected)throw new Error('This application is protected')
      if(process.platform!=='darwin'){
        await shell.openExternal(process.platform==='win32'?'ms-settings:appsfeatures':`appstream://${encodeURIComponent(application.bundleId||'')}`)
        return {status:'opened' as const,destination:'application' as const}
      }
      await snapshot(application.location)
      const update=this.updates.get(id)
      if(!update){await this.openApplication(id);return {status:'opened' as const,destination:'application' as const}}
      await this.requireBrowserClosed(application.location)
      const result=await updateRegisteredApplication(application.location,update)
      if(result.status==='updated') {
        const metadata=await inspectApplication(application.location,this.language(),false)
        if(metadata){this.metadata.set(id,metadata);application.version=metadata.version;application.size=metadata.sizeBytes||application.size;application.lastUsedAt=metadata.lastUsedAt?.toISOString()||null}
        application.updateAvailable=false;application.latestVersion=null;this.updates.delete(id)
        for(const [key,value] of this.related)if(value.applicationId===id)this.related.delete(key)
      }
      if(result.status==='updated'){this.measuredApplicationFingerprints.delete(id);void this.persistApplications().catch(()=>undefined);this.publishApplications();if(this.applicationTimer)this.applicationDebounce=setTimeout(()=>{void this.listApplications(true).catch(()=>undefined)},100)}
      return {...result,application}
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
      const measured=await this.engine.request<Array<{path:string;size:number;errors:number}>>('measure',{paths:valid.map((v)=>v.path)})
      return valid.flatMap((v)=>{
        const size=measured.find((m)=>m.path===v.path); if (!size || size.errors) return []
        const file:RelatedApplicationFile={id:randomUUID(),path:v.path,kind:v.kind,size:size.size,directory:v.snapshot.directory}
        this.related.set(file.id,{file,snapshot:v.snapshot,applicationId:id}); return [file]
      })
    })
  }
  async uninstall(input: {applicationId:string;ids:string[]}): Promise<StorageActivity | null> {
    await this.registeredApplication(input.applicationId)
    return this.exclusive('apps',async () => {
      const application=this.applications.get(input.applicationId)
      if (!application || application.protected) throw new Error('This application is protected')
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
    })
  }
  register(): void {
    const handle=(name:string, fn:(input:any)=>unknown):void=>{ipcMain.handle(`memento:storage:${name}`,(_event,input)=>fn(input))}
    handle('state',()=>({index:this.latest?this.sessions.get(this.latest)?.index||null:null,indexes:Object.fromEntries([...this.sessions].map(([mode,s])=>[mode,s.index])),history:this.history,home}))
    handle('scan',(v)=>this.scan(z.object({mode:z.enum(['analysis','large','duplicates']).default('analysis'),minimum:z.number().int().min(10*1024**2).optional(),includeHidden:z.boolean().optional()}).parse(v||{})))
    handle('cancel',(v)=>{const scope=z.enum(['analysis','large','duplicates','cleanup','privacy','apps']).optional().parse(v)||this.queue.activeScope;if(!scope)return false;this.queue.cancelPending(scope);if(this.queue.activeScope!==scope||!this.activeEngine)return false;this.activeEngine.stop();for(const [mode,s] of this.sessions)if(s.engine===this.activeEngine)this.sessions.delete(mode);return true})
    handle('children',(v)=>{const q=entryInput.extend({offset:int.optional()}).parse(v);return this.session(q.generation).engine.request('children',q)})
    handle('large',(v)=>{const q=scope.extend({minimum:z.number().nonnegative(),search:z.string().max(500),offset:int,category:z.enum(['all','video','image','audio','archive','installer','document','other']).default('all')}).parse(v);return this.session(q.generation).engine.request('large',{...q,categories:fileCategories})})
    handle('duplicates',(v)=>this.exclusive('duplicates',async()=>{const q=typeof v==='number'?{generation:v,minimum:10*1024**2}:scope.extend({minimum:z.number().int().min(10*1024**2).default(10*1024**2)}).parse(v);const session=this.session(q.generation);this.activeEngine=session.engine;try{const result=await session.engine.request<{groups:DuplicateGroup[];elapsedMs:number}>('duplicates',{minimum:q.minimum});session.groups=new Map(result.groups.map((g)=>[g.id,g]));return result}finally{this.activeEngine=null}}))
    handle('trash',(v)=>this.trash(scope.extend({ids:z.array(int).min(1).max(500).transform((v)=>[...new Set(v)]),kind:z.enum(['large','duplicates']),groupId:z.string().max(100).optional()}).parse(v)))
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
      else if(q.type==='rule'){const rule=this.rules.get(q.id);location=rule?.snapshots.find((s)=>s.path===q.path)?.path}
      else if(q.type==='related')location=this.related.get(q.id)?.file.path
      else location=this.applications.get(q.id)?.location
      if(!location)throw new Error('The item is no longer available. Scan again.')
      shell.showItemInFolder(location)
    })
    handle('cleanup',(v)=>this.cleanup(z.boolean().parse(v)))
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
      try {if(process.platform==='linux'&&application.iconPath&&/\.(png|svg)$/i.test(application.iconPath)){const data=await readFile(application.iconPath);if(data.length<=2*1024*1024)return `data:image/${application.iconPath.endsWith('.svg')?'svg+xml':'png'};base64,${data.toString('base64')}`}const icon=await app.getFileIcon(application.iconPath||application.location,{size:'normal'});return icon.isEmpty()?null:icon.toDataURL()}catch{return null}
    })
    handle('related',(v)=>this.inspectApplication(z.string().uuid().parse(v)))
    handle('uninstall',(v)=>this.uninstall(z.object({applicationId:z.string().uuid(),ids:z.array(z.string().uuid()).max(500)}).parse(v)))
    app.on('before-quit',()=>{this.stopApplicationInventory();this.engine.stop();this.activeEngine?.stop();for(const session of this.sessions.values())session.engine.stop()})
  }
}
