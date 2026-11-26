import {describe,expect,it} from 'vitest'
import {storageScanScope} from './storage-scan-scope'
describe('scan scope defaults',()=>{
  it('excludes app data by default and allows explicit read-only inclusion',()=>{
    expect(storageScanScope('/Users/test',false,'darwin').excludePaths).toContain('/Users/test/Library')
    expect(storageScanScope('/Users/test',true,'darwin')).toEqual({includeHidden:true,excludePaths:[]})
    expect(storageScanScope('C:\\Users\\test',false,'win32',{}).excludePaths).toContain('C:\\Users\\test\\AppData')
    expect(storageScanScope('/home/test',false,'linux').includeHidden).toBe(false)
  })
})
