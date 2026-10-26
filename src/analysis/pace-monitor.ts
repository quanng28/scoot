import type { TrackedJoint } from '../features/practice/tracking.js';
import type { ExerciseId } from '../features/setup/setup-model.js';
import type { Sample } from '../pose/observations.js';

/**
 * Calibration-free movement pace monitor. It runs on every recording (including video-only takes) so a
 * spoken pace cue never depends on finished setup. Two independent speed signals are combined:
 *  - angular speed of one image-plane joint angle per exercise (vertical reference where a trunk joint is
 *    often hidden when seated, so a missing hip cannot silence the cue), and
 *  - linear speed of the distal joint in limb lengths per second (scale-free, needs no reference object).
 * Either one above its limit for two consecutive observations raises a warning. Short tracking gaps
 * (blur during fast motion) are bridged instead of resetting. Engineering estimates only, not clinical.
 */
export const PACE_MONITOR_VERSION = 'pace-monitor.v2';
export const PACE_SETTINGS = {
  fastDegPerSec: 150,
  fastLimbLengthsPerSec: 1.5,
  /** Both speeds must fall below this fraction of their limits before another warning can start. */
  rearmRatio: 0.5,
  /** Consecutive observations above a limit before warning; one noisy frame is not enough. */
  confirmSamples: 2,
  smoothingTauMs: 50,
  maxGapMs: 400,
  minConfidence: 0.3,
  /** Repetition segmentation on the monitored angle (excursion from a slowly tracked rest angle). */
  repOnsetDeg: 25,
  repReturnDeg: 12,
  restTauMs: 600,
  seriesStepMs: 100,
  maxSeries: 700,
  maxEvents: 30,
  maxReps: 30,
} as const;

type Ref = TrackedJoint | 'down';
type PaceJoints = { ref: Ref; vertex: TrackedJoint; distal: TrackedJoint; limb: readonly TrackedJoint[] };
const UPPER: readonly TrackedJoint[] = ['shoulder', 'elbow', 'wrist'];
const PACE_JOINTS: Record<ExerciseId, PaceJoints> = {
  seated_forward_reach: { ref: 'down', vertex: 'shoulder', distal: 'wrist', limb: UPPER },
  seated_elbow_flexion_extension: { ref: 'shoulder', vertex: 'elbow', distal: 'wrist', limb: UPPER },
  seated_forward_arm_raise: { ref: 'down', vertex: 'shoulder', distal: 'elbow', limb: UPPER },
  seated_knee_extension: { ref: 'hip', vertex: 'knee', distal: 'ankle', limb: ['hip', 'knee', 'ankle'] },
  seated_single_leg_lift: { ref: 'down', vertex: 'hip', distal: 'knee', limb: ['hip', 'knee', 'ankle'] },
  seated_ankle_pumps: { ref: 'knee', vertex: 'ankle', distal: 'footIndex', limb: ['knee', 'ankle'] },
};
export const PACE_ANGLE_LABEL: Record<ExerciseId, string> = {
  seated_forward_reach: 'arm elevation from vertical',
  seated_elbow_flexion_extension: 'elbow angle',
  seated_forward_arm_raise: 'upper-arm elevation from vertical',
  seated_knee_extension: 'knee angle',
  seated_single_leg_lift: 'thigh angle from vertical',
  seated_ankle_pumps: 'shank-to-foot angle',
};
/** Where linear speed is measured, for report wording. */
export const PACE_DISTAL_LABEL: Record<ExerciseId, string> = {
  seated_forward_reach: 'wrist', seated_elbow_flexion_extension: 'wrist', seated_forward_arm_raise: 'elbow',
  seated_knee_extension: 'ankle', seated_single_leg_lift: 'knee', seated_ankle_pumps: 'front of the foot',
};

export type PaceSeverity = 'moderate' | 'high';
/** One fast-movement episode: from the confirmed crossing until both speeds drop below the re-arm level. */
export type PaceEvent = { index: number; tMs: number; rep: number | null; peakDegPerSec: number; peakLimbPerSec: number; severity: PaceSeverity };
export type PaceRep = { index: number; startMs: number; endMs: number; minDeg: number; maxDeg: number; excursionDeg: number; peakDegPerSec: number; peakLimbPerSec: number; warnings: number };
export type PacePoint = { tMs: number; angleDeg: number | null; degPerSec: number | null; limbPerSec: number | null };
export type PaceSummary = {
  trackedSec: number;
  angleMinDeg: number | null;
  angleMaxDeg: number | null;
  peakSpeedDegPerSec: number | null;
  peakLimbLengthsPerSec: number | null;
  fastWarnings: number;
  events: PaceEvent[];
  reps: PaceRep[];
  /** Downsampled angle/speed trace for the local charts only; never sent to a provider. */
  series: PacePoint[];
};

type Point = { x: number; y: number };
type Obs = { t: number; angle: number | null; distal: Point | null };

export function paceSeverity(peakDegPerSec: number, peakLimbPerSec: number): PaceSeverity {
  return peakDegPerSec >= 2 * PACE_SETTINGS.fastDegPerSec || peakLimbPerSec >= 2 * PACE_SETTINGS.fastLimbLengthsPerSec ? 'high' : 'moderate';
}

export class PaceMonitor {
  private last: Obs | null = null;
  /** Smoothed signed angular velocity and distal velocity vector; speeds are their magnitudes. */
  private degVel = 0;
  private limbVel = { x: 0, y: 0 };
  private degSpeed = 0;
  private limbSpeed = 0;
  private above = 0;
  private armed = true;
  private event: PaceEvent | null = null;
  private readonly events: PaceEvent[] = [];
  private warnings = 0;
  private trackedMs = 0;
  private min = Infinity;
  private max = -Infinity;
  private peakDeg = 0;
  private peakLimb = 0;
  private limbPx = 0;
  private rest: number | null = null;
  private rep: Omit<PaceRep, 'index' | 'endMs' | 'excursionDeg'> | null = null;
  private repExcursion = 0;
  private readonly reps: PaceRep[] = [];
  private readonly series: PacePoint[] = [];
  private lastSeriesT = -Infinity;
  private readonly joints: PaceJoints;

  constructor(exerciseId: ExerciseId, private readonly width: number, private readonly height: number) {
    this.joints = PACE_JOINTS[exerciseId];
  }

  /** `tMs` is recording-relative time. Returns true exactly when a new fast-movement warning is raised. */
  push(sample: Sample, tMs: number): boolean {
    const p = (joint: TrackedJoint): Point | null => {
      const l = sample.landmarks[joint];
      return l && l.confidence !== null && l.confidence >= PACE_SETTINGS.minConfidence && Number.isFinite(l.x) && Number.isFinite(l.y) ? { x: l.x * this.width, y: l.y * this.height } : null;
    };
    const limb = this.joints.limb.map(p);
    if (limb.every(Boolean)) {
      let length = 0;
      for (let i = 1; i < limb.length; i++) length += Math.hypot(limb[i]!.x - limb[i - 1]!.x, limb[i]!.y - limb[i - 1]!.y);
      this.limbPx = Math.max(this.limbPx, length); // longest view = least foreshortened
    }
    const vertex = p(this.joints.vertex), distal = p(this.joints.distal);
    const ref = this.joints.ref === 'down' ? (vertex ? { x: vertex.x, y: vertex.y + 1 } : null) : p(this.joints.ref);
    const angle = vertex && distal && ref ? angleAt(ref, vertex, distal) : null;
    if (angle === null && distal === null) return false;
    const obs: Obs = { t: tMs, angle, distal };
    const prev = this.last;
    this.last = obs;
    if (angle !== null) { this.min = Math.min(this.min, angle); this.max = Math.max(this.max, angle); }
    let raised = false;
    if (prev && obs.t > prev.t) {
      const dt = obs.t - prev.t;
      if (dt > PACE_SETTINGS.maxGapMs) { this.degVel = 0; this.limbVel = { x: 0, y: 0 }; this.degSpeed = 0; this.limbSpeed = 0; this.above = 0; }
      else {
        this.trackedMs += dt;
        const alpha = 1 - Math.exp(-dt / PACE_SETTINGS.smoothingTauMs);
        const before = { deg: this.degVel, limb: { ...this.limbVel } };
        if (angle !== null && prev.angle !== null) this.degVel += alpha * ((angle - prev.angle) / (dt / 1000) - this.degVel);
        const scale = this.limbPx > 0 ? this.limbPx : 0.35 * this.height;
        if (distal && prev.distal) {
          this.limbVel.x += alpha * ((distal.x - prev.distal.x) / scale / (dt / 1000) - this.limbVel.x);
          this.limbVel.y += alpha * ((distal.y - prev.distal.y) / scale / (dt / 1000) - this.limbVel.y);
        }
        this.degSpeed = Math.abs(this.degVel); this.limbSpeed = Math.hypot(this.limbVel.x, this.limbVel.y);
        this.peakDeg = Math.max(this.peakDeg, this.degSpeed); this.peakLimb = Math.max(this.peakLimb, this.limbSpeed);
        // A real movement keeps its direction; a one-frame landmark jump goes out and straight back.
        const sameDirection = Math.sign(this.degVel) === Math.sign(before.deg) || this.limbVel.x * before.limb.x + this.limbVel.y * before.limb.y > 0;
        raised = this.detect(obs.t, sameDirection);
      }
    }
    if (angle !== null) this.segment(obs.t, angle, prev && obs.t > prev.t ? obs.t - prev.t : 0);
    if (obs.t - this.lastSeriesT >= PACE_SETTINGS.seriesStepMs && this.series.length < PACE_SETTINGS.maxSeries) {
      this.lastSeriesT = obs.t;
      this.series.push({ tMs: obs.t, angleDeg: angle, degPerSec: prev ? this.degSpeed : null, limbPerSec: prev ? this.limbSpeed : null });
    }
    return raised;
  }

  get fastWarnings(): number { return this.warnings; }

  summary(): PaceSummary {
    const tracked = this.trackedMs > 0;
    return {
      trackedSec: this.trackedMs / 1000,
      angleMinDeg: Number.isFinite(this.min) ? this.min : null,
      angleMaxDeg: Number.isFinite(this.max) ? this.max : null,
      peakSpeedDegPerSec: tracked ? this.peakDeg : null,
      peakLimbLengthsPerSec: tracked ? this.peakLimb : null,
      fastWarnings: this.warnings,
      events: this.events.map((e) => ({ ...e })),
      reps: this.reps.map((r) => ({ ...r })),
      series: [...this.series],
    };
  }

  private detect(t: number, sameDirection: boolean): boolean {
    const fast = this.degSpeed > PACE_SETTINGS.fastDegPerSec || this.limbSpeed > PACE_SETTINGS.fastLimbLengthsPerSec;
    this.above = !fast ? 0 : sameDirection ? this.above + 1 : 1;
    if (this.event) {
      this.event.peakDegPerSec = Math.max(this.event.peakDegPerSec, this.degSpeed);
      this.event.peakLimbPerSec = Math.max(this.event.peakLimbPerSec, this.limbSpeed);
      this.event.severity = paceSeverity(this.event.peakDegPerSec, this.event.peakLimbPerSec);
    }
    if (this.armed && this.above >= PACE_SETTINGS.confirmSamples) {
      this.armed = false; this.warnings++;
      if (this.rep) this.rep.warnings++;
      const event: PaceEvent = { index: this.warnings, tMs: t, rep: this.rep ? this.reps.length + 1 : null, peakDegPerSec: this.degSpeed, peakLimbPerSec: this.limbSpeed, severity: paceSeverity(this.degSpeed, this.limbSpeed) };
      this.event = this.events.length < PACE_SETTINGS.maxEvents ? event : null;
      if (this.event) this.events.push(this.event);
      return true;
    }
    if (!this.armed && this.degSpeed < PACE_SETTINGS.fastDegPerSec * PACE_SETTINGS.rearmRatio && this.limbSpeed < PACE_SETTINGS.fastLimbLengthsPerSec * PACE_SETTINGS.rearmRatio) {
      this.armed = true; this.event = null;
    }
    return false;
  }

  private segment(t: number, angle: number, dt: number): void {
    if (this.rest === null) { this.rest = angle; return; }
    const excursion = Math.abs(angle - this.rest);
    if (!this.rep) {
      // Follow slow posture drift only inside the rest band, so even a very slow raise leaves it.
      if (excursion < PACE_SETTINGS.repReturnDeg) this.rest += (1 - Math.exp(-dt / PACE_SETTINGS.restTauMs)) * (angle - this.rest);
      if (excursion >= PACE_SETTINGS.repOnsetDeg) {
        this.rep = { startMs: t, minDeg: angle, maxDeg: angle, peakDegPerSec: this.degSpeed, peakLimbPerSec: this.limbSpeed, warnings: this.event && this.event.rep === null ? 1 : 0 };
        if (this.event && this.event.rep === null) this.event.rep = this.reps.length + 1;
        this.repExcursion = excursion;
      }
      return;
    }
    const rep = this.rep;
    rep.minDeg = Math.min(rep.minDeg, angle); rep.maxDeg = Math.max(rep.maxDeg, angle);
    rep.peakDegPerSec = Math.max(rep.peakDegPerSec, this.degSpeed); rep.peakLimbPerSec = Math.max(rep.peakLimbPerSec, this.limbSpeed);
    this.repExcursion = Math.max(this.repExcursion, excursion);
    if (excursion <= PACE_SETTINGS.repReturnDeg) {
      if (this.reps.length < PACE_SETTINGS.maxReps) this.reps.push({ index: this.reps.length + 1, ...rep, endMs: t, excursionDeg: this.repExcursion });
      this.rep = null;
    }
  }
}

function angleAt(a: Point, v: Point, b: Point): number | null {
  const ax = a.x - v.x, ay = a.y - v.y, bx = b.x - v.x, by = b.y - v.y;
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!(mag > 0)) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / mag))) * 180 / Math.PI;
}
