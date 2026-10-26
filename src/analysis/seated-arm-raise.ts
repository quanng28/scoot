import { z } from 'zod';
import { REACH_JOINTS, type ReachFrame, type PixelPose, type Reason, type Interruption } from './reach-contract.js';
import { pixelObservation, distance } from './reach-geometry.js';

const finite = z.number().finite();
const positive = finite.positive();
export const armRaiseMetricUnits = {
  peakUpperArmAngleDeg: 'degrees',
  peakWristElevation: 'reference_lengths',
  torsoForwardPeakDeg: 'degrees',
  raiseDurationSec: 'seconds',
  returnDurationSec: 'seconds',
} as const;

export type ArmRaiseMetric = keyof typeof armRaiseMetricUnits;
export type ArmRaiseReason = Exclude<Reason, 'TARGET_NOT_REACHED'> | 'ENDPOINT_NOT_REACHED';

export const armRaiseConfigSchema = z.strictObject({
  sessionId: z.string().min(1),
  configurationId: z.string().min(1),
  version: z.string().min(1),
  mode: z.enum(['rehabilitation', 'wellness']),
  side: z.enum(['left', 'right']),
  frameWidth: positive.max(16384),
  frameHeight: positive.max(16384),
  orientation: z.string().min(1),
  baseline: z.strictObject({
    shoulder: z.strictObject({ x: finite, y: finite }),
    elbow: z.strictObject({ x: finite, y: finite }),
    wrist: z.strictObject({ x: finite, y: finite }),
    hip: z.strictObject({ x: finite, y: finite }),
  }),
  reference: z.tuple([z.strictObject({ x: finite, y: finite }), z.strictObject({ x: finite, y: finite })]),
  forwardSign: z.union([z.literal(-1), z.literal(1)]),
  endpointDriver: z.enum(['upperArmAngle', 'wristElevation']),
  endpointDeg: finite.min(0).max(180),
  endpointElevation: finite.min(0).max(5),
  settings: z.strictObject({
    minConfidence: z.strictObject({
      shoulder: finite.min(0).max(1),
      elbow: finite.min(0).max(1),
      wrist: finite.min(0).max(1),
      hip: finite.min(0).max(1),
    }),
    minSegmentPx: positive,
    minReferencePx: positive,
    restToleranceDeg: positive,
    endpointToleranceDeg: positive,
    onsetExcursionDeg: positive,
    returnHysteresisDeg: positive,
    restToleranceElevation: positive,
    endpointToleranceElevation: positive,
    onsetExcursionElevation: positive,
    returnHysteresisElevation: positive,
    readinessMs: positive,
    onsetDwellMs: positive,
    endpointDwellMs: positive,
    returnDwellMs: positive,
    timeoutMs: positive,
    smoothingTauMs: finite.nonnegative(),
    filterResetGapMs: positive,
    sampleSupportMs: positive,
    maxGapMs: positive,
    minCoverage: positive.max(1),
    minObservations: z.number().int().min(2),
  }),
  criteria: z.array(z.strictObject({
    metric: z.enum(['peakUpperArmAngleDeg', 'peakWristElevation', 'torsoForwardPeakDeg', 'raiseDurationSec', 'returnDurationSec']),
    operator: z.enum(['<', '>']),
    threshold: finite,
  })),
});

export type ArmRaiseConfig = z.infer<typeof armRaiseConfigSchema>;

export type ArmRaiseObservation = {
  timestampMs: number;
  raw: PixelPose;
  filtered: PixelPose;
  upperArmAngleDeg: number;
  wristElevation: number;
  torsoDeltaDeg: number;
};

export type ArmRaiseAttempt = {
  id: string;
  sessionId: string;
  configurationId: string;
  analysisVersion: string;
  exerciseId: 'seated_forward_arm_raise';
  mode: ArmRaiseConfig['mode'];
  side: ArmRaiseConfig['side'];
  startMs: number;
  endpointMs: number | null;
  returnStartMs: number | null;
  restMs: number | null;
  endMs: number;
  classification: 'measurable' | 'excluded';
  reasons: ArmRaiseReason[];
  explanations: string[];
  metrics: Record<ArmRaiseMetric, { value: number | null; unit: string; reasons: ArmRaiseReason[] }>;
  quality: { coverage: number; longestGapMs: number; observationCount: number };
  flags: { metric: ArmRaiseMetric; operator: '<' | '>'; threshold: number; observed: number; replay: { startMs: number; endMs: number }; explanation: string }[];
  observations: ArmRaiseObservation[];
  evidence: { status: 'unavailable'; reason: string };
};

type Entry = { time: number; observation: ArmRaiseObservation | null; reason: ArmRaiseReason | null };
type Active = {
  id: string;
  start: number;
  endpoint: number | null;
  returnStart: number | null;
  restTime: number | null;
  completion: number | null;
  endpointMaxAngle: number;
  endpointMaxElevation: number;
  entries: Entry[];
  reasons: Set<ArmRaiseReason>;
};

type State = 'REACQUIRE_REST' | 'REST' | 'RAISING' | 'RAISE_ENDPOINT' | 'LOWERING';

const upperArmAngle = (p: PixelPose) => {
  const { shoulder: s, elbow: e, hip: h } = p;
  const dot = (e.x - s.x) * (h.x - s.x) + (e.y - s.y) * (h.y - s.y);
  const mag = distance(e, s) * distance(h, s);
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
};

const inclination = (p: PixelPose) => Math.atan2(p.shoulder.x - p.hip.x, -(p.shoulder.y - p.hip.y)) * 180 / Math.PI;
const wrap = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
const validSegments = (p: PixelPose, minimum: number) =>
  distance(p.shoulder, p.elbow) >= minimum && distance(p.elbow, p.wrist) >= minimum && distance(p.shoulder, p.hip) >= minimum;

export class SeatedArmRaiseAnalyzer {
  private readonly config: ArmRaiseConfig;
  private readonly restAngle: number;
  private readonly refLengthPx: number;
  private phase: State = 'REACQUIRE_REST';
  private clock = -1;
  private lastFrame = -1;
  private barrier = -1;
  private lastValid: number | null = null;
  private previous: ArmRaiseObservation | null = null;
  private dwell = new Map<string, number>();
  private onset: ArmRaiseObservation[] = [];
  private active: Active | null = null;
  private nextId = 1;
  private stopped = false;
  private results: ArmRaiseAttempt[] = [];

  constructor(input: unknown) {
    this.config = armRaiseConfigSchema.parse(structuredClone(input));
    const c = this.config, s = c.settings;
    const criterionKeys = c.criteria.map((criterion) => `${criterion.metric}/${criterion.operator}/${criterion.threshold}`);
    if (new Set(criterionKeys).size !== criterionKeys.length) throw new Error('Duplicate review criteria');
    if (!validSegments(c.baseline, s.minSegmentPx) || Object.values(c.baseline).some((p) => p.x < 0 || p.y < 0 || p.x > c.frameWidth || p.y > c.frameHeight)) {
      throw new Error('Invalid arm raise baseline');
    }
    this.restAngle = upperArmAngle(c.baseline);
    this.refLengthPx = distance(...c.reference);
    if (!Number.isFinite(this.refLengthPx) || this.refLengthPx < s.minReferencePx || c.reference.some((p) => p.x < 0 || p.y < 0 || p.x > c.frameWidth || p.y > c.frameHeight)) {
      throw new Error('Invalid fixed image reference');
    }
    if (c.endpointDriver === 'upperArmAngle') {
      if (c.endpointDeg - s.endpointToleranceDeg <= this.restAngle + s.onsetExcursionDeg || s.onsetExcursionDeg <= s.restToleranceDeg ||
          s.returnHysteresisDeg >= c.endpointDeg - this.restAngle - s.restToleranceDeg) {
        throw new Error('Arm raise angle endpoint, rest and onset regions must be distinct');
      }
    } else {
      if (c.endpointElevation - s.endpointToleranceElevation <= s.onsetExcursionElevation || s.onsetExcursionElevation <= s.restToleranceElevation ||
          s.returnHysteresisElevation >= c.endpointElevation - s.restToleranceElevation) {
        throw new Error('Arm raise elevation endpoint, rest and onset regions must be distinct');
      }
    }
    if (s.sampleSupportMs > s.maxGapMs || s.filterResetGapMs > s.maxGapMs ||
        [s.readinessMs, s.onsetDwellMs, s.endpointDwellMs, s.returnDwellMs].some((v) => v >= s.timeoutMs)) {
      throw new Error('Invalid arm raise timing configuration');
    }
  }

  get state(): State { return this.phase; }
  get configuration(): ArmRaiseConfig { return structuredClone(this.config); }
  drain(): ArmRaiseAttempt[] { const out = this.results; this.results = []; return out; }

  advance(now: number): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    this.clock = now;
    if (this.active?.completion !== null && this.active?.completion !== undefined && now > this.active.completion) {
      this.finish(this.active.completion, []);
      this.phase = 'REST';
    }
    const reasons: ArmRaiseReason[] = [];
    if (this.active && now - this.active.start >= this.config.settings.timeoutMs) reasons.push('TIMEOUT');
    if (this.lastValid !== null && now - this.lastValid > this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
    if (reasons.length) { this.finish(now, reasons); this.barrier = now; this.reacquire(); }
  }

  interrupt(now: number, reason: Interruption): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    // A stop at the completion timestamp wins; a later stop preserves an already completed attempt.
    if (this.active && (this.active.completion === null || now <= this.active.completion)) {
      const reasons: ArmRaiseReason[] = [reason];
      if (now - this.active.start >= this.config.settings.timeoutMs) reasons.push('TIMEOUT');
      if (this.lastValid !== null && now - this.lastValid > this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
      this.clock = now;
      this.finish(now, reasons);
    } else {
      this.advance(now);
    }
    this.reacquire(); this.stopped = true;
  }

  accept(frame: ReachFrame): void {
    const time = frame.timestampMs, c = this.config, s = c.settings;
    if (this.stopped || !Number.isFinite(time) || time < 0 || time <= this.lastFrame || time <= this.barrier) return;
    this.advance(Math.max(time, this.clock)); if (time < this.barrier) return; this.lastFrame = time;
    if (frame.side !== c.side || frame.width !== c.frameWidth || frame.height !== c.frameHeight || frame.orientation !== c.orientation) {
      this.interrupt(Math.max(time, this.clock), 'SETUP_CHANGED'); return;
    }
    if (this.active?.completion !== null && this.active?.completion !== undefined) return;
    if (this.lastValid !== null && time - this.lastValid > s.sampleSupportMs) {
      this.resetDwell();
      if (this.active && this.phase === 'RAISING') this.active.reasons.add('CRITICAL_PEAK_GAP');
    }
    const converted = pixelObservation(frame, c);
    if (converted.reason) { this.reject(time, converted.reason === 'TARGET_NOT_REACHED' ? 'ENDPOINT_NOT_REACHED' : converted.reason); return; }
    if (this.previous && time - this.previous.timestampMs > s.filterResetGapMs) this.previous = null;
    const raw = converted.pose, filtered = structuredClone(converted.pose);
    const alpha = !this.previous || s.smoothingTauMs === 0 ? 1 : 1 - Math.exp(-(time - this.previous.timestampMs) / s.smoothingTauMs);
    for (const key of REACH_JOINTS) {
      const old = this.previous?.filtered[key] ?? raw[key];
      filtered[key] = { x: old.x + alpha * (raw[key].x - old.x), y: old.y + alpha * (raw[key].y - old.y) };
    }
    if (!validSegments(raw, s.minSegmentPx) || !validSegments(filtered, s.minSegmentPx)) { this.reject(time, 'DEGENERATE_GEOMETRY'); return; }
    const curAngle = upperArmAngle(filtered);
    const elevation = (c.baseline.wrist.y - filtered.wrist.y) / this.refLengthPx;
    const torsoDelta = c.forwardSign * wrap(inclination(filtered) - inclination(c.baseline));
    const observation: ArmRaiseObservation = { timestampMs: time, raw, filtered, upperArmAngleDeg: curAngle, wristElevation: elevation, torsoDeltaDeg: torsoDelta };
    this.previous = observation; this.lastValid = time;
    if (this.active) {
      this.active.entries.push({ time, observation, reason: null });
      if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); return; }
    }

    const resting = c.endpointDriver === 'upperArmAngle'
      ? Math.abs(curAngle - this.restAngle) <= s.restToleranceDeg
      : Math.abs(elevation) <= s.restToleranceElevation;
    const endpoint = c.endpointDriver === 'upperArmAngle'
      ? Math.abs(curAngle - c.endpointDeg) <= s.endpointToleranceDeg
      : Math.abs(elevation - c.endpointElevation) <= s.endpointToleranceElevation;

    if (this.phase === 'REACQUIRE_REST') {
      if (this.confirm('ready', resting, time, s.readinessMs) !== null) { this.phase = 'REST'; this.resetDwell(); this.previous = null; }
      return;
    }
    if (this.phase === 'REST') {
      const raising = c.endpointDriver === 'upperArmAngle'
        ? (!resting && curAngle - this.restAngle > s.onsetExcursionDeg)
        : (!resting && elevation > s.onsetExcursionElevation);
      if (raising) this.onset.push(observation); else this.onset = [];
      if (this.onset.length > 10_000) { this.reacquire(); return; }
      const first = this.confirm('onset', raising, time, s.onsetDwellMs);
      if (first !== null) {
        const buffer = this.onset;
        this.active = {
          id: `${c.sessionId}:raise:${this.nextId++}`,
          start: first, endpoint: null, returnStart: null, restTime: null, completion: null,
          endpointMaxAngle: -Infinity, endpointMaxElevation: -Infinity,
          entries: buffer.map((o) => ({ time: o.timestampMs, observation: o, reason: null })),
          reasons: new Set(),
        };
        this.phase = 'RAISING'; this.resetDwell();
        for (const o of buffer) {
          const match = c.endpointDriver === 'upperArmAngle'
            ? Math.abs(o.upperArmAngleDeg - c.endpointDeg) <= s.endpointToleranceDeg
            : Math.abs(o.wristElevation - c.endpointElevation) <= s.endpointToleranceElevation;
          const found = this.confirm('endpoint', match, o.timestampMs, s.endpointDwellMs);
          if (found !== null) { this.enterEndpoint(found); break; }
        }
      }
      return;
    }
    const a = this.active; if (!a) return;
    if (this.phase === 'RAISING') {
      const found = this.confirm('endpoint', endpoint, time, s.endpointDwellMs);
      if (found !== null) this.enterEndpoint(found);
      else if (this.confirm('early', resting, time, s.returnDwellMs) !== null) { this.finish(time, ['ENDPOINT_NOT_REACHED']); this.phase = 'REST'; }
      return;
    }
    if (this.phase === 'RAISE_ENDPOINT') {
      a.endpointMaxAngle = Math.max(a.endpointMaxAngle, observation.upperArmAngleDeg);
      a.endpointMaxElevation = Math.max(a.endpointMaxElevation, observation.wristElevation);
      const departing = c.endpointDriver === 'upperArmAngle'
        ? a.endpointMaxAngle - observation.upperArmAngleDeg > s.returnHysteresisDeg
        : a.endpointMaxElevation - observation.wristElevation > s.returnHysteresisElevation;
      const returnStart = this.confirm('departure', departing, time, s.returnDwellMs);
      const restTime = this.confirm('rest', resting, time, s.returnDwellMs);
      if (returnStart !== null) { a.returnStart = returnStart; this.phase = 'LOWERING'; }
      if (restTime !== null && a.returnStart !== null) { a.restTime = restTime; a.completion = time; }
      return;
    }
    if (this.phase === 'LOWERING') {
      const restTime = this.confirm('rest', resting, time, s.returnDwellMs);
      if (restTime !== null) { a.restTime = restTime; a.completion = time; }
    }
  }

  private enterEndpoint(time: number): void {
    const a = this.active!; a.endpoint = time;
    const past = a.entries.filter((e) => e.time >= time && e.observation).map((e) => e.observation!);
    a.endpointMaxAngle = Math.max(...past.map((o) => o.upperArmAngleDeg));
    a.endpointMaxElevation = Math.max(...past.map((o) => o.wristElevation));
    this.phase = 'RAISE_ENDPOINT'; this.resetDwell();
  }

  private confirm(key: string, condition: boolean, time: number, duration: number): number | null {
    if (!condition) { this.dwell.delete(key); return null; }
    const first = this.dwell.get(key) ?? time; this.dwell.set(key, first); return time - first >= duration ? first : null;
  }
  private resetDwell(): void { this.dwell.clear(); this.onset = []; }
  private reacquire(): void { this.phase = 'REACQUIRE_REST'; this.resetDwell(); this.previous = null; this.lastValid = null; }
  private reject(time: number, reason: ArmRaiseReason): void {
    this.resetDwell(); if (!this.active) return;
    this.active.entries.push({ time, observation: null, reason });
    if (this.phase === 'RAISING') this.active.reasons.add('CRITICAL_PEAK_GAP');
    if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); }
  }

  private finish(end: number, extra: ArmRaiseReason[]): void {
    const a = this.active; if (!a) return; this.active = null; this.resetDwell(); this.previous = null;
    const s = this.config.settings, reasons = new Set<ArmRaiseReason>([...a.reasons, ...extra]);
    if (a.endpoint === null) reasons.add('ENDPOINT_NOT_REACHED');
    if (a.completion === null && !extra.includes('ENDPOINT_NOT_REACHED')) reasons.add('RETURN_NOT_OBSERVED');
    let cursor = a.start, support = 0, longestGapMs = 0;
    for (const [i, e] of a.entries.entries()) {
      if (!e.observation) continue;
      const until = Math.min(end, e.time + s.sampleSupportMs, a.entries[i + 1]?.time ?? end);
      longestGapMs = Math.max(longestGapMs, e.time - cursor);
      support += Math.max(0, until - e.time); cursor = Math.max(cursor, until);
    }
    longestGapMs = Math.max(longestGapMs, end - cursor);
    const observations = a.entries.flatMap((e) => e.observation ? [e.observation] : []);
    const coverage = end > a.start ? support / (end - a.start) : 0;
    if (coverage < s.minCoverage) reasons.add('INSUFFICIENT_COVERAGE');
    if (longestGapMs > s.maxGapMs) reasons.add('TRACKING_GAP');
    if (observations.length < s.minObservations) reasons.add('INSUFFICIENT_OBSERVATIONS');
    if (reasons.size) for (const e of a.entries) if (e.reason) reasons.add(e.reason);
    const measurable = reasons.size === 0;
    const outward = observations.filter((o) => a.endpoint !== null && o.timestampMs <= a.endpoint);
    const peakAngle = measurable ? Math.max(...outward.map((o) => o.upperArmAngleDeg)) : null;
    const peakElevation = measurable ? Math.max(...outward.map((o) => o.wristElevation)) : null;
    const torsoPeak = measurable ? Math.max(0, ...outward.map((o) => o.torsoDeltaDeg)) : null;
    const values: Record<ArmRaiseMetric, number | null> = {
      peakUpperArmAngleDeg: peakAngle,
      peakWristElevation: peakElevation,
      torsoForwardPeakDeg: torsoPeak,
      raiseDurationSec: measurable ? (a.endpoint! - a.start) / 1000 : null,
      returnDurationSec: measurable ? (a.restTime! - a.returnStart!) / 1000 : null,
    };
    const reasonList = [...reasons];
    const explanations = reasonList.map((r) => r === 'ENDPOINT_NOT_REACHED' ? 'Sustained raise endpoint was not observed.'
      : r === 'RETURN_NOT_OBSERVED' ? 'A sustained return to rest was not observed.'
      : r === 'CRITICAL_PEAK_GAP' ? 'Missing outward-phase observations could conceal the endpoint or peak.'
      : r === 'TRACKING_GAP' ? 'Tracking was absent longer than the configured limit.'
      : r === 'INSUFFICIENT_COVERAGE' ? 'Too little of the attempt had valid observations.'
      : r === 'INSUFFICIENT_OBSERVATIONS' ? 'The attempt had too few valid observations.'
      : r === 'DEGENERATE_GEOMETRY' ? 'Projected arm or trunk segments were too short to measure reliably.'
      : r === 'LOW_LANDMARK_QUALITY' ? 'A required arm or trunk landmark was missing or unreliable.'
      : r === 'OUT_OF_FRAME' ? 'A required arm or trunk landmark was outside the camera image.'
      : r === 'TIMEOUT' ? 'The attempt exceeded the configured duration limit.'
      : r === 'STOPPED_EARLY' ? 'Capture stopped before the attempt was finalized.'
      : r === 'DISCOMFORT_STOP' ? 'Capture stopped after reported discomfort.'
      : r === 'SETUP_CHANGED' ? 'Camera geometry, anatomical side, or task setup changed.'
      : 'Diagnostic observation buffer exceeded.');

    const metric = (key: ArmRaiseMetric) => ({ value: values[key], unit: armRaiseMetricUnits[key], reasons: [...reasonList] });
    const metrics: ArmRaiseAttempt['metrics'] = {
      peakUpperArmAngleDeg: metric('peakUpperArmAngleDeg'),
      peakWristElevation: metric('peakWristElevation'),
      torsoForwardPeakDeg: metric('torsoForwardPeakDeg'),
      raiseDurationSec: metric('raiseDurationSec'),
      returnDurationSec: metric('returnDurationSec')
    };

    const flags: ArmRaiseAttempt['flags'] = [];
    if (measurable) {
      for (const criterion of this.config.criteria) {
        const observed = values[criterion.metric]!;
        if (criterion.operator === '>' ? observed > criterion.threshold : observed < criterion.threshold) {
          flags.push({
            ...criterion, observed,
            replay: { startMs: a.start, endMs: end },
            explanation: `${criterion.metric} ${observed} ${armRaiseMetricUnits[criterion.metric]} exceeded configured ${criterion.operator} ${criterion.threshold}. Review replay.`,
          });
        }
      }
    }

    this.results.push({
      id: a.id,
      sessionId: this.config.sessionId,
      configurationId: this.config.configurationId,
      analysisVersion: this.config.version,
      exerciseId: 'seated_forward_arm_raise',
      mode: this.config.mode,
      side: this.config.side,
      startMs: a.start,
      endpointMs: a.endpoint,
      returnStartMs: a.returnStart,
      restMs: a.restTime,
      endMs: end,
      classification: measurable ? 'measurable' : 'excluded',
      reasons: reasonList,
      explanations,
      metrics,
      quality: { coverage, longestGapMs, observationCount: observations.length },
      flags,
      observations,
      evidence: { status: 'unavailable', reason: 'Recording linkage and timing verification must be supplied by capture integration.' },
    });
  }
}

export function summarizeArmRaise(attempts: ArmRaiseAttempt[]) {
  const groups = new Set(attempts.map((a) => `${a.mode}/${a.exerciseId}/${a.configurationId}/${a.analysisVersion}`));
  if (groups.size > 1) throw new Error('Cannot summarize incompatible exercise configurations');
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length) throw new Error('Duplicate attempt IDs');
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  const flagged = measurable.filter((a) => a.flags.length > 0).length;
  const median = (key: ArmRaiseMetric): number | null => {
    const values = measurable.flatMap((a) => {
      const value = a.metrics[key].value;
      return value === null ? [] : [value];
    }).sort((a, b) => a - b);
    return values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null;
  };
  const medians = {
    peakUpperArmAngleDeg: median('peakUpperArmAngleDeg'),
    peakWristElevation: median('peakWristElevation'),
    torsoForwardPeakDeg: median('torsoForwardPeakDeg'),
    raiseDurationSec: median('raiseDurationSec'),
    returnDurationSec: median('returnDurationSec')
  };
  return { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged, flagRate: measurable.length ? flagged / measurable.length : null, medians };
}
