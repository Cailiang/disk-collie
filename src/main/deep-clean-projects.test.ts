import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {lstat,mkdtemp,mkdir,readFile,realpath,rename,rm,symlink,utimes,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {discoverProjectArtifacts} from './project-artifacts'
import {projectArtifactSnapshot} from './deep-clean-projects'
let home:string,project:string,output:string
beforeEach(async()=>{home=await realpath(await mkdtemp(path.join(os.tmpdir(),'memento-deep-project-')));project=path.join(home,'Projects/fixture');output=path.join(project,'node_modules');await mkdir(path.join(output,'package'),{recursive:true});await writeFile(path.join(project,'package.json'),'{}');await writeFile(path.join(project,'source.ts'),'original source');await writeFile(path.join(output,'package/index.js'),'downloaded dependency')})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})
async function artifact(){const found=(await discoverProjectArtifacts(home)).find((entry)=>entry.target===output);expect(found).toBeDefined();return found!}
describe('registered project artifact Trash',()=>{
  it('moves the complete generated directory without following its links or touching source',async()=>{
    const outside=path.join(home,'original-document');await writeFile(outside,'original');await symlink(outside,path.join(output,'dependency-link'));await utimes(output,new Date(Date.now()-10000),new Date(Date.now()-10000))
    const destination=path.join(home,'owned-trash'),snapshot=await projectArtifactSnapshot(await artifact(),home,async(target)=>{expect(target).toBe(output);await rename(target,destination)})
    expect(snapshot.status).toBe('ready');expect(snapshot.count).toBe(2)
    expect(await snapshot.clean()).toMatchObject({count:2,removedPaths:[output]})
    await expect(lstat(output)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(outside,'utf8')).toBe('original');expect(await readFile(path.join(project,'source.ts'),'utf8')).toBe('original source');expect((await lstat(path.join(destination,'dependency-link'))).isSymbolicLink()).toBe(true)
  })
  it('blocks a newly added nested file before Trash and keeps the complete directory',async()=>{
    const snapshot=await projectArtifactSnapshot(await artifact(),home,async()=>{throw new Error('must not run')})
    const directory=path.join(output,'package'),before=await lstat(directory)
    await writeFile(path.join(directory,'new-work.txt'),'new work');await utimes(directory,new Date(),new Date(before.mtimeMs+2000))
    await expect(snapshot.clean()).rejects.toThrow('deep.sourceChanged');expect(await readFile(path.join(output,'package/index.js'),'utf8')).toBe('downloaded dependency')
  })
  it('blocks key material deep within a generated folder and never partially clears it',async()=>{
    const definition=await artifact();await mkdir(path.join(output,'a/b/c'),{recursive:true});const key=path.join(output,'a/b/c/private.pem');await writeFile(key,'private key')
    const snapshot=await projectArtifactSnapshot(definition,home,async()=>{throw new Error('must not run')})
    expect(snapshot.status).toBe('review-only');await expect(snapshot.clean()).rejects.toThrow('deep.sourceUnavailable');expect(await readFile(key,'utf8')).toBe('private key');expect(await readFile(path.join(output,'package/index.js'),'utf8')).toBe('downloaded dependency')
  })
  it('does not discover excluded projects or whole artifacts containing an excluded descendant',async()=>{
    expect((await discoverProjectArtifacts(home,Date.now(),undefined,[project])).some((entry)=>entry.target===output)).toBe(false)
    expect((await discoverProjectArtifacts(home,Date.now(),undefined,[path.join(output,'package')])).some((entry)=>entry.target===output)).toBe(false)
    expect((await discoverProjectArtifacts(home,Date.now(),undefined,[path.join(home,'unrelated')])).some((entry)=>entry.target===output)).toBe(true)
  })
  it('honors cancellation while discovering and capturing project output',async()=>{
    const definition=await artifact(),controller=new AbortController();controller.abort()
    await expect(discoverProjectArtifacts(home,Date.now(),controller.signal)).rejects.toThrow('deep.cancelled')
    await expect(projectArtifactSnapshot(definition,home,async()=>undefined,200000,controller.signal)).rejects.toThrow('deep.cancelled')
  })
})
