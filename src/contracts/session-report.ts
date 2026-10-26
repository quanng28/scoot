import { z } from 'zod';
import { EXERCISE_METRIC_MAP, type MetricDefinition } from './exercise-metrics.js';
import { parseReviewRecord, type ReviewRecord } from './review-session.js';

export const REPORT_INPUT_VERSION = 'seated-session-facts.v1';
export const METRIC_DEFINITION_VERSION = 'seated-metrics.v1';
export const exerciseIdSchema = z.enum(['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps']);
const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const id = z.string().min(1).max(200);
const reasons = z.array(z.enum(['LOW_LANDMARK_QUALITY', 'OUT_OF_FRAME', 'DEGENERATE_GEOMETRY', 'TRACKING_GAP', 'CRITICAL_PEAK_GAP',
  'INSUFFICIENT_COVERAGE', 'INSUFFICIENT_OBSERVATIONS', 'TARGET_NOT_REACHED', 'ENDPOINT_NOT_REACHED', 'RETURN_NOT_OBSERVED',
  'TIMEOUT', 'STOPPED_EARLY', 'DISCOMFORT_STOP', 'SETUP_CHANGED', 'BUFFER_LIMIT', 'WRONG_DIRECTION', 'AMBIGUOUS_MOTION', 'UNRESOLVED_JITTER'])).max(30);
const criterion = z.strictObject({ metric: id, operator: z.enum(['<', '>']), threshold: finite });
const metricDefinition = z.strictObject({ id, label: z.string().min(1), unit: z.enum(['degrees', 'seconds', 'reference_lengths']),
  definitionVersion: z.literal(METRIC_DEFINITION_VERSION), definition: z.string().min(1), window: z.enum(['outward', 'return', 'at_peak_excursion']) });
const metricValue = z.strictObject({ id, value: finite.nullable(), unit: metricDefinition.shape.unit, reasons });
const attempt = z.strictObject({
  id, classification: z.enum(['measurable', 'excluded']), reasons,
  startMs: nonNegative, endpointMs: nonNegative.nullable(), returnStartMs: nonNegative.nullable(), restMs: nonNegative.nullable(), endMs: nonNegative,
  metrics: z.array(metricValue).min(1).max(8),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: z.number().int().nonnegative() }),
  flags: z.array(criterion.extend({ observed: finite, finalizedAtMs: nonNegative, replay: z.strictObject({ startMs: nonNegative, endMs: nonNegative }) })).max(30),
});

/** Engineering definitions, not clinical ROM or muscle-action claims. */
const definitions: Record<string, string> = {
  elbowPeakDeg: 'Maximum projected shoulder-elbow-wrist angle from onset through first target entry.',
  torsoForwardPeakDeg: 'Maximum positive signed baseline-relative shoulder-hip inclination change; a 2D proxy.',
  wristForwardPeak: 'Maximum wrist displacement projected along the fixed rest-to-target direction, divided by the fixed image reference length.',
  reachDurationSec: 'First target entry minus first sustained onset, divided by 1000; target hold excluded.',
  minElbowDeg: 'Minimum projected shoulder-elbow-wrist angle from onset through first bend endpoint entry.',
  bendExcursionDeg: 'Resting projected elbow angle minus the minimum outward elbow angle.',
  bendDurationSec: 'First bend endpoint entry minus first sustained onset, divided by 1000.',
  peakUpperArmAngleDeg: 'Maximum projected elbow-shoulder-hip angle, with the shoulder as vertex, during the outward interval.',
  peakWristElevation: 'Maximum upward wrist displacement from its fixed baseline divided by the fixed image reference length.',
  raiseDurationSec: 'First raise endpoint entry minus first sustained onset, divided by 1000.',
  peakKneeAngleDeg: 'Maximum projected hip-knee-ankle angle during the outward interval.',
  projectedExtensionExcursionDeg: 'Maximum outward projected knee angle minus the fixed resting knee angle.',
  extensionDurationSec: 'First extension endpoint entry minus first sustained onset, divided by 1000.',
  peakKneeElevation: 'Maximum upward knee displacement from its fixed baseline divided by the fixed image reference length.',
  liftDurationSec: 'First lift endpoint entry minus first sustained onset, divided by 1000.',
  orientedAngleDeg: 'atan2(cross(knee-ankle, foot-index-ankle), dot(knee-ankle, foot-index-ankle)) in degrees, at peak prescribed excursion.',
  signedChangeDeg: 'Wrapped signed change from the resting oriented shank-foot angle, normalized to fixed screen-forward direction, at peak prescribed excursion.',
  peakExcursionDeg: 'Maximum positive prescribed-direction signed wrapped shank-foot excursion during the outward interval.',
  outwardDurationSec: 'First pump endpoint entry minus first sustained onset, divided by 1000.',
  returnDurationSec: 'First resting entry minus first sustained departure from endpoint, divided by 1000; endpoint hold excluded.',
};

function expectedDefinitions(exerciseId: ReviewRecord['exercise']['id']) {
  const table: Readonly<Record<string, MetricDefinition>> = EXERCISE_METRIC_MAP[exerciseId];
  return Object.entries(table).map(([key, info]) => ({ id: key, label: info.label, unit: info.unit,
    definitionVersion: METRIC_DEFINITION_VERSION,
    definition: definitions[key] ?? (() => { throw new Error(`Missing definition: ${key}`); })(),
    window: key === 'returnDurationSec' ? 'return' as const : key === 'orientedAngleDeg' || key === 'signedChangeDeg' ? 'at_peak_excursion' as const : 'outward' as const }));
}

/** Strict, independently revalidated DTO. No raw configuration, landmarks, labels, notes, video or URLs. */
export const sessionReportInputSchema = z.strictObject({
  schemaVersion: z.literal(REPORT_INPUT_VERSION), sessionId: id, configurationId: id,
  sourceSchemaVersion: id, analysisVersion: id, createdAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  provenance: z.enum(['developer_validation_capture', 'labeled_synthetic_fixture']),
  exercise: z.strictObject({ id: exerciseIdSchema, definitionVersion: id, catalogSchemaVersion: id }),
  mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  metricDefinitions: z.array(metricDefinition).min(1).max(8),
  counts: z.strictObject({ detected: z.number().int().nonnegative(), measurable: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), flagged: z.number().int().nonnegative() }),
  configuredCriteria: z.array(criterion).max(30),
  qualityPolicy: z.strictObject({ minCoverage: finite.min(0).max(1), maxGapMs: nonNegative, sampleSupportMs: nonNegative, minObservations: z.number().int().nonnegative() }),
  attempts: z.array(attempt).max(500),
  limitations: z.tuple([z.literal('Projected image-plane engineering estimates; not clinically validated.'), z.literal('Physical-device capture-to-video timing remains unverified.')]),
}).superRefine((facts, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (Date.parse(facts.endedAt) < Date.parse(facts.createdAt)) issue('Invalid session time order');
  const expected = expectedDefinitions(facts.exercise.id);
  const versions = { seated_forward_reach: 'reach-session.consumer-v1', seated_elbow_flexion_extension: 'elbow-session.consumer-v1',
    seated_forward_arm_raise: 'arm-raise-session.consumer-v2', seated_knee_extension: 'knee-extension-session.consumer-v2',
    seated_single_leg_lift: 'leg-lift-session.consumer-v2', seated_ankle_pumps: 'ankle-pumps-session.consumer-v2' };
  if (facts.sourceSchemaVersion !== versions[facts.exercise.id]) issue('Source schema does not belong to this exercise');
  if (JSON.stringify(facts.metricDefinitions) !== JSON.stringify(expected)) issue('Metric definitions must match the versioned exercise allowlist');
  const keys = new Set(expected.map((m) => m.id));
  const units = new Map(expected.map((m) => [m.id, m.unit]));
  if (facts.configuredCriteria.some((c) => !keys.has(c.metric))) issue('Unsupported criterion');
  const ids = new Set<string>();
  let previousEnd = -1;
  for (const a of facts.attempts) {
    if (ids.has(a.id)) issue('Duplicate attempt ID');
    ids.add(a.id);
    if (a.startMs < previousEnd || a.endMs < a.startMs) issue('Attempt time order invalid');
    previousEnd = a.endMs;
    if (a.endpointMs !== null && (a.endpointMs < a.startMs || a.endpointMs > a.endMs)) issue('Endpoint outside attempt');
    if (a.returnStartMs !== null && (a.endpointMs === null || a.returnStartMs < a.endpointMs || a.returnStartMs > a.endMs)) issue('Return time outside attempt');
    if (a.restMs !== null && (a.returnStartMs === null || a.restMs < a.returnStartMs || a.restMs > a.endMs)) issue('Rest time outside return interval');
    if (a.metrics.length !== keys.size || new Set(a.metrics.map((m) => m.id)).size !== keys.size) issue('Missing or duplicate metrics');
    const measurable = a.classification === 'measurable';
    const needsRest = facts.sourceSchemaVersion.endsWith('consumer-v2');
    if (measurable && needsRest && (a.returnStartMs === null || a.restMs === null)) issue('Measurable return requires first event times');
    if (measurable ? a.reasons.length > 0 || a.endpointMs === null : a.reasons.length === 0 || a.flags.length > 0) issue('Classification disagrees with phases/reasons/flags');
    for (const m of a.metrics) {
      if (!keys.has(m.id) || m.unit !== units.get(m.id)) issue('Metric does not belong to exercise');
      if (measurable ? m.value === null || m.reasons.length > 0 : m.value !== null || m.reasons.length === 0) issue('Metric disagrees with classification');
      if (m.reasons.some((reason) => !a.reasons.includes(reason))) issue('Metric reasons disagree with attempt');
      if (measurable && needsRest && m.id.endsWith('DurationSec')) {
        const expectedDuration = m.id === 'returnDurationSec' && a.restMs !== null && a.returnStartMs !== null ? (a.restMs - a.returnStartMs) / 1000
          : a.endpointMs !== null ? (a.endpointMs - a.startMs) / 1000 : null;
        if (m.value === null || expectedDuration === null || Math.abs(m.value - expectedDuration) > 1e-9) issue('Duration disagrees with accepted first event times');
      }
    }
    for (const f of a.flags) {
      if (!facts.configuredCriteria.some((c) => c.metric === f.metric && c.operator === f.operator && c.threshold === f.threshold)) issue('Unconfigured flag');
      if (f.observed !== a.metrics.find((m) => m.id === f.metric)?.value || !(f.operator === '>' ? f.observed > f.threshold : f.observed < f.threshold)) issue('Flag is not a measured strict exceedance');
      if (f.replay.startMs < a.startMs || f.replay.endMs > a.endMs || f.replay.endMs < f.replay.startMs || f.finalizedAtMs !== a.endMs) issue('Flag time outside attempt');
    }
    if (measurable) for (const c of facts.configuredCriteria) {
      const value = a.metrics.find((m) => m.id === c.metric)?.value;
      const exceeded = value !== undefined && value !== null && (c.operator === '>' ? value > c.threshold : value < c.threshold);
      if (exceeded !== a.flags.some((f) => f.metric === c.metric && f.operator === c.operator && f.threshold === c.threshold)) issue('Missing configured flag');
    }
  }
  const measurable = facts.attempts.filter((a) => a.classification === 'measurable');
  if (facts.counts.detected !== facts.attempts.length || facts.counts.measurable !== measurable.length ||
    facts.counts.excluded !== facts.attempts.length - measurable.length || facts.counts.flagged !== measurable.filter((a) => a.flags.length > 0).length) issue('Counts disagree with finalized attempts');
});
export type SessionReportInput = z.infer<typeof sessionReportInputSchema>;

/** Call only after capture finalizes. The builder revalidates, clones and selects each allowed fact. */
export function buildSessionReportInput(input: ReviewRecord): SessionReportInput {
  const record = parseReviewRecord(input);
  const attempts = record.attempts.map((a) => ({
    id: a.id, classification: a.classification, reasons: [...a.reasons], startMs: a.startMs,
    endpointMs: 'targetMs' in a ? a.targetMs : a.endpointMs,
    returnStartMs: 'returnStartMs' in a ? a.returnStartMs : null, restMs: 'restMs' in a ? a.restMs : null, endMs: a.endMs,
    metrics: Object.entries(a.metrics).map(([key, m]) => ({ id: key, value: m.value,
      unit: m.unit === 'reference lengths' ? 'reference_lengths' : m.unit, reasons: [...m.reasons] })),
    quality: { ...a.quality }, flags: a.flags.map((f) => ({ metric: f.metric, operator: f.operator, threshold: f.threshold,
      observed: f.observed, finalizedAtMs: a.endMs, replay: { ...f.replay } })),
  }));
  const measurable = attempts.filter((a) => a.classification === 'measurable');
  return sessionReportInputSchema.parse({
    schemaVersion: REPORT_INPUT_VERSION, sessionId: record.sessionId, configurationId: record.configuration.configurationId,
    sourceSchemaVersion: record.schemaVersion, analysisVersion: record.configuration.version, createdAt: record.createdAt, endedAt: record.endedAt,
    provenance: record.provenance.kind, exercise: { ...record.exercise }, mode: record.mode, side: record.configuration.side,
    metricDefinitions: expectedDefinitions(record.exercise.id),
    counts: { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged: measurable.filter((a) => a.flags.length > 0).length },
    configuredCriteria: record.configuration.criteria.map((c) => ({ ...c })),
    qualityPolicy: { minCoverage: record.configuration.settings.minCoverage, maxGapMs: record.configuration.settings.maxGapMs,
      sampleSupportMs: record.configuration.settings.sampleSupportMs, minObservations: record.configuration.settings.minObservations },
    attempts, limitations: ['Projected image-plane engineering estimates; not clinically validated.', 'Physical-device capture-to-video timing remains unverified.'],
  });
}

/** Chart consumers receive only source-linked values; null/excluded points stay gaps, never zeroes. */
export function buildSessionMetricSeries(input: SessionReportInput) {
  const facts = sessionReportInputSchema.parse(input);
  return facts.metricDefinitions.map((definition) => ({
    group: { exerciseId: facts.exercise.id, mode: facts.mode, configurationId: facts.configurationId, analysisVersion: facts.analysisVersion },
    definition, thresholds: facts.configuredCriteria.filter((criterion) => criterion.metric === definition.id),
    points: facts.attempts.map((attempt, index) => {
      const metric = attempt.metrics.find((value) => value.id === definition.id);
      if (!metric) throw new Error('Validated source metric is missing');
      return { attemptId: attempt.id, repetition: index + 1, classification: attempt.classification,
        startMs: attempt.startMs, endpointMs: attempt.endpointMs, endMs: attempt.endMs,
        value: metric.value, reasons: [...metric.reasons] };
    }),
  }));
}
