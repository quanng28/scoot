import type { Interruption, PixelPose, ReachAttempt, ReachConfig, ReachState } from '../../analysis/reach-contract.js';
import {
  REST_MAX_GAP_MS,
  calibrateReachBaseline,
  calibratePoseBaseline,
  calibrateKneeExtensionBaseline,
  calibrateLegLiftBaseline,
  calibrateAnklePumpsBaseline,
  type KneeExtensionBaseline,
  type LegLiftBaseline,
  type AnklePumpsBaseline,
} from '../../analysis/rest-calibration.js';
import { SeatedReachAnalyzer } from '../../analysis/seated-reach.js';
import { SeatedElbowAnalyzer, type ElbowAttempt, type ElbowConfig } from '../../analysis/seated-elbow.js';
import { SeatedArmRaiseAnalyzer, type ArmRaiseAttempt, type ArmRaiseConfig } from '../../analysis/seated-arm-raise.js';
import { SeatedKneeExtensionAnalyzer, type KneeExtensionAttempt, type KneeExtensionConfig } from '../../analysis/seated-knee-extension.js';
import { SeatedSingleLegLiftAnalyzer, type LegLiftAttempt, type LegLiftConfig } from '../../analysis/seated-single-leg-lift.js';
import { PaceMonitor, type PaceSummary } from '../../analysis/pace-monitor.js';
import { SeatedAnklePumpsAnalyzer, type AnklePumpsAttempt, type AnklePumpsConfig } from '../../analysis/seated-ankle-pumps.js';
import { createCueEvent, countdownCueEvents, RECORDING_LIMIT_MS, type CueEvent } from '../../contracts/cue-events.js';
import { Camera } from '../../capture/camera.js';
import { LocalRecorder, type Recording } from '../../capture/recorder.js';
import { developerReachConfig, ReachSession } from '../../capture/reach-session.js';
import { ElbowSession } from '../../capture/elbow-session.js';
import { ArmRaiseSession } from '../../capture/arm-raise-session.js';
import { KneeExtensionSession } from '../../capture/knee-extension-session.js';
import { LegLiftSession } from '../../capture/leg-lift-session.js';
import { AnklePumpsSession } from '../../capture/ankle-pumps-session.js';
import { toSample, type PoseFrame, type Sample } from '../../pose/observations.js';
import { PoseClient } from '../../pose/pose-client.js';
import { drawSkeleton, previewX } from '../../pose/preview.js';
import { READINESS, exerciseName, type Calibration, type ExerciseId } from '../setup/setup-model.js';
import { EXERCISE_REQUIRED_LANDMARKS, jointStatuses, ReadinessTracker, tapToIntrinsic, type JointStatus } from './tracking.js';

type Point = { x: number; y: number };
export type CapturePhase = 'idle' | 'opening' | 'previewing' | 'recording' | 'finalizing' | 'closed';
export type StopReason = 'STOPPED' | 'DISCOMFORT_STOP' | 'SETUP_CHANGED' | 'CAPTURE_FAILED';
export type AnyConfig = ReachConfig | ElbowConfig | ArmRaiseConfig | KneeExtensionConfig | LegLiftConfig | AnklePumpsConfig;
export type AnyAttempt = ReachAttempt | ElbowAttempt | ArmRaiseAttempt | KneeExtensionAttempt | LegLiftAttempt | AnklePumpsAttempt;

const LIMIT_MESSAGE = `${RECORDING_LIMIT_MS / 1000}-second recording limit reached.`;

export type CaptureSnapshot = {
  phase: CapturePhase;
  message: string;
  problem: boolean;
  tracking: Partial<Record<string, JointStatus>> | null;
  stableMs: number;
  ready: boolean;
  resultsPerSec: number | null;
  inferenceMs: number | null;
  frameSize: { width: number; height: number } | null;
  reference: Point[];
  baseline: boolean;
  target: Point | null;
  selecting: 'reference' | 'target';
  analyzerState: ReachState | 'WAITING_FOR_RECORDER' | string | null;
  counts: { detected: number; measurable: number; excluded: number; flagged: number } | null;
  recordingMs: number | null;
  countdownSeconds: number | null;
  poseDetected?: boolean;
  /** Fast-movement warnings raised so far in this recording (calibration-free pace monitor). */
  paceWarnings?: number;
};

export type CountdownCue = { remainingSeconds: number; timestampMs: number };
type CaptureCommon = {
  recording: Recording | null;
  stopReason: StopReason;
  stoppedAtMs: number | null;
  message: string | null;
  discomfortAtMs: number | null;
  startedAt: string;
  endedAt: string;
  countdownCues: CountdownCue[];
  cueEvents: CueEvent[];
};
type ExerciseCapture =
  | { exerciseId: 'seated_forward_reach'; config: ReachConfig; attempts: ReachAttempt[] }
  | { exerciseId: 'seated_elbow_flexion_extension'; config: ElbowConfig; attempts: ElbowAttempt[] }
  | { exerciseId: 'seated_forward_arm_raise'; config: ArmRaiseConfig; attempts: ArmRaiseAttempt[] }
  | { exerciseId: 'seated_knee_extension'; config: KneeExtensionConfig; attempts: KneeExtensionAttempt[] }
  | { exerciseId: 'seated_single_leg_lift'; config: LegLiftConfig; attempts: LegLiftAttempt[] }
  | { exerciseId: 'seated_ankle_pumps'; config: AnklePumpsConfig; attempts: AnklePumpsAttempt[] };
export type CaptureOutcome = ExerciseCapture & CaptureCommon;
export type VideoCaptureOutcome = CaptureCommon & { captureId: string; exerciseId: ExerciseId; pace: PaceSummary | null };
type PreparedExercise =
  | { exerciseId: 'seated_forward_reach'; config: ReachConfig }
  | { exerciseId: 'seated_elbow_flexion_extension'; config: ElbowConfig }
  | { exerciseId: 'seated_forward_arm_raise'; config: ArmRaiseConfig }
  | { exerciseId: 'seated_knee_extension'; config: KneeExtensionConfig }
  | { exerciseId: 'seated_single_leg_lift'; config: LegLiftConfig }
  | { exerciseId: 'seated_ankle_pumps'; config: AnklePumpsConfig };

export type OpenOptions = { facing: 'user' | 'environment'; delegate: 'CPU' | 'GPU'; mirrored: boolean; side: 'left' | 'right'; exerciseId?: ExerciseId };

type ExerciseSession = ReachSession | ElbowSession | ArmRaiseSession | KneeExtensionSession | LegLiftSession | AnklePumpsSession;
type CapturedBaseline =
  | { kind: 'reach' | 'elbow' | 'arm_raise'; value: PixelPose }
  | { kind: 'knee_extension'; value: KneeExtensionBaseline }
  | { kind: 'leg_lift'; value: LegLiftBaseline }
  | { kind: 'ankle_pumps'; value: AnklePumpsBaseline };
const needsReference = (exerciseId: ExerciseId) => exerciseId === 'seated_forward_reach' || exerciseId === 'seated_forward_arm_raise' || exerciseId === 'seated_single_leg_lift';

// Display-only target radius, read from Quan P's developer settings rather than duplicated.
const PREVIEW_TARGET_RADIUS = developerReachConfig({ shoulder: { x: 0, y: 0 }, elbow: { x: 0, y: 1 }, wrist: { x: 1, y: 1 }, hip: { x: 0, y: 2 } },
  [{ x: 0, y: 0 }, { x: 1, y: 0 }], { x: 2, y: 1 }, 10, 10, 'left', 'preview', null).settings.targetRadius;
const STALL_MS = 4000;

export class CaptureController {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private camera: Camera | null = null;
  private client: PoseClient | null = null;
  private recorder: LocalRecorder | null = null;
  private session: ExerciseSession | null = null;
  private pendingConfig: PreparedExercise | null = null;
  private pendingSupport = '';
  private videoCaptureId: string | null = null;
  private pace: PaceMonitor | null = null;
  private exerciseId: ExerciseId = 'seated_forward_reach';
  private timer: ReturnType<typeof setInterval> | undefined;
  private raf = 0;
  private epoch = 0;
  private origin = 0;
  private lastFrameAt = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private samples: Sample[] = [];
  private currentFrame: PoseFrame | null = null;
  private baseline: CapturedBaseline | null = null;
  private options: OpenOptions | null = null;
  private readiness = new ReadinessTracker(READINESS.windowMs, REST_MAX_GAP_MS);
  private stopReason: StopReason | null = null;
  private stopMessage: string | null = null;
  private stoppedAtMs: number | null = null;
  private discomfortAtMs: number | null = null;
  private startedAt = '';
  private countdownCues: CountdownCue[] = [];
  private readonly announcedCountdown = new Set<number>();
  private lastEmit = 0;
  private readonly cleanup: (() => void)[] = [];
  private state: CaptureSnapshot = {
    phase: 'idle', message: 'Camera starts only when you choose Open camera.', problem: false, tracking: null, stableMs: 0, ready: false,
    resultsPerSec: null, inferenceMs: null, frameSize: null, reference: [], baseline: false, target: null, selecting: 'reference', analyzerState: null, counts: null, recordingMs: null, countdownSeconds: null,
  };

  constructor(
    private readonly listener: (snapshot: CaptureSnapshot) => void,
    private readonly onFinished: (outcome: CaptureOutcome) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly onVideoFinished?: (outcome: VideoCaptureOutcome) => void
  ) {}

  get snapshot(): CaptureSnapshot { return this.state; }
  attach(video: HTMLVideoElement, canvas: HTMLCanvasElement): void { this.video = video; this.canvas = canvas; }
  setMirrored(mirrored: boolean): void {
    if (!this.options || !this.video) return;
    this.options = { ...this.options, mirrored };
    this.video.style.transform = mirrored ? 'scaleX(-1)' : '';
    if (this.currentFrame) this.draw(this.currentFrame);
  }

  async open(options: OpenOptions): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'closed') return;
    if (!this.video) throw new Error('Preview not attached');
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.update({ message: 'Camera access requires HTTPS (or localhost) and a supported browser.', problem: true }, true);
      return;
    }
    if (!globalThis.Worker || !globalThis.OffscreenCanvas || !globalThis.createImageBitmap) {
      this.update({ message: 'This browser lacks the worker/frame APIs needed for local pose tracking.', problem: true }, true);
      return;
    }
    const token = ++this.epoch;
    this.options = options;
    this.exerciseId = options.exerciseId ?? 'seated_forward_reach';
    this.resetSetupState();
    this.update({ phase: 'opening', message: 'Opening camera and loading the local pose model…', problem: false }, true);
    try {
      this.camera = new Camera(navigator.mediaDevices);
      const stream = await this.camera.open(options.facing);
      if (token !== this.epoch) return;
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (token === this.epoch) this.fail('Camera access ended.'); });
      this.video.srcObject = stream;
      this.video.style.transform = options.mirrored ? 'scaleX(-1)' : '';
      await this.video.play();
      if (token !== this.epoch) return;
      const root = new URL('pose/', document.baseURI);
      this.client = new PoseClient(new URL('pose-worker.js', root), (frame) => this.receive(frame), (message) => { if (token === this.epoch) this.fail(message); });
      await this.client.initialize(root, options.delegate);
      if (token !== this.epoch) return;
      this.origin = this.now(); this.lastFrameAt = this.origin; this.lastVideoTime = -1; this.frames = 0;
      this.listen();
      const initialMsg =
        needsReference(this.exerciseId) ? 'Tap two separated points on a fixed object to set the reference length.'
        : this.exerciseId === 'seated_ankle_pumps' ? 'Position camera close to foot and shank, hold foot still for 1 s, then capture resting baseline.'
        : 'Hold the resting position still for at least one second, then capture the resting baseline.';
      this.update({ phase: 'previewing', message: initialMsg }, true);
      this.loop(token);
    } catch (error) {
      if (token !== this.epoch) return;
      const denied = error instanceof Error && error.name === 'NotAllowedError';
      this.teardown();
      this.update({
        phase: 'closed', problem: true,
        message: denied ? 'Camera permission denied. Allow camera access for this site in browser or app settings, then choose Open camera. If this embedded browser cannot access the camera, open this page in Chrome, Edge or Safari.'
          : 'Camera or pose model failed to start. Check camera availability and asset loading, then retry.',
      }, true);
    }
  }

  tap(clientX: number, clientY: number): void {
    const frame = this.currentFrame, canvas = this.canvas;
    if (!needsReference(this.exerciseId) || this.state.phase !== 'previewing' || !frame || !canvas || !this.options) return;
    const point = tapToIntrinsic(clientX, clientY, canvas.getBoundingClientRect(), frame.width, frame.height, this.options.mirrored);
    if (!point) return;
    if (this.state.selecting === 'target' && this.baseline) {
      this.update({ target: point, message: 'Target selected. Supervisor: confirm camera, seating and target placement, then wait for readiness.' }, true);
      return;
    }
    const reference = this.state.reference.length >= 2 ? [point] : [...this.state.reference, point];
    this.baseline = null;
    this.update({
      reference, baseline: false, target: null, selecting: 'reference',
      message: reference.length === 2 ? 'Hold the resting position still, then capture the resting baseline.' : 'Tap the second reference point.',
    }, true);
  }

  captureBaseline(): void {
    const frame = this.currentFrame;
    if (this.state.phase !== 'previewing' || !frame || !this.options || (needsReference(this.exerciseId) && this.state.reference.length !== 2)) return;
    const samples = this.samples.slice();
    // Use the most recent second (at least six observations), not an earlier
    // pose adjustment that is still in the bounded history.
    while (samples.length > 6 && samples.at(-1)!.timestampMs - samples[1]!.timestampMs >= READINESS.windowMs) samples.shift();
    try {
      switch (this.exerciseId) {
        case 'seated_forward_reach': {
          const [a, b] = this.state.reference;
          if (!a || !b) throw new Error('Select two fixed reference points.');
          this.baseline = { kind: 'reach', value: calibrateReachBaseline(samples, frame.width, frame.height, [a, b]) };
          break;
        }
        case 'seated_elbow_flexion_extension':
        case 'seated_forward_arm_raise':
          this.baseline = { kind: this.exerciseId === 'seated_forward_arm_raise' ? 'arm_raise' : 'elbow', value: calibratePoseBaseline(samples, frame.width, frame.height) };
          break;
        case 'seated_knee_extension':
          this.baseline = { kind: 'knee_extension', value: calibrateKneeExtensionBaseline(samples, frame.width, frame.height) };
          break;
        case 'seated_single_leg_lift':
          this.baseline = { kind: 'leg_lift', value: calibrateLegLiftBaseline(samples, frame.width, frame.height) };
          break;
        case 'seated_ankle_pumps':
          this.baseline = { kind: 'ankle_pumps', value: calibrateAnklePumpsBaseline(samples, frame.width, frame.height) };
          break;
      }
      this.samples = [];
      const msg = this.exerciseId === 'seated_forward_reach'
        ? 'Baseline captured. Tap the fixed reach target in the image.'
        : `${exerciseName(this.exerciseId)} baseline captured. Confirm setup and wait for tracking readiness.`;
      this.update({
        baseline: true,
        selecting: this.exerciseId === 'seated_forward_reach' ? 'target' : 'reference',
        target: null,
        message: msg,
        problem: false,
      }, true);
    } catch (error) {
      this.baseline = null;
      this.update({ baseline: false, message: error instanceof Error ? error.message : 'Baseline capture failed. Hold still and retry.', problem: true }, true);
    }
  }

  calibration(): Calibration | null {
    const frame = this.currentFrame, baseline = this.baseline;
    if (!frame || !baseline) return null;
    const dimensions = { width: frame.width, height: frame.height };
    const [first, second] = this.state.reference;
    switch (baseline.kind) {
      case 'reach':
        if (!this.state.target || !first || !second) return null;
        return { kind: 'reach', baseline: structuredClone(baseline.value), reference: [{ ...first }, { ...second }], target: { ...this.state.target }, ...dimensions };
      case 'elbow': return { kind: 'elbow', baseline: structuredClone(baseline.value), ...dimensions };
      case 'arm_raise':
        if (!first || !second) return null;
        return { kind: 'arm_raise', baseline: structuredClone(baseline.value), reference: [{ ...first }, { ...second }], ...dimensions };
      case 'knee_extension': return { kind: 'knee_extension', baseline: structuredClone(baseline.value), ...dimensions };
      case 'leg_lift':
        if (!first || !second) return null;
        return { kind: 'leg_lift', baseline: structuredClone(baseline.value), reference: [{ ...first }, { ...second }], ...dimensions };
      case 'ankle_pumps': return { kind: 'ankle_pumps', baseline: structuredClone(baseline.value), ...dimensions };
    }
  }

  resetSetup(message = 'Setup reset. Calibrate a fresh resting baseline.'): void {
    if (this.state.phase === 'recording' || this.state.phase === 'finalizing') return;
    this.resetSetupState();
    this.update({ message, problem: false }, true);
  }

  start(config: AnyConfig, support = ''): string | null {
    if (this.state.phase !== 'previewing' || !(this.video?.srcObject instanceof MediaStream)) return 'Camera preview is not running.';
    if (!this.state.ready) return 'Wait until all required landmarks are tracked for the readiness window.';
    if (this.exerciseId !== 'seated_forward_reach' && !support.trim()) return 'Describe the assigned limb support, including none if unsupported.';
    let prepared: PreparedExercise;
    try {
      switch (this.exerciseId) {
        case 'seated_forward_reach': prepared = { exerciseId: 'seated_forward_reach', config: new SeatedReachAnalyzer(config).configuration }; break;
        case 'seated_elbow_flexion_extension': prepared = { exerciseId: 'seated_elbow_flexion_extension', config: new SeatedElbowAnalyzer(config).configuration }; break;
        case 'seated_forward_arm_raise': prepared = { exerciseId: 'seated_forward_arm_raise', config: new SeatedArmRaiseAnalyzer(config).configuration }; break;
        case 'seated_knee_extension': prepared = { exerciseId: 'seated_knee_extension', config: new SeatedKneeExtensionAnalyzer(config).configuration }; break;
        case 'seated_single_leg_lift': prepared = { exerciseId: 'seated_single_leg_lift', config: new SeatedSingleLegLiftAnalyzer(config).configuration }; break;
        case 'seated_ankle_pumps': prepared = { exerciseId: 'seated_ankle_pumps', config: new SeatedAnklePumpsAnalyzer(config).configuration }; break;
      }
    } catch (error) {
      return error instanceof Error ? `Calibration rejected: ${error.message}` : 'Calibration rejected.';
    }
    return this.beginRecording(prepared, support, null);
  }

  /** MVP capture needs only a live detected pose; calibration is optional for video. */
  startVideoOnly(captureId: string): string | null {
    if (this.state.phase !== 'previewing' || !this.state.poseDetected || !(this.video?.srcObject instanceof MediaStream)) return 'Wait for MediaPipe to show the body skeleton.';
    if (!this.onVideoFinished) return 'Video-only recording is unavailable in this view.';
    return this.beginRecording(null, '', captureId);
  }

  private beginRecording(prepared: PreparedExercise | null, support: string, captureId: string | null): string | null {
    if (!(this.video?.srcObject instanceof MediaStream)) return 'Camera preview is not running.';
    if (typeof MediaRecorder === 'undefined') return 'This browser cannot record video locally.';
    const recorder = new LocalRecorder(() => this.now() - this.origin);
    let result: Promise<Recording>;
    try { result = recorder.start(this.video.srcObject); } catch (error) { return error instanceof Error ? error.message : 'Recording could not start.'; }
    this.recorder = recorder;
    this.pendingConfig = prepared;
    this.videoCaptureId = captureId;
    const frame = this.currentFrame;
    this.pace = frame ? new PaceMonitor(this.exerciseId, frame.width, frame.height) : null;
    this.countdownCues = []; this.announcedCountdown.clear();
    this.pendingSupport = support;
    this.session = null;
    this.stopReason = null;
    this.stopMessage = null;
    this.stoppedAtMs = null;
    this.discomfortAtMs = null;
    this.startedAt = new Date().toISOString();
    this.timer = setInterval(() => this.tick(), 50);

    const recordingMsg =
      this.exerciseId === 'seated_forward_reach' ? 'Recording locally. Hold rest until REST, then reach and return.'
      : this.exerciseId === 'seated_elbow_flexion_extension' ? 'Recording locally. Hold until REST, bend to assigned endpoint, then straighten to rest.'
      : this.exerciseId === 'seated_forward_arm_raise' ? 'Recording locally. Hold until REST, raise arm to endpoint, then lower to rest.'
      : this.exerciseId === 'seated_knee_extension' ? 'Recording locally. Hold until REST, extend knee to endpoint, then return to rest.'
      : this.exerciseId === 'seated_single_leg_lift' ? 'Recording locally. Hold until REST, lift knee to endpoint, then lower to rest.'
      : 'Recording locally. Hold until REST, pump foot in assigned direction, then return to rest.';

    this.update({
      phase: 'recording',
      analyzerState: prepared ? 'WAITING_FOR_RECORDER' : 'VIDEO_ONLY',
      counts: prepared ? { detected: 0, measurable: 0, excluded: 0, flagged: 0 } : null,
      recordingMs: null,
      countdownSeconds: null,
      message: prepared ? recordingMsg : 'Recording video. Exercise measurements are off because setup is incomplete; pace cues stay on.',
      problem: false,
      paceWarnings: 0,
    }, true);

    recorder.onStopped(({ captureMs, reason }) => {
      if (this.recorder !== recorder) return;
      const limited = reason === null && recorder.startTimeMs !== null && captureMs - recorder.startTimeMs >= RECORDING_LIMIT_MS;
      this.end(limited ? 'STOPPED' : 'CAPTURE_FAILED', 'STOPPED_EARLY', limited ? LIMIT_MESSAGE : reason ?? 'Recording ended unexpectedly.', captureMs);
    });
    void result.then((recording) => { if (this.recorder === recorder) this.finish(recording); });
    return null;
  }

  stop(): void { this.end('STOPPED', 'STOPPED_EARLY', null); }
  discomfort(): void {
    if (this.state.phase === 'recording') {
      this.discomfortAtMs = this.recordingRelativeNow() ?? 0;
      this.end('DISCOMFORT_STOP', 'DISCOMFORT_STOP', 'Stopped after reported discomfort.');
    } else this.close('Stopped after reported discomfort. No session was recorded.');
  }

  reportSetupChange(): void {
    if (this.state.phase === 'recording') this.end('SETUP_CHANGED', 'SETUP_CHANGED', 'Reported setup change. A new setup and calibration are required.');
    else this.resetSetup('Setup change reported. Recalibrate resting baseline.');
  }

  close(message = 'Camera stopped. Camera tracks and pose worker released.'): void {
    if (this.state.phase === 'recording' || this.state.phase === 'finalizing') { this.fail(message); return; }
    this.epoch++; this.teardown(); this.resetSetupState();
    this.update({ phase: 'closed', message, problem: false, tracking: null, stableMs: 0, ready: false, frameSize: null, resultsPerSec: null, inferenceMs: null }, true);
  }

  private end(reason: StopReason, interruption: Interruption, message: string | null, captureMs = this.now() - this.origin): void {
    if (this.state.phase !== 'recording') return;
    this.stopReason = reason; this.stopMessage = message;
    const anchor = this.recorder?.startTimeMs;
    this.stoppedAtMs = anchor === null || anchor === undefined ? null : Math.max(0, captureMs - anchor);
    this.session?.stop(captureMs, interruption);
    clearInterval(this.timer); this.timer = undefined;
    this.update({ phase: 'finalizing', message: 'Finalizing the local recording…' }, true);
    void this.recorder?.stop(reason === 'CAPTURE_FAILED' ? message : null);
  }

  private fail(message: string): void {
    if (this.state.phase === 'recording') { this.end('CAPTURE_FAILED', 'STOPPED_EARLY', message); return; }
    if (this.state.phase === 'finalizing') return;
    this.epoch++; this.teardown(); this.resetSetupState();
    this.update({ phase: 'closed', message: `${message} Restart setup to continue.`, problem: true, tracking: null, ready: false, stableMs: 0 }, true);
  }

  private finish(recording: Recording): void {
    clearInterval(this.timer); this.timer = undefined;
    if (!this.stopReason) {
      this.stopReason = 'CAPTURE_FAILED';
      this.stopMessage = recording.reason ?? 'Recording ended unexpectedly.';
      this.stoppedAtMs = Math.max(0, recording.endMs - recording.startMs);
      this.session?.stop(recording.endMs, 'STOPPED_EARLY');
    }
    const exercise = this.captureExercise();
    const binding = exercise ? { sessionId: exercise.config.sessionId, configurationId: exercise.config.configurationId, exerciseId: exercise.exerciseId } : null;
    const cueEvents = binding ? [
      ...countdownCueEvents(binding, this.countdownCues),
      ...(this.stoppedAtMs === null ? [] : [createCueEvent(binding, 'stop.stopped', this.stoppedAtMs, 'stop')]),
    ] : [];
    const outcome: CaptureOutcome | null = exercise ? {
      ...exercise, recording, stopReason: this.stopReason, stoppedAtMs: this.stoppedAtMs, message: this.stopMessage,
      discomfortAtMs: this.discomfortAtMs, startedAt: this.startedAt, endedAt: new Date().toISOString(), countdownCues: [...this.countdownCues], cueEvents,
    } : null;
    const videoOutcome: VideoCaptureOutcome | null = this.videoCaptureId ? {
      captureId: this.videoCaptureId, exerciseId: this.exerciseId, recording, stopReason: this.stopReason,
      stoppedAtMs: this.stoppedAtMs, message: this.stopMessage, discomfortAtMs: this.discomfortAtMs,
      startedAt: this.startedAt, endedAt: new Date().toISOString(), countdownCues: [...this.countdownCues], cueEvents: [], pace: this.pace?.summary() ?? null,
    } : null;
    this.recorder = null; this.session = null; this.pendingConfig = null; this.videoCaptureId = null; this.pace = null;
    this.epoch++; this.teardown(); this.resetSetupState();
    this.update({ phase: 'closed', message: 'Capture ended. Camera tracks and pose worker released.', problem: false, tracking: null, ready: false, stableMs: 0, analyzerState: null }, true);
    if (outcome) this.onFinished(outcome);
    if (videoOutcome) this.onVideoFinished?.(videoOutcome);
  }

  private captureExercise(): ExerciseCapture | null {
    const session = this.session;
    if (session instanceof ReachSession) return { exerciseId: 'seated_forward_reach', config: session.config, attempts: [...session.attempts] };
    if (session instanceof ElbowSession) return { exerciseId: 'seated_elbow_flexion_extension', config: session.config, attempts: [...session.attempts] };
    if (session instanceof ArmRaiseSession) return { exerciseId: 'seated_forward_arm_raise', config: session.config, attempts: [...session.attempts] };
    if (session instanceof KneeExtensionSession) return { exerciseId: 'seated_knee_extension', config: session.config, attempts: [...session.attempts] };
    if (session instanceof LegLiftSession) return { exerciseId: 'seated_single_leg_lift', config: session.config, attempts: [...session.attempts] };
    if (session instanceof AnklePumpsSession) return { exerciseId: 'seated_ankle_pumps', config: session.config, attempts: [...session.attempts] };
    const prepared = this.pendingConfig;
    return prepared ? { ...prepared, attempts: [] } : null;
  }

  private tick(): void {
    if (this.state.phase !== 'recording') return;
    const anchor = this.recorder?.startTimeMs;
    const prepared = this.pendingConfig;
    if (prepared && anchor !== null && anchor !== undefined) {
      switch (prepared.exerciseId) {
        case 'seated_forward_reach': this.session = new ReachSession(prepared.config, anchor); break;
        case 'seated_elbow_flexion_extension': this.session = new ElbowSession(prepared.config, anchor, this.pendingSupport); break;
        case 'seated_forward_arm_raise': this.session = new ArmRaiseSession(prepared.config, anchor, this.pendingSupport); break;
        case 'seated_knee_extension': this.session = new KneeExtensionSession(prepared.config, anchor, this.pendingSupport); break;
        case 'seated_single_leg_lift': this.session = new LegLiftSession(prepared.config, anchor, this.pendingSupport); break;
        case 'seated_ankle_pumps': this.session = new AnklePumpsSession(prepared.config, anchor, this.pendingSupport); break;
      }
      this.pendingConfig = null;
    }
    const elapsed = this.recordingRelativeNow();
    if (elapsed !== null) {
      if (elapsed >= RECORDING_LIMIT_MS) {
        this.end('STOPPED', 'STOPPED_EARLY', LIMIT_MESSAGE);
        return;
      }
      const remaining = elapsed >= RECORDING_LIMIT_MS - 5000 ? Math.ceil((RECORDING_LIMIT_MS - elapsed) / 1000) : null;
      if (remaining !== null && !this.announcedCountdown.has(remaining)) {
        this.announcedCountdown.add(remaining);
        this.countdownCues.push({ remainingSeconds: remaining, timestampMs: elapsed });
      }
      this.update({ countdownSeconds: remaining, recordingMs: elapsed });
    }
    this.session?.tick(this.now() - this.origin);
    this.publishSession();
  }

  private publishSession(force = false): void {
    if (!this.session) return;
    const s = this.session.summary();
    this.update({
      analyzerState: this.session.analyzer.state,
      counts: { detected: s.detected, measurable: s.measurable, excluded: s.excluded, flagged: s.flagged },
      recordingMs: this.recordingRelativeNow(),
    }, force);
  }

  private recordingRelativeNow(): number | null {
    const anchor = this.recorder?.startTimeMs;
    return anchor === null || anchor === undefined ? null : Math.max(0, this.now() - this.origin - anchor);
  }

  private receive(frame: PoseFrame): void {
    if (this.state.phase !== 'previewing' && this.state.phase !== 'recording') return;
    // A queued inference reply can arrive before a resumed interval callback.
    // Evaluate the recording deadline before allowing it into an analyzer.
    if (this.state.phase === 'recording') {
      this.tick();
      if (this.state.phase !== 'recording') return;
    }
    const size = this.state.frameSize;
    if (size && (size.width !== frame.width || size.height !== frame.height)) {
      if (this.state.phase === 'recording') this.end('SETUP_CHANGED', 'SETUP_CHANGED', 'Frame dimensions changed during recording.');
      else this.fail('Frame dimensions changed.');
      return;
    }
    this.currentFrame = frame; this.lastFrameAt = this.now(); this.frames++;
    const side = this.options!.side;
    const requiredLandmarks = EXERCISE_REQUIRED_LANDMARKS[this.exerciseId];
    const tracking = jointStatuses(frame, side, READINESS.minConfidence, requiredLandmarks);
    const stableMs = this.readiness.update(frame.timestampMs, tracking, requiredLandmarks);
    // Keep only the latest uninterrupted, usable setup run. A lost joint must
    // not poison the next baseline for the entire history window.
    const previousSample = this.samples.at(-1);
    if (requiredLandmarks.some((joint) => tracking[joint] !== 'ok') ||
        (previousSample && frame.timestampMs - previousSample.timestampMs > REST_MAX_GAP_MS)) this.samples = [];
    if (requiredLandmarks.every((joint) => tracking[joint] === 'ok')) this.samples.push(toSample(frame, side));
    this.samples = this.samples.filter((s) => s.timestampMs >= frame.timestampMs - 4000).slice(-128);
    if (this.session) { this.session.frame(frame); this.publishSession(); }
    const recordingStart = this.recorder?.startTimeMs;
    if (this.state.phase === 'recording' && this.pace && recordingStart !== null && recordingStart !== undefined && frame.timestampMs >= recordingStart &&
        this.pace.push(toSample(frame, side), frame.timestampMs - recordingStart)) this.update({ paceWarnings: this.pace.fastWarnings }, true);
    this.draw(frame);
    const elapsed = Math.max((this.now() - this.origin) / 1000, 0.001);
    const ready = this.readiness.ready(stableMs) && !!this.baseline && (this.exerciseId !== 'seated_forward_reach' || !!this.state.target);
    this.update({
      tracking,
      poseDetected: frame.points.some((point) => point.visibility !== null && point.visibility >= READINESS.minConfidence && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1),
      stableMs,
      ready,
      frameSize: { width: frame.width, height: frame.height },
      resultsPerSec: this.frames / elapsed,
      inferenceMs: frame.inferenceMs,
    });
  }

  private loop(token: number): void {
    if (token !== this.epoch || !this.video) return;
    if (this.now() - this.lastFrameAt > STALL_MS) { this.fail('Tracking stalled (no pose results for 4 seconds).'); return; }
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      void this.client?.send(this.video, this.now() - this.origin);
    }
    this.raf = requestAnimationFrame(() => this.loop(token));
  }

  private listen(): void {
    const hidden = () => { if (document.hidden) this.fail('Capture stopped because the page was hidden.'); };
    const orientation = () => {
      if (this.state.phase === 'recording') this.end('SETUP_CHANGED', 'SETUP_CHANGED', 'Device orientation changed during recording.');
      else this.fail('Device orientation changed.');
    };
    const pagehide = () => this.fail('Page closed.');
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('orientationchange', orientation);
    window.addEventListener('pagehide', pagehide);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', hidden), () => window.removeEventListener('orientationchange', orientation), () => window.removeEventListener('pagehide', pagehide));
  }

  private teardown(): void {
    cancelAnimationFrame(this.raf); clearInterval(this.timer); this.timer = undefined;
    this.cleanup.splice(0).forEach((remove) => remove());
    this.client?.close(); this.client = null;
    this.camera?.stop(); this.camera = null;
    if (this.video) { this.video.srcObject = null; this.video.style.transform = ''; }
    this.currentFrame = null; this.samples = [];
    const context = this.canvas?.getContext('2d');
    if (context && this.canvas) context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private resetSetupState(): void {
    this.baseline = null; this.samples = []; this.readiness.reset();
    this.state = { ...this.state, reference: [], baseline: false, target: null, selecting: 'reference', ready: false, stableMs: 0, poseDetected: false };
  }

  private update(patch: Partial<CaptureSnapshot>, force = false): void {
    this.state = { ...this.state, ...patch };
    const now = this.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    this.listener(this.state);
  }

  private draw(frame: PoseFrame): void {
    const canvas = this.canvas, context = canvas?.getContext('2d');
    if (!canvas || !context || !this.options) return;
    if (canvas.width !== frame.width || canvas.height !== frame.height) { canvas.width = frame.width; canvas.height = frame.height; }
    context.clearRect(0, 0, canvas.width, canvas.height);
    const mirrored = this.options.mirrored;
    const x = (px: number) => previewX(px / canvas.width, mirrored) * canvas.width;
    drawSkeleton(context, frame, mirrored);
    context.font = '14px system-ui, sans-serif';

    if (needsReference(this.exerciseId)) {
      this.state.reference.forEach((p, i) => {
        context.fillStyle = '#f2c14e'; context.beginPath(); context.arc(x(p.x), p.y, 7, 0, Math.PI * 2); context.fill();
        context.fillText(`Ref ${i + 1}`, x(p.x) + 10, p.y - 8);
      });
      const target = this.state.target, [r1, r2] = this.state.reference;
      if (target && r1 && r2) {
        const radius = Math.hypot(r2.x - r1.x, r2.y - r1.y) * (this.session instanceof ReachSession ? this.session.config.settings.targetRadius : PREVIEW_TARGET_RADIUS);
        context.strokeStyle = '#ef7a85'; context.lineWidth = 3; context.beginPath(); context.arc(x(target.x), target.y, radius, 0, Math.PI * 2); context.stroke();
        context.fillStyle = '#ef7a85';
        const labelWidth = context.measureText('Target region').width;
        const right = x(target.x) + radius + 6 + labelWidth <= canvas.width;
        context.fillText('Target region', right ? x(target.x) + radius + 6 : x(target.x) - radius - 6 - labelWidth, target.y);
      }
    }
  }
}
