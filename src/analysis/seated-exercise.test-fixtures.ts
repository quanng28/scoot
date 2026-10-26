import type { ReachFrame } from './reach-contract.js';
import type { ArmRaiseConfig } from './seated-arm-raise.js';
import type { KneeExtensionConfig, KneePose } from './seated-knee-extension.js';
import type { LegLiftConfig, LegLiftPose } from './seated-single-leg-lift.js';
import type { AnklePumpsConfig, AnklePose } from './seated-ankle-pumps.js';

export type Point = { x: number; y: number };
export const reference: [Point, Point] = [{ x: 20, y: 20 }, { x: 120, y: 20 }];
export const timing = {
  minSegmentPx: 2, readinessMs: 100, onsetDwellMs: 100, endpointDwellMs: 100,
  returnDwellMs: 100, timeoutMs: 2000, smoothingTauMs: 0, filterResetGapMs: 100,
  sampleSupportMs: 80, maxGapMs: 200, minCoverage: 0.8, minObservations: 6,
};
const common = {
  sessionId: 'fixture', configurationId: 'fixture:setup', version: 'synthetic-v2',
  mode: 'rehabilitation' as const, side: 'left' as const,
  frameWidth: 600, frameHeight: 400, orientation: 'side-view',
};

// Geometry is generated in pixels, then independently encoded in each frame shape.
export function armPose(angle = 0) {
  const r = angle * Math.PI / 180;
  return { shoulder: { x: 200, y: 100 }, hip: { x: 200, y: 250 },
    elbow: { x: 200 + 50 * Math.sin(r), y: 100 + 50 * Math.cos(r) },
    wrist: { x: 200 + 100 * Math.sin(r), y: 100 + 100 * Math.cos(r) } };
}
export function kneePose(angle = 90): KneePose {
  const r = angle * Math.PI / 180;
  return { hip: { x: 150, y: 150 }, knee: { x: 200, y: 150 },
    ankle: { x: 200 - 50 * Math.cos(r), y: 150 + 50 * Math.sin(r) } };
}
export function liftPose(elevation = 0): LegLiftPose {
  return { shoulder: { x: 200, y: 100 }, hip: { x: 200, y: 250 },
    knee: { x: 250, y: 250 - elevation * 100 }, ankle: { x: 250, y: 300 - elevation * 100 } };
}
export function anklePose(beta = 90): AnklePose {
  const footRadians = (beta - 90) * Math.PI / 180;
  return { knee: { x: 200, y: 150 }, ankle: { x: 200, y: 250 },
    footIndex: { x: 200 + 50 * Math.cos(footRadians), y: 250 + 50 * Math.sin(footRadians) },
    heel: { x: 200 - 20 * Math.cos(footRadians), y: 250 - 20 * Math.sin(footRadians) } };
}
export function armConfig(): ArmRaiseConfig {
  return { ...common, baseline: armPose(), reference: structuredClone(reference), forwardSign: 1,
    endpointDriver: 'upperArmAngle', endpointDeg: 90, endpointElevation: 1,
    settings: { ...timing, minReferencePx: 2, minConfidence: { shoulder: 0.5, elbow: 0.5, wrist: 0.5, hip: 0.5 },
      restToleranceDeg: 5, endpointToleranceDeg: 5, onsetExcursionDeg: 20, returnHysteresisDeg: 10,
      restToleranceElevation: 0.05, endpointToleranceElevation: 0.05, onsetExcursionElevation: 0.2, returnHysteresisElevation: 0.1 }, criteria: [] };
}
export function kneeConfig(): KneeExtensionConfig {
  return { ...common, baseline: kneePose(), endpointDeg: 180,
    settings: { ...timing, minConfidence: { hip: 0.5, knee: 0.5, ankle: 0.5 },
      restToleranceDeg: 5, endpointToleranceDeg: 5, onsetExcursionDeg: 20, returnHysteresisDeg: 10 }, criteria: [] };
}
export function liftConfig(): LegLiftConfig {
  return { ...common, baseline: liftPose(), reference: structuredClone(reference), forwardSign: 1, endpointElevation: 0.5,
    settings: { ...timing, minReferencePx: 2, minConfidence: { shoulder: 0.5, hip: 0.5, knee: 0.5, ankle: 0.5 },
      restTolerance: 0.05, endpointTolerance: 0.05, onsetElevation: 0.2, returnHysteresis: 0.1 }, criteria: [] };
}
export function ankleConfig(): AnklePumpsConfig {
  return { ...common, baseline: anklePose(), screenForwardSign: 1, pumpDirectionSign: 1, directionVerified: true,
    endpointDeg: 30,
    settings: { ...timing, maxAngularStepDeg: 90, minConfidence: { knee: 0.5, ankle: 0.5, heel: 0.5, footIndex: 0.5 },
      minExcursionThresholdDeg: 3, restToleranceDeg: 2, endpointToleranceDeg: 2, onsetExcursionDeg: 5, returnHysteresisDeg: 3 }, criteria: [] };
}

export function poseFrame(
  timestampMs: number,
  pose: Partial<Record<keyof ReachFrame['landmarks'], Point>>,
  config: Pick<ArmRaiseConfig, 'frameWidth' | 'frameHeight' | 'side' | 'orientation'> = common,
): ReachFrame {
  const landmarks: ReachFrame['landmarks'] = {};
  for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
    const p = pose[key];
    if (p) landmarks[key] = { x: p.x / config.frameWidth, y: p.y / config.frameHeight, confidence: 1 };
  }
  return { timestampMs, width: config.frameWidth, height: config.frameHeight,
    orientation: config.orientation, side: config.side, landmarks };
}

export function runFixtureCycle<P extends Partial<Record<keyof ReachFrame['landmarks'], Point>>>(
  engine: { accept(frame: ReachFrame): void; advance(time: number): void },
  config: Pick<ArmRaiseConfig, 'frameWidth' | 'frameHeight' | 'side' | 'orientation'>,
  poses: { rest: P; outward: P; endpoint: P; returning: P },
  offset = 0,
): void {
  const steps = [
    { times: [0, 47, 109], pose: poses.rest }, { times: [161, 213, 270], pose: poses.outward },
    { times: [337, 389, 442, 503, 568], pose: poses.endpoint },
    { times: [620, 675, 729], pose: poses.returning }, { times: [781, 834, 889], pose: poses.rest },
  ];
  for (const step of steps) for (const time of step.times) engine.accept(poseFrame(time + offset, step.pose, config));
  engine.advance(890 + offset);
}
export function reflected<P extends Record<string, Point>>(pose: P, width = 600): P {
  const copy = structuredClone(pose);
  for (const point of Object.values(copy)) point.x = width - point.x;
  return copy;
}
