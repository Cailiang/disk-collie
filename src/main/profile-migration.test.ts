import {afterEach,describe,expect,it} from 'vitest'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {AgentStore} from './agent/agent-store'
import {StorageLedger} from './storage-ledger'
import {DATABASE_NAME,migrateLegacyProfile} from './profile-migration'

const {DatabaseSync}=require('node:sqlite') as typeof import('node:sqlite')
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
  const root=mkdtempSync(path.join(os.tmpdir(),'diskcollie-profile-test-'));roots.push(root)
  const legacy=path.join(root,'Memento'),target=path.join(root,'DiskCollie'),store=new AgentStore(legacy)
  const provider=store.saveProvider({name:'Owned provider',type:'openai-compatible',baseUrl:'https://fixture.example/v1',model:'owned-model',apiKey:'synthetic-migration-secret'})
  store.updateAppSettings({language:'en-US',theme:'graphite',scanExcludedDirectories:['/owned/private']})
  store.markLocalAiConfigImportCompleted();store.close()
  const ledger=new StorageLedger(legacy)
  ledger.save({id:'owned-cleanup',date:'2026-11-27T00:00:00Z',kind:'cleanup',items:2,bytes:4096,failures:0,locations:['/owned/cache']});ledger.close()
  renameSync(path.join(legacy,DATABASE_NAME),path.join(legacy,'memento.sqlite'))
  return {legacy,target,provider}
}

describe('DiskCollie profile migration',()=>{
  it('preserves encrypted providers, settings, cleanup totals and committed WAL data without changing the old profile',()=>{
    const {legacy,target,provider}=fixture(),writer=new DatabaseSync(path.join(legacy,'memento.sqlite'))
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE owned_wal(value TEXT); INSERT INTO owned_wal VALUES(\'committed\')')
    expect(statSync(path.join(legacy,'memento.sqlite-wal')).size).toBeGreaterThan(0)
    try{
      expect(migrateLegacyProfile(target,[legacy])).toBe(true)
      const migrated=new AgentStore(target),ledger=new StorageLedger(target),snapshot=new DatabaseSync(path.join(target,DATABASE_NAME))
      try{
        expect(migrated.getPrivateProvider(provider.id).apiKey).toBe('synthetic-migration-secret')
        expect(migrated.getAppSettings()).toMatchObject({language:'en-US',theme:'graphite',scanExcludedDirectories:['/owned/private']})
        expect(migrated.hasCompletedLocalAiConfigImport()).toBe(true)
        expect(ledger.list()).toMatchObject([{id:'owned-cleanup',bytes:4096,items:2}])
        expect(snapshot.prepare('SELECT value FROM owned_wal').get()).toEqual({value:'committed'})
        expect(readFileSync(path.join(target,'agent-master.key'))).toEqual(readFileSync(path.join(legacy,'agent-master.key')))
        expect(readFileSync(path.join(target,DATABASE_NAME)).includes(Buffer.from('synthetic-migration-secret'))).toBe(false)
        expect(migrateLegacyProfile(target,[legacy])).toBe(false)
        expect(writer.prepare('SELECT COUNT(*) AS count FROM ai_providers').get()).toEqual({count:1})
      }finally{snapshot.close();ledger.close();migrated.close()}
    }finally{writer.close()}
  })
  it('supports an explicitly selected old profile with the legacy database filename',()=>{
    const {legacy,provider}=fixture(),migrated=new AgentStore(legacy)
    try{expect(migrated.getPrivateProvider(provider.id).apiKey).toBe('synthetic-migration-secret');expect(existsSync(path.join(legacy,DATABASE_NAME))).toBe(true);expect(existsSync(path.join(legacy,'memento.sqlite'))).toBe(true)}finally{migrated.close()}
  })
  it('never replaces an existing DiskCollie database',()=>{
    const {legacy,target}=fixture(),existing=new AgentStore(target)
    existing.updateAppSettings({theme:'klein'});existing.close()
    expect(migrateLegacyProfile(target,[legacy])).toBe(false)
    const reopened=new AgentStore(target)
    try{expect(reopened.getAppSettings().theme).toBe('klein');expect(reopened.listProviders()).toEqual([])}finally{reopened.close()}
  })
  it('refuses to migrate encrypted providers without their key',()=>{
    const {legacy,target}=fixture();rmSync(path.join(legacy,'agent-master.key'))
    expect(()=>migrateLegacyProfile(target,[legacy])).toThrow('encryption key')
    expect(existsSync(path.join(target,DATABASE_NAME))).toBe(false)
    expect(existsSync(path.join(legacy,'memento.sqlite'))).toBe(true)
  })
  it('does not overwrite a conflicting key and can resume after the matching key was already published',()=>{
    const {legacy,target,provider}=fixture();mkdirSync(target);writeFileSync(path.join(target,'agent-master.key'),Buffer.alloc(32,42))
    expect(()=>migrateLegacyProfile(target,[legacy])).toThrow('no files were overwritten')
    expect(readFileSync(path.join(target,'agent-master.key'))).toEqual(Buffer.alloc(32,42))
    expect(existsSync(path.join(target,DATABASE_NAME))).toBe(false)
    writeFileSync(path.join(target,'agent-master.key'),readFileSync(path.join(legacy,'agent-master.key')))
    expect(migrateLegacyProfile(target,[legacy])).toBe(true)
    const store=new AgentStore(target);try{expect(store.getPrivateProvider(provider.id).apiKey).toBe('synthetic-migration-secret')}finally{store.close()}
  })
  it('imports older JSON-only settings and cleanup history',()=>{
    const {legacy,target}=fixture();rmSync(path.join(legacy,'memento.sqlite'));rmSync(path.join(legacy,'agent-master.key'))
    writeFileSync(path.join(legacy,'app-settings.json'),JSON.stringify({theme:'tiffany'}))
    writeFileSync(path.join(legacy,'storage-history.json'),JSON.stringify([{id:'old-json',date:'2026-11-27T00:00:00Z',kind:'large',items:1,bytes:2048,failures:0,locations:[]}]))
    expect(migrateLegacyProfile(target,[legacy])).toBe(true)
    const store=new AgentStore(target),ledger=new StorageLedger(target)
    try{expect(store.getAppSettings().theme).toBe('tiffany');expect(ledger.list()).toMatchObject([{id:'old-json',bytes:2048}])}finally{ledger.close();store.close()}
  })
})
