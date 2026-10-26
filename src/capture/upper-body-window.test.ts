import { expect, it } from 'vitest';
import { UpperBodyWindow, UPPER_BODY_SETTINGS } from './upper-body-window.js';
import { UPPER_BODY_SETTINGS as CANONICAL_SETTINGS } from '../analysis/upper-body-engineering.js';
import type { Sample } from '../pose/observations.js';
const calibration = { referenceLengthPx: 100, forwardSign: 1 as const, forwardUnit: { x: 1, y: 0 }, wristRest: { x: 100, y: 100 }, kneeRest: null, torsoRestDeg: 0, ankleRestDeg: null };
function sample(timestampMs: number, confidence = 0.5): Sample {
  return { timestampMs, landmarks: { shoulder: { x: .25, y: .2, confidence }, elbow: { x: .25, y: .4, confidence }, wrist: { x: .5, y: .4, confidence }, hip: { x: .25, y: .8, confidence }, knee: { x: .5, y: .8, confidence }, ankle: { x: .5, y: 1, confidence } } };
}
function ready() { const w = new UpperBodyWindow(); w.calibrate(calibration, 400, 300, 'left'); return w; }
it('uses the canonical immutable policy so capture cannot weaken recognition quality', () => {
  expect(UPPER_BODY_SETTINGS).toBe(CANONICAL_SETTINGS);
  expect(() => Reflect.set(UPPER_BODY_SETTINGS, 'minCoverage', 0)).not.toThrow();
  expect(UPPER_BODY_SETTINGS.minCoverage).toBe(0.8);
  expect(() => (UPPER_BODY_SETTINGS.requiredFeatures as unknown as string[]).pop()).toThrow();
  expect(UPPER_BODY_SETTINGS.requiredFeatures).toHaveLength(5);
});
it('waits for full two seconds and emits only fixed upper-body measurements', () => {
  const w = ready();
  for (let t=0;t<2000;t+=100) expect(w.accept(sample(t),400,300,'left')).toBeNull();
  const result = w.accept(sample(2000),400,300,'left')!;
  expect(result.endMs-result.startMs).toBe(2000);
  expect(result.quality).toMatchObject({status:'measurable',coverage:1,maxGapMs:0});
  expect(result.samples.every(s=>s.features.kneeAngleDeg===null && s.features.ankleSignedChangeDeg===null && s.features.kneeElevationReferenceLengths===null)).toBe(true);
});
it('rejects low confidence and unsupported gaps despite otherwise good coverage', () => {
  const w=ready(); let result;
  for(let t=0;t<=2000;t+=100) result=w.accept(sample(t,.49),400,300,'left');
  expect(result!.quality.status).toBe('unable_to_measure');
  const gap=ready();
  for(let t=0;t<=2000;t+=100) if(t<500 || t>=1000) result=gap.accept(sample(t),400,300,'left');
  expect(result!.quality.maxGapMs).toBeGreaterThan(300);
  expect(result!.quality.status).toBe('unable_to_measure');
});
it('discards calibration and buffers after explicit reset, side or geometry changes', () => {
  for(const change of ['reset','side','geometry']) {
    const w=ready();w.accept(sample(0),400,300,'left');
    if(change==='reset') w.reset();
    else w.accept(sample(100),change==='geometry'?800:400,300,change==='side'?'right':'left');
    expect(w.accept(sample(2000),400,300,'left')).toBeNull();
    w.calibrate(calibration,400,300,'left');
    expect(w.accept(sample(2100),400,300,'left')).toBeNull();
  }
});
it('snapshots samples and calibration rather than retaining caller-owned evidence',()=>{
  const w=ready();const first=sample(0);w.accept(first,400,300,'left');
  first.landmarks.wrist!.x=.99;
  let result;for(let t=100;t<=2000;t+=100)result=w.accept(sample(t),400,300,'left');
  expect(result!.samples[0]!.features.wristForwardReferenceLengths).toBe(1);
});
it('invalid calibration or malformed samples discard old buffers and require fresh setup',()=>{
  const w=ready();w.accept(sample(0),400,300,'left');
  expect(()=>w.calibrate({...calibration,referenceLengthPx:1},400,300,'left')).toThrow();
  expect(w.accept(sample(2000),400,300,'left')).toBeNull();
  w.calibrate(calibration,400,300,'left');const bad=sample(0);bad.landmarks.wrist!.confidence=NaN;
  expect(()=>w.accept(bad,400,300,'left')).toThrow('Malformed');expect(w.accept(sample(2000),400,300,'left')).toBeNull();
});
