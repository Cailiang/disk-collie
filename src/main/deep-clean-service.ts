import {randomUUID} from 'node:crypto'
import type {DeepCleanItem,DeepCleanPreview,DeepCleanScan,DeepCleanSource} from '../shared/deep-clean-types'
import {privacyAccessFailure,type PrivacySource} from './privacy-resource'
import {assertDeepNotCancelled,type DeepCleanContext} from './deep-clean-context'
import {deepCleanDefinitions,type DeepCleanDefinition} from './deep-clean-rules'
import {deepFileSnapshot,type DeepCleanSnapshot} from './deep-clean-resource'

export interface RegisteredDeepCleanSource {item:DeepCleanItem;source:DeepCleanSource;snapshot:DeepCleanSnapshot;definition:DeepCleanDefinition}
export class DeepCleanService {
  private registered=new Map<string,RegisteredDeepCleanSource>()
  private items:DeepCleanItem[]=[]
  constructor(private readonly discover:(context:DeepCleanContext)=>Promise<DeepCleanDefinition[]>=deepCleanDefinitions){}
  has(id:string):boolean{return this.registered.has(id)}
  get(id:string):RegisteredDeepCleanSource{const value=this.registered.get(id);if(!value)throw new Error('deep.selectionExpired');return value}
  paths(id:string):string[]{const source=this.registered.get(id);return source?[source.source.path]:this.items.find((item)=>item.id===id)?.sources.map((source)=>source.path)||[]}
  owner(id:string):PrivacySource|undefined{return this.registered.get(id)?.definition.owner||this.items.find((item)=>item.id===id)?.owner}
  forget(id:string):void{this.registered.delete(id)}
  async scan(context:DeepCleanContext,running:(name:string)=>boolean=()=>false,progress?:(done:number,total:number,path:string)=>void):Promise<DeepCleanScan>{
    const started=Date.now(),definitions=await this.discover(context),until=Date.now(),previousIds=new Map([...this.registered].map(([id,value])=>[value.definition.key+'\0'+value.source.path,id])),previousItems=new Map(this.items.map((item)=>[item.key,item.id]))
    const next=new Map<string,RegisteredDeepCleanSource>(),items:DeepCleanItem[]=[]
    let processed=0,errors=0,limited=false
    for(const definition of definitions){
      assertDeepNotCancelled(context.signal)
      const item:DeepCleanItem={id:previousItems.get(definition.key)||randomUUID(),key:definition.key,name:definition.name,description:definition.description,group:definition.group,risk:definition.risk,recommended:definition.recommended&&definition.risk==='safe',size:0,count:0,status:'empty',sources:[],runningApps:definition.applications.filter(running),owner:definition.owner}
      for(const target of definition.paths){
        assertDeepNotCancelled(context.signal)
        let snapshot:DeepCleanSnapshot
        try{snapshot=await (definition.snapshot?definition.snapshot(target,until):deepFileSnapshot(target,until,{...definition.options,signal:context.signal}))}catch(error){
          assertDeepNotCancelled(context.signal)
          snapshot={count:0,size:0,modified:null,status:privacyAccessFailure(error)?'permission-required':(error as NodeJS.ErrnoException).code==='ENOENT'?'empty':'unavailable',files:[],validate:async()=>{throw new Error('deep.sourceUnavailable')},clean:async()=>{throw new Error('deep.sourceUnavailable')}}
        }
        const id=previousIds.get(definition.key+'\0'+target)||randomUUID()
        const source:DeepCleanSource={id,cleanupMethod:definition.cleanupMethod||(definition.options?.readOnly?'none':'delete'),path:target,name:target.split(/[/\\]/).filter(Boolean).at(-1)||target,size:snapshot.size,count:snapshot.count,modified:snapshot.modified,status:snapshot.status==='ready'&&item.runningApps.length?'requires-close':snapshot.status}
        item.sources.push(source);item.size+=source.size;item.count+=source.count
        if(['permission-required','unavailable'].includes(source.status))errors++
        if(source.status==='limited')limited=true
        next.set(id,{item,source,snapshot,definition})
      }
      const states=item.sources.map((source)=>source.status)
      item.status=states.includes('ready')?'ready':states.includes('requires-close')?'requires-close':states.includes('permission-required')?'permission-required':states.includes('limited')?'limited':states.includes('review-only')?'review-only':states.includes('unavailable')?'unavailable':'empty'
      items.push(item);progress?.(++processed,definitions.length,definition.paths[0]||'')
      // Yield to Electron between sources so navigation and independent jobs keep responding.
      await new Promise<void>((resolve)=>setImmediate(resolve))
    }
    this.registered=next;this.items=items
    return {items,elapsedMs:Date.now()-started,scannedAt:new Date(until).toISOString(),errors,limited}
  }
  async preview(id:string,offset=0):Promise<DeepCleanPreview>{
    const {snapshot}=this.get(id),files=snapshot.files.slice(offset,offset+100)
    return {id,files,total:snapshot.files.length,offset,nextOffset:offset+files.length<snapshot.files.length?offset+files.length:null}
  }
  async prepare(ids:string[],running:(name:string)=>boolean,skipRunning=false):Promise<{entries:RegisteredDeepCleanSource[];skipped:number}>{
    const selected=[...new Set(ids)].map((id)=>this.get(id))
    if(!selected.length)throw new Error('deep.selectionExpired')
    if(selected.some((entry)=>!['ready','requires-close'].includes(entry.source.status)||entry.item.risk==='protected'||!entry.source.count))throw new Error('deep.sourceUnavailable')
    const blocked=selected.filter((entry)=>entry.definition.applications.some(running))
    if(blocked.length&&!skipRunning)throw new Error('deep.closeApplications')
    const entries=selected.filter((entry)=>!blocked.includes(entry))
    for(const entry of entries)await entry.snapshot.validate()
    return {entries,skipped:blocked.length}
  }
}
