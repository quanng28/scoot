import { afterEach, expect, it, vi } from 'vitest';
import { CaptureController, type CaptureOutcome, type VideoCaptureOutcome } from './capture-controller.js';
import { developerReachConfig } from '../../capture/reach-session.js';
import { developerElbowConfig } from '../../capture/elbow-session.js';
import type { PoseFrame } from '../../pose/observations.js';
import type { PoseJoint } from '../../analysis/reach-contract.js';
import { armPose, kneePose, liftPose, anklePose } from '../../analysis/seated-exercise.test-fixtures.js';
import { buildArmRaiseConfig, buildKneeExtensionConfig, buildLegLiftConfig, buildAnklePumpsConfig, emptySetup, type ExerciseId } from '../setup/setup-model.js';

const pose = vi.hoisted(() => ({ receive: null as ((frame: PoseFrame) => void) | null, close: vi.fn() }));
vi.mock('../../pose/pose-client.js', () => ({ PoseClient: class {
  constructor(_url: URL, receive: (frame: PoseFrame) => void) { pose.receive = receive; }
  initialize = async () => {}; send = async () => true; close = pose.close;
} }));
class FakeRecorder {
  static latest: FakeRecorder;
  static startImmediately = true;
  static isTypeSupported = () => true;
  state = 'inactive'; mimeType = 'video/webm';
  onstart: (() => void) | null = null; onstop: (() => void) | null = null;
  onerror: (() => void) | null = null; ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() { FakeRecorder.latest = this; }
  start() { this.state = 'recording'; if (FakeRecorder.startImmediately) this.onstart?.(); }
  stop = vi.fn(() => { this.state = 'inactive'; });
  finish() { this.ondataavailable?.({ data: new Blob(['video']) }); this.onstop?.(); }
}
const baseline = { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 100, y: 100 }, hip: { x: 50, y: 150 } };
function frame(x = 100): PoseFrame {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [key, index] of [['shoulder', 11], ['elbow', 13], ['wrist', 15], ['hip', 23]] as const) {
    const point = baseline[key]; points[index] = { x: (key === 'wrist' ? x : point.x) / 400, y: point.y / 300, visibility: 1 };
  }
  return { type: 'pose', sequence: Date.now(), timestampMs: Date.now(), width: 400, height: 300, inferenceMs: 1, points };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); FakeRecorder.startImmediately = true; });
async function openController(exerciseId: ExerciseId = 'seated_forward_reach') {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  class Stream { getTracks = () => [track]; getVideoTracks = () => [track]; }
  vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new Stream() } });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, baseURI: 'http://localhost/' }));
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Worker', class {}); vi.stubGlobal('OffscreenCanvas', class {}); vi.stubGlobal('createImageBitmap', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const finished = vi.fn<(outcome: CaptureOutcome) => void>();
  const videoFinished = vi.fn<(outcome: VideoCaptureOutcome) => void>();
  const controller = new CaptureController(vi.fn(), finished, () => Date.now(), videoFinished);
  const video = { srcObject: null, style: { transform: '' }, play: async () => {}, readyState: 1 } as unknown as HTMLVideoElement;
  const canvas = { getContext: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as unknown as HTMLCanvasElement;
  controller.attach(video, canvas); await controller.open({ facing: 'environment', delegate: 'CPU', mirrored: false, side: 'left', exerciseId });
  return { controller, finished, videoFinished, track };
}

it.each(['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'] as const)('%s records without calibration or required-joint readiness when a pose is visible', async (exerciseId) => {
  const { controller, finished, videoFinished, track } = await openController(exerciseId);
  expect(controller.startVideoOnly('quick')).toContain('MediaPipe');
  const partial = frame(); partial.points[15]!.visibility = 0;
  pose.receive!(partial);
  expect(controller.snapshot.ready).toBe(false);
  expect(controller.startVideoOnly('quick')).toBeNull();
  expect(controller.snapshot).toMatchObject({ phase: 'recording', analyzerState: 'VIDEO_ONLY', counts: null, paceWarnings: 0 });
  expect(controller.startVideoOnly('duplicate')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  controller.stop(); FakeRecorder.latest.finish(); await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  expect(videoFinished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ captureId: 'quick', exerciseId, stopReason: 'STOPPED', recording: expect.objectContaining({ blob: expect.any(Blob) }), pace: expect.objectContaining({ fastWarnings: 0 }) }));
  expect(track.stop).toHaveBeenCalledTimes(1);
});

it('stops an uncalibrated video at the recording deadline', async () => {
  const { controller, videoFinished } = await openController();
  pose.receive!(frame()); expect(controller.startVideoOnly('deadline')).toBeNull();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.snapshot.phase).toBe('finalizing');
  FakeRecorder.latest.finish(); await Promise.resolve();
  expect(videoFinished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stopReason: 'STOPPED', message: '30-second recording limit reached.' }));
});
async function setup(delayRecorderStartMs = 0) {
  const { controller, finished, track } = await openController();
  pose.receive!(frame()); controller.tap(0, 0); controller.tap(100, 0);
  for (let t = 100; t <= 1000; t += 100) { await vi.advanceTimersByTimeAsync(100); pose.receive!(frame()); }
  controller.captureBaseline(); controller.tap(200, 100);
  await vi.advanceTimersByTimeAsync(100); pose.receive!(frame());
  const config = developerReachConfig(baseline, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 200, y: 100 }, 400, 300, 'left', 'capture-test', null);
  FakeRecorder.startImmediately = delayRecorderStartMs === 0;
  expect(controller.start(config)).toBeNull();
  if (delayRecorderStartMs) {
    await vi.advanceTimersByTimeAsync(delayRecorderStartMs);
    expect(controller.snapshot.recordingMs).toBeNull();
    FakeRecorder.latest.onstart?.();
  }
  const start = Date.now();
  const send = async (relative: number, x = 100) => { await vi.advanceTimersByTimeAsync(start + relative - Date.now()); pose.receive!(frame(x)); };
  // Readiness and onset are real analyzer transitions, not mocked attempt outputs.
  for (let t = 0; t <= 600; t += 100) await send(t);
  for (let t = 700; t <= 900; t += 100) await send(t, 130);
  return { controller, finished, track, recorder: FakeRecorder.latest, send };
}

it('can calibrate and start recording at 2.5 pose results/s after a missing joint recovers', async () => {
  const { controller } = await openController('seated_elbow_flexion_extension');
  const missing = frame(); missing.points[15]!.visibility = 0;
  pose.receive!(missing);
  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(400);
    pose.receive!(frame());
  }
  controller.captureBaseline();
  expect(controller.snapshot.baseline).toBe(true);
  await vi.advanceTimersByTimeAsync(400); pose.receive!(frame());
  expect(controller.snapshot.ready).toBe(true);
  const config = developerElbowConfig(baseline, 45, 1, 400, 300, 'left', 'slow-camera', null);
  expect(controller.start(config, 'none')).toBeNull();
  expect(controller.snapshot.phase).toBe('recording');
  controller.close();
});
it.each(['delayed', 'missing'] as const)('freezes an automatic recorder error before %s finalization and releases capture', async (kind) => {
  const { controller, recorder, finished, track, send } = await setup();
  await vi.advanceTimersByTimeAsync(50); recorder.onerror?.();
  expect(controller.snapshot.phase).toBe('finalizing'); expect(finished).not.toHaveBeenCalled();
  await send(1000, 200); await send(1200); await send(1500);
  if (kind === 'delayed') recorder.finish();
  else await vi.advanceTimersByTimeAsync(5000);
  await Promise.resolve();
  expect(finished).toHaveBeenCalledTimes(1);
  const outcome = finished.mock.calls[0]![0];
  expect(outcome).toMatchObject({ stoppedAtMs: 950, stopReason: 'CAPTURE_FAILED', recording: { complete: false, startMs: 1100, endMs: 2050 } });
  expect(outcome.attempts).toHaveLength(1);
  expect(outcome.attempts[0]).toMatchObject({ endMs: 950, classification: 'excluded', reasons: expect.arrayContaining(['STOPPED_EARLY', 'RETURN_NOT_OBSERVED']) });
  expect(track.stop).toHaveBeenCalledTimes(1); expect(pose.close).toHaveBeenCalledTimes(1);
  expect(controller.snapshot.phase).toBe('closed');
});
it('same-timestamp discomfort overrides a pending reach completion and remains authoritative through recorder notification', async () => {
  const { controller, recorder, finished, send } = await setup();
  for (let t = 1000; t <= 1200; t += 100) await send(t, 200);
  for (let t = 1300; t <= 1500; t += 100) await send(t);
  controller.discomfort(); recorder.finish(); await Promise.resolve();
  const outcome = finished.mock.calls[0]![0];
  expect(outcome).toMatchObject({ stopReason: 'DISCOMFORT_STOP', stoppedAtMs: 1500, discomfortAtMs: 1500 });
  expect(outcome.attempts).toHaveLength(1);
  expect(outcome.attempts[0]).toMatchObject({ classification: 'excluded', endMs: 1500, reasons: expect.arrayContaining(['DISCOMFORT_STOP']) });
});

it('records an elbow session without reach reference taps or a target', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  class Stream { getTracks = () => [track]; getVideoTracks = () => [track]; }
  vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => new Stream() } });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, baseURI: 'http://localhost/' }));
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Worker', class {}); vi.stubGlobal('OffscreenCanvas', class {}); vi.stubGlobal('createImageBitmap', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const finished = vi.fn(), controller = new CaptureController(vi.fn(), finished, () => Date.now());
  controller.attach({ srcObject: null, style: { transform: '' }, play: async () => {}, readyState: 1 } as unknown as HTMLVideoElement,
    { getContext: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as unknown as HTMLCanvasElement);
  await controller.open({ facing: 'environment', delegate: 'CPU', mirrored: false, side: 'left', exerciseId: 'seated_elbow_flexion_extension' });
  pose.receive!(frame());
  for (let t = 100; t <= 1100; t += 100) { await vi.advanceTimersByTimeAsync(100); pose.receive!(frame()); }
  controller.captureBaseline();
  expect(controller.snapshot.baseline).toBe(true);
  expect(controller.snapshot.reference).toHaveLength(0);
  expect(controller.snapshot.target).toBeNull();
  await vi.advanceTimersByTimeAsync(100); pose.receive!(frame());
  const calibration = controller.calibration();
  expect(calibration).not.toBeNull();
  const config = developerElbowConfig(baseline, 45, 1, 400, 300, 'left', 'elbow-capture-test', null);
  expect(controller.start(config, 'none')).toBeNull();
  controller.stop(); FakeRecorder.latest.finish(); await Promise.resolve();
  expect(finished).toHaveBeenCalledTimes(1);
  expect(finished.mock.calls[0]![0]).toMatchObject({ exerciseId: 'seated_elbow_flexion_extension', config: { endpointDeg: 45 }, stopReason: 'STOPPED' });
  expect(track.stop).toHaveBeenCalledTimes(1);
});

it('anchors the 30-second limit and unique final countdown to a delayed recorder start', async () => {
  const { controller, recorder, finished, send } = await setup(2500);
  await send(24_950);
  expect(controller.snapshot.countdownSeconds).toBeNull();
  for (const t of [25_000, 25_500, 26_000, 26_500, 27_000, 28_000, 29_000]) await send(t);
  expect(controller.snapshot.countdownSeconds).toBe(1);
  await send(30_000);
  expect(controller.snapshot.phase).toBe('finalizing');
  recorder.finish(); await Promise.resolve();
  expect(finished).toHaveBeenCalledTimes(1);
  const outcome = finished.mock.calls[0]![0];
  expect(outcome).toMatchObject({ stopReason: 'STOPPED', message: '30-second recording limit reached.', stoppedAtMs: 30_000 });
  expect(outcome.countdownCues).toEqual([
    { remainingSeconds: 5, timestampMs: 25_000 }, { remainingSeconds: 4, timestampMs: 26_000 },
    { remainingSeconds: 3, timestampMs: 27_000 }, { remainingSeconds: 2, timestampMs: 28_000 }, { remainingSeconds: 1, timestampMs: 29_000 },
  ]);
  expect(outcome.cueEvents.map((cue: { cueId: string }) => cue.cueId)).toEqual(['countdown.5', 'countdown.4', 'countdown.3', 'countdown.2', 'countdown.1', 'stop.stopped']);
  expect(recorder.stop).toHaveBeenCalledTimes(1);
});

it('stops immediately after a suspended clock passes the limit without replaying skipped countdown cues', async () => {
  const { controller, recorder, finished } = await setup();
  vi.setSystemTime(Date.now() + 65_000);
  await vi.advanceTimersByTimeAsync(50);
  expect(controller.snapshot.phase).toBe('finalizing');
  controller.stop(); recorder.finish(); await Promise.resolve();
  expect(finished).toHaveBeenCalledTimes(1);
  const outcome = finished.mock.calls[0]![0];
  expect(outcome.stopReason).toBe('STOPPED');
  expect(outcome.stoppedAtMs).toBeGreaterThanOrEqual(30_000);
  expect(outcome.countdownCues).toEqual([]);
  expect(outcome.cueEvents).toHaveLength(1);
  expect(outcome.cueEvents[0]).toMatchObject({ cueId: 'stop.stopped', timestampMs: outcome.stoppedAtMs });
  expect(recorder.stop).toHaveBeenCalledTimes(1);
});

it('evaluates a resumed deadline before a queued inference reply, even before the timer runs', async () => {
  const { controller, recorder, finished } = await setup();
  vi.setSystemTime(Date.now() + 65_000);
  pose.receive!(frame(200));
  expect(controller.snapshot.phase).toBe('finalizing');
  recorder.finish(); await Promise.resolve();
  const outcome = finished.mock.calls[0]![0];
  expect(outcome.stopReason).toBe('STOPPED');
  expect(outcome.attempts).toHaveLength(1);
  expect(outcome.attempts[0]!.classification).toBe('excluded');
  expect(outcome.attempts[0]!.reasons).toEqual(expect.arrayContaining(['TIMEOUT', 'TRACKING_GAP']));
  expect(recorder.stop).toHaveBeenCalledTimes(1);
});

type PixelPoints = Partial<Record<PoseJoint, { x: number; y: number }>>;
function selectedFrame(pose: PixelPoints): PoseFrame {
  const points: PoseFrame['points'] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const indices = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, footIndex: 31 };
  for (const [joint, index] of Object.entries(indices)) {
    const point = Object.entries(pose).find(([name]) => name === joint)?.[1];
    if (point) points[index] = { x: point.x / 600, y: point.y / 400, visibility: 1 };
  }
  return { type: 'pose', sequence: Date.now(), timestampMs: Date.now(), width: 600, height: 400, inferenceMs: 1, points };
}
const remainingExercises = ['seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'] as const;
it.each(remainingExercises)('%s calibrates and records with only its prescribed joints and setup', async (exerciseId) => {
  const { controller, finished, track } = await openController(exerciseId);
  const draft = { ...emptySetup('2026-10-25', exerciseId), mode: 'rehabilitation' as const, side: 'left' as const,
    participantLabel: 'TEAM', supervisorLabel: 'SUPERVISOR', attestationContext: 'Synthetic fixture', attested: true, seatingSupport: 'none',
    assignedRangeOrGoal: 'Configured endpoint fixture', teamTestConfirmed: true, setupDirectionVerified: true };
  const poses = exerciseId === 'seated_forward_arm_raise' ? { rest: armPose(), outward: armPose(30), endpoint: armPose(90), returning: armPose(30) }
    : exerciseId === 'seated_knee_extension' ? { rest: kneePose(), outward: kneePose(120), endpoint: kneePose(150), returning: kneePose(120) }
    : exerciseId === 'seated_single_leg_lift' ? { rest: liftPose(), outward: liftPose(0.1), endpoint: liftPose(0.3), returning: liftPose(0.1) }
    : { rest: anklePose(), outward: anklePose(98), endpoint: anklePose(105), returning: anklePose(98) };
  pose.receive!(selectedFrame(poses.rest));
  const referenceNeeded = exerciseId === 'seated_forward_arm_raise' || exerciseId === 'seated_single_leg_lift';
  if (referenceNeeded) { controller.tap(0, 0); controller.tap(100, 0); }
  for (let t = 100; t <= 1100; t += 100) { await vi.advanceTimersByTimeAsync(100); pose.receive!(selectedFrame(poses.rest)); }
  controller.captureBaseline();
  expect(controller.snapshot.baseline).toBe(true);
  expect(controller.snapshot.reference).toHaveLength(referenceNeeded ? 2 : 0);
  expect(controller.snapshot.target).toBeNull();
  await vi.advanceTimersByTimeAsync(100); pose.receive!(selectedFrame(poses.rest));
  expect(controller.snapshot.ready).toBe(true);
  const calibration = controller.calibration();
  if (!calibration) throw new Error('Expected exercise calibration');
  const sessionId = `capture-${exerciseId}`;
  const config = calibration.kind === 'arm_raise' ? buildArmRaiseConfig(draft, calibration, sessionId)
    : calibration.kind === 'knee_extension' ? buildKneeExtensionConfig(draft, calibration, sessionId)
    : calibration.kind === 'leg_lift' ? buildLegLiftConfig(draft, calibration, sessionId)
    : calibration.kind === 'ankle_pumps' ? buildAnklePumpsConfig(draft, calibration, sessionId)
    : null;
  if (!config) throw new Error('Unexpected calibration');
  const start = Date.now();
  expect(controller.start(config, draft.seatingSupport)).toBeNull();
  const send = async (relative: number, value: PixelPoints) => { await vi.advanceTimersByTimeAsync(start + relative - Date.now()); pose.receive!(selectedFrame(value)); };
  for (let t = 0; t <= 700; t += 100) await send(t, poses.rest);
  for (let t = 800; t <= 1100; t += 100) await send(t, poses.outward);
  for (let t = 1200; t <= 1500; t += 100) await send(t, poses.endpoint);
  for (let t = 1600; t <= 1900; t += 100) await send(t, poses.returning);
  for (let t = 2000; t <= 2400; t += 100) await send(t, poses.rest);
  controller.stop(); FakeRecorder.latest.finish(); await Promise.resolve();
  expect(finished).toHaveBeenCalledTimes(1);
  const outcome = finished.mock.calls[0]![0];
  expect(outcome).toMatchObject({ exerciseId, config: { sessionId }, stopReason: 'STOPPED' });
  expect(outcome.attempts).toHaveLength(1);
  expect(outcome.attempts[0]).toMatchObject({ exerciseId, classification: 'measurable' });
  expect(track.stop).toHaveBeenCalledTimes(1);
});
