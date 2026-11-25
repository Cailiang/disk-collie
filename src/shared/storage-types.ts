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
export interface StorageIndex {
  generation: number
  root: StorageEntry | null
  entries: number
  errors: number
  skipped: number
  limited: boolean
  elapsedMs: number
}
export interface StorageProgress {
  phase: 'indexing' | 'sampling' | 'hashing'
  entries: number
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
}
export interface StorageApi {
  storageState: () => Promise<{ index: StorageIndex | null; history: StorageActivity[]; home: string }>
  storageScan: (choose?: boolean) => Promise<StorageIndex | null>
  storageCancel: () => Promise<void>
  storageChildren: (input: { generation: number; id: number; offset?: number }) => Promise<{ parent: StorageEntry; items: StorageEntry[] }>
  storageLarge: (input: { generation: number; minimum: number; search: string; offset: number }) => Promise<{ count: number; items: StorageEntry[] }>
  storageDuplicates: (generation: number) => Promise<{ groups: DuplicateGroup[]; elapsedMs: number }>
  storageTrash: (input: { generation: number; ids: number[]; kind: 'large' | 'duplicates'; groupId?: string }) => Promise<StorageActivity>
  storageReveal: (input: { generation: number; id: number }) => Promise<void>
  storageCleanup: (privacy: boolean) => Promise<CleanupItem[]>
  storageClean: (ids: string[]) => Promise<StorageActivity>
  storageApplications: () => Promise<StorageApplication[]>
  storageApplicationIcon: (id:string) => Promise<string|null>
  storageRelated: (id: string) => Promise<RelatedApplicationFile[]>
  storageUninstall: (input: { applicationId: string; ids: string[] }) => Promise<StorageActivity | null>
  onStorageProgress: (callback: (progress: StorageProgress) => void) => () => void
}
