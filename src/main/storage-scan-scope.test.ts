import {describe,expect,it} from 'vitest'
import {storageScanScope} from './storage-scan-scope'
describe('scan scope defaults',()=>{
  it('excludes app data by default and allows explicit read-only inclusion',()=>{
    expect(storageScanScope('/Users/test',false,'darwin').excludePaths).toContain('/Users/test/Library')
    expect(storageScanScope('/Users/test',true,'darwin')).toEqual({includeHidden:true,excludePaths:[]})
    expect(storageScanScope('C:\\Users\\test',false,'win32',{}).excludePaths).toContain('C:\\Users\\test\\AppData')
    expect(storageScanScope('/home/test',false,'linux').includeHidden).toBe(false)
  })
  it.each(['large','duplicates'] as const)('always excludes protected locations from %s, even with hidden files enabled',mode=>{
    for(const includeHidden of [false,true]){
      const scope=storageScanScope('/Users/test',includeHidden,'darwin',{},mode)
      for(const location of ['/private','/var','/System','/Applications','/Users/test/Library'])expect(scope.excludePaths).toContain(location)
      expect(scope.excludeNames).toEqual(expect.arrayContaining(['.ssh','.aws','.Trash']))
    }
    expect(storageScanScope('C:\\Users\\test',true,'win32',{},mode).excludePaths).toEqual(expect.arrayContaining(['C:\\Windows','C:\\Program Files','C:\\Users\\test\\AppData']))
  })
})
