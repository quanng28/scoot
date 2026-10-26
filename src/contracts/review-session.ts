import { elbowAttemptRecordSchema, elbowSessionRecordSchema, summarizeElbowSession, type ElbowAttemptRecord, type ElbowSessionRecord } from './elbow-session.js';
import { attemptRecordSchema, parseSessionRecord, summarizeSession, type AttemptRecord, type SessionRecord } from './reach-session.js';
import { armRaiseAttemptRecordSchema, armRaiseSessionRecordSchema, summarizeArmRaiseSession, type ArmRaiseAttemptRecord, type ArmRaiseSessionRecord } from './arm-raise-session.js';
import { kneeExtensionAttemptRecordSchema, kneeExtensionSessionRecordSchema, summarizeKneeExtensionSession, type KneeExtensionAttemptRecord, type KneeExtensionSessionRecord } from './knee-extension-session.js';
import { legLiftAttemptRecordSchema, legLiftSessionRecordSchema, summarizeLegLiftSession, type LegLiftAttemptRecord, type LegLiftSessionRecord } from './leg-lift-session.js';
import { anklePumpsAttemptRecordSchema, anklePumpsSessionRecordSchema, summarizeAnklePumpsSession, type AnklePumpsAttemptRecord, type AnklePumpsSessionRecord } from './ankle-pumps-session.js';

export type ReviewRecord =
  | SessionRecord
  | ElbowSessionRecord
  | ArmRaiseSessionRecord
  | KneeExtensionSessionRecord
  | LegLiftSessionRecord
  | AnklePumpsSessionRecord;

export type ReviewAttempt =
  | AttemptRecord
  | ElbowAttemptRecord
  | ArmRaiseAttemptRecord
  | KneeExtensionAttemptRecord
  | LegLiftAttemptRecord
  | AnklePumpsAttemptRecord;

export function parseReviewRecord(input: unknown): ReviewRecord {
  const id = typeof input === 'object' && input !== null && 'exercise' in input &&
    typeof input.exercise === 'object' && input.exercise !== null && 'id' in input.exercise ? input.exercise.id : null;
  switch (id) {
    case 'seated_elbow_flexion_extension': return elbowSessionRecordSchema.parse(input);
    case 'seated_forward_arm_raise': return armRaiseSessionRecordSchema.parse(input);
    case 'seated_knee_extension': return kneeExtensionSessionRecordSchema.parse(input);
    case 'seated_single_leg_lift': return legLiftSessionRecordSchema.parse(input);
    case 'seated_ankle_pumps': return anklePumpsSessionRecordSchema.parse(input);
    case 'seated_forward_reach': return parseSessionRecord(input);
    default: throw new Error('Unsupported exercise in saved session');
  }
}

export function parseReviewAttempt(input: unknown): ReviewAttempt {
  const id = typeof input === 'object' && input !== null && 'exerciseId' in input ? input.exerciseId : null;
  switch (id) {
    case 'seated_elbow_flexion_extension': return elbowAttemptRecordSchema.parse(input);
    case 'seated_forward_arm_raise': return armRaiseAttemptRecordSchema.parse(input);
    case 'seated_knee_extension': return kneeExtensionAttemptRecordSchema.parse(input);
    case 'seated_single_leg_lift': return legLiftAttemptRecordSchema.parse(input);
    case 'seated_ankle_pumps': return anklePumpsAttemptRecordSchema.parse(input);
    case 'seated_forward_reach': return attemptRecordSchema.parse(input);
    default: throw new Error('Unsupported exercise in saved attempt');
  }
}

export function summarizeReviewRecord(record: ReviewRecord) {
  switch (record.schemaVersion) {
    case 'elbow-session.consumer-v1': return summarizeElbowSession(record);
    case 'arm-raise-session.consumer-v2': return summarizeArmRaiseSession(record);
    case 'knee-extension-session.consumer-v2': return summarizeKneeExtensionSession(record);
    case 'leg-lift-session.consumer-v2': return summarizeLegLiftSession(record);
    case 'ankle-pumps-session.consumer-v2': return summarizeAnklePumpsSession(record);
    case 'reach-session.consumer-v1': return summarizeSession(record);
    default: return assertNever(record);
  }
}

function assertNever(value: never): never { throw new Error(`Unsupported session schema: ${String(value)}`); }
