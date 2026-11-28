import {describe,expect,it} from 'vitest'
import {filterStartupGroups,startupGroups} from './startup-groups'
import {demoStartup} from '../renderer/src/startup-demo'
describe('startup grouping and status filters',()=>{
  it('keeps every source in an exact owner group and distinguishes mixed, unknown and orphan states',()=>{
    const groups=startupGroups(demoStartup()),code=groups.find(group=>group.id==='vscode')!
    expect(code.items).toHaveLength(2);expect(code.state).toBe('mixed')
    expect(filterStartupGroups(groups,'Microsoft','all',false)).toEqual([code])
    expect(filterStartupGroups(groups,'','all',false)).toHaveLength(8)
    expect(filterStartupGroups(groups,'','all',true)).toHaveLength(9)
    expect(filterStartupGroups(groups,'迅雷','all',false)[0].name).toBe('迅雷')
    expect(filterStartupGroups(groups,'Thunder','all',false)[0].name).toBe('迅雷')
    expect(filterStartupGroups(groups,'','enabled',false)).toContainEqual(code)
    expect(filterStartupGroups(groups,'','disabled',false).map(group=>group.name).sort()).toEqual(['Build worker','Figma'])
    expect(filterStartupGroups(groups,'','orphan',false).map(group=>group.name).sort()).toEqual(['Old Cloud','Old Editor'])
  })
})
