import { z } from 'zod';
import { elbowConfigSchema, type ElbowAttempt } from '../analysis/seated-elbow.js';
import { recordingEvidenceSchema } from './reach-session.js';

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const metricNames = ['minElbowDeg', 'bendExcursionDeg', 'torsoForwardPeakDeg', 'bendDurationSec', 'returnDurationSec'] as const;
const units = { minElbowDeg: 'degrees', bendExcursionDeg: 'degrees', torsoForwardPeakDeg: 'degrees', bendDurationSec: 'seconds', returnDurationSec: 'seconds' } as const;
const reason = z.string().min(1);
const metric = z.strictObject({ value: finite.nullable(), unit: z.string(), reasons: z.array(reason) });

export const elbowAttemptRecordSchema = z.strictObject({
  id: z.string().min(1), sessionId: z.string().min(1), configurationId: z.string().min(1), analysisVersion: z.string().min(1),
  exerciseId: z.literal('seated_elbow_flexion_extension'), mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  startMs: nonNegative, endpointMs: nonNegative.nullable(), returnStartMs: nonNegative.nullable(), endMs: nonNegative,
  classification: z.enum(['measurable', 'excluded']), reasons: z.array(reason), explanations: z.array(z.string()),
  metrics: z.strictObject({ minElbowDeg: metric, bendExcursionDeg: metric, torsoForwardPeakDeg: metric, bendDurationSec: metric, returnDurationSec: metric }),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: z.number().int().nonnegative() }),
  flags: z.array(z.strictObject({ metric: z.enum(metricNames), operator: z.enum(['<', '>']), threshold: finite, observed: finite,
    replay: z.strictObject({ startMs: nonNegative, endMs: nonNegative }), explanation: z.string().min(1) })),
  evidence: z.strictObject({ status: z.literal('unavailable'), reason: z.string() }),
}).superRefine((attempt, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (attempt.endMs < attempt.startMs) issue('Attempt ends before it starts');
  if (attempt.endpointMs !== null && (attempt.endpointMs < attempt.startMs || attempt.endpointMs > attempt.endMs)) issue('Endpoint outside attempt');
  if (attempt.classification === 'measurable' && (attempt.reasons.length || attempt.endpointMs === null)) issue('Measurable attempt needs endpoint and no exclusion reasons');
  if (attempt.classification === 'excluded' && (!attempt.reasons.length || attempt.flags.length)) issue('Excluded attempt needs reasons and no flags');
  for (const name of metricNames) {
    const value = attempt.metrics[name];
    if (value.unit !== units[name]) issue(`${name} has the wrong unit`);
    if (attempt.classification === 'measurable' ? value.value === null : value.value !== null) issue(`${name} disagrees with classification`);
  }
});
export type ElbowAttemptRecord = z.infer<typeof elbowAttemptRecordSchema>;

export const elbowSessionRecordSchema = z.strictObject({
  schemaVersion: z.literal('elbow-session.consumer-v1'),
  sessionId: z.string().min(1), createdAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  provenance: z.strictObject({ kind: z.literal('developer_validation_capture'), label: z.literal('Developer/judge validation · experimental · not participant use') }),
  exercise: z.strictObject({ id: z.literal('seated_elbow_flexion_extension'), definitionVersion: z.string().min(1), catalogSchemaVersion: z.string().min(1) }),
  mode: z.enum(['rehabilitation', 'wellness']), participantLabel: z.string().trim().min(1).max(120), taskLabel: z.string().trim().min(1).max(120),
  attestation: z.strictObject({ reported: z.literal(true), supervisorLabel: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), context: z.string().trim().min(1).max(500) }),
  setup: z.strictObject({ seatingSupport: z.string().trim().min(1).max(300), assignedRangeOrGoal: z.string().trim().min(1).max(300),
    cameraFacing: z.enum(['user', 'environment']), delegate: z.enum(['CPU', 'GPU']), previewMirrored: z.boolean(), teamTestConfirmed: z.literal(true),
    supervisorSetupConfirmed: z.literal(true), readiness: z.strictObject({ version: z.string(), windowMs: finite.positive(), minConfidence: finite.min(0).max(1) }) }),
  configuration: elbowConfigSchema,
  capture: z.strictObject({ stopReason: z.enum(['STOPPED', 'DISCOMFORT_STOP', 'SETUP_CHANGED', 'CAPTURE_FAILED']), stoppedAtMs: nonNegative.nullable(), message: z.string().nullable() }),
  discomfort: z.strictObject({ response: z.enum(['yes', 'no', 'not_reported']), reportedDuringCaptureAtMs: nonNegative.nullable(), note: z.string().max(1000) }),
  notes: z.string().max(5000), attempts: z.array(elbowAttemptRecordSchema).max(500), recording: recordingEvidenceSchema,
}).superRefine((session, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (session.configuration.sessionId !== session.sessionId || session.configuration.mode !== session.mode) issue('Configuration does not belong to session');
  if (Date.parse(session.endedAt) < Date.parse(session.createdAt)) issue('Session ends before it starts');
  if (session.capture.stopReason === 'DISCOMFORT_STOP' && (session.discomfort.response !== 'yes' || session.discomfort.reportedDuringCaptureAtMs === null)) issue('Discomfort stop requires report');
  const ids = new Set<string>();
  for (const attempt of session.attempts) {
    if (ids.has(attempt.id)) issue('Duplicate attempt');
    ids.add(attempt.id);
    if (attempt.sessionId !== session.sessionId || attempt.configurationId !== session.configuration.configurationId || attempt.analysisVersion !== session.configuration.version ||
        attempt.side !== session.configuration.side || attempt.mode !== session.mode) issue('Attempt belongs to another configuration');
  }
});
export type ElbowSessionRecord = z.infer<typeof elbowSessionRecordSchema>;

export function toElbowAttemptRecord(attempt: ElbowAttempt): ElbowAttemptRecord {
  const { observations: _observations, ...stored } = attempt;
  void _observations;
  return elbowAttemptRecordSchema.parse(stored);
}

export function summarizeElbowSession(record: ElbowSessionRecord) {
  const measurable = record.attempts.filter((attempt) => attempt.classification === 'measurable');
  const medians = Object.fromEntries(metricNames.map((name) => {
    const values = measurable.flatMap((attempt) => attempt.metrics[name].value === null ? [] : [attempt.metrics[name].value!]).sort((a, b) => a - b);
    return [name, values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null];
  }));
  return { detected: record.attempts.length, measurable: measurable.length, excluded: record.attempts.length - measurable.length,
    flagged: measurable.filter((attempt) => attempt.flags.length > 0).length, medians };
}
