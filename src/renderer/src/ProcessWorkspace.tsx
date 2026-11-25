import { Activity, ArrowDown, ArrowUp, Copy, MoreHorizontal, Pause, Play, Search, Sparkles, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OverviewMetrics, OverviewProcess } from '../../shared/types'
import { StorageDialog } from './StorageWorkspace'
import { WorkspaceHelp } from './WorkspaceHelp'
import { useI18n } from './i18n'

type Sort='name'|'pid'|'cpuPercent'|'memoryBytes'
const iconCache=new Map<string,string|null>()
function ProcessLogo({process}:{process:OverviewProcess}):React.JSX.Element {
  const ref=useRef<HTMLSpanElement>(null),[icon,setIcon]=useState<string|null>(iconCache.get(process.command)||null)
  useEffect(()=>{
    let active=true
    setIcon(iconCache.get(process.command)||null)
    const observer=new IntersectionObserver((entries)=>{if(!entries.some((e)=>e.isIntersecting))return;observer.disconnect();if(!window.memento||!process.command)return;if(iconCache.has(process.command))return;void window.memento.getProcessIcon(process.command).then((value)=>{iconCache.set(process.command,value);if(active)setIcon(value)}).catch(()=>undefined)})
    if(ref.current)observer.observe(ref.current)
    return()=>{active=false;observer.disconnect()}
  },[process.command])
  return <span ref={ref} className="process-logo">{icon?<img src={icon} alt=""/>:<Activity size={18}/>}</span>
}
export function ProcessWorkspace({metrics,paused,error,onPause,onAsk,onCopyName,onCopyPid,onTerminate}:{metrics:OverviewMetrics|null;paused:boolean;error:string|null;onPause:(paused:boolean)=>void;onAsk:(p:OverviewProcess)=>void;onCopyName:(name:string)=>void;onCopyPid:(pid:number)=>void;onTerminate:(p:OverviewProcess,force:boolean)=>void}):React.JSX.Element {
  const {t,locale}=useI18n()
  const [query,setQuery]=useState(''),[sort,setSort]=useState<Sort>('memoryBytes'),[ascending,setAscending]=useState(false)
  const [scope,setScope]=useState('all'),[menu,setMenu]=useState<number|null>(null)
  const [confirm,setConfirm]=useState<{process:OverviewProcess;force:boolean}|null>(null)
  const menuRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(menu===null)return
    const close=(e:PointerEvent):void=>{if(!menuRef.current?.contains(e.target as Node))setMenu(null)}
    const escape=(e:KeyboardEvent):void=>{if(e.key==='Escape')setMenu(null)}
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)}
  },[menu])
  const processes=useMemo(()=>(metrics?.processes||[]).filter((p)=>(scope==='all'||(scope==='system')===p.isSystem)&&`${p.name} ${p.pid} ${p.command}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{const value=sort==='name'?a.name.localeCompare(b.name):a[sort]-b[sort];return ascending?value:-value}),[metrics,query,sort,ascending,scope])
  const percent=(n:number):string=>`${new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(n)}%`
  const memory=(n:number):string=>`${new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(n/1024**(n>=1024**3?3:2))} ${n>=1024**3?'GB':'MB'}`
  const sortHeader=(key:Sort,label:string):React.ReactNode=><th scope="col" aria-sort={sort===key?ascending?'ascending':'descending':'none'}><button onClick={()=>{if(sort===key)setAscending(!ascending);else{setSort(key);setAscending(key==='name')}}}>{label}{sort===key&&(ascending?<ArrowUp size={12}/>:<ArrowDown size={12}/>)}</button></th>
  return <div className="space-workspace space-processes"><header className="space-heading"><div><h1>{t('process.title')}</h1><WorkspaceHelp>{t('process.subtitle')}</WorkspaceHelp></div><div className="space-process-metrics"><span>CPU <b>{percent(metrics?.cpu.usagePercent||0)}</b></span><span>{t('process.memory')} <b>{memory(metrics?.memory.usedBytes||0)}</b></span><button className="space-button" onClick={()=>onPause(!paused)}>{paused?<Play size={15}/>:<Pause size={15}/>} {t(paused?'process.resume':'process.pause')}</button></div></header>{error&&<div className="space-alert" role="alert">{error}</div>}
    <div className="space-toolbar"><label className="space-search"><Search size={16}/><input type="search" placeholder={t('process.search')} aria-label={t('process.search')} value={query} onChange={(e)=>setQuery(e.target.value)}/></label><div className="space-segmented" role="group" aria-label={t('compact.processScope')}>{['all','user','system'].map((s)=><button className={scope===s?'is-active':''} key={s} onClick={()=>setScope(s)}>{t(`compact.${s}`)}</button>)}</div><span>{processes.length} · {t(paused?'process.paused':'process.live')}</span></div>
    <div className="space-process-table"><table><thead><tr>{sortHeader('name',t('common.name'))}{sortHeader('pid','PID')}{sortHeader('cpuPercent','CPU')}{sortHeader('memoryBytes',t('process.memory'))}<th scope="col">{t('compact.actions')}</th></tr></thead><tbody>{processes.map((p)=><tr key={p.pid} className="space-process-row"><td><span className="space-process-name" title={p.command}><ProcessLogo process={p}/><span><strong>{p.name}</strong><small>{p.command}</small></span></span></td><td>{p.pid}</td><td>{percent(p.cpuPercent)}</td><td><b>{memory(p.memoryBytes)}</b></td><td><div className="space-process-actions"><button className="icon-button" title={t('process.ask')} aria-label={`${t('process.ask')} ${p.name}`} onClick={()=>onAsk(p)}><Sparkles size={16}/></button><button className="icon-button" title={t(p.isSystem?'process.protected':'process.quit')} aria-label={`${t('process.quit')} ${p.name}`} disabled={p.isSystem} onClick={()=>setConfirm({process:p,force:false})}><Square size={15}/></button><button className="icon-button" aria-label={`${t('compact.actions')} ${p.name}`} aria-expanded={menu===p.pid} onClick={()=>setMenu(menu===p.pid?null:p.pid)}><MoreHorizontal size={17}/></button>{menu===p.pid&&<div className="space-process-menu" ref={menuRef} role="group" aria-label={t('compact.actions')}><button onClick={()=>{onCopyName(p.name);setMenu(null)}}><Copy size={14}/>{t('process.copyName')}</button><button onClick={()=>{onCopyPid(p.pid);setMenu(null)}}><Copy size={14}/>PID</button>{!p.isSystem&&<button onClick={()=>{setConfirm({process:p,force:true});setMenu(null)}}><Square size={14}/>{t('process.force')}</button>}</div>}</div></td></tr>)}</tbody></table>{!processes.length&&<div className="space-empty">{t('common.empty')}</div>}</div>
    {confirm&&<StorageDialog title={t(confirm.force?'process.force':'process.quit')} dismiss={()=>setConfirm(null)}><p>{confirm.process.name} · PID {confirm.process.pid}</p><p>{t(confirm.force?'process.forceEffect':'process.quitEffect')}</p><footer><button className="space-button" onClick={()=>setConfirm(null)}>{t('common.cancel')}</button><button className="space-button danger" onClick={()=>{onTerminate(confirm.process,confirm.force);setConfirm(null)}}>{t('common.continue')}</button></footer></StorageDialog>}
  </div>
}
