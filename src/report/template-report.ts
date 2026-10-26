import type { ContextEntry, SessionContext } from '../contracts/session-context.js';
import type { ChartSpec, GeneratedReport, ReportInput } from '../contracts/provider-report.js';
import { reportFacts } from './report-input.js';

/**
 * Deterministic local explanation (FR-17 fallback). Built only from source facts, so it is always
 * available without a key, network or consent and passes the same validator as a generated report.
 * Local context entries, including real ones that never leave the device, are listed by ID for
 * display in their original wording; they are not summarized.
 */
export const TEMPLATE_VERSION = 'report-template.v1';
export type LocalReport = { source: 'deterministic_template'; version: typeof TEMPLATE_VERSION; report: GeneratedReport; contextEntries: ContextEntry[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function defaultChart(input: ReportInput): ChartSpec {
  for (const d of input.metricDefinitions) {
    const hasValue = input.attempts.some((a) => a.classification === 'measurable' && a.metrics.find((m) => m.metric === d.metric)?.value !== null);
    if (hasValue) return { type: 'per_attempt_metric', metric: d.metric, showThreshold: input.criteria.some((c) => c.metric === d.metric) };
  }
  return input.counts.detected ? { type: 'attempt_counts', metric: 'none', showThreshold: false } : { type: 'none', metric: 'none', showThreshold: false };
}

/** Exact, versioned general statements; provider output cannot introduce a new uncited claim. */
export const GENERAL_LIMITATIONS = [
  'Angles and displacements are 2D image-plane estimates, not clinical range-of-motion or distance measurements.',
  'Values are 2D image-plane estimates from a single camera view.',
] as const;

/** Shared evidence-bound summary used by the prompt, fallback and acceptance validator. */
export function deterministicSummary(input: ReportInput): string {
  const { detected, measurable, excluded, flagged } = input.counts;
  const flagSentence = !input.criteria.length ? 'No review criteria were configured.'
    : flagged ? `${flagged} flagged for review (a flag requests review of the replay).`
      : 'No configured review criterion was exceeded.';
  return detected === 0
    ? `No attempts were detected, so there are no measurements to report. ${flagSentence}`
    : `${plural(detected, 'attempt was', 'attempts were')} detected: ${measurable} measurable and ${excluded} excluded. ${flagSentence} Values are image-based estimates from a single camera view.`;
}

export function templateReport(input: ReportInput, localContext: SessionContext): LocalReport {
  const facts = reportFacts(input);
  const summary = deterministicSummary(input);
  // Flags first, then exclusions, then measured values, so the bounded list keeps what needs review.
  const observations = [...facts.filter((f) => f.kind === 'flag'), ...facts.filter((f) => f.kind === 'exclusion'), ...facts.filter((f) => f.kind === 'metric' && !f.nullValue)]
    .slice(0, 12).map((f) => ({ factId: f.id, text: f.text }));
  const limitations = [
    { factId: 'none', text: GENERAL_LIMITATIONS[0] },
    ...facts.filter((f) => f.kind === 'capture').map((f) => ({ factId: f.id, text: f.text })),
  ].slice(0, 6);
  const contextEntries = [...localContext.selfReport, ...localContext.clinician];
  return { source: 'deterministic_template', version: TEMPLATE_VERSION, contextEntries,
    report: { summary, observations, limitations, reportedContext: input.context.selfReport.map((s) => ({ contextId: s.contextId })).concat(input.context.clinician.map((c) => ({ contextId: c.contextId }))), chart: defaultChart(input) } };
}
