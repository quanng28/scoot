import { SeatedSingleLegLiftAnalyzer, summarizeSingleLegLift, type LegLiftConfig, type LegLiftAttempt, LEG_LIFT_JOINTS } from '../analysis/seated-single-leg-lift.js';
import { type Interruption, type ReachFrame } from '../analysis/reach-contract.js';
import { toSample, type PoseFrame } from '../pose/observations.js';

export function developerLegLiftConfig(
  baseline: LegLiftConfig['baseline'],
  reference: LegLiftConfig['reference'],
  endpointElevation: number,
  forwardSign: 1 | -1,
  width: number,
  height: number,
  side: LegLiftConfig['side'],
  sessionId: string,
  criteria: LegLiftConfig['criteria'] = []
): LegLiftConfig {
  return {
    sessionId, configurationId: `${sessionId}:setup`, version: 'leg-lift.developer-v2', mode: 'rehabilitation', side,
    frameWidth: width, frameHeight: height, orientation: 'fixed-intrinsic-frame', baseline, reference, forwardSign, endpointElevation,
    settings: {
      minConfidence: { shoulder: 0.5, hip: 0.5, knee: 0.5, ankle: 0.5 },
      minSegmentPx: 2, minReferencePx: 2,
      restTolerance: 0.05, endpointTolerance: 0.05, onsetElevation: 0.08, returnHysteresis: 0.05,
      readinessMs: 500, onsetDwellMs: 150, endpointDwellMs: 150, returnDwellMs: 150,
      timeoutMs: 15_000, smoothingTauMs: 0, filterResetGapMs: 250, sampleSupportMs: 250, maxGapMs: 1000, minCoverage: 0.8, minObservations: 6,
    },
    criteria,
  };
}

export class LegLiftSession {
  readonly analyzer: SeatedSingleLegLiftAnalyzer;
  readonly attempts: LegLiftAttempt[] = [];
  private ended = false;
  constructor(readonly config: LegLiftConfig, readonly recordingStartMs: number, readonly support: string) {
    if (!Number.isFinite(recordingStartMs) || recordingStartMs < 0) throw new Error('Invalid recording anchor');
    if (!support.trim()) throw new Error('Describe seating and leg support, including none if unsupported');
    this.analyzer = new SeatedSingleLegLiftAnalyzer(config);
    this.config = this.analyzer.configuration;
  }
  frame(frame: PoseFrame): void {
    if (this.ended || frame.timestampMs < this.recordingStartMs) return;
    const sample = toSample(frame, this.config.side);
    const landmarks: ReachFrame['landmarks'] = {};
    for (const key of LEG_LIFT_JOINTS) if (sample.landmarks[key]) landmarks[key] = sample.landmarks[key];
    this.analyzer.accept({
      timestampMs: frame.timestampMs - this.recordingStartMs,
      width: frame.width,
      height: frame.height,
      orientation: this.config.orientation,
      side: this.config.side,
      landmarks,
    });
    this.collect();
  }
  tick(cameraRunMs: number): void {
    if (this.ended || cameraRunMs < this.recordingStartMs) return;
    this.analyzer.advance(cameraRunMs - this.recordingStartMs);
    this.collect();
  }
  stop(cameraRunMs: number, reason: Interruption): void {
    if (this.ended) return;
    this.analyzer.interrupt(Math.max(0, cameraRunMs - this.recordingStartMs), reason);
    this.collect();
    this.ended = true;
  }
  summary() { return summarizeSingleLegLift(this.attempts); }
  private collect(): void { this.attempts.push(...this.analyzer.drain()); }
}
