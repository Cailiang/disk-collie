import {chmod,copyFile,lstat,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import type {PrivacyKind,PrivacyRecord,PrivacyTimeRange} from '../shared/privacy-types'
import {isScanPathExcluded} from '../shared/scan-exclusions'
import {privacyAccessFailure,privacyFileResource,privacyPathSnapshot,privacySince,privacyUnavailable,validatePrivacyPath,type PrivacyContext,type PrivacyDefinition,type PrivacyPathSnapshot,type PrivacyResource,type PrivacySnapshot,type PrivacySource} from './privacy-resource'

const {DatabaseSync}=require('node:sqlite') as typeof import('node:sqlite')
type Database=InstanceType<typeof DatabaseSync>
type SqlValue=string|number|bigint|null
type Family='chromium'|'firefox'|'safari'
type SqlSpec={table:string;required:Record<string,string[]>;where?:string;time?:{column:string;family:Family};records:string;grouped?:boolean;related?:Array<{table:string;where:string;fields?:string[];requires?:string[]}>;mutate?:(database:Database)=>void}
const MAX_ROWS=100000,MAX_JSON_BYTES=32*1024*1024
const CHROME_MS=11644473600000n,SAFARI_SECONDS=978307200

function quote(identifier:string):string{return '"'+identifier.replaceAll('"','""')+'"'}
function tableExists(database:Database,table:string):boolean{return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))}
function columns(database:Database,table:string):Set<string>{return new Set((database.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{name:string}>).map((row)=>row.name))}
function requireSchema(database:Database,spec:SqlSpec):void{for(const [table,needed] of Object.entries(spec.required)){if(!tableExists(database,table)||needed.some((name)=>!columns(database,table).has(name)))throw new Error('privacy.sourceUnavailable')}}
function openDatabase(filename:string,writable=false):Database{const database=new DatabaseSync(filename,{readOnly:!writable});database.exec('PRAGMA busy_timeout=200; PRAGMA foreign_keys=ON;');if(!writable)database.exec('PRAGMA query_only=ON;');return database}
function databaseBusy(error:unknown):boolean{return [5,6].includes(Number((error as {errcode?:number})?.errcode))||/database (?:is )?(?:locked|busy)/i.test(String(error))}
async function contentHash(filename:string):Promise<string>{const hash=createHash('sha256');for await(const bytes of createReadStream(filename))hash.update(bytes);return hash.digest('hex')}
/** A locked browser is read through a verified, short-lived private copy; the source is never opened for recovery. */
async function readBrowserDatabase<T>(filename:string,read:(database:Database)=>T):Promise<T>{
  let live:Database|undefined
  try{live=openDatabase(filename);return read(live)}catch(error){if(!databaseBusy(error))throw error}finally{live?.close()}
  for(let attempt=0;attempt<3;attempt++){
    const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'diskcollie-private-browser-')))
    let copy:Database|undefined
    try{
      await chmod(directory,0o700)
      const observed=await observedDatabase(filename),primary=observed.get('')
      if(!primary||primary.directory)throw new Error('privacy.sourceUnavailable')
      const sources=[...observed].filter(([suffix,value])=>suffix!=='-shm'&&value)
      if(sources.reduce((sum,[,value])=>sum+(value?.size||0),0)>2*1024**3)throw new Error('privacy.sourceUnavailable')
      const target=path.join(directory,'records.sqlite')
      for(const [suffix,value] of sources){await copyFile(value!.path,target+suffix);await chmod(target+suffix,0o600)}
      await validateDatabase(observed)
      let stable=true
      for(const [suffix,value] of sources)if(await contentHash(value!.path)!==await contentHash(target+suffix)){stable=false;break}
      await validateDatabase(observed)
      if(!stable){if(attempt<2)continue;throw new Error('privacy.sourceChanged')}
      // Recovery can write to this isolated copy, including a captured rollback journal, never to browser files.
      copy=new DatabaseSync(target);copy.exec('PRAGMA busy_timeout=200; PRAGMA foreign_keys=ON; PRAGMA query_only=ON;')
      const checks=copy.prepare('PRAGMA quick_check').all() as Array<Record<string,unknown>>
      if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw new Error('privacy.sourceUnavailable')
      return read(copy)
    }catch(error){
      // A concurrent checkpoint can remove a companion between observing and copying it.
      if((error as Error).message==='privacy.sourceChanged'||isMissing(error)){if(attempt<2)continue;throw new Error('privacy.sourceChanged')}
      throw error
    }
    finally{copy?.close();await rm(directory,{recursive:true,force:true})}
  }
  throw new Error('privacy.sourceChanged')
}
function isMissing(error:unknown):boolean{return (error as NodeJS.ErrnoException)?.code==='ENOENT'}
function unavailable(error:unknown):PrivacySnapshot{return privacyUnavailable(privacyAccessFailure(error)||/permission|not authorized|access is denied/i.test(String(error))?'permission-required':'unavailable')}
function epoch(value:number,family:Family):SqlValue{if(family==='safari')return value/1000-SAFARI_SECONDS;return (BigInt(Math.trunc(value))+(family==='chromium'?CHROME_MS:0n))*1000n}
function timestamp(column:string,family:Family):string{return family==='safari'?`CAST((${column}+${SAFARI_SECONDS})*1000 AS INTEGER)`:family==='chromium'?`CAST(${column}/1000-${CHROME_MS} AS INTEGER)`:`CAST(${column}/1000 AS INTEGER)`}
function filter(spec:SqlSpec,range:PrivacyTimeRange,until:number):{sql:string;values:SqlValue[]}{
  const tests=spec.where?[spec.where]:[],values:SqlValue[]=[]
  if(spec.time){const since=privacySince(range,until);if(since!==null){tests.push(`${spec.time.column}>=?`);values.push(epoch(since,spec.time.family))}tests.push(`${spec.time.column}<=?`);values.push(epoch(until,spec.time.family))}
  return {sql:tests.length?tests.map((test)=>`(${test})`).join(' AND '):'1',values}
}
function cleanText(value:unknown,limit=2048):string{return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit)}
function accountSite(value:unknown):string{
  const raw=cleanText(value),explicit=/^[a-z][a-z\d+.-]*:\/\//i.test(raw)
  try{
    const parsed=new URL(explicit?raw:`https://${raw.replace(/^\/\//,'')}`),hostname=parsed.hostname.replace(/\.$/,'')
    if(!['http:','https:','ftp:','android:'].includes(parsed.protocol)||!hostname)return '—'
    const validHost=hostname.startsWith('[')?/^\[[a-f\d:.]+\]$/i.test(hostname):hostname.split('.').every((label)=>/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))
    if(!validHost||!explicit&&!hostname.includes('.')&&hostname!=='localhost'&&!hostname.startsWith('['))return '—'
    return explicit?`${parsed.protocol}//${parsed.host}`:parsed.host
  }catch{return '—'}
}
function accountLink(site:string):string|undefined{return /^(https?|ftp):\/\//.test(site)?site:undefined}
function record(row:Record<string,unknown>,index:number):PrivacyRecord{
  const time=Number(row.timestamp),title=cleanText(row.title)||cleanText(row.url)||cleanText(row.path)||'—'
  return {id:cleanText(row.id)||String(index),title,...(row.subtitle?{subtitle:cleanText(row.subtitle)}:{}),...(row.url?{url:cleanText(row.url)}:{}),...(row.path?{path:cleanText(row.path)}:{}),...(Number.isFinite(time)&&time>0?{timestamp:new Date(time).toISOString()}:{}),...(row.count!==undefined?{count:Number(row.count)}:{})}
}
async function observedDatabase(filename:string):Promise<Map<string,PrivacyPathSnapshot|null>>{
  const result=new Map<string,PrivacyPathSnapshot|null>()
  for(const suffix of ['','-wal','-shm','-journal']){try{result.set(suffix,await privacyPathSnapshot(filename+suffix))}catch(error){if(!isMissing(error))throw error;result.set(suffix,null)}}
  return result
}
// Database sizes describe the source involved, not bytes guaranteed to be released.
function databaseSourceSize(observed:Map<string,PrivacyPathSnapshot|null>):number{return [...observed].reduce((sum,[suffix,snapshot])=>sum+(suffix!=='-shm'&&snapshot?snapshot.size:0),0)}
async function validateDatabase(observed:Map<string,PrivacyPathSnapshot|null>,identityOnly=false):Promise<void>{
  const primary=observed.get('');if(!primary)throw new Error('privacy.sourceUnavailable')
  if(identityOnly){await validatePrivacyPath(primary,true);return}
  for(const [suffix,old] of observed){
    if(old){await validatePrivacyPath(old,suffix==='-shm');continue}
    if(suffix==='-shm')continue
    try{await lstat(primary.path+suffix)}catch(error){if(isMissing(error))continue;throw error}
    throw new Error('privacy.sourceChanged')
  }
}
function selected(database:Database,ids:readonly string[]):void{
  database.exec('CREATE TEMP TABLE diskcollie_privacy_keys(id INTEGER PRIMARY KEY)')
  const insert=database.prepare('INSERT INTO diskcollie_privacy_keys(id) VALUES(?)')
  for(const id of ids)insert.run(BigInt(id))
}
const keys='SELECT id FROM temp.diskcollie_privacy_keys'
function optionalDelete(database:Database,table:string,column:string,source=keys):void{if(tableExists(database,table)&&columns(database,table).has(column))database.exec(`DELETE FROM ${quote(table)} WHERE ${quote(column)} IN (${source})`)}
function remaining(database:Database,table:string):number{return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quote(table)} WHERE rowid IN (${keys})`).get()!.count)}
function queryFingerprint(database:Database,query:string):string{
  const hash=createHash('sha256'),statement=database.prepare(query)
  statement.setReadBigInts(true)
  for(const row of statement.iterate())hash.update(JSON.stringify(row,(_key,value)=>typeof value==='bigint'?{integer:value.toString()}:value instanceof Uint8Array?{bytes:Buffer.from(value).toString('base64')}:value)+'\n')
  return hash.digest('hex')
}
/** Capture record contents and their affected relations, excluding sibling-maintained counters. */
function fingerprintOrder(database:Database,table:string):string{
  const info=database.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{name:string;pk:number}>
  const primary=info.filter((column)=>column.pk>0).sort((a,b)=>a.pk-b.pk)
  return (primary.length?primary:info).map((column)=>quote(column.name)).join(',')
}
function rowsFingerprint(database:Database,spec:SqlSpec,source:string):string{
  const fingerprints=[queryFingerprint(database,`SELECT * FROM ${quote(spec.table)} WHERE rowid IN (${source}) ORDER BY rowid`)]
  for(const related of spec.related||[]){
    if(!tableExists(database,related.table)||related.requires?.some((name)=>!columns(database,related.table).has(name))){fingerprints.push(`missing:${related.table}`);continue}
    const fields=related.fields?.map(quote).join(',')||'*'
    fingerprints.push(queryFingerprint(database,`SELECT ${fields} FROM ${quote(related.table)} WHERE ${related.where.replaceAll('$IDS',source)} ORDER BY ${fingerprintOrder(database,related.table)}`))
  }
  return createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex')
}

function chromiumVisits(database:Database):void{
  database.exec(`CREATE TEMP TABLE diskcollie_privacy_urls(id INTEGER PRIMARY KEY); INSERT INTO diskcollie_privacy_urls SELECT DISTINCT url FROM visits WHERE rowid IN (${keys})`)
  for(const [table,column] of [['visit_source','id'],['content_annotations','visit_id'],['context_annotations','visit_id'],['clusters_and_visits','visit_id']] as const)optionalDelete(database,table,column)
  const visitColumns=columns(database,'visits')
  for(const column of ['from_visit','opener_visit'])if(visitColumns.has(column))database.exec(`UPDATE visits SET ${quote(column)}=0 WHERE ${quote(column)} IN (${keys})`)
  database.exec(`DELETE FROM visits WHERE rowid IN (${keys})`)
  const urlColumns=columns(database,'urls'),assignments:string[]=[]
  if(urlColumns.has('visit_count'))assignments.push('visit_count=(SELECT COUNT(*) FROM visits WHERE visits.url=urls.id)')
  if(urlColumns.has('last_visit_time'))assignments.push('last_visit_time=COALESCE((SELECT MAX(visit_time) FROM visits WHERE visits.url=urls.id),0)')
  if(urlColumns.has('typed_count')&&visitColumns.has('transition'))assignments.push('typed_count=(SELECT COUNT(*) FROM visits WHERE visits.url=urls.id AND (transition&255)=1)')
  if(assignments.length)database.exec(`UPDATE urls SET ${assignments.join(',')} WHERE id IN (SELECT id FROM temp.diskcollie_privacy_urls)`)
  const keepSearch=tableExists(database,'keyword_search_terms')&&columns(database,'keyword_search_terms').has('url_id')?' AND NOT EXISTS(SELECT 1 FROM keyword_search_terms WHERE url_id=urls.id)':''
  database.exec(`DELETE FROM urls WHERE id IN (SELECT id FROM temp.diskcollie_privacy_urls) AND NOT EXISTS(SELECT 1 FROM visits WHERE visits.url=urls.id)${keepSearch}`)
}
function firefoxVisits(database:Database):void{
  database.exec(`CREATE TEMP TABLE diskcollie_privacy_places(id INTEGER PRIMARY KEY); INSERT INTO diskcollie_privacy_places SELECT DISTINCT place_id FROM moz_historyvisits WHERE rowid IN (${keys}); DELETE FROM moz_historyvisits WHERE rowid IN (${keys})`)
  const available=columns(database,'moz_places'),assignments:string[]=[]
  if(available.has('visit_count'))assignments.push('visit_count=(SELECT COUNT(*) FROM moz_historyvisits WHERE place_id=moz_places.id)')
  if(available.has('last_visit_date'))assignments.push('last_visit_date=(SELECT MAX(visit_date) FROM moz_historyvisits WHERE place_id=moz_places.id)')
  if(assignments.length)database.exec(`UPDATE moz_places SET ${assignments.join(',')} WHERE id IN (SELECT id FROM temp.diskcollie_privacy_places)`)
  const foreign=available.has('foreign_count')?'AND COALESCE(foreign_count,0)=0':''
  const bookmarks=tableExists(database,'moz_bookmarks')&&columns(database,'moz_bookmarks').has('fk')?'AND NOT EXISTS(SELECT 1 FROM moz_bookmarks WHERE fk=moz_places.id)':''
  database.exec(`DELETE FROM moz_places WHERE id IN (SELECT id FROM temp.diskcollie_privacy_places) AND NOT EXISTS(SELECT 1 FROM moz_historyvisits WHERE place_id=moz_places.id) ${foreign} ${bookmarks}`)
}
function safariVisits(database:Database):void{
  database.exec(`CREATE TEMP TABLE diskcollie_privacy_safari_items(id INTEGER PRIMARY KEY); INSERT INTO diskcollie_privacy_safari_items SELECT DISTINCT history_item FROM history_visits WHERE rowid IN (${keys}); DELETE FROM history_visits WHERE rowid IN (${keys}); DELETE FROM history_items WHERE id IN (SELECT id FROM temp.diskcollie_privacy_safari_items) AND NOT EXISTS(SELECT 1 FROM history_visits WHERE history_item=history_items.id)`)
}
function chromiumSearch(database:Database):void{
  database.exec(`CREATE TEMP TABLE diskcollie_privacy_search_urls(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO diskcollie_privacy_search_urls SELECT url_id FROM keyword_search_terms WHERE rowid IN (${keys}); DELETE FROM keyword_search_terms WHERE rowid IN (${keys}); DELETE FROM urls WHERE id IN (SELECT id FROM temp.diskcollie_privacy_search_urls) AND NOT EXISTS(SELECT 1 FROM keyword_search_terms WHERE url_id=urls.id) AND NOT EXISTS(SELECT 1 FROM visits WHERE visits.url=urls.id)`)
}

function sqlResource(definition:PrivacyDefinition,spec:SqlSpec):PrivacyResource{
  return {...definition,scan:async(range,until)=>{
    if(range!=='all'&&!definition.supportsRange)return privacyUnavailable('range-unsupported')
    const filename=definition.paths[0]
    try{
      await privacyPathSnapshot(filename)
      const {ids,total,fingerprint}=await readBrowserDatabase(filename,(reader)=>{
        requireSchema(reader,spec);reader.exec('BEGIN')
        const query=filter(spec,range,until),total=Number(reader.prepare(`SELECT COUNT(*) AS count FROM ${quote(spec.table)} WHERE ${query.sql}`).get(...query.values)!.count)
        const statement=reader.prepare(`SELECT rowid AS id FROM ${quote(spec.table)} WHERE ${query.sql} ORDER BY ${spec.time?`${spec.time.column} DESC,`:''}rowid DESC LIMIT ${MAX_ROWS}`);statement.setReadBigInts(true)
        const ids=(statement.all(...query.values) as Array<{id:bigint}>).map((row)=>String(row.id))
        return {ids,total,fingerprint:rowsFingerprint(reader,spec,ids.join(','))}
      })
      const observed=await observedDatabase(filename),size=databaseSourceSize(observed)
      let validated=false
      return {count:ids.length,size,capability:ids.length?'ready':'empty',limited:total>ids.length,
        validate:async()=>{await validateDatabase(observed);validated=true},
        preview:async(offset,limit)=>{
          await validateDatabase(observed,true)
          if(!ids.length)return []
          const page=spec.grouped?ids:ids.slice(offset,offset+limit)
          if(!page.length)return []
          return readBrowserDatabase(filename,(reader)=>{
            requireSchema(reader,spec)
            // Only engine-created integer row identities enter this fixed query; no renderer SQL or paths.
            const list=page.join(','),sql=spec.records.replaceAll('$IDS',list)+(spec.grouped?' LIMIT ? OFFSET ?':'')
            const rows=reader.prepare(sql).all(...(spec.grouped?[limit,offset]:[])) as Array<Record<string,unknown>>
            return rows.map((row,index)=>{const entry=record(row,index);if(definition.kind==='passwords'){entry.id=String(offset+index);entry.title=accountSite(entry.title);entry.url=accountLink(entry.title)}return entry})
          })
        },
        clean:async(progress)=>{
          if(!validated)await validateDatabase(observed)
          await validateDatabase(observed,true)
          const before=databaseSourceSize(await observedDatabase(filename))
          let writer:Database|undefined
          try{
            writer=openDatabase(filename,true);requireSchema(writer,spec);writer.exec('BEGIN IMMEDIATE');selected(writer,ids)
            const count=remaining(writer,spec.table)
            if(count!==ids.length||rowsFingerprint(writer,spec,keys)!==fingerprint)throw new Error('privacy.sourceChanged')
            if(spec.mutate)spec.mutate(writer);else writer.exec(`DELETE FROM ${quote(spec.table)} WHERE rowid IN (${keys})`)
            if(remaining(writer,spec.table)!==0)throw new Error('privacy.verificationFailed')
            writer.exec('COMMIT');progress?.(count,count)
            writer.close();writer=undefined
            const after=databaseSourceSize(await observedDatabase(filename))
            return {count,size:Math.max(0,before-after),changed:count>0,removedPaths:[]}
          }catch(error){if(writer?.isTransaction)writer.exec('ROLLBACK');throw error}finally{writer?.close()}
        }
      }
    }catch(error){return isMissing(error)?privacyUnavailable('empty'):unavailable(error)}
  }}
}

async function readJson(filename:string):Promise<Record<string,any>>{const observed=await privacyPathSnapshot(filename);if(observed.directory||observed.size>MAX_JSON_BYTES)throw new Error('privacy.sourceUnavailable');const value=JSON.parse(await readFile(filename,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('privacy.sourceUnavailable');return value}
async function replaceJson(filename:string,value:unknown):Promise<void>{const temporary=filename+'.diskcollie-'+randomUUID();try{await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temporary,filename)}finally{await rm(temporary,{force:true})}}
function firefoxPasswords(definition:PrivacyDefinition):PrivacyResource{
  return {...definition,scan:async(range)=>{
    if(range!=='all')return privacyUnavailable('range-unsupported')
    try{
      const filename=definition.paths[0],original=await privacyPathSnapshot(filename),value=await readJson(filename)
      if(!Array.isArray(value.logins))return privacyUnavailable('unavailable')
      const logins=value.logins as Array<Record<string,unknown>>,count=logins.length
      if(count>MAX_ROWS)return privacyUnavailable('unavailable')
      const sites=new Map<string,number>();for(const login of logins){const site=accountSite(login.hostname);sites.set(site,(sites.get(site)||0)+1)}
      return {count,size:original.size,capability:count?'ready':'empty',
        preview:async(offset,limit)=>{await validatePrivacyPath(original);return [...sites].sort(([a],[b])=>a.localeCompare(b)).slice(offset,offset+limit).map(([site,count],id)=>({id:String(id+offset),title:site||'—',url:accountLink(site),count}))},
        validate:()=>validatePrivacyPath(original),
        clean:async(progress)=>{await validatePrivacyPath(original);if(!count)return {count:0,size:0,changed:false,removedPaths:[]};const next=await readJson(filename);next.logins=[];await replaceJson(filename,next);const check=await readJson(filename);if(!Array.isArray(check.logins)||check.logins.length)throw new Error('privacy.verificationFailed');progress?.(count,count);return {count,size:Math.max(0,original.size-(await lstat(filename)).size),changed:count>0,removedPaths:[]}}
      }
    }catch(error){return isMissing(error)?privacyUnavailable('empty'):unavailable(error)}
  }}
}
function chromiumPermissions(definition:PrivacyDefinition):PrivacyResource{
  return {...definition,scan:async(range)=>{
    if(range!=='all')return privacyUnavailable('range-unsupported')
    try{
      const filename=definition.paths[0],original=await privacyPathSnapshot(filename),value=await readJson(filename),exceptions=value.profile?.content_settings?.exceptions
      if(exceptions!==undefined&&(!exceptions||typeof exceptions!=='object'||Array.isArray(exceptions)))return privacyUnavailable('unavailable')
      const entries:Array<{category:string;site:string}>=[]
      for(const [category,sites] of Object.entries(exceptions||{}))if(sites&&typeof sites==='object'&&!Array.isArray(sites))for(const site of Object.keys(sites))entries.push({category,site})
      if(entries.length>MAX_ROWS)return privacyUnavailable('unavailable')
      return {count:entries.length,size:original.size,capability:entries.length?'ready':'empty',
        preview:async(offset,limit)=>{await validatePrivacyPath(original);return entries.slice(offset,offset+limit).map((entry,index)=>({id:String(index+offset),title:cleanText(entry.site),subtitle:cleanText(entry.category),count:1}))},
        validate:()=>validatePrivacyPath(original),
        clean:async(progress)=>{await validatePrivacyPath(original);const next=await readJson(filename),settings=next.profile?.content_settings?.exceptions;let count=0;for(const entry of entries)if(settings?.[entry.category]&&Object.hasOwn(settings[entry.category],entry.site)){delete settings[entry.category][entry.site];count++}if(count!==entries.length)throw new Error('privacy.sourceChanged');if(!count)return {count:0,size:0,changed:false,removedPaths:[]};await replaceJson(filename,next);const check=await readJson(filename);if(entries.some((entry)=>Object.hasOwn(check.profile?.content_settings?.exceptions?.[entry.category]||{},entry.site)))throw new Error('privacy.verificationFailed');progress?.(count,count);return {count,size:Math.max(0,original.size-(await lstat(filename)).size),changed:count>0,removedPaths:[]}}
      }
    }catch(error){return isMissing(error)?privacyUnavailable('empty'):unavailable(error)}
  }}
}

type Browser={key:string;name:string;bundle:string;appName?:string;root:string;process:string;family:Family;cacheRoot?:string}
type BrowserProfile={id:string;name:string;root:string;denied?:boolean}
function browserSource(browser:Browser,context:PrivacyContext):PrivacySource{
  const paths=context.platform==='win32'?path.win32:path.posix
  const installed=context.applications.find((application)=>application.bundleId?.toLowerCase()===browser.bundle.toLowerCase()||application.name===browser.name)
  return {key:browser.key,name:browser.name,bundleIds:[browser.bundle],iconPaths:[...(installed?[installed.iconPath||installed.location]:[]),...(context.platform==='darwin'?[paths.join('/Applications',(browser.appName||browser.name)+'.app'),paths.join(context.home,'Applications',(browser.appName||browser.name)+'.app'),paths.join('/System/Applications',(browser.appName||browser.name)+'.app')]:[])]}
}
async function directoryState(filename:string):Promise<'present'|'missing'|'denied'>{try{return (await privacyPathSnapshot(filename)).directory?'present':'missing'}catch(error){return privacyAccessFailure(error)?'denied':'missing'}}
async function fileExists(filename:string):Promise<boolean>{try{return !(await privacyPathSnapshot(filename)).directory}catch(error){return privacyAccessFailure(error)}}
function installed(browser:Browser,context:PrivacyContext):boolean{return context.applications.some((application)=>application.bundleId?.toLowerCase()===browser.bundle.toLowerCase()||application.name===browser.name)}
async function profileDirectories(browser:Browser,context:PrivacyContext):Promise<BrowserProfile[]>{
  const paths=context.platform==='win32'?path.win32:path.posix
  if(isScanPathExcluded(browser.root,context.excludedPaths))return []
  if(browser.family==='safari'){const state=await directoryState(browser.root);return state!=='missing'||installed(browser,context)?[{id:'Default',name:'Default',root:browser.root,denied:state==='denied'}]:[]}
  let names:string[]=[],denied=false
  try{names=(await readdir(browser.root,{withFileTypes:true})).filter((entry)=>entry.isDirectory()&&(browser.family==='firefox'||/^(Default|Profile \d+|Guest Profile)$/.test(entry.name))).map((entry)=>entry.name).sort()}catch(error){denied=privacyAccessFailure(error);if(denied||installed(browser,context))names=['Default'];else return []}
  const result:BrowserProfile[]=[]
  let labels:Record<string,any>={}
  if(browser.family==='chromium'&&!isScanPathExcluded(paths.join(browser.root,'Local State'),context.excludedPaths))try{labels=(await readJson(paths.join(browser.root,'Local State'))).profile?.info_cache||{}}catch{/* Friendly profile names are optional. */}
  for(const name of names)if(!isScanPathExcluded(paths.join(browser.root,name),context.excludedPaths))result.push({id:name,name:cleanText(labels[name]?.name)||name,root:paths.join(browser.root,name),denied})
  if(!denied&&browser.family==='chromium'&&!isScanPathExcluded(paths.join(browser.root,'History'),context.excludedPaths)&&await fileExists(paths.join(browser.root,'History')))result.unshift({id:'Root',name:'Default',root:browser.root})
  if(!result.length&&installed(browser,context)&&!isScanPathExcluded(paths.join(browser.root,'Default'),context.excludedPaths))result.push({id:'Default',name:'Default',root:paths.join(browser.root,'Default')})
  return result
}

function browserDefinitions(context:PrivacyContext):Browser[]{
  const paths=context.platform==='win32'?path.win32:path.posix,home=context.home,mac=context.platform==='darwin',win=context.platform==='win32'
  const support=mac?paths.join(home,'Library/Application Support'):win?context.env.LOCALAPPDATA||paths.join(home,'AppData/Local'):context.env.XDG_CONFIG_HOME||paths.join(home,'.config')
  const roaming=context.env.APPDATA||paths.join(home,'AppData/Roaming')
  const chromium=(key:string,name:string,bundle:string,macRoot:string,winRoot:string,linuxRoot:string,process:string,appName?:string):Browser=>({key,name,bundle,appName,root:paths.join(support,mac?macRoot:win?winRoot:linuxRoot),process:mac?(appName||name):process,family:'chromium',...(!win?{cacheRoot:paths.join(mac?paths.join(home,'Library/Caches'):context.env.XDG_CACHE_HOME||paths.join(home,'.cache'),mac?macRoot:linuxRoot)}:{})})
  return [
    chromium('chrome','Google Chrome','com.google.Chrome','Google/Chrome','Google/Chrome/User Data','google-chrome','chrome'),
    chromium('edge','Microsoft Edge','com.microsoft.edgemac','Microsoft Edge','Microsoft/Edge/User Data','microsoft-edge','msedge'),
    chromium('brave','Brave','com.brave.Browser','BraveSoftware/Brave-Browser','BraveSoftware/Brave-Browser/User Data','BraveSoftware/Brave-Browser','brave','Brave Browser'),
    chromium('chromium','Chromium','org.chromium.Chromium','Chromium','Chromium/User Data','chromium','chromium'),
    {...chromium('opera','Opera','com.operasoftware.Opera','com.operasoftware.Opera','Opera Software/Opera Stable','opera','opera'),...(win?{root:paths.join(roaming,'Opera Software/Opera Stable')}:{})},
    chromium('vivaldi','Vivaldi','com.vivaldi.Vivaldi','Vivaldi','Vivaldi/User Data','vivaldi','vivaldi'),
    chromium('yandex','Yandex Browser','ru.yandex.desktop.yandex-browser','Yandex/YandexBrowser','Yandex/YandexBrowser/User Data','yandex-browser','browser','Yandex'),
    chromium('qq','QQ Browser','com.tencent.QQBrowser','QQBrowser3','Tencent/QQBrowser/User Data','qqbrowser','QQBrowser','QQBrowser'),
    chromium('360','360 Safe Browser','com.qihoo.360securebrowser','360Chrome','360Chrome/Chrome/User Data','360chrome','360Chrome','360Chrome'),
    ...(mac?[chromium('arc','Arc','company.thebrowser.Browser','Arc/User Data','','','Arc')]:[]),
    {key:'firefox',name:'Firefox',bundle:'org.mozilla.firefox',root:mac?paths.join(support,'Firefox/Profiles'):win?paths.join(roaming,'Mozilla/Firefox/Profiles'):paths.join(home,'.mozilla/firefox'),process:mac?'Firefox':'firefox',family:'firefox',cacheRoot:mac?paths.join(home,'Library/Caches/Firefox/Profiles'):win?paths.join(support,'Mozilla/Firefox/Profiles'):paths.join(context.env.XDG_CACHE_HOME||paths.join(home,'.cache'),'mozilla/firefox')},
    ...(mac?[{key:'safari',name:'Safari',bundle:'com.apple.Safari',root:paths.join(home,'Library/Safari'),process:'Safari',family:'safari' as const}]:[])
  ]
}

/** Independently implemented adapters for fixed browser stores; all details stay local/session-only. */
export async function browserPrivacyResources(context:PrivacyContext):Promise<PrivacyResource[]>{
  const resources:PrivacyResource[]=[],paths=context.platform==='win32'?path.win32:path.posix
  for(const browser of browserDefinitions(context)){
    const source=browserSource(browser,context)
    for(const profile of await profileDirectories(browser,context)){
      const add=(resource:PrivacyResource):void=>{if(!resource.paths.length)return;resources.push(profile.denied?{...resource,scan:async(range,until)=>{const snapshot=await resource.scan(range,until);return snapshot.capability==='empty'?privacyUnavailable('permission-required'):snapshot}}:resource)}
      const definition=(kind:PrivacyKind,locations:string[],supportsRange:boolean):PrivacyDefinition=>({key:`${browser.key}:${profile.id}:${kind}`,kind,category:['cookies','site-data','site-permissions','passwords','autofill'].includes(kind)?'browser-accounts':'browser-activity',source,profile:profile.name,browser:browser.process,paths:locations.filter((target)=>!isScanPathExcluded(target,context.excludedPaths)),excludedPaths:context.excludedPaths,risk:['passwords','autofill'].includes(kind)?'sensitive':['cookies','site-data','site-permissions'].includes(kind)?'account':['sessions','top-sites'].includes(kind)?'recent':'low',supportsRange,recommended:['history','search','downloads','cache','favicons','shortcuts'].includes(kind)})
      const database=(kind:PrivacyKind,filename:string,spec:SqlSpec,supportsRange=Boolean(spec.time)):void=>{add(sqlResource(definition(kind,[paths.join(profile.root,filename)],supportsRange),spec))}
      const files=(kind:PrivacyKind,locations:string[]):void=>{add(privacyFileResource(definition(kind,locations,false)))}
      if(browser.family==='chromium'){
        const time={column:'visit_time',family:browser.family}
        database('history','History',{table:'visits',required:{visits:['id','url','visit_time'],urls:['id','url','title']},time,records:`SELECT visits.id AS id,COALESCE(NULLIF(urls.title,''),urls.url) AS title,urls.url AS url,${timestamp('visits.visit_time','chromium')} AS timestamp FROM visits JOIN urls ON urls.id=visits.url WHERE visits.rowid IN ($IDS) ORDER BY visits.visit_time DESC,visits.id DESC`,related:[{table:'urls',fields:['id','url','title'],where:'id IN (SELECT url FROM visits WHERE rowid IN ($IDS))'},...[['visit_source','id'],['content_annotations','visit_id'],['context_annotations','visit_id'],['clusters_and_visits','visit_id']].map(([table,column])=>({table,requires:[column],where:`${quote(column)} IN ($IDS)`}))],mutate:chromiumVisits})
        database('search','History',{table:'keyword_search_terms',required:{keyword_search_terms:['url_id','term'],urls:['id','url','last_visit_time'],visits:['url']},time:{column:'(SELECT last_visit_time FROM urls WHERE id=keyword_search_terms.url_id)',family:'chromium'},records:`SELECT terms.rowid AS id,terms.term AS title,${timestamp('urls.last_visit_time','chromium')} AS timestamp FROM keyword_search_terms AS terms JOIN urls ON urls.id=terms.url_id WHERE terms.rowid IN ($IDS) ORDER BY urls.last_visit_time DESC,terms.rowid DESC`,related:[{table:'urls',fields:['id','url'],where:'id IN (SELECT url_id FROM keyword_search_terms WHERE rowid IN ($IDS))'}],mutate:chromiumSearch})
        database('downloads','History',{table:'downloads',required:{downloads:['id','target_path','start_time'],downloads_url_chains:['id','url']},time:{column:'start_time',family:'chromium'},records:`SELECT rowid AS id,target_path AS title,target_path AS path,${timestamp('start_time','chromium')} AS timestamp FROM downloads WHERE rowid IN ($IDS) ORDER BY start_time DESC,rowid DESC`,related:[{table:'downloads_url_chains',where:'id IN ($IDS)'}],mutate:(database)=>{optionalDelete(database,'downloads_url_chains','id');database.exec(`DELETE FROM downloads WHERE rowid IN (${keys})`)}})
        const cookie=!isScanPathExcluded(paths.join(profile.root,'Network/Cookies'),context.excludedPaths)&&await fileExists(paths.join(profile.root,'Network/Cookies'))?'Network/Cookies':'Cookies'
        database('cookies',cookie,{table:'cookies',required:{cookies:['host_key','last_access_utc']},time:{column:'last_access_utc',family:'chromium'},grouped:true,records:'SELECT host_key AS id,host_key AS title,COUNT(*) AS count FROM cookies WHERE rowid IN ($IDS) GROUP BY host_key ORDER BY COUNT(*) DESC,host_key'})
        database('passwords','Login Data',{table:'logins',required:{logins:['origin_url']},grouped:true,records:'SELECT origin_url AS id,origin_url AS title,origin_url AS url,COUNT(*) AS count FROM logins WHERE rowid IN ($IDS) GROUP BY origin_url ORDER BY origin_url',related:['password_notes','insecure_credentials'].map((table)=>({table,requires:['parent_id'],where:'parent_id IN ($IDS)'})),mutate:(database)=>{for(const table of ['password_notes','insecure_credentials'])optionalDelete(database,table,'parent_id');database.exec(`DELETE FROM logins WHERE rowid IN (${keys})`)}})
        database('autofill','Web Data',{table:'autofill',required:{autofill:['name']},grouped:true,records:'SELECT name AS id,name AS title,COUNT(*) AS count FROM autofill WHERE rowid IN ($IDS) GROUP BY name ORDER BY name'})
        database('top-sites','Top Sites',{table:'top_sites',required:{top_sites:['url','title']},records:"SELECT rowid AS id,COALESCE(NULLIF(title,''),url) AS title,url FROM top_sites WHERE rowid IN ($IDS) ORDER BY rowid"})
        database('shortcuts','Shortcuts',{table:'omni_box_shortcuts',required:{omni_box_shortcuts:['text','url','last_access_time']},time:{column:'last_access_time',family:'chromium'},records:`SELECT rowid AS id,text AS title,url,${timestamp('last_access_time','chromium')} AS timestamp FROM omni_box_shortcuts WHERE rowid IN ($IDS) ORDER BY last_access_time DESC,rowid DESC`})
        database('favicons','Favicons',{table:'icon_mapping',required:{icon_mapping:['page_url','icon_id'],favicons:['id'],favicon_bitmaps:['icon_id']},grouped:true,records:'SELECT page_url AS id,page_url AS title,page_url AS url,COUNT(*) AS count FROM icon_mapping WHERE rowid IN ($IDS) GROUP BY page_url ORDER BY page_url',related:[{table:'favicons',where:'id IN (SELECT icon_id FROM icon_mapping WHERE rowid IN ($IDS))'},{table:'favicon_bitmaps',where:'icon_id IN (SELECT icon_id FROM icon_mapping WHERE rowid IN ($IDS))'}],mutate:(database)=>{database.exec(`CREATE TEMP TABLE diskcollie_privacy_icons(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO diskcollie_privacy_icons SELECT icon_id FROM icon_mapping WHERE rowid IN (${keys}); DELETE FROM icon_mapping WHERE rowid IN (${keys}); DELETE FROM favicon_bitmaps WHERE icon_id IN (SELECT id FROM temp.diskcollie_privacy_icons) AND NOT EXISTS(SELECT 1 FROM icon_mapping WHERE icon_mapping.icon_id=favicon_bitmaps.icon_id); DELETE FROM favicons WHERE id IN (SELECT id FROM temp.diskcollie_privacy_icons) AND NOT EXISTS(SELECT 1 FROM icon_mapping WHERE icon_mapping.icon_id=favicons.id)`)}})
        add(chromiumPermissions(definition('site-permissions',[paths.join(profile.root,'Preferences')],false)))
        files('sessions',['Sessions','Current Session','Current Tabs','Last Session','Last Tabs'].map((name)=>paths.join(profile.root,name)))
        const cacheNames=['Cache','Code Cache','GPUCache','DawnCache','DawnGraphiteCache','DawnWebGPUCache']
        files('cache',[...cacheNames.map((name)=>paths.join(profile.root,name)),...(browser.cacheRoot?cacheNames.map((name)=>paths.join(browser.cacheRoot!,...(profile.id==='Root'?[]:[profile.id]),name)):[])])
        files('site-data',['Local Storage','IndexedDB','Service Worker','WebStorage'].map((name)=>paths.join(profile.root,name)))
      }else if(browser.family==='firefox'){
        const visit=(downloads:boolean):SqlSpec=>({table:'moz_historyvisits',required:{moz_historyvisits:['id','place_id','visit_date','visit_type'],moz_places:['id','url','title'],moz_bookmarks:['fk']},where:`visit_type${downloads?'=':'<>'}7`,time:{column:'visit_date',family:'firefox'},records:`SELECT visits.id AS id,COALESCE(NULLIF(places.title,''),places.url) AS title,places.url AS url,${timestamp('visits.visit_date','firefox')} AS timestamp FROM moz_historyvisits AS visits JOIN moz_places AS places ON places.id=visits.place_id WHERE visits.rowid IN ($IDS) ORDER BY visits.visit_date DESC,visits.id DESC`,related:[{table:'moz_places',fields:['id','url','title'],where:'id IN (SELECT place_id FROM moz_historyvisits WHERE rowid IN ($IDS))'}],mutate:firefoxVisits})
        database('history','places.sqlite',visit(false));database('downloads','places.sqlite',visit(true))
        database('cookies','cookies.sqlite',{table:'moz_cookies',required:{moz_cookies:['host','lastAccessed']},time:{column:'lastAccessed',family:'firefox'},grouped:true,records:'SELECT host AS id,host AS title,COUNT(*) AS count FROM moz_cookies WHERE rowid IN ($IDS) GROUP BY host ORDER BY COUNT(*) DESC,host'})
        database('site-permissions','permissions.sqlite',{table:'moz_perms',required:{moz_perms:['origin','type']},records:"SELECT rowid AS id,origin AS title,type AS subtitle FROM moz_perms WHERE rowid IN ($IDS) ORDER BY origin,type"})
        database('autofill','formhistory.sqlite',{table:'moz_formhistory',required:{moz_formhistory:['fieldname']},grouped:true,records:'SELECT fieldname AS id,fieldname AS title,COUNT(*) AS count FROM moz_formhistory WHERE rowid IN ($IDS) GROUP BY fieldname ORDER BY fieldname'})
        add(firefoxPasswords(definition('passwords',[paths.join(profile.root,'logins.json')],false)))
        files('sessions',['sessionstore-backups','sessionstore.jsonlz4','sessionstore.js'].map((name)=>paths.join(profile.root,name)))
        files('site-data',[paths.join(profile.root,'storage/default')])
        files('cache',[paths.join(profile.root,'cache2'),...(browser.cacheRoot?[paths.join(browser.cacheRoot,profile.id,'cache2')]:[])])
      }else{
        database('history','History.db',{table:'history_visits',required:{history_visits:['id','history_item','visit_time'],history_items:['id','url']},time:{column:'visit_time',family:'safari'},records:`SELECT visits.id AS id,items.url AS title,items.url AS url,${timestamp('visits.visit_time','safari')} AS timestamp FROM history_visits AS visits JOIN history_items AS items ON items.id=visits.history_item WHERE visits.rowid IN ($IDS) ORDER BY visits.visit_time DESC,visits.id DESC`,related:[{table:'history_items',fields:['id','url'],where:'id IN (SELECT history_item FROM history_visits WHERE rowid IN ($IDS))'}],mutate:safariVisits})
        files('sessions',[paths.join(profile.root,'LastSession.plist')])
        files('cache',[paths.join(context.home,'Library/Caches/com.apple.Safari'),paths.join(context.home,'Library/Caches/com.apple.WebKit.Networking')])
      }
    }
  }
  return resources
}
