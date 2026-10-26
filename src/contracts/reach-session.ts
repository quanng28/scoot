import { z } from 'zod';
import { metricUnits, reachConfigSchema, reasonText, type Metric, type Reason, type ReachAttempt } from '../analysis/reach-contract.js';
import { summarizeReach } from '../analysis/seated-reach.js';

/**
 * Quan N consumer contract for SR01 results (H1.3). It does not replace Quan P's producer types in
 * src/analysis/reach-contract.ts; it re-validates his finalized attempts at the application/storage boundary.
 *
 * Three statuses stay separate:
 * - measurement validity: attempt.classification / metric nulls (producer-owned)
 * - recording/replay evidence: session.recording plus a runtime decode check (replayWindow)
 * - save status: owned by src/storage, never stored inside the record
 */
export const ATTEMPT_SCHEMA_VERSION = 'reach-attempt.consumer-v1';
export const SESSION_SCHEMA_VERSION = 'reach-session.consumer-v1';
/** Seconds of lead-in/lead-out shown around an attempt during replay. Display setting, not analysis. */
export const REPLAY_CONTEXT_SEC = 0.5;

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const METRICS = Object.keys(metricUnits) as Metric[];
const REASONS = Object.keys(reasonText) as [Reason, ...Reason[]];
const reasonSchema = z.enum(REASONS);
const metricSchema = z.enum(METRICS as [Metric, ...Metric[]]);

/** Engine metric IDs ↔ catalog-local IDs/units (src/catalog/exercises.json, seated_forward_reach 1.0.0). */
export const CATALOG_METRIC_MAP: Record<Metric, { catalogId: string; catalogUnit: string; label: string; short: string }> = {
  elbowPeakDeg: { catalogId: 'peak_elbow_angle', catalogUnit: 'degrees', label: 'Peak projected elbow angle (estimated 2D)', short: 'Elbow angle' },
  torsoForwardPeakDeg: { catalogId: 'peak_forward_torso_inclination_change', catalogUnit: 'degrees', label: 'Peak forward torso inclination change (2D proxy)', short: 'Torso change' },
  wristForwardPeak: { catalogId: 'peak_forward_wrist_displacement', catalogUnit: 'reference_lengths', label: 'Peak forward wrist displacement', short: 'Wrist displacement' },
  reachDurationSec: { catalogId: 'reach_duration', catalogUnit: 'seconds', label: 'Reach duration (onset to first target entry)', short: 'Reach duration' },
};

const metricValueSchema = z.strictObject({ value: finite.nullable(), unit: z.string(), reasons: z.array(reasonSchema) });

export const attemptRecordSchema = z.strictObject({
  schemaVersion: z.literal(ATTEMPT_SCHEMA_VERSION),
  id: z.string().min(1), sessionId: z.string().min(1), configurationId: z.string().min(1), analysisVersion: z.string().min(1),
  exerciseId: z.literal('seated_forward_reach'), mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  /** Recording-relative milliseconds (recorder start event = 0). */
  startMs: nonNegative, targetMs: nonNegative.nullable(), endMs: nonNegative,
  classification: z.enum(['measurable', 'excluded']),
  reasons: z.array(reasonSchema), explanations: z.array(z.string()),
  metrics: z.strictObject({ elbowPeakDeg: metricValueSchema, torsoForwardPeakDeg: metricValueSchema, wristForwardPeak: metricValueSchema, reachDurationSec: metricValueSchema }),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: z.number().int().nonnegative() }),
  flags: z.array(z.strictObject({ metric: metricSchema, operator: z.enum(['<', '>']), threshold: finite, observed: finite,
    replay: z.strictObject({ startMs: nonNegative, endMs: nonNegative }), explanation: z.string().min(1) })),
  /** Producer evidence status. The engine never certifies its own recording linkage. */
  engineEvidence: z.strictObject({ status: z.literal('unavailable'), reason: z.string() }),
}).superRefine((a, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (a.endMs < a.startMs) issue('endMs precedes startMs');
  if (a.targetMs !== null && (a.targetMs < a.startMs || a.targetMs > a.endMs)) issue('targetMs outside attempt range');
  if (new Set(a.reasons).size !== a.reasons.length) issue('duplicate reasons');
  if (a.explanations.length !== a.reasons.length) issue('each reason needs an explanation');
  for (const key of METRICS) {
    const metric = a.metrics[key];
    if (metric.unit !== metricUnits[key]) issue(`${key} unit must be ${metricUnits[key]}`);
    if ((metric.value === null) !== (metric.reasons.length > 0)) issue(`${key}: null values need reasons and valid values none`);
  }
  if (a.classification === 'measurable') {
    if (a.reasons.length) issue('measurable attempt cannot carry exclusion reasons');
    if (a.targetMs === null) issue('measurable attempt needs a target time');
    if (METRICS.some((key) => a.metrics[key].value === null)) issue('measurable attempt needs all four metrics');
  } else {
    if (!a.reasons.length) issue('excluded attempt needs a reason');
    if (METRICS.some((key) => a.metrics[key].value !== null)) issue('excluded attempt cannot report metric values');
    if (a.flags.length) issue('excluded attempt cannot carry criterion flags');
  }
  for (const flag of a.flags) {
    if (flag.observed !== a.metrics[flag.metric].value) issue(`flag ${flag.metric} does not match its measured value`);
    if (!(flag.operator === '>' ? flag.observed > flag.threshold : flag.observed < flag.threshold)) issue(`flag ${flag.metric} is not a strict exceedance`);
    if (flag.replay.startMs < a.startMs || flag.replay.endMs > a.endMs || flag.replay.endMs < flag.replay.startMs) issue('flag replay outside attempt');
  }
});
export type AttemptRecord = z.infer<typeof attemptRecordSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.iso.datetime();
const label = z.string().trim().min(1).max(120);

export const recordingEvidenceSchema = z.strictObject({
  /** complete: finalized normally; incomplete: partial/interrupted data; unavailable: no usable bytes. */
  status: z.enum(['complete', 'incomplete', 'unavailable']),
  mimeType: z.string().nullable(), sizeBytes: z.number().int().nonnegative(),
  /** Recorder-start to recorder-stop on the capture clock; attempt times share this origin. */
  durationMs: nonNegative.nullable(), reason: z.string().nullable(),
  timing: z.literal('estimated_recorder_start'),
}).superRefine((r, ctx) => {
  if (r.status === 'unavailable' && r.sizeBytes > 0) ctx.addIssue({ code: 'custom', message: 'unavailable recording cannot have bytes' });
  if (r.status !== 'unavailable' && (r.sizeBytes === 0 || r.durationMs === null || r.mimeType === null)) ctx.addIssue({ code: 'custom', message: 'recording evidence needs bytes, MIME type and duration' });
  if (r.status !== 'complete' && !r.reason) ctx.addIssue({ code: 'custom', message: 'incomplete/unavailable recording needs a reason' });
});
export type RecordingEvidence = z.infer<typeof recordingEvidenceSchema>;

export const STOP_REASONS = ['STOPPED', 'DISCOMFORT_STOP', 'SETUP_CHANGED', 'CAPTURE_FAILED', 'SYNTHETIC_FIXTURE'] as const;

export const sessionRecordSchema = z.strictObject({
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  sessionId: z.string().min(1), createdAt: isoTime, endedAt: isoTime,
  /** Fixtures are never presented as live measurements. */
  provenance: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('developer_validation_capture'), label: z.literal('Developer/judge validation · experimental · not participant use') }),
    z.strictObject({ kind: z.literal('labeled_synthetic_fixture'), label: z.literal('Synthetic fixture · not a live measurement') }),
  ]),
  exercise: z.strictObject({ id: z.literal('seated_forward_reach'), definitionVersion: z.string().min(1), catalogSchemaVersion: z.string().min(1) }),
  mode: z.enum(['rehabilitation', 'wellness']),
  participantLabel: label, taskLabel: label,
  attestation: z.strictObject({ reported: z.literal(true), supervisorLabel: label, date: isoDate, context: z.string().trim().min(1).max(500) }),
  setup: z.strictObject({
    seatingSupport: z.string().trim().min(1).max(300), targetPlacement: z.string().trim().min(1).max(300), assignedRangeOrGoal: z.string().trim().min(1).max(300),
    cameraFacing: z.enum(['user', 'environment', 'synthetic']), delegate: z.enum(['CPU', 'GPU', 'none']), previewMirrored: z.boolean(),
    teamTestConfirmed: z.literal(true), supervisorSetupConfirmed: z.literal(true),
    readiness: z.strictObject({ version: z.string().min(1), windowMs: z.number().positive(), minConfidence: finite.min(0).max(1) }),
  }),
  /** Immutable engine configuration snapshot: calibration, engineering settings, criteria, analysis version. */
  configuration: reachConfigSchema,
  capture: z.strictObject({ stopReason: z.enum(STOP_REASONS), stoppedAtMs: nonNegative.nullable(), message: z.string().nullable() }),
  discomfort: z.strictObject({ response: z.enum(['yes', 'no', 'not_reported']), reportedDuringCaptureAtMs: nonNegative.nullable(), note: z.string().max(1000) }),
  notes: z.string().max(5000),
  attempts: z.array(attemptRecordSchema).max(500),
  recording: recordingEvidenceSchema,
}).superRefine((s, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const c = s.configuration;
  if (c.sessionId !== s.sessionId || c.mode !== s.mode) issue('configuration does not belong to this session/mode');
  if (s.provenance.kind === 'labeled_synthetic_fixture' ? s.capture.stopReason !== 'SYNTHETIC_FIXTURE' : s.capture.stopReason === 'SYNTHETIC_FIXTURE') issue('fixture provenance and stop reason disagree');
  if (s.capture.stopReason === 'DISCOMFORT_STOP' && (s.discomfort.response !== 'yes' || s.discomfort.reportedDuringCaptureAtMs === null)) issue('discomfort stop must keep its timestamped yes report');
  if (Date.parse(s.endedAt) < Date.parse(s.createdAt)) issue('session ends before it starts');
  const ids = new Set<string>();
  let previousStart = -1;
  for (const a of s.attempts) {
    if (ids.has(a.id)) issue(`duplicate attempt ${a.id}`);
    ids.add(a.id);
    if (a.sessionId !== s.sessionId || a.configurationId !== c.configurationId || a.analysisVersion !== c.version || a.mode !== c.mode || a.side !== c.side) issue(`attempt ${a.id} belongs to another configuration`);
    if (a.startMs < previousStart) issue('attempts must be ordered by start time');
    previousStart = a.startMs;
    for (const flag of a.flags) if (!c.criteria.some((k) => k.metric === flag.metric && k.operator === flag.operator && k.threshold === flag.threshold)) issue(`attempt ${a.id} has a flag for an unconfigured criterion`);
    if (a.classification === 'measurable') for (const k of c.criteria) {
      const v = a.metrics[k.metric].value!;
      const exceeded = k.operator === '>' ? v > k.threshold : v < k.threshold;
      if (exceeded !== a.flags.some((f) => f.metric === k.metric && f.operator === k.operator && f.threshold === k.threshold)) issue(`attempt ${a.id} flags disagree with configured criteria`);
    }
  }
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

/** Adapter from Quan P's finalized engine attempt. Diagnostic observation streams stay out of the stored record. */
export function toAttemptRecord(attempt: ReachAttempt): AttemptRecord {
  const { observations: _diagnostics, evidence, ...rest } = attempt;
  void _diagnostics;
  return attemptRecordSchema.parse({ schemaVersion: ATTEMPT_SCHEMA_VERSION, ...structuredClone(rest), engineEvidence: { ...evidence } });
}

export function parseSessionRecord(input: unknown): SessionRecord {
  return sessionRecordSchema.parse(input);
}

/** Count invariants come from the producer summary: detected = measurable + excluded; flagged ≤ measurable. */
export function summarizeSession(record: Pick<SessionRecord, 'attempts'>) {
  const summary = summarizeReach(record.attempts.map((a) => ({ ...a, observations: [], evidence: a.engineEvidence })));
  if (summary.detected !== summary.measurable + summary.excluded || summary.flagged > summary.measurable) throw new Error('Count invariant violated');
  return summary;
}

export type ReplayAvailability = { available: true; startSec: number; endSec: number; attemptStartSec: number; attemptEndSec: number } | { available: false; reason: string };

/**
 * Recording-relative replay range for one attempt. `decodable` is the runtime result of loading the video;
 * a stored blob that cannot be decoded is evidence-unavailable rather than silently replayable.
 * Live consumers pass decodedDurationMs too; metadata duration alone cannot establish video coverage.
 */
export function replayWindow(attempt: Pick<AttemptRecord, 'startMs' | 'endMs'>, recording: RecordingEvidence, decodable: boolean | null, decodedDurationMs?: number | null): ReplayAvailability {
  if (recording.status === 'unavailable') return { available: false, reason: recording.reason ?? 'No recording was captured.' };
  if (decodable === false) return { available: false, reason: 'The stored video could not be decoded in this browser.' };
  if (decodable === null) return { available: false, reason: 'Video is still loading.' };
  // Legacy consumers may omit the decoded bound; the live review adapter supplies it.
  if (decodedDurationMs !== undefined && (decodedDurationMs === null || !Number.isFinite(decodedDurationMs) || decodedDurationMs <= 0))
    return { available: false, reason: 'The decoded video duration is not available yet.' };
  const duration = Math.min(recording.durationMs!, decodedDurationMs ?? recording.durationMs!);
  if (![attempt.startMs, attempt.endMs, duration].every(Number.isFinite) || attempt.startMs < 0 || attempt.endMs <= attempt.startMs)
    return { available: false, reason: 'This attempt has no valid replay range.' };
  if (attempt.endMs > duration) return { available: false, reason: 'This attempt extends beyond the recorded video.' };
  return { available: true, attemptStartSec: attempt.startMs / 1000, attemptEndSec: attempt.endMs / 1000,
    startSec: Math.max(0, attempt.startMs / 1000 - REPLAY_CONTEXT_SEC), endSec: Math.min(duration / 1000, attempt.endMs / 1000 + REPLAY_CONTEXT_SEC) };
}

/** Maps Quan P's recorder result to stored evidence metadata (the Blob itself is stored separately). */
export function recordingEvidence(recording: { blob: Blob; mimeType: string; startMs: number; endMs: number; complete: boolean; reason: string | null } | null, missingReason: string): RecordingEvidence {
  if (!recording || recording.blob.size === 0) return { status: 'unavailable', mimeType: null, sizeBytes: 0, durationMs: null, reason: recording?.reason ?? missingReason, timing: 'estimated_recorder_start' };
  return recordingEvidenceSchema.parse({ status: recording.complete ? 'complete' : 'incomplete', mimeType: recording.mimeType || 'application/octet-stream', sizeBytes: recording.blob.size,
    durationMs: Math.max(0, recording.endMs - recording.startMs), reason: recording.complete ? null : recording.reason ?? 'Recording did not finalize normally.', timing: 'estimated_recorder_start' });
}
