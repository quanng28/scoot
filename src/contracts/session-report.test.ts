import { describe, expect, it } from 'vitest';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { fourWorkflowRecords } from './seated-workflow.test-fixtures.js';
import { buildSessionReportInput, buildSessionMetricSeries, sessionReportInputSchema } from './session-report.js';

describe('finalized factual report allowlist', () => {
  it('retains legacy reach counts, source versions, strict flags and excluded null reasons', () => {
    const source = syntheticReachSession('report-reach');
    source.notes = 'PRIVATE-NOTE'; source.participantLabel = 'PRIVATE-LABEL';
    const facts = buildSessionReportInput(source);
    expect(facts.counts).toEqual({ detected: 4, measurable: 3, excluded: 1, flagged: 1 });
    expect(facts.sourceSchemaVersion).toBe('reach-session.consumer-v1');
    expect(facts.provenance).toBe('labeled_synthetic_fixture');
    expect(facts.attempts[2]?.metrics.every((m) => m.value === null && m.reasons.length > 0)).toBe(true);
    expect(facts.attempts[1]?.flags[0]).toMatchObject({ metric: 'torsoForwardPeakDeg', operator: '>', threshold: 10 });
    expect(JSON.stringify(facts)).not.toMatch(/PRIVATE|"(?:landmarks|publicUrl|video|supervisorLabel|participantLabel|baseline)"\s*:/);
  });

  it('maps four real adapter fixtures to their own definitions, values and units', () => {
    const sources = fourWorkflowRecords('report');
    const expected = [
      { id: 'peakUpperArmAngleDeg', value: 90, unit: 'degrees' },
      { id: 'peakKneeAngleDeg', value: 180, unit: 'degrees' },
      { id: 'peakKneeElevation', value: 0.5, unit: 'reference_lengths' },
      { id: 'peakExcursionDeg', value: 30, unit: 'degrees' },
    ];
    sources.forEach((source, index) => {
      const facts = buildSessionReportInput(source), metric = expected[index]!;
      expect(facts.exercise.id).toBe(source.exercise.id);
      expect(facts.counts).toEqual({ detected: 1, measurable: 1, excluded: 0, flagged: 0 });
      expect(facts.attempts[0]?.metrics.find((m) => m.id === metric.id)).toEqual({ ...metric, reasons: [] });
      expect(facts.attempts[0]).toMatchObject({ startMs: 161, endpointMs: 337, returnStartMs: 620, endMs: 889 });
      expect(facts.metricDefinitions.map((m) => m.id)).toEqual(Object.keys(source.attempts[0]!.metrics));
      source.notes = 'mutation after finalized DTO';
      expect(JSON.stringify(facts)).not.toContain(source.notes);
    });
  });

  it('keeps zero-measurable sessions empty and does not invent context or medians', () => {
    for (const source of fourWorkflowRecords('empty')) {
      const facts = buildSessionReportInput({ ...source, attempts: [] });
      expect(facts.counts).toEqual({ detected: 0, measurable: 0, excluded: 0, flagged: 0 });
      expect(facts.attempts).toEqual([]);
      expect('context' in facts).toBe(false); expect('medians' in facts).toBe(false);
    }
  });

  it('rejects extra fields at every boundary and nonfinite values', () => {
    const facts = buildSessionReportInput(fourWorkflowRecords('strict')[0]);
    expect(sessionReportInputSchema.safeParse({ ...facts, video: 'bytes' }).success).toBe(false);
    expect(sessionReportInputSchema.safeParse({ ...facts, exercise: { ...facts.exercise, notes: 'private' } }).success).toBe(false);
    expect(sessionReportInputSchema.safeParse({ ...facts, configuredCriteria: [{ metric: 'peakUpperArmAngleDeg', operator: '>', threshold: Infinity }] }).success).toBe(false);
    const bad = structuredClone(facts); bad.attempts[0]!.metrics[0]!.value = NaN;
    expect(sessionReportInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects forged counts, definitions, units, exclusions, flags and replay ranges', () => {
    const facts = buildSessionReportInput(fourWorkflowRecords('forged')[0]);
    const invalid = (mutate: (draft: typeof facts) => void) => {
      const draft = structuredClone(facts); mutate(draft);
      expect(sessionReportInputSchema.safeParse(draft).success).toBe(false);
    };
    invalid((f) => { f.counts.measurable = 2; });
    invalid((f) => { f.metricDefinitions[0]!.definition = 'Clinical range of motion'; });
    invalid((f) => { f.attempts[0]!.metrics[0]!.unit = 'seconds'; });
    invalid((f) => { f.attempts[0]!.metrics[0]!.value = null; });
    invalid((f) => { f.attempts[0]!.classification = 'excluded'; f.attempts[0]!.reasons = ['TIMEOUT']; });
    invalid((f) => { f.attempts[0]!.flags.push({ metric: 'peakUpperArmAngleDeg', operator: '>', threshold: 10, observed: 90, finalizedAtMs: 889, replay: { startMs: 161, endMs: 337 } }); });
    invalid((f) => { f.configuredCriteria.push({ metric: 'peakUpperArmAngleDeg', operator: '>', threshold: 10 }); });
    invalid((f) => { f.attempts[0]!.endpointMs = 890; });
    invalid((f) => { f.attempts[0]!.restMs = null; });
    invalid((f) => { f.attempts[0]!.metrics.find((m) => m.id === 'returnDurationSec')!.value = 0.269; });
    invalid((f) => { f.sourceSchemaVersion = 'reach-session.consumer-v1'; });
  });
  it('provides source-linked chart points, null gaps, thresholds and compatible grouping', () => {
    const facts = buildSessionReportInput(syntheticReachSession('chart'));
    const series = buildSessionMetricSeries(facts);
    const torso = series.find((s) => s.definition.id === 'torsoForwardPeakDeg')!;
    expect(torso.thresholds).toEqual([{ metric: 'torsoForwardPeakDeg', operator: '>', threshold: 10 }]);
    expect(torso.points.map((p) => p.value)).toEqual([0, 12, null, 0]);
    expect(torso.points[2]).toMatchObject({ classification: 'excluded', reasons: ['TARGET_NOT_REACHED'] });
    expect(torso.group).toMatchObject({ exerciseId: 'seated_forward_reach', configurationId: 'chart:setup' });
    const empty = buildSessionMetricSeries(buildSessionReportInput({ ...fourWorkflowRecords('chart-empty')[1], attempts: [] }));
    expect(empty.every((s) => s.points.length === 0 && s.definition.unit !== 'reference_lengths')).toBe(true);
  });
});
