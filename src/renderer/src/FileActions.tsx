import {FolderOpen,Info,ListX,LoaderCircle,MoreHorizontal,Trash2} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {StorageProperties,StorageTarget} from '../../shared/storage-types'
import {AiActionButton,readableTaskError,type AiRequest} from './AiTasks'
import {WorkspaceDialog} from './WorkspaceDialog'
import {useI18n} from './i18n'
import {useMessages} from './Messages'

export interface FileActionItem {path:string;size:number;name?:string;modified?:number;directory?:boolean;trashable?:boolean;applicationData?:boolean}
export function FileActions({file,target,onReveal,onTrash,onIgnore,aiRequest}:{file:FileActionItem;target:StorageTarget;onReveal:(target:StorageTarget)=>Promise<void>;onTrash?:()=>void;onIgnore:(target:StorageTarget,path:string)=>Promise<void>;aiRequest?:AiRequest}):React.JSX.Element {
  const {t,locale}=useI18n(),{show}=useMessages()
  const name=file.name||file.path.split(/[/\\]/).pop()||file.path
  const anchor=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
  const [position,setPosition]=useState<{left:number;top:number}|null>(null),[properties,setProperties]=useState<StorageProperties|null>(null),[busy,setBusy]=useState(false)
  useEffect(()=>{
    if(!position)return
    menu.current?.querySelector('button')?.focus()
    const close=():void=>setPosition(null)
    const outside=(event:PointerEvent):void=>{if(!menu.current?.contains(event.target as Node)&&!anchor.current?.contains(event.target as Node))close()}
    const keys=(event:KeyboardEvent):void=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();anchor.current?.focus()}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const buttons=Array.from(menu.current?.querySelectorAll('button')||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()
      }
      if(event.key==='Tab'){close();anchor.current?.focus()}
    }
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keys,true);window.addEventListener('resize',close);window.addEventListener('scroll',close,true)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys,true);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true)}
  },[position])
  const inspect=async():Promise<void>=>{
    setPosition(null);anchor.current?.focus();setBusy(true)
    try{
      setProperties(window.diskCollie?await window.diskCollie.storageProperties(target):{name,path:file.path,directory:Boolean(file.directory),size:file.size,allocated:null,createdAt:'2025-01-10T08:00:00.000Z',modifiedAt:file.modified?new Date(file.modified/1e6).toISOString():null,accessedAt:null,permissions:null})
    }catch(error){show({message:readableTaskError(error),tone:'error'})}finally{setBusy(false)}
  }
  const ignore=async():Promise<void>=>{
    setPosition(null);anchor.current?.focus();setBusy(true)
    try{await onIgnore(target,file.path);show({message:t('file.ignored'),tone:'success'})}catch(error){show({message:readableTaskError(error),tone:'error'})}finally{setBusy(false)}
  }
  const date=(value:string|null):string=>value?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(value)):t('file.unknown')
  const size=(value:number|null):string=>value===null?t('file.unknown'):t('file.bytes',{count:value.toLocaleString(locale)})
  return <span className="space-file-actions" onClick={(event)=>event.stopPropagation()}>
    <button className="icon-button" title={t('common.reveal')} aria-label={`${t('common.reveal')} ${name}`} onClick={()=>void onReveal(target)}><FolderOpen size={15}/></button>
    <AiActionButton request={aiRequest||{key:`file:${file.path}:${file.modified||file.size}`,title:name,prompt:t('file.prompt',{path:JSON.stringify(file.path),size:file.size,modified:file.modified?new Date(file.modified/1e6).toISOString():t('file.unknown')})}}/>
    <button ref={anchor} className="icon-button file-more" title={t('file.more')} aria-label={`${t('file.more')} ${name}`} aria-haspopup="menu" aria-expanded={Boolean(position)} disabled={busy} onClick={()=>{const rect=anchor.current!.getBoundingClientRect();setPosition(position?null:{left:Math.max(8,Math.min(innerWidth-228,rect.right-220)),top:Math.max(8,Math.min(innerHeight-100,rect.bottom+4))})}}>{busy?<LoaderCircle className="spinner" size={15}/>:<MoreHorizontal size={15}/>}</button>
    {onTrash&&<button className="icon-button file-trash" disabled={file.trashable===false} title={t(file.trashable===false?'storage.readOnly':file.applicationData?'disk.reviewApplicationData':'common.trash')} aria-label={`${t(file.trashable===false?'storage.readOnly':'common.trash')} ${name}`} onClick={onTrash}><Trash2 size={15}/></button>}
    {position&&createPortal(<div className="file-action-menu" role="menu" aria-label={`${t('file.more')} ${name}`} ref={menu} style={position}><button role="menuitem" onClick={()=>void ignore()}><ListX size={16}/>{t('file.ignore')}</button><button role="menuitem" onClick={()=>void inspect()}><Info size={16}/>{t('file.properties')}</button></div>,document.body)}
    {properties&&createPortal(<WorkspaceDialog title={t('file.properties')} className="file-properties-dialog" dismiss={()=>setProperties(null)}><dl className="file-properties">{[[t('common.name'),properties.name],[t('file.fullPath'),properties.path],[t('file.type'),t(properties.directory?'file.directory':'file.regular')],[t(properties.directory?'file.scannedSize':'common.size'),size(properties.size)],[t('file.allocated'),size(properties.allocated)],[t('file.created'),date(properties.createdAt)],[t('common.modified'),date(properties.modifiedAt)],[t('file.accessed'),date(properties.accessedAt)],...(properties.permissions?[[t('file.permissions'),properties.permissions]]:[])].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="space-dialog-actions"><button className="space-button" onClick={()=>setProperties(null)}>{t('common.close')}</button></div></WorkspaceDialog>,document.body)}
  </span>
}
