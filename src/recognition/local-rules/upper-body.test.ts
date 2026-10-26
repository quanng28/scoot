import {expect,it} from 'vitest';
import {recognizeUpperBody,LOCAL_RULES_SETTINGS} from './upper-body.js';
import {FEATURE_SCHEMA_VERSION,type MovementWindow} from '../../contracts/recognition.js';
import {buildSyntheticUpperBodyInput} from '../../analysis/synthetic-upper-body.js';
import {extractUpperBodyWindow} from '../../analysis/upper-body-engineering.js';
/** Explicit feature-timeline wiring fixtures, not labeled participant accuracy data. */
function fixture(kind:'rest'|'reach'|'raise'|'elbow'|'partial'='reach'):MovementWindow {
  return {schemaVersion:FEATURE_SCHEMA_VERSION,startMs:0,endMs:2000,quality:{status:'measurable',coverage:1,maxGapMs:0},samples:Array.from({length:21},(_,i)=>{
    const phase=kind==='rest'?0:kind==='partial'?i/20:1-Math.abs(i-10)/10;
    return {timestampMs:i*100,features:{elbowAngleDeg:90+40*phase,upperArmToTrunkAngleDeg:kind==='elbow'?20:20+25*phase,wristForwardReferenceLengths:phase*.6,wristElevationReferenceLengths:kind==='raise'?.5*phase:0,torsoInclinationChangeDeg:0,kneeAngleDeg:null,ankleSignedChangeDeg:null,kneeElevationReferenceLengths:null}};
  })};
}
it('suggests only engineering rest/reach patterns, with explanations and manual confirmation',()=>{
  expect(recognizeUpperBody(fixture('rest'))).toMatchObject({status:'suggestion',label:'rest',requiresConfirmation:true,validated:false});
  expect(recognizeUpperBody(fixture())).toMatchObject({status:'suggestion',label:'seated_forward_reach',reasons:expect.arrayContaining(['FORWARD_WRIST_EXCURSION_AND_RETURN'])});
  expect(Object.isFrozen(LOCAL_RULES_SETTINGS)).toBe(true);
});
it('consumes the actual fixed-profile extractor output, including conservative abstention',()=>{
  const input=buildSyntheticUpperBodyInput();
  expect(recognizeUpperBody(extractUpperBodyWindow(input))).toMatchObject({status:'abstained',label:'unknown',reasons:['REACH_OR_ARM_RAISE_AMBIGUOUS']});
  for(const sample of input.samples)sample.landmarks=structuredClone(input.restSamples[0]!.landmarks);
  expect(recognizeUpperBody(extractUpperBodyWindow(input))).toMatchObject({status:'suggestion',label:'rest'});
});
it.each(['raise','elbow','partial'] as const)('abstains for %s ambiguity or an incomplete cycle',kind=>{
  expect(recognizeUpperBody(fixture(kind))).toMatchObject({status:'abstained',label:'unknown'});
});
it.each(['partial-window','poor-metadata','forged-quality','lower-limb','selected-label','target','thresholds','flags','landmarks','identifiers'] as const)('rejects %s input',kind=>{
  const w=fixture();
  if(kind==='partial-window'){w.endMs=1000;w.samples=w.samples.filter(s=>s.timestampMs<=1000);}
  if(kind==='poor-metadata')w.quality.status='unable_to_measure';
  if(kind==='forged-quality')for(const s of w.samples.slice(2,15))s.features.elbowAngleDeg=null;
  if(kind==='lower-limb')w.samples[0]!.features.kneeAngleDeg=90;
  if(kind==='selected-label')Object.assign(w,{selectedExercise:'seated_forward_reach'});
  if(kind==='target')Object.assign(w,{target:{x:1,y:1}});
  if(kind==='thresholds')Object.assign(w,{thresholds:[8]});
  if(kind==='flags')Object.assign(w,{flags:[]});
  if(kind==='landmarks')Object.assign(w,{landmarks:[]});
  if(kind==='identifiers')Object.assign(w,{sessionId:'person'});
  expect(recognizeUpperBody(w)).toMatchObject({status:'unable_to_measure',label:'unknown'});
});
