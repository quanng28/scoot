import { z } from 'zod';

const finite = z.number().finite();
const positive = finite.positive();
const point = z.strictObject({ x: finite, y: finite });
export const REACH_JOINTS = ['shoulder', 'elbow', 'wrist', 'hip'] as const;
export type Joint = typeof REACH_JOINTS[number];
/** Shared pose transport keys. Each analyzer still requires only its own landmark subset. */
export type PoseJoint = Joint | 'knee' | 'ankle' | 'heel' | 'footIndex';
export const metricUnits = { elbowPeakDeg: 'degrees', torsoForwardPeakDeg: 'degrees', wristForwardPeak: 'reference lengths', reachDurationSec: 'seconds' } as const;
export type Metric = keyof typeof metricUnits;
export const reachConfigSchema = z.strictObject({
  sessionId: z.string().min(1), configurationId: z.string().min(1), version: z.string().min(1),
  mode: z.enum(['rehabilitation', 'wellness']), side: z.enum(['left', 'right']),
  frameWidth: positive.max(16384), frameHeight: positive.max(16384), orientation: z.string().min(1),
  baseline: z.strictObject({ shoulder: point, elbow: point, wrist: point, hip: point }),
  reference: z.tuple([point, point]), target: point,
  settings: z.strictObject({
    minConfidence: z.strictObject({ shoulder: finite.min(0).max(1), elbow: finite.min(0).max(1), wrist: finite.min(0).max(1), hip: finite.min(0).max(1) }),
    minSegmentPx: positive, minReferencePx: positive, minForwardPx: positive,
    restRadius: positive, targetRadius: positive, onsetDistance: positive, returnHysteresis: positive,
    readinessMs: positive, onsetDwellMs: positive, targetDwellMs: positive, returnDwellMs: positive,
    timeoutMs: positive, smoothingTauMs: finite.nonnegative(), filterResetGapMs: positive,
    sampleSupportMs: positive, maxGapMs: positive, minCoverage: positive.max(1), minObservations: z.number().int().min(2),
  }),
  criteria: z.array(z.strictObject({ metric: z.enum(['elbowPeakDeg', 'torsoForwardPeakDeg', 'wristForwardPeak', 'reachDurationSec']), operator: z.enum(['<', '>']), threshold: finite })),
});
export type ReachConfig = z.infer<typeof reachConfigSchema>;
export type PixelPose = Record<Joint, z.infer<typeof point>>;
export type ReachFrame = {
  /** Recording-relative capture time, not inference completion time. */
  timestampMs: number; width: number; height: number; orientation: string; side: 'left' | 'right';
  landmarks: Partial<Record<PoseJoint, { x: number; y: number; confidence: number | null }>>;
};
export type Reason = 'LOW_LANDMARK_QUALITY' | 'OUT_OF_FRAME' | 'DEGENERATE_GEOMETRY' | 'TRACKING_GAP' | 'CRITICAL_PEAK_GAP' |
  'INSUFFICIENT_COVERAGE' | 'INSUFFICIENT_OBSERVATIONS' | 'TARGET_NOT_REACHED' | 'RETURN_NOT_OBSERVED' | 'TIMEOUT' |
  'STOPPED_EARLY' | 'DISCOMFORT_STOP' | 'SETUP_CHANGED' | 'BUFFER_LIMIT';
export type Interruption = 'STOPPED_EARLY' | 'DISCOMFORT_STOP' | 'SETUP_CHANGED';
export const reasonText: Record<Reason, string> = {
  LOW_LANDMARK_QUALITY: 'A required landmark was missing or unreliable.',
  OUT_OF_FRAME: 'A required landmark was outside the camera image.',
  DEGENERATE_GEOMETRY: 'Projected segments were too short to measure reliably.',
  TRACKING_GAP: 'Tracking was absent longer than the configured limit.',
  CRITICAL_PEAK_GAP: 'Missing outward-phase observations could conceal the target or a measurement peak.',
  INSUFFICIENT_COVERAGE: 'Too little of the attempt had valid observations.',
  INSUFFICIENT_OBSERVATIONS: 'The attempt had too few valid observations.',
  TARGET_NOT_REACHED: 'Sustained entry into the image target region was not observed.',
  RETURN_NOT_OBSERVED: 'A sustained return to rest was not observed.',
  TIMEOUT: 'The attempt exceeded the configured duration limit.',
  STOPPED_EARLY: 'Capture stopped before the attempt was finalized.',
  DISCOMFORT_STOP: 'Capture stopped after reported discomfort.',
  SETUP_CHANGED: 'Camera geometry, anatomical side, or task setup changed.',
  BUFFER_LIMIT: 'The attempt exceeded the diagnostic observation limit.',
};
export type ReachState = 'REST' | 'OUTWARD' | 'TARGET' | 'RETURN' | 'REACQUIRE_REST';
export type Observation = { timestampMs: number; raw: PixelPose; filtered: PixelPose; elbowDeg: number; torsoDeltaDeg: number; forward: number; displacement: number; restDistance: number; targetDistance: number };
export type ReachAttempt = {
  id: string; sessionId: string; configurationId: string; analysisVersion: string;
  exerciseId: 'seated_forward_reach'; mode: ReachConfig['mode']; side: ReachConfig['side'];
  startMs: number; targetMs: number | null; endMs: number; classification: 'measurable' | 'excluded';
  reasons: Reason[]; explanations: string[]; metrics: Record<Metric, { value: number | null; unit: string; reasons: Reason[] }>;
  quality: { coverage: number; longestGapMs: number; observationCount: number };
  flags: { metric: Metric; operator: '<' | '>'; threshold: number; observed: number; replay: { startMs: number; endMs: number }; explanation: string }[];
  evidence: { status: 'unavailable'; reason: string }; observations: Observation[];
};
