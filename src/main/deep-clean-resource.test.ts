import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {lstat,mkdtemp,mkdir,readFile,realpath,rm,symlink,utimes,writeFile} from 'node:fs/promises'
import {writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {deepFileSnapshot} from './deep-clean-resource'
import {PrivacyCleanupError} from './privacy-resource'
let home:string
const NOW=Date.now(),OLD=NOW-10*86400000
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-deep-files-')))})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function file(relative:string,contents='owned cache',time=OLD):Promise<string>{const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,contents);await utimes(target,new Date(time),new Date(time));return target}
describe('deep cleanup file snapshots',()=>{
  it('cleans only captured eligible files and retains roots, newly created files, documents and credentials',async()=>{
    const target=await file('cache/old.log'),credential=await file('cache/auth.json','credential'),document=await file('Documents/report.txt','original document')
    await file('cache/current.log','recent',NOW-1000);await file('cache/future.log','future',NOW+86400000)
    const snapshot=await deepFileSnapshot(path.dirname(target),NOW,{olderThanDays:7})
    expect(snapshot.status).toBe('ready');expect(snapshot.count).toBe(1)
    const fresh=await file('cache/new-after-scan.log','keep')
    expect(await snapshot.clean()).toMatchObject({count:1,size:11,removedPaths:[target]})
    expect((await lstat(path.dirname(target))).isDirectory()).toBe(true)
    expect(await readFile(fresh,'utf8')).toBe('keep');expect(await readFile(document,'utf8')).toBe('original document');expect(await readFile(credential,'utf8')).toBe('credential')
  })
  it('makes nested links and incomplete scans explicit without deleting their destinations',async()=>{
    const target=await file('outside/document','original'),root=path.join(home,'cache');await mkdir(root)
    await symlink(target,path.join(root,'link'))
    const snapshot=await deepFileSnapshot(root,NOW)
    expect(snapshot.status).toBe('limited');expect(snapshot.count).toBe(0)
    await expect(snapshot.clean()).rejects.toThrow('deep.sourceUnavailable');expect(await readFile(target,'utf8')).toBe('original')
    const linked=path.join(home,'redirect');await symlink(root,linked)
    expect((await deepFileSnapshot(linked,NOW)).status).toBe('unavailable')
  })
  it('preflights every captured file before the first deletion and tracks later partial success',async()=>{
    const first=await file('cache/first','first',OLD),second=await file('cache/second','second',OLD-1000),root=path.dirname(first)
    const changed=await deepFileSnapshot(root,NOW)
    await writeFile(second,'changed')
    await expect(changed.clean()).rejects.toThrow('deep.sourceChanged');expect(await readFile(first,'utf8')).toBe('first')
    await utimes(second,new Date(OLD),new Date(OLD))
    const partial=await deepFileSnapshot(root,NOW)
    let failure:unknown
    try{await partial.clean((done)=>{if(done===1)writeFileSync(second,'changed during cleanup')})}catch(error){failure=error}
    expect(failure).toBeInstanceOf(PrivacyCleanupError)
    expect((failure as PrivacyCleanupError).outcome).toMatchObject({count:1,size:5,removedPaths:[first]})
    expect(await readFile(second,'utf8')).toBe('changed during cleanup')
  })
  it('marks bounded and read-only scans as unavailable for mutation',async()=>{
    for(let index=0;index<5;index++)await file('cache/'+index)
    const bounded=await deepFileSnapshot(path.join(home,'cache'),NOW,{maximumFiles:3})
    expect(bounded.status).toBe('limited');await expect(bounded.clean()).rejects.toThrow('deep.sourceUnavailable')
    const readonly=await deepFileSnapshot(path.join(home,'cache'),NOW,{readOnly:true})
    expect(readonly.status).toBe('review-only');expect(readonly.count).toBe(5);await expect(readonly.clean()).rejects.toThrow('deep.sourceUnavailable')
  })
  it('skips excluded nested directories and preserves them during cleanup',async()=>{
    const keep=await file('cache/private/secret','keep'),remove=await file('cache/public/cache','remove'),root=path.join(home,'cache')
    const snapshot=await deepFileSnapshot(root,NOW,{excludedPaths:[path.dirname(keep)]})
    expect(snapshot.count).toBe(1);expect(snapshot.files.map((entry)=>entry.path)).toEqual([remove])
    expect((await snapshot.clean()).removedPaths).toEqual([remove]);expect(await readFile(keep,'utf8')).toBe('keep')
    expect((await deepFileSnapshot(root,NOW,{excludedPaths:[root]})).count).toBe(0)
  })
  it('supports cancellation during traversal' ,async()=>{
    await file('cache/entry');const abort=new AbortController();abort.abort()
    await expect(deepFileSnapshot(path.join(home,'cache'),NOW,{signal:abort.signal})).rejects.toThrow('deep.cancelled')
  })
})
