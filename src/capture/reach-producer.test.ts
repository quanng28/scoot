import {expect,it} from 'vitest';
import {developerReachConfig,ReachSession} from './reach-session.js';
import {attemptReplayRange,reachProducerSchema} from '../contracts/reach-producer.js';
import {attemptRecordSchema,recordingEvidence,replayWindow,toAttemptRecord} from '../contracts/reach-session.js';
import {movementWindowSchema} from '../contracts/recognition.js';
import type {PoseFrame} from '../pose/observations.js';
import type {Recording} from './recorder.js';
const baseline={shoulder:{x:50,y:50},elbow:{x:50,y:100},wrist:{x:100,y:100},hip:{x:50,y:150}};
function setup(){const config=developerReachConfig(baseline,[{x:0,y:0},{x:100,y:0}],{x:200,y:100},400,300,'left','fixture',8);return {config,run:new ReachSession(config,5000)};}
function frame(t:number,x=100,shoulderX=50):PoseFrame {
  const points=Array.from({length:33},()=>({x:0,y:0,visibility:0}));
  for(const [key,index] of [['shoulder',11],['elbow',13],['wrist',15],['hip',23]] as const){const p=baseline[key];points[index]={x:(key==='wrist'?x:key==='shoulder'?shoulderX:p.x)/400,y:p.y/300,visibility:1};}
  return {type:'pose',sequence:t,timestampMs:5000+t,width:400,height:300,inferenceMs:1,points};
}
function cycle(run:ReachSession,offset=0,flagged=false,incomplete=false){
  for(let t=0;t<=500;t+=100)run.frame(frame(offset+t));
  for(let t=600;t<=800;t+=100)run.frame(frame(offset+t,130,flagged?70:50));
  for(let t=900;t<=1100;t+=100)run.frame(frame(offset+t,incomplete?150:200,flagged?70:50));
  for(let t=1200;t<=1400;t+=100)run.frame(frame(offset+t));
  run.tick(5000+offset+1401);
}
const recording=(endMs=7000):Recording=>({blob:new Blob(['fixture-only'],{type:'video/webm'}),mimeType:'video/webm',startMs:5000,endMs,complete:true,reason:null});
it('exports the 12/10/2/4 producer batch with four measurements, versions, ranges and no diagnostics',()=>{
  const {run}=setup();for(let i=0;i<12;i++)cycle(run,i*2000,i<4,i>=10);
  run.stop(29000,'STOPPED_EARLY');const output=run.result(recording(29000),'synthetic_fixture');
  expect(run.summary()).toMatchObject({detected:12,measurable:10,excluded:2,flagged:4});
  expect(output).toMatchObject({schemaVersion:'sr01-producer.v1',timebase:'recording-relative-ms',participantReady:false,recording:{replay:'not_checked',timing:'estimated-recorder-start'}});
  expect(output.attempts[0]!.metrics).toMatchObject({elbowPeakDeg:{value:expect.any(Number),unit:'degrees'},torsoForwardPeakDeg:{value:expect.closeTo(11.3099,3)},wristForwardPeak:{value:1,unit:'reference lengths'},reachDurationSec:{value:.3,unit:'seconds'}});
  expect(output.attempts[0]!.flags[0]).toMatchObject({metric:'torsoForwardPeakDeg',operator:'>',threshold:8,replay:{startMs:600,endMs:1400}});
  expect(output.attempts[10]!.metrics.elbowPeakDeg).toMatchObject({value:null,reasons:expect.arrayContaining(['TARGET_NOT_REACHED'])});
  expect('observations' in output.attempts[0]!).toBe(false);expect('saveStatus' in output).toBe(false);
});
it('keeps capture side/orientation fixed despite input and returned-config mutation',()=>{
  const {run,config}=setup();config.side='right';config.orientation='changed';run.config.side='right';
  cycle(run);expect(run.attempts[0]!.classification).toBe('measurable');expect(run.attempts[0]!.side).toBe('left');
});
it('invalid stop leaves an open attempt recoverable and stale finite stop clamps to the latest clock',()=>{
  const {run}=setup();for(let t=0;t<=500;t+=100)run.frame(frame(t));for(let t=600;t<=800;t+=100)run.frame(frame(t,130));
  expect(()=>run.stop(NaN,'STOPPED_EARLY')).toThrow('Invalid stop');run.tick(5850);run.stop(5800,'DISCOMFORT_STOP');run.stop(5900,'STOPPED_EARLY');
  expect(run.attempts).toHaveLength(1);expect(run.attempts[0]).toMatchObject({endMs:850,classification:'excluded',reasons:expect.arrayContaining(['DISCOMFORT_STOP'])});
});
it.each(['metric','unit','reason','flag','quality','range','id','duplicate','metadata'] as const)('rejects malformed %s at the producer/consumer boundary',kind=>{
  const {run}=setup();cycle(run,0,true);run.stop(7000,'STOPPED_EARLY');const output=run.result(recording(),'synthetic_fixture'),a=output.attempts[0]!;
  if(kind==='metric')a.metrics.elbowPeakDeg.value=NaN;
  if(kind==='unit')Object.assign(a.metrics.wristForwardPeak,{unit:'centimeters'});
  if(kind==='reason')a.metrics.elbowPeakDeg.value=null;
  if(kind==='flag')a.flags[0]!.observed=0;
  if(kind==='quality')a.quality.coverage=0;
  if(kind==='range')a.endMs=a.startMs-1;
  if(kind==='id')a.configurationId='other';
  if(kind==='duplicate')output.attempts.push(a);
  if(kind==='metadata')Object.assign(output,{selectedExercise:'reach'});
  expect(reachProducerSchema.safeParse(output).success).toBe(false);
});
it('requires finalization and the same recording anchor; bounds replay by decoded and captured durations',()=>{
  const {run}=setup();cycle(run);expect(()=>run.result(recording(),'synthetic_fixture')).toThrow('Stop');run.stop(7000,'STOPPED_EARLY');
  expect(()=>run.result({...recording(),startMs:4999},'synthetic_fixture')).toThrow('anchor');
  const a=run.result(recording(),'synthetic_fixture').attempts[0]!;
  expect(attemptReplayRange(a,2000,1800)).toEqual({startMs:100,endMs:1800,timing:'estimated-recorder-start'});
  expect(attemptReplayRange(a,2000,1000)).toBeNull();expect(attemptReplayRange(a,NaN,2000)).toBeNull();expect(attemptReplayRange(a,2000,Infinity)).toBeNull();
});
it('does not export complete evidence when the recording Blob is empty or mismatched',()=>{
  const {run}=setup();cycle(run);run.stop(7000,'STOPPED_EARLY');
  expect(()=>run.result({...recording(),blob:new Blob([],{type:'video/webm'})},'synthetic_fixture')).toThrow('nonempty Blob');
  expect(()=>run.result({...recording(),mimeType:'video/mp4'},'synthetic_fixture')).toThrow('matching MIME');
});

it.each(['short','interrupted','missing'] as const)('retains measured attempts and flags when recording is %s',kind=>{
  const {run}=setup();cycle(run,0,true);run.stop(7000,'STOPPED_EARLY');
  const expected=run.result(recording(),'synthetic_fixture').attempts;
  const video:Recording=kind==='short' ? recording(6000) : {
    ...recording(kind==='missing'?5000:6000),complete:false,reason:'Recording interrupted',
    ...(kind==='missing'?{blob:new Blob([],{type:'video/webm'})}:{})
  };
  const output=run.result(video,'synthetic_fixture');
  expect(output.attempts).toEqual(expected);
  expect(output.attempts[0]).toMatchObject({classification:'measurable',flags:[{metric:'torsoForwardPeakDeg',operator:'>',threshold:8}]});
  expect(output.recording).toMatchObject({durationMs:kind==='missing'?0:1000,replay:'not_checked'});
  expect(attemptReplayRange(output.attempts[0],output.recording.durationMs,1000)).toBeNull();
  expect(replayWindow(output.attempts[0]!,recordingEvidence(video,'No video'),true).available).toBe(false);
});
it('hands all measured and excluded attempts to the merged consumer contract without diagnostics',()=>{
  const {run}=setup();cycle(run,0,true);cycle(run,2000,false,true);run.stop(9000,'STOPPED_EARLY');
  const output=run.result(recording(9000),'synthetic_fixture');
  const consumed=output.attempts.map(a=>toAttemptRecord({
    ...a,observations:[],evidence:{status:'unavailable',reason:'Replay decoding and timing remain consumer checks.'}
  }));
  expect(consumed.map(a=>a.classification)).toEqual(['measurable','excluded']);
  for(const [index,a] of consumed.entries()) {
    expect(attemptRecordSchema.safeParse(a).success).toBe(true);
    expect(a.metrics).toEqual(output.attempts[index]!.metrics);
    expect(a.flags).toEqual(output.attempts[index]!.flags);
    expect(a.engineEvidence.status).toBe('unavailable');
    expect(a).not.toHaveProperty('observations');
    expect(a).not.toHaveProperty('raw');
    // Local result/configuration envelopes cannot masquerade as the provider allowlist.
    expect(movementWindowSchema.safeParse(a).success).toBe(false);
  }
  expect(movementWindowSchema.safeParse(output).success).toBe(false);
});
it.each(['duplicate-reason','missing-explanation'] as const)('rejects %s to preserve consumer conformance',kind=>{
  const {run}=setup();cycle(run,0,false,true);run.stop(7000,'STOPPED_EARLY');
  const output=run.result(recording(),'synthetic_fixture'),a=output.attempts[0]!;
  if(kind==='duplicate-reason') {
    a.reasons.push(a.reasons[0]!);a.explanations.push(a.explanations[0]!);
  } else a.explanations.pop();
  expect(reachProducerSchema.safeParse(output).success).toBe(false);
});
