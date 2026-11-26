export type DeepCleanGroup='system'|'user-cache'|'browser'|'application'|'development'|'project'|'xcode'|'ai'|'container'|'application-optimization'|'custom'
export type DeepCleanRisk='safe'|'review'|'protected'
export type DeepCleanStatus='ready'|'empty'|'permission-required'|'requires-close'|'review-only'|'limited'|'unavailable'
export interface DeepCleanCopy {zh:string;en:string}
export interface DeepCleanSource {
  cleanupMethod?:'delete'|'trash'|'none'
  id:string
  path:string
  name:string
  size:number
  count:number
  modified:number|null
  status:DeepCleanStatus
}
export interface DeepCleanItem {
  id:string
  key:string
  name:DeepCleanCopy
  description:DeepCleanCopy
  group:DeepCleanGroup
  risk:DeepCleanRisk
  recommended:boolean
  size:number
  count:number
  status:DeepCleanStatus
  sources:DeepCleanSource[]
  runningApps:string[]
  owner?:{key:string;name:string;bundleIds:string[];iconPaths:string[]}
}
export interface DeepCleanScan {
  items:DeepCleanItem[]
  elapsedMs:number
  scannedAt:string
  errors:number
  limited:boolean
}
export interface DeepCleanFile {id:string;name:string;path:string;size:number;modified:number}
export interface DeepCleanPreview {id:string;files:DeepCleanFile[];total:number;offset:number;nextOffset:number|null}
