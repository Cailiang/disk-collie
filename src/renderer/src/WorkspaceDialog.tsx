import {useEffect,useId,useRef} from 'react'
export function WorkspaceDialog({title,dismiss,children,role='dialog',className=''}:{title:string;dismiss:()=>void;children:React.ReactNode;role?:'dialog'|'alertdialog';className?:string}):React.JSX.Element {
  const ref=useRef<HTMLDivElement>(null)
  const titleId=useId()
  const dismissRef=useRef(dismiss);dismissRef.current=dismiss
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const body=ref.current
    const focusable=():HTMLElement[]=>Array.from(body?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')||[])
    ;(focusable()[0]||body)?.focus()
    const key=(e:KeyboardEvent):void=>{
      const dialogs=document.querySelectorAll('[aria-modal="true"]')
      if(dialogs[dialogs.length-1]!==body)return
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dismissRef.current()}
      if(e.key==='Tab'){e.stopImmediatePropagation();const nodes=focusable();const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
    }
    document.addEventListener('keydown',key,true)
    return ()=>{document.removeEventListener('keydown',key,true);previous?.focus()}
  },[])
  return <div className={`space-dialog-backdrop ${className}`}><div className="space-dialog" role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}><h2 id={titleId}>{title}</h2>{children}</div></div>
}

