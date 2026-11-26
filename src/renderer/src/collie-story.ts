export const COLLIE_STORY_DURATION = 20_000
export const collieActivities = ['ball', 'frisbee', 'tug', 'basketball'] as const
export type MascotActivity = typeof collieActivities[number]

export interface ColliePose {
  x:number; y:number; tilt:number; head:number; bow:number; front:number; back:number
  run:number; tail:number; look:number; joy:number
  ballX:number; ballY:number; ballAngle:number; ballScale:number; ballOpacity:number
  discX:number; discY:number; discAngle:number; discOpacity:number
  ropeEndX:number; ropeEndY:number; ropeSlack:number; ropeOpacity:number; ropeLoose:number
  hoopOpacity:number
}
type Cue = Partial<ColliePose> & {at:number; phase:string}
const neutral:ColliePose = {
  x:240,y:240,tilt:0,head:0,bow:0,front:0,back:0,run:0,tail:0,look:0,joy:0,
  ballX:425,ballY:226,ballAngle:0,ballScale:1,ballOpacity:0,
  discX:580,discY:105,discAngle:-12,discOpacity:0,
  ropeEndX:560,ropeEndY:196,ropeSlack:0,ropeOpacity:0,ropeLoose:0,hoopOpacity:0
}
// Each scene has a beginning, a mishap and an ending. These are full stories,
// rather than short gait loops stretched to twenty seconds.
const stories:Record<MascotActivity,Cue[]> = {
  ball:[
    {at:0,phase:'notice',x:230,head:9,ballOpacity:1},
    {at:2200,phase:'sniff',x:305,head:18,bow:12,look:4},
    {at:4500,phase:'play-bow',x:330,head:6,bow:26,front:-16,back:8,tail:-12},
    {at:6200,phase:'nudge',x:345,bow:15,front:-40,ballX:440},
    {at:7800,phase:'ball-escapes',x:355,bow:0,front:0,ballX:530,ballY:185,ballAngle:150},
    {at:9200,phase:'chase',x:440,y:236,run:1,ballX:582,ballY:226,ballAngle:310},
    {at:10800,phase:'overshoot',x:525,y:237,tilt:-9,ballX:500,ballY:226,ballAngle:440},
    {at:12000,phase:'skid',x:565,y:240,tilt:10,run:0,front:-32,back:20,head:-20},
    {at:13600,phase:'where-did-it-go',x:535,tilt:0,front:0,back:0,head:-25,look:-8},
    {at:15000,phase:'found-it',x:455,bow:20,head:15,run:.6,ballX:500},
    {at:16500,phase:'retrieve',x:365,bow:0,head:0,run:.8,ballX:439,ballY:183},
    {at:18300,phase:'present',x:280,y:240,run:0,ballX:375,ballY:226,ballAngle:600,head:-8},
    {at:20000,phase:'proud-wag',head:4,joy:1,front:-8}
  ],
  frisbee:[
    {at:0,phase:'listen',x:220,head:-14,look:-7,discOpacity:0},
    {at:1800,phase:'disc-arrives',discX:615,discY:105,discOpacity:1,discAngle:20},
    {at:3800,phase:'track',x:270,head:-21,bow:10,discX:480,discY:92,discAngle:-15},
    {at:5800,phase:'crouch',x:310,bow:26,front:-18,discX:470,discY:92},
    {at:7600,phase:'run-up',x:370,y:237,bow:0,run:1,discX:530,discY:82,front:0},
    {at:9500,phase:'leap',x:440,y:181,tilt:-14,run:0,front:-64,back:35,discX:540,discY:102},
    {at:11200,phase:'catch',x:465,y:151,tilt:-8,head:-10,discX:547,discY:92,discAngle:2},
    {at:13000,phase:'landing',x:490,y:240,tilt:8,front:-12,back:0,head:0,discX:569,discY:179,discAngle:8},
    {at:14400,phase:'little-wobble',x:478,tilt:-6,front:14,discX:555,discY:177},
    {at:16500,phase:'bring-it-back',x:350,y:236,tilt:0,run:.8,front:0,discX:429,discY:176},
    {at:18500,phase:'drop',x:270,y:240,run:0,discX:370,discY:236,discAngle:0},
    {at:20000,phase:'one-more',head:-13,bow:10,tail:-10,joy:.7}
  ],
  tug:[
    {at:0,phase:'curious',x:265,head:12,ropeEndX:560,ropeEndY:204,ropeSlack:34,ropeOpacity:1},
    {at:2800,phase:'pick-up',x:365,bow:21,head:16},
    {at:5000,phase:'brace',x:370,bow:8,head:0,front:16,back:-16,ropeSlack:4},
    {at:7600,phase:'first-pull',x:335,tilt:-5,bow:17,head:-9,ropeSlack:0,front:30,back:-25},
    {at:9600,phase:'dig-in',x:315,tilt:4,bow:22,head:8,front:36,back:-30},
    {at:11600,phase:'big-pull',x:295,tilt:-8,bow:12,head:-11,ropeEndX:541,ropeSlack:0},
    {at:13000,phase:'rope-slips',x:260,y:217,tilt:-24,bow:0,front:-64,back:34,ropeEndX:485,ropeEndY:168,ropeLoose:1},
    {at:14700,phase:'flop',x:245,y:240,tilt:9,front:-20,back:12,head:19,ropeEndX:422,ropeEndY:233,ropeSlack:37},
    {at:16500,phase:'shake-it-off',x:290,tilt:0,head:-16,front:0,back:0,ropeEndX:450,ropeEndY:198,ropeSlack:15},
    {at:18300,phase:'victory',x:310,head:8,ropeEndX:465,ropeEndY:210,joy:1},
    {at:20000,phase:'happy-rest',bow:20,head:0,ropeEndX:455,ropeEndY:235,ropeSlack:27,joy:.4}
  ],
  basketball:[
    {at:0,phase:'size-it-up',x:250,ballX:388,ballY:225,ballScale:1.35,ballOpacity:1,hoopOpacity:1,head:8},
    {at:2400,phase:'paw-up',x:288,front:-54,head:12},
    {at:4200,phase:'first-bounce',x:305,front:-20,ballX:400,ballY:196,ballAngle:70},
    {at:5500,phase:'dribble-down',front:-42,ballX:410,ballY:225,ballAngle:145},
    {at:6800,phase:'dribble-up',front:-15,ballX:420,ballY:169,ballAngle:220},
    {at:8100,phase:'nose-shot',x:350,head:-22,front:0,ballX:450,ballY:135,ballAngle:260},
    {at:9800,phase:'first-shot',x:380,head:-20,ballX:535,ballY:90,ballAngle:330},
    {at:11300,phase:'rim-bounce',ballX:592,ballY:126,ballAngle:420,head:-12},
    {at:12700,phase:'rebound',x:395,front:-45,ballX:485,ballY:198,ballAngle:510},
    {at:14300,phase:'second-chance',x:420,y:208,tilt:-13,head:-21,front:-62,ballX:505,ballY:112,ballAngle:590},
    {at:15800,phase:'high-arc',x:430,y:240,tilt:0,front:0,ballX:565,ballY:72,ballAngle:650},
    {at:17300,phase:'basket',ballX:592,ballY:153,ballAngle:740,head:-10},
    {at:18600,phase:'score',ballX:592,ballY:225,ballAngle:810,front:-38,joy:1},
    {at:20000,phase:'victory-dance',x:405,y:235,tilt:-5,front:-20,back:10,head:7,joy:.8}
  ]
}
const expanded = Object.fromEntries(collieActivities.map(activity=>{
  let previous=neutral
  return [activity,stories[activity].map(cue=>{previous={...previous,...cue};return {...previous,at:cue.at,phase:cue.phase}})]
})) as Record<MascotActivity,Array<ColliePose & {at:number;phase:string}>>

export function sampleCollieStory(activity:MascotActivity,elapsed:number):ColliePose & {phase:string} {
  const time=Math.max(0,Math.min(COLLIE_STORY_DURATION,Number.isFinite(elapsed)?elapsed:0)),cues=expanded[activity]
  let index=0
  while(index<cues.length-1&&time>=cues[index+1].at)index++
  const from=cues[index],to=cues[Math.min(index+1,cues.length-1)]
  const ratio=to.at===from.at?0:(time-from.at)/(to.at-from.at),ease=ratio*ratio*(3-2*ratio)
  const pose={phase:from.phase} as ColliePose & {phase:string}
  for(const key of Object.keys(neutral) as Array<keyof ColliePose>)pose[key]=from[key]+(to[key]-from[key])*ease
  return pose
}

export function nextCollieActivity(activity:MascotActivity):MascotActivity {
  return collieActivities[(collieActivities.indexOf(activity)+1)%collieActivities.length]
}
