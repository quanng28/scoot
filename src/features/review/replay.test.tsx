// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CurrentSession } from '../../app/state.js';
import { syntheticReachSession } from '../fixtures/synthetic-reach.js';
import { ResultsScreen } from './ResultsScreen.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps measurements and flags while decoded video independently gates live replay', () => {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:local-test', revokeObjectURL: vi.fn() });
  const record = syntheticReachSession('replay-fixture', new Date('2026-10-25T12:00:00Z'));
  record.recording = { status: 'complete', mimeType: 'video/mp4', sizeBytes: 10, durationMs: 9000, reason: null, timing: 'estimated_recorder_start' };
  const current: CurrentSession = { record, video: new Blob(['test-video'], { type: 'video/mp4' }), videoProblem: null, save: { kind: 'unsaved' } };
  const noop = () => undefined;
  render(<ResultsScreen current={current} dispatch={noop} onSave={noop} onDelete={noop} onNewSession={null} onHome={noop} />);
  const player = screen.getByTestId('replay');
  const summary = screen.getByRole('heading', { name: 'Summary' });
  const scroll = vi.fn(); Object.defineProperty(summary, 'scrollIntoView', { value: scroll });
  expect(player.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View report' }));
  expect(scroll).toHaveBeenCalledOnce();
  expect(screen.getByTestId('replay')).toBe(player);
  Object.defineProperty(player, 'duration', { configurable: true, value: 0.1 });
  fireEvent.loadedData(player);
  expect(screen.queryByRole('button', { name: /Replay attempt/ })).toBeNull();
  expect(screen.getByTestId('summary-counts').textContent).toContain('4 detected attempts = 3 measurable + 1 excluded');
  expect(screen.getByText(/Torso change 12\.0° exceeded the configured > 10° review criterion/)).toBeTruthy();
  Object.defineProperty(player, 'duration', { configurable: true, value: 9 });
  fireEvent.durationChange(player);
  expect(screen.getAllByRole('button', { name: /Replay attempt/ })).toHaveLength(4);
  Object.defineProperty(player, 'duration', { configurable: true, value: Infinity });
  fireEvent.durationChange(player);
  expect(screen.queryByRole('button', { name: /Replay attempt/ })).toBeNull();
});
