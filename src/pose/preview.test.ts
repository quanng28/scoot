import { expect, it, vi } from 'vitest';
import { BODY_CONNECTIONS, drawSkeleton, previewX } from './preview.js';
import type { PoseFrame } from './observations.js';

it('mirrors display and reverses tap coordinates without changing anatomical indices', () => {
  expect(previewX(0.2, true)).toBeCloseTo(0.8);
  expect(previewX(previewX(0.2, true), true)).toBeCloseTo(0.2);
  expect(previewX(0.2, false)).toBe(0.2);
  expect(BODY_CONNECTIONS).toContainEqual([13, 15]);
  expect(BODY_CONNECTIONS).toContainEqual([14, 16]);
  expect(BODY_CONNECTIONS).toContainEqual([25, 27]);
  expect(BODY_CONNECTIONS).toContainEqual([26, 28]);
});

it('draws both legs and both 21-point hands in mirrored display coordinates without altering measurements', () => {
  const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  const points = Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + i * 0.02, y: 0.2 + i * 0.02, visibility: 1 }));
  const frame: PoseFrame = { type: 'pose', sequence: 1, timestampMs: 100, width: 1000, height: 500, inferenceMs: 1, points,
    hands: [Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.3 })), Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.4 }))] };
  const before = structuredClone(frame);
  drawSkeleton(context as unknown as CanvasRenderingContext2D, frame, true);
  for (const index of [27, 28]) expect(context.lineTo).toHaveBeenCalledWith((1 - points[index]!.x) * 1000, points[index]!.y * 500);
  expect(context.arc).toHaveBeenCalledWith(800, 150, 3, 0, Math.PI * 2);
  expect(context.arc).toHaveBeenCalledWith((1 - 0.8) * 1000, 200, 3, 0, Math.PI * 2);
  expect(context.arc).toHaveBeenCalledTimes(33 + 42);
  expect(frame).toEqual(before);
});

it('omits missing, out-of-frame and low-confidence body landmarks', () => {
  const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  const frame: PoseFrame = { type: 'pose', sequence: 1, timestampMs: 100, width: 640, height: 480, inferenceMs: 1,
    points: [{ x: 0.2, y: 0.3, visibility: null }, { x: 0.3, y: 0.3, visibility: 0.1 }, { x: 2, y: 0.3, visibility: 1 }] };
  drawSkeleton(context as unknown as CanvasRenderingContext2D, frame, false);
  expect(context.stroke).not.toHaveBeenCalled();
  expect(context.arc).not.toHaveBeenCalled();
});
