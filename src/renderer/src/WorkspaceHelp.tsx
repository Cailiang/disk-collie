import { CircleHelp, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from './i18n'

export function WorkspaceHelp({children}:{children:React.ReactNode}):React.JSX.Element {
  const {t}=useI18n(),id=useId(),ref=useRef<HTMLSpanElement>(null)
  const [open,setOpen]=useState(false)
  useEffect(()=>{
    if(!open)return
    const outside=(e:PointerEvent):void=>{if(!ref.current?.contains(e.target as Node))setOpen(false)}
    const escape=(e:KeyboardEvent):void=>{if(e.key==='Escape'){setOpen(false);ref.current?.querySelector('button')?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open])
  return <span className="workspace-help" ref={ref}><button type="button" className="icon-button" aria-label={t('compact.help')} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><CircleHelp size={16}/></button>{open&&<span id={id} role="note" className="workspace-help-content"><button type="button" className="icon-button" aria-label={t('common.close')} onClick={()=>setOpen(false)}><X size={14}/></button>{children}</span>}</span>
}
