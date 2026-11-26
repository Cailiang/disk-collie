import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { AppLanguage } from '../shared/app-settings'
import { translate } from '../shared/localization'
import type { ScanProgress } from '../shared/types'
import type { ScanBundle } from './scanner'
import { collectPortableOverview } from './portable-overview'
import type { StorageService } from './storage-service'

/** Portable deterministic evidence for the existing user-configured Agent. */
export async function runPortableScan(service:StorageService,language:AppLanguage,onProgress:(v:ScanProgress)=>void):Promise<ScanBundle> {
  const start=performance.now(),startedAt=new Date().toISOString()
  onProgress({section:'storage',progress:10,message:translate(language,'scan.indexing')})
  const metrics=await collectPortableOverview()
  const rules=await service.cleanup(false,false)
  onProgress({section:'applications',progress:75,message:translate(language,'apps.loading')})
  const applications=await service.listApplications(false)
  const actions:ScanBundle['actions']=new Map(),revealTargets=new Map<string,string>()
  const candidates=rules.map((rule)=>{
    const id=randomUUID();actions.set(id,{kind:'delete-storage',target:rule.path,storageRuleId:rule.id});revealTargets.set(id,rule.path)
    return {id,section:'storage' as const,name:translate(language,`rule.${rule.nameKey}`),subtitle:rule.path,description:translate(language,'cleanup.rebuild'),sizeBytes:rule.size,risk:'review' as const,status:translate(language,'common.review'),location:rule.path,evidence:[rule.path],confidence:'verified' as const,reasonCodes:['allowlisted-rebuildable-path'] as const,estimateQuality:'approximate' as const,cleanupCategory:rule.category==='developer'?'developer' as const:'applications' as const,action:{kind:'delete-storage' as const,label:translate(language,'common.clean'),consequence:translate(language,'cleanup.permanent'),reversible:false,estimatedBytes:rule.size}}
  })
  const result:ScanBundle['result']={scanId:randomUUID(),startedAt,completedAt:new Date().toISOString(),system:{hostname:metrics.hostname,osVersion:metrics.osVersion,diskTotalBytes:metrics.disk.totalBytes,diskFreeBytes:metrics.disk.freeBytes,memoryTotalBytes:metrics.memory.totalBytes,memoryUsedBytes:metrics.memory.usedBytes,uptimeSeconds:os.uptime()},candidates,applications:applications.map((a)=>({id:a.id,name:a.name,version:a.version,bundleId:a.bundleId,location:a.location,sizeBytes:a.size,lastUsedAt:null,scope:'shared',unused:false,protectedReason:translate(language,'apps.systemDescription')})),ignoredApplications:[],terminal:{shell:process.env.ComSpec||process.env.SHELL||'',baselineMs:null,startupMs:null,sampleCount:0,findings:[],configFiles:[]},timings:[{section:'total',durationMs:Math.round(performance.now()-start)}],diagnostics:[],warnings:[]}
  onProgress({section:'storage',progress:100,message:translate(language,'common.complete')})
  return {actions,revealTargets,terminalFixes:new Map(),result}
}
