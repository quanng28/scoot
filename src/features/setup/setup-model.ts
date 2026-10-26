import { reachConfigSchema, type PixelPose, type ReachConfig } from '../../analysis/reach-contract.js';
import { developerReachConfig } from '../../capture/reach-session.js';
import { developerElbowConfig } from '../../capture/elbow-session.js';
import { developerArmRaiseConfig } from '../../capture/arm-raise-session.js';
import { developerKneeExtensionConfig } from '../../capture/knee-extension-session.js';
import { developerLegLiftConfig } from '../../capture/leg-lift-session.js';
import { developerAnklePumpsConfig } from '../../capture/ankle-pumps-session.js';
import { elbowConfigSchema, type ElbowConfig } from '../../analysis/seated-elbow.js';
import { armRaiseConfigSchema, type ArmRaiseConfig } from '../../analysis/seated-arm-raise.js';
import { kneeExtensionConfigSchema, type KneeExtensionConfig } from '../../analysis/seated-knee-extension.js';
import { legLiftConfigSchema, type LegLiftConfig } from '../../analysis/seated-single-leg-lift.js';
import { anklePumpsConfigSchema, type AnklePumpsConfig } from '../../analysis/seated-ankle-pumps.js';
import { catalog, exerciseById } from '../../catalog/catalog.js';
import { SESSION_SCHEMA_VERSION, parseSessionRecord, type AttemptRecord, type RecordingEvidence, type SessionRecord } from '../../contracts/reach-session.js';
import { elbowSessionRecordSchema, type ElbowAttemptRecord, type ElbowSessionRecord } from '../../contracts/elbow-session.js';
import { armRaiseSessionRecordSchema, type ArmRaiseAttemptRecord, type ArmRaiseSessionRecord } from '../../contracts/arm-raise-session.js';
import { kneeExtensionSessionRecordSchema, type KneeExtensionAttemptRecord, type KneeExtensionSessionRecord } from '../../contracts/knee-extension-session.js';
import { legLiftSessionRecordSchema, type LegLiftAttemptRecord, type LegLiftSessionRecord } from '../../contracts/leg-lift-session.js';
import { anklePumpsSessionRecordSchema, type AnklePumpsAttemptRecord, type AnklePumpsSessionRecord } from '../../contracts/ankle-pumps-session.js';

export type CriterionDraft = { metric: string; enabled: boolean; operator: '<' | '>'; threshold: string; label: string; unit: string };
export type ExerciseId =
  | 'seated_forward_reach'
  | 'seated_elbow_flexion_extension'
  | 'seated_forward_arm_raise'
  | 'seated_knee_extension'
  | 'seated_single_leg_lift'
  | 'seated_ankle_pumps';

export const exerciseName = (id: ExerciseId) => exerciseById(id).displayName;

export const EXERCISE_CRITERIA_METRICS: Record<ExerciseId, { metric: string; label: string; unit: string }[]> = {
  seated_forward_reach: [
    { metric: 'elbowPeakDeg', label: 'Peak projected elbow angle', unit: 'degrees' },
    { metric: 'torsoForwardPeakDeg', label: 'Peak forward torso change', unit: 'degrees' },
    { metric: 'wristForwardPeak', label: 'Peak forward wrist displacement', unit: 'reference lengths' },
    { metric: 'reachDurationSec', label: 'Reach duration', unit: 'seconds' },
  ],
  seated_elbow_flexion_extension: [
    { metric: 'minElbowDeg', label: 'Minimum elbow angle', unit: 'degrees' },
    { metric: 'bendExcursionDeg', label: 'Bend excursion', unit: 'degrees' },
    { metric: 'torsoForwardPeakDeg', label: 'Peak forward torso change', unit: 'degrees' },
    { metric: 'bendDurationSec', label: 'Bend duration', unit: 'seconds' },
    { metric: 'returnDurationSec', label: 'Return duration', unit: 'seconds' },
  ],
  seated_forward_arm_raise: [
    { metric: 'peakUpperArmAngleDeg', label: 'Peak upper-arm-to-trunk angle', unit: 'degrees' },
    { metric: 'peakWristElevation', label: 'Peak wrist elevation', unit: 'reference lengths' },
    { metric: 'torsoForwardPeakDeg', label: 'Peak forward torso change', unit: 'degrees' },
    { metric: 'raiseDurationSec', label: 'Raise duration', unit: 'seconds' },
    { metric: 'returnDurationSec', label: 'Return duration', unit: 'seconds' },
  ],
  seated_knee_extension: [
    { metric: 'peakKneeAngleDeg', label: 'Peak knee angle', unit: 'degrees' },
    { metric: 'projectedExtensionExcursionDeg', label: 'Extension excursion', unit: 'degrees' },
    { metric: 'extensionDurationSec', label: 'Extension duration', unit: 'seconds' },
    { metric: 'returnDurationSec', label: 'Return duration', unit: 'seconds' },
  ],
  seated_single_leg_lift: [
    { metric: 'peakKneeElevation', label: 'Peak knee elevation', unit: 'reference lengths' },
    { metric: 'torsoForwardPeakDeg', label: 'Peak forward torso change', unit: 'degrees' },
    { metric: 'liftDurationSec', label: 'Lift duration', unit: 'seconds' },
    { metric: 'returnDurationSec', label: 'Return duration', unit: 'seconds' },
  ],
  seated_ankle_pumps: [
    { metric: 'orientedAngleDeg', label: 'Oriented shank-to-foot angle', unit: 'degrees' },
    { metric: 'signedChangeDeg', label: 'Signed shank-to-foot change', unit: 'degrees' },
    { metric: 'peakExcursionDeg', label: 'Peak prescribed excursion', unit: 'degrees' },
    { metric: 'outwardDurationSec', label: 'Outward duration', unit: 'seconds' },
    { metric: 'returnDurationSec', label: 'Return duration', unit: 'seconds' },
  ],
};

export type SetupDraft = {
  exerciseId: ExerciseId;
  mode: 'rehabilitation' | 'wellness' | '';
  participantLabel: string;
  taskLabel: string;
  supervisorLabel: string;
  attestationDate: string;
  attestationContext: string;
  attested: boolean;
  side: 'left' | 'right' | '';
  seatingSupport: string;
  targetPlacement: string;
  assignedRangeOrGoal: string;

  // Exercise-specific config inputs
  elbowEndpointDeg: string;
  elbowForwardSign: 1 | -1;

  armRaiseDriver: 'upperArmAngle' | 'wristElevation';
  armRaiseEndpointDeg: string;
  armRaiseEndpointElevation: string;
  armRaiseForwardSign: 1 | -1;

  kneeEndpointDeg: string;

  legLiftEndpointElevation: string;
  legLiftForwardSign: 1 | -1;

  ankleEndpointDeg: string;
  ankleForwardSign: 1 | -1;
  ankleDirectionSign: 1 | -1;
  setupDirectionVerified: boolean;

  cameraFacing: 'user' | 'environment';
  delegate: 'CPU' | 'GPU';
  previewMirrored: boolean;
  teamTestConfirmed: boolean;
  criteria: CriterionDraft[];
};

/** Versioned engineering readiness gate for the Start control. Not a clinical threshold. */
export const READINESS = { version: 'reach-ui-readiness.v2', windowMs: 1000, minConfidence: 0.5 } as const;
export const DEVELOPER_LABEL = 'Developer/judge validation · experimental · not participant use' as const;
export const FIXTURE_LABEL = 'Synthetic fixture · not a live measurement' as const;

export function emptySetup(today: string, exerciseId: ExerciseId = 'seated_forward_reach'): SetupDraft {
  const metricList = EXERCISE_CRITERIA_METRICS[exerciseId] ?? EXERCISE_CRITERIA_METRICS.seated_forward_reach;
  return {
    exerciseId,
    mode: '',
    participantLabel: '',
    taskLabel: exerciseName(exerciseId),
    supervisorLabel: '',
    attestationDate: today,
    attestationContext: '',
    attested: false,
    side: '',
    seatingSupport: '',
    targetPlacement: '',
    assignedRangeOrGoal: '',
    cameraFacing: 'environment',
    delegate: 'CPU',
    previewMirrored: false,
    elbowEndpointDeg: '90',
    elbowForwardSign: 1,
    armRaiseDriver: 'upperArmAngle',
    armRaiseEndpointDeg: '90',
    armRaiseEndpointElevation: '0.8',
    armRaiseForwardSign: 1,
    kneeEndpointDeg: '150',
    legLiftEndpointElevation: '0.2',
    legLiftForwardSign: 1,
    ankleEndpointDeg: '15',
    ankleForwardSign: 1,
    ankleDirectionSign: 1,
    setupDirectionVerified: false,
    teamTestConfirmed: false,
    criteria: metricList.map((m) => ({ metric: m.metric, enabled: false, operator: '>', threshold: '', label: m.label, unit: m.unit })),
  };
}

export function parsedCriteria(draft: SetupDraft): { metric: string; operator: '<' | '>'; threshold: number }[] {
  return draft.criteria
    .filter((c) => c.enabled)
    .map((c) => ({ metric: c.metric, operator: c.operator, threshold: Number(c.threshold) }));
}

/** Every message blocks camera setup/recording until corrected (FR-03, FR-05, FR-28). */
export function setupErrors(draft: SetupDraft): string[] {
  const errors: string[] = [];
  const selected = exerciseById(draft.exerciseId);
  if (!draft.mode) errors.push('Select rehabilitation or wellness explicitly.');
  else if (!selected.supportedModeIds.includes(draft.mode)) errors.push(`${selected.displayName} is not defined for this mode.`);
  if (!draft.participantLabel.trim()) errors.push('Enter a pseudonymous participant label (no real names or medical identifiers).');
  if (!draft.taskLabel.trim()) errors.push('Enter a task label.');
  if (!draft.supervisorLabel.trim()) errors.push('Enter a pseudonymous supervisor label.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.attestationDate)) errors.push('Enter the suitability attestation date.');
  if (!draft.attestationContext.trim()) errors.push('Describe the suitability attestation context.');
  if (!draft.attested) errors.push('Record the supervisor suitability attestation.');
  if (!draft.side) errors.push('Select the assigned (measured) side.');
  if (!draft.seatingSupport.trim()) errors.push('Describe seating and support, including “none”.');
  if (draft.exerciseId === 'seated_forward_reach' && !draft.targetPlacement.trim()) errors.push('Describe the fixed target placement.');

  if (draft.exerciseId === 'seated_elbow_flexion_extension') {
    const val = Number(draft.elbowEndpointDeg);
    if (!draft.elbowEndpointDeg.trim() || !Number.isFinite(val) || val < 0 || val > 180) {
      errors.push('Enter an elbow bend endpoint from 0 to 180 degrees.');
    }
  }

  if (draft.exerciseId === 'seated_forward_arm_raise') {
    if (draft.armRaiseDriver === 'upperArmAngle') {
      const val = Number(draft.armRaiseEndpointDeg);
      if (!draft.armRaiseEndpointDeg.trim() || !Number.isFinite(val) || val < 0 || val > 180) {
        errors.push('Enter an arm raise angle endpoint from 0 to 180 degrees.');
      }
    } else {
      const val = Number(draft.armRaiseEndpointElevation);
      if (!draft.armRaiseEndpointElevation.trim() || !Number.isFinite(val) || val <= 0) {
        errors.push('Enter a positive arm raise wrist elevation endpoint (in reference lengths).');
      }
    }
  }

  if (draft.exerciseId === 'seated_knee_extension') {
    const val = Number(draft.kneeEndpointDeg);
    if (!draft.kneeEndpointDeg.trim() || !Number.isFinite(val) || val < 0 || val > 180) {
      errors.push('Enter a knee extension endpoint from 0 to 180 degrees.');
    }
  }

  if (draft.exerciseId === 'seated_single_leg_lift') {
    const val = Number(draft.legLiftEndpointElevation);
    if (!draft.legLiftEndpointElevation.trim() || !Number.isFinite(val) || val <= 0) {
      errors.push('Enter a positive knee elevation endpoint (in reference lengths).');
    }
  }

  if (draft.exerciseId === 'seated_ankle_pumps') {
    const val = Number(draft.ankleEndpointDeg);
    if (!draft.setupDirectionVerified) errors.push('Verify the prescribed ankle direction against a labeled small setup motion.');
    if (!draft.ankleEndpointDeg.trim() || !Number.isFinite(val) || val < 1 || val > 90) {
      errors.push('Enter an ankle pump endpoint from 1 to 90 degrees excursion.');
    }
  }

  if (!draft.assignedRangeOrGoal.trim()) errors.push('Record the clinician-assigned range or goal.');
  if (!draft.teamTestConfirmed) errors.push('Confirm this is a suitable, consenting team/judge validation test.');

  for (const c of draft.criteria) {
    if (!c.enabled) continue;
    if (!EXERCISE_CRITERIA_METRICS[draft.exerciseId].some((metric) => metric.metric === c.metric)) errors.push(`${c.label}: metric is unsupported for this exercise.`);
    const value = c.threshold.trim() === '' ? Number.NaN : Number(c.threshold);
    if (!Number.isFinite(value)) errors.push(`${c.label}: enter a numeric threshold or disable the criterion.`);
    else if (value < 0 && c.metric !== 'signedChangeDeg' && c.metric !== 'orientedAngleDeg') errors.push(`${c.label}: threshold cannot be negative.`);
  }
  return errors;
}

export type Calibration =
  | { kind: 'reach'; baseline: PixelPose; reference: ReachConfig['reference']; target: ReachConfig['target']; width: number; height: number }
  | { kind: 'elbow'; baseline: PixelPose; width: number; height: number }
  | { kind: 'arm_raise'; baseline: PixelPose; reference: ReachConfig['reference']; width: number; height: number }
  | { kind: 'knee_extension'; baseline: KneeExtensionConfig['baseline']; width: number; height: number }
  | { kind: 'leg_lift'; baseline: LegLiftConfig['baseline']; reference: ReachConfig['reference']; width: number; height: number }
  | { kind: 'ankle_pumps'; baseline: AnklePumpsConfig['baseline']; width: number; height: number };

export type ElbowCalibration = { baseline: PixelPose; width: number; height: number };

export function buildReachConfig(draft: SetupDraft, calibration: Extract<Calibration, { kind: 'reach' }>, sessionId: string): ReachConfig {
  if (draft.exerciseId !== 'seated_forward_reach' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const base = developerReachConfig(calibration.baseline, calibration.reference, calibration.target, calibration.width, calibration.height, draft.side, sessionId, null);
  return reachConfigSchema.parse({ ...base, mode: draft.mode, criteria: parsedCriteria(draft) });
}

export function buildElbowConfig(draft: SetupDraft, calibration: ElbowCalibration | Extract<Calibration, { kind: 'elbow' }>, sessionId: string): ElbowConfig {
  if (draft.exerciseId !== 'seated_elbow_flexion_extension' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const config = {
    ...developerElbowConfig(calibration.baseline, Number(draft.elbowEndpointDeg), draft.elbowForwardSign, calibration.width, calibration.height, draft.side, sessionId, null),
    mode: draft.mode,
    criteria: parsedCriteria(draft),
  };
  return elbowConfigSchema.parse(config);
}

export function buildArmRaiseConfig(draft: SetupDraft, calibration: Extract<Calibration, { kind: 'arm_raise' }>, sessionId: string): ArmRaiseConfig {
  if (draft.exerciseId !== 'seated_forward_arm_raise' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const config = {
    ...developerArmRaiseConfig(
      calibration.baseline,
      calibration.reference,
      draft.armRaiseDriver,
      Number(draft.armRaiseEndpointDeg),
      Number(draft.armRaiseEndpointElevation),
      draft.armRaiseForwardSign,
      calibration.width,
      calibration.height,
      draft.side,
      sessionId,
      []
    ),
    mode: draft.mode,
    criteria: parsedCriteria(draft),
  };
  return armRaiseConfigSchema.parse(config);
}

export function buildKneeExtensionConfig(draft: SetupDraft, calibration: Extract<Calibration, { kind: 'knee_extension' }>, sessionId: string): KneeExtensionConfig {
  if (draft.exerciseId !== 'seated_knee_extension' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const config = {
    ...developerKneeExtensionConfig(
      calibration.baseline,
      Number(draft.kneeEndpointDeg),
      calibration.width,
      calibration.height,
      draft.side,
      sessionId,
      []
    ),
    mode: draft.mode,
    criteria: parsedCriteria(draft),
  };
  return kneeExtensionConfigSchema.parse(config);
}

export function buildLegLiftConfig(draft: SetupDraft, calibration: Extract<Calibration, { kind: 'leg_lift' }>, sessionId: string): LegLiftConfig {
  if (draft.exerciseId !== 'seated_single_leg_lift' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const config = {
    ...developerLegLiftConfig(
      calibration.baseline,
      calibration.reference,
      Number(draft.legLiftEndpointElevation),
      draft.legLiftForwardSign,
      calibration.width,
      calibration.height,
      draft.side,
      sessionId,
      []
    ),
    mode: draft.mode,
    criteria: parsedCriteria(draft),
  };
  return legLiftConfigSchema.parse(config);
}

export function buildAnklePumpsConfig(draft: SetupDraft, calibration: Extract<Calibration, { kind: 'ankle_pumps' }>, sessionId: string): AnklePumpsConfig {
  if (draft.exerciseId !== 'seated_ankle_pumps' || setupErrors(draft).length || !draft.mode || !draft.side) throw new Error('Setup is incomplete');
  const config = {
    ...developerAnklePumpsConfig(
      calibration.baseline,
      Number(draft.ankleEndpointDeg),
      draft.ankleForwardSign,
      draft.ankleDirectionSign,
      true,
      calibration.width,
      calibration.height,
      draft.side,
      sessionId,
      []
    ),
    mode: draft.mode,
    criteria: parsedCriteria(draft),
  };
  return anklePumpsConfigSchema.parse(config);
}

export type SessionInput = {
  draft: SetupDraft; config: ReachConfig; provenance: 'developer_validation_capture' | 'labeled_synthetic_fixture';
  createdAt: string; endedAt: string; attempts: AttemptRecord[]; recording: RecordingEvidence;
  stopReason: SessionRecord['capture']['stopReason']; stoppedAtMs: number | null; message: string | null; discomfortAtMs: number | null;
};

export function buildSessionRecord(input: SessionInput): SessionRecord {
  const { draft } = input;
  if (draft.exerciseId !== 'seated_forward_reach') throw new Error('Reach session requires reach selection');
  const reach = exerciseById('seated_forward_reach');
  const fixture = input.provenance === 'labeled_synthetic_fixture';
  return parseSessionRecord({
    schemaVersion: SESSION_SCHEMA_VERSION, sessionId: input.config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: fixture ? { kind: 'labeled_synthetic_fixture', label: FIXTURE_LABEL } : { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: 'seated_forward_reach', definitionVersion: reach.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: draft.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), targetPlacement: draft.targetPlacement.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(),
      cameraFacing: fixture ? 'synthetic' : draft.cameraFacing, delegate: fixture ? 'none' : draft.delegate, previewMirrored: fixture ? false : draft.previewMirrored,
      teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS } },
    configuration: input.config,
    capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
  });
}

export function buildElbowSessionRecord(input: {
  draft: SetupDraft; config: ElbowConfig; attempts: ElbowAttemptRecord[]; recording: RecordingEvidence;
  createdAt: string; endedAt: string; stopReason: ElbowSessionRecord['capture']['stopReason']; stoppedAtMs: number | null;
  message: string | null; discomfortAtMs: number | null;
}): ElbowSessionRecord {
  const { draft, config } = input;
  if (draft.exerciseId !== 'seated_elbow_flexion_extension' || setupErrors(draft).length) throw new Error('Elbow setup is incomplete');
  const exercise = exerciseById(draft.exerciseId);
  return elbowSessionRecordSchema.parse({
    schemaVersion: 'elbow-session.consumer-v1', sessionId: config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: draft.exerciseId, definitionVersion: exercise.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: config.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(), cameraFacing: draft.cameraFacing,
      delegate: draft.delegate, previewMirrored: draft.previewMirrored, teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS } },
    configuration: config, capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
  });
}

export function buildArmRaiseSessionRecord(input: {
  draft: SetupDraft; config: ArmRaiseConfig; attempts: ArmRaiseAttemptRecord[]; recording: RecordingEvidence;
  createdAt: string; endedAt: string; stopReason: ArmRaiseSessionRecord['capture']['stopReason']; stoppedAtMs: number | null;
  message: string | null; discomfortAtMs: number | null;
}): ArmRaiseSessionRecord {
  const { draft, config } = input;
  if (draft.exerciseId !== 'seated_forward_arm_raise' || setupErrors(draft).length) throw new Error('Arm raise setup is incomplete');
  const exercise = exerciseById(draft.exerciseId);
  return armRaiseSessionRecordSchema.parse({
    schemaVersion: 'arm-raise-session.consumer-v2', sessionId: config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: draft.exerciseId, definitionVersion: exercise.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: config.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(), cameraFacing: draft.cameraFacing,
      delegate: draft.delegate, previewMirrored: draft.previewMirrored, teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS } },
    configuration: config, capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
  });
}

export function buildKneeExtensionSessionRecord(input: {
  draft: SetupDraft; config: KneeExtensionConfig; attempts: KneeExtensionAttemptRecord[]; recording: RecordingEvidence;
  createdAt: string; endedAt: string; stopReason: KneeExtensionSessionRecord['capture']['stopReason']; stoppedAtMs: number | null;
  message: string | null; discomfortAtMs: number | null;
}): KneeExtensionSessionRecord {
  const { draft, config } = input;
  if (draft.exerciseId !== 'seated_knee_extension' || setupErrors(draft).length) throw new Error('Knee extension setup is incomplete');
  const exercise = exerciseById(draft.exerciseId);
  return kneeExtensionSessionRecordSchema.parse({
    schemaVersion: 'knee-extension-session.consumer-v2', sessionId: config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: draft.exerciseId, definitionVersion: exercise.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: config.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(), cameraFacing: draft.cameraFacing,
      delegate: draft.delegate, previewMirrored: draft.previewMirrored, teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS } },
    configuration: config, capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
  });
}

export function buildLegLiftSessionRecord(input: {
  draft: SetupDraft; config: LegLiftConfig; attempts: LegLiftAttemptRecord[]; recording: RecordingEvidence;
  createdAt: string; endedAt: string; stopReason: LegLiftSessionRecord['capture']['stopReason']; stoppedAtMs: number | null;
  message: string | null; discomfortAtMs: number | null;
}): LegLiftSessionRecord {
  const { draft, config } = input;
  if (draft.exerciseId !== 'seated_single_leg_lift' || setupErrors(draft).length) throw new Error('Leg lift setup is incomplete');
  const exercise = exerciseById(draft.exerciseId);
  return legLiftSessionRecordSchema.parse({
    schemaVersion: 'leg-lift-session.consumer-v2', sessionId: config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: draft.exerciseId, definitionVersion: exercise.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: config.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(), cameraFacing: draft.cameraFacing,
      delegate: draft.delegate, previewMirrored: draft.previewMirrored, teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS } },
    configuration: config, capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
  });
}

export function buildAnklePumpsSessionRecord(input: {
  draft: SetupDraft; config: AnklePumpsConfig; attempts: AnklePumpsAttemptRecord[]; recording: RecordingEvidence;
  createdAt: string; endedAt: string; stopReason: AnklePumpsSessionRecord['capture']['stopReason']; stoppedAtMs: number | null;
  message: string | null; discomfortAtMs: number | null;
}): AnklePumpsSessionRecord {
  const { draft, config } = input;
  if (draft.exerciseId !== 'seated_ankle_pumps' || setupErrors(draft).length) throw new Error('Ankle pumps setup is incomplete');
  const exercise = exerciseById(draft.exerciseId);
  return anklePumpsSessionRecordSchema.parse({
    schemaVersion: 'ankle-pumps-session.consumer-v2', sessionId: config.sessionId, createdAt: input.createdAt, endedAt: input.endedAt,
    provenance: { kind: 'developer_validation_capture', label: DEVELOPER_LABEL },
    exercise: { id: draft.exerciseId, definitionVersion: exercise.definitionVersion, catalogSchemaVersion: catalog.schemaVersion },
    mode: config.mode, participantLabel: draft.participantLabel.trim(), taskLabel: draft.taskLabel.trim(),
    attestation: { reported: draft.attested, supervisorLabel: draft.supervisorLabel.trim(), date: draft.attestationDate, context: draft.attestationContext.trim() },
    setup: { seatingSupport: draft.seatingSupport.trim(), assignedRangeOrGoal: draft.assignedRangeOrGoal.trim(), cameraFacing: draft.cameraFacing,
      delegate: draft.delegate, previewMirrored: draft.previewMirrored, teamTestConfirmed: draft.teamTestConfirmed, supervisorSetupConfirmed: true, readiness: { ...READINESS }, gatedStatus: 'automatic_measurement_gated_pending_physical_device_trial' },
    configuration: config, capture: { stopReason: input.stopReason, stoppedAtMs: input.stoppedAtMs, message: input.message },
    discomfort: { response: input.discomfortAtMs !== null ? 'yes' : 'not_reported', reportedDuringCaptureAtMs: input.discomfortAtMs, note: '' },
    notes: '', attempts: input.attempts, recording: input.recording,
    manualLogs: [],
  });
}
