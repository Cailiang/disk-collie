import { describe,expect,it } from 'vitest'
import { treemap } from './treemap'
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
})
