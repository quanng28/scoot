import { SeatedReachAnalyzer, summarizeReach } from '../analysis/seated-reach.js';
import { REACH_JOINTS, type ReachConfig, type ReachAttempt, type PixelPose, type Interruption, type ReachFrame } from '../analysis/reach-contract.js';
import { toSample, type PoseFrame } from '../pose/observations.js';
import { createReachProducerOutput, type ReachProducerOutput } from '../contracts/reach-producer.js';
import type { Recording } from './recorder.js';

/** Only for the explicitly labeled developer path. Values require device validation. */
export function developerReachConfig(baseline: PixelPose, reference: ReachConfig['reference'], target: ReachConfig['target'], width: number, height: number, side: ReachConfig['side'], sessionId: string, torsoThreshold: number | null): ReachConfig {
  return { sessionId, configurationId: `${sessionId}:setup`, version: 'reach.developer-v1', mode: 'rehabilitation', side,
    frameWidth: width, frameHeight: height, orientation: 'fixed-intrinsic-frame', baseline, reference, target,
    settings: { minConfidence: { shoulder: 0.5, elbow: 0.5, wrist: 0.5, hip: 0.5 }, minSegmentPx: 2, minReferencePx: 20, minForwardPx: 10,
      restRadius: 0.12, targetRadius: 0.12, onsetDistance: 0.2, returnHysteresis: 0.1,
      readinessMs: 500, onsetDwellMs: 150, targetDwellMs: 150, returnDwellMs: 150,
      timeoutMs: 15_000, smoothingTauMs: 0, filterResetGapMs: 250, sampleSupportMs: 250, maxGapMs: 1000, minCoverage: 0.8, minObservations: 6 },
    criteria: torsoThreshold === null ? [] : [{ metric: 'torsoForwardPeakDeg', operator: '>', threshold: torsoThreshold }] };
}

/** Binds one analyzer to one recording start; no previous-recording results leak in. */
export class ReachSession {
  readonly analyzer: SeatedReachAnalyzer;
  readonly attempts: ReachAttempt[] = [];
  private readonly snapshot: ReachConfig;
  /** Defensive copies prevent callers from changing side/orientation after setup. */
  get config(): ReachConfig { return structuredClone(this.snapshot); }
  private ended = false;
  private clockMs = 0;
  constructor(config: ReachConfig, readonly recordingStartMs: number) {
    if (!Number.isFinite(recordingStartMs) || recordingStartMs < 0) throw new Error('Invalid recording anchor');
    this.analyzer = new SeatedReachAnalyzer(config);
    this.snapshot = this.analyzer.configuration;
  }
  frame(frame: PoseFrame): void {
    if (this.ended || !Number.isFinite(frame.timestampMs) || frame.timestampMs < this.recordingStartMs) return;
    this.clockMs = Math.max(this.clockMs,frame.timestampMs-this.recordingStartMs);
    const sample = toSample(frame, this.snapshot.side);
    const landmarks: ReachFrame['landmarks'] = {};
    for (const key of REACH_JOINTS) if (sample.landmarks[key]) landmarks[key] = sample.landmarks[key];
    this.analyzer.accept({ timestampMs: frame.timestampMs - this.recordingStartMs, width: frame.width, height: frame.height,
      orientation: this.snapshot.orientation, side: this.snapshot.side, landmarks });
    this.collect();
  }
  tick(cameraRunMs: number): void {
    if (this.ended || !Number.isFinite(cameraRunMs) || cameraRunMs < this.recordingStartMs) return;
    this.clockMs = Math.max(this.clockMs,cameraRunMs-this.recordingStartMs);
    this.analyzer.advance(this.clockMs); this.collect();
  }
  stop(cameraRunMs: number, reason: Interruption): void {
    if (this.ended) return;
    if (!Number.isFinite(cameraRunMs) || cameraRunMs<0) throw new Error('Invalid stop clock');
    this.clockMs = Math.max(this.clockMs, cameraRunMs-this.recordingStartMs, 0);
    this.analyzer.interrupt(this.clockMs, reason);
    this.collect(); this.ended = true;
  }
  summary() { return summarizeReach(this.attempts); }
  /** Consumer checks replay decoding and persistence separately. Stop/finalize capture first. */
  result(recording:Recording,provenance:ReachProducerOutput['provenance']):ReachProducerOutput {
    if(!this.ended) throw new Error('Stop analysis before exporting results');
    if(recording.startMs!==this.recordingStartMs) throw new Error('Recording anchor mismatch');
    return createReachProducerOutput(this.snapshot,this.attempts,recording,provenance);
  }
  private collect(): void { this.attempts.push(...this.analyzer.drain()); }
}
