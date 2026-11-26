import {lstat} from 'node:fs/promises'
import {assertDeepNotCancelled} from './deep-clean-context'
import type {DeepCleanFile} from '../shared/deep-clean-types'
import {deepFileSnapshot,type DeepCleanSnapshot} from './deep-clean-resource'
/** Disk images remain wholly read-only; logical capacity is not reclaimable storage. */
export async function containerDiskSnapshot(target:string,until:number,signal?:AbortSignal):Promise<DeepCleanSnapshot>{
  const result=await deepFileSnapshot(target,until,{readOnly:true,pattern:/\.(raw|qcow2|vhdx|vhd)$/i,signal})
  const files:DeepCleanFile[]=[]
  for(let offset=0;offset<result.files.length;offset+=32){
    assertDeepNotCancelled(signal)
    files.push(...await Promise.all(result.files.slice(offset,offset+32).map(async(file)=>{const stat=await lstat(file.path);return {...file,size:Number.isFinite(stat.blocks)?Math.max(0,stat.blocks*512):file.size}})))
  }
  return {...result,files,size:files.reduce((sum,file)=>sum+file.size,0)}
}
