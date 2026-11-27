import {Pause,Play} from 'lucide-react'
import {useEffect,useId,useRef,useState} from 'react'
import mark from './assets/mascot/collie-mark.svg?raw'
import {useI18n} from './i18n'
import {advanceGame,createGame,gameAction,gameEnvironment,gameModes,GROUND,pauseGame,PLAYER_X,type GameMode,type GameObject,type GameState} from './scan-game'
import {GameScenery} from './GameScenery'
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
  const lift=running&&!reduced?Math.max(0,Math.cos(state.time*27))*7:0,tilt=reduced?0:state.y<0?Math.max(-8,Math.min(8,state.velocity/65)):0
  return <g className="scan-game-player" transform={`translate(${PLAYER_X} ${GROUND+state.y})`}>
    <g transform={`rotate(${reduced?0:Math.sin(state.time*9)*6} -30 -30)`}><path d="M-31-32q-24 8-35-15 13 10 22 6l-2 7 15-4" fill="var(--accent-soft)"/></g>
    <g opacity=".42"><path d={`M-22-23l${-gait} ${21-lift}h12M15-23l${gait} 21h12`}/></g>
    <ellipse cx="-7" cy="-29" rx="30" ry="17" fill="var(--surface)"/>
    <path d={`M-25-22l${gait} 21h12M17-23l${-gait} ${22-lift}h12`} fill="none"/>
    <g transform={`rotate(${tilt} 25 -52)`}><g transform="translate(58 -87) scale(-.6 .6)" dangerouslySetInnerHTML={{__html:mark}}/></g>
    {state.flash>0&&<g transform={`translate(58 ${-91-(.3-state.flash)*30})`} strokeWidth="2"><path d="M0-4v8m-4-4h8m5-13 3-3"/><text x="10" y="2" stroke="none" fill="currentColor" fontSize="14" fontWeight="600">+{state.lastReward}</text></g>}
  </g>
}
function ObjectDrawing({object,time,reduced}:{object:GameObject;time:number;reduced:boolean}):React.JSX.Element {
  const {width:w,height:h,variant}=object
  if(object.kind==='gap')return <g className="game-gap" data-variant={variant} data-x={object.x} data-width={w} data-group={object.group}>
    <rect x={object.x} y={GROUND-2} width={w} height="46" fill="var(--accent-soft)" stroke="none"/>
    <path d={`M${object.x} ${GROUND-1}v14m${w}-14v14`} strokeWidth="2"/>
    <path d={`M${object.x+7} 258q8-5 16 0t16 0t16 0M${object.x+Math.max(10,w-47)} 275q10-4 20 0`} opacity=".6" strokeWidth="1.6"/>
    {variant==='bridge'&&<g transform={`translate(${object.x} 244)`} strokeWidth="2"><path d={`M-23-2h23m${w} 0h23M-16-2v-16m${w+32} 16v-16m-7 16v-16M-25-17H0m${w} 0h25`}/><path d="M-3-3 5 3 1 10m-6-11-4 8"/></g>}
    {variant==='stones'&&<ellipse cx={object.x+w+18} cy={GROUND+3} rx="14" ry="5" fill="var(--surface)" strokeWidth="1.7"/>}
  </g>
  if(object.kind==='bone')return object.resolved?<></>:<g className="game-bone" transform={`translate(${object.x} ${object.y}) rotate(-24)`} strokeWidth="2.4"><path d="M-7-3q-7-7-9-1-6 1-1 6 1 7 8 1H8q7 6 9 0 5-6-1-7-3-7-9 1Z" fill="var(--accent-soft)"/></g>
  if(object.kind==='disc')return object.resolved?<></>:<g className="game-disc" data-variant={variant} data-x={object.x} data-y={object.y} data-base-y={object.baseY} data-born={object.born} data-motion={object.motion} transform={`translate(${object.x} ${object.y}) rotate(${reduced?0:Math.sin(time*7)*12})`}>
    <ellipse rx="20" ry="7" fill="var(--accent-soft)"/><path d="M-12 0q12-4 24 0" strokeWidth="1.6" opacity=".65"/>{variant==='loft'&&<path d="m-6-3 3 6 4-5" strokeWidth="1.4"/>}{variant==='wave'&&<path d="M-27 0h-8m5 5h-5" strokeWidth="1.8" opacity=".5"/>}
  </g>
  return <g className="game-obstacle" data-variant={variant} data-x={object.x} data-width={w} data-height={h} data-altitude={object.altitude} transform={`translate(${object.x} ${GROUND-object.altitude})`}>
    {variant==='stump'||variant==='double-log'||variant==='triple-log'?<>{[0,...(variant==='double-log'?[49]:variant==='triple-log'?[41,82]:[])].map(x=><g key={x} transform={`translate(${x} 0)`}><path d={`M0-3V${-h+5}Q17 ${-h-3} 34 ${-h+5}V-3Q17 3 0-3Z`} fill="var(--accent-soft)"/><ellipse cx="17" cy={-h+5} rx="17" ry="5"/><path d={`M8 ${-h+12}v10m12-8v10`} opacity=".55" strokeWidth="1.7"/></g>)}</>:variant==='rocks'?<><path d={`M0 0 4-16 19-${h}l18 7 12-3L${w} 0Z`} fill="var(--accent-soft)"/><path d="m19-25 7 13 12 1m-12-1-5 9" opacity=".5" strokeWidth="1.7"/></>:variant==='cones'?<>{[0,45].map(x=><g key={x} transform={`translate(${x} 0)`}><path d="M0 0 12-29h5L30 0Z" fill="var(--accent-soft)"/><path d="M6-9h18M9-17h12m-23 26h33" strokeWidth="2"/></g>)}</>:variant==='hedge'?<><path d={`M0-2v-29q-3-13 9-13 9-14 18-5 15-3 16 13V-2Z`} fill="var(--accent-soft)"/><path d="m8-16 7-8 6 8m10-12 5-7" opacity=".5" strokeWidth="2"/></>:variant==='hurdle'?<><path d={`M2 0V-${h}h22V0M2-${h-12}h22`} fill="var(--accent-soft)"/><path d="M-4 0H9m8 0h13"/></>:variant==='ball'?<g transform={`translate(${w/2} ${-h/2}) rotate(${reduced?0:time*240})`}><circle r={h/2} fill="var(--accent-soft)"/><path d={`M-${h/2} 0h${h}M0-${h/2}v${h}m-12-12q19 11 0 24`} strokeWidth="1.8"/></g>:<g transform={`translate(${w/2} ${-h/2})`}>
      <ellipse rx="16" ry="9" fill="var(--accent-soft)"/><path d={`M-5 0q-7 ${reduced?-13:Math.sin(time*16)*16-6}-19-9m29 7 13-3-5 7m-25 0-15 4`} fill="var(--surface)"/><circle cx="8" cy="-4" r="1.8" fill="currentColor" stroke="none"/>
    </g>}
  </g>
}
function previewObjects(mode:GameMode):GameObject[] {
  const base={id:-1,group:-1,x:500,width:mode==='pond'?99:32,height:32,y:139,baseY:139,altitude:0,motion:0,value:10,last:true,resolved:false,collected:false,born:0}
  return mode==='pond'?[{...base,kind:'gap',variant:'bridge'}]:mode==='frisbee'?[{...base,kind:'disc',variant:'loft'},{...base,id:-2,x:575,y:101,kind:'disc',variant:'pair'}]:[{...base,kind:'obstacle',variant:'stump'},{...base,id:-2,x:590,width:62,height:25,kind:'obstacle',variant:'rocks'}]
}
function Drawing({state,reduced,narrow}:{state:GameState;reduced:boolean;narrow:boolean}):React.JSX.Element {
  const objects=state.phase==='ready'?previewObjects(state.mode):state.objects,clip=useId().replace(/:/g,'_')
  return <svg className="scan-game-stage" viewBox={`0 0 ${narrow?600:800} 290`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <defs><clipPath id={clip}><rect width={narrow?600:800} height="290"/></clipPath></defs><g clipPath={`url(#${clip})`}><GameScenery state={state} reduced={reduced}/>
    <path d="M0 245H800V290H0Z" fill="var(--surface)" stroke="none"/>
    <g opacity=".22" strokeWidth="1.7">{[0,1,2,3].map(index=><path key={index} d={`M${(index*240-(reduced?0:state.distance%240)+800)%960-80} 263h22m15 0h6`}/>)}</g>
    {objects.map(object=><ObjectDrawing key={object.id} object={object} time={state.time} reduced={reduced}/>)}
    <Player state={state} reduced={reduced}/></g>
  </svg>
}
function freshSeed():number {return crypto.getRandomValues(new Uint32Array(1))[0]}

/** Opt-in, one-button games. Their clock and input never control the storage task. */
export function ScanGame({initialMode='runner'}:{initialMode?:GameMode}):React.JSX.Element {
  const {t}=useI18n(),id=useId(),root=useRef<HTMLElement>(null),field=useRef<HTMLDivElement>(null)
  const [frame,setFrame]=useState(()=>createGame(initialMode,freshSeed())),[best,setBest]=useState<Best>(readBest),[visible,setVisible]=useState(false),[reduced,setReduced]=useState(false),[narrow,setNarrow]=useState(false)
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
  const choose=(mode:GameMode):void=>{bestRef.current=saveBest(current.current,bestRef.current);setBest(bestRef.current);publish(createGame(mode,freshSeed()));field.current?.focus({preventScroll:true})}
  const environment=gameEnvironment(frame.distance)
  const hint=t(`game.${frame.phase==='running'?'jump':frame.phase==='paused'?'resume':frame.phase==='over'?'retry':'start'}`)
  return <section ref={root} className={`scan-game ${reduced?'is-motion-reduced':''}`} aria-label={t('game.label')} data-game-mode={frame.mode} data-game-phase={frame.phase} data-game-time={frame.time.toFixed(3)} data-game-y={frame.y.toFixed(1)} data-game-score={frame.score} data-game-distance={frame.distance.toFixed(1)} data-game-level={environment.level} data-game-region={environment.blend>.5?environment.next:environment.region} data-game-light={environment.light}>
    <header className="scan-game-header"><div className="scan-game-modes" role="group" aria-label={t('game.choose')}>{gameModes.map(mode=><button type="button" key={mode} className={frame.mode===mode?'is-active':''} aria-pressed={frame.mode===mode} onClick={()=>choose(mode)}>{t(`game.${mode}`)}</button>)}</div><div className="scan-game-stats"><span>{t('game.score')} <b>{String(frame.score).padStart(3,'0')}</b></span><span>{t('game.best')} <b>{String(Math.max(best[frame.mode]||0,frame.score)).padStart(3,'0')}</b></span><button type="button" className="icon-button game-pause" disabled={frame.phase==='ready'||frame.phase==='over'} aria-label={t(frame.phase==='paused'?'game.resumeButton':'game.pause')} data-tooltip={t(frame.phase==='paused'?'game.resumeButton':'game.pause')} onClick={()=>frame.phase==='paused'?act():pause()}>{frame.phase==='paused'?<Play size={14}/>:<Pause size={14}/>}</button></div></header>
    <div ref={field} className="scan-game-field" role="button" tabIndex={0} aria-label={t('game.control',{name:t(`game.${frame.mode}`)})} aria-describedby={`${id}-hint`} onClick={event=>{event.currentTarget.focus({preventScroll:true});act()}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();act()}}}>
      <Drawing state={frame} reduced={reduced} narrow={narrow}/><div className="game-route"><span>{t(`game.region.${environment.blend>.5?environment.next:environment.region}`)}</span><small>{t(`game.light.${environment.light}`)}</small><b>Lv.{environment.level}</b>{frame.mode==='frisbee'&&frame.combo>1&&<em>{t('game.combo',{count:frame.combo})}</em>}</div>
      {frame.phase!=='running'&&<div className="scan-game-overlay"><strong>{t(frame.phase==='over'?'game.over':frame.phase==='paused'?'game.paused':`game.${frame.mode}`)}</strong><span>{frame.phase==='ready'?t(`game.guide.${frame.mode}`):frame.phase==='over'?t('game.finalScore',{score:frame.score}):t('game.pauseHint')}</span></div>}
      {frame.mode==='frisbee'&&<span className="game-chances" aria-label={t('game.chances',{count:3-frame.missed})}>{[0,1,2].map(index=><i key={index} className={index<3-frame.missed?'':'is-lost'}/>)}</span>}
    </div>
    <footer className="scan-game-hint" id={`${id}-hint`}><kbd>{t('game.space')}</kbd><span>{hint}</span><small>{t('game.tap')}</small></footer>
    <span className="scan-game-sr" aria-live="polite">{frame.phase==='over'?t('game.finalScore',{score:frame.score}):t(`game.state.${frame.phase}`)}</span>
  </section>
}
