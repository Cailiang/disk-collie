import {StartupIgnoreStore} from './startup-ignore-store'
import {app,ipcMain,shell} from 'electron'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {z} from 'zod'
import type {StartupAction,StartupCatalog,StartupChange,StartupChangeResult,StartupItem,StartupOutcome} from '../shared/startup-types'
import type {AppLanguage} from '../shared/app-settings'
import {translate} from '../shared/localization'
import type {AgentStore} from './agent/agent-store'
import {readApplicationIcon} from './application-icon'
import {baseItem,command,errorKey,type StartupAdapter,type StartupRecord} from './startup/common'
import {macStartup} from './startup/macos'
import {linuxStartup} from './startup/linux'
import {windowsStartup} from './startup/windows'

export class StartupService {
  private readonly ignoreStore:StartupIgnoreStore
  private records=new Map<string,StartupRecord>()
  private ids=new Map<string,string>()
  private catalog:StartupCatalog|null=null
  private snapshots=new Map<string,Map<string,StartupRecord>>()
  private readBackKeys=new Set<string>()
  private tail:Promise<unknown>=Promise.resolve()
  private readonly adapter:StartupAdapter
  constructor(private readonly options:{profile:string;language:()=>AppLanguage;ledger?:AgentStore;adapter?:StartupAdapter}){
    this.ignoreStore=new StartupIgnoreStore(path.join(options.profile,'startup-ignored.json'))
    const fixture=process.env.DISKCOLLIE_TEST_RUN==='1'?process.env.DISKCOLLIE_TEST_STARTUP_ROOT:undefined
    const self=typeof app.getPath==='function'?app.getPath('exe'):''
    const settings={self:process.platform==='darwin'?/^(.+?\.app)(?:\/|$)/.exec(self)?.[1]:self,home:os.homedir(),profile:options.profile,trash:(file:string)=>shell.trashItem(file),fixture,language:options.language}
    this.adapter=options.adapter||(process.platform==='darwin'?macStartup(settings):process.platform==='win32'?windowsStartup(settings):linuxStartup(settings))
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.then(work);this.tail=next.catch(()=>undefined);return next}
  private message(key:string):string{return translate(this.options.language(),key)}
  private async discover(changedRecords?:StartupRecord[]):Promise<StartupCatalog>{
    const started=Date.now(),targeted=Boolean(changedRecords?.length&&changedRecords.every(record=>record.readBack)&&this.catalog),keys=new Set(changedRecords?.map(record=>record.key))
    this.readBackKeys.clear()
    const refreshed:StartupRecord[]=[]
    if(targeted){for(const record of changedRecords!){const next=await record.readBack!();if(next){if(next.key!==record.key)throw new Error('startup.verificationFailed');refreshed.push(next)}}this.readBackKeys=new Set(keys)}
    const result=targeted?{records:refreshed,coverage:this.catalog!.coverage}:await this.adapter.scan()
    const records=targeted?new Map(this.records):new Map<string,StartupRecord>()
    if(targeted)for(const [id,record] of records)if(keys.has(record.key)&&!refreshed.some(next=>next.key===record.key))records.delete(id)
    for(const record of result.records){
      if(targeted&&!keys.has(record.key))continue
      let id=this.ids.get(record.key);if(!id){id=randomUUID();this.ids.set(record.key,id)}
      record.item=baseItem({...record.item,id});records.set(id,record)
    }
    const coverage=targeted?result.coverage.map(source=>({...source,count:source.count+[...records.values()].filter(record=>record.item.kind===source.source).length-[...this.records.values()].filter(record=>record.item.kind===source.source).length})):result.coverage
    this.records=records
    return this.publish(coverage,Date.now()-started)
  }
  private async publish(coverage:StartupCatalog['coverage'],elapsedMs:number):Promise<StartupCatalog> {
    const ignored=await this.ignoreStore.list(),keys=new Set(ignored.map(item=>item.key))
    this.catalog={id:randomUUID(),scannedAt:new Date().toISOString(),elapsedMs,items:[...this.records.values()].filter(record=>!keys.has(record.key)).map(record=>record.item),coverage,ignored:ignored.map(({key,...item})=>{const current=[...this.records.values()].find(record=>record.key===key);return current?{...item,name:current.item.owner||current.item.name,configuration:current.item.configuration}:item})}
    this.snapshots.set(this.catalog.id,new Map(this.records))
    while(this.snapshots.size>8)this.snapshots.delete(this.snapshots.keys().next().value!)
    return this.catalog
  }
  ignore(input:{catalogId:string;ids:string[]}):Promise<StartupCatalog>{return this.serial(async()=>{
    const snapshot=this.snapshots.get(input.catalogId)
    if(!snapshot)throw new Error('startup.expired')
    const records=[...new Set(input.ids)].map(id=>{const record=snapshot.get(id);if(!record)throw new Error('startup.expired');return record})
    if(!records.length||records.length>100)throw new Error('startup.selectionInvalid')
    const entries=await this.ignoreStore.list(),keys=new Set(entries.map(item=>item.key))
    for(const record of records)if(!keys.has(record.key)){entries.push({id:randomUUID(),key:record.key,name:record.item.owner||record.item.name,configuration:record.item.configuration});keys.add(record.key)}
    await this.ignoreStore.save(entries)
    return this.publish(this.catalog?.coverage||[],this.catalog?.elapsedMs||0)
  }).catch(error=>{throw new Error(this.message(errorKey(error)))})}
  restoreIgnored(id:string):Promise<StartupCatalog>{return this.serial(async()=>{
    const entries=await this.ignoreStore.list()
    if(!entries.some(item=>item.id===id))throw new Error('startup.expired')
    await this.ignoreStore.save(entries.filter(item=>item.id!==id))
    return this.catalog?this.publish(this.catalog.coverage,this.catalog.elapsedMs):this.discover()
  }).catch(error=>{throw new Error(this.message(errorKey(error)))})}

  scan():Promise<StartupCatalog>{return this.serial(()=>this.discover()).catch(error=>{throw new Error(this.message(errorKey(error)))})}
  change(input:StartupChange):Promise<StartupChangeResult>{return this.serial(async()=>{
    const snapshot=this.snapshots.get(input.catalogId)
    if(!snapshot)throw new Error(this.message('startup.expired'))
    const ignoredKeys=new Set((await this.ignoreStore.list()).map(item=>item.key))
    const ids=[...new Set(input.ids)],records=ids.map(id=>{const record=snapshot.get(id);if(!record)throw new Error(this.message('startup.expired'));return record})
    if(!records.length||records.length>100)throw new Error(this.message('startup.selectionInvalid'))
    for(const record of records){
      if(ignoredKeys.has(record.key))throw new Error(this.message('startup.ignoredSelection'))
      if(input.action==='remove'?!record.item.canRemove:!record.item.canToggle)throw new Error(this.message('startup.readonly'))
      try{if(await record.validate()!==record.signature)throw new Error('startup.changed')}catch(error){throw new Error(this.message(errorKey(error)))}
    }
    const title=this.message('startup.title')+' · '+this.message('startup.action.'+input.action)
    const run=this.options.ledger?.createMaintenanceRun({source:'direct',scanId:input.catalogId,title,operations:records.map(record=>({operationId:record.item.id,kind:'startup-'+input.action,title:record.item.name,reversible:input.action!=='remove'}))})
    const outcomes=new Map<string,StartupOutcome>()
    const outcome=(record:StartupRecord,problem:unknown|null,changed=true):void=>{outcomes.set(record.item.id,{id:record.item.id,name:record.item.name,ok:problem===null,changed:problem===null&&changed,message:problem===null?changed?'':this.message('startup.unchanged'):this.message(errorKey(problem))})}
    for(const record of records){
      if(outcomes.has(record.item.id))continue
      const desired=input.action==='enable'?'enabled':'disabled'
      if(input.action!=='remove'&&record.item.state===desired){outcome(record,null,false);continue}
      const group=record.batch?records.filter(candidate=>candidate.batch?.token===record.batch!.token&&!outcomes.has(candidate.item.id)&&(input.action==='remove'||candidate.item.state!==desired)):[record]
      try{
        for(const candidate of group)if(await candidate.validate()!==candidate.signature)throw new Error('startup.changed')
        if(record.batch){const applied=await record.batch.apply(group,input.action);for(const candidate of group){const result=applied.find(result=>result.key===candidate.key);outcome(candidate,result?result.error:new Error('startup.verificationFailed'))}}
        else{await record.change(input.action);outcome(record,null)}
      }catch(error){for(const candidate of group)outcome(candidate,error)}
    }
    const results=records.map(record=>outcomes.get(record.item.id)!)
    let catalog:StartupCatalog
    try{
      catalog=await this.discover(records)
      for(let n=0;n<records.length;n++)if(results[n].ok&&results[n].changed){
        const previous=records[n],next=[...this.records.values()].find(record=>record.key===previous.key)
        const sourceCoverage=catalog.coverage.filter(source=>source.source===previous.item.kind)
        const verified=input.action==='remove'?!next&&(this.readBackKeys.has(previous.key)||sourceCoverage.length>0&&sourceCoverage.every(source=>source.status==='complete')):next?.item.state===(input.action==='enable'?'enabled':'disabled')
        if(!verified){results[n].ok=false;results[n].changed=false;results[n].message=this.message('startup.verificationFailed')}
      }
    }catch{
      // Successful command delivery alone is never reported as a verified change.
      for(const result of results)if(result.changed){result.ok=false;result.changed=false;result.message=this.message('startup.verificationFailed')}
      this.catalog=null;catalog={id:randomUUID(),scannedAt:new Date().toISOString(),elapsedMs:0,items:[],coverage:[{source:process.platform==='darwin'?'agent':process.platform==='win32'?'registry':'desktop',status:'unavailable',message:'startup.verificationFailed',count:0}]}
    }
    if(run){for(const operation of run.operations){const result=results.find(result=>result.id===operation.operationId)!;this.options.ledger!.completeMaintenanceOperation(operation.id,{status:result.ok?'completed':'failed',message:result.message||title,errorCode:result.ok?null:'startup.changeFailed'})}this.options.ledger!.completeMaintenanceRun(run.id)}
    return {results,catalog}
  })}
  private item(id:string):StartupItem {const item=this.records.get(id)?.item;if(!item)throw new Error(this.message('startup.expired'));return item}
  async reveal(id:string):Promise<void>{const item=this.item(id),location=path.isAbsolute(item.configuration)?item.configuration:item.target;if(!location||!path.isAbsolute(location))throw new Error(this.message('startup.noLocation'));shell.showItemInFolder(location)}
  async icon(id:string):Promise<string|null>{const item=this.item(id);if(!item.icon)return null;try{return await readApplicationIcon(item.icon)}catch{return null}}
  async settings(section:'startup'|'privacy'|'automation'|'services'|'tasks'):Promise<void>{
    if(process.platform==='darwin')await shell.openExternal(section==='privacy'?'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles':section==='automation'?'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation':'x-apple.systempreferences:com.apple.LoginItems-Settings.extension')
    else if(process.platform==='win32'){
      if(section==='services'||section==='tasks'){const error=await shell.openPath(path.win32.join(process.env.SystemRoot||'C:\\Windows','System32',section==='services'?'services.msc':'taskschd.msc'));if(error)throw new Error(this.message('startup.settingsUnavailable'))}
      else await shell.openExternal('ms-settings:startupapps')
    }else{const directory=path.join(os.homedir(),'.config/autostart');await mkdir(directory,{recursive:true});const error=await shell.openPath(directory);if(error)throw new Error(this.message('startup.settingsUnavailable'))}
  }
  register():void{
    const id=z.string().uuid()
    ipcMain.handle('diskcollie:startup:scan',()=>this.scan())
    ipcMain.handle('diskcollie:startup:ignore',(_event,input)=>this.ignore(z.object({catalogId:id,ids:z.array(id).min(1).max(100)}).strict().parse(input)))
    ipcMain.handle('diskcollie:startup:restore-ignored',(_event,input)=>this.restoreIgnored(id.parse(input)))
    ipcMain.handle('diskcollie:startup:change',(_event,input)=>this.change(z.object({catalogId:id,ids:z.array(id).min(1).max(100),action:z.enum(['enable','disable','remove'])}).strict().parse(input)))
    ipcMain.handle('diskcollie:startup:reveal',(_event,input)=>this.reveal(id.parse(input)))
    ipcMain.handle('diskcollie:startup:icon',(_event,input)=>this.icon(id.parse(input)))
    ipcMain.handle('diskcollie:startup:settings',(_event,input)=>this.settings(z.enum(['startup','privacy','automation','services','tasks']).parse(input)))
  }
}
