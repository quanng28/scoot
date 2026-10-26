import { describe, expect, it } from 'vitest';
import { calibrateRest } from './rest-calibration.js';
import { buildSyntheticUpperBodyFixture, buildSyntheticUpperBodyInput } from './synthetic-upper-body.js';
import { extractUpperBodyWindow, UPPER_BODY_POLICY_VERSION, UPPER_BODY_SETTINGS } from './upper-body-engineering.js';
function missingWrist(indices: number[]) {
  const input = buildSyntheticUpperBodyInput();
  for (const index of indices) delete input.samples[index]!.landmarks.wrist;
  return input;
}
describe('fixed upper-body engineering profile', () => {
  it('computes a full 21-sample synthetic window with complete coverage and no leg calibration', () => {
    const fixture = buildSyntheticUpperBodyFixture();
    expect(fixture.policyVersion).toBe(UPPER_BODY_POLICY_VERSION);
    expect(fixture.fixtureStatus).toContain('SYNTHETIC ONLY');
    expect(fixture.window.samples).toHaveLength(21);
    expect(fixture.window.endMs - fixture.window.startMs).toBe(2000);
    expect(fixture.window.quality).toEqual({ status: 'measurable', coverage: 1, maxGapMs: 0 });
    for (const sample of fixture.window.samples) {
      expect(sample.features.kneeAngleDeg).toBeNull();
      expect(sample.features.kneeElevationReferenceLengths).toBeNull();
      expect(sample.features.ankleSignedChangeDeg).toBeNull();
    }
    const input = buildSyntheticUpperBodyInput();
    const calibration = calibrateRest(input.restSamples, input.frameWidth, input.frameHeight, input.reference, input.forwardSign);
    expect(calibration.kneeRest).toBeNull(); expect(calibration.ankleRestDeg).toBeNull();
  });
  it('freezes the profile and its required-feature list independently of exercise choice', () => {
    expect(Object.isFrozen(UPPER_BODY_SETTINGS)).toBe(true);
    expect(Object.isFrozen(UPPER_BODY_SETTINGS.requiredFeatures)).toBe(true);
    expect(UPPER_BODY_SETTINGS).toEqual({ version: 'upper-body-engineering-v1', minConfidence: 0.5,
      minSegmentPx: 2, sampleSupportMs: 150, minCoverage: 0.8, maxGapMs: 300,
      requiredFeatures: ['elbowAngleDeg', 'upperArmToTrunkAngleDeg', 'wristForwardReferenceLengths', 'wristElevationReferenceLengths', 'torsoInclinationChangeDeg'] });
  });
  it.each([0, 1999, 2001, 10_000])('rejects non-profile duration %s, including partial warm-up', (endMs) => {
    expect(() => extractUpperBodyWindow({ ...buildSyntheticUpperBodyInput(), endMs })).toThrow();
  });
  it.each(['settings', 'calibration', 'selectedExercise', 'expectedExercise', 'participantId'])('rejects caller override/prohibited metadata %s', (key) => {
    expect(() => extractUpperBodyWindow({ ...buildSyntheticUpperBodyInput(), [key]: {} })).toThrow();
  });
  it('rejects nested metadata in reference and calibration observations', () => {
    const input = buildSyntheticUpperBodyInput();
    expect(() => extractUpperBodyWindow({ ...input, reference: [{ ...input.reference[0], notes: 'private' }, input.reference[1]] })).toThrow();
    expect(() => extractUpperBodyWindow({ ...input, restSamples: [{ ...input.restSamples[0], expectedExercise: 'reach' }, ...input.restSamples.slice(1)] })).toThrow();
  });
  it('rejects required feature loss using quality, without lowering requirements', () => {
    const input = missingWrist(Array.from({ length: 21 }, (_, i) => i));
    expect(extractUpperBodyWindow(input).quality.status).toBe('unable_to_measure');
  });
  it('accepts a 2 px upper-arm segment and rejects one below the fixed minimum', () => {
    const input = buildSyntheticUpperBodyInput();
    for (const sample of input.samples) {
      sample.landmarks.shoulder = { x: 0, y: 0, confidence: 1 };
      sample.landmarks.elbow = { x: 2 / 640, y: 0, confidence: 1 };
    }
    expect(extractUpperBodyWindow(input).quality.status).toBe('measurable');
    for (const sample of input.samples) sample.landmarks.elbow!.x = 1.99 / 640;
    expect(extractUpperBodyWindow(input).quality.status).toBe('unable_to_measure');
  });
  it('accepts confidence exactly 0.5 and rejects insufficient required-feature confidence', () => {
    const input = buildSyntheticUpperBodyInput();
    for (const sample of input.samples) sample.landmarks.wrist!.confidence = 0.5;
    expect(extractUpperBodyWindow(input).quality.status).toBe('measurable');
    for (const sample of input.samples) sample.landmarks.wrist!.confidence = 0.499;
    expect(extractUpperBodyWindow(input).quality).toEqual({ status: 'unable_to_measure', coverage: 0, maxGapMs: 2000 });
  });
  it('accepts coverage exactly 0.8 but rejects below it without a gap violation', () => {
    expect(extractUpperBodyWindow(missingWrist([2, 6, 10, 14])).quality).toEqual({ status: 'measurable', coverage: 0.8, maxGapMs: 100 });
    expect(extractUpperBodyWindow(missingWrist([2, 6, 10, 14, 18])).quality).toEqual({ status: 'unable_to_measure', coverage: 0.75, maxGapMs: 100 });
  });
  it('accepts a 300 ms gap and rejects 400 ms even with coverage 0.8', () => {
    expect(extractUpperBodyWindow(missingWrist([2, 3, 4])).quality).toEqual({ status: 'measurable', coverage: 0.85, maxGapMs: 300 });
    expect(extractUpperBodyWindow(missingWrist([2, 3, 4, 5])).quality).toEqual({ status: 'unable_to_measure', coverage: 0.8, maxGapMs: 400 });
  });
});
describe('fixed engineering rest calibration', () => {
  const calibrate = (input = buildSyntheticUpperBodyInput()) => calibrateRest(input.restSamples, input.frameWidth, input.frameHeight, input.reference, input.forwardSign);
  it('accepts six observations across exactly one second and the 20 px reference boundary', () => {
    const input = buildSyntheticUpperBodyInput(); input.reference[1].x = 40;
    expect(calibrate(input).referenceLengthPx).toBe(20);
  });
  it('accepts a 250 ms calibration gap and a 20 px shoulder–hip baseline', () => {
    const input = buildSyntheticUpperBodyInput(); input.restSamples[1]!.timestampMs = 250;
    for (const sample of input.restSamples) {
      sample.landmarks.shoulder = { x: 0, y: 0.5, confidence: 1 };
      sample.landmarks.hip = { x: 20 / 640, y: 0.5, confidence: 1 };
    }
    expect(() => calibrate(input)).not.toThrow();
  });
  it('accepts maximum landmark distance 20 px and rejects beyond it', () => {
    const input = buildSyntheticUpperBodyInput();
    input.restSamples[0]!.landmarks.wrist!.x += 20 / 640;
    expect(() => calibrate(input)).not.toThrow();
    input.restSamples[0]!.landmarks.wrist!.x += 0.001;
    expect(() => calibrate(input)).toThrow('Rest position moved');
  });
  it.each(['few', 'short', 'gap', 'missing', 'confidence', 'null', 'nonfinite', 'short_reference', 'short_trunk'] as const)('rejects invalid calibration %s', (condition) => {
    const input = buildSyntheticUpperBodyInput();
    if (condition === 'few') input.restSamples.pop();
    if (condition === 'short') input.restSamples.forEach((s, i) => { s.timestampMs = i * 199; });
    if (condition === 'gap') input.restSamples.at(-1)!.timestampMs += 301;
    if (condition === 'missing') delete input.restSamples[0]!.landmarks.hip;
    if (condition === 'confidence') input.restSamples[0]!.landmarks.wrist!.confidence = 0.499;
    if (condition === 'null') input.restSamples[0]!.landmarks.wrist!.confidence = null;
    if (condition === 'nonfinite') input.restSamples[0]!.landmarks.wrist!.x = Infinity;
    if (condition === 'short_reference') input.reference[1].x = 39.9;
    if (condition === 'short_trunk') for (const sample of input.restSamples) sample.landmarks.hip!.y = 0.21;
    expect(() => calibrate(input)).toThrow();
  });
  it('rejects malformed reference metadata and non-finite timestamps', () => {
    const input = buildSyntheticUpperBodyInput();
    expect(() => calibrateRest(input.restSamples, 640, 480, [{ ...input.reference[0], notes: 'private' }, input.reference[1]] as unknown as typeof input.reference, 1)).toThrow();
    input.restSamples[0]!.timestampMs = NaN;
    expect(() => calibrate(input)).toThrow();
  });
});
