import type {StorageTaskScope} from '../shared/storage-types'
type Job={scope:StorageTaskScope;mutation:boolean;work:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(error:Error)=>void}
const heavy=(scope:StorageTaskScope):boolean=>['analysis','large','duplicates'].includes(scope)
/** Independent workspaces run concurrently; same-scope work and mutations remain ordered. */
export class StorageTaskQueue {
  private pending:Job[]=[]
  private active=new Set<Job>()
  get activeScopes():StorageTaskScope[]{return [...this.active].map((job)=>job.scope)}
  constructor(private readonly notify:(scope:StorageTaskScope,queued:boolean,blockedBy:StorageTaskScope|null)=>void=()=>undefined){}
  private conflict(a:Job,b:Job):boolean{return a.scope===b.scope||a.mutation&&b.mutation}
  run<T>(scope:StorageTaskScope,work:()=>Promise<T>,mutation=false):Promise<T> {
    return new Promise<T>((resolve,reject)=>{
      const job:Job={scope,work,mutation,resolve:resolve as (value:unknown)=>void,reject}
      this.pending.push(job);this.drain()
      if(this.pending.includes(job))this.notify(scope,true,[...this.active].find((active)=>this.conflict(job,active)||heavy(job.scope)&&heavy(active.scope))?.scope||null)
    })
  }
  private drain():void {
    for(const job of [...this.pending]){
      const earlier=this.pending.slice(0,this.pending.indexOf(job))
      if([...this.active].some((other)=>this.conflict(job,other))||earlier.some((other)=>this.conflict(job,other))||heavy(job.scope)&&[...this.active].filter((other)=>heavy(other.scope)).length>=2)continue
      this.pending.splice(this.pending.indexOf(job),1);this.active.add(job);this.notify(job.scope,false,null)
      void Promise.resolve().then(job.work).then(job.resolve,(error)=>job.reject(error instanceof Error?error:new Error(String(error)))).finally(()=>{this.active.delete(job);this.drain()})
    }
  }
  cancelPending(scope:StorageTaskScope):void {
    const cancelled=this.pending.filter((job)=>job.scope===scope);this.pending=this.pending.filter((job)=>job.scope!==scope)
    for(const job of cancelled)job.reject(new Error('Scan cancelled'))
    this.drain()
  }
}
