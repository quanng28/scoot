import { movementWindowSchema } from '../../contracts/recognition.js';
import { UPPER_BODY_SETTINGS, UPPER_BODY_POLICY_VERSION, UPPER_BODY_WINDOW_MS } from '../../analysis/upper-body-engineering.js';
import { windowSupport } from '../../analysis/movement-features.js';

export const LOCAL_RULES_VERSION='upper-body-rules.engineering-v1' as const;
/** Illustrative engineering cutoffs, not clinical limits or evaluated recognition accuracy. */
export const LOCAL_RULES_SETTINGS=Object.freeze({restDisplacement:.08,restAngleRangeDeg:8,restTorsoDeg:5,endpointTolerance:.12,minForwardPeak:.3,maxElevation:.15,minArmRangeDeg:12,minElbowRangeDeg:15});
export type LocalRecognition = {
  version:typeof LOCAL_RULES_VERSION; policyVersion:typeof UPPER_BODY_POLICY_VERSION;
  status:'suggestion'|'abstained'|'unable_to_measure'; label:'rest'|'seated_forward_reach'|'unknown';
  reasons:string[]; requiresConfirmation:true; validated:false;
};
/** Only independent allowlisted features enter. No selected task, target or criteria parameter exists. */
export function recognizeUpperBody(raw:unknown):LocalRecognition {
  const result=(status:LocalRecognition['status'],label:LocalRecognition['label'],...reasons:string[]):LocalRecognition=>({version:LOCAL_RULES_VERSION,policyVersion:UPPER_BODY_POLICY_VERSION,status,label,reasons,requiresConfirmation:true,validated:false});
  const parsed=movementWindowSchema.safeParse(raw);
  if(!parsed.success) return result('unable_to_measure','unknown','INVALID_FEATURE_WINDOW');
  const w=parsed.data;
  if(w.endMs-w.startMs!==UPPER_BODY_WINDOW_MS) return result('unable_to_measure','unknown','COMPLETE_TWO_SECOND_WINDOW_REQUIRED');
  if(w.samples.some(s=>s.features.kneeAngleDeg!==null || s.features.ankleSignedChangeDeg!==null || s.features.kneeElevationReferenceLengths!==null)) return result('unable_to_measure','unknown','UPPER_BODY_ONLY_PROFILE_REQUIRED');
  const validity=w.samples.map(s=>({timestampMs:s.timestampMs,valid:UPPER_BODY_SETTINGS.requiredFeatures.every(k=>s.features[k]!==null)}));
  const quality=windowSupport(validity,w.startMs,w.endMs,UPPER_BODY_SETTINGS.sampleSupportMs);
  if(w.quality.status!=='measurable' || w.quality.coverage<UPPER_BODY_SETTINGS.minCoverage || w.quality.maxGapMs>UPPER_BODY_SETTINGS.maxGapMs ||
    quality.coverage<UPPER_BODY_SETTINGS.minCoverage || quality.maxGapMs>UPPER_BODY_SETTINGS.maxGapMs) return result('unable_to_measure','unknown','INSUFFICIENT_FIXED_PROFILE_QUALITY');
  const valid=w.samples.filter((_,i)=>validity[i]!.valid).map(s=>s.features);
  if(valid.length<2) return result('unable_to_measure','unknown','INSUFFICIENT_OBSERVATIONS');
  const forward=valid.map(f=>f.wristForwardReferenceLengths!),elevation=valid.map(f=>f.wristElevationReferenceLengths!);
  const arm=valid.map(f=>f.upperArmToTrunkAngleDeg!),elbow=valid.map(f=>f.elbowAngleDeg!),torso=valid.map(f=>f.torsoInclinationChangeDeg!);
  const span=(v:number[])=>Math.max(...v)-Math.min(...v),absolute=(v:number[])=>Math.max(...v.map(Math.abs));
  const s=LOCAL_RULES_SETTINGS;
  if(absolute(forward)<=s.restDisplacement && absolute(elevation)<=s.restDisplacement && span(arm)<=s.restAngleRangeDeg && span(elbow)<=s.restAngleRangeDeg && absolute(torso)<=s.restTorsoDeg)
    return result('suggestion','rest','SMALL_STABLE_UPPER_BODY_FEATURE_CHANGE');
  if(absolute(elevation)>s.maxElevation) return result('abstained','unknown','REACH_OR_ARM_RAISE_AMBIGUOUS');
  if(Math.max(...forward)<s.minForwardPeak) return result('abstained','unknown','NO_DISTINCT_FORWARD_CYCLE');
  if(span(arm)<s.minArmRangeDeg || span(elbow)<s.minElbowRangeDeg) return result('abstained','unknown','REACH_OR_ELBOW_MOTION_AMBIGUOUS');
  const peak=forward.indexOf(Math.max(...forward));
  if(peak===0 || peak===forward.length-1 || Math.abs(forward[0]!)>s.endpointTolerance || Math.abs(forward.at(-1)!)>s.endpointTolerance)
    return result('abstained','unknown','COMPLETE_REACH_RETURN_NOT_OBSERVED_IN_WINDOW');
  return result('suggestion','seated_forward_reach','FORWARD_WRIST_EXCURSION_AND_RETURN','ARM_AND_ELBOW_CHANGE_WITH_SMALL_ELEVATION','ENGINEERING_PATTERN_ONLY_REQUIRES_MANUAL_CONFIRMATION');
}
