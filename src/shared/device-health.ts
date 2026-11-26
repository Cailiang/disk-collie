import type {OverviewMetrics} from './types'
export function usageSeverity(value:number):'normal'|'warning'|'danger' {return value>65?'danger':value>40?'warning':'normal'}
export type HealthDimensionKey='cpu'|'gpu'|'memory'|'storage'|'battery'
export interface HealthDimension {key:HealthDimensionKey;value:number|null;score:number|null;weight:number}
const measured=(value:number|null|undefined):number|null=>typeof value==='number'&&Number.isFinite(value)?Math.min(100,Math.max(0,value)):null
export function deviceHealth(metrics:OverviewMetrics|null):{score:number|null;dimensions:HealthDimension[];measured:number} {
  const values:[HealthDimensionKey,number|null|undefined,number][]=[['cpu',metrics?.cpu.usagePercent,20],['gpu',metrics?.gpu.usagePercent,15],['memory',metrics?.memory.usedPercent,25],['storage',metrics?.disk.totalBytes?100-metrics.disk.availableBytes/metrics.disk.totalBytes*100:null,25],['battery',metrics?.battery.available?metrics.battery.healthPercent:null,15]]
  const dimensions=values.map(([key,input,weight]):HealthDimension=>{
    const value=measured(input)
    let score=value===null?null:key==='battery'?value:key==='storage'?100-Math.max(0,value-75)*3:key==='memory'?100-Math.max(0,value-50)*1.5:100-Math.max(0,value-40)*1.4
    if(score!==null){if(key==='cpu'&&metrics?.thermal.state==='limited')score=Math.min(score,50);score=Math.max(0,Math.min(100,score))}
    return {key,value,score,weight}
  })
  const known=dimensions.filter((dimension)=>dimension.score!==null),weight=known.reduce((sum,dimension)=>sum+dimension.weight,0)
  return {score:weight?Math.round(known.reduce((sum,dimension)=>sum+dimension.score!*dimension.weight,0)/weight):null,dimensions,measured:known.length}
}
