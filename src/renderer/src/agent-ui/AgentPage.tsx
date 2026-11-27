import {CollieMark} from '../CollieMark'
import {NavigationIcon} from './NavigationIcon'
import type {AgentViewKey} from './Shell'
import './CleanupAdvisor.css'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CircleCheck,
  Clock3,
  HardDrive,
  ListChecks,
  LoaderCircle,
  Play,
  RadioTower,
  Sparkles,
  SquarePen,
  SquareTerminal,
  UserRound,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentRunRecord } from '../../../shared/agent-types'
import type { ScanResult } from '../../../shared/types'
import { useI18n } from '../i18n'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentResults } from './AgentResults'
import { formatBytes, runStatusLabel } from './utils'

function runIsBusy(run: AgentRunRecord | null): boolean {
  return Boolean(run && ['preparing', 'analyzing', 'plan-ready', 'executing', 'verifying'].includes(run.status))
}

function AgentProgress({
  run,
  statusMessage
}: {
  run: AgentRunRecord
  statusMessage: string
}): React.JSX.Element {
  const { text } = useI18n()
  const phase = run.status === 'preparing'
    ? 0
    : run.status === 'analyzing'
      ? 1
      : run.status === 'executing'
        ? 2
        : 3
  const ranges: Record<AgentRunRecord['status'], [number, number]> = {
    preparing: [8, 20],
    analyzing: [22, 87],
    'plan-ready': [88, 94],
    'awaiting-confirmation': [100, 100],
    executing: [12, 80],
    verifying: [82, 96],
    completed: [100, 100],
    cancelled: [100, 100],
    failed: [100, 100]
  }
  const [progress, setProgress] = useState(ranges[run.status][0])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const [start, cap] = ranges[run.status]
    setProgress(start)
    setElapsedSeconds(0)
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1)
      setProgress((current) => Math.min(cap, current + Math.max(0.35, (cap - current) * 0.035)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [run.id, run.status])

  const roundedProgress = Math.round(progress)
  const stages = [
    text("legacy.read.962df2"),
    text("legacy.analyze.3da51d"),
    text("legacy.review.3a42f4"),
    text("legacy.compose.ae6a23")
  ]
  return (
    <div className="activity-block agent-progress" role="status" aria-live="polite">
      <div className="agent-progress-head">
        <span className="agent-progress-mark"><Sparkles size={16} /></span>
        <span className="agent-progress-copy"><strong>{statusMessage || runStatusLabel(run.status, run.language)}</strong><small>{elapsedSeconds < 2 ? text("legacy.agent_is_building_analysis_context.95bb4a") : text("legacy.s_elapsed.59dc02", { p0: elapsedSeconds })}</small></span>
        <span className="agent-progress-value">{roundedProgress}%</span>
      </div>
      <div className="agent-progress-track" role="progressbar" aria-label={text("legacy.agent_analysis_progress.b9b514")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={roundedProgress}><span style={{ width: `${roundedProgress}%` }} /></div>
      <div className="agent-progress-stages">{stages.map((stage, index) => <span className={index <= phase ? 'is-active' : ''} key={stage}><i />{stage}</span>)}</div>
    </div>
  )
}

export function AgentPage({
  scan,
  run,
  conversationRuns,
  workspaceRuns,
  statusMessage,
  selectedPlanIds,
  providerConfigured,
  addingOperationId,
  openingApplicationId,
  returnLabel,
  onSubmit,
  onSelectWorkspaceRun,
  onCloseWorkspaceRun,
  onNewTask,
  onOpenHistory,
  onOpenSettings,
  onReturn,
  onOpenApplication,
  onAddPlanItem,
  onTogglePlanItem,
  onExecutePlan,
  onDiscardPlan,
  preparing,
  draft,
  onDraftChange,
  onNavigate
}: {
  scan: ScanResult | null
  run: AgentRunRecord | null
  conversationRuns: AgentRunRecord[]
  workspaceRuns: AgentRunRecord[]
  statusMessage: string
  selectedPlanIds: Set<string>
  providerConfigured: boolean
  addingOperationId: string | null
  openingApplicationId: string | null
  returnLabel: string | null
  onSubmit: (prompt: string) => Promise<boolean>
  preparing:boolean
  draft:string
  onDraftChange:(value:string)=>void
  onNavigate:(view:AgentViewKey)=>void
  onSelectWorkspaceRun: (run: AgentRunRecord) => void
  onCloseWorkspaceRun: (conversationId: string) => void
  onNewTask: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  onReturn: () => void
  onOpenApplication: (id: string) => void
  onAddPlanItem: (id: string) => void
  onTogglePlanItem: (id: string) => void
  onExecutePlan: () => void
  onDiscardPlan: () => void
}): React.JSX.Element {
  const { language, text } = useI18n()
  const input=draft,setInput=onDraftChange
  const composerRef=useRef<HTMLTextAreaElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const busy = runIsBusy(run)
  const waitingConfirmation = run?.status === 'awaiting-confirmation'
  const selectedItems = run?.plan.filter((item) => selectedPlanIds.has(item.id)) ?? []
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.estimatedBytes, 0)
  const activePlannedIds = new Set(run?.plan.map((item) => item.id) ?? [])
  const completedPlanIds = new Set(run?.results.filter((result) => result.ok).map((result) => result.id) ?? [])
  const busyWorkspaceCount = workspaceRuns.filter((item) => runIsBusy(item)).length

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' })
  }, [conversationRuns.length, run?.status, run?.updatedAt, statusMessage])

  const submit = async (question=input): Promise<void> => {
    const prompt = question.trim()
    if (!prompt || busy || preparing) return
    if (!providerConfigured) {
      onOpenSettings()
      return
    }
    if(await onSubmit(prompt))setInput('')
  }

  return (
    <section className={`page agent-page cleanup-advisor is-active ${run?.plan.length?'has-plan':''}`}>
      <div className="agent-main">
        <header className="agent-heading">
          <div>
            <h1>{text('advisor.title')}</h1>
            <p>{text('advisor.subtitle')}</p>
          </div>
          <div className="session-menu">
            {returnLabel && <button type="button" className="secondary-button return-origin-button" onClick={onReturn}><ArrowLeft size={15} />{text("legacy.back_to.f5c261", { p0: returnLabel })}</button>}
            <button type="button" className="icon-button" onClick={onNewTask} disabled={busy} title={text("legacy.new_task.146617")} aria-label={text("legacy.new_task.146617")}>
              <SquarePen size={16} />
            </button>
            <button type="button" className="icon-button" onClick={onOpenHistory} title={text("legacy.history.116143")} aria-label={text("legacy.history.116143")}>
              <Clock3 size={16} />
            </button>
          </div>
        </header>

        {workspaceRuns.length > 1 && (
          <div className="agent-task-switcher" aria-label={text("legacy.analysis_tasks.e6adbe")}>
            <strong>{busyWorkspaceCount
              ? text(`正在处理 ${busyWorkspaceCount} 项任务`, `${busyWorkspaceCount} ${busyWorkspaceCount === 1 ? 'task' : 'tasks'} running`)
              : text("legacy.recent_tasks.e92f2a", { p0: workspaceRuns.length })}</strong>
            <div className="agent-task-list">
              {workspaceRuns.map((workspaceRun) => {
                const taskBusy = runIsBusy(workspaceRun)
                const taskActive = workspaceRun.conversationId === run?.conversationId
                return (
                  <div className={`agent-task-item ${taskActive ? 'is-active' : ''}`} key={workspaceRun.conversationId}>
                    <button type="button" className="agent-task-select" aria-current={taskActive ? 'true' : undefined} onClick={() => onSelectWorkspaceRun(workspaceRun)}>
                      <span>{taskBusy
                        ? <LoaderCircle className="spinner" size={14} />
                        : workspaceRun.status === 'failed'
                          ? <X size={14} />
                          : <CircleCheck size={14} />}</span>
                      <strong>{workspaceRun.prompt}</strong>
                      <small>{runStatusLabel(workspaceRun.status, language)}</small>
                    </button>
                    <button type="button" className="agent-task-close" onClick={() => onCloseWorkspaceRun(workspaceRun.conversationId)} title={text("legacy.close_task.ebe518")} aria-label={text("legacy.close_task.be2632", { p0: workspaceRun.prompt })}><X size={13} /></button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="conversation" ref={conversationRef} aria-live="polite">
          {!conversationRuns.length&&<div className="advisor-start">
            <CollieMark className="advisor-mascot" label={text('brand.collie')}/>
            <h2>{text('advisor.startTitle')}</h2>
            <div className="advisor-intents">
              <button type="button" disabled={preparing||busy} onClick={()=>{const question=text('advisor.priorityPrompt');setInput(question);void submit(question)}}><NavigationIcon kind="health" size={23}/><span><strong>{text('advisor.priority')}</strong><small>{text('advisor.priorityDetail')}</small></span><ArrowUp size={16}/></button>
              <button type="button" disabled={preparing||busy} onClick={()=>{setInput(text('advisor.fileDraft'));composerRef.current?.focus()}}><NavigationIcon kind="large" size={23}/><span><strong>{text('advisor.file')}</strong><small>{text('advisor.fileDetail')}</small></span><ArrowUp size={16}/></button>
              <button type="button" onClick={()=>onNavigate('apps')}><NavigationIcon kind="apps" size={23}/><span><strong>{text('advisor.apps')}</strong><small>{text('advisor.appsDetail')}</small></span><ArrowUp size={16}/></button>
            </div>
            <div className="advisor-source-links"><span>{text('advisor.fromResults')}</span>{(['large','disk'] as const).map((source)=><button type="button" key={source} onClick={()=>onNavigate(source)}><NavigationIcon kind={source} size={16}/>{text(`nav.${source}`)}</button>)}</div>
          </div>}
          {preparing&&<div className="advisor-preparing" role="status"><LoaderCircle className="spinner" size={16} aria-hidden="true"/><span>{text('advisor.preparing')}</span></div>}
          {conversationRuns.map((conversationRun) => {
            const isActive = conversationRun.id === run?.id
            const runBusy = isActive && busy
            const runBytes = conversationRun.plan.reduce((sum, item) => sum + item.estimatedBytes, 0)
            return (
              <div className="conversation-turn" key={conversationRun.id}>
                <div className="message user">
                  <div className="message-body"><p>{conversationRun.prompt}</p></div>
                  <span className="message-avatar"><UserRound size={15} /></span>
                </div>
                <div className="message assistant">
                  <span className="message-avatar"><Sparkles size={16} /></span>
                  <div className="message-body">
                    {runBusy && <AgentProgress run={conversationRun} statusMessage={statusMessage} />}
                    {(conversationRun.status === 'failed' || conversationRun.status === 'cancelled') && (
                      <div className="activity-block">
                        <div className="activity-row is-done">
                          <span className="activity-icon">{conversationRun.status === 'failed' ? <X size={13} /> : <CircleCheck size={13} />}</span>
                          <span>{isActive && statusMessage ? statusMessage : runStatusLabel(conversationRun.status, language)}</span>
                          <small>{runStatusLabel(conversationRun.status, language)}</small>
                        </div>
                      </div>
                    )}
                    {(conversationRun.presentation?.summary || conversationRun.response) && (
                      <AgentMarkdown>{conversationRun.presentation?.summary ?? conversationRun.response ?? ''}</AgentMarkdown>
                    )}
                    {conversationRun.presentation && (
                      <AgentResults
                        presentation={conversationRun.presentation}
                        plannedIds={activePlannedIds}
                        addingOperationId={isActive ? addingOperationId : null}
                        openingApplicationId={openingApplicationId}
                        onOpenApplication={onOpenApplication}
                        onAddPlanItem={onAddPlanItem}
                      />
                    )}
                    {conversationRun.error && <p role="alert" className="error-copy">{conversationRun.error}</p>}
                    {conversationRun.status === 'completed' && conversationRun.results.length > 0 && (
                      <div className="result-summary">
                        <div><strong>{conversationRun.results.filter((item) => item.ok).length}</strong><span>{text("legacy.completed.58782c")}</span></div>
                        <div><strong>{conversationRun.results.filter((item) => !item.ok).length}</strong><span>{text("legacy.failed.af9f5f")}</span></div>
                        <div><strong>{formatBytes(runBytes)}</strong><span>{text("legacy.planned_space.cc61fd")}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="composer-wrap">
          {!providerConfigured&&<div className="advisor-provider"><span>{text('advisor.providerNeeded')}</span><button type="button" className="space-button" onClick={onOpenSettings}>{text('tasks.configure')}</button></div>}
          <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <textarea
              ref={composerRef}
              rows={1}
              aria-label={text("legacy.enter_task.405f37")}
              placeholder={text('advisor.placeholder')}
              value={input}
              disabled={busy||preparing}
              onChange={(event) => {
                setInput(event.target.value)
                event.currentTarget.style.height = 'auto'
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <button type="submit" className="send-button" title={text("legacy.send.f1004b")} aria-label={text("legacy.send.f1004b")} disabled={!input.trim()||busy||preparing}>
              {busy ? <LoaderCircle className="spinner" size={17} /> : <ArrowUp size={17} />}
            </button>
          </form>
        </div>
      </div>

      {Boolean(run?.plan.length)&&<aside className="agent-rail" aria-label={text("legacy.current_task.711bf2")}>
        <div className="rail-header">
          <h2>{text("legacy.current_task.711bf2")}</h2>
          <span className="state-label">{run ? runStatusLabel(run.status, language) : text("legacy.waiting.b4e9d2")}</span>
        </div>

        {!run?.plan.length ? (
          <div className="rail-empty">
            <div>
              <span><ListChecks size={18} /></span>
              <strong>{text("legacy.no_execution_plan.03b192")}</strong>
              <small>{text("legacy.add_an_action_from_a_result_or_ask_the_age.32a8f2")}</small>
            </div>
          </div>
        ) : (
          <div className="plan-panel is-visible">
            <div className="plan-summary">
              <div><strong>{selectedBytes ? formatBytes(selectedBytes) : `${selectedItems.length}`}</strong><span>{selectedBytes ? text("legacy.estimated_space.7a62ca") : text("legacy.pending_actions.0f782a")}</span></div>
              <span className="risk-label review">{text("legacy.review_items.7ae12c", { p0: selectedItems.filter((item) => item.risk === 'review').length })}</span>
            </div>
            <div className="plan-steps">
              {run.plan.map((item) => (
                <div className="plan-step" key={item.id}>
                  <label className="plan-check" title={text("legacy.select_this_step.627489")}>
                    <input type="checkbox" checked={selectedPlanIds.has(item.id)} onChange={() => onTogglePlanItem(item.id)} disabled={!waitingConfirmation || completedPlanIds.has(item.id)} />
                    <span>{(selectedPlanIds.has(item.id) || completedPlanIds.has(item.id)) && <Check size={12} />}</span>
                  </label>
                  <div className="plan-step-copy"><strong>{item.title}</strong><small>{item.detail}</small></div>
                  <div className="plan-step-meta"><strong>{item.estimatedBytes ? formatBytes(item.estimatedBytes) : text("legacy.action.c3ce74")}</strong><small>{completedPlanIds.has(item.id) ? text("legacy.completed.58782c") : item.risk === 'review' ? text("legacy.review.fb1984") : text("legacy.pending.8b36bc")}</small></div>
                </div>
              ))}
            </div>
            {waitingConfirmation && (
              <div className="plan-actions">
                <button type="button" className="primary-button" onClick={onExecutePlan} disabled={!selectedPlanIds.size}>
                  <Play size={15} />{text("legacy.confirm_and_run.48cd4d")}
                </button>
                <button type="button" className="icon-button" onClick={onDiscardPlan} title={text("legacy.discard_plan.ab31fb")} aria-label={text("legacy.discard_plan.ab31fb")}>
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>}
    </section>
  )
}
