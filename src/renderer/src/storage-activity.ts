import type { StorageActivity } from '../../shared/storage-types'

/** Local calendar days, including zero days and the lifetime balance before the window. */
export function activityTimeline(history:StorageActivity[],now=new Date(),count=14) {
  const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-count+1)
  const key=(date:Date):string=>`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`
  const days=Array.from({length:count},(_,i)=>{const date=new Date(start);date.setDate(date.getDate()+i);return {key:key(date),date,bytes:0,tasks:0,cumulative:0}})
  const byDate=new Map(days.map((day)=>[day.key,day]))
  let cumulative=0
  for(const record of history) {
    const date=new Date(record.date)
    if(!Number.isFinite(date.getTime())||record.items<=0||!Number.isFinite(record.bytes)||record.bytes<0||date>now)continue
    if(date<start)cumulative+=record.bytes
    else {const day=byDate.get(key(date));if(day){day.bytes+=record.bytes;day.tasks++}}
  }
  for(const day of days){cumulative+=day.bytes;day.cumulative=cumulative}
  return days
}
