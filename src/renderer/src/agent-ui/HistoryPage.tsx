import { ChevronRight, FolderOpen, History, Search, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunRecord } from '../../../shared/agent-types'
import type { MaintenanceRunRecord } from '../../../shared/maintenance-types'
import { useI18n } from '../i18n'
import { formatBytes, formatDateTime, runStatusLabel } from './utils'

type HistoryMode = 'maintenance' | 'agent'

function maintenanceSourceLabel(source: MaintenanceRunRecord['source'], language: 'zh-CN' | 'en-US'): string {
  const labels: Record<MaintenanceRunRecord['source'], [string, string]> = {
    direct: ['直接操作', 'Direct'],
    agent: ['Agent 计划', 'Agent plan'],
    'disk-browser': ['磁盘浏览', 'Disk browser'],
    terminal: ['终端优化', 'Terminal'],
    undo: ['恢复操作', 'Restore']
  }
  return language === 'en-US' ? labels[source][1] : labels[source][0]
}

function maintenanceStatusLabel(status: MaintenanceRunRecord['status'], language: 'zh-CN' | 'en-US'): string {
  const labels: Record<MaintenanceRunRecord['status'], [string, string]> = {
    running: ['执行中', 'Running'],
    completed: ['已完成', 'Completed'],
    partial: ['部分完成', 'Partial'],
    failed: ['失败', 'Failed']
  }
  return language === 'en-US' ? labels[status][1] : labels[status][0]
}

export function HistoryPage({
  runs,
  maintenanceRuns,
  onOpenRun,
  onDeleteRuns,
  onDeleteMaintenanceRuns,
  onRevealRecovery
}: {
  runs: AgentRunRecord[]
  maintenanceRuns: MaintenanceRunRecord[]
  onOpenRun: (run: AgentRunRecord) => void
  onDeleteRuns: (runs: AgentRunRecord[]) => void
  onDeleteMaintenanceRuns: (runs: MaintenanceRunRecord[]) => void
  onRevealRecovery: (operationRecordId: string) => void
}): React.JSX.Element {
  const { language, text } = useI18n()
  const [mode, setMode] = useState<HistoryMode>('maintenance')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const filteredAgentRuns = useMemo(() => runs.filter((run) => !normalized || [
    run.prompt,
    run.providerName,
    run.model,
    runStatusLabel(run.status, language),
    run.response ?? '',
    run.error ?? ''
  ].some((value) => value.toLocaleLowerCase().includes(normalized))), [language, normalized, runs])
  const filteredMaintenanceRuns = useMemo(() => maintenanceRuns.filter((run) => !normalized || [
    run.title,
    maintenanceSourceLabel(run.source, language),
    maintenanceStatusLabel(run.status, language),
    ...run.operations.flatMap((operation) => [
      operation.title,
      operation.kind,
      operation.errorCode ?? '',
      operation.message ?? ''
    ])
  ].some((value) => value.toLocaleLowerCase().includes(normalized))), [language, maintenanceRuns, normalized])
  const visibleIds = mode === 'agent'
    ? filteredAgentRuns.filter((run) => !['preparing', 'analyzing', 'plan-ready', 'executing', 'verifying'].includes(run.status)).map((run) => run.id)
    : filteredMaintenanceRuns.filter((run) => run.status !== 'running').map((run) => run.id)
  const allFilteredSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const someFilteredSelected = visibleIds.some((id) => selectedIds.has(id))
  const selectedAgentRuns = filteredAgentRuns.filter((run) => selectedIds.has(run.id))
  const selectedMaintenanceRuns = filteredMaintenanceRuns.filter((run) => selectedIds.has(run.id))

  useEffect(() => {
    setSelectedIds(new Set())
    setQuery('')
  }, [mode])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected
  }, [allFilteredSelected, someFilteredSelected])

  const toggleSelected = (id: string): void => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const toggleAll = (): void => setSelectedIds((current) => {
    const next = new Set(current)
    if (allFilteredSelected) visibleIds.forEach((id) => next.delete(id))
    else visibleIds.forEach((id) => next.add(id))
    return next
  })

  const selectedCount = mode === 'agent' ? selectedAgentRuns.length : selectedMaintenanceRuns.length
  const total = mode === 'agent' ? runs.length : maintenanceRuns.length
  const filteredCount = mode === 'agent' ? filteredAgentRuns.length : filteredMaintenanceRuns.length

  return (
    <section className="page content-page is-active">
      <div className="page-command-bar">
        <div className="history-mode-tabs" role="tablist" aria-label={text("legacy.history_type.140a41")}>
          <button type="button" role="tab" aria-selected={mode === 'maintenance'} className={mode === 'maintenance' ? 'is-active' : ''} onClick={() => setMode('maintenance')}>{text("legacy.maintenance.b573f3")} <span>{maintenanceRuns.length}</span></button>
          <button type="button" role="tab" aria-selected={mode === 'agent'} className={mode === 'agent' ? 'is-active' : ''} onClick={() => setMode('agent')}>{text("legacy.agent.67d46f")} <span>{runs.length}</span></button>
        </div>
        <div className="history-command-actions">
          {selectedCount > 0 && <button type="button" className="danger-button history-bulk-delete" onClick={() => mode === 'agent' ? onDeleteRuns(selectedAgentRuns) : onDeleteMaintenanceRuns(selectedMaintenanceRuns)}><Trash2 size={14} />{text("legacy.delete_selected.e21e63", { p0: selectedCount })}</button>}
          <label className="search-field history-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text("legacy.search_titles_operations_or_status.2f3aff")} aria-label={text("legacy.search_history.fb97dd")} /></label>
        </div>
      </div>

      {filteredCount > 0 ? (
        <div className="history-table">
          <div className="history-head">
            <label className="history-check"><input ref={selectAllRef} type="checkbox" checked={allFilteredSelected} disabled={!visibleIds.length} onChange={toggleAll} aria-label={text("legacy.select_all_filtered_history.1d559e")} /></label>
            <span>{text("legacy.task.b094e4")}</span><span>{text("legacy.status.8042ea")}</span><span>{text("legacy.time.772ed3")}</span><span>{text("legacy.result.df9aef")}</span><span />
          </div>
          {mode === 'agent' ? filteredAgentRuns.map((run) => {
            const deletable = !['preparing', 'analyzing', 'plan-ready', 'executing', 'verifying'].includes(run.status)
            const reclaimed = run.plan.reduce((sum, item) => sum + item.estimatedBytes, 0)
            return (
              <div className="history-entry" key={run.id}>
                <label className="history-check history-row-check"><input type="checkbox" checked={selectedIds.has(run.id)} disabled={!deletable} onChange={() => toggleSelected(run.id)} aria-label={text("legacy.select.07ce81", { p0: run.prompt })} /></label>
                <button type="button" className="history-row" onClick={() => onOpenRun(run)}>
                  <span className="history-title"><strong>{run.prompt}</strong><small>{text("legacy.plan_steps.7d8ace", { p0: run.plan.length, p1: run.providerName, p2: run.model })}</small></span>
                  <span><span className={`risk-label ${run.status === 'completed' ? 'safe' : run.status === 'failed' ? 'danger' : 'review'}`}>{runStatusLabel(run.status, language)}</span></span>
                  <span>{formatDateTime(run.createdAt, language)}</span>
                  <span>{run.results.length ? text("legacy.completed.f64192", { p0: run.results.filter((item) => item.ok).length }) : reclaimed ? formatBytes(reclaimed) : text("legacy.read_only.5ebe60")}</span>
                  <span><ChevronRight size={15} /></span>
                </button>
                <button type="button" className="icon-button history-delete" disabled={!deletable} onClick={() => onDeleteRuns([run])} title={text("legacy.delete_history.10cfc7")} aria-label={text("legacy.delete_history_for.8018ca", { p0: run.prompt })}><Trash2 size={14} /></button>
              </div>
            )
          }) : filteredMaintenanceRuns.map((run) => {
            const completed = run.operations.filter((operation) => operation.status === 'completed')
            const recovery = completed.find((operation) => operation.recoveryAvailable)
            const estimatedBytes = completed.reduce((sum, operation) => sum + (operation.estimatedBytes ?? 0), 0)
            return (
              <div className="history-entry" key={run.id}>
                <label className="history-check history-row-check"><input type="checkbox" checked={selectedIds.has(run.id)} disabled={run.status === 'running'} onChange={() => toggleSelected(run.id)} aria-label={text("legacy.select.07ce81", { p0: run.title })} /></label>
                <div className="history-row maintenance-history-row">
                  <span className="history-title"><strong>{run.title}</strong><small>{maintenanceSourceLabel(run.source, language)} · {run.operations.map((operation) => operation.title).join('；')}</small></span>
                  <span><span className={`risk-label ${run.status === 'completed' ? 'safe' : run.status === 'failed' ? 'danger' : 'review'}`}>{maintenanceStatusLabel(run.status, language)}</span></span>
                  <span>{formatDateTime(run.createdAt, language)}</span>
                  <span>{estimatedBytes ? formatBytes(estimatedBytes) : text("legacy.completed.6a8e61", { p0: completed.length, p1: run.operations.length })}</span>
                  <span>{recovery && <button type="button" className="icon-button history-recovery" onClick={() => onRevealRecovery(recovery.id)} title={recovery.recoveryMode === 'trash' ? text("legacy.open_trash.26653e") : text("legacy.show_configuration_backup.613295")} aria-label={recovery.recoveryMode === 'trash' ? text("legacy.open_trash.26653e") : text("legacy.show_configuration_backup.613295")}><FolderOpen size={14} /></button>}</span>
                </div>
                <button type="button" className="icon-button history-delete" disabled={run.status === 'running'} onClick={() => onDeleteMaintenanceRuns([run])} title={text("legacy.delete_audit_record.fb0a4f")} aria-label={text("legacy.delete_history_for.8018ca", { p0: run.title })}><Trash2 size={14} /></button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="history-empty">{query.trim() ? <Search size={20} /> : mode === 'agent' ? <History size={20} /> : <Wrench size={20} />}<strong>{query.trim() ? text("legacy.no_matching_records.b843c9") : mode === 'agent' ? text("legacy.no_agent_history_yet.9b009d") : text("legacy.no_maintenance_history_yet.9406fc")}</strong><span>{query.trim() ? text("legacy.total_records.bd53d4", { p0: total }) : mode === 'agent' ? text("legacy.start_the_first_task_from_agent.cebbf8") : text("legacy.direct_cleanup_terminal_fixes_and_agent_pl.8a69a0")}</span></div>
      )}
    </section>
  )
}
