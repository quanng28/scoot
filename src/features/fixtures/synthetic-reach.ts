import { SeatedReachAnalyzer } from '../../analysis/seated-reach.js';
import type { ReachFrame } from '../../analysis/reach-contract.js';
import { recordingEvidence, toAttemptRecord, type SessionRecord } from '../../contracts/reach-session.js';
import { buildReachConfig, buildSessionRecord, emptySetup, type SetupDraft } from '../setup/setup-model.js';

/**
 * Labeled synthetic session: a scripted landmark timeline passed through Quan P's real SR01 analyzer.
 * It demonstrates the results/replay-unavailable UI without a camera. It is never a live measurement,
 * and its illustrative 10° torso criterion is a code fixture, not a clinical cutoff.
 */
const WIDTH = 400, HEIGHT = 300;
const BASELINE = { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 100, y: 100 }, hip: { x: 50, y: 150 } };
const TORSO_12_DEG_SHOULDER_X = 50 + 100 * Math.tan((12 * Math.PI) / 180);

function frame(time: number, wristX: number, shoulderX = BASELINE.shoulder.x): ReachFrame {
  const point = (x: number, y: number) => ({ x: x / WIDTH, y: y / HEIGHT, confidence: 0.95 });
  return { timestampMs: time, width: WIDTH, height: HEIGHT, orientation: 'fixed-intrinsic-frame', side: 'left', landmarks: {
    shoulder: point(shoulderX, BASELINE.shoulder.y), elbow: point(BASELINE.elbow.x, BASELINE.elbow.y),
    wrist: point(wristX, BASELINE.wrist.y), hip: point(BASELINE.hip.x, BASELINE.hip.y) } };
}

function fixtureDraft(today: string): SetupDraft {
  const draft = emptySetup(today);
  return { ...draft, mode: 'rehabilitation', participantLabel: 'SYNTHETIC-01', taskLabel: 'Seated forward reach (synthetic fixture)',
    supervisorLabel: 'SYNTHETIC-SUPERVISOR', attestationContext: 'Synthetic fixture; no person was recorded.', attested: true, side: 'left',
    seatingSupport: 'Synthetic: chair with back support, no arm support', targetPlacement: 'Synthetic image target at 1 reference length forward',
    assignedRangeOrGoal: 'Synthetic: reach to target and return', teamTestConfirmed: true,
    criteria: draft.criteria.map((c) => c.metric === 'torsoForwardPeakDeg' ? { ...c, enabled: true, operator: '>', threshold: '10' } : c) };
}

export function syntheticReachSession(sessionId: string, now = new Date()): SessionRecord {
  const draft = fixtureDraft(now.toISOString().slice(0, 10));
  const config = buildReachConfig(draft, { kind: 'reach', baseline: BASELINE, reference: [{ x: 0, y: 0 }, { x: 100, y: 0 }], target: { x: 200, y: 100 }, width: WIDTH, height: HEIGHT }, sessionId);
  const engine = new SeatedReachAnalyzer(config);
  let time = 0;
  const hold = (until: number, wristX: number, shoulderX?: number) => { for (; time <= until; time += 50) engine.accept(frame(time, wristX, shoulderX)); };
  const cycle = (offset: number, peakX: number, shoulderX?: number) => {
    hold(offset + 550, 100); hold(offset + 800, 150, shoulderX); hold(offset + 1150, peakX, shoulderX);
    if (peakX >= 200) hold(offset + 1400, 150);
    hold(offset + 1950, 100);
  };
  cycle(0, 200);                              // measurable
  cycle(2000, 200, TORSO_12_DEG_SHOULDER_X);  // measurable, exceeds illustrative > 10° torso criterion
  cycle(4000, 160);                           // excluded: target region not reached
  cycle(6000, 200);                           // measurable
  engine.advance(time);
  const attempts = engine.drain().map(toAttemptRecord);
  const stamp = now.toISOString();
  return buildSessionRecord({ draft, config, provenance: 'labeled_synthetic_fixture', createdAt: stamp, endedAt: stamp, attempts,
    recording: recordingEvidence(null, 'Synthetic fixture: no camera recording exists.'),
    stopReason: 'SYNTHETIC_FIXTURE', stoppedAtMs: time, message: 'Generated from a scripted landmark timeline.', discomfortAtMs: null });
}
