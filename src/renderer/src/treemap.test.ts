import { describe,expect,it } from 'vitest'
import { treemap,readableTreemap } from './treemap'
describe('storage map',()=>{
  it('preserves proportions without overlapping rectangles',()=>{
    const items=[60,25,10,5].map((size,id)=>({id,size}))
    const rectangles=treemap(items)
    for(const rect of rectangles){
      expect(rect.width*rect.height).toBeCloseTo(items[rect.id].size*100)
      expect(rect.x+rect.width).toBeLessThanOrEqual(100.000001)
      expect(rect.y+rect.height).toBeLessThanOrEqual(100.000001)
      for(const other of rectangles.filter((v)=>v.id!==rect.id)){
        const overlap=Math.max(0,Math.min(rect.x+rect.width,other.x+other.width)-Math.max(rect.x,other.x))*Math.max(0,Math.min(rect.y+rect.height,other.y+other.height)-Math.max(rect.y,other.y))
        expect(overlap).toBeCloseTo(0)
      }
    }
  })
  it('keeps extreme size differences readable across wide and narrow charts without changing bytes',()=>{
    for(const count of [2,3,7,11])for(const [width,height] of [[600,430],[366,430],[250,410]]){
      const items=[1e12,...Array.from({length:count-1},(_,index)=>index+1)].map((size,id)=>({id,size}))
      const tiles=readableTreemap(items,width,height)
      expect(tiles).toHaveLength(count);expect(tiles.reduce((sum,tile)=>sum+tile.width*tile.height,0)).toBeCloseTo(10000)
      for(const tile of tiles){expect(tile.width*width/100).toBeGreaterThanOrEqual(79.999);expect(tile.height*height/100).toBeGreaterThanOrEqual(55.999)}
      expect(items[0].size).toBe(1e12)
    }
  })
})
