import { describe,expect,it } from 'vitest'
import { isStorageMutationAllowed as allowed } from './storage-policy'
describe('native file mutation scope',()=>{
  it('allows selected personal files but protects root, escape, app data and credentials',()=>{
    const root='/Users/test'
    expect(allowed(`${root}/Downloads/archive.zip`,root,'darwin',root)).toBe(true)
    for(const target of [root,'/Users/elsewhere/file',`${root}/Library/Caches/file`,`${root}/.ssh/key`,`${root}/.memento/key`,`${root}/.diskcollie/key`,`${root}/.disk-collie/key`,'/System/file','/Applications/Example.app/Contents/file'])expect(allowed(target,root,'darwin',root),target).toBe(false)
    expect(allowed('/Applications/Example.app/Contents/file','/','darwin',root)).toBe(false)
    expect(allowed('/Volumes/External/project.mov','/Volumes/External','darwin',root)).toBe(true)
  })
  it('treats Windows casing and namespace prefixes identically',()=>{
    const home='C:\\Users\\Test'
    expect(allowed('\\\\?\\C:\\Users\\Test\\Downloads\\file.zip','\\\\?\\C:\\Users\\Test','win32',home,{})).toBe(true)
    for(const target of ['c:\\WINDOWS\\system.ini','C:\\Program Files\\App\\data','C:\\Users\\Test\\AppData\\Local\\data','C:\\Users\\Test\\.ssh\\key','D:\\file'])expect(allowed(target,'C:\\','win32',home,{}),target).toBe(false)
  })
})

it('protects relocated macOS system security data but leaves relocated personal configuration eligible',()=>{
  expect(allowed('/Users/Shared/Previously Relocated Items 1/Security/System/file.dmg','/','darwin','/Users/test')).toBe(false)
  expect(allowed('/Users/Shared/Previously Relocated Items 1/Configuration/personal.txt','/','darwin','/Users/test')).toBe(true)
})
