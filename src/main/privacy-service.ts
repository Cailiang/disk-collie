import {isScanPathExcluded} from '../shared/scan-exclusions'
import {randomUUID} from 'node:crypto'
import type {PrivacyItem,PrivacyPreview,PrivacyTimeRange} from '../shared/privacy-types'
import {browserPrivacyResources} from './privacy-browser'
import {systemPrivacyResources} from './privacy-system'
import {privacyAccessFailure,privacyUnavailable,type PrivacyContext,type PrivacyResource,type PrivacySnapshot} from './privacy-resource'

interface RegisteredPrivacy {resource:PrivacyResource;snapshot:PrivacySnapshot;item:PrivacyItem}
const effect=(kind:PrivacyItem['kind']):string=>kind==='app-edit-history'?'editHistory':kind==='app-sessions'?'appSessions':['cookies','site-data','site-permissions'].includes(kind)?'accounts':kind==='passwords'?'passwords':kind==='autofill'?'autofill':kind==='clipboard'?'clipboard':kind==='shell-history'?'shell':kind.includes('session')?'sessions':kind.includes('cache')?'rebuild':kind.includes('logs')?'logs':kind.includes('recent')?'recent':'history'
/** The Renderer only receives registered IDs. Preview and mutation plans stay in Main. */
export class PrivacyService {
  private registered=new Map<string,RegisteredPrivacy>()
  constructor(private readonly discover:(context:PrivacyContext)=>Promise<PrivacyResource[]>=async(context)=>(await Promise.all([browserPrivacyResources(context),systemPrivacyResources(context)])).flat()){}
  has(id:string):boolean{return this.registered.has(id)}
  source(id:string):PrivacyResource['source']|undefined{return this.registered.get(id)?.resource.source}
  paths(id:string):string[]{return this.registered.get(id)?.resource.paths||[]}
  get(id:string):RegisteredPrivacy{const entry=this.registered.get(id);if(!entry)throw new Error('privacy.selectionExpired');return entry}
  async scan(context:PrivacyContext,range:PrivacyTimeRange,running:(browser:string)=>boolean=()=>false):Promise<PrivacyItem[]>{
    const until=Date.now(),resources=(await this.discover(context)).filter((resource)=>!resource.paths.some((target)=>isScanPathExcluded(target,context.excludedPaths))),next=new Map<string,RegisteredPrivacy>()
    const previous=new Map([...this.registered].map(([id,value])=>[value.resource.key,id]))
    for(let start=0;start<resources.length;start+=4){
      const batch=await Promise.all(resources.slice(start,start+4).map(async(resource)=>{
        let snapshot:PrivacySnapshot
        try{snapshot=await resource.scan(range,until)}catch(error){snapshot=privacyUnavailable(privacyAccessFailure(error)?'permission-required':'unavailable')}
        const id=previous.get(resource.key)||randomUUID()
        const item:PrivacyItem={id,nameKey:resource.kind,path:resource.paths[0]||`privacy:${resource.key}`,paths:resource.paths,size:snapshot.size,category:'privacy',effectKey:effect(resource.kind),browser:resource.browser,profile:resource.profile,source:{key:resource.source.key,name:resource.source.name},privacyCategory:resource.category,kind:resource.kind,count:snapshot.count,risk:resource.risk,capability:snapshot.capability,recommended:resource.recommended??resource.risk==='low',range,browserRunning:Boolean(resource.browser&&running(resource.browser)),limited:snapshot.limited}
        return {resource,snapshot,item}
      }))
      for(const entry of batch)next.set(entry.item.id,entry)
    }
    this.registered=next
    return [...next.values()].map((entry)=>entry.item)
  }
  async preview(id:string,offset=0):Promise<PrivacyPreview>{
    const {snapshot,item}=this.get(id)
    if(snapshot.capability!=='ready'&&snapshot.capability!=='empty')throw new Error('privacy.sourceUnavailable')
    const records=await snapshot.preview(offset,100)
    return {id,kind:item.kind,records,total:item.count||0,offset,nextOffset:records.length===100?offset+records.length:null,limited:item.limited}
  }
  async prepare(ids:string[],running:(browser:string)=>boolean,skipRunning=false):Promise<{entries:RegisteredPrivacy[];skipped:number}>{
    const selected=[...new Set(ids)].map((id)=>this.get(id))
    if(!selected.length)throw new Error('privacy.selectionExpired')
    if(selected.some((entry)=>entry.item.capability!=='ready'||!entry.item.count))throw new Error('privacy.sourceUnavailable')
    const blocked=selected.filter((entry)=>entry.resource.browser&&running(entry.resource.browser))
    if(blocked.length&&!skipRunning)throw new Error('privacy.browserMustClose')
    const entries=selected.filter((entry)=>!blocked.includes(entry))
    // Validate every selection before the first mutation, including shared DB sources.
    for(const entry of entries)await entry.snapshot.validate()
    return {entries,skipped:blocked.length}
  }
  forget(id:string):void{this.registered.delete(id)}
}
