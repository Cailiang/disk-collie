import {describe,expect,it} from 'vitest'
import type {DuplicateGroup,StorageEntry} from './storage-types'
import {duplicateRemovalGroups,selectExtraCopies} from './duplicate-selection'
const file=(id:number)=>({id,name:String(id),size:10,allocated:10} as StorageEntry)
const groups:DuplicateGroup[]=[{id:'a',files:[file(1),file(2),file(3)],reclaimable:20},{id:'b',files:[file(4),file(5)],reclaimable:10}]
describe('duplicate batch selection',()=>{
  it('preserves a survivor when adding extra copies to a manual selection',()=>{
    const selected=selectExtraCopies(groups,new Set([1,4]))
    expect([...selected].sort()).toEqual([1,3,4])
    expect(duplicateRemovalGroups(groups,selected).map((batch)=>batch.keep.id)).toEqual([2,5])
  })
  it('validates every group in one batch and rejects an unknown or complete group',()=>{
    expect(duplicateRemovalGroups(groups,new Set([2,5])).map((batch)=>batch.files[0].id)).toEqual([2,5])
    expect(()=>duplicateRemovalGroups(groups,new Set([2,4,5]))).toThrow('Keep at least one')
    expect(()=>duplicateRemovalGroups(groups,new Set([2,99]))).toThrow('Unknown')
    expect(()=>duplicateRemovalGroups(groups,new Set([2,5]),'a')).toThrow('Unknown')
  })
})
