import { describe,expect,it } from 'vitest'
import { storageRules } from './storage-rules'
describe('portable cleanup rules',()=>{
  it.each(['darwin','win32','linux'] as const)('separates privacy on %s and excludes credentials',platform=>{
    const rules=storageRules(platform,'/fixture',{LOCALAPPDATA:'/fixture/local',XDG_CACHE_HOME:'/fixture/cache',XDG_CONFIG_HOME:'/fixture/config'})
    expect(rules.some((r)=>r.category==='privacy')).toBe(true)
    expect(rules.some((r)=>r.category==='developer')).toBe(true)
    expect(rules.some((r)=>/Cookies|Login Data|\.ssh|\.aws|models|\.env/.test(r.relative))).toBe(false)
    expect(rules.filter((r)=>r.category==='privacy').every((r)=>['history','recent'].includes(r.effect))).toBe(true)
  })
})
