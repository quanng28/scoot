import { describe, expect, it } from 'vitest';
import { SeatedKneeExtensionAnalyzer, summarizeKneeExtension } from './seated-knee-extension.js';
import { kneeConfig, kneePose, poseFrame, runFixtureCycle, reflected } from './seated-exercise.test-fixtures.js';

function cycle(engine: SeatedKneeExtensionAnalyzer, config = kneeConfig()) {
  runFixtureCycle(engine, config, { rest: kneePose(), outward: kneePose(120), endpoint: kneePose(180), returning: kneePose(130) });
}
describe('SR04 independent knee-angle fixtures', () => {
  it('reports straight projected knee angle and excursion relative to the fixed 90° baseline', () => {
    const engine = new SeatedKneeExtensionAnalyzer(kneeConfig()); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeAngleDeg.value).toBeCloseTo(180);
    expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeCloseTo(90);
    expect(attempt.metrics.extensionDurationSec.value).toBe(0.176); expect(attempt.metrics.returnDurationSec.value).toBe(0.161);
  });
  it.each([{ width: 600, height: 400 }, { width: 400, height: 600 }])('preserves geometry in rectangular $width×$height frames', ({ width, height }) => {
    const config = kneeConfig(); config.frameWidth = width; config.frameHeight = height;
    const engine = new SeatedKneeExtensionAnalyzer(config); cycle(engine, config);
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeAngleDeg.value).toBeCloseTo(180); expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeCloseTo(90);
  });
  it('retains anatomy under reflection and does not require upper-body landmarks', () => {
    const config = kneeConfig(); config.side = 'right'; config.baseline = reflected(config.baseline);
    const engine = new SeatedKneeExtensionAnalyzer(config);
    runFixtureCycle(engine, config, { rest: reflected(kneePose()), outward: reflected(kneePose(120)), endpoint: reflected(kneePose(180)), returning: reflected(kneePose(130)) });
    const attempt = engine.drain()[0]!; expect(attempt.side).toBe('right'); expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeCloseTo(90);
  });
  it('a leg translating upward without knee extension never satisfies the angular endpoint', () => {
    const config = kneeConfig(), engine = new SeatedKneeExtensionAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, kneePose())));
    for (let t = 150; t < 650; t += 50) {
      const pose = kneePose(); for (const p of Object.values(pose)) p.y -= 40;
      engine.accept(poseFrame(t, pose));
    }
    expect(engine.state).toBe('REST'); expect(engine.drain()).toEqual([]);
  });
  it('caller baseline mutation cannot turn extension excursion into an absolute angle', () => {
    const config = kneeConfig(), engine = new SeatedKneeExtensionAnalyzer(config); config.baseline = kneePose(150); config.endpointDeg = 160;
    cycle(engine); const attempt = engine.drain()[0]!; expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeCloseTo(90);
    expect(engine.configuration.baseline.ankle.x).toBeCloseTo(200);
  });
  it('holds the outward peak window at the accepted first endpoint sample', () => {
    const config = kneeConfig(); config.endpointDeg = 150; config.settings.endpointToleranceDeg = 5;
    const engine = new SeatedKneeExtensionAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, kneePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, kneePose(120))));
    [300, 350, 400].forEach((t) => engine.accept(poseFrame(t, kneePose(150))));
    [450, 500, 550].forEach((t) => engine.accept(poseFrame(t, kneePose(180))));
    [600, 650, 700].forEach((t) => engine.accept(poseFrame(t, kneePose()))); engine.advance(701);
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakKneeAngleDeg.value).toBeCloseTo(150); expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeCloseTo(60);
  });
  it.each(['hip', 'knee', 'ankle'] as const)('missing %s produces nulls and explicit exclusion', (joint) => {
    const engine = new SeatedKneeExtensionAnalyzer(kneeConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, kneePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, kneePose(120))));
    const frame = poseFrame(300, kneePose(180)); delete frame.landmarks[joint]; engine.accept(frame); engine.interrupt(320, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY'); expect(attempt.metrics.peakKneeAngleDeg.value).toBeNull(); expect(attempt.flags).toEqual([]);
  });
  it('rejects NaN confidence before geometry and near-zero leg segments before smoothing', () => {
    const config = kneeConfig(); config.settings.smoothingTauMs = 100;
    const engine = new SeatedKneeExtensionAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, kneePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, kneePose(120))));
    const invalid = poseFrame(300, kneePose(180)); invalid.landmarks.ankle!.confidence = NaN; engine.accept(invalid);
    const collapsed = kneePose(180); collapsed.ankle = { ...collapsed.knee }; engine.accept(poseFrame(350, collapsed)); engine.interrupt(360, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY'); expect(attempt.reasons).toContain('DEGENERATE_GEOMETRY'); expect(attempt.metrics.projectedExtensionExcursionDeg.value).toBeNull();
  });
  it('strict equality does not flag; all matching enabled criteria retain full-precision values', () => {
    const config = kneeConfig(); config.criteria = [
      { metric: 'extensionDurationSec', operator: '>', threshold: 0.176 }, { metric: 'extensionDurationSec', operator: '<', threshold: 0.176 },
      { metric: 'extensionDurationSec', operator: '>', threshold: 0.1759 }, { metric: 'returnDurationSec', operator: '<', threshold: 0.2 },
    ];
    const engine = new SeatedKneeExtensionAnalyzer(config); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.flags).toHaveLength(2); expect(attempt.flags[0]!.observed).toBe(0.176); expect(attempt.flags[0]!.explanation).toContain('0.176 seconds');
    expect(() => summarizeKneeExtension([attempt, attempt])).toThrow('Duplicate');
    expect(() => summarizeKneeExtension([attempt, { ...attempt, id: 'other', configurationId: 'other' }])).toThrow('incompatible');
  });
  it('invalid or overlapping baseline/endpoint regions cannot start', () => {
    const config = kneeConfig(); config.endpointDeg = 100; expect(() => new SeatedKneeExtensionAnalyzer(config)).toThrow('distinct');
    config.endpointDeg = 180; config.baseline.ankle = { ...config.baseline.knee }; expect(() => new SeatedKneeExtensionAnalyzer(config)).toThrow('baseline');
  });
});

describe('SeatedKneeExtensionAnalyzer summary and criteria boundaries', () => {
  it('rejects duplicate criteria before capture', () => {
    const config = kneeConfig();
    const criterion = { metric: 'extensionDurationSec' as const, operator: '>' as const, threshold: 0.17 };
    config.criteria = [criterion, criterion];
    expect(() => new SeatedKneeExtensionAnalyzer(config)).toThrow('Duplicate review criteria');
  });
  it('counts mixed measured/excluded attempts with a measurable flag denominator', () => {
    const config = kneeConfig(); config.criteria = [{ metric: 'extensionDurationSec', operator: '>', threshold: 0.17 }];
    const engine = new SeatedKneeExtensionAnalyzer(config);
    const poses = { rest: kneePose(), outward: kneePose(120), endpoint: kneePose(180), returning: kneePose(130) };
    runFixtureCycle(engine, config, poses); const first = engine.drain();
    runFixtureCycle(engine, config, poses, 1000); const second = engine.drain();
    [2000, 2047, 2109].forEach((t) => engine.accept(poseFrame(t, poses.rest, config)));
    [2161, 2213, 2270].forEach((t) => engine.accept(poseFrame(t, poses.outward, config)));
    engine.interrupt(2300, 'STOPPED_EARLY'); const excluded = engine.drain();
    const summary = summarizeKneeExtension([...first, ...second, ...excluded]);
    expect(summary).toMatchObject({ detected: 3, measurable: 2, excluded: 1, flagged: 2, flagRate: 1 });
    expect(summary.medians.extensionDurationSec).toBe(0.176);
    const empty = summarizeKneeExtension(excluded); expect(empty.flagRate).toBeNull(); expect(Object.values(empty.medians).every((value) => value === null)).toBe(true);
  });
});
