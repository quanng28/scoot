import { useMemo, useReducer, useRef } from 'react';
import { captureOutcomeToRecord } from '../demo/capture-outcome.js';
import { EntryScreen } from '../features/entry/EntryScreen.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import type { CaptureOutcome } from '../features/practice/capture-controller.js';
import { PracticeScreen } from '../features/practice/PracticeScreen.js';
import { ResultsScreen } from '../features/review/ResultsScreen.js';
import { SessionsScreen } from '../features/review/SessionsScreen.js';
import { SetupScreen } from '../features/setup/SetupScreen.js';
import { SessionStore, StorageError } from '../storage/session-store.js';
import { initialState, reducer, type Screen } from './state.js';

const today = () => new Date().toISOString().slice(0, 10);

export function App({ store: injected }: { store?: SessionStore }) {
  const store = useMemo(() => injected ?? new SessionStore(), [injected]);
  const [state, dispatch] = useReducer(reducer, today(), initialState);
  const setupRef = useRef(state.setup);
  setupRef.current = state.setup;
  const go = (screen: Screen) => dispatch({ type: 'navigate', screen });

  const onOutcome = (outcome: CaptureOutcome) => {
    try {
      const record = captureOutcomeToRecord(setupRef.current, outcome);

      const video = outcome.recording && outcome.recording.blob.size > 0 ? outcome.recording.blob : null;
      dispatch({ type: 'session-created', record, video });
    } catch (error) {
      dispatch({ type: 'notice', message: `Capture results failed validation and are not shown as measurements: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}` });
    }
  };

  const save = () => {
    const current = state.current;
    if (!current) return;
    dispatch({ type: 'save-started' });
    store.save(current.record, current.video).then(
      ({ savedAt }) => dispatch({ type: 'save-succeeded', sessionId: current.record.sessionId, savedAt }),
      (error: unknown) => dispatch({ type: 'save-failed', sessionId: current.record.sessionId, message: error instanceof StorageError ? error.message : 'Unknown storage error; nothing was saved.' }));
  };
  const removeCurrent = () => {
    const id = state.current?.record.sessionId;
    if (!id) return;
    store.delete(id).then(() => dispatch({ type: 'session-deleted', sessionId: id }),
      (error: unknown) => dispatch({ type: 'notice', message: error instanceof StorageError ? error.message : 'Delete failed; the session was not removed.' }));
  };
  const open = async (id: string) => {
    const loaded = await store.load(id);
    dispatch({ type: 'session-opened', record: loaded.record, video: loaded.video, videoProblem: loaded.videoProblem, savedAt: loaded.savedAt });
  };

  const newSetup = () => {
    const current = state.current;
    if (current) dispatch({ type: 'select-exercise', exerciseId: current.record.exercise.id, today: today() });
  };

  return (
    <main>
      <header className="topbar"><button type="button" className="link" onClick={() => go('entry')}>Seated exercise review</button><span className="muted">Local prototype · supervised use</span></header>
      {state.notice && state.screen !== 'sessions' && <p className="status status-problem" role="alert">{state.notice}</p>}
      {state.screen === 'entry' && <EntryScreen onSelectExercise={(exerciseId) => dispatch({ type: 'select-exercise', exerciseId, today: today() })} onSessions={() => go('sessions')}
        onFixture={() => dispatch({ type: 'session-created', record: syntheticReachSession(crypto.randomUUID()), video: null })} />}
      {state.screen === 'setup' && <SetupScreen draft={state.setup} dispatch={dispatch} onContinue={() => go('practice')} onBack={() => go('entry')} />}
      {state.screen === 'practice' && <PracticeScreen draft={state.setup} onOutcome={onOutcome} onBack={() => go('setup')}
        onMirrorChange={(previewMirrored) => dispatch({ type: 'setup', patch: { previewMirrored } })} />}
      {state.screen === 'results' && state.current && <ResultsScreen current={state.current} dispatch={dispatch} onSave={save} onDelete={removeCurrent} onHome={() => go('entry')}
        onNewSession={state.current.record.provenance.kind === 'developer_validation_capture' && state.current.save.kind === 'saved' ? newSetup : null} />}
      {state.screen === 'sessions' && <SessionsScreen store={store} notice={state.notice} onOpen={open} onHome={() => go('entry')}
        onDeleted={(id) => dispatch({ type: 'session-deleted', sessionId: id })} />}
    </main>
  );
}

export { captureOutcomeToRecord } from '../demo/capture-outcome.js';
