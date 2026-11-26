import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({exec:vi.fn(),open:vi.fn(),external:vi.fn(),install:vi.fn(),updater:vi.fn(),updaterCommand:vi.fn()}))
vi.mock('node:child_process',()=>({execFile:(command:string,args:string[],options:unknown,callback:any)=>{mocks.exec(command,args,options);callback(null,'','')}}))
vi.mock('node:fs',()=>({existsSync:(target:string)=>target==='/opt/homebrew/bin/brew'||target==='/opt/homebrew/bin/mas'}))
vi.mock('electron',()=>({shell:{openPath:mocks.open,openExternal:mocks.external}}))
vi.mock('./application-updater',()=>({installSparkleUpdate:mocks.install,runSparkleUpdater:mocks.updater,sparkleUpdaterCommand:mocks.updaterCommand}))
import {updateRegisteredApplication} from './storage-application-actions'
describe('registered application updates',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.open.mockResolvedValue('');mocks.external.mockResolvedValue(undefined);mocks.install.mockResolvedValue(undefined);mocks.updaterCommand.mockReturnValue(null)})
  it('passes a validated cask as a single argument and rejects option or shell injection',async()=>{
    const result=await updateRegisteredApplication('/Applications/Fixture.app',{source:'homebrew-cask',token:'fixture-app',mode:'direct',latestVersion:'2'})
    expect(result.status).toBe('updated');expect(mocks.exec.mock.calls[0].slice(0,2)).toEqual(['/opt/homebrew/bin/brew',['upgrade','--cask','fixture-app']])
    for(const token of ['--force','app;touch /tmp/file','../escape'])await expect(updateRegisteredApplication('/Applications/Fixture.app',{source:'homebrew-cask',token,mode:'direct',latestVersion:'2'})).rejects.toThrow(/Invalid/)
    expect(mocks.exec).toHaveBeenCalledTimes(1)
  })
  it('distinguishes App Store handoff and application-owned updaters from installed updates',async()=>{
    expect(await updateRegisteredApplication('/Applications/Fixture.app',{source:'mac-app-store',token:'123456',mode:'external',latestVersion:'2'})).toEqual({status:'opened',destination:'app-store'})
    expect(mocks.external).toHaveBeenCalledWith('macappstore://itunes.apple.com/app/id123456')
    expect(await updateRegisteredApplication('/Applications/Fixture.app',{source:'sparkle',token:'https://example.org/feed',mode:'external',latestVersion:'2'})).toEqual({status:'opened',destination:'application'})
    expect(mocks.open).toHaveBeenCalledWith('/Applications/Fixture.app')
  })
  it('delegates downloaded updates to the existing identity and signature verifier',async()=>{
    await updateRegisteredApplication('/Applications/Fixture.app',{source:'sparkle',token:'https://example.org/feed',downloadUrl:'https://example.org/fixture.zip',mode:'direct',latestVersion:'2.1'})
    expect(mocks.install).toHaveBeenCalledWith({target:'/Applications/Fixture.app',downloadUrl:'https://example.org/fixture.zip',expectedVersion:'2.1'})
  })
})
