import {describe,expect,it} from 'vitest'
import {deviceHealth,healthGrade,usageSeverity} from './device-health'
import {localizedDemoOverviewMetrics} from '../renderer/src/demo'
describe('device readings and severity',()=>{
  it('uses visibly different grades for 80 and 20 points',()=>{expect([null,20,49,50,79,80,100].map(healthGrade)).toEqual(['unknown','attention','attention','fair','fair','good','good'])})
  it('applies strict user thresholds at 40 and 65 percent',()=>{expect([40,40.1,65,65.1].map(usageSeverity)).toEqual(['normal','warning','warning','danger'])})
  it('excludes missing hardware readings and does not invent a perfect score while loading',()=>{
    expect(deviceHealth(null).score).toBeNull()
    const metrics=localizedDemoOverviewMetrics();metrics.gpu.usagePercent=null;metrics.battery.available=false
    const health=deviceHealth(metrics);expect(health.measured).toBe(3);expect(health.dimensions.filter((d)=>d.score===null).map((d)=>d.key)).toEqual(['gpu','battery'])
    metrics.cpu.usagePercent=95;metrics.memory.usedPercent=95;metrics.disk.availableBytes=0
    expect(deviceHealth(metrics).score!).toBeLessThan(health.score!)
  })
})
