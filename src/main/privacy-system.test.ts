import {chmod,mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

const clipboard=vi.hoisted(()=>({change:7,count:1,scripts:[] as string[],denied:false,nativeBookmarks:false}))
vi.mock('node:child_process',async(importOriginal)=>{
  const original=await importOriginal<typeof import('node:child_process')>()
  const execFile=((command:string,args:string[],options:unknown,callback:(error:Error|null,stdout:string,stderr:string)=>void)=>{
    if(command!=='/usr/bin/osascript')return original.execFile(command,args,options as never,callback)
    const script=args[3]
    if(!script.includes('NSPasteboard')&&(!script.includes('NSURL')||clipboard.nativeBookmarks))return original.execFile(command,args,options as never,callback)
    clipboard.scripts.push(script)
    if(clipboard.denied){callback(Object.assign(new Error('Operation not permitted'),{code:'EPERM'}),'','');return}
    if(script.includes('NSURL')){callback(null,JSON.stringify(JSON.parse(args[4]).map(()=>null)),'');return}
    if(script.includes('clearContents')){
      if(Number(args[4])!==clipboard.change){callback(new Error('privacy.sourceChanged'),'','');return}
      clipboard.count=0;clipboard.change++;callback(null,'cleared','');return
    }
    callback(null,JSON.stringify({change:clipboard.change,count:clipboard.count,formats:1}),'')
  }) as unknown as typeof original.execFile
  Object.defineProperty(execFile,Symbol.for('nodejs.util.promisify.custom'),{value:(command:string,args:string[],options:unknown)=>new Promise((resolve,reject)=>execFile(command,args,options as never,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})))})
  return {...original,execFile}
})
import {systemPrivacyResources} from './privacy-system'
import type {PrivacyContext} from './privacy-resource'

let home:string
const context=(platform:NodeJS.Platform='linux'):PrivacyContext=>({home,platform,applications:[],env:{}})
const fixture=async(relative:string,content:string):Promise<string>=>{const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);return target}
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-privacy-system-')));clipboard.change=7;clipboard.count=1;clipboard.scripts=[];clipboard.denied=false;clipboard.nativeBookmarks=false})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})

describe('real shell and desktop activity records',()=>{
  it('previews actual zsh commands without extended-history metadata and removes only dated records in range',async()=>{
    const now=Date.now(),old=Math.floor((now-8*86400000)/1000),recent=Math.floor((now-10000)/1000)
    const target=await fixture('.zsh_history',`: ${old}:0;echo old\n: ${recent}:2;printf hello\\\nworld\n`)
    const resource=(await systemPrivacyResources(context())).find((entry)=>entry.kind==='shell-history')!
    const snapshot=await resource.scan('week',now)
    expect(snapshot.capability).toBe('ready');expect(snapshot.count).toBe(1)
    const records=await snapshot.preview(0,20);expect(records[0].title).toBe('printf hello\nworld');expect(records[0].timestamp).toBe(new Date(recent*1000).toISOString())
    const outcome=await snapshot.clean();expect(outcome.count).toBe(1);expect(outcome.removedPaths).toBeUndefined()
    expect(await readFile(target,'utf8')).toBe(`: ${old}:0;echo old\n`)
  })
  it('does not invent timestamps for plain bash history and rejects a changed history file',async()=>{
    const target=await fixture('.bash_history','echo first\necho second\n')
    const resource=(await systemPrivacyResources(context())).find((entry)=>entry.kind==='shell-history')!
    expect((await resource.scan('today',Date.now())).capability).toBe('range-unsupported')
    const snapshot=await resource.scan('all',Date.now());expect(snapshot.count).toBe(2)
    expect((await snapshot.preview(0,1))[0].timestamp).toBeUndefined()
    await writeFile(target,'echo first\necho second\necho new\n')
    await expect(snapshot.validate()).rejects.toThrow('privacy.sourceChanged')
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(await readFile(target,'utf8')).toContain('echo new')
  })
  it('freezes the all-time upper bound while keeping genuinely undated shell records selectable',async()=>{
    const now=Date.now(),old=Math.floor((now-10000)/1000),future=Math.floor((now+86400000)/1000)
    const target=await fixture('.zsh_history',`echo undated\n: ${old}:0;echo old\n: ${future}:0;echo future\n`)
    const resource=(await systemPrivacyResources(context())).find((entry)=>entry.kind==='shell-history')!,snapshot=await resource.scan('all',now)
    expect(snapshot.count).toBe(2);expect((await snapshot.preview(0,10)).map((entry)=>entry.title)).toEqual(['echo undated','echo old'])
    await snapshot.clean();expect(await readFile(target,'utf8')).toBe(`: ${future}:0;echo future\n`)
  })
  it('parses bash timestamp groups and fish records without deleting a fish header',async()=>{
    const now=Date.now(),epoch=Math.floor((now-10000)/1000)
    await fixture('.bash_history',`#${epoch}\necho one\necho two\n`)
    const target=await fixture('.local/share/fish/fish_history',`# retained metadata\n- cmd: echo fish\\nnext\n  when: ${epoch}\n  paths:\n    - /tmp/example\n`)
    const resources=(await systemPrivacyResources(context())).filter((entry)=>entry.kind==='shell-history')
    const bash=await resources.find((entry)=>entry.key.includes('bash'))!.scan('hour',now)
    expect(bash.count).toBe(1);expect((await bash.preview(0,10))[0].title).toBe('echo one\necho two')
    const fish=await resources.find((entry)=>entry.key.includes('fish'))!.scan('hour',now)
    expect((await fish.preview(0,10))[0].title).toBe('echo fish\nnext')
    await fish.clean();expect(await readFile(target,'utf8')).toBe('# retained metadata\n')
  })
  it('preserves XBEL metadata and unmatched bookmark records when cleaning a date range',async()=>{
    const now=Date.now(),recent=new Date(now-10000).toISOString(),old=new Date(now-8*86400000).toISOString()
    const target=await fixture('.local/share/recently-used.xbel',`<?xml version="1.0"?><xbel version="1.0"><title>Recent files</title><bookmark href="file:///old.txt" visited="${old}"><title>Old</title></bookmark><bookmark href="file:///new.txt" visited="${recent}"><title>A &amp; B</title></bookmark></xbel>`)
    const resource=(await systemPrivacyResources(context())).find((entry)=>entry.kind==='recent-documents')!,snapshot=await resource.scan('week',now)
    expect(snapshot.count).toBe(1);expect((await snapshot.preview(0,10))[0]).toMatchObject({title:'A & B',url:'file:///new.txt',timestamp:recent})
    await snapshot.clean();const remaining=await readFile(target,'utf8');expect(remaining).toContain('<title>Recent files</title>');expect(remaining).toContain('file:///old.txt');expect(remaining).not.toContain('file:///new.txt')
  })
  it('uses only allowlisted Code activity directories and leaves settings and documents intact',async()=>{
    const history=await fixture('.config/Code/User/History/entry.json','edit history'),settings=await fixture('.config/Code/User/settings.json','{"editor.fontSize":14}'),document=await fixture('Documents/example.txt','my document')
    const resources=await systemPrivacyResources(context()),resource=resources.find((entry)=>entry.kind==='app-edit-history')!,snapshot=await resource.scan('all',Date.now()+1000)
    expect(snapshot.count).toBe(1);expect((await snapshot.clean()).removedPaths).toEqual([history]);expect(await readFile(settings,'utf8')).toContain('editor.fontSize');expect(await readFile(document,'utf8')).toBe('my document')
  })
})

const plistHeader='<?xml version="1.0"?><plist version="1.0">'
const recentArchive=():string=>plistHeader+`<dict><key>$version</key><integer>100000</integer><key>$archiver</key><string>NSKeyedArchiver</string><key>$top</key><dict><key>root</key><dict><key>CF$UID</key><integer>1</integer></dict></dict><key>$objects</key><array><string>$null</string><dict><key>NS.keys</key><array><dict><key>CF$UID</key><integer>2</integer></dict><dict><key>CF$UID</key><integer>3</integer></dict></array><key>NS.objects</key><array><dict><key>CF$UID</key><integer>4</integer></dict><dict><key>CF$UID</key><integer>5</integer></dict></array><key>$class</key><dict><key>CF$UID</key><integer>7</integer></dict></dict><string>items</string><string>properties</string><dict><key>NS.objects</key><array><dict><key>CF$UID</key><integer>6</integer></dict></array><key>$class</key><dict><key>CF$UID</key><integer>8</integer></dict></dict><dict><key>retained</key><string>root property</string></dict><dict><key>Name</key><string>Fixture.txt</string><key>Bookmark</key><data>Ym9vaw==</data></dict><dict><key>$classes</key><array><string>NSDictionary</string><string>NSObject</string></array><key>$classname</key><string>NSDictionary</string></dict><dict><key>$classes</key><array><string>NSArray</string><string>NSObject</string></array><key>$classname</key><string>NSArray</string></dict></array></dict></plist>`

describe.skipIf(process.platform!=='darwin')('macOS property list records',()=>{
  it('round-trips an actual Foundation SFL4 archive and native bookmark, retaining non-target properties',async()=>{
    clipboard.nativeBookmarks=true
    const document=await fixture('Documents/Native Fixture.txt','owned fixture'),target=path.join(home,'Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.RecentDocuments.sfl4')
    await mkdir(path.dirname(target),{recursive:true})
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile)
    const create=String.raw`ObjC.import('Foundation');function run(argv){var root=$.NSMutableDictionary.alloc.init;var items=$.NSMutableArray.alloc.init;var item=$.NSMutableDictionary.alloc.init;item.setObjectForKey($('Native Fixture.txt'),$('Name'));var url=$.NSURL.fileURLWithPath($(argv[1]));var bookmark=url.bookmarkDataWithOptionsIncludingResourceValuesForKeysRelativeToURLError(0,undefined,undefined,Ref());if(!bookmark||bookmark.isNil())throw Error('bookmark fixture failed');item.setObjectForKey(bookmark,$('Bookmark'));items.addObject(item);root.setObjectForKey(items,$('items'));root.setObjectForKey($({custom:'retained native property'}),$('properties'));if(!$.NSKeyedArchiver.archiveRootObjectToFile(root,$(argv[0])))throw Error('archive fixture failed');return 'created'}`
    await run('/usr/bin/osascript',['-l','JavaScript','-e',create,target,document],{timeout:15000})
    const resource=(await systemPrivacyResources(context('darwin'))).find((entry)=>entry.kind==='recent-documents')!,snapshot=await resource.scan('all',Date.now())
    expect(snapshot.count).toBe(1);expect(await snapshot.preview(0,10)).toEqual([expect.objectContaining({title:'Native Fixture.txt',path:document,url:new URL('file://'+document).href})])
    await snapshot.validate();await snapshot.clean()
    const verify=String.raw`ObjC.import('Foundation');function run(argv){var root=$.NSKeyedUnarchiver.unarchiveObjectWithFile($(argv[0]));if(!root||root.isNil())throw Error('native decode failed');return JSON.stringify({count:Number(root.objectForKey($('items')).count),property:ObjC.unwrap(root.objectForKey($('properties')).objectForKey($('custom')))})}`
    const {stdout}=await run('/usr/bin/osascript',['-l','JavaScript','-e',verify,target],{timeout:15000})
    expect(JSON.parse(stdout)).toEqual({count:0,property:'retained native property'});expect(await readFile(document,'utf8')).toBe('owned fixture')
  })
  it.each(['sfl2','sfl3','sfl4'])('reads and clears %s records, preserving root properties and archive classes',async(extension)=>{
    const target=await fixture(`Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.RecentDocuments.${extension}`,recentArchive())
    const resource=(await systemPrivacyResources(context('darwin'))).find((entry)=>entry.kind==='recent-documents')!
    expect((await resource.scan('week',Date.now())).capability).toBe('range-unsupported')
    const snapshot=await resource.scan('all',Date.now());expect(snapshot.capability).toBe('ready');expect(snapshot.count).toBe(1)
    expect((await snapshot.preview(0,10))[0].title).toBe('Fixture.txt')
    const outcome=await snapshot.clean();expect(outcome.count).toBe(1);expect(outcome.removedPaths).toBeUndefined()
    expect((await resource.scan('all',Date.now())).count).toBe(0)
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{stdout}=await promisify(execFile)('/usr/bin/plutil',['-convert','xml1','-o','-',target])
    expect(stdout).toContain('root property');expect(stdout).toContain('NSDictionary');expect(stdout).toContain('NSArray');expect(stdout).not.toContain('Fixture.txt');expect(stdout).not.toContain('Ym9vaw==')
  })
  it('finds installed application .sfl4 registries, but does not offer favorites or unrelated archives',async()=>{
    await fixture('Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/com.example.fixture.sfl4',recentArchive())
    await fixture('Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.FavoriteItems.sfl4',recentArchive())
    const ctx=context('darwin');ctx.applications=[{id:'fixture',bundleId:'com.example.fixture',name:'Fixture',version:'1',location:'/Applications/Fixture.app',size:0,protected:false,method:'trash'}]
    const resources=await systemPrivacyResources(ctx),app=resources.find((entry)=>entry.kind==='app-recent')!
    expect(app.source.iconPaths).toEqual(['/Applications/Fixture.app']);expect((await app.scan('all',Date.now())).count).toBe(1);expect(resources.some((entry)=>entry.paths.some((target)=>target.includes('FavoriteItems')))).toBe(false)
  })
  it('clears only selected Finder keys and supports multiple keys in one preferences file',async()=>{
    const target=await fixture('Library/Preferences/com.apple.finder.plist',plistHeader+'<dict><key>SGTRecentFileSearches</key><array><dict><key>name</key><string>fixture search</string><key>values</key><array><string>value</string></array></dict></array><key>GoToFieldHistory</key><array><string>/fixture</string></array><key>ShowPathbar</key><true/></dict></plist>')
    const resources=await systemPrivacyResources(context('darwin')),search=resources.find((entry)=>entry.key==='finder-SGTRecentFileSearches')!,goTo=resources.find((entry)=>entry.key==='finder-GoToFieldHistory')!
    const first=await search.scan('all',Date.now()),second=await goTo.scan('all',Date.now())
    expect((await first.preview(0,10))[0].title).toBe('fixture search');await first.clean();await second.clean()
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{stdout}=await promisify(execFile)('/usr/bin/plutil',['-convert','xml1','-o','-',target])
    expect(stdout).toContain('ShowPathbar');expect(stdout).toContain('<true/>');expect(stdout).not.toContain('fixture search');expect(stdout).not.toContain('/fixture')
  })
  it('reports unreadable recent registries as permission-required instead of empty',async()=>{
    const target=await fixture('Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.RecentDocuments.sfl4',recentArchive())
    const resource=(await systemPrivacyResources(context('darwin'))).find((entry)=>entry.kind==='recent-documents')!
    await chmod(target,0)
    try{const snapshot=await resource.scan('all',Date.now());expect(snapshot.capability).toBe('permission-required');expect(snapshot.count).toBeNull();await expect(snapshot.clean()).rejects.toThrow('privacy.sourceUnavailable')}finally{await chmod(target,0o600)}
  })
})

describe('clipboard privacy boundary',()=>{
  it('uses summary metadata only and refuses to clear newly copied content',async()=>{
    const resource=(await systemPrivacyResources(context('darwin'))).find((entry)=>entry.kind==='clipboard')!,snapshot=await resource.scan('all',Date.now())
    expect(snapshot.count).toBe(1);expect(await snapshot.preview(0,10)).toEqual([{id:'clipboard-summary',title:'Clipboard',count:1}])
    clipboard.change++;await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged');expect(clipboard.count).toBe(1)
    expect(clipboard.scripts.join('\n')).not.toMatch(/readText|readObjects|stringForType|dataForType/)
  })
  it('verifies the clipboard is empty and reports unavailable access explicitly',async()=>{
    const resource=(await systemPrivacyResources(context('darwin'))).find((entry)=>entry.kind==='clipboard')!,snapshot=await resource.scan('all',Date.now())
    expect(await snapshot.clean()).toMatchObject({count:1,changed:true});expect(clipboard.count).toBe(0)
    clipboard.denied=true;expect((await resource.scan('all',Date.now())).capability).toBe('permission-required')
  })
})
