import { describe, expect, it } from 'vitest';
import type { CaptureSnapshot } from '../features/practice/capture-controller.js';
import { emptySetup, type ExerciseId } from '../features/setup/setup-model.js';
import { EXERCISE_REQUIRED_LANDMARKS } from '../features/practice/tracking.js';
import { captureGuidance, mvpCaptureGuidance, canSaveStartingPosition, framingInstruction, trackingGuidance, primaryCaptureDisabled, REFERENCE_EXPLANATION, MEASUREMENT_EXPLANATIONS, needsImageReference } from './capture-guidance.js';

const exerciseIds: ExerciseId[] = ['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'];
function fixture(id: ExerciseId) {
  const draft = emptySetup('2026-10-25', id);
  Object.assign(draft, { mode: 'rehabilitation', participantLabel: 'Demo', supervisorLabel: 'Supervisor', attestationContext: 'Team fixture', attested: true, teamTestConfirmed: true, seatingSupport: 'Chair; no limb support', assignedRangeOrGoal: 'Assigned fixture range', targetPlacement: 'Fixed target', side: 'left', setupDirectionVerified: true });
  const snapshot: CaptureSnapshot = { phase: 'previewing', message: '', problem: false, tracking: Object.fromEntries(EXERCISE_REQUIRED_LANDMARKS[id].map((j) => [j, 'ok'])), stableMs: 1000, ready: true, resultsPerSec: null, inferenceMs: null, frameSize: { width: 640, height: 480 }, reference: [{ x: 10, y: 10 }, { x: 110, y: 10 }], baseline: true, target: { x: 200, y: 100 }, selecting: 'reference', analyzerState: null, counts: null, recordingMs: null, countdownSeconds: null };
  return { draft, snapshot };
}

describe('actionable capture guidance without relaxing measurement gates', () => {
  it.each(exerciseIds)('enables MVP video recording for %s without measurement setup', (id) => {
    const { snapshot } = fixture(id);
    const draft = emptySetup('2026-10-25', id);
    const uncalibrated = { ...snapshot, ready: false, baseline: false, reference: [], target: null, tracking: null, poseDetected: true };
    expect(mvpCaptureGuidance(uncalibrated, draft, false, false)).toMatchObject({ ready: true, recordLabel: 'Record' });
    expect(mvpCaptureGuidance({ ...uncalibrated, poseDetected: false }, draft, false, false).ready).toBe(false);
    expect(mvpCaptureGuidance({ ...uncalibrated, phase: 'closed' }, draft, false, false).recordLabel).toBe('Open camera');
  });
  it('enables camera retry after permission denial without claiming joints are out of frame', () => {
    const { draft, snapshot } = fixture('seated_forward_reach');
    const denied: CaptureSnapshot = { ...snapshot, phase: 'closed', tracking: null, problem: true, message: 'Camera permission denied.', ready: false };
    expect(primaryCaptureDisabled(denied)).toBe(false);
    expect(captureGuidance(denied, draft, false, false)).toMatchObject({ ready: false, recordLabel: 'Open camera' });
    expect(trackingGuidance(denied, draft)).toContain('Camera is not running');
    expect(trackingGuidance(denied, draft)).not.toContain('not clearly visible');
    expect(canSaveStartingPosition(denied, draft.exerciseId)).toBe(false);
    expect(primaryCaptureDisabled({ ...denied, phase: 'opening' })).toBe(true);
    expect(primaryCaptureDisabled({ ...denied, phase: 'idle' })).toBe(false);
    expect(trackingGuidance({ ...snapshot, tracking: null }, draft)).toContain('Waiting for the first');
    expect(trackingGuidance({ ...denied, phase: 'opening' }, draft)).toContain('Opening the camera');
  });
  it.each(exerciseIds)('requires current tracking, calibration and confirmations for %s', (id) => {
    const { draft, snapshot } = fixture(id);
    expect(captureGuidance(snapshot, draft, true, true).ready).toBe(true);
    expect(captureGuidance(snapshot, draft, false, true).ready).toBe(false);
    expect(captureGuidance(snapshot, draft, true, false).focusId).toBe('setup-confirmed');
    expect(captureGuidance({ ...snapshot, ready: false }, draft, true, true).ready).toBe(false);
    expect(captureGuidance({ ...snapshot, phase: 'closed' }, draft, true, true).focusId).toBe('btn-retry-camera');
    const required = EXERCISE_REQUIRED_LANDMARKS[id][0];
    const missing = { ...snapshot, tracking: { ...snapshot.tracking, [required]: 'out_of_frame' as const } };
    expect(captureGuidance(missing, draft, true, true).focusId).toBe('tracking-status');
    expect(trackingGuidance(missing, draft)).toContain('not clearly visible');
    expect(MEASUREMENT_EXPLANATIONS[id]).toContain('local calculations');
  });

  it.each(exerciseIds)('requires only matching reference/target steps for %s', (id) => {
    const { draft, snapshot } = fixture(id);
    const noReference = { ...snapshot, reference: [] };
    expect(captureGuidance(noReference, draft, true, true).focusId === 'overlay-canvas').toBe(needsImageReference(id));
    expect(captureGuidance({ ...snapshot, baseline: false }, draft, true, true).focusId).toBe('btn-baseline');
    expect(captureGuidance({ ...snapshot, target: null }, draft, true, true).ready).toBe(id !== 'seated_forward_reach');
  });

  it.each(exerciseIds)('allows starting-position capture before recording readiness for %s', (id) => {
    const { snapshot } = fixture(id);
    const beforeBaseline = { ...snapshot, ready: false, baseline: false, target: null };
    expect(canSaveStartingPosition(beforeBaseline, id)).toBe(true);
    expect(canSaveStartingPosition({ ...beforeBaseline, stableMs: 999 }, id)).toBe(false);
    expect(canSaveStartingPosition({ ...beforeBaseline, tracking: null }, id)).toBe(false);
    expect(canSaveStartingPosition({ ...beforeBaseline, reference: [] }, id)).toBe(!needsImageReference(id));
  });

  it.each(exerciseIds)('keeps framing instructions correct after selected side changes for %s', (id) => {
    const wording = framingInstruction(id);
    expect(wording).toContain('selected side');
    expect(wording).not.toMatch(/\bleft\b|\bright\b/);
    for (const joint of EXERCISE_REQUIRED_LANDMARKS[id]) expect(wording).toContain(joint === 'footIndex' ? 'front of the foot' : joint);
  });

  it('surfaces camera and calibration problems instead of hiding why setup failed', () => {
    const { draft, snapshot } = fixture('seated_forward_reach');
    const calibrationProblem = captureGuidance({ ...snapshot, problem: true, message: 'Reference points are too close together.' }, draft, false, false);
    expect(calibrationProblem.message).toContain('Reference points are too close together.');
    expect(calibrationProblem.focusId).toBe('capture-technical-status');
    const cameraProblem = captureGuidance({ ...snapshot, phase: 'closed', problem: true, message: 'Camera permission denied.' }, draft, false, false);
    expect(cameraProblem.message).toContain('Camera permission denied.');
    expect(cameraProblem.focusId).toBe('btn-retry-camera');
    expect(cameraProblem.ready).toBe(false);
  });

  it('explains a fixed image reference without inventing physical scale', () => {
    expect(REFERENCE_EXPLANATION).toContain('two ends'); expect(REFERENCE_EXPLANATION).toContain('not a distance in centimetres');
    const { draft, snapshot } = fixture('seated_forward_reach');
    expect(captureGuidance({ ...snapshot, reference: [] }, draft, true, true).message).toContain('stationary object');
  });

  it('uses foot visibility wording and requires fresh ankle direction proof', () => {
    const { draft, snapshot } = fixture('seated_ankle_pumps');
    expect(trackingGuidance({ ...snapshot, tracking: { ...snapshot.tracking, footIndex: 'missing' } }, draft)).toContain('front of the foot');
    draft.setupDirectionVerified = false;
    expect(captureGuidance(snapshot, draft, true, true).focusId).toBe('setup-ankle-direction');
  });
});
