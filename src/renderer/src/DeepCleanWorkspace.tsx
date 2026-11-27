import {AppWindow,Archive,ArrowUpRight,Box,BrainCircuit,Check,ChevronDown,ChevronRight,Code2,File,FolderOpen,HardDrive,Info,Layers3,LoaderCircle,LockKeyhole,Search,Settings2,ShieldCheck,ShieldEllipsis,Terminal,Trash2,X} from 'lucide-react'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {DeepCleanFile,DeepCleanGroup,DeepCleanItem,DeepCleanPreview,DeepCleanScan,DeepCleanSource} from '../../shared/deep-clean-types'
import {AiActionButton,readableTaskError} from './AiTasks'
import {useI18n} from './i18n'
import {useMessages} from './Messages'
import {WorkspaceDialog} from './WorkspaceDialog'
import './DeepCleanWorkspace.css'

export interface DeepCleanWorkspaceProps {
  scan:DeepCleanScan|null
  selected:Set<string>
  bytes:(size:number)=>string
  loading:boolean
  onScan:()=>void
  onCancel?:()=>void
  onToggle:(ids:string[],checked:boolean)=>void
  onClear:()=>void
  onReview:()=>void
  preview:(id:string,offset:number)=>Promise<DeepCleanPreview>
  reveal:(id:string,path?:string)=>Promise<void>|void
  icon:(itemId:string)=>Promise<string|null>
  onPermissions:()=>Promise<void>|void
  progress?:React.ReactNode
}
const groups:DeepCleanGroup[]=['system','user-cache','browser','application','development','project','xcode','ai','container','custom']
const groupIcons:Record<DeepCleanGroup,typeof HardDrive>={system:HardDrive,'user-cache':Archive,browser:Layers3,application:AppWindow,development:Terminal,project:Code2,xcode:Code2,ai:BrainCircuit,container:Box,'application-optimization':Settings2,custom:FolderOpen}
const available=(item:DeepCleanItem,source:DeepCleanSource):boolean=>item.risk!=='protected'&&source.cleanupMethod!=='none'&&['ready','requires-close'].includes(source.status)&&source.count>0
type SourcePair={item:DeepCleanItem;source:DeepCleanSource}
function BulkCheck({pairs,selected,onToggle,label,disabled}:{pairs:SourcePair[];selected:Set<string>;onToggle:(ids:string[],checked:boolean)=>void;label:string;disabled:boolean}):React.JSX.Element {
  const input=useRef<HTMLInputElement>(null),eligible=pairs.filter(({item,source})=>available(item,source)),count=eligible.filter(({source})=>selected.has(source.id)).length
  useEffect(()=>{if(input.current)input.current.indeterminate=count>0&&count<eligible.length},[count,eligible.length])
  return <input ref={input} type="checkbox" aria-label={label} disabled={disabled||!eligible.length} checked={eligible.length>0&&count===eligible.length} onChange={(event)=>onToggle(eligible.map(({source})=>source.id),event.target.checked)}/>
}
function RuleLogo({item,load}:{item:DeepCleanItem;load:DeepCleanWorkspaceProps['icon']}):React.JSX.Element {
  const [value,setValue]=useState<string|null>(null),latest=useRef(load);latest.current=load
  useEffect(()=>{let active=true;setValue(null);void latest.current(item.id).then((icon)=>{if(active)setValue(icon)}).catch(()=>undefined);return()=>{active=false}},[item.id])
  if(value)return <img className="deep-rule-logo" src={value} alt={item.owner?.name||''}/>
  if(!window.diskCollie&&item.owner?.key==='vscode')return <img className="deep-rule-logo" src={new URL('./assets/demo-vscode.ico',import.meta.url).href} alt="Visual Studio Code"/>
  const Icon=groupIcons[item.group]
  return <span className="deep-rule-logo deep-logo-fallback"><Icon size={22}/></span>
}
interface PreviewState {item:DeepCleanItem;source:DeepCleanSource;files:DeepCleanFile[];total:number;nextOffset:number|null;offset:number;loading:boolean;error:string}
export function DeepCleanWorkspace({scan,selected,bytes,loading,onScan,onCancel,onToggle,onClear,onReview,preview,reveal,icon,onPermissions,progress}:DeepCleanWorkspaceProps):React.JSX.Element {
  const {t,locale}=useI18n(),{show}=useMessages(),allItems=useMemo(()=>(scan?.items||[]).filter((item)=>item.risk!=='protected').map((item)=>({...item,sources:item.sources.filter((source)=>source.cleanupMethod!=='none'&&source.status!=='review-only').sort((a,b)=>b.size-a.size||a.path.localeCompare(b.path))})).filter((item)=>item.sources.length).sort((a,b)=>b.size-a.size||a.key.localeCompare(b.key)),[scan])
  const [group,setGroup]=useState<DeepCleanGroup|null>(null),[expanded,setExpanded]=useState<Record<string,boolean>>({}),[mode,setMode]=useState('manual'),[details,setDetails]=useState<PreviewState|null>(null)
  const [discoveredOnly,setDiscoveredOnly]=useState(true),[observed,setObserved]=useState<Set<string>>(new Set())
  const request=useRef(0),latestPreview=useRef(preview);latestPreview.current=preview
  useEffect(()=>{if(!scan)return;setObserved((previous)=>{const next=new Set(previous);for(const item of scan.items)for(const source of item.sources)if(source.count>0||source.size>0)next.add(source.id);return next.size===previous.size?previous:next})},[scan])
  const items=useMemo(()=>allItems.map((item)=>({...item,sources:item.sources.filter((source)=>!discoveredOnly||source.count>0||source.size>0||source.status!=='empty'||observed.has(source.id))})).filter((item,index)=>!discoveredOnly||item.sources.length>0||!allItems[index].sources.length&&item.status!=='empty'),[scan,discoveredOnly,observed])
  const name=(item:DeepCleanItem):string=>locale.startsWith('zh')?item.name.zh:item.name.en
  const description=(item:DeepCleanItem):string=>locale.startsWith('zh')?item.description.zh:item.description.en
  const pairs=useMemo(()=>allItems.flatMap((item)=>item.sources.map((source)=>({item,source}))),[scan])
  const present=groups.filter((key)=>items.some((item)=>item.group===key)).sort((a,b)=>items.filter((item)=>item.group===b).reduce((sum,item)=>sum+item.size,0)-items.filter((item)=>item.group===a).reduce((sum,item)=>sum+item.size,0)),active=group&&present.includes(group)?group:present[0]||'system',visible=items.filter((item)=>item.group===active)
  const eligible=pairs.filter(({item,source})=>available(item,source)),safe=eligible.filter(({item,source})=>item.risk==='safe'&&source.status==='ready'),chosen=eligible.filter(({source})=>selected.has(source.id))
  const discoveredCount=pairs.filter(({source})=>source.count>0||source.size>0||source.status!=='empty'||observed.has(source.id)).length
  const totalSize=pairs.reduce((sum,{source})=>sum+source.size,0),selectedSize=chosen.reduce((sum,{source})=>sum+source.size,0),selectedFiles=chosen.reduce((sum,{source})=>sum+source.count,0)
  const toggle=(ids:string[],checked:boolean):void=>{setMode('manual');onToggle(ids,checked)}
  const selectMode=(value:string):void=>{setMode(value);if(value==='manual')return;onClear();const list=value==='safe'?safe:value==='recommended'?safe.filter(({item})=>item.recommended):[];if(list.length)onToggle(list.map(({source})=>source.id),true)}
  const permissions=():void=>{try{void Promise.resolve(onPermissions()).catch((error)=>show({message:readableTaskError(error),tone:'error'}))}catch(error){show({message:readableTaskError(error),tone:'error'})}}
  const open=(id:string,path?:string):void=>{try{void Promise.resolve(reveal(id,path)).catch((error)=>show({message:readableTaskError(error),tone:'error'}))}catch(error){show({message:readableTaskError(error),tone:'error'})}}
  const closePreview=():void=>{request.current++;setDetails(null)}
  const load=async(item:DeepCleanItem,source:DeepCleanSource,offset=0):Promise<void>=>{
    const token=++request.current
    setDetails((previous)=>({item,source,files:offset?previous?.files||[]:[],total:previous?.source.id===source.id?previous.total:source.count,nextOffset:null,offset,loading:true,error:''}))
    try{const result=await latestPreview.current(source.id,offset);if(token!==request.current)return;setDetails((previous)=>({item,source,files:offset?[...new Map([...(previous?.files||[]),...result.files].map((file)=>[file.id,file])).values()]:result.files,total:result.total,nextOffset:result.nextOffset,offset,loading:false,error:''}))}
    catch(error){if(token===request.current)setDetails((previous)=>previous?{...previous,loading:false,error:readableTaskError(error)}:previous)}
  }
  const fileTime=(timestamp:number):string=>timestamp>0?new Intl.DateTimeFormat(locale,{dateStyle:'medium'}).format(new Date(timestamp>1e15?timestamp/1e6:timestamp)):t('deep.unknownTime')
  const ai=(item:DeepCleanItem,source:DeepCleanSource,file?:DeepCleanFile)=>({key:`deep:${source.id}:${file?.id||'source'}`,title:file?.name||`${name(item)} · ${source.name}`,prompt:t('deep.aiPrompt',{name:name(item),group:t(`deep.group.${item.group}`),path:JSON.stringify(file?.path||source.path),size:file?.size??source.size,count:file?1:source.count,risk:t(`deep.risk.${item.risk}`),status:t(`deep.status.${source.status}`),method:t(`deep.method.${source.cleanupMethod||'delete'}`),apps:item.runningApps.join(', ')||t('deep.noRunningApps')})})
  const canPreview=(source:DeepCleanSource):boolean=>source.count>0&&!['permission-required','unavailable','empty'].includes(source.status)
  return <section className="deep-clean-page">
    <header className="space-heading deep-heading"><div><h1>{t('deep.title')}</h1>{scan&&<span>{t('deep.scanSummary',{size:bytes(totalSize),count:discoveredCount})}</span>}</div><div className="deep-heading-actions">{loading&&onCancel&&<button className="space-button" onClick={onCancel}><X size={14}/>{t('common.cancel')}</button>}<button className="space-button" disabled={loading} onClick={onScan}>{loading?<LoaderCircle className="spinner" size={15}/>:<Search size={15}/>}<span>{t(scan?'common.rescan':'deep.startScan')}</span></button></div></header>
    {progress}
    {scan&&(scan.limited||scan.errors>0)&&<div className="deep-scan-notice" role="status"><Info size={15}/><span>{scan.limited?t('deep.scanLimited'):t('deep.scanErrors',{count:scan.errors})}</span>{scan.errors>0&&<button className="space-text-button" onClick={permissions}>{t('deep.permissions')}</button>}</div>}
    {!scan?(!loading?<div className="deep-first-scan"><Search size={32}/><h2>{t('deep.emptyTitle')}</h2><p>{t('deep.emptyDescription')}</p><button className="space-button primary" onClick={onScan}>{t('deep.startScan')}</button></div>:null):<div className="deep-workspace">
      <nav className="deep-categories" aria-label={t('deep.categories')}>{(present.length?present:groups).map((key)=>{const Icon=groupIcons[key],list=pairs.filter(({item})=>item.group===key),size=list.reduce((sum,{source})=>sum+source.size,0),count=list.filter(({item,source})=>available(item,source)&&selected.has(source.id)).length;return <button key={key} data-size={size} className={active===key?'is-active':''} aria-current={active===key?'page':undefined} onClick={()=>setGroup(key)}><Icon size={18}/><span><strong>{t(`deep.group.${key}`)}</strong><small>{bytes(size)}</small></span>{count>0&&<b>{count}</b>}</button>})}</nav>
      <div className="deep-content"><header><div><h2>{t(`deep.group.${active}`)}</h2><span>{t('deep.ruleCount',{count:visible.length})}</span></div><div className="deep-content-heading-actions"><label><input type="checkbox" checked={discoveredOnly} aria-label={t('deep.discoveredOnly')} onChange={(event)=>setDiscoveredOnly(event.target.checked)}/>{t('deep.discoveredOnly')}</label><label><BulkCheck pairs={pairs.filter(({item,source})=>item.group===active&&item.risk==='safe'&&source.status==='ready')} selected={selected} onToggle={toggle} label={t('deep.selectGroup')} disabled={loading}/>{t('deep.selectGroup')}</label></div></header>
        {loading&&!scan?<div className="deep-skeleton" aria-label={t('deep.scanning')}>{[0,1,2,3,4].map((index)=><div key={index}><i/><span/><b/></div>)}</div>:visible.map((item,index)=>{const title=name(item),isOpen=expanded[item.id]??(index===0),itemPairs=item.sources.map((source)=>({item,source}));return <section className={`deep-rule ${isOpen?'is-open':''} risk-${item.risk}`} key={item.id} data-deep-rule={item.key} data-size={item.size}>
          <div className="deep-rule-heading"><BulkCheck pairs={itemPairs} selected={selected} onToggle={toggle} disabled={loading} label={t('deep.selectRule',{name:title})}/><button className="deep-rule-toggle" aria-expanded={isOpen} aria-label={t('deep.toggleRule',{name:title})} onClick={()=>setExpanded((previous)=>({...previous,[item.id]:!isOpen}))}><RuleLogo item={item} load={icon}/><span><strong>{title}</strong><small>{description(item)}</small></span><b>{bytes(item.size)}<small>{t('deep.files',{count:item.count.toLocaleString(locale)})}</small></b><ChevronDown size={15}/></button></div>
          {isOpen&&<div className="deep-rule-details">
            {item.risk!=='safe'&&<p className={`deep-risk-note risk-${item.risk}`}>{item.risk==='protected'?<LockKeyhole size={14}/>:<ShieldEllipsis size={14}/>}<span>{t(`deep.riskNote.${item.risk}`)}</span></p>}
            {item.runningApps.length>0&&<p className="deep-running-note"><AppWindow size={14}/>{t('deep.runningApps',{names:item.runningApps.join(', ')})}</p>}
            {!item.sources.length&&<div className={`deep-no-sources status-${item.status}`}><span>{t(`deep.status.${item.status}`)}</span>{item.status==='permission-required'&&<button className="space-text-button" onClick={permissions}>{t('deep.permissions')}<ArrowUpRight size={12}/></button>}</div>}
            {item.sources.map((source)=>{const enabled=available(item,source);return <div className={`deep-source status-${source.status} ${selected.has(source.id)&&enabled?'is-selected':''}`} key={source.id} data-deep-source={source.id} data-size={source.size}>
              <input type="checkbox" aria-label={t('deep.selectSource',{name:source.name})} checked={selected.has(source.id)&&enabled} disabled={loading||!enabled} onChange={(event)=>toggle([source.id],event.target.checked)}/>
              <button className="deep-source-details" disabled={loading||(!canPreview(source)&&source.status!=='permission-required')} aria-label={t('deep.previewSource',{name:source.name})} onClick={()=>source.status==='permission-required'?permissions():void load(item,source)}><span><strong>{source.name}</strong><code title={source.path}>{source.path}</code><small className={`deep-source-state ${source.status==='ready'&&item.risk==='safe'?'state-safe':''}`}>{source.status!=='ready'?t(`deep.status.${source.status}`):t(`deep.risk.${item.risk}`)}{source.cleanupMethod&&` · ${t(`deep.method.${source.cleanupMethod}`)}`}</small></span><b>{bytes(source.size)}<small>{t('deep.files',{count:source.count.toLocaleString(locale)})}</small></b>{source.status==='permission-required'?<LockKeyhole size={14}/>:canPreview(source)?<ChevronRight size={14}/>:<span className="deep-chevron-spacer"/>}</button>
              <div className="deep-source-actions"><button className="icon-button" aria-label={t('deep.openSource',{name:source.name})} data-tooltip={t('common.reveal')} disabled={!source.path} onClick={()=>open(source.id)}><FolderOpen size={15}/></button><AiActionButton request={ai(item,source)}/></div>
            </div>})}
          </div>}
        </section>})}
        {!loading&&scan&&!visible.length&&<div className="deep-category-empty"><ShieldCheck size={26}/><strong>{t('deep.noSources')}</strong><button className="space-text-button" onClick={onScan}>{t('common.rescan')}</button></div>}
      </div>
    </div>}
    {scan&&<footer className="deep-batch-actions" role="region" aria-label={t('selection.actions')} data-batch-actions><div><span>{t('common.selected',{count:chosen.length})}</span><strong>{bytes(selectedSize)}</strong><small>{t('deep.files',{count:selectedFiles.toLocaleString(locale)})}</small></div><div className="deep-batch-controls"><label><span>{t('deep.selectionMode')}</span><select aria-label={t('deep.selectionMode')} value={mode} disabled={loading} onChange={(event)=>selectMode(event.target.value)}>{['manual','recommended','safe','none'].map((value)=><option value={value} key={value}>{t(`deep.selection.${value}`)}</option>)}</select></label>{chosen.length>0&&<button className="space-text-button deep-clear" disabled={loading} onClick={()=>{setMode('manual');onClear()}}>{t('selection.clear')}</button>}<button className="space-button primary" disabled={loading||!chosen.length} onClick={onReview}><Trash2 size={15}/>{t('deep.review')}</button></div></footer>}
    {details&&<WorkspaceDialog title={details.source.name} className="deep-preview-dialog" dismiss={closePreview}><div className="deep-preview-summary"><RuleLogo item={details.item} load={icon}/><div><strong>{name(details.item)}</strong><code>{details.source.path}</code></div><b>{bytes(details.source.size)}</b></div><div className={`deep-preview-risk risk-${details.item.risk}`}><ShieldCheck size={14}/><span>{description(details.item)}{details.item.risk!=='safe'&&` ${t(`deep.riskNote.${details.item.risk}`)}`}<b>{t(`deep.method.${details.source.cleanupMethod||'delete'}`)}</b></span></div>
      <div className="deep-preview-scroll" aria-busy={details.loading}>{details.files.map((file)=><div className="deep-preview-file" key={file.id}><File size={16}/><div><strong>{file.name}</strong><code>{file.path}</code><small>{fileTime(file.modified)}</small></div><b>{bytes(file.size)}</b><div className="deep-preview-file-actions"><button className="icon-button" data-tooltip={t('common.reveal')} aria-label={`${t('common.reveal')} ${file.name}`} onClick={()=>open(details.source.id,file.path)}><FolderOpen size={15}/></button><AiActionButton request={ai(details.item,details.source,file)}/></div></div>)}
        {details.loading&&<div className="deep-preview-status" role="status"><LoaderCircle className="spinner" size={19}/>{t('deep.loadingFiles')}</div>}
        {!details.loading&&details.error&&<div className="deep-preview-status deep-preview-error"><Info size={23}/><p>{details.error}</p><button className="space-button" onClick={()=>void load(details.item,details.source,details.offset)}>{t('common.retry')}</button><button className="space-text-button" onClick={()=>{closePreview();onScan()}}>{t('common.rescan')}</button></div>}
        {!details.loading&&!details.error&&!details.files.length&&<div className="deep-preview-status"><Archive size={24}/>{t('deep.noFiles')}</div>}
      </div><div className="deep-preview-pagination"><span>{t('deep.previewCount',{shown:details.files.length.toLocaleString(locale),total:details.total.toLocaleString(locale)})}</span>{!details.error&&details.nextOffset!==null&&<button className="space-text-button" disabled={details.loading} onClick={()=>void load(details.item,details.source,details.nextOffset!)}>{t('common.more')}<ChevronDown size={13}/></button>}</div><footer><button className="space-button" onClick={closePreview}><X size={14}/>{t('common.close')}</button><button className="space-button primary" disabled={loading||!available(details.item,details.source)} onClick={()=>toggle([details.source.id],!selected.has(details.source.id))}>{selected.has(details.source.id)?<Check size={14}/>:<ShieldCheck size={14}/>} {t(selected.has(details.source.id)?'deep.sourceSelected':'deep.selectThisSource')}</button></footer>
    </WorkspaceDialog>}
  </section>
}
