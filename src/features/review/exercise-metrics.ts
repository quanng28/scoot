import { circularMedianDegrees } from '../../analysis/circular-statistics.js';
import { reasonText } from '../../analysis/reach-contract.js';
import type { ReviewRecord } from '../../contracts/review-session.js';
import { EXERCISE_METRIC_MAP, type MetricDefinition } from '../../contracts/exercise-metrics.js';
import { exerciseName, type ExerciseId } from '../setup/setup-model.js';
export { EXERCISE_METRIC_MAP, type MetricDefinition } from '../../contracts/exercise-metrics.js';

export const metricSuffix = (unit: MetricDefinition['unit']): string => unit === 'degrees' ? '°' : unit === 'seconds' ? ' s' : ' reference lengths';
export const formatExerciseMetric = (definition: MetricDefinition, value: number): string => `${value.toFixed(definition.digits)}${metricSuffix(definition.unit)}`;
const EXTRA_REASONS: Readonly<Record<string, string>> = {
  ENDPOINT_NOT_REACHED: 'Sustained entry into the configured endpoint region was not observed.',
  AMBIGUOUS_DIRECTION: 'The prescribed ankle direction could not be established reliably.',
};
export const exerciseReason = (reason: string): string => Object.entries(reasonText).find(([code]) => code === reason)?.[1] ?? EXTRA_REASONS[reason] ?? reason.replaceAll('_', ' ').toLowerCase();
type MetricValue = { value: number | null; unit: string; reasons: readonly string[] };
type DisplayCriterion = { metric: string; operator: '<' | '>'; threshold: number };
type DisplayFlag = DisplayCriterion & { observed: number };
type DisplaySource = {
  exercise: { id: ExerciseId };
  attempts: readonly {
    id: string; startMs: number; endMs: number; classification: 'measurable' | 'excluded'; reasons: readonly string[]; explanations: readonly string[];
    metrics: Readonly<Record<string, MetricValue>>; quality: { coverage: number; longestGapMs: number; observationCount: number };
    flags: readonly DisplayFlag[];
  }[];
  configuration: { criteria: readonly DisplayCriterion[] };
};
export type ExerciseResults = ReturnType<typeof buildResults>;
function buildResults(record: DisplaySource, definitions: Readonly<Record<string, MetricDefinition>>, limb: 'arm' | 'leg', endpointLabel: string) {
  const descriptors = Object.entries(definitions).map(([id, definition]) => ({ id, ...definition }));
  const criterion = (value: DisplayCriterion) => {
    const definition = definitions[value.metric];
    if (!definition) throw new Error(`Unsupported ${record.exercise.id} metric: ${value.metric}`);
    return `${definition.short} ${value.operator} ${value.threshold}${metricSuffix(definition.unit)}`;
  };
  const flag = (value: DisplayFlag) => {
    const definition = definitions[value.metric];
    if (!definition) throw new Error(`Unsupported ${record.exercise.id} flag: ${value.metric}`);
    let digits = definition.digits;
    while (digits < 15 && value.observed.toFixed(digits) === value.threshold.toFixed(digits)) digits++;
    const observed = value.observed.toFixed(digits) === value.threshold.toFixed(digits) ? String(value.observed) : value.observed.toFixed(digits);
    return `${definition.short} ${observed}${metricSuffix(definition.unit)} exceeded the configured ${value.operator} ${value.threshold}${metricSuffix(definition.unit)} review criterion. Review replay.`;
  };
  const attempts = record.attempts.map((attempt) => ({
    ...attempt,
    endpointMs: 'targetMs' in attempt && typeof attempt.targetMs === 'number' ? attempt.targetMs : 'endpointMs' in attempt && typeof attempt.endpointMs === 'number' ? attempt.endpointMs : null,
    metrics: descriptors.map((definition) => {
      const fact = attempt.metrics[definition.id];
      if (!fact) throw new Error(`Missing ${record.exercise.id} metric: ${definition.id}`);
      return { ...fact, ...definition };
    }),
    flagTexts: attempt.flags.map(flag),
  }));
  const measurable = attempts.filter((attempt) => attempt.classification === 'measurable');
  const medians = descriptors.map((definition) => {
    const values = measurable.flatMap((attempt) => attempt.metrics.flatMap((metric) => metric.id === definition.id && metric.value !== null ? [metric.value] : [])).sort((a, b) => a - b);
    const low = values[Math.floor((values.length - 1) / 2)], high = values[Math.floor(values.length / 2)];
    return { ...definition, value: definition.id === 'orientedAngleDeg' ? circularMedianDegrees(values) : low === undefined || high === undefined ? null : (low + high) / 2 };
  });
  return {
    exerciseId: record.exercise.id, name: exerciseName(record.exercise.id), limb, endpointLabel, attempts, medians,
    criteria: record.configuration.criteria.map(criterion),
    summary: { detected: attempts.length, measurable: measurable.length, excluded: attempts.length - measurable.length, flagged: measurable.filter((attempt) => attempt.flags.length > 0).length },
  };
}

/** Narrow by the top-level schema discriminator; there is no fallback to reach. */
export function getExerciseResults(record: ReviewRecord): ExerciseResults {
  switch (record.schemaVersion) {
    case 'reach-session.consumer-v1': return buildResults(record, EXERCISE_METRIC_MAP.seated_forward_reach, 'arm', 'first target entry');
    case 'elbow-session.consumer-v1': return buildResults(record, EXERCISE_METRIC_MAP.seated_elbow_flexion_extension, 'arm', 'bend endpoint');
    case 'arm-raise-session.consumer-v2': return buildResults(record, EXERCISE_METRIC_MAP.seated_forward_arm_raise, 'arm', 'raise endpoint');
    case 'knee-extension-session.consumer-v2': return buildResults(record, EXERCISE_METRIC_MAP.seated_knee_extension, 'leg', 'extension endpoint');
    case 'leg-lift-session.consumer-v2': return buildResults(record, EXERCISE_METRIC_MAP.seated_single_leg_lift, 'leg', 'lift endpoint');
    case 'ankle-pumps-session.consumer-v2': return buildResults(record, EXERCISE_METRIC_MAP.seated_ankle_pumps, 'leg', 'pump endpoint');
  }
  const unsupported: never = record;
  throw new Error(`Unsupported session: ${String(unsupported)}`);
}
