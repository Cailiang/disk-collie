export type StartupState='enabled'|'disabled'|'unknown'
export type StartupKind='agent'|'daemon'|'login'|'background'|'embedded'|'registry'|'folder'|'task'|'service'|'package'|'advanced'|'desktop'|'systemd'
export type StartupTiming='login'|'boot'|'background'|'scheduled'|'event'|'unknown'
export type StartupAccess='user'|'administrator'|'settings'|'protected'|'readonly'
export interface StartupItem {
  id:string;name:string;owner:string;ownerId:string;publisher:string;description:string
  kind:StartupKind;scope:'user'|'machine'|'system';state:StartupState;running:boolean|null
  timing:StartupTiming[];configuration:string;target:string;orphan:boolean;issue:string|null
  access:StartupAccess;canToggle:boolean;canRemove:boolean;icon:string|null
}
export interface StartupGroup {id:string;name:string;publisher:string;items:StartupItem[];state:StartupState|'mixed';system:boolean}
export interface StartupCoverage {source:StartupKind;status:'complete'|'partial'|'unavailable';message:string;count:number}
export interface StartupCatalog {id:string;scannedAt:string;items:StartupItem[];coverage:StartupCoverage[];elapsedMs:number}
export type StartupAction='enable'|'disable'|'remove'
export interface StartupChange {catalogId:string;ids:string[];action:StartupAction}
export interface StartupOutcome {id:string;name:string;ok:boolean;changed:boolean;message:string}
export interface StartupChangeResult {results:StartupOutcome[];catalog:StartupCatalog}
export interface StartupApi {
  startupScan:()=>Promise<StartupCatalog>
  startupChange:(input:StartupChange)=>Promise<StartupChangeResult>
  startupReveal:(id:string)=>Promise<void>
  startupIcon:(id:string)=>Promise<string|null>
  startupSettings:(section:'startup'|'privacy'|'automation'|'services'|'tasks')=>Promise<void>
}
