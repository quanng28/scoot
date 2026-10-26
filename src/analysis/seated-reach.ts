import { reachConfigSchema, metricUnits, reasonText, type ReachConfig, type ReachFrame, type ReachState, type ReachAttempt, type Observation, type Reason, type Interruption, type Metric } from './reach-contract.js';
import { validateReachCalibration, pixelObservation, measureReach } from './reach-geometry.js';

type Entry = { time: number; observation: Observation | null; reason: Reason | null };
type Active = { id: string; start: number; target: number | null; entries: Entry[]; reasons: Set<Reason>; targetMaximum: number; completion: number | null };
/** Deterministic SR01 engine. Host supplies recording-relative frames and calls
 * advance(now) independently of inference (including after background resume).
 * Completion is committed only once time moves past its confirmation timestamp,
 * allowing a same-timestamp stop/discomfort event to take precedence.
 */
export class SeatedReachAnalyzer {
  private readonly config: ReachConfig;
  private phase: ReachState = 'REACQUIRE_REST';
  private clock = -1;
  private lastFrame = -1;
  private rejectedThrough = -1;
  private lastValid: number | null = null;
  private filtered: Observation | null = null;
  private active: Active | null = null;
  private onset: Observation[] = [];
  private dwell = new Map<string, number>();
  private nextId = 1;
  private stopped = false;
  private emitted: ReachAttempt[] = [];

  constructor(input: unknown) {
    this.config = reachConfigSchema.parse(structuredClone(input));
    validateReachCalibration(this.config);
  }
  get state(): ReachState { return this.phase; }
  get configuration(): ReachConfig { return structuredClone(this.config); }
  /** Destructive queue read, never returns the same finalized attempt twice. */
  drain(): ReachAttempt[] { const out = this.emitted; this.emitted = []; return out; }

  advance(now: number): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    this.clock = now;
    if (this.active?.completion !== null && this.active?.completion !== undefined && now > this.active.completion) {
      this.finalize(this.active.completion, []); this.phase = 'REST';
    }
    const reasons: Reason[] = [];
    if (this.active && now - this.active.start >= this.config.settings.timeoutMs) reasons.push('TIMEOUT');
    if (this.lastValid !== null && now - this.lastValid > this.config.settings.maxGapMs) reasons.push('TRACKING_GAP');
    if (reasons.length) {
      if (this.active) this.finalize(now, reasons);
      this.rejectedThrough = now;
      this.reacquire();
    }
  }

  interrupt(now: number, reason: Interruption): void {
    if (this.stopped || !Number.isFinite(now) || now < 0 || now < this.clock) return;
    // Do not commit a pending completion at this same timestamp.
    this.advance(now);
    if (this.active) this.finalize(now, [reason]);
    this.reacquire(); this.stopped = true;
  }

  accept(frame: ReachFrame): void {
    const time = frame.timestampMs;
    if (this.stopped || !Number.isFinite(time) || time < 0 || time <= this.lastFrame || time <= this.rejectedThrough) return;
    this.advance(Math.max(time, this.clock));
    if (time < this.rejectedThrough) return;
    this.lastFrame = time;
    if (frame.width !== this.config.frameWidth || frame.height !== this.config.frameHeight || frame.orientation !== this.config.orientation || frame.side !== this.config.side) {
      this.interrupt(Math.max(time, this.clock), 'SETUP_CHANGED'); return;
    }
    if (this.active?.completion !== null && this.active?.completion !== undefined) return;
    const s = this.config.settings;
    const gap = this.lastValid !== null && time - this.lastValid > s.sampleSupportMs;
    if (gap) {
      this.resetDwell();
      if (this.active && this.phase === 'OUTWARD') this.active.reasons.add('CRITICAL_PEAK_GAP');
    }
    const pixels = pixelObservation(frame, this.config);
    if (pixels.reason) { this.reject(time, pixels.reason); return; }
    if (this.filtered && time - this.filtered.timestampMs > s.filterResetGapMs) this.filtered = null;
    const observation = measureReach(pixels.pose, this.filtered, time, this.config);
    if (!observation) { this.reject(time, 'DEGENERATE_GEOMETRY'); return; }
    this.filtered = observation; this.lastValid = time;
    if (this.active) {
      this.active.entries.push({ time, observation, reason: null });
      if (this.active.entries.length > 10_000) { this.finalize(time, ['BUFFER_LIMIT']); this.reacquire(); return; }
    }
    const resting = observation.restDistance <= s.restRadius;
    if (this.phase === 'REACQUIRE_REST') {
      if (this.confirm('ready', resting, time, s.readinessMs) !== null) { this.phase = 'REST'; this.resetDwell(); this.filtered = null; }
      return;
    }
    if (this.phase === 'REST') {
      const departing = !resting && observation.forward > s.onsetDistance;
      if (!departing) this.onset = []; else this.onset.push(observation);
      if (this.onset.length > 10_000) { this.reacquire(); return; }
      const first = this.confirm('onset', departing, time, s.onsetDwellMs);
      if (first !== null) {
        const onsetSamples = this.onset;
        this.active = { id: `${this.config.sessionId}:reach:${this.nextId++}`, start: first, target: null,
          entries: onsetSamples.map((o) => ({ time: o.timestampMs, observation: o, reason: null })), reasons: new Set(), targetMaximum: -Infinity, completion: null };
        this.phase = 'OUTWARD'; this.resetDwell();
        // Preserve a target dwell that began during onset confirmation.
        for (const sample of onsetSamples) {
          const target = this.confirm('target', sample.targetDistance <= s.targetRadius, sample.timestampMs, s.targetDwellMs);
          if (target !== null) {
            this.active.target = target; this.phase = 'TARGET';
            this.active.targetMaximum = Math.max(...onsetSamples.filter((o) => o.timestampMs >= target).map((o) => o.forward));
            this.resetDwell(); break;
          }
        }
      }
      return;
    }
    const active = this.active;
    if (!active) return;
    if (this.phase === 'OUTWARD') {
      const target = this.confirm('target', observation.targetDistance <= s.targetRadius, time, s.targetDwellMs);
      if (target !== null) { active.target = target; active.targetMaximum = Math.max(...active.entries.filter((e) => e.time >= target && e.observation).map((e) => e.observation!.forward)); this.phase = 'TARGET'; this.resetDwell(); }
      else if (this.confirm('early-return', resting, time, s.returnDwellMs) !== null) { this.finalize(time, ['TARGET_NOT_REACHED']); this.phase = 'REST'; }
      return;
    }
    if (this.phase === 'TARGET') {
      active.targetMaximum = Math.max(active.targetMaximum, observation.forward);
      const returned = this.confirm('rest', resting, time, s.returnDwellMs);
      const departing = this.confirm('return', active.targetMaximum - observation.forward > s.returnHysteresis, time, s.returnDwellMs);
      if (returned !== null) { active.completion = time; return; }
      if (departing !== null) this.phase = 'RETURN';
      return;
    }
    if (this.phase === 'RETURN' && this.confirm('rest', resting, time, s.returnDwellMs) !== null) active.completion = time;
  }

  private confirm(key: string, condition: boolean, time: number, dwellMs: number): number | null {
    if (!condition) { this.dwell.delete(key); return null; }
    const first = this.dwell.get(key) ?? time; this.dwell.set(key, first);
    return time - first >= dwellMs ? first : null;
  }
  private resetDwell(): void { this.dwell.clear(); this.onset = []; }
  private reacquire(): void { this.phase = 'REACQUIRE_REST'; this.resetDwell(); this.filtered = null; this.lastValid = null; }
  private reject(time: number, reason: Reason): void {
    this.resetDwell();
    if (this.active) {
      this.active.entries.push({ time, observation: null, reason });
      if (this.phase === 'OUTWARD') this.active.reasons.add('CRITICAL_PEAK_GAP');
      if (this.active.entries.length > 10_000) { this.finalize(time, ['BUFFER_LIMIT']); this.reacquire(); }
    }
  }
  private finalize(end: number, extra: Reason[]): void {
    const active = this.active;
    if (!active) return;
    this.active = null; this.resetDwell(); this.filtered = null;
    const s = this.config.settings, reasons = new Set<Reason>([...active.reasons, ...extra]);
    if (active.target === null) reasons.add('TARGET_NOT_REACHED');
    if (active.completion === null && !extra.includes('TARGET_NOT_REACHED')) reasons.add('RETURN_NOT_OBSERVED');
    let cursor = active.start, support = 0, longestGapMs = 0;
    for (const [index, entry] of active.entries.entries()) {
      if (!entry.observation) continue;
      const until = Math.min(end, entry.time + s.sampleSupportMs, active.entries[index + 1]?.time ?? end);
      longestGapMs = Math.max(longestGapMs, entry.time - cursor);
      support += Math.max(0, until - entry.time); cursor = Math.max(cursor, until);
    }
    longestGapMs = Math.max(longestGapMs, end - cursor);
    const observations = active.entries.flatMap((e) => e.observation ? [e.observation] : []);
    const coverage = end > active.start ? support / (end - active.start) : 0;
    if (coverage < s.minCoverage) reasons.add('INSUFFICIENT_COVERAGE');
    if (longestGapMs > s.maxGapMs) reasons.add('TRACKING_GAP');
    if (observations.length < s.minObservations) reasons.add('INSUFFICIENT_OBSERVATIONS');
    if (reasons.size) for (const entry of active.entries) if (entry.reason) reasons.add(entry.reason);
    const outward = observations.filter((o) => active.target !== null && o.timestampMs <= active.target);
    const measurable = reasons.size === 0;
    const values: Record<Metric, number | null> = {
      elbowPeakDeg: measurable ? Math.max(...outward.map((o) => o.elbowDeg)) : null,
      torsoForwardPeakDeg: measurable ? Math.max(0, ...outward.map((o) => o.torsoDeltaDeg)) : null,
      wristForwardPeak: measurable ? Math.max(...outward.map((o) => o.forward)) : null,
      reachDurationSec: measurable ? (active.target! - active.start) / 1000 : null,
    };
    const reasonList = [...reasons];
    const metrics = Object.fromEntries((Object.keys(metricUnits) as Metric[]).map((key) => [key, { value: values[key], unit: metricUnits[key], reasons: [...reasonList] }])) as ReachAttempt['metrics'];
    const flags: ReachAttempt['flags'] = [];
    if (measurable) for (const criterion of this.config.criteria) {
      const observed = values[criterion.metric]!;
      if (criterion.operator === '>' ? observed > criterion.threshold : observed < criterion.threshold) flags.push({ ...criterion, observed,
        replay: { startMs: active.start, endMs: end }, explanation: `${criterion.metric} ${observed} ${metricUnits[criterion.metric]} exceeded configured ${criterion.operator} ${criterion.threshold}. Review replay.` });
    }
    this.emitted.push({ id: active.id, sessionId: this.config.sessionId, configurationId: this.config.configurationId, analysisVersion: this.config.version,
      exerciseId: 'seated_forward_reach', mode: this.config.mode, side: this.config.side, startMs: active.start, targetMs: active.target, endMs: end,
      classification: measurable ? 'measurable' : 'excluded', reasons: reasonList, explanations: reasonList.map((reason) => reasonText[reason]), metrics, flags,
      quality: { coverage, longestGapMs, observationCount: observations.length }, observations,
      evidence: { status: 'unavailable', reason: 'Recording linkage and timing verification must be supplied by capture integration.' } });
  }
}

/** Caller groups by mode/exercise/configuration; mixing them is rejected. */
export function summarizeReach(attempts: ReachAttempt[]) {
  const groups = new Set(attempts.map((a) => `${a.mode}/${a.exerciseId}/${a.configurationId}/${a.analysisVersion}`));
  if (groups.size > 1) throw new Error('Cannot summarize incompatible reach configurations');
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length) throw new Error('Duplicate attempt IDs');
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  const flagged = measurable.filter((a) => a.flags.length > 0).length;
  const medians = Object.fromEntries((Object.keys(metricUnits) as Metric[]).map((key) => {
    const values = measurable.flatMap((a) => a.metrics[key].value === null ? [] : [a.metrics[key].value!]).sort((a, b) => a - b);
    return [key, values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null];
  }));
  return { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged, flagRate: measurable.length ? flagged / measurable.length : null, medians };
}
