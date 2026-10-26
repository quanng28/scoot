import { describe, expect, it } from 'vitest';
import { SeatedReachAnalyzer, summarizeReach } from './seated-reach.js';
import { measureReach, pixelObservation } from './reach-geometry.js';
import type { ReachConfig, ReachFrame, ReachAttempt } from './reach-contract.js';

function config(): ReachConfig {
  return { sessionId: 'synthetic', configurationId: 'fixture-v1', version: 'reach.experimental-v1', mode: 'rehabilitation', side: 'left',
    frameWidth: 400, frameHeight: 300, orientation: 'landscape', baseline: { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 100, y: 100 }, hip: { x: 50, y: 150 } },
    reference: [{ x: 0, y: 0 }, { x: 100, y: 0 }], target: { x: 200, y: 100 },
    settings: { minConfidence: { shoulder: 0.5, elbow: 0.5, wrist: 0.5, hip: 0.5 }, minSegmentPx: 1, minReferencePx: 10, minForwardPx: 10,
      restRadius: 0.1, targetRadius: 0.05, onsetDistance: 0.2, returnHysteresis: 0.1, readinessMs: 100, onsetDwellMs: 100, targetDwellMs: 100, returnDwellMs: 100,
      timeoutMs: 2000, smoothingTauMs: 0, filterResetGapMs: 100, sampleSupportMs: 75, maxGapMs: 200, minCoverage: 0.8, minObservations: 6 },
    criteria: [{ metric: 'torsoForwardPeakDeg', operator: '>', threshold: 8 }] };
}
function frame(time: number, x = 100, shoulderX = 50): ReachFrame {
  return { timestampMs: time, width: 400, height: 300, orientation: 'landscape', side: 'left', landmarks: {
    shoulder: { x: shoulderX / 400, y: 50 / 300, confidence: 1 }, elbow: { x: 50 / 400, y: 100 / 300, confidence: 1 },
    wrist: { x: x / 400, y: 100 / 300, confidence: 1 }, hip: { x: 50 / 400, y: 150 / 300, confidence: 1 },
  } };
}
function ready(engine: SeatedReachAnalyzer, offset = 0) { [0, 50, 100].forEach((t) => engine.accept(frame(offset + t))); }
function cycle(engine: SeatedReachAnalyzer, offset = 0, flagged = false, incomplete = false) {
  ready(engine, offset);
  [150, 200, 250].forEach((t) => engine.accept(frame(offset + t, 125, flagged ? 70 : 50)));
  [300, 350, 400, 450, 500].forEach((t) => engine.accept(frame(offset + t, incomplete ? 150 : 200, flagged ? 70 : 50)));
  [550, 600, 650].forEach((t) => engine.accept(frame(offset + t, 150)));
  [700, 750, 800].forEach((t) => engine.accept(frame(offset + t)));
  engine.advance(offset + 801);
}

describe('SR01 segmentation and accounting', () => {
  it('emits 12/10/2/4, with measurable-only medians and stable distinct IDs', () => {
    const engine = new SeatedReachAnalyzer(config()); const results: ReachAttempt[] = [];
    for (let i = 0; i < 12; i++) { cycle(engine, i * 1000, i < 4, i >= 10); results.push(...engine.drain()); }
    expect(summarizeReach(results)).toMatchObject({ detected: 12, measurable: 10, excluded: 2, flagged: 4, flagRate: 0.4 });
    expect(new Set(results.map((a) => a.id)).size).toBe(12);
    expect(results[0]!.flags[0]!.replay).toEqual({ startMs: 150, endMs: 800 });
    expect(results[10]!.reasons).toContain('TARGET_NOT_REACHED');
    expect(results[10]!.metrics.elbowPeakDeg.value).toBeNull(); expect(results[10]!.flags).toEqual([]);
    expect(engine.drain()).toEqual([]);
  });
  it('uses first onset/target times and excludes target hold/return from peaks', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    engine.accept(frame(300, 200));
    // Bigger torso movement in target-confirmation dwell and return must not enter outward peaks.
    [350, 400, 450, 500].forEach((t) => engine.accept(frame(t, 200, 90)));
    [550, 600, 650].forEach((t) => engine.accept(frame(t, 150, 90)));
    [700, 750, 800].forEach((t) => engine.accept(frame(t)));
    engine.advance(801); const result = engine.drain()[0]!;
    expect(result.classification).toBe('measurable');
    expect(result.startMs).toBe(150); expect(result.targetMs).toBe(300);
    expect(result.metrics.reachDurationSec.value).toBe(0.15);
    expect(result.metrics.torsoForwardPeakDeg.value).toBe(0);
    expect(result.metrics.wristForwardPeak.value).toBe(1);
    expect(result.metrics.elbowPeakDeg.value).toBe(90);
  });
  it('held target and a direct jump to rest produce exactly one result', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    for (let t = 300; t <= 1000; t += 50) engine.accept(frame(t, 200));
    expect(engine.drain()).toEqual([]);
    [1050, 1100, 1150, 1200].forEach((t) => engine.accept(frame(t)));
    expect(engine.drain()).toHaveLength(1);
  });
  it('strict equality does not flag; disabled criteria produce no flags; all matching reasons retained', () => {
    const c = config(); c.criteria = [{ metric: 'elbowPeakDeg', operator: '>', threshold: 90 }, { metric: 'wristForwardPeak', operator: '<', threshold: 1 }];
    let engine = new SeatedReachAnalyzer(c); cycle(engine); expect(engine.drain()[0]!.flags).toEqual([]);
    c.criteria = []; engine = new SeatedReachAnalyzer(c); cycle(engine, 0, true); expect(engine.drain()[0]!.flags).toEqual([]);
    c.criteria = [{ metric: 'elbowPeakDeg', operator: '>', threshold: 80 }, { metric: 'reachDurationSec', operator: '<', threshold: 1 }];
    engine = new SeatedReachAnalyzer(c); cycle(engine); expect(engine.drain()[0]!.flags).toHaveLength(2);
  });
  it('retains a measured 12-degree torso change against an illustrative >10-degree review criterion', () => {
    const c = config(); c.criteria = [{ metric: 'torsoForwardPeakDeg', operator: '>', threshold: 10 }];
    const engine = new SeatedReachAnalyzer(c), offset = 5000;
    // A 100-pixel vertical torso segment tilted by 12 degrees in intrinsic pixels.
    const shoulderX = 50 + 100 * Math.tan(12 * Math.PI / 180);
    ready(engine, offset);
    [150, 200, 250].forEach((t) => engine.accept(frame(offset + t, 125, shoulderX)));
    [300, 350, 400].forEach((t) => engine.accept(frame(offset + t, 200, shoulderX)));
    [450, 500, 550].forEach((t) => engine.accept(frame(offset + t)));
    engine.advance(offset + 551);
    const attempts = engine.drain(); expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt.classification).toBe('measurable');
    expect(attempt.metrics.torsoForwardPeakDeg).toMatchObject({ value: expect.closeTo(12, 9), unit: 'degrees', reasons: [] });
    expect(attempt).toMatchObject({ startMs: 5150, targetMs: 5300, endMs: 5550 });
    expect(attempt.flags).toHaveLength(1);
    expect(attempt.flags[0]).toMatchObject({ metric: 'torsoForwardPeakDeg', operator: '>', observed: expect.closeTo(12, 9), threshold: 10,
      replay: { startMs: 5150, endMs: 5550 } });
    expect(attempt.flags[0]!.explanation).toContain('exceeded configured > 10');
    expect(attempt.flags[0]!.explanation).toContain('Review replay.');
    expect(attempt.flags[0]!.explanation).not.toMatch(/bad posture|unsafe|weak|diagnos|normal movement/i);
    expect(engine.drain()).toEqual([]);
  });
  it('retains target-observed attempts with no completed return as excluded on stop', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    [300, 350, 400].forEach((t) => engine.accept(frame(t, 200)));
    [450, 500].forEach((t) => engine.accept(frame(t, 150)));
    engine.interrupt(550, 'STOPPED_EARLY'); engine.interrupt(550, 'STOPPED_EARLY'); engine.advance(10_000);
    const attempts = engine.drain(); expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt).toMatchObject({ startMs: 150, targetMs: 300, endMs: 550, classification: 'excluded', flags: [] });
    expect(attempt.reasons).toEqual(expect.arrayContaining(['STOPPED_EARLY', 'RETURN_NOT_OBSERVED']));
    expect(attempt.reasons).not.toContain('TARGET_NOT_REACHED');
    for (const metric of Object.values(attempt.metrics)) {
      expect(metric.value).toBeNull(); expect(metric.reasons).toContain('RETURN_NOT_OBSERVED');
    }
    expect(summarizeReach(attempts)).toMatchObject({ detected: 1, measurable: 0, excluded: 1, flagged: 0, flagRate: null });
    expect(engine.drain()).toEqual([]);
  });
  it.each(['STOPPED_EARLY', 'DISCOMFORT_STOP', 'SETUP_CHANGED'] as const)('same-timestamp %s wins over pending completion exactly once', (reason) => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    [300, 350, 400].forEach((t) => engine.accept(frame(t, 200)));
    [450, 500, 550].forEach((t) => engine.accept(frame(t)));
    engine.interrupt(550, reason); engine.interrupt(550, reason); engine.advance(10000);
    const results = engine.drain(); expect(results).toHaveLength(1); expect(results[0]!.reasons).toContain(reason); expect(results[0]!.classification).toBe('excluded');
  });
});

describe('tracking and deadlines', () => {
  it('accepts delayed inference results while the watchdog advances without a timeout', () => {
    const engine = new SeatedReachAnalyzer(config());
    for (const [time, x] of [[0,100],[50,100],[100,100],[150,125],[200,125],[250,125],[300,200],[350,200],[400,200],[450,100],[500,100],[550,100]]) {
      engine.advance(time! + 10); engine.accept(frame(time!, x!));
    }
    engine.advance(570); expect(engine.drain()[0]!.classification).toBe('measurable');
  });
  it('retains first target evidence during onset confirmation', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250, 300, 350].forEach((t) => engine.accept(frame(t, 200)));
    [400, 450, 500].forEach((t) => engine.accept(frame(t)));
    engine.advance(501); const result = engine.drain()[0]!;
    expect(result.targetMs).toBe(150); expect(result.metrics.reachDurationSec.value).toBe(0);
  });
  it('a rejected target-dwell frame resets target confirmation', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150,200,250].forEach((t) => engine.accept(frame(t,125)));
    engine.accept(frame(300,200)); engine.accept({ ...frame(350,200), landmarks: {} });
    [400,450,500].forEach((t) => engine.accept(frame(t,200)));
    [550,600,650].forEach((t) => engine.accept(frame(t)));
    engine.advance(651); const result = engine.drain()[0]!;
    expect(result.targetMs).toBe(400); expect(result.reasons).toContain('CRITICAL_PEAK_GAP');
  });
  it('watchdog excludes without more frames and rejects a late completion', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    engine.advance(451); engine.advance(500); engine.accept(frame(400, 200));
    expect(engine.state).toBe('REACQUIRE_REST');
    const result = engine.drain(); expect(result).toHaveLength(1); expect(result[0]!.reasons).toContain('TRACKING_GAP');
    cycle(engine, 1000); expect(engine.drain()[0]!.classification).toBe('measurable');
  });
  it.each(['wrist', 'hip'] as const)('excludes a reach with missing %s evidence and retains null metric reasons', (joint) => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    const occluded = frame(300, 150); delete occluded.landmarks[joint]; engine.accept(occluded);
    [350, 400, 450].forEach((t) => engine.accept(frame(t, 200)));
    [500, 550, 600].forEach((t) => engine.accept(frame(t)));
    engine.advance(601);
    const attempts = engine.drain(); expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt.classification).toBe('excluded'); expect(attempt.flags).toEqual([]);
    expect(attempt.reasons).toEqual(expect.arrayContaining(['LOW_LANDMARK_QUALITY', 'CRITICAL_PEAK_GAP']));
    for (const metric of Object.values(attempt.metrics)) {
      expect(metric.value).toBeNull(); expect(metric.reasons).toContain('LOW_LANDMARK_QUALITY');
    }
    expect(attempt.explanations).toContain('A required landmark was missing or unreliable.');
    expect(summarizeReach(attempts)).toMatchObject({ detected: 1, measurable: 0, excluded: 1, flagged: 0 });
  });
  it('only rejected frames still trigger deadlines', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    for (let t = 300; t < 600; t += 50) engine.accept({ ...frame(t), landmarks: {} });
    expect(engine.drain()).toHaveLength(1);
  });
  it('timeout runs even while valid frames keep arriving', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    for (let t = 150; t <= 2200; t += 50) engine.accept(frame(t, 125));
    const result = engine.drain(); expect(result).toHaveLength(1); expect(result[0]!.reasons).toContain('TIMEOUT');
  });
  it('a brief outward gap invalidates peak evidence even with high overall coverage', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    engine.accept({ ...frame(300, 150), landmarks: {} });
    [350, 400, 450].forEach((t) => engine.accept(frame(t, 200)));
    [500, 550, 600].forEach((t) => engine.accept(frame(t)));
    engine.advance(601); const result = engine.drain()[0]!;
    expect(result.quality.coverage).toBeGreaterThan(0.8);
    expect(result.reasons).toContain('CRITICAL_PEAK_GAP'); expect(result.flags).toEqual([]);
  });
  it('missing timestamps reset onset dwell rather than satisfying it', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    engine.accept(frame(150, 125)); engine.accept(frame(250, 125));
    expect(engine.state).toBe('REST');
    engine.accept(frame(300, 125)); engine.accept(frame(350, 125)); expect(engine.state).toBe('OUTWARD');
  });
  it('duplicate/out-of-order frames do not count twice', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    engine.accept(frame(100, 200)); engine.accept(frame(99, 200));
    cycle(engine, 1000); expect(engine.drain()).toHaveLength(1);
  });
  it('setup changes end the engine until a new configured instance is created', () => {
    const engine = new SeatedReachAnalyzer(config()); ready(engine);
    [150, 200, 250].forEach((t) => engine.accept(frame(t, 125)));
    engine.accept({ ...frame(300), width: 300 }); cycle(engine, 1000);
    const results = engine.drain(); expect(results).toHaveLength(1); expect(results[0]!.reasons).toContain('SETUP_CHANGED');
  });
  it('no measurable attempts has null medians/rate; incompatible groups and duplicate IDs rejected', () => {
    expect(summarizeReach([])).toMatchObject({ detected: 0, flagRate: null, medians: { elbowPeakDeg: null } });
    const engine = new SeatedReachAnalyzer(config()); cycle(engine); const a = engine.drain()[0]!;
    expect(() => summarizeReach([a, a])).toThrow('Duplicate');
    expect(() => summarizeReach([a, { ...a, id: 'different', configurationId: 'other' }])).toThrow('incompatible');
  });
});

describe('geometry, smoothing and immutable configuration', () => {
  it('rejects extreme finite dimensions and nonfinite derived geometry before reporting',()=>{
    const c=config();c.frameWidth=1e200;
    expect(()=>new SeatedReachAnalyzer(c)).toThrow();
    expect(pixelObservation({...frame(0),width:Infinity},config()).reason).toBe('DEGENERATE_GEOMETRY');
    const pose=structuredClone(c.baseline);pose.wrist.x=1e200;pose.elbow.y=1e200;
    expect(measureReach(pose,null,0,config())).toBeNull();
  });
  it('reverse-forward reflected geometry preserves side selection and forward metrics', () => {
    const c = config(); c.side = 'right';
    for (const p of [...Object.values(c.baseline), ...c.reference, c.target]) p.x = 400 - p.x;
    const engine = new SeatedReachAnalyzer(c);
    for (const [time,x] of [[0,100],[50,100],[100,100],[150,125],[200,125],[250,125],[300,200],[350,200],[400,200],[450,100],[500,100],[550,100]]) {
      const f = frame(time!,x!); f.side = 'right';
      for (const p of Object.values(f.landmarks)) if (p) p.x = 1 - p.x;
      engine.accept(f);
    }
    engine.advance(551); const result = engine.drain()[0]!;
    expect(result.side).toBe('right'); expect(result.metrics.wristForwardPeak.value).toBe(1); expect(result.metrics.elbowPeakDeg.value).toBe(90);
  });
  it('calculates known 90/180-degree geometry, fixed-reference displacement, and signed torso', () => {
    const c = config(); let pose = structuredClone(c.baseline);
    expect(measureReach(pose, null, 0, c)!.elbowDeg).toBe(90);
    pose.wrist = { x: 50, y: 150 }; expect(measureReach(pose, null, 0, c)!.elbowDeg).toBe(180);
    pose = structuredClone(c.baseline); pose.wrist.x = 150; pose.shoulder.x = 70;
    const result = measureReach(pose, null, 0, c)!;
    expect(result.forward).toBe(0.5); expect(result.torsoDeltaDeg).toBeCloseTo(11.3099, 3);
    pose.shoulder.x = 30; expect(measureReach(pose, null, 0, c)!.torsoDeltaDeg).toBeLessThan(0);
  });
  it('converts portrait/landscape inputs to the same pixel geometry', () => {
    const c = config(), source = frame(0);
    const original = pixelObservation(source, c).pose!;
    const portrait = { ...source, width: 300, height: 400, landmarks: Object.fromEntries(Object.entries(source.landmarks).map(([key, p]) => [key, { ...p, x: p!.x * 400 / 300, y: p!.y * 300 / 400 }])) };
    expect(pixelObservation(portrait, c).pose).toEqual(original);
  });
  it('rejects degeneracy and missing confidence rather than producing NaN', () => {
    const c = config(), f = frame(0); f.landmarks.elbow = { ...f.landmarks.shoulder! };
    expect(pixelObservation(f, c).reason).toBe('DEGENERATE_GEOMETRY');
    f.landmarks.wrist!.confidence = null; expect(pixelObservation(f, c).reason).toBe('LOW_LANDMARK_QUALITY');
  });
  it('uses elapsed-time smoothing while retaining raw observations', () => {
    const c = config(); c.settings.smoothingTauMs = 100;
    const first = measureReach(c.baseline, null, 0, c)!;
    const moved = structuredClone(c.baseline); moved.wrist.x = 200;
    const second = measureReach(moved, first, 100, c)!;
    expect(second.raw.wrist.x).toBe(200); expect(second.filtered.wrist.x).toBeCloseTo(163.212, 2);
  });
  it('configuration is copied and invalid calibration rejected', () => {
    const c = config(), engine = new SeatedReachAnalyzer(c); c.target.x = 100;
    cycle(engine); expect(engine.drain()[0]!.classification).toBe('measurable');
    expect(() => new SeatedReachAnalyzer(c)).toThrow('Invalid');
    c.target.x = 50; c.target.y = 200; c.baseline.wrist.x = 50;
    expect(() => new SeatedReachAnalyzer(c)).toThrow('Invalid');
  });
});
