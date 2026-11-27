import {chmodSync,copyFileSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs'
import path from 'node:path'

const {DatabaseSync}=require('node:sqlite') as typeof import('node:sqlite')
export const DATABASE_NAME='disk-collie.sqlite'
const legacyDatabaseName='memento.sqlite'
const profileFiles=['agent-master.key','app-settings.json','storage-history.json']

function regularFile(filename:string):boolean {
  if(!existsSync(filename))return false
  if(!lstatSync(filename).isFile())throw new Error('Profile migration requires regular files')
  return true
}

/** Copy a consistent SQLite snapshot and its encryption key; never modify the old profile. */
export function migrateLegacyProfile(directory:string,legacyDirectories:readonly string[]):boolean {
  if(existsSync(path.join(directory,DATABASE_NAME)))return false
  const source=legacyDirectories.find(candidate=>regularFile(path.join(candidate,legacyDatabaseName))||
    path.resolve(candidate)!==path.resolve(directory)&&profileFiles.some(name=>regularFile(path.join(candidate,name))))
  if(!source)return false
  mkdirSync(directory,{recursive:true,mode:0o700})
  const staging=mkdtempSync(path.join(directory,'.profile-migration-')),installed:string[]=[],files:string[]=[]
  try{
    const legacyDatabase=path.join(source,legacyDatabaseName)
    if(regularFile(legacyDatabase)){
      const database=new DatabaseSync(legacyDatabase,{readOnly:true})
      try{
        database.exec('PRAGMA busy_timeout=5000')
        const providers=database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_providers'").get()
        if(providers&&(database.prepare('SELECT COUNT(*) AS count FROM ai_providers').get() as {count:number}).count>0&&
          (!regularFile(path.join(source,'agent-master.key'))||readFileSync(path.join(source,'agent-master.key')).length!==32)){
          throw new Error('The legacy provider encryption key is missing or invalid; the original data was preserved')
        }
        // VACUUM INTO includes committed WAL data and avoids copying a live database piecemeal.
        database.prepare('VACUUM INTO ?').run(path.join(staging,DATABASE_NAME))
        chmodSync(path.join(staging,DATABASE_NAME),0o600)
      }finally{database.close()}
    }
    for(const name of profileFiles){
      if(!regularFile(path.join(source,name)))continue
      copyFileSync(path.join(source,name),path.join(staging,name));chmodSync(path.join(staging,name),0o600);files.push(name)
    }
    if(existsSync(path.join(staging,DATABASE_NAME)))files.push(DATABASE_NAME)
    for(const name of files){
      const target=path.join(directory,name),staged=path.join(staging,name)
      if(existsSync(target)){
        if(!regularFile(target)||!readFileSync(target).equals(readFileSync(staged)))throw new Error('DiskCollie profile already contains different data; no files were overwritten')
        continue
      }
      // Publish complete files exclusively; the database comes last, after its key and settings.
      linkSync(staged,target);installed.push(target)
    }
    return true
  }catch(error){for(const filename of installed.reverse())rmSync(filename,{force:true});throw error}
  finally{rmSync(staging,{recursive:true,force:true})}
}

export function currentDatabasePath(directory:string):string {
  migrateLegacyProfile(directory,[directory])
  return path.join(directory,DATABASE_NAME)
}
