import {describe,expect,it} from 'vitest'
import {startupAuthorizationMessage} from './startup-permissions'
import {baseItem} from '../main/startup/common'

describe('startup authorization context',()=>{
  it('identifies the application, action, exact configuration count and preservation scope',()=>{
    const items=[baseItem({name:'dev.old.helper',owner:'旧应用',kind:'daemon'}),baseItem({name:'dev.old.updater',owner:'旧应用',kind:'daemon'})]
    expect(startupAuthorizationMessage(items,'remove','zh-CN')).toBe('DiskCollie 要移除 2 项启动配置（旧应用）。这些是所有用户的启动设置，需要管理员权限；应用和个人文件会保留。')
  })
  it('bounds untrusted display metadata and removes invisible formatting while preserving literal quotes as data',()=>{
    const items=[baseItem({name:'x'.repeat(10000),kind:'agent'}),baseItem({name:'"quoted"\n\u202Ename',kind:'agent'}),baseItem({name:'Another',kind:'agent'})]
    const prompt=startupAuthorizationMessage(items,'disable','en-US')
    expect(prompt).toContain('DiskCollie needs to disable 3')
    expect(prompt).toContain('"quoted" name and others')
    expect(prompt).not.toMatch(/[\r\n\u202E]/)
    expect(prompt.length).toBeLessThan(400)
  })
})
