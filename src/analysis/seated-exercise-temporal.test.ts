import { describe, expect, it } from 'vitest';
import { SeatedArmRaiseAnalyzer, summarizeArmRaise, type ArmRaiseAttempt } from './seated-arm-raise.js';
import { SeatedKneeExtensionAnalyzer, summarizeKneeExtension, type KneeExtensionAttempt } from './seated-knee-extension.js';
import { SeatedSingleLegLiftAnalyzer, summarizeSingleLegLift, type LegLiftAttempt } from './seated-single-leg-lift.js';
import { SeatedAnklePumpsAnalyzer, summarizeAnklePumps, type AnklePumpsAttempt } from './seated-ankle-pumps.js';
import type { ReachFrame, Interruption } from './reach-contract.js';
import { armConfig, armPose, kneeConfig, kneePose, liftConfig, liftPose, ankleConfig, anklePose, poseFrame } from './seated-exercise.test-fixtures.js';

type Attempt = ArmRaiseAttempt | KneeExtensionAttempt | LegLiftAttempt | AnklePumpsAttempt;
type Engine = { accept(frame: ReachFrame): void; advance(time: number): void; interrupt(time: number, reason: Interruption): void; drain(): Attempt[]; readonly state: string };
type Phase = 'rest' | 'outward' | 'endpoint' | 'return';
const cases = [
  { name: 'SR03 arm raise', create: () => new SeatedArmRaiseAnalyzer(armConfig()), frame: (time: number, phase: Phase) => poseFrame(time, armPose({ rest: 0, outward: 30, endpoint: 90, return: 45 }[phase])) },
  { name: 'SR04 knee extension', create: () => new SeatedKneeExtensionAnalyzer(kneeConfig()), frame: (time: number, phase: Phase) => poseFrame(time, kneePose({ rest: 90, outward: 120, endpoint: 180, return: 130 }[phase])) },
  { name: 'SR05 single-leg lift', create: () => new SeatedSingleLegLiftAnalyzer(liftConfig()), frame: (time: number, phase: Phase) => poseFrame(time, liftPose({ rest: 0, outward: 0.25, endpoint: 0.5, return: 0.3 }[phase])) },
  { name: 'SR06 ankle pumps', create: () => new SeatedAnklePumpsAnalyzer(ankleConfig()), frame: (time: number, phase: Phase) => poseFrame(time, anklePose({ rest: 90, outward: 100, endpoint: 120, return: 105 }[phase])) },
];
const restTimes = [0, 47, 109];
const onsetTimes = [161, 213, 270];
const endpointTimes = [337, 389, 442, 503, 568];
const returnTimes = [620, 675, 729];
const endTimes = [781, 834, 889];
for (const spec of cases) {
  const feed = (engine: Engine, times: number[], phase: Phase) => times.forEach((t) => engine.accept(spec.frame(t, phase)));
  const open = (engine: Engine) => { feed(engine, restTimes, 'rest'); feed(engine, onsetTimes, 'outward'); };
  const complete = (engine: Engine) => { open(engine); feed(engine, endpointTimes, 'endpoint'); feed(engine, returnTimes, 'return'); feed(engine, endTimes, 'rest'); engine.advance(890); };
  describe(spec.name + ' independent temporal contract', () => {
    it('uses irregular first-event timestamps; endpoint holds never create another count', () => {
      const engine = spec.create(); complete(engine); const attempts = engine.drain();
      expect(attempts).toHaveLength(1);
      const attempt = attempts[0]!;
      expect(attempt).toMatchObject({ classification: 'measurable', startMs: 161, endpointMs: 337, returnStartMs: 620, restMs: 781, endMs: 889, reasons: [], flags: [] });
      expect(attempt.quality.coverage).toBe(1);
      expect(engine.drain()).toEqual([]);
      feed(engine, [930, 980, 1030], 'rest'); engine.advance(1031); expect(engine.drain()).toEqual([]);
      const durations = Object.entries(attempt.metrics).filter(([key]) => key.endsWith('DurationSec')).map(([, metric]) => metric.value);
      expect(durations).toEqual([0.176, 0.161]);
    });
    it('ignores duplicate/out-of-order captures without extending dwell or changing events', () => {
      const engine = spec.create(); open(engine);
      engine.accept(spec.frame(213, 'endpoint')); engine.accept(spec.frame(100, 'rest'));
      feed(engine, endpointTimes, 'endpoint'); feed(engine, returnTimes, 'return'); feed(engine, endTimes, 'rest'); engine.advance(890);
      const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.endpointMs).toBe(337);
      expect(attempt.observations.filter((o) => o.timestampMs === 213)).toHaveLength(1);
    });
    it('resets endpoint dwell and nulls all metrics after a critical missing-landmark gap', () => {
      const engine = spec.create(); open(engine); engine.accept(spec.frame(337, 'endpoint'));
      engine.accept({ ...spec.frame(389, 'endpoint'), landmarks: {} });
      feed(engine, [442, 503, 568], 'endpoint'); feed(engine, returnTimes, 'return'); feed(engine, endTimes, 'rest'); engine.advance(890);
      const attempt = engine.drain()[0]!;
      expect(attempt.endpointMs).toBe(442); expect(attempt.classification).toBe('excluded');
      expect(attempt.reasons).toEqual(expect.arrayContaining(['CRITICAL_PEAK_GAP', 'LOW_LANDMARK_QUALITY']));
      for (const metric of Object.values(attempt.metrics)) { expect(metric.value).toBeNull(); expect(metric.reasons).toContain('CRITICAL_PEAK_GAP'); }
      expect(attempt.flags).toEqual([]);
    });
    it('does not interpolate a dropped capture interval even when no rejected result arrives', () => {
      const engine = spec.create(); open(engine); feed(engine, [370, 421, 479], 'endpoint'); feed(engine, [530, 585, 640], 'rest'); engine.advance(641);
      const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('excluded'); expect(attempt.reasons).toContain('CRITICAL_PEAK_GAP'); expect(attempt.quality.coverage).toBeLessThan(1);
    });
    it('keeps a premature return as one excluded attempt with endpoint/null reasons', () => {
      const engine = spec.create(); open(engine); feed(engine, [337, 389, 442], 'rest'); engine.advance(443);
      const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('excluded'); expect(attempt.endpointMs).toBeNull(); expect(attempt.reasons).toContain('ENDPOINT_NOT_REACHED');
      for (const metric of Object.values(attempt.metrics)) expect(metric.value).toBeNull();
    });
    it('records an endpoint without inventing an incomplete return', () => {
      const engine = spec.create(); open(engine); feed(engine, endpointTimes, 'endpoint'); engine.interrupt(570, 'STOPPED_EARLY');
      const attempt = engine.drain()[0]!; expect(attempt.endpointMs).toBe(337); expect(attempt.reasons).toContain('RETURN_NOT_OBSERVED'); expect(attempt.classification).toBe('excluded');
    });
    it('watchdog finalizes silence once, rejects late results and reacquires rest', () => {
      const engine = spec.create(); open(engine); engine.advance(471); engine.accept(spec.frame(400, 'endpoint')); engine.advance(800);
      const attempts = engine.drain(); expect(attempts).toHaveLength(1); expect(attempts[0]!.reasons).toContain('TRACKING_GAP'); expect(engine.state).toBe('REACQUIRE_REST');
      feed(engine, [900, 950, 1000], 'endpoint'); expect(engine.state).toBe('REACQUIRE_REST');
      feed(engine, [1050, 1100, 1150], 'rest'); expect(engine.state).toBe('REST'); expect(engine.drain()).toEqual([]);
    });
    it('watchdog is not suppressed by rejected-only arrivals', () => {
      const engine = spec.create(); open(engine);
      for (const time of [337, 389, 442, 503, 568]) engine.accept({ ...spec.frame(time, 'endpoint'), landmarks: {} });
      const attempts = engine.drain(); expect(attempts).toHaveLength(1); expect(attempts[0]!.reasons).toContain('TRACKING_GAP');
    });
    it('retains discomfort and every elapsed watchdog reason when capture stops after silence', () => {
      const engine = spec.create(); open(engine); engine.interrupt(2400, 'DISCOMFORT_STOP');
      const attempts = engine.drain(); expect(attempts).toHaveLength(1);
      expect(attempts[0]!.reasons).toEqual(expect.arrayContaining(['DISCOMFORT_STOP', 'TIMEOUT', 'TRACKING_GAP']));
    });
    it('timeout closes an open attempt despite a continuous valid stream', () => {
      const engine = spec.create(); open(engine);
      for (let time = 320; time < 2300; time += 50) engine.accept(spec.frame(time, 'outward'));
      const attempts = engine.drain(); expect(attempts).toHaveLength(1); expect(attempts[0]!.reasons).toContain('TIMEOUT');
    });
    it.each(['STOPPED_EARLY', 'DISCOMFORT_STOP', 'SETUP_CHANGED'] as const)('same-timestamp %s wins over completion and stays idempotent', (reason) => {
      const engine = spec.create(); open(engine); feed(engine, endpointTimes, 'endpoint'); feed(engine, returnTimes, 'return'); feed(engine, endTimes, 'rest');
      engine.interrupt(889, reason); engine.interrupt(889, reason); engine.advance(1000); engine.accept(spec.frame(1001, 'endpoint'));
      const attempts = engine.drain(); expect(attempts).toHaveLength(1); expect(attempts[0]!.classification).toBe('excluded'); expect(attempts[0]!.reasons).toContain(reason); expect(attempts[0]!.flags).toEqual([]);
    });
    it('does not treat a changed side/orientation or intrinsic geometry as the old calibration', () => {
      const engine = spec.create(); open(engine); engine.accept({ ...spec.frame(337, 'endpoint'), width: 601 });
      const attempts = engine.drain(); expect(attempts).toHaveLength(1); expect(attempts[0]!.reasons).toContain('SETUP_CHANGED');
    });
    it('accepts a direct endpoint-to-rest return only with sustained rest evidence', () => {
      const engine = spec.create(); open(engine); feed(engine, endpointTimes, 'endpoint'); feed(engine, returnTimes, 'rest'); engine.advance(730);
      const attempt = engine.drain()[0]!; expect(attempt.classification).toBe('measurable'); expect(attempt.returnStartMs).toBe(620);
      const duration = Object.entries(attempt.metrics).find(([key]) => key === 'returnDurationSec')?.[1].value; expect(duration).toBe(0);
    });
  });
}

describe('zero-measurable and compatible summary groups', () => {
  it.each([
    ['arm raise', () => summarizeArmRaise([])], ['knee extension', () => summarizeKneeExtension([])],
    ['single-leg lift', () => summarizeSingleLegLift([])], ['ankle pumps', () => summarizeAnklePumps([])],
  ] as const)('%s has no invented zero medians or percentages', (_name, summary) => {
    const result = summary(); expect(result).toMatchObject({ detected: 0, measurable: 0, excluded: 0, flagged: 0, flagRate: null });
    expect(Object.values(result.medians).every((value) => value === null)).toBe(true);
  });
});
