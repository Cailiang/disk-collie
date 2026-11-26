import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {isSystemProcess} from './overview-monitor'
const exec=promisify(execFile)
export interface ProcessIdentity {pid:number;parent:number;uid:number;started:string;command:string}
export function applicationProcessBundle(command:string):string|null {return /^(.+?\.app)(?:\/|$)/i.exec(command)?.[1]||null}
export function parseProcessIdentities(output:string):ProcessIdentity[] {
  return output.split('\n').flatMap((line)=>{const match=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d+)\s+(.+)$/.exec(line);return match?[{pid:Number(match[1]),parent:Number(match[2]),uid:Number(match[3]),started:match[4].replace(/\s+/g,' '),command:match[5].trim()}]:[]})
}
async function readProcesses(pid?:number):Promise<ProcessIdentity[]> {
  try{const {stdout}=await exec('/bin/ps',['-ww',...(pid?['-p',String(pid)]:['-a','-x']),'-o','pid=,ppid=,uid=,lstart=,comm='],{timeout:3000,maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C'}});return parseProcessIdentities(stdout)}catch(error){if(pid&&(error as {code?:number}).code===1)return [];throw error}
}
interface Dependencies {list:()=>Promise<ProcessIdentity[]>;inspect:(pid:number)=>Promise<ProcessIdentity|undefined>;signal:(pid:number,signal:NodeJS.Signals)=>void;wait:(ms:number)=>Promise<void>;now:()=>number}
const defaults:Dependencies={list:()=>readProcesses(),inspect:async(pid)=>(await readProcesses(pid))[0],signal:(pid,signal)=>process.kill(pid,signal),wait:(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),now:()=>Date.now()}
/** App helpers are actions on the owning app. Verify exit instead of equating signal delivery with success. */
export async function terminateUserProcess(pid:number,force:boolean,options:{uid:number;ownPid:number;ownBundle:string|null},dependencies:Partial<Dependencies>={}):Promise<void> {
  const api={...defaults,...dependencies},snapshot=await api.list(),target=snapshot.find((p)=>p.pid===pid)
  if(!target)throw new Error('process.control.missing')
  const protectedPids=new Set<number>();let ancestor:number|undefined=options.ownPid
  while(ancestor&&!protectedPids.has(ancestor)){protectedPids.add(ancestor);ancestor=snapshot.find((p)=>p.pid===ancestor)?.parent}
  const bundle=applicationProcessBundle(target.command)
  const targets=bundle?snapshot.filter((p)=>applicationProcessBundle(p.command)===bundle):[target]
  if(targets.some((p)=>p.uid!==options.uid||p.pid<=1||protectedPids.has(p.pid)||isSystemProcess(null,p.command)||(options.ownBundle&&applicationProcessBundle(p.command)===options.ownBundle)))throw new Error('process.control.protected')
  const selected=force?targets:bundle?targets.filter((p)=>p.command.startsWith(bundle+'/Contents/MacOS/')):[target]
  const jobs=selected.length?selected:[target]
  for(const job of jobs){const current=await api.inspect(job.pid);if(current&&(current.uid!==job.uid||current.command!==job.command||current.started!==job.started))throw new Error('process.control.changed')}
  for(const job of jobs){const current=await api.inspect(job.pid);if(!current)continue;if(current.uid!==job.uid||current.command!==job.command||current.started!==job.started)throw new Error('process.control.changed');try{api.signal(job.pid,force?'SIGKILL':'SIGTERM')}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}}
  const deadline=api.now()+(force?3500:2500)
  while(true){const current=await api.list();const remaining=bundle?current.filter((p)=>applicationProcessBundle(p.command)===bundle&&p.uid===options.uid):current.filter((p)=>p.pid===target.pid&&p.started===target.started);if(!remaining.length)return;if(api.now()>=deadline)throw new Error(force?'process.control.restarted':'process.control.running');await api.wait(120)}
}
