import { describe, expect, it } from 'vitest';
import { FrameOrder, toSample, poseReplySchema, type PoseFrame } from './observations.js';

describe('pose observation boundary', () => {
  it('accepts two complete hands and rejects truncated finger data', () => {
    const hand = Array.from({ length: 21 }, () => ({ x: 0.4, y: 0.5 }));
    const reply = { type: 'pose', sequence: 0, timestampMs: 1, width: 640, height: 480, inferenceMs: 1, points: [], hands: [hand, hand] };
    expect(poseReplySchema.safeParse(reply).success).toBe(true);
    expect(poseReplySchema.safeParse({ ...reply, hands: [hand.slice(1)] }).success).toBe(false);
    expect(poseReplySchema.safeParse({ ...reply, hands: [hand, hand, hand] }).success).toBe(false);
  });
  it('maps anatomical sides without opposite-side substitution', () => {
    const frame: PoseFrame = { type: 'pose', sequence: 0, timestampMs: 1, width: 640, height: 480, inferenceMs: 10,
      points: Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, visibility: i === 15 ? null : 0.9 })) };
    expect(toSample(frame, 'left').landmarks.wrist).toEqual({ x: 15 / 33, y: 0.5, confidence: null });
    expect(toSample(frame, 'right').landmarks.wrist?.x).toBe(16 / 33);
    expect(toSample(frame, 'left').landmarks.footIndex?.x).toBe(31 / 33);
    expect(toSample({ ...frame, points: [] }, 'left').landmarks).toEqual({});
  });
  it('rejects malformed/nonfinite worker results', () => {
    expect(poseReplySchema.safeParse({ type: 'pose', timestampMs: NaN }).success).toBe(false);
  });
  it('ignores stale and duplicate replies without poisoning the clock', () => {
    const order = new FrameOrder();
    expect(order.accept({ sequence: 2, timestampMs: 20 })).toBe(true);
    expect(order.accept({ sequence: 2, timestampMs: 21 })).toBe(false);
    expect(order.accept({ sequence: 3, timestampMs: 19 })).toBe(false);
    expect(order.accept({ sequence: 3, timestampMs: 30 })).toBe(true);
  });
});
