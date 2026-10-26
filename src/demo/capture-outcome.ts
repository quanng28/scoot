import { recordingEvidence, toAttemptRecord } from '../contracts/reach-session.js';
import { toElbowAttemptRecord } from '../contracts/elbow-session.js';
import { toArmRaiseAttemptRecord } from '../contracts/arm-raise-session.js';
import { toKneeExtensionAttemptRecord } from '../contracts/knee-extension-session.js';
import { toLegLiftAttemptRecord } from '../contracts/leg-lift-session.js';
import { toAnklePumpsAttemptRecord } from '../contracts/ankle-pumps-session.js';
import type { ReviewRecord } from '../contracts/review-session.js';
import type { CaptureOutcome } from '../features/practice/capture-controller.js';
import {
  buildElbowSessionRecord,
  buildSessionRecord,
  buildArmRaiseSessionRecord,
  buildKneeExtensionSessionRecord,
  buildLegLiftSessionRecord,
  buildAnklePumpsSessionRecord,
  type SetupDraft,
} from '../features/setup/setup-model.js';

/** Typed bridge used by live capture and save/reopen integration fixtures. */
export function captureOutcomeToRecord(draft: SetupDraft, outcome: CaptureOutcome): ReviewRecord {
  if (draft.exerciseId !== outcome.exerciseId) throw new Error('Capture belongs to a different selected exercise');
  const common = {
    draft, createdAt: outcome.startedAt, endedAt: outcome.endedAt,
    recording: recordingEvidence(outcome.recording, 'No recording was produced.'),
    stopReason: outcome.stopReason, stoppedAtMs: outcome.stoppedAtMs, message: outcome.message, discomfortAtMs: outcome.discomfortAtMs,
  };
  switch (outcome.exerciseId) {
    case 'seated_forward_reach': return buildSessionRecord({ ...common, config: outcome.config, provenance: 'developer_validation_capture', attempts: outcome.attempts.map(toAttemptRecord) });
    case 'seated_elbow_flexion_extension': return buildElbowSessionRecord({ ...common, config: outcome.config, attempts: outcome.attempts.map(toElbowAttemptRecord) });
    case 'seated_forward_arm_raise': return buildArmRaiseSessionRecord({ ...common, config: outcome.config, attempts: outcome.attempts.map(toArmRaiseAttemptRecord) });
    case 'seated_knee_extension': return buildKneeExtensionSessionRecord({ ...common, config: outcome.config, attempts: outcome.attempts.map(toKneeExtensionAttemptRecord) });
    case 'seated_single_leg_lift': return buildLegLiftSessionRecord({ ...common, config: outcome.config, attempts: outcome.attempts.map(toLegLiftAttemptRecord) });
    case 'seated_ankle_pumps': return buildAnklePumpsSessionRecord({ ...common, config: outcome.config, attempts: outcome.attempts.map(toAnklePumpsAttemptRecord) });
  }
  const unsupported: never = outcome;
  throw new Error(`Unsupported capture: ${String(unsupported)}`);
}
