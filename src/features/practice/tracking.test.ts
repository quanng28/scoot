import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '../../pose/observations.js';
import { jointStatuses, ReadinessTracker, tapToIntrinsic } from './tracking.js';

function frame(overrides: Record<number, { x: number; y: number; visibility: number | null }> = {}): PoseFrame {
  const points: PoseFrame['points'] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  for (const [i, p] of Object.entries(overrides)) points[Number(i)] = p;
  return { type: 'pose', sequence: 1, timestampMs: 1, width: 640, height: 480, inferenceMs: 1, points };
}

describe('tracking status', () => {
  it('uses only the selected side and reports each failure separately', () => {
    const f = frame({ 13: { x: 1.2, y: 0.5, visibility: 0.9 }, 15: { x: 0.5, y: 0.5, visibility: 0.2 }, 23: { x: 0.5, y: 0.5, visibility: null } });
    expect(jointStatuses(f, 'left', 0.5)).toEqual({ shoulder: 'ok', elbow: 'out_of_frame', wrist: 'low_confidence', hip: 'low_confidence' });
    expect(jointStatuses(f, 'right', 0.5)).toEqual({ shoulder: 'ok', elbow: 'ok', wrist: 'ok', hip: 'ok' });
    expect(jointStatuses({ ...f, points: f.points.slice(0, 12) }, 'left', 0.5)).toMatchObject({ shoulder: 'ok', elbow: 'missing' });
  });
  it('requires a continuous readiness window and resets on gaps or unreliable joints', () => {
    const ok = { shoulder: 'ok', elbow: 'ok', wrist: 'ok', hip: 'ok' } as const;
    const tracker = new ReadinessTracker(1000);
    expect(tracker.update(0, ok)).toBe(0);
    expect(tracker.ready(tracker.update(1000, ok))).toBe(false); // 1000 ms gap > 250 ms resets
    for (let t = 1100; t <= 2000; t += 100) tracker.update(t, ok);
    expect(tracker.ready(tracker.update(2100, ok))).toBe(true);
    expect(tracker.update(2200, { ...ok, wrist: 'low_confidence' })).toBe(0);
  });
  it('maps taps on a mirrored, scaled preview back to unmirrored intrinsic pixels', () => {
    const rect = { left: 10, top: 20, width: 320, height: 240 };
    expect(tapToIntrinsic(10 + 80, 20 + 60, rect, 640, 480, false)).toEqual({ x: 160, y: 120 });
    expect(tapToIntrinsic(10 + 80, 20 + 60, rect, 640, 480, true)).toEqual({ x: 480, y: 120 });
    expect(tapToIntrinsic(0, 0, rect, 640, 480, false)).toBeNull();
  });
});

it('rejects nonfinite coordinates/confidence without requiring unrelated upper-body joints for knee tracking', () => {
  const f = frame({ 11: { x: Number.NaN, y: 0.5, visibility: 1 }, 15: { x: 0.5, y: 0.5, visibility: Number.NaN } });
  expect(jointStatuses(f, 'left', 0.5)).toMatchObject({ shoulder: 'missing', wrist: 'low_confidence' });
  expect(jointStatuses(f, 'left', 0.5, ['hip', 'knee', 'ankle'])).toEqual({ hip: 'ok', knee: 'ok', ankle: 'ok' });
});
it('ignores duplicate/out-of-order readiness timestamps and rejects invalid tap geometry', () => {
  const tracker = new ReadinessTracker(1000);
  const ok = { hip: 'ok', knee: 'ok', ankle: 'ok' } as const;
  expect(tracker.update(0, ok, ['hip', 'knee', 'ankle'])).toBe(0);
  expect(tracker.update(100, ok, ['hip', 'knee', 'ankle'])).toBe(100);
  expect(tracker.update(100, ok, ['hip', 'knee', 'ankle'])).toBe(100);
  expect(tracker.update(50, ok, ['hip', 'knee', 'ankle'])).toBe(100);
  expect(tracker.update(Number.NaN, ok, ['hip', 'knee', 'ankle'])).toBe(0);
  expect(tracker.update(200, ok, ['hip', 'knee', 'ankle'])).toBe(0);
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  expect(tapToIntrinsic(Number.NaN, 20, rect, 600, 400, false)).toBeNull();
  expect(tapToIntrinsic(20, 20, rect, 0, 400, false)).toBeNull();
});
