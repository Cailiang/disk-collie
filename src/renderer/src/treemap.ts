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

/** Minimum pixel bounds keep both labels readable; byte values remain untouched. */
export function readableTreemap(items:Array<{id:number;size:number}>,pixelWidth=600,pixelHeight=430):Rectangle[] {
  if(!items.length)return []
  const width=Math.max(1,pixelWidth),height=Math.max(1,pixelHeight)
  let minWidth=Math.min(80,width),minHeight=Math.min(56,height)
  while(Math.floor(width/minWidth)*Math.floor(height/minHeight)<items.length){minWidth*=.9;minHeight*=.9}
  const total=items.reduce((sum,item)=>sum+Math.max(0,item.size),0),floor=Math.min(.05,1/items.length)
  let low=0,high=1
  for(let iteration=0;iteration<48;iteration++){const scale=(low+high)/2,sum=items.reduce((value,item)=>value+Math.max(floor,total?item.size/total*scale:1/items.length),0);if(sum>1)high=scale;else low=scale}
  const weighted=items.map((item)=>({id:item.id,size:Math.max(floor,total?item.size/total*low:1/items.length)}))
  const layout=(entries:typeof weighted,x:number,y:number,w:number,h:number):Rectangle[]=>{
    if(entries.length===1)return [{id:entries[0].id,x:x/width*100,y:y/height*100,width:w/width*100,height:h/height*100}]
    const sum=entries.reduce((value,item)=>value+item.size,0)
    let partial=0,best:{split:number;horizontal:boolean;extent:number;cost:number}|null=null
    for(let split=1;split<entries.length;split++){
      partial+=entries[split-1].size
      for(const horizontal of [w>=h,w<h]){
        const extent=horizontal?w:h,opposite=horizontal?h:w,unit=horizontal?minWidth:minHeight,otherUnit=horizontal?minHeight:minWidth
        const capacity=Math.max(1,Math.floor((opposite+1e-6)/otherUnit))
        const first=Math.ceil(split/capacity)*unit,last=Math.ceil((entries.length-split)/capacity)*unit
        if(first+last>extent+1e-6)continue
        const position=Math.max(first,Math.min(extent-last,extent*partial/sum))
        const cost=Math.abs(partial/sum-.5)+(horizontal===(w>=h)?0:.0001)
        if(!best||cost<best.cost)best={split,horizontal,extent:position,cost}
      }
    }
    if(!best)return treemap(entries,x/width*100,y/height*100,w/width*100,h/height*100)
    const {split,horizontal,extent}=best
    return horizontal?[...layout(entries.slice(0,split),x,y,extent,h),...layout(entries.slice(split),x+extent,y,w-extent,h)]:[...layout(entries.slice(0,split),x,y,w,extent),...layout(entries.slice(split),x,y+extent,w,h-extent)]
  }
  return layout(weighted,0,0,width,height)
}
