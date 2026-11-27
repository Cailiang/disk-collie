import {Pause,Play} from 'lucide-react'
import {useEffect,useId,useRef,useState} from 'react'
import mark from './assets/mascot/collie-mark.svg?raw'
import {useI18n} from './i18n'
import {advanceGame,createGame,gameAction,gameModes,GROUND,pauseGame,PLAYER_X,type GameMode,type GameState} from './scan-game'
import './ScanGame.css'

const bestKey='memento.scan-games.best.v1'
type Best=Partial<Record<GameMode,number>>
function readBest():Best {
  try{const value=JSON.parse(localStorage.getItem(bestKey)||'{}');return Object.fromEntries(gameModes.map(mode=>[mode,Number.isSafeInteger(value?.[mode])&&value[mode]>=0?value[mode]:0]))}catch{return {}}
}
function saveBest(state:GameState,best:Best):Best {
  const stored=readBest(),next=Object.fromEntries(gameModes.map(mode=>[mode,Math.max(best[mode]||0,stored[mode]||0,mode===state.mode?state.score:0)])) as Best
  if(gameModes.every(mode=>next[mode]===(best[mode]||0)))return best
  try{localStorage.setItem(bestKey,JSON.stringify(next))}catch{/* A disabled local store does not stop play. */}
  return next
}
function Player({state,reduced}:{state:GameState;reduced:boolean}):React.JSX.Element {
  const running=state.phase==='running'&&state.y===0,gait=running&&!reduced?Math.sin(state.time*27)*13:0
  return <g className="scan-game-player" transform={`translate(${PLAYER_X} ${GROUND+state.y})`}>
    <path d="M-31-32q-24 8-35-15 13 10 22 6l-2 7 15-4" fill="var(--accent-soft)"/>
    <g opacity=".42"><path d={`M-22-23l${-gait} 21h12M15-23l${gait} 21h12`}/></g>
    <ellipse cx="-7" cy="-29" rx="30" ry="17" fill="var(--surface)"/>
    <path d={`M-25-22l${gait} 21h12M17-23l${-gait} 22h12`} fill="none"/>
    <g transform="translate(58 -87) scale(-.6 .6)" dangerouslySetInnerHTML={{__html:mark}}/>
    {state.flash>0&&<g transform="translate(55 -85)" strokeWidth="2"><path d="M0-4v8m-4-4h8m5-13 3-3"/></g>}
  </g>
}
function Drawing({state,reduced,narrow}:{state:GameState;reduced:boolean;narrow:boolean}):React.JSX.Element {
  const objects=state.phase==='ready'?[{id:-1,kind:state.mode==='pond'?'gap' as const:state.mode==='frisbee'?'disc' as const:'log' as const,x:530,width:state.mode==='pond'?105:38,height:32,y:139,resolved:false}]:state.objects
  const offset=reduced?0:state.distance%240
  return <svg className="scan-game-stage" viewBox={`0 0 ${narrow?600:800} 290`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {!reduced&&<g opacity=".11" strokeWidth="2" transform={`translate(${-offset*.2} 0)`}><path d="M80 93q12-16 24 0h21m435-16q15-21 30 0h27M350 126q9-13 19 0h14"/></g>}
    <path d={`M25 ${GROUND}H775`} opacity=".24" strokeWidth="2"/>
    <g opacity=".18" strokeWidth="2">{[0,1,2,3].map(index=><path key={index} d={`M${(index*240-offset+800)%960-80} 256h22m15 0h6`}/>)}</g>
    {objects.map(object=>object.kind==='gap'?<g key={object.id} className="game-gap">
      <path d={`M${object.x} ${GROUND}h${object.width}`} stroke="var(--surface)" strokeWidth="8"/>
      <path d={`M${object.x} ${GROUND-1}v14m${object.width}-14v14`} strokeWidth="2"/>
      <path d={`M${object.x+10} 263q8-5 16 0t16 0t16 0t16 0`} opacity=".4" strokeWidth="2"/>
      <path d={`M${object.x+object.width/2-10} 276q10-4 20 0`} opacity=".2" strokeWidth="2"/>
    </g>:object.kind==='log'?<g key={object.id} className="game-log" transform={`translate(${object.x} ${GROUND})`}>
      <rect x="0" y={-object.height} width={object.width} height={object.height} rx="7" fill="var(--accent-soft)"/>
      <path d={`M9 ${-object.height+9}v${Math.max(3,object.height-18)}m10-9v9`} opacity=".55" strokeWidth="2"/>
    </g>:!object.resolved&&<g key={object.id} className="game-disc" transform={`translate(${object.x} ${object.y}) rotate(${reduced?0:Math.sin(state.time*7)*12})`}>
      <ellipse rx="20" ry="7" fill="var(--accent-soft)"/><path d="M-12 0q12-4 24 0" strokeWidth="1.6" opacity=".5"/>
    </g>)}
    <Player state={state} reduced={reduced}/>
  </svg>
}

/** Opt-in, one-button games. Their clock and input never control the storage task. */
export function ScanGame({initialMode='runner'}:{initialMode?:GameMode}):React.JSX.Element {
  const {t}=useI18n(),id=useId(),root=useRef<HTMLElement>(null),field=useRef<HTMLDivElement>(null)
  const [frame,setFrame]=useState(()=>createGame(initialMode)),[best,setBest]=useState<Best>(readBest),[visible,setVisible]=useState(false),[reduced,setReduced]=useState(false),[narrow,setNarrow]=useState(false)
  const current=useRef(frame),bestRef=useRef(best)
  const publish=(state:GameState):void=>{current.current=state;setFrame(state);const next=state.phase==='over'?saveBest(state,bestRef.current):bestRef.current;if(next!==bestRef.current){bestRef.current=next;setBest(next)}}
  const pause=():void=>publish(pauseGame(current.current))
  const act=():void=>publish(gameAction(current.current))
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)'),receive=():void=>setReduced(media.matches)
    receive();media.addEventListener('change',receive)
    return()=>media.removeEventListener('change',receive)
  },[])
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>{setVisible(entry.isIntersecting);if(!entry.isIntersecting)pause()})
    const resize=new ResizeObserver(([entry])=>{if(entry.contentRect.width>0)setNarrow(entry.contentRect.width<560)})
    if(root.current){observer.observe(root.current);resize.observe(root.current)}
    const stop=():void=>{if(document.hidden)pause()},blur=():void=>pause()
    document.addEventListener('visibilitychange',stop);window.addEventListener('blur',blur)
    return()=>{observer.disconnect();resize.disconnect();document.removeEventListener('visibilitychange',stop);window.removeEventListener('blur',blur);saveBest(current.current,bestRef.current)}
  },[])
  useEffect(()=>{
    if(!visible)return
    const active=document.activeElement
    if(active===document.body||active instanceof HTMLButtonElement&&active.disabled)field.current?.focus({preventScroll:true})
    const keydown=(event:KeyboardEvent):void=>{
      if(event.code!=='Space'||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||document.hidden||!root.current?.getClientRects().length)return
      const target=event.target instanceof HTMLElement?event.target:null
      if(target?.isContentEditable||target?.closest('input,textarea,select,a,button:not(:disabled),[role="textbox"]'))return
      if(Array.from(document.querySelectorAll('[aria-modal="true"]')).some(dialog=>dialog.getClientRects().length))return
      event.preventDefault();act()
    }
    window.addEventListener('keydown',keydown)
    return()=>window.removeEventListener('keydown',keydown)
  },[visible])
  useEffect(()=>{
    if(!visible||frame.phase!=='running')return
    let request=0,previous:number|undefined,published=0
    const tick=(now:number):void=>{
      if(document.hidden){pause();return}
      if(previous!==undefined)current.current=advanceGame(current.current,(now-previous)/1000)
      previous=now
      if(now-published>=1000/30||current.current.phase==='over'){publish(current.current);published=now}
      if(current.current.phase==='running')request=requestAnimationFrame(tick)
    }
    request=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(request)
  },[visible,frame.phase])
  const choose=(mode:GameMode):void=>{bestRef.current=saveBest(current.current,bestRef.current);setBest(bestRef.current);publish(createGame(mode));field.current?.focus({preventScroll:true})}
  const hint=t(`game.${frame.phase==='running'?'jump':frame.phase==='paused'?'resume':frame.phase==='over'?'retry':'start'}`)
  return <section ref={root} className={`scan-game ${reduced?'is-motion-reduced':''}`} aria-label={t('game.label')} data-game-mode={frame.mode} data-game-phase={frame.phase} data-game-time={frame.time.toFixed(3)} data-game-y={frame.y.toFixed(1)} data-game-score={frame.score}>
    <header className="scan-game-header"><div className="scan-game-modes" role="group" aria-label={t('game.choose')}>{gameModes.map(mode=><button type="button" key={mode} className={frame.mode===mode?'is-active':''} aria-pressed={frame.mode===mode} onClick={()=>choose(mode)}>{t(`game.${mode}`)}</button>)}</div><div className="scan-game-stats"><span>{t('game.score')} <b>{String(frame.score).padStart(3,'0')}</b></span><span>{t('game.best')} <b>{String(Math.max(best[frame.mode]||0,frame.score)).padStart(3,'0')}</b></span><button type="button" className="icon-button game-pause" disabled={frame.phase==='ready'||frame.phase==='over'} aria-label={t(frame.phase==='paused'?'game.resumeButton':'game.pause')} data-tooltip={t(frame.phase==='paused'?'game.resumeButton':'game.pause')} onClick={()=>frame.phase==='paused'?act():pause()}>{frame.phase==='paused'?<Play size={14}/>:<Pause size={14}/>}</button></div></header>
    <div ref={field} className="scan-game-field" role="button" tabIndex={0} aria-label={t('game.control',{name:t(`game.${frame.mode}`)})} aria-describedby={`${id}-hint`} onClick={event=>{event.currentTarget.focus({preventScroll:true});act()}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();act()}}}>
      <Drawing state={frame} reduced={reduced} narrow={narrow}/>
      {frame.phase!=='running'&&<div className="scan-game-overlay"><strong>{t(frame.phase==='over'?'game.over':frame.phase==='paused'?'game.paused':`game.${frame.mode}`)}</strong><span>{frame.phase==='ready'?t(`game.guide.${frame.mode}`):frame.phase==='over'?t('game.finalScore',{score:frame.score}):t('game.pauseHint')}</span></div>}
      {frame.mode==='frisbee'&&<span className="game-chances" aria-label={t('game.chances',{count:3-frame.missed})}>{[0,1,2].map(index=><i key={index} className={index<3-frame.missed?'':'is-lost'}/>)}</span>}
    </div>
    <footer className="scan-game-hint" id={`${id}-hint`}><kbd>{t('game.space')}</kbd><span>{hint}</span><small>{t('game.tap')}</small></footer>
    <span className="scan-game-sr" aria-live="polite">{frame.phase==='over'?t('game.finalScore',{score:frame.score}):t(`game.state.${frame.phase}`)}</span>
  </section>
}
