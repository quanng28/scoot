// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { ResultsScreen } from '../features/review/ResultsScreen.js';
import { SessionStore } from '../storage/session-store.js';
import { App } from './App.js';
import { initialState, reducer, type CurrentSession } from './state.js';

afterEach(cleanup);
const noop = () => undefined;
const fixtureCurrent = (): CurrentSession => ({ record: syntheticReachSession('fx', new Date('2026-10-25T12:00:00Z')), video: null, videoProblem: null, save: { kind: 'unsaved' } });

describe('entry and setup gates', () => {
  it('selects elbow independently of the task label and resets setup when switching exercises', () => {
    render(<App store={new SessionStore('ui-exercise-choice')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up seated elbow bend validation' }));
    expect(screen.getByRole('heading', { name: 'Seated elbow bend and straighten setup' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Bend endpoint (degrees)' })).toBeTruthy();
    expect(screen.queryByText('Fixed target placement')).toBeNull();
    fireEvent.change(screen.getByLabelText('Task label'), { target: { value: 'Custom label' } });
    expect(screen.getByRole('heading', { name: 'Seated elbow bend and straighten setup' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set up seated forward reach validation' }));
    expect(screen.getByRole('heading', { name: 'Seated forward reach setup' })).toBeTruthy();
    expect(screen.getByLabelText('Task label')).toHaveProperty('value', 'Seated forward reach');
  });
  it('blocks participant start and keeps the developer path separately labelled', () => {
    render(<App store={new SessionStore('ui-entry')} />);
    expect(screen.getByRole('button', { name: 'Start participant session' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText(/Needs clinical review · Needs technical validation/)).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /Set up seated forward reach validation/ }));
    expect(screen.getByRole('button', { name: 'Continue to camera setup' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Select rehabilitation or wellness explicitly/)).toBeTruthy();
  });

  it('opens the synthetic fixture with its non-live label and no replay', () => {
    render(<App store={new SessionStore('ui-fixture')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open labelled synthetic fixture' }));
    expect(screen.getByRole('note').textContent).toBe('Synthetic fixture · not a live measurement');
    expect(screen.getByTestId('summary-counts').textContent).toContain('4 detected attempts = 3 measurable + 1 excluded');
    expect(screen.getAllByText(/Replay unavailable: Synthetic fixture: no camera recording exists/).length).toBeGreaterThan(0);
  });
});

describe('results screen', () => {
  it('shows measurements with units, Unable to measure with reasons, and flags with value and threshold', () => {
    render(<ResultsScreen current={fixtureCurrent()} dispatch={noop} onSave={noop} onDelete={noop} onNewSession={null} onHome={noop} />);
    const attempts = screen.getAllByTestId('attempt');
    expect(attempts).toHaveLength(4);
    const excluded = attempts.find((a) => a.textContent!.includes('Unable to measure'))!;
    expect(within(excluded).getAllByText('Unable to measure')).toHaveLength(4);
    expect(within(excluded).getAllByText(/Sustained entry into the image target region was not observed/)).toHaveLength(5);
    expect(screen.getByText(/Torso change 12\.0° exceeded the configured > 10° review criterion/)).toBeTruthy();
    expect(screen.getByTestId('medians').textContent).toMatch(/elbow angle.*90\.0°/i);
    fireEvent.click(screen.getByRole('button', { name: 'Flagged (1)' }));
    expect(screen.getAllByTestId('attempt')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Excluded (1)' }));
    expect(screen.getAllByTestId('attempt')[0]!.textContent).toContain('Attempt 3');
  });

  it('shows no medians or percentages when nothing is measurable', () => {
    const current = fixtureCurrent();
    const reach = current.record;
    if (reach.schemaVersion !== 'reach-session.consumer-v1') throw new Error('Expected reach fixture');
    current.record = { ...reach, attempts: reach.attempts.filter((a) => a.classification === 'excluded') };
    render(<ResultsScreen current={current} dispatch={noop} onSave={noop} onDelete={noop} onNewSession={null} onHome={noop} />);
    expect(screen.getByTestId('no-measurable').textContent).toContain('No measurable repetitions');
    expect(screen.queryByTestId('medians')).toBeNull();
    expect(screen.getByTestId('summary-counts').textContent).not.toMatch(/%|of 0/);
  });

  it('labels a missing stored video as evidence unavailable', () => {
    const current = fixtureCurrent();
    current.record = { ...current.record, provenance: { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' },
      capture: { stopReason: 'STOPPED', stoppedAtMs: 9000, message: null }, recording: { status: 'complete', mimeType: 'video/webm', sizeBytes: 10, durationMs: 9000, reason: null, timing: 'estimated_recorder_start' } };
    current.videoProblem = 'The stored video is missing or unreadable. Evidence unavailable.';
    render(<ResultsScreen current={current} dispatch={noop} onSave={noop} onDelete={noop} onNewSession={null} onHome={noop} />);
    expect(screen.getByRole('alert').textContent).toContain('incomplete for review');
    expect(screen.queryByRole('button', { name: /Replay attempt/ })).toBeNull();
  });
});

describe('reducer', () => {
  it('marks edits after saving as unsaved and keeps a discomfort stop at yes', () => {
    let state = reducer(initialState('2026-10-25'), { type: 'session-opened', record: fixtureCurrent().record, video: null, videoProblem: null, savedAt: '2026-10-25T12:00:00.000Z' });
    expect(state.current!.save.kind).toBe('saved');
    state = reducer(state, { type: 'notes', notes: 'Review attempt 2' });
    expect(state.current!.save.kind).toBe('unsaved');
    const discomfort = { ...state.current!.record, capture: { ...state.current!.record.capture, stopReason: 'DISCOMFORT_STOP' as const }, discomfort: { response: 'yes' as const, reportedDuringCaptureAtMs: 10, note: '' } };
    state = reducer({ ...state, current: { ...state.current!, record: discomfort } }, { type: 'discomfort', response: 'no', note: 'resolved' });
    expect(state.current!.record.discomfort).toMatchObject({ response: 'yes', note: 'resolved' });
  });
  it('ignores save results for a session that is no longer open', () => {
    const state = reducer(initialState('2026-10-25'), { type: 'session-created', record: fixtureCurrent().record, video: null });
    expect(reducer(state, { type: 'save-succeeded', sessionId: 'other', savedAt: 'x' }).current!.save.kind).toBe('unsaved');
  });
});
