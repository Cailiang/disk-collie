import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
/** Measure the actual label so edge clamping never pulls it away from its action. */
export function GlobalTooltips():React.JSX.Element|null {
  const [anchor,setAnchor]=useState<{text:string;rect:DOMRect}|null>(null),[position,setPosition]=useState({left:0,top:0})
  const ref=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{
    if(!anchor||!ref.current)return
    const {width,height}=ref.current.getBoundingClientRect(),rect=anchor.rect
    setPosition({left:Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2)),top:rect.top-height-7>=8?rect.top-height-7:Math.min(innerHeight-height-8,rect.bottom+7)})
  },[anchor])
  useEffect(()=>{
    let button:HTMLElement|null=null,timer:number|undefined
    const hide=():void=>{clearTimeout(timer);button=null;setAnchor(null)}
    const show=(target:EventTarget|null):void=>{
      const next=target instanceof Element?target.closest<HTMLElement>('button[data-tooltip],button[title],button[aria-label]'):null
      if(!next||next===button)return
      hide();button=next
      const text=next.dataset.tooltip||next.getAttribute('title')||next.getAttribute('aria-label')
      if(text)timer=window.setTimeout(()=>setAnchor({text,rect:next.getBoundingClientRect()}),180)
    }
    const enter=(event:Event):void=>show(event.target)
    const leave=(event:PointerEvent|FocusEvent):void=>{if(button&&!(event.relatedTarget instanceof Node&&button.contains(event.relatedTarget)))hide()}
    document.addEventListener('pointerover',enter);document.addEventListener('focusin',enter);document.addEventListener('pointerout',leave);document.addEventListener('focusout',leave);document.addEventListener('click',hide);document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide)
    return()=>{hide();document.removeEventListener('pointerover',enter);document.removeEventListener('focusin',enter);document.removeEventListener('pointerout',leave);document.removeEventListener('focusout',leave);document.removeEventListener('click',hide);document.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)}
  },[])
  return anchor?createPortal(<div ref={ref} role="tooltip" className="action-tooltip" style={position}>{anchor.text}</div>,document.body):null
}
