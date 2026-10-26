import { REACH_JOINTS } from '../../analysis/reach-contract.js';
import { toSample, type PoseFrame } from '../../pose/observations.js';
import { previewX } from '../../pose/preview.js';

export type TrackedJoint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'footIndex';
export type JointStatus = 'ok' | 'low_confidence' | 'missing' | 'out_of_frame';
export const JOINT_STATUS_TEXT: Record<JointStatus, string> = { ok: 'Tracked', low_confidence: 'Unreliable', missing: 'Not detected', out_of_frame: 'Outside image' };

export const EXERCISE_REQUIRED_LANDMARKS = {
  seated_forward_reach: ['shoulder', 'elbow', 'wrist', 'hip'],
  seated_elbow_flexion_extension: ['shoulder', 'elbow', 'wrist', 'hip'],
  seated_forward_arm_raise: ['shoulder', 'elbow', 'wrist', 'hip'],
  seated_knee_extension: ['hip', 'knee', 'ankle'],
  seated_single_leg_lift: ['shoulder', 'hip', 'knee', 'ankle'],
  seated_ankle_pumps: ['knee', 'ankle', 'heel', 'footIndex'],
} as const;

/** Per-joint status for the selected side only; no opposite-side substitution. */
export function jointStatuses(
  frame: PoseFrame,
  side: 'left' | 'right',
  minConfidence: number,
  joints: readonly TrackedJoint[] = REACH_JOINTS
): Partial<Record<TrackedJoint, JointStatus>> {
  const sample = toSample(frame, side);
  const result: Partial<Record<TrackedJoint, JointStatus>> = {};
  for (const joint of joints) {
    const p = sample.landmarks[joint];
    result[joint] = !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ? 'missing' : p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ? 'out_of_frame'
      : p.confidence === null || !Number.isFinite(p.confidence) || p.confidence < minConfidence ? 'low_confidence' : 'ok';
  }
  return result;
}

/** Continuous all-required-joints-tracked duration on the capture clock; any unreliable frame or gap resets it. */
export class ReadinessTracker {
  private since: number | null = null;
  private last: number | null = null;
  constructor(private readonly windowMs: number, private readonly maxGapMs = 250) {}
  update(timestampMs: number, statuses: Partial<Record<string, JointStatus>>, requiredJoints: readonly string[] = REACH_JOINTS): number {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) { this.since = null; return 0; }
    if (this.last !== null && timestampMs <= this.last) return this.since === null ? 0 : this.last - this.since;
    const allOk = requiredJoints.length > 0 && requiredJoints.every((joint) => statuses[joint] === 'ok');
    if (!allOk || (this.last !== null && timestampMs - this.last > this.maxGapMs)) this.since = null;
    if (allOk && this.since === null) this.since = timestampMs;
    this.last = timestampMs;
    return this.since === null ? 0 : timestampMs - this.since;
  }
  ready(stableMs: number): boolean { return stableMs >= this.windowMs; }
  reset(): void { this.since = null; this.last = null; }
}

/** Converts a tap on the (optionally mirrored) preview into unmirrored intrinsic-frame pixels. */
export function tapToIntrinsic(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, frameWidth: number, frameHeight: number, mirrored: boolean): { x: number; y: number } | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height, frameWidth, frameHeight].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || frameWidth <= 0 || frameHeight <= 0) return null;
  const nx = (clientX - rect.left) / rect.width, ny = (clientY - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { x: previewX(nx, mirrored) * frameWidth, y: ny * frameHeight };
}
