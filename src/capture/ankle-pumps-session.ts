import { SeatedAnklePumpsAnalyzer, summarizeAnklePumps, type AnklePumpsConfig, type AnklePumpsAttempt, ANKLE_PUMPS_JOINTS } from '../analysis/seated-ankle-pumps.js';
import { type Interruption, type ReachFrame } from '../analysis/reach-contract.js';
import { toSample, type PoseFrame } from '../pose/observations.js';

export function developerAnklePumpsConfig(
  baseline: AnklePumpsConfig['baseline'],
  endpointDeg: number,
  screenForwardSign: 1 | -1,
  pumpDirectionSign: 1 | -1,
  directionVerified: true,
  width: number,
  height: number,
  side: AnklePumpsConfig['side'],
  sessionId: string,
  criteria: AnklePumpsConfig['criteria'] = []
): AnklePumpsConfig {
  return {
    sessionId, configurationId: `${sessionId}:setup`, version: 'ankle-pumps.developer-v2', mode: 'rehabilitation', side,
    frameWidth: width, frameHeight: height, orientation: 'close-side-view', baseline, screenForwardSign, pumpDirectionSign, directionVerified, endpointDeg,
    settings: {
      minConfidence: { knee: 0.5, ankle: 0.5, heel: 0.5, footIndex: 0.5 },
      minSegmentPx: 2,
      minExcursionThresholdDeg: 3, maxAngularStepDeg: 90,
      restToleranceDeg: 3, endpointToleranceDeg: 4, onsetExcursionDeg: 5, returnHysteresisDeg: 3,
      readinessMs: 500, onsetDwellMs: 150, endpointDwellMs: 150, returnDwellMs: 150,
      timeoutMs: 15_000, smoothingTauMs: 0, filterResetGapMs: 250, sampleSupportMs: 250, maxGapMs: 1000, minCoverage: 0.8, minObservations: 6,
    },
    criteria,
  };
}

export class AnklePumpsSession {
  readonly analyzer: SeatedAnklePumpsAnalyzer;
  readonly attempts: AnklePumpsAttempt[] = [];
  private ended = false;
  constructor(readonly config: AnklePumpsConfig, readonly recordingStartMs: number, readonly support: string) {
    if (!Number.isFinite(recordingStartMs) || recordingStartMs < 0) throw new Error('Invalid recording anchor');
    if (!support.trim()) throw new Error('Describe foot/leg support, including none if unsupported');
    this.analyzer = new SeatedAnklePumpsAnalyzer(config);
    this.config = this.analyzer.configuration;
  }
  frame(frame: PoseFrame): void {
    if (this.ended || frame.timestampMs < this.recordingStartMs) return;
    const sample = toSample(frame, this.config.side);
    const landmarks: ReachFrame['landmarks'] = {};
    for (const key of ANKLE_PUMPS_JOINTS) if (sample.landmarks[key]) landmarks[key] = sample.landmarks[key];
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
  summary() { return summarizeAnklePumps(this.attempts); }
  private collect(): void { this.attempts.push(...this.analyzer.drain()); }
}
