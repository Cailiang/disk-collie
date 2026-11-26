import {Pause,Play,SkipForward} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {useI18n} from './i18n'
import {COLLIE_STORY_DURATION,nextCollieActivity,sampleCollieStory,type ColliePose,type MascotActivity} from './collie-story'
import './MascotScene.css'
export type {MascotActivity} from './collie-story'

function Collie({pose,time}:{pose:ColliePose;time:number}):React.JSX.Element {
  const gait=Math.sin(time/83)*28*pose.run,tail=pose.tail+Math.sin(time/145)*(pose.joy?24:11)
  const blink=time%4700>4480?.12:1
  return <g className="collie-puppet" transform={`translate(${pose.x} ${pose.y}) rotate(${pose.tilt})`}>
    <g transform={`rotate(${tail} -51 -55)`}><path d="M-52-50C-83-41-111-63-102-88q13 13 24 10l-5 10q20-1 31 10" fill="var(--accent-soft)"/></g>
    <g opacity=".38"><path d="M-32-38-21-12q6 5 3 12h-17" transform={`rotate(${-gait+pose.back} -32 -38)`}/><path d="m24-37 11 29q9 2 6 8H24" transform={`rotate(${gait+pose.front*.7} 24 -37)`}/></g>
    <path d="M-52-52c-9-22 15-33 43-26q23 0 40 14l9 9-6 8 10 6-10 6q-12 13-37 9-33 2-49-26Z" fill="var(--surface)"/>
    <path d="m24-65 8 10-4 8 10 7-8 5" opacity=".6"/>
    <path d="M-43-39-49-11q-8 3-7 11h24q4-3-1-7l10-29" fill="var(--surface)" transform={`rotate(${gait+pose.back} -38 -37)`}/>
    <path d="m28-36 5 29q-4 2-4 7h25q1-5-6-8L48-34" fill="var(--surface)" transform={`rotate(${-gait+pose.front} 35 -37)`}/>
    <g transform={`translate(49 ${-76+pose.bow}) rotate(${pose.head})`}>
      <path d="M-27-11q-10-23-3-41 12 2 20 16 14-6 29 1l14-12q12 6 9 24L32-16q12 9 14 22 1 15-21 20-20 4-35-10l-10 1 3-9-9-3 7-8Z" fill="var(--surface)"/>
      <path d="m-25-42 11 13m47-8-4 13M4-31q-5 8-2 16m14-16q7 9 5 17"/>
      <path d="m-29-40 7 16 8-5M30-25l9 2-2-9" fill="var(--accent-soft)" strokeWidth="2.5"/>
      <g transform={`translate(0 -4) scale(1 ${blink})`} stroke="none" fill="currentColor"><ellipse cx={5+pose.look*.15} cy="0" rx="3" ry="3.8"/><ellipse cx={25+pose.look*.1} cy="1" rx="3" ry="3.8"/></g>
      <path d="m33 5 7 2-4 5-5-4Z" fill="currentColor" strokeWidth="2"/>
      <path d="M36 12q-3 10-13 4m-2-3q1 13 9 11 5-2 5-8" fill="var(--accent-soft)" strokeWidth="2.5"/>
      <path d="m-8 5 4 1m-4 5 3 1" opacity=".4" strokeWidth="2"/>
    </g>
    {pose.joy>.4&&<g className="collie-delight" opacity={pose.joy} strokeWidth="2.5"><path d="m-13-113 2-7m26 8 5-6m-43 17-6-3"/></g>}
  </g>
}
function StoryDrawing({activity,elapsed,round}:{activity:MascotActivity;elapsed:number;round:number}):React.JSX.Element {
  const pose=sampleCollieStory(activity,elapsed)
  const mouth={x:pose.x+87,y:pose.y-59+pose.bow}
  return <svg className="collie-stage" viewBox="60 0 620 300" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g transform={round%8>=4?'translate(720 0) scale(-1 1)':undefined}>
      <g className="collie-scenery" strokeWidth="1.8" opacity=".16"><path d="M76 246h568M111 246l-3-6m9 6 3-6m427 6 4-5m5 5 3-6M151 108v9m-4-4h8M537 61v8m-4-4h8"/><circle cx="616" cy="202" r="2"/></g>
      <ellipse cx={pose.x-8} cy="245" rx={51+(240-pose.y)*.15} ry="4" fill="currentColor" opacity=".05" stroke="none"/>
      <g opacity={pose.hoopOpacity} strokeWidth="2.6"><path d="M624 245V105h-24v35m9-35v29h28v-29M607 245h34"/><ellipse cx="590" cy="147" rx="26" ry="6"/><path d="m567 149 7 24q15 8 32 0l7-24m-36 4 4 21m12-20v23m11-24-4 22"/></g>
      {activity==='tug'&&<g strokeWidth="3" opacity={pose.ropeOpacity}><path d="M560 244v-47q10-7 20 0v47m-23-43h24" opacity=".3" transform={`rotate(${pose.ropeLoose>.5?0:(560-pose.ropeEndX)*.6} 570 245)`}/><path d={`M${mouth.x} ${mouth.y} Q${(mouth.x+pose.ropeEndX)/2} ${Math.max(mouth.y,pose.ropeEndY)+pose.ropeSlack} ${pose.ropeEndX} ${pose.ropeEndY}`} strokeWidth="5"/><path d={`M${mouth.x+3} ${mouth.y-5} Q${(mouth.x+pose.ropeEndX)/2} ${Math.max(mouth.y,pose.ropeEndY)+pose.ropeSlack-5} ${pose.ropeEndX} ${pose.ropeEndY-5}`} opacity=".4" strokeWidth="2"/><circle cx={pose.ropeEndX} cy={pose.ropeEndY} r="7" fill="var(--surface)"/></g>}
      <Collie pose={pose} time={elapsed}/>
      <g opacity={pose.ballOpacity} transform={`translate(${pose.ballX} ${pose.ballY}) rotate(${pose.ballAngle}) scale(${pose.ballScale})`}><circle r="17" fill="var(--accent-soft)"/><path d="M-11-13q14 12 0 26M11-13q-14 12 0 26" strokeWidth="2"/>{activity==='basketball'&&<path d="M-17 0h34M0-17v34" strokeWidth="2"/>}</g>
      <g opacity={pose.discOpacity} transform={`translate(${pose.discX} ${pose.discY}) rotate(${pose.discAngle})`}><ellipse rx="27" ry="7" fill="var(--accent-soft)"/><path d="M-18 0q18-5 36 0" opacity=".45" strokeWidth="2"/></g>
      {pose.run>.3&&<g opacity={pose.run*.4} strokeWidth="2"><path d={`M${pose.x-88} ${pose.y-31}h-13m16 10h-8`}/></g>}
    </g>
  </svg>
}

/** A visible, pausable twenty-second story; the next story starts automatically. */
export function MascotScene({activity='ball',compact=false}:{activity?:MascotActivity;compact?:boolean}):React.JSX.Element {
  const {t}=useI18n(),root=useRef<HTMLElement>(null)
  const [frame,setFrame]=useState({activity,elapsed:0,round:0}),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false),[visible,setVisible]=useState(false)
  const clock=useRef({activity,elapsed:0,round:0})
  useEffect(()=>{clock.current={activity,elapsed:0,round:0};setFrame({...clock.current})},[activity])
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)'),receive=():void=>setReduced(media.matches)
    receive();media.addEventListener('change',receive)
    return()=>media.removeEventListener('change',receive)
  },[])
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting))
    if(root.current)observer.observe(root.current)
    return()=>observer.disconnect()
  },[])
  useEffect(()=>{
    if(paused||reduced||!visible)return
    let request=0,previous:number|undefined,published=0
    const tick=(now:number):void=>{
      if(document.hidden){previous=undefined;request=requestAnimationFrame(tick);return}
      if(previous!==undefined)clock.current.elapsed+=now-previous
      previous=now
      while(clock.current.elapsed>=COLLIE_STORY_DURATION){clock.current.elapsed-=COLLIE_STORY_DURATION;clock.current.activity=nextCollieActivity(clock.current.activity);clock.current.round++}
      if(now-published>=1000/30){setFrame({...clock.current});published=now}
      request=requestAnimationFrame(tick)
    }
    request=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(request)
  },[paused,reduced,visible])
  const next=():void=>{clock.current={activity:nextCollieActivity(clock.current.activity),elapsed:0,round:clock.current.round+1};setFrame({...clock.current})}
  const elapsed=reduced?18_300:frame.elapsed,pose=sampleCollieStory(frame.activity,elapsed)
  return <section ref={root} className={`mascot-scene ${compact?'is-compact':''} ${reduced?'is-motion-reduced':''}`} data-mascot-activity={frame.activity} data-story-phase={pose.phase} data-story-elapsed={Math.floor(elapsed)} data-story-cycle={frame.round} data-story-paused={paused||reduced} aria-label={t('mascot.theater')}>
    <StoryDrawing activity={frame.activity} elapsed={elapsed} round={frame.round}/>
    <div className="mascot-story-controls"><button type="button" className="icon-button mascot-pause" disabled={reduced} aria-label={t(paused?'mascot.play':'mascot.pause')} data-tooltip={t(reduced?'mascot.reduced':paused?'mascot.play':'mascot.pause')} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={14}/>:<Pause size={14}/>}</button><button type="button" className="icon-button mascot-next" aria-label={t('mascot.changeGame')} data-tooltip={t('mascot.changeGame')} onClick={next}><SkipForward size={15}/></button></div>
  </section>
}
