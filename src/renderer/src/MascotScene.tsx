import {useEffect,useState} from 'react'
import {useI18n} from './i18n'
import './MascotScene.css'
export type MascotActivity='ball'|'frisbee'|'tug'|'basketball'
const games:MascotActivity[]=['ball','frisbee','tug','basketball']
const sprites={ball:new URL('./assets/mascot/ball.png',import.meta.url).href,frisbee:new URL('./assets/mascot/frisbee.png',import.meta.url).href,tug:new URL('./assets/mascot/tug.png',import.meta.url).href,basketball:new URL('./assets/mascot/basketball.png',import.meta.url).href}
/** Four photographed poses per game; motion stays independent of real task progress. */
export function MascotScene({activity='ball'}:{activity?:MascotActivity}):React.JSX.Element {
  const {t}=useI18n(),[game,setGame]=useState(activity)
  useEffect(()=>setGame(activity),[activity])
  return <button type="button" className={`mascot-scene mascot-${game}`} data-mascot-activity={game} aria-label={t('mascot.changeGame')} data-tooltip={t('mascot.changeGame')} onClick={()=>setGame(games[(games.indexOf(game)+1)%games.length])}><span className="mascot-sprite" aria-hidden="true" style={{backgroundImage:`url(${sprites[game]})`}}/><span className="mascot-game-dot" aria-hidden="true"/></button>
}
