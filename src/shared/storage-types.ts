import type { ApplicationUpdateMode, ApplicationUpdateResult, ApplicationUpdateSource } from './types'
import type { FileCategory } from './file-categories'
export interface StorageEntry {
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
export interface StorageProgress {
  phase: 'indexing' | 'sampling' | 'hashing' | 'cleaning'
  entries: number
  total?: number
  elapsedMs: number
  errors?: number
  skipped?: number
  path?: string
}
export interface DuplicateGroup { id: string; files: StorageEntry[]; reclaimable: number }
export interface CleanupItem {
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
  id: string
  date: string
  kind: 'large' | 'duplicates' | 'cleanup' | 'privacy' | 'uninstall'
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
export type StorageApplicationUpdateResult = ApplicationUpdateResult & { application?: StorageApplication }
export type StorageTarget =
  | { type:'entry'; generation:number; id:number }
  | { type:'rule'; id:string; path:string }
  | { type:'related'; id:string }
  | { type:'application'; id:string }
export interface StorageApi {
  storageState: () => Promise<{ index: StorageIndex | null; indexes: Partial<Record<StorageMode,StorageIndex>>; history: StorageActivity[]; home: string }>
  storageScan: (options?: StorageScanOptions) => Promise<StorageIndex | null>
  storageCancel: () => Promise<void>
  storageChildren: (input: { generation: number; id: number; offset?: number }) => Promise<{ parent: StorageEntry; items: StorageEntry[] }>
  storageLarge: (input: { generation: number; minimum: number; search: string; offset: number; category?: FileCategory | 'all' }) => Promise<{ count: number; items: StorageEntry[]; categories?: Record<string,number> }>
  storageDuplicates: (generation: number, minimum?:number) => Promise<{ groups: DuplicateGroup[]; elapsedMs: number }>
  storageTrash: (input: { generation: number; ids: number[]; kind: 'large' | 'duplicates'; groupId?: string }) => Promise<StorageActivity>
  storageReveal: (input: { generation: number; id: number }) => Promise<void>
  storageRevealTarget: (target:StorageTarget) => Promise<void>
  storageCleanup: (privacy: boolean) => Promise<CleanupItem[]>
  storageClean: (ids: string[]) => Promise<StorageActivity>
  storageApplications: () => Promise<StorageApplication[]>
  storageApplicationIcon: (id:string) => Promise<string|null>
  storageOpenApplication: (id:string) => Promise<void>
  storageCheckUpdates: () => Promise<StorageApplication[]>
  storageUpdateApplication: (id:string) => Promise<StorageApplicationUpdateResult>
  storageRelatedChildren: (input:{id:string;offset?:number}) => Promise<{items:RelatedApplicationFile[];more:boolean}>
  storageRelated: (id: string) => Promise<RelatedApplicationFile[]>
  storageUninstall: (input: { applicationId: string; ids: string[] }) => Promise<StorageActivity | null>
  onStorageProgress: (callback: (progress: StorageProgress) => void) => () => void
}
