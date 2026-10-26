import { describe, expect, it } from 'vitest';
import { calibratePoseBaseline, calibrateReachBaseline, calibrateRest } from './rest-calibration.js';
import type { Sample } from '../pose/observations.js';
const baseline = (): Sample[] => Array.from({ length: 7 }, (_, i) => ({ timestampMs: i * 200, landmarks: {
  shoulder: { x: 0.5, y: 0.2, confidence: 1 }, elbow: { x: 0.5, y: 0.4, confidence: 1 },
  wrist: { x: 0.6, y: 0.5, confidence: 1 }, hip: { x: 0.5, y: 0.8, confidence: 1 },
} }));
const reference: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
describe('experimental upper-body rest calibration', () => {
  it('accepts a stable six-observation baseline at 2.5 results/s but rejects a gap over 500 ms', () => {
    const samples = baseline().slice(0, 6).map((sample, i) => ({ ...sample, timestampMs: i * 400 }));
    expect(calibratePoseBaseline(samples, 640, 480).wrist).toEqual({ x: 384, y: 240 });
    samples[5]!.timestampMs += 101;
    expect(() => calibratePoseBaseline(samples, 640, 480)).toThrow('tracking gap');
  });
  it('captures fixed pixel baseline, sign and reference without inventing leg calibration', () => {
    const result = calibrateRest(baseline(), 640, 480, reference, -1);
    expect(result.wristRest).toEqual({ x: 384, y: 240 });
    expect(result.referenceLengthPx).toBe(100);
    expect(result.forwardUnit).toEqual({ x: -1, y: 0 });
    expect(result.torsoRestDeg).toBe(0);
    expect(result.kneeRest).toBeNull(); expect(result.ankleRestDeg).toBeNull();
  });
  it.each(['missing', 'confidence', 'motion', 'gap', 'duplicate', 'short'] as const)('rejects %s rest evidence', (kind) => {
    const samples = baseline();
    if (kind === 'missing') delete samples[1]!.landmarks.hip;
    if (kind === 'confidence') samples[1]!.landmarks.wrist!.confidence = null;
    if (kind === 'motion') samples[1]!.landmarks.wrist!.x = 0.9;
    if (kind === 'gap') samples.at(-1)!.timestampMs += 301;
    if (kind === 'duplicate') samples[1]!.timestampMs = 0;
    if (kind === 'short') samples.splice(3);
    expect(() => calibrateRest(samples, 640, 480, reference, 1)).toThrow();
  });
  it('rejects near-zero reference and out-of-frame taps', () => {
    expect(() => calibrateRest(baseline(), 640, 480, [{ x: 0, y: 0 }, { x: 1, y: 0 }], 1)).toThrow();
    expect(() => calibrateRest(baseline(), 640, 480, [{ x: -10, y: 0 }, { x: 100, y: 0 }], 1)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity, undefined])('rejects invalid confidence %s at every calibration entry', (confidence) => {
    const samples = baseline();
    const raw = samples as unknown as { landmarks: { wrist: { confidence?: number } } }[];
    if (confidence === undefined) delete raw[0]!.landmarks.wrist.confidence;
    else raw[0]!.landmarks.wrist.confidence = confidence;
    expect(() => calibratePoseBaseline(samples, 640, 480)).toThrow();
    expect(() => calibrateRest(samples, 640, 480, reference, 1)).toThrow();
    expect(() => calibrateReachBaseline(samples, 640, 480, reference)).toThrow();
  });
  it('rejects undeclared calibration fields and malformed references', () => {
    const samples = baseline();
    Object.assign(samples[0]!.landmarks.wrist!, { expectedExercise: 'reach' });
    expect(() => calibratePoseBaseline(samples, 640, 480)).toThrow();
    const privateReference = [{ x: 0, y: 0, notes: 'private' }, reference[1]] as unknown as typeof reference;
    expect(() => calibrateReachBaseline(baseline(), 640, 480, privateReference)).toThrow();
    expect(() => calibrateRest(baseline(), 640, 480, [reference[0]] as unknown as typeof reference, 1)).toThrow();
  });
  it('keeps reach and recognition baselines compatible without inventing target calibration', () => {
    const samples = baseline();
    const pose = calibratePoseBaseline(samples, 640, 480);
    expect(calibrateReachBaseline(samples, 640, 480, reference)).toEqual(pose);
    expect(calibrateRest(samples, 640, 480, reference, 1).wristRest).toEqual(pose.wrist);
  });
});
