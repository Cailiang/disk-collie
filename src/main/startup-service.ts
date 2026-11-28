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
import {command,errorKey,type StartupAdapter,type StartupRecord} from './startup/common'
import {macStartup} from './startup/macos'
import {linuxStartup} from './startup/linux'
import {windowsStartup} from './startup/windows'

export class StartupService {
  private records=new Map<string,StartupRecord>()
  private ids=new Map<string,string>()
  private catalog:StartupCatalog|null=null
  private tail:Promise<unknown>=Promise.resolve()
  private readonly adapter:StartupAdapter
  constructor(private readonly options:{profile:string;language:()=>AppLanguage;ledger?:AgentStore;adapter?:StartupAdapter}){
    const fixture=process.env.DISKCOLLIE_TEST_RUN==='1'?process.env.DISKCOLLIE_TEST_STARTUP_ROOT:undefined
    const self=typeof app.getPath==='function'?app.getPath('exe'):''
    const settings={self:process.platform==='darwin'?/^(.+?\.app)(?:\/|$)/.exec(self)?.[1]:self,home:os.homedir(),profile:options.profile,trash:(file:string)=>shell.trashItem(file),fixture}
    this.adapter=options.adapter||(process.platform==='darwin'?macStartup(settings):process.platform==='win32'?windowsStartup(settings):linuxStartup(settings))
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.then(work);this.tail=next.catch(()=>undefined);return next}
  private message(key:string):string{return translate(this.options.language(),key)}
  private async discover():Promise<StartupCatalog>{
    const started=Date.now(),result=await this.adapter.scan(),records=new Map<string,StartupRecord>()
    for(const record of result.records){
      let id=this.ids.get(record.key);if(!id){id=randomUUID();this.ids.set(record.key,id)}
      record.item={...record.item,id};records.set(id,record)
    }
    this.records=records
    this.catalog={id:randomUUID(),scannedAt:new Date().toISOString(),elapsedMs:Date.now()-started,items:[...records.values()].map(record=>record.item),coverage:result.coverage}
    return this.catalog
  }
  scan():Promise<StartupCatalog>{return this.serial(()=>this.discover()).catch(error=>{throw new Error(this.message(errorKey(error)))})}
  change(input:StartupChange):Promise<StartupChangeResult>{return this.serial(async()=>{
    if(!this.catalog||this.catalog.id!==input.catalogId||Date.now()-Date.parse(this.catalog.scannedAt)>15*60000)throw new Error(this.message('startup.expired'))
    const ids=[...new Set(input.ids)],records=ids.map(id=>{const record=this.records.get(id);if(!record)throw new Error(this.message('startup.expired'));return record})
    if(!records.length||records.length>100)throw new Error(this.message('startup.selectionInvalid'))
    for(const record of records){
      if(input.action==='remove'?!record.item.canRemove:!record.item.canToggle)throw new Error(this.message('startup.readonly'))
      try{if(await record.validate()!==record.signature)throw new Error('startup.changed')}catch(error){throw new Error(this.message(errorKey(error)))}
    }
    const title=this.message('startup.title')+' · '+this.message('startup.action.'+input.action)
    const run=this.options.ledger?.createMaintenanceRun({source:'direct',scanId:this.catalog.id,title,operations:records.map(record=>({operationId:record.item.id,kind:'startup-'+input.action,title:record.item.name,reversible:input.action!=='remove'}))})
    const results:StartupOutcome[]=[]
    for(const record of records){
      const id=record.item.id,desired=input.action==='enable'?'enabled':'disabled'
      if(input.action!=='remove'&&record.item.state===desired){results.push({id,name:record.item.name,ok:true,changed:false,message:this.message('startup.unchanged')});continue}
      try{
        if(await record.validate()!==record.signature)throw new Error('startup.changed')
        await record.change(input.action)
        results.push({id,name:record.item.name,ok:true,changed:true,message:''})
      }catch(error){results.push({id,name:record.item.name,ok:false,changed:false,message:this.message(errorKey(error))})}
    }
    let catalog:StartupCatalog
    try{
      catalog=await this.discover()
      for(let n=0;n<records.length;n++)if(results[n].ok&&results[n].changed){
        const previous=records[n],next=[...this.records.values()].find(record=>record.key===previous.key)
        const sourceCoverage=catalog.coverage.filter(source=>source.source===previous.item.kind)
        const verified=input.action==='remove'?!next&&sourceCoverage.length>0&&sourceCoverage.every(source=>source.status==='complete'):next?.item.state===(input.action==='enable'?'enabled':'disabled')
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
    ipcMain.handle('diskcollie:startup:change',(_event,input)=>this.change(z.object({catalogId:id,ids:z.array(id).min(1).max(100),action:z.enum(['enable','disable','remove'])}).strict().parse(input)))
    ipcMain.handle('diskcollie:startup:reveal',(_event,input)=>this.reveal(id.parse(input)))
    ipcMain.handle('diskcollie:startup:icon',(_event,input)=>this.icon(id.parse(input)))
    ipcMain.handle('diskcollie:startup:settings',(_event,input)=>this.settings(z.enum(['startup','privacy','automation','services','tasks']).parse(input)))
  }
}
