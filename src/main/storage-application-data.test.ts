import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdir,mkdtemp,readFile,rename,rm,symlink,writeFile,readdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {applicationDataRoot} from './storage-application-data-policy'
import {isStorageDirectoryCandidate,prepareStorageDirectoryTrash} from './storage-directory-trash'
import {trashApplicationDataDirectory} from './storage-application-data-trash'
import {command} from './startup/common'

const roots:string[]=[]
async function fixture(){
  const home=await mkdtemp(path.join(os.homedir(),'diskcollie-appdata-test-'));roots.push(home)
  const target=path.join(home,'Library/Application Support/NoMachine'),file=path.join(target,'var/server.log')
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'owned log');await writeFile(path.join(target,'private.key'),'owned application credential')
  return {home,target,file,options:{home,platform:'darwin' as const}}
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
describe('explicit application-data directory review',()=>{
  it('allows individual support subtrees while retaining system, shared-parent, bundle and exclusion boundaries',()=>{
    expect(applicationDataRoot('/Library/Application Support/NoMachine/var','/Users/test','darwin')).toBe('/Library/Application Support/NoMachine')
    expect(isStorageDirectoryCandidate('/Library/Application Support/NoMachine','/',{platform:'darwin',home:'/Users/test'})).toBe(true)
    for(const target of ['/Library','/Library/Application Support','/Library/LaunchDaemons','/System/Library/Application Support/NoMachine','/Library/Application Support/com.apple.idleassetsd','/Library/Application Support/Apple','/Library/Application Support/TCC','/Library/Application Support/CoreDevice','/Library/Application Support/Tool.app'])expect(isStorageDirectoryCandidate(target,'/',{platform:'darwin',home:'/Users/test'}),target).toBe(false)
    expect(applicationDataRoot('/Library/Application Support/NoMachine','/Users/test','linux')).toBeNull()
    expect(isStorageDirectoryCandidate('/Library/Application Support/NoMachine','/',{platform:'darwin',home:'/Users/test',excludedPaths:['/Library/Application Support/NoMachine/var']})).toBe(false)
  })
  it.skipIf(process.platform==='win32')('reviews app-owned settings and hidden data without following links, and still rejects linked ancestors and later edits',async()=>{
    const {home,target,file,options}=await fixture(),outside=path.join(home,'keep.txt');await writeFile(outside,'keep');await symlink(outside,path.join(target,'shortcut'))
    const reviewed=await prepareStorageDirectoryTrash(target,home,options)
    expect(reviewed.summary).toMatchObject({files:2,links:1})
    await writeFile(file,'changed log');await expect(reviewed.validate()).rejects.toThrow('storage.directoryChanged')
    const fresh=await prepareStorageDirectoryTrash(target,home,options)
    await fresh.trash(location=>rename(location,path.join(home,'owned-trash')))
    expect(await readFile(outside,'utf8')).toBe('keep')
    await symlink(path.join(home,'owned-trash'),target);await expect(prepareStorageDirectoryTrash(target,home,options)).rejects.toThrow('storage.directoryChanged')
  })
  it.skipIf(process.platform!=='darwin')('uses one explained authorization and a descriptor-pinned exclusive move into the owned Trash',async()=>{
    const {home,target,file,options}=await fixture(),outside=path.join(home,'keep.txt')
    await writeFile(outside,'keep linked destination');await symlink(outside,path.join(target,'outside-link'))
    const reviewed=await prepareStorageDirectoryTrash(target,home,options)
    const run=vi.fn<typeof command>(async(file,args,timeout)=>file==='/usr/bin/osascript'?command('/bin/sh',['-c',args[2]],timeout):command(file,args,timeout))
    await trashApplicationDataDirectory(target,reviewed.validate,'zh-CN',{home,run,trash:async()=>{throw new Error('Simulated permission denial')}})
    expect(run.mock.calls.filter(([file])=>file==='/usr/bin/osascript')).toHaveLength(1)
    expect(run.mock.calls.find(([file])=>file==='/usr/bin/osascript')![1][3]).toContain('DiskCollie 要将应用数据目录“NoMachine”移到废纸篓')
    const [reserved]=await readdir(path.join(home,'.Trash'))
    expect(await readFile(path.join(home,'.Trash',reserved,'NoMachine/var/server.log'),'utf8')).toBe('owned log')
    expect(await readFile(outside,'utf8')).toBe('keep linked destination')
    await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'})
  })
  it.skipIf(process.platform!=='darwin')('rejects changes during the password dialog and preserves data after cancellation',async()=>{
    const {home,target,file,options}=await fixture(),reviewed=await prepareStorageDirectoryTrash(target,home,options)
    const run:typeof command=async(fileName,args,timeout)=>{
      if(fileName==='/usr/bin/osascript'){await writeFile(file,'new data while authorizing');return command('/bin/sh',['-c',args[2]],timeout)}
      return command(fileName,args,timeout)
    }
    await expect(trashApplicationDataDirectory(target,reviewed.validate,'en-US',{home,run,trash:async()=>{throw new Error('Permission')}})).rejects.toThrow('storage.directoryChanged')
    expect(await readFile(file,'utf8')).toBe('new data while authorizing')
    const next=await prepareStorageDirectoryTrash(target,home,options)
    const cancel:typeof command=async(file,args,timeout)=>{if(file==='/usr/bin/osascript')throw new Error('User canceled (-128)');return command(file,args,timeout)}
    await expect(trashApplicationDataDirectory(target,next.validate,'en-US',{home,run:cancel,trash:async()=>{throw new Error('Permission')}})).rejects.toThrow('storage.applicationDataCancelled')
    expect(await readFile(file,'utf8')).toBe('new data while authorizing')
    expect(await readdir(path.join(home,'.Trash'))).toEqual([])
  })
  it.skipIf(process.platform!=='darwin')('rejects a replaced Trash parent and never overwrites an existing destination',async()=>{
    for(const attack of ['replace-parent','existing-destination']){
      const {home,target,file,options}=await fixture(),reviewed=await prepareStorageDirectoryTrash(target,home,options),outside=path.join(home,'keep-outside')
      await mkdir(outside);await writeFile(path.join(outside,'canary'),'keep')
      const run:typeof command=async(fileName,args,timeout)=>{
        if(fileName==='/usr/bin/osascript'){
          const [name]=await readdir(path.join(home,'.Trash')),reserved=path.join(home,'.Trash',name)
          if(attack==='replace-parent'){await rename(reserved,path.join(home,'original-reservation'));await symlink(outside,reserved)}
          else await writeFile(path.join(reserved,'NoMachine'),'existing destination')
          return command('/bin/sh',['-c',args[2]],timeout)
        }
        return command(fileName,args,timeout)
      }
      await expect(trashApplicationDataDirectory(target,reviewed.validate,'en-US',{home,run,trash:async()=>{throw new Error('Permission')}})).rejects.toThrow(attack==='replace-parent'?'storage.directoryChanged':'storage.applicationDataMoveFailed')
      expect(await readFile(file,'utf8')).toBe('owned log');expect(await readFile(path.join(outside,'canary'),'utf8')).toBe('keep')
      if(attack==='existing-destination'){const [name]=await readdir(path.join(home,'.Trash'));expect(await readFile(path.join(home,'.Trash',name,'NoMachine'),'utf8')).toBe('existing destination')}
    }
  })
})
