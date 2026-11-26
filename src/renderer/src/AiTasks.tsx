import {ArrowLeft,ArrowUpRight,Check,CheckCircle2,ChevronDown,Clock3,LoaderCircle,RotateCcw,Settings2,Sparkles,X} from 'lucide-react'
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react'
import type {AgentProcessContext,AgentRunRecord} from '../../shared/agent-types'
import type {AgentViewKey} from './agent-ui/Shell'
import {useI18n} from './i18n'
export interface AiTaskOrigin {source:AgentViewKey;scrollTop:number}
export interface AiRequest {key:string;title:string;prompt:string;process?:AgentProcessContext}
export interface AiTask extends AiRequest {id:string;origin:AiTaskOrigin;phase:'needs-provider'|'queued'|'preparing'|'running'|'ready'|'failed'|'cancelled';run:AgentRunRecord|null;message:string;read:boolean}
interface TasksApi {tasks:AiTask[];request:(input:AiRequest)=>void;find:(key:string)=>AiTask|undefined;show:()=>void}
const Context=createContext<TasksApi>({tasks:[],request:()=>undefined,find:()=>undefined,show:()=>undefined})
export const useAiTasks=():TasksApi=>useContext(Context)
export function readableTaskError(error:unknown):string {return (error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method ['"].+?['"]: (?:Error: )?/,'').replace(/^Error: /,'')}
export function aiRunReady(run:AgentRunRecord):boolean {return run.status==='completed'||(['awaiting-confirmation','plan-ready'].includes(run.status)&&Boolean(run.response||run.presentation))}
export function AiTaskProvider({configured,visibleRunId,origin,start,onRun,onOpen,onConfigure,children}:{configured:boolean;visibleRunId:string|null;origin:()=>AiTaskOrigin;start:(task:AiTask,publish:(run:AgentRunRecord)=>void,signal:AbortSignal)=>Promise<AgentRunRecord>;onRun:(run:AgentRunRecord)=>void;onOpen:(run:AgentRunRecord,origin:AiTaskOrigin)=>void;onConfigure:(origin:AiTaskOrigin)=>void;children:React.ReactNode}):React.JSX.Element {
  const {t}=useI18n()
  const [tasks,setTasks]=useState<AiTask[]>([]),[open,setOpen]=useState(false)
  const current=useRef(tasks),active=useRef<string|null>(null),controllers=useRef(new Map<string,AbortController>()),early=useRef(new Map<string,{run:AgentRunRecord;complete:boolean}>())
  const latest=useRef({configured,visibleRunId,origin,start,onRun,onOpen,onConfigure});latest.current={configured,visibleRunId,origin,start,onRun,onOpen,onConfigure}
  const update=useCallback((fn:(tasks:AiTask[])=>AiTask[]):void=>{current.current=fn(current.current);setTasks(current.current)},[])
  const publish=useCallback((run:AgentRunRecord,complete=true):void=>{
    early.current.set(run.id,{run,complete});latest.current.onRun(run)
    update((items)=>items.map((task)=>task.run?.id!==run.id||task.phase==='cancelled'?task:{...task,run,phase:run.status==='failed'?'failed':run.status==='cancelled'?'cancelled':complete||aiRunReady(run)?'ready':'running',message:run.error||'',read:complete?latest.current.visibleRunId===run.id:task.read}))
  },[update])
  useEffect(()=>window.memento?.onAgentRunEvent((event)=>{
    if(event.type==='status'){update((items)=>items.map((task)=>task.run?.id===event.runId&&task.phase!=='cancelled'?{...task,message:event.message,run:{...task.run!,status:event.status}}:task));return}
    publish(event.run,true)
  }),[publish,update])
  useEffect(()=>{
    if(visibleRunId)update((items)=>items.map((task)=>task.run?.id===visibleRunId?{...task,read:true}:task))
  },[visibleRunId,update])
  useEffect(()=>{
    if(!configured&&tasks.some((task)=>task.phase==='queued')){update((items)=>items.map((task)=>task.phase==='queued'?{...task,phase:'needs-provider'}:task));return}
    if(configured&&tasks.some((task)=>task.phase==='needs-provider')){update((items)=>items.map((task)=>task.phase==='needs-provider'?{...task,phase:'queued',message:''}:task));return}
    if(active.current){const existing=tasks.find((task)=>task.id===active.current);if(existing&&['preparing','running'].includes(existing.phase))return;controllers.current.delete(active.current);active.current=null}
    if(!configured)return
    const next=tasks.find((task)=>task.phase==='queued');if(!next)return
    active.current=next.id;const controller=new AbortController();controllers.current.set(next.id,controller)
    update((items)=>items.map((task)=>task.id===next.id?{...task,phase:'preparing',message:''}:task))
    void latest.current.start(next,(run)=>publish(run,true),controller.signal).then((initial)=>{
      const buffered=early.current.get(initial.id),run=buffered?.run||initial
      latest.current.onRun(run)
      update((items)=>items.map((task)=>task.id!==next.id||task.phase==='cancelled'?task:{...task,run,phase:run.status==='failed'?'failed':run.status==='cancelled'?'cancelled':buffered?.complete||aiRunReady(run)?'ready':'running',message:run.error||'',read:latest.current.visibleRunId===run.id}))
      if(controller.signal.aborted&&window.memento)void window.memento.cancelAgentRun(run.id)
    }).catch((error)=>{update((items)=>items.map((task)=>task.id!==next.id||task.phase==='cancelled'?task:{...task,phase:latest.current.configured?'failed':'needs-provider',message:latest.current.configured?readableTaskError(error):'',read:false}))})
  },[tasks,configured,publish,update])
  const viewTask=(task:AiTask):void=>{if(!task.run)return;update((items)=>items.map((item)=>item.id===task.id?{...item,read:true}:item));setOpen(false);latest.current.onOpen(task.run,task.origin)}
  const request=(input:AiRequest):void=>{
    const existing=current.current.find((task)=>task.key===input.key&&task.phase!=='cancelled')
    if(existing){const changed={...existing,origin:latest.current.origin()};update((items)=>items.map((task)=>task.id===existing.id?changed:task));if(existing.phase==='ready')viewTask(changed);else setOpen(true);return}
    const task:AiTask={...input,id:crypto.randomUUID(),origin:latest.current.origin(),phase:latest.current.configured?'queued':'needs-provider',run:null,message:'',read:false}
    update((items)=>[...items,task]);setOpen(true)
  }
  const cancel=(task:AiTask):void=>{controllers.current.get(task.id)?.abort();if(task.run&&window.memento)void window.memento.cancelAgentRun(task.run.id).catch(()=>undefined);update((items)=>items.map((item)=>item.id===task.id?{...item,phase:'cancelled',read:true}:item))}
  const retry=(task:AiTask):void=>{update((items)=>items.map((item)=>item.id===task.id?{...item,phase:configured?'queued':'needs-provider',message:'',run:null,read:false}:item));setOpen(true)}
  const pending=tasks.filter((task)=>['queued','preparing','running'].includes(task.phase)).length,unread=tasks.filter((task)=>task.phase==='ready'&&!task.read).length
  const originName=(value:AgentViewKey):string=>t(`nav.${value==='overview'?'home':value==='health'?'cleanup':value}`)
  return <Context.Provider value={{tasks,request,find:(key)=>tasks.find((task)=>task.key===key&&task.phase!=='cancelled'),show:()=>setOpen(true)}}>{children}
    {tasks.length>0&&<aside className="ai-task-hub" aria-label={t('tasks.title')}>
      {open&&<section className="ai-task-panel"><header><div><Sparkles size={16}/><strong>{t('tasks.title')}</strong></div><button className="icon-button" aria-label={t('tasks.minimize')} onClick={()=>setOpen(false)}><ChevronDown size={17}/></button></header><div className="ai-task-list">{[...tasks].reverse().map((task)=><article key={task.id} className={`ai-task-row phase-${task.phase}`} data-task-key={task.key}><span className="ai-task-status">{['preparing','running'].includes(task.phase)?<LoaderCircle className="spinner" size={17}/>:task.phase==='ready'?<CheckCircle2 size={17}/>:task.phase==='needs-provider'?<Settings2 size={17}/>:<Clock3 size={17}/>}</span><div className="ai-task-copy"><strong title={task.title}>{task.title}</strong><small>{originName(task.origin.source)} · {t(`tasks.${task.phase}`)}{task.phase==='ready'&&!task.read&&<i>{t('tasks.new')}</i>}</small>{task.message&&<p>{task.message}</p>}<div className="ai-task-actions">{task.phase==='needs-provider'?<button onClick={()=>{setOpen(false);latest.current.onConfigure(task.origin)}}>{t('tasks.configure')}<Settings2 size={12}/></button>:task.run&&task.phase!=='cancelled'?<button onClick={()=>viewTask(task)}>{t(task.phase==='ready'?'tasks.view':'tasks.progress')}<ArrowUpRight size={12}/></button>:null}{['failed','cancelled'].includes(task.phase)&&<button onClick={()=>retry(task)}><RotateCcw size={12}/>{t('common.retry')}</button>}</div></div><button className="icon-button" aria-label={t(['ready','failed','cancelled'].includes(task.phase)?'tasks.dismiss':'tasks.cancel')} onClick={()=>['ready','failed','cancelled'].includes(task.phase)?update((items)=>items.filter((item)=>item.id!==task.id)):cancel(task)}><X size={14}/></button></article>)}</div><footer>{t('tasks.stay')}</footer></section>}
      <button className={`ai-task-launcher ${unread?'has-unread':''}`} aria-expanded={open} aria-label={t('tasks.open')} onClick={()=>setOpen(!open)}>{pending?<LoaderCircle className="spinner" size={17}/>:unread?<CheckCircle2 size={17}/>:<Sparkles size={17}/>}<span>{t('tasks.title')}</span>{pending>0&&<b>{t('tasks.active',{count:pending})}</b>}{unread>0&&<b className="ai-task-unread">{t('tasks.unread',{count:unread})}</b>}</button>
      <span className="sr-only" role="status" aria-live="polite">{unread?t('tasks.unread',{count:unread}):pending?t('tasks.active',{count:pending}):''}</span>
    </aside>}
  </Context.Provider>
}
export function AiActionButton({request,label,size=15}:{request:AiRequest;label?:string;size?:number}):React.JSX.Element {
  const {t}=useI18n(),queue=useAiTasks(),task=queue.find(request.key)
  const busy=task&&['queued','preparing','running'].includes(task.phase)
  return <button className={`icon-button ai-action ${task?'is-'+task.phase:''}`} data-ai-key={request.key} data-ai-state={task?.phase||'idle'} data-tooltip={t(task?`tasks.tip.${task.phase}`:'file.ask')} aria-label={`${label||t('file.ask')} ${request.title}`} aria-busy={Boolean(busy)} onClick={()=>queue.request(request)}>{busy?<LoaderCircle className="spinner" size={size}/>:task?.phase==='ready'?<Check size={size}/>:task?.phase==='needs-provider'?<Settings2 size={size}/>:<Sparkles size={size}/>}</button>
}
