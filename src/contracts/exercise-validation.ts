import type { RefinementCtx } from 'zod';

type MetricValue = { value: number | null; unit: string; reasons: string[] };
type Criterion = { metric: string; operator: '<' | '>'; threshold: number };
type Flag = Criterion & { observed: number; replay: { startMs: number; endMs: number } };
type FinalizedAttempt = {
  id: string; sessionId: string; configurationId: string; analysisVersion: string;
  side: 'left' | 'right'; mode: 'rehabilitation' | 'wellness';
  startMs: number; endpointMs: number | null; returnStartMs: number | null; restMs: number | null; endMs: number;
  classification: 'measurable' | 'excluded'; reasons: string[]; explanations: string[];
  metrics: Record<string, MetricValue>; flags: Flag[];
};

/** Shared factual invariants, independent of each exercise's metric identifiers and geometry. */
export function validateExerciseAttempt(attempt: FinalizedAttempt, units: Record<string, string>, ctx: RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (attempt.endMs < attempt.startMs) issue('Attempt ends before it starts');
  if (attempt.endpointMs !== null && (attempt.endpointMs < attempt.startMs || attempt.endpointMs > attempt.endMs)) issue('Endpoint outside attempt');
  if (attempt.returnStartMs !== null && (attempt.endpointMs === null || attempt.returnStartMs < attempt.endpointMs || attempt.returnStartMs > attempt.endMs)) issue('Return start outside endpoint-to-end interval');
  if (attempt.restMs !== null && (attempt.returnStartMs === null || attempt.restMs < attempt.returnStartMs || attempt.restMs > attempt.endMs)) issue('Rest event outside return interval');
  if (new Set(attempt.reasons).size !== attempt.reasons.length) issue('Duplicate exclusion reasons');
  if (attempt.explanations.length !== attempt.reasons.length) issue('Each exclusion reason needs an explanation');
  if (attempt.classification === 'measurable' && (attempt.reasons.length || attempt.endpointMs === null || attempt.returnStartMs === null || attempt.restMs === null)) issue('Measurable attempt needs endpoint, return and no exclusion reasons');
  if (attempt.classification === 'excluded' && (!attempt.reasons.length || attempt.flags.length)) issue('Excluded attempt needs reasons and no flags');
  for (const [name, unit] of Object.entries(units)) {
    const metric = attempt.metrics[name];
    if (!metric) { issue(`Missing metric ${name}`); continue; }
    if (metric.unit !== unit) issue(`${name} has the wrong unit`);
    if ((metric.value === null) !== (metric.reasons.length > 0)) issue(`${name}: null values need reasons and measured values none`);
    if (attempt.classification === 'measurable' ? metric.value === null : metric.value !== null) issue(`${name} disagrees with classification`);
    if (metric.reasons.some((reason) => !attempt.reasons.includes(reason))) issue(`${name} contains a reason absent from the attempt`);
  }
  if (attempt.classification === 'measurable' && attempt.endpointMs !== null && attempt.returnStartMs !== null && attempt.restMs !== null) {
    for (const [name, metric] of Object.entries(attempt.metrics)) {
      if (!name.endsWith('DurationSec')) continue;
      const expected = name === 'returnDurationSec' ? (attempt.restMs - attempt.returnStartMs) / 1000 : (attempt.endpointMs - attempt.startMs) / 1000;
      if (metric.value === null || Math.abs(metric.value - expected) > 1e-9) issue(`${name} disagrees with accepted first event times`);
    }
  }
  const flagKeys = new Set<string>();
  for (const flag of attempt.flags) {
    const key = `${flag.metric}:${flag.operator}:${flag.threshold}`;
    if (flagKeys.has(key)) issue('Duplicate criterion flag');
    flagKeys.add(key);
    if (attempt.metrics[flag.metric]?.value !== flag.observed) issue(`Flag ${flag.metric} does not match its measured value`);
    if (!(flag.operator === '>' ? flag.observed > flag.threshold : flag.observed < flag.threshold)) issue(`Flag ${flag.metric} is not a strict exceedance`);
    if (flag.replay.startMs < attempt.startMs || flag.replay.endMs > attempt.endMs || flag.replay.endMs < flag.replay.startMs) issue('Flag replay outside attempt');
  }
}

type FinalizedSession = {
  sessionId: string; mode: 'rehabilitation' | 'wellness'; createdAt: string; endedAt: string;
  configuration: { sessionId: string; configurationId: string; version: string; mode: 'rehabilitation' | 'wellness'; side: 'left' | 'right'; criteria: Criterion[] };
  capture: { stopReason: string; stoppedAtMs: number | null };
  discomfort: { response: string; reportedDuringCaptureAtMs: number | null };
  attempts: FinalizedAttempt[];
};

/** Saved flags must be exactly the strict comparisons configured for that immutable session. */
export function validateExerciseSession(session: FinalizedSession, ctx: RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const config = session.configuration;
  if (config.sessionId !== session.sessionId || config.mode !== session.mode) issue('Configuration does not belong to session');
  if (Date.parse(session.endedAt) < Date.parse(session.createdAt)) issue('Session ends before it starts');
  if (session.capture.stopReason === 'DISCOMFORT_STOP' && (session.discomfort.response !== 'yes' || session.discomfort.reportedDuringCaptureAtMs === null)) issue('Discomfort stop requires report');
  if (session.discomfort.reportedDuringCaptureAtMs !== null && session.capture.stoppedAtMs !== null && session.discomfort.reportedDuringCaptureAtMs > session.capture.stoppedAtMs) issue('Discomfort report occurs after stop');
  const ids = new Set<string>();
  let previousEnd = -1;
  for (const attempt of session.attempts) {
    if (ids.has(attempt.id)) issue('Duplicate attempt');
    ids.add(attempt.id);
    if (attempt.sessionId !== session.sessionId || attempt.configurationId !== config.configurationId || attempt.analysisVersion !== config.version || attempt.side !== config.side || attempt.mode !== session.mode) issue('Attempt belongs to another configuration');
    if (attempt.startMs < previousEnd) issue('Attempts must be ordered without overlap');
    previousEnd = attempt.endMs;
    if (session.capture.stoppedAtMs !== null && attempt.endMs > session.capture.stoppedAtMs) issue('Attempt ends after capture stopped');
    for (const flag of attempt.flags) {
      if (!config.criteria.some((criterion) => criterion.metric === flag.metric && criterion.operator === flag.operator && criterion.threshold === flag.threshold)) issue('Flag references an unconfigured criterion');
    }
    if (attempt.classification === 'measurable') {
      for (const criterion of config.criteria) {
        const value = attempt.metrics[criterion.metric]?.value;
        if (value === null || value === undefined) { issue('Configured criterion has no measured value'); continue; }
        const exceeded = criterion.operator === '>' ? value > criterion.threshold : value < criterion.threshold;
        const flagged = attempt.flags.some((flag) => flag.metric === criterion.metric && flag.operator === criterion.operator && flag.threshold === criterion.threshold);
        if (exceeded !== flagged) issue('Flags disagree with configured criteria');
      }
    }
  }
}
