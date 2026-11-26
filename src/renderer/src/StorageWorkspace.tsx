import {DeepCleanWorkspace} from './DeepCleanWorkspace'
import {demoDeepCleanScan,demoDeepCleanPreview} from './deep-clean-demo'
import type {StorageDirectoryPlan} from '../../shared/storage-directory-types'
import type {DeepCleanScan} from '../../shared/deep-clean-types'
import {SpaceFileDetails} from './SpaceFileDetails'
import {demoPrivacyItems,demoPrivacyPreview} from './privacy-demo'
import type {PrivacyItem,PrivacyTimeRange} from '../../shared/privacy-types'
import {useMessages} from './Messages'
import {WorkspaceDialog as StorageDialog} from './WorkspaceDialog'
export {WorkspaceDialog as StorageDialog} from './WorkspaceDialog'
import { ArrowLeft, ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronRight, CircleHelp, Copy, File, Folder, FolderOpen, HardDrive, Layers3, LoaderCircle, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CleanupItem, DuplicateGroup, RelatedApplicationFile, StorageActivity, StorageApplication, StorageEntry, StorageIndex, StorageProgress, StorageTarget } from '../../shared/storage-types'
import type { OverviewMetrics } from '../../shared/types'
import type { AgentViewKey } from './agent-ui/Shell'
import { useI18n } from './i18n'
import { demoApps, demoCleanup, demoDuplicates, demoHistory, demoIndex, demoLarge, demoRelated, demoChildren } from './storage-demo'
import { fileCategories, fileCategory, type FileCategory } from '../../shared/file-categories'
import { WorkspaceHelp } from './WorkspaceHelp'
import { readableTreemap } from './treemap'
import {HomeOverview} from './HomeOverview'
import { AiActionButton,readableTaskError } from './AiTasks'
import {PrivacyWorkspace} from './PrivacyWorkspace'
import { ApplicationManager } from './ApplicationManager'
import {selectExtraCopies} from '../../shared/duplicate-selection'
import type {ApplicationInventoryState} from '../../shared/storage-types'
import { selectedApplicationFiles } from '../../shared/application-files'

export type StorageView = 'overview'|'health'|'large'|'duplicates'|'disk'|'privacy'|'apps'|'history'
interface Confirmation { deep?:boolean; effects?:string[]; kind:StorageActivity['kind']; count:number; size:number; names:string[]; run:(options?:{skipRunning?:boolean})=>Promise<StorageActivity|null> }
const MB=1024**2
export function StorageWorkspace({view,active,metrics,onNavigate,historyChildren,activity,onActivity,onProcess}:{view:StorageView;active:boolean;metrics:OverviewMetrics|null;onNavigate:(view:AgentViewKey)=>void;historyChildren?:React.ReactNode;activity:StorageActivity|null;onActivity:(activity:StorageActivity)=>void;onProcess:(sort:'cpuPercent'|'memoryBytes')=>void}):React.JSX.Element {
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
  const {show}=useMessages()
  const setError=useCallback((message:string):void=>{if(message)show({message,tone:'error'})},[show])
  const setNotice=useCallback((message:string):void=>{if(message)show({message,tone:'success'})},[show])
  const [large,setLarge]=useState<StorageEntry[]>([])
  const [largeCount,setLargeCount]=useState(0)
  const [removedPaths,setRemovedPaths]=useState<string[]>([])
  const demoRemovedSizes=useRef(new Map<string,number>()),demoOriginalSizes=useRef(new Map<string,{size:number;allocated:number}>())
  const adjustDemoEntry=(entry:StorageEntry):StorageEntry=>{
    if(!entry.directory)return entry
    const original=demoOriginalSizes.current.get(entry.path)||{size:entry.size,allocated:entry.allocated};demoOriginalSizes.current.set(entry.path,original)
    const removed=[...demoRemovedSizes.current].filter(([location])=>location.startsWith(entry.path==='/'?'/':entry.path+'/')).reduce((sum,[,size])=>sum+size,0)
    return {...entry,size:Math.max(0,original.size-removed),allocated:Math.max(0,original.allocated-removed)}
  }
  const [category,setCategory]=useState<FileCategory|'all'>('all')
  const [categoryCounts,setCategoryCounts]=useState<Record<string,number>>({})
  const [duplicateMinimum,setDuplicateMinimum]=useState(10*MB)
  const [includeHidden,setIncludeHidden]=useState(false)
  const [groupLimit,setGroupLimit]=useState(40)
  const [minimum,setMinimum]=useState(100*MB)
  const [search,setSearch]=useState('')
  const [offset,setOffset]=useState(0)
  const [selected,setSelected]=useState<Set<number>>(new Set())
  const [folder,setFolder]=useState<StorageEntry|null>(null)
  const [children,setChildren]=useState<StorageEntry[]>([])
  const [mapOffset,setMapOffset]=useState(0)
  const [breadcrumbs,setBreadcrumbs]=useState<StorageEntry[]>([])
  const mapRef=useRef<HTMLDivElement>(null)
  const [mapSize,setMapSize]=useState({width:600,height:400})
  useEffect(()=>{if(view!=='disk'||!mapRef.current)return;const observer=new ResizeObserver(([entry])=>{if(entry.contentRect.width>0&&entry.contentRect.height>0)setMapSize({width:entry.contentRect.width,height:entry.contentRect.height})});observer.observe(mapRef.current);return()=>observer.disconnect()},[view,active,index?.generation,folder?.id])
  const [groups,setGroups]=useState<DuplicateGroup[]|null>(null)
  const [cleanup,setCleanup]=useState<CleanupItem[]|null>(null)
  const [deepScan,setDeepScan]=useState<DeepCleanScan|null>(null)
  const [deepSelected,setDeepSelected]=useState<Set<string>>(new Set())
  const demoDeepCleared=useRef(new Set<string>())
  const [privacy,setPrivacy]=useState<PrivacyItem[]|null>(null)
  const [privacyRange,setPrivacyRange]=useState<PrivacyTimeRange>('all')
  const [privacySkipRunning,setPrivacySkipRunning]=useState(false)
  const demoPrivacyCleared=useRef(new Set<string>())
  const [mapFile,setMapFile]=useState<StorageEntry|null>(null)
  const [ruleSelected,setRuleSelected]=useState<Set<string>>(new Set())
  const [applications,setApplications]=useState<StorageApplication[]|null>(null)
  const [inventory,setInventory]=useState<ApplicationInventoryState|null>(null)
  const [application,setApplication]=useState<StorageApplication|null>(null)
  const [related,setRelated]=useState<RelatedApplicationFile[]>([])
  const [relatedSelected,setRelatedSelected]=useState<Set<string>>(new Set())
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null)
  const [completed,setCompleted]=useState<StorageActivity|null>(null)
  const [executing,setExecuting]=useState(false)
  const [ledgerOpen,setLedgerOpen]=useState(false)
  const duplicateAfterScan=useRef<number|null>(null)
  const scopeEpoch=useRef(0)
  const cancelled=useRef(false)
  const mounted=useRef(true)
  const querySequence=useRef(0)
  const detailsSequence=useRef(0)
  const attempted=useRef(new Set<string>())
  const mainRef=useRef<HTMLDivElement>(null)
  const demo=!window.memento
  const runTask=useCallback(async<T,>(kind:typeof task,work:()=>Promise<T>):Promise<T|null>=>{
    const epoch=scopeEpoch.current
    cancelled.current=false;setBusy(true);setTask(kind);setError('');setNotice('')
    try {const result=await work();return epoch===scopeEpoch.current&&!cancelled.current?result:null} catch(e){if(epoch===scopeEpoch.current&&!cancelled.current)setError(readableTaskError(e));return null}
    finally {if(mounted.current&&epoch===scopeEpoch.current){setBusy(false);setTask(null);setProgress(null)}}
  },[])
  useEffect(()=>{
    mounted.current=true
    const epoch=scopeEpoch.current
    if(window.memento) void window.memento.storageState().then((s)=>{if(epoch!==scopeEpoch.current)return;const retained=s.indexes[view==='disk'?'analysis':view==='large'||view==='duplicates'?view:'analysis'];setIndex(retained||null);setIncludeHidden(retained?.includeHidden??false);setHistory(s.history)}).catch((e)=>setError(readableTaskError(e)))
    else {setIndex(demoIndex);setHistory(demoHistory)}
    const unsubscribe=window.memento?.onStorageProgress((p)=>{if(!p.scope||p.scope===(view==='health'?'cleanup':view==='disk'?'analysis':view))setProgress(p)})
    const stopScope=window.memento?.onStorageScopeChanged(()=>{
      ++scopeEpoch.current;++querySequence.current;++detailsSequence.current;cancelled.current=true
      setIndex(null);setLarge([]);setLargeCount(0);setCategoryCounts({});setGroups(null);setFolder(null);setChildren([]);setBreadcrumbs([]);setMapFile(null);setMapOffset(0)
      setSelected(new Set());setCleanup(null);setDeepScan(null);setDeepSelected(new Set());setPrivacy(null);setRuleSelected(new Set());setRelated([]);setRelatedSelected(new Set());setConfirmation(null)
      setBusy(false);setTask(null);setProgress(null);attempted.current.clear();duplicateAfterScan.current=null
    })
    return ()=>{mounted.current=false;++scopeEpoch.current;unsubscribe?.();stopScope?.()}
  },[])
  useEffect(()=>{
    if(view!=='apps')return
    if(!window.memento){setApplications(demoApps);return}
    const receive=(state:ApplicationInventoryState):void=>{if(!mounted.current)return;setInventory(state);setApplications(state.applications);setApplication((previous)=>previous?state.applications.find((application)=>application.id===previous.id&&application.version===previous.version)||null:null)}
    const stop=window.memento.onStorageApplications(receive)
    void window.memento.storageApplicationState().then(receive).catch((error)=>setError(String(error)))
    return stop
  },[])
  useEffect(()=>{
    if(!activity)return
    setHistory((prev)=>[activity,...prev.filter((r)=>r.id!==activity.id)])
    const removed=(p:string):boolean=>(activity.removedPaths||activity.locations).some((location)=>p===location||p.startsWith(location+'/')||p.startsWith(location+'\\'))
    if(demo){
      const known=[...breadcrumbs,...children,...large,...(groups||[]).flatMap((group)=>group.files),...(mapFile?[mapFile]:[])]
      for(const location of activity.removedPaths||activity.locations){const entry=known.find((entry)=>entry.path===location),size=entry?.allocated??(activity.locations.length===1?activity.bytes:0);demoRemovedSizes.current.set(location,size)}
      setIndex((previous)=>previous?.root?{...previous,root:adjustDemoEntry(previous.root)}:previous)
      setFolder((previous)=>previous?adjustDemoEntry(previous):previous);setBreadcrumbs((previous)=>previous.map(adjustDemoEntry));setChildren((previous)=>previous.map(adjustDemoEntry))
    }
    setRemovedPaths((prev)=>[...prev,...(activity.removedPaths||activity.locations)])
    setRuleSelected((prev)=>new Set([...prev].filter((id)=>!(cleanup||privacy||[]).some((r)=>r.id===id&&removed(r.path)))))
    setRelatedSelected((prev)=>new Set([...prev].filter((id)=>!related.some((r)=>r.id===id&&removed(r.path)))))
    const removedIds=new Set([...large,...(groups||[]).flatMap((g)=>g.files)].filter((e)=>removed(e.path)).map((e)=>e.id))
    setSelected((prev)=>new Set([...prev].filter((id)=>!removedIds.has(id))))
    setLarge((prev)=>prev.filter((e)=>!removed(e.path)));setOffset(0)
    setLargeCount((n)=>Math.max(0,n-large.filter((e)=>removed(e.path)).length))
    setGroups((prev)=>prev?.map((g)=>{const files=g.files.filter((e)=>!removed(e.path));return {...g,files,reclaimable:files.slice(1).reduce((n,e)=>n+e.allocated,0)}}).filter((g)=>g.files.length>1)||prev)
    const filterRules=(prev:CleanupItem[]|null):CleanupItem[]|null=>prev?.filter((r)=>!removed(r.path))||prev
    if(activity.deepCleanIds?.length){const cleared=new Set(activity.deepCleanIds),failed=new Set(activity.errors?.map((error)=>error.path)||[]);setDeepSelected((previous)=>new Set([...previous].filter((id)=>!cleared.has(id))));setDeepScan((previous)=>previous?{...previous,items:previous.items.map((item)=>{const sources=item.sources.map((source)=>cleared.has(source.id)?failed.has(source.path)?{...source,status:'limited' as const}:{...source,size:0,count:0,status:'empty' as const}:source);return {...item,sources,size:sources.reduce((sum,source)=>sum+source.size,0),count:sources.reduce((sum,source)=>sum+source.count,0)}})}:previous)}
    setCleanup(filterRules);setPrivacy((previous)=>previous?.filter((item)=>!activity.privacyIds?.includes(item.id)&&!removed(item.path))||previous)
    if(mapFile&&removed(mapFile.path))setMapFile(null)
    setApplications((prev)=>prev?.filter((a)=>!removed(a.location))||prev)
    setRelated((prev)=>prev.filter((r)=>!removed(r.path)))
    if(application&&removed(application.location))setApplication(null)
    if(view==='disk'&&activity.locations.length){
      setChildren((previous)=>previous.filter((file)=>!removed(file.path)));setMapOffset(0)
      if(demo&&folder&&removed(folder.path)){
        const trail=breadcrumbs.filter((entry)=>!removed(entry.path)),parent=trail.at(-1)||index?.root
        if(parent){const adjusted=adjustDemoEntry(parent);setFolder(adjusted);setBreadcrumbs((trail.length?trail:[parent]).map(adjustDemoEntry));setChildren(demoChildren(parent).map(adjustDemoEntry).filter((entry)=>!removed(entry.path)&&!removedPaths.some((location)=>entry.path===location||entry.path.startsWith(location+'/'))));setMapFile(parent.id===0?null:adjusted)}
      }
    }
    if(view==='disk'&&index&&activity.locations.length&&window.memento)void (async()=>{
      try {
        const state=await window.memento!.storageState(),next=state.indexes.analysis
        if(!next)return
        setIndex(next)
        const survivingTrail=breadcrumbs.filter((entry)=>!removed(entry.path)),current=folder&&!removed(folder.path)?folder:survivingTrail.at(-1)||next.root
        if(current){const result=await window.memento!.storageChildren({generation:next.generation,id:current.id});setFolder(result.parent);setChildren(result.items);if(folder&&removed(folder.path)){setBreadcrumbs(survivingTrail.length?survivingTrail:[result.parent]);setMapFile(result.parent.id===0?null:result.parent)}else if(current.id===0)setBreadcrumbs([result.parent])}
      }catch(e){setError(readableTaskError(e))}
    })()
  },[activity])
  useEffect(()=>{setGroups(null);setSelected(new Set());setOffset(0);setBreadcrumbs([]);setFolder(null);setMapFile(null);if(index&&duplicateAfterScan.current===index.generation){duplicateAfterScan.current=null;void findDuplicates(index)}},[index?.generation,index?.root?.path])
  const scan=async():Promise<void>=>{
    const result=await runTask('scan',async()=>{
      if(window.memento)return window.memento.storageScan({mode:view==='disk'||view==='overview'?'analysis':view==='duplicates'?'duplicates':'large',minimum:duplicateMinimum,includeHidden})
      await new Promise((resolve)=>setTimeout(resolve,450));return {...demoIndex,generation:(index?.generation||0)+1}
    })
    if(result){if(view==='duplicates')duplicateAfterScan.current=result.generation;setIndex(result);setGroups(null);setSelected(new Set());setBreadcrumbs([]);setFolder(null)}
  }
  const cancel=async():Promise<void>=>{cancelled.current=true;const active=await window.memento?.storageCancel(view==='health'?'cleanup':view==='disk'?'analysis':view==='privacy'?'privacy':view==='duplicates'?'duplicates':'large');if(active&&task==='duplicates')setIndex(null)}
  const loadCleanup=useCallback(async(isPrivacy:boolean,range:PrivacyTimeRange=privacyRange):Promise<void>=>{
    if(isPrivacy){const result=await runTask('cleanup',async()=>window.memento?window.memento.storagePrivacyScan(range):demoPrivacyItems(range,demoPrivacyCleared.current));if(result){setPrivacy(result);setRuleSelected(new Set())}}
    else{const result=await runTask('cleanup',async()=>window.memento?window.memento.storageCleanup(false):demoCleanup);if(result){setCleanup(result);setRuleSelected(new Set())}}
  },[runTask,privacyRange])
  const loadDeep=async():Promise<void>=>{const result=await runTask('cleanup',async()=>window.memento?window.memento.storageDeepScan():demoDeepCleanScan(demoDeepCleared.current));if(result){setDeepScan(result);setDeepSelected(new Set())}}
  const loadApps=useCallback(async():Promise<void>=>{
    const result=await runTask('apps',async()=>window.memento?window.memento.storageApplications(true):demoApps)
    if(result){setApplications(result);setApplication(null);setRelated([]);setRelatedSelected(new Set())}
  },[runTask])
  useEffect(()=>{
    if(!active||busy||attempted.current.has(view))return
    if(view==='privacy'&&privacy===null){attempted.current.add(view);void loadCleanup(true)}
  },[active,view,cleanup,privacy,applications,busy,loadCleanup,loadApps])
  useEffect(()=>{
    if(view!=='large'||!active||!index)return
    const sequence=++querySequence.current
    const timeout=setTimeout(()=>{
      const work=window.memento?window.memento.storageLarge({generation:index.generation,minimum,search,offset,category}):Promise.resolve({items:demoLarge.filter((e)=>!removedPaths.some((p)=>e.path===p||e.path.startsWith(p+'/'))&&e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())&&(category==='all'||fileCategory(e.name)===category)),count:demoLarge.filter((e)=>!removedPaths.some((p)=>e.path===p||e.path.startsWith(p+'/'))&&e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())&&(category==='all'||fileCategory(e.name)===category)).length,categories:demoLarge.filter((e)=>!removedPaths.some((p)=>e.path===p||e.path.startsWith(p+'/'))&&e.size>=minimum&&e.name.toLowerCase().includes(search.toLowerCase())).reduce<Record<string,number>>((counts,e)=>{const key=fileCategory(e.name);counts[key]=(counts[key]||0)+1;return counts},{})})
      void work.then((r)=>{if(sequence!==querySequence.current)return;setLarge((prev)=>offset?[...new Map([...prev,...r.items].map((item)=>[item.id,item])).values()]:r.items);setLargeCount(r.count);setCategoryCounts(r.categories||{})}).catch((e)=>{if(sequence===querySequence.current)setError(readableTaskError(e))})
    },150)
    return ()=>{clearTimeout(timeout);++querySequence.current}
  },[index,view,active,minimum,search,offset,category,activity,removedPaths])
  const openFolder=useCallback(async(entry:StorageEntry,trail:StorageEntry[]):Promise<void>=>{
    if(!index)return
    const sequence=++querySequence.current
    try {
      const result=window.memento?await window.memento.storageChildren({generation:index.generation,id:entry.id}):{parent:adjustDemoEntry(entry),items:demoChildren(entry).map(adjustDemoEntry)}
      if(sequence!==querySequence.current)return
      setMapFile(result.parent.id===0?null:result.parent);setFolder(result.parent);setChildren(result.items.filter((file)=>!demo||!removedPaths.some((location)=>file.path===location||file.path.startsWith(location+'/')||file.path.startsWith(location+'\\'))));setBreadcrumbs(trail);setMapOffset(0)
    }catch(e){setError(readableTaskError(e))}
  },[index,removedPaths])
  useEffect(()=>{if(view==='disk'&&index?.root&&!folder)void openFolder(index.root,[index.root])},[view,index,folder,openFolder])
  const findDuplicates=async(current=index):Promise<void>=>{
    if(!current)return
    const result=await runTask('duplicates',()=>window.memento?window.memento.storageDuplicates(current.generation,duplicateMinimum):Promise.resolve({groups:demoDuplicates.map((g)=>{const files=g.files.filter((e)=>!removedPaths.includes(e.path));return {...g,files,reclaimable:files.slice(1).reduce((s,e)=>s+e.allocated,0)}}).filter((g)=>g.files.length>1),elapsedMs:150}))
    if(result){setGroups(result.groups);setSelected(new Set())}
  }
  const inspect=async(app:StorageApplication):Promise<void>=>{
    const sequence=++detailsSequence.current
    setApplication(app);setRelated([]);setRelatedSelected(new Set())
    if(app.method==='system'||app.system||app.protected)return
    const result=await runTask('related',()=>window.memento?window.memento.storageRelated(app.id):Promise.resolve(demoRelated.filter((file)=>app.bundleId!=='com.figma.Desktop'||file.kind==='application').map((r)=>({...r,size:r.kind==='application'?app.size:r.size,path:r.kind==='application'?app.location:r.path.replace('com.microsoft.VSCode',app.bundleId||'com.microsoft.VSCode').replace('/Code','/'+(app.name==='Figma'?'Figma':'Code'))}))))
    if(result&&sequence===detailsSequence.current){setRelated(result);setRelatedSelected(new Set(result.filter((r)=>r.kind==='application').map((r)=>r.id)))}
  }
  const fakeActivity=async(kind:StorageActivity['kind'],count:number,size:number,locations:string[]):Promise<StorageActivity>=>{
    for(let i=0;i<count;i++){
      setProgress({phase:'cleaning',entries:i,total:count,elapsedMs:i*180,path:locations[i]})
      await new Promise((resolve)=>setTimeout(resolve,180))
    }
    setProgress({phase:'cleaning',entries:count,total:count,elapsedMs:count*180,path:locations.at(-1)})
    return {id:crypto.randomUUID(),date:new Date().toISOString(),kind,items:count,bytes:size,failures:0,locations}
  }
  const confirmTrash=async(entries:StorageEntry[],group?:DuplicateGroup):Promise<void>=>{
    if(!index||!entries.length||executing)return
    const kind=group||view==='duplicates'?'duplicates':view==='disk'?'analysis':'large'
    const directory=entries.find((entry)=>entry.directory)
    let plan:StorageDirectoryPlan|undefined
    if(directory){
      if(directory.id===0||directory.trashable===false||kind!=='analysis')return
      const result=await runTask('related',async()=>{
        if(window.memento)return window.memento.storageDirectoryPlan({generation:index.generation,id:directory.id})
        const all:StorageEntry[]=[],pending=[directory],visited=new Set<number>()
        while(pending.length&&visited.size<1000){const current=pending.pop()!;if(visited.has(current.id))continue;visited.add(current.id);if(current.id!==directory.id)all.push(current);if(current.directory)pending.push(...demoChildren(current))}
        return {id:crypto.randomUUID(),generation:index.generation,entryId:directory.id,path:directory.path,name:directory.name,size:directory.size,allocated:directory.allocated,files:all.filter((entry)=>!entry.directory).length,directories:all.filter((entry)=>entry.directory).length,links:0,hiddenFiles:all.filter((entry)=>entry.name.startsWith('.')).length}
      })
      if(!result)return
      plan=result
    }
    const size=plan?.allocated??entries.reduce((sum,entry)=>sum+entry.allocated,0)
    setConfirmation({kind,count:entries.length,size,names:entries.map((entry)=>entry.path),effects:plan?[t('disk.directoryContents',{files:plan.files,directories:plan.directories,hidden:plan.hiddenFiles})]:undefined,run:()=>window.memento?window.memento.storageTrash({generation:index.generation,ids:entries.map((entry)=>entry.id),kind,groupId:group?.id,directoryPlanId:plan?.id}):fakeActivity(kind,entries.length,size,entries.map((entry)=>entry.path))})
  }
  const confirmDeep=():void=>{
    if(!deepScan)return
    const sources=deepScan.items.flatMap((item)=>item.sources.filter((source)=>deepSelected.has(source.id)&&['ready','requires-close'].includes(source.status)).map((source)=>({item,source})))
    if(!sources.length)return
    setPrivacySkipRunning(false)
    const localized=(value:{zh:string;en:string}):string=>locale==='zh-CN'?value.zh:value.en
    setConfirmation({deep:true,kind:'cleanup',count:sources.length,size:sources.reduce((sum,entry)=>sum+entry.source.size,0),names:sources.map(({item,source})=>`${localized(item.name)} · ${source.path}`),effects:[...new Set(sources.map(({item})=>localized(item.description)))],run:async(options)=>{
      if(window.memento)return window.memento.storageDeepClean({ids:sources.map(({source})=>source.id),skipRunning:Boolean(options?.skipRunning)})
      const running=sources.filter(({source})=>source.status==='requires-close')
      if(running.length&&!options?.skipRunning)throw new Error(t('deep.closeApplications'))
      const actionable=sources.filter((entry)=>!running.includes(entry))
      const result=await fakeActivity('cleanup',actionable.length,actionable.reduce((sum,entry)=>sum+entry.source.size,0),actionable.map(({source})=>source.path))
      for(const {source} of actionable)demoDeepCleared.current.add(source.id)
      return {...result,deepCleanIds:actionable.map(({source})=>source.id),removedPaths:actionable.map(({source})=>source.path),traces:actionable.reduce((sum,entry)=>sum+entry.source.count,0),skipped:running.length,unchanged:0}
    }})
  }
  const confirmClean=():void=>{
    if(view==='privacy'){
      const items=(privacy||[]).filter((item)=>ruleSelected.has(item.id)&&item.capability==='ready')
      if(!items.length)return
      setPrivacySkipRunning(false)
      const sources=new Map<string,number>();for(const item of items)sources.set(item.path||item.id,Math.max(sources.get(item.path||item.id)||0,item.size))
      const traces=items.reduce((sum,item)=>sum+(item.count||0),0)
      setConfirmation({kind:'privacy',count:items.length,size:[...sources.values()].reduce((sum,size)=>sum+size,0),effects:[t('privacy.confirmTraces',{count:traces}),...new Set(items.map((item)=>t(`cleanup.${item.effectKey}Effect`)))],names:items.map((item)=>`${item.source?.name||''} · ${t(`privacy.kind.${item.kind}`)}${item.profile?' · '+item.profile:''}`),run:async(options)=>{
        if(window.memento)return window.memento.storagePrivacyClean({ids:items.map((item)=>item.id),skipRunning:Boolean(options?.skipRunning)})
        const result=await fakeActivity('privacy',items.length,0,[])
        for(const item of items)demoPrivacyCleared.current.add(item.id)
        return {...result,privacyIds:items.map((item)=>item.id),removedPaths:[],traces,skipped:0,unchanged:0}
      }})
      return
    }
    const items=cleanup?.filter((rule)=>ruleSelected.has(rule.id))||[]
    if(!items.length)return
    setConfirmation({kind:'cleanup',effects:[...new Set(items.map((item)=>t(`cleanup.${item.effectKey}Effect`)))],count:items.length,size:items.reduce((sum,item)=>sum+item.size,0),names:items.flatMap((item)=>item.paths||[item.path]),run:()=>window.memento?window.memento.storageClean(items.map((item)=>item.id)):fakeActivity('cleanup',items.length,items.reduce((sum,item)=>sum+item.size,0),items.flatMap((item)=>item.paths||[item.path]))})
  }

  const confirmUninstall=():void=>{
    if(!application)return
    const items=selectedApplicationFiles(related,relatedSelected)
    setConfirmation({kind:'uninstall',count:items.length,size:items.reduce((s,e)=>s+e.size,0),names:items.map((e)=>e.path),run:()=>window.memento?window.memento.storageUninstall({applicationId:application.id,ids:items.map((e)=>e.id)}):fakeActivity('uninstall',items.length,items.reduce((s,e)=>s+e.size,0),items.map((e)=>e.path))})
  }
  const execute=async():Promise<void>=>{
    if(!confirmation||executing)return
    setExecuting(true);setError('');setProgress({phase:'cleaning',entries:0,total:confirmation.count,elapsedMs:0,path:confirmation.names[0]})
    try {
      const [result]=await Promise.all([confirmation.run({skipRunning:privacySkipRunning}),new Promise((resolve)=>setTimeout(resolve,750))])
      if(result){onActivity(result);if(result.kind==='privacy')await loadCleanup(true);setCompleted(result)}
      setConfirmation(null)
    }catch(e){setError(readableTaskError(e));setConfirmation(null)}finally{setExecuting(false)}
  }
  const toggle=<T,>(setter:React.Dispatch<React.SetStateAction<Set<T>>>,id:T):void=>setter((prev)=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next})
  const reveal=async(entry:StorageEntry):Promise<void>=>{if(!index)return;try{if(window.memento)await window.memento.storageReveal({generation:index.generation,id:entry.id});else setNotice(t('common.reveal'))}catch(e){setError(readableTaskError(e))}}
  const fileActions=(file:{path:string;size:number;name?:string;modified?:number;trashable?:boolean},target:StorageTarget,onTrash?:()=>void):React.JSX.Element=><FileActions file={file} target={target} onTrash={onTrash} onReveal={async(target)=>{try{if(window.memento)await window.memento.storageRevealTarget(target);else setNotice(t('common.reveal'))}catch(e){setError(readableTaskError(e))}}}/>
  const formatDate=(date:string|number):string=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(date))
  const heading=(title:string,subtitle:string,action?:React.ReactNode):React.JSX.Element=><header className="space-heading"><div><h1>{t(title)}</h1>{['large','duplicates','privacy'].includes(view)&&<WorkspaceHelp>{t(subtitle)}{view==='duplicates'&&<p>{t('compact.duplicateHelp')}</p>}{view==='large'&&<p>{t('compact.largeHelp')}</p>}{view==='privacy'&&<p>{t('privacy.warning')}</p>}</WorkspaceHelp>}</div>{action}</header>
  const scanButtons=<div className="space-actions"><button className="space-button primary" disabled={busy} onClick={()=>void scan()}><Search size={16}/>{t(index?'common.rescan':'common.scan')}</button></div>
  const scanPrompt=<div className="space-start"><HardDrive size={32}/><h2>{t('scan.fullDisk')}</h2>{scanButtons}</div>
  const scanStatus=index&&<div className="space-scan-status"><CheckCircle2 size={14}/><span>{t('scan.ready',{count:index.entries.toLocaleString(locale),seconds:(index.elapsedMs/1000).toFixed(2)})}</span><code title={index.root?.path}>{index.root?.path}</code>{view!=='disk'&&(index.errors>0||index.skipped>0)&&<WorkspaceHelp>{t('scan.coverage',{errors:index.errors,skipped:index.skipped})}</WorkspaceHelp>}</div>
  const progressLabel=t(progress?.phase==='queued'?'scan.queued':task==='scan'?`scan.${view==='disk'?'analysis':view==='duplicates'?'duplicates':'large'}`:task==='duplicates'?`scan.${progress?.phase==='hashing'?'hashing':'sampling'}`:view==='privacy'?'privacy.loading':view==='health'?'deep.scanning':'common.working')
  const taskProgress=busy&&task!=='related'&&task!=='apps'&&<div className="space-progress" role="status" aria-live="polite"><div className="space-scan-orbit"><LoaderCircle className="spinner" size={24}/></div><div className="space-progress-copy"><strong>{progressLabel}</strong><span>{progress?.phase==='queued'?t('scan.waiting'):progress?`${progress.entries.toLocaleString(locale)}${progress.total!==undefined?` / ${progress.total.toLocaleString(locale)}`:''} · ${(progress.elapsedMs/1000).toFixed(1)} s`:'—'}</span><small title={progress?.path}>{progress?.path}</small><div className={`space-progress-track ${progress?.total?'is-measured':''}`} role="progressbar" aria-label={progressLabel} aria-valuenow={progress?.total?Math.round(progress.entries/progress.total*100):undefined} aria-valuemin={0} aria-valuemax={100}><i style={progress?.total?{width:`${progress.entries/progress.total*100}%`}:undefined}/></div></div>{(task==='scan'||task==='duplicates'||progress?.phase==='queued')&&<button className="space-button" onClick={()=>void cancel()}>{t('common.cancel')}</button>}</div>
  const categories=(counts:Record<string,number>):React.JSX.Element=><div className="space-category-tabs" role="group" aria-label={t('compact.categories')}>{(['all',...Object.keys(fileCategories),'other'] as const).map((key)=><button key={key} className={category===key?'is-active':''} onClick={()=>{setCategory(key as typeof category);setOffset(0);setSelected(new Set());setGroupLimit(40)}}>{t(`category.${key}`)}<small>{key==='all'?Object.values(counts).reduce((a,b)=>a+b,0):counts[key]||0}</small></button>)}</div>
  const activityRows=(records:StorageActivity[]):React.JSX.Element=><div className="space-activity">{records.map((r)=><div className="space-activity-row" key={r.id}><span className={`space-activity-icon ${r.failures?'has-error':''}`}>{r.kind==='privacy'?<ShieldCheck size={19}/>:r.kind==='cleanup'?<Sparkles size={19}/>:<Trash2 size={19}/>}</span><div><strong>{t(`history.${r.kind}`)}</strong><small>{formatDate(r.date)} · {t('history.items',{count:r.items})}{r.failures>0&&` · ${t('history.failures',{count:r.failures})}`}</small></div><b>{bytes(r.bytes)}</b><Check size={15}/></div>)}</div>
  const cleaned=history.reduce((s,r)=>s+r.bytes,0)
  const cleanedItems=history.reduce((s,r)=>s+r.items,0)
  const total=metrics?.disk.totalBytes||512*1024**3, free=metrics?.disk.availableBytes||(demo?168*1024**3:0)
  const usedPercent=Math.max(0,Math.min(100,100-free/total*100))
  const colors=['#355e54','#5b8070','#88a28a','#b5c4a7','#d2ba96','#c49173','#b78281','#8d929e','#66798c']
  const sortedMapEntries=useMemo(()=>children.filter((entry)=>entry.size>0).sort((a,b)=>b.size-a.size),[children])
  const mapEntries=useMemo(()=>{
    const entries=sortedMapEntries.slice(mapOffset,mapOffset+10)
    const remainder=(folder?.size||0)-sortedMapEntries.slice(0,mapOffset+10).reduce((sum,entry)=>sum+entry.size,0)
    if(folder&&remainder>=1&&entries.length)entries.push({...folder,id:-1,name:t('disk.other'),size:remainder})
    return entries
  },[sortedMapEntries,folder,mapOffset,t])
  const map=useMemo(()=>readableTreemap(mapEntries,mapSize.width,mapSize.height),[mapEntries,mapSize])
  const openMapOther=async():Promise<void>=>{
    const next=mapOffset+10
    if(next>=children.length&&window.memento&&index&&folder){try{const result=await window.memento.storageChildren({generation:index.generation,id:folder.id,offset:children.length});setChildren((previous)=>[...previous,...result.items])}catch(error){setError(String(error));return}}
    setMapOffset(next)
  }
  const selectedLarge=large.filter((e)=>selected.has(e.id))
  const selectedDuplicateGroups=(groups||[]).filter((group)=>group.files.some((file)=>selected.has(file.id)))
  const selectedDuplicates=selectedDuplicateGroups.flatMap((group)=>group.files.filter((file)=>selected.has(file.id)))
  const rules=view==='privacy'?privacy:cleanup
  return <div className={`space-workspace space-${view}`} ref={mainRef}>
    {view==='overview'&&<HomeOverview metrics={metrics} history={history} bytes={bytes} onProcess={onProcess} onNavigate={onNavigate}/>}
    {(view==='large'||view==='disk'||view==='duplicates')&&<>
      {heading(`${view}.title`,`${view}.subtitle`,index?scanButtons:undefined)}
      {<div className="space-toolbar duplicate-options">{view==='duplicates'&&<label>{t('large.minimum')} <select aria-label={t('large.minimum')} disabled={busy} value={duplicateMinimum} onChange={(e)=>{setDuplicateMinimum(Number(e.target.value));setIndex(null);setGroups(null)}}>{[10*MB,50*MB,100*MB,1024*MB].map((n)=><option value={n} key={n}>{bytes(n)} +</option>)}</select></label>}<label className="space-inline-check"><input type="checkbox" aria-describedby={`${view}-scan-scope`} disabled={busy} checked={includeHidden} onChange={(e)=>{setIncludeHidden(e.target.checked);setIndex(null);setGroups(null)}}/>{t(view==='disk'?'compact.includeHidden':'scan.includeHiddenFiles')}</label></div>}
      <p className={`space-scan-scope ${includeHidden?'is-expanded':''}`} id={`${view}-scan-scope`}><ShieldCheck size={15}/><span>{t(view==='disk'?(includeHidden?'scan.scopeExpanded':'scan.scopeDefault'):(includeHidden?'scan.cleanupScopeExpanded':'scan.cleanupScopeDefault'))}</span></p>
      {taskProgress}
      {!index&&!busy?scanPrompt:index&&<>{scanStatus}
        {view==='large'&&<>
          <div className="space-toolbar"><label className="space-search"><Search size={17}/><input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e)=>{setSearch(e.target.value);setOffset(0);setSelected(new Set())}}/></label><select aria-label={t('large.minimum')} value={minimum} onChange={(e)=>{setMinimum(Number(e.target.value));setOffset(0);setSelected(new Set())}}><option value={10*MB}>10 MB +</option><option value={100*MB}>100 MB +</option><option value={1024*MB}>1 GB +</option><option value={5*1024*MB}>5 GB +</option></select><span>{t('large.found',{count:largeCount})}</span></div>
          {categories(categoryCounts)}
          <div className="space-file-table"><div className="space-file-table-head"><input type="checkbox" aria-label={t('common.selectAll')} checked={large.length>0&&large.every((e)=>selected.has(e.id))} onChange={(e)=>setSelected(e.target.checked?new Set(large.map((v)=>v.id)):new Set())}/><span>{t('common.name')}</span><span>{t('common.size')} <ArrowDown size={12}/></span><span>{t('common.modified')}</span><span/></div>{large.map((file)=><div className={`space-file-row ${selected.has(file.id)?'is-selected':''}`} key={file.id}><input type="checkbox" aria-label={file.name} checked={selected.has(file.id)} onChange={()=>toggle(setSelected,file.id)}/><span className="space-file-info"><span className="space-file-icon"><File size={22}/></span><span><strong>{file.name}</strong><small title={file.path}>{file.path}</small></span></span><b>{bytes(file.size)}</b><span className="space-file-date">{formatDate(file.modified/1e6)}</span>{fileActions(file,{type:'entry',generation:index.generation,id:file.id})}</div>)}{!large.length&&<div className="space-empty">{t('common.empty')}</div>}</div>
          {large.length<largeCount&&<button className="space-button space-load-more" onClick={()=>setOffset(large.length)}>{t('common.more')}</button>}

          {selectedLarge.length>0&&<SelectionBar count={selectedLarge.length} size={bytes(selectedLarge.reduce((sum,file)=>sum+file.allocated,0))} disabled={busy} onClear={()=>setSelected(new Set())} onReview={()=>confirmTrash(selectedLarge)}/>}
        </>}
        {view==='disk'&&folder&&<>
          <div className="space-disk-toolbar"><div className="space-disk-navigation"><button className="space-button space-disk-back" disabled={breadcrumbs.length<2} onClick={()=>void openFolder(breadcrumbs[breadcrumbs.length-2],breadcrumbs.slice(0,-1))}><ArrowLeft size={16}/>{t('disk.back')}</button><nav className="space-breadcrumbs" aria-label={t('disk.root')}>{breadcrumbs.map((crumb,i)=><button key={crumb.id} disabled={i===breadcrumbs.length-1} onClick={()=>void openFolder(crumb,breadcrumbs.slice(0,i+1))}>{i===0&&<HardDrive size={14}/>}<span>{crumb.name}</span>{i<breadcrumbs.length-1&&<ChevronRight size={14}/>}</button>)}</nav></div><div><strong>{bytes(folder.size)}</strong><small>{t('disk.total')}</small></div></div>
          <div className="space-explorer"><DirectoryTree key={`${index.generation}:${activity?.id||''}`} index={index} selected={folder.id} activeTrail={breadcrumbs} bytes={bytes} onOpen={openFolder} onReveal={reveal} onSelectFile={setMapFile} selectedFile={mapFile?.id} onError={setError} adjustDemo={demo?adjustDemoEntry:undefined} removedPaths={demo?removedPaths:[]} actions={(file)=>fileActions(file,{type:'entry',generation:index.generation,id:file.id},file.id===0?undefined:()=>void confirmTrash([file]))}/><div className="space-map-column"><div className="space-map-caption"><span title={t('disk.areaHint')}>{t('disk.top10')}{mapOffset>0&&` / ${t('disk.other')}`}</span>{mapOffset>0&&<button className="space-text-button" onClick={()=>setMapOffset((offset)=>Math.max(0,offset-10))}><ArrowLeft size={13}/>{t('disk.backTop')}</button>}</div><div className="space-treemap" ref={mapRef} role="group" aria-label={t('disk.map')}>{map.map((rect,i)=>{const file=mapEntries.find((entry)=>entry.id===rect.id)!;return <button className={`space-treemap-cell ${mapFile?.id===rect.id?'is-current':''}`} key={rect.id} style={{left:`${rect.x}%`,top:`${rect.y}%`,width:`${rect.width}%`,height:`${rect.height}%`,background:colors[i%colors.length],color:i%colors.length===3||i%colors.length===4?'#27382c':'#fff'}} title={`${file.name} · ${bytes(file.size)}`} aria-label={`${file.name} ${bytes(file.size)}`} onClick={()=>file.id===-1?void openMapOther():file.directory?void openFolder(file,[...breadcrumbs,file]):setMapFile(file)}>{rect.height*mapSize.height/100>=90&&rect.width*mapSize.width/100>=75&&<span>{file.directory?<Folder size={16}/>:<File size={16}/>}</span>}<strong>{file.name}</strong><small>{bytes(file.size)}</small></button>})}{!map.length&&<div className="space-empty">{t('common.empty')}</div>}</div>{mapFile?<SpaceFileDetails file={mapFile} bytes={bytes} onReveal={()=>void reveal(mapFile)} onTrash={()=>confirmTrash([mapFile])} onClose={()=>setMapFile(null)}/>:<p className="space-map-file-hint">{t('disk.fileActionsHint')}</p>}</div></div>
        </>}
        {view==='duplicates'&&<>
          {groups===null&&!busy&&<div className="space-start compact"><Copy size={28}/><button className="space-button primary" onClick={()=>void findDuplicates()}><Search size={16}/>{t('duplicates.find')}</button></div>}
          {groups!==null&&<>
            <div className="space-section-title"><h2>{t('duplicates.groups',{count:groups.length})}</h2><span>{t('duplicates.reclaim',{size:bytes(groups.reduce((s,g)=>s+g.reclaimable,0))})}</span><button className="space-text-button" disabled={busy||!groups.length} onClick={()=>setSelected((previous)=>selectExtraCopies(groups.filter((group)=>category==='all'||fileCategory(group.files[0].name)===category),previous))}>{t('duplicates.selectAll')}</button></div>
            {categories(groups.reduce<Record<string,number>>((counts,g)=>{const key=fileCategory(g.files[0].name);counts[key]=(counts[key]||0)+1;return counts},{}))}
            {!groups.length&&<div className="space-empty">{t('duplicates.empty')}</div>}
            {([...Object.keys(fileCategories),'other'] as FileCategory[]).filter((c)=>category==='all'||c===category).map((c)=>{const list=groups.filter((g)=>fileCategory(g.files[0].name)===c);if(!list.length)return null;return <details className="space-tree-category" open key={c}><summary><Folder size={17}/><strong>{t(`category.${c}`)}</strong><span>{t('duplicates.groups',{count:list.length})}</span><b>{bytes(list.reduce((s,g)=>s+g.reclaimable,0))}</b></summary>{list.slice(0,groupLimit).map((group,i)=><details className="space-duplicate-group" key={group.id} open={i===0}><summary><Copy size={17}/><span><strong>{group.files[0].name}</strong><small>{t('common.items',{count:group.files.length})} · {bytes(group.files[0].size)}</small></span><button className="space-text-button" onClick={(e)=>{e.preventDefault();setSelected((prev)=>selectExtraCopies([group],prev))}}>{t('duplicates.select')}</button><b>{bytes(group.reclaimable)}</b></summary>{group.files.map((file)=><div className="space-duplicate-row" key={file.id}><input type="checkbox" aria-label={file.path} checked={selected.has(file.id)} disabled={!selected.has(file.id)&&group.files.filter((e)=>!selected.has(e.id)).length===1} onChange={()=>toggle(setSelected,file.id)}/><File size={16}/><span title={file.path}>{file.path}</span><span className={`space-keep-badge ${!selected.has(file.id)?'is-keep':''}`}>{!selected.has(file.id)?<><Check size={12}/>{t('duplicates.keep')}</>:t('duplicates.extra')}</span><b>{bytes(file.size)}</b>{fileActions(file,{type:'entry',generation:index.generation,id:file.id})}</div>)}</details>)}{list.length>groupLimit&&<button className="space-button space-load-more" onClick={()=>setGroupLimit((n)=>n+40)}>{t('common.more')}</button>}</details>})}
            {selectedDuplicates.length>0&&<SelectionBar count={selectedDuplicates.length} size={bytes(selectedDuplicates.reduce((sum,file)=>sum+file.allocated,0))} detail={t('duplicates.selectedGroups',{count:selectedDuplicateGroups.length})} disabled={busy} onClear={()=>setSelected(new Set())} onReview={()=>confirmTrash(selectedDuplicates)} label={t('duplicates.remove')}/>}
          </>}
        </>}

      </>}
    </>}
    {view==='health'&&<DeepCleanWorkspace scan={deepScan} selected={deepSelected} bytes={bytes} loading={busy} onScan={()=>void loadDeep()} onCancel={()=>void cancel()} onToggle={(ids,checked)=>setDeepSelected((previous)=>{const next=new Set(previous);for(const id of ids)if(checked)next.add(id);else next.delete(id);return next})} onClear={()=>setDeepSelected(new Set())} onReview={confirmDeep} preview={async(id,offset)=>window.memento?window.memento.storageDeepPreview({id,offset}):demoDeepCleanPreview(id,offset)} reveal={async(id,path)=>{if(window.memento)await window.memento.storageDeepReveal({id,path});else setNotice(t('common.reveal'))}} icon={async(id)=>window.memento?window.memento.storageDeepIcon(id):null} onPermissions={()=>{if(window.memento)return window.memento.storagePrivacyPermissions().catch((error)=>setError(readableTaskError(error)));setNotice(t('privacy.permissionsDemo'))}} progress={taskProgress}/>}

    {view==='privacy'&&<PrivacyWorkspace rules={privacy||[]} selected={ruleSelected} onToggle={(ids,checked)=>setRuleSelected((previous)=>{const next=new Set(previous);for(const id of ids)if(checked)next.add(id);else next.delete(id);return next})} bytes={bytes} loading={busy} range={privacyRange} onRangeChange={(range)=>{setPrivacyRange(range);void loadCleanup(true,range)}} onRefresh={()=>void loadCleanup(true)} onReview={confirmClean} onClear={()=>setRuleSelected(new Set())} preview={async(id,offset)=>window.memento?window.memento.storagePrivacyPreview({id,offset}):demoPrivacyPreview(id,privacyRange,offset)} onPermissions={()=>{if(window.memento)void window.memento.storagePrivacyPermissions().catch((error)=>setError(readableTaskError(error)));else setNotice(t('privacy.permissionsDemo'))}} progress={taskProgress}/>}

    {view==='apps'&&<ApplicationManager inventory={inventory} applications={applications} onApplications={setApplications} busy={busy} loadingFiles={task==='related'} application={application} files={related} selected={relatedSelected} onSelect={setRelatedSelected} onFiles={(next)=>setRelated((prev)=>[...new Map([...prev,...next].map((f)=>[f.id,f])).values()])} onInspect={(app)=>app?void inspect(app):setApplication(null)} onRefresh={()=>void loadApps()} onConfirm={confirmUninstall} actions={fileActions} bytes={bytes} onNotice={setNotice} onError={(error)=>setError(readableTaskError(error))}/>}

    {view==='history'&&<>
      {heading('history.title','history.subtitle')}
      <div className="space-history-stats"><div><Sparkles size={20}/><strong>{bytes(cleaned)}</strong><span>{t('home.achievement')}</span></div><div><Trash2 size={20}/><strong>{cleanedItems.toLocaleString(locale)}</strong><span>{t('home.cleanedItems')}</span></div><div><CheckCircle2 size={20}/><strong>{history.filter((r)=>r.items>0).length}</strong><span>{t('home.sessions')}</span></div></div>

      {history.length?activityRows(history):<div className="space-empty"><CheckCircle2 size={30}/><h2>{t('home.noHistory')}</h2></div>}
      <button className="space-ledger-toggle space-button" aria-expanded={ledgerOpen} onClick={()=>setLedgerOpen(!ledgerOpen)}>{t('history.ai')}<ChevronRight size={16}/></button>{ledgerOpen&&historyChildren}
    </>}
    {(confirmation||completed)&&<StorageDialog title={completed?t(completed.failures?'confirm.failed':'common.complete'):t(executing?'cleaning.title':'confirm.title')} dismiss={()=>{if(!executing){setConfirmation(null);setCompleted(null)}}}>
      {executing&&confirmation?<CleanupAnimation confirmation={confirmation} progress={progress} bytes={bytes}/>:completed?<><span className="space-dialog-success"><CheckCircle2 size={35}/></span><h3>{t('confirm.completed',{count:completed.items,size:bytes(completed.bytes)})}</h3>{(completed.kind==='privacy'||completed.deepCleanIds!==undefined)&&<p>{t(completed.kind==='privacy'?'privacy.cleanedTraces':'deep.cleanedFiles',{count:completed.traces||0})}{Boolean(completed.skipped)&&' · '+t('privacy.skippedItems',{count:completed.skipped!})}{Boolean(completed.unchanged)&&' · '+t('privacy.unchangedItems',{count:completed.unchanged!})}</p>}{completed.failures>0&&<p role="alert">{t('common.failed',{count:completed.failures})}</p>}{completed.errors?.map((error)=><p className="space-result-error" key={error.path}>{error.path} · {error.message}</p>)}<p>{t(completed.kind==='cleanup'||completed.kind==='privacy'?'history.note':'home.trashNote')}</p><footer><button className="space-button primary" autoFocus onClick={()=>setCompleted(null)}>{t('confirm.finish')}</button></footer></>:confirmation&&<><p>{t('confirm.description',{count:confirmation.count,size:bytes(confirmation.size)})}</p>{confirmation.effects&&<div className="space-confirm-effects">{confirmation.effects.map((effect)=><p key={effect}>{effect}</p>)}</div>}{(confirmation.kind==='privacy'||confirmation.deep)&&<label className="privacy-confirm-skip"><input type="checkbox" checked={privacySkipRunning} onChange={(event)=>setPrivacySkipRunning(event.target.checked)}/>{t(confirmation.deep?'deep.skipRunning':'privacy.skipRunning')}</label>}<div className="space-dialog-files">{confirmation.names.map((name)=><div key={name}><File size={16}/><span>{name}</span></div>)}</div><div className="space-dialog-consequence"><CircleHelp size={19}/><p>{t(confirmation.deep?'deep.confirmMethods':confirmation.kind==='cleanup'||confirmation.kind==='privacy'?'cleanup.permanent':confirmation.kind==='uninstall'?'confirm.uninstall':'confirm.trash')}{confirmation.kind==='duplicates'&&` ${t('duplicates.confirm')}`}</p></div><footer><button className="space-button" autoFocus disabled={executing} onClick={()=>setConfirmation(null)}>{t('common.cancel')}</button><button className="space-button danger" disabled={executing} onClick={()=>void execute()}>{executing?<><LoaderCircle className="spinner" size={16}/>{t('common.working')}</>:t(confirmation.kind==='cleanup'||confirmation.kind==='privacy'?'common.clean':'common.trash')}</button></footer></>}
    </StorageDialog>}
  </div>
}

function SelectionBar({count,size,detail,disabled,onClear,onReview,label}:{count:number;size:string;detail?:string;disabled?:boolean;onClear:()=>void;onReview:()=>void;label?:string}):React.JSX.Element {
  const {t}=useI18n(),ref=useRef<HTMLElement>(null)
  const [position,setPosition]=useState({left:24,right:24})
  useEffect(()=>{
    const parent=ref.current?.closest<HTMLElement>('.space-workspace');if(!parent)return
    const measure=():void=>{const rect=parent.getBoundingClientRect(),style=getComputedStyle(parent);if(rect.width>0)setPosition({left:Math.max(12,rect.left+parseFloat(style.paddingLeft)),right:Math.max(12,innerWidth-rect.right+parseFloat(style.paddingRight))})}
    measure();const observer=new ResizeObserver(measure);observer.observe(parent);window.addEventListener('resize',measure)
    return()=>{observer.disconnect();window.removeEventListener('resize',measure)}
  },[])
  return <section ref={ref} style={position} data-batch-actions className="space-selection-bar" role="region" aria-label={t('selection.actions')}><div><strong>{t('common.selected',{count})}</strong><span>{size}{detail&&` · ${detail}`}</span></div><div className="space-selection-actions"><button className="space-text-button" disabled={disabled} onClick={onClear}>{t('selection.clear')}</button><button className="space-button primary" disabled={disabled} onClick={onReview}><Trash2 size={16}/>{label||t('common.review')}</button></div></section>
}


function DirectoryTree({index,selected,activeTrail,bytes,onOpen,onReveal,actions,removedPaths,onError,onSelectFile,selectedFile,adjustDemo}:{index:StorageIndex;adjustDemo?:(entry:StorageEntry)=>StorageEntry;selected:number;activeTrail:StorageEntry[];bytes:(n:number)=>string;onOpen:(e:StorageEntry,trail:StorageEntry[])=>Promise<void>;onReveal:(e:StorageEntry)=>Promise<void>;actions:(e:StorageEntry)=>React.ReactNode;removedPaths:string[];onError:(message:string)=>void;onSelectFile:(file:StorageEntry)=>void;selectedFile?:number}):React.JSX.Element {
  const {t}=useI18n()
  const [nodes,setNodes]=useState<Map<number,StorageEntry[]>>(new Map())
  const [more,setMore]=useState<Map<number,boolean>>(new Map())
  const [expanded,setExpanded]=useState<Set<number>>(new Set([0]))
  const [loading,setLoading]=useState<Set<number>>(new Set())
  const current=useRef(index.generation)
  const load=useCallback(async(entry:StorageEntry,offset=0):Promise<void>=>{
    const generation=index.generation
    setLoading((s)=>new Set([...s,entry.id]))
    try{
      const result=window.memento?await window.memento.storageChildren({generation,id:entry.id,offset}):{items:demoChildren(entry)}
      if(current.current===generation){setNodes((s)=>new Map(s).set(entry.id,offset?[...(s.get(entry.id)||[]),...result.items]:result.items));setMore((s)=>new Map(s).set(entry.id,result.items.length===200))}
    }catch(e){if(current.current===generation)onError(readableTaskError(e))}finally{if(current.current===generation)setLoading((s)=>{const next=new Set(s);next.delete(entry.id);return next})}
  },[index.generation])
  useEffect(()=>{current.current=index.generation;setNodes(new Map());setMore(new Map());setExpanded(new Set([0]));if(index.root)void load(index.root);return()=>{current.current=-1}},[index.generation,load])
  useEffect(()=>{setExpanded((s)=>new Set([...s,...activeTrail.map((e)=>e.id)]));for(const entry of activeTrail){if(entry.id!==0&&!nodes.has(entry.id))void load(entry)}},[selected,index.generation,load])
  const branch=(entry:StorageEntry,trail:StorageEntry[],depth:number):React.ReactNode=>{
    entry=adjustDemo?.(entry)||entry
    const open=expanded.has(entry.id),children=(nodes.get(entry.id)||[]).filter((file)=>!removedPaths.some((location)=>file.path===location||file.path.startsWith(location+'/')||file.path.startsWith(location+'\\')))
    return <div key={entry.id} role="none"><div className={`space-folder-row ${(selectedFile??selected)===entry.id?'is-active':''}`} role="treeitem" aria-selected={(selectedFile??selected)===entry.id} aria-expanded={entry.directory?open:undefined} aria-level={depth+1} style={{paddingLeft:8+depth*14}}>
      {entry.directory?<button className="icon-button tree-toggle" aria-label={`${t(open?'compact.collapse':'compact.expand')} ${entry.name}`} onClick={()=>{setExpanded((s)=>{const next=new Set(s);if(open)next.delete(entry.id);else next.add(entry.id);return next});if(!open&&!nodes.has(entry.id))void load(entry)}}><ChevronRight size={14} className={open?'is-open':''}/></button>:<span className="tree-spacer"/>}
      <button className="tree-folder-name" title={entry.path} onClick={()=>entry.directory?void onOpen(entry,trail):onSelectFile(entry)}>{entry.directory?<Folder size={16}/>:<File size={16}/>}<span>{entry.name}</span><b>{bytes(entry.size)}</b></button>{actions(entry)}
    </div>{open&&entry.directory&&<div role="group">{loading.has(entry.id)&&<span className="tree-loading"><LoaderCircle className="spinner" size={15}/></span>}{children.map((child)=>branch(child,[...trail,child],depth+1))}{more.get(entry.id)&&<button className="space-text-button space-load-more" onClick={()=>void load(entry,children.length)}>{t('common.more')}</button>}</div>}</div>
  }
  return <div className="space-folder-list"><div className="space-folder-list-heading"><h2>{t('disk.list')}</h2></div><div role="tree" aria-label={t('disk.list')}>{index.root&&branch(index.root,[index.root],0)}</div></div>
}

function CleanupTree({rules,selected,onToggle,bytes,actions}:{rules:CleanupItem[];selected:Set<string>;onToggle:(id:string)=>void;bytes:(n:number)=>string;actions:(file:{path:string;size:number},target:StorageTarget)=>React.ReactNode}):React.JSX.Element {
  const {t}=useI18n()
  const buckets=new Map<string,CleanupItem[]>()
  for(const rule of rules){const key=rule.browser||`cleanup.${rule.category}`;buckets.set(key,[...(buckets.get(key)||[]),rule])}
  return <div className="space-cleanup-tree">{[...buckets].map(([name,list])=>{
    const profiles=new Map<string,CleanupItem[]>()
    for(const rule of list){const profile=/[/\\](Default|Profile \d+)[/\\]/.exec(rule.path)?.[1]||t('compact.localData');profiles.set(profile,[...(profiles.get(profile)||[]),rule])}
    return <details className="space-tree-category" key={name} open><summary><ShieldCheck size={17}/><strong>{name.startsWith('cleanup.')?t(name):name}</strong><span>{list.length}</span><b>{bytes(list.reduce((s,r)=>s+r.size,0))}</b></summary>{[...profiles].map(([profile,items])=><details className="space-profile-group" open key={profile}><summary><Folder size={16}/><strong>{profile}</strong><b>{bytes(items.reduce((s,r)=>s+r.size,0))}</b></summary>{items.map((rule)=><details className="space-rule-details" key={rule.id}><summary className="space-cleanup-row"><label onClick={(e)=>e.stopPropagation()}><input type="checkbox" aria-label={t(`rule.${rule.nameKey}`)} checked={selected.has(rule.id)} onChange={()=>onToggle(rule.id)}/></label><span className="space-cleanup-copy"><strong>{t(`rule.${rule.nameKey}`)}</strong></span><span onClick={(e)=>e.stopPropagation()}><WorkspaceHelp>{t(rule.effectKey==='rebuild'?'cleanup.rebuild':`cleanup.${rule.effectKey}Effect`)}</WorkspaceHelp></span><b>{bytes(rule.size)}</b></summary><div className="space-rule-paths">{(rule.paths||[rule.path]).map((p)=><div key={p}><File size={14}/><code>{p}</code>{actions({path:p,size:rule.size},{type:'rule',id:rule.id,path:p})}</div>)}</div></details>)}</details>)}</details>
  })}</div>
}

function FileActions({file,target,onReveal,onTrash}:{file:{path:string;size:number;name?:string;modified?:number;trashable?:boolean};target:StorageTarget;onReveal:(target:StorageTarget)=>Promise<void>;onTrash?:()=>void}):React.JSX.Element {
  const {t}=useI18n()
  const name=file.name||file.path.split(/[/\\]/).pop()||file.path
  return <span className="space-file-actions" onClick={(e)=>e.stopPropagation()}>
    <button className="icon-button" title={t('common.reveal')} aria-label={`${t('common.reveal')} ${name}`} onClick={()=>void onReveal(target)}><FolderOpen size={15}/></button>
    <AiActionButton request={{key:`file:${file.path}:${file.modified||file.size}`,title:name,prompt:t('file.prompt',{path:JSON.stringify(file.path),size:file.size,modified:file.modified?new Date(file.modified/1e6).toISOString():t('file.unknown')})}}/>
    {onTrash&&<button className="icon-button file-trash" disabled={file.trashable===false} title={t(file.trashable===false?'storage.readOnly':'common.trash')} aria-label={`${t(file.trashable===false?'storage.readOnly':'common.trash')} ${name}`} onClick={onTrash}><Trash2 size={15}/></button>}
  </span>
}

function CleanupAnimation({confirmation,progress,bytes}:{confirmation:Confirmation;progress:StorageProgress|null;bytes:(n:number)=>string}):React.JSX.Element {
  const {t}=useI18n()
  const done=progress?.phase==='cleaning'?progress.entries:0
  const total=progress?.total||confirmation.count
  const percent=Math.min(100,Math.round(done/total*100))
  return <div className="space-cleaning-animation" role="status" aria-live="polite">
    <div className="space-cleaning-scene" aria-hidden="true"><i/><i/><i/><span><Trash2 size={35}/></span><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54"/><circle cx="60" cy="60" r="54" pathLength="100" strokeDasharray={`${percent} 100`}/></svg></div>
    <p>{t(progress?.phase==='queued'?'scan.queued':confirmation.kind==='cleanup'||confirmation.kind==='privacy'?'cleaning.permanent':'cleaning.trash')}</p>{progress?.phase==='queued'&&<p>{t('scan.waiting')}</p>}
    <div className="space-cleaning-count"><strong>{t('cleaning.progress',{done,total})}</strong><span>{bytes(confirmation.size)}</span></div>
    <div className="space-progress-track is-measured" role="progressbar" aria-label={t('cleaning.title')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${percent}%`}}/></div>
    <code title={progress?.path}>{progress?.path||confirmation.names[0]}</code>
  </div>
}
