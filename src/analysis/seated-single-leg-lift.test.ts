import { describe, expect, it } from 'vitest';
import { SeatedSingleLegLiftAnalyzer, summarizeSingleLegLift } from './seated-single-leg-lift.js';
import { liftConfig, liftPose, poseFrame, runFixtureCycle, reflected } from './seated-exercise.test-fixtures.js';

function cycle(engine: SeatedSingleLegLiftAnalyzer, config = liftConfig()) {
  runFixtureCycle(engine, config, { rest: liftPose(), outward: liftPose(0.25), endpoint: liftPose(0.5), returning: liftPose(0.3) });
}
describe('SR05 independent knee-elevation fixtures', () => {
  it('normalizes 50 pixel upward motion against a fixed 100 pixel reference', () => {
    const engine = new SeatedSingleLegLiftAnalyzer(liftConfig()); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeElevation.value).toBeCloseTo(0.5);
    expect(attempt.metrics.peakKneeElevation.unit).toBe('reference_lengths'); expect(attempt.metrics.torsoForwardPeakDeg.value).toBe(0);
    expect(attempt.metrics.liftDurationSec.value).toBe(0.176); expect(attempt.metrics.returnDurationSec.value).toBe(0.161);
    expect(Object.keys(attempt.metrics)).not.toContain('hipAngle');
  });
  it.each([{ width: 600, height: 400 }, { width: 400, height: 600 }])('preserves normalized elevation in rectangular $width×$height frames', ({ width, height }) => {
    const config = liftConfig(); config.frameWidth = width; config.frameHeight = height;
    const engine = new SeatedSingleLegLiftAnalyzer(config); cycle(engine, config); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeElevation.value).toBeCloseTo(0.5);
  });
  it('reflection preserves anatomical side and upward-positive elevation', () => {
    const config = liftConfig(); config.side = 'right'; config.forwardSign = -1; config.baseline = reflected(config.baseline); config.reference = [{ x: 580, y: 20 }, { x: 480, y: 20 }];
    const engine = new SeatedSingleLegLiftAnalyzer(config);
    runFixtureCycle(engine, config, { rest: reflected(liftPose()), outward: reflected(liftPose(0.25)), endpoint: reflected(liftPose(0.5)), returning: reflected(liftPose(0.3)) });
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.side).toBe('right'); expect(attempt.metrics.peakKneeElevation.value).toBeCloseTo(0.5);
  });
  it('snapshots baseline/reference and never divides by a moving torso reference', () => {
    const config = liftConfig(), engine = new SeatedSingleLegLiftAnalyzer(config); config.reference[1].x = 520; config.baseline.knee.y = 350;
    const endpoint = liftPose(0.5); endpoint.shoulder.y = 50;
    runFixtureCycle(engine, liftConfig(), { rest: liftPose(), outward: liftPose(0.25), endpoint, returning: liftPose(0.3) });
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeElevation.value).toBeCloseTo(0.5);
    expect(engine.configuration.reference[1].x).toBe(120);
  });
  it('retains signed torso change, but excludes the larger return-phase tilt from reported peaks', () => {
    const config = liftConfig(), engine = new SeatedSingleLegLiftAnalyzer(config);
    const tilted = (elevation: number, degrees: number) => { const pose = liftPose(elevation); pose.shoulder.x += 150 * Math.tan(degrees * Math.PI / 180); return pose; };
    runFixtureCycle(engine, config, { rest: liftPose(), outward: tilted(0.25, -15), endpoint: tilted(0.5, 12), returning: tilted(0.3, 30) });
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.torsoForwardPeakDeg.value).toBeCloseTo(12); expect(attempt.observations.some((o) => o.torsoDeltaDeg < 0)).toBe(true);
  });
  it('extension without knee elevation is not a lift', () => {
    const engine = new SeatedSingleLegLiftAnalyzer(liftConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, liftPose())));
    const extended = liftPose(); extended.ankle = { x: 300, y: 250 };
    [150, 200, 250, 300, 350, 400].forEach((t) => engine.accept(poseFrame(t, extended)));
    expect(engine.state).toBe('REST'); expect(engine.drain()).toEqual([]);
  });
  it('an endpoint overshoot never substitutes for observed entry into its configured band', () => {
    const config = liftConfig(), engine = new SeatedSingleLegLiftAnalyzer(config);
    runFixtureCycle(engine, config, { rest: liftPose(), outward: liftPose(0.25), endpoint: liftPose(0.8), returning: liftPose(0.3) });
    const attempt = engine.drain()[0]!; expect(attempt.endpointMs).toBeNull(); expect(attempt.reasons).toContain('ENDPOINT_NOT_REACHED');
  });
  it.each(['shoulder', 'hip', 'knee', 'ankle'] as const)('missing %s excludes the attempt with null reasons', (joint) => {
    const engine = new SeatedSingleLegLiftAnalyzer(liftConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, liftPose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, liftPose(0.25))));
    const frame = poseFrame(300, liftPose(0.5)); delete frame.landmarks[joint]; engine.accept(frame); engine.interrupt(320, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY'); expect(attempt.metrics.peakKneeElevation.value).toBeNull(); expect(attempt.metrics.peakKneeElevation.reasons.length).toBeGreaterThan(0);
    expect(summarizeSingleLegLift([attempt])).toMatchObject({ detected: 1, measurable: 0, excluded: 1, flagRate: null, medians: { peakKneeElevation: null } });
  });
  it('strict equality and multiple criteria use full precision and compatible groups', () => {
    const config = liftConfig(); config.criteria = [
      { metric: 'liftDurationSec', operator: '>', threshold: 0.176 }, { metric: 'liftDurationSec', operator: '<', threshold: 0.176 },
      { metric: 'liftDurationSec', operator: '>', threshold: 0.1759 }, { metric: 'returnDurationSec', operator: '<', threshold: 0.2 },
    ];
    const engine = new SeatedSingleLegLiftAnalyzer(config); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.flags).toHaveLength(2); expect(attempt.flags[0]!.explanation).toContain('0.176 seconds');
    expect(() => summarizeSingleLegLift([attempt, attempt])).toThrow('Duplicate');
    expect(() => summarizeSingleLegLift([attempt, { ...attempt, id: 'other', configurationId: 'other' }])).toThrow('incompatible');
  });
  it('rejects unobservable/ambiguous setup and unavailable fixed reference', () => {
    const config = liftConfig(); expect(() => new SeatedSingleLegLiftAnalyzer({ ...config, forwardSign: 0 })).toThrow();
    expect(() => new SeatedSingleLegLiftAnalyzer({ ...config, reference: [config.reference[0], config.reference[0]] })).toThrow('reference');
    config.endpointElevation = 0.1; expect(() => new SeatedSingleLegLiftAnalyzer(config)).toThrow('distinct');
  });
});

describe('SeatedSingleLegLiftAnalyzer summary and criteria boundaries', () => {
  it('rejects duplicate criteria before capture', () => {
    const config = liftConfig();
    const criterion = { metric: 'liftDurationSec' as const, operator: '>' as const, threshold: 0.17 };
    config.criteria = [criterion, criterion];
    expect(() => new SeatedSingleLegLiftAnalyzer(config)).toThrow('Duplicate review criteria');
  });
  it('counts mixed measured/excluded attempts with a measurable flag denominator', () => {
    const config = liftConfig(); config.criteria = [{ metric: 'liftDurationSec', operator: '>', threshold: 0.17 }];
    const engine = new SeatedSingleLegLiftAnalyzer(config);
    const poses = { rest: liftPose(), outward: liftPose(0.25), endpoint: liftPose(0.5), returning: liftPose(0.3) };
    runFixtureCycle(engine, config, poses); const first = engine.drain();
    runFixtureCycle(engine, config, poses, 1000); const second = engine.drain();
    [2000, 2047, 2109].forEach((t) => engine.accept(poseFrame(t, poses.rest, config)));
    [2161, 2213, 2270].forEach((t) => engine.accept(poseFrame(t, poses.outward, config)));
    engine.interrupt(2300, 'STOPPED_EARLY'); const excluded = engine.drain();
    const summary = summarizeSingleLegLift([...first, ...second, ...excluded]);
    expect(summary).toMatchObject({ detected: 3, measurable: 2, excluded: 1, flagged: 2, flagRate: 1 });
    expect(summary.medians.liftDurationSec).toBe(0.176);
    const empty = summarizeSingleLegLift(excluded); expect(empty.flagRate).toBeNull(); expect(Object.values(empty.medians).every((value) => value === null)).toBe(true);
  });
});
