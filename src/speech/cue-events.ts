import { EXERCISE_REQUIRED_LANDMARKS, type TrackedJoint } from '../features/practice/tracking.js';
import type { CueId } from '../contracts/cue.js';
import type { CaptureSnapshot, StopReason } from '../features/practice/capture-controller.js';
import type { ExerciseId } from '../features/setup/setup-model.js';
import type { CueContext } from './cue-controller.js';

import { RECORDING_LIMIT_MS } from '../contracts/cue-events.js';
export { RECORDING_LIMIT_MS };
/** A joint must stay lost (or recovered) this long before speaking; single-frame flicker is silent. */
export const TRACKING_DEBOUNCE_MS = 600;

export type CueSnapshot = Pick<CaptureSnapshot, 'phase' | 'tracking' | 'ready' | 'reference' | 'baseline' | 'target' | 'analyzerState' | 'recordingMs' | 'paceWarnings'>;

type SetupStep = 'setup.reference' | 'setup.hold_rest' | 'setup.target' | 'setup.confirm' | 'setup.ankle_direction' | null;
const REST_CUE: Record<ExerciseId, CueId> = {
  seated_forward_reach: 'phase.rest', seated_elbow_flexion_extension: 'phase.rest_elbow',
  seated_forward_arm_raise: 'phase.rest_arm_raise', seated_knee_extension: 'phase.rest_knee',
  seated_single_leg_lift: 'phase.rest_leg_lift', seated_ankle_pumps: 'phase.rest_ankle',
};
const ENDPOINT: Record<ExerciseId, string> = {
  seated_forward_reach: 'TARGET', seated_elbow_flexion_extension: 'BEND_ENDPOINT',
  seated_forward_arm_raise: 'RAISE_ENDPOINT', seated_knee_extension: 'EXTENSION_ENDPOINT',
  seated_single_leg_lift: 'LIFT_ENDPOINT', seated_ankle_pumps: 'PUMP_ENDPOINT',
};
const TRACKING_CUE: Record<TrackedJoint, CueId> = {
  shoulder: 'tracking.shoulder', elbow: 'tracking.elbow', wrist: 'tracking.wrist', hip: 'tracking.hip',
  knee: 'tracking.knee', ankle: 'tracking.ankle', heel: 'tracking.heel', footIndex: 'tracking.footIndex',
};

/**
 * Derives approved cue IDs from authoritative local state only (checklist D1). It never reads model
 * output and never creates measurement events; phase cues follow actual analyzer state transitions.
 * One instance per camera run; call reset() when a new run or session starts.
 */
export class CueEventDeriver {
  private previous: CueSnapshot | null = null;
  private lostSince: number | null = null;
  private okSince: number | null = null;
  private announcedLoss = false;

  constructor(private readonly exerciseId: ExerciseId, private readonly limitMs = RECORDING_LIMIT_MS) {}

  reset(): void { this.previous = null; this.lostSince = null; this.okSince = null; this.announcedLoss = false; }

  /** Revalidate in-flight setup and tracking instructions on every snapshot, before playback. */
  context(next: CueSnapshot): CueContext {
    const transientCueIds: CueId[] = [];
    const step = next.phase === 'previewing' ? this.setupStep(next) : null;
    if (step) transientCueIds.push(step);
    if (next.ready && next.baseline && (this.exerciseId !== 'seated_forward_reach' || next.target)) transientCueIds.push('ready.record');
    if (next.tracking) {
      const lost = EXERCISE_REQUIRED_LANDMARKS[this.exerciseId].filter((joint) => next.tracking?.[joint] !== 'ok');
      if (lost.length > 1) transientCueIds.push('tracking.multiple');
      else if (lost.length === 1) transientCueIds.push(TRACKING_CUE[lost[0]!]);
      else transientCueIds.push('tracking.restored');
    }
    return { phase: next.phase, analyzerState: next.analyzerState, transientCueIds };
  }

  /** `nowMs` is the same monotonic clock the snapshots come from. */
  update(next: CueSnapshot, nowMs: number): CueId[] {
    const prev = this.previous;
    this.previous = next;
    const cues: CueId[] = [];
    if (next.phase === 'previewing') {
      const step = this.setupStep(next);
      if (step && (prev?.phase !== 'previewing' || this.setupStep(prev) !== step)) cues.push(step);
      if (next.ready && prev?.ready !== true) cues.push('ready.record');
    }
    if (next.phase === 'recording' && prev?.phase !== 'recording') cues.push('recording.started');
    if (next.phase === 'recording' && prev?.phase === 'recording' && next.analyzerState !== prev.analyzerState) {
      // Only first readiness (not every completed repetition) prompts the movement, to keep speech sparse.
      if (next.analyzerState === 'REST' && (prev.analyzerState === 'REACQUIRE_REST' || prev.analyzerState === 'WAITING_FOR_RECORDER'))
        cues.push(REST_CUE[this.exerciseId]);
      if (next.analyzerState === ENDPOINT[this.exerciseId]) cues.push('phase.target');
    }
    if (next.phase === 'recording' && prev?.phase === 'recording' && (next.paceWarnings ?? 0) > (prev.paceWarnings ?? 0)) cues.push('pace.slow_down');
    if (next.phase === 'recording' && prev?.phase === 'recording') {
      const countdown = countdownCue(prev.recordingMs, next.recordingMs, this.limitMs);
      if (countdown) cues.push(countdown);
    }
    cues.push(...this.tracking(next, nowMs));
    return cues;
  }

  private setupStep(s: CueSnapshot): SetupStep {
    if (this.exerciseId === 'seated_forward_reach' || this.exerciseId === 'seated_forward_arm_raise' || this.exerciseId === 'seated_single_leg_lift') {
      if (s.reference.length < 2) return 'setup.reference';
      if (!s.baseline) return 'setup.hold_rest';
      if (this.exerciseId === 'seated_forward_reach' && !s.target) return 'setup.target';
    } else if (!s.baseline) return 'setup.hold_rest';
    return s.ready ? null : 'setup.confirm';
  }

  private tracking(s: CueSnapshot, now: number): CueId[] {
    if ((s.phase !== 'previewing' && s.phase !== 'recording') || !s.tracking) { this.lostSince = null; this.okSince = null; this.announcedLoss = false; return []; }
    const lost = EXERCISE_REQUIRED_LANDMARKS[this.exerciseId].filter((joint) => s.tracking?.[joint] !== 'ok');
    if (lost.length) {
      this.okSince = null;
      this.lostSince ??= now;
      if (!this.announcedLoss && now - this.lostSince >= TRACKING_DEBOUNCE_MS) {
        this.announcedLoss = true;
        return [lost.length === 1 ? TRACKING_CUE[lost[0]!] : 'tracking.multiple'];
      }
      return [];
    }
    this.lostSince = null;
    if (!this.announcedLoss) return [];
    this.okSince ??= now;
    if (now - this.okSince < TRACKING_DEBOUNCE_MS) return [];
    this.announcedLoss = false; this.okSince = null;
    return s.phase === 'recording' ? ['tracking.restored'] : [];
  }
}

/**
 * Countdown cue when the recording clock crosses limit-5s … limit-1s. If several boundaries are
 * crossed at once (irregular ticks, background resume), only the latest number is spoken.
 */
export function countdownCue(prevMs: number | null, nextMs: number | null, limitMs = RECORDING_LIMIT_MS): CueId | null {
  if (prevMs === null || nextMs === null || nextMs <= prevMs || nextMs >= limitMs) return null;
  let crossed: number | null = null;
  for (let remaining = 5; remaining >= 1; remaining--) {
    const boundary = limitMs - remaining * 1000;
    if (prevMs < boundary && nextMs >= boundary) crossed = remaining;
  }
  return crossed === null ? null : `countdown.${crossed}` as CueId;
}

/** Remaining whole seconds for a visible 5–4–3–2–1 display, or null outside the final five seconds. */
export function countdownRemaining(recordingMs: number | null, limitMs = RECORDING_LIMIT_MS): number | null {
  if (recordingMs === null || recordingMs < limitMs - 5000 || recordingMs >= limitMs) return null;
  return Math.ceil((limitMs - recordingMs) / 1000);
}

/** Stop cue for a finalized capture; `timeLimit` marks the recording-limit expiry path. */
export function stopCue(reason: StopReason, timeLimit = false): CueId {
  if (timeLimit) return 'stop.time_limit';
  return reason === 'STOPPED' ? 'stop.stopped' : reason === 'DISCOMFORT_STOP' ? 'stop.discomfort' : 'stop.interrupted';
}
