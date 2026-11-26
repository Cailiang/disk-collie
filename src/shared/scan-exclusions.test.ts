import {describe,expect,it} from 'vitest'
import {normalizeScanExcludedDirectories,isScanPathExcluded,scanPathsOverlap} from './scan-exclusions'
describe('scan directory exclusions',()=>{
  it('normalizes absolute paths without changing valid spaces or POSIX backslashes',()=>{
    expect(normalizeScanExcludedDirectories(['/Users/alex/Private/','/Users/alex/./Private','/Users/alex/x/../Private','/Users/alex/trailing ','/Users/alex/back\\slash','relative',null,'/bad\npath'])).toEqual(['/Users/alex/Private','/Users/alex/trailing ','/Users/alex/back\\slash'])
  })
  it('matches full components and nested directories, never sibling prefixes',()=>{
    expect(isScanPathExcluded('/Users/alex/Private/child',['/Users/alex/Private'])).toBe(true)
    expect(isScanPathExcluded('/Users/alex/Private-copy',['/Users/alex/Private'])).toBe(false)
    expect(isScanPathExcluded('/Users/alex/Public/../Private/file',['/Users/alex/Private'])).toBe(true)
    expect(scanPathsOverlap('/Users/alex',['/Users/alex/Private'])).toBe(true)
    expect(scanPathsOverlap('/Users/alex/Public',['/Users/alex/Private'])).toBe(false)
    expect(isScanPathExcluded('/anything',['/'])).toBe(true)
  })
  it('normalizes Windows drives and UNC paths with case-insensitive boundaries',()=>{
    expect(normalizeScanExcludedDirectories(['C:\\Users\\Alex\\Private','c:/users/alex/private/'])).toEqual(['c:/users/alex/private'])
    expect(isScanPathExcluded('C:\\Users\\Alex\\Private\\child',['c:/users/alex/private'])).toBe(true)
    expect(isScanPathExcluded('C:\\Users\\Alex\\Private-copy',['c:/users/alex/private'])).toBe(false)
    expect(isScanPathExcluded('C:\\anything',['c:/'])).toBe(true)
    expect(isScanPathExcluded('\\\\server\\Share\\folder\\child',['\\\\SERVER\\share\\folder'])).toBe(true)
    expect(isScanPathExcluded('\\\\server\\Share2\\file',['\\\\server\\Share'])).toBe(false)
  })
})
