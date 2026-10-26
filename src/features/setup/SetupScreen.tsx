import type { Dispatch } from 'react';
import type { Action } from '../../app/state.js';
import { exerciseName, setupErrors, type SetupDraft } from './setup-model.js';

type Props = { draft: SetupDraft; dispatch: Dispatch<Action>; onContinue: () => void; onBack: () => void };

const isLegExercise = (id: SetupDraft['exerciseId']) =>
  id === 'seated_knee_extension' || id === 'seated_single_leg_lift' || id === 'seated_ankle_pumps';

export function SetupScreen({ draft, dispatch, onContinue, onBack }: Props) {
  const errors = setupErrors(draft);
  const set = (patch: Partial<SetupDraft>) => dispatch({ type: 'setup', patch });
  const text = (key: 'participantLabel' | 'taskLabel' | 'supervisorLabel' | 'attestationContext' | 'seatingSupport' | 'targetPlacement' | 'assignedRangeOrGoal', label: string, hint?: string) => (
    <label className="field">{label}{hint && <span className="hint">{hint}</span>}
      <input value={draft[key]} maxLength={key === 'attestationContext' ? 500 : 300} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );

  return (
    <section aria-labelledby="setup-title">
      <p className="badge badge-dev">Developer/judge validation · experimental · not participant use</p>
      {draft.exerciseId === 'seated_ankle_pumps' && (
        <p className="badge" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffeeba' }}>
          Gated Feasibility: Close-view physical iPhone trial pending. Automatic measurement remains gated; developer validation does not establish participant readiness.
        </p>
      )}
      <h1 id="setup-title">{exerciseName(draft.exerciseId)} setup</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (!errors.length) onContinue(); }}>
        <fieldset>
          <legend>Session mode</legend>
          {(['rehabilitation', 'wellness'] as const).map((mode) => (
            <label key={mode} className="choice"><input type="radio" name="mode" checked={draft.mode === mode} onChange={() => set({ mode })} />{mode === 'rehabilitation' ? 'Rehabilitation' : 'Wellness'}</label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Labels</legend>
          {text('participantLabel', 'Pseudonymous participant label', 'No real names or medical identifiers.')}
          {text('taskLabel', 'Task label')}
        </fieldset>
        <fieldset>
          <legend>Suitability attestation</legend>
          {text('supervisorLabel', 'Pseudonymous supervisor label')}
          <label className="field">Attestation date<input type="date" value={draft.attestationDate} onChange={(e) => set({ attestationDate: e.target.value })} /></label>
          {text('attestationContext', 'Context', 'For example: team engineering test, judge demonstration.')}
          <label className="choice"><input type="checkbox" checked={draft.attested} onChange={(e) => set({ attested: e.target.checked })} />
            The supervisor reports this seated activity is suitable for this person. This is an unverified local record, not identity verification or medical clearance.</label>
        </fieldset>
        <fieldset>
          <legend>Assignment</legend>
          <div className="row">
            {(['left', 'right'] as const).map((side) => (
              <label key={side} className="choice"><input type="radio" name="side" checked={draft.side === side} onChange={() => set({ side })} />{side === 'left' ? (isLegExercise(draft.exerciseId) ? 'Left leg' : 'Left arm') : (isLegExercise(draft.exerciseId) ? 'Right leg' : 'Right arm')}</label>
            ))}
          </div>
          {text('seatingSupport', isLegExercise(draft.exerciseId) ? 'Seating and leg support' : 'Seating and arm support', 'Include “none” when unsupported.')}

          {draft.exerciseId === 'seated_forward_reach' && text('targetPlacement', 'Fixed target placement', 'The target must stay in place for the whole session.')}

          {draft.exerciseId === 'seated_elbow_flexion_extension' && <>
            <label className="field">Bend endpoint (degrees)<input type="number" min="0" max="180" step="any" value={draft.elbowEndpointDeg}
              onChange={(e) => set({ elbowEndpointDeg: e.target.value })} /></label>
            <label className="field">Image forward direction<select value={draft.elbowForwardSign} onChange={(e) => set({ elbowForwardSign: e.target.value === '-1' ? -1 : 1 })}>
              <option value={1}>Image right</option><option value={-1}>Image left</option></select></label>
          </>}

          {draft.exerciseId === 'seated_forward_arm_raise' && <>
            <label className="field">Endpoint driver<select value={draft.armRaiseDriver} onChange={(e) => set({ armRaiseDriver: e.target.value === 'wristElevation' ? 'wristElevation' : 'upperArmAngle' })}>
              <option value="upperArmAngle">Upper-arm-to-trunk angle (degrees)</option>
              <option value="wristElevation">Wrist elevation (reference lengths)</option>
            </select></label>
            {draft.armRaiseDriver === 'upperArmAngle' ? (
              <label className="field">Raised angle endpoint (degrees)<input type="number" min="0" max="180" step="any" value={draft.armRaiseEndpointDeg}
                onChange={(e) => set({ armRaiseEndpointDeg: e.target.value })} /></label>
            ) : (
              <label className="field">Wrist elevation endpoint (reference lengths)<input type="number" min="0.1" max="3" step="0.05" value={draft.armRaiseEndpointElevation}
                onChange={(e) => set({ armRaiseEndpointElevation: e.target.value })} /></label>
            )}
            <label className="field">Image forward direction<select value={draft.armRaiseForwardSign} onChange={(e) => set({ armRaiseForwardSign: e.target.value === '-1' ? -1 : 1 })}>
              <option value={1}>Image right</option><option value={-1}>Image left</option></select></label>
          </>}

          {draft.exerciseId === 'seated_knee_extension' && <>
            <label className="field">Extension angle endpoint (degrees)<input type="number" min="0" max="180" step="any" value={draft.kneeEndpointDeg}
              onChange={(e) => set({ kneeEndpointDeg: e.target.value })} /></label>
          </>}

          {draft.exerciseId === 'seated_single_leg_lift' && <>
            <label className="field">Knee lift elevation endpoint (reference lengths)<input type="number" min="0.05" max="2" step="0.05" value={draft.legLiftEndpointElevation}
              onChange={(e) => set({ legLiftEndpointElevation: e.target.value })} /></label>
            <label className="field">Image forward direction<select value={draft.legLiftForwardSign} onChange={(e) => set({ legLiftForwardSign: e.target.value === '-1' ? -1 : 1 })}>
              <option value={1}>Image right</option><option value={-1}>Image left</option></select></label>
          </>}

          {draft.exerciseId === 'seated_ankle_pumps' && <>
            <label className="field">Pump excursion endpoint (degrees)<input type="number" min="1" max="90" step="any" value={draft.ankleEndpointDeg}
              onChange={(e) => set({ ankleEndpointDeg: e.target.value })} /></label>
            <label className="field">Image forward direction<select value={draft.ankleForwardSign} onChange={(e) => set({ ankleForwardSign: e.target.value === '-1' ? -1 : 1, setupDirectionVerified: false })}>
              <option value={1}>Toes point right (Image right)</option>
              <option value={-1}>Toes point left (Image left)</option>
            </select></label>
            <label className="field">Prescribed pump direction<select value={draft.ankleDirectionSign} onChange={(e) => set({ ankleDirectionSign: e.target.value === '-1' ? -1 : 1, setupDirectionVerified: false })}>
              <option value={1}>Positive calibrated signed change</option>
              <option value={-1}>Negative calibrated signed change</option>
            </select></label>
            <label className="choice"><input type="checkbox" checked={draft.setupDirectionVerified} onChange={(event) => set({ setupDirectionVerified: event.target.checked })} />Supervisor verified this prescribed direction against a labeled small setup motion in the unmirrored analysis view.</label>
          </>}

          {text('assignedRangeOrGoal', 'Clinician-assigned range or goal')}
        </fieldset>

        <fieldset>
          <legend>Review criteria (optional)</legend>
          <p className="hint">A flag only requests review. Thresholds here are entered for this test; none is a clinical default. With no criteria enabled there are no automatic flags.</p>
          {draft.criteria.map((c, index) => (
            <div key={c.metric} className="criterion">
              <label className="choice"><input type="checkbox" checked={c.enabled} onChange={(e) => dispatch({ type: 'criterion', index, patch: { enabled: e.target.checked } })} />{c.label}</label>
              <select aria-label={`${c.label} comparison`} value={c.operator} disabled={!c.enabled} onChange={(e) => dispatch({ type: 'criterion', index, patch: { operator: e.target.value === '<' ? '<' : '>' } })}>
                <option value=">">greater than</option><option value="<">less than</option>
              </select>
              <input aria-label={`${c.label} threshold`} inputMode="decimal" value={c.threshold} disabled={!c.enabled} onChange={(e) => dispatch({ type: 'criterion', index, patch: { threshold: e.target.value } })} />
              <span className="unit">{c.unit}</span>
            </div>
          ))}
        </fieldset>

        <fieldset>
          <legend>Camera</legend>
          <label className="field">Camera<select value={draft.cameraFacing} onChange={(e) => set({ cameraFacing: e.target.value === 'user' ? 'user' : 'environment' })}>
            <option value="environment">Rear camera</option><option value="user">Front camera</option></select></label>
          <label className="field">Pose compute<select value={draft.delegate} onChange={(e) => set({ delegate: e.target.value === 'GPU' ? 'GPU' : 'CPU' })}>
            <option value="CPU">CPU</option><option value="GPU">GPU (experimental)</option></select></label>
          <label className="choice"><input type="checkbox" checked={draft.previewMirrored} onChange={(e) => set({ previewMirrored: e.target.checked })} />Mirror the preview (display only; measurement side is unchanged)</label>
        </fieldset>
        <label className="choice"><input type="checkbox" checked={draft.teamTestConfirmed} onChange={(e) => set({ teamTestConfirmed: e.target.checked })} />
          This is a suitable, consenting team member or judge test, not a participant session.</label>
        {errors.length > 0 && (
          <div className="problems" role="status"><p>Complete these items before camera setup:</p><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        <div className="actions">
          <button type="button" onClick={onBack}>Back</button>
          <button type="submit" className="primary" disabled={errors.length > 0}>Continue to camera setup</button>
        </div>
      </form>
    </section>
  );
}
