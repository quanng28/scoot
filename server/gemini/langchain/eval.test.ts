import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { evalFixturesSchema } from '../../../scripts/report-eval/fixtures.js';
import { assertRunAllowed, parseOptions, runEvaluation } from '../../../scripts/report-eval/harness.js';
import { percentile, summarizeRun } from '../../../scripts/report-eval/summary.js';
import { REPORT_EXERCISES } from '../../../src/contracts/provider-report.js';
import { measuredSpec, quickSpec } from './specs.js';

const fixtures = async () => evalFixturesSchema.parse(JSON.parse(await readFile('fixtures/report-eval/cases.json', 'utf8')));

describe('synthetic paired evaluation harness', () => {
  it('has 26 allowlisted fictional fixtures, all six exercises in both arms, and valid local fallbacks', async () => {
    const cases = await fixtures(); expect(cases).toHaveLength(26);
    for (const branch of ['quick', 'measured']) expect(new Set(cases.filter((f) => f.branch === branch).map((f) => f.input.exercise.id))).toEqual(new Set(REPORT_EXERCISES));
    for (const fixture of cases) {
      const spec = fixture.branch === 'measured' ? await measuredSpec(fixture.input) : await quickSpec(fixture.input);
      expect(spec.validate(spec.fallback()).ok, fixture.id).toBe(true);
    }
    const capped = cases.find((f) => f.id === 'quick-thirty-reps-thirty-events');
    expect(capped?.branch === 'quick' && capped.input.reps.length).toBe(30);
    expect(capped?.branch === 'quick' && capped.input.events.length).toBe(30);
  });
  it('defaults to reproducible offline fakes; records every outcome without payloads', async () => {
    const network = vi.fn<typeof fetch>(async () => { throw new Error('unexpected external request'); });
    const run = await runEvaluation(await fixtures(), parseOptions([]), {}, network);
    expect(network).not.toHaveBeenCalled(); expect(run.mode).toBe('fake');
    expect(run.rows).toHaveLength(26 * 3 * 2); expect(run.calls).toBeLessThanOrEqual(200);
    expect(run.rows.some((r) => r.metrics.outcome === 'accepted_after_repair')).toBe(true);
    expect(run.rows.some((r) => r.metrics.outcome === 'fallback_validation')).toBe(true);
    for (const row of run.rows) expect(row.calls).toBeLessThanOrEqual(row.pipeline === 'direct' ? 1 : 2);
    expect(run.rows.filter((r) => r.fixtureId === 'measured-injection-gate').every((r) => r.calls === 0 && r.responseCode === 'CONTEXT_NOT_PERMITTED')).toBe(true);
    expect(JSON.stringify(run)).not.toMatch(/offline-fake-key|system_instruction|calculate nothing|FICTIONAL FIXTURE:|observations":|headline":|contents":|apiKey/);
    const summary = summarizeRun(run);
    for (const text of ['First-pass valid', 'Final valid', 'Repair recovery', 'Failure classes', 'p50 / p95', 'Per-fixture', 'Accepted output', 'not yet run', 'Release blocker']) expect(summary).toContain(text);
  });
  it('enforces the global call cap across both actual endpoint arms', async () => {
    const run = await runEvaluation(await fixtures(), parseOptions(['--max-calls', '2', '--runs', '1']));
    expect(run.calls).toBe(2); expect(run.rows.some((r) => r.responseCode === 'BUDGET_EXHAUSTED')).toBe(true);
    expect(run.rows.reduce((n, r) => n + r.calls, 0)).toBe(2);
  });
  it('requires explicit live, key and yes; neither environment keys nor --yes alone select live', () => {
    expect(parseOptions(['--yes']).live).toBe(false);
    expect(() => assertRunAllowed(parseOptions(['--live']), { GEMINI_API_KEY: 'FAKE_KEY' })).toThrow('--yes');
    expect(() => assertRunAllowed(parseOptions(['--live', '--yes']), {})).toThrow('GEMINI_API_KEY');
    expect(() => assertRunAllowed(parseOptions(['--trace']), { LANGSMITH_API_KEY: 'FAKE_TRACE_KEY' })).toThrow('--yes');
    expect(() => parseOptions(['--runs', '0'])).toThrow(); expect(() => parseOptions(['--max-calls', 'NaN'])).toThrow();
    expect(() => parseOptions(['--unknown'])).toThrow();
  });
  it('uses actual provider usage when a mocked live transport returns it, without echoing secrets', async () => {
    const fixture = (await fixtures())[0]!;
    if (fixture.branch !== 'measured') throw new Error('fixture branch');
    const spec = await measuredSpec(fixture.input);
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(spec.fallback()) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 } })));
    const run = await runEvaluation([fixture], parseOptions(['--live', '--yes', '--runs', '1', '--max-calls', '2']), { GEMINI_API_KEY: 'FAKE_KEY_SENTINEL' }, transport);
    expect(transport).toHaveBeenCalledTimes(2); expect(run.rows.map((r) => r.metrics.usage?.total)).toEqual([18, 18]);
    expect(JSON.stringify(run)).not.toContain('FAKE_KEY_SENTINEL');
  });
  it('uses nearest-rank quantiles without mutating samples or inventing missing values', () => {
    const samples = [3, 1, 2];
    expect(percentile(samples, 0.5)).toBe(2); expect(percentile(samples, 0.95)).toBe(3); expect(percentile([], 0.95)).toBeNull(); expect(samples).toEqual([3, 1, 2]);
  });
});
