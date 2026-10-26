import { SeatedElbowAnalyzer, summarizeElbow, type ElbowConfig, type ElbowAttempt } from '../analysis/seated-elbow.js';
import { REACH_JOINTS, type PixelPose, type Interruption, type ReachFrame } from '../analysis/reach-contract.js';
import { toSample, type PoseFrame } from '../pose/observations.js';

/** Experimental angle-based developer setup; no reach target or distance scale. */
export function developerElbowConfig(baseline: PixelPose, endpointDeg: number, forwardSign: 1 | -1, width: number, height: number, side: ElbowConfig['side'], sessionId: string, torsoThreshold: number | null): ElbowConfig {
  return { sessionId, configurationId: sessionId + ':setup', version: 'elbow.developer-v1', mode: 'rehabilitation', side,
    frameWidth: width, frameHeight: height, orientation: 'fixed-intrinsic-frame', baseline, endpointDeg, forwardSign,
    settings: { minConfidence: { shoulder: 0.5, elbow: 0.5, wrist: 0.5, hip: 0.5 }, minSegmentPx: 2,
      restToleranceDeg: 10, endpointToleranceDeg: 10, onsetExcursionDeg: 20, returnHysteresisDeg: 10,
      readinessMs: 500, onsetDwellMs: 150, endpointDwellMs: 150, returnDwellMs: 150,
      timeoutMs: 15_000, smoothingTauMs: 0, filterResetGapMs: 250, sampleSupportMs: 250, maxGapMs: 1000, minCoverage: 0.8, minObservations: 6 },
    criteria: torsoThreshold === null ? [] : [{ metric: 'torsoForwardPeakDeg', operator: '>', threshold: torsoThreshold }] };
}

/** Binds one analyzer to one recording start; no previous-recording results leak in. */
export class ElbowSession {
  readonly analyzer: SeatedElbowAnalyzer;
  readonly attempts: ElbowAttempt[] = [];
  private ended = false;
  constructor(readonly config: ElbowConfig, readonly recordingStartMs: number, readonly support: string) {
    if (!Number.isFinite(recordingStartMs) || recordingStartMs < 0) throw new Error('Invalid recording anchor');
    if (!support.trim()) throw new Error('Describe elbow support, including none if unsupported');
    this.analyzer = new SeatedElbowAnalyzer(config);
    this.config = this.analyzer.configuration;
  }
  frame(frame: PoseFrame): void {
    if (this.ended || frame.timestampMs < this.recordingStartMs) return;
    const sample = toSample(frame, this.config.side);
    const landmarks: ReachFrame['landmarks'] = {};
    for (const key of REACH_JOINTS) if (sample.landmarks[key]) landmarks[key] = sample.landmarks[key];
    this.analyzer.accept({ timestampMs: frame.timestampMs - this.recordingStartMs, width: frame.width, height: frame.height,
      orientation: this.config.orientation, side: this.config.side, landmarks });
    this.collect();
  }
  tick(cameraRunMs: number): void {
    if (this.ended || cameraRunMs < this.recordingStartMs) return;
    this.analyzer.advance(cameraRunMs - this.recordingStartMs); this.collect();
  }
  stop(cameraRunMs: number, reason: Interruption): void {
    if (this.ended) return;
    this.analyzer.interrupt(Math.max(0, cameraRunMs - this.recordingStartMs), reason);
    this.collect(); this.ended = true;
  }
  summary() { return summarizeElbow(this.attempts); }
  private collect(): void { this.attempts.push(...this.analyzer.drain()); }
}
