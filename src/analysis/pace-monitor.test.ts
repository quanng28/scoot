import { describe, expect, it } from 'vitest';
import type { Sample } from '../pose/observations.js';
import { PaceMonitor, PACE_SETTINGS } from './pace-monitor.js';

/** Pose inference on a phone often runs near 15 results per second; test at that rate. */
const STEP = 1000 / 15;
type Opts = { hip?: boolean; confidence?: number };
/** Arm elevated θ degrees from vertical in a 1000×1000 frame (shoulder fixed, upper arm 150 px, forearm 150 px). */
const arm = (t: number, deg: number, { hip = true, confidence = 0.9 }: Opts = {}): Sample => {
  const r = deg * Math.PI / 180, dx = Math.sin(r), dy = Math.cos(r);
  return { timestampMs: t, landmarks: {
    shoulder: { x: 0.5, y: 0.4, confidence }, elbow: { x: 0.5 + 0.15 * dx, y: 0.4 + 0.15 * dy, confidence },
    wrist: { x: 0.5 + 0.3 * dx, y: 0.4 + 0.3 * dy, confidence }, ...(hip ? { hip: { x: 0.5, y: 0.8, confidence } } : {}),
  } };
};

/** Rest at 10°, raise to 90° over riseMs, hold, lower over riseMs, rest. Returns warning times (ms). */
function raise(m: PaceMonitor, riseMs: number, start = 0, opts: Opts & { dropEvery?: number } = {}): { warnings: number[]; end: number } {
  const warnings: number[] = [];
  let t = start, i = 0;
  const push = (deg: number) => {
    const dropped = opts.dropEvery && ++i % opts.dropEvery === 0;
    const sample = arm(t, deg, dropped ? { ...opts, confidence: 0.05 } : opts);
    if (m.push(sample, t)) warnings.push(t);
    t += STEP;
  };
  for (let k = 0; k < 15; k++) push(10);
  for (let s = 0; s <= riseMs; s += STEP) push(10 + 80 * Math.min(1, s / riseMs));
  for (let k = 0; k < 10; k++) push(90);
  for (let s = 0; s <= riseMs; s += STEP) push(90 - 80 * Math.min(1, s / riseMs));
  for (let k = 0; k < 15; k++) push(10);
  return { warnings, end: t };
}

describe('PaceMonitor (combined angular + limb speed, gap tolerant)', () => {
  it('stays quiet for a controlled 2-second raise and segments it as one repetition', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    expect(raise(m, 2000).warnings).toEqual([]);
    const s = m.summary();
    expect(s.reps).toHaveLength(1);
    expect(s.reps[0]!.excursionDeg).toBeGreaterThan(70);
    expect(s.peakSpeedDegPerSec!).toBeLessThan(PACE_SETTINGS.fastDegPerSec);
  });

  it('warns on the very first fast raise, attributes it to rep 1 and records when it happened', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    const { warnings } = raise(m, 400);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const [first] = m.summary().events;
    expect(first).toMatchObject({ index: 1, rep: 1 });
    expect(first!.tMs).toBeGreaterThan(15 * STEP); // during the raise, not at rest
  });

  it('grades a very fast raise as high strain risk', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    raise(m, 150);
    expect(m.summary().events.some((e) => e.severity === 'high')).toBe(true);
  });

  it('still detects fast movement when the hip is hidden by the chair', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    expect(raise(m, 400, 0, { hip: false }).warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('bridges frames dropped by motion blur instead of resetting the speed', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    expect(raise(m, 400, 0, { dropEvery: 2 }).warnings.length).toBeGreaterThanOrEqual(1);
    expect(m.summary().trackedSec).toBeGreaterThan(2);
  });

  it('ignores a single-frame landmark jump', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    let t = 0;
    for (let k = 0; k < 20; k++) { expect(m.push(arm(t, k === 10 ? 40 : 10), t)).toBe(false); t += STEP; }
    expect(m.summary().fastWarnings).toBe(0);
  });

  it('raises a new warning for each separate fast repetition', () => {
    const m = new PaceMonitor('seated_forward_arm_raise', 1000, 1000);
    const first = raise(m, 400);
    raise(m, 400, first.end);
    const s = m.summary();
    expect(s.reps).toHaveLength(2);
    expect(new Set(s.events.map((e) => e.rep))).toEqual(new Set([1, 2]));
  });

  it('catches a quick forward reach (mostly straight-line wrist motion) but not a controlled one', () => {
    /** Wrist travels forward 0.7 of the arm's length; shoulder and elbow stay roughly in view. */
    const reach = (durationMs: number) => {
      const m = new PaceMonitor('seated_forward_reach', 1000, 1000);
      let t = 0, warned = false;
      const at = (f: number): Sample => ({ timestampMs: t, landmarks: {
        shoulder: { x: 0.5, y: 0.4, confidence: 0.9 }, elbow: { x: 0.5 + 0.1 * f, y: 0.55 - 0.05 * f, confidence: 0.9 },
        wrist: { x: 0.55 + 0.21 * f, y: 0.6 - 0.15 * f, confidence: 0.9 }, hip: { x: 0.5, y: 0.8, confidence: 0.9 } } });
      for (let k = 0; k < 15; k++) { warned = m.push(at(0), t) || warned; t += STEP; }
      for (let s = 0; s <= durationMs; s += STEP) { warned = m.push(at(Math.min(1, s / durationMs)), t) || warned; t += STEP; }
      return warned;
    };
    expect(reach(350)).toBe(true);
    expect(reach(1800)).toBe(false);
  });
});
