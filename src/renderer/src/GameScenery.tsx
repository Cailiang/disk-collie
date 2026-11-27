import {useId} from 'react'
import {gameEnvironment,GROUND,type GameRegion,type GameState} from './scan-game'

function Trees({pine=false}:{pine?:boolean}):React.JSX.Element {
  return <>{[65,270,480,760,1000,1150].map((x,index)=><g key={x} transform={`translate(${x} ${index%2?11:0}) scale(${index%3===0?.8:1})`}>
    {pine?<path d="M0 213V128m-27 59L0 134l28 53h-15l22 29h-70l22-29Z"/>:<><path d="M0 224v-42m0 22-14-12m14-1 13-11"/><path d="M-22 185q-15-18 4-29-2-26 20-25 23-3 23 22 22 11 7 29-8 19-27 10-19 11-27-7Z"/></>}
  </g>)}</>
}
function Panorama({region,near=false,time=0}:{region:GameRegion;near?:boolean;time?:number}):React.JSX.Element {
  if(!near)return <g fill="currentColor" stroke="none">
    {region==='meadow'?<path d="M0 214Q150 107 320 189T680 181T1020 196T1360 173V244H0Z"/>:region==='forest'?<path d="M0 218 140 115 250 184 390 88 555 195 725 126 890 207 1060 110 1210 210V244H0Z"/>:region==='river'?<><path d="M0 220 175 93 345 207 540 112 750 214 940 83 1120 206 1280 141V244H0Z"/><path d="m154 110 21-17 27 20-26-6Z" fill="var(--surface)"/></>:<path d="M0 220V195h60v-39h42v39h29v-18h66v33h74v-49h53v25h54v30h67v-66h30v-27h37v91h84v-32h60v24h51v-54h63v59h69v-33h51v37h84v-52h67v56h97v-28h90v-22h54v43h56v35H0Z"/>}
  </g>
  if(region==='forest')return <Trees pine/>
  if(region==='meadow')return <><Trees/>{[380,610,930].map(x=><g key={x} transform={`translate(${x} 224)`}><path d="M0 20V-3m25 23V-3m25 23V-3M0 3h50M0 12h50"/></g>)}</>
  if(region==='river')return <><path d="M0 217Q180 196 350 217T710 216T1080 210L1250 224V244H0Z" fill="var(--accent-soft)" stroke="none"/><path d="M90 228q75-9 160 0m220 0q75-7 140 0m260-2q80-8 140 0"/><g transform="translate(470 174)"><path d="M-82 54v-10Q0-12 82 44v10M-67 35v-18m34-3V-4m34 5v-18m34 31V-4m34 39V17M-82 17Q0-35 82 17"/></g>{[50,290,840,1120].map(x=><path key={x} d={`M${x} 242v-26m-6 26q-9-17-6-30m16 30q9-19 5-29`}/>)}</>
  return <>{[90,320,610,890,1110].map((x,index)=><g key={x} transform={`translate(${x} ${index%2?11:0})`}><path d="M-31 230v-47H31v47m-70-47 39-31 39 31M-6 230v-23H8v23m-29-35h9v9h-9Zm36 0h9v9h-9Z" fill="var(--surface)"/><path d="M18 166v-15h7v22"/></g>)}<g transform="translate(475 179)"><path d="m-13 58 7-58H6l8 58M-8 36H8"/><g transform={`rotate(${time*32})`}><path d="M0 0v-29h7v22L0 0h29v7H7L0 0v29h-7V7L0 0h-29v-7h22Z" fill="var(--accent-soft)"/></g></g></>
}
export function GameScenery({state,reduced}:{state:GameState;reduced:boolean}):React.JSX.Element {
  const id=useId().replace(/:/g,'_'),environment=gameEnvironment(state.distance),distance=reduced?0:state.distance
  const blend=reduced?0:environment.blend,night=environment.night
  const cloudsOffset=distance*.12%1100,farOffset=distance*.18%1200,nearOffset=distance*.43%1200
  return <g className="game-scenery" data-region={environment.region} data-light={environment.light}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--accent-soft)" stopOpacity={.28+night*.32}/><stop offset="1" stopColor="var(--surface)"/></linearGradient></defs>
    <rect width="800" height={GROUND} fill="var(--surface)" stroke="none"/>
    <rect width="800" height={GROUND} fill={`url(#${id})`} stroke="none"/>
    <rect width="800" height={GROUND} fill="currentColor" opacity={night*.13} stroke="none"/>
    <g opacity={.4*(1-night)} strokeWidth="1.6" transform={`translate(${590-distance*.008%120} 54)`}><circle r="14" fill="var(--accent-soft)"/>{[0,45,90,135,180,225,270,315].map(angle=><path key={angle} d="M0-21v-5" transform={`rotate(${angle})`}/>)}</g>
    <g opacity={night*.7} strokeWidth="1.5"><path d="M647 34a17 17 0 1 0 20 24 18 18 0 0 1-20-24Z" fill="var(--accent-soft)"/>{[75,172,289,389,478,560,720,765].map((x,index)=><g key={x} transform={`translate(${x} ${34+index%3*18})`}><path d="M-2 0h4m-2-2v4"/></g>)}</g>
    <g className="game-cloud-layer" opacity={.38-night*.2} strokeWidth="1.7" fill="var(--surface)">{[0,1].map(tile=><g key={tile} transform={`translate(${tile*1100-cloudsOffset} 0)`}>{[60,370,710,990].map((x,index)=><path key={x} transform={`translate(${x} ${67+index%2*34}) scale(${index%2?.8:1})`} d="M0 10q-5-10 7-12 3-18 19-10 13-3 18 12 16-3 19 10Z"/>)}</g>)}</g>
    {[0,1].map(layer=><g key={layer} opacity={layer?.33:.14} strokeWidth={layer?1.8:0}>
      {[{region:environment.region,alpha:1-blend},{region:environment.next,alpha:blend}].filter(item=>item.alpha>0).map(item=><g key={item.region} opacity={item.alpha} data-panorama={item.region}>{[0,1].map(tile=><g key={tile} transform={`translate(${tile*1200-(layer?nearOffset:farOffset)} 0)`}><Panorama region={item.region} near={Boolean(layer)} time={reduced?0:state.time}/></g>)}</g>)}
    </g>)}
    <g opacity=".29" strokeWidth="1.6">{[0,1,2,3,4,5].map(index=>{const x=(index*195-distance*.9%1170+1170)%1170-85;return <g key={index} transform={`translate(${x} 242)`}><path d={index%2?'M0 0q-5-7-7-5m7 5q3-9 7-8':'M0 0v-11m-4 3 8-2m-7-3 5 4'}/>{index%2===0&&<circle cy="-13" r="2" fill="currentColor" stroke="none"/>}</g>})}</g>
    <path d="M0 244H800" strokeWidth="2" opacity=".4"/>
  </g>
}
