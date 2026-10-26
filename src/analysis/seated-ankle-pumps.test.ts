import { describe, expect, it } from 'vitest';
import { SeatedAnklePumpsAnalyzer, summarizeAnklePumps, orientedShankFootAngle, verifyAnkleSetupDirection } from './seated-ankle-pumps.js';
import { ankleConfig, anklePose, poseFrame, runFixtureCycle, reflected } from './seated-exercise.test-fixtures.js';

function cycle(engine: SeatedAnklePumpsAnalyzer, config = ankleConfig(), baseline = 90, sign = 1) {
  runFixtureCycle(engine, config, { rest: anklePose(baseline), outward: anklePose(baseline + sign * 10), endpoint: anklePose(baseline + sign * 30), returning: anklePose(baseline + sign * 15) });
}
describe('SR06 oriented shank/foot geometry and prescribed direction', () => {
  it('uses atan2 orientation, preserving signs that unsigned acos would discard', () => {
    expect(orientedShankFootAngle({ x: 0, y: -100 }, { x: 0, y: 0 }, { x: 50, y: 0 })).toBe(90);
    expect(orientedShankFootAngle({ x: 0, y: -100 }, { x: 0, y: 0 }, { x: -50, y: 0 })).toBe(-90);
    expect(orientedShankFootAngle({ x: 0, y: -100 }, { x: 0, y: 0 }, { x: 0, y: 50 })).toBe(180);
  });
  it('reports angle and signed change at outward peak, with separate phase durations', () => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig()); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.orientedAngleDeg.value).toBeCloseTo(120);
    expect(attempt.metrics.signedChangeDeg.value).toBeCloseTo(30); expect(attempt.metrics.peakExcursionDeg.value).toBeCloseTo(30);
    expect(attempt.metrics.outwardDurationSec.value).toBe(0.176); expect(attempt.metrics.returnDurationSec.value).toBe(0.161);
    expect(attempt.evidence.reason).toContain('physical iPhone');
  });
  it.each([{ width: 600, height: 400 }, { width: 400, height: 600 }])('uses intrinsic pixels in rectangular $width×$height frames', ({ width, height }) => {
    const config = ankleConfig(); config.frameWidth = width; config.frameHeight = height;
    const engine = new SeatedAnklePumpsAnalyzer(config); cycle(engine, config); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.orientedAngleDeg.value).toBeCloseTo(120); expect(attempt.metrics.peakExcursionDeg.value).toBeCloseTo(30);
  });
  it.each([1, -1] as const)('wraps the ±180° boundary for pumpDirectionSign %s without folding direction', (direction) => {
    const baseline = direction === 1 ? 170 : -170, config = ankleConfig(); config.baseline = anklePose(baseline); config.pumpDirectionSign = direction;
    const engine = new SeatedAnklePumpsAnalyzer(config); cycle(engine, config, baseline, direction); const attempt = engine.drain()[0]!;
    expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.orientedAngleDeg.value).toBeCloseTo(direction === 1 ? -160 : 160);
    expect(attempt.metrics.signedChangeDeg.value).toBeCloseTo(30 * direction); expect(attempt.metrics.peakExcursionDeg.value).toBeCloseTo(30);
  });
  it('reflection and screen-forward normalization preserve prescribed excursion without swapping side', () => {
    const config = ankleConfig(); config.side = 'right'; config.screenForwardSign = -1; config.baseline = reflected(config.baseline);
    const engine = new SeatedAnklePumpsAnalyzer(config);
    runFixtureCycle(engine, config, { rest: reflected(anklePose()), outward: reflected(anklePose(100)), endpoint: reflected(anklePose(120)), returning: reflected(anklePose(105)) });
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.side).toBe('right');
    expect(attempt.metrics.orientedAngleDeg.value).toBeCloseTo(-120); expect(attempt.metrics.signedChangeDeg.value).toBeCloseTo(30); expect(attempt.metrics.peakExcursionDeg.value).toBeCloseTo(30);
  });
  it('opposite-direction movement cannot satisfy the endpoint or count a pump', () => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig()); cycle(engine, ankleConfig(), 90, -1);
    expect(engine.drain()).toEqual([]); expect(engine.state).toBe('REST');
  });
  it('an opposite-direction frame breaks a pending positive onset dwell', () => {
    const config = ankleConfig(), engine = new SeatedAnklePumpsAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    engine.accept(poseFrame(150, anklePose(100))); engine.accept(poseFrame(200, anklePose(80))); engine.accept(poseFrame(250, anklePose(100)));
    expect(engine.state).toBe('REST');
    [300, 350].forEach((t) => engine.accept(poseFrame(t, anklePose(100))));
    [400, 450, 500].forEach((t) => engine.accept(poseFrame(t, anklePose(120))));
    [550, 600, 650].forEach((t) => engine.accept(poseFrame(t, anklePose()))); engine.advance(651);
    const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.startMs).toBe(250);
  });
  it('opposite motion during an opened outward attempt excludes it even if endpoint is reached later', () => {
    const config = ankleConfig(), engine = new SeatedAnklePumpsAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, anklePose(100)))); engine.accept(poseFrame(300, anklePose(80)));
    [350, 400, 450].forEach((t) => engine.accept(poseFrame(t, anklePose(120))));
    [500, 550, 600].forEach((t) => engine.accept(poseFrame(t, anklePose()))); engine.advance(601);
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('WRONG_DIRECTION'); expect(attempt.classification).toBe('excluded'); expect(attempt.metrics.peakExcursionDeg.value).toBeNull(); expect(attempt.flags).toEqual([]);
  });
  it('tiny jitter cannot open an attempt or generate synthetic counts', () => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig());
    for (let time = 0; time < 1000; time += 50) engine.accept(poseFrame(time, anklePose(time % 100 === 0 ? 90.3 : 89.7)));
    expect(engine.state).toBe('REST'); expect(engine.drain()).toEqual([]);
    expect(summarizeAnklePumps([])).toMatchObject({ detected: 0, measurable: 0, flagRate: null, medians: { peakExcursionDeg: null } });
  });
  it.each(['knee', 'ankle', 'heel', 'footIndex'] as const)('requires %s evidence and preserves explicit null/exclusion reasons', (joint) => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, anklePose(100))));
    const frame = poseFrame(300, anklePose(120)); delete frame.landmarks[joint]; engine.accept(frame); engine.interrupt(320, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY');
    for (const metric of Object.values(attempt.metrics)) { expect(metric.value).toBeNull(); expect(metric.reasons).toContain('LOW_LANDMARK_QUALITY'); }
    expect(attempt.flags).toEqual([]);
  });
  it('raw ambiguous angle jumps cannot be hidden by smoothing', () => {
    const config = ankleConfig(); config.settings.smoothingTauMs = 20;
    const engine = new SeatedAnklePumpsAnalyzer(config);
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, anklePose(100))));
    engine.accept(poseFrame(300, anklePose(230))); engine.interrupt(320, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('AMBIGUOUS_MOTION'); expect(attempt.metrics.signedChangeDeg.value).toBeNull();
  });
  it('short heel/foot-index or nonfinite-confidence evidence cannot be measured', () => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, anklePose(100))));
    const collapsed = anklePose(120); collapsed.footIndex = { ...collapsed.ankle }; engine.accept(poseFrame(300, collapsed));
    const invalid = poseFrame(350, anklePose(120)); invalid.landmarks.heel!.confidence = Infinity; engine.accept(invalid); engine.interrupt(360, 'STOPPED_EARLY');
    const attempt = engine.drain()[0]!; expect(attempt.reasons).toContain('DEGENERATE_GEOMETRY'); expect(attempt.reasons).toContain('LOW_LANDMARK_QUALITY');
  });
  it('snapshots both signs, baseline and angular ambiguity policy', () => {
    const config = ankleConfig(), engine = new SeatedAnklePumpsAnalyzer(config); config.pumpDirectionSign = -1; config.screenForwardSign = -1; config.baseline = anklePose(150); config.settings.maxAngularStepDeg = 1;
    cycle(engine); const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.metrics.peakExcursionDeg.value).toBeCloseTo(30);
    expect(engine.configuration.directionVerified).toBe(true); expect(engine.configuration.settings.maxAngularStepDeg).toBe(90);
  });
  it('strict equality and multiple criteria preserve full precision; summary groups stay separate', () => {
    const config = ankleConfig(); config.criteria = [
      { metric: 'outwardDurationSec', operator: '>', threshold: 0.176 }, { metric: 'outwardDurationSec', operator: '<', threshold: 0.176 },
      { metric: 'outwardDurationSec', operator: '>', threshold: 0.1759 }, { metric: 'returnDurationSec', operator: '<', threshold: 0.2 },
    ];
    const engine = new SeatedAnklePumpsAnalyzer(config); cycle(engine); const attempt = engine.drain()[0]!;
    expect(attempt.flags).toHaveLength(2); expect(attempt.flags[0]!.explanation).toContain('0.176 seconds');
    expect(() => summarizeAnklePumps([attempt, attempt])).toThrow('Duplicate');
    expect(() => summarizeAnklePumps([attempt, { ...attempt, id: 'other', configurationId: 'other' }])).toThrow('incompatible');
  });
  it('rejects unverified direction, ambiguous signs, unresolved scales and overlapping bands', () => {
    const config = ankleConfig(); expect(() => new SeatedAnklePumpsAnalyzer({ ...config, directionVerified: false })).toThrow();
    const missingProof = { ...config, directionVerified: undefined }; expect(() => new SeatedAnklePumpsAnalyzer(missingProof)).toThrow();
    expect(() => new SeatedAnklePumpsAnalyzer({ ...config, pumpDirectionSign: 0 })).toThrow();
    config.settings.minExcursionThresholdDeg = 10; expect(() => new SeatedAnklePumpsAnalyzer(config)).toThrow('distinct');
  });
});

describe('SR06 labeled setup direction verification', () => {
  it('uses signed wrapped motion including the ±180° boundary', () => {
    expect(verifyAnkleSetupDirection([anklePose(175), anklePose(185)], anklePose(170), 1, 1)).toMatchObject({ ok: true, maxExcursionDeg: 15 });
    expect(verifyAnkleSetupDirection([anklePose(-175), anklePose(-185)], anklePose(-170), 1, -1)).toMatchObject({ ok: true, maxExcursionDeg: 15 });
  });
  it('requires a resolved labeled motion, not jitter, wrong direction, empty samples or an ambiguous jump', () => {
    expect(verifyAnkleSetupDirection([anklePose(90.2)], anklePose(), 1, 1).ok).toBe(false);
    expect(verifyAnkleSetupDirection([anklePose(80)], anklePose(), 1, 1).ok).toBe(false);
    expect(verifyAnkleSetupDirection([], anklePose(), 1, 1).ok).toBe(false);
    expect(verifyAnkleSetupDirection([anklePose(240)], anklePose(), 1, 1).ok).toBe(false);
    expect(verifyAnkleSetupDirection([anklePose(95)], anklePose(), 1, 1, NaN).ok).toBe(false);
  });
  it('rejects absent/degenerate heel evidence and nonfinite setup coordinates', () => {
    const invalid = anklePose(95); invalid.heel = { ...invalid.ankle };
    expect(verifyAnkleSetupDirection([invalid], anklePose(), 1, 1).ok).toBe(false);
    invalid.heel.x = NaN; expect(verifyAnkleSetupDirection([invalid], anklePose(), 1, 1).ok).toBe(false);
  });
  it('rejects mixed resolved directions even if one sample reaches the requested direction', () => {
    expect(verifyAnkleSetupDirection([anklePose(100), anklePose(80)], anklePose(), 1, 1).ok).toBe(false);
  });
});

describe('SeatedAnklePumpsAnalyzer summary and criteria boundaries', () => {
  it('keeps a two-cycle circular median near the observed ±180 degree boundary', () => {
    const config = ankleConfig(); config.baseline = anklePose(170); config.endpointDeg = 10;
    const engine = new SeatedAnklePumpsAnalyzer(config);
    const poses = (endpoint: number) => ({ rest: anklePose(170), outward: anklePose(176), endpoint: anklePose(endpoint), returning: anklePose(174) });
    runFixtureCycle(engine, config, poses(179));
    runFixtureCycle(engine, config, poses(181), 1000);
    const attempts = engine.drain();
    expect(attempts.map((attempt) => attempt.classification)).toEqual(['measurable', 'measurable']);
    expect(attempts[0]!.metrics.orientedAngleDeg.value).toBeCloseTo(179);
    expect(attempts[1]!.metrics.orientedAngleDeg.value).toBeCloseTo(-179);
    expect(summarizeAnklePumps(attempts).medians.orientedAngleDeg).toBe(-180);
  });
  it('rejects duplicate criteria before capture', () => {
    const config = ankleConfig();
    const criterion = { metric: 'outwardDurationSec' as const, operator: '>' as const, threshold: 0.17 };
    config.criteria = [criterion, criterion];
    expect(() => new SeatedAnklePumpsAnalyzer(config)).toThrow('Duplicate review criteria');
  });
  it('counts mixed measured/excluded attempts with a measurable flag denominator', () => {
    const config = ankleConfig(); config.criteria = [{ metric: 'outwardDurationSec', operator: '>', threshold: 0.17 }];
    const engine = new SeatedAnklePumpsAnalyzer(config);
    const poses = { rest: anklePose(), outward: anklePose(100), endpoint: anklePose(120), returning: anklePose(105) };
    runFixtureCycle(engine, config, poses); const first = engine.drain();
    runFixtureCycle(engine, config, poses, 1000); const second = engine.drain();
    [2000, 2047, 2109].forEach((t) => engine.accept(poseFrame(t, poses.rest, config)));
    [2161, 2213, 2270].forEach((t) => engine.accept(poseFrame(t, poses.outward, config)));
    engine.interrupt(2300, 'STOPPED_EARLY'); const excluded = engine.drain();
    const summary = summarizeAnklePumps([...first, ...second, ...excluded]);
    expect(summary).toMatchObject({ detected: 3, measurable: 2, excluded: 1, flagged: 2, flagRate: 1 });
    expect(summary.medians.outwardDurationSec).toBe(0.176);
    const empty = summarizeAnklePumps(excluded); expect(empty.flagRate).toBeNull(); expect(Object.values(empty.medians).every((value) => value === null)).toBe(true);
  });
});

describe('SR06 first sample ambiguity', () => {
  it('checks a first post-readiness jump against the frozen baseline before any filtered history exists', () => {
    const engine = new SeatedAnklePumpsAnalyzer(ankleConfig());
    [0, 50, 100].forEach((t) => engine.accept(poseFrame(t, anklePose())));
    [150, 200, 250].forEach((t) => engine.accept(poseFrame(t, anklePose(230))));
    expect(engine.state).toBe('REST'); expect(engine.drain()).toEqual([]);
  });
});
