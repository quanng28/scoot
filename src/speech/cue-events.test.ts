import { describe, expect, it } from 'vitest';
import type { JointStatus } from '../features/practice/tracking.js';
import { countdownCue, countdownRemaining, CueEventDeriver, stopCue, type CueSnapshot } from './cue-events.js';

const ok: Record<'shoulder' | 'elbow' | 'wrist' | 'hip', JointStatus> = { shoulder: 'ok', elbow: 'ok', wrist: 'ok', hip: 'ok' };
const base: CueSnapshot = { phase: 'previewing', tracking: ok, ready: false, reference: [], baseline: false, target: null, analyzerState: null, recordingMs: null };
const p = { x: 1, y: 1 };

describe('CueEventDeriver: real event sequences → approved cue IDs', () => {
  it('bounds transient cue eligibility to current setup and exact required-joint evidence', () => {
    const d = new CueEventDeriver('seated_forward_reach');
    expect(d.context(base).transientCueIds).toEqual(['setup.reference', 'tracking.restored']);
    const calibrated = { ...base, reference: [p, p], baseline: true, target: p, ready: true };
    expect(d.context(calibrated).transientCueIds).toEqual(['ready.record', 'tracking.restored']);
    expect(d.context({ ...calibrated, ready: false, tracking: { ...ok, wrist: 'missing' } }).transientCueIds).toEqual(['setup.confirm', 'tracking.wrist']);
    const ankle = new CueEventDeriver('seated_ankle_pumps');
    const tracking = { knee: 'ok' as const, ankle: 'ok' as const, heel: 'missing' as const, footIndex: 'ok' as const };
    expect(ankle.context({ ...base, tracking }).transientCueIds).toEqual(['setup.hold_rest', 'tracking.heel']);
    expect(ankle.context({ ...base, tracking: { ...tracking, heel: 'ok' } }).transientCueIds).not.toContain('tracking.heel');
  });

  it('walks the reach setup one step at a time, then readiness and recording start', () => {
    const d = new CueEventDeriver('seated_forward_reach');
    const seq: CueSnapshot[] = [
      base, { ...base, reference: [p] }, { ...base, reference: [p, p] }, { ...base, reference: [p, p], baseline: true },
      { ...base, reference: [p, p], baseline: true, target: p }, { ...base, reference: [p, p], baseline: true, target: p, ready: true },
      { ...base, phase: 'recording', reference: [p, p], baseline: true, target: p, ready: true, analyzerState: 'WAITING_FOR_RECORDER', recordingMs: 0 },
    ];
    expect(seq.map((s, i) => d.update(s, i * 100))).toEqual([['setup.reference'], [], ['setup.hold_rest'], ['setup.target'], ['setup.confirm'], ['ready.record'], ['recording.started']]);
  });

  it('speaks phase cues only on supported analyzer transitions, once per held target', () => {
    const d = new CueEventDeriver('seated_forward_reach');
    const rec = (analyzerState: string, recordingMs: number): CueSnapshot => ({ ...base, phase: 'recording', ready: true, analyzerState, recordingMs });
    const states = ['WAITING_FOR_RECORDER', 'REACQUIRE_REST', 'REST', 'OUTWARD', 'TARGET', 'TARGET', 'TARGET', 'RETURN', 'REST', 'OUTWARD'];
    const out = states.map((s, i) => d.update(rec(s, i * 100), i * 100));
    expect(out.flat()).toEqual(['recording.started', 'phase.rest', 'phase.target']);
  });

  it('speaks the pace cue whenever the pace monitor raises a new warning, in video-only recordings too', () => {
    const d = new CueEventDeriver('seated_forward_arm_raise');
    const rec = (paceWarnings: number, recordingMs: number): CueSnapshot => ({ ...base, phase: 'recording', analyzerState: 'VIDEO_ONLY', recordingMs, paceWarnings });
    const out = [rec(0, 0), rec(0, 100), rec(1, 200), rec(1, 300), rec(2, 400)].map((s, i) => d.update(s, i * 100));
    expect(out).toEqual([['recording.started'], [], ['pace.slow_down'], [], ['pace.slow_down']]);
  });

  it('uses the elbow wording and BEND_ENDPOINT for the elbow flow', () => {
    const d = new CueEventDeriver('seated_elbow_flexion_extension');
    const rec = (analyzerState: string): CueSnapshot => ({ ...base, phase: 'recording', ready: true, baseline: true, analyzerState, recordingMs: 0 });
    expect([rec('REACQUIRE_REST'), rec('REST'), rec('BENDING'), rec('BEND_ENDPOINT')].flatMap((s, i) => d.update(s, i))).toEqual(['recording.started', 'phase.rest_elbow', 'phase.target']);
  });

  it('debounces tracking loss: flicker is silent; sustained repeated loss speaks once; recovery once', () => {
    const d = new CueEventDeriver('seated_forward_reach');
    const rec = (wrist: JointStatus): CueSnapshot => ({ ...base, phase: 'recording', analyzerState: 'REST', recordingMs: 1000, tracking: { ...ok, wrist } });
    d.update(rec('ok'), 0);
    expect(d.update(rec('missing'), 100)).toEqual([]);
    expect(d.update(rec('ok'), 200)).toEqual([]); // flicker
    const lossFrames = Array.from({ length: 30 }, (_, i) => d.update(rec('out_of_frame'), 300 + i * 100)).flat();
    expect(lossFrames).toEqual(['tracking.wrist']); // no speech storm from 30 missing frames
    const recovery = Array.from({ length: 10 }, (_, i) => d.update(rec('ok'), 3400 + i * 100)).flat();
    expect(recovery).toEqual(['tracking.restored']);
  });

  it('names multiple lost joints together', () => {
    const d = new CueEventDeriver('seated_forward_reach');
    const s: CueSnapshot = { ...base, phase: 'recording', analyzerState: 'REST', recordingMs: 0, tracking: { ...ok, wrist: 'missing', hip: 'low_confidence' } };
    d.update(s, 0);
    expect(d.update(s, 700)).toEqual(['tracking.multiple']);
  });
});

describe('countdown and stop cues', () => {
  it('emits each final-five-second number once from the recording clock', () => {
    const ticks = [24_000, 24_950, 25_010, 25_500, 26_000, 27_200, 28_000, 29_000, 29_999, 30_000];
    const out = ticks.slice(1).map((t, i) => countdownCue(ticks[i]!, t)).filter(Boolean);
    expect(out).toEqual(['countdown.5', 'countdown.4', 'countdown.3', 'countdown.2', 'countdown.1']);
  });

  it('speaks only the latest number after a background resume and nothing at or after the limit', () => {
    expect(countdownCue(24_000, 27_500)).toBe('countdown.3');
    expect(countdownCue(29_500, 30_200)).toBeNull();
    expect(countdownCue(26_000, 25_000)).toBeNull(); // clock never runs backwards into a repeat
    expect(countdownCue(null, 26_000)).toBeNull();
  });

  it('shows 5–4–3–2–1 remaining only within the final five seconds', () => {
    expect([24_999, 25_000, 25_001, 28_500, 29_999, 30_000].map((t) => countdownRemaining(t))).toEqual([null, 5, 5, 2, 1, null]);
  });

  it('maps finalization reasons to stop sentences', () => {
    expect(stopCue('STOPPED')).toBe('stop.stopped');
    expect(stopCue('DISCOMFORT_STOP')).toBe('stop.discomfort');
    expect(stopCue('SETUP_CHANGED')).toBe('stop.interrupted');
    expect(stopCue('CAPTURE_FAILED', true)).toBe('stop.time_limit');
  });
});

const sixPhases = [
  ['seated_forward_reach', 'phase.rest', 'TARGET'],
  ['seated_elbow_flexion_extension', 'phase.rest_elbow', 'BEND_ENDPOINT'],
  ['seated_forward_arm_raise', 'phase.rest_arm_raise', 'RAISE_ENDPOINT'],
  ['seated_knee_extension', 'phase.rest_knee', 'EXTENSION_ENDPOINT'],
  ['seated_single_leg_lift', 'phase.rest_leg_lift', 'LIFT_ENDPOINT'],
  ['seated_ankle_pumps', 'phase.rest_ankle', 'PUMP_ENDPOINT'],
] as const;
describe.each(sixPhases)('%s speech follows its own analyzer', (exercise, restCue, endpoint) => {
  it('uses the matching movement instruction and only its actual held endpoint', () => {
    const deriver = new CueEventDeriver(exercise);
    const rec = (analyzerState: string): CueSnapshot => ({ ...base, phase: 'recording', tracking: null, analyzerState, recordingMs: 0 });
    const output = ['REACQUIRE_REST', 'REST', endpoint, endpoint].flatMap((state, i) => deriver.update(rec(state), i * 10));
    expect(output).toEqual(['recording.started', restCue, 'phase.target']);
    if (endpoint !== 'BEND_ENDPOINT') expect(deriver.update(rec('BEND_ENDPOINT'), 100)).not.toContain('phase.target');
  });
});

it('requests the fixed reference for arm raise and leg lift rather than elbow setup', () => {
  for (const id of ['seated_forward_arm_raise', 'seated_single_leg_lift'] as const)
    expect(new CueEventDeriver(id).update(base, 0)).toEqual(['setup.reference']);
});

it.each([
  ['seated_knee_extension', 'knee', 'tracking.knee'],
  ['seated_single_leg_lift', 'ankle', 'tracking.ankle'],
  ['seated_ankle_pumps', 'heel', 'tracking.heel'],
  ['seated_ankle_pumps', 'footIndex', 'tracking.footIndex'],
] as const)('names the required %s %s tracking loss', (exercise, joint, cue) => {
  const d = new CueEventDeriver(exercise);
  const tracking: CueSnapshot['tracking'] = { shoulder: 'ok', elbow: 'ok', wrist: 'ok', hip: 'ok', knee: 'ok', ankle: 'ok', heel: 'ok', footIndex: 'ok', [joint]: 'missing' };
  const snapshot: CueSnapshot = { ...base, phase: 'recording', tracking, analyzerState: 'REST', recordingMs: 0 };
  d.update(snapshot, 0);
  expect(d.update(snapshot, 700)).toEqual([cue]);
});
