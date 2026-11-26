import {describe,expect,it,vi} from 'vitest'
import {parseProcessIdentities,terminateUserProcess,type ProcessIdentity} from './process-control'
const item=(pid:number,command:string,parent=1,uid=501):ProcessIdentity=>({pid,command,parent,uid,started:'Thu Nov 26 10:00:00 2026'})
describe('confirmed user process termination',()=>{
  it('quits the owning app when a helper is selected and preserves unrelated applications',async()=>{
    let processes=[item(99,'/Applications/Memento.app/Contents/MacOS/Memento'),item(10,'/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop'),item(11,'/Applications/GitHub Desktop.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',10),item(12,'/Applications/Other.app/Contents/MacOS/Other')]
    const signal=vi.fn((pid:number)=>{processes=processes.filter((p)=>p.pid!==pid)})
    await terminateUserProcess(11,true,{uid:501,ownPid:99,ownBundle:'/Applications/Memento.app'},{list:async()=>processes,inspect:async(pid)=>processes.find((p)=>p.pid===pid),signal})
    expect(signal.mock.calls.map(([pid])=>pid)).toEqual([10,11]);expect(processes.map((p)=>p.pid)).toEqual([99,12])
  })
  it('rejects PID reuse and protects system, other-user and own processes',async()=>{
    const target=item(10,'/Users/test/worker'),signal=vi.fn()
    await expect(terminateUserProcess(10,true,{uid:501,ownPid:99,ownBundle:null},{list:async()=>[target],inspect:async()=>({...target,started:'later'}),signal})).rejects.toThrow('changed');expect(signal).not.toHaveBeenCalled()
    for(const protectedTarget of [item(10,'/System/worker'),item(10,'/Users/other/worker',1,502),item(99,'/Users/test/own')])await expect(terminateUserProcess(protectedTarget.pid,true,{uid:501,ownPid:99,ownBundle:null},{list:async()=>[protectedTarget],signal})).rejects.toThrow('protected')
    expect(signal).not.toHaveBeenCalled()
  })
  it('does not report success when a signalled application remains running',async()=>{
    const target=item(10,'/Applications/Fixture.app/Contents/MacOS/Fixture');let now=0
    await expect(terminateUserProcess(10,true,{uid:501,ownPid:99,ownBundle:null},{list:async()=>[target],inspect:async()=>target,signal:()=>undefined,now:()=>now,wait:async(ms)=>{now+=ms}})).rejects.toThrow('restarted')
  })
  it('reads identity and start time without breaking application paths containing spaces',()=>{
    expect(parseProcessIdentities(' 10  1  501 Thu Nov 26 10:00:00 2026 /Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop')[0]).toMatchObject({pid:10,uid:501,started:'Thu Nov 26 10:00:00 2026',command:'/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop'})
  })
})
