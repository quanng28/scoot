import type { Metric } from '../analysis/reach-contract.js';
import type { ElbowAttempt } from '../analysis/seated-elbow.js';
import type { ArmRaiseMetric } from '../analysis/seated-arm-raise.js';
import type { KneeExtensionMetric } from '../analysis/seated-knee-extension.js';
import type { LegLiftMetric } from '../analysis/seated-single-leg-lift.js';
import type { AnklePumpsMetric } from '../analysis/seated-ankle-pumps.js';
import { CATALOG_METRIC_MAP } from './reach-session.js';
import type { ReviewRecord } from './review-session.js';
type ExerciseId = ReviewRecord['exercise']['id'];

export type MetricDefinition = { label: string; short: string; unit: 'degrees' | 'seconds' | 'reference_lengths'; digits: number };
type MetricByExercise = {
  seated_forward_reach: Metric;
  seated_elbow_flexion_extension: keyof ElbowAttempt['metrics'];
  seated_forward_arm_raise: ArmRaiseMetric;
  seated_knee_extension: KneeExtensionMetric;
  seated_single_leg_lift: LegLiftMetric;
  seated_ankle_pumps: AnklePumpsMetric;
};
const degrees = (label: string, short = label): MetricDefinition => ({ label, short, unit: 'degrees', digits: 1 });
const seconds = (label: string): MetricDefinition => ({ label, short: label, unit: 'seconds', digits: 2 });
const lengths = (label: string): MetricDefinition => ({ label, short: label, unit: 'reference_lengths', digits: 2 });

/** Exhaustive exercise/metric table: adding or renaming an analyzer metric requires an explicit display definition. */
export const EXERCISE_METRIC_MAP = {
  seated_forward_reach: {
    elbowPeakDeg: degrees(CATALOG_METRIC_MAP.elbowPeakDeg.label, CATALOG_METRIC_MAP.elbowPeakDeg.short),
    torsoForwardPeakDeg: degrees(CATALOG_METRIC_MAP.torsoForwardPeakDeg.label, CATALOG_METRIC_MAP.torsoForwardPeakDeg.short),
    wristForwardPeak: lengths(CATALOG_METRIC_MAP.wristForwardPeak.label),
    reachDurationSec: seconds(CATALOG_METRIC_MAP.reachDurationSec.label),
  },
  seated_elbow_flexion_extension: {
    minElbowDeg: degrees('Minimum projected elbow angle'), bendExcursionDeg: degrees('Projected bend excursion'),
    torsoForwardPeakDeg: degrees('Peak forward torso inclination change (2D proxy)', 'Torso change'),
    bendDurationSec: seconds('Bend duration'), returnDurationSec: seconds('Return duration'),
  },
  seated_forward_arm_raise: {
    peakUpperArmAngleDeg: degrees('Peak upper-arm-to-trunk angle'), peakWristElevation: lengths('Peak wrist elevation'),
    torsoForwardPeakDeg: degrees('Peak forward torso inclination change (2D proxy)', 'Torso change'),
    raiseDurationSec: seconds('Raise duration'), returnDurationSec: seconds('Return duration'),
  },
  seated_knee_extension: {
    peakKneeAngleDeg: degrees('Peak projected knee angle'), projectedExtensionExcursionDeg: degrees('Baseline-relative projected extension excursion'),
    extensionDurationSec: seconds('Extension duration'), returnDurationSec: seconds('Return duration'),
  },
  seated_single_leg_lift: {
    peakKneeElevation: lengths('Peak knee elevation'), torsoForwardPeakDeg: degrees('Peak forward torso inclination change (2D proxy)', 'Torso change'),
    liftDurationSec: seconds('Lift duration'), returnDurationSec: seconds('Return duration'),
  },
  seated_ankle_pumps: {
    orientedAngleDeg: degrees('Oriented shank-to-foot angle (2D proxy)'), signedChangeDeg: degrees('Signed baseline-relative shank-to-foot change'),
    peakExcursionDeg: degrees('Peak prescribed-direction excursion'), outwardDurationSec: seconds('Outward duration'), returnDurationSec: seconds('Return duration'),
  },
} satisfies { [E in ExerciseId]: Record<MetricByExercise[E], MetricDefinition> };
