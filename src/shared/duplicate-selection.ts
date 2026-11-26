import type {DuplicateGroup,StorageEntry} from './storage-types'

/** Keep an existing survivor in each group when selecting extra copies. */
export function selectExtraCopies(groups:DuplicateGroup[],selected:ReadonlySet<number>):Set<number> {
  const next=new Set(selected)
  for(const group of groups){
    const keep=group.files.find((file)=>!selected.has(file.id))||group.files[0]
    for(const file of group.files)if(file.id===keep.id)next.delete(file.id);else next.add(file.id)
  }
  return next
}

/** Validate the whole batch before hashing or moving any copy. */
export function duplicateRemovalGroups(groups:DuplicateGroup[],ids:ReadonlySet<number>,groupId?:string):Array<{group:DuplicateGroup;keep:StorageEntry;files:StorageEntry[]}> {
  const batches=groups.filter((group)=>group.files.some((file)=>ids.has(file.id))).map((group)=>{
    if(groupId&&group.id!==groupId)throw new Error('Unknown duplicate selection')
    const keep=group.files.find((file)=>!ids.has(file.id))
    if(!keep)throw new Error('Keep at least one copy in every duplicate group')
    return {group,keep,files:group.files.filter((file)=>ids.has(file.id))}
  })
  if(new Set(batches.flatMap((batch)=>batch.files.map((file)=>file.id))).size!==ids.size)throw new Error('Unknown duplicate selection')
  return batches
}
