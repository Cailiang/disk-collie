import {ArrowDown,ArrowRight,ArrowUp,ArrowUpRight,Battery,ChevronDown,Cpu,HardDrive,MemoryStick,Monitor,Wifi,Zap} from 'lucide-react'
import {useEffect,useState} from 'react'
import type {OverviewMetrics} from '../../shared/types'
import type {StorageActivity} from '../../shared/storage-types'
import {deviceHealth,healthGrade,usageSeverity} from '../../shared/device-health'
import {CleanupCharts} from './CleanupCharts'
import {useI18n} from './i18n'
import type {AgentViewKey} from './agent-ui/Shell'

function CpuChart({values,label}:{values:number[];label:string}):React.JSX.Element {
  const x=(i:number):number=>values.length<2?292:8+i/(values.length-1)*284
  const y=(value:number):number=>64-Math.max(0,Math.min(100,value))*.55
  const points=values.map((value,i)=>`${x(i)},${y(value)}`).join(' ')
  return <svg className="overview-cpu-chart" viewBox="0 0 300 72" role="img" aria-label={label}><line x1="8" x2="292" y1="64" y2="64"/>{values.length>1&&<><polygon points={`8,64 ${points} 292,64`}/><polyline points={points}/></>}{values.length>0&&<circle cx={x(values.length-1)} cy={y(values.at(-1)!)} r="3"/>}</svg>
}
export function HomeOverview({metrics,history,bytes,onProcess,onNavigate}:{metrics:OverviewMetrics|null;history:StorageActivity[];bytes:(n:number)=>string;onProcess:(sort:'cpuPercent'|'memoryBytes')=>void;onNavigate:(view:AgentViewKey)=>void}):React.JSX.Element {
  const {t,locale}=useI18n(),[samples,setSamples]=useState<Array<{date:string;cpu:number}>>([]),[details,setDetails]=useState(false)
  useEffect(()=>{if(metrics)setSamples((previous)=>[...previous.filter((sample)=>sample.date!==metrics.collectedAt),{date:metrics.collectedAt,cpu:metrics.cpu.usagePercent}].slice(-48))},[metrics?.collectedAt])
  const score=deviceHealth(metrics).score,grade=healthGrade(score)
  const percent=(value:number|null|undefined):string=>value===null||value===undefined?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(value)+'%'
  const cleaned=history.reduce((sum,record)=>sum+record.bytes,0),items=history.reduce((sum,record)=>sum+record.items,0)
  const diskPercent=metrics?.disk.totalBytes?Math.max(0,Math.min(100,(metrics.disk.totalBytes-metrics.disk.availableBytes)/metrics.disk.totalBytes*100)):0
  return <>
    <header className="space-heading overview-heading"><div><h1>{t('home.title')}</h1></div><span>{metrics?.hardware.model||'—'}</span></header>
    <div className="overview-top">
      <section className={`device-health score-${grade}`} aria-label={t('health.title')} data-health-grade={grade}>
        <h2>{t('health.title')}</h2><div className="overview-score"><svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="59"/><circle cx="70" cy="70" r="59" pathLength="100" strokeDasharray={`${score??0} 100`}/></svg><strong data-testid="health-score">{score??'—'}<small>{t('health.points')}</small></strong></div><span className="overview-score-label">{t(`health.status.${grade}`)}</span><button className="space-text-button" onClick={()=>onNavigate('large')}>{t('nav.large')}<ArrowRight size={13}/></button>
      </section>
      <section className="overview-device" aria-label={t('home.deviceStatus')}>
        <header><h2>{t('home.deviceStatus')}</h2><button className="space-text-button overview-details-toggle" aria-expanded={details} aria-controls="device-details" onClick={()=>setDetails(!details)}>{t('home.deviceDetails')}<ChevronDown size={14} className={details?'is-open':''}/></button></header>
        <div className="overview-metrics">
          <button className={`overview-metric metric-cpu usage-${usageSeverity(metrics?.cpu.usagePercent||0)}`} data-testid="home-cpu" data-tooltip={t('home.viewCpu')} onClick={()=>onProcess('cpuPercent')}><span className="overview-metric-label"><Cpu size={16}/>CPU<ArrowUpRight size={14}/></span><strong>{percent(metrics?.cpu.usagePercent)}</strong><CpuChart values={samples.map((sample)=>sample.cpu)} label={t('home.cpuChart')}/><small>{metrics?.hardware.cpuModel||'—'}</small></button>
          <button className={`overview-metric metric-memory usage-${usageSeverity(metrics?.memory.usedPercent||0)}`} data-testid="home-memory" data-tooltip={t('home.viewMemory')} onClick={()=>onProcess('memoryBytes')}><span className="overview-metric-label"><MemoryStick size={16}/>{t('process.memory')}<ArrowUpRight size={14}/></span><strong>{percent(metrics?.memory.usedPercent)}</strong><div className="overview-memory-chart" role="img" aria-label={t('home.memoryChart')}>{Array.from({length:24},(_,index)=><i key={index} className={metrics&&index/24*100<metrics.memory.usedPercent?'is-used':''}/>)}</div><small>{metrics?`${bytes(metrics.memory.usedBytes)} / ${bytes(metrics.memory.totalBytes)}`:'—'}</small></button>
          <button className={`overview-metric metric-storage usage-${diskPercent>90?'danger':diskPercent>80?'warning':'normal'}`} data-testid="home-storage" data-tooltip={t('home.findLarge')} onClick={()=>onNavigate('large')}><span className="overview-metric-label"><HardDrive size={16}/>{t('home.storage')}<ArrowUpRight size={14}/></span><div className="overview-storage-body"><div><strong>{metrics?bytes(metrics.disk.availableBytes):'—'}</strong><small>{t('home.available')}</small></div><svg className="overview-storage-chart" viewBox="0 0 100 100" role="img" aria-label={t('home.storageChart',{percent:percent(diskPercent)})}><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="38" pathLength="100" strokeDasharray={`${diskPercent} 100`}/><text x="50" y="55">{metrics?Math.round(diskPercent)+'%':'—'}</text></svg></div><small>{t('home.total')} {metrics?bytes(metrics.disk.totalBytes):'—'}</small></button>
        </div>
        {details&&<div className="overview-device-details" id="device-details"><div><span><Monitor size={15}/>GPU</span><strong>{metrics?.gpu.name||'—'}</strong><small>{percent(metrics?.gpu.usagePercent)}</small></div><div><span><Battery size={15}/>{t('home.power')}</span><strong>{metrics?.battery.available?percent(metrics.battery.percent):'—'}</strong><small>{metrics?.battery.available?`${t('health.dimension.battery')} ${percent(metrics.battery.healthPercent)} · ${t('home.cycles',{count:metrics.battery.cycleCount??'—'})}`:t('home.noBattery')}</small><small><Zap size={11}/>{t(`home.power.${metrics?.battery.powerSource||'unknown'}`)}</small></div><div><span><Wifi size={15}/>{t('home.network')}</span><strong>{metrics?.network.interfaceName||'—'}</strong><small><ArrowDown size={11}/>{metrics?bytes(metrics.network.receivedBytesPerSecond)+'/s':'—'}<ArrowUp size={11}/>{metrics?bytes(metrics.network.sentBytesPerSecond)+'/s':'—'}</small></div><footer>{metrics?`${metrics.hardware.architecture} · ${metrics.hardware.logicalCores} ${t('home.cores')} · ${metrics.osVersion}`:'—'}</footer></div>}
      </section>
    </div>
    <section className="overview-history" aria-label={t('home.value')}><header><h2>{t('home.value')}</h2></header><div className="overview-totals"><div><span>{t('home.achievement')}</span><strong data-testid="organized-total">{bytes(cleaned)}</strong></div><div><span>{t('home.cleanedItems')}</span><b>{items.toLocaleString(locale)}</b></div><div><span>{t('home.sessions')}</span><b>{history.filter((record)=>record.items>0).length}</b></div></div><CleanupCharts history={history} bytes={bytes}/></section>
  </>
}
