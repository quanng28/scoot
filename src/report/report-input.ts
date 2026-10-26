import { reasonText, type Reason } from '../analysis/reach-contract.js';
import type { ReviewRecord } from '../contracts/review-session.js';
import { buildSessionReportInput } from '../contracts/session-report.js';
import type { SessionContext } from '../contracts/session-context.js';
import { REPORT_INPUT_VERSION, reportInputSchema, UNIT_DECIMALS, type ReportInput, type ReportMetric, type ReportUnit } from '../contracts/provider-report.js';
import { DEFAULT_CONTEXT_POLICY, selectTransferableContext, type ContextSelection, type ContextTransferPolicy } from './context-policy.js';

const STOP_TEXT: Record<string, string> = {
  STOPPED: 'stopped by the user', DISCOMFORT_STOP: 'stopped after reported discomfort', SETUP_CHANGED: 'stopped because the setup changed',
  CAPTURE_FAILED: 'ended because capture failed or was interrupted', SYNTHETIC_FIXTURE: 'synthetic fixture, no live capture',
};

/**
 * Explicit adapter from the independently revalidated six-exercise facts contract to the bounded
 * provider allowlist. Source IDs, coordinates, notes and video stay local. The caller retains the
 * source facts for replay/chart links; provider explanations are digest-bound to this exact DTO.
 */
export function buildProviderReportInput(record: ReviewRecord, context: SessionContext, policy: ContextTransferPolicy = DEFAULT_CONTEXT_POLICY): { input: ReportInput; withheld: ContextSelection['withheld'] } {
  const facts = buildSessionReportInput(record);
  const selection = selectTransferableContext(context, policy);
  const input = reportInputSchema.parse({
    schemaVersion: REPORT_INPUT_VERSION, provenance: facts.provenance,
    exercise: { id: facts.exercise.id, definitionVersion: facts.exercise.definitionVersion, analysisVersion: facts.analysisVersion, mode: facts.mode, side: facts.side },
    metricDefinitions: facts.metricDefinitions.map((definition) => ({ metric: definition.id, label: definition.label,
      unit: definition.unit === 'reference_lengths' ? 'reference lengths' : definition.unit })),
    counts: facts.counts, criteria: facts.configuredCriteria,
    attempts: facts.attempts.map((attempt, index) => ({
      index: index + 1, classification: attempt.classification, startSec: attempt.startMs / 1000, endSec: attempt.endMs / 1000,
      keyTimes: [
        { event: facts.exercise.id === 'seated_forward_reach' ? 'target_entry' : 'endpoint', sec: attempt.endpointMs === null ? null : attempt.endpointMs / 1000 },
        { event: 'return_start', sec: attempt.returnStartMs === null ? null : attempt.returnStartMs / 1000 },
        { event: 'rest_entry', sec: attempt.restMs === null ? null : attempt.restMs / 1000 },
        { event: 'completion', sec: attempt.endMs / 1000 },
      ],
      metrics: attempt.metrics.map((metric) => ({ metric: metric.id, value: metric.value, nullReasons: metric.reasons })),
      exclusionReasons: attempt.reasons, quality: attempt.quality,
      flags: attempt.flags.map((flag) => ({ metric: flag.metric, operator: flag.operator, threshold: flag.threshold, observed: flag.observed })),
    })),
    capture: { stopReason: record.capture.stopReason, recordingStatus: record.recording.status, recordingDurationSec: record.recording.durationMs === null ? null : record.recording.durationMs / 1000 },
    context: { selfReport: selection.selfReport, clinician: selection.clinician, withheldCount: selection.withheld.length },
  });
  return { input, withheld: selection.withheld };
}

export type ReportFact = { id: string; kind: 'counts' | 'criteria' | 'attempt' | 'metric' | 'exclusion' | 'quality' | 'flag' | 'capture' | 'context';
  text: string; values: number[]; metric?: ReportMetric; nullValue?: boolean; operator?: '<' | '>' };

export const formatValue = (value: number, unit: ReportUnit) => value.toFixed(UNIT_DECIMALS[unit]);
/** Report wording for engine reason codes; BUFFER_LIMIT avoids the word "diagnostic", which the validator reserves. */
const REASON_OVERRIDES: Partial<Record<Reason, string>> = { BUFFER_LIMIT: 'The attempt exceeded the stored observation limit' };
const reasonSentence = (code: string) => REASON_OVERRIDES[code as Reason] ?? (code in reasonText ? reasonText[code as Reason].replace(/\.$/, '') : code.toLowerCase().replaceAll('_', ' '));
const sec = (value: number) => value.toFixed(2);

/**
 * Deterministic, numbered source facts. The prompt shows these, the validator checks generated sentences
 * against them, and the template report is assembled from them, so all three agree by construction.
 */
export function reportFacts(input: ReportInput): ReportFact[] {
  const def = new Map(input.metricDefinitions.map((d) => [d.metric, d]));
  const { detected, measurable, excluded, flagged } = input.counts;
  const facts: ReportFact[] = [{ id: 'counts', kind: 'counts', values: [detected, measurable, excluded, flagged],
    text: `Detected attempts: ${detected}; measurable: ${measurable}; excluded: ${excluded}; measurable attempts with a configured review flag: ${flagged}.` }];
  if (!input.criteria.length) facts.push({ id: 'criteria.none', kind: 'criteria', values: [], text: 'No review criteria were configured, so no attempt can be flagged.' });
  input.criteria.forEach((c, i) => {
    const d = def.get(c.metric)!;
    facts.push({ id: `criterion.${i + 1}`, kind: 'criteria', metric: c.metric, operator: c.operator, values: [c.threshold],
      text: `Configured review criterion: ${d.label} ${c.operator} ${formatValue(c.threshold, d.unit)} ${d.unit}.` });
  });
  for (const a of input.attempts) {
    const n = a.index;
    facts.push({ id: `attempt.${n}`, kind: 'attempt', values: [n, a.startSec, a.endSec],
      text: `Attempt ${n} was ${a.classification}, from ${sec(a.startSec)} to ${sec(a.endSec)} seconds of the recording.` });
    if (a.classification === 'excluded') facts.push({ id: `attempt.${n}.exclusion`, kind: 'exclusion', values: [n],
      text: `Attempt ${n} was excluded from measurement: ${a.exclusionReasons.map(reasonSentence).join('; ')}.` });
    for (const m of a.metrics) {
      const d = def.get(m.metric)!;
      facts.push(m.value === null
        ? { id: `attempt.${n}.${m.metric}`, kind: 'metric', metric: m.metric, nullValue: true, values: [n], text: `Attempt ${n} ${d.label}: not available (${m.nullReasons.map(reasonSentence).join('; ')}).` }
        : { id: `attempt.${n}.${m.metric}`, kind: 'metric', metric: m.metric, values: [n, m.value], text: `Attempt ${n} ${d.label}: ${formatValue(m.value, d.unit)} ${d.unit}.` });
    }
    facts.push({ id: `attempt.${n}.quality`, kind: 'quality', values: [n, a.quality.coverage * 100, a.quality.longestGapMs, a.quality.observationCount],
      text: `Attempt ${n} tracking coverage ${(a.quality.coverage * 100).toFixed(0)}%, longest gap ${a.quality.longestGapMs.toFixed(0)} ms, ${a.quality.observationCount} valid observations.` });
    for (const f of a.flags) {
      const d = def.get(f.metric)!;
      facts.push({ id: `attempt.${n}.flag.${f.metric}`, kind: 'flag', metric: f.metric, operator: f.operator, values: [n, f.observed, f.threshold],
        text: `Attempt ${n} ${d.label} ${formatValue(f.observed, d.unit)} ${d.unit} exceeded the configured ${f.operator} ${formatValue(f.threshold, d.unit)} ${d.unit} review criterion. A flag requests review of the replay.` });
    }
  }
  const c = input.capture;
  facts.push({ id: 'capture', kind: 'capture', values: c.recordingDurationSec === null ? [] : [c.recordingDurationSec],
    text: `Capture ${STOP_TEXT[c.stopReason] ?? reasonSentence(c.stopReason)}. Recording evidence: ${c.recordingStatus}${c.recordingDurationSec === null ? '' : `, ${sec(c.recordingDurationSec)} seconds`}.` });
  for (const s of input.context.selfReport) facts.push({ id: `context.${s.contextId}`, kind: 'context', values: [], text: 'Self-reported context was supplied (shown separately in its original wording).' });
  for (const s of input.context.clinician) facts.push({ id: `context.${s.contextId}`, kind: 'context', values: [], text: 'Existing clinician-provided context was supplied (shown separately; not an app finding).' });
  if (input.context.withheldCount) facts.push({ id: 'context.withheld', kind: 'context', values: [input.context.withheldCount], text: `${input.context.withheldCount} context entries were kept on this device and not sent.` });
  return facts;
}

/** Canonical JSON (sorted keys) so client and server compute the same binding digest. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function reportInputDigest(input: ReportInput): Promise<string> { return canonicalDigest(input); }

/** SHA-256 of the canonical JSON; shared by the measured and the video-only report bindings. */
export async function canonicalDigest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
