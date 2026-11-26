import type {CleanupItem,PrivacyCategory} from './storage-types'
export type PrivacyTimeRange='hour'|'today'|'week'|'all'
export type PrivacyKind='history'|'search'|'downloads'|'sessions'|'cache'|'favicons'|'top-sites'|'shortcuts'|'cookies'|'site-data'|'site-permissions'|'passwords'|'autofill'|'app-cache'|'app-logs'|'app-sessions'|'app-edit-history'|'app-recent'|'clipboard'|'recent-apps'|'recent-documents'|'recent-servers'|'shell-history'|'network-history'
export type PrivacyRisk='low'|'recent'|'account'|'sensitive'
export type PrivacyCapability='ready'|'empty'|'permission-required'|'unavailable'|'range-unsupported'
export interface PrivacyItem extends CleanupItem {
  privacyCategory:PrivacyCategory
  kind:PrivacyKind
  count:number|null
  risk:PrivacyRisk
  capability:PrivacyCapability
  recommended:boolean
  range:PrivacyTimeRange
  browserRunning?:boolean
  limited?:boolean
}
export interface PrivacyRecord {id:string;title:string;subtitle?:string;url?:string;timestamp?:string;count?:number;path?:string}
export interface PrivacyPreview {id:string;kind:PrivacyKind;records:PrivacyRecord[];total:number;offset:number;nextOffset:number|null;limited?:boolean}
