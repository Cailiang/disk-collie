import { contextBridge, ipcRenderer } from 'electron'
import type { AgentRunEvent } from '../shared/agent-types'
import type { AppUpdateState, DiskUsageProgress, DiskCollieApi, ScanProgress } from '../shared/types'

const bootTheme = process.argv
  .find((argument) => argument.startsWith('--diskcollie-theme='))
  ?.slice('--diskcollie-theme='.length)
const allowedBootThemes = new Set([
  'porcelain',
  'graphite',
  'tiffany',
  'klein',
  'burgundy',
  'mars',
  'prussian',
  'midnight'
])
if (bootTheme && allowedBootThemes.has(bootTheme)) {
  const applyBootTheme = (): void => {
    if (document.documentElement) document.documentElement.dataset.theme = bootTheme
  }
  if (document.documentElement) applyBootTheme()
  else window.addEventListener('DOMContentLoaded', applyBootTheme, { once: true })
}

const api: DiskCollieApi = {
  storageState: () => ipcRenderer.invoke('diskcollie:storage:state'),
  storageScan: (options) => ipcRenderer.invoke('diskcollie:storage:scan', options),
  storageCancel: (scope) => ipcRenderer.invoke('diskcollie:storage:cancel',scope),
  storageChildren: (input) => ipcRenderer.invoke('diskcollie:storage:children', input),
  storageLarge: (input) => ipcRenderer.invoke('diskcollie:storage:large', input),
  storageDuplicates: (generation, minimum) => ipcRenderer.invoke('diskcollie:storage:duplicates', {generation,minimum}),
  storageTrash: (input) => ipcRenderer.invoke('diskcollie:storage:trash', input),
  storageDirectoryPlan:(input)=>ipcRenderer.invoke('diskcollie:storage:directory-plan',input),
  onStorageScopeChanged:(callback)=>{const listener=():void=>callback();ipcRenderer.on('diskcollie:storage:scope-changed',listener);return()=>ipcRenderer.removeListener('diskcollie:storage:scope-changed',listener)},
  storageReveal: (input) => ipcRenderer.invoke('diskcollie:storage:reveal', input),
  storageRevealTarget: (input) => ipcRenderer.invoke('diskcollie:storage:reveal-target', input),
  storageCleanup: (privacy) => ipcRenderer.invoke('diskcollie:storage:cleanup', privacy),
  storageDeepScan:()=>ipcRenderer.invoke('diskcollie:storage:deep-scan'),
  storageDeepPreview:(input)=>ipcRenderer.invoke('diskcollie:storage:deep-preview',input),
  storageDeepClean:(input)=>ipcRenderer.invoke('diskcollie:storage:deep-clean',input),
  storageDeepReveal:(input)=>ipcRenderer.invoke('diskcollie:storage:deep-reveal',input),
  storageDeepIcon:(id)=>ipcRenderer.invoke('diskcollie:storage:deep-icon',id),
  storagePrivacyScan: (range) => ipcRenderer.invoke('diskcollie:storage:privacy-scan',range),
  storagePrivacyPreview: (input) => ipcRenderer.invoke('diskcollie:storage:privacy-preview',input),
  storagePrivacyClean: (input) => ipcRenderer.invoke('diskcollie:storage:privacy-clean',input),
  storagePrivacyPermissions: () => ipcRenderer.invoke('diskcollie:storage:privacy-permissions'),
  storageCleanupIcon: (id) => ipcRenderer.invoke('diskcollie:storage:cleanup-icon',id),
  storageClean: (ids) => ipcRenderer.invoke('diskcollie:storage:clean', ids),
  storageApplications: (refresh) => ipcRenderer.invoke('diskcollie:storage:applications',refresh),
  storageApplicationState: () => ipcRenderer.invoke('diskcollie:storage:application-state'),
  onStorageApplications: (callback) => {const listener=(_event:Electron.IpcRendererEvent,state:import('../shared/storage-types').ApplicationInventoryState):void=>callback(state);ipcRenderer.on('diskcollie:storage:applications-changed',listener);return ()=>ipcRenderer.removeListener('diskcollie:storage:applications-changed',listener)},
  storageApplicationIcon: (id) => ipcRenderer.invoke('diskcollie:storage:application-icon', id),
  storageOpenApplication: (id) => ipcRenderer.invoke('diskcollie:storage:open-application', id),
  storageCheckUpdates: () => ipcRenderer.invoke('diskcollie:storage:check-updates'),
  storageUpdateApplication: (id) => ipcRenderer.invoke('diskcollie:storage:update-application', id),
  storageRelatedChildren: (input) => ipcRenderer.invoke('diskcollie:storage:related-children', input),
  storageRelated: (id) => ipcRenderer.invoke('diskcollie:storage:related', id),
  storageUninstall: (input) => ipcRenderer.invoke('diskcollie:storage:uninstall', input),
  onStorageProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../shared/storage-types').StorageProgress): void => callback(progress)
    ipcRenderer.on('diskcollie:storage:progress', listener)
    return () => ipcRenderer.removeListener('diskcollie:storage:progress', listener)
  },
  getVersion: () => ipcRenderer.invoke('diskcollie:get-version'),
  getUpdateState: () => ipcRenderer.invoke('diskcollie:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('diskcollie:update:check'),
  installUpdate: () => ipcRenderer.invoke('diskcollie:update:install'),
  getOverviewMetrics: () => ipcRenderer.invoke('diskcollie:overview:get'),
  copyOverviewProcessName: (name) => ipcRenderer.invoke('diskcollie:overview:process-copy-name', name),
  copyOverviewProcessPid: (pid) => ipcRenderer.invoke('diskcollie:overview:process-copy-pid', pid),
  terminateOverviewProcess: (input) => ipcRenderer.invoke('diskcollie:overview:process-terminate', input),
  addScanExcludedDirectory:()=>ipcRenderer.invoke('diskcollie:settings:exclude-directory-add'),
  removeScanExcludedDirectory:(directory)=>ipcRenderer.invoke('diskcollie:settings:exclude-directory-remove',directory),
  getAppSettings: () => ipcRenderer.invoke('diskcollie:settings:get'),
  updateAppSettings: (input) => ipcRenderer.invoke('diskcollie:settings:update', input),
  scan: (language) => ipcRenderer.invoke('diskcollie:scan', language),
  scanDiskUsage: () => ipcRenderer.invoke('diskcollie:disk-usage:scan'),
  cancelDiskUsageScan: () => ipcRenderer.invoke('diskcollie:disk-usage:cancel'),
  revealDiskUsageNode: (id) => ipcRenderer.invoke('diskcollie:disk-usage:reveal', id),
  trashDiskUsageNode: (id) => ipcRenderer.invoke('diskcollie:disk-usage:trash', id),
  onDiskUsageNodeRemoved: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('diskcollie:disk-usage-node-removed', listener)
    return () => ipcRenderer.removeListener('diskcollie:disk-usage-node-removed', listener)
  },
  getApplicationIcon: (id) => ipcRenderer.invoke('diskcollie:get-application-icon', id),
  getProcessIcon: (command) => ipcRenderer.invoke('diskcollie:get-process-icon', command),
  openApplication: (id) => ipcRenderer.invoke('diskcollie:open-application', id),
  updateApplication: (id) => ipcRenderer.invoke('diskcollie:update-application', id),
  openSystemSettings: (section) => ipcRenderer.invoke('diskcollie:open-system-settings', section),
  openActivityMonitorNetwork: () => ipcRenderer.invoke('diskcollie:open-activity-monitor-network'),
  revealTerminalFinding: (id) => ipcRenderer.invoke('diskcollie:reveal-terminal-finding', id),
  runActions: (ids) => ipcRenderer.invoke('diskcollie:run-actions', ids),
  runTerminalFixes: (ids) => ipcRenderer.invoke('diskcollie:run-terminal-fixes', ids),
  undoTerminalFixes: () => ipcRenderer.invoke('diskcollie:undo-terminal-fixes'),
  listMaintenanceRuns: () => ipcRenderer.invoke('diskcollie:maintenance:runs:list'),
  deleteMaintenanceRuns: (runIds) => ipcRenderer.invoke('diskcollie:maintenance:runs:delete-many', runIds),
  revealMaintenanceRecovery: (operationRecordId) => ipcRenderer.invoke('diskcollie:maintenance:recovery:reveal', operationRecordId),
  revealCandidateLocation: (id) => ipcRenderer.invoke('diskcollie:reveal-candidate-location', id),
  listAgentProviders: () => ipcRenderer.invoke('diskcollie:agent:providers:list'),
  discoverAgentProviderModels: (input) => ipcRenderer.invoke('diskcollie:agent:providers:models', input),
  saveAgentProvider: (input) => ipcRenderer.invoke('diskcollie:agent:providers:save', input),
  deleteAgentProvider: (id) => ipcRenderer.invoke('diskcollie:agent:providers:delete', id),
  setDefaultAgentProvider: (id) => ipcRenderer.invoke('diskcollie:agent:providers:set-default', id),
  testAgentProvider: (input) => ipcRenderer.invoke('diskcollie:agent:providers:test', input),
  importLocalAiConfigurations: () => ipcRenderer.invoke('diskcollie:agent:providers:import-local'),
  importCcSwitchProviders: () => ipcRenderer.invoke('diskcollie:agent:providers:import-cc-switch'),
  startAgentRun: (input) => ipcRenderer.invoke('diskcollie:agent:runs:start', input),
  cancelAgentRun: (runId) => ipcRenderer.invoke('diskcollie:agent:runs:cancel', runId),
  addAgentPlanItems: (input) => ipcRenderer.invoke('diskcollie:agent:plans:add', input),
  executeAgentPlan: (input) => ipcRenderer.invoke('diskcollie:agent:plans:execute', input),
  listAgentRuns: () => ipcRenderer.invoke('diskcollie:agent:runs:list'),
  getAgentRun: (runId) => ipcRenderer.invoke('diskcollie:agent:runs:get', runId),
  deleteAgentRun: (runId) => ipcRenderer.invoke('diskcollie:agent:runs:delete', runId),
  deleteAgentRuns: (runIds) => ipcRenderer.invoke('diskcollie:agent:runs:delete-many', runIds),
  onAgentProvidersChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('diskcollie:agent-providers-changed', listener)
    return () => ipcRenderer.removeListener('diskcollie:agent-providers-changed', listener)
  },
  onAgentRunEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, runEvent: AgentRunEvent): void => {
      callback(runEvent)
    }
    ipcRenderer.on('diskcollie:agent-run-event', listener)
    return () => ipcRenderer.removeListener('diskcollie:agent-run-event', listener)
  },
  onScanProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('diskcollie:scan-progress', listener)
    return () => ipcRenderer.removeListener('diskcollie:scan-progress', listener)
  },
  onDiskUsageProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DiskUsageProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('diskcollie:disk-usage-progress', listener)
    return () => ipcRenderer.removeListener('diskcollie:disk-usage-progress', listener)
  },
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState): void => {
      callback(state)
    }
    ipcRenderer.on('diskcollie:update-state', listener)
    return () => ipcRenderer.removeListener('diskcollie:update-state', listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('diskCollie', api)
