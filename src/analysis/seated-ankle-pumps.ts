import { z } from 'zod';
import { circularMedianDegrees } from './circular-statistics.js';
import { type ReachFrame, type Reason, type Interruption } from './reach-contract.js';

const finite = z.number().finite();
const positive = finite.positive();
export const ANKLE_PUMPS_JOINTS = ['knee', 'ankle', 'heel', 'footIndex'] as const;
export type AnklePumpsJoint = typeof ANKLE_PUMPS_JOINTS[number];
export type Point = { x: number; y: number };
export type AnklePose = Record<AnklePumpsJoint, Point>;

export const anklePumpsMetricUnits = {
  orientedAngleDeg: 'degrees',
  signedChangeDeg: 'degrees',
  peakExcursionDeg: 'degrees',
  outwardDurationSec: 'seconds',
  returnDurationSec: 'seconds',
} as const;

export type AnklePumpsMetric = keyof typeof anklePumpsMetricUnits;
export type AnklePumpsReason = Exclude<Reason, 'TARGET_NOT_REACHED'> | 'ENDPOINT_NOT_REACHED' | 'WRONG_DIRECTION' | 'AMBIGUOUS_MOTION' | 'UNRESOLVED_JITTER';

export const anklePumpsConfigSchema = z.strictObject({
  sessionId: z.string().min(1),
  configurationId: z.string().min(1),
  version: z.string().min(1),
  mode: z.enum(['rehabilitation', 'wellness']),
  side: z.enum(['left', 'right']),
  frameWidth: positive.max(16384),
  frameHeight: positive.max(16384),
  orientation: z.string().min(1),
  baseline: z.strictObject({
    knee: z.strictObject({ x: finite, y: finite }),
    ankle: z.strictObject({ x: finite, y: finite }),
    heel: z.strictObject({ x: finite, y: finite }),
    footIndex: z.strictObject({ x: finite, y: finite }),
  }),
  screenForwardSign: z.union([z.literal(-1), z.literal(1)]),
  pumpDirectionSign: z.union([z.literal(-1), z.literal(1)]),
  directionVerified: z.literal(true),
  endpointDeg: finite.min(1).max(90),
  settings: z.strictObject({
    minConfidence: z.strictObject({
      knee: finite.min(0).max(1),
      ankle: finite.min(0).max(1),
      heel: finite.min(0).max(1),
      footIndex: finite.min(0).max(1),
    }),
    minSegmentPx: positive,
    minExcursionThresholdDeg: positive,
    maxAngularStepDeg: positive.lt(180),
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
    metric: z.enum(['orientedAngleDeg', 'signedChangeDeg', 'peakExcursionDeg', 'outwardDurationSec', 'returnDurationSec']),
    operator: z.enum(['<', '>']),
    threshold: finite,
  })),
});

export type AnklePumpsConfig = z.infer<typeof anklePumpsConfigSchema>;

export type AnkleObservation = {
  timestampMs: number;
  raw: AnklePose;
  filtered: AnklePose;
  orientedAngleDeg: number;
  signedChangeDeg: number;
  excursionDeg: number;
};

export type AnklePumpsAttempt = {
  id: string;
  sessionId: string;
  configurationId: string;
  analysisVersion: string;
  exerciseId: 'seated_ankle_pumps';
  mode: AnklePumpsConfig['mode'];
  side: AnklePumpsConfig['side'];
  startMs: number;
  endpointMs: number | null;
  returnStartMs: number | null;
  restMs: number | null;
  endMs: number;
  classification: 'measurable' | 'excluded';
  reasons: AnklePumpsReason[];
  explanations: string[];
  metrics: Record<AnklePumpsMetric, { value: number | null; unit: string; reasons: AnklePumpsReason[] }>;
  quality: { coverage: number; longestGapMs: number; observationCount: number };
  flags: { metric: AnklePumpsMetric; operator: '<' | '>'; threshold: number; observed: number; replay: { startMs: number; endMs: number }; explanation: string }[];
  observations: AnkleObservation[];
  evidence: { status: 'unavailable'; reason: string };
};

type Entry = { time: number; observation: AnkleObservation | null; reason: AnklePumpsReason | null };
type Active = {
  id: string;
  start: number;
  endpoint: number | null;
  returnStart: number | null;
  restTime: number | null;
  completion: number | null;
  endpointMaximum: number;
  entries: Entry[];
  reasons: Set<AnklePumpsReason>;
};

type State = 'REACQUIRE_REST' | 'REST' | 'PUMP_OUT' | 'PUMP_ENDPOINT' | 'RETURN';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180;

export const orientedShankFootAngle = (knee: Point, ankle: Point, foot: Point): number => {
  const ux = knee.x - ankle.x, uy = knee.y - ankle.y;
  const vx = foot.x - ankle.x, vy = foot.y - ankle.y;
  const cross = ux * vy - uy * vx;
  const dot = ux * vx + uy * vy;
  return Math.atan2(cross, dot) * 180 / Math.PI;
};

const validSegments = (p: AnklePose, minimum: number) =>
  dist(p.knee, p.ankle) >= minimum && dist(p.ankle, p.footIndex) >= minimum &&
  dist(p.ankle, p.heel) >= Math.min(minimum, 10) && dist(p.heel, p.footIndex) >= Math.min(minimum, 10);

/** Verifies a small labeled setup motion with all four required foot/shank landmarks. */
export function verifyAnkleSetupDirection(
  motions: AnklePose[],
  baseline: AnklePose,
  screenForwardSign: 1 | -1,
  pumpDirectionSign: 1 | -1,
  minDeg = 3,
): { ok: boolean; maxExcursionDeg: number; explanation: string } {
  const invalid = (explanation: string) => ({ ok: false, maxExcursionDeg: 0, explanation });
  const valid = (pose: AnklePose) => ANKLE_PUMPS_JOINTS.every((key) => {
    const point = pose[key];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }) && validSegments(pose, 2);
  if (![screenForwardSign, pumpDirectionSign].every((sign) => sign === 1 || sign === -1) ||
      !Number.isFinite(minDeg) || minDeg <= 0 || minDeg >= 90 || !motions.length || !valid(baseline) || motions.some((pose) => !valid(pose))) {
    return invalid('Direction verification requires finite, resolved knee, ankle, heel and foot-index evidence.');
  }
  const beta0 = orientedShankFootAngle(baseline.knee, baseline.ankle, baseline.footIndex);
  let previousBeta = beta0, maxExcursion = 0;
  for (const motion of motions) {
    const beta = orientedShankFootAngle(motion.knee, motion.ankle, motion.footIndex);
    if (Math.abs(wrap(beta - previousBeta)) >= 90) return invalid('Setup angle change was too large to resolve the prescribed direction.');
    const excursion = pumpDirectionSign * wrap(screenForwardSign * (beta - beta0));
    if (excursion <= -minDeg) return invalid('Setup motion included a resolved movement opposite to the prescribed direction.');
    maxExcursion = Math.max(maxExcursion, excursion);
    previousBeta = beta;
  }
  if (maxExcursion < minDeg) {
    return { ok: false, maxExcursionDeg: maxExcursion, explanation: `Observed excursion ${maxExcursion}° did not reach required verification minimum of ${minDeg}° in prescribed direction.` };
  }
  return { ok: true, maxExcursionDeg: maxExcursion, explanation: `Direction verified with ${maxExcursion}° setup excursion.` };
}

export class SeatedAnklePumpsAnalyzer {
  private readonly config: AnklePumpsConfig;
  private readonly restBeta: number;
  private phase: State = 'REACQUIRE_REST';
  private clock = -1;
  private lastFrame = -1;
  private barrier = -1;
  private lastValid: number | null = null;
  private previous: AnkleObservation | null = null;
  private dwell = new Map<string, number>();
  private onset: AnkleObservation[] = [];
  private active: Active | null = null;
  private nextId = 1;
  private stopped = false;
  private results: AnklePumpsAttempt[] = [];

  constructor(input: unknown) {
    this.config = anklePumpsConfigSchema.parse(structuredClone(input));
    const c = this.config, s = c.settings;
    const criterionKeys = c.criteria.map((criterion) => `${criterion.metric}/${criterion.operator}/${criterion.threshold}`);
    if (new Set(criterionKeys).size !== criterionKeys.length) throw new Error('Duplicate review criteria');
    if (!validSegments(c.baseline, s.minSegmentPx) || Object.values(c.baseline).some((p) => p.x < 0 || p.y < 0 || p.x > c.frameWidth || p.y > c.frameHeight)) {
      throw new Error('Invalid ankle pumps baseline');
    }
    this.restBeta = orientedShankFootAngle(c.baseline.knee, c.baseline.ankle, c.baseline.footIndex);
    if (c.endpointDeg - s.endpointToleranceDeg <= s.onsetExcursionDeg || s.onsetExcursionDeg <= s.restToleranceDeg ||
        s.returnHysteresisDeg >= c.endpointDeg - s.restToleranceDeg ||
        s.minExcursionThresholdDeg > s.onsetExcursionDeg || s.maxAngularStepDeg <= s.onsetExcursionDeg) {
      throw new Error('Ankle pumps endpoint, rest and onset regions must be distinct');
    }
    if (s.sampleSupportMs > s.maxGapMs || s.filterResetGapMs > s.maxGapMs ||
        [s.readinessMs, s.onsetDwellMs, s.endpointDwellMs, s.returnDwellMs].some((v) => v >= s.timeoutMs)) {
      throw new Error('Invalid ankle pumps timing configuration');
    }
  }

  get state(): State { return this.phase; }
  get configuration(): AnklePumpsConfig { return structuredClone(this.config); }
  drain(): AnklePumpsAttempt[] { const out = this.results; this.results = []; return out; }

  advance(now: number): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    this.clock = now;
    if (this.active?.completion !== null && this.active?.completion !== undefined && now > this.active.completion) {
      this.finish(this.active.completion, []);
      this.phase = 'REST';
    }
    const reasons: AnklePumpsReason[] = [];
    if (this.active && now - this.active.start >= this.config.settings.timeoutMs) reasons.push('TIMEOUT');
    if (this.lastValid !== null && now - this.lastValid > this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
    if (reasons.length) { this.finish(now, reasons); this.barrier = now; this.reacquire(); }
  }

  interrupt(now: number, reason: Interruption): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    // A stop at the completion timestamp wins; a later stop preserves an already completed attempt.
    if (this.active && (this.active.completion === null || now <= this.active.completion)) {
      const reasons: AnklePumpsReason[] = [reason];
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
      if (this.active && this.phase === 'PUMP_OUT') this.active.reasons.add('CRITICAL_PEAK_GAP');
    }

    const raw = structuredClone(c.baseline);
    for (const key of ANKLE_PUMPS_JOINTS) {
      const p = frame.landmarks[key];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.confidence === null || !Number.isFinite(p.confidence) || p.confidence < s.minConfidence[key] || p.confidence > 1) {
        this.reject(time, 'LOW_LANDMARK_QUALITY'); return;
      }
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        this.reject(time, 'OUT_OF_FRAME'); return;
      }
      raw[key] = { x: p.x * frame.width, y: p.y * frame.height };
    }

    if (!validSegments(raw, s.minSegmentPx)) { this.reject(time, 'DEGENERATE_GEOMETRY'); return; }
    // Check raw observations first: smoothing must not hide an ambiguous angular jump.
    {
      const rawBeta = orientedShankFootAngle(raw.knee, raw.ankle, raw.footIndex);
      const previousRaw = this.previous?.raw ?? c.baseline;
      const previousBeta = orientedShankFootAngle(previousRaw.knee, previousRaw.ankle, previousRaw.footIndex);
      if (Math.abs(wrap(rawBeta - previousBeta)) > s.maxAngularStepDeg) {
        if (this.active) this.active.reasons.add('AMBIGUOUS_MOTION');
        this.reject(time, 'AMBIGUOUS_MOTION'); return;
      }
    }
    if (this.previous && time - this.previous.timestampMs > s.filterResetGapMs) this.previous = null;
    const filtered = structuredClone(raw);
    const alpha = !this.previous || s.smoothingTauMs === 0 ? 1 : 1 - Math.exp(-(time - this.previous.timestampMs) / s.smoothingTauMs);
    for (const key of ANKLE_PUMPS_JOINTS) {
      const old = this.previous?.filtered[key] ?? raw[key];
      filtered[key] = { x: old.x + alpha * (raw[key].x - old.x), y: old.y + alpha * (raw[key].y - old.y) };
    }
    if (!validSegments(raw, s.minSegmentPx) || !validSegments(filtered, s.minSegmentPx)) { this.reject(time, 'DEGENERATE_GEOMETRY'); return; }

    const curBeta = orientedShankFootAngle(filtered.knee, filtered.ankle, filtered.footIndex);
    const delta = wrap(c.screenForwardSign * (curBeta - this.restBeta));
    const excursion = c.pumpDirectionSign * delta;


    const observation: AnkleObservation = {
      timestampMs: time,
      raw,
      filtered,
      orientedAngleDeg: curBeta,
      signedChangeDeg: delta,
      excursionDeg: excursion,
    };
    this.previous = observation; this.lastValid = time;
    if (this.active) {
      this.active.entries.push({ time, observation, reason: null });
      if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); return; }
    }

    const resting = Math.abs(excursion) <= s.restToleranceDeg;
    const endpoint = Math.abs(excursion - c.endpointDeg) <= s.endpointToleranceDeg;

    if (this.phase === 'REACQUIRE_REST') {
      if (this.confirm('ready', resting, time, s.readinessMs) !== null) { this.phase = 'REST'; this.resetDwell(); this.previous = null; }
      return;
    }
    if (this.phase === 'REST') {
      // Check for wrong-direction movement
      if (excursion < -s.onsetExcursionDeg) {
        // Opposite motion breaks a pending onset dwell; nonconsecutive samples cannot open an attempt.
        this.resetDwell(); return;
      }
      const pumping = !resting && excursion > s.onsetExcursionDeg;
      if (pumping) this.onset.push(observation); else this.onset = [];
      if (this.onset.length > 10_000) { this.reacquire(); return; }
      const first = this.confirm('onset', pumping, time, s.onsetDwellMs);
      if (first !== null) {
        const buffer = this.onset;
        this.active = {
          id: `${c.sessionId}:ankle:${this.nextId++}`,
          start: first, endpoint: null, returnStart: null, restTime: null, completion: null,
          endpointMaximum: -Infinity,
          entries: buffer.map((o) => ({ time: o.timestampMs, observation: o, reason: null })),
          reasons: new Set(),
        };
        this.phase = 'PUMP_OUT'; this.resetDwell();
        for (const o of buffer) {
          const match = Math.abs(o.excursionDeg - c.endpointDeg) <= s.endpointToleranceDeg;
          const found = this.confirm('endpoint', match, o.timestampMs, s.endpointDwellMs);
          if (found !== null) { this.enterEndpoint(found); break; }
        }
      }
      return;
    }
    const a = this.active; if (!a) return;
    if (this.phase === 'PUMP_OUT') {
      if (excursion < -s.restToleranceDeg) {
        a.reasons.add('WRONG_DIRECTION');
      }
      const found = this.confirm('endpoint', endpoint, time, s.endpointDwellMs);
      if (found !== null) this.enterEndpoint(found);
      else if (this.confirm('early', resting, time, s.returnDwellMs) !== null) {
        this.finish(time, ['ENDPOINT_NOT_REACHED']); this.phase = 'REST';
      }
      return;
    }
    if (this.phase === 'PUMP_ENDPOINT') {
      a.endpointMaximum = Math.max(a.endpointMaximum, observation.excursionDeg);
      const departing = a.endpointMaximum - observation.excursionDeg > s.returnHysteresisDeg;
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
    a.endpointMaximum = Math.max(...past.map((o) => o.excursionDeg));
    this.phase = 'PUMP_ENDPOINT'; this.resetDwell();
  }

  private confirm(key: string, condition: boolean, time: number, duration: number): number | null {
    if (!condition) { this.dwell.delete(key); return null; }
    const first = this.dwell.get(key) ?? time; this.dwell.set(key, first); return time - first >= duration ? first : null;
  }
  private resetDwell(): void { this.dwell.clear(); this.onset = []; }
  private reacquire(): void { this.phase = 'REACQUIRE_REST'; this.resetDwell(); this.previous = null; this.lastValid = null; }
  private reject(time: number, reason: AnklePumpsReason): void {
    this.resetDwell(); if (!this.active) return;
    this.active.entries.push({ time, observation: null, reason });
    if (this.phase === 'PUMP_OUT') this.active.reasons.add('CRITICAL_PEAK_GAP');
    if (this.active.entries.length > 10_000) { this.finish(time, ['BUFFER_LIMIT']); this.reacquire(); }
  }

  private finish(end: number, extra: AnklePumpsReason[]): void {
    const a = this.active; if (!a) return; this.active = null; this.resetDwell(); this.previous = null;
    const s = this.config.settings, reasons = new Set<AnklePumpsReason>([...a.reasons, ...extra]);
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

    const outward = observations.filter((o) => a.endpoint !== null && o.timestampMs <= a.endpoint);
    const peakExcursion = outward.length ? Math.max(...outward.map((o) => o.excursionDeg)) : 0;
    if (peakExcursion < s.minExcursionThresholdDeg) reasons.add('UNRESOLVED_JITTER');

    const measurable = reasons.size === 0;
    const peakObs = outward.find((o) => o.excursionDeg === peakExcursion) ?? outward[0];

    const values: Record<AnklePumpsMetric, number | null> = {
      orientedAngleDeg: measurable && peakObs ? peakObs.orientedAngleDeg : null,
      signedChangeDeg: measurable && peakObs ? peakObs.signedChangeDeg : null,
      peakExcursionDeg: measurable ? peakExcursion : null,
      outwardDurationSec: measurable ? (a.endpoint! - a.start) / 1000 : null,
      returnDurationSec: measurable ? (a.restTime! - a.returnStart!) / 1000 : null,
    };
    const reasonList = [...reasons];
    const explanations = reasonList.map((r) => r === 'ENDPOINT_NOT_REACHED' ? 'Configured ankle pump endpoint was not observed.'
      : r === 'RETURN_NOT_OBSERVED' ? 'A sustained return to resting foot position was not observed.'
      : r === 'WRONG_DIRECTION' ? 'Movement departed in the opposite direction from the prescribed pump direction.'
      : r === 'AMBIGUOUS_MOTION' ? 'Sudden foot segment angle jump made angular unwrapping ambiguous.'
      : r === 'UNRESOLVED_JITTER' ? 'Foot movement remained below the minimum resolution threshold.'
      : r === 'CRITICAL_PEAK_GAP' ? 'Missing outward-phase observations could conceal the pump peak.'
      : r === 'TRACKING_GAP' ? 'Foot or shank tracking was absent longer than the configured limit.'
      : r === 'INSUFFICIENT_COVERAGE' ? 'Too little of the attempt had valid observations.'
      : r === 'INSUFFICIENT_OBSERVATIONS' ? 'The attempt had too few valid observations.'
      : r === 'DEGENERATE_GEOMETRY' ? 'Projected shank, foot, or heel segments were too short to measure reliably.'
      : r === 'LOW_LANDMARK_QUALITY' ? 'A required landmark (knee, ankle, heel, or foot index) was missing or unreliable.'
      : r === 'OUT_OF_FRAME' ? 'A required foot or shank landmark was outside the camera frame.'
      : r === 'TIMEOUT' ? 'The attempt exceeded the configured duration limit.'
      : r === 'STOPPED_EARLY' ? 'Capture stopped before the pump attempt was finalized.'
      : r === 'DISCOMFORT_STOP' ? 'Capture stopped after reported discomfort.'
      : r === 'SETUP_CHANGED' ? 'Camera geometry, anatomical side, or foot support changed.'
      : 'Diagnostic observation buffer exceeded.');

    const metric = (key: AnklePumpsMetric) => ({ value: values[key], unit: anklePumpsMetricUnits[key], reasons: [...reasonList] });
    const metrics: AnklePumpsAttempt['metrics'] = {
      orientedAngleDeg: metric('orientedAngleDeg'),
      signedChangeDeg: metric('signedChangeDeg'),
      peakExcursionDeg: metric('peakExcursionDeg'),
      outwardDurationSec: metric('outwardDurationSec'),
      returnDurationSec: metric('returnDurationSec')
    };

    const flags: AnklePumpsAttempt['flags'] = [];
    if (measurable) {
      for (const criterion of this.config.criteria) {
        const observed = values[criterion.metric]!;
        if (criterion.operator === '>' ? observed > criterion.threshold : observed < criterion.threshold) {
          flags.push({
            ...criterion, observed,
            replay: { startMs: a.start, endMs: end },
            explanation: `${criterion.metric} ${observed} ${anklePumpsMetricUnits[criterion.metric]} exceeded configured ${criterion.operator} ${criterion.threshold}. Review replay.`,
          });
        }
      }
    }

    this.results.push({
      id: a.id,
      sessionId: this.config.sessionId,
      configurationId: this.config.configurationId,
      analysisVersion: this.config.version,
      exerciseId: 'seated_ankle_pumps',
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
      evidence: { status: 'unavailable', reason: 'Ankle pumps automatic measurement is gated until close-view physical iPhone trial demonstrates usable tracking. Manual logging is available.' },
    });
  }
}

export function summarizeAnklePumps(attempts: AnklePumpsAttempt[]) {
  const groups = new Set(attempts.map((a) => `${a.mode}/${a.exerciseId}/${a.configurationId}/${a.analysisVersion}`));
  if (groups.size > 1) throw new Error('Cannot summarize incompatible exercise configurations');
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length) throw new Error('Duplicate attempt IDs');
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  const flagged = measurable.filter((a) => a.flags.length > 0).length;
  const median = (key: AnklePumpsMetric): number | null => {
    const values = measurable.flatMap((a) => {
      const value = a.metrics[key].value;
      return value === null ? [] : [value];
    }).sort((a, b) => a - b);
    return key === 'orientedAngleDeg' ? circularMedianDegrees(values)
      : values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null;
  };
  const medians = {
    orientedAngleDeg: median('orientedAngleDeg'),
    signedChangeDeg: median('signedChangeDeg'),
    peakExcursionDeg: median('peakExcursionDeg'),
    outwardDurationSec: median('outwardDurationSec'),
    returnDurationSec: median('returnDurationSec')
  };
  return { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged, flagRate: measurable.length ? flagged / measurable.length : null, medians };
}
