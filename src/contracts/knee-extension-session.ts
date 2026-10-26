import { z } from 'zod';
import { validateExerciseAttempt, validateExerciseSession } from './exercise-validation.js';
import { SeatedKneeExtensionAnalyzer, kneeExtensionConfigSchema, type KneeExtensionAttempt } from '../analysis/seated-knee-extension.js';
import { recordingEvidenceSchema } from './reach-session.js';

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const metricNames = ['peakKneeAngleDeg', 'projectedExtensionExcursionDeg', 'extensionDurationSec', 'returnDurationSec'] as const;
const units = {
  peakKneeAngleDeg: 'degrees',
  projectedExtensionExcursionDeg: 'degrees',
  extensionDurationSec: 'seconds',
  returnDurationSec: 'seconds',
} as const;
const reason = z.string().min(1);
const metric = z.strictObject({ value: finite.nullable(), unit: z.string(), reasons: z.array(reason) });

export const kneeExtensionAttemptRecordSchema = z.strictObject({
  id: z.string().min(1), sessionId: z.string().min(1), configurationId: z.string().min(1), analysisVersion: z.string().min(1),
  exerciseId: z.literal('seated_knee_extension'), mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  startMs: nonNegative, endpointMs: nonNegative.nullable(), returnStartMs: nonNegative.nullable(), restMs: nonNegative.nullable(), endMs: nonNegative,
  classification: z.enum(['measurable', 'excluded']), reasons: z.array(reason), explanations: z.array(z.string()),
  metrics: z.strictObject({
    peakKneeAngleDeg: metric,
    projectedExtensionExcursionDeg: metric,
    extensionDurationSec: metric,
    returnDurationSec: metric,
  }),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: z.number().int().nonnegative() }),
  flags: z.array(z.strictObject({ metric: z.enum(metricNames), operator: z.enum(['<', '>']), threshold: finite, observed: finite,
    replay: z.strictObject({ startMs: nonNegative, endMs: nonNegative }), explanation: z.string().min(1) })),
  evidence: z.strictObject({ status: z.literal('unavailable'), reason: z.string() }),
}).superRefine((attempt, ctx) => validateExerciseAttempt(attempt, units, ctx));
export type KneeExtensionAttemptRecord = z.infer<typeof kneeExtensionAttemptRecordSchema>;

export const kneeExtensionSessionRecordSchema = z.strictObject({
  schemaVersion: z.literal('knee-extension-session.consumer-v2'),
  sessionId: z.string().min(1), createdAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  provenance: z.strictObject({ kind: z.literal('developer_validation_capture'), label: z.literal('Developer/judge validation · experimental · not participant use') }),
  exercise: z.strictObject({ id: z.literal('seated_knee_extension'), definitionVersion: z.string().min(1), catalogSchemaVersion: z.string().min(1) }),
  mode: z.enum(['rehabilitation', 'wellness']), participantLabel: z.string().trim().min(1).max(120), taskLabel: z.string().trim().min(1).max(120),
  attestation: z.strictObject({ reported: z.literal(true), supervisorLabel: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), context: z.string().trim().min(1).max(500) }),
  setup: z.strictObject({
    seatingSupport: z.string().trim().min(1).max(300), assignedRangeOrGoal: z.string().trim().min(1).max(300),
    cameraFacing: z.enum(['user', 'environment']), delegate: z.enum(['CPU', 'GPU']), previewMirrored: z.boolean(), teamTestConfirmed: z.literal(true),
    supervisorSetupConfirmed: z.literal(true), readiness: z.strictObject({ version: z.string(), windowMs: finite.positive(), minConfidence: finite.min(0).max(1) }),
  }),
  configuration: kneeExtensionConfigSchema,
  capture: z.strictObject({ stopReason: z.enum(['STOPPED', 'DISCOMFORT_STOP', 'SETUP_CHANGED', 'CAPTURE_FAILED']), stoppedAtMs: nonNegative.nullable(), message: z.string().nullable() }),
  discomfort: z.strictObject({ response: z.enum(['yes', 'no', 'not_reported']), reportedDuringCaptureAtMs: nonNegative.nullable(), note: z.string().max(1000) }),
  notes: z.string().max(5000), attempts: z.array(kneeExtensionAttemptRecordSchema).max(500), recording: recordingEvidenceSchema,
}).superRefine((session, ctx) => {
  validateExerciseSession(session, ctx);
  try { new SeatedKneeExtensionAnalyzer(session.configuration); } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid exercise calibration or engineering configuration' });
  }
});
export type KneeExtensionSessionRecord = z.infer<typeof kneeExtensionSessionRecordSchema>;

export function toKneeExtensionAttemptRecord(attempt: KneeExtensionAttempt): KneeExtensionAttemptRecord {
  const { observations: _observations, ...stored } = attempt;
  void _observations;
  return kneeExtensionAttemptRecordSchema.parse(stored);
}

export function summarizeKneeExtensionSession(record: KneeExtensionSessionRecord) {
  const measurable = record.attempts.filter((attempt) => attempt.classification === 'measurable');
  const medians = Object.fromEntries(metricNames.map((name) => {
    const values = measurable.flatMap((attempt) => attempt.metrics[name].value === null ? [] : [attempt.metrics[name].value!]).sort((a, b) => a - b);
    return [name, values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null];
  }));
  return { detected: record.attempts.length, measurable: measurable.length, excluded: record.attempts.length - measurable.length,
    flagged: measurable.filter((attempt) => attempt.flags.length > 0).length, medians };
}
