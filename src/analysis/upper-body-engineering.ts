import { z } from 'zod';
import { extractionInputSchema, extractMovementWindow, type ExtractionInput } from './movement-features.js';
import { calibrateRest } from './rest-calibration.js';
import type { MovementWindow } from '../contracts/recognition.js';

export const UPPER_BODY_POLICY_VERSION = 'upper-body-engineering-v1' as const;
export const UPPER_BODY_WINDOW_MS = 2000;
const requiredFeatures = Object.freeze([
  'elbowAngleDeg', 'upperArmToTrunkAngleDeg', 'wristForwardReferenceLengths',
  'wristElevationReferenceLengths', 'torsoInclinationChangeDeg',
] as const);
/** Fixed experimental engineering settings, independent of selected/expected exercise.
 * Lifecycle reset on side/view/frame/setup changes and physical calibration suitability
 * remain caller requirements; this pure function cannot observe those changes.
 */
export const UPPER_BODY_SETTINGS = Object.freeze({
  version: UPPER_BODY_POLICY_VERSION, minConfidence: 0.5, minSegmentPx: 2,
  sampleSupportMs: 150, minCoverage: 0.8, maxGapMs: 300, requiredFeatures,
});
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
export const upperBodyInputSchema = extractionInputSchema.pick({
  startMs: true, endMs: true, frameWidth: true, frameHeight: true, side: true, samples: true,
}).extend({
  forwardSign: z.union([z.literal(1), z.literal(-1)]),
  reference: z.tuple([point, point]),
  restSamples: extractionInputSchema.shape.samples,
}).strict().refine((input) => input.endMs - input.startMs === UPPER_BODY_WINDOW_MS, {
  message: 'upper-body-engineering-v1 requires exactly 2000 ms; no partial warm-up windows.',
});
export type UpperBodyInput = z.infer<typeof upperBodyInputSchema>;
export function extractUpperBodyWindow(raw: unknown): MovementWindow {
  const input = upperBodyInputSchema.parse(raw);
  const calibration = calibrateRest(input.restSamples, input.frameWidth, input.frameHeight, input.reference, input.forwardSign);
  // Clone the frozen feature list only for the existing extractor's mutable input type.
  const settings: ExtractionInput['settings'] = { ...UPPER_BODY_SETTINGS, requiredFeatures: [...requiredFeatures] };
  return extractMovementWindow({
    startMs: input.startMs, endMs: input.endMs, frameWidth: input.frameWidth,
    frameHeight: input.frameHeight, side: input.side, samples: input.samples, calibration, settings,
  });
}
