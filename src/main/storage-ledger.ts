import {existsSync,mkdirSync,readFileSync} from 'node:fs'
import path from 'node:path'
import {currentDatabasePath} from './profile-migration'
import {z} from 'zod'
import type {StorageActivity} from '../shared/storage-types'

const {DatabaseSync}=require('node:sqlite') as typeof import('node:sqlite')
const activitySchema=z.object({id:z.string(),date:z.string(),kind:z.enum(['analysis','large','duplicates','cleanup','privacy','uninstall']),items:z.number().nonnegative(),bytes:z.number().nonnegative(),failures:z.number().nonnegative(),locations:z.array(z.string()),deepCleanIds:z.array(z.string()).optional(),removedPaths:z.array(z.string()).optional(),privacyIds:z.array(z.string()).optional(),traces:z.number().nonnegative().optional(),skipped:z.number().nonnegative().optional(),unchanged:z.number().nonnegative().optional(),errors:z.array(z.object({path:z.string(),message:z.string()})).optional()})

/** Cleanup history shares the embedded database with providers and app settings. */
export class StorageLedger {
  private readonly database:InstanceType<typeof DatabaseSync>
  constructor(directory:string){
    mkdirSync(directory,{recursive:true,mode:0o700})
    this.database=new DatabaseSync(currentDatabasePath(directory))
    this.database.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS cleanup_activity(id TEXT PRIMARY KEY,date TEXT NOT NULL,value_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS cleanup_activity_date ON cleanup_activity(date DESC);
      CREATE TABLE IF NOT EXISTS local_migrations(key TEXT PRIMARY KEY,completed_at TEXT NOT NULL);`)
    this.importLegacy(path.join(directory,'storage-history.json'))
  }
  list():StorageActivity[]{
    return (this.database.prepare('SELECT value_json FROM cleanup_activity ORDER BY date DESC,rowid DESC').all() as Array<{value_json:string}>).map((row)=>activitySchema.parse(JSON.parse(row.value_json)))
  }
  save(record:StorageActivity):void{
    const valid=activitySchema.parse(record)
    this.database.prepare('INSERT INTO cleanup_activity(id,date,value_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,value_json=excluded.value_json').run(valid.id,valid.date,JSON.stringify(valid))
  }
  close():void{this.database.close()}
  private importLegacy(filename:string):void{
    if(this.database.prepare("SELECT 1 FROM local_migrations WHERE key='cleanup-json-v1'").get())return
    let records:StorageActivity[]=[]
    if(existsSync(filename)){
      try{records=z.array(activitySchema).parse(JSON.parse(readFileSync(filename,'utf8')))}catch{return}
    }
    this.database.exec('BEGIN IMMEDIATE')
    try{
      const insert=this.database.prepare('INSERT OR IGNORE INTO cleanup_activity(id,date,value_json) VALUES(?,?,?)')
      for(const record of records)insert.run(record.id,record.date,JSON.stringify(record))
      this.database.prepare("INSERT INTO local_migrations(key,completed_at) VALUES('cleanup-json-v1',?)").run(new Date().toISOString())
      this.database.exec('COMMIT')
    }catch(error){this.database.exec('ROLLBACK');throw error}
  }
}
