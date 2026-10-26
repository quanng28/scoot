import { z } from 'zod';

/** DRAFT: Quan P extractor supplied; joint quality/calibration policy and physical-device validation pending. */
export const FEATURE_SCHEMA_VERSION = 'movement-features.draft-v1' as const;
export const MAX_WINDOW_BYTES = 65_536;
export const MAX_WINDOW_MS = 10_000;
const finite = z.number().finite();
// Encoding bounds are engineering abuse limits, not clinical cutoffs.
const time = finite.nonnegative().max(86_400_000);
const displacement = finite.min(-1000).max(1000).nullable();
const angle = finite.min(0).max(180).nullable();
/** Projected degrees and fixed-reference lengths; null means unavailable, never zero. */
export const movementFeaturesSchema = z.strictObject({
  elbowAngleDeg: angle,
  upperArmToTrunkAngleDeg: angle,
  kneeAngleDeg: angle,
  ankleSignedChangeDeg: finite.min(-180).max(180).nullable(),
  wristForwardReferenceLengths: displacement,
  wristElevationReferenceLengths: displacement,
  kneeElevationReferenceLengths: displacement,
  torsoInclinationChangeDeg: finite.min(-180).max(180).nullable(),
});
export const featureSampleSchema = z.strictObject({
  timestampMs: time,
  features: movementFeaturesSchema,
});
export const movementWindowSchema = z.strictObject({
  schemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
  startMs: time,
  endMs: time,
  samples: z.array(featureSampleSchema).min(2).max(128),
  quality: z.strictObject({
    status: z.enum(['measurable', 'unable_to_measure']),
    coverage: finite.min(0).max(1),
    maxGapMs: time,
  }),
}).superRefine((window, context) => {
  const duration = window.endMs - window.startMs;
  if (duration <= 0 || duration > MAX_WINDOW_MS) {
    context.addIssue({ code: 'custom', path: ['endMs'], message: 'Window must span more than 0 and at most 10000 ms.' });
  }
  if (window.quality.maxGapMs > duration) {
    context.addIssue({ code: 'custom', path: ['quality', 'maxGapMs'], message: 'Gap exceeds window duration.' });
  }
  let previous = -1;
  for (const [index, sample] of window.samples.entries()) {
    if (sample.timestampMs < window.startMs || sample.timestampMs > window.endMs || sample.timestampMs <= previous) {
      context.addIssue({ code: 'custom', path: ['samples', index, 'timestampMs'], message: 'Samples must be strictly ordered within the window.' });
    }
    previous = sample.timestampMs;
  }
  // Count UTF-8 bytes without a Node dependency so this contract is shareable.
  if (new TextEncoder().encode(JSON.stringify(window)).byteLength > MAX_WINDOW_BYTES) {
    context.addIssue({ code: 'custom', message: 'Feature window exceeds 64 KiB.' });
  }
});
export type MovementWindow = z.infer<typeof movementWindowSchema>;
