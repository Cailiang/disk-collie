import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {lstat,mkdtemp,mkdir,readFile,realpath,rename,rm,symlink,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {PrivacyCleanupError,privacyFileResource,privacyPathSnapshot,privacySince,validatePrivacyPath,type PrivacyDefinition} from './privacy-resource'

const NOW=Date.UTC(2026,10,26,12),OLD=NOW-10*86400000,RECENT=NOW-1800000,FUTURE=NOW+86400000
let home:string
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-privacy-resource-')))})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function fixture(relative:string,content:string,time=RECENT):Promise<string>{
  const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);await utimes(target,new Date(time),new Date(time));return target
}
function definition(paths:string[],supportsRange=true):PrivacyDefinition{return {key:'fixture-cache',kind:'app-cache',category:'app-activity',source:{key:'fixture',name:'Fixture',bundleIds:[],iconPaths:[]},paths,risk:'low',supportsRange}}

describe('privacy file cleanup boundary',()=>{
  it('derives stable hour/week boundaries and local calendar midnight',()=>{
    expect(privacySince('all',NOW)).toBeNull();expect(privacySince('hour',NOW)).toBe(NOW-3600000);expect(privacySince('week',NOW)).toBe(NOW-7*86400000)
    const midnight=new Date(NOW);midnight.setHours(0,0,0,0)
    expect(privacySince('today',NOW)).toBe(midnight.getTime())
  })

  it('scans only eligible timestamps, previews exact files, and reports their actual removed bytes',async()=>{
    await fixture('cache/old','old',OLD);const recent=await fixture('cache/recent','recent contents');await fixture('cache/future','future',FUTURE)
    const resource=privacyFileResource(definition([path.join(home,'cache')]))
    const snapshot=await resource.scan('week',NOW)
    expect(snapshot).toMatchObject({count:1,size:Buffer.byteLength('recent contents'),capability:'ready',limited:false})
    expect(await snapshot.preview(0,100)).toEqual([{id:recent,title:'recent',subtitle:recent,path:recent,timestamp:new Date(RECENT).toISOString()}])
    await snapshot.validate()
    expect(await snapshot.clean()).toEqual({count:1,size:Buffer.byteLength('recent contents'),changed:true,removedPaths:[recent]})
    expect(await readFile(path.join(home,'cache/old'),'utf8')).toBe('old');expect(await readFile(path.join(home,'cache/future'),'utf8')).toBe('future')
    expect((await lstat(path.join(home,'cache'))).isDirectory()).toBe(true)
  })

  it('never recursively deletes newly created files or unrelated user documents',async()=>{
    const old=await fixture('cache/entry','old cache'),document=await fixture('Documents/report.txt','user document')
    const snapshot=await privacyFileResource(definition([path.join(home,'cache')])).scan('all',NOW)
    const added=await fixture('cache/new-after-scan','new cache')
    await snapshot.validate()
    expect((await snapshot.clean()).removedPaths).toEqual([old])
    expect(await readFile(added,'utf8')).toBe('new cache');expect(await readFile(document,'utf8')).toBe('user document')
  })

  it('does not scan or delete symlinked roots, files, directories, or their destinations',async()=>{
    const target=await fixture('outside/secret','private document'),cache=path.join(home,'cache');await mkdir(cache)
    await symlink(target,path.join(cache,'file-link'));await symlink(path.dirname(target),path.join(cache,'directory-link'))
    await symlink(cache,path.join(home,'cache-link'))
    const snapshot=await privacyFileResource(definition([cache,path.join(home,'cache-link')])).scan('all',NOW)
    expect(snapshot).toMatchObject({count:0,size:0,capability:'empty'})
    await expect(privacyPathSnapshot(path.join(home,'cache-link/file-link'))).rejects.toThrow('privacy.sourceChanged')
    expect(await snapshot.clean()).toEqual({count:0,size:0,changed:false,removedPaths:[]})
    expect(await readFile(target,'utf8')).toBe('private document')
    expect((await lstat(path.join(cache,'file-link'))).isSymbolicLink()).toBe(true)
  })

  it('rejects files changed or replaced after scan and retains their replacement content',async()=>{
    const target=await fixture('cache/entry','original contents'),resource=privacyFileResource(definition([path.dirname(target)]))
    const changed=await resource.scan('all',NOW)
    await writeFile(target,'edited after scanning')
    await expect(changed.validate()).rejects.toThrow('privacy.sourceChanged')
    await expect(changed.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(await readFile(target,'utf8')).toBe('edited after scanning')
    await utimes(target,new Date(RECENT),new Date(RECENT))
    const replacement=await resource.scan('all',NOW),newFile=await fixture('replacement','new inode')
    await rename(newFile,target)
    await expect(replacement.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(await readFile(target,'utf8')).toBe('new inode')
  })

  it('rejects a directory replaced by a symlink between scan and cleanup',async()=>{
    const target=await fixture('cache/entry','scanned contents'),other=await fixture('other/entry','must survive')
    const snapshot=await privacyFileResource(definition([path.dirname(target)])).scan('all',NOW)
    await rename(path.dirname(target),path.join(home,'original-cache'));await symlink(path.dirname(other),path.dirname(target))
    await expect(snapshot.validate()).rejects.toThrow('privacy.sourceChanged')
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(await readFile(other,'utf8')).toBe('must survive')
    expect(await readFile(path.join(home,'original-cache/entry'),'utf8')).toBe('scanned contents')
  })

  it('supports explicit identity-only checks while strict checks reject content changes',async()=>{
    const target=await fixture('cache/entry','old'),original=await privacyPathSnapshot(target)
    await writeFile(target,'changed content')
    await expect(validatePrivacyPath(original)).rejects.toThrow('privacy.sourceChanged')
    await expect(validatePrivacyPath(original,true)).resolves.toBeUndefined()
  })

  it('reports unsupported ranges and missing roots explicitly',async()=>{
    const target=await fixture('cache/entry','retained'),resource=privacyFileResource(definition([path.dirname(target)],false))
    const unsupported=await resource.scan('today',NOW)
    expect(unsupported).toMatchObject({count:null,capability:'range-unsupported',size:0})
    await expect(unsupported.clean()).rejects.toThrow('privacy.sourceUnavailable')
    expect(await readFile(target,'utf8')).toBe('retained')
    const absent=await privacyFileResource(definition([path.join(home,'missing')])).scan('all',NOW)
    expect(absent).toMatchObject({count:0,size:0,capability:'empty'})
  })

  it('freezes the all-time scan upper boundary while including old records',async()=>{
    const old=await fixture('cache/old','old',OLD);await fixture('cache/future','future',FUTURE)
    const snapshot=await privacyFileResource(definition([path.join(home,'cache')])).scan('all',NOW)
    expect(snapshot.count).toBe(1);expect((await snapshot.preview(0,100))[0].path).toBe(old)
  })

  it('deduplicates repeated files and overlapping directory roots before counting or deleting',async()=>{
    const first=await fixture('cache/first','one'),second=await fixture('cache/nested/second','two')
    const root=path.join(home,'cache'),snapshot=await privacyFileResource(definition([root,root,first,path.dirname(second),second])).scan('all',NOW)
    expect(snapshot.count).toBe(2);expect(snapshot.size).toBe(6)
    expect((await snapshot.preview(0,100)).map((entry)=>entry.path).sort()).toEqual([first,second].sort())
    const outcome=await snapshot.clean()
    expect(outcome.count).toBe(2);expect(outcome.size).toBe(6)
    expect(outcome.removedPaths?.sort()).toEqual([first,second].sort())
  })

  it('revalidates the entire captured file set before deleting the first file',async()=>{
    const first=await fixture('cache/first','first',RECENT),later=await fixture('cache/later','second',OLD)
    const snapshot=await privacyFileResource(definition([path.dirname(first)])).scan('all',NOW)
    await snapshot.validate()
    await writeFile(later,'changed since preparation')
    await expect(snapshot.clean()).rejects.toThrow('privacy.sourceChanged')
    expect(await readFile(first,'utf8')).toBe('first')
    expect(await readFile(later,'utf8')).toBe('changed since preparation')
  })
  it('retains confirmed removals if another captured file changes during cleanup',async()=>{
    const first=await fixture('cache/first','first',RECENT),later=await fixture('cache/later','second',OLD)
    const snapshot=await privacyFileResource(definition([path.dirname(first)])).scan('all',NOW)
    let failure:unknown
    try{await snapshot.clean((done)=>{if(done===1)writeFileSync(later,'changed during cleanup')})}catch(error){failure=error}
    expect(failure).toBeInstanceOf(PrivacyCleanupError)
    expect((failure as PrivacyCleanupError).outcome).toEqual({count:1,size:5,changed:true,removedPaths:[first]})
    expect(await readFile(later,'utf8')).toBe('changed during cleanup')
    await expect(lstat(first)).rejects.toMatchObject({code:'ENOENT'})
  })

})
