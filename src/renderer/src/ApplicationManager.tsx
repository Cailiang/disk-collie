import {useMessages} from './Messages'
import {AppWindow,ArrowDown,ArrowUp,ArrowDownToLine,ArrowUpRight,ChevronRight,Clock3,File,Folder,LoaderCircle,LockKeyhole,Play,RefreshCw,Search,Trash2} from 'lucide-react'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {ApplicationInventoryState,RelatedApplicationFile,StorageApplication,StorageApplicationUpdateResult,StorageTarget} from '../../shared/storage-types'
import {applicationUnusedDays,compareApplications,pathContains,selectedApplicationFiles,type ApplicationSort} from '../../shared/application-files'
import {AiActionButton} from './AiTasks'
import {useI18n} from './i18n'
import {demoRelatedChildren} from './storage-demo'
import {ApplicationOperations} from '../../shared/application-operations'
import {mergeApplicationUpdate} from './application-updates'

type Props={inventory:ApplicationInventoryState|null;applications:StorageApplication[]|null;onApplications:(apps:StorageApplication[])=>void;busy:boolean;loadingFiles:boolean;application:StorageApplication|null;files:RelatedApplicationFile[];selected:Set<string>;onSelect:(ids:Set<string>)=>void;onFiles:(files:RelatedApplicationFile[])=>void;onInspect:(app:StorageApplication|null)=>void;onRefresh:()=>void;onConfirm:()=>void;actions:(file:{path:string;size:number},target:StorageTarget)=>React.ReactNode;bytes:(n:number)=>string;onNotice:(message:string)=>void;onError:(message:string)=>void}
export function ApplicationManager(props:Props):React.JSX.Element {
  const {inventory,applications,onApplications,busy,loadingFiles,application,files,selected,onSelect,onFiles,onInspect,onRefresh,onConfirm,actions,bytes,onNotice,onError}=props
  const {t,locale}=useI18n(),{show}=useMessages()
  useEffect(()=>{if(inventory?.error)show({message:inventory.error,tone:'error',title:t('apps.refreshFailed')})},[inventory?.error,show])
  const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'updates'|'unused'>('all'),[scope,setScope]=useState<'user'|'system'>('user'),[sort,setSort]=useState<ApplicationSort>('name'),[direction,setDirection]=useState<'ascending'|'descending'>('ascending')
  const [checking,setChecking]=useState(false),[updating,setUpdating]=useState(new Set<string>())
  const operations=useRef(new ApplicationOperations()),latestApplications=useRef(applications),seenApplications=useRef(applications)
  if(seenApplications.current!==applications){latestApplications.current=applications;seenApplications.current=applications}
  const [expanded,setExpanded]=useState(new Set<string>()),[loading,setLoading]=useState<string|null>(null),[loaded,setLoaded]=useState(new Map<string,{more:boolean;offset:number}>())
  useEffect(()=>{setExpanded(new Set());setLoaded(new Map());setLoading(null)},[application?.id])
  const visible=useMemo(()=>(applications||[]).filter((a)=>Boolean(a.system)===(scope==='system')&&`${a.name} ${a.bundleId||''}`.toLowerCase().includes(search.toLowerCase())&&(filter==='all'||filter==='updates'&&a.updateAvailable||filter==='unused'&&(applicationUnusedDays(a.lastUsedAt)??-1)>=90)).sort((a,b)=>compareApplications(a,b,sort,direction,locale)),[applications,scope,search,filter,sort,direction,locale])
  const sortHeader=(key:ApplicationSort,label:string):React.JSX.Element=><span role="columnheader" aria-sort={sort===key?direction:'none'}><button onClick={()=>{setSort(key);setDirection(sort===key?(direction==='ascending'?'descending':'ascending'):key==='name'?'ascending':'descending')}}>{label}{sort===key?(direction==='ascending'?<ArrowUp size={12}/>:<ArrowDown size={12}/>):<ArrowDown size={12} className="sort-inactive"/>}</button></span>
  const daysLabel=(app:StorageApplication):string=>{const days=applicationUnusedDays(app.lastUsedAt);return days===null?t('apps.usageUnknown'):days===0?t('apps.usedToday'):t('apps.unusedDays',{days})}
  const check=async():Promise<void>=>{setChecking(true);try{const next=window.diskCollie?await window.diskCollie.storageCheckUpdates():(applications||[]).map((a)=>({...a,updateCheckedAt:new Date().toISOString()}));latestApplications.current=next;onApplications(next);onNotice(t('apps.checked',{count:next.filter((a)=>a.updateAvailable&&!a.system).length}))}catch(e){onError(String(e))}finally{setChecking(false)}}
  const open=async(app:StorageApplication):Promise<void>=>{try{if(window.diskCollie)await window.diskCollie.storageOpenApplication(app.id);else onNotice(t('apps.opened',{name:app.name}))}catch(e){onError(String(e))}}
  const update=async(app:StorageApplication):Promise<void>=>{
    if(operations.current.has(app.id))return
    const pending=operations.current.run(app.id,'update',async():Promise<StorageApplicationUpdateResult>=>{
      if(window.diskCollie)return window.diskCollie.storageUpdateApplication(app.id)
      await new Promise((resolve)=>setTimeout(resolve,600))
      return app.updateAvailable?{status:'updated'}:{status:'opened',destination:'application'}
    })
    setUpdating(operations.current.activeIds('update'))
    try{
      const result=await pending
      if(result.status==='updated'){
        const next=mergeApplicationUpdate(latestApplications.current||[],app.id,result)
        latestApplications.current=next;onApplications(next)
        if(currentApplication.current===app.id)onInspect(null)
        onNotice(t('apps.updated',{name:app.name}))
      }else onNotice(t('apps.updaterOpened',{name:app.name}))
    }catch(e){onError(String(e))}finally{setUpdating(operations.current.activeIds('update'))}
  }
  const loadChildren=async(file:RelatedApplicationFile,offset=0):Promise<void>=>{
    if(busy)return
    const currentId=application?.id;setLoading(file.id)
    try {const result=window.diskCollie?await window.diskCollie.storageRelatedChildren({id:file.id,offset}):{items:demoRelatedChildren(file),more:false};if(currentId!==currentApplication.current)return;onFiles([...new Map([...files,...result.items].map((f)=>[f.id,f])).values()]);setLoaded((prev)=>new Map(prev).set(file.id,{more:result.more,offset:offset+100}))}catch(e){if(currentId===currentApplication.current)onError(String(e))}finally{if(currentId===currentApplication.current)setLoading(null)}
  }
  const currentApplication=useRef(application?.id);currentApplication.current=application?.id
  const selectedFiles=selectedApplicationFiles(files,selected)
  const renderFile=(file:RelatedApplicationFile,depth=0):React.ReactNode=>{
    const covered=selectedFiles.some((parent)=>parent.id!==file.id&&pathContains(parent.path,file.path)),checked=selected.has(file.id)||covered
    const isOpen=expanded.has(file.id)
    const change=():void=>{const next=new Set(selected);if(checked)next.delete(file.id);else next.add(file.id);onSelect(next)}
    return <div className="manager-file-branch" key={file.id}>
      <div className="space-related-row manager-file" style={{paddingLeft:12+depth*18}}>
        {file.directory?<button className="icon-button manager-file-toggle" disabled={busy} aria-label={`${t(isOpen?'compact.collapse':'compact.expand')} ${file.path}`} aria-expanded={isOpen} onClick={()=>{setExpanded((prev)=>{const next=new Set(prev);if(isOpen)next.delete(file.id);else next.add(file.id);return next});if(!isOpen&&!loaded.has(file.id))void loadChildren(file)}}><ChevronRight size={14} className={isOpen?'is-open':''}/></button>:<span className="manager-file-spacer"/>}
        <input type="checkbox" aria-label={file.path} checked={checked} disabled={file.kind==='application'||covered||busy||Boolean(application&&updating.has(application.id))} onChange={change}/>
        {file.directory?<Folder size={17}/>:<File size={17}/>}
        <div className="manager-file-name"><strong>{depth===0?t(`apps.${file.kind}`):file.path.split(/[/\\]/).pop()}</strong><small title={file.path}>{file.path}</small></div>
        <span className={`manager-file-effect effect-${file.kind}`}>{t(`apps.effect.${file.kind}`)}</span><b>{file.size?bytes(file.size):'—'}</b>{actions(file,{type:'related',id:file.id})}
      </div>
      {isOpen&&<div className="manager-file-children">{files.filter((child)=>child.parentId===file.id).map((child)=>renderFile(child,depth+1))}{loading===file.id?<div className="manager-file-loading" role="status"><LoaderCircle className="spinner" size={14}/>{t('common.working')}</div>:loaded.get(file.id)?.more?<button className="space-text-button" onClick={()=>void loadChildren(file,loaded.get(file.id)!.offset)}>{t('common.more')}</button>:loaded.has(file.id)&&!files.some((child)=>child.parentId===file.id)?<div className="manager-file-loading">{t('apps.emptyFolder')}</div>:null}</div>}
    </div>
  }
  return <>
    <header className="space-heading"><div><h1>{t('apps.title')}</h1></div><div className="space-actions">{scope==='user'&&<button className="space-button" disabled={!applications||busy||checking} onClick={()=>void check()}>{checking?<LoaderCircle className="spinner" size={15}/>:<ArrowDownToLine size={15}/>}<span>{t('apps.checkUpdates')}</span></button>}<button className="space-button" disabled={busy||checking} onClick={onRefresh}><RefreshCw size={15}/>{t('common.refresh')}</button></div></header>
    <div className="manager-inventory-status" role="status">{inventory?.refreshing||inventory?.measuringSizes?<LoaderCircle className="spinner" size={13}/>:<RefreshCw size={13}/>}<span>{t(inventory?.refreshing?applications?.length?'apps.refreshing':'apps.loading':inventory?.measuringSizes?'apps.measuringSizes':'apps.cacheReady')}</span>{inventory?.updatedAt&&<time dateTime={inventory.updatedAt}>{new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit'}).format(new Date(inventory.updatedAt))}</time>}</div>
    <div className="manager-summary"><span><b>{visible.length}</b> {t('apps.applicationCount')}</span><span>{t('apps.occupied')} <b>{bytes(visible.reduce((n,a)=>n+a.size,0))}</b></span></div>
    <div className="manager-scope-tabs" role="tablist" aria-label={t('apps.scope')}>{(['user','system'] as const).map((key)=><button key={key} role="tab" aria-selected={scope===key} onClick={()=>{setScope(key);setFilter('all');onInspect(null)}}>{t(`apps.scope.${key}`)}<span>{(applications||[]).filter((app)=>Boolean(app.system)===(key==='system')).length}</span></button>)}</div>
    <div className="manager-toolbar"><label className="space-search"><Search size={16}/><input type="search" aria-label={t('apps.search')} placeholder={t('apps.search')} value={search} onChange={(e)=>setSearch(e.target.value)}/></label>{scope==='user'&&<div className="space-segmented" role="group" aria-label={t('apps.filter')}>{(['all','updates','unused'] as const).map((key)=><button key={key} className={filter===key?'is-active':''} onClick={()=>setFilter(key)}>{t(`apps.filter.${key}`)}</button>)}</div>}</div>
    <div className="manager-table"><div className="manager-table-head" role="row">{sortHeader('name',t('apps.application'))}{sortHeader('used',t('apps.lastUsed'))}{sortHeader('size',t('common.size'))}<span>{t('apps.actions')}</span></div>
      {(applications===null||!applications.length&&inventory?.refreshing)&&<div className="manager-skeleton" aria-label={t('apps.loading')}>{[0,1,2,3].map((key)=><div key={key}><i/><span/><b/></div>)}</div>}
      {visible.map((app)=><section className={`space-application manager-application ${application?.id===app.id?'is-active':''}`} data-application-id={app.id} data-updating={updating.has(app.id)||undefined} key={app.id}>
        <div className="manager-row"><button className="space-app-row" aria-expanded={application?.id===app.id} disabled={busy} onClick={()=>onInspect(application?.id===app.id?null:app)}><ChevronRight size={14}/><ApplicationLogo application={app}/><span className="manager-app-name"><strong>{app.name}{app.system&&<LockKeyhole size={12}/>}</strong><small>{app.version||t('file.unknown')} · {app.bundleId||app.location}</small>{app.updateAvailable&&<span className="manager-update-label">{t('apps.availableVersion',{version:app.latestVersion||'—'})}</span>}</span><span className={`manager-last-used ${(applicationUnusedDays(app.lastUsedAt)??0)>=90?'is-unused':''}`} title={app.lastUsedAt?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(app.lastUsedAt)):t('apps.usageUnknown')}><Clock3 size={13}/>{daysLabel(app)}</span><b>{app.size?bytes(app.size):'—'}</b></button>
        <div className="manager-row-actions"><button className="icon-button" title={t('apps.open')} aria-label={`${t('apps.open')} ${app.name}`} onClick={()=>void open(app)}><Play size={15}/></button>{!app.system&&<button className={`manager-update-button ${app.updateAvailable?'has-update':''} ${updating.has(app.id)?'is-updating':''}`} title={t(updating.has(app.id)?'apps.updating':app.updateAvailable?'apps.update':'apps.openUpdater')} aria-label={`${t(updating.has(app.id)?'apps.updating':app.updateAvailable?'apps.update':'apps.openUpdater')} ${app.name}`} aria-busy={updating.has(app.id)} disabled={app.protected||updating.has(app.id)} onClick={()=>void update(app)}>{updating.has(app.id)?<LoaderCircle className="spinner" size={15}/>:<ArrowDownToLine size={15}/>}<span>{t(updating.has(app.id)?'apps.updating':app.updateAvailable?'apps.update':'apps.openUpdater')}</span></button>}<AiActionButton request={{key:`app:${app.location}:${app.version}`,title:app.name,prompt:t('apps.aiPrompt',{name:app.name,bundle:app.bundleId||t('file.unknown'),version:app.version,path:JSON.stringify(app.location),used:daysLabel(app)})}}/>{!app.system&&!app.protected&&<button className="icon-button" title={t('apps.reviewRemoval')} aria-label={`${t('apps.reviewRemoval')} ${app.name}`} disabled={app.protected||busy||updating.has(app.id)} onClick={()=>onInspect(app)}><Trash2 size={15}/></button>}</div></div>
        {application?.id===app.id&&<div className="space-app-detail manager-detail"><div className="manager-detail-heading"><div><h2>{t('apps.files')}</h2><p>{app.location}</p></div><span>{t('common.items',{count:files.filter((f)=>!f.parentId).length})}</span></div>
          {app.protected||app.system?<div className="space-protected"><LockKeyhole size={16}/>{t(app.system?'apps.systemProtected':'apps.protected')}</div>:app.method==='system'?<div className="manager-handoff"><p>{t('apps.systemDescription')}</p><button className="space-button" onClick={()=>{if(window.diskCollie)void window.diskCollie.storageUninstall({applicationId:app.id,ids:[]}).catch((e)=>onError(String(e)))}}>{t('apps.system')}<ArrowUpRight size={14}/></button></div>:<>
          <p className="manager-selection-note">{t('apps.reviewNote')}</p>
          {loadingFiles?<div className="manager-loading" role="status"><LoaderCircle className="spinner" size={18}/>{t('apps.filesLoading')}</div>:<div className="space-related-group manager-files">{files.filter((f)=>!f.parentId).map((f)=>renderFile(f))}</div>}
          {!loadingFiles&&files.some((file)=>file.kind==='application')&&files.every((file)=>file.kind==='application')&&<p className="manager-empty-related">{t('apps.noRelated')}</p>}
          {!loadingFiles&&!files.length&&<div className="manager-detail-error" role="status"><span>{t('apps.filesUnavailable')}</span><button className="space-button" onClick={()=>onInspect(app)}>{t('common.retry')}</button></div>}
          <footer className="space-app-actions manager-remove-bar space-selection-bar"><div><strong>{bytes(selectedFiles.reduce((n,f)=>n+f.size,0))}</strong><span>{t('common.selected',{count:selectedFiles.length})}</span></div><button className="space-button danger" disabled={busy||loadingFiles||!files.some((f)=>f.kind==='application')||updating.has(app.id)} onClick={onConfirm}><Trash2 size={15}/>{t('apps.uninstall')}</button></footer></>}
        </div>}
      </section>)}{applications!==null&&!visible.length&&!inventory?.refreshing&&<div className="space-empty">{t('apps.noMatches')}</div>}
    </div>
  </>
}

export function ApplicationLogo({application}:{application:StorageApplication}):React.JSX.Element {
  const [source,setSource]=useState<string|null>(null),ref=useRef<HTMLSpanElement>(null)
  useEffect(()=>{let active=true;setSource(null);const observer=new IntersectionObserver((entries)=>{if(entries.some((e)=>e.isIntersecting)){observer.disconnect();if(window.diskCollie)void window.diskCollie.storageApplicationIcon(application.id).then((icon)=>{if(active)setSource(icon)}).catch(()=>undefined);else setSource(application.bundleId==='com.figma.Desktop'?new URL('./assets/demo-figma.svg',import.meta.url).href:application.bundleId==='com.microsoft.VSCode'?new URL('./assets/demo-vscode.ico',import.meta.url).href:null)}});if(ref.current)observer.observe(ref.current);return()=>{active=false;observer.disconnect()}},[application.id,application.version,application.location,application.iconPath,application.cached])
  return <span className="space-app-monogram manager-logo" ref={ref}>{source?<img src={source} alt={`${application.name} logo`}/>:<AppWindow size={24}/>}</span>
}
