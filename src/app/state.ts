import type { ReviewRecord } from '../contracts/review-session.js';
import type { ManualLogEntry } from '../contracts/ankle-pumps-session.js';
import { emptySetup, type CriterionDraft, type ExerciseId, type SetupDraft } from '../features/setup/setup-model.js';

export type Screen = 'entry' | 'setup' | 'practice' | 'results' | 'sessions';
/** Save status is application state, separate from measurement validity and replay evidence. */
export type SaveStatus = { kind: 'unsaved' } | { kind: 'saving' } | { kind: 'saved'; savedAt: string } | { kind: 'failed'; message: string };
export type CurrentSession = { record: ReviewRecord; video: Blob | null; videoProblem: string | null; save: SaveStatus };
export type AppState = { screen: Screen; setup: SetupDraft; current: CurrentSession | null; notice: string | null };

export type Action =
  | { type: 'navigate'; screen: Screen }
  | { type: 'select-exercise'; exerciseId: ExerciseId; today: string }
  | { type: 'setup'; patch: Partial<SetupDraft> }
  | { type: 'criterion'; index: number; patch: Partial<CriterionDraft> }
  | { type: 'session-created'; record: ReviewRecord; video: Blob | null }
  | { type: 'session-opened'; record: ReviewRecord; video: Blob | null; videoProblem: string | null; savedAt: string }
  | { type: 'notes'; notes: string }
  | { type: 'discomfort'; response: ReviewRecord['discomfort']['response']; note: string }
  | { type: 'add-manual-log'; count: number; note: string; side: 'left' | 'right' }
  | { type: 'save-started' } | { type: 'save-succeeded'; sessionId: string; savedAt: string } | { type: 'save-failed'; sessionId: string; message: string }
  | { type: 'session-deleted'; sessionId: string }
  | { type: 'notice'; message: string | null };

export function initialState(today: string): AppState {
  return { screen: 'entry', setup: emptySetup(today), current: null, notice: null };
}

const edited = (current: CurrentSession, record: ReviewRecord): CurrentSession => ({
  ...current,
  record,
  save: current.save.kind === 'saving' ? current.save : { kind: 'unsaved' },
});

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'navigate': return { ...state, screen: action.screen, notice: null };
    case 'select-exercise': return { ...state, screen: 'setup', setup: emptySetup(action.today, action.exerciseId), current: null, notice: null };
    case 'setup': return { ...state, setup: { ...state.setup, ...action.patch } };
    case 'criterion': return { ...state, setup: { ...state.setup, criteria: state.setup.criteria.map((c, i) => i === action.index ? { ...c, ...action.patch } : c) } };
    case 'session-created': return { ...state, screen: 'results', notice: null, current: { record: action.record, video: action.video, videoProblem: null, save: { kind: 'unsaved' } } };
    case 'session-opened': return { ...state, screen: 'results', notice: null, current: { record: action.record, video: action.video, videoProblem: action.videoProblem, save: { kind: 'saved', savedAt: action.savedAt } } };
    case 'notes': return state.current ? { ...state, current: edited(state.current, { ...state.current.record, notes: action.notes }) } : state;
    case 'discomfort': {
      const current = state.current;
      if (!current) return state;
      const response = current.record.capture.stopReason === 'DISCOMFORT_STOP' ? 'yes' : action.response;
      return { ...state, current: edited(current, { ...current.record, discomfort: { ...current.record.discomfort, response, note: action.note } }) };
    }
    case 'add-manual-log': {
      const current = state.current;
      if (!current || current.record.schemaVersion !== 'ankle-pumps-session.consumer-v2' || !Number.isInteger(action.count) || action.count <= 0) return state;
      const newLog: ManualLogEntry = {
        id: crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        count: action.count,
        side: action.side,
        note: action.note,
        label: 'Manual log — not a measured repetition or substitute for an unavailable analyzer',
      };
      const updatedLogs = [...current.record.manualLogs, newLog];
      return { ...state, current: edited(current, { ...current.record, manualLogs: updatedLogs }) };
    }
    case 'save-started': return state.current ? { ...state, current: { ...state.current, save: { kind: 'saving' } } } : state;
    case 'save-succeeded': return state.current?.record.sessionId === action.sessionId ? { ...state, current: { ...state.current, save: { kind: 'saved', savedAt: action.savedAt } } } : state;
    case 'save-failed': return state.current?.record.sessionId === action.sessionId ? { ...state, current: { ...state.current, save: { kind: 'failed', message: action.message } } } : state;
    case 'session-deleted': return state.current?.record.sessionId === action.sessionId ? { ...state, current: null, screen: 'sessions', notice: 'Session and its local video deleted.' } : { ...state, notice: 'Session and its local video deleted.' };
    case 'notice': return { ...state, notice: action.message };
  }
}
