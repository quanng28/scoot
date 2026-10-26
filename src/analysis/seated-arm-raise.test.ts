import { describe, expect, it } from 'vitest';
import { SeatedArmRaiseAnalyzer, summarizeArmRaise } from './seated-arm-raise.js';
import { armConfig, armPose, poseFrame, runFixtureCycle, reflected } from './seated-exercise.test-fixtures.js';

function cycle(engine: SeatedArmRaiseAnalyzer, config = armConfig(), endpoint = armPose(90)) {
  runFixtureCycle(engine, config, { rest: armPose(), outward: armPose(30), endpoint, returning: armPose(45) });
}
describe('SR03 independent geometry and fixed-driver calibration', () => {
  it('measures the shoulder vertex, fixed-reference wrist elevation and separate durations', () => {
    const engine = new SeatedArmRaiseAnalyzer(armConfig()); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable');
    expect(attempt.metrics.peakUpperArmAngleDeg.value).toBeCloseTo(90, 10);
    expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(1, 10);
    expect(attempt.metrics.torsoForwardPeakDeg.value).toBe(0);
    expect(attempt.metrics.raiseDurationSec).toMatchObject({ value: 0.176, unit: 'seconds' });
    expect(attempt.metrics.returnDurationSec.value).toBe(0.161);
  });
  it('accepts a bent elbow and keeps wrist elevation distinct from the upper-arm angle', () => {
    const endpoint = { ...armPose(90), wrist: { x: 250, y: 150 } };
    const engine = new SeatedArmRaiseAnalyzer(armConfig()); cycle(engine, armConfig(), endpoint);
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable');
    expect(attempt.metrics.peakUpperArmAngleDeg.value).toBeCloseTo(90);
    expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(0.5);
  });
  it('snapshots reference, direction, baseline and driver despite later caller edits', () => {
    const config = armConfig(), engine = new SeatedArmRaiseAnalyzer(config);
    config.reference[1].x = 520; config.endpointDriver = 'wristElevation'; config.endpointElevation = 4;
    config.baseline.wrist.y = 390; config.forwardSign = -1;
    cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(1);
    expect(engine.configuration.endpointDriver).toBe('upperArmAngle'); expect(engine.configuration.reference[1].x).toBe(120);
  });
  it('uses the fixed selected image reference even when the observed torso length changes', () => {
    const config = armConfig(); const engine = new SeatedArmRaiseAnalyzer(config);
    const endpoint = { shoulder: { x: 200, y: 50 }, hip: { x: 200, y: 250 }, elbow: { x: 250, y: 50 }, wrist: { x: 300, y: 100 } };
    cycle(engine, config, endpoint); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(1);
  });
  it('retains signed torso samples and reports only the positive forward peak in the outward interval', () => {
    const config = armConfig(), engine = new SeatedArmRaiseAnalyzer(config);
    const tilted = (angle: number, torso: number) => {
      const pose = armPose(angle), shift = 150 * Math.tan(torso * Math.PI / 180);
      pose.hip.x -= shift;
      return pose;
    };
    runFixtureCycle(engine, config, { rest: armPose(), outward: tilted(60, -15), endpoint: tilted(78, 12), returning: tilted(45, 30) });
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable');
    expect(attempt.metrics.peakUpperArmAngleDeg.value).toBeCloseTo(90);
    expect(attempt.metrics.torsoForwardPeakDeg.value).toBeCloseTo(12);
    expect(attempt.observations.some((o) => o.torsoDeltaDeg < 0)).toBe(true);
  });
  it.each([{ width: 600, height: 400 }, { width: 400, height: 600 }])('converts rectangular $width×$height frames in intrinsic pixels', ({ width, height }) => {
    const config = armConfig(); config.frameWidth = width; config.frameHeight = height;
    const engine = new SeatedArmRaiseAnalyzer(config); cycle(engine, config); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakUpperArmAngleDeg.value).toBeCloseTo(90); expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(1);
  });
  it('reflection changes forward direction but never substitutes anatomical side', () => {
    const config = armConfig(); config.side = 'right'; config.forwardSign = -1; config.baseline = reflected(config.baseline); config.reference = [{ x: 580, y: 20 }, { x: 480, y: 20 }];
    const engine = new SeatedArmRaiseAnalyzer(config);
    runFixtureCycle(engine, config, { rest: reflected(armPose()), outward: reflected(armPose(30)), endpoint: reflected(armPose(90)), returning: reflected(armPose(45)) });
    const attempt = engine.drain()[0]!; expect(attempt.side).toBe('right'); expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakUpperArmAngleDeg.value).toBeCloseTo(90); expect(attempt.metrics.peakWristElevation.value).toBeCloseTo(1);
  });
  it('fixed wrist driver does not switch to an observed angle endpoint', () => {
    const config = armConfig(); config.endpointDriver = 'wristElevation'; config.endpointElevation = 1.5;
    const engine = new SeatedArmRaiseAnalyzer(config); cycle(engine, config);
    const attempt = engine.drain()[0]!; expect(attempt.endpointMs).toBeNull(); expect(attempt.reasons).toContain('ENDPOINT_NOT_REACHED');
  });
  it('fixed angle driver does not switch to a wrist-only endpoint', () => {
    const config = armConfig(), engine = new SeatedArmRaiseAnalyzer(config);
    const endpoint = { ...armPose(30), wrist: { x: 300, y: 100 } }; cycle(engine, config, endpoint);
    const attempt = engine.drain()[0]!; expect(attempt.endpointMs).toBeNull(); expect(attempt.reasons).toContain('ENDPOINT_NOT_REACHED');
  });
  it('requires entry into an elevation band rather than accepting arbitrary overshoot', () => {
    const config = armConfig(); config.endpointDriver = 'wristElevation'; config.endpointElevation = 0.5;
    const engine = new SeatedArmRaiseAnalyzer(config); cycle(engine, config);
    expect(engine.drain()[0]!.reasons).toContain('ENDPOINT_NOT_REACHED');
  });
  it('compares criteria strictly at full precision and retains all reasons', () => {
    const config = armConfig(); config.criteria = [
      { metric: 'raiseDurationSec', operator: '>', threshold: 0.176 },
      { metric: 'raiseDurationSec', operator: '<', threshold: 0.176 },
      { metric: 'raiseDurationSec', operator: '>', threshold: 0.1759 },
      { metric: 'returnDurationSec', operator: '<', threshold: 0.2 },
    ];
    const engine = new SeatedArmRaiseAnalyzer(config); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.flags).toHaveLength(2); expect(attempt.flags[0]!.explanation).toContain('0.176 seconds');
    expect(attempt.flags[0]!.replay).toEqual({ startMs: 161, endMs: 889 });
  });
  it('rejects invalid fixed references, ambiguous direction and overlapping/unreturnable drivers', () => {
    const config = armConfig(); expect(() => new SeatedArmRaiseAnalyzer({ ...config, forwardSign: 0 })).toThrow();
    expect(() => new SeatedArmRaiseAnalyzer({ ...config, reference: [config.reference[0], config.reference[0]] })).toThrow('reference');
    expect(() => new SeatedArmRaiseAnalyzer({ ...config, endpointDeg: 10 })).toThrow('distinct');
    config.settings.returnHysteresisDeg = 1000; expect(() => new SeatedArmRaiseAnalyzer(config)).toThrow('distinct');
  });
  it('nulls required metrics when driver evidence is missing and protects summary compatibility', () => {
    const config = armConfig(), engine = new SeatedArmRaiseAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, armPose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, armPose(30))));
    const frame = poseFrame(300, armPose(90)); delete frame.landmarks.wrist; engine.accept(frame); engine.interrupt(320, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.metrics.peakWristElevation.value).toBeNull(); expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY');
    expect(() => summarizeArmRaise([attempt, attempt])).toThrow('Duplicate');
    expect(() => summarizeArmRaise([attempt, { ...attempt, id: 'different', configurationId: 'other' }])).toThrow('incompatible');
    expect(summarizeArmRaise([attempt])).toMatchObject({ detected: 1, measurable: 0, excluded: 1, flagRate: null });
  });
});

describe('SeatedArmRaiseAnalyzer summary and criteria boundaries', () => {
  it('rejects duplicate criteria before capture', () => {
    const config = armConfig();
    const criterion = { metric: 'raiseDurationSec' as const, operator: '>' as const, threshold: 0.17 };
    config.criteria = [criterion, criterion];
    expect(() => new SeatedArmRaiseAnalyzer(config)).toThrow('Duplicate review criteria');
  });
  it('counts mixed measured/excluded attempts with a measurable flag denominator', () => {
    const config = armConfig(); config.criteria = [{ metric: 'raiseDurationSec', operator: '>', threshold: 0.17 }];
    const engine = new SeatedArmRaiseAnalyzer(config);
    const poses = { rest: armPose(), outward: armPose(30), endpoint: armPose(90), returning: armPose(45) };
    runFixtureCycle(engine, config, poses); const first = engine.drain();
    runFixtureCycle(engine, config, poses, 1000); const second = engine.drain();
    [2000, 2047, 2109].forEach((t) => engine.accept(poseFrame(t, poses.rest, config)));
    [2161, 2213, 2270].forEach((t) => engine.accept(poseFrame(t, poses.outward, config)));
    engine.interrupt(2300, 'STOPPED_EARLY'); const excluded = engine.drain();
    const summary = summarizeArmRaise([...first, ...second, ...excluded]);
    expect(summary).toMatchObject({ detected: 3, measurable: 2, excluded: 1, flagged: 2, flagRate: 1 });
    expect(summary.medians.raiseDurationSec).toBe(0.176);
    const empty = summarizeArmRaise(excluded); expect(empty.flagRate).toBeNull(); expect(Object.values(empty.medians).every((value) => value === null)).toBe(true);
  });
});
