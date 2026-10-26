import { describe, expect, it } from 'vitest';
import { parseReviewAttempt, parseReviewRecord, summarizeReviewRecord } from './review-session.js';
import { fourWorkflowRecords } from './seated-workflow.test-fixtures.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';

const records = fourWorkflowRecords('consumer');
describe.each(records.map((record) => ({ exercise: record.exercise.id, record })))('$exercise consumer invariants', ({ record }) => {
  const attempt = record.attempts[0]!;
  const firstMetric = Object.keys(attempt.metrics)[0]!;
  const firstValue = Object.values(attempt.metrics)[0]!;
  it('finalizes the correct capture path with first-event timestamps, metric units and no diagnostic points', () => {
    expect(parseReviewRecord(record)).toEqual(record);
    expect(attempt).toMatchObject({ classification: 'measurable', startMs: 161, endpointMs: 337, returnStartMs: 620, restMs: 781, endMs: 889 });
    expect(summarizeReviewRecord(record)).toMatchObject({ detected: 1, measurable: 1, excluded: 0, flagged: 0 });
    expect('observations' in attempt).toBe(false);
    expect(Object.values(attempt.metrics).every((metric) => Number.isFinite(metric.value) && metric.reasons.length === 0)).toBe(true);
  });
  it('rejects nulls without reasons, nonfinite values, wrong units, diagnostic fields and missing returns', () => {
    const badMetric = (metric: unknown) => ({ ...attempt, metrics: { ...attempt.metrics, [firstMetric]: metric } });
    for (const metric of [
      { ...firstValue, value: null }, { ...firstValue, value: Infinity }, { ...firstValue, value: NaN },
      { ...firstValue, unit: 'centimeters' }, { ...firstValue, reasons: ['UNEXPLAINED'] },
    ]) expect(() => parseReviewAttempt(badMetric(metric))).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, observations: [] })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, returnStartMs: null })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, restMs: null })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, restMs: attempt.returnStartMs! - 1 })).toThrow();
    const duration = Object.keys(attempt.metrics).find((key) => key.endsWith('DurationSec'))!;
    expect(() => parseReviewAttempt({ ...attempt, metrics: { ...attempt.metrics, [duration]: { value: 99, unit: 'seconds', reasons: [] } } })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, returnStartMs: attempt.startMs })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, endpointMs: attempt.endMs + 1 })).toThrow();
  });
  it('requires observed strict flags, configured criteria and replay inside the attempt', () => {
    const observed = firstValue.value!;
    const criterion = { metric: firstMetric, operator: '>', threshold: observed - 1 };
    const flag = { ...criterion, observed, replay: { startMs: attempt.startMs, endMs: attempt.endMs }, explanation: 'Synthetic configured comparison; review replay.' };
    const flagged = { ...record, configuration: { ...record.configuration, criteria: [criterion] }, attempts: [{ ...attempt, flags: [flag] }] };
    expect(summarizeReviewRecord(parseReviewRecord(flagged)).flagged).toBe(1);
    expect(() => parseReviewRecord({ ...flagged, attempts: [attempt] })).toThrow();
    expect(() => parseReviewRecord({ ...record, attempts: [{ ...attempt, flags: [flag] }] })).toThrow();
    for (const invalid of [
      { ...flag, observed: observed + 1 }, { ...flag, threshold: observed },
      { ...flag, replay: { startMs: attempt.startMs - 1, endMs: attempt.endMs } },
      { ...flag, replay: { startMs: attempt.startMs, endMs: attempt.endMs + 1 } },
    ]) expect(() => parseReviewAttempt({ ...attempt, flags: [invalid] })).toThrow();
    expect(() => parseReviewAttempt({ ...attempt, flags: [flag, flag] })).toThrow();
  });
  it('retains exclusions/nulls and reports no invented medians for zero measurable attempts', () => {
    const reasons = ['ENDPOINT_NOT_REACHED'];
    const metrics = Object.fromEntries(Object.entries(attempt.metrics).map(([key, metric]) => [key, { ...metric, value: null, reasons }]));
    const excluded = { ...attempt, classification: 'excluded', reasons, explanations: ['Configured endpoint was not observed.'], endpointMs: null, returnStartMs: null, restMs: null, metrics, flags: [] };
    const parsed = parseReviewRecord({ ...record, attempts: [excluded] });
    expect(summarizeReviewRecord(parsed)).toMatchObject({ detected: 1, measurable: 0, excluded: 1, flagged: 0 });
    expect(Object.values(summarizeReviewRecord(parsed).medians).every((median) => median === null)).toBe(true);
    expect(() => parseReviewAttempt({ ...excluded, explanations: [] })).toThrow();
    expect(() => parseReviewAttempt({ ...excluded, reasons: [...reasons, ...reasons] })).toThrow();
    const empty = summarizeReviewRecord(parseReviewRecord({ ...record, attempts: [] }));
    expect(empty).toMatchObject({ detected: 0, measurable: 0, excluded: 0, flagged: 0 });
    expect(Object.values(empty.medians).every((median) => median === null)).toBe(true);
  });
  it('rejects cross-configuration, duplicate, overlapping, post-stop and unverified legacy records', () => {
    expect(() => parseReviewRecord({ ...record, attempts: [attempt, attempt] })).toThrow();
    expect(() => parseReviewRecord({ ...record, attempts: [attempt, { ...attempt, id: `${attempt.id}:other` }] })).toThrow();
    expect(() => parseReviewRecord({ ...record, attempts: [{ ...attempt, configurationId: 'another-setup' }] })).toThrow();
    expect(() => parseReviewRecord({ ...record, capture: { ...record.capture, stoppedAtMs: 500 } })).toThrow();
    expect(() => parseReviewRecord({ ...record, schemaVersion: record.schemaVersion.replace('v2', 'v1') })).toThrow();
    expect(() => parseReviewRecord({ ...record, configuration: { ...record.configuration, endpointDeg: 0 } })).toThrow();
  });
});

it('retains the legacy reach v1 consumer and rejects unsupported exercises explicitly', () => {
  const reach = syntheticReachSession('legacy');
  expect(parseReviewRecord(reach)).toEqual(reach);
  expect(() => parseReviewRecord({ ...reach, exercise: { ...reach.exercise, id: 'standing_jump' } })).toThrow('Unsupported exercise');
  expect(() => parseReviewAttempt({ ...reach.attempts[0], exerciseId: 'standing_jump' })).toThrow('Unsupported exercise');
});
