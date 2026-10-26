import { catalog, participantStartAllowed, readinessLabels } from '../../catalog/catalog.js';
import type { ExerciseId } from '../setup/setup-model.js';

type Props = { onSelectExercise: (id: ExerciseId) => void; onFixture: () => void; onSessions: () => void };

export function EntryScreen({ onSelectExercise, onFixture, onSessions }: Props) {
  const anyAvailable = catalog.exercises.some(participantStartAllowed);
  return (
    <section aria-labelledby="entry-title">
      <h1 id="entry-title">Seated exercise review</h1>
      <p className="lead">Records a supervised seated exercise on this device, then shows projected 2D measurements and a replay of each detected attempt for therapist review.</p>
      <ul className="facts">
        <li>Supervised use only. It does not provide acute stroke care, decide medical readiness, or score movement as correct or safe.</li>
        <li>Video, measurements, labels and notes stay in this browser. Nothing is uploaded.</li>
        <li>Prototype: measurements are estimated from a single camera and are not clinically validated.</li>
      </ul>

      <h2>Exercise catalog</h2>
      <ul className="catalog" aria-label="Exercise catalog">
        {catalog.exercises.map((entry) => (
          <li key={entry.id}>
            <span className="catalog-name">{entry.displayName}</span>
            <span className="catalog-status">{readinessLabels(entry).join(' · ')}</span>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" disabled={!anyAvailable} aria-describedby="participant-blocked">Start participant session</button>
      </div>
      {!anyAvailable && <p id="participant-blocked" className="muted">Participant sessions are blocked: no exercise has completed clinical review, technical validation and physical-device evidence.</p>}

      <h2>Developer / judge validation</h2>
      <p className="badge badge-dev">Experimental · suitable consenting team members or judges only · not participant use</p>
      <p>Choose an exercise for technical validation. Results are segregated and labelled; this path never marks an exercise available for participant use.</p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onSelectExercise('seated_forward_reach')}>Set up seated forward reach validation</button>
        <button type="button" onClick={() => onSelectExercise('seated_elbow_flexion_extension')}>Set up seated elbow bend validation</button>
        <button type="button" onClick={() => onSelectExercise('seated_forward_arm_raise')}>Set up seated forward arm raise validation</button>
        <button type="button" onClick={() => onSelectExercise('seated_knee_extension')}>Set up seated knee extension validation</button>
        <button type="button" onClick={() => onSelectExercise('seated_single_leg_lift')}>Set up seated single-leg lift validation</button>
        <button type="button" onClick={() => onSelectExercise('seated_ankle_pumps')}>Set up seated ankle pumps validation (Gated)</button>
        <button type="button" onClick={onFixture}>Open labelled synthetic fixture</button>
        <button type="button" onClick={onSessions}>Saved sessions on this device</button>
      </div>
      <p className="muted">Exercise selection is manual. No movement features are sent anywhere.</p>
    </section>
  );
}
