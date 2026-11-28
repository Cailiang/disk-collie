import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const state=vi.hoisted(()=>({options:[] as any[],requests:[] as any[],reply:null as null|((input:any)=>Promise<{text:string}>)}))
vi.mock('ai',async(importOriginal)=>({...await importOriginal<typeof import('ai')>(),ToolLoopAgent:class{constructor(options:any){state.options.push(options)}generate(input:any){state.requests.push(input);return state.reply!(input)}}}))
import {AgentStore} from './agent-store'
import {LocalAgentRuntime} from './local-agent-runtime'
import type {AgentRunEvent} from '../../shared/agent-types'
let directory:string,store:AgentStore,runtime:LocalAgentRuntime
beforeEach(()=>{directory=mkdtempSync(path.join(os.tmpdir(),'diskcollie-item-ai-'));store=new AgentStore(directory);store.saveProvider({name:'Owned provider',type:'openai-compatible',baseUrl:'http://127.0.0.1:9/v1',model:'owned-model',apiKey:'owned-test-secret'});runtime=new LocalAgentRuntime(store);state.options=[];state.requests=[];state.reply=async()=>({text:'The Unarchiver is an archive extraction application.'})})
afterEach(()=>{store.close();rmSync(directory,{recursive:true,force:true})})
describe('item explanation without a computer health scan',()=>{
  it('completes and persists a scoped application explanation with no tools or executable plan',async()=>{
    const events:AgentRunEvent[]=[]
    const initial=runtime.startExplanation({prompt:'Explain The Unarchiver, version 4.3, path /Applications/The Unarchiver.app'},'en-US',event=>events.push(event))
    await vi.waitFor(()=>expect(store.getRun(initial.id)?.status).toBe('completed'))
    expect(store.getRun(initial.id)).toMatchObject({response:'The Unarchiver is an archive extraction application.',plan:[],focus:[],presentation:null,error:null})
    expect(state.options[0].tools).toEqual({});expect(state.options[0].instructions).toContain('untrusted data')
    expect(state.requests[0].prompt).toContain('The Unarchiver')
    expect(events.map(event=>event.type)).toEqual(['status','completed'])
  })
  it('cancels an in-flight explanation and persists a cancelled result without actions',async()=>{
    state.reply=input=>new Promise((_,reject)=>input.abortSignal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    const initial=runtime.startExplanation({prompt:'Explain the selected app'},'en-US',()=>undefined)
    runtime.cancel(initial.id)
    await vi.waitFor(()=>expect(store.getRun(initial.id)?.status).toBe('cancelled'))
    expect(store.getRun(initial.id)?.plan).toEqual([])
  })
  it('rejects blank prompts and reports an empty model reply as a failure',async()=>{
    expect(()=>runtime.startExplanation({prompt:' '},'en-US',()=>undefined)).toThrow(/item/)
    state.reply=async()=>({text:' '})
    const initial=runtime.startExplanation({prompt:'Explain the selected startup item'},'en-US',()=>undefined)
    await vi.waitFor(()=>expect(store.getRun(initial.id)?.status).toBe('failed'))
    expect(store.getRun(initial.id)?.error).toContain('no explanation')
  })
})
