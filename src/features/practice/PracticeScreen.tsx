import { useEffect, useRef, useState } from 'react';
import { STATE_TEXT, formatSeconds } from '../review/format.js';
import {
  READINESS,
  buildElbowConfig,
  buildReachConfig,
  buildArmRaiseConfig,
  buildKneeExtensionConfig,
  buildLegLiftConfig,
  buildAnklePumpsConfig,
  exerciseName,
  setupErrors,
  type SetupDraft,
} from '../setup/setup-model.js';
import { CaptureController, type AnyConfig, type CaptureOutcome, type CaptureSnapshot } from './capture-controller.js';
import { EXERCISE_REQUIRED_LANDMARKS, JOINT_STATUS_TEXT } from './tracking.js';

type Props = { draft: SetupDraft; onOutcome: (outcome: CaptureOutcome) => void; onBack: () => void; onMirrorChange: (mirrored: boolean) => void };

const needsReference = (id: SetupDraft['exerciseId']) => id === 'seated_forward_reach' || id === 'seated_forward_arm_raise' || id === 'seated_single_leg_lift';
const isLegExercise = (id: SetupDraft['exerciseId']) =>
  id === 'seated_knee_extension' || id === 'seated_single_leg_lift' || id === 'seated_ankle_pumps';

export function PracticeScreen({ draft, onOutcome, onBack, onMirrorChange }: Props) {
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const outcomeRef = useRef(onOutcome);
  outcomeRef.current = onOutcome;
  const [controller] = useState(() => new CaptureController((s) => setSnap(s), (o) => outcomeRef.current(o)));
  const [snap, setSnap] = useState<CaptureSnapshot>(controller.snapshot);
  const [confirmed, setConfirmed] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (video.current && canvas.current) controller.attach(video.current, canvas.current);
    return () => controller.close('Capture view closed. Camera tracks released.');
  }, [controller]);

  useEffect(() => { setConfirmed(false); }, [snap.reference.length, snap.baseline, snap.target]);

  const live = snap.phase === 'previewing' || snap.phase === 'recording';
  const recording = snap.phase === 'recording' || snap.phase === 'finalizing';
  const canStart = snap.phase === 'previewing' && snap.ready && confirmed && setupErrors(draft).length === 0;
  const side = draft.side === 'right' ? 'right' : 'left';
  const requiredLandmarks = EXERCISE_REQUIRED_LANDMARKS[draft.exerciseId];

  const start = () => {
    setStartError(null);
    const calibration = controller.calibration();
    if (!calibration) { setStartError('Calibration is incomplete.'); return; }
    try {
      let config: AnyConfig | null = null;
      if (draft.exerciseId === 'seated_forward_reach' && calibration.kind === 'reach') {
        config = buildReachConfig(draft, calibration, crypto.randomUUID());
      } else if (draft.exerciseId === 'seated_elbow_flexion_extension' && calibration.kind === 'elbow') {
        config = buildElbowConfig(draft, calibration, crypto.randomUUID());
      } else if (draft.exerciseId === 'seated_forward_arm_raise' && calibration.kind === 'arm_raise') {
        config = buildArmRaiseConfig(draft, calibration, crypto.randomUUID());
      } else if (draft.exerciseId === 'seated_knee_extension' && calibration.kind === 'knee_extension') {
        config = buildKneeExtensionConfig(draft, calibration, crypto.randomUUID());
      } else if (draft.exerciseId === 'seated_single_leg_lift' && calibration.kind === 'leg_lift') {
        config = buildLegLiftConfig(draft, calibration, crypto.randomUUID());
      } else if (draft.exerciseId === 'seated_ankle_pumps' && calibration.kind === 'ankle_pumps') {
        config = buildAnklePumpsConfig(draft, calibration, crypto.randomUUID());
      }
      if (!config) { setStartError('Calibration type mismatch.'); return; }
      const error = controller.start(config, draft.seatingSupport);
      if (error) setStartError(error);
    } catch (e) { setStartError(e instanceof Error ? e.message : 'Could not start.'); }
  };

  const steps: [boolean, string][] = [
    [live, draft.exerciseId === 'seated_ankle_pumps'
      ? 'Position the device close to the foot and lower leg for a close side view. Keep knee, ankle, heel and toes in frame.'
      : `Place the device on a stable support with a fixed side view of the seated person. Keep required landmarks in frame (${requiredLandmarks.join(', ')}).`],
    ...(needsReference(draft.exerciseId) ? [[snap.reference.length === 2, 'Tap two separated points on a fixed object to set the reference length.'] as [boolean, string]] : []),
    [snap.baseline, 'Hold the resting position still for at least one second, then capture the resting baseline.'],
    ...(draft.exerciseId === 'seated_forward_reach' ? [[!!snap.target, 'Tap the fixed reach target in the image.'] as [boolean, string]] : []),
    [confirmed, 'Supervisor confirms seating, support, camera framing and task alignment.'],
    [snap.ready, `All required landmarks (${requiredLandmarks.join(', ')}) tracked for ${READINESS.windowMs / 1000} s (engineering readiness, not a clinical check).`],
  ];

  return (
    <section aria-labelledby="practice-title">
      <p className="badge badge-dev">Developer/judge validation · experimental · not participant use</p>
      {draft.exerciseId === 'seated_ankle_pumps' && (
        <p className="badge" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffeeba' }}>
          Gated Feasibility: Close-view physical iPhone trial pending. Automatic measurement remains gated; developer validation does not establish participant readiness.
        </p>
      )}
      <h1 id="practice-title">{exerciseName(draft.exerciseId)} camera setup and practice</h1>
      <p className="muted">{draft.mode === 'wellness' ? 'Wellness' : 'Rehabilitation'} · {draft.participantLabel} · {side} {isLegExercise(draft.exerciseId) ? 'leg' : 'arm'} · {draft.seatingSupport}</p>

      <div className="actions">
        {!live && !recording && <button type="button" className="primary" disabled={snap.phase === 'opening'}
          onClick={() => void controller.open({ facing: draft.cameraFacing, delegate: draft.delegate, mirrored: draft.previewMirrored, side, exerciseId: draft.exerciseId })}>Open camera</button>}
        {snap.phase === 'previewing' && <button type="button" onClick={() => controller.close()}>Stop camera</button>}
        {snap.phase === 'previewing' && <button type="button" onClick={() => controller.resetSetup()}>Reset setup</button>}
        {!recording && <button type="button" onClick={onBack}>Back to setup</button>}
      </div>
      <p className={snap.problem ? 'status status-problem' : 'status'} role="status" aria-live="polite" id="capture-status">{snap.message}</p>

      <div className="preview">
        <video ref={video} autoPlay muted playsInline aria-label="Camera preview" />
        <canvas ref={canvas} data-testid="overlay" aria-label={needsReference(draft.exerciseId) ? 'Tap to place fixed reference points (and reach target for reach only)' : 'Landmark overlay'}
          onClick={(e) => controller.tap(e.clientX, e.clientY)} />
      </div>
      <label className="choice"><input type="checkbox" checked={draft.previewMirrored} disabled={recording || snap.phase === 'opening'}
        onChange={(event) => { controller.setMirrored(event.target.checked); onMirrorChange(event.target.checked); }} />Mirror camera preview (display only; anatomical side is preserved)</label>
      {snap.resultsPerSec !== null && <p className="muted">{snap.frameSize?.width}×{snap.frameSize?.height} · {snap.resultsPerSec.toFixed(1)} pose results/s · {snap.inferenceMs?.toFixed(0)} ms inference · {draft.delegate} · Lite model</p>}
      <p className="muted">Green: body skeleton. Pink: hands/feet tracking. Keep your required joints in frame and clearly visible. Mirroring changes preview only; saved video and analysis use original camera view.</p>

      {!recording && (
        <>
          <ol className="steps">{steps.map(([done, label]) => <li key={label} className={done ? 'done' : ''}><span className="sr-only">{done ? 'Done: ' : 'To do: '}</span>{label}</li>)}</ol>
          <div className="actions">
            <button type="button" disabled={snap.phase !== 'previewing' || (needsReference(draft.exerciseId) && snap.reference.length !== 2)} onClick={() => controller.captureBaseline()}>Capture resting baseline</button>
          </div>
          <label className="choice"><input type="checkbox" checked={confirmed} disabled={draft.exerciseId === 'seated_forward_reach' ? !snap.target : !snap.baseline} onChange={(e) => setConfirmed(e.target.checked)} />
            Supervisor confirms setup. Visible joints alone do not confirm correct seating or camera alignment.</label>
        </>
      )}

      <h2>Tracking status ({side} side)</h2>
      <ul className="tracking" aria-label="Required landmark tracking">
        {requiredLandmarks.map((joint) => {
          const status = snap.tracking?.[joint];
          return <li key={joint} className={status ? `track-${status}` : ''}><span className="joint">{joint}</span> {status ? JOINT_STATUS_TEXT[status] : 'No tracking'}</li>;
        })}
      </ul>
      {!recording && snap.tracking && <p className="muted">Stable for {(Math.min(snap.stableMs, READINESS.windowMs) / 1000).toFixed(1)} of {READINESS.windowMs / 1000} s.</p>}

      {recording ? (
        <div className="live-panel">
          <p className="state" data-testid="analyzer-state">{snap.analyzerState ? draft.exerciseId === 'seated_forward_reach' ? STATE_TEXT[snap.analyzerState] ?? snap.analyzerState : snap.analyzerState : ''}</p>
          {snap.counts && <p data-testid="live-counts">{snap.counts.detected} detected · {snap.counts.measurable} measurable · {snap.counts.excluded} excluded · {snap.counts.flagged} flagged</p>}
          {snap.countdownSeconds !== null && <p role="status">Recording ends in {snap.countdownSeconds}</p>}
          {snap.recordingMs !== null && <p className="muted">Recording {formatSeconds(snap.recordingMs)} (local, maximum 60 s)</p>}
          <div className="actions big">
            <button type="button" className="primary" disabled={snap.phase !== 'recording'} onClick={() => controller.stop()}>Stop</button>
            <button type="button" className="danger" disabled={snap.phase !== 'recording'} onClick={() => controller.discomfort()}>Discomfort — stop now</button>
            <button type="button" disabled={snap.phase !== 'recording'} onClick={() => controller.reportSetupChange()}>Setup changed</button>
          </div>
          <p className="muted">Stop at any time. Do not continue through discomfort or move farther than assigned.</p>
        </div>
      ) : (
        <div className="actions big">
          <button type="button" className="primary" disabled={!canStart} onClick={start}>Start recording</button>
          {snap.phase === 'previewing' && <button type="button" className="danger" onClick={() => controller.discomfort()}>Discomfort — stop</button>}
        </div>
      )}
      {startError && <p className="status status-problem" role="alert">{startError}</p>}
      <p className="muted">If the camera, seating, support{draft.exerciseId === 'seated_forward_reach' ? ', or target' : ''} changes, choose Setup changed and calibrate again. The app cannot detect every setup change.</p>
    </section>
  );
}
