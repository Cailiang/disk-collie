import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {browserPrivacyResources} from './privacy-browser'
import type {PrivacyContext,PrivacyResource} from './privacy-resource'
import * as privacyPaths from './privacy-resource'

const filesystemAccess=vi.hoisted(()=>({deniedDirectories:new Set<string>()}))
vi.mock('node:fs/promises',async(importOriginal)=>{
  const original=await importOriginal<typeof import('node:fs/promises')>()
  return {...original,readdir:(...args:Parameters<typeof original.readdir>)=>filesystemAccess.deniedDirectories.has(String(args[0]))?Promise.reject(Object.assign(new Error('Permission denied'),{code:'EACCES'})):original.readdir(...args)}
})

const {DatabaseSync}=require('node:sqlite') as typeof import('node:sqlite')
const NOW=Date.UTC(2026,10,26,12),OLD=NOW-10*86400000,RECENT=NOW-1800000,FUTURE=NOW+86400000
const chromeTime=(ms:number)=>(BigInt(ms)+11644473600000n)*1000n
const firefoxTime=(ms:number)=>BigInt(ms)*1000n
const safariTime=(ms:number)=>ms/1000-978307200
let home:string,chrome:string,context:PrivacyContext

beforeEach(async()=>{
  home=await realpath(await mkdtemp(path.join(os.tmpdir(),'diskcollie-browser-privacy-')))
  chrome=path.join(home,'Library/Application Support/Google/Chrome/Default')
  await mkdir(chrome,{recursive:true})
  context={platform:'darwin',home,env:{},applications:[]}
})
afterEach(async()=>{filesystemAccess.deniedDirectories.clear();vi.restoreAllMocks();await rm(home,{recursive:true,force:true})})

async function resource(key:string):Promise<PrivacyResource>{
  const found=(await browserPrivacyResources(context)).find((entry)=>entry.key===key)
  expect(found,`Expected resource ${key}`).toBeDefined()
  return found!
}
function chromeHistory():void{
  const database=new DatabaseSync(path.join(chrome,'History'))
  database.exec(`
    CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,last_visit_time INTEGER,visit_count INTEGER,typed_count INTEGER);
    CREATE TABLE visits(id INTEGER PRIMARY KEY,url INTEGER,visit_time INTEGER,from_visit INTEGER,opener_visit INTEGER,transition INTEGER);
    CREATE TABLE keyword_search_terms(keyword_id INTEGER,url_id INTEGER,term TEXT);
    CREATE TABLE downloads(id INTEGER PRIMARY KEY,target_path TEXT,start_time INTEGER);
    CREATE TABLE downloads_url_chains(id INTEGER,chain_index INTEGER,url TEXT);
    CREATE TABLE visit_source(id INTEGER,source INTEGER);
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO meta VALUES('version','999');
  `)
  for(const [index,time] of [OLD,RECENT,FUTURE].entries()){
    const id=index+1
    database.prepare('INSERT INTO urls VALUES(?,?,?,?,1,1)').run(id,`https://site${id}.example/`,`Visit ${id}`,chromeTime(time))
    database.prepare('INSERT INTO visits VALUES(?,?,?,0,0,1)').run(id,id,chromeTime(time))
    database.prepare('INSERT INTO visit_source VALUES(?,0)').run(id)
    database.prepare('INSERT INTO keyword_search_terms VALUES(?,?,?)').run(id,id,`search ${id}`)
    database.prepare('INSERT INTO downloads VALUES(?,?,?)').run(id,path.join(home,`download-${id}.zip`),chromeTime(time))
    database.prepare('INSERT INTO downloads_url_chains VALUES(?,0,?)').run(id,`https://files.example/${id}.zip`)
  }
  database.close()
}
function query(filename:string,sql:string):Array<Record<string,unknown>>{
  const database=new DatabaseSync(filename,{readOnly:true})
  try{return database.prepare(sql).all()}finally{database.close()}
}

describe('browser privacy SQLite adapters',()=>{
  it('skips excluded browser profiles and individual stores without reading their metadata',async()=>{
    chromeHistory()
    const history=path.join(chrome,'History'),original=privacyPaths.privacyPathSnapshot
    context.excludedPaths=[history,path.join(chrome,'Network')]
    const inspect=vi.spyOn(privacyPaths,'privacyPathSnapshot').mockImplementation(async(target)=>{
      if(target===history||target.startsWith(path.join(chrome,'Network')+path.sep))throw new Error('Excluded metadata must not be read')
      return original(target)
    })
    const resources=await browserPrivacyResources(context)
    expect(resources.some((entry)=>entry.key==='chrome:Default:history'||entry.key==='chrome:Default:search'||entry.key==='chrome:Default:downloads')).toBe(false)
    expect(inspect.mock.calls.some(([target])=>target===history||target.startsWith(path.join(chrome,'Network')+path.sep))).toBe(false)
    context.excludedPaths=[chrome]
    expect((await browserPrivacyResources(context)).some((entry)=>entry.source.key==='chrome')).toBe(false)
  })
  it('keeps Safari discoverable when its root is denied even without an application inventory entry',async()=>{
    const safari=path.join(home,'Library/Safari'),original=privacyPaths.privacyPathSnapshot
    const cache=path.join(home,'Library/Caches/com.apple.Safari');await mkdir(cache,{recursive:true})
    const cacheFile=path.join(cache,'response');await writeFile(cacheFile,'cache response');await utimes(cacheFile,new Date(OLD),new Date(OLD))
    vi.spyOn(privacyPaths,'privacyPathSnapshot').mockImplementation(async(target)=>{
      if(target===safari||target.startsWith(safari+path.sep))throw Object.assign(new Error('Operation not permitted'),{code:'EPERM'})
      return original(target)
    })
    const resources=(await browserPrivacyResources(context)).filter((entry)=>entry.source.key==='safari')
    expect(resources.map((entry)=>entry.kind)).toEqual(['history','sessions','cache'])
    const history=resources.find((entry)=>entry.kind==='history')!,snapshot=await history.scan('all',NOW)
    expect(snapshot.capability).toBe('permission-required');expect(snapshot.count).toBeNull()
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceUnavailable')
    expect((await resources.find((entry)=>entry.kind==='cache')!.scan('all',NOW)).capability).toBe('ready')
  })

  it.each(['chrome','firefox'])('retains %s permission failures without inventing root profiles or claiming an unknown profile is empty',async(browser)=>{
    const root=browser==='chrome'?path.dirname(chrome):path.join(home,'Library/Application Support/Firefox/Profiles')
    filesystemAccess.deniedDirectories.add(root)
    if(browser==='chrome')await rm(chrome,{recursive:true})
    const resources=(await browserPrivacyResources(context)).filter((entry)=>entry.source.key===browser)
    expect(resources.length).toBeGreaterThan(0);expect(resources.every((entry)=>entry.key.startsWith(`${browser}:Default:`))).toBe(true)
    const history=resources.find((entry)=>entry.kind==='history')!
    expect((await history.scan('all',NOW)).capability).toBe('permission-required')
  })

  it('scopes Chromium history by time and freezes the upper scan bound',async()=>{
    chromeHistory()
    const history=await resource('chrome:Default:history')
    const snapshot=await history.scan('week',NOW)
    expect(snapshot.capability).toBe('ready')
    expect(snapshot.count).toBe(1)
    expect(snapshot.size).toBeGreaterThan(0)
    expect(await snapshot.preview(0,100)).toEqual([expect.objectContaining({title:'Visit 2',timestamp:new Date(RECENT).toISOString()})])
    await snapshot.validate()
    const outcome=await snapshot.clean()
    expect(outcome.count).toBe(1)
    // Deleting SQLite rows does not itself promise that filesystem blocks shrink.
    expect(outcome.size).toBe(0)
    expect(query(path.join(chrome,'History'),'SELECT id FROM visits ORDER BY id')).toEqual([{id:1},{id:3}])
    expect(query(path.join(chrome,'History'),'SELECT id FROM downloads ORDER BY id')).toHaveLength(3)
    expect(query(path.join(chrome,'History'),'SELECT term FROM keyword_search_terms ORDER BY rowid')).toHaveLength(3)
  })

  it('prevalidates shared DB resources, then independently clears selected traces and preserves schema and downloaded files',async()=>{
    chromeHistory()
    await writeFile(path.join(home,'download-2.zip'),'downloaded payload')
    await writeFile(path.join(chrome,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{children:[{url:'https://site2.example/'}]}}}))
    const snapshots=await Promise.all(['history','search','downloads'].map(async(kind)=>(await resource(`chrome:Default:${kind}`)).scan('all',NOW)))
    expect(snapshots.map((snapshot)=>snapshot.count)).toEqual([2,2,2])
    for(const snapshot of snapshots)await snapshot.validate()
    for(const snapshot of snapshots)expect((await snapshot.clean()).count).toBe(2)
    const filename=path.join(chrome,'History')
    expect(query(filename,'SELECT id FROM visits')).toEqual([{id:3}])
    expect(query(filename,'SELECT term FROM keyword_search_terms')).toEqual([{term:'search 3'}])
    expect(query(filename,'SELECT id FROM downloads')).toEqual([{id:3}])
    expect(query(filename,'SELECT id FROM downloads_url_chains')).toEqual([{id:3}])
    expect(query(filename,'SELECT id FROM visit_source')).toEqual([{id:3}])
    expect(query(filename,'SELECT id FROM urls')).toEqual([{id:3}])
    expect(query(filename,'SELECT value FROM meta')).toEqual([{value:'999'}])
    expect(await readFile(path.join(home,'download-2.zip'),'utf8')).toBe('downloaded payload')
    expect(await readFile(path.join(chrome,'Bookmarks'),'utf8')).toContain('https://site2.example/')
  })

  it('reads committed records in a live WAL without modifying browser records',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),writer=new DatabaseSync(filename)
    try{
      writer.exec('PRAGMA journal_mode=WAL')
      writer.prepare('INSERT INTO urls VALUES(4,?,?,?,1,1)').run('https://wal.example/','WAL record',chromeTime(RECENT))
      writer.prepare('INSERT INTO visits VALUES(4,4,?,0,0,1)').run(chromeTime(RECENT))
      const snapshot=await (await resource('chrome:Default:history')).scan('all',NOW)
      expect(snapshot.count).toBe(3)
      expect((await snapshot.preview(0,100)).map((entry)=>entry.title)).toContain('WAL record')
      await snapshot.validate()
      expect(query(filename,'SELECT id FROM visits')).toHaveLength(4)
    }finally{writer.close()}
  })

  it('handles real Chromium WITHOUT ROWID relations when scanning, previewing and clearing history',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),writer=new DatabaseSync(filename)
    writer.exec(`CREATE TABLE clusters_and_visits(cluster_id INTEGER NOT NULL,visit_id INTEGER NOT NULL,score NUMERIC NOT NULL,PRIMARY KEY(cluster_id,visit_id)) WITHOUT ROWID;
      INSERT INTO clusters_and_visits VALUES(10,1,0.1),(20,2,0.2),(20,3,0.3);`)
    writer.close()
    const snapshot=await (await resource('chrome:Default:history')).scan('week',NOW)
    expect(snapshot.capability).toBe('ready');expect(snapshot.count).toBe(1)
    expect(await snapshot.preview(0,100)).toEqual([expect.objectContaining({title:'Visit 2'})])
    await snapshot.validate();expect((await snapshot.clean()).count).toBe(1)
    expect(query(filename,'SELECT cluster_id,visit_id FROM clusters_and_visits ORDER BY cluster_id,visit_id')).toEqual([{cluster_id:10,visit_id:1},{cluster_id:20,visit_id:3}])
  })

  it('reads committed history, searches and downloads through an isolated rollback-journal copy while Chrome holds an exclusive lock',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),writer=new DatabaseSync(filename)
    const privateDirectories=async()=>new Set((await readdir(os.tmpdir())).filter((name)=>name.startsWith('diskcollie-private-browser-')))
    const beforeDirectories=await privateDirectories()
    try{
      writer.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA cache_size=1; BEGIN EXCLUSIVE; UPDATE urls SET title='uncommitted private title' WHERE id=2;")
      // Force dirty pages into the rollback journal, so copying only the main file would expose uncommitted data.
      const insert=writer.prepare('INSERT INTO meta VALUES(?,?)')
      for(let index=0;index<30;index++)insert.run(`uncommitted-${index}`,'x'.repeat(4096))
      const original=await readFile(filename),journal=await readFile(filename+'-journal')
      for(const [kind,title] of [['history','Visit 2'],['search','search 2'],['downloads',path.join(home,'download-2.zip')]] as const){
        const snapshot=await (await resource(`chrome:Default:${kind}`)).scan('all',NOW)
        expect(snapshot.capability).toBe('ready');expect(snapshot.count).toBe(2)
        expect((await snapshot.preview(0,100)).map((entry)=>entry.title)).toContain(title)
        if(kind==='history')await expect(snapshot.clean()).rejects.toThrow(/locked/i)
      }
      expect(await readFile(filename)).toEqual(original);expect(await readFile(filename+'-journal')).toEqual(journal)
      expect(writer.prepare('SELECT title FROM urls WHERE id=2').get()!.title).toBe('uncommitted private title')
      expect(await privateDirectories()).toEqual(beforeDirectories)
    }finally{writer.exec('ROLLBACK');writer.close()}
    expect(query(filename,'SELECT title FROM urls WHERE id=2')).toEqual([{title:'Visit 2'}])
    expect(query(filename,"SELECT COUNT(*) AS count FROM meta WHERE key LIKE 'uncommitted-%'")).toEqual([{count:0}])
  })

  it('rejects sources changed after scanning and rejects symbolic links',async()=>{
    chromeHistory()
    const history=await resource('chrome:Default:history'),snapshot=await history.scan('all',NOW)
    const filename=path.join(chrome,'History'),writer=new DatabaseSync(filename)
    writer.exec("UPDATE meta SET value='changed'");writer.close()
    await expect(snapshot.validate()).rejects.toThrow('privacy.sourceChanged')
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    const destination=path.join(home,'actual-history')
    await writeFile(destination,await readFile(filename));await rm(filename);await symlink(destination,filename)
    expect((await history.scan('all',NOW)).capability).toBe('unavailable')
    expect(query(destination,'SELECT id FROM visits')).toHaveLength(3)
  })

  it('rejects in-place row changes after successful prevalidation even when row IDs and counts remain identical',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),snapshot=await (await resource('chrome:Default:history')).scan('all',NOW)
    await snapshot.validate()
    const writer=new DatabaseSync(filename)
    writer.prepare('UPDATE visits SET visit_time=? WHERE id=2').run(chromeTime(RECENT+1000));writer.close()
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(query(filename,'SELECT id FROM visits ORDER BY id')).toEqual([{id:1},{id:2},{id:3}])
    expect(query(filename,'SELECT id FROM visit_source ORDER BY id')).toEqual([{id:1},{id:2},{id:3}])
  })

  it('keeps URLs with existing visits when clearing only search records',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),snapshot=await (await resource('chrome:Default:search')).scan('all',NOW)
    await snapshot.validate();await snapshot.clean()
    expect(query(filename,'SELECT term FROM keyword_search_terms')).toEqual([{term:'search 3'}])
    expect(query(filename,'SELECT id FROM urls ORDER BY id')).toEqual([{id:1},{id:2},{id:3}])
    expect(query(filename,'SELECT id FROM visits ORDER BY id')).toEqual([{id:1},{id:2},{id:3}])
  })

  it('rejects changed related URL contents after prevalidation while preserving the database',async()=>{
    chromeHistory()
    const filename=path.join(chrome,'History'),snapshot=await (await resource('chrome:Default:history')).scan('all',NOW)
    await snapshot.validate()
    const writer=new DatabaseSync(filename)
    writer.exec("UPDATE urls SET url='https://replacement.example/' WHERE id=2");writer.close()
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(query(filename,'SELECT id FROM visits ORDER BY id')).toEqual([{id:1},{id:2},{id:3}])
    expect(query(filename,'SELECT url FROM urls WHERE id=2')).toEqual([{url:'https://replacement.example/'}])
  })

  it('previews only cookie domains, password sites and autofill field names, preserving unrelated payment data',async()=>{
    const cookies=new DatabaseSync(path.join(chrome,'Cookies'))
    cookies.exec('CREATE TABLE cookies(host_key TEXT,last_access_utc INTEGER,name TEXT,value TEXT,encrypted_value BLOB)')
    cookies.prepare('INSERT INTO cookies VALUES(?,?,?,?,?)').run('.example.com',chromeTime(RECENT),'secret-cookie-name','SECRET_COOKIE_VALUE',Buffer.from('SECRET_ENCRYPTED_COOKIE'))
    cookies.close()
    const passwords=new DatabaseSync(path.join(chrome,'Login Data'))
    passwords.exec('CREATE TABLE logins(id INTEGER PRIMARY KEY,origin_url TEXT,username_value TEXT,password_value BLOB); CREATE TABLE password_notes(parent_id INTEGER,value TEXT); CREATE TABLE insecure_credentials(parent_id INTEGER,insecurity_type INTEGER)')
    passwords.prepare('INSERT INTO logins VALUES(1,?,?,?)').run('https://USERINFO:SECRET_PASS@example.com/login?token=SECRET_TOKEN','SECRET_USERNAME',Buffer.from('SECRET_PASSWORD'))
    passwords.exec("INSERT INTO password_notes VALUES(1,'SECRET_NOTE'); INSERT INTO insecure_credentials VALUES(1,0)")
    passwords.close()
    const forms=new DatabaseSync(path.join(chrome,'Web Data'))
    forms.exec("CREATE TABLE autofill(name TEXT,value TEXT); INSERT INTO autofill VALUES('email','SECRET_EMAIL'); CREATE TABLE credit_cards(number TEXT); INSERT INTO credit_cards VALUES('SECRET_CARD'); CREATE TABLE autofill_profiles(name TEXT); INSERT INTO autofill_profiles VALUES('SECRET_ADDRESS')")
    forms.close()
    const snapshots=await Promise.all(['cookies','passwords','autofill'].map(async(kind)=>(await resource(`chrome:Default:${kind}`)).scan('all',NOW)))
    const previews=await Promise.all(snapshots.map((snapshot)=>snapshot.preview(0,100)))
    const json=JSON.stringify(previews)
    expect(json).not.toMatch(/SECRET|USERINFO|secret-cookie-name/)
    expect(previews[0]).toEqual([expect.objectContaining({title:'.example.com',count:1})])
    expect(previews[1]).toEqual([expect.objectContaining({title:'https://example.com',url:'https://example.com',count:1})])
    expect(previews[2]).toEqual([expect.objectContaining({title:'email',count:1})])
    await snapshots[2].validate();await snapshots[2].clean()
    expect(query(path.join(chrome,'Web Data'),'SELECT * FROM autofill')).toEqual([])
    expect(query(path.join(chrome,'Web Data'),'SELECT * FROM credit_cards')).toEqual([{number:'SECRET_CARD'}])
    expect(query(path.join(chrome,'Web Data'),'SELECT * FROM autofill_profiles')).toEqual([{name:'SECRET_ADDRESS'}])
    await snapshots[1].validate();await snapshots[1].clean()
    expect(query(path.join(chrome,'Login Data'),'SELECT * FROM logins')).toEqual([])
    expect(query(path.join(chrome,'Login Data'),'SELECT * FROM password_notes')).toEqual([])
    expect(query(path.join(chrome,'Login Data'),'SELECT * FROM insecure_credentials')).toEqual([])
  })

  it('does not pretend untimestamped records support a time range',async()=>{
    for(const kind of ['passwords','autofill','site-permissions','cache','sessions','site-data','top-sites','favicons']){
      const snapshot=await (await resource(`chrome:Default:${kind}`)).scan('hour',NOW)
      expect(snapshot.capability).toBe('range-unsupported')
      expect(snapshot.count).toBeNull()
      await expect(snapshot.clean()).rejects.toThrow('privacy.sourceUnavailable')
    }
  })

  it('redacts malformed password origins without returning credentials, paths or query tokens',async()=>{
    const database=new DatabaseSync(path.join(chrome,'Login Data'))
    database.exec('CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB)')
    for(const origin of ['bare-site.example:8443/private/SECRET_PATH?token=SECRET_QUERY','SECRET_USER:SECRET_PASS@account.example/private?SECRET_QUERY','unparseable SECRET_CREDENTIAL_TEXT','SECRET_STANDALONE_VALUE'])database.prepare('INSERT INTO logins VALUES(?,?,?)').run(origin,'SECRET_USERNAME',Buffer.from('SECRET_PASSWORD'))
    database.close()
    const snapshot=await (await resource('chrome:Default:passwords')).scan('all',NOW),records=await snapshot.preview(0,100)
    expect(records.map((entry)=>entry.title)).toEqual(expect.arrayContaining(['bare-site.example:8443','account.example','—']))
    expect(JSON.stringify(records)).not.toMatch(/secret|\/private|\?token|@/i)
    const profile=path.join(home,'Library/Application Support/Firefox/Profiles/personal.default');await mkdir(profile,{recursive:true})
    await writeFile(path.join(profile,'logins.json'),JSON.stringify({logins:[{hostname:'firefox.example/private/SECRET_PATH?token=SECRET_QUERY',encryptedUsername:'SECRET_USERNAME'},{hostname:'invalid SECRET_TEXT'}]}))
    const firefox=await (await resource('firefox:personal.default:passwords')).scan('all',NOW),firefoxRecords=await firefox.preview(0,100)
    expect(firefoxRecords.map((entry)=>entry.title)).toEqual(expect.arrayContaining(['firefox.example','—']))
    expect(firefoxRecords.every((entry)=>entry.url===undefined)).toBe(true)
    expect(JSON.stringify(firefoxRecords)).not.toMatch(/secret|\/private|\?token/i)
  })

  it('guards related favicon bytes before removing mappings and their orphaned icon data',async()=>{
    const filename=path.join(chrome,'Favicons'),database=new DatabaseSync(filename)
    database.exec("CREATE TABLE icon_mapping(id INTEGER PRIMARY KEY,page_url TEXT,icon_id INTEGER); CREATE TABLE favicons(id INTEGER PRIMARY KEY,url TEXT); CREATE TABLE favicon_bitmaps(id INTEGER PRIMARY KEY,icon_id INTEGER,image_data BLOB); CREATE TABLE meta(value TEXT); INSERT INTO meta VALUES('keep'); INSERT INTO icon_mapping VALUES(1,'https://example.com',1); INSERT INTO favicons VALUES(1,'https://example.com/favicon.ico')")
    database.prepare('INSERT INTO favicon_bitmaps VALUES(1,1,?)').run(Buffer.from('original icon'));database.close()
    const adapter=await resource('chrome:Default:favicons'),snapshot=await adapter.scan('all',NOW)
    await snapshot.validate()
    const writer=new DatabaseSync(filename)
    writer.prepare('UPDATE favicon_bitmaps SET image_data=? WHERE id=1').run(Buffer.from('new icon'));writer.close()
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(query(filename,'SELECT id FROM icon_mapping')).toEqual([{id:1}])
    const refreshed=await adapter.scan('all',NOW);await refreshed.validate();await refreshed.clean()
    expect(query(filename,'SELECT id FROM icon_mapping')).toEqual([])
    expect(query(filename,'SELECT id FROM favicons')).toEqual([])
    expect(query(filename,'SELECT id FROM favicon_bitmaps')).toEqual([])
    expect(query(filename,'SELECT value FROM meta')).toEqual([{value:'keep'}])
  })

  it('clears only Chromium site permission exceptions and retains all unrelated preferences',async()=>{
    const filename=path.join(chrome,'Preferences')
    const preferences={profile:{name:'Personal',content_settings:{exceptions:{notifications:{'https://notify.example:443,*':{setting:1}},geolocation:{'https://maps.example:443,*':{setting:2}}},pattern_pairs:{keep:true}}},session:{restore_on_startup:1}}
    await writeFile(filename,JSON.stringify(preferences))
    const snapshot=await (await resource('chrome:Default:site-permissions')).scan('all',NOW)
    expect(snapshot.count).toBe(2)
    expect((await snapshot.preview(0,100)).map((entry)=>entry.subtitle)).toEqual(['notifications','geolocation'])
    await snapshot.validate();expect((await snapshot.clean()).count).toBe(2)
    const next=JSON.parse(await readFile(filename,'utf8'))
    expect(next.profile.content_settings.exceptions).toEqual({notifications:{},geolocation:{}})
    expect(next.profile.content_settings.pattern_pairs).toEqual({keep:true})
    expect(next.profile.name).toBe('Personal');expect(next.session).toEqual(preferences.session)
  })

  it('discovers external macOS browser caches and preserves the profile data alongside them',async()=>{
    const cache=path.join(home,'Library/Caches/Google/Chrome/Default/Cache/Cache_Data')
    await mkdir(cache,{recursive:true})
    const filename=path.join(cache,'cache-entry')
    await writeFile(filename,'cached response')
    await utimes(filename,new Date(OLD),new Date(OLD))
    await writeFile(path.join(chrome,'Preferences'),JSON.stringify({profile:{name:'Personal'}}))
    const snapshot=await (await resource('chrome:Default:cache')).scan('all',NOW)
    expect(snapshot.count).toBe(1)
    expect(snapshot.size).toBe(Buffer.byteLength('cached response'))
    expect(await snapshot.preview(0,100)).toEqual([expect.objectContaining({title:'cache-entry',path:filename})])
    await snapshot.validate()
    expect(await snapshot.clean()).toEqual({count:1,size:Buffer.byteLength('cached response'),changed:true,removedPaths:[filename]})
    expect(await readFile(path.join(chrome,'Preferences'),'utf8')).toContain('Personal')
  })

  it('keeps Firefox bookmarks and downloads when clearing browsing visits',async()=>{
    const profile=path.join(home,'Library/Application Support/Firefox/Profiles/personal.default')
    await mkdir(profile,{recursive:true})
    const filename=path.join(profile,'places.sqlite'),database=new DatabaseSync(filename)
    database.exec('CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,foreign_count INTEGER,visit_count INTEGER,last_visit_date INTEGER); CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY,place_id INTEGER,visit_date INTEGER,visit_type INTEGER); CREATE TABLE moz_bookmarks(fk INTEGER)')
    for(const [id,type,foreign] of [[1,1,1],[2,1,0],[3,7,0]]){
      database.prepare('INSERT INTO moz_places VALUES(?,?,?,?,1,?)').run(id,`https://firefox${id}.example/`,`Firefox ${id}`,foreign,firefoxTime(RECENT))
      database.prepare('INSERT INTO moz_historyvisits VALUES(?,?,?,?)').run(id,id,firefoxTime(RECENT),type)
    }
    database.exec('INSERT INTO moz_bookmarks VALUES(1)');database.close()
    const snapshot=await (await resource('firefox:personal.default:history')).scan('week',NOW)
    expect(snapshot.count).toBe(2)
    expect((await snapshot.preview(0,100))[0].timestamp).toBe(new Date(RECENT).toISOString())
    await snapshot.validate();await snapshot.clean()
    expect(query(filename,'SELECT id FROM moz_places ORDER BY id')).toEqual([{id:1},{id:3}])
    expect(query(filename,'SELECT id FROM moz_historyvisits')).toEqual([{id:3}])
    expect(query(filename,'SELECT fk FROM moz_bookmarks')).toEqual([{fk:1}])
    const downloads=await (await resource('firefox:personal.default:downloads')).scan('all',NOW)
    expect(downloads.count).toBe(1)
  })

  it('clears Firefox login entries without exposing credentials or removing key files and metadata',async()=>{
    const profile=path.join(home,'Library/Application Support/Firefox/Profiles/personal.default')
    await mkdir(profile,{recursive:true})
    const filename=path.join(profile,'logins.json')
    await writeFile(filename,JSON.stringify({nextId:9,version:3,disabledHosts:['https://disabled.example'],logins:[{id:8,hostname:'https://SECRET_USER:SECRET_PASS@firefox.example/path?token=SECRET_TOKEN',encryptedUsername:'SECRET_USERNAME',encryptedPassword:'SECRET_PASSWORD'}]}))
    await writeFile(path.join(profile,'key4.db'),'key file must survive')
    const snapshot=await (await resource('firefox:personal.default:passwords')).scan('all',NOW)
    expect(snapshot.count).toBe(1)
    expect(JSON.stringify(await snapshot.preview(0,100))).not.toContain('SECRET')
    await snapshot.validate();expect((await snapshot.clean()).count).toBe(1)
    expect(JSON.parse(await readFile(filename,'utf8'))).toEqual({nextId:9,version:3,disabledHosts:['https://disabled.example'],logins:[]})
    expect(await readFile(path.join(profile,'key4.db'),'utf8')).toBe('key file must survive')
  })

  it('converts Safari timestamps correctly and removes only selected visit items',async()=>{
    const profile=path.join(home,'Library/Safari');await mkdir(profile,{recursive:true})
    const filename=path.join(profile,'History.db'),database=new DatabaseSync(filename)
    database.exec('CREATE TABLE history_items(id INTEGER PRIMARY KEY,url TEXT); CREATE TABLE history_visits(id INTEGER PRIMARY KEY,history_item INTEGER,visit_time REAL); CREATE TABLE metadata(value TEXT); INSERT INTO metadata VALUES(\'keep\')')
    for(const [index,time] of [OLD,RECENT,FUTURE].entries()){
      database.prepare('INSERT INTO history_items VALUES(?,?)').run(index+1,`https://safari${index+1}.example/`)
      database.prepare('INSERT INTO history_visits VALUES(?,?,?)').run(index+1,index+1,safariTime(time))
    }
    database.close()
    const snapshot=await (await resource('safari:Default:history')).scan('hour',NOW)
    expect(snapshot.count).toBe(1)
    expect((await snapshot.preview(0,100))[0].timestamp).toBe(new Date(RECENT).toISOString())
    await snapshot.validate();await snapshot.clean()
    expect(query(filename,'SELECT id FROM history_items ORDER BY id')).toEqual([{id:1},{id:3}])
    expect(query(filename,'SELECT id FROM history_visits ORDER BY id')).toEqual([{id:1},{id:3}])
    expect(query(filename,'SELECT value FROM metadata')).toEqual([{value:'keep'}])
  })
})
