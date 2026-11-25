import { describe,expect,it } from 'vitest'
import { fileCategory } from './file-categories'
describe('file classification',()=>{
  it('classifies common large file types case-insensitively',()=>{
    expect(fileCategory('holiday.MOV')).toBe('video')
    expect(fileCategory('archive.tar.gz')).toBe('archive')
    expect(fileCategory('setup.DMG')).toBe('installer')
    expect(fileCategory('data.PDF')).toBe('document')
    expect(fileCategory('cover.HEIC')).toBe('image')
    expect(fileCategory('master.FLAC')).toBe('audio')
    expect(fileCategory('README')).toBe('other')
    expect(fileCategory('data.unknown')).toBe('other')
  })
})
