import {useState} from 'react'
import type {StorageActivity} from '../../shared/storage-types'
import {useI18n} from './i18n'
import {activityTimeline} from './storage-activity'

export function CleanupCharts({history,bytes}:{history:StorageActivity[];bytes:(n:number)=>string}):React.JSX.Element {
  const {t,locale}=useI18n()
  const days=activityTimeline(history)
  const [highlight,setHighlight]=useState<number|null>(null)
  const selected=days[highlight??days.length-1]
  const cumulativeMax=Math.max(1,...days.map((d)=>d.cumulative)),dailyMax=Math.max(1,...days.map((d)=>d.bytes))
  const x=(i:number):number=>12+i/(days.length-1)*576
  const y=(n:number):number=>142-n/cumulativeMax*124
  const points=days.map((d,i)=>`${x(i)},${y(d.cumulative)}`).join(' ')
  const date=(d:Date):string=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric'}).format(d)
  return <section className="space-cleanup-charts" aria-label={t('charts.title')}>
    <div className="space-chart"><header><div><h2>{t('charts.cumulative')}</h2><span>{t('charts.period')}</span></div><strong>{bytes(selected.cumulative)}</strong></header>
      <svg className="space-line-chart" viewBox="0 0 600 160" role="img" aria-label={t('charts.lineLabel',{size:bytes(days.at(-1)!.cumulative)})}>
        {[18,80,142].map((line)=><line key={line} x1="12" y1={line} x2="588" y2={line} className="space-chart-grid"/>)}
        <polygon points={`12,142 ${points} 588,142`} className="space-chart-area"/>
        <polyline points={points} className="space-chart-line"/>
        <circle cx={x(highlight??days.length-1)} cy={y(selected.cumulative)} r="5" className="space-chart-point"/>
      </svg><div className="space-chart-axis"><span>{date(days[0].date)}</span><span>{date(days[Math.floor(days.length/2)].date)}</span><span>{date(days.at(-1)!.date)}</span></div>
    </div>
    <div className="space-chart"><header><div><h2>{t('charts.daily')}</h2><span>{date(selected.date)} · {t('charts.tasks',{count:selected.tasks})}</span></div><strong>{bytes(selected.bytes)}</strong></header>
      <div className="space-bar-chart" role="group" aria-label={t('charts.daily')} onMouseLeave={()=>setHighlight(null)}>{days.map((day,i)=><button key={day.key} className={i===(highlight??days.length-1)?'is-active':''} aria-label={t('charts.dayLabel',{date:date(day.date),size:bytes(day.bytes),count:day.tasks})} title={t('charts.dayLabel',{date:date(day.date),size:bytes(day.bytes),count:day.tasks})} onMouseEnter={()=>setHighlight(i)} onFocus={()=>setHighlight(i)} onClick={()=>setHighlight(i)}><i style={{height:`${day.bytes?Math.max(3,day.bytes/dailyMax*100):0}%`}}/></button>)}</div>
      <div className="space-chart-axis"><span>{date(days[0].date)}</span><span>{t('charts.today')}</span></div>
    </div><p className="space-chart-note">{t(history.some((r)=>r.items>0)?'charts.note':'charts.empty')}</p>
  </section>
}
