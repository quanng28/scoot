import { REACH_JOINTS, type PixelPose, type ReachConfig, type ReachFrame, type Reason, type Observation } from './reach-contract.js';

type Point = { x: number; y: number };
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const inclination = (pose: PixelPose) => Math.atan2(pose.shoulder.x - pose.hip.x, -(pose.shoulder.y - pose.hip.y)) * 180 / Math.PI;
export function validateReachCalibration(c: ReachConfig): void {
  const s = c.settings, length = distance(...c.reference), target = distance(c.target, c.baseline.wrist) / length;
  const points = [...Object.values(c.baseline), ...c.reference, c.target];
  if (points.some((p) => p.x < 0 || p.y < 0 || p.x > c.frameWidth || p.y > c.frameHeight) ||
      length < s.minReferencePx || Math.abs(c.target.x - c.baseline.wrist.x) < s.minForwardPx ||
      target <= s.restRadius + s.targetRadius || s.onsetDistance < s.restRadius ||
      s.onsetDistance >= target - s.targetRadius || s.returnHysteresis >= target - s.restRadius ||
      s.sampleSupportMs > s.maxGapMs || s.filterResetGapMs > s.maxGapMs ||
      [s.readinessMs, s.onsetDwellMs, s.targetDwellMs, s.returnDwellMs].some((ms) => ms >= s.timeoutMs) ||
      !nondegenerate(c.baseline, s.minSegmentPx)) throw new Error('Invalid reach calibration or incompatible engineering settings');
}
function nondegenerate(p: PixelPose, minimum: number): boolean {
  return Object.values(p).every(v => Number.isFinite(v.x) && Number.isFinite(v.y)) &&
    [distance(p.shoulder,p.elbow),distance(p.elbow,p.wrist),distance(p.shoulder,p.hip)].every(d => Number.isFinite(d) && d >= minimum);
}
export function pixelObservation(frame: ReachFrame, config: { settings: Pick<ReachConfig['settings'], 'minConfidence' | 'minSegmentPx'> }): { pose: PixelPose; reason?: never } | { pose?: never; reason: Reason } {
  if (![frame.width,frame.height].every(v => Number.isFinite(v) && v>0 && v<=16384)) return {reason:'DEGENERATE_GEOMETRY'};
  const pose = {} as PixelPose;
  for (const key of REACH_JOINTS) {
    const p = frame.landmarks[key];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.confidence === null || !Number.isFinite(p.confidence) || p.confidence < config.settings.minConfidence[key] || p.confidence > 1) return { reason: 'LOW_LANDMARK_QUALITY' };
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return { reason: 'OUT_OF_FRAME' };
    pose[key] = { x: p.x * frame.width, y: p.y * frame.height };
  }
  return nondegenerate(pose, config.settings.minSegmentPx) ? { pose } : { reason: 'DEGENERATE_GEOMETRY' };
}
export function measureReach(raw: PixelPose, previous: Observation | null, timestampMs: number, config: ReachConfig): Observation | null {
  const tau = config.settings.smoothingTauMs;
  const alpha = !previous || tau === 0 ? 1 : 1 - Math.exp(-(timestampMs - previous.timestampMs) / tau);
  const filtered = {} as PixelPose;
  for (const key of REACH_JOINTS) {
    const p = previous?.filtered[key] ?? raw[key];
    filtered[key] = { x: p.x + alpha * (raw[key].x - p.x), y: p.y + alpha * (raw[key].y - p.y) };
  }
  if (!nondegenerate(filtered, config.settings.minSegmentPx)) return null;
  const { shoulder: a, elbow: b, wrist: w } = filtered;
  const cosine = ((a.x - b.x) * (w.x - b.x) + (a.y - b.y) * (w.y - b.y)) / (distance(a, b) * distance(w, b));
  const rest = config.baseline.wrist, target = config.target, length = distance(...config.reference), directionLength = distance(rest, target);
  const forward = ((w.x - rest.x) * (target.x - rest.x) + (w.y - rest.y) * (target.y - rest.y)) / directionLength / length;
  const measured = { timestampMs, raw, filtered, elbowDeg: Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI,
    torsoDeltaDeg: Math.sign(target.x - rest.x) * wrap(inclination(filtered) - inclination(config.baseline)),
    forward, displacement: distance(w, rest) / length, restDistance: distance(w, rest) / length, targetDistance: distance(w, target) / length };
  return [timestampMs,measured.elbowDeg,measured.torsoDeltaDeg,measured.forward,measured.displacement,measured.restDistance,measured.targetDistance].every(Number.isFinite) ? measured : null;
}
