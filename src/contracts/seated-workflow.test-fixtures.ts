import { armConfig, kneeConfig, liftConfig, ankleConfig, armPose, kneePose, liftPose, anklePose, poseFrame } from '../analysis/seated-exercise.test-fixtures.js';
import type { ReachFrame } from '../analysis/reach-contract.js';
import { INDICES, type PoseFrame } from '../pose/observations.js';
import { ArmRaiseSession } from '../capture/arm-raise-session.js';
import { KneeExtensionSession } from '../capture/knee-extension-session.js';
import { LegLiftSession } from '../capture/leg-lift-session.js';
import { AnklePumpsSession } from '../capture/ankle-pumps-session.js';
import { armRaiseSessionRecordSchema, toArmRaiseAttemptRecord } from './arm-raise-session.js';
import { kneeExtensionSessionRecordSchema, toKneeExtensionAttemptRecord } from './knee-extension-session.js';
import { legLiftSessionRecordSchema, toLegLiftAttemptRecord } from './leg-lift-session.js';
import { anklePumpsSessionRecordSchema, toAnklePumpsAttemptRecord } from './ankle-pumps-session.js';

const joints = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'footIndex'] as const;
export const RECORDING_ANCHOR = 5000;

/** Independently maps normalized exercise evidence to the documented anatomical model indices. */
export function captureFrame(frame: ReachFrame, anchor = RECORDING_ANCHOR): PoseFrame {
  const points: PoseFrame['points'] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: null }));
  for (const joint of joints) {
    const point = frame.landmarks[joint];
    if (point) points[INDICES[joint] + (frame.side === 'right' ? 1 : 0)] = { x: point.x, y: point.y, visibility: point.confidence };
  }
  return { type: 'pose', sequence: frame.timestampMs + anchor, timestampMs: frame.timestampMs + anchor,
    width: frame.width, height: frame.height, inferenceMs: 3, points };
}

const phases = [
  { times: [0, 47, 109], value: 0 }, { times: [161, 213, 270], value: 1 },
  { times: [337, 389, 442, 503, 568], value: 2 }, { times: [620, 675, 729], value: 3 },
  { times: [781, 834, 889], value: 0 },
];
export function workflowFrames(pose: (phase: number) => ReachFrame['landmarks']): PoseFrame[] {
  return phases.flatMap(({ times, value }) => times.map((time) => captureFrame({ timestampMs: time,
    width: 600, height: 400, orientation: 'side-view', side: 'left', landmarks: pose(value) })));
}

export function fourCaptureFixtures(prefix = 'workflow') {
  const arm = armConfig(), knee = kneeConfig(), lift = liftConfig(), ankle = ankleConfig();
  const identified = <T extends { sessionId: string; configurationId: string }>(config: T, suffix: string): T => ({
    ...config, sessionId: `${prefix}-${suffix}`, configurationId: `${prefix}-${suffix}:setup`,
  });
  return [
    { run: new ArmRaiseSession(identified(arm, 'arm'), RECORDING_ANCHOR, 'Illustrative supported seated arm'),
      frames: workflowFrames((phase) => poseFrame(0, armPose([0, 30, 90, 45][phase]), arm).landmarks) },
    { run: new KneeExtensionSession(identified(knee, 'knee'), RECORDING_ANCHOR, 'Illustrative seated leg support'),
      frames: workflowFrames((phase) => poseFrame(0, kneePose([90, 120, 180, 130][phase]), knee).landmarks) },
    { run: new LegLiftSession(identified(lift, 'lift'), RECORDING_ANCHOR, 'Illustrative seated leg support'),
      frames: workflowFrames((phase) => poseFrame(0, liftPose([0, 0.25, 0.5, 0.3][phase]), lift).landmarks) },
    { run: new AnklePumpsSession(identified(ankle, 'ankle'), RECORDING_ANCHOR, 'Illustrative supported shank and foot'),
      frames: workflowFrames((phase) => poseFrame(0, anklePose([90, 100, 120, 105][phase]), ankle).landmarks) },
  ] as const;
}

function metadata(sessionId: string) {
  return {
    sessionId, createdAt: '2026-10-25T12:00:00Z', endedAt: '2026-10-25T12:00:01Z',
    provenance: { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' },
    mode: 'rehabilitation', participantLabel: 'Synthetic team fixture', taskLabel: 'Synthetic seated workflow fixture',
    attestation: { reported: true, supervisorLabel: 'Synthetic supervisor', date: '2026-10-25', context: 'Fictional setup fixture, no participant use' },
    setup: { seatingSupport: 'Illustrative seated support', assignedRangeOrGoal: 'Illustrative configured endpoint', cameraFacing: 'environment',
      delegate: 'CPU', previewMirrored: false, teamTestConfirmed: true, supervisorSetupConfirmed: true,
      readiness: { version: 'synthetic-v2', windowMs: 100, minConfidence: 0.5 } },
    capture: { stopReason: 'STOPPED', stoppedAtMs: 890, message: null },
    discomfort: { response: 'not_reported', reportedDuringCaptureAtMs: null, note: '' }, notes: '',
    recording: { status: 'complete', mimeType: 'video/webm', sizeBytes: 5, durationMs: 1000, reason: null, timing: 'estimated_recorder_start' },
  };
}

/** Real capture adapters finalize each numeric/temporal fixture before the consumer and storage boundaries. */
export function fourWorkflowRecords(prefix = 'workflow') {
  const [arm, knee, lift, ankle] = fourCaptureFixtures(prefix);
  for (const { run, frames } of [arm, knee, lift, ankle]) {
    for (const frame of frames) run.frame(frame);
    run.tick(RECORDING_ANCHOR + 890);
    run.stop(RECORDING_ANCHOR + 890, 'STOPPED_EARLY');
  }
  const exercise = (id: string) => ({ id, definitionVersion: '1.0.0', catalogSchemaVersion: 'seated-exercise-catalog-v1' });
  const armRecord = armRaiseSessionRecordSchema.parse({ ...metadata(arm.run.config.sessionId), schemaVersion: 'arm-raise-session.consumer-v2',
    exercise: exercise('seated_forward_arm_raise'), configuration: arm.run.config, attempts: arm.run.attempts.map(toArmRaiseAttemptRecord) });
  const kneeRecord = kneeExtensionSessionRecordSchema.parse({ ...metadata(knee.run.config.sessionId), schemaVersion: 'knee-extension-session.consumer-v2',
    exercise: exercise('seated_knee_extension'), configuration: knee.run.config, attempts: knee.run.attempts.map(toKneeExtensionAttemptRecord) });
  const liftRecord = legLiftSessionRecordSchema.parse({ ...metadata(lift.run.config.sessionId), schemaVersion: 'leg-lift-session.consumer-v2',
    exercise: exercise('seated_single_leg_lift'), configuration: lift.run.config, attempts: lift.run.attempts.map(toLegLiftAttemptRecord) });
  const ankleRecord = anklePumpsSessionRecordSchema.parse({ ...metadata(ankle.run.config.sessionId), schemaVersion: 'ankle-pumps-session.consumer-v2',
    exercise: exercise('seated_ankle_pumps'), configuration: ankle.run.config, attempts: ankle.run.attempts.map(toAnklePumpsAttemptRecord),
    setup: { ...metadata(ankle.run.config.sessionId).setup, gatedStatus: 'automatic_measurement_gated_pending_physical_device_trial' }, manualLogs: [] });
  return [armRecord, kneeRecord, liftRecord, ankleRecord] as const;
}
