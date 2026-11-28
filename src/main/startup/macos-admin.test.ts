import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,writeFile,rm,readFile,chmod,symlink} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {baseItem,command,fingerprint,shellQuote} from './common'
import {changeMacStartupBatch,macStartupElevationScript,type MacAdminTarget} from './macos-admin'

const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function targets(){
  const root=await mkdtemp(path.join(os.tmpdir(),'diskcollie-admin-test-'));roots.push(root)
  const targets:MacAdminTarget[]=[]
  for(const [index,name] of ["owned ' $(touch injected) config.plist",'other.plist'].entries()){
    const file=path.join(root,name);await writeFile(file,'owned configuration '+index)
    targets.push({file,label:'dev.fixture.'+index,domain:'system',record:{key:file,item:baseItem({name,kind:'daemon'}),signature:await fingerprint(file,true),validate:()=>fingerprint(file,true),change:async()=>{throw new Error('Use batch')}}})
  }
  return {root,targets}
}
describe('bounded macOS administrator batches',()=>{
  it('requests one authorization for multiple registered configs and parses per-item outcomes',async()=>{
    const {targets:rows}=await targets(),run=vi.fn<typeof command>(async()=> 'DiskCollieStartupResult:0:ok\nDiskCollieStartupResult:1:failed\n')
    const result=await changeMacStartupBatch(rows,'remove',run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]).toMatchObject({0:'/usr/bin/osascript',2:120000})
    const args=run.mock.calls[0][1]
    expect(args[1]).toContain('with administrator privileges')
    expect(args[1]).toContain('with prompt (item 2 of argv)')
    expect(args[3]).toContain('DiskCollie 要移除 2 项启动配置')
    expect(args[1]).not.toContain(rows[0].record.item.name)
    expect(args[2]).toContain('/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin')
    expect(result[0]).toEqual({key:rows[0].record.key,error:null})
    expect(String(result[1].error)).toContain('startup.failed')
  })
  it('uses the requested action and current UI language in a separate native password-dialog argument',async()=>{
    const {targets:rows}=await targets(),run=vi.fn<typeof command>(async()=> 'DiskCollieStartupResult:0:ok\n')
    rows[0].record.item.owner='Localized App'
    for(const action of ['enable','disable','remove'] as const){
      await changeMacStartupBatch([rows[0]],action,run,'en-US')
      const args=run.mock.lastCall![1]
      expect(args[1]).toBe(macStartupElevationScript)
      expect(args[3]).toContain(`DiskCollie needs to ${action} 1 startup configurations (Localized App)`)
      expect(args[3]).toContain('Administrator permission')
    }
  })
  it.skipIf(process.platform!=='darwin')('compiles the real password-prompt syntax without executing or requesting authorization',async()=>{
    const {root}=await targets()
    await command('/usr/bin/osacompile',['-o',path.join(root,'elevate.scpt'),'-e',macStartupElevationScript])
  })
  it('rejects definition drift before elevation, propagates cancellation and requires a result marker for each item',async()=>{
    const {targets:rows}=await targets(),run=vi.fn<typeof command>(async()=> '')
    await writeFile(rows[1].file,'changed')
    await expect(changeMacStartupBatch(rows,'remove',run)).rejects.toThrow('startup.changed');expect(run).not.toHaveBeenCalled()
    rows.pop()
    run.mockRejectedValueOnce(new Error('User cancelled (-128)'))
    await expect(changeMacStartupBatch(rows,'remove',run)).rejects.toThrow('cancelled')
    expect((await changeMacStartupBatch(rows,'remove',run))[0].error).toMatchObject({message:'startup.failed'})
  })
  it.skipIf(process.platform!=='darwin')('executes the fixed guarded script on owned fixtures, quotes paths, rejects changes during the dialog and preserves alias targets',async()=>{
    const {root,targets:rows}=await targets(),stub=path.join(root,'launchctl-stub'),referent=path.join(root,'keep-target.plist')
    await writeFile(stub,'#!/bin/sh\nexit 0\n');await chmod(stub,0o700)
    await writeFile(referent,'keep real configuration');await rm(rows[1].file);await symlink(referent,rows[1].file)
    rows[1].record.signature=await fingerprint(rows[1].file,true)
    const run:typeof command=async(_file,args)=>{
      // Run without elevation, and replace launchctl with an owned inert executable.
      // The production quoting, stat/hash guard, shell and config-only removal remain intact.
      await writeFile(rows[0].file,'changed while authorizing')
      return command('/bin/sh',['-c',args[2].replaceAll('/bin/launchctl',shellQuote(stub))])
    }
    const result=await changeMacStartupBatch(rows,'remove',run)
    expect(result[0].error).toMatchObject({message:'startup.changed'});expect(result[1].error).toBeNull()
    expect(await readFile(rows[0].file,'utf8')).toBe('changed while authorizing')
    await expect(readFile(rows[1].file)).rejects.toMatchObject({code:'ENOENT'})
    expect(await readFile(referent,'utf8')).toBe('keep real configuration')
    rows[0].record.signature=await fingerprint(rows[0].file,true)
    const [removed]=await changeMacStartupBatch([rows[0]],'remove',async(_file,args)=>command('/bin/sh',['-c',args[2].replaceAll('/bin/launchctl',shellQuote(stub))]))
    expect(removed.error).toBeNull();await expect(readFile(rows[0].file)).rejects.toMatchObject({code:'ENOENT'})
    await expect(readFile(path.join(root,'injected'))).rejects.toMatchObject({code:'ENOENT'})
  })
})
