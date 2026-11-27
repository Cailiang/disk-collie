import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {lstat,mkdir,mkdtemp,readFile,rename,rm,symlink,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {isStorageDirectoryCandidate,prepareStorageDirectoryTrash} from './storage-directory-trash'

let home:string,root:string
beforeEach(async()=>{home=await mkdtemp(path.join(os.homedir(),'diskcollie-directory-trash-'));root=path.join(home,'Downloads');await mkdir(root)})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function file(relative:string,contents:string):Promise<string>{const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,contents);return target}
const options=()=>({home})
describe('reviewed complete directory Trash boundary',()=>{
  it('reviews hidden descendants and moves the complete folder while leaving linked destinations intact',async()=>{
    const target=path.dirname(await file('archive/report.txt','report')),hidden=await file('archive/.hidden/data.txt','hidden data'),outside=await file('outside.txt','outside contents')
    await symlink(outside,path.join(target,'shortcut'))
    const reviewed=await prepareStorageDirectoryTrash(target,home,options())
    expect(reviewed.summary).toMatchObject({path:target,name:'archive',size:17,files:2,directories:1,links:1,hiddenFiles:1})
    expect(reviewed.summary.allocated).toBeGreaterThanOrEqual(0)
    const trash=path.join(home,'owned-trash-archive')
    await reviewed.trash(async(location)=>rename(location,trash))
    await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'})
    expect(await readFile(path.join(trash,'.hidden/data.txt'),'utf8')).toBe('hidden data')
    expect(await readFile(outside,'utf8')).toBe('outside contents')
    expect((await lstat(path.join(trash,'shortcut'))).isSymbolicLink()).toBe(true)
  })
  it('rejects scan roots, the user home, applications, protected descendants and excluded directories',async()=>{
    expect(isStorageDirectoryCandidate(home,home,options())).toBe(false)
    expect(isStorageDirectoryCandidate(home,path.parse(home).root,options())).toBe(false)
    expect(isStorageDirectoryCandidate('/Applications/Fixture.app','/',options())).toBe(false)
    const target=path.dirname(await file('archive/safe.txt','safe'))
    expect(isStorageDirectoryCandidate(target,home,{...options(),excludedPaths:[path.join(target,'private')]})).toBe(false)
    await file('archive/.ssh/private.txt','must remain')
    await expect(prepareStorageDirectoryTrash(target,home,options())).rejects.toThrow('storage.directoryProtected')
    expect(await readFile(path.join(target,'safe.txt'),'utf8')).toBe('safe')
    await rm(path.join(target,'.ssh'),{recursive:true})
    await file('archive/private.key','must remain')
    await expect(prepareStorageDirectoryTrash(target,home,options())).rejects.toThrow('storage.directoryProtected')
  })
  it('does not authorize a linked root or traversal through a linked parent',async()=>{
    const target=path.dirname(await file('real/report.txt','keep'))
    await symlink(target,path.join(root,'alias'))
    await expect(prepareStorageDirectoryTrash(path.join(root,'alias'),home,options())).rejects.toThrow('storage.directoryChanged')
    expect(await readFile(path.join(target,'report.txt'),'utf8')).toBe('keep')
  })
  it('rejects nested file edits, replacement, new files and changed links after review',async()=>{
    const first=await file('archive/nested/report.txt','original'),target=path.join(root,'archive'),outside=await file('outside.txt','outside')
    await symlink(outside,path.join(target,'shortcut'))
    const edited=await prepareStorageDirectoryTrash(target,home,options()),before=await lstat(first)
    await writeFile(first,'replacement bytes');await utimes(first,before.atime,before.mtime)
    await expect(edited.validate()).rejects.toThrow('storage.directoryChanged')
    const added=await prepareStorageDirectoryTrash(target,home,options())
    await file('archive/nested/new.txt','new file')
    await expect(added.trash(async()=>{throw new Error('must not execute')})).rejects.toThrow('storage.directoryChanged')
    const linked=await prepareStorageDirectoryTrash(target,home,options())
    await rm(path.join(target,'shortcut'));await symlink(first,path.join(target,'shortcut'))
    await expect(linked.validate()).rejects.toThrow('storage.directoryChanged')
    expect(await readFile(outside,'utf8')).toBe('outside')
  })
  it('refuses incomplete reviews and verifies that the Trash operation actually removes the source',async()=>{
    const target=path.dirname(await file('archive/one.txt','one'));await file('archive/two.txt','two')
    await expect(prepareStorageDirectoryTrash(target,home,{...options(),maximumEntries:2})).rejects.toThrow('storage.directoryIncomplete')
    const reviewed=await prepareStorageDirectoryTrash(target,home,options())
    await expect(reviewed.trash(async()=>undefined)).rejects.toThrow('storage.directoryVerificationFailed')
    expect(await readFile(path.join(target,'one.txt'),'utf8')).toBe('one')
  })
  it('permits a fully reviewed empty directory',async()=>{
    const target=path.join(root,'empty');await mkdir(target)
    const reviewed=await prepareStorageDirectoryTrash(target,home,options())
    expect(reviewed.summary).toMatchObject({files:0,directories:0,links:0,size:0})
    await reviewed.trash(async(location)=>rename(location,path.join(home,'owned-empty-trash')))
    await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'})
  })
})
