import {AppWindow,ArrowDown,ArrowDownToLine,ArrowUp,ArrowUpDown,ChevronDown,ChevronRight,Clock3,Clipboard,Database,FileClock,Folder,Globe,History,KeyRound,LoaderCircle,LockKeyhole,Monitor,Search,Settings2,ShieldCheck,Terminal,UserRound,Wifi,X} from 'lucide-react'
import {useEffect,useMemo,useRef,useState} from 'react'
import type {PrivacyCategory} from '../../shared/storage-types'
import type {PrivacyItem,PrivacyKind,PrivacyPreview,PrivacyRecord,PrivacyTimeRange} from '../../shared/privacy-types'
import {AiActionButton,readableTaskError} from './AiTasks'
import {WorkspaceDialog} from './WorkspaceDialog'
import {useI18n} from './i18n'
import {useMessages} from './Messages'
import './privacy-workspace.css'

const categories:PrivacyCategory[]=['browser-activity','browser-accounts','app-activity','system-activity']
const categoryIcons={ 'browser-activity':Globe,'browser-accounts':ShieldCheck,'app-activity':AppWindow,'system-activity':Clock3 }
const kindIcons:Partial<Record<PrivacyKind,typeof History>>={search:Search,downloads:ArrowDownToLine,cookies:ShieldCheck,'site-data':Database,'site-permissions':Settings2,passwords:KeyRound,autofill:UserRound,clipboard:Clipboard,'shell-history':Terminal,'recent-apps':AppWindow,'recent-documents':FileClock,'recent-servers':Monitor,'network-history':Wifi,'app-cache':Database,'app-logs':FileClock,'app-sessions':AppWindow,'app-edit-history':FileClock}
const canSelect=(item:PrivacyItem):boolean=>item.capability==='ready'&&(item.count??0)>0
const numericCount=(items:PrivacyItem[]):number=>items.reduce((sum,item)=>sum+(item.count??0),0)
const sourceKey=(item:PrivacyItem):string=>item.source?.key||item.browser||'system'
const sourceName=(items:PrivacyItem[],fallback:string):string=>items[0].source?.name||items[0].browser||fallback
const sourceBytes=(items:PrivacyItem[]):number=>{const files=new Map<string,number>();for(const item of items){const key=item.path||item.id;files.set(key,Math.max(files.get(key)||0,item.size))}return [...files.values()].reduce((sum,size)=>sum+size,0)}
export interface PrivacyWorkspaceProps {
  rules:PrivacyItem[]
  selected:Set<string>
  onToggle:(ids:string[],checked:boolean)=>void
  bytes:(n:number)=>string
  loading:boolean
  range:PrivacyTimeRange
  onRangeChange:(range:PrivacyTimeRange)=>void
  onRefresh:()=>void
  onReview:()=>void
  onClear:()=>void
  preview:(id:string,offset:number)=>Promise<PrivacyPreview>
  onPermissions:()=>void
  progress?:React.ReactNode
}
function GroupCheck({items,selected,onToggle,label,disabled=false}:{items:PrivacyItem[];selected:Set<string>;onToggle:(ids:string[],checked:boolean)=>void;label:string;disabled?:boolean}):React.JSX.Element {
  const ref=useRef<HTMLInputElement>(null),available=items.filter(canSelect),count=available.filter((item)=>selected.has(item.id)).length
  useEffect(()=>{if(ref.current)ref.current.indeterminate=count>0&&count<available.length},[count,available.length])
  return <input ref={ref} type="checkbox" aria-label={label} checked={available.length>0&&count===available.length} disabled={disabled||!available.length} onChange={(event)=>onToggle(available.map((item)=>item.id),event.target.checked)}/>
}
function SourceLogo({rule}:{rule:PrivacyItem}):React.JSX.Element {
  const [icon,setIcon]=useState<string|null>(null)
  useEffect(()=>{let current=true;setIcon(null);if(window.memento)void window.memento.storageCleanupIcon(rule.id).then((value)=>{if(current)setIcon(value)}).catch(()=>undefined);return()=>{current=false}},[rule.id])
  if(icon)return <img className="privacy-source-logo" src={icon} alt={rule.source?.name||rule.browser||''}/>
  if(!window.memento&&rule.source?.key==='chrome')return <svg className="privacy-source-logo" viewBox="0 0 40 40" aria-label="Google Chrome" role="img"><circle cx="20" cy="20" r="18" fill="#e8b83d"/><path d="M20 20 4.4 29A18 18 0 0 1 20 2H36Z" fill="#df6256"/><path d="M20 20 36 11a18 18 0 0 1-16 27H4Z" fill="#67a471"/><circle cx="20" cy="20" r="8.8" fill="#f5f8fa"/><circle cx="20" cy="20" r="7" fill="#5d93cb"/></svg>
  if(!window.memento&&rule.source?.key==='safari')return <svg className="privacy-source-logo" viewBox="0 0 40 40" aria-label="Safari" role="img"><rect x="1" y="1" width="38" height="38" rx="9" fill="#f4f6f7"/><circle cx="20" cy="20" r="16" fill="#67aacf"/><path d="m27 8-4 15-10 9 4-15Z" fill="white"/><path d="m27 8-4 15-6-6Z" fill="#df6662"/></svg>
  if(!window.memento&&rule.source?.key==='vscode')return <img className="privacy-source-logo" src={new URL('./assets/demo-vscode.ico',import.meta.url).href} alt="Visual Studio Code"/>
  if(!window.memento&&rule.source?.key==='figma')return <img className="privacy-source-logo" src={new URL('./assets/demo-figma.svg',import.meta.url).href} alt="Figma"/>
  const Icon=rule.privacyCategory.startsWith('browser')?Globe:rule.privacyCategory==='system-activity'?Monitor:AppWindow
  return <span className="privacy-source-logo privacy-logo-fallback"><Icon size={23}/></span>
}
interface PreviewState {item:PrivacyItem;records:PrivacyRecord[];loading:boolean;error:string;nextOffset:number|null;total:number;limited:boolean;requestedOffset:number}
export function PrivacyWorkspace({rules,selected,onToggle,bytes,loading,range,onRangeChange,onRefresh,onReview,onClear,preview,onPermissions,progress}:PrivacyWorkspaceProps):React.JSX.Element {
  const {t,locale}=useI18n(),{show}=useMessages()
  const [category,setCategory]=useState<PrivacyCategory>('browser-activity'),[expanded,setExpanded]=useState<Record<string,boolean>>({}),[mode,setMode]=useState('manual'),[details,setDetails]=useState<PreviewState|null>(null)
  const [appSort,setAppSort]=useState<{key:'name'|'count';direction:'ascending'|'descending'}>({key:'name',direction:'ascending'})
  const sequence=useRef(0),latest=useRef(preview);latest.current=preview
  const displayRules=useMemo(()=>{
    const groups=new Map<string,PrivacyItem[]>()
    for(const rule of rules)if(rule.privacyCategory==='app-activity'){const key=sourceKey(rule);groups.set(key,[...(groups.get(key)||[]),rule])}
    const empty=new Set([...groups].filter(([,items])=>items.every((item)=>item.count===0)).map(([key])=>key))
    return rules.filter((rule)=>rule.privacyCategory!=='app-activity'||!empty.has(sourceKey(rule)))
  },[rules])
  const visible=useMemo(()=>displayRules.filter((rule)=>rule.privacyCategory===category),[displayRules,category]),eligible=rules.filter(canSelect),chosen=rules.filter((rule)=>selected.has(rule.id)&&canSelect(rule))
  const groupedSources=useMemo(()=>{const groups=new Map<string,PrivacyItem[]>();for(const rule of visible){const key=sourceKey(rule);groups.set(key,[...(groups.get(key)||[]),rule])}return [...groups]},[visible])
  const sources=useMemo(()=>{
    if(category!=='app-activity')return groupedSources
    const collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'})
    return groupedSources.map((entry,index)=>({entry,index})).sort((a,b)=>{
      const aItems=a.entry[1],bItems=b.entry[1],direction=appSort.direction==='ascending'?1:-1
      if(appSort.key==='count'){
        const aUnknown=aItems.some((item)=>item.count===null),bUnknown=bItems.some((item)=>item.count===null)
        if(aUnknown!==bUnknown)return aUnknown?1:-1
        const difference=numericCount(aItems)-numericCount(bItems)
        if(difference)return difference*direction
      }
      const nameOrder=collator.compare(sourceName(aItems,t('privacy.system')),sourceName(bItems,t('privacy.system')))
      return (appSort.key==='name'?nameOrder*direction:nameOrder)||a.index-b.index
    }).map(({entry})=>entry)
  },[appSort,category,groupedSources,locale,t])
  const changeAppSort=(key:'name'|'count'):void=>setAppSort((current)=>({key,direction:current.key===key?(current.direction==='ascending'?'descending':'ascending'):key==='name'?'ascending':'descending'}))
  const count=(items:PrivacyItem[]):string=>{const total=numericCount(items),unknown=items.some((item)=>item.count===null);return total?`${total.toLocaleString(locale)}${unknown?'+':''}`:unknown?'—':'0'}
  const toggle=(ids:string[],checked:boolean):void=>{setMode('manual');onToggle(ids,checked)}
  const chooseMode=(value:string):void=>{
    setMode(value)
    if(value==='manual')return
    onClear()
    if(value==='all')onToggle(eligible.map((item)=>item.id),true)
    if(value==='recommended')onToggle(eligible.filter((item)=>item.recommended&&item.risk==='low').map((item)=>item.id),true)
  }
  const closeDetails=():void=>{sequence.current++;setDetails(null)}
  const requestPermissions=():void=>{try{void Promise.resolve(onPermissions()).catch((error)=>show({message:readableTaskError(error),tone:'error'}))}catch(error){show({message:readableTaskError(error),tone:'error'})}}
  const loadPreview=async(item:PrivacyItem,offset:number,replace:boolean):Promise<void>=>{
    const token=++sequence.current
    setDetails((previous)=>({item,records:replace?[]:previous?.records||[],loading:true,error:'',nextOffset:previous?.nextOffset??null,total:previous?.total??item.count??0,limited:previous?.limited||Boolean(item.limited),requestedOffset:offset}))
    try{
      const result=await latest.current(item.id,offset)
      if(token!==sequence.current)return
      setDetails((previous)=>({item,records:replace?result.records:[...new Map([...(previous?.records||[]),...result.records].map((record)=>[record.id,record])).values()],loading:false,error:'',nextOffset:result.nextOffset,total:result.total,limited:Boolean(result.limited),requestedOffset:offset}))
    }catch(error){if(token===sequence.current)setDetails((previous)=>previous?{...previous,loading:false,error:readableTaskError(error)}:previous)}
  }
  const openPreview=(item:PrivacyItem):void=>{if(item.capability==='permission-required'){requestPermissions();return}if(item.capability!=='ready'&&item.capability!=='empty')return;void loadPreview(item,0,true)}
  const date=(value:string):string=>{const timestamp=new Date(value);return Number.isFinite(timestamp.getTime())?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(timestamp):'—'}
  const risk=(item:PrivacyItem):string=>item.risk==='low'?'':t(`privacy.risk.${item.risk}`)
  const kindName=(item:PrivacyItem):string=>t(`privacy.kind.${item.kind}`)
  return <section className="privacy-page">
    <header className="space-heading privacy-page-heading"><div><h1>{t('privacy.title')}</h1><span className="privacy-page-total">{t('privacy.traces',{count:count(displayRules)})}<i/>{t('privacy.findings',{count:displayRules.length})}</span></div><div className="space-actions"><label className="privacy-range"><Clock3 size={15}/><select aria-label={t('privacy.timeRange')} value={range} disabled={loading} onChange={(event)=>{closeDetails();onRangeChange(event.target.value as PrivacyTimeRange)}}>{(['hour','today','week','all'] as const).map((value)=><option key={value} value={value}>{t(`privacy.range.${value}`)}</option>)}</select></label><button className="space-button" disabled={loading} onClick={onRefresh}>{loading?<LoaderCircle className="spinner" size={15}/>:<Search size={15}/>}<span>{t('common.rescan')}</span></button></div></header>
    {progress}
    {(!loading||rules.length>0)&&<><section className="privacy-workspace"><nav className="privacy-categories" aria-label={t('privacy.categories')}>{categories.map((key)=>{const Icon=categoryIcons[key],list=displayRules.filter((rule)=>rule.privacyCategory===key),selection=list.filter((rule)=>selected.has(rule.id)&&canSelect(rule));return <button key={key} className={category===key?'is-active':''} aria-current={category===key?'page':undefined} onClick={()=>setCategory(key)}><Icon size={19}/><span><strong>{t(`privacy.category.${key}`)}</strong><small>{t('privacy.findings',{count:list.length})}<i/> {t('privacy.traces',{count:count(list)})}</small></span>{selection.length>0&&<b aria-label={t('privacy.selectedTraces',{count:count(selection)})}>{numericCount(selection).toLocaleString(locale)}</b>}</button>})}</nav>
      <div className="privacy-content"><header><div><h2>{t(`privacy.category.${category}`)}</h2><span>{t('privacy.traces',{count:count(visible)})}</span></div><div className="privacy-content-tools">{category==='app-activity'&&<div className="privacy-app-sort" role="group" aria-label={t('privacy.sortApps')}>{(['name','count'] as const).map((key)=>{const active=appSort.key===key,Icon=active?(appSort.direction==='ascending'?ArrowUp:ArrowDown):ArrowUpDown;return <button type="button" key={key} data-privacy-sort={key} data-sort-direction={active?appSort.direction:undefined} aria-label={`${t(key==='name'?'privacy.sortName':'privacy.sortCount')}${active?`, ${t(`privacy.${appSort.direction}`)}`:''}`} aria-pressed={active} onClick={()=>changeAppSort(key)}><span>{t(key==='name'?'privacy.name':'privacy.traceCount')}</span><Icon size={12}/></button>})}</div>}<label><GroupCheck items={visible} selected={selected} onToggle={toggle} disabled={loading} label={t('privacy.selectCategory')}/>{t('privacy.selectCategory')}</label></div></header>
        {category==='browser-accounts'&&<p className="privacy-account-note"><ShieldCheck size={15}/>{t('privacy.accountsNote')}</p>}
        {visible.some((item)=>item.capability==='permission-required')&&<div className="privacy-access-note"><LockKeyhole size={16}/><span>{t('privacy.accessNote')}</span><button className="space-text-button" onClick={requestPermissions}>{t('privacy.openPermissions')}<ChevronRight size={13}/></button></div>}
        {loading&&!rules.length?<div className="privacy-result-skeleton" aria-label={t('privacy.loading')}>{[0,1,2,3].map((index)=><div key={index}><i/><span/><b/></div>)}</div>:sources.map(([key,list])=>{
          const name=sourceName(list,t('privacy.system')),open=expanded[key]??(key===groupedSources[0]?.[0]||category==='system-activity'),profiles=new Map<string,PrivacyItem[]>()
          for(const rule of list){const profile=rule.profile||'';profiles.set(profile,[...(profiles.get(profile)||[]),rule])}
          return <section className={`privacy-source ${open?'is-open':''}`} key={key} data-privacy-source={key}><div className="privacy-source-heading"><GroupCheck items={list} selected={selected} onToggle={toggle} disabled={loading} label={t('privacy.selectSource',{name})}/><button className="privacy-source-toggle" aria-label={t('privacy.toggleSource',{name})} aria-expanded={open} onClick={()=>setExpanded((previous)=>({...previous,[key]:!open}))}><SourceLogo rule={list[0]}/><span><strong>{name}</strong>{profiles.size>1&&<small>{t('privacy.profiles',{count:profiles.size})}</small>}</span>{list.some((item)=>item.browserRunning)&&<em>{t('privacy.browserRunning')}</em>}<b>{t('privacy.traces',{count:count(list)})}</b><ChevronDown size={15}/></button></div>
            {open&&<div className="privacy-source-records">{[...profiles].map(([profile,items])=><div className={`privacy-profile ${profile?'has-name':''}`} key={profile||'local'}>{profile&&<div className="privacy-profile-heading"><GroupCheck items={items} selected={selected} onToggle={toggle} disabled={loading} label={t('privacy.selectProfile',{name:profile})}/><UserRound size={14}/><strong>{profile==='Default'?t('privacy.defaultProfile'):profile}</strong><span>{t('privacy.traces',{count:count(items)})}</span></div>}{items.map((item)=>{const Icon=kindIcons[item.kind]||History,available=canSelect(item),title=kindName(item),status=item.capability==='ready'?'':t(`privacy.capability.${item.capability}`);return <div className={`privacy-record-row space-cleanup-row capability-${item.capability} ${selected.has(item.id)?'is-selected':''}`} key={item.id} data-privacy-id={item.id} data-privacy-kind={item.kind}>
              <input type="checkbox" aria-label={title} checked={selected.has(item.id)&&available} disabled={loading||!available} onChange={(event)=>toggle([item.id],event.target.checked)}/><button className="privacy-type-action" disabled={loading||['unavailable','range-unsupported','empty'].includes(item.capability)} aria-label={t(item.capability==='permission-required'?'privacy.openPermissionsFor':'privacy.viewDetails',{name:title,source:name,profile:profile==='Default'?t('privacy.defaultProfile'):profile})} onClick={()=>openPreview(item)}><Icon size={17}/><span className="privacy-type-copy"><strong>{title}</strong>{status?<small className="privacy-capability-label">{status}</small>:risk(item)&&<small className={`privacy-risk risk-${item.risk}`}>{risk(item)}</small>}</span><span className="privacy-record-stat"><b>{item.count===null?'—':`${item.limited?'≥ ':''}${item.count.toLocaleString(locale)}`}</b>{item.size>0&&<small>{bytes(item.size)}</small>}</span>{item.capability==='permission-required'?<LockKeyhole size={14}/>:item.capability==='ready'?<ChevronRight size={14}/>:<span className="privacy-chevron-spacer"/>}</button>
              <AiActionButton request={{key:`privacy:${item.id}`,title,prompt:t('privacy.aiPrompt',{name:title,source:name,count:item.count??t('file.unknown'),risk:risk(item)||t('privacy.risk.low'),range:t(`privacy.range.${range}`)})}}/>
            </div>})}</div>)}</div>}
          </section>
        })}
        {!loading&&!visible.length&&<div className="privacy-category-empty"><Folder size={28}/><strong>{t('privacy.emptyCategory')}</strong><p>{t('privacy.emptyRange')}</p><button className="space-text-button" onClick={onRefresh}>{t('common.rescan')}</button></div>}
      </div>
    </section>
    <footer className="privacy-batch-actions" role="region" aria-label={t('selection.actions')} data-batch-actions><div className="privacy-batch-summary"><span>{t('common.selected',{count:chosen.length})}</span><strong>{t('privacy.traces',{count:count(chosen)})}</strong>{chosen.length>0&&<small>{t('privacy.sourceSize',{size:bytes(sourceBytes(chosen))})}</small>}</div><div className="privacy-batch-controls"><label><span>{t('privacy.selectionMode')}</span><select aria-label={t('privacy.selectionMode')} value={mode} disabled={loading} onChange={(event)=>chooseMode(event.target.value)}>{(['manual','recommended','all','none'] as const).map((value)=><option key={value} value={value}>{t(`privacy.selection.${value}`)}</option>)}</select></label>{chosen.length>0&&<button className="space-text-button privacy-clear" disabled={loading} onClick={()=>{setMode('manual');onClear()}}>{t('selection.clear')}</button>}<button className="space-button primary" disabled={loading||!chosen.length} onClick={onReview}><ShieldCheck size={16}/>{t('privacy.reviewSelection')}</button></div></footer></>}
    {details&&<WorkspaceDialog title={kindName(details.item)} className="privacy-preview-dialog" dismiss={closeDetails}><div className="privacy-preview-summary"><SourceLogo rule={details.item}/><div><strong>{details.item.source?.name||details.item.browser||t('privacy.system')}</strong><span>{details.item.profile==='Default'?t('privacy.defaultProfile'):details.item.profile||t(`privacy.category.${details.item.privacyCategory}`)} · {t(`privacy.range.${details.item.range}`)}</span></div><b>{t('privacy.traces',{count:details.total.toLocaleString(locale)})}</b></div><p className="privacy-preview-local"><LockKeyhole size={13}/>{t('privacy.previewLocal')}</p>
      <div className="privacy-preview-scroll" aria-busy={details.loading}>{details.records.map((record)=><div className="privacy-record-item" key={record.id}><div><strong>{details.item.kind==='clipboard'?t('privacy.clipboardSummary'):record.title}</strong>{[record.url,record.subtitle,record.path].filter((value,index,values)=>Boolean(value)&&value!==record.title&&values.indexOf(value)===index).map((value)=><span key={value}>{value}</span>)}</div><aside>{record.timestamp&&<time dateTime={record.timestamp}>{date(record.timestamp)}</time>}{record.count!==undefined&&<small>{t('privacy.recordCount',{count:record.count.toLocaleString(locale)})}</small>}</aside></div>)}
        {details.loading&&<div className="privacy-preview-loading" role="status"><LoaderCircle className="spinner" size={18}/>{t('privacy.previewLoading')}</div>}
        {!details.loading&&details.error&&<div className="privacy-preview-error"><InfoError/><p>{details.error}</p><div><button className="space-button" onClick={()=>void loadPreview(details.item,details.requestedOffset,details.records.length===0)}>{t('common.retry')}</button><button className="space-text-button" onClick={()=>{closeDetails();onRefresh()}}>{t('common.rescan')}</button></div></div>}
        {!details.loading&&!details.error&&!details.records.length&&<div className="privacy-preview-empty"><History size={25}/><p>{t('privacy.noPreviewRecords')}</p></div>}
      </div>
      <div className="privacy-preview-bottom"><span>{t('privacy.previewShown',{count:details.records.length.toLocaleString(locale)})}{details.limited&&` · ${t('privacy.previewLimited')}`}</span>{!details.error&&details.nextOffset!==null&&<button className="space-text-button" disabled={details.loading} onClick={()=>void loadPreview(details.item,details.nextOffset!,false)}>{t('common.more')}<ChevronDown size={14}/></button>}</div><footer><button className="space-button" onClick={closeDetails}><X size={15}/>{t('common.close')}</button></footer>
    </WorkspaceDialog>}
  </section>
}
function InfoError():React.JSX.Element{return <ShieldCheck size={24}/>}
