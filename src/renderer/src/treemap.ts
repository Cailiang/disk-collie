export interface Rectangle { id:number; x:number; y:number; width:number; height:number }
/** Balanced binary treemap: no rounding loss, with deterministic keyboard/list order. */
export function treemap(items:Array<{id:number;size:number}>, x=0,y=0,width=100,height=100):Rectangle[] {
  if (!items.length) return []
  if (items.length===1) return [{id:items[0].id,x,y,width,height}]
  const total=items.reduce((s,e)=>s+Math.max(0,e.size),0)
  let sum=0, split=1
  for (let i=0;i<items.length-1;i++) {sum+=Math.max(0,items[i].size);split=i+1;if(sum>=total/2)break}
  const ratio=total>0?sum/total:split/items.length
  if (width>=height) return [...treemap(items.slice(0,split),x,y,width*ratio,height),...treemap(items.slice(split),x+width*ratio,y,width*(1-ratio),height)]
  return [...treemap(items.slice(0,split),x,y,width,height*ratio),...treemap(items.slice(split),x,y+height*ratio,width,height*(1-ratio))]
}
