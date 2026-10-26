import { describe, expect, it } from 'vitest';
import { SeatedElbowAnalyzer, type ElbowConfig } from '../analysis/seated-elbow.js';
import type { ReachFrame } from '../analysis/reach-contract.js';
import { developerElbowConfig } from '../capture/elbow-session.js';
import { toElbowAttemptRecord, elbowSessionRecordSchema } from '../contracts/elbow-session.js';
import { EXERCISE_METRIC_MAP } from '../contracts/exercise-metrics.js';
import { REPORT_EXERCISES, REPORT_METRIC_DEFINITIONS, reportInputSchema } from '../contracts/provider-report.js';
import { parseReviewRecord, type ReviewRecord } from '../contracts/review-session.js';
import { emptyContext } from '../contracts/session-context.js';
import { fourWorkflowRecords } from '../contracts/seated-workflow.test-fixtures.js';
import { buildSessionReportInput, buildSessionMetricSeries } from '../contracts/session-report.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { buildProviderReportInput, reportFacts, reportInputDigest } from './report-input.js';
import { validateGeneratedReport } from './report-validator.js';
import { templateReport } from './template-report.js';

function elbowRecord() {
  const baseline = { shoulder: { x: 200, y: 100 }, elbow: { x: 200, y: 150 }, wrist: { x: 200, y: 200 }, hip: { x: 200, y: 250 } };
  const config: ElbowConfig = developerElbowConfig(baseline, 90, 1, 400, 300, 'left', 'provider-elbow', null);
  config.settings = { ...config.settings, readinessMs: 100, onsetDwellMs: 100, endpointDwellMs: 100, returnDwellMs: 100, smoothingTauMs: 0,
    minCoverage: 0.8, minObservations: 6, maxGapMs: 200, sampleSupportMs: 75, filterResetGapMs: 100 };
  const analyzer = new SeatedElbowAnalyzer(config);
  const frame = (timestampMs: number, angle: number): ReachFrame => {
    const radians = angle * Math.PI / 180;
    return { timestampMs, width: 400, height: 300, orientation: config.orientation, side: 'left', landmarks: {
      shoulder: { x: 0.5, y: 100 / 300, confidence: 1 }, elbow: { x: 0.5, y: 0.5, confidence: 1 },
      wrist: { x: (200 + 50 * Math.sin(radians)) / 400, y: (150 - 50 * Math.cos(radians)) / 300, confidence: 1 },
      hip: { x: 0.5, y: 250 / 300, confidence: 1 },
    } };
  };
  for (const [times, angle] of [[[0, 50, 100], 180], [[150, 200, 250], 150], [[300, 350, 400, 450, 500], 90], [[550, 600, 650], 140], [[700, 750, 800], 180]] as const)
    for (const timestamp of times) analyzer.accept(frame(timestamp, angle));
  analyzer.advance(801);
  const reach = syntheticReachSession('provider-reach');
  return elbowSessionRecordSchema.parse({ ...reach, schemaVersion: 'elbow-session.consumer-v1', sessionId: config.sessionId,
    provenance: { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' },
    exercise: { ...reach.exercise, id: 'seated_elbow_flexion_extension' }, configuration: config,
    setup: { seatingSupport: reach.setup.seatingSupport, assignedRangeOrGoal: reach.setup.assignedRangeOrGoal,
      cameraFacing: 'environment', delegate: 'CPU', previewMirrored: false, teamTestConfirmed: true, supervisorSetupConfirmed: true, readiness: reach.setup.readiness },
    capture: { stopReason: 'STOPPED', stoppedAtMs: 801, message: null }, attempts: analyzer.drain().map(toElbowAttemptRecord) });
}

function records(): ReviewRecord[] {
  return [syntheticReachSession('six-reach'), elbowRecord(), ...fourWorkflowRecords('six-provider')];
}

describe('all-six provider report adapters', () => {
  it('uses each matching definition, numeric value, unit and accepted first-event timing from validated source records', () => {
    expect(records().map((record) => record.exercise.id)).toEqual([...REPORT_EXERCISES]);
    for (const record of records()) {
      const facts = buildSessionReportInput(record);
      const { input } = buildProviderReportInput(record, emptyContext());
      expect(input.exercise.id).toBe(record.exercise.id);
      expect(input.counts).toEqual(facts.counts);
      expect(input.metricDefinitions.map((d) => d.metric)).toEqual(Object.keys(EXERCISE_METRIC_MAP[record.exercise.id]));
      input.attempts.forEach((attempt, index) => {
        const source = facts.attempts[index]!;
        expect(attempt.metrics.map((metric) => [metric.metric, metric.value, metric.nullReasons]))
          .toEqual(source.metrics.map((metric) => [metric.id, metric.value, metric.reasons]));
        expect(attempt.keyTimes).toContainEqual({ event: record.exercise.id === 'seated_forward_reach' ? 'target_entry' : 'endpoint', sec: source.endpointMs === null ? null : source.endpointMs / 1000 });
        expect(attempt.keyTimes).toContainEqual({ event: 'rest_entry', sec: source.restMs === null ? null : source.restMs / 1000 });
      });
      const local = templateReport(input, emptyContext());
      expect(validateGeneratedReport(input, local.report)).toEqual({ ok: true, report: local.report });
      // Every defined metric can be chosen only when this exercise has measured source values.
      for (const definition of input.metricDefinitions) {
        const report = { ...local.report, chart: { type: 'per_attempt_metric' as const, metric: definition.metric, showThreshold: false } };
        expect(validateGeneratedReport(input, report).ok).toBe(true);
        const fact = reportFacts(input).find((f) => f.kind === 'metric' && f.metric === definition.metric && !f.nullValue)!;
        expect(validateGeneratedReport(input, { ...report, observations: [{ factId: fact.id, text: fact.text }] }).ok, `${record.exercise.id}: ${fact.text}`).toBe(true);
      }
    }
  });

  it('rejects cross-exercise definitions, duplicate/absent metrics, incorrect event order and fabricated missing flags', () => {
    for (const record of records()) {
      const { input } = buildProviderReportInput(record, emptyContext());
      const wrong = structuredClone(input);
      wrong.metricDefinitions[0]!.label = 'Elbow fallback';
      expect(reportInputSchema.safeParse(wrong).success).toBe(false);
      const duplicate = structuredClone(input);
      duplicate.attempts[0]!.metrics[1] = { ...duplicate.attempts[0]!.metrics[0]! };
      expect(reportInputSchema.safeParse(duplicate).success).toBe(false);
      const late = structuredClone(input);
      late.attempts[0]!.keyTimes[0]!.sec = late.attempts[0]!.endSec + 1;
      expect(reportInputSchema.safeParse(late).success).toBe(false);
      const source = structuredClone(record);
      Object.assign(source.attempts[0]!, { metrics: {} });
      expect(() => buildProviderReportInput(source, emptyContext())).toThrow();
    }
  });

  it('keeps all six zero-measurable sessions unavailable and does not invent charts, percentages or medians', () => {
    for (const record of records()) {
      const empty = parseReviewRecord({ ...record, attempts: [] });
      const { input } = buildProviderReportInput(empty, emptyContext());
      const local = templateReport(input, emptyContext());
      expect(input.counts).toEqual({ detected: 0, measurable: 0, excluded: 0, flagged: 0 });
      expect(local.report.chart).toEqual({ type: 'none', metric: 'none', showThreshold: false });
      expect(local.report.summary).not.toMatch(/median|%|success|correct/);
      expect(validateGeneratedReport(input, local.report).ok).toBe(true);
    }
  });

  it('preserves lower-body exclusion nulls and reasons without permitting elbow/reach charts', () => {
    for (const record of fourWorkflowRecords('excluded-provider')) {
      const excluded = parseReviewRecord({ ...record, attempts: record.attempts.map((attempt) => ({ ...attempt, classification: 'excluded',
        reasons: ['STOPPED_EARLY'], explanations: ['Capture stopped before the attempt was finalized.'], flags: [], metrics: Object.fromEntries(Object.entries(attempt.metrics).map(([key, metric]) =>
          [key, { ...metric, value: null, reasons: ['STOPPED_EARLY'] }])) })) });
      const { input } = buildProviderReportInput(excluded, emptyContext());
      expect(input.counts).toEqual({ detected: 1, measurable: 0, excluded: 1, flagged: 0 });
      expect(input.attempts[0]!.metrics.every((metric) => metric.value === null && metric.nullReasons.includes('STOPPED_EARLY'))).toBe(true);
      const local = templateReport(input, emptyContext());
      expect(validateGeneratedReport(input, local.report).ok).toBe(true);
      expect(validateGeneratedReport(input, { ...local.report, chart: { type: 'per_attempt_metric', metric: 'elbowPeakDeg', showThreshold: false } }).ok).toBe(false);
    }
  });

  it('keeps circular ankle source series, definitions and response binding separate from generated prose', async () => {
    const ankle = fourWorkflowRecords('circular-provider')[3];
    const facts = buildSessionReportInput(ankle);
    const series = buildSessionMetricSeries(facts);
    expect(series.find((s) => s.definition.id === 'orientedAngleDeg')?.definition.window).toBe('at_peak_excursion');
    expect(series.find((s) => s.definition.id === 'orientedAngleDeg')?.points[0]?.value).toBeCloseTo(120);
    const { input } = buildProviderReportInput(ankle, emptyContext());
    const digest = await reportInputDigest(input);
    const changed = structuredClone(input);
    changed.attempts[0]!.metrics[0]!.value = -179;
    expect(await reportInputDigest(changed)).not.toBe(digest);
    expect(REPORT_METRIC_DEFINITIONS.seated_ankle_pumps.minElbowDeg).toBeUndefined();
    expect(JSON.stringify(input)).not.toMatch(/circular-provider|"(?:video|landmarks|baseline|notes|participantLabel|configurationId)"\s*:/);
  });
});
