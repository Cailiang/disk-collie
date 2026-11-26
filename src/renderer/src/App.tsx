import { ProcessWorkspace } from './ProcessWorkspace'
import { StorageWorkspace, type StorageView } from './StorageWorkspace'
import { AiTaskProvider, type AiTask, type AiTaskOrigin } from './AiTasks'
import { GlobalTooltips } from './GlobalTooltips'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentPresentation,
  AgentProcessContext,
  AgentProcessResultItem,
  AgentProviderModelsResult,
  AgentPlanItem,
  AgentProvider,
  AgentProviderTestResult,
  AgentRunEvent,
  AgentRunRecord,
  CcSwitchImportResult,
  DiscoverAgentModelsInput,
  LocalAiImportResult,
  SaveAgentProviderInput
} from '../../shared/agent-types'
import type { MaintenanceRunRecord } from '../../shared/maintenance-types'
import {
  candidateWhitelistValue,
  applicationWhitelistValue,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type UpdateAppSettingsInput
} from '../../shared/app-settings'
import type {
  AppUpdateState,
  CandidateOperation,
  DiskUsageNode,
  DiskUsageProgress,
  DiskUsageScanResult,
  InstalledApplication,
  OverviewMetrics,
  OverviewProcess,
  ScanCandidate,
  ScanProgress,
  ScanResult,
  TerminalFinding
} from '../../shared/types'
import { AgentPage } from './agent-ui/AgentPage'
import { ApplicationsPage, type ApplicationFilter } from './agent-ui/ApplicationsPage'
import { DiskAnalysisPage } from './agent-ui/DiskAnalysisPage'
import {
  ApplicationIgnoreConfirmDialog,
  DeleteMaintenanceHistoryDialog,
  DeleteHistoryDialog,
  DiskUsageTrashDialog,
  DirectActionConfirmDialog,
  type DirectActionRequest,
  type ExecutionPhase,
  ExecutionProgressDialog,
  IgnoreConfirmDialog,
  IgnoredItemsDialog,
  UninstallDialog
} from './agent-ui/Dialogs'
import { HealthPage, type CleanupCategoryFilter, type CleanupSelection, type HealthAgentOrigin, type HealthTab, type PageRestoreTarget, type StorageMode } from './agent-ui/HealthPage'
import { HistoryPage } from './agent-ui/HistoryPage'
import { OverviewPage } from './agent-ui/OverviewPage'
import { SettingsPage } from './agent-ui/SettingsPage'
import { type AgentViewKey, Shell } from './agent-ui/Shell'
import {
  localizedDemoDiskUsageResult,
  localizedDemoMaintenanceRuns,
  localizedDemoOverviewMetrics,
  localizedDemoResult
} from './demo'
import { withoutDiskUsageNode } from './disk-usage-tree'
import { I18nProvider, useI18n } from './i18n'
import {
  appendWorkspaceConversation,
  latestWorkspaceConversationRuns
} from './agent-workspace'
import { applyCompletedCandidateActions } from './candidate-actions'
import { isActionableFinding, isReviewClue, isSafeCleanup } from '../../shared/finding-trust'
import { formatBytes } from './agent-ui/utils'

const DEMO_PROVIDER: AgentProvider = {
  id: 'demo-provider',
  name: 'DeepSeek',
  type: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  isDefault: true,
  connectionState: 'connected',
  keyPresent: true,
  keyHint: '••••demo',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

function demoUpdateState(currentVersion: string): AppUpdateState | null {
  if (!import.meta.env.DEV) return null
  const phase = new URLSearchParams(window.location.search).get('demoUpdate')
  if (phase !== 'downloading' && phase !== 'downloaded') return null
  return {
    currentVersion,
    latestVersion: '0.6.56',
    updateAvailable: true,
    phase,
    downloadPercent: phase === 'downloaded' ? 100 : 42,
    checkedAt: new Date().toISOString(),
    error: null
  }
}

function demoOperationCopy(
  kind: string,
  language: AppSettings['language'],
  fallbackLabel: string,
  fallbackConsequence: string
): { label: string; consequence: string } {
  if (kind === 'terminate-process') {
    return language === 'en-US'
      ? { label: 'Quit process', consequence: 'Send SIGTERM and allow the process to clean up and exit.' }
      : { label: '退出进程', consequence: '发送 SIGTERM，让进程自行清理后退出。' }
  }
  if (kind === 'terminate-process-force') {
    return language === 'en-US'
      ? { label: 'Force quit process', consequence: 'Send SIGKILL; unsaved data may be lost.' }
      : { label: '强制退出进程', consequence: '发送 SIGKILL，未保存的数据可能丢失。' }
  }
  if (language !== 'en-US') return { label: fallbackLabel, consequence: fallbackConsequence }
  if (kind.startsWith('stop-')) {
    return { label: 'Stop service', consequence: 'Stop the registered background service.' }
  }
  if (kind === 'trash' || kind === 'trash-home-artifact' || kind === 'trash-project-artifact') {
    return { label: 'Move to Trash', consequence: 'Move the registered item to the Trash.' }
  }
  if (kind === 'brew-cleanup') {
    return { label: 'Clean old versions', consequence: 'Remove old versions registered by Homebrew.' }
  }
  return { label: 'Clean permanently', consequence: 'Remove the registered rebuildable content.' }
}

function demoProcessResult(process: AgentProcessContext, language: AppSettings['language']): AgentProcessResultItem {
  const operations = process.isSystem ? [] : (['terminate-process', 'terminate-process-force'] as const).map((kind) => {
    const copy = demoOperationCopy(kind, language, '', '')
    return {
      id: `overview-process-${process.pid}-${kind === 'terminate-process-force' ? 'force' : 'quit'}`,
      label: copy.label,
      consequence: copy.consequence,
      reversible: false,
      estimatedBytes: 0
    }
  })
  return {
    kind: 'processes',
    id: `overview-process-${process.pid}`,
    ...process,
    operations
  }
}

function demoPlan(
  scan: ScanResult,
  language: AppSettings['language'] = 'zh-CN',
  process?: AgentProcessContext
): AgentPlanItem[] {
  if (process && !process.isSystem) {
    return demoProcessResult(process, language).operations.map((operation) => ({
      id: operation.id,
      kind: 'action',
      actionKind: operation.id.endsWith('-force') ? 'terminate-process-force' : 'terminate-process',
      title: operation.label,
      detail: `${process.name} · ${operation.consequence}`,
      estimatedBytes: 0,
      risk: 'review',
      reversible: false
    }))
  }
  const items: AgentPlanItem[] = []
  for (const candidate of scan.candidates) {
    const operation = candidate.operations?.[0] ?? (candidate.action ? { id: candidate.id, ...candidate.action } : null)
    if (!operation || items.length >= 3) continue
    const copy = demoOperationCopy(
      operation.kind,
      language,
      operation.label,
      operation.consequence
    )
    items.push({
      id: operation.id,
      kind: 'action',
      actionKind: operation.kind,
      title: copy.label,
      detail: `${candidate.name} · ${copy.consequence}`,
      estimatedBytes: operation.estimatedBytes ?? candidate.sizeBytes ?? 0,
      risk: candidate.risk === 'safe' && operation.reversible ? 'safe' : 'review',
      reversible: operation.reversible
    })
  }
  return items
}

function demoPresentation(
  scan: ScanResult,
  prompt: string,
  language: AppSettings['language'],
  process?: AgentProcessContext
): AgentPresentation {
  if (process) {
    const item = demoProcessResult(process, language)
    return {
      summary: language === 'en-US'
        ? `I found the focused process ${process.name} (PID ${process.pid}). Its registered quit actions are shown below.`
        : `已定位到进程 ${process.name}（PID ${process.pid}），下面展示可执行的退出操作。`,
      sections: [{
        kind: 'processes',
        title: language === 'en-US' ? 'Process' : '进程',
        items: [item]
      }]
    }
  }
  const applicationTask = /应用|app|残留|unused/i.test(prompt)
  const normalizedPrompt = prompt.toLocaleLowerCase()
  const directlyNamedCandidate = scan.candidates.find((item) => (
    normalizedPrompt.includes(item.name.toLocaleLowerCase())
  ))
  const serviceTask = directlyNamedCandidate
    ? directlyNamedCandidate.section === 'services'
    : /服务|service|启动项|process/i.test(prompt)
  if (applicationTask) {
    const directApplication = scan.applications.find((item) => (
      normalizedPrompt.includes(item.name.toLocaleLowerCase()) ||
      Boolean(item.bundleId && normalizedPrompt.includes(item.bundleId.toLocaleLowerCase()))
    ))
    const applications = (directApplication
      ? [directApplication]
      : scan.applications.filter((item) => item.unused).slice(0, 6)).map((item) => ({
      kind: 'applications' as const,
      id: item.id,
      name: item.name,
      version: item.version,
      bundleId: item.bundleId,
      location: item.location,
      scope: item.scope,
      protectedReason: item.protectedReason,
      backgroundOnly: item.backgroundOnly,
      executable: item.executable,
      urlSchemes: item.urlSchemes,
      sizeBytes: item.sizeBytes,
      lastUsedAt: item.lastUsedAt,
      unused: item.unused,
      operation: item.action ? {
        id: item.action.id,
        label: language === 'en-US' ? 'Uninstall' : item.action.label,
        consequence: language === 'en-US'
          ? 'Move the application bundle to the Trash after confirmation.'
          : item.action.consequence,
        reversible: item.action.reversible,
        estimatedBytes: item.action.estimatedBytes ?? item.sizeBytes
      } : null
    }))
    return {
      summary: language === 'en-US'
        ? directApplication
          ? `I found the exact application ${directApplication.name}. Its verified local metadata and available actions are shown below.`
          : 'I found applications that have not been used for three months. You can open one to review it or add its uninstall action to the confirmation plan.'
        : directApplication
          ? `已定位到 ${directApplication.name}，下面展示它经过核对的本机信息和可用操作。`
          : '我找到了超过 3 个月未使用的应用。你可以先打开核对，或把卸载操作加入右侧确认计划。',
      sections: [{
        kind: 'applications',
        title: directApplication
          ? language === 'en-US' ? 'Application analysis' : '应用分析'
          : language === 'en-US' ? 'Unused applications' : '长期未使用的应用',
        items: applications
      }]
    }
  }
  const matchingCandidate = directlyNamedCandidate?.section === (serviceTask ? 'services' : 'storage')
    ? directlyNamedCandidate
    : undefined
  const candidates = (matchingCandidate
    ? [matchingCandidate]
    : scan.candidates.filter((item) => item.section === (serviceTask ? 'services' : 'storage')).slice(0, 8))
    .map((item) => ({
      kind: item.section as 'services' | 'storage',
      id: item.id,
      name: item.name,
      subtitle: item.subtitle,
      description: item.description,
      status: item.status,
      risk: item.risk,
      confidence: item.confidence,
      reasonCodes: item.reasonCodes,
      estimateQuality: item.estimateQuality,
      sizeBytes: item.sizeBytes ?? 0,
      location: item.location ?? null,
      evidence: item.evidence,
      operations: (item.operations ?? (item.action ? [{ id: item.id, ...item.action }] : [])).map((operation) => ({
        ...demoOperationCopy(
          operation.kind,
          language,
          operation.label,
          operation.consequence
        ),
        id: operation.id,
        reversible: operation.reversible,
        estimatedBytes: operation.estimatedBytes ?? item.sizeBytes ?? 0
      }))
    }))
  const kind = serviceTask ? 'services' : 'storage'
  return {
    summary: matchingCandidate
      ? matchingCandidate.description
      : language === 'en-US'
        ? 'Inspection complete. Review the relevant items below and add only the actions you want to the confirmation plan.'
        : '检查完成。请核对下面的相关项目，只把需要处理的操作加入确认计划。',
    sections: [{
      kind,
      title: matchingCandidate
        ? language === 'en-US' ? 'Identified item' : '项目识别'
        : serviceTask
          ? language === 'en-US' ? 'Background services' : '后台服务'
          : language === 'en-US' ? 'Reclaimable storage' : '可清理的存储空间',
      items: candidates
    }]
  }
}

function demoPlanItemFromPresentation(
  run: AgentRunRecord,
  operationId: string
): AgentPlanItem | null {
  for (const section of run.presentation?.sections ?? []) {
    for (const item of section.items) {
      const operations = item.kind === 'terminal' || item.kind === 'applications'
        ? item.operation ? [item.operation] : []
        : item.operations
      const operation = operations.find((candidate) => candidate.id === operationId)
      if (!operation) continue
      const name = item.kind === 'terminal' ? item.title : item.name
      const risk = item.kind === 'terminal'
        ? 'safe'
        : item.kind === 'applications'
          ? 'review'
          : item.kind === 'processes'
            ? 'review'
          : item.risk === 'safe' && operation.reversible ? 'safe' : 'review'
      return {
        id: operation.id,
        kind: item.kind === 'terminal' ? 'terminal-fix' : 'action',
        actionKind: item.kind === 'terminal' ? 'terminal-fix' : 'action',
        title: operation.label,
        detail: `${name} · ${operation.consequence}`,
        estimatedBytes: operation.estimatedBytes,
        risk,
        reversible: operation.reversible
      }
    }
  }
  return null
}

type AgentOrigin =
  | { view:'task'; source:AgentViewKey; scrollTop:number }
  | { view: 'storage'; source: StorageView }
  | { view: 'overview' }
  | { view: 'health'; tab: HealthTab; category?: CleanupCategoryFilter; itemId?: string; scrollTop: number }
  | { view: 'terminal'; tab: 'terminal'; category: 'terminal'; itemId?: string; scrollTop: number }
  | { view: 'apps'; itemId?: string; scrollTop: number }
  | { view: 'disk' }

interface RestoreTarget extends PageRestoreTarget {
  view: Extract<AgentOrigin['view'], 'health' | 'terminal' | 'apps'>
}

interface ExecutionState {
  phase: ExecutionPhase
  verificationMode: 'local' | 'scan'
  itemCount: number
  completedCount: number
  detail: string
  progress: number
  itemIds: string[]
  items: Array<{ id: string; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; message?: string }>
  retryAction?: DirectActionRequest
  runId?: string
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

function pendingExecutionItems(labels: Array<{ id: string; label: string }>): ExecutionState['items'] {
  return labels.map((item) => ({ ...item, status: 'pending' as const }))
}

const DIRECT_STORAGE_FEEDBACK_MS = 2_850

async function waitUntilElapsed(startedAt: number, milliseconds: number): Promise<void> {
  const remaining = milliseconds - (performance.now() - startedAt)
  if (remaining > 0) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
  }
}

function AppContent({ onLanguageChange }: { onLanguageChange: (language: AppSettings['language']) => void }): React.JSX.Element {
  const [appVersion, setAppVersion] = useState(__MEMENTO_VERSION__)
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [providers, setProviders] = useState<AgentProvider[]>([])
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [maintenanceRuns, setMaintenanceRuns] = useState<MaintenanceRunRecord[]>([])
  const [overviewMetrics, setOverviewMetrics] = useState<OverviewMetrics | null>(null)
  const [overviewBusy, setOverviewBusy] = useState(false)
  const [overviewPaused, setOverviewPaused] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [view, setViewState] = useState<AgentViewKey>('overview')
  const viewRef=useRef<AgentViewKey>(view),viewScroll=useRef(new Map<AgentViewKey,number>())
  viewRef.current=view
  const setView=useCallback((next:AgentViewKey):void=>{if(next===viewRef.current)return;viewScroll.current.set(viewRef.current,document.querySelector('.page-stack')?.scrollTop||0);viewRef.current=next;setViewState(next)},[])
  useEffect(()=>{const frame=requestAnimationFrame(()=>{const page=document.querySelector('.page-stack');if(page)page.scrollTop=viewScroll.current.get(view)||0});return()=>cancelAnimationFrame(frame)},[view])
  const [aiSetupOrigin,setAiSetupOrigin]=useState<AiTaskOrigin|null>(null)
  const [processEntry,setProcessEntry]=useState<{sort:'cpuPercent'|'memoryBytes';token:number}|null>(null)
  const [applicationEntryFilter, setApplicationEntryFilter] = useState<ApplicationFilter>('all')
  const [scanBusy, setScanBusy] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<AgentRunRecord | null>(null)
  const [workspaceConversationIds, setWorkspaceConversationIds] = useState<string[]>([])
  const [runStatusMessage, setRunStatusMessage] = useState('')
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set())
  const [storageMode, setStorageMode] = useState<StorageMode>('safe')
  const [cleanupSelectedIds, setCleanupSelectedIds] = useState<Set<string>>(new Set())
  const [diskUsage, setDiskUsage] = useState<DiskUsageScanResult | null>(null)
  const [diskUsageProgress, setDiskUsageProgress] = useState<DiskUsageProgress | null>(null)
  const [diskUsageBusy, setDiskUsageBusy] = useState(false)
  const [diskUsageError, setDiskUsageError] = useState<string | null>(null)
  const [pendingDiskUsageTrash, setPendingDiskUsageTrash] = useState<DiskUsageNode | null>(null)
  const [diskUsageTrashBusy, setDiskUsageTrashBusy] = useState(false)
  const [storageActivity,setStorageActivity]=useState<import('../../shared/storage-types').StorageActivity|null>(null)
  const [agentOrigin, setAgentOrigin] = useState<AgentOrigin | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null)
  const [pendingDirectAction, setPendingDirectAction] = useState<DirectActionRequest | null>(null)
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<InstalledApplication | null>(null)
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [removingApplicationId, setRemovingApplicationId] = useState<string | null>(null)
  const [pendingIgnore, setPendingIgnore] = useState<ScanCandidate | null>(null)
  const [pendingApplicationIgnore, setPendingApplicationIgnore] = useState<InstalledApplication | null>(null)
  const [ignoreBusy, setIgnoreBusy] = useState(false)
  const [ignoredManagerOpen, setIgnoredManagerOpen] = useState(false)
  const [ignoredManagerKind, setIgnoredManagerKind] = useState<'storage' | 'services' | 'applications'>('storage')
  const [restoreBusyValue, setRestoreBusyValue] = useState<string | null>(null)
  const [openingApplicationId, setOpeningApplicationId] = useState<string | null>(null)
  const [updatingApplicationId, setUpdatingApplicationId] = useState<string | null>(null)
  const [addingOperationId, setAddingOperationId] = useState<string | null>(null)
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<AgentRunRecord[] | null>(null)
  const [pendingMaintenanceDelete, setPendingMaintenanceDelete] = useState<MaintenanceRunRecord[] | null>(null)
  const [historyDeleteBusy, setHistoryDeleteBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const started = useRef(false)
  const activeRunId = useRef<string | null>(null)
  const latestAgentStartToken = useRef(0)
  const diskUsageCancelRequested = useRef(false)
  const overviewRequestInFlight = useRef(false)
  const overviewMetricsRef = useRef<OverviewMetrics | null>(null)
  const resultRef = useRef<ScanResult | null>(null)
  const automaticScanStarted = useRef(false)
  const evidenceInFlight=useRef<Promise<ScanResult|null>|null>(null)
  const { text: appText } = useI18n()

  const defaultProvider = useMemo(
    () => providers.find((provider) => provider.isDefault) ?? providers[0] ?? null,
    [providers]
  )

  const refreshOverview = useCallback(async (showBusy = false): Promise<void> => {
    if (overviewRequestInFlight.current) return
    overviewRequestInFlight.current = true
    if (showBusy || !overviewMetricsRef.current) setOverviewBusy(true)
    try {
      const next = window.memento
        ? await window.memento.getOverviewMetrics()
        : localizedDemoOverviewMetrics()
      overviewMetricsRef.current = next
      setOverviewMetrics(next)
      setOverviewError(null)
    } catch (error) {
      setOverviewError(error instanceof Error
        ? error.message
        : settings.language === 'en-US' ? 'Could not refresh system status.' : '无法刷新系统状态')
    } finally {
      overviewRequestInFlight.current = false
      setOverviewBusy(false)
    }
  }, [settings.language])

  useEffect(() => {
    if (!['overview', 'processes'].includes(view) || overviewPaused) return
    void refreshOverview()
    const interval = window.setInterval(() => void refreshOverview(), 2_500)
    return () => window.clearInterval(interval)
  }, [overviewPaused, refreshOverview, view])

  useEffect(() => {
    activeRunId.current = activeRun?.id ?? null
  }, [activeRun?.id])

  useEffect(() => {
    resultRef.current = result
  }, [result])

  const refreshProviders = useCallback(async (): Promise<AgentProvider[]> => {
    const next = window.memento
      ? await window.memento.listAgentProviders()
      : new URLSearchParams(window.location.search).get('noProvider') === '1' ? [] : [DEMO_PROVIDER]
    setProviders(next)
    return next
  }, [])

  const refreshRuns = useCallback(async (): Promise<void> => {
    setRuns(window.memento ? await window.memento.listAgentRuns() : [])
  }, [])

  const refreshMaintenanceRuns = useCallback(async (): Promise<void> => {
    setMaintenanceRuns(window.memento
      ? await window.memento.listMaintenanceRuns()
      : localizedDemoMaintenanceRuns(settings.language))
  }, [settings.language])

  const scanNow=useCallback((languageOverride?:AppSettings['language']):Promise<ScanResult|null>=>{
    if(evidenceInFlight.current)return evidenceInFlight.current
    const work=(async()=>{
    setScanBusy(true)
    setScanError(null)
    try {
      const language = languageOverride ?? settings.language
      const next = window.memento ? await window.memento.scan(language) : localizedDemoResult(language)
      resultRef.current = next
      setResult(next)
      setCleanupSelectedIds(new Set(next.candidates.filter(isSafeCleanup).map((candidate) => candidate.id)))
      return next
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : (languageOverride ?? settings.language) === 'en-US' ? 'Computer health scan failed.' : '电脑体检失败'
      setScanError(message)
      setToast(message)
      return null
    } finally {
      setScanBusy(false)
    }
    })()
    evidenceInFlight.current=work
    void work.finally(()=>{if(evidenceInFlight.current===work)evidenceInFlight.current=null})
    return work
  },[settings.language])

  useEffect(() => {
    const unsubscribeProgress = window.memento?.onScanProgress((scanProgress) => {
      setProgress(scanProgress)
      setExecutionState((current) => current?.phase === 'verifying'
        ? {
            ...current,
            progress: Math.min(96, 44 + Math.round(scanProgress.progress * 0.52)),
            detail: scanProgress.message
          }
        : current)
    })
    const unsubscribeDiskUsage = window.memento?.onDiskUsageProgress(setDiskUsageProgress)
    const unsubscribeDiskUsageRemoval = window.memento?.onDiskUsageNodeRemoved((id) => {
      setDiskUsage((current) => current ? withoutDiskUsageNode(current, id) : current)
    })
    const unsubscribeUpdate = window.memento?.onUpdateState(setUpdateState)
    const unsubscribeProviders = window.memento?.onAgentProvidersChanged(() => {
      void refreshProviders()
    })
    const unsubscribeAgent = window.memento?.onAgentRunEvent((event: AgentRunEvent) => {
      if (event.type === 'status') {
        if (event.runId === activeRunId.current) {
          setActiveRun((current) => current ? { ...current, status: event.status } : current)
          setRuns((current) => current.map((run) => (
            run.id === event.runId ? { ...run, status: event.status } : run
          )))
          setRunStatusMessage(event.message)
        }
        setExecutionState((current) => current?.runId === event.runId
          ? {
              ...current,
              phase: event.status === 'verifying' ? 'verifying' : 'executing',
              detail: event.message,
              progress: event.status === 'verifying'
                ? Math.max(current.progress, 44)
                : Math.max(current.progress, 16)
            }
          : current)
        return
      }
      setRuns((current) => [event.run, ...current.filter((run) => run.id !== event.run.id)])
      if (event.run.id === activeRunId.current) {
        setActiveRun(event.run)
        setRunStatusMessage(event.type === 'failed'
          ? event.run.error ?? (event.run.language === 'en-US' ? 'Task failed' : '任务失败')
          : '')
        setSelectedPlanIds(new Set())
      }
      setExecutionState((current) => current?.runId === event.run.id
        ? {
            ...current,
            phase: event.type === 'failed' ? 'failed' : 'completed',
            completedCount: event.run.results.filter((item) => (
              item.ok && current.itemIds.includes(item.id)
            )).length,
            progress: 100,
            items: current.items.map((item) => {
              const result = event.run.results.find((candidate) => candidate.id === item.id)
              return result ? { ...item, status: result.ok ? 'completed' as const : 'failed' as const, message: result.message } : item
            }),
            detail: event.run.error ?? (event.run.language === 'en-US'
              ? 'Verification finished.'
              : '复检已经完成。')
          }
        : current)
    })
    return () => {
      unsubscribeProgress?.()
      unsubscribeDiskUsage?.()
      unsubscribeDiskUsageRemoval?.()
      unsubscribeUpdate?.()
      unsubscribeProviders?.()
      unsubscribeAgent?.()
    }
  }, [refreshProviders])

  const scanDiskUsage = useCallback(async (): Promise<void> => {
    if (diskUsageBusy) return
    diskUsageCancelRequested.current = false
    setDiskUsageBusy(true)
    setDiskUsageError(null)
    setDiskUsageProgress({
      phase: 'scanning',
      scannedEntries: 0,
      retainedEntries: 0,
      inaccessibleEntries: 0,
      currentLocation: '/',
      elapsedMs: 0,
      message: settings.language === 'en-US' ? 'Scanning the disk asynchronously' : '正在异步扫描磁盘'
    })
    try {
      const next = window.memento
        ? await window.memento.scanDiskUsage()
        : await new Promise<DiskUsageScanResult>((resolve) => window.setTimeout(
            () => resolve(localizedDemoDiskUsageResult(settings.language)),
            720
          ))
      setDiskUsage(next)
      setDiskUsageProgress(null)
    } catch (error) {
      if (!diskUsageCancelRequested.current) {
        setDiskUsageError(error instanceof Error
          ? error.message
          : settings.language === 'en-US' ? 'Disk scan failed.' : '磁盘扫描失败')
      }
    } finally {
      setDiskUsageBusy(false)
      diskUsageCancelRequested.current = false
    }
  }, [diskUsageBusy, settings.language])

  const cancelDiskUsageScan = (): void => {
    if (!diskUsageBusy) return
    diskUsageCancelRequested.current = true
    void window.memento?.cancelDiskUsageScan()
  }

  const changeStorageMode = (mode: StorageMode): void => {
    setStorageMode(mode)
  }

  useEffect(() => {
    // StorageWorkspace owns the shared native index.
  }, [diskUsage, diskUsageBusy, scanDiskUsage, view])

  const revealDiskUsageNode = (id: string): void => {
    if (!window.memento) {
      setToast(appText("legacy.shown_in_finder.9e6532"))
      return
    }
    void window.memento.revealDiskUsageNode(id).catch((error) => {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_reveal_the_disk_item.c9b1cc"))
    })
  }

  const revealCandidate = (candidate: ScanCandidate): void => {
    if (!window.memento) {
      setToast(appText("legacy.location_opened.66170e"))
      return
    }
    void window.memento.revealCandidateLocation(candidate.id).catch((error) => {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_the_item_location.2ac631"))
    })
  }

  const trashDiskUsageNode = async (): Promise<void> => {
    if (!pendingDiskUsageTrash || diskUsageTrashBusy) return
    const node = pendingDiskUsageTrash
    setDiskUsageTrashBusy(true)
    try {
      if (window.memento) await window.memento.trashDiskUsageNode(node.id)
      else await new Promise((resolve) => window.setTimeout(resolve, 420))
      setDiskUsage((current) => current ? withoutDiskUsageNode(current, node.id) : current)
      setPendingDiskUsageTrash(null)
      setToast(appText("legacy.was_moved_to_trash.c949ae", { p0: node.name }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_move_the_disk_item_to_trash.479eaa"))
    } finally {
      setDiskUsageTrashBusy(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const [initialSettings, initialVersion, initialUpdateState] = await Promise.all([
          window.memento ? window.memento.getAppSettings() : Promise.resolve(DEFAULT_APP_SETTINGS),
          window.memento ? window.memento.getVersion() : Promise.resolve(__MEMENTO_VERSION__),
          window.memento
            ? window.memento.getUpdateState()
            : Promise.resolve(demoUpdateState(__MEMENTO_VERSION__))
        ])
        setAppVersion(initialVersion)
        setUpdateState(initialUpdateState)
        setSettings(initialSettings)
        onLanguageChange(initialSettings.language)
        document.documentElement.dataset.theme = initialSettings.theme
        await Promise.all([refreshProviders(), refreshRuns(), refreshMaintenanceRuns()])
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Memento 初始化失败')
      }
    })()
  }, [onLanguageChange, refreshMaintenanceRuns, refreshProviders, refreshRuns])

  useEffect(() => {
    if (
      !result &&
      !scanBusy &&
      !automaticScanStarted.current &&
      (view === 'terminal' || view === 'agent')
    ) {
      automaticScanStarted.current = true
      void scanNow()
    }
  }, [result, scanBusy, scanNow, view])

  useEffect(() => {
    if (view === 'history') void refreshMaintenanceRuns()
  }, [refreshMaintenanceRuns, view])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const updateSettings = async (input: UpdateAppSettingsInput): Promise<void> => {
    const previousLanguage = settings.language
    const next = window.memento
      ? await window.memento.updateAppSettings(input)
      : { ...settings, ...input }
    setSettings(next)
    onLanguageChange(next.language)
    document.documentElement.dataset.theme = next.theme
    if (next.language !== previousLanguage) {
      resultRef.current = null
      setResult(null)
      automaticScanStarted.current = true
      await scanNow(next.language)
    }
  }

  const startAgentRun = (prompt: string, options: { isolated?: boolean; origin?: AgentOrigin; diskUsageNodeId?: string; process?: AgentProcessContext } = {}): void => {
    const uiText = (chinese: string, english: string): string => (
      settings.language === 'en-US' ? english : chinese
    )
    const activeResult = resultRef.current
    if (!activeResult) {
      setToast(uiText('请先完成一次电脑体检', 'Complete a computer health scan first.'))
      return
    }
    if (!defaultProvider) {
      setView('settings')
      setToast(uiText('请先配置模型供应商', 'Configure a model provider first.'))
      return
    }
    if (options.origin) setAgentOrigin(options.origin)
    const startToken = latestAgentStartToken.current + 1
    latestAgentStartToken.current = startToken
    setView('agent')
    setRunStatusMessage(uiText('正在准备设备信息', 'Preparing device information'))
    setSelectedPlanIds(new Set())

    if (!window.memento) {
      const timestamp = new Date().toISOString()
      const run: AgentRunRecord = {
        id: crypto.randomUUID(),
        conversationId: options.isolated ? crypto.randomUUID() : activeRun?.conversationId ?? crypto.randomUUID(),
        language: settings.language,
        prompt,
        status: 'analyzing',
        providerId: defaultProvider.id,
        providerName: defaultProvider.name,
        model: defaultProvider.model,
        response: null,
        presentation: null,
        focus: [],
        plan: [],
        results: [],
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      setActiveRun(run)
      activeRunId.current = run.id
      setWorkspaceConversationIds((current) => appendWorkspaceConversation(
        current,
        run.conversationId
      ))
      window.setTimeout(() => {
        const plan = demoPlan(activeResult, settings.language, options.process)
        const presentation = demoPresentation(activeResult, prompt, settings.language, options.process)
        const completed = {
          ...run,
          status: 'awaiting-confirmation' as const,
          response: presentation.summary,
          presentation,
          plan,
          updatedAt: new Date().toISOString()
        }
        setRuns((current) => [completed, ...current])
        if (latestAgentStartToken.current === startToken) {
          setActiveRun(completed)
          activeRunId.current = completed.id
          setSelectedPlanIds(new Set(plan.map((item) => item.id)))
          setRunStatusMessage(uiText('处理计划已经准备好', 'The action plan is ready'))
        }
      }, 900)
      return
    }

    void window.memento.startAgentRun({
      prompt,
      conversationId: options.isolated ? undefined : activeRun?.conversationId,
      diskUsageNodeId: options.diskUsageNodeId,
      process: options.process
    }).then((run) => {
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)])
      setWorkspaceConversationIds((current) => appendWorkspaceConversation(
        current,
        run.conversationId
      ))
      if (latestAgentStartToken.current === startToken) {
        activeRunId.current = run.id
        setActiveRun(run)
      }
    }).catch((error) => setToast(error instanceof Error
      ? error.message
      : uiText('无法启动 Agent', 'Could not start the Agent.')))
  }

  const startQueuedExplanation=async(task:AiTask,publish:(run:AgentRunRecord)=>void,signal:AbortSignal):Promise<AgentRunRecord>=>{
    const evidence=resultRef.current||await scanNow()
    signal.throwIfAborted()
    if(!evidence)throw new Error(appText('tasks.evidenceFailed'))
    if(window.memento)return window.memento.startAgentRun({prompt:task.prompt,process:task.process})
    if(!defaultProvider)throw new Error(appText('tasks.needs-provider'))
    const now=new Date().toISOString()
    const run:AgentRunRecord={id:crypto.randomUUID(),conversationId:crypto.randomUUID(),language:settings.language,prompt:task.prompt,status:'analyzing',providerId:defaultProvider.id,providerName:defaultProvider.name,model:defaultProvider.model,response:null,presentation:null,focus:[],plan:[],results:[],error:null,createdAt:now,updatedAt:now}
    const timeout=window.setTimeout(()=>{
      if(signal.aborted)return
      const presentation=demoPresentation(evidence,task.prompt,settings.language,task.process)
      publish({...run,status:'awaiting-confirmation',presentation,response:presentation.summary,plan:task.process?demoPlan(evidence,settings.language,task.process):[],updatedAt:new Date().toISOString()})
    },1100)
    signal.addEventListener('abort',()=>{clearTimeout(timeout);publish({...run,status:'cancelled',updatedAt:new Date().toISOString()})},{once:true})
    return run
  }

  const askDiskUsageNode = async (node: DiskUsageNode): Promise<void> => {
    if (!resultRef.current && !await scanNow()) return
    startAgentRun(
      appText("legacy.analyze_the_disk_directory_in_read_only_mo.799f18", { p0: node.name, p1: node.location }),
      { isolated: true, origin: { view: 'disk' }, diskUsageNodeId: node.id }
    )
  }

  const askOverviewProcess = async (process: OverviewProcess): Promise<void> => {
    if (!resultRef.current && !await scanNow()) return
    startAgentRun(
      appText("legacy.analyze_the_live_process_pid_cpu_memory_ex.12b26e", { p0: process.name, p1: process.pid, p2: process.cpuPercent.toFixed(1), p3: formatBytes(process.memoryBytes) }),
      {
        isolated: true,
        origin: { view: 'overview' },
        process: {
          pid: process.pid,
          name: process.name,
          command: process.command,
          cpuPercent: process.cpuPercent,
          memoryPercent: process.memoryPercent,
          memoryBytes: process.memoryBytes,
          isSystem: process.isSystem
        }
      }
    )
  }

  const copyOverviewProcessName = async (name: string): Promise<void> => {
    try {
      if (window.memento) await window.memento.copyOverviewProcessName(name)
      else await navigator.clipboard?.writeText(name)
      setToast(appText("legacy.process_name_copied.dd0e31"))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.copy_failed.4fa5d3"))
    }
  }

  const copyOverviewProcessPid = async (pid: number): Promise<void> => {
    try {
      if (window.memento) await window.memento.copyOverviewProcessPid(pid)
      else await navigator.clipboard?.writeText(String(pid))
      setToast(appText("legacy.process_pid_copied.467451"))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.copy_failed.4fa5d3"))
    }
  }

  const terminateOverviewProcess = async (process: OverviewProcess, force: boolean): Promise<boolean> => {
    try {
      if (window.memento) await window.memento.terminateOverviewProcess({ pid: process.pid, force })
      setToast(appText(
        force ? `已强制退出 ${process.name}` : `已请求退出 ${process.name}`,
        force ? `${process.name} was force quit` : `Quit requested for ${process.name}`
      ))
      await refreshOverview(true)
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.process_action_failed.0c4ce8"))
      await refreshOverview(true)
      return false
    }
  }

  const executePlan = async (): Promise<void> => {
    if (!activeRun || !selectedPlanIds.size) return
    if (scanBusy) {
      setToast(appText("legacy.wait_for_the_current_scan_to_finish_before.7ecaa6"))
      return
    }
    const runId = activeRun.id
    const itemIds = [...selectedPlanIds]
    const itemCount = itemIds.length
    const itemLabels = itemIds.map((id) => ({
      id,
      label: activeRun.plan.find((item) => item.id === id)?.title ?? id
    }))
    setExecutionState({
      phase: 'executing',
      verificationMode: 'scan',
      itemCount,
      completedCount: 0,
      progress: 8,
      itemIds,
      items: pendingExecutionItems(itemLabels),
      detail: settings.language === 'en-US'
        ? 'Running the actions you confirmed.'
        : '正在执行你已经确认的操作。',
      runId
    })
    await waitForNextPaint()
    try {
      if (!window.memento) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 520))
        setExecutionState((current) => current?.runId === runId ? {
          ...current,
          phase: 'verifying',
          progress: 44,
          detail: settings.language === 'en-US'
            ? 'Scanning again to verify the results.'
            : '正在重新体检并验证结果。'
        } : current)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 520))
        const completed: AgentRunRecord = {
          ...activeRun,
          status: 'completed',
          results: [...selectedPlanIds].map((id) => ({
            id,
            ok: true,
            message: settings.language === 'en-US' ? 'Operation completed' : '操作完成'
          })),
          updatedAt: new Date().toISOString()
        }
        setActiveRun(completed)
        setRuns((current) => [completed, ...current.filter((run) => run.id !== completed.id)])
        setSelectedPlanIds(new Set())
        setExecutionState({
          phase: 'completed',
          verificationMode: 'scan',
          itemCount,
          completedCount: itemCount,
          progress: 100,
          itemIds,
          items: itemLabels.map((item) => ({ ...item, status: 'completed' as const })),
          detail: settings.language === 'en-US'
            ? 'The actions completed and verification passed.'
            : '操作已经完成，复检结果正常。',
          runId
        })
        setToast(settings.language === 'en-US'
          ? 'The plan completed and the computer was scanned again.'
          : '计划执行完成并已重新体检')
        return
      }
      const executed = await window.memento.executeAgentPlan({
        runId: activeRun.id,
        itemIds
      })
      setActiveRun(executed.run)
      resultRef.current = executed.scan
      setResult(executed.scan)
      setCleanupSelectedIds(new Set(executed.scan.candidates.filter(isSafeCleanup).map((candidate) => candidate.id)))
      setRuns((current) => [executed.run, ...current.filter((run) => run.id !== executed.run.id)])
      const selectedResults = executed.run.results.filter((item) => itemIds.includes(item.id))
      setExecutionState({
        phase: selectedResults.some((item) => !item.ok) ? 'failed' : 'completed',
        verificationMode: 'scan',
        itemCount,
        completedCount: selectedResults.filter((item) => item.ok).length,
        progress: 100,
        itemIds,
        items: itemLabels.map((item) => {
          const result = selectedResults.find((candidate) => candidate.id === item.id)
          return { ...item, status: result?.ok ? 'completed' as const : 'failed' as const, message: result?.message }
        }),
        detail: executed.run.error ?? (settings.language === 'en-US'
          ? 'The actions completed and verification passed.'
          : '操作已经完成，复检结果正常。'),
        runId
      })
      setToast(executed.run.error ?? (settings.language === 'en-US'
        ? 'The plan completed and the computer was scanned again.'
        : '计划执行完成并已重新体检'))
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : settings.language === 'en-US' ? 'The action plan failed.' : '处理计划执行失败'
      setExecutionState((current) => current?.runId === runId ? {
        ...current,
        phase: 'failed',
        progress: 100,
        items: current.items.map((item) => ({ ...item, status: 'failed' as const, message })),
        detail: message
      } : current)
      setToast(message)
    }
  }

  const requestDirectAction = (candidate: ScanCandidate, operation: CandidateOperation): void => {
    if (scanBusy) {
      setToast(appText("legacy.wait_for_the_current_scan_to_finish_before.5a304b"))
      return
    }
    setPendingDirectAction({
      id: operation.id,
      candidateId: candidate.id,
      kind: 'action',
      verificationMode: candidate.section === 'storage' ? 'local' : 'scan',
      subject: candidate.name,
      label: operation.label,
      consequence: operation.consequence,
      reversible: operation.reversible,
      estimatedBytes: operation.estimatedBytes ?? candidate.sizeBytes ?? 0,
      itemLabels: [{ id: operation.id, label: `${candidate.name} · ${operation.label}` }]
    })
  }

  const requestDirectActions = (selections: CleanupSelection[]): void => {
    if (!selections.length) return
    if (scanBusy) {
      setToast(appText("legacy.wait_for_the_current_scan_to_finish_before.ceafd4"))
      return
    }
    const reversible = selections.every(({ operation }) => operation.reversible)
    const verificationMode = selections.every(({ candidate }) => candidate.section === 'storage') ? 'local' : 'scan'
    setPendingDirectAction({
      id: selections[0].operation.id,
      ids: selections.map(({ operation }) => operation.id),
      candidateIds: selections.map(({ candidate }) => candidate.id),
      kind: 'action',
      verificationMode,
      subject: appText("legacy.cleanup_items.6501cd", { p0: selections.length }),
      label: appText("legacy.clean_selected_items.aa11e8", { p0: selections.length }),
      consequence: appText("legacy.only_deterministic_cleanup_actions_registe.083ac1"),
      reversible,
      estimatedBytes: selections.reduce((sum, { candidate, operation }) => sum + (operation.estimatedBytes ?? candidate.sizeBytes ?? 0), 0),
      itemLabels: selections.map(({ candidate, operation }) => ({ id: operation.id, label: `${candidate.name} · ${operation.label}` }))
    })
  }

  const requestDirectTerminalFixes = (findings: TerminalFinding[]): void => {
    const fixes = findings.map((finding) => finding.fix).filter((fix): fix is NonNullable<typeof fix> => Boolean(fix))
    if (!fixes.length) return
    if (scanBusy) {
      setToast(appText("legacy.wait_for_the_current_scan_to_finish_before.603e6c"))
      return
    }
    setPendingDirectAction({
      id: fixes[0].id,
      ids: fixes.map((fix) => fix.id),
      kind: 'terminal-fix',
      verificationMode: 'scan',
      subject: appText("legacy.terminal_startup_optimizations.e66f85", { p0: fixes.length }),
      label: appText("legacy.optimize_selected_items.4244c8", { p0: fixes.length }),
      consequence: appText("legacy.shell_configuration_is_backed_up_before_ed.4c5efc"),
      reversible: true,
      estimatedBytes: 0,
      itemLabels: fixes.map((fix) => ({ id: fix.id, label: `${findings.find((finding) => finding.fix?.id === fix.id)?.title ?? fix.id} · ${fix.label}` }))
    })
  }

  const executeDirectAction = async (actionOverride?: DirectActionRequest): Promise<void> => {
    const action = actionOverride ?? pendingDirectAction
    if (!action) return
    const actionIds = action.ids?.length ? action.ids : [action.id]
    const startedAt = performance.now()
    setPendingDirectAction(null)
    setExecutionState({
      phase: 'executing',
      verificationMode: action.verificationMode,
      itemCount: actionIds.length,
      completedCount: 0,
      progress: 8,
      itemIds: actionIds,
      items: pendingExecutionItems(action.itemLabels ?? actionIds.map((id) => ({ id, label: id }))),
      detail: appText("legacy.running.d701be", { p0: action.label })
    })
    await waitForNextPaint()
    try {
      const results = window.memento
        ? action.kind === 'terminal-fix'
          ? (await window.memento.runTerminalFixes(actionIds)).results
          : await window.memento.runActions(actionIds)
        : await new Promise<Array<{ id: string; ok: boolean; message: string }>>((resolve) => {
            window.setTimeout(() => resolve(actionIds.map((id) => ({
              id,
              ok: true,
              message: appText("legacy.action_completed.a4b7ae")
            }))), 520)
          })
      const completedCount = results.filter((item) => item.ok).length
      const completedIds = new Set(results.filter((item) => item.ok).map((item) => item.id))
      setExecutionState({
        phase: 'verifying',
        verificationMode: action.verificationMode,
        itemCount: actionIds.length,
        completedCount,
        progress: 44,
        itemIds: actionIds,
        items: (action.itemLabels ?? actionIds.map((id) => ({ id, label: id }))).map((item) => {
          const result = results.find((candidate) => candidate.id === item.id)
          return { ...item, status: result?.ok ? 'completed' as const : 'failed' as const, message: result?.message }
        }),
        detail: action.verificationMode === 'local'
          ? appText("legacy.confirming_the_deletion_and_updating_the_c.c9d30a")
          : appText("legacy.scanning_again_to_verify_the_result.3c8c71")
      })
      if (action.verificationMode === 'local') {
        const completedCandidateIds = new Set<string>()
        if (action.candidateId && completedIds.has(action.id)) completedCandidateIds.add(action.candidateId)
        action.candidateIds?.forEach((candidateId, index) => {
          if (completedIds.has(actionIds[index])) completedCandidateIds.add(candidateId)
        })
        await waitUntilElapsed(startedAt, 1_600)
        setExecutionState((current) => current ? { ...current, progress: 72 } : current)
        await waitUntilElapsed(startedAt, 2_250)
        setExecutionState((current) => current ? { ...current, progress: 92 } : current)
        await waitUntilElapsed(startedAt, DIRECT_STORAGE_FEEDBACK_MS)
        setResult((current) => {
          if (!current) return current
          const reconciled = applyCompletedCandidateActions(
            current.candidates,
            completedIds,
            settings.language
          )
          return {
            ...current,
            candidates: completedCandidateIds.size
              ? reconciled.filter((candidate) => !completedCandidateIds.has(candidate.id))
              : reconciled
          }
        })
        setCleanupSelectedIds((current) => new Set([...current].filter((id) => !completedCandidateIds.has(id))))
      } else {
        setScanBusy(true)
        const verified = window.memento
          ? await window.memento.scan(settings.language)
          : await new Promise<ScanResult>((resolve) => window.setTimeout(() => resolve(localizedDemoResult(settings.language)), 520))
        resultRef.current = verified
        setResult(verified)
        setCleanupSelectedIds(new Set(verified.candidates.filter(isSafeCleanup).map((candidate) => candidate.id)))
      }
      const failure = results.find((item) => !item.ok)
      setExecutionState({
        phase: failure ? 'failed' : 'completed',
        verificationMode: action.verificationMode,
        itemCount: actionIds.length,
        completedCount,
        progress: 100,
        itemIds: actionIds,
        items: (action.itemLabels ?? actionIds.map((id) => ({ id, label: id }))).map((item) => {
          const result = results.find((candidate) => candidate.id === item.id)
          return { ...item, status: result?.ok ? 'completed' as const : 'failed' as const, message: result?.message }
        }),
        retryAction: results.some((item) => !item.ok)
          ? (() => {
              const failedIds = results.filter((item) => !item.ok).map((item) => item.id)
              return {
                ...action,
                ids: failedIds,
                candidateIds: action.candidateIds?.filter((_, index) => failedIds.includes(actionIds[index] ?? '')),
                itemLabels: (action.itemLabels ?? []).filter((item) => failedIds.includes(item.id))
              }
            })()
          : undefined,
        detail: failure?.message ?? appText(
          action.verificationMode === 'local'
            ? `“${action.label}”已完成，当前列表已经更新。`
            : `“${action.label}”已完成，复检结果正常。`,
          action.verificationMode === 'local'
            ? `"${action.label}" completed and the current list was updated.`
            : `"${action.label}" completed and verification passed.`
        )
      })
      if (!failure) {
        setToast(appText(
          action.verificationMode === 'local'
            ? `“${action.subject}”已处理并从列表移除`
            : `“${action.subject}”处理完成`,
          action.verificationMode === 'local'
            ? `"${action.subject}" was processed and removed from the list.`
            : `"${action.subject}" completed.`
        ))
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : appText("legacy.the_action_or_verification_did_not_complet.49293f")
      setExecutionState({
        phase: 'failed',
        verificationMode: action.verificationMode,
        itemCount: actionIds.length,
        completedCount: 0,
        progress: 100,
        itemIds: actionIds,
        items: (action.itemLabels ?? actionIds.map((id) => ({ id, label: id }))).map((item) => ({ ...item, status: 'failed' as const, message })),
        retryAction: action,
        detail: message
      })
      setToast(message)
    } finally {
      setScanBusy(false)
    }
  }

  const returnToAgentOrigin = (): void => {
    if (!agentOrigin) return
    if(agentOrigin.view==='task'){viewScroll.current.set(agentOrigin.source,agentOrigin.scrollTop);setView(agentOrigin.source);setAgentOrigin(null);return}
    if(agentOrigin.view==='storage'){setView(agentOrigin.source);setAgentOrigin(null);return}
    if (agentOrigin.view === 'overview') {
      setAgentOrigin(null)
      setView('processes')
      return
    }
    if (agentOrigin.view === 'disk') {
      setAgentOrigin(null)
      setView('disk')
      return
    }
    if (agentOrigin.view === 'terminal') {
      setRestoreTarget({
        view: 'terminal',
        category: 'terminal',
        itemId: agentOrigin.itemId,
        scrollTop: agentOrigin.scrollTop,
        token: Date.now()
      })
      setAgentOrigin(null)
      setView('terminal')
      return
    }
    setRestoreTarget({
      view: agentOrigin.view,
      category: agentOrigin.view === 'health' ? agentOrigin.category : undefined,
      itemId: agentOrigin.itemId,
      scrollTop: agentOrigin.scrollTop,
      token: Date.now()
    })
    setView(agentOrigin.view)
  }

  const discardPlan = (): void => {
    if (!activeRun) return
    if (window.memento) void window.memento.cancelAgentRun(activeRun.id)
    const cancelled: AgentRunRecord = {
      ...activeRun,
      status: 'cancelled',
      plan: [],
      error: null,
      updatedAt: new Date().toISOString()
    }
    setActiveRun(cancelled)
    setRuns((current) => [cancelled, ...current.filter((run) => run.id !== cancelled.id)])
    setSelectedPlanIds(new Set())
    setRunStatusMessage(settings.language === 'en-US' ? 'Plan cancelled' : '计划已取消')
  }

  const addAgentPlanItem = async (id: string): Promise<void> => {
    if (!activeRun || addingOperationId) return
    const wasFinished = ['completed', 'failed', 'cancelled'].includes(activeRun.status)
    setAddingOperationId(id)
    try {
      let updated: AgentRunRecord
      if (window.memento) {
        updated = await window.memento.addAgentPlanItems({
          runId: activeRun.id,
          itemIds: [id]
        })
      } else {
        const item = demoPlanItemFromPresentation(activeRun, id) ??
          (result ? demoPlan(result, settings.language).find((candidate) => candidate.id === id) : null)
        if (!item) throw new Error(settings.language === 'en-US' ? 'The action is no longer available.' : '操作已经失效')
        updated = {
          ...activeRun,
          status: 'awaiting-confirmation',
          plan: [...new Map([...activeRun.plan, item].map((planItem) => [planItem.id, planItem])).values()],
          updatedAt: new Date().toISOString()
        }
      }
      setActiveRun(updated)
      setRuns((current) => [updated, ...current.filter((run) => run.id !== updated.id)])
      const completedIds = new Set(updated.results.filter((item) => item.ok).map((item) => item.id))
      setSelectedPlanIds(wasFinished
        ? new Set([id])
        : new Set(updated.plan.filter((item) => !completedIds.has(item.id)).map((item) => item.id)))
      setRunStatusMessage(settings.language === 'en-US' ? 'Added to the confirmation plan' : '已加入确认计划')
    } catch (error) {
      setToast(error instanceof Error
        ? error.message
        : settings.language === 'en-US' ? 'Could not add the action to the plan.' : '无法加入处理计划')
    } finally {
      setAddingOperationId(null)
    }
  }

  const openIgnoredManager = (kind: 'storage' | 'services' | 'applications' = 'storage'): void => {
    setIgnoredManagerKind(kind)
    setIgnoredManagerOpen(true)
  }

  const confirmApplicationIgnore = async (): Promise<void> => {
    if (!pendingApplicationIgnore) return
    const application = pendingApplicationIgnore
    const value = applicationWhitelistValue(application)
    setIgnoreBusy(true)
    try {
      await updateSettings({
        applicationWhitelist: [...settings.applicationWhitelist, value]
      })
      setResult((current) => current ? {
        ...current,
        applications: current.applications.filter((item) => item.id !== application.id),
        ignoredApplications: [
          ...current.ignoredApplications.filter((item) => item.id !== application.id),
          { ...application, action: undefined }
        ],
        candidates: current.candidates.filter((candidate) => !(
          candidate.section === 'applications' &&
          (candidate.operations ?? []).some((operation) => operation.id === application.action?.id)
        ))
      } : current)
      setToast(appText("legacy.was_added_to_ignored_items.7ed23e", { p0: application.name }))
      setPendingApplicationIgnore(null)
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_update_ignored_items.df01ee"))
    } finally {
      setIgnoreBusy(false)
    }
  }

  const confirmIgnore = async (): Promise<void> => {
    if (!pendingIgnore) return
    const value = candidateWhitelistValue(pendingIgnore)
    if (!value) return
    setIgnoreBusy(true)
    try {
      const nextInput = pendingIgnore.section === 'services'
        ? { serviceWhitelist: [...settings.serviceWhitelist, value] }
        : { storageWhitelist: [...settings.storageWhitelist, value] }
      await updateSettings(nextInput)
      setResult((current) => current
        ? { ...current, candidates: current.candidates.filter((candidate) => candidate.id !== pendingIgnore.id) }
        : current)
      setToast(appText("legacy.was_added_to_ignored_items.7ed23e", { p0: pendingIgnore.name }))
      setPendingIgnore(null)
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_update_ignored_items.df01ee"))
    } finally {
      setIgnoreBusy(false)
    }
  }

  const restoreIgnored = async (kind: 'services' | 'storage' | 'applications', value: string): Promise<void> => {
    setRestoreBusyValue(value)
    try {
      await updateSettings(kind === 'services'
        ? { serviceWhitelist: settings.serviceWhitelist.filter((item) => item !== value) }
        : kind === 'storage'
          ? { storageWhitelist: settings.storageWhitelist.filter((item) => item !== value) }
          : { applicationWhitelist: settings.applicationWhitelist.filter((item) => item !== value) })
      await scanNow()
      setToast(appText("legacy.detection_restored.531f0a"))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_restore_detection.58cb35"))
    } finally {
      setRestoreBusyValue(null)
    }
  }

  const openApplication = async (application: InstalledApplication): Promise<void> => {
    setOpeningApplicationId(application.id)
    try {
      if (window.memento) await window.memento.openApplication(application.id)
      setToast(appText("legacy.opened.c3d642", { p0: application.name }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_the_application.f7a0ec"))
    } finally {
      setOpeningApplicationId(null)
    }
  }

  const updateApplication = async (application: InstalledApplication): Promise<void> => {
    setUpdatingApplicationId(application.id)
    try {
      const outcome = window.memento
        ? await window.memento.updateApplication(application.id)
        : application.updateMode === 'external'
          ? { status: 'opened' as const, destination: application.updateSource === 'mac-app-store' ? 'app-store' as const : 'application' as const }
          : { status: 'updated' as const }
      if (outcome.status === 'updated') {
        await scanNow()
        setToast(appText("legacy.was_updated.df1b36", { p0: application.name }))
      } else {
        setToast(outcome.destination === 'app-store'
          ? appText("legacy.the_app_store_is_open_finish_updating_then.469610", { p0: application.name })
          : appText("legacy.s_updater_is_open_finish_the_update_then_c.bbd318", { p0: application.name }))
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.application_update_failed.dad306"))
    } finally {
      setUpdatingApplicationId(null)
    }
  }

  const openSystemSettings = async (section: 'battery' | 'network'): Promise<void> => {
    try {
      if (window.memento) await window.memento.openSystemSettings(section)
      else setView('settings')
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_system_settings.12e03c"))
    }
  }

  const openActivityMonitorNetwork = async (): Promise<void> => {
    try {
      setToast(appText("legacy.opening_activity_monitor_accessibility_is_.e648fb"))
      const selected = window.memento ? await window.memento.openActivityMonitorNetwork() : true
      if (!selected) {
        setToast(appText("legacy.activity_monitor_is_open_to_switch_to_the_.5f87e8"))
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_activity_monitor.a8ed91"))
    }
  }

  const revealTerminalFinding = async (finding: TerminalFinding): Promise<void> => {
    try {
      if (window.memento) await window.memento.revealTerminalFinding(finding.id)
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_the_terminal_configuration.78bcbe"))
    }
  }

  const deleteHistoryRun = async (): Promise<void> => {
    if (!pendingHistoryDelete) return
    const selectedRuns = pendingHistoryDelete
    const selectedIds = new Set(selectedRuns.map((run) => run.id))
    setHistoryDeleteBusy(true)
    try {
      if (window.memento) await window.memento.deleteAgentRuns([...selectedIds])
      const remainingRuns = window.memento
        ? await window.memento.listAgentRuns()
        : runs.filter((item) => !selectedIds.has(item.id))
      setRuns(remainingRuns)
      const remainingConversationIds = new Set(remainingRuns.map((run) => run.conversationId))
      setWorkspaceConversationIds((current) => current.filter((id) => remainingConversationIds.has(id)))
      if (activeRun && selectedIds.has(activeRun.id)) {
        setActiveRun(null)
        activeRunId.current = null
        setSelectedPlanIds(new Set())
        setRunStatusMessage('')
      }
      setPendingHistoryDelete(null)
      setToast(appText("legacy.task_records_deleted.6917a3", { p0: selectedRuns.length }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_delete_task_history.12795a"))
    } finally {
      setHistoryDeleteBusy(false)
    }
  }

  const deleteMaintenanceHistory = async (): Promise<void> => {
    if (!pendingMaintenanceDelete) return
    const selectedIds = new Set(pendingMaintenanceDelete.map((run) => run.id))
    setHistoryDeleteBusy(true)
    try {
      if (window.memento) await window.memento.deleteMaintenanceRuns([...selectedIds])
      setMaintenanceRuns((current) => current.filter((run) => !selectedIds.has(run.id)))
      setPendingMaintenanceDelete(null)
      setToast(appText("legacy.maintenance_audit_records_deleted.ae52d1", { p0: selectedIds.size }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_delete_maintenance_history.44d741"))
    } finally {
      setHistoryDeleteBusy(false)
    }
  }

  const revealMaintenanceRecovery = (operationRecordId: string): void => {
    if (!window.memento) {
      setToast(appText("legacy.recovery_location_opened.437d64"))
      return
    }
    void window.memento.revealMaintenanceRecovery(operationRecordId).catch((error) => {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_open_the_recovery_location.ea570c"))
    })
  }

  const uninstallApplication = async (): Promise<void> => {
    if (!pendingUninstall?.action) return
    const application = pendingUninstall
    const actionId = pendingUninstall.action.id
    setUninstallBusy(true)
    try {
      const results = window.memento
        ? await window.memento.runActions([actionId])
        : await new Promise<Array<{ id: string; ok: boolean; message: string }>>((resolve) => {
            window.setTimeout(() => resolve([{
              id: actionId,
              ok: true,
              message: appText("legacy.operation_completed.4a9496")
            }]), 650)
          })
      const failure = results.find((item) => !item.ok)
      if (failure) throw new Error(failure.message)
      setRemovingApplicationId(application.id)
      setPendingUninstall(null)
      setToast(appText("legacy.was_moved_to_the_trash.efff51", { p0: application.name }))
      const exitDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 420
      await new Promise<void>((resolve) => window.setTimeout(resolve, exitDuration))
      setResult((current) => current ? {
        ...current,
        applications: current.applications.filter((item) => item.id !== application.id)
      } : current)
      setRemovingApplicationId(null)
      if (window.memento) void scanNow()
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_uninstall_the_application.da57bc"))
    } finally {
      setUninstallBusy(false)
    }
  }

  const discoverProviderModels = useCallback(async (
    input: DiscoverAgentModelsInput
  ): Promise<AgentProviderModelsResult> => {
    if (window.memento) return window.memento.discoverAgentProviderModels(input)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 520))
    const models = input.type === 'anthropic'
      ? ['claude-opus-4-6', 'claude-sonnet-4-5']
      : input.type === 'google' || input.type === 'antigravity'
        ? ['gemini-3.1-pro-preview', 'gemini-2.5-flash']
        : input.type === 'openai'
          ? ['gpt-5.4', 'gpt-5.3-codex-spark']
          : ['deepseek-chat', 'deepseek-reasoner', 'grok-4-1-fast-reasoning']
    const suffix = input.type === 'google'
      ? '/v1beta'
      : input.type === 'antigravity' ? '/antigravity/v1beta' : '/v1'
    const parsed = new URL(input.baseUrl)
    const resolvedBaseUrl = parsed.pathname === '/'
      ? `${parsed.origin}${suffix}`
      : input.baseUrl.replace(/\/+$/, '')
    return { models, resolvedBaseUrl, excludedModelCount: 0 }
  }, [])

  const saveProvider = async (input: SaveAgentProviderInput): Promise<AgentProvider> => {
    try {
      if (!window.memento) {
        const timestamp = new Date().toISOString()
        const existing = providers.find((provider) => provider.id === input.id)
        const provider: AgentProvider = {
          ...DEMO_PROVIDER,
          ...input,
          id: input.id ?? crypto.randomUUID(),
          isDefault: existing?.isDefault ?? providers.length === 0,
          connectionState: 'untested',
          keyPresent: true,
          keyHint: input.apiKey ? `••••${input.apiKey.slice(-4)}` : DEMO_PROVIDER.keyHint,
          createdAt: timestamp,
          updatedAt: timestamp
        }
        setProviders((current) => [
          provider,
          ...current.filter((item) => item.id !== provider.id)
        ])
        return provider
      }
      const provider = await window.memento.saveAgentProvider(input)
      await refreshProviders()
      return provider
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_save_the_provider.e8bd50"))
      throw error
    }
  }

  const testProvider = async (input: SaveAgentProviderInput): Promise<AgentProviderTestResult> => {
    try {
      const tested = window.memento
        ? await window.memento.testAgentProvider(input)
        : {
            ok: true,
            message: appText("legacy.connected_the_model_supports_tool_calling.27451d"),
            toolCalling: true,
            testedAt: new Date().toISOString()
          }
      if (window.memento) await refreshProviders()
      return tested
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.connection_test_failed.e28922"))
      throw error
    }
  }

  const deleteProvider = async (id: string): Promise<void> => {
    try {
      if (window.memento) await window.memento.deleteAgentProvider(id)
      setProviders((current) => current.filter((provider) => provider.id !== id))
      setToast(appText("legacy.provider_configuration_deleted.3da99c"))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_delete_the_provider.fda080"))
      throw error
    }
  }

  const setDefaultProvider = async (id: string): Promise<void> => {
    try {
      const next = window.memento
        ? await window.memento.setDefaultAgentProvider(id)
        : providers.map((provider) => ({ ...provider, isDefault: provider.id === id }))
      setProviders(next)
      const provider = next.find((item) => item.id === id)
      setToast(provider
        ? appText("legacy.is_now_the_default_provider_new_tasks_use.58cad4", { p0: provider.name, p1: provider.model })
        : appText("legacy.default_provider_updated.71e836"))
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_update_the_default_model.f6e00b"))
      throw error
    }
  }

  const importLocalAiConfigurations = async (): Promise<LocalAiImportResult> => {
    try {
      const imported = window.memento
        ? await window.memento.importLocalAiConfigurations()
        : { sourcesFound: 4, detected: 4, imported: 2, rejected: 2, removed: 0 }
      await refreshProviders()
      const removedText = imported.removed > 0
        ? appText("legacy.previously_imported_invalid_configurations.5cb8fe", { p0: imported.removed })
        : ''
      setToast(imported.sourcesFound === 0
        ? appText("legacy.no_claude_codex_gemini_or_grok_configurati.931651", { p0: removedText })
        : imported.detected === imported.rejected
          ? appText("legacy.all_discovered_local_ai_configurations_fai.a98bba", { p0: removedText })
          : appText("legacy.configurations_found_added_or_updated_and_.0e124d", { p0: imported.detected, p1: imported.imported, p2: imported.rejected, p3: removedText }))
      return imported
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_scan_local_ai_configurations.51ec20"))
      throw error
    }
  }

  const importCcSwitchProviders = async (): Promise<CcSwitchImportResult> => {
    try {
      const imported = window.memento
        ? await window.memento.importCcSwitchProviders()
        : { databaseFound: true, detected: 2, imported: 1, rejected: 1, removed: 0 }
      await refreshProviders()
      setToast(!imported.databaseFound
        ? appText("legacy.no_local_cc_switch_configuration_was_found.6bbb4d")
        : imported.detected === 0
          ? appText("legacy.cc_switch_has_no_complete_configuration_to.e4e25b")
          : imported.detected === imported.rejected
            ? appText("legacy.all_cc_switch_configurations_failed_creden.e74f2c")
            : appText("legacy.cc_switch_configurations_were_copied_inval.b1dde1", { p0: imported.imported, p1: imported.rejected }))
      return imported
    } catch (error) {
      setToast(error instanceof Error ? error.message : appText("legacy.could_not_import_cc_switch.9c34ee"))
      throw error
    }
  }

  const checkForUpdates = async (): Promise<void> => {
    try {
      const next = window.memento
        ? await window.memento.checkForUpdates()
        : {
            currentVersion: appVersion,
            latestVersion: null,
            updateAvailable: false,
            phase: 'up-to-date' as const,
            downloadPercent: null,
            checkedAt: new Date().toISOString(),
            error: null
          }
      setUpdateState(next)
    } catch (error) {
      setUpdateState((current) => ({
        currentVersion: current?.currentVersion ?? appVersion,
        latestVersion: current?.latestVersion ?? null,
        updateAvailable: current?.updateAvailable ?? false,
        phase: 'error',
        downloadPercent: null,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : appText("legacy.could_not_check_for_updates.09e020")
      }))
    }
  }

  const installUpdate = (): void => {
    if (!window.memento) {
      setUpdateState((current) => current ? { ...current, phase: 'installing' } : current)
      return
    }
    void window.memento?.installUpdate().catch((error) => {
      setUpdateState((current) => current ? {
        ...current,
        phase: 'error',
        downloadPercent: null,
        error: error instanceof Error ? error.message : appText("legacy.could_not_install_the_update.6f0bb8")
      } : current)
    })
  }

  const healthCount = result
    ? result.candidates.filter((candidate) => (
        candidate.section === 'storage' &&
        !isReviewClue(candidate) && (isSafeCleanup(candidate) || isActionableFinding(candidate))
      )).length
    : 0
  const terminalCount = result?.terminal.findings.filter((finding) => Boolean(finding.fix)).length ?? 0
  const conversationRuns = useMemo(() => {
    if (!activeRun) return []
    const byId = new Map(
      runs
        .filter((run) => run.conversationId === activeRun.conversationId)
        .map((run) => [run.id, run])
    )
    byId.set(activeRun.id, activeRun)
    return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }, [activeRun, runs])
  const workspaceRuns = useMemo(() => latestWorkspaceConversationRuns(
    runs,
    activeRun,
    workspaceConversationIds
  ), [activeRun, runs, workspaceConversationIds])

  const selectWorkspaceRun = (run: AgentRunRecord): void => {
    latestAgentStartToken.current += 1
    setActiveRun(run)
    activeRunId.current = run.id
    const completedIds = new Set(run.results.filter((item) => item.ok).map((item) => item.id))
    setSelectedPlanIds(new Set(run.plan
      .filter((item) => !completedIds.has(item.id))
      .map((item) => item.id)))
    setRunStatusMessage('')
    setView('agent')
  }

  const closeWorkspaceRun = (conversationId: string): void => {
    const remaining = workspaceRuns.filter((run) => run.conversationId !== conversationId)
    setWorkspaceConversationIds((current) => current.filter((id) => id !== conversationId))
    if (activeRun?.conversationId !== conversationId) return
    const fallback = remaining.at(-1) ?? null
    if (fallback) {
      selectWorkspaceRun(fallback)
      return
    }
    setActiveRun(null)
    activeRunId.current = null
    setSelectedPlanIds(new Set())
    setRunStatusMessage('')
  }
  const agentOriginLabel = agentOrigin?.view === 'task'
    ? appText(`nav.${agentOrigin.source==='overview'?'home':agentOrigin.source==='health'?'cleanup':agentOrigin.source}`)
    : agentOrigin?.view === 'storage'
    ? appText(`nav.${agentOrigin.source==='health'?'cleanup':agentOrigin.source}`)
    : agentOrigin?.view === 'overview'
    ? appText('nav.processes')
    : agentOrigin?.view === 'apps'
    ? appText("legacy.applications.516cc6")
    : agentOrigin?.view === 'disk'
      ? appText("legacy.disk_analysis.045d77")
    : agentOrigin?.view === 'terminal'
      ? appText("legacy.terminal_startup.54e632")
    : agentOrigin?.view === 'health'
      ? agentOrigin.tab === 'services'
        ? appText("legacy.services.c83843")
        : agentOrigin.tab === 'terminal'
          ? appText("legacy.terminal.19bb19")
          : appText("legacy.storage.3a8df2")
      : null

  const openAgentApplication = (id: string): void => {
    const application = result?.applications.find((item) => item.id === id)
    if (!application) {
      setToast(settings.language === 'en-US'
        ? 'The application is no longer available. Scan again.'
        : '应用已经不存在，请重新体检')
      return
    }
    void openApplication(application)
  }

  return (
    <AiTaskProvider configured={Boolean(defaultProvider)} visibleRunId={view==='agent'?activeRun?.id||null:null} origin={()=>({source:viewRef.current,scrollTop:document.querySelector('.page-stack')?.scrollTop||0})} start={startQueuedExplanation} onRun={(run)=>{setRuns((current)=>[run,...current.filter((item)=>item.id!==run.id)]);setWorkspaceConversationIds((current)=>appendWorkspaceConversation(current,run.conversationId))}} onOpen={(run,origin)=>{const scrollTop=viewRef.current===origin.source?(document.querySelector('.page-stack')?.scrollTop||0):(viewScroll.current.get(origin.source)??origin.scrollTop);setAgentOrigin({view:'task',...origin,scrollTop});viewScroll.current.set('agent',0);selectWorkspaceRun(run)}} onConfigure={(origin)=>{setAiSetupOrigin({...origin,scrollTop:viewRef.current===origin.source?(document.querySelector('.page-stack')?.scrollTop||0):(viewScroll.current.get(origin.source)??origin.scrollTop)});setView('settings')}}>
    <GlobalTooltips/>
    <Shell
      activeView={view}
      provider={defaultProvider}
      healthCount={healthCount}
      applicationCount={result?.applications.length ?? 0}
      terminalCount={terminalCount}
      appVersion={appVersion}
      updateState={updateState}
      hostname={overviewMetrics?.hostname ?? result?.system.hostname ?? ''}
      osVersion={overviewMetrics?.osVersion ?? result?.system.osVersion ?? ''}
      onNavigate={(nextView) => {
        if (nextView === 'apps') setApplicationEntryFilter('all')
        setView(nextView)
      }}
      onInstallUpdate={installUpdate}
    >
      {<div hidden={view!=='processes'}><ProcessWorkspace entry={processEntry} metrics={overviewMetrics} paused={overviewPaused} error={overviewError} onPause={setOverviewPaused} onAsk={(p) => void askOverviewProcess(p)} onCopyName={(name) => void copyOverviewProcessName(name)} onCopyPid={(pid) => void copyOverviewProcessPid(pid)} onTerminate={terminateOverviewProcess} /></div>}
      {view === 'agent' && <AgentPage scan={result} run={activeRun} conversationRuns={conversationRuns} workspaceRuns={workspaceRuns} statusMessage={runStatusMessage} selectedPlanIds={selectedPlanIds} providerConfigured={Boolean(defaultProvider)} addingOperationId={addingOperationId} openingApplicationId={openingApplicationId} returnLabel={agentOriginLabel} onSubmit={startAgentRun} onSelectWorkspaceRun={selectWorkspaceRun} onCloseWorkspaceRun={closeWorkspaceRun} onNewTask={() => { setActiveRun(null); activeRunId.current = null; setSelectedPlanIds(new Set()); setRunStatusMessage(''); setAgentOrigin(null) }} onOpenHistory={() => setView('history')} onOpenSettings={() => setView('settings')} onReturn={returnToAgentOrigin} onOpenApplication={openAgentApplication} onAddPlanItem={(id) => void addAgentPlanItem(id)} onTogglePlanItem={(id) => setSelectedPlanIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onExecutePlan={() => void executePlan()} onDiscardPlan={discardPlan} />}
      {view === 'terminal' && <HealthPage
        standaloneTerminal
        result={result}
        settings={settings}
        scanBusy={scanBusy}
        progress={progress}
        storageMode={storageMode}
        restoreTarget={restoreTarget?.view === 'terminal' ? restoreTarget : null}
        onRestoreComplete={() => setRestoreTarget(null)}
        onScan={() => void scanNow()}
        onStorageModeChange={changeStorageMode}
        onRevealCandidate={revealCandidate}
        onAgentPrompt={(prompt, origin: HealthAgentOrigin) => startAgentRun(prompt, { isolated: true, origin: { view: 'terminal', ...origin, tab: 'terminal', category: 'terminal' } })}
        onDirectAction={requestDirectAction}
        onDirectActions={requestDirectActions}
        selectedIds={cleanupSelectedIds}
        onSelectedIdsChange={setCleanupSelectedIds}
        onDirectTerminalFixes={requestDirectTerminalFixes}
        onRevealTerminalFinding={(finding) => void revealTerminalFinding(finding)}
        onIgnore={setPendingIgnore}
        onManageIgnored={openIgnoredManager}
      />}
      {(['overview','health','large','duplicates','disk','privacy','apps','history'] as StorageView[]).map((storageView)=><div key={storageView} hidden={view!==storageView}>
        <StorageWorkspace view={storageView} active={view===storageView} metrics={overviewMetrics} onProcess={(sort)=>{setProcessEntry({sort,token:Date.now()});setView('processes')}} onNavigate={setView} activity={storageActivity} onActivity={setStorageActivity} historyChildren={storageView==='history'?<HistoryPage runs={runs} maintenanceRuns={maintenanceRuns} onOpenRun={(run) => { setActiveRun(run); activeRunId.current = run.id; setSelectedPlanIds(new Set()); setView('agent') }} onDeleteRuns={setPendingHistoryDelete} onDeleteMaintenanceRuns={setPendingMaintenanceDelete} onRevealRecovery={revealMaintenanceRecovery} />:undefined} />
      </div>)}
      {view==='settings'&&aiSetupOrigin&&<div className="ai-setup-return"><button className="space-button" onClick={()=>{viewScroll.current.set(aiSetupOrigin.source,aiSetupOrigin.scrollTop);setView(aiSetupOrigin.source);setAiSetupOrigin(null)}}><ArrowLeft size={15}/>{appText('tasks.return',{page:appText(`nav.${aiSetupOrigin.source==='overview'?'home':aiSetupOrigin.source==='health'?'cleanup':aiSetupOrigin.source}`)})}</button><span>{appText('tasks.resumeAfterSetup')}</span></div>}
      {view === 'settings' && <SettingsPage settings={settings} providers={providers} appVersion={appVersion} updateState={updateState} onUpdateSettings={updateSettings} onDiscoverModels={discoverProviderModels} onSaveProvider={saveProvider} onTestProvider={testProvider} onDeleteProvider={deleteProvider} onSetDefaultProvider={setDefaultProvider} onImportLocalAi={importLocalAiConfigurations} onImportCcSwitch={importCcSwitchProviders} onCheckUpdates={checkForUpdates} onManageIgnored={() => openIgnoredManager()} onToast={setToast} />}

      {pendingDirectAction && <DirectActionConfirmDialog action={pendingDirectAction} onClose={() => setPendingDirectAction(null)} onConfirm={() => void executeDirectAction()} />}
      {executionState && <ExecutionProgressDialog phase={executionState.phase} verificationMode={executionState.verificationMode} progress={executionState.progress} itemCount={executionState.itemCount} completedCount={executionState.completedCount} detail={executionState.detail} items={executionState.items} onRetry={executionState.retryAction ? () => void executeDirectAction(executionState.retryAction) : undefined} onClose={() => setExecutionState(null)} />}
      {pendingUninstall && <UninstallDialog application={pendingUninstall} busy={uninstallBusy} onClose={() => setPendingUninstall(null)} onConfirm={() => void uninstallApplication()} />}
      {pendingDiskUsageTrash && <DiskUsageTrashDialog node={pendingDiskUsageTrash} busy={diskUsageTrashBusy} onClose={() => setPendingDiskUsageTrash(null)} onConfirm={() => void trashDiskUsageNode()} />}
      {pendingIgnore && <IgnoreConfirmDialog candidate={pendingIgnore} busy={ignoreBusy} onClose={() => setPendingIgnore(null)} onConfirm={() => void confirmIgnore()} />}
      {pendingApplicationIgnore && <ApplicationIgnoreConfirmDialog application={pendingApplicationIgnore} busy={ignoreBusy} onClose={() => setPendingApplicationIgnore(null)} onConfirm={() => void confirmApplicationIgnore()} />}
      {ignoredManagerOpen && <IgnoredItemsDialog initialKind={ignoredManagerKind} serviceValues={settings.serviceWhitelist} storageValues={settings.storageWhitelist} applicationValues={settings.applicationWhitelist} ignoredApplications={result?.ignoredApplications ?? []} busyValue={restoreBusyValue} onRestore={(kind, value) => void restoreIgnored(kind, value)} onClose={() => setIgnoredManagerOpen(false)} />}
      {pendingHistoryDelete && <DeleteHistoryDialog runs={pendingHistoryDelete} busy={historyDeleteBusy} onClose={() => setPendingHistoryDelete(null)} onConfirm={() => void deleteHistoryRun()} />}
      {pendingMaintenanceDelete && <DeleteMaintenanceHistoryDialog runs={pendingMaintenanceDelete} busy={historyDeleteBusy} onClose={() => setPendingMaintenanceDelete(null)} onConfirm={() => void deleteMaintenanceHistory()} />}
      {toast && <div className="toast is-visible" role="status"><CheckCircle2 size={16} /><span>{toast}</span></div>}
    </Shell>
    </AiTaskProvider>
  )
}

export default function App(): React.JSX.Element {
  const [language, setLanguage] = useState(DEFAULT_APP_SETTINGS.language)
  return <I18nProvider language={language}><AppContent onLanguageChange={setLanguage} /></I18nProvider>
}
