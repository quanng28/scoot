import { describe, expect, it } from 'vitest';
import { extractMovementWindow, type ExtractionInput } from './movement-features.js';

function fixture(): ExtractionInput {
  return {
    startMs: 0, endMs: 200, frameWidth: 200, frameHeight: 100, side: 'left',
    calibration: { referenceLengthPx: 100, forwardSign: 1, wristRest: { x: 50, y: 75 }, kneeRest: { x: 100, y: 75 }, forwardUnit: { x: 1, y: 0 }, torsoRestDeg: 0, ankleRestDeg: 90 },
    settings: { version: 'synthetic-v1', minConfidence: 0.5, minSegmentPx: 1, sampleSupportMs: 100, minCoverage: 0.9, maxGapMs: 100, requiredFeatures: ['elbowAngleDeg'] },
    samples: [0, 100, 200].map((timestampMs) => ({ timestampMs, landmarks: {
      shoulder: { x: 0.25, y: 0.25, confidence: 1 }, elbow: { x: 0.25, y: 0.5, confidence: 1 },
      wrist: { x: 0.5, y: 0.5, confidence: 1 }, hip: { x: 0.25, y: 0.75, confidence: 1 },
      knee: { x: 0.5, y: 0.75, confidence: 1 }, ankle: { x: 0.5, y: 1, confidence: 1 },
      heel: { x: 0.45, y: 1, confidence: 1 }, footIndex: { x: 0.75, y: 1, confidence: 1 },
    } })),
  };
}
describe('movement feature extraction', () => {
  it('computes independently known geometry and fixed-reference displacements', () => {
    const result = extractMovementWindow(fixture());
    expect(result.samples[0]!.features).toEqual({ elbowAngleDeg: 90, upperArmToTrunkAngleDeg: 0, kneeAngleDeg: 90, ankleSignedChangeDeg: 0, wristForwardReferenceLengths: 0.5, wristElevationReferenceLengths: 0.25, kneeElevationReferenceLengths: 0, torsoInclinationChangeDeg: 0 });
    expect(result.quality).toEqual({ status: 'measurable', coverage: 1, maxGapMs: 0 });
  });
  it('uses intrinsic pixels rather than distorted normalized geometry', () => {
    const input = fixture();
    for (const s of input.samples) s.landmarks.wrist = { x: 0.5, y: 1, confidence: 1 };
    expect(extractMovementWindow(input).samples[0]!.features.elbowAngleDeg).toBeCloseTo(135);
  });
  it('normalizes reflected coordinates with explicit forward sign', () => {
    const input = fixture();
    for (const s of input.samples) for (const p of Object.values(s.landmarks)) if (p) p.x = 1 - p.x;
    input.calibration.wristRest = { x: 150, y: 75 };
    input.calibration.forwardUnit = { x: -1, y: 0 };
    input.calibration.forwardSign = -1;
    input.calibration.ankleRestDeg = -90;
    expect(extractMovementWindow(input).samples[0]!.features).toEqual(extractMovementWindow(fixture()).samples[0]!.features);
  });
  it.each(['missing', 'confidence', 'outside', 'degenerate'] as const)('returns null for %s geometry', (kind) => {
    const input = fixture();
    for (const s of input.samples) {
      if (kind === 'missing') delete s.landmarks.wrist;
      if (kind === 'confidence') s.landmarks.wrist!.confidence = null;
      if (kind === 'outside') s.landmarks.wrist!.x = 2;
      if (kind === 'degenerate') s.landmarks.wrist = { ...s.landmarks.elbow! };
    }
    const result = extractMovementWindow(input);
    expect(result.samples[0]!.features.elbowAngleDeg).toBeNull();
    expect(result.quality.status).toBe('unable_to_measure');
  });
  it('accounts for gaps including missing leading and trailing support', () => {
    const input = fixture();
    input.samples = [input.samples[1]!, input.samples[2]!];
    input.settings.sampleSupportMs = 20;
    const result = extractMovementWindow(input);
    expect(result.quality).toEqual({ status: 'unable_to_measure', coverage: 0.1, maxGapMs: 100 });
  });
  it('invalid observations interrupt support and cannot disappear from coverage', () => {
    const input = fixture();
    delete input.samples[1]!.landmarks.wrist;
    expect(extractMovementWindow(input).quality).toEqual({ status: 'unable_to_measure', coverage: 0.5, maxGapMs: 100 });
  });
  it.each(['duplicate', 'reversed', 'nonfinite', 'direction', 'reference'] as const)('rejects %s input', (kind) => {
    const input = fixture();
    if (kind === 'duplicate') input.samples[1]!.timestampMs = 0;
    if (kind === 'reversed') input.samples.reverse();
    if (kind === 'nonfinite') input.samples[0]!.landmarks.wrist!.x = NaN;
    if (kind === 'direction') input.calibration.forwardUnit = { x: 2, y: 0 };
    if (kind === 'reference') input.calibration.referenceLengthPx = 0;
    expect(() => extractMovementWindow(input)).toThrow();
  });
  it('requires observed heel evidence for the ankle proxy', () => {
    const input = fixture();
    delete input.samples[0]!.landmarks.heel;
    expect(extractMovementWindow(input).samples[0]!.features.ankleSignedChangeDeg).toBeNull();
  });
});
