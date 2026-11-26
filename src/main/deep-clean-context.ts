import type {PrivacyContext} from './privacy-resource'
export interface DeepCleanContext extends PrivacyContext {
  signal?:AbortSignal
  trash?:(target:string)=>Promise<void>
}
export function assertDeepNotCancelled(signal?:AbortSignal):void{if(signal?.aborted)throw new Error('deep.cancelled')}
