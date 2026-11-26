import {describe,it,expect} from 'vitest'
import {applicationUnusedDays,compareApplications,pathContains,selectedApplicationFiles} from './application-files'
import type {RelatedApplicationFile,StorageApplication} from './storage-types'
const file=(id:string,path:string,size:number):RelatedApplicationFile=>({id,path,size,kind:'support'})
describe('application file selection',()=>{
  it('does not double-count selected descendants or swallow similarly named siblings',()=>{
    const files=[file('app','/Applications/Example.app',100),file('cache','/Users/test/Cache',20),file('nested','/Users/test/Cache/sub/file',10),file('sibling','/Users/test/Cache-other',30)]
    expect(selectedApplicationFiles(files,new Set(['app','cache','nested','sibling'])).map((f)=>f.id)).toEqual(['app','cache','sibling'])
    expect(selectedApplicationFiles(files,new Set(['nested']))[0].size).toBe(10)
    expect(pathContains('C:\\Apps\\App','C:\\Apps\\App\\data')).toBe(true)
    expect(pathContains('C:\\Apps\\App','C:\\Apps\\Application')).toBe(false)
  })
  it('keeps missing and invalid activity dates unknown instead of inferring non-use',()=>{
    const now=Date.UTC(2026,10,26)
    expect(applicationUnusedDays(null,now)).toBeNull()
    expect(applicationUnusedDays('invalid',now)).toBeNull()
    expect(applicationUnusedDays(new Date(now+86400000).toISOString(),now)).toBeNull()
    expect(applicationUnusedDays(new Date(now-106*86400000).toISOString(),now)).toBe(106)
  })
  it('keeps unknown usage dates last in both column sort directions',()=>{
    const applications=['2026-11-24','invalid',null,'2026-11-26'].map((lastUsedAt,index)=>({name:String(index),lastUsedAt} as StorageApplication))
    expect([...applications].sort((a,b)=>compareApplications(a,b,'used','ascending','en-US')).map((app)=>app.name)).toEqual(['0','3','1','2'])
    expect([...applications].sort((a,b)=>compareApplications(a,b,'used','descending','en-US')).map((app)=>app.name)).toEqual(['3','0','1','2'])
  })
})
