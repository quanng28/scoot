import { z } from 'zod';
import { type ReachFrame, type Reason, type Interruption } from './reach-contract.js';

const finite = z.number().finite();
const positive = finite.positive();
export const KNEE_JOINTS = ['hip', 'knee', 'ankle'] as const;
export type KneeJoint = typeof KNEE_JOINTS[number];
export type Point = { x: number; y: number };
export type KneePose = Record<KneeJoint, Point>;

export const kneeExtensionMetricUnits = {
  peakKneeAngleDeg: 'degrees',
  projectedExtensionExcursionDeg: 'degrees',
  extensionDurationSec: 'seconds',
  returnDurationSec: 'seconds',
} as const;

export type KneeExtensionMetric = keyof typeof kneeExtensionMetricUnits;
export type KneeExtensionReason = Exclude<Reason, 'TARGET_NOT_REACHED'> | 'ENDPOINT_NOT_REACHED';

export const kneeExtensionConfigSchema = z.strictObject({
  sessionId: z.string().min(1),
  configurationId: z.string().min(1),
  version: z.string().min(1),
  mode: z.enum(['rehabilitation', 'wellness']),
  side: z.enum(['left', 'right']),
  frameWidth: positive.max(16384),
  frameHeight: positive.max(16384),
  orientation: z.string().min(1),
  baseline: z.strictObject({
    hip: z.strictObject({ x: finite, y: finite }),
    knee: z.strictObject({ x: finite, y: finite }),
    ankle: z.strictObject({ x: finite, y: finite }),
  }),
  endpointDeg: finite.min(0).max(180),
  settings: z.strictObject({
    minConfidence: z.strictObject({
      hip: finite.min(0).max(1),
      knee: finite.min(0).max(1),
      ankle: finite.min(0).max(1),
    }),
    minSegmentPx: positive,
    restToleranceDeg: positive,
    endpointToleranceDeg: positive,
    onsetExcursionDeg: positive,
    returnHysteresisDeg: positive,
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
    metric: z.enum(['peakKneeAngleDeg', 'projectedExtensionExcursionDeg', 'extensionDurationSec', 'returnDurationSec']),
    operator: z.enum(['<', '>']),
    threshold: finite,
  })),
});

export type KneeExtensionConfig = z.infer<typeof kneeExtensionConfigSchema>;

export type KneeObservation = {
  timestampMs: number;
  raw: KneePose;
  filtered: KneePose;
  kneeDeg: number;
  excursionDeg: number;
};

export type KneeExtensionAttempt = {
  id: string;
  sessionId: string;
  configurationId: string;
  analysisVersion: string;
  exerciseId: 'seated_knee_extension';
  mode: KneeExtensionConfig['mode'];
  side: KneeExtensionConfig['side'];
  startMs: number;
  endpointMs: number | null;
  returnStartMs: number | null;
  restMs: number | null;
  endMs: number;
  classification: 'measurable' | 'excluded';
  reasons: KneeExtensionReason[];
  explanations: string[];
  metrics: Record<KneeExtensionMetric, { value: number | null; unit: string; reasons: KneeExtensionReason[] }>;
  quality: { coverage: number; longestGapMs: number; observationCount: number };
  flags: { metric: KneeExtensionMetric; operator: '<' | '>'; threshold: number; observed: number; replay: { startMs: number; endMs: number }; explanation: string }[];
  observations: KneeObservation[];
  evidence: { status: 'unavailable'; reason: string };
};

type Entry = { time: number; observation: KneeObservation | null; reason: KneeExtensionReason | null };
type Active = {
  id: string;
  start: number;
  endpoint: number | null;
  returnStart: number | null;
  restTime: number | null;
  completion: number | null;
  endpointMaximum: number;
  entries: Entry[];
  reasons: Set<KneeExtensionReason>;
};

type State = 'REACQUIRE_REST' | 'REST' | 'EXTENDING' | 'EXTENSION_ENDPOINT' | 'RETURN';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const kneeAngle = (p: KneePose) => {
  const { hip: h, knee: k, ankle: a } = p;
  const dot = (h.x - k.x) * (a.x - k.x) + (h.y - k.y) * (a.y - k.y);
  const mag = dist(h, k) * dist(a, k);
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
};

const validSegments = (p: KneePose, minimum: number) =>
  dist(p.hip, p.knee) >= minimum && dist(p.knee, p.ankle) >= minimum;

export class SeatedKneeExtensionAnalyzer {
  private readonly config: KneeExtensionConfig;
  private readonly restAngle: number;
  private phase: State = 'REACQUIRE_REST';
  private clock = -1;
  private lastFrame = -1;
  private barrier = -1;
  private lastValid: number | null = null;
  private previous: KneeObservation | null = null;
  private dwell = new Map<string, number>();
  private onset: KneeObservation[] = [];
  private active: Active | null = null;
  private nextId = 1;
  private stopped = false;
  private results: KneeExtensionAttempt[] = [];

  constructor(input: unknown) {
    this.config = kneeExtensionConfigSchema.parse(structuredClone(input));
    const c = this.config, s = c.settings;
    const criterionKeys = c.criteria.map((criterion) => `${criterion.metric}/${criterion.operator}/${criterion.threshold}`);
    if (new Set(criterionKeys).size !== criterionKeys.length) throw new Error('Duplicate review criteria');
    if (!validSegments(c.baseline, s.minSegmentPx) || Object.values(c.baseline).some((p) => p.x < 0 || p.y < 0 || p.x > c.frameWidth || p.y > c.frameHeight)) {
      throw new Error('Invalid knee extension baseline');
    }
    this.restAngle = kneeAngle(c.baseline);
    if (c.endpointDeg - s.endpointToleranceDeg <= this.restAngle + s.onsetExcursionDeg || s.onsetExcursionDeg <= s.restToleranceDeg ||
        s.returnHysteresisDeg >= c.endpointDeg - this.restAngle - s.restToleranceDeg) {
      throw new Error('Knee extension endpoint, rest and onset regions must be distinct');
    }
    if (s.sampleSupportMs > s.maxGapMs || s.filterResetGapMs > s.maxGapMs ||
        [s.readinessMs, s.onsetDwellMs, s.endpointDwellMs, s.returnDwellMs].some((v) => v >= s.timeoutMs)) {
      throw new Error('Invalid knee extension timing configuration');
    }
  }

  get state(): State { return this.phase; }
  get configuration(): KneeExtensionConfig { return structuredClone(this.config); }
  drain(): KneeExtensionAttempt[] { const out = this.results; this.results = []; return out; }

  advance(now: number): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    this.clock = now;
    if (this.active?.completion !== null && this.active?.completion !== undefined && now > this.active.completion) {
      this.finish(this.active.completion, []);
      this.phase = 'REST';
    }
    const reasons: KneeExtensionReason[] = [];
    if (this.active && now - this.active.start >= this.config.settings.timeoutMs) reasons.push('TIMEOUT');
    if (this.lastValid !== null && now - this.lastValid > this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
    if (reasons.length) { this.finish(now, reasons); this.barrier = now; this.reacquire(); }
  }

  interrupt(now: number, reason: Interruption): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    // A stop at the completion timestamp wins; a later stop preserves an already completed attempt.
    if (this.active && (this.active.completion === null || now <= this.active.completion)) {
      const reasons: KneeExtensionReason[] = [reason];
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
      if (this.active && this.phase === 'EXTENDING') this.active.reasons.add('CRITICAL_PEAK_GAP');
    }

    const raw = structuredClone(c.baseline);
    for (const key of KNEE_JOINTS) {
      const p = frame.landmarks[key];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.confidence === null || !Number.isFinite(p.confidence) || p.confidence < s.minConfidence[key] || p.confidence > 1) {
        this.reject(time, 'LOW_LANDMARK_QUALITY'); return;
      }
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        this.reject(time, 'OUT_OF_FRAME'); return;
      }
      raw[key] = { x: p.x * frame.width, y: p.y * frame.height };
    }

    if (this.previous && time - this.previous.timestampMs > s.filterResetGapMs) this.previous = null;
    const filtered = structuredClone(raw);
    const alpha = !this.previous || s.smoothingTauMs === 0 ? 1 : 1 - Math.exp(-(time - this.previous.timestampMs) / s.smoothingTauMs);
    for (const key of KNEE_JOINTS) {
      const old = this.previous?.filtered[key] ?? raw[key];
      filtered[key] = { x: old.x + alpha * (raw[key].x - old.x), y: old.y + alpha * (raw[key].y - old.y) };
    }
    if (!validSegments(raw, s.minSegmentPx) || !validSegments(filtered, s.minSegmentPx)) { this.reject(time, 'DEGENERATE_GEOMETRY'); return; }

    const curAngle = kneeAngle(filtered);
    const excursion = curAngle - this.restAngle;
    const observation: KneeObservation = { timestampMs: time, raw, filtered, kneeDeg: curAngle, excursionDeg: excursion };
    this.previous = observation; this.lastValid = time;
    if (this.active) {
      this.active.entries.push({ time, observation, reason: null });
      if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); return; }
    }

    const resting = Math.abs(curAngle - this.restAngle) <= s.restToleranceDeg;
    const endpoint = Math.abs(curAngle - c.endpointDeg) <= s.endpointToleranceDeg;

    if (this.phase === 'REACQUIRE_REST') {
      if (this.confirm('ready', resting, time, s.readinessMs) !== null) { this.phase = 'REST'; this.resetDwell(); this.previous = null; }
      return;
    }
    if (this.phase === 'REST') {
      const extending = !resting && curAngle - this.restAngle > s.onsetExcursionDeg;
      if (extending) this.onset.push(observation); else this.onset = [];
      if (this.onset.length > 10_000) { this.reacquire(); return; }
      const first = this.confirm('onset', extending, time, s.onsetDwellMs);
      if (first !== null) {
        const buffer = this.onset;
        this.active = {
          id: `${c.sessionId}:knee:${this.nextId++}`,
          start: first, endpoint: null, returnStart: null, restTime: null, completion: null,
          endpointMaximum: -Infinity,
          entries: buffer.map((o) => ({ time: o.timestampMs, observation: o, reason: null })),
          reasons: new Set(),
        };
        this.phase = 'EXTENDING'; this.resetDwell();
        for (const o of buffer) {
          const match = Math.abs(o.kneeDeg - c.endpointDeg) <= s.endpointToleranceDeg;
          const found = this.confirm('endpoint', match, o.timestampMs, s.endpointDwellMs);
          if (found !== null) { this.enterEndpoint(found); break; }
        }
      }
      return;
    }
    const a = this.active; if (!a) return;
    if (this.phase === 'EXTENDING') {
      const found = this.confirm('endpoint', endpoint, time, s.endpointDwellMs);
      if (found !== null) this.enterEndpoint(found);
      else if (this.confirm('early', resting, time, s.returnDwellMs) !== null) { this.finish(time, ['ENDPOINT_NOT_REACHED']); this.phase = 'REST'; }
      return;
    }
    if (this.phase === 'EXTENSION_ENDPOINT') {
      a.endpointMaximum = Math.max(a.endpointMaximum, observation.kneeDeg);
      const departing = a.endpointMaximum - observation.kneeDeg > s.returnHysteresisDeg;
      const returnStart = this.confirm('departure', departing, time, s.returnDwellMs);
      const restTime = this.confirm('rest', resting, time, s.returnDwellMs);
      if (returnStart !== null) { a.returnStart = returnStart; this.phase = 'RETURN'; }
      if (restTime !== null && a.returnStart !== null) { a.restTime = restTime; a.completion = time; }
      return;
    }
    if (this.phase === 'RETURN') {
      const restTime = this.confirm('rest', resting, time, s.returnDwellMs);
      if (restTime !== null) { a.restTime = restTime; a.completion = time; }
    }
  }

  private enterEndpoint(time: number): void {
    const a = this.active!; a.endpoint = time;
    const past = a.entries.filter((e) => e.time >= time && e.observation).map((e) => e.observation!);
    a.endpointMaximum = Math.max(...past.map((o) => o.kneeDeg));
    this.phase = 'EXTENSION_ENDPOINT'; this.resetDwell();
  }

  private confirm(key: string, condition: boolean, time: number, duration: number): number | null {
    if (!condition) { this.dwell.delete(key); return null; }
    const first = this.dwell.get(key) ?? time; this.dwell.set(key, first); return time - first >= duration ? first : null;
  }
  private resetDwell(): void { this.dwell.clear(); this.onset = []; }
  private reacquire(): void { this.phase = 'REACQUIRE_REST'; this.resetDwell(); this.previous = null; this.lastValid = null; }
  private reject(time: number, reason: KneeExtensionReason): void {
    this.resetDwell(); if (!this.active) return;
    this.active.entries.push({ time, observation: null, reason });
    if (this.phase === 'EXTENDING') this.active.reasons.add('CRITICAL_PEAK_GAP');
    if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); }
  }

  private finish(end: number, extra: KneeExtensionReason[]): void {
    const a = this.active; if (!a) return; this.active = null; this.resetDwell(); this.previous = null;
    const s = this.config.settings, reasons = new Set<KneeExtensionReason>([...a.reasons, ...extra]);
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
    const peakAngle = measurable ? Math.max(...outward.map((o) => o.kneeDeg)) : null;
    const excursion = peakAngle !== null ? peakAngle - this.restAngle : null;
    const values: Record<KneeExtensionMetric, number | null> = {
      peakKneeAngleDeg: peakAngle,
      projectedExtensionExcursionDeg: excursion,
      extensionDurationSec: measurable ? (a.endpoint! - a.start) / 1000 : null,
      returnDurationSec: measurable ? (a.restTime! - a.returnStart!) / 1000 : null,
    };
    const reasonList = [...reasons];
    const explanations = reasonList.map((r) => r === 'ENDPOINT_NOT_REACHED' ? 'Configured knee extension endpoint was not observed.'
      : r === 'RETURN_NOT_OBSERVED' ? 'A sustained return to resting knee position was not observed.'
      : r === 'CRITICAL_PEAK_GAP' ? 'Missing extension-phase observations could conceal the peak or endpoint.'
      : r === 'TRACKING_GAP' ? 'Leg tracking was absent longer than the configured limit.'
      : r === 'INSUFFICIENT_COVERAGE' ? 'Too little of the attempt had valid observations.'
      : r === 'INSUFFICIENT_OBSERVATIONS' ? 'The attempt had too few valid observations.'
      : r === 'DEGENERATE_GEOMETRY' ? 'Projected leg segments were too short or obscured to measure reliably.'
      : r === 'LOW_LANDMARK_QUALITY' ? 'A required leg landmark (hip, knee, or ankle) was missing or unreliable.'
      : r === 'OUT_OF_FRAME' ? 'A required leg landmark was outside the camera frame.'
      : r === 'TIMEOUT' ? 'The attempt exceeded the configured duration limit.'
      : r === 'STOPPED_EARLY' ? 'Capture stopped before the extension attempt was finalized.'
      : r === 'DISCOMFORT_STOP' ? 'Capture stopped after reported discomfort.'
      : r === 'SETUP_CHANGED' ? 'Camera geometry, anatomical side, or seating setup changed.'
      : 'Diagnostic observation buffer exceeded.');

    const metric = (key: KneeExtensionMetric) => ({ value: values[key], unit: kneeExtensionMetricUnits[key], reasons: [...reasonList] });
    const metrics: KneeExtensionAttempt['metrics'] = {
      peakKneeAngleDeg: metric('peakKneeAngleDeg'),
      projectedExtensionExcursionDeg: metric('projectedExtensionExcursionDeg'),
      extensionDurationSec: metric('extensionDurationSec'),
      returnDurationSec: metric('returnDurationSec')
    };

    const flags: KneeExtensionAttempt['flags'] = [];
    if (measurable) {
      for (const criterion of this.config.criteria) {
        const observed = values[criterion.metric]!;
        if (criterion.operator === '>' ? observed > criterion.threshold : observed < criterion.threshold) {
          flags.push({
            ...criterion, observed,
            replay: { startMs: a.start, endMs: end },
            explanation: `${criterion.metric} ${observed} ${kneeExtensionMetricUnits[criterion.metric]} exceeded configured ${criterion.operator} ${criterion.threshold}. Review replay.`,
          });
        }
      }
    }

    this.results.push({
      id: a.id,
      sessionId: this.config.sessionId,
      configurationId: this.config.configurationId,
      analysisVersion: this.config.version,
      exerciseId: 'seated_knee_extension',
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

export function summarizeKneeExtension(attempts: KneeExtensionAttempt[]) {
  const groups = new Set(attempts.map((a) => `${a.mode}/${a.exerciseId}/${a.configurationId}/${a.analysisVersion}`));
  if (groups.size > 1) throw new Error('Cannot summarize incompatible exercise configurations');
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length) throw new Error('Duplicate attempt IDs');
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  const flagged = measurable.filter((a) => a.flags.length > 0).length;
  const median = (key: KneeExtensionMetric): number | null => {
    const values = measurable.flatMap((a) => {
      const value = a.metrics[key].value;
      return value === null ? [] : [value];
    }).sort((a, b) => a - b);
    return values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null;
  };
  const medians = {
    peakKneeAngleDeg: median('peakKneeAngleDeg'),
    projectedExtensionExcursionDeg: median('projectedExtensionExcursionDeg'),
    extensionDurationSec: median('extensionDurationSec'),
    returnDurationSec: median('returnDurationSec')
  };
  return { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged, flagRate: measurable.length ? flagged / measurable.length : null, medians };
}
