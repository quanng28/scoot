import type { EvalRow, EvalRun } from './harness.js';

export function percentile(values: number[], share: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? null;
}
const percentage = (count: number, total: number) => total ? `${(100 * count / total).toFixed(2)}% (${count}/${total})` : 'not applicable';
const accepted = (row: EvalRow) => row.metrics.outcome === 'accepted_first_pass' || row.metrics.outcome === 'accepted_after_repair';
const firstValid = (row: EvalRow) => row.metrics.steps.some((s) => s.step === 'validate' && s.attempt === 1 && s.outcome === 'pass');
const firstRejected = (row: EvalRow) => row.metrics.steps.some((s) => s.step === 'validate' && s.attempt === 1 && s.outcome === 'reject');
const quantiles = (values: number[]) => values.length ? `${percentile(values, 0.5)?.toFixed(2)} / ${percentile(values, 0.95)?.toFixed(2)}` : 'not applicable';

export function summarizeRun(run: EvalRun): string {
  const lines = ['# Synthetic report evaluation', '', `Mode: **${run.mode}**. Date: ${run.date}. Model configuration: ${run.modelId}.`,
    `Actual provider-adapter calls: ${run.calls}; cap: ${run.maxCalls}; unconstrained maximum: ${run.maximumPossibleCalls}.`,
    `Settings: ${JSON.stringify(run.settings)}. Repetitions: ${run.runs}. Prompt/validator versions: ${[...new Set(run.rows.map((r) => `${r.metrics.promptVersion}/${r.metrics.validatorVersion}`))].join(', ')}.`, '',
    run.mode === 'fake' ? 'Deterministic fake fault schedule: this tests the harness and pipeline mechanics. Live model efficacy, latency, tokens and cost: not yet run.' : 'Live synthetic output; no clinician validation and no real patient data.',
    '', '| Pipeline | First-pass valid | Final valid after ≤1 repair | Repair recovery | Fallback | Calls |', '| --- | --- | --- | --- | --- | --- |'];
  for (const pipeline of ['direct', 'langchain'] as const) {
    const rows = run.rows.filter((r) => r.pipeline === pipeline);
    lines.push(`| ${pipeline} | ${percentage(rows.filter(firstValid).length, rows.length)} | ${percentage(rows.filter(accepted).length, rows.length)} | ${percentage(rows.filter((r) => r.metrics.outcome === 'accepted_after_repair').length, rows.filter(firstRejected).length)} | ${percentage(rows.filter((r) => !accepted(r)).length, rows.length)} | ${rows.reduce((n, r) => n + r.calls, 0)} |`);
  }
  lines.push('', '## Failure classes', '', '| Pipeline | Class | Rate (all units) |', '| --- | --- | --- |');
  for (const pipeline of ['direct', 'langchain'] as const) {
    const rows = run.rows.filter((r) => r.pipeline === pipeline);
    for (const failure of [...new Set(rows.flatMap((r) => r.metrics.failureClass ? [r.metrics.failureClass] : []))].sort())
      lines.push(`| ${pipeline} | ${failure} | ${percentage(rows.filter((r) => r.metrics.failureClass === failure).length, rows.length)} |`);
  }
  lines.push('', '## Measured latency and reported tokens', '', 'Nearest-rank p50 / p95. A two-call unit includes repair time even when repair fails. Units rejected before dispatch are separate.', '',
    '| Pipeline | Calls per unit | Units | Whole-unit latency ms p50 / p95 | Reported total tokens p50 / p95 |', '| --- | --- | --- | --- | --- |');
  for (const pipeline of ['direct', 'langchain'] as const) for (const count of [0, 1, 2]) {
    const rows = run.rows.filter((r) => r.pipeline === pipeline && r.calls === count);
    const usage = rows.flatMap((r) => r.metrics.usage ? [r.metrics.usage.total] : []);
    lines.push(`| ${pipeline} | ${count} | ${rows.length} | ${quantiles(rows.map((r) => r.metrics.durationMs))} | ${!rows.length ? 'not applicable' : count === 0 ? 'not applicable' : usage.length === rows.length ? quantiles(usage) : 'not yet run (usage unavailable)'} |`);
  }
  lines.push('', '## Per-fixture outcomes', '', '| Fixture | Pipeline | First-pass valid | Final valid | Fallback | Calls | p95 ms |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const id of [...new Set(run.rows.map((r) => r.fixtureId))]) for (const pipeline of ['direct', 'langchain'] as const) {
    const rows = run.rows.filter((r) => r.fixtureId === id && r.pipeline === pipeline);
    lines.push(`| ${id} | ${pipeline} | ${percentage(rows.filter(firstValid).length, rows.length)} | ${percentage(rows.filter(accepted).length, rows.length)} | ${percentage(rows.filter((r) => !accepted(r)).length, rows.length)} | ${rows.reduce((n, r) => n + r.calls, 0)} | ${percentile(rows.map((r) => r.metrics.durationMs), 0.95)?.toFixed(2)} |`);
  }
  lines.push('', '## Accepted output that may still be wrong', '', 'Each item identifies an actual accepted unit and a concrete limitation detected locally. No report payload is retained. This detector is not exhaustive; human review is required.');
  const caveats = run.rows.filter((r) => r.caveats.length);
  if (!caveats.length) lines.push('', 'No case was flagged by the local checks; this does not establish correctness.');
  for (const row of caveats) lines.push('', `- ${row.fixtureId}, repetition ${row.repetition}, ${row.pipeline}: ${row.caveats.join(' ')}`);
  const statusFailures = run.rows.some((r) => r.caveats.some((c) => c.includes('contradicts')));
  lines.push('', '## Acceptance decision', '', run.mode === 'fake' ? 'Not assessed: fake outcomes cannot meet the preregistered live improvement or latency criteria.'
    : 'Human assessment required against docs/report-eval/acceptance.md; inspect paired rates, at least 20 first-pass rejections, added p95 latency, incomplete runs and every accepted-output caveat.',
    statusFailures ? 'Release blocker observed in this synthetic run: existing quick validation can accept a headline inconsistent with supplied status. Validators were not loosened; this needs a separately reviewed validator change.' : 'No automatic clinical correctness claim is made.',
    '', 'Synthetic limits: no clinician validation, no real patient data, no measure of clinical usefulness or safety. Fake latency is local machine execution time. Missing token usage is unknown. Payloads, prompts, context, credentials and model text are excluded from these files.', '');
  return lines.join('\n');
}
