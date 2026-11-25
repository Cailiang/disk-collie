import os from 'node:os'
import type { OverviewMetrics, OverviewProcess } from '../shared/types'
import { NativeEngine } from './native-engine'

const engine=new NativeEngine()
export async function collectPortableOverview():Promise<OverviewMetrics> {
  const data=await engine.request<{hostname:string;osVersion:string;totalMemory:number;usedMemory:number;cpu:number;processes:OverviewProcess[];disks:Array<{mount:string;total:number;free:number}>}>('system')
  const disk=data.disks.find((d)=>os.homedir().toLowerCase().startsWith(d.mount.toLowerCase()))||data.disks[0]||{total:0,free:0}
  const memoryPercent=data.usedMemory/Math.max(1,data.totalMemory)*100
  const diskPercent=(disk.total-disk.free)/Math.max(1,disk.total)*100
  return {collectedAt:new Date().toISOString(),hostname:data.hostname||os.hostname(),osVersion:data.osVersion||os.release(),uptimeSeconds:os.uptime(),hardware:{model:os.platform(),cpuModel:os.cpus()[0]?.model||'',architecture:os.arch(),logicalCores:os.cpus().length},health:{score:Math.round(100-Math.max(data.cpu,memoryPercent,diskPercent)*.3),status:diskPercent>95?'attention':'good',issues:diskPercent>95?['disk-low']:[]},cpu:{usagePercent:data.cpu,loadAverage:os.loadavg() as [number,number,number]},gpu:{name:null,usagePercent:null},memory:{totalBytes:data.totalMemory,usedBytes:data.usedMemory,availableBytes:data.totalMemory-data.usedMemory,usedPercent:memoryPercent},disk:{totalBytes:disk.total,usedBytes:disk.total-disk.free,freeBytes:disk.free,availableBytes:disk.free,usedPercent:diskPercent},network:{interfaceName:null,receivedBytesPerSecond:0,sentBytesPerSecond:0},battery:{available:false,percent:null,status:'unknown',powerSource:'unknown',cycleCount:null,healthPercent:null},thermal:{state:'unknown',cpuSpeedLimitPercent:null,availableCpus:null},processes:data.processes,diagnostics:[]}
}
export async function terminatePortableProcess(pid:number,force:boolean):Promise<void> { await engine.request('terminate',{pid,force}) }
export function stopPortableOverview():void {engine.stop()}
