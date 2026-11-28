import type {StorageDirectoryPlan} from './storage-directory-types'
import type {DeepCleanScan,DeepCleanPreview} from './deep-clean-types'
import type { ApplicationUpdateMode, ApplicationUpdateResult, ApplicationUpdateSource } from './types'
import type { FileCategory } from './file-categories'
import type {PrivacyItem,PrivacyPreview,PrivacyTimeRange} from './privacy-types'
export interface StorageEntry {
  /** Main-process policy metadata; never authorizes a mutation on its own. */
  trashable?:boolean
  applicationData?:boolean
  id: number
  parent: number | null
  name: string
  path: string
  directory: boolean
  size: number
  allocated: number
  modified: number
  identity: string
  links: number
}
export type StorageMode = 'analysis' | 'large' | 'duplicates'
export interface StorageScanOptions { mode?:StorageMode; minimum?:number; includeHidden?:boolean }
export interface StorageIndex {
  includeHidden?:boolean
  mode?: StorageMode
  retained?: number
  generation: number
  root: StorageEntry | null
  entries: number
  errors: number
  skipped: number
  limited: boolean
  elapsedMs: number
}
export type StorageTaskScope = StorageMode | 'cleanup' | 'privacy' | 'apps'
export interface StorageProgress {
  scope?: StorageTaskScope
  blockedBy?: StorageTaskScope

  phase: 'queued' | 'indexing' | 'sampling' | 'hashing' | 'cleaning'
  entries: number
  total?: number
  elapsedMs: number
  errors?: number
  skipped?: number
  path?: string
}
export interface DuplicateGroup { id: string; files: StorageEntry[]; reclaimable: number }
export type PrivacyCategory='browser-activity'|'browser-accounts'|'app-activity'|'system-activity'
export interface CleanupItem {
  privacyCategory?:PrivacyCategory
  source?:{key:string;name:string}
  profile?:string
  id: string
  nameKey: string
  path: string
  size: number
  category: 'cache' | 'developer' | 'logs' | 'privacy'
  paths?: string[]
  effectKey: string
  browser?: string
}
export interface StorageActivity {
  deepCleanIds?:string[]
  removedPaths?:string[]
  privacyIds?:string[]
  traces?:number
  skipped?:number
  unchanged?:number
  errors?:Array<{path:string;message:string}>
  id: string
  date: string
  kind: 'analysis' | 'large' | 'duplicates' | 'cleanup' | 'privacy' | 'uninstall'
  items: number
  bytes: number
  failures: number
  locations: string[]
}
export interface RelatedApplicationFile {
  id: string
  path: string
  size: number
  directory?: boolean
  parentId?: string
  kind: 'application' | 'cache' | 'preferences' | 'support' | 'logs'
}
export interface StorageApplication {
  id: string
  name: string
  version: string
  location: string
  bundleId: string | null
  size: number
  protected: boolean
  /** Restored presentation data; main revalidates before actions. */
  cached?: boolean
  method: 'trash' | 'system'
  system?: boolean
  lastUsedAt?: string | null
  updateAvailable?: boolean
  latestVersion?: string | null
  updateSource?: ApplicationUpdateSource
  updateMode?: ApplicationUpdateMode
  updateCheckedAt?: string | null
  iconPath?: string
}
export interface ApplicationInventoryState {applications:StorageApplication[];refreshing:boolean;measuringSizes:boolean;updatedAt:string|null;error:string|null}
export type StorageApplicationUpdateResult = ApplicationUpdateResult & { application?: StorageApplication }
export type StorageTarget =
  | { type:'entry'; generation:number; id:number }
  | { type:'rule'; id:string; path:string }
  | { type:'related'; id:string }
  | { type:'application'; id:string }
export interface StorageApi {
  storageState: () => Promise<{ index: StorageIndex | null; indexes: Partial<Record<StorageMode,StorageIndex>>; history: StorageActivity[]; home: string }>
  storageScan: (options?: StorageScanOptions) => Promise<StorageIndex | null>
  storageCancel: (scope?:StorageTaskScope) => Promise<boolean>
  storageChildren: (input: { generation: number; id: number; offset?: number }) => Promise<{ parent: StorageEntry; items: StorageEntry[] }>
  storageLarge: (input: { generation: number; minimum: number; search: string; offset: number; category?: FileCategory | 'all' }) => Promise<{ count: number; items: StorageEntry[]; categories?: Record<string,number> }>
  storageDuplicates: (generation: number, minimum?:number) => Promise<{ groups: DuplicateGroup[]; elapsedMs: number }>
  storageTrash: (input: { generation: number; ids: number[]; kind: StorageMode; groupId?: string;directoryPlanId?:string;acknowledgeApplicationData?:boolean }) => Promise<StorageActivity>
  storageDirectoryPlan:(input:{generation:number;id:number})=>Promise<StorageDirectoryPlan>
  onStorageScopeChanged:(callback:()=>void)=>()=>void
  storageReveal: (input: { generation: number; id: number }) => Promise<void>
  storageRevealTarget: (target:StorageTarget) => Promise<void>
  storageCleanup: (privacy: boolean) => Promise<CleanupItem[]>
  storageDeepScan:()=>Promise<DeepCleanScan>
  storageDeepPreview:(input:{id:string;offset?:number})=>Promise<DeepCleanPreview>
  storageDeepClean:(input:{ids:string[];skipRunning:boolean})=>Promise<StorageActivity>
  storageDeepReveal:(input:{id:string;path?:string})=>Promise<void>
  storageDeepIcon:(id:string)=>Promise<string|null>
  storagePrivacyScan:(range:PrivacyTimeRange)=>Promise<PrivacyItem[]>
  storagePrivacyPreview:(input:{id:string;offset?:number})=>Promise<PrivacyPreview>
  storagePrivacyClean:(input:{ids:string[];skipRunning:boolean})=>Promise<StorageActivity>
  storagePrivacyPermissions:()=>Promise<void>
  storageCleanupIcon: (id:string) => Promise<string|null>
  storageClean: (ids: string[]) => Promise<StorageActivity>
  storageApplications: (refresh?:boolean) => Promise<StorageApplication[]>
  storageApplicationState: () => Promise<ApplicationInventoryState>
  onStorageApplications: (callback:(state:ApplicationInventoryState)=>void) => () => void
  storageApplicationIcon: (id:string) => Promise<string|null>
  storageOpenApplication: (id:string) => Promise<void>
  storageCheckUpdates: () => Promise<StorageApplication[]>
  storageUpdateApplication: (id:string) => Promise<StorageApplicationUpdateResult>
  storageRelatedChildren: (input:{id:string;offset?:number}) => Promise<{items:RelatedApplicationFile[];more:boolean}>
  storageRelated: (id: string) => Promise<RelatedApplicationFile[]>
  storageUninstall: (input: { applicationId: string; ids: string[] }) => Promise<StorageActivity | null>
  onStorageProgress: (callback: (progress: StorageProgress) => void) => () => void
}
