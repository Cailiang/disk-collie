import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronRight, CircleHelp, Copy, File, Folder, FolderOpen, HardDrive, Layers3, LoaderCircle, LockKeyhole, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CleanupItem, DuplicateGroup, RelatedApplicationFile, StorageActivity, StorageApplication, StorageEntry, StorageIndex, StorageProgress } from '../../shared/storage-types'
import type { OverviewMetrics } from '../../shared/types'
import type { AgentViewKey } from './agent-ui/Shell'
import { useI18n } from './i18n'
import { demoApps, demoCleanup, demoDuplicates, demoHistory, demoIndex, demoLarge, demoPrivacy, demoRelated, demoChildren } from './storage-demo'
import { fileCategories, fileCategory, type FileCategory } from '../../shared/file-categories'
import { WorkspaceHelp } from './WorkspaceHelp'
import { treemap } from './treemap'

export type StorageView = 'overview'|'health'|'large'|'duplicates'|'disk'|'privacy'|'apps'|'history'
interface Confirmation { kind:StorageActivity['kind']; count:number; size:number; names:string[]; run:()=>Promise<StorageActivity|null> }
const MB=1024**2
export function StorageWorkspace({view,metrics,onNavigate,historyChildren}:{view:StorageView;metrics:OverviewMetrics|null;onNavigate:(view:AgentViewKey)=>void;historyChildren?:React.ReactNode}):React.JSX.Element {
  const {t,locale}=useI18n()
  const bytes=useCallback((n:number):string=>{
    if (!Number.isFinite(n) || n<=0) return '0 B'
    const power=Math.min(4,Math.floor(Math.log(n)/Math.log(1024)))
    return `${new Intl.NumberFormat(locale,{maximumFractionDigits:power>1?1:0}).format(n/1024**power)} ${['B','KB','MB','GB','TB'][power]}`
  },[locale])
  const [index,setIndex]=useState<StorageIndex|null>(null)
  const [history,setHistory]=useState<StorageActivity[]>([])
  const [busy,setBusy]=useState(false)
  const [task,setTask]=useState<'scan'|'duplicates'|'cleanup'|'apps'|'related'|null>(null)
  const [progress,setProgress]=useState<StorageProgress|null>(null)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [large,setLarge]=useState<StorageEntry[]>([])
  const [largeCount,setLargeCount]=useState(0)
  const [category,setCategory]=useState<FileCategory|'all'>('all')
  const [categoryCounts,setCategoryCounts]=useState<Record<string,number>>({})
  const [duplicateMinimum,setDuplicateMinimum]=useState(200*1024)
  const [includeHidden,setIncludeHidden]=useState(false)
  const [groupLimit,setGroupLimit]=useState(40)
  const [minimum,setMinimum]=useState(100*MB)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [selected,setSelected]=useState<Set<number>>(new Set())
  const [folder,setFolder]=useState<StorageEntry|null>(null)
  const [children,setChildren]=useState<StorageEntry[]>([])
  const [breadcrumbs,setBreadcrumbs]=useState<StorageEntry[]>([])
  const [groups,setGroups]=useState<DuplicateGroup[]|null>(null)
  const [cleanup,setCleanup]=useState<CleanupItem[]|null>(null)
  const [privacy,setPrivacy]=useState<CleanupItem[]|null>(null)
  const [ruleSelected,setRuleSelected]=useState<Set<string>>(new Set())
  const [applications,setApplications]=useState<StorageApplication[]|null>(null)
  const [appSearch,setAppSearch]=useState('')
  const [application,setApplication]=useState<StorageApplication|null>(null)
  const [related,setRelated]=useState<RelatedApplicationFile[]>([])
  const [relatedSelected,setRelatedSelected]=useState<Set<string>>(new Set())
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null)
  const [completed,setCompleted]=useState<StorageActivity|null>(null)
  const [executing,setExecuting]=useState(false)
  const [ledgerOpen,setLedgerOpen]=useState(false)
  const cancelled=useRef(false)
  const mounted=useRef(true)
  const querySequence=useRef(0)
  const detailsSequence=useRef(0)
  const attempted=useRef(new Set<string>())
  const mainRef=useRef<HTMLDivElement>(null)
  const demo=!window.memento
  const runTask=useCallback(async<T,>(kind:typeof task,work:()=>Promise<T>):Promise<T|null>=>{
    cancelled.current=false;setBusy(true);setTask(kind);setError('');setNotice('')
    try {return await work()} catch(e){if(!cancelled.current)setError(e instanceof Error?e.message:String(e));return null}
    finally {if(mounted.current){setBusy(false);setTask(null);setProgress(null)}}
  },[])
  useEffect(()=>{
    mounted.current=true
    if(window.memento) void window.memento.storageState().then((s)=>{setIndex(s.index);setHistory(s.history)}).catch((e)=>setError(String(e)))
    else {setIndex(demoIndex);setHistory(demoHistory)}
    const unsubscribe=window.memento?.onStorageProgress(setProgress)
    return ()=>{mounted.current=false;unsubscribe?.()}
  },[])
  useEffect(()=>{setSelected(new Set());setRuleSelected(new Set());setError('');setNotice('');setSearch('');setOffset(0);setCategory('all');setGroupLimit(40);mainRef.current?.scrollTo(0,0)},[view])
  useEffect(()=>{setGroups(null);setSelected(new Set());setOffset(0);setBreadcrumbs([]);setFolder(null)},[index?.generation,index?.root?.path])
  useEffect(()=>{if(index?.mode&&(['large','disk','duplicates'].includes(view))&&(view==='duplicates'?index.mode!=='duplicates':index.mode!=='analysis'&&index.mode!==view))setIndex(null)},[view,index])
  const scan=async(choose=false):Promise<void>=>{
    const result=await runTask('scan',async()=>{
      if(window.memento)return window.memento.storageScan({choose,mode:view==='disk'||view==='overview'?'analysis':view==='duplicates'?'duplicates':'large',minimum:duplicateMinimum,includeHidden})
      await new Promise((resolve)=>setTimeout(resolve,450));return {...demoIndex,generation:(index?.generation||0)+1}
    })
    if(result){setIndex(result);setGroups(null);setSelected(new Set());setBreadcrumbs([]);setFolder(null);if(view==='duplicates')void findDuplicates(result)}
  }
  const cancel=async():Promise<void>=>{cancelled.current=true;await window.memento?.storageCancel();setIndex(null)}
  const loadCleanup=useCallback(async(isPrivacy:boolean):Promise<void>=>{
    const result=await runTask('cleanup',async()=>window.memento?window.memento.storageCleanup(isPrivacy):(isPrivacy?demoPrivacy:demoCleanup))
    if(result){if(isPrivacy)setPrivacy(result);else setCleanup(result);setRuleSelected(new Set())}
  },[runTask])
  const loadApps=useCallback(async():Promise<void>=>{
    const result=await runTask('apps',async()=>window.memento?window.memento.storageApplications():demoApps)
    if(result){setApplications(result);setApplication(null);setRelated([])}
  },[runTask])
  useEffect(()=>{
    if(busy||attempted.current.has(view))return
    if(view==='health'&&cleanup===null){attempted.current.add(view);void loadCleanup(false)}
    if(view==='privacy'&&privacy===null){attempted.current.add(view);void loadCleanup(true)}
    if(view==='apps'&&applications===null){attempted.current.add(view);void loadApps()}
  },[view,cleanup,privacy,applications,busy,loadCleanup,loadApps])
  useEffect(()=>{
    if(view!=='large'||!index)return
    const sequence=++querySequence.current
    const timeout=setTimeout(()=>{
      const work=window.memento?window.memento.storageLarge({generation:index.generation,minimum,search,offset,category}):Promise.resolve({items:demoLarge.filter((e)=>e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())&&(category==='all'||fileCategory(e.name)===category)),count:demoLarge.filter((e)=>e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())&&(category==='all'||fileCategory(e.name)===category)).length,categories:demoLarge.filter((e)=>e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())).reduce<Record<string,number>>((counts,e)=>{const key=fileCategory(e.name);counts[key]=(counts[key]||0)+1;return counts},{})})
      void work.then((r)=>{if(sequence!==querySequence.current)return;setLarge((prev)=>offset?[...prev,...r.items]:r.items);setLargeCount(r.count);setCategoryCounts(r.categories||{})}).catch((e)=>{if(sequence===querySequence.current)setError(String(e))})
    },150)
    return ()=>{clearTimeout(timeout);++querySequence.current}
  },[index,view,minimum,search,offset,category])
  const openFolder=useCallback(async(entry:StorageEntry,trail:StorageEntry[]):Promise<void>=>{
    if(!index)return
    const sequence=++querySequence.current
    try {
      const result=window.memento?await window.memento.storageChildren({generation:index.generation,id:entry.id}):{parent:entry,items:demoChildren(entry)}
      if(sequence!==querySequence.current)return
      setFolder(result.parent);setChildren(result.items);setBreadcrumbs(trail)
    }catch(e){setError(String(e))}
  },[index])
  useEffect(()=>{if(view==='disk'&&index?.root&&!folder)void openFolder(index.root,[index.root])},[view,index,folder,openFolder])
  const findDuplicates=async(current=index):Promise<void>=>{
    if(!current)return
    const result=await runTask('duplicates',()=>window.memento?window.memento.storageDuplicates(current.generation,duplicateMinimum):Promise.resolve({groups:demoDuplicates,elapsedMs:150}))
    if(result){setGroups(result.groups);setSelected(new Set())}
  }
  const inspect=async(app:StorageApplication):Promise<void>=>{
    const sequence=++detailsSequence.current
    setApplication(app);setRelated([]);setRelatedSelected(new Set())
    if(app.method==='system')return
    const result=await runTask('related',()=>window.memento?window.memento.storageRelated(app.id):Promise.resolve(demoRelated.map((r)=>r.kind==='application'?{...r,path:app.location}:r)))
    if(result&&sequence===detailsSequence.current){setRelated(result);setRelatedSelected(new Set(result.filter((r)=>r.kind==='application').map((r)=>r.id)))}
  }
  const fakeActivity=async(kind:StorageActivity['kind'],count:number,size:number):Promise<StorageActivity>=>{
    await new Promise((resolve)=>setTimeout(resolve,300))
    return {id:crypto.randomUUID(),date:new Date().toISOString(),kind,items:count,bytes:size,failures:0,locations:[]}
  }
  const confirmTrash=(entries:StorageEntry[],group?:DuplicateGroup):void=>{
    if(!index||!entries.length)return
    const kind=group?'duplicates':'large'
    setConfirmation({kind,count:entries.length,size:entries.reduce((s,e)=>s+e.allocated,0),names:entries.map((e)=>e.path),run:()=>window.memento?window.memento.storageTrash({generation:index.generation,ids:entries.map((e)=>e.id),kind,groupId:group?.id}):fakeActivity(kind,entries.length,entries.reduce((s,e)=>s+e.size,0))})
  }
  const confirmClean=():void=>{
    const items=(view==='privacy'?privacy:cleanup)?.filter((r)=>ruleSelected.has(r.id))||[]
    if(!items.length)return
    const kind=view==='privacy'?'privacy':'cleanup'
    setConfirmation({kind,count:items.length,size:items.reduce((s,e)=>s+e.size,0),names:items.flatMap((e)=>e.paths||[e.path]),run:()=>window.memento?window.memento.storageClean(items.map((e)=>e.id)):fakeActivity(kind,items.length,items.reduce((s,e)=>s+e.size,0))})
  }
  const confirmUninstall=():void=>{
    if(!application)return
    const items=related.filter((r)=>relatedSelected.has(r.id))
    setConfirmation({kind:'uninstall',count:items.length,size:items.reduce((s,e)=>s+e.size,0),names:items.map((e)=>e.path),run:()=>window.memento?window.memento.storageUninstall({applicationId:application.id,ids:items.map((e)=>e.id)}):fakeActivity('uninstall',items.length,items.reduce((s,e)=>s+e.size,0))})
  }
  const execute=async():Promise<void>=>{
    if(!confirmation||executing)return
    setExecuting(true);setError('')
    try {
      const result=await confirmation.run()
      if(result){setCompleted(result);setHistory((prev)=>[result,...prev]);setIndex(null);setGroups(null);setCleanup(null);setPrivacy(null);setSelected(new Set());setRuleSelected(new Set());if(result.kind==='uninstall'){setApplications((prev)=>prev?.filter((a)=>a.id!==application?.id)||null);setApplication(null);setRelated([])}}
      setConfirmation(null)
    }catch(e){setError(e instanceof Error?e.message:String(e));setConfirmation(null)}finally{setExecuting(false)}
  }
  const toggle=<T,>(setter:React.Dispatch<React.SetStateAction<Set<T>>>,id:T):void=>setter((prev)=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next})
  const reveal=async(entry:StorageEntry):Promise<void>=>{if(!index)return;try{if(window.memento)await window.memento.storageReveal({generation:index.generation,id:entry.id});else setNotice(t('common.reveal'))}catch(e){setError(String(e))}}
  const formatDate=(date:string|number):string=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(date))
  const heading=(title:string,subtitle:string,action?:React.ReactNode):React.JSX.Element=><header className="space-heading"><div><h1>{t(title)}</h1><WorkspaceHelp>{t(subtitle)}{view==='duplicates'&&<p>{t('compact.duplicateHelp')}</p>}{view==='large'&&<p>{t('compact.largeHelp')}</p>}{view==='disk'&&<p>{t('disk.hint')}</p>}{view==='privacy'&&<p>{t('privacy.warning')}</p>}{view==='apps'&&<p>{t('apps.evidence')}</p>}</WorkspaceHelp></div>{action}</header>
  const scanButtons=<div className="space-actions"><button className="space-button" disabled={busy} onClick={()=>void scan(true)}><FolderOpen size={16}/>{t('common.choose')}</button><button className="space-button primary" disabled={busy} onClick={()=>void scan()}><Search size={16}/>{t(index?'common.rescan':'common.scan')}</button></div>
  const scanPrompt=<div className="space-start"><HardDrive size={32}/><h2>{t('compact.chooseScope')}</h2>{scanButtons}</div>
  const scanStatus=index&&<div className="space-scan-status"><CheckCircle2 size={14}/><span>{t('scan.ready',{count:index.entries.toLocaleString(locale),seconds:(index.elapsedMs/1000).toFixed(2)})}</span><code title={index.root?.path}>{index.root?.path}</code><WorkspaceHelp>{t('scan.coverage',{errors:index.errors,skipped:index.skipped})}</WorkspaceHelp></div>
  const taskProgress=busy&&task!=='related'&&task!=='apps'&&<div className="space-progress" role="status" aria-live="polite"><div className="space-scan-orbit"><LoaderCircle className="spinner" size={24}/></div><div className="space-progress-copy"><strong>{t(task==='scan'?'scan.title':task==='duplicates'?`scan.${progress?.phase||'sampling'}`:'common.working')}</strong><span>{progress?`${progress.entries.toLocaleString(locale)}${progress.total!==undefined?` / ${progress.total.toLocaleString(locale)}`:''} · ${(progress.elapsedMs/1000).toFixed(1)} s`:'—'}</span><small title={progress?.path}>{progress?.path}</small><div className={`space-progress-track ${progress?.total?'is-measured':''}`} role="progressbar" aria-label={t('scan.title')} aria-valuenow={progress?.total?Math.round(progress.entries/progress.total*100):undefined} aria-valuemin={0} aria-valuemax={100}><i style={progress?.total?{width:`${progress.entries/progress.total*100}%`}:undefined}/></div></div>{(task==='scan'||task==='duplicates')&&<button className="space-button" onClick={()=>void cancel()}>{t('common.cancel')}</button>}</div>
  const categories=(counts:Record<string,number>):React.JSX.Element=><div className="space-category-tabs" role="group" aria-label={t('compact.categories')}>{(['all',...Object.keys(fileCategories),'other'] as const).map((key)=><button key={key} className={category===key?'is-active':''} onClick={()=>{setCategory(key as typeof category);setOffset(0);setSelected(new Set());setGroupLimit(40)}}>{t(`category.${key}`)}<small>{key==='all'?Object.values(counts).reduce((a,b)=>a+b,0):counts[key]||0}</small></button>)}</div>
  const activityRows=(records:StorageActivity[]):React.JSX.Element=><div className="space-activity">{records.map((r)=><div className="space-activity-row" key={r.id}><span className={`space-activity-icon ${r.failures?'has-error':''}`}>{r.kind==='privacy'?<ShieldCheck size={19}/>:r.kind==='cleanup'?<Sparkles size={19}/>:<Trash2 size={19}/>}</span><div><strong>{t(`history.${r.kind}`)}</strong><small>{formatDate(r.date)} · {t('history.items',{count:r.items})}{r.failures>0&&` · ${t('history.failures',{count:r.failures})}`}</small></div><b>{bytes(r.bytes)}</b><Check size={15}/></div>)}</div>
  const cleaned=history.filter((r)=>r.kind==='cleanup'||r.kind==='privacy').reduce((s,r)=>s+r.bytes,0)
  const trashed=history.filter((r)=>r.kind!=='cleanup'&&r.kind!=='privacy').reduce((s,r)=>s+r.bytes,0)
  const total=metrics?.disk.totalBytes||512*1024**3, free=metrics?.disk.availableBytes||(demo?168*1024**3:0)
  const usedPercent=Math.max(0,Math.min(100,100-free/total*100))
  const colors=['#355e54','#5b8070','#88a28a','#b5c4a7','#d2ba96','#c49173','#b78281','#8d929e','#66798c']
  const mapEntries=useMemo(()=>{
    const entries=children.filter((e)=>e.size>0).slice(0,24)
    const remainder=(folder?.size||0)-entries.reduce((sum,e)=>sum+e.size,0)
    if(folder&&remainder>0)entries.push({...folder,id:-1,name:t('disk.other'),size:remainder})
    return entries
  },[children,folder,t])
  const map=useMemo(()=>treemap(mapEntries),[mapEntries])
  const selectedLarge=large.filter((e)=>selected.has(e.id))
  const rules=view==='privacy'?privacy:cleanup
  return <div className={`space-workspace space-${view}`} ref={mainRef}>
    {error&&<div className="space-alert" role="alert"><CircleHelp size={18}/><span>{error}</span><button className="icon-button" aria-label={t('common.close')} onClick={()=>setError('')}><X size={16}/></button></div>}
    {notice&&<div className="space-alert" role="status">{notice}</div>}
    {view==='overview'&&<>
      {heading('home.title','home.subtitle')}
      <section className="space-home-hero">
        <div className="space-home-primary"><span className="space-eyebrow">{t('home.storage')}</span><div className="space-home-amount"><strong>{metrics||demo?bytes(free):'—'}</strong><span>{t('home.available')}</span><span className="space-home-drive"><HardDrive size={20}/></span></div><div className="space-capacity"><span style={{width:`${usedPercent}%`}}/></div><div className="space-capacity-legend"><span><i/>{t('home.used')} <b>{metrics||demo?bytes(total-free):'—'}</b></span><span><i/>{t('home.free')} <b>{metrics||demo?bytes(free):'—'}</b></span><span>{bytes(total)}</span></div><div className="space-hero-divider"/><div className="space-actions"><button className="space-button primary" onClick={()=>onNavigate('disk')}>{t('home.scanCta')}<ArrowRight size={17}/></button><button className="space-text-button" disabled={busy} onClick={()=>{onNavigate('disk');void scan(true)}}>{t('home.choose')}</button></div></div>
        <div className="space-home-achievement"><span className="space-achievement-symbol"><Layers3 size={29}/></span><span className="space-eyebrow">{t('home.achievement')}</span><strong>{bytes(cleaned)}</strong><p>{t('home.cleaned')}</p><div className="space-achievement-bottom"><div><b>{history.filter((r)=>r.items>0).length}</b><small>{t('home.sessions')}</small></div><div><b>{bytes(trashed)}</b><small>{t('home.trashed')}</small></div></div></div>
      </section>
      <div className="space-section-title"><div><h2>{t('home.tools')}</h2></div><span className="space-local-tag"><ShieldCheck size={15}/>{t('home.privacyLocal')}</span></div>
      <div className="space-tools-grid">{([{id:'large',icon:File,color:'terra',description:'home.largeDesc'},{id:'duplicates',icon:Copy,color:'lavender',description:'home.duplicateDesc'},{id:'health',icon:Sparkles,color:'sage',description:'home.cleanupDesc'},{id:'privacy',icon:ShieldCheck,color:'sand',description:'home.privacyDesc'},{id:'apps',icon:Layers3,color:'blue',description:'home.appsDesc'},{id:'processes',icon:HardDrive,color:'rose',description:'home.processDesc'}] as const).map((tool)=><button className="space-tool" key={tool.id} onClick={()=>onNavigate(tool.id)}><span className={`space-tool-icon ${tool.color}`}><tool.icon size={23}/></span><ArrowUpRight className="space-tool-arrow" size={17}/><strong>{t(`nav.${tool.id==='health'?'cleanup':tool.id}`)}</strong></button>)}</div>
      <div className="space-section-title"><h2>{t('home.recent')}</h2><button className="space-text-button" onClick={()=>onNavigate('history')}>{t('home.viewHistory')}<ArrowRight size={14}/></button></div>{history.length?activityRows(history.slice(0,3)):<div className="space-empty-history"><span><CheckCircle2 size={26}/></span><div><strong>{t('home.noHistory')}</strong></div></div>}
    </>}
    {(view==='large'||view==='disk'||view==='duplicates')&&<>
      {heading(`${view}.title`,`${view}.subtitle`,index?scanButtons:undefined)}
      {(view==='duplicates'||view==='large')&&<div className="space-toolbar duplicate-options">{view==='duplicates'&&<label>{t('large.minimum')} <select aria-label={t('large.minimum')} disabled={busy} value={duplicateMinimum} onChange={(e)=>{setDuplicateMinimum(Number(e.target.value));setIndex(null);setGroups(null)}}>{[200*1024,MB,10*MB,100*MB].map((n)=><option value={n} key={n}>{bytes(n)} +</option>)}</select></label>}<label className="space-inline-check"><input type="checkbox" disabled={busy} checked={includeHidden} onChange={(e)=>{setIncludeHidden(e.target.checked);setIndex(null);setGroups(null)}}/>{t('compact.includeHidden')}</label></div>}
      {taskProgress}
      {!index&&!busy?scanPrompt:index&&<>{scanStatus}
        {view==='large'&&<>
          <div className="space-toolbar"><label className="space-search"><Search size={17}/><input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e)=>{setSearch(e.target.value);setOffset(0);setSelected(new Set())}}/></label><select aria-label={t('large.minimum')} value={minimum} onChange={(e)=>{setMinimum(Number(e.target.value));setOffset(0);setSelected(new Set())}}><option value={10*MB}>10 MB +</option><option value={100*MB}>100 MB +</option><option value={1024*MB}>1 GB +</option><option value={5*1024*MB}>5 GB +</option></select><span>{t('large.found',{count:largeCount})}</span></div>
          {categories(categoryCounts)}
          <div className="space-file-table"><div className="space-file-table-head"><input type="checkbox" aria-label={t('common.selectAll')} checked={large.length>0&&large.every((e)=>selected.has(e.id))} onChange={(e)=>setSelected(e.target.checked?new Set(large.map((v)=>v.id)):new Set())}/><span>{t('common.name')}</span><span>{t('common.size')} <ArrowDown size={12}/></span><span>{t('common.modified')}</span><span/></div>{large.map((file)=><div className={`space-file-row ${selected.has(file.id)?'is-selected':''}`} key={file.id}><input type="checkbox" aria-label={file.name} checked={selected.has(file.id)} onChange={()=>toggle(setSelected,file.id)}/><span className="space-file-info"><span className="space-file-icon"><File size={22}/></span><span><strong>{file.name}</strong><small title={file.path}>{file.path}</small></span></span><b>{bytes(file.size)}</b><span className="space-file-date">{formatDate(file.modified/1e6)}</span><button className="icon-button" aria-label={`${t('common.reveal')} ${file.name}`} onClick={()=>void reveal(file)}><FolderOpen size={16}/></button></div>)}{!large.length&&<div className="space-empty">{t('common.empty')}</div>}</div>
          {large.length<largeCount&&<button className="space-button space-load-more" onClick={()=>setOffset(large.length)}>{t('common.more')}</button>}

          {selectedLarge.length>0&&<div className="space-selection-bar"><div><strong>{t('common.selected',{count:selectedLarge.length})}</strong><span>{t('large.pending',{size:bytes(selectedLarge.reduce((s,e)=>s+e.size,0))})}</span></div><button className="space-button primary" disabled={busy} onClick={()=>confirmTrash(selectedLarge)}><Trash2 size={16}/>{t('common.review')}</button></div>}
        </>}
        {view==='disk'&&folder&&<>
          <div className="space-disk-toolbar"><nav className="space-breadcrumbs" aria-label={t('disk.root')}>{breadcrumbs.map((crumb,i)=><button key={crumb.id} disabled={i===breadcrumbs.length-1} onClick={()=>void openFolder(crumb,breadcrumbs.slice(0,i+1))}>{i===0&&<HardDrive size={14}/>}<span>{crumb.name}</span>{i<breadcrumbs.length-1&&<ChevronRight size={14}/>}</button>)}</nav><div><strong>{bytes(folder.size)}</strong><small>{t('disk.total')}</small></div></div>
          <div className="space-explorer"><DirectoryTree index={index} selected={folder.id} activeTrail={breadcrumbs} bytes={bytes} onOpen={openFolder} onReveal={reveal}/><div className="space-treemap" role="group" aria-label={t('disk.map')}>{map.map((rect,i)=>{const file=mapEntries.find((e)=>e.id===rect.id)!;return <button className="space-treemap-cell" key={rect.id} style={{left:`${rect.x}%`,top:`${rect.y}%`,width:`${rect.width}%`,height:`${rect.height}%`,background:colors[i%colors.length],color:i%colors.length===3||i%colors.length===4?'#27382c':'#fff'}} title={`${file.name} · ${bytes(file.size)}`} aria-label={`${file.name} ${bytes(file.size)}`} disabled={file.id===-1} onClick={()=>file.directory?void openFolder(file,[...breadcrumbs,file]):void reveal(file)}><span>{file.directory?<Folder size={18}/>:<File size={18}/>}</span><strong>{file.name}</strong><small>{bytes(file.size)}</small></button>})}{!map.length&&<div className="space-empty">{t('common.empty')}</div>}</div></div>
        </>}
        {view==='duplicates'&&<>
          {groups===null&&!busy&&<div className="space-start compact"><Copy size={28}/><button className="space-button primary" onClick={()=>void findDuplicates()}><Search size={16}/>{t('duplicates.find')}</button></div>}
          {groups!==null&&<>
            <div className="space-section-title"><h2>{t('duplicates.groups',{count:groups.length})}</h2><span>{t('duplicates.reclaim',{size:bytes(groups.reduce((s,g)=>s+g.reclaimable,0))})}</span></div>
            {categories(groups.reduce<Record<string,number>>((counts,g)=>{const key=fileCategory(g.files[0].name);counts[key]=(counts[key]||0)+1;return counts},{}))}
            {!groups.length&&<div className="space-empty">{t('duplicates.empty')}</div>}
            {([...Object.keys(fileCategories),'other'] as FileCategory[]).filter((c)=>category==='all'||c===category).map((c)=>{const list=groups.filter((g)=>fileCategory(g.files[0].name)===c);if(!list.length)return null;return <details className="space-tree-category" open key={c}><summary><Folder size={17}/><strong>{t(`category.${c}`)}</strong><span>{t('duplicates.groups',{count:list.length})}</span><b>{bytes(list.reduce((s,g)=>s+g.reclaimable,0))}</b></summary>{list.slice(0,groupLimit).map((group,i)=><details className="space-duplicate-group" key={group.id} open={i===0}><summary><Copy size={17}/><span><strong>{group.files[0].name}</strong><small>{t('common.items',{count:group.files.length})} · {bytes(group.files[0].size)}</small></span><button className="space-text-button" onClick={(e)=>{e.preventDefault();setSelected((prev)=>new Set([...prev,...group.files.slice(1).map((file)=>file.id)]))}}>{t('duplicates.select')}</button><b>{bytes(group.reclaimable)}</b></summary>{group.files.map((file)=><label className="space-duplicate-row" key={file.id}><input type="checkbox" aria-label={file.path} checked={selected.has(file.id)} disabled={!selected.has(file.id)&&group.files.filter((e)=>!selected.has(e.id)).length===1} onChange={()=>toggle(setSelected,file.id)}/><File size={16}/><span title={file.path}>{file.path}</span><span className={`space-keep-badge ${!selected.has(file.id)?'is-keep':''}`}>{!selected.has(file.id)?<><Check size={12}/>{t('duplicates.keep')}</>:t('duplicates.extra')}</span><b>{bytes(file.size)}</b></label>)}{group.files.some((e)=>selected.has(e.id))&&<footer><button className="space-button" onClick={()=>confirmTrash(group.files.filter((e)=>selected.has(e.id)),group)}>{t('duplicates.remove')}<ArrowRight size={14}/></button></footer>}</details>)}{list.length>groupLimit&&<button className="space-button space-load-more" onClick={()=>setGroupLimit((n)=>n+40)}>{t('common.more')}</button>}</details>})}
          </>}
        </>}

      </>}
    </>}
    {(view==='health'||view==='privacy')&&<>
      {heading(view==='privacy'?'privacy.title':'cleanup.title',view==='privacy'?'privacy.subtitle':'cleanup.subtitle',<button className="space-button" disabled={busy} onClick={()=>void loadCleanup(view==='privacy')}><Search size={16}/>{t('common.rescan')}</button>)}
      {taskProgress}
      {!busy&&rules===null&&<div className="space-start compact"><button className="space-button primary" onClick={()=>void loadCleanup(view==='privacy')}>{t('common.scan')}</button></div>}
      {!busy&&rules!==null&&<><div className="space-cleanup-summary"><strong>{bytes(rules.reduce((s,r)=>s+r.size,0))}</strong><span>{t('common.items',{count:rules.length})}</span></div><CleanupTree rules={rules} selected={ruleSelected} onToggle={(id)=>toggle(setRuleSelected,id)} bytes={bytes}/>{!rules.length&&<div className="space-empty">{t('cleanup.empty')}</div>}{ruleSelected.size>0&&<div className="space-selection-bar"><div><strong>{t('common.selected',{count:ruleSelected.size})}</strong><span>{bytes(rules.filter((r)=>ruleSelected.has(r.id)).reduce((s,r)=>s+r.size,0))}</span></div><button className="space-button primary" onClick={confirmClean}>{t('common.review')}<ArrowRight size={16}/></button></div>}</>}
    </>}

    {view==='apps'&&<>
      {heading('apps.title','apps.subtitle',<button className="space-button" disabled={busy} onClick={()=>void loadApps()}><Search size={16}/>{t('common.refresh')}</button>)}
      {task==='apps'&&<div className="space-empty" role="status"><LoaderCircle className="spinner" size={24}/>{t('apps.loading')}</div>}
      <div className="space-toolbar"><label className="space-search"><Search size={17}/><input type="search" aria-label={t('apps.search')} placeholder={t('apps.search')} value={appSearch} onChange={(e)=>setAppSearch(e.target.value)}/></label><span>{t('common.items',{count:applications?.length||0})}</span></div>
      <div className="space-applications">{applications?.filter((a)=>a.name.toLowerCase().includes(appSearch.toLowerCase())).map((app,i)=><section className={`space-application ${application?.id===app.id?'is-active':''}`} key={app.id}><button className="space-app-row" aria-expanded={application?.id===app.id} disabled={busy} onClick={()=>application?.id===app.id?setApplication(null):void inspect(app)}><ChevronRight size={15}/><ApplicationIcon application={app} tone={i%5}/><span><strong>{app.name}</strong><small>{app.location}</small></span><span className="space-app-version">{app.version}</span>{app.protected?<LockKeyhole size={15}/>:<b>{application?.id===app.id?bytes(related.reduce((s,r)=>s+r.size,0)):app.size?bytes(app.size):''}</b>}</button>{application?.id===app.id&&<div className="space-app-detail">
        {app.protected?<div className="space-protected"><LockKeyhole size={17}/>{t('apps.protected')}</div>:app.method==='system'?<div className="space-system-uninstaller"><button className="space-button" onClick={()=>{if(window.memento)void window.memento.storageUninstall({applicationId:app.id,ids:[]}).catch((e)=>setError(String(e)))}}>{t('apps.system')}<ArrowUpRight size={16}/></button><WorkspaceHelp>{t('apps.systemDescription')}</WorkspaceHelp></div>:<>
        {task==='related'?<div className="space-empty"><LoaderCircle className="spinner"/></div>:(['application','support','preferences','cache','logs'] as const).map((kind)=>{const list=related.filter((r)=>r.kind===kind);if(!list.length)return null;return <details className="space-related-group" key={kind} open><summary><Folder size={16}/><strong>{t(`apps.${kind}`)}</strong><span>{list.length}</span><b>{bytes(list.reduce((s,r)=>s+r.size,0))}</b></summary>{list.map((file)=><label className="space-related-row" key={file.id}><input type="checkbox" checked={relatedSelected.has(file.id)} disabled={file.kind==='application'} aria-label={file.path} onChange={()=>toggle(setRelatedSelected,file.id)}/><File size={15}/><div><small title={file.path}>{file.path}</small></div><b>{bytes(file.size)}</b></label>)}</details>})}
        <div className="space-app-actions"><span>{bytes(related.filter((r)=>relatedSelected.has(r.id)).reduce((s,r)=>s+r.size,0))}</span><WorkspaceHelp>{t('apps.selectRelated')} {t('apps.evidence')}</WorkspaceHelp><button className="space-button primary" disabled={busy||!related.some((r)=>r.kind==='application')} onClick={confirmUninstall}><Trash2 size={16}/>{t('apps.uninstall')}</button></div></>}
      </div>}</section>)}</div>
    </>}

    {view==='history'&&<>
      {heading('history.title','history.subtitle')}
      <div className="space-history-stats"><div><Sparkles size={20}/><strong>{bytes(cleaned)}</strong><span>{t('home.cleaned')}</span></div><div><Trash2 size={20}/><strong>{bytes(trashed)}</strong><span>{t('home.trashed')}</span></div><div><CheckCircle2 size={20}/><strong>{history.filter((r)=>r.items>0).length}</strong><span>{t('home.sessions')}</span></div></div>

      {history.length?activityRows(history):<div className="space-empty"><CheckCircle2 size={30}/><h2>{t('home.noHistory')}</h2></div>}
      <button className="space-ledger-toggle space-button" aria-expanded={ledgerOpen} onClick={()=>setLedgerOpen(!ledgerOpen)}>{t('history.ai')}<ChevronRight size={16}/></button>{ledgerOpen&&historyChildren}
    </>}
    {(confirmation||completed)&&<StorageDialog title={completed?t(completed.failures?'confirm.failed':'common.complete'):t('confirm.title')} dismiss={()=>{if(!executing){setConfirmation(null);setCompleted(null)}}}>
      {completed?<><span className="space-dialog-success"><CheckCircle2 size={35}/></span><h3>{t('confirm.completed',{count:completed.items,size:bytes(completed.bytes)})}</h3>{completed.failures>0&&<p role="alert">{t('common.failed',{count:completed.failures})}</p>}<p>{t(completed.kind==='cleanup'||completed.kind==='privacy'?'history.note':'home.trashNote')}</p><footer><button className="space-button primary" autoFocus onClick={()=>setCompleted(null)}>{t('confirm.finish')}</button></footer></>:confirmation&&<><p>{t('confirm.description',{count:confirmation.count,size:bytes(confirmation.size)})}</p><div className="space-dialog-files">{confirmation.names.map((name)=><div key={name}><File size={16}/><span>{name}</span></div>)}</div><div className="space-dialog-consequence"><CircleHelp size={19}/><p>{t(confirmation.kind==='cleanup'||confirmation.kind==='privacy'?'cleanup.permanent':confirmation.kind==='uninstall'?'confirm.uninstall':'confirm.trash')}{confirmation.kind==='duplicates'&&` ${t('duplicates.confirm')}`}</p></div><footer><button className="space-button" autoFocus disabled={executing} onClick={()=>setConfirmation(null)}>{t('common.cancel')}</button><button className="space-button danger" disabled={executing} onClick={()=>void execute()}>{executing?<><LoaderCircle className="spinner" size={16}/>{t('common.working')}</>:t(confirmation.kind==='cleanup'||confirmation.kind==='privacy'?'common.clean':'common.trash')}</button></footer></>}
    </StorageDialog>}
  </div>
}

export function StorageDialog({title,dismiss,children}:{title:string;dismiss:()=>void;children:React.ReactNode}):React.JSX.Element {
  const ref=useRef<HTMLDivElement>(null)
  const dismissRef=useRef(dismiss);dismissRef.current=dismiss
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const body=ref.current
    const focusable=():HTMLElement[]=>Array.from(body?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')||[])
    ;(focusable()[0]||body)?.focus()
    const key=(e:KeyboardEvent):void=>{
      if(e.key==='Escape'){e.preventDefault();dismissRef.current()}
      if(e.key==='Tab'){const nodes=focusable();const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
    }
    document.addEventListener('keydown',key)
    return ()=>{document.removeEventListener('keydown',key);previous?.focus()}
  },[])
  return <div className="space-dialog-backdrop"><div className="space-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-dialog-title" tabIndex={-1} ref={ref}><h2 id="storage-dialog-title">{title}</h2>{children}</div></div>
}

function ApplicationIcon({application,tone=0,large=false}:{application:StorageApplication;tone?:number;large?:boolean}):React.JSX.Element {
  const [source,setSource]=useState<string|null>(null)
  const ref=useRef<HTMLSpanElement>(null)
  useEffect(()=>{
    setSource(null);let active=true;let requested=false
    const observer=new IntersectionObserver((entries)=>{
      if(!requested&&entries.some((e)=>e.isIntersecting)){
        requested=true;observer.disconnect()
        if(window.memento)void window.memento.storageApplicationIcon(application.id).then((icon)=>{if(active)setSource(icon)}).catch(()=>undefined)
      }
    })
    if(ref.current)observer.observe(ref.current)
    return ()=>{active=false;observer.disconnect()}
  },[application.id])
  return <span ref={ref} className={`space-app-monogram tone-${tone} ${large?'large':''}`}>{source?<img src={source} alt=""/>:application.name.slice(0,1).toUpperCase()}</span>
}

function DirectoryTree({index,selected,activeTrail,bytes,onOpen,onReveal}:{index:StorageIndex;selected:number;activeTrail:StorageEntry[];bytes:(n:number)=>string;onOpen:(e:StorageEntry,trail:StorageEntry[])=>Promise<void>;onReveal:(e:StorageEntry)=>Promise<void>}):React.JSX.Element {
  const {t}=useI18n()
  const [nodes,setNodes]=useState<Map<number,StorageEntry[]>>(new Map())
  const [more,setMore]=useState<Map<number,boolean>>(new Map())
  const [expanded,setExpanded]=useState<Set<number>>(new Set([0]))
  const [loading,setLoading]=useState<Set<number>>(new Set())
  const [error,setError]=useState('')
  const current=useRef(index.generation)
  const load=useCallback(async(entry:StorageEntry,offset=0):Promise<void>=>{
    const generation=index.generation
    setLoading((s)=>new Set([...s,entry.id]));setError('')
    try{
      const result=window.memento?await window.memento.storageChildren({generation,id:entry.id,offset}):{items:demoChildren(entry)}
      if(current.current===generation){setNodes((s)=>new Map(s).set(entry.id,offset?[...(s.get(entry.id)||[]),...result.items]:result.items));setMore((s)=>new Map(s).set(entry.id,result.items.length===200))}
    }catch(e){if(current.current===generation)setError(String(e))}finally{if(current.current===generation)setLoading((s)=>{const next=new Set(s);next.delete(entry.id);return next})}
  },[index.generation])
  useEffect(()=>{current.current=index.generation;setNodes(new Map());setMore(new Map());setExpanded(new Set([0]));if(index.root)void load(index.root);return()=>{current.current=-1}},[index.generation,load])
  useEffect(()=>{setExpanded((s)=>new Set([...s,...activeTrail.map((e)=>e.id)]));for(const entry of activeTrail){if(entry.id!==0&&!nodes.has(entry.id))void load(entry)}},[selected,index.generation,load])
  const branch=(entry:StorageEntry,trail:StorageEntry[],depth:number):React.ReactNode=>{
    const open=expanded.has(entry.id),children=nodes.get(entry.id)||[]
    return <div key={entry.id} role="none"><div className={`space-folder-row ${selected===entry.id?'is-active':''}`} role="treeitem" aria-selected={selected===entry.id} aria-expanded={entry.directory?open:undefined} aria-level={depth+1} style={{paddingLeft:8+depth*14}}>
      {entry.directory?<button className="icon-button tree-toggle" aria-label={`${t(open?'compact.collapse':'compact.expand')} ${entry.name}`} onClick={()=>{setExpanded((s)=>{const next=new Set(s);if(open)next.delete(entry.id);else next.add(entry.id);return next});if(!open&&!nodes.has(entry.id))void load(entry)}}><ChevronRight size={14} className={open?'is-open':''}/></button>:<span className="tree-spacer"/>}
      <button className="tree-folder-name" title={entry.path} onClick={()=>entry.directory?void onOpen(entry,trail):void onReveal(entry)}>{entry.directory?<Folder size={16}/>:<File size={16}/>}<span>{entry.name}</span><b>{bytes(entry.size)}</b></button>
    </div>{open&&entry.directory&&<div role="group">{loading.has(entry.id)&&<span className="tree-loading"><LoaderCircle className="spinner" size={15}/></span>}{children.map((child)=>branch(child,[...trail,child],depth+1))}{more.get(entry.id)&&<button className="space-text-button space-load-more" onClick={()=>void load(entry,children.length)}>{t('common.more')}</button>}</div>}</div>
  }
  return <div className="space-folder-list"><div className="space-folder-list-heading"><h2>{t('disk.list')}</h2></div>{error&&<div role="alert" className="space-alert">{error}</div>}<div role="tree" aria-label={t('disk.list')}>{index.root&&branch(index.root,[index.root],0)}</div></div>
}

function CleanupTree({rules,selected,onToggle,bytes}:{rules:CleanupItem[];selected:Set<string>;onToggle:(id:string)=>void;bytes:(n:number)=>string}):React.JSX.Element {
  const {t}=useI18n()
  const buckets=new Map<string,CleanupItem[]>()
  for(const rule of rules){const key=rule.browser||`cleanup.${rule.category}`;buckets.set(key,[...(buckets.get(key)||[]),rule])}
  return <div className="space-cleanup-tree">{[...buckets].map(([name,list])=>{
    const profiles=new Map<string,CleanupItem[]>()
    for(const rule of list){const profile=/[/\\](Default|Profile \d+)[/\\]/.exec(rule.path)?.[1]||t('compact.localData');profiles.set(profile,[...(profiles.get(profile)||[]),rule])}
    return <details className="space-tree-category" key={name} open><summary><ShieldCheck size={17}/><strong>{name.startsWith('cleanup.')?t(name):name}</strong><span>{list.length}</span><b>{bytes(list.reduce((s,r)=>s+r.size,0))}</b></summary>{[...profiles].map(([profile,items])=><details className="space-profile-group" open key={profile}><summary><Folder size={16}/><strong>{profile}</strong><b>{bytes(items.reduce((s,r)=>s+r.size,0))}</b></summary>{items.map((rule)=><details className="space-rule-details" key={rule.id}><summary className="space-cleanup-row"><label onClick={(e)=>e.stopPropagation()}><input type="checkbox" aria-label={t(`rule.${rule.nameKey}`)} checked={selected.has(rule.id)} onChange={()=>onToggle(rule.id)}/></label><span className="space-cleanup-copy"><strong>{t(`rule.${rule.nameKey}`)}</strong></span><span onClick={(e)=>e.stopPropagation()}><WorkspaceHelp>{t(rule.effectKey==='rebuild'?'cleanup.rebuild':`cleanup.${rule.effectKey}Effect`)}</WorkspaceHelp></span><b>{bytes(rule.size)}</b></summary><div className="space-rule-paths">{(rule.paths||[rule.path]).map((p)=><div key={p}><File size={14}/><code>{p}</code></div>)}</div></details>)}</details>)}</details>
  })}</div>
}
