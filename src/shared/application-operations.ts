type ApplicationOperationKind='update'|'uninstall'
type PendingOperation={kind:ApplicationOperationKind;promise:Promise<unknown>}
/** App updates are independent; replacing and removing the same app must never overlap. */
export class ApplicationOperations {
  private readonly pending=new Map<string,PendingOperation>()
  has(id:string,kind?:ApplicationOperationKind):boolean {const operation=this.pending.get(id);return Boolean(operation&&(!kind||operation.kind===kind))}
  activeIds(kind?:ApplicationOperationKind):Set<string> {return new Set([...this.pending].filter(([,operation])=>!kind||operation.kind===kind).map(([id])=>id))}
  run<T>(id:string,kind:ApplicationOperationKind,work:()=>Promise<T>):Promise<T> {
    const existing=this.pending.get(id)
    if(existing)return existing.kind===kind?existing.promise as Promise<T>:Promise.reject(new Error('apps.operationInProgress'))
    const promise=Promise.resolve().then(work).finally(()=>{if(this.pending.get(id)?.promise===promise)this.pending.delete(id)})
    this.pending.set(id,{kind,promise})
    return promise
  }
}
