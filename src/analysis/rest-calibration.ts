import { z } from 'zod';
import { extractionInputSchema, type ExtractionInput } from './movement-features.js';
import type { PixelPose } from './reach-contract.js';

type Sample = ExtractionInput['samples'][number];
type Point = { x: number; y: number };
// Setup may run below 4 results/s when body and hand inference share the CPU.
// Movement analysis retains its own stricter gap and coverage rules.
export const REST_MAX_GAP_MS = 500;
const pointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
};

/** Validate the time window once, then read only the selected exercise's required joints. */
function stableRest(rawSamples: Sample[], width: number, height: number, instruction: string) {
  const samples = extractionInputSchema.shape.samples.parse(rawSamples);
  if (![width, height].every((v) => Number.isFinite(v) && v > 0 && v <= 16384)) throw new Error('Invalid frame');
  if (samples.length < 6 || samples.at(-1)!.timestampMs - samples[0]!.timestampMs < 1000) throw new Error(instruction);
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i]!.timestampMs - samples[i - 1]!.timestampMs;
    if (delta <= 0 || delta > REST_MAX_GAP_MS) throw new Error('Rest window has a tracking gap');
  }
  return (key: keyof Sample['landmarks']): Point => {
    const pixels = samples.map((sample) => {
      const point = sample.landmarks[key];
      if (!point || point.confidence === null || point.confidence < 0.5 || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
        throw new Error(`Rest calibration needs visible ${key}`);
      return { x: point.x * width, y: point.y * height };
    });
    const center = { x: median(pixels.map((point) => point.x)), y: median(pixels.map((point) => point.y)) };
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || pixels.some((point) => Math.hypot(point.x - center.x, point.y - center.y) > 20))
      throw new Error('Rest position moved; hold still and retry');
    return center;
  };
}
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Stable four-joint developer baseline; no distance reference is needed for SR02. */
export function calibratePoseBaseline(rawSamples: Sample[], width: number, height: number): PixelPose {
  const get = stableRest(rawSamples, width, height, 'Hold still with shoulder, elbow, wrist and hip visible for at least one second');
  const baseline = { shoulder: get('shoulder'), elbow: get('elbow'), wrist: get('wrist'), hip: get('hip') };
  if (distance(baseline.shoulder, baseline.hip) < 20) throw new Error('Shoulder–hip reference is too short');
  return baseline;
}

/** Fixed horizontal engineering recognition baseline. Reset on setup/side/view changes.
 * These pixel settings are experimental and do not establish clinical validity.
 */
export function calibrateRest(samples: Sample[], width: number, height: number, rawReference: [Point, Point], forwardSign: 1 | -1): ExtractionInput['calibration'] {
  const reference = z.tuple([pointSchema, pointSchema]).parse(rawReference);
  if (![1, -1].includes(forwardSign)) throw new Error('Invalid frame/direction');
  if (!reference.every((p) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)) throw new Error('Reference points must be inside the image');
  const referenceLengthPx = Math.hypot(reference[1].x - reference[0].x, reference[1].y - reference[0].y);
  if (!Number.isFinite(referenceLengthPx) || referenceLengthPx < 20) throw new Error('Choose reference points at least 20 image pixels apart');
  const baseline = calibratePoseBaseline(samples, width, height);
  const dx = baseline.shoulder.x - baseline.hip.x, dy = baseline.shoulder.y - baseline.hip.y;
  return { referenceLengthPx, forwardSign, wristRest: baseline.wrist, kneeRest: null,
    forwardUnit: { x: forwardSign, y: 0 }, torsoRestDeg: Math.atan2(dx, -dy) * 180 / Math.PI, ankleRestDeg: null };
}

/** Preserve all four fixed joints for SR01's separate target-based calibration. */
export function calibrateReachBaseline(samples: Sample[], width: number, height: number, reference: [Point, Point]): PixelPose {
  calibrateRest(samples, width, height, reference, 1);
  return calibratePoseBaseline(samples, width, height);
}

export type KneeExtensionBaseline = { hip: Point; knee: Point; ankle: Point };
export function calibrateKneeExtensionBaseline(rawSamples: Sample[], width: number, height: number): KneeExtensionBaseline {
  const get = stableRest(rawSamples, width, height, 'Hold still with hip, knee and ankle visible for at least one second');
  const baseline = { hip: get('hip'), knee: get('knee'), ankle: get('ankle') };
  if (distance(baseline.hip, baseline.knee) < 20) throw new Error('Thigh reference (hip–knee) is too short');
  if (distance(baseline.knee, baseline.ankle) < 20) throw new Error('Shank reference (knee–ankle) is too short');
  return baseline;
}

export type LegLiftBaseline = { shoulder: Point; hip: Point; knee: Point; ankle: Point };
export function calibrateLegLiftBaseline(rawSamples: Sample[], width: number, height: number): LegLiftBaseline {
  const get = stableRest(rawSamples, width, height, 'Hold still with shoulder, hip, knee and ankle visible for at least one second');
  const baseline = { shoulder: get('shoulder'), hip: get('hip'), knee: get('knee'), ankle: get('ankle') };
  if (distance(baseline.shoulder, baseline.hip) < 20) throw new Error('Trunk reference (shoulder–hip) is too short');
  if (distance(baseline.hip, baseline.knee) < 20) throw new Error('Thigh reference (hip–knee) is too short');
  if (distance(baseline.knee, baseline.ankle) < 20) throw new Error('Shank reference (knee–ankle) is too short');
  return baseline;
}

export type AnklePumpsBaseline = { knee: Point; ankle: Point; heel: Point; footIndex: Point };
export function calibrateAnklePumpsBaseline(rawSamples: Sample[], width: number, height: number): AnklePumpsBaseline {
  const get = stableRest(rawSamples, width, height, 'Hold still with knee, ankle, heel and foot index visible for at least one second');
  const baseline = { knee: get('knee'), ankle: get('ankle'), heel: get('heel'), footIndex: get('footIndex') };
  if (distance(baseline.knee, baseline.ankle) < 15) throw new Error('Shank segment (knee–ankle) is too short');
  if (distance(baseline.ankle, baseline.footIndex) < 15) throw new Error('Foot segment (ankle–footIndex) is too short');
  if (distance(baseline.ankle, baseline.heel) < 10) throw new Error('Heel segment (ankle–heel) is too short');
  return baseline;
}
