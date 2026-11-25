import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { CleanupItem, DuplicateGroup, RelatedApplicationFile, StorageActivity, StorageApplication, StorageEntry, StorageIndex } from '../shared/storage-types'
import { fileCategories } from '../shared/file-categories'
import type { StorageScanOptions } from '../shared/storage-types'
import { NativeEngine } from './native-engine'
import { storageRules } from './storage-rules'
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
  private engine = new NativeEngine((progress) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('memento:storage:progress', progress) })
  private index: StorageIndex | null = null
  private history: StorageActivity[] = []
  private rules = new Map<string, { item: CleanupItem; snapshots: Snapshot[]; browser?: string }>()
  private applications = new Map<string, StorageApplication>()
  private related = new Map<string, { file: RelatedApplicationFile; snapshot: Snapshot; applicationId: string }>()
  private duplicateGroups = new Map<string, DuplicateGroup>()
  private busy = false
  private generation = 0
  private historyPath = path.join(app.getPath('userData'), 'storage-history.json')
  async init(): Promise<void> {
    try {
      const data: unknown = JSON.parse(await readFile(this.historyPath, 'utf8'))
      const parsed = z.array(z.object({ id:z.string(), date:z.string(), kind:z.enum(['large','duplicates','cleanup','privacy','uninstall']), items:z.number().nonnegative(), bytes:z.number().nonnegative(), failures:z.number().nonnegative(), locations:z.array(z.string()) })).safeParse(data)
      if (parsed.success) this.history = parsed.data.slice(0, 500)
    } catch { /* First launch has no ledger. */ }
  }
  private async save(): Promise<void> {
    await mkdir(path.dirname(this.historyPath), { recursive: true })
    await writeFile(`${this.historyPath}.tmp`, JSON.stringify(this.history.slice(0, 500)), { mode: 0o600 })
    await rename(`${this.historyPath}.tmp`, this.historyPath)
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Another storage task is running')
    this.busy = true
    try { return await work() } finally { this.busy = false }
  }
  private requireIndex(generation: number): StorageIndex {
    if (!this.index || this.index.generation !== generation) throw new Error('The scan has changed. Refresh this view.')
    return this.index
  }
  private async activity(kind: StorageActivity['kind'], jobs: Array<{ path: string; size: number; run: () => Promise<void> }>): Promise<StorageActivity> {
    const record: StorageActivity = { id: randomUUID(), date: new Date().toISOString(), kind, items: 0, bytes: 0, failures: 0, locations: [] }
    this.history.unshift(record); await this.save()
    for (const job of jobs) {
      try { await job.run(); record.items++; record.bytes += job.size; record.locations.push(job.path) }
      catch { record.failures++ }
      await this.save()
    }
    return record
  }
  async scan(options: StorageScanOptions): Promise<StorageIndex | null> {
    return this.exclusive(async () => {
      let root = process.env.MEMENTO_TEST_RUN === '1' && process.env.MEMENTO_TEST_STORAGE_ROOT ? process.env.MEMENTO_TEST_STORAGE_ROOT : home
      if (options.mode === 'analysis' && process.env.MEMENTO_TEST_RUN !== '1') root = path.parse(home).root
      if (options.choose) {
        const selected = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: home })
        if (selected.canceled || !selected.filePaths[0]) return null
        root = selected.filePaths[0]
      }
      this.index = null; this.duplicateGroups.clear()
      this.index = await this.engine.request<StorageIndex>('scan', { root, ...options, excludePaths: (options.mode==='duplicates'||options.mode==='large')&&!options.choose&&!options.includeHidden ? [path.join(home,'Library'),path.join(home,'AppData')] : [] })
      this.index.generation = ++this.generation // cancellation may restart the sidecar; never reuse IPC generations
      return this.index
    })
  }
  async cleanup(privacy: boolean): Promise<CleanupItem[]> {
    return this.exclusive(async () => {
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
    return this.exclusive(async () => {
      const values = ids.map((id) => { const v=this.rules.get(id); if (!v) throw new Error('Cleanup selection expired. Scan again.'); return v })
      if (new Set(values.map((v) => v.item.category === 'privacy')).size !== 1) throw new Error('Review privacy and caches separately')
      // Preflight the whole selection before making any changes.
      for (const value of values) { for(const s of value.snapshots)await unchanged(s); await this.requireBrowserClosed(value.browser) }
      const result = await this.activity(values[0].item.category === 'privacy' ? 'privacy' : 'cleanup', values.map((value) => ({ path: value.item.path, size: value.item.size, run: async () => {
        for(const s of value.snapshots)await unchanged(s)
        // Never follow links: rm unlinks nested symlinks rather than traversing them.
        for(const s of value.snapshots)await rm(s.path, { recursive: true, force: false }); this.rules.delete(value.item.id)
      } })))
      this.index = null; this.duplicateGroups.clear()
      return result
    })
  }
  async trash(input: { generation: number; ids: number[]; kind: 'large' | 'duplicates'; groupId?: string }): Promise<StorageActivity> {
    return this.exclusive(async () => {
      const index = this.requireIndex(input.generation)
      const entries = await Promise.all(input.ids.map((id) => this.engine.request<StorageEntry>('entry', { id })))
      for (const entry of entries) if (!index.root || !isStorageMutationAllowed(entry.path, index.root.path) || entry.directory) throw new Error('This location is protected. Only personal files can be moved here.')
      if (input.kind === 'duplicates') {
        const group = input.groupId ? this.duplicateGroups.get(input.groupId) : undefined
        if (!group || entries.some((e) => !group.files.some((f) => f.id === e.id))) throw new Error('Unknown duplicate selection')
        const keep = group.files.find((e) => !input.ids.includes(e.id))
        if (!keep) throw new Error('Keep at least one copy')
        for (const entry of [keep, ...entries]) {
          const fresh = await this.engine.request<{ hash: string }>('hash', { id: entry.id })
          if (fresh.hash !== group.id) throw new Error('Duplicate contents changed. Scan again.')
        }
      }
      const snapshots = await Promise.all(entries.map((e) => snapshot(e.path)))
      const result = await this.activity(input.kind, entries.map((entry,i) => ({ path: entry.path, size: entry.allocated, run: async () => {
        await unchanged(snapshots[i]); await shell.trashItem(entry.path)
      } })))
      this.index = null; this.duplicateGroups.clear()
      return result
    })
  }
  async listApplications(): Promise<StorageApplication[]> {
    return this.exclusive(async () => {
      this.applications.clear(); this.related.clear()
      if (process.platform === 'darwin') {
        for (const root of ['/Applications', path.join(home, 'Applications'), '/System/Applications']) {
          let names: string[] = []; try { names = await readdir(root) } catch { continue }
          for (const name of names.filter((v) => v.endsWith('.app'))) {
            const location = path.join(root, name)
            try {
              await snapshot(location)
              const { stdout } = await exec('/usr/bin/plutil', ['-convert','json','-o','-',path.join(location,'Contents/Info.plist')], { timeout: 3000 })
              const p = JSON.parse(stdout)
              const id=randomUUID()
              this.applications.set(id, { id, name: String(p.CFBundleDisplayName || p.CFBundleName || name.slice(0,-4)), version: String(p.CFBundleShortVersionString || p.CFBundleVersion || ''), bundleId: typeof p.CFBundleIdentifier === 'string' ? p.CFBundleIdentifier : null, location, size:0, protected:root.startsWith('/System') || location === app.getPath('exe').split('.app/')[0]+'.app', method:'trash' })
            } catch { /* Unreadable bundles are not authorized for removal. */ }
          }
        }
      } else if (process.platform === 'win32') {
        const script = "$p=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName} | Select-Object DisplayName,DisplayVersion,InstallLocation,EstimatedSize) | ConvertTo-Json -Compress"
        const { stdout } = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:15000,maxBuffer:8*1024*1024,windowsHide:true})
        const parsed=JSON.parse(stdout || '[]')
        for (const p of Array.isArray(parsed)?parsed:parsed?[parsed]:[]) { const id=randomUUID(); this.applications.set(id,{id,name:String(p.DisplayName),version:String(p.DisplayVersion || ''),location:String(p.InstallLocation || ''),bundleId:null,size:Number(p.EstimatedSize || 0)*1024,protected:false,method:'system'}) }
      } else {
        for (const root of ['/usr/share/applications', path.join(home,'.local/share/applications')]) {
          let names: string[]=[]; try { names=await readdir(root) } catch { continue }
          for (const name of names.filter((v)=>v.endsWith('.desktop'))) {
            try {
              const location=path.join(root,name); const content=await readFile(location,'utf8');
              const display=/^Name=(.+)$/m.exec(content)?.[1]; if (!display || /^NoDisplay=true$/m.test(content)) continue
              const id=randomUUID(); this.applications.set(id,{id,name:display,version:'',location,bundleId:name.slice(0,-8),size:0,protected:false,method:'system'})
            } catch { /* Invalid desktop entries are skipped. */ }
          }
        }
      }
      return [...this.applications.values()].sort((a,b)=>a.name.localeCompare(b.name))
    })
  }
  async inspectApplication(id: string): Promise<RelatedApplicationFile[]> {
    return this.exclusive(async () => {
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
        const file:RelatedApplicationFile={id:randomUUID(),path:v.path,kind:v.kind,size:size.size}
        this.related.set(file.id,{file,snapshot:v.snapshot,applicationId:id}); return [file]
      })
    })
  }
  async uninstall(input: {applicationId:string;ids:string[]}): Promise<StorageActivity | null> {
    return this.exclusive(async () => {
      const application=this.applications.get(input.applicationId)
      if (!application || application.protected) throw new Error('This application is protected')
      if (application.method === 'system') {
        if (process.platform === 'win32') await shell.openExternal('ms-settings:appsfeatures')
        else await shell.openExternal(`appstream://${encodeURIComponent(application.bundleId || '')}`)
        return null
      }
      const values=input.ids.map((id)=>{const v=this.related.get(id); if (!v || v.applicationId!==application.id) throw new Error('Related file selection expired'); return v})
      if (!values.some((v)=>v.file.kind==='application')) throw new Error('Select the application to uninstall')
      await this.requireBrowserClosed(application.location)
      for (const value of values) await unchanged(value.snapshot)
      const result=await this.activity('uninstall',values.map((v)=>({path:v.file.path,size:v.file.size,run:async()=>{await unchanged(v.snapshot); await shell.trashItem(v.file.path)}})))
      this.related.clear(); this.applications.delete(application.id); this.index=null
      return result
    })
  }
  register(): void {
    const handle=(name:string, fn:(input:any)=>unknown):void=>{ipcMain.handle(`memento:storage:${name}`,(_event,input)=>fn(input))}
    handle('state',()=>({index:this.index,history:this.history,home}))
    handle('scan',(v)=>this.scan(typeof v==='boolean'?{choose:v,mode:'analysis'}:z.object({choose:z.boolean().optional(),mode:z.enum(['analysis','large','duplicates']).default('analysis'),minimum:z.number().int().min(1024).optional(),includeHidden:z.boolean().optional()}).parse(v||{})))
    handle('cancel',()=>{ if (this.busy) {this.engine.stop(); this.index=null; this.duplicateGroups.clear()} })
    handle('children',(v)=>{const q=entryInput.extend({offset:int.optional()}).parse(v);this.requireIndex(q.generation);return this.engine.request('children',q)})
    handle('large',(v)=>{const q=scope.extend({minimum:z.number().nonnegative(),search:z.string().max(500),offset:int,category:z.enum(['all','video','image','audio','archive','installer','document','other']).default('all')}).parse(v);this.requireIndex(q.generation);return this.engine.request('large',{...q,categories:fileCategories})})
    handle('duplicates',(v)=>this.exclusive(async()=>{const q=typeof v==='number'?{generation:v,minimum:1024}:scope.extend({minimum:z.number().int().min(1024).default(200*1024)}).parse(v);this.requireIndex(q.generation);const result=await this.engine.request<{groups:DuplicateGroup[];elapsedMs:number}>('duplicates',{minimum:q.minimum});this.duplicateGroups=new Map(result.groups.map((g)=>[g.id,g]));return result}))
    handle('trash',(v)=>this.trash(scope.extend({ids:z.array(int).min(1).max(500).transform((v)=>[...new Set(v)]),kind:z.enum(['large','duplicates']),groupId:z.string().max(100).optional()}).parse(v)))
    handle('reveal',async(v)=>{const q=entryInput.parse(v);this.requireIndex(q.generation);const entry=await this.engine.request<StorageEntry>('entry',q);shell.showItemInFolder(entry.path)})
    handle('cleanup',(v)=>this.cleanup(z.boolean().parse(v)))
    handle('clean',(v)=>this.clean(z.array(z.string().uuid()).min(1).max(100).transform((ids)=>[...new Set(ids)]).parse(v)))
    handle('applications',()=>this.listApplications())
    handle('application-icon',async(v)=>{
      const id=z.string().uuid().parse(v);const application=this.applications.get(id)
      if(!application||!application.location)return null
      try {const icon=await app.getFileIcon(application.location,{size:'normal'});return icon.isEmpty()?null:icon.toDataURL()}catch{return null}
    })
    handle('related',(v)=>this.inspectApplication(z.string().uuid().parse(v)))
    handle('uninstall',(v)=>this.uninstall(z.object({applicationId:z.string().uuid(),ids:z.array(z.string().uuid()).max(100)}).parse(v)))
    app.on('before-quit',()=>this.engine.stop())
  }
}
