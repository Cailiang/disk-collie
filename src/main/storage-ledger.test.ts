import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {StorageLedger} from './storage-ledger'
import {AgentStore} from './agent/agent-store'
import type {StorageActivity} from '../shared/storage-types'
const directories:string[]=[]
const directory=():string=>{const value=mkdtempSync(path.join(os.tmpdir(),'diskcollie-ledger-'));directories.push(value);return value}
afterEach(()=>{for(const value of directories.splice(0))rmSync(value,{recursive:true,force:true})})
describe('embedded cleanup history',()=>{
  it('imports legacy records once and persists incremental results beside encrypted providers and custom settings',()=>{
    const root=directory(),record:StorageActivity={id:'legacy',date:'2026-11-25T12:00:00.000Z',kind:'large',items:1,bytes:1234,failures:0,locations:['/fixture/file']}
    writeFileSync(path.join(root,'storage-history.json'),JSON.stringify([record]))
    const settings=new AgentStore(root),provider=settings.saveProvider({name:'Fixture',type:'openai-compatible',baseUrl:'http://127.0.0.1:1234/v1',model:'fixture',apiKey:'test-secret'})
    settings.updateAppSettings({theme:'graphite',storageWhitelist:['/fixture/keep']})
    const store=new StorageLedger(root)
    expect(store.list()).toEqual([record])
    store.save({...record,items:2,bytes:2468,failures:1});store.close()
    const reopened=new StorageLedger(root)
    expect(reopened.list()).toEqual([{...record,items:2,bytes:2468,failures:1}])
    expect(settings.getAppSettings()).toMatchObject({theme:'graphite',storageWhitelist:['/fixture/keep']})
    expect(settings.getPrivateProvider(provider.id).apiKey).toBe('test-secret')
    expect(readFileSync(path.join(root,'storage-history.json'),'utf8')).toBe(JSON.stringify([record]))
    reopened.close();settings.close()
  })
  it('leaves an unreadable legacy file intact and allows its later recovery without losing newer results',()=>{
    const root=directory(),filename=path.join(root,'storage-history.json')
    writeFileSync(filename,'{incomplete')
    const current:StorageActivity={id:'current',date:'2026-11-26T12:00:00.000Z',kind:'analysis',items:1,bytes:10,failures:0,locations:[]}
    const store=new StorageLedger(root);store.save(current);store.close()
    writeFileSync(filename,JSON.stringify([{...current,id:'restored',date:'2026-11-25T12:00:00.000Z'}]))
    const recovered=new StorageLedger(root)
    expect(recovered.list().map((record)=>record.id)).toEqual(['current','restored']);recovered.close()
  })
})
