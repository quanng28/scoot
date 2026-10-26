import { z } from 'zod';
import type { ExtractionInput } from '../analysis/movement-features.js';

export const poseReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('pose'), sequence: z.number().int().nonnegative(), timestampMs: z.number().finite().nonnegative(),
    width: z.number().positive(), height: z.number().positive(), inferenceMs: z.number().finite().nonnegative(),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), visibility: z.number().finite().min(0).max(1).nullable() })).max(33),
    hands: z.array(z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).length(21)).max(2).optional(),
  }),
]);
export type PoseReply = z.infer<typeof poseReplySchema>;
export type PoseFrame = Extract<PoseReply, { type: 'pose' }>;
export type Sample = ExtractionInput['samples'][number];
export const INDICES = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, footIndex: 31 } as const;

/** MediaPipe visibility is the explicit confidence policy for this experiment.
 * Missing visibility never becomes perfect confidence. No opposite-side fallback.
 */
export function toSample(frame: PoseFrame, side: 'left' | 'right'): Sample {
  const landmarks: Sample['landmarks'] = {};
  for (const [name, left] of Object.entries(INDICES)) {
    const p = frame.points[left + (side === 'right' ? 1 : 0)];
    if (p) landmarks[name as keyof typeof INDICES] = { x: p.x, y: p.y, confidence: p.visibility };
  }
  return { timestampMs: frame.timestampMs, landmarks };
}

/** Reject duplicates/stale replies without moving the accepted clock backwards. */
export class FrameOrder {
  private sequence = -1;
  private timestamp = -1;
  accept(frame: Pick<PoseFrame, 'sequence' | 'timestampMs'>): boolean {
    if (frame.sequence <= this.sequence || frame.timestampMs <= this.timestamp) return false;
    this.sequence = frame.sequence;
    this.timestamp = frame.timestampMs;
    return true;
  }
}
