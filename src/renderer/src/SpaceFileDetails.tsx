import {Check,File,Folder,FolderOpen,LoaderCircle,LockKeyhole,Settings2,Sparkles,Trash2,X} from 'lucide-react'
import {useEffect,useId,useRef} from 'react'
import type {StorageEntry} from '../../shared/storage-types'
import {useAiTasks} from './AiTasks'
import {useI18n} from './i18n'
import './SpaceFileDetails.css'

export interface SpaceFileDetailsProps {
  file:StorageEntry
  bytes:(n:number)=>string
  onReveal:()=>void
  onTrash:()=>void
  onClose:()=>void
}
/** The selected tile's actions remain next to its name, with no nested card. */
export function SpaceFileDetails({file,bytes,onReveal,onTrash,onClose}:SpaceFileDetailsProps):React.JSX.Element {
  const {t}=useI18n(),queue=useAiTasks(),titleId=useId(),ref=useRef<HTMLElement>(null)
  const name=file.name||file.path.split(/[/\\]/).pop()||file.path
  const request={key:`file:${file.path}:${file.modified||file.size}`,title:name,prompt:t('file.prompt',{path:JSON.stringify(file.path),size:file.size,modified:file.modified?new Date(file.modified/1e6).toISOString():t('file.unknown')})}
  const task=queue.find(request.key),busy=Boolean(task&&['queued','preparing','running'].includes(task.phase)),protectedFile=file.trashable===false||file.id===0
  const AskIcon=busy?LoaderCircle:task?.phase==='ready'?Check:task?.phase==='needs-provider'?Settings2:Sparkles
  useEffect(()=>{ref.current?.focus({preventScroll:true});ref.current?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})},[file.id,file.path])
  return <section className="space-file-details" ref={ref} tabIndex={-1} role="region" aria-label={t('disk.fileDetails')} onKeyDown={(event)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose()}}}>
    <div className="space-file-detail-copy">{file.directory?<Folder size={20}/>:<File size={20}/>}<div><div><h2 id={titleId}>{name}</h2><b>{bytes(file.size)}</b></div><code title={file.path}>{file.path}</code></div></div>
    <div className="space-file-detail-actions"><button className="space-button" aria-label={`${t('common.reveal')} ${name}`} onClick={onReveal}><FolderOpen size={15}/>{t('common.reveal')}</button><button className={`space-button ai-action ${task?'is-'+task.phase:''}`} data-ai-key={request.key} data-ai-state={task?.phase||'idle'} data-tooltip={t(task?`tasks.tip.${task.phase}`:'file.ask')} aria-label={`${t('file.ask')} ${name}`} aria-busy={busy} onClick={()=>queue.request(request)}><AskIcon size={15} className={busy?'spinner':undefined}/>{t(task?.phase==='ready'?'tasks.view':'file.ask')}</button><button className="space-button space-file-detail-trash" disabled={protectedFile} data-tooltip={t(protectedFile?'storage.readOnly':'common.trash')} aria-label={`${t('common.trash')} ${name}`} onClick={onTrash}><Trash2 size={15}/>{t('common.trash')}</button></div>
    <button className="icon-button space-file-detail-close" aria-label={t('disk.closeFileDetails')} onClick={onClose}><X size={15}/></button>
    {protectedFile&&<p className="space-file-detail-protected"><LockKeyhole size={13}/>{t('storage.readOnly')}</p>}
  </section>
}
