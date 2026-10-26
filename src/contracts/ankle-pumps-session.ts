import { z } from 'zod';
import { circularMedianDegrees } from '../analysis/circular-statistics.js';
import { validateExerciseAttempt, validateExerciseSession } from './exercise-validation.js';
import { SeatedAnklePumpsAnalyzer, anklePumpsConfigSchema, type AnklePumpsAttempt } from '../analysis/seated-ankle-pumps.js';
import { recordingEvidenceSchema } from './reach-session.js';

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const metricNames = ['orientedAngleDeg', 'signedChangeDeg', 'peakExcursionDeg', 'outwardDurationSec', 'returnDurationSec'] as const;
const units = {
  orientedAngleDeg: 'degrees',
  signedChangeDeg: 'degrees',
  peakExcursionDeg: 'degrees',
  outwardDurationSec: 'seconds',
  returnDurationSec: 'seconds',
} as const;
const reason = z.string().min(1);
const metric = z.strictObject({ value: finite.nullable(), unit: z.string(), reasons: z.array(reason) });

export const manualLogEntrySchema = z.strictObject({
  id: z.string().min(1),
  loggedAt: z.iso.datetime(),
  count: z.number().int().positive(),
  side: z.enum(['left', 'right']),
  note: z.string().max(1000),
  label: z.literal('Manual log — not a measured repetition or substitute for an unavailable analyzer'),
});
export type ManualLogEntry = z.infer<typeof manualLogEntrySchema>;

export const anklePumpsAttemptRecordSchema = z.strictObject({
  id: z.string().min(1), sessionId: z.string().min(1), configurationId: z.string().min(1), analysisVersion: z.string().min(1),
  exerciseId: z.literal('seated_ankle_pumps'), mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  startMs: nonNegative, endpointMs: nonNegative.nullable(), returnStartMs: nonNegative.nullable(), restMs: nonNegative.nullable(), endMs: nonNegative,
  classification: z.enum(['measurable', 'excluded']), reasons: z.array(reason), explanations: z.array(z.string()),
  metrics: z.strictObject({
    orientedAngleDeg: metric,
    signedChangeDeg: metric,
    peakExcursionDeg: metric,
    outwardDurationSec: metric,
    returnDurationSec: metric,
  }),
  quality: z.strictObject({ coverage: finite.min(0).max(1), longestGapMs: nonNegative, observationCount: z.number().int().nonnegative() }),
  flags: z.array(z.strictObject({ metric: z.enum(metricNames), operator: z.enum(['<', '>']), threshold: finite, observed: finite,
    replay: z.strictObject({ startMs: nonNegative, endMs: nonNegative }), explanation: z.string().min(1) })),
  evidence: z.strictObject({ status: z.literal('unavailable'), reason: z.string() }),
}).superRefine((attempt, ctx) => validateExerciseAttempt(attempt, units, ctx));
export type AnklePumpsAttemptRecord = z.infer<typeof anklePumpsAttemptRecordSchema>;

export const anklePumpsSessionRecordSchema = z.strictObject({
  schemaVersion: z.literal('ankle-pumps-session.consumer-v2'),
  sessionId: z.string().min(1), createdAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  provenance: z.strictObject({ kind: z.literal('developer_validation_capture'), label: z.literal('Developer/judge validation · experimental · not participant use') }),
  exercise: z.strictObject({ id: z.literal('seated_ankle_pumps'), definitionVersion: z.string().min(1), catalogSchemaVersion: z.string().min(1) }),
  mode: z.enum(['rehabilitation', 'wellness']), participantLabel: z.string().trim().min(1).max(120), taskLabel: z.string().trim().min(1).max(120),
  attestation: z.strictObject({ reported: z.literal(true), supervisorLabel: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), context: z.string().trim().min(1).max(500) }),
  setup: z.strictObject({
    seatingSupport: z.string().trim().min(1).max(300), assignedRangeOrGoal: z.string().trim().min(1).max(300),
    cameraFacing: z.enum(['user', 'environment']), delegate: z.enum(['CPU', 'GPU']), previewMirrored: z.boolean(), teamTestConfirmed: z.literal(true),
    supervisorSetupConfirmed: z.literal(true), readiness: z.strictObject({ version: z.string(), windowMs: finite.positive(), minConfidence: finite.min(0).max(1) }),
    gatedStatus: z.literal('automatic_measurement_gated_pending_physical_device_trial'),
  }),
  configuration: anklePumpsConfigSchema,
  capture: z.strictObject({ stopReason: z.enum(['STOPPED', 'DISCOMFORT_STOP', 'SETUP_CHANGED', 'CAPTURE_FAILED']), stoppedAtMs: nonNegative.nullable(), message: z.string().nullable() }),
  discomfort: z.strictObject({ response: z.enum(['yes', 'no', 'not_reported']), reportedDuringCaptureAtMs: nonNegative.nullable(), note: z.string().max(1000) }),
  notes: z.string().max(5000), attempts: z.array(anklePumpsAttemptRecordSchema).max(500), recording: recordingEvidenceSchema,
  manualLogs: z.array(manualLogEntrySchema).default([]),
}).superRefine((session, ctx) => {
  validateExerciseSession(session, ctx);
  try { new SeatedAnklePumpsAnalyzer(session.configuration); } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid exercise calibration or engineering configuration' });
  }
});
export type AnklePumpsSessionRecord = z.infer<typeof anklePumpsSessionRecordSchema>;

export function toAnklePumpsAttemptRecord(attempt: AnklePumpsAttempt): AnklePumpsAttemptRecord {
  const { observations: _observations, ...stored } = attempt;
  void _observations;
  return anklePumpsAttemptRecordSchema.parse(stored);
}

export function summarizeAnklePumpsSession(record: AnklePumpsSessionRecord) {
  const measurable = record.attempts.filter((attempt) => attempt.classification === 'measurable');
  const medians = Object.fromEntries(metricNames.map((name) => {
    const values = measurable.flatMap((attempt) => attempt.metrics[name].value === null ? [] : [attempt.metrics[name].value!]).sort((a, b) => a - b);
    return [name, name === 'orientedAngleDeg' ? circularMedianDegrees(values)
      : values.length ? (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2 : null];
  }));
  return { detected: record.attempts.length, measurable: measurable.length, excluded: record.attempts.length - measurable.length,
    flagged: measurable.filter((attempt) => attempt.flags.length > 0).length, medians, manualLogsCount: record.manualLogs.reduce((acc, log) => acc + log.count, 0) };
}
