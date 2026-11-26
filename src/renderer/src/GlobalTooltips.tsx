import {useEffect,useState} from 'react'
import {createPortal} from 'react-dom'
/** Shared hover/focus feedback for icon actions, rendered outside clipped result tables. */
export function GlobalTooltips():React.JSX.Element|null {
  const [tooltip,setTooltip]=useState<{text:string;x:number;y:number;below:boolean}|null>(null)
  useEffect(()=>{
    let button:HTMLElement|null=null,timer:number|undefined
    const hide=():void=>{clearTimeout(timer);button=null;setTooltip(null)}
    const show=(target:EventTarget|null):void=>{
      const next=target instanceof Element?target.closest<HTMLElement>('button[data-tooltip],button[title],button[aria-label]'):null
      if(!next||next===button)return
      hide();button=next
      const text=next.dataset.tooltip||next.getAttribute('title')||next.getAttribute('aria-label')
      if(!text)return
      timer=window.setTimeout(()=>{const rect=next.getBoundingClientRect();setTooltip({text,x:Math.min(window.innerWidth-132,Math.max(132,rect.x+rect.width/2)),y:rect.top<55?rect.bottom+8:rect.top-8,below:rect.top<55})},180)
    }
    const enter=(e:Event):void=>show(e.target)
    const leave=(e:PointerEvent|FocusEvent):void=>{if(button&&!(e.relatedTarget instanceof Node&&button.contains(e.relatedTarget)))hide()}
    document.addEventListener('pointerover',enter);document.addEventListener('focusin',enter);document.addEventListener('pointerout',leave);document.addEventListener('focusout',leave);document.addEventListener('click',hide);document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide)
    return()=>{hide();document.removeEventListener('pointerover',enter);document.removeEventListener('focusin',enter);document.removeEventListener('pointerout',leave);document.removeEventListener('focusout',leave);document.removeEventListener('click',hide);document.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)}
  },[])
  return tooltip?createPortal(<div role="tooltip" className={`action-tooltip ${tooltip.below?'is-below':''}`} style={{left:tooltip.x,top:tooltip.y}}>{tooltip.text}</div>,document.body):null
}
