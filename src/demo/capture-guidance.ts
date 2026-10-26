import type { CaptureSnapshot } from '../features/practice/capture-controller.js';
import { EXERCISE_REQUIRED_LANDMARKS, type TrackedJoint } from '../features/practice/tracking.js';
import { READINESS, setupErrors, type SetupDraft, type ExerciseId } from '../features/setup/setup-model.js';

export const JOINT_NAMES: Record<TrackedJoint, string> = { shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', hip: 'hip', knee: 'knee', ankle: 'ankle', heel: 'heel', footIndex: 'front of the foot' };
export const REFERENCE_EXPLANATION = 'In the camera picture, tap the two ends of one stationary object, such as an edge of the desk. This gives movement a fixed reference size, not a distance in centimetres. Keep that object and the camera still.';
export const needsImageReference = (id: ExerciseId): boolean => id === 'seated_forward_reach' || id === 'seated_forward_arm_raise' || id === 'seated_single_leg_lift';
/** The selected side can change before reopening preview, so setup wording stays side-neutral. */
export function framingInstruction(exerciseId: ExerciseId): string {
  const joints = EXERCISE_REQUIRED_LANDMARKS[exerciseId].map((joint) => JOINT_NAMES[joint]).join(', ');
  return `Position the camera to the side of the seated person so the ${joints} on the selected side remain in view. Check the side selector below. A close-up of the face is not enough.`;
}
export type CaptureGuidance = { ready: boolean; message: string; focusId: string; recordLabel: string };
const blocked = (message: string, focusId: string, recordLabel = 'Finish setup'): CaptureGuidance => ({ ready: false, message, focusId, recordLabel });
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export function trackingGuidance(snapshot: CaptureSnapshot, draft: SetupDraft): string {
  if (snapshot.phase === 'opening') return 'Opening the camera and loading body tracking. No joint visibility assessment is available yet.';
  if (snapshot.phase === 'idle' || snapshot.phase === 'closed') return 'Camera is not running. Allow camera access for this site in browser or app settings, then choose Open camera. Body framing can be checked once the preview appears.';
  if (!snapshot.tracking) return 'Camera preview is open. Waiting for the first body-tracking result before checking joint visibility.';
  const required = EXERCISE_REQUIRED_LANDMARKS[draft.exerciseId];
  const side = draft.side === 'right' ? 'right' : 'left';
  const missing = required.filter((joint) => snapshot.tracking?.[joint] !== 'ok');
  if (missing.length) return `Camera view: your ${side} ${list(missing.map((joint) => JOINT_NAMES[joint]))} ${missing.length === 1 ? 'is' : 'are'} not clearly visible. Move the camera back or adjust its angle to include ${list(required.map((joint) => JOINT_NAMES[joint]))}.`;
  return snapshot.stableMs >= READINESS.windowMs ? `Camera view: all required ${side}-side joints are visible and steady. This checks camera visibility, not exercise quality.`
    : 'Camera view: the required joints are visible. Hold your starting position still for one second.';
}

/** The primary control also opens/retries the camera; only in-flight operations disable it. */
export function primaryCaptureDisabled(snapshot: CaptureSnapshot): boolean {
  return snapshot.phase === 'opening' || snapshot.phase === 'recording' || snapshot.phase === 'finalizing';
}

export function mvpCaptureGuidance(snapshot: CaptureSnapshot, draft: SetupDraft, calibrated: boolean, confirmed: boolean): CaptureGuidance {
  if (snapshot.phase === 'previewing') return snapshot.poseDetected
    ? { ready: true, recordLabel: 'Record', focusId: 'btn-start-record', message: 'Ready to record. Press Record now. Measurement setup below is optional.' }
    : blocked('Waiting for MediaPipe to show the body skeleton. Recording will be available when a pose appears.', 'tracking-status', 'Waiting for MediaPipe');
  return captureGuidance(snapshot, draft, calibrated, confirmed);
}

/** Calibration precedes recording readiness; do not require snapshot.ready before a baseline exists. */
export function canSaveStartingPosition(snapshot: CaptureSnapshot, exerciseId: ExerciseId): boolean {
  return snapshot.phase === 'previewing' && snapshot.stableMs >= READINESS.windowMs
    && EXERCISE_REQUIRED_LANDMARKS[exerciseId].every((joint) => snapshot.tracking?.[joint] === 'ok')
    && (!needsImageReference(exerciseId) || snapshot.reference.length === 2);
}

/** Presentation only. The shared controller still enforces calibration/readiness before starting. */
export function captureGuidance(snapshot: CaptureSnapshot, draft: SetupDraft, calibrated: boolean, confirmed: boolean): CaptureGuidance {
  if (snapshot.phase === 'recording') return blocked('Recording locally. Stop immediately if uncomfortable.', 'btn-stop-record', 'Recording');
  if (snapshot.phase === 'finalizing') return blocked('Recording stopped. Finishing the saved video and measurements…', 'capture-status', 'Finishing');
  if (snapshot.problem && snapshot.message.trim()) return blocked(`Not recording. Setup needs attention: ${snapshot.message}`, snapshot.phase === 'closed' ? 'btn-retry-camera' : 'capture-technical-status', snapshot.phase === 'closed' ? 'Open camera' : 'Review setup issue');
  if (snapshot.phase === 'opening') return blocked('Opening the camera. Nothing is recording yet.', 'capture-status', 'Opening camera');
  if (snapshot.phase !== 'previewing') return blocked('Open the camera to begin setup. Nothing is recording yet.', 'btn-retry-camera', 'Open camera');
  const missing = EXERCISE_REQUIRED_LANDMARKS[draft.exerciseId].some((joint) => snapshot.tracking?.[joint] !== 'ok');
  if (missing) return blocked(`Not recording. ${trackingGuidance(snapshot, draft)} Check that “Measured anatomical side” matches the side facing the camera.`, 'tracking-status', 'Check camera view');
  if (needsImageReference(draft.exerciseId) && snapshot.reference.length < 2) return blocked(snapshot.reference.length === 0 ? `Not recording. Set the image reference: ${REFERENCE_EXPLANATION}` : 'Not recording. Tap the other end of the same stationary object in the camera picture.', 'overlay-canvas', 'Set image reference');
  if (!snapshot.baseline) return blocked('Not recording. Hold your assigned starting position still for one second, then choose “Save starting position”.', 'btn-baseline', 'Save starting position');
  if (draft.exerciseId === 'seated_forward_reach' && !snapshot.target) return blocked('Not recording. Tap the fixed point in the camera picture that your wrist should reach. This marks the assigned target; it does not tell you how far you should reach.', 'overlay-canvas', 'Mark reach target');
  if (draft.exerciseId === 'seated_ankle_pumps' && !draft.setupDirectionVerified) return blocked('Not recording. Confirm the assigned foot movement direction after the labelled small setup motion.', 'setup-ankle-direction');
  if (!calibrated) return blocked('Not recording. Setup could not be calibrated. Check the detailed setup message and capture a fresh starting position.', 'btn-baseline');
  if (!draft.mode) return blocked('Not recording. Choose the session mode in the setup form.', 'setup-mode');
  if (!draft.seatingSupport.trim()) return blocked('Not recording. Describe your seating and assigned limb support, including “none” if unsupported.', 'setup-support');
  if (!draft.assignedRangeOrGoal.trim()) return blocked('Not recording. Enter the assigned task range or goal.', 'setup-goal');
  if (draft.exerciseId === 'seated_forward_reach' && !draft.targetPlacement.trim()) return blocked('Not recording. Describe the fixed reach target in the setup form.', 'setup-target');
  if (!draft.attestationContext.trim()) return blocked('Not recording. Describe the supervisor’s suitability confirmation for this team demonstration.', 'setup-attestation-context');
  if (!draft.attested) return blocked('Not recording. The supervisor needs to confirm suitability for the assigned seated task.', 'setup-attested');
  if (!draft.teamTestConfirmed) return blocked('Not recording. Confirm this is a suitable, consenting team or judge demonstration.', 'setup-team');
  if (setupErrors(draft).length) return blocked('Not recording. Complete the highlighted setup requirements below.', 'setup-errors');
  if (!confirmed) return blocked('Not recording. Review the setup, then confirm the seating, camera and task alignment.', 'setup-confirmed');
  if (!snapshot.ready) return blocked('Not recording. Keep the required joints visible and hold the starting position still for one second.', 'tracking-status');
  return { ready: true, message: 'Ready to record. Press Record to start; the camera preview alone is not a recording.', focusId: 'btn-start-record', recordLabel: 'Record' };
}

export const MEASUREMENT_EXPLANATIONS: Record<ExerciseId, string> = {
  seated_forward_reach: 'During a complete reach and return, local calculations use shoulder–elbow–wrist geometry for the projected elbow angle, shoulder–hip geometry for torso change, the fixed image reference for forward wrist movement, and captured timestamps for reach time.',
  seated_elbow_flexion_extension: 'During a complete bend and straighten, local calculations use the shoulder–elbow–wrist angle for minimum elbow angle and change from the saved starting angle, shoulder–hip geometry for torso change, and captured timestamps for bend and return time.',
  seated_forward_arm_raise: 'During a complete raise and lower, local calculations use the elbow–shoulder–hip angle for arm elevation, the fixed image reference for wrist elevation, shoulder–hip geometry for torso change, and captured timestamps for raise and return time.',
  seated_knee_extension: 'During a complete extension and return, local calculations use the hip–knee–ankle angle for knee angle and change from the saved starting angle, and captured timestamps for extension and return time.',
  seated_single_leg_lift: 'During a complete lift and lower, local calculations compare knee height with the saved starting position using the fixed image reference, use shoulder–hip geometry for torso change, and captured timestamps for lift and return time.',
  seated_ankle_pumps: 'During a complete pump and return, local calculations use knee, ankle and front-of-foot geometry for the oriented shank-to-foot angle and change in the confirmed direction; heel visibility is also required. Captured timestamps provide outward and return time.',
};
