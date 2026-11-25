import {
  Archive,
  AppWindow,
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Play,
  RadioTower,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProvider, AgentRunRecord } from '../../../shared/agent-types'
import type { MaintenanceRunRecord } from '../../../shared/maintenance-types'
import {
  applicationWhitelistValue,
  candidateWhitelistValue
} from '../../../shared/app-settings'
import type { DiskUsageNode, InstalledApplication, ScanCandidate } from '../../../shared/types'
import { useI18n } from '../i18n'
import { ApplicationIcon } from './ApplicationsPage'
import { formatBytes } from './utils'

function DialogFrame({
  title,
  description,
  wide = false,
  busy = false,
  onClose,
  children,
  actions
}: {
  title: string
  description: string
  wide?: boolean
  busy?: boolean
  onClose: () => void
  children?: React.ReactNode
  actions: React.ReactNode
}): React.JSX.Element {
  const { text } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useRef(`dialog-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [busy, onClose])

  return (
    <div className="dialog-backdrop is-open" role="presentation" onMouseDown={() => !busy && onClose()}>
      <section ref={dialogRef} className={`dialog ${wide ? 'ignored-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId.current} onMouseDown={(event) => event.stopPropagation()}>
        <header className="dialog-header"><div><h2 id={titleId.current}>{title}</h2><p>{description}</p></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} title={text("legacy.close.fbd8ce")} aria-label={text("legacy.close.fbd8ce")}><X size={16} /></button></header>
        {children}
        <footer className="dialog-actions">{actions}</footer>
      </section>
    </div>
  )
}

export interface DirectActionRequest {
  id: string
  candidateId?: string
  candidateIds?: string[]
  ids?: string[]
  kind: 'action' | 'terminal-fix'
  verificationMode: 'local' | 'scan'
  subject: string
  label: string
  consequence: string
  reversible: boolean
  estimatedBytes: number
  itemLabels?: Array<{ id: string; label: string }>
}

export type ExecutionPhase = 'executing' | 'verifying' | 'completed' | 'failed'

export function DirectActionConfirmDialog({
  action,
  onClose,
  onConfirm
}: {
  action: DirectActionRequest
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const itemCount = action.ids?.length ?? 1
  return (
    <DialogFrame
      title={itemCount > 1
        ? text("legacy.clean_items.126b25", { p0: itemCount })
        : text("legacy.run_directly.7da91f", { p0: action.label })}
      description={action.verificationMode === 'local'
        ? text("legacy.ai_analysis_is_skipped_only_actions_regist.ff31ac")
        : text("legacy.ai_analysis_is_skipped_only_this_registere.c2e122")}
      onClose={onClose}
      actions={<><button type="button" className="secondary-button" onClick={onClose}>{text("legacy.cancel.d94a8e")}</button><button type="button" className={action.reversible ? 'primary-button' : 'danger-button'} onClick={onConfirm}><Play size={15} />{text("legacy.confirm_and_run.48cd4d")}</button></>}
    >
      <div className="dialog-body">
        <div className="confirm-row">
          <span>{action.reversible ? <ShieldCheck size={13} /> : <CircleAlert size={13} />}</span>
          <div><strong>{action.subject}</strong><small>{action.consequence}</small></div>
          <span className={`risk-label ${action.reversible ? 'safe' : 'review'}`}>{action.estimatedBytes ? formatBytes(action.estimatedBytes) : action.ids && action.ids.length > 1 ? text("legacy.items.217ed7", { p0: action.ids.length }) : text("legacy.action.c3ce74")}</span>
        </div>
      </div>
    </DialogFrame>
  )
}

export function ExecutionProgressDialog({
  phase,
  verificationMode,
  progress,
  itemCount,
  completedCount,
  detail,
  onClose,
  items = [],
  onRetry
}: {
  phase: ExecutionPhase
  verificationMode: 'local' | 'scan'
  progress: number
  itemCount: number
  completedCount: number
  detail: string
  onClose: () => void
  items?: Array<{ id: string; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; message?: string }>
  onRetry?: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const [animatedProgress, setAnimatedProgress] = useState(progress)
  const [activeIndex, setActiveIndex] = useState(0)
  const finished = phase === 'completed' || phase === 'failed'
  useEffect(() => {
    setAnimatedProgress(progress)
    if (phase !== 'executing') return
    const interval = window.setInterval(() => {
      setAnimatedProgress((current) => Math.min(88, current + 1.6))
      setActiveIndex((current) => items.length ? (current + 1) % items.length : 0)
    }, 180)
    return () => window.clearInterval(interval)
  }, [items.length, phase, progress])
  const progressValue = Math.max(0, Math.min(100, Math.round(phase === 'executing' ? animatedProgress : progress)))
  const title = phase === 'executing'
    ? text("legacy.running_confirmed_actions.d07139")
    : phase === 'verifying'
      ? verificationMode === 'local'
        ? text("legacy.updating_storage_list.50fdd3")
        : text("legacy.verifying_results.80d427")
      : phase === 'completed'
        ? text("legacy.actions_completed.59f76b")
        : text("legacy.some_actions_did_not_complete.c4107b")
  const stage = phase === 'executing'
    ? text("legacy.running_actions.2cf33d")
    : phase === 'verifying'
      ? verificationMode === 'local'
        ? text("legacy.updating_list.4ab7dc")
        : text("legacy.verifying.c2ef36")
      : phase === 'completed'
        ? text("legacy.verified.1e9a6f")
        : text("legacy.review_needed.96dc04")
  const stageIndex = phase === 'executing' ? 0 : phase === 'verifying' ? 1 : 2
  const StatusIcon = phase === 'executing'
    ? verificationMode === 'local' ? Trash2 : Play
    : phase === 'verifying'
      ? verificationMode === 'local' ? Archive : Search
      : phase === 'completed'
        ? CheckCircle2
        : CircleAlert
  const stages = [
    { label: text("legacy.run.405068"), icon: verificationMode === 'local' ? Trash2 : Play },
    { label: verificationMode === 'local' ? text("legacy.update.5cb0e4") : text("legacy.verify.c05202"), icon: verificationMode === 'local' ? Archive : Search },
    { label: text("legacy.done.23c91b"), icon: CheckCircle2 }
  ]
  return (
    <DialogFrame
      title={title}
      description={detail}
      busy={!finished}
      onClose={onClose}
      actions={<button type="button" className="secondary-button" onClick={onClose} disabled={!finished}>{text("legacy.done.23c91b")}</button>}
    >
      <div className={`execution-stage is-${phase} is-${verificationMode}`} role="status" aria-live="polite">
        <div className="execution-overview">
          <span className="execution-status-mark" aria-hidden="true"><StatusIcon size={22} /></span>
          <div className="execution-copy">
            <small>{text("legacy.current_stage.48e735")}</small>
            <strong>{stage}</strong>
            <span>{phase === 'executing'
              ? text(`正在处理 ${itemCount} 项已确认操作`, `Running ${itemCount} confirmed ${itemCount === 1 ? 'action' : 'actions'}`)
              : phase === 'verifying'
                ? verificationMode === 'local'
                  ? text("legacy.confirming_the_deletion_and_updating_the_c.152bb4")
                  : text("legacy.checking_action_results_and_device_state.385461")
                : detail}</span>
          </div>
          <strong className="execution-progress-value">{progressValue}%</strong>
        </div>
        <div className="execution-progress-track" role="progressbar" aria-label={text("legacy.action_progress.ae3a51")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
          <span style={{ width: `${progressValue}%` }}><i /></span>
        </div>
        <ol className="execution-pipeline">
          {stages.map((item, index) => {
            const Icon = item.icon
            const state = phase === 'completed'
              ? 'complete'
              : phase === 'failed' && index === 2
                ? 'failed'
                : index < stageIndex
                  ? 'complete'
                  : index === stageIndex
                    ? 'active'
                    : 'pending'
            return (
              <li className={`is-${state}`} key={item.label}>
                <span className="execution-phase-icon">{state === 'complete' ? <CheckCircle2 size={16} /> : <Icon size={16} />}</span>
                <span><strong>{item.label}</strong><small>{state === 'complete'
                  ? text("legacy.complete.d5a549")
                  : state === 'active'
                    ? text("legacy.in_progress.bcb296")
                    : state === 'failed'
                      ? text("legacy.incomplete.4c1087")
                      : text("legacy.waiting.84187b")}</small></span>
              </li>
            )
          })}
        </ol>
        {items.length > 0 && <div className="execution-items" aria-label={text("legacy.item_results.7da2a2")}>
          {items.map((item, index) => {
            const displayStatus = phase === 'executing' && item.status === 'pending'
              ? index === activeIndex ? 'running' : 'pending'
              : item.status
            return <div className={`execution-item is-${displayStatus}`} key={item.id}>
              <span className="execution-item-icon">{displayStatus === 'completed' ? <CheckCircle2 size={14} /> : displayStatus === 'failed' ? <CircleAlert size={14} /> : displayStatus === 'running' ? <LoaderCircle className="spinner" size={14} /> : <span />}</span>
              <span className="execution-item-copy"><strong>{item.label}</strong>{displayStatus === 'failed' && item.message && <small>{item.message}</small>}</span>
              <small>{displayStatus === 'completed' ? text("legacy.done.23c91b") : displayStatus === 'failed' ? text("legacy.failed.1dad49") : displayStatus === 'running' ? text("legacy.working.6e7c9f") : text("legacy.waiting.84187b")}</small>
            </div>
          })}
        </div>}
        {finished && <div className={`execution-result ${phase === 'failed' ? 'is-failed' : ''}`}><span>{phase === 'completed' ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}</span><strong>{completedCount} / {itemCount}</strong><small>{phase === 'completed' ? text("legacy.actions_completed.6b06cd") : text("legacy.completed_failed_items_can_be_retried.78310f")}</small></div>}
        {phase === 'failed' && onRetry && <button type="button" className="primary-button execution-retry-button" onClick={onRetry}><RefreshCw size={14} />{text("legacy.retry_failed_items.99b0ea")}</button>}
      </div>
    </DialogFrame>
  )
}

export function UninstallDialog({
  application,
  busy,
  onClose,
  onConfirm
}: {
  application: InstalledApplication
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  return <DialogFrame title={text("legacy.uninstall.0ec5f5", { p0: application.name })} description={busy ? text("legacy.memento_is_moving_the_application_to_trash.b91c98") : text("legacy.the_application_bundle_will_move_to_trash_.68aaa8")} busy={busy} onClose={onClose} actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}{busy ? text("legacy.uninstalling.2f00df") : text("legacy.move_to_trash.488326")}</button></>}>
    {busy && <div className="uninstall-progress" role="status" aria-live="polite"><span className="uninstall-progress-mark"><Trash2 size={20} /></span><div><strong>{text("legacy.uninstalling_application.77bebd")}</strong><small>{text("legacy.the_app_will_disappear_from_the_list_when_.779c88")}</small></div></div>}
  </DialogFrame>
}

export function DiskUsageTrashDialog({
  node,
  busy,
  onClose,
  onConfirm
}: {
  node: DiskUsageNode
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const itemType = node.kind === 'directory' ? text("legacy.folder.edef97") : text("legacy.file.873b4b")
  return (
    <DialogFrame
      title={text("legacy.move_to_trash.04175b", { p0: node.name })}
      description={node.kind === 'directory'
        ? text("legacy.the_entire_folder_and_all_of_its_contents_.7344f5")
        : text("legacy.the_file_will_move_to_trash_and_will_not_b.a5c19c")}
      busy={busy}
      onClose={onClose}
      actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}{busy ? text("legacy.moving.e763df") : text("legacy.move_to_trash.488326")}</button></>}
    >
      <div className="dialog-body"><div className="confirm-row"><span><Trash2 size={13} /></span><div><strong>{node.location}</strong><small>{itemType} · {formatBytes(node.sizeBytes)}</small></div><span className="risk-label review">{text("legacy.review.fb1984")}</span></div></div>
    </DialogFrame>
  )
}

export function IgnoreConfirmDialog({
  candidate,
  busy,
  onClose,
  onConfirm
}: {
  candidate: ScanCandidate
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const storage = candidate.section === 'storage'
  const identity = candidateWhitelistValue(candidate) ?? candidate.name
  return (
    <DialogFrame title={text("legacy.ignore.8d0e3e", { p0: candidate.name })} description={storage ? text("legacy.this_item_will_not_be_cleaned_or_counted_a.7fd546") : text("legacy.the_service_is_not_changed_future_scans_an.bb09cb")} busy={busy} onClose={onClose} actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <EyeOff size={15} />}{text("legacy.ignore_item.25b7f2")}</button></>}>
      <div className="dialog-body"><div className="confirm-row"><span><EyeOff size={13} /></span><div><strong>{candidate.name}</strong><small>{identity}</small></div><span className="risk-label safe">{text("legacy.restorable.53d267")}</span></div></div>
    </DialogFrame>
  )
}

export function ApplicationIgnoreConfirmDialog({
  application,
  busy,
  onClose,
  onConfirm
}: {
  application: InstalledApplication
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const identity = applicationWhitelistValue(application)
  return (
    <DialogFrame title={text("legacy.ignore.8d0e3e", { p0: application.name })} description={text("legacy.the_app_is_not_uninstalled_application_man.0cc420")} busy={busy} onClose={onClose} actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <EyeOff size={15} />}{text("legacy.ignore_application.080a18")}</button></>}>
      <div className="dialog-body"><div className="confirm-row"><span><AppWindow size={13} /></span><div><strong>{application.name}</strong><small>{identity}</small></div><span className="risk-label safe">{text("legacy.restorable.53d267")}</span></div></div>
    </DialogFrame>
  )
}

export function DeleteHistoryDialog({
  runs,
  busy,
  onClose,
  onConfirm
}: {
  runs: AgentRunRecord[]
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const multiple = runs.length > 1
  return (
    <DialogFrame title={text(multiple ? `删除 ${runs.length} 条任务记录？` : '删除任务记录？', multiple ? `Delete ${runs.length} task records?` : 'Delete task history?')} description={text("legacy.this_permanently_deletes_the_locally_store.4a4ff4")} busy={busy} onClose={onClose} actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}{busy ? text("legacy.deleting.b065ce") : text(multiple ? '全部删除' : '删除记录', multiple ? 'Delete all' : 'Delete history')}</button></>}>
      <div className="dialog-body"><div className="confirm-row"><span><Archive size={13} /></span><div><strong>{multiple ? text("legacy.selected_records.f8c3e4", { p0: runs.length }) : runs[0]?.prompt}</strong><small>{text("legacy.completed_system_changes_are_not_undone.01020b")}</small></div><span className="risk-label review">{text("legacy.permanent.0178ad")}</span></div></div>
    </DialogFrame>
  )
}

export function DeleteMaintenanceHistoryDialog({
  runs,
  busy,
  onClose,
  onConfirm
}: {
  runs: MaintenanceRunRecord[]
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const multiple = runs.length > 1
  return (
    <DialogFrame title={text(multiple ? `删除 ${runs.length} 条维护记录？` : '删除维护记录？', multiple ? `Delete ${runs.length} maintenance records?` : 'Delete maintenance history?')} description={text("legacy.only_local_audit_records_are_deleted_trash.d064b9")} busy={busy} onClose={onClose} actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}{busy ? text("legacy.deleting.b065ce") : text("legacy.delete_history.10cfc7")}</button></>}>
      <div className="dialog-body"><div className="confirm-row"><span><Archive size={13} /></span><div><strong>{multiple ? text("legacy.selected_records.f8c3e4", { p0: runs.length }) : runs[0]?.title}</strong><small>{text("legacy.file_system_targets_and_recovery_materials.03ad7f")}</small></div><span className="risk-label review">{text("legacy.records_only.574712")}</span></div></div>
    </DialogFrame>
  )
}

export function DeleteProviderDialog({
  provider,
  busy,
  onClose,
  onConfirm
}: {
  provider: AgentProvider
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  return (
    <DialogFrame
      title={text("legacy.delete.6e53a6", { p0: provider.name })}
      description={text("legacy.this_removes_the_provider_encrypted_key_an.01b06f")}
      busy={busy}
      onClose={onClose}
      actions={<><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("legacy.cancel.d94a8e")}</button><button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}{busy ? text("legacy.deleting.b065ce") : text("legacy.delete_configuration.9829c2")}</button></>}
    >
      <div className="dialog-body"><div className="confirm-row"><span><KeyRound size={13} /></span><div><strong>{provider.name}</strong><small>{text("legacy.key_model_settings_and_connection_state.cc77a9", { p0: provider.model })}</small></div><span className="risk-label review">{text("legacy.permanent.0178ad")}</span></div></div>
    </DialogFrame>
  )
}

export function IgnoredItemsDialog({
  initialKind,
  serviceValues,
  storageValues,
  applicationValues,
  ignoredApplications,
  busyValue,
  onRestore,
  onClose
}: {
  initialKind: 'storage' | 'services' | 'applications'
  serviceValues: string[]
  storageValues: string[]
  applicationValues: string[]
  ignoredApplications: InstalledApplication[]
  busyValue: string | null
  onRestore: (kind: 'services' | 'storage' | 'applications', value: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { text } = useI18n()
  const [kind, setKind] = useState<'storage' | 'services' | 'applications'>(initialKind)
  const [search, setSearch] = useState('')
  const values = kind === 'storage' ? storageValues : kind === 'services' ? serviceValues : applicationValues
  const applicationByValue = useMemo(() => new Map(
    ignoredApplications.map((application) => [applicationWhitelistValue(application), application])
  ), [ignoredApplications])
  const filteredValues = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return values
    return values.filter((value) => {
      const application = kind === 'applications' ? applicationByValue.get(value) : undefined
      return [value, application?.name, application?.bundleId, application?.location]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    })
  }, [applicationByValue, kind, search, values])
  const selectKind = (next: typeof kind): void => {
    setKind(next)
    setSearch('')
  }
  return (
    <DialogFrame wide title={text("legacy.ignored_items.988cce")} description={text("legacy.these_items_stay_out_of_health_recommendat.20fe85")} busy={busyValue !== null} onClose={onClose} actions={<button type="button" className="secondary-button" onClick={onClose} disabled={busyValue !== null}>{text("legacy.done.23c91b")}</button>}>
      <div className="ignored-tabs" role="tablist" aria-label={text("legacy.ignored_item_type.319c9a")}><button type="button" role="tab" aria-selected={kind === 'storage'} className={`ignored-tab ${kind === 'storage' ? 'is-active' : ''}`} onClick={() => selectKind('storage')}>{text("legacy.storage.3a8df2")} <span>{storageValues.length}</span></button><button type="button" role="tab" aria-selected={kind === 'services'} className={`ignored-tab ${kind === 'services' ? 'is-active' : ''}`} onClick={() => selectKind('services')}>{text("legacy.services.c83843")} <span>{serviceValues.length}</span></button><button type="button" role="tab" aria-selected={kind === 'applications'} className={`ignored-tab ${kind === 'applications' ? 'is-active' : ''}`} onClick={() => selectKind('applications')}>{text("legacy.applications.50f6b0")} <span>{applicationValues.length}</span></button></div>
      <label className="ignored-search search-field">
        <Search size={15} />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === 'applications' ? text("legacy.search_app_name_bundle_id_or_path.cc34ad") : text("legacy.search_name_or_path.f1debb")} aria-label={text("legacy.search_ignored_items.b24f6b")} />
      </label>
      <div className="ignored-list">
        {filteredValues.length ? filteredValues.map((value) => {
          const application = kind === 'applications' ? applicationByValue.get(value) : undefined
          const name = kind === 'storage'
            ? value.split('/').filter(Boolean).at(-1) ?? value
            : application?.name ?? (kind === 'applications' ? value.split('.').at(-1) ?? value : value)
          const detail = application
            ? [application.bundleId, application.location].filter(Boolean).join(' · ')
            : value
          return <div className="ignored-row" key={value}>{application ? <ApplicationIcon application={application} /> : <span>{kind === 'storage' ? <Archive size={14} /> : kind === 'services' ? <RadioTower size={14} /> : <AppWindow size={14} />}</span>}<div><strong>{name}</strong><small>{detail}</small></div><button type="button" className="quiet-button" onClick={() => onRestore(kind, value)} disabled={busyValue !== null}>{busyValue === value ? <LoaderCircle className="spinner" size={14} /> : <Eye size={14} />}{text("legacy.restore.5b1670")}</button></div>
        }) : <div className="ignored-empty"><div>{search ? <Search size={18} /> : <CheckCircle2 size={18} />}<span>{search ? text("legacy.no_ignored_items_match.d12887") : kind === 'storage' ? text("legacy.no_ignored_storage.fe072a") : kind === 'services' ? text("legacy.no_ignored_services.61fc07") : text("legacy.no_ignored_applications.8be8e1")}</span></div></div>}
      </div>
    </DialogFrame>
  )
}
