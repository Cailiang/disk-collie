import type {StorageTaskScope} from '../shared/storage-types'
type Job={scope:StorageTaskScope;cancelled:boolean;reject:(error:Error)=>void}
/** Serialize filesystem work without turning ordinary navigation into an IPC error. */
export class StorageTaskQueue {
  private tail:Promise<void>=Promise.resolve()
  private pending=new Set<Job>()
  activeScope:StorageTaskScope|null=null
  constructor(private readonly notify:(scope:StorageTaskScope,queued:boolean,blockedBy:StorageTaskScope|null)=>void=()=>undefined){}
  run<T>(scope:StorageTaskScope,work:()=>Promise<T>):Promise<T> {
    return new Promise<T>((resolve,reject)=>{
      const blockedBy=this.activeScope||this.pending.values().next().value?.scope||null
      const job:Job={scope,cancelled:false,reject};this.pending.add(job)
      if(blockedBy)this.notify(scope,true,blockedBy)
      const scheduled=this.tail.then(async()=>{
        this.pending.delete(job)
        if(job.cancelled)return
        this.activeScope=scope;this.notify(scope,false,null)
        try{resolve(await work())}catch(error){reject(error instanceof Error?error:new Error(String(error)))}finally{this.activeScope=null}
      })
      this.tail=scheduled.catch(()=>undefined)
    })
  }
  cancelPending(scope:StorageTaskScope):void {
    for(const job of this.pending)if(job.scope===scope){job.cancelled=true;this.pending.delete(job);job.reject(new Error('Scan cancelled'))}
  }
}
