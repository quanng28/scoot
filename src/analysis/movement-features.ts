import { z } from 'zod';
import { FEATURE_SCHEMA_VERSION, movementFeaturesSchema, movementWindowSchema, type MovementWindow } from '../contracts/recognition.js';

// This local-only input deliberately cannot be forwarded as the provider payload.
const finite = z.number().finite();
const point = z.strictObject({ x: finite, y: finite });
const landmark = point.extend({ confidence: finite.min(0).max(1).nullable() });
const landmarks = z.strictObject({
  shoulder: landmark.optional(), elbow: landmark.optional(), wrist: landmark.optional(),
  hip: landmark.optional(), knee: landmark.optional(), ankle: landmark.optional(),
  heel: landmark.optional(), footIndex: landmark.optional(),
});
export const extractionInputSchema = z.strictObject({
  startMs: finite.nonnegative(), endMs: finite.nonnegative(),
  frameWidth: finite.positive(), frameHeight: finite.positive(),
  // One explicitly selected anatomical side, already unmirrored; no side substitution.
  side: z.enum(['left', 'right']),
  calibration: z.strictObject({
    referenceLengthPx: finite.positive(), forwardSign: z.union([z.literal(1), z.literal(-1)]),
    wristRest: point.nullable(), kneeRest: point.nullable(),
    forwardUnit: point.nullable(), torsoRestDeg: finite.min(-180).max(180).nullable(),
    ankleRestDeg: finite.min(-180).max(180).nullable(),
  }),
  settings: z.strictObject({
    version: z.string().min(1), minConfidence: finite.min(0).max(1),
    minSegmentPx: finite.positive(), sampleSupportMs: finite.positive(),
    minCoverage: finite.positive().max(1), maxGapMs: finite.nonnegative(),
    requiredFeatures: z.array(z.enum([
      'elbowAngleDeg', 'upperArmToTrunkAngleDeg', 'kneeAngleDeg', 'ankleSignedChangeDeg',
      'wristForwardReferenceLengths', 'wristElevationReferenceLengths',
      'kneeElevationReferenceLengths', 'torsoInclinationChangeDeg',
    ])).min(1),
  }),
  samples: z.array(z.strictObject({ timestampMs: finite.nonnegative(), landmarks })).min(2).max(128),
});
export type ExtractionInput = z.infer<typeof extractionInputSchema>;
type Point = z.infer<typeof point>;
type Features = z.infer<typeof movementFeaturesSchema>;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const length = (p: Point): number => Math.hypot(p.x, p.y);
const wrap = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180;

/** Causal elapsed-time support shared by extraction and the local rules gate. */
export function windowSupport(samples: {timestampMs:number;valid:boolean}[], startMs: number, endMs: number, supportMs: number) {
  let covered=0,cursor=startMs,maxGapMs=0;
  for(const [i,sample] of samples.entries()) {
    if(!sample.valid) continue;
    const until=Math.min(endMs,sample.timestampMs+supportMs,samples[i+1]?.timestampMs??endMs);
    maxGapMs=Math.max(maxGapMs,sample.timestampMs-cursor);
    covered+=until-sample.timestampMs;cursor=until;
  }
  return {coverage:covered/(endMs-startMs),maxGapMs:Math.max(maxGapMs,endMs-cursor)};
}

/** Pure projected geometry. Input landmarks are normalized; calibration is in intrinsic pixels.
 * No interpolation, smoothing, clinical thresholds, exercise labels or network access.
 */
export function extractMovementWindow(raw: unknown): MovementWindow {
  const input = extractionInputSchema.parse(raw);
  const { calibration: c, settings: s } = input;
  const duration = input.endMs - input.startMs;
  if (duration <= 0 || duration > 10_000) throw new Error('Invalid window duration');
  if (c.forwardUnit && Math.abs(length(c.forwardUnit) - 1) > 1e-6) throw new Error('Forward direction must be a unit vector');
  if (c.referenceLengthPx < s.minSegmentPx) throw new Error('Degenerate reference');
  let previous = -1;
  const validTimes: number[] = [];
  const samples = input.samples.map((sample) => {
    if (sample.timestampMs <= previous || sample.timestampMs < input.startMs || sample.timestampMs > input.endMs) {
      throw new Error('Samples must be strictly ordered within the window');
    }
    previous = sample.timestampMs;
    const get = (key: keyof typeof sample.landmarks): Point | null => {
      const p = sample.landmarks[key];
      if (!p || p.confidence === null || p.confidence < s.minConfidence || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
      return { x: p.x * input.frameWidth, y: p.y * input.frameHeight };
    };
    const angle = (a: Point | null, b: Point | null, d: Point | null): number | null => {
      if (!a || !b || !d) return null;
      const u = subtract(a, b), v = subtract(d, b);
      if (length(u) < s.minSegmentPx || length(v) < s.minSegmentPx) return null;
      return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (length(u) * length(v))))) * 180 / Math.PI;
    };
    const shoulder = get('shoulder'), elbow = get('elbow'), wrist = get('wrist'), hip = get('hip');
    const knee = get('knee'), ankle = get('ankle'), heel = get('heel'), foot = get('footIndex');
    const torso = shoulder && hip ? subtract(shoulder, hip) : null;
    const shank = knee && ankle ? subtract(knee, ankle) : null;
    const footVector = foot && ankle ? subtract(foot, ankle) : null;
    const displacement = wrist && c.wristRest ? subtract(wrist, c.wristRest) : null;
    const features: Features = {
      elbowAngleDeg: angle(shoulder, elbow, wrist),
      upperArmToTrunkAngleDeg: angle(elbow, shoulder, hip),
      kneeAngleDeg: angle(hip, knee, ankle),
      ankleSignedChangeDeg: heel && foot && length(subtract(foot, heel)) >= s.minSegmentPx && shank && footVector && length(shank) >= s.minSegmentPx && length(footVector) >= s.minSegmentPx && c.ankleRestDeg !== null
        ? wrap(c.forwardSign * (Math.atan2(shank.x * footVector.y - shank.y * footVector.x, shank.x * footVector.x + shank.y * footVector.y) * 180 / Math.PI - c.ankleRestDeg)) : null,
      wristForwardReferenceLengths: displacement && c.forwardUnit ? (displacement.x * c.forwardUnit.x + displacement.y * c.forwardUnit.y) / c.referenceLengthPx : null,
      wristElevationReferenceLengths: wrist && c.wristRest ? (c.wristRest.y - wrist.y) / c.referenceLengthPx : null,
      kneeElevationReferenceLengths: knee && c.kneeRest ? (c.kneeRest.y - knee.y) / c.referenceLengthPx : null,
      torsoInclinationChangeDeg: torso && length(torso) >= s.minSegmentPx && c.torsoRestDeg !== null
        ? wrap(c.forwardSign * wrap(Math.atan2(torso.x, -torso.y) * 180 / Math.PI - c.torsoRestDeg)) : null,
    };
    if (s.requiredFeatures.every((key) => features[key] !== null)) validTimes.push(sample.timestampMs);
    return { timestampMs: sample.timestampMs, features };
  });
  // Causal capped support: each valid sample supports at most sampleSupportMs,
  // and never past the next observed sample (including an invalid one).
  const valid = new Set(validTimes);
  const {coverage,maxGapMs:longestGap}=windowSupport(samples.map(sample=>({timestampMs:sample.timestampMs,valid:valid.has(sample.timestampMs)})),input.startMs,input.endMs,s.sampleSupportMs);
  return movementWindowSchema.parse({
    schemaVersion: FEATURE_SCHEMA_VERSION, startMs: input.startMs, endMs: input.endMs, samples,
    quality: { status: validTimes.length >= 2 && coverage >= s.minCoverage && longestGap <= s.maxGapMs ? 'measurable' : 'unable_to_measure', coverage, maxGapMs: longestGap },
  });
}
