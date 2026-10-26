// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App, captureOutcomeToRecord } from '../../app/App.js';
import type { CurrentSession } from '../../app/state.js';
import { SeatedArmRaiseAnalyzer } from '../../analysis/seated-arm-raise.js';
import { SeatedKneeExtensionAnalyzer } from '../../analysis/seated-knee-extension.js';
import { SeatedSingleLegLiftAnalyzer } from '../../analysis/seated-single-leg-lift.js';
import { SeatedAnklePumpsAnalyzer } from '../../analysis/seated-ankle-pumps.js';
import { armPose, kneePose, liftPose, anklePose, reference, timing, runFixtureCycle, poseFrame } from '../../analysis/seated-exercise.test-fixtures.js';
import type { CaptureOutcome } from '../practice/capture-controller.js';
import { buildArmRaiseConfig, buildKneeExtensionConfig, buildLegLiftConfig, buildAnklePumpsConfig, emptySetup, setupErrors, exerciseName, type ExerciseId } from '../setup/setup-model.js';
import { SessionStore } from '../../storage/session-store.js';
import { EXERCISE_METRIC_MAP, getExerciseResults } from './exercise-metrics.js';
import { ResultsScreen } from './ResultsScreen.js';

// fake-indexeddb uses Node structuredClone; use its cloneable Blob before storage schemas load.
vi.hoisted(async () => {
  const { Blob } = await import('node:buffer');
  vi.stubGlobal('Blob', Blob);
});
const noOp = () => undefined;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function readyDraft(exerciseId: ExerciseId) {
  return { ...emptySetup('2026-10-25', exerciseId), mode: 'rehabilitation' as const, side: 'left' as const,
    participantLabel: 'TEAM-SYNTHETIC', supervisorLabel: 'SUPERVISOR', attestationContext: 'Synthetic integration fixture', attested: true,
    seatingSupport: 'Fixed chair, supported limb for synthetic fixture', assignedRangeOrGoal: 'Configured fixture endpoint', teamTestConfirmed: true,
    setupDirectionVerified: true };
}
const common = {
  recording: { blob: new Blob(['synthetic recording fixture'], { type: 'video/webm' }), mimeType: 'video/webm', startMs: 100, endMs: 2100, complete: true, reason: null },
  stopReason: 'STOPPED' as const, stoppedAtMs: 1500, message: null, discomfortAtMs: null,
  startedAt: '2026-10-25T12:00:00.000Z', endedAt: '2026-10-25T12:00:02.000Z', countdownCues: [], cueEvents: [],
};
/** Uses production setup/config builders and actual analyzers; the production capture bridge builds the stored record. */
function workflow(exerciseId: ExerciseId): { draft: ReturnType<typeof readyDraft>; outcome: CaptureOutcome } {
  const draft = readyDraft(exerciseId);
  const captured = { ...common, recording: { ...common.recording, blob: new Blob(['synthetic recording fixture'], { type: 'video/webm' }) } };
  const dimensions = { width: 600, height: 400 };
  switch (exerciseId) {
    case 'seated_forward_arm_raise': {
      draft.criteria[0] = { metric: 'peakUpperArmAngleDeg', enabled: true, operator: '>', threshold: '45', label: 'Angle', unit: 'degrees' };
      const config = buildArmRaiseConfig(draft, { kind: 'arm_raise', baseline: armPose(), reference, ...dimensions }, exerciseId);
      config.settings = { ...config.settings, ...timing };
      const analyzer = new SeatedArmRaiseAnalyzer(config);
      runFixtureCycle(analyzer, config, { rest: armPose(), outward: armPose(30), endpoint: armPose(90), returning: armPose(30) });
      for (const t of [1000, 1050, 1110]) analyzer.accept(poseFrame(t, armPose(30), config));
      analyzer.interrupt(1200, 'STOPPED_EARLY');
      return { draft, outcome: { ...captured, exerciseId, config, attempts: analyzer.drain() } };
    }
    case 'seated_knee_extension': {
      draft.kneeEndpointDeg = '180';
      draft.criteria[0] = { metric: 'peakKneeAngleDeg', enabled: true, operator: '>', threshold: '140', label: 'Angle', unit: 'degrees' };
      const config = buildKneeExtensionConfig(draft, { kind: 'knee_extension', baseline: kneePose(), ...dimensions }, exerciseId);
      config.settings = { ...config.settings, ...timing };
      const analyzer = new SeatedKneeExtensionAnalyzer(config);
      runFixtureCycle(analyzer, config, { rest: kneePose(), outward: kneePose(120), endpoint: kneePose(180), returning: kneePose(120) });
      for (const t of [1000, 1050, 1110]) analyzer.accept(poseFrame(t, kneePose(120), config));
      analyzer.interrupt(1200, 'STOPPED_EARLY');
      return { draft, outcome: { ...captured, exerciseId, config, attempts: analyzer.drain() } };
    }
    case 'seated_single_leg_lift': {
      draft.legLiftEndpointElevation = '0.5';
      draft.criteria[0] = { metric: 'peakKneeElevation', enabled: true, operator: '>', threshold: '0.3', label: 'Elevation', unit: 'reference lengths' };
      const config = buildLegLiftConfig(draft, { kind: 'leg_lift', baseline: liftPose(), reference, ...dimensions }, exerciseId);
      config.settings = { ...config.settings, ...timing };
      const analyzer = new SeatedSingleLegLiftAnalyzer(config);
      runFixtureCycle(analyzer, config, { rest: liftPose(), outward: liftPose(0.25), endpoint: liftPose(0.5), returning: liftPose(0.25) });
      for (const t of [1000, 1050, 1110]) analyzer.accept(poseFrame(t, liftPose(0.25), config));
      analyzer.interrupt(1200, 'STOPPED_EARLY');
      return { draft, outcome: { ...captured, exerciseId, config, attempts: analyzer.drain() } };
    }
    case 'seated_ankle_pumps': {
      draft.ankleEndpointDeg = '30';
      draft.criteria[2] = { metric: 'peakExcursionDeg', enabled: true, operator: '>', threshold: '10', label: 'Excursion', unit: 'degrees' };
      const config = buildAnklePumpsConfig(draft, { kind: 'ankle_pumps', baseline: anklePose(), ...dimensions }, exerciseId);
      config.settings = { ...config.settings, ...timing };
      const analyzer = new SeatedAnklePumpsAnalyzer(config);
      runFixtureCycle(analyzer, config, { rest: anklePose(), outward: anklePose(100), endpoint: anklePose(120), returning: anklePose(100) });
      for (const t of [1000, 1050, 1110]) analyzer.accept(poseFrame(t, anklePose(100), config));
      analyzer.interrupt(1200, 'STOPPED_EARLY');
      return { draft, outcome: { ...captured, exerciseId, config, attempts: analyzer.drain() } };
    }
    default: throw new Error('This fixture covers the four remaining exercises');
  }
}
const exercises = ['seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'] as const;

it.each(exercises)('%s follows its own setup → analyzer → results → save/reopen path', async (id) => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:local-synthetic-fixture', revokeObjectURL: vi.fn() });
  const { draft, outcome } = workflow(id);
  expect(setupErrors(draft)).toEqual([]);
  const record = captureOutcomeToRecord(draft, outcome);
  expect(record.exercise.id).toBe(id);
  expect(record.schemaVersion).toContain('consumer-v2');
  const view = getExerciseResults(record);
  expect(view.summary).toEqual({ detected: 2, measurable: 1, excluded: 1, flagged: 1 });
  expect(view.attempts[0]!.metrics.map((metric) => metric.id)).toEqual(Object.keys(EXERCISE_METRIC_MAP[id]));
  expect(view.attempts[1]!.metrics.every((metric) => metric.value === null && metric.reasons.length > 0)).toBe(true);
  const store = new SessionStore(`exercise-ui-${id}`);
  const video = outcome.recording!.blob;
  await store.save(record, video);
  store.close();
  const reopened = new SessionStore(`exercise-ui-${id}`);
  const restored = await reopened.load(id);
  expect(restored.record).toEqual(record);
  expect(restored.video?.size).toBe(video.size);
  expect((await reopened.list())[0]).toMatchObject({ exerciseId: id, readable: true, counts: view.summary });
  const current: CurrentSession = { record: restored.record, video: restored.video, videoProblem: restored.videoProblem, save: { kind: 'saved', savedAt: restored.savedAt } };
  render(<ResultsScreen current={current} dispatch={noOp} onSave={noOp} onDelete={noOp} onNewSession={null} onHome={noOp} />);
  expect(screen.getByTestId('summary-counts').textContent).toContain('2 detected attempts = 1 measurable + 1 excluded');
  const attempts = screen.getAllByTestId('attempt');
  for (const definition of Object.values(EXERCISE_METRIC_MAP[id])) expect(within(attempts[0]!).getByRole('rowheader', { name: definition.label })).toBeTruthy();
  expect(within(attempts[0]!).getByText(/exceeded the configured/).textContent).toContain('Review replay.');
  expect(within(attempts[1]!).getAllByText('Unable to measure')).toHaveLength(Object.keys(EXERCISE_METRIC_MAP[id]).length);
  const player = screen.getByTestId('replay');
  Object.defineProperty(player, 'duration', { configurable: true, value: 0.2 }); fireEvent.loadedData(player);
  expect(screen.queryByRole('button', { name: /Replay attempt/ })).toBeNull();
  Object.defineProperty(player, 'duration', { configurable: true, value: 2 }); fireEvent.durationChange(player);
  expect(screen.getAllByRole('button', { name: /Replay attempt/ })).toHaveLength(2);
  cleanup();
  render(<App store={reopened} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved sessions on this device' }));
  const openButton = await screen.findByRole('button', { name: 'Open' });
  expect(screen.getByTestId('session-row').textContent).toContain(exerciseName(id));
  fireEvent.click(openButton);
  await screen.findByRole('heading', { name: 'Session results' });
  fireEvent.click(screen.getByRole('button', { name: 'New setup for this exercise' }));
  expect(screen.getByRole('heading', { name: `${exerciseName(id)} setup` })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continue to camera setup' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Pseudonymous participant label', { exact: false })).toHaveProperty('value', '');
  await reopened.delete(id); reopened.close();
});

it.each(exercises)('%s has no invented medians when every detected attempt is excluded', (id) => {
  const { draft, outcome } = workflow(id);
  // Map/filter each discriminated branch without asserting a union to another exercise.
  const record = captureOutcomeToRecord(draft, outcome);
  record.attempts.splice(0, 1);
  const current: CurrentSession = { record, video: null, videoProblem: null, save: { kind: 'unsaved' } };
  render(<ResultsScreen current={current} dispatch={noOp} onSave={noOp} onDelete={noOp} onNewSession={null} onHome={noOp} />);
  expect(screen.getByTestId('no-measurable').textContent).toContain('No measurable repetitions');
  expect(screen.queryByTestId('medians')).toBeNull();
  expect(screen.getByTestId('summary-counts').textContent).not.toMatch(/%|of 0/);
});

it('rejects an unverified ankle direction and unsupported criteria before capture', () => {
  const draft = readyDraft('seated_ankle_pumps');
  draft.setupDirectionVerified = false;
  expect(setupErrors(draft)).toContain('Verify the prescribed ankle direction against a labeled small setup motion.');
  expect(emptySetup('2026-10-25', 'seated_ankle_pumps').setupDirectionVerified).toBe(false);
  draft.setupDirectionVerified = true;
  draft.criteria = [{ metric: 'elbowPeakDeg', enabled: true, operator: '>', threshold: '30', label: 'Wrong exercise', unit: 'degrees' }];
  expect(setupErrors(draft)).toContain('Wrong exercise: metric is unsupported for this exercise.');
});

it('never attaches an outcome to a different selected exercise', () => {
  const { outcome } = workflow('seated_knee_extension');
  expect(() => captureOutcomeToRecord(readyDraft('seated_forward_arm_raise'), outcome)).toThrow('different selected exercise');
});


it('uses circular ankle medians across the representation boundary and leaves ambiguous spreads unavailable', () => {
  const { draft, outcome } = workflow('seated_ankle_pumps');
  const record = captureOutcomeToRecord(draft, outcome);
  if (record.schemaVersion !== 'ankle-pumps-session.consumer-v2') throw new Error('Expected ankle record');
  const original = record.attempts[0]!;
  const first = structuredClone(original), second = structuredClone(original);
  second.id = `${original.id}:second`;
  first.metrics.orientedAngleDeg.value = 179;
  second.metrics.orientedAngleDeg.value = -179;
  record.attempts = [first, second];
  expect(getExerciseResults(record).medians.find((metric) => metric.id === 'orientedAngleDeg')?.value).toBe(-180);
  first.metrics.orientedAngleDeg.value = 0;
  second.metrics.orientedAngleDeg.value = 180;
  expect(getExerciseResults(record).medians.find((metric) => metric.id === 'orientedAngleDeg')?.value).toBeNull();
});
