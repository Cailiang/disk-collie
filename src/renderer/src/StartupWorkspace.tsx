import {useEffect,useMemo,useRef,useState} from 'react'
import {AppWindow,ChevronRight,FolderOpen,Info,LoaderCircle,LockKeyhole,Power,RefreshCw,Search,Settings2,Trash2} from 'lucide-react'
import type {MaintenanceRunRecord} from '../../shared/maintenance-types'
import type {StartupAction,StartupCatalog,StartupGroup,StartupItem} from '../../shared/startup-types'
import {filterStartupGroups,startupGroups} from '../../shared/startup-groups'
import {useI18n} from './i18n'
import {useMessages} from './Messages'
import {WorkspaceDialog} from './WorkspaceDialog'
import {AiActionButton,readableTaskError} from './AiTasks'
import {ScanGame} from './ScanGame'
import {demoStartup} from './startup-demo'
import './StartupWorkspace.css'

function StartupLogo({item}:{item:StartupItem}):React.JSX.Element {
  const [icon,setIcon]=useState<string|null>(null),ref=useRef<HTMLSpanElement>(null)
  useEffect(()=>{let active=true;const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();if(window.diskCollie)void window.diskCollie.startupIcon(item.id).then(icon=>{if(active)setIcon(icon)}).catch(()=>undefined)});if(ref.current)observer.observe(ref.current);return()=>{active=false;observer.disconnect()}},[item.id,item.icon])
  return <span className="startup-logo" ref={ref}>{icon?<img src={icon} alt=""/>:<AppWindow size={20}/>}</span>
}
interface Pending {items:StartupItem[];action:StartupAction;name:string}
export function StartupWorkspace({active,onSettings}:{active:boolean;onSettings:()=>void}):React.JSX.Element {
  const {t,locale,language}=useI18n(),{show}=useMessages()
  const [catalog,setCatalog]=useState<StartupCatalog|null>(null),[scanning,setScanning]=useState(false),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[system,setSystem]=useState(false),[expanded,setExpanded]=useState(new Set<string>()),[pending,setPending]=useState<Pending|null>(null)
  const demoHistory=useRef<MaintenanceRunRecord[]>([])
  const [history,setHistory]=useState<MaintenanceRunRecord[]|null>(null)
  const [lastOutcome,setLastOutcome]=useState(''),mounted=useRef(true),scanSequence=useRef(0),started=useRef(false)
  const scannedLanguage=useRef(language)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++scanSequence.current}},[])
  const error=(problem:unknown):void=>show({message:readableTaskError(problem),tone:'error'})
  const scan=async():Promise<void>=>{
    const sequence=++scanSequence.current;setScanning(true)
    try{const result=window.diskCollie?await window.diskCollie.startupScan():await new Promise<StartupCatalog>(resolve=>setTimeout(()=>resolve(demoStartup(language)),1100));if(mounted.current&&sequence===scanSequence.current){setCatalog(result);setLastOutcome('')}}catch(problem){if(mounted.current&&sequence===scanSequence.current)error(problem)}finally{if(mounted.current&&sequence===scanSequence.current)setScanning(false)}
  }
  // Retain results and controls when visiting the advisor or another workspace.
  useEffect(()=>{if(active&&(!started.current||scannedLanguage.current!==language)){started.current=true;scannedLanguage.current=language;void scan()}},[active,language])
  const groups=useMemo(()=>catalog?startupGroups(catalog):[],[catalog]),visible=useMemo(()=>filterStartupGroups(groups,query,filter,system),[groups,query,filter,system])
  const scoped=useMemo(()=>filterStartupGroups(groups,'','all',system),[groups,system])
  const counts={all:scoped.length,enabled:scoped.filter(group=>group.items.some(item=>item.state==='enabled')).length,disabled:scoped.filter(group=>group.state==='disabled').length,orphan:scoped.filter(group=>group.items.some(item=>item.orphan)).length}
  const openSettings=(section:'startup'|'privacy'|'automation'|'services'|'tasks'='startup'):void=>{if(window.diskCollie)void window.diskCollie.startupSettings(section).catch(error);else show({message:t('startup.settingsDemo'),tone:'info'})}
  const manage=(items:StartupItem[]):void=>{if(items.some(item=>item.issue==='startup.selfManaged'))onSettings();else openSettings(items.some(item=>item.access==='protected')?'startup':items.every(item=>item.kind==='service')?'services':items.every(item=>item.kind==='task')?'tasks':'startup')}
  const openHistory=():void=>{if(window.diskCollie)void window.diskCollie.listMaintenanceRuns().then(runs=>setHistory(runs.filter(run=>run.operations.some(operation=>operation.kind.startsWith('startup-'))))).catch(error);else setHistory(demoHistory.current)}
  const reveal=(item:StartupItem):void=>{if(window.diskCollie)void window.diskCollie.startupReveal(item.id).catch(error);else show({message:item.configuration||item.target,tone:'info'})}
  const ask=(items:StartupItem[],name:string):React.JSX.Element=><AiActionButton request={{key:'startup:'+items.map(item=>item.id+item.state).join(':'),title:name,prompt:t('startup.aiPrompt',{name,items:items.map(item=>`${t('startup.kind.'+item.kind)} · ${t('startup.state.'+item.state)} · ${item.target} · ${item.configuration}${item.orphan?' · '+t('startup.orphan'):''}`).join('\n')})}}/>
  const prepare=(items:StartupItem[],action:StartupAction,name:string):void=>{const eligible=items.filter(item=>action==='remove'?item.canRemove:item.canToggle);if(eligible.length)setPending({items:eligible,action,name})}
  const execute=async():Promise<void>=>{
    if(!pending||!catalog||busy)return
    const current=pending;setBusy(true)
    try{
      const result=window.diskCollie?await window.diskCollie.startupChange({catalogId:catalog.id,ids:current.items.map(item=>item.id),action:current.action}):await new Promise<import('../../shared/startup-types').StartupChangeResult>(resolve=>setTimeout(()=>resolve({results:current.items.map(item=>({id:item.id,name:item.name,ok:true,changed:true,message:''})),catalog:{...catalog,id:crypto.randomUUID(),items:current.action==='remove'?catalog.items.filter(item=>!current.items.some(target=>target.id===item.id)):catalog.items.map(item=>current.items.some(target=>target.id===item.id)?{...item,state:current.action==='enable'?'enabled':'disabled'}:item)}}),650))
      if(!mounted.current)return
      setCatalog(result.catalog);setPending(null)
      if(!window.diskCollie){const time=new Date().toISOString();demoHistory.current.unshift({id:crypto.randomUUID(),source:'direct',scanId:catalog.id,agentRunId:null,title:t('startup.title')+' · '+t('startup.action.'+current.action),status:'completed',createdAt:time,completedAt:time,operations:current.items.map(item=>({id:crypto.randomUUID(),runId:'demo-startup',operationId:item.id,kind:'startup-'+current.action,title:item.name,status:'completed',reversible:current.action!=='remove',estimatedBytes:null,actualBytes:null,recoveryMode:'none',recoveryAvailable:false,errorCode:null,message:null,createdAt:time,completedAt:time}))})}
      const failed=result.results.filter(result=>!result.ok),count=result.results.filter(result=>result.ok&&result.changed).length
      setLastOutcome(t('startup.done',{count}))
      if(failed.length)show({title:t('startup.partialResult'),message:failed.map(result=>result.name+' · '+result.message).join('\n'),tone:'error'})
    }catch(problem){error(problem);setPending(null)}finally{if(mounted.current)setBusy(false)}
  }
  const toggle=(items:StartupItem[],name:string):React.JSX.Element=>{
    const adjustable=items.filter(item=>item.canToggle),on=(adjustable.length?adjustable:items).some(item=>item.state==='enabled'),label=t(on?'startup.action.disable':'startup.action.enable')+' '+name
    return <button className={`startup-switch ${on?'is-on':''}`} type="button" role="switch" aria-checked={on} aria-label={label} title={adjustable.length?label:t('startup.readonly')} disabled={!adjustable.length||busy||scanning} onClick={()=>prepare(adjustable,on?'disable':'enable',name)}><i/></button>
  }
  const status=(state:StartupGroup['state'],orphan=false):React.JSX.Element=><span className={`startup-state state-${orphan?'orphan':state}`}>{t(orphan?'startup.orphan':'startup.state.'+state)}</span>
  return <div className="space-workspace space-startup">
    <header className="space-heading"><h1>{t('startup.title')}</h1><div className="space-actions"><button className="space-button" onClick={()=>openSettings()}><Settings2 size={15}/>{t('startup.systemSettings')}</button><button className="space-button primary" disabled={busy||scanning} onClick={()=>void scan()}>{scanning?<LoaderCircle size={15} className="spinner"/>:<RefreshCw size={15}/>}<span>{t(catalog?'common.rescan':'common.scan')}</span></button></div></header>
    {scanning&&!catalog?<div className="space-progress space-progress-game"><div className="space-progress-heading"><div className="space-progress-copy" role="status"><strong>{t('startup.scanning')}</strong><span>{t('startup.readOnlyScan')}</span><div className="space-progress-track"><i/></div></div></div><ScanGame initialMode="runner"/></div>:<>
      {catalog&&<div className="startup-summary" role="status"><span>{t('startup.found',{apps:groups.length,items:catalog.items.length})}</span><span>{lastOutcome||t('startup.scannedAt',{time:new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit'}).format(new Date(catalog.scannedAt))})}</span>{scanning&&<LoaderCircle size={14} className="spinner"/>}</div>}
      {catalog?.coverage.some(source=>source.status!=='complete')&&<details className="startup-coverage"><summary><Info size={15}/>{t('startup.incomplete')}</summary><div>{catalog.coverage.filter(source=>source.status!=='complete').map((source,index)=><p key={source.source+index}><strong>{t('startup.kind.'+source.source)}</strong><span>{t(source.message||'startup.partial')}</span>{source.message==='startup.automation'&&<button className="space-text-button" onClick={()=>openSettings('automation')}>{t('startup.automationSettings')}</button>}</p>)}<button className="space-text-button" onClick={()=>openSettings(window.diskCollie?.platform==='darwin'?'privacy':'startup')}>{t('startup.permissions')}</button></div></details>}
      <div className="space-toolbar startup-toolbar"><label className="space-search"><Search size={16}/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('startup.search')} aria-label={t('startup.search')}/></label><label className="space-inline-check"><input type="checkbox" checked={system} onChange={event=>setSystem(event.target.checked)}/>{t('startup.showSystem')}</label></div>
      <div className="startup-filters space-category-tabs" role="group" aria-label={t('startup.filter')}>{(['all','enabled','disabled','orphan'] as const).map(key=><button className={filter===key?'is-active':''} key={key} onClick={()=>setFilter(key)}>{t('startup.filter.'+key)}<small>{counts[key]}</small></button>)}</div>
      {visible.some(group=>group.items.some(item=>item.state==='unknown'))&&<p className="startup-footnote startup-state-note">{t('startup.unknownHint')}</p>}
      <div className="startup-list">
        {visible.map(group=>{
          const open=expanded.has(group.id),orphan=group.items.some(item=>item.orphan),manageable=group.items.filter(item=>item.canToggle),removable=group.items.filter(item=>item.canRemove&&(filter!=='orphan'||item.orphan))
          return <section className={`startup-group ${open?'is-open':''}`} key={group.id} data-startup-group={group.id}>
            <div className="startup-group-row"><button className="startup-group-name" aria-expanded={open} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(open)next.delete(group.id);else next.add(group.id);return next})}><ChevronRight size={15} className={open?'is-open':''}/><StartupLogo item={group.items.find(item=>item.icon)||group.items[0]}/><span><strong>{group.name}</strong><small>{group.publisher||t('startup.configurations',{count:group.items.length})}</small></span></button>
              <div className="startup-group-meta">{status(group.state)}{orphan&&status(group.state,true)}<span className="startup-timing">{[...new Set(group.items.flatMap(item=>item.timing))].map(timing=>t('startup.timing.'+timing)).join(' · ')}</span></div>
              <div className="startup-row-actions">{ask(group.items,group.name)}{removable.length>0?<button className="icon-button" aria-label={t('startup.removeNamed',{name:group.name})} title={t('startup.action.remove')} disabled={busy||scanning} onClick={()=>prepare(removable,'remove',group.name)}><Trash2 size={15}/></button>:<button className="icon-button" title={t('startup.readonly')} aria-label={t('startup.manageInSettings',{name:group.name})} onClick={()=>manage(group.items)}><LockKeyhole size={15}/></button>}{toggle(group.items,group.name)}</div>
            </div>
            {open&&<div className="startup-details"><div className="startup-detail-summary"><span>{t('startup.configurations',{count:group.items.length})}</span>{!manageable.length&&<span><LockKeyhole size={13}/>{t('startup.readonly')}</span>}</div>{group.items.map(item=><div className="startup-item" key={item.id} data-startup-item={item.id}>
              <div className="startup-item-heading"><div><strong>{item.name}</strong>{status(item.state,item.orphan)}</div><div className="startup-item-actions">{(item.target||/^[A-Za-z]:|^\//.test(item.configuration))&&<button className="icon-button" title={t('common.reveal')} aria-label={`${t('common.reveal')} ${item.name}`} onClick={()=>reveal(item)}><FolderOpen size={15}/></button>}{ask([item],item.name)}{item.canRemove&&<button className="icon-button" aria-label={t('startup.removeNamed',{name:item.name})} title={t('startup.action.remove')} disabled={busy||scanning} onClick={()=>prepare([item],'remove',item.name)}><Trash2 size={15}/></button>}{toggle([item],item.name)}</div></div>
              {item.description&&<p className="startup-description">{item.description}</p>}
              <dl><div><dt>{t('startup.source')}</dt><dd>{t('startup.kind.'+item.kind)} · {t('startup.scope.'+item.scope)}{item.access==='administrator'&&` · ${t('startup.admin')}`}</dd></div><div><dt>{t('startup.when')}</dt><dd>{item.timing.map(value=>t('startup.timing.'+value)).join(' · ')}{item.running!==null&&` · ${t(item.running?'startup.running':'startup.notRunning')}`}</dd></div><div><dt>{t('startup.target')}</dt><dd title={item.target}>{item.target||t('startup.targetUnknown')}</dd></div><div><dt>{t('startup.configuration')}</dt><dd title={item.configuration}>{item.configuration||'—'}</dd></div></dl>
              {item.issue&&<p className={`startup-issue ${item.orphan?'is-orphan':''}`}><Info size={13}/>{t(item.issue)}</p>}
              {item.access==='settings'&&<button className="space-text-button" onClick={()=>manage([item])}>{t(item.issue==='startup.selfManaged'?'startup.selfSettings':'startup.systemManaged')}</button>}
            </div>)}</div>}
          </section>
        })}
        {!visible.length&&<div className="space-empty"><Power size={26}/><p>{t(catalog?.items.length?'startup.noMatches':'startup.empty')}</p></div>}
      </div>
      <p className="startup-footnote">{t('startup.effect')} <button className="space-text-button" onClick={openHistory}>{t('startup.history')}</button></p>
    </>}
    {history&&<WorkspaceDialog title={t('startup.history')} dismiss={()=>setHistory(null)}><div className="startup-history">{history.length?history.map(run=><article key={run.id}><strong>{run.title}</strong><span>{new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(run.createdAt))}</span>{run.operations.map(operation=><p key={operation.id}><span>{operation.title}</span><span>{t(operation.status==='completed'?'startup.historyDone':'startup.historyFailed')}</span></p>)}</article>):<p>{t('startup.historyEmpty')}</p>}</div><footer><button className="space-button" onClick={()=>setHistory(null)}>{t('common.close')}</button></footer></WorkspaceDialog>}
    {pending&&<WorkspaceDialog title={t('startup.action.'+pending.action)} dismiss={()=>{if(!busy)setPending(null)}}><p><strong>{pending.name}</strong> · {t('startup.configurations',{count:pending.items.length})}</p><p>{t(pending.action==='remove'?'startup.removeEffect':'startup.effect')}</p>{pending.items.some(item=>item.access==='administrator')&&<p className="startup-admin-note"><LockKeyhole size={14}/>{t('startup.adminEffect')}</p>}{pending.items.some(item=>item.timing.includes('scheduled')||item.timing.includes('event'))&&<p>{t('startup.otherTriggers')}</p>}<div className="space-dialog-files">{pending.items.map(item=><div key={item.id}><span>{item.name}</span><small>{item.configuration}</small></div>)}</div><footer><button className="space-button" disabled={busy} onClick={()=>setPending(null)}>{t('common.cancel')}</button><button className={`space-button ${pending.action==='remove'?'danger':'primary'}`} disabled={busy} onClick={()=>void execute()}>{busy?<LoaderCircle size={15} className="spinner"/>:null}{t(busy?'startup.verifying':'startup.action.'+pending.action)}</button></footer></WorkspaceDialog>}
  </div>
}
