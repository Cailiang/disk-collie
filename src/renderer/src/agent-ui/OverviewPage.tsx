import {
  Activity,
  AppWindow,
  ArrowDownUp,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BrainCircuit,
  Copy,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  MoreHorizontal,
  Network,
  Pause,
  Power,
  Play,
  RefreshCw,
  Search,
  Skull,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InstalledApplication, OverviewHealthIssue, OverviewMetrics } from '../../../shared/types'
import type { ApplicationFilter } from './ApplicationsPage'
import { useI18n } from '../i18n'
import { formatBytes, formatStorageBytes } from './utils'
import { ApplicationIcon } from './ApplicationsPage'

const HISTORY_LIMIT = 28

function boundedHistory(current: number[], value: number): number[] {
  return [...current, value].slice(-HISTORY_LIMIT)
}

function Sparkline({
  values,
  maximum = 100,
  secondary = false
}: {
  values: number[]
  maximum?: number
  secondary?: boolean
}): React.JSX.Element {
  const safeValues = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0]
  const ceiling = Math.max(maximum, ...safeValues, 1)
  const points = safeValues.map((value, index) => {
    const x = index / Math.max(1, safeValues.length - 1) * 100
    const y = 31 - Math.min(1, Math.max(0, value / ceiling)) * 27
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  return (
    <svg className={`overview-sparkline ${secondary ? 'is-secondary' : ''}`} viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  )
}

function BarHistory({ values }: { values: number[] }): React.JSX.Element {
  const safeValues = values.length ? values.slice(-10) : [0]
  return <div className="overview-bars" aria-hidden="true">{safeValues.map((value, index) => <i key={index} style={{ height: `${Math.max(8, Math.min(100, value))}%` }} />)}</div>
}

function HealthGauge({ value }: { value: number }): React.JSX.Element {
  const radius = 30
  const circumference = Math.PI * radius
  return (
    <svg className="overview-health-gauge" viewBox="0 0 76 46" role="img" aria-label={`${value}%`}>
      <path d="M 8 39 A 30 30 0 0 1 68 39" pathLength={circumference} className="gauge-track" />
      <path d="M 8 39 A 30 30 0 0 1 68 39" pathLength={circumference} className="gauge-value" strokeDasharray={`${circumference * value / 100} ${circumference}`} />
    </svg>
  )
}

function formatRate(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB/s`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB/s`
}

function applicationForProcess(
  process: OverviewMetrics['processes'][number],
  applications: readonly InstalledApplication[]
): InstalledApplication | null {
  const command = process.command.trim()
  return applications.find((application) => (
    command === application.location || command.startsWith(`${application.location}/`)
  )) ?? null
}

function ProcessIcon({ process, application }: {
  process: OverviewMetrics['processes'][number]
  application: InstalledApplication | null
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '120px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    if (!visible || application || !window.memento) return
    void window.memento.getProcessIcon(process.command).then((value) => {
      if (active) setSource(value)
    })
    return () => { active = false }
  }, [application, process.command, visible])

  return <div className="app-logo" ref={ref}>{application
    ? <ApplicationIcon application={application} />
    : source
      ? <img src={source} alt="" />
      : <span className="process-logo-fallback"><Activity size={13} /></span>}</div>
}

function healthIssueLabel(issue: OverviewHealthIssue, language: 'zh-CN' | 'en-US'): string {
  const labels: Record<OverviewHealthIssue, [string, string]> = {
    'cpu-high': ['CPU 持续高负载', 'High CPU load'],
    'memory-high': ['内存占用偏高', 'High memory usage'],
    'disk-low': ['磁盘空间不足', 'Low disk space'],
    'thermal-limited': ['系统正在限制性能', 'Performance is thermally limited'],
    'battery-service': ['电池健康度偏低', 'Battery service recommended'],
    'restart-recommended': ['运行时间较长', 'Long uptime']
  }
  return labels[issue][language === 'en-US' ? 1 : 0]
}

function OverviewSkeleton(): React.JSX.Element {
  return (
    <section className="page content-page overview-page is-active" aria-busy="true">
      <div className="overview-grid overview-skeleton-grid">
        {Array.from({ length: 8 }, (_, index) => <div className="overview-card overview-skeleton" key={index}><i /><i /><i /></div>)}
      </div>
      <div className="overview-process-panel overview-skeleton"><i /><i /><i /></div>
    </section>
  )
}

export function OverviewPage({
  metrics,
  busy,
  paused,
  error,
  applicationsLoading,
  applicationScanProgress,
  onRefresh,
  onPausedChange,
  onAskProcess,
  onCopyProcessName,
  onCopyProcessPid,
  onTerminateProcess,
  applications,
  onOpenApplications,
  onOpenDisk,
  onOpenSystemSettings,
  onOpenActivityMonitorNetwork
}: {
  metrics: OverviewMetrics | null
  busy: boolean
  paused: boolean
  error: string | null
  applicationsLoading: boolean
  applicationScanProgress: number | null
  onRefresh: () => void
  onPausedChange: (paused: boolean) => void
  onAskProcess: (process: OverviewMetrics['processes'][number]) => void
  onCopyProcessName: (name: string) => void
  onCopyProcessPid: (pid: number) => void
  onTerminateProcess: (process: OverviewMetrics['processes'][number], force: boolean) => void
  applications: readonly InstalledApplication[]
  onOpenApplications: (filter?: ApplicationFilter) => void
  onOpenDisk: () => void
  onOpenSystemSettings: (section: 'battery' | 'network') => void
  onOpenActivityMonitorNetwork: () => void
}): React.JSX.Element {
  const { language, text } = useI18n()
  const [query, setQuery] = useState('')
  const [processSort, setProcessSort] = useState<'name' | 'cpu' | 'memory'>('cpu')
  const [processSortDirection, setProcessSortDirection] = useState<'asc' | 'desc'>('desc')
  const [processScope, setProcessScope] = useState<'all' | 'user' | 'system'>('all')
  const [openProcessMenu, setOpenProcessMenu] = useState<number | null>(null)
  const [processInteractionActive, setProcessInteractionActive] = useState(false)
  const [heldProcesses, setHeldProcesses] = useState<OverviewMetrics['processes']>([])
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [gpuHistory, setGpuHistory] = useState<number[]>([])
  const [memoryHistory, setMemoryHistory] = useState<number[]>([])
  const [networkReceivedHistory, setNetworkReceivedHistory] = useState<number[]>([])
  const [networkSentHistory, setNetworkSentHistory] = useState<number[]>([])
  const processPanelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!metrics) return
    setCpuHistory((current) => boundedHistory(current, metrics.cpu.usagePercent))
    setGpuHistory((current) => boundedHistory(current, metrics.gpu.usagePercent ?? 0))
    setMemoryHistory((current) => boundedHistory(current, metrics.memory.usedPercent))
    setNetworkReceivedHistory((current) => boundedHistory(current, metrics.network.receivedBytesPerSecond))
    setNetworkSentHistory((current) => boundedHistory(current, metrics.network.sentBytesPerSecond))
  }, [metrics])

  useEffect(() => {
    if (!processInteractionActive) setHeldProcesses(metrics?.processes ?? [])
  }, [metrics?.processes, processInteractionActive])

  const processes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return [...(processInteractionActive ? heldProcesses : metrics?.processes ?? [])]
      .filter((process) => processScope === 'all' || (processScope === 'system' ? process.isSystem : !process.isSystem))
      .filter((process) => !normalized || `${process.name} ${process.command} ${process.pid}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => {
        const result = processSort === 'name'
          ? left.name.localeCompare(right.name, language)
          : processSort === 'cpu'
            ? right.cpuPercent - left.cpuPercent
            : right.memoryBytes - left.memoryBytes
        return processSortDirection === 'asc' ? -result : result
      })
  }, [heldProcesses, language, metrics?.processes, processInteractionActive, processScope, processSort, processSortDirection, query])

  const beginProcessInteraction = (): void => {
    setHeldProcesses(metrics?.processes ?? [])
    setProcessInteractionActive(true)
  }

  const endProcessInteraction = (): void => {
    setProcessInteractionActive(false)
    setOpenProcessMenu(null)
  }

  const closeProcessMenu = (): void => {
    setOpenProcessMenu(null)
    setProcessInteractionActive(false)
  }

  const chooseProcessSort = (sort: 'name' | 'cpu' | 'memory'): void => {
    if (sort === processSort) {
      setProcessSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setProcessSort(sort)
    setProcessSortDirection(sort === 'name' ? 'asc' : 'desc')
  }

  const focusProcessList = (sort: 'cpu' | 'memory'): void => {
    setProcessSort(sort)
    setProcessSortDirection('desc')
    setProcessScope('all')
    window.requestAnimationFrame(() => processPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const activateCard = (event: React.KeyboardEvent<HTMLElement>, action: () => void): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  const confirmTerminate = (process: OverviewMetrics['processes'][number], force: boolean): void => {
    if (force && !window.confirm(text("legacy.force_quit_pid_unsaved_data_may_be_lost.56f8ba", { p0: process.name, p1: process.pid }))) return
    closeProcessMenu()
    onTerminateProcess(process, force)
  }

  if (!metrics && busy) return <OverviewSkeleton />
  if (!metrics) {
    return (
      <section className="page content-page overview-page is-active">
        <div className="overview-error-state"><Activity size={24} /><strong>{text("legacy.could_not_read_this_mac.14fd55")}</strong><span>{error ?? text("legacy.try_again.889f53")}</span><button type="button" className="primary-button" onClick={onRefresh}><RefreshCw size={15} />{text("legacy.retry.2b57d6")}</button></div>
      </section>
    )
  }

  const healthStatus = {
    excellent: text("legacy.excellent.1aed42"),
    good: text("legacy.good.7fdcc5"),
    fair: text("legacy.needs_review.5a4c5d"),
    attention: text("legacy.needs_attention.7cc748")
  }[metrics.health.status]
  const healthSummary = metrics.health.issues.length
    ? metrics.health.issues.slice(0, 2).map((issue) => healthIssueLabel(issue, language)).join(' · ')
    : text("legacy.no_significant_resource_pressure.3787b8")
  const batteryIcon = metrics.battery.status === 'charging'
    ? BatteryCharging
    : (metrics.battery.percent ?? 0) >= 95 ? BatteryFull : BatteryMedium
  const BatteryIcon = batteryIcon
  const maxNetwork = Math.max(...networkReceivedHistory, ...networkSentHistory, 1024)
  const unusedApplications = applications.filter((application) => application.unused).length
  const updateableApplications = applications.filter((application) => application.updateAvailable).length
  const applicationProgress = applicationsLoading
    ? Math.min(96, Math.max(8, applicationScanProgress ?? 12))
    : 100

  return (
    <section className="page content-page overview-page is-active">
      <div className="overview-command-bar">
        <span>{text("legacy.live_status.d253b7")} · {paused ? text("legacy.paused.30dbde") : text("legacy.updates_every_2_5_seconds.d4767c")}</span>
        <div>
          <button type="button" className="icon-button" onClick={() => onPausedChange(!paused)} title={paused ? text("legacy.resume_updates.05f00d") : text("legacy.pause_updates.fc2e36")} aria-label={paused ? text("legacy.resume_updates.05f00d") : text("legacy.pause_updates.fc2e36")}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
          <button type="button" className="icon-button" onClick={onRefresh} disabled={busy} title={text("legacy.refresh_now.6a9999")} aria-label={text("legacy.refresh_now.6a9999")}><RefreshCw className={busy ? 'spinner' : ''} size={15} /></button>
        </div>
      </div>

      {error && <div className="overview-inline-warning" role="status"><Activity size={14} /><span>{error}</span></div>}

      <div className="overview-grid">
        <article className={`overview-card overview-health-card status-${metrics.health.status}`}>
          <header><span><Gauge size={15} />{text("legacy.health.b6a3f4")}</span><small>{metrics.hardware.model}</small></header>
          <div className="overview-health-value"><div><strong>{metrics.health.score}</strong><span>{healthStatus}</span></div><HealthGauge value={metrics.health.score} /></div>
          <p>{healthSummary}</p>
          <footer><span>{metrics.hardware.cpuModel.replace(/\s+CPU.*$/, '')}</span><span>{formatBytes(metrics.memory.totalBytes)}</span><span>macOS {metrics.osVersion}</span></footer>
        </article>

        <article className="overview-card overview-card-link" role="button" tabIndex={0} onClick={() => focusProcessList('cpu')} onKeyDown={(event) => activateCard(event, () => focusProcessList('cpu'))} title={text("legacy.view_processes_sorted_by_cpu_usage.f22bef")}>
          <header><span><Cpu size={15} />CPU</span><small>{metrics.hardware.logicalCores} {text("legacy.threads.02f3a5")}</small></header>
          <div className="overview-metric-value"><strong>{Math.round(metrics.cpu.usagePercent)}</strong><em>%</em></div>
          <BarHistory values={cpuHistory} />
          <footer><span>{text("legacy.load.fd46ea")} {metrics.cpu.loadAverage.map((value) => value.toFixed(2)).join(' / ')}</span><span className="overview-card-link-label">{text("legacy.view_processes.8a1491")}</span></footer>
        </article>

        <article className="overview-card">
          <header><span><Activity size={15} />GPU</span><small>{metrics.gpu.name ? text("legacy.graphics.609659") : text("legacy.unavailable.250f24")}</small></header>
          <div className="overview-metric-value"><strong>{metrics.gpu.usagePercent === null ? '--' : Math.round(metrics.gpu.usagePercent)}</strong>{metrics.gpu.usagePercent !== null && <em>%</em>}</div>
          <Sparkline values={gpuHistory} />
          <footer><span>{metrics.gpu.name ?? text("legacy.utilization_is_not_exposed_by_macos.cf2066")}</span></footer>
        </article>

        <article className="overview-card overview-card-link" role="button" tabIndex={0} onClick={() => focusProcessList('memory')} onKeyDown={(event) => activateCard(event, () => focusProcessList('memory'))} title={text("legacy.view_processes_sorted_by_memory_usage.c3814b")}>
          <header><span><MemoryStick size={15} />{text("legacy.memory.2cbbca")}</span><small>{text("legacy.available.e21a3c")} {formatBytes(metrics.memory.availableBytes)}</small></header>
          <div className="overview-metric-value"><strong>{Math.round(metrics.memory.usedPercent)}</strong><em>%</em></div>
          <Sparkline values={memoryHistory} />
          <footer><span>{formatBytes(metrics.memory.usedBytes)} / {formatBytes(metrics.memory.totalBytes)}</span><span className="overview-card-link-label">{text("legacy.view_processes.8a1491")}</span></footer>
        </article>

        <article className="overview-card overview-card-link" role="button" tabIndex={0} onClick={() => onOpenSystemSettings('battery')} onKeyDown={(event) => activateCard(event, () => onOpenSystemSettings('battery'))} title={text("legacy.open_battery_settings.ee6dc6")}>
          <header><span><BatteryIcon size={15} />{text("legacy.battery.a62eb9")}</span><small>{metrics.battery.available ? (metrics.battery.powerSource === 'ac' ? text("legacy.ac_power.282cb8") : text("legacy.on_battery.be44d8")) : text("legacy.not_detected.c55674")}</small></header>
          <div className="overview-metric-value"><strong>{metrics.battery.percent ?? '--'}</strong>{metrics.battery.percent !== null && <em>%</em>}</div>
          <div className="overview-progress"><i style={{ width: `${metrics.battery.percent ?? 0}%` }} /></div>
          <footer><span>{metrics.battery.healthPercent !== null ? text("legacy.health.69c403", { p0: Math.round(metrics.battery.healthPercent) }) : text("legacy.health_unavailable.b7a83d")}</span><span className="overview-card-link-label">{text("legacy.system_settings.135272")}</span></footer>
        </article>

        <article className="overview-card overview-card-link" role="button" tabIndex={0} onClick={onOpenDisk} onKeyDown={(event) => activateCard(event, onOpenDisk)} title={text("legacy.open_disk_analysis.8734e1")}>
          <header><span><HardDrive size={15} />{text("legacy.disk.8a4e68")}</span><small>{formatStorageBytes(metrics.disk.totalBytes)}</small></header>
          <div className="overview-metric-value"><strong>{formatStorageBytes(metrics.disk.availableBytes)}</strong><em>{text("legacy.available.0eb4bd")}</em></div>
          <div className="overview-progress"><i style={{ width: `${metrics.disk.usedPercent}%` }} /></div>
          <footer><span>{text("legacy.includes_macos_purgeable_space.6605e9")}</span><span className="overview-card-link-label">{text("legacy.open_analysis.6f7e15")}</span></footer>
        </article>

        <article className="overview-card overview-card-link" role="button" tabIndex={0} onClick={onOpenActivityMonitorNetwork} onKeyDown={(event) => activateCard(event, onOpenActivityMonitorNetwork)} title={text("legacy.open_activity_monitor_network.6ece5d")}>
          <header><span><Network size={15} />{text("legacy.network.eb8f65")}</span><small>{metrics.network.interfaceName ?? text("legacy.offline.0c4f82")}</small></header>
          <div className="overview-network-values"><strong>↓ {formatRate(metrics.network.receivedBytesPerSecond)}</strong><span>↑ {formatRate(metrics.network.sentBytesPerSecond)}</span></div>
          <Sparkline values={networkReceivedHistory} maximum={maxNetwork} />
          <Sparkline values={networkSentHistory} maximum={maxNetwork} secondary />
          <footer><span>{text("legacy.interface.8f812d")} · {metrics.network.interfaceName ?? '--'}</span><span className="overview-card-link-label">{text("legacy.activity_monitor.6210fd")}</span></footer>
        </article>

        <article className="overview-card overview-card-link overview-application-card" role="button" tabIndex={0} onClick={() => onOpenApplications()} onKeyDown={(event) => activateCard(event, () => onOpenApplications())} title={text("legacy.open_applications.47a206")}>
          <header><span><AppWindow size={15} />{text("legacy.application_analysis.4683fa")}</span><small>{text("legacy.open_list.a85277")}</small></header>
          <div className="overview-application-total"><strong>{applicationsLoading ? '—' : applications.length}</strong><span>{applicationsLoading ? text("legacy.scanning.12a218") : text("legacy.installed_apps.06cd1f")}</span></div>
          {applicationsLoading && <div className="overview-application-loading" role="progressbar" aria-label={text("legacy.application_scan_progress.e242e6")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={applicationProgress}><span style={{ width: `${applicationProgress}%` }} /></div>}
          <div className="overview-application-stats">
            <button type="button" className="overview-application-stat" onClick={(event) => { event.stopPropagation(); onOpenApplications('unused') }} disabled={applicationsLoading} title={text("legacy.view_unused_applications.c92fee")}><strong>{applicationsLoading ? '—' : unusedApplications}</strong>{text("legacy.unused.bfa0f3")}</button>
            <button type="button" className="overview-application-stat" onClick={(event) => { event.stopPropagation(); onOpenApplications('updates') }} disabled={applicationsLoading} title={text("legacy.view_applications_with_updates.f77e89")}><strong>{applicationsLoading ? '—' : updateableApplications}</strong>{text("legacy.updates.48d9f8")}</button>
          </div>
          <footer><span>{text("legacy.click_a_number_to_filter.0458f0")}</span><span className="overview-card-link-label">{text("legacy.applications.516cc6")}</span></footer>
        </article>
      </div>

      <section
        ref={processPanelRef}
        className="overview-process-panel"
        onPointerEnter={beginProcessInteraction}
        onPointerLeave={endProcessInteraction}
        onFocusCapture={beginProcessInteraction}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) endProcessInteraction()
        }}
      >
        <header>
          <div className="overview-process-title"><div><strong>{text("legacy.processes.67e64c")}</strong><span>{text("legacy.sampled_processes.47f240", { p0: metrics.processes.length })}</span></div><div className="process-scope-filter" role="tablist" aria-label={text("legacy.process_type.a9b208")}>
            {(['all', 'user', 'system'] as const).map((scope) => <button key={scope} type="button" role="tab" aria-selected={processScope === scope} className={processScope === scope ? 'is-active' : ''} onClick={() => setProcessScope(scope)}>{scope === 'all' ? text("legacy.all.bafb97") : scope === 'user' ? text("legacy.user.b9e955") : text("legacy.system.5b103d")}</button>)}
          </div></div>
          <label className="search-field overview-process-search"><Search size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text("legacy.search_name_or_pid.5baadd")} aria-label={text("legacy.search_processes.83c91a")} /></label>
        </header>
        <div className="overview-process-head">
          <button type="button" className={processSort === 'name' ? 'is-active' : ''} onClick={() => chooseProcessSort('name')} aria-sort={processSort === 'name' ? processSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{text("legacy.process.17f9ae")}<ArrowDownUp size={11} /></button>
          <span>PID</span>
          <button type="button" className={processSort === 'cpu' ? 'is-active' : ''} onClick={() => chooseProcessSort('cpu')} aria-sort={processSort === 'cpu' ? processSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>CPU<ArrowDownUp size={11} /></button>
          <button type="button" className={processSort === 'memory' ? 'is-active' : ''} onClick={() => chooseProcessSort('memory')} aria-sort={processSort === 'memory' ? processSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{text("legacy.memory.2cbbca")}<ArrowDownUp size={11} /></button>
          <span aria-hidden="true" />
        </div>
        <div className="overview-process-list">
          {processes.length ? processes.map((process) => {
            const processApplication = applicationForProcess(process, applications)
            return <div className={`overview-process-row ${process.isSystem ? 'is-system' : 'is-user'}`} key={process.pid}>
              <span className="overview-process-name"><span className="process-logo"><ProcessIcon process={process} application={processApplication} /></span><strong>{process.name}</strong><small>{process.command} · <span className="process-scope-label">{process.isSystem ? text("legacy.system_process.bf94b7") : text("legacy.user_process.48776d")}</span></small></span>
              <span>{process.pid}</span>
              <span className={process.cpuPercent >= 80 ? 'is-hot' : ''}><i className="process-meter"><b style={{ width: `${Math.min(100, process.cpuPercent)}%` }} /></i><strong>{process.cpuPercent.toFixed(1)}%</strong></span>
              <span><strong>{formatBytes(process.memoryBytes)}</strong><small>{process.memoryPercent.toFixed(1)}%</small></span>
              <span className="overview-process-actions">
                <button type="button" className="icon-button process-menu-button" onClick={() => { beginProcessInteraction(); setOpenProcessMenu((current) => current === process.pid ? null : process.pid) }} title={text("legacy.process_actions.0609ce")} aria-label={text("legacy.open_actions_for.9d74bf", { p0: process.name })} aria-expanded={openProcessMenu === process.pid}><MoreHorizontal size={15} /></button>
                {openProcessMenu === process.pid && <span className="process-action-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { closeProcessMenu(); onAskProcess(process) }}><BrainCircuit size={13} />{text("legacy.ask_ai.8b825f")}</button>
                  <button type="button" role="menuitem" onClick={() => { closeProcessMenu(); onCopyProcessName(process.name) }}><Copy size={13} />{text("legacy.copy_name.f4caba")}</button>
                  <button type="button" role="menuitem" onClick={() => { closeProcessMenu(); onCopyProcessPid(process.pid) }}><Copy size={13} />{text("legacy.copy_pid.0decae")}</button>
                  {!process.isSystem && <>
                    <button type="button" role="menuitem" onClick={() => confirmTerminate(process, false)}><Power size={13} />{text("legacy.quit_process.3b2954")}</button>
                    <button type="button" role="menuitem" className="is-danger" onClick={() => confirmTerminate(process, true)}><Zap size={13} />{text("legacy.force_quit.0fe9c5")}</button>
                  </>}
                  {process.isSystem && <span className="process-action-note"><Skull size={12} />{text("legacy.system_process_protected.3a849f")}</span>}
                </span>}
              </span>
            </div>
          }) : <div className="overview-process-empty">{text("legacy.no_matching_processes.509d7d")}</div>}
        </div>
      </section>
    </section>
  )
}
