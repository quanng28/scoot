import { z } from 'zod';
import { pipelineMetricsSchema } from './report-pipeline.js';
import { reasonText, type Reason } from '../analysis/reach-contract.js';
import { STOP_REASONS } from './reach-session.js';
import { EXERCISE_METRIC_MAP } from './exercise-metrics.js';

/**
 * Report contracts (PRD FR-16–FR-19, checklist F1–F4). The input is a separate allowlisted DTO built from
 * finalized validated facts; the model output is a bounded structure whose every claim must trace back to
 * that input. Numbers shown to the user always come from the record, not from generated prose.
 *
 * Excluded by construction: video/URL, landmarks/observations, session/configuration IDs, participant/task/
 * supervisor labels, attestation, setup free text, notes, discomfort note, and any non-synthetic context.
 */
export const REPORT_INPUT_VERSION = 'session-report-input.v1';
export const GENERATED_REPORT_VERSION = 'session-report-output.v1';
export const ACCEPTED_REPORT_VERSION = 'accepted-report.v1';
export const EXPERIMENTAL_LABEL = 'Experimental explanation · not a clinical assessment' as const;
/** Request/response byte bounds enforced on both client and server. */
export const REPORT_REQUEST_BYTES = 48_000;
export const REPORT_RESPONSE_BYTES = 32_000;

export const REPORT_EXERCISES = ['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise',
  'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'] as const;
export const REPORT_METRICS = ['elbowPeakDeg', 'torsoForwardPeakDeg', 'wristForwardPeak', 'reachDurationSec',
  'minElbowDeg', 'bendExcursionDeg', 'bendDurationSec', 'returnDurationSec',
  'peakUpperArmAngleDeg', 'peakWristElevation', 'raiseDurationSec', 'peakKneeAngleDeg',
  'projectedExtensionExcursionDeg', 'extensionDurationSec', 'peakKneeElevation', 'liftDurationSec',
  'orientedAngleDeg', 'signedChangeDeg', 'peakExcursionDeg', 'outwardDurationSec'] as const;
export type ReportMetric = typeof REPORT_METRICS[number];
export const REPORT_UNITS = ['degrees', 'reference lengths', 'seconds'] as const;
export type ReportUnit = typeof REPORT_UNITS[number];
/** Display precision per unit. Used by the template, the fact text and the numeric validator alike. */
export const UNIT_DECIMALS: Record<ReportUnit, number> = { degrees: 1, 'reference lengths': 2, seconds: 2 };

/**
 * Fixed labels/units per exercise. Free-text label fields could otherwise carry notes past the context gate,
 * so the schema accepts only these exact strings. Elbow entries mirror src/contracts/elbow-session.ts.
 */
function metricDefinitions(exercise: typeof REPORT_EXERCISES[number]): Partial<Record<ReportMetric, { label: string; unit: ReportUnit }>> {
  return Object.fromEntries(Object.entries(EXERCISE_METRIC_MAP[exercise]).map(([key, definition]) =>
    [key, { label: definition.label, unit: definition.unit === 'reference_lengths' ? 'reference lengths' : definition.unit }]));
}
export const REPORT_METRIC_DEFINITIONS = {
  seated_forward_reach: metricDefinitions('seated_forward_reach'),
  seated_elbow_flexion_extension: metricDefinitions('seated_elbow_flexion_extension'),
  seated_forward_arm_raise: metricDefinitions('seated_forward_arm_raise'),
  seated_knee_extension: metricDefinitions('seated_knee_extension'),
  seated_single_leg_lift: metricDefinitions('seated_single_leg_lift'),
  seated_ankle_pumps: metricDefinitions('seated_ankle_pumps'),
} satisfies Record<typeof REPORT_EXERCISES[number], Partial<Record<ReportMetric, { label: string; unit: ReportUnit }>>>;
/** Fixture context must carry this marker; real text would have to be deliberately mislabelled to pass. */
export const FICTIONAL_PREFIX = 'FICTIONAL FIXTURE:';
export const CONTEXT_ID_PATTERN = /^(sr|cc)-\d{1,3}$/;

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().max(500);
const REASONS: [string, ...string[]] = ['ENDPOINT_NOT_REACHED', 'WRONG_DIRECTION', 'AMBIGUOUS_MOTION', 'UNRESOLVED_JITTER', ...(Object.keys(reasonText) as Reason[])];
const reasonCode = z.enum(REASONS);
const version = z.string().regex(/^[A-Za-z0-9._-]{1,60}$/);
const fictional = z.string().min(FICTIONAL_PREFIX.length + 1).max(500).refine((t) => t.startsWith(FICTIONAL_PREFIX), 'fixture context must be marked fictional');
const contextIdSchema = z.string().regex(CONTEXT_ID_PATTERN);
const metric = z.enum(REPORT_METRICS);
const operator = z.enum(['<', '>']);

const attemptInputSchema = z.strictObject({
  /** 1-based display order; attempt IDs are not sent. */
  index: z.number().int().min(1).max(500),
  classification: z.enum(['measurable', 'excluded']),
  startSec: nonNegative, endSec: nonNegative,
  keyTimes: z.array(z.strictObject({ event: z.enum(['target_entry', 'endpoint', 'return_start', 'rest_entry', 'completion']), sec: nonNegative.nullable() })).max(5),
  metrics: z.array(z.strictObject({ metric, value: finite.nullable(), nullReasons: z.array(reasonCode).max(10) })).max(8),
  exclusionReasons: z.array(reasonCode).max(16),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: count.max(100_000) }),
  flags: z.array(z.strictObject({ metric, operator, threshold: finite, observed: finite })).max(8),
});

/** Only fictional fixture context may be transmitted; real entries are rejected by schema (FR-21 gate). */
const sentSelfReportSchema = z.strictObject({ contextId: contextIdSchema, dataClass: z.literal('synthetic_fixture'), originalText: fictional,
  timing: z.enum(['before_recording', 'after_recording']), source: z.enum(['participant', 'supervisor_on_behalf']), confirmation: z.enum(['confirmed_by_participant', 'unconfirmed']) });
const sentClinicianSchema = z.strictObject({ contextId: contextIdSchema, dataClass: z.literal('synthetic_fixture'), category: z.enum(['diagnosis', 'restriction', 'other']),
  text: fictional, suppliedBy: z.enum(['clinician', 'supervisor_relaying_clinician']), verification: z.enum(['unverified', 'verified_against_source_record']) });

export const reportInputSchema = z.strictObject({
  schemaVersion: z.literal(REPORT_INPUT_VERSION),
  provenance: z.enum(['developer_validation_capture', 'labeled_synthetic_fixture']),
  exercise: z.strictObject({ id: z.enum(REPORT_EXERCISES), definitionVersion: version, analysisVersion: version,
    mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']) }),
  metricDefinitions: z.array(z.strictObject({ metric, label: z.string().min(1).max(80), unit: z.enum(REPORT_UNITS) })).min(1).max(8),
  counts: z.strictObject({ detected: count, measurable: count, excluded: count, flagged: count }),
  criteria: z.array(z.strictObject({ metric, operator, threshold: finite })).max(8),
  attempts: z.array(attemptInputSchema).max(100),
  capture: z.strictObject({ stopReason: z.enum(STOP_REASONS), recordingStatus: z.enum(['complete', 'incomplete', 'unavailable']), recordingDurationSec: nonNegative.nullable() }),
  context: z.strictObject({ selfReport: z.array(sentSelfReportSchema).max(10), clinician: z.array(sentClinicianSchema).max(10),
    /** How many local entries were kept on the device, so the explanation can mention it without content. */
    withheldCount: z.number().int().nonnegative().max(20) }),
}).superRefine((input, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const defined = new Set(input.metricDefinitions.map((d) => d.metric));
  if (defined.size !== input.metricDefinitions.length) issue('duplicate metric definition');
  const fixed = REPORT_METRIC_DEFINITIONS[input.exercise.id];
  if (input.metricDefinitions.length !== Object.keys(fixed).length || input.metricDefinitions.some((d) => fixed[d.metric]?.label !== d.label || fixed[d.metric]?.unit !== d.unit))
    issue('metric definitions must be the fixed labels/units for this exercise');
  const measurable = input.attempts.filter((a) => a.classification === 'measurable');
  const { detected, excluded, flagged } = input.counts;
  if (detected !== input.attempts.length || input.counts.measurable !== measurable.length || excluded !== detected - measurable.length ||
    flagged !== measurable.filter((a) => a.flags.length).length) issue('counts disagree with attempts');
  input.attempts.forEach((a, i) => {
    if (a.index !== i + 1) issue('attempt indices must be 1..n in order');
    if (a.endSec < a.startSec) issue(`attempt ${a.index} ends before it starts`);
    if (a.metrics.length !== defined.size || new Set(a.metrics.map((m) => m.metric)).size !== defined.size || a.metrics.some((m) => !defined.has(m.metric))) issue(`attempt ${a.index} metrics disagree with definitions`);
    for (const m of a.metrics) if ((m.value === null) !== (m.nullReasons.length > 0)) issue(`attempt ${a.index} ${m.metric}: null needs reasons`);
    if (a.classification === 'excluded' && (a.metrics.some((m) => m.value !== null) || a.flags.length || !a.exclusionReasons.length)) issue(`excluded attempt ${a.index} cannot carry values or flags`);
    if (a.classification === 'measurable' && (a.exclusionReasons.length || a.metrics.some((m) => m.value === null))) issue(`measurable attempt ${a.index} has exclusion reasons`);
    const keyTimeNames = new Set(a.keyTimes.map((t) => t.event));
    if (keyTimeNames.size !== a.keyTimes.length) issue(`attempt ${a.index} has duplicate event times`);
    let previousTime = a.startSec;
    for (const t of a.keyTimes) if (t.sec !== null) {
      if (t.sec < previousTime || t.sec > a.endSec) issue(`attempt ${a.index} event time outside ordered attempt`);
      previousTime = t.sec;
    }
    for (const f of a.flags) {
      const value = a.metrics.find((m) => m.metric === f.metric)?.value;
      if (value !== f.observed || !(f.operator === '>' ? f.observed > f.threshold : f.observed < f.threshold)) issue(`attempt ${a.index} flag is not a strict exceedance of its measured value`);
      if (!input.criteria.some((c) => c.metric === f.metric && c.operator === f.operator && c.threshold === f.threshold)) issue(`attempt ${a.index} flag has no configured criterion`);
    }
    if (a.classification === 'measurable') for (const c of input.criteria) {
      const value = a.metrics.find((m) => m.metric === c.metric)?.value;
      const exceeded = value !== null && value !== undefined && (c.operator === '>' ? value > c.threshold : value < c.threshold);
      if (exceeded !== a.flags.some((f) => f.metric === c.metric && f.operator === c.operator && f.threshold === c.threshold)) issue(`attempt ${a.index} has missing configured flag`);
    }
  });
  for (const c of input.criteria) if (!defined.has(c.metric)) issue('criterion for an undefined metric');
  const ids = [...input.context.selfReport, ...input.context.clinician].map((c) => c.contextId);
  if (new Set(ids).size !== ids.length) issue('duplicate context IDs');
});
export type ReportInput = z.infer<typeof reportInputSchema>;
export type ReportAttemptInput = ReportInput['attempts'][number];

export const CHART_TYPES = ['none', 'attempt_counts', 'per_attempt_metric'] as const;
const chartSchema = z.strictObject({ type: z.enum(CHART_TYPES), metric: z.enum([...REPORT_METRICS, 'none']), showThreshold: z.boolean() });
export type ChartSpec = z.infer<typeof chartSchema>;

/** Model output after JSON parsing. Structure alone proves nothing; see src/report/report-validator.ts. */
export const generatedReportSchema = z.strictObject({
  summary: z.string().trim().min(1).max(700),
  observations: z.array(z.strictObject({ factId: z.string().max(60), text: z.string().trim().min(1).max(300) })).max(12),
  limitations: z.array(z.strictObject({ factId: z.string().max(60), text: z.string().trim().min(1).max(300) })).max(6),
  /** The app renders context in its original wording; the model may only reference which entries it saw. */
  reportedContext: z.array(z.strictObject({ contextId: z.string().max(40) })).max(20),
  chart: chartSchema,
});
export type GeneratedReport = z.infer<typeof generatedReportSchema>;

/** Same structure as generatedReportSchema, in the JSON Schema subset documented for Gemini structured output. */
export const GEMINI_REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Copy the REQUIRED SUMMARY verbatim. Do not paraphrase or add claims.' },
    observations: { type: 'array', items: { type: 'object', properties: {
      factId: { type: 'string', description: 'ID of the one source fact this sentence restates.' },
      text: { type: 'string', description: 'Copy the cited SOURCE FACT text verbatim. No additional claims or paraphrases.' } }, required: ['factId', 'text'] } },
    limitations: { type: 'array', items: { type: 'object', properties: {
      factId: { type: 'string', description: 'Source fact ID, or "none" for a general measurement limitation.' },
      text: { type: 'string' } }, required: ['factId', 'text'] } },
    reportedContext: { type: 'array', items: { type: 'object', properties: { contextId: { type: 'string' } }, required: ['contextId'] } },
    chart: { type: 'object', properties: {
      type: { type: 'string', enum: [...CHART_TYPES] },
      metric: { type: 'string', enum: [...REPORT_METRICS, 'none'] },
      showThreshold: { type: 'boolean' } }, required: ['type', 'metric', 'showThreshold'] },
  },
  required: ['summary', 'observations', 'limitations', 'reportedContext', 'chart'],
} as const;

export const reportRequestSchema = z.strictObject({ input: reportInputSchema });

export type ReportErrorCode = 'METHOD_NOT_ALLOWED' | 'ORIGIN_DENIED' | 'ACCESS_DENIED' | 'PROTECTION_UNCONFIGURED' | 'PROVIDER_DISABLED' |
  'INVALID_INPUT' | 'CONTEXT_NOT_PERMITTED' | 'REQUEST_TOO_LARGE' | 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' | 'TIMEOUT' | 'CANCELLED' |
  'PROVIDER_ERROR' | 'REFUSED' | 'MALFORMED_RESPONSE' | 'REJECTED_CONTENT' | 'NETWORK_ERROR' | 'STALE_RESPONSE';

export const reportProvenanceSchema = z.strictObject({
  /** gemini: a genuine provider response; mock_provider: a labelled offline stand-in that is never real-provider evidence. */
  source: z.enum(['gemini', 'mock_provider']),
  pipeline: pipelineMetricsSchema.optional(),
  model: z.string().min(1).max(80), promptVersion: z.string().min(1).max(40), validatorVersion: z.string().min(1).max(40), generatedAt: z.iso.datetime(),
});
export type ReportProvenance = z.infer<typeof reportProvenanceSchema>;

export const reportResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), binding: z.strictObject({ inputSchemaVersion: z.literal(REPORT_INPUT_VERSION), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
    provenance: reportProvenanceSchema, report: generatedReportSchema }),
  z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string().min(1).max(40), message: z.string().max(300) }), issues: z.array(z.string().max(200)).max(20).optional() }),
]);
export type ReportResponse = z.infer<typeof reportResponseSchema>;

/** Locally persisted, validated explanation. Bound to one session and one exact input digest. */
export const acceptedReportSchema = z.strictObject({
  schemaVersion: z.literal(ACCEPTED_REPORT_VERSION),
  sessionId: z.string().min(1), inputDigest: z.string().regex(/^[a-f0-9]{64}$/), inputSchemaVersion: z.literal(REPORT_INPUT_VERSION),
  label: z.literal(EXPERIMENTAL_LABEL), provenance: reportProvenanceSchema, report: generatedReportSchema, acceptedAt: z.iso.datetime(),
});
export type AcceptedReport = z.infer<typeof acceptedReportSchema>;
