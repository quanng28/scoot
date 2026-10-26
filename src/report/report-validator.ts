import { generatedReportSchema, type GeneratedReport, type ReportInput, type ReportMetric, type ReportUnit } from '../contracts/provider-report.js';
import { reportFacts, type ReportFact } from './report-input.js';
import { deterministicSummary, GENERAL_LIMITATIONS } from './template-report.js';

/**
 * Semantic validation of a generated explanation (PRD FR-17/FR-19, checklist F3). Valid JSON is not
 * evidence of fidelity, so every sentence is checked against the deterministic source facts:
 * - text is NFKC-normalized; invisible or unsupported characters are rejected;
 * - every number (digits, glued digits or number words) must round to a value of the cited fact;
 * - each cited metric/flag/criterion sentence must name its own metric and unit and no other; non-metric
 *   facts may not carry metric names or angle/length units; flag wording must match the operator direction;
 * - summary counts must sit in the same clause as their label ("3 measurable", "1 excluded") and equal
 *   that count; negated counts ("no attempt was excluded") are checked too; quantifiers are not allowed;
 * - comparison, diagnosis, cause, treatment, advice, judgement, progress, statistic and instruction-like
 *   wording is rejected unless the cited deterministic fact itself uses the word;
 * - context can only be referenced by ID, never quoted (normalized n-gram check);
 * - chart choices must come from the allowlist and have real data behind them.
 * Acceptance also requires exact evidence-bound wording: the deterministic summary, cited source
 * fact text, or one versioned general limitation. The lexicon and numeric checks provide diagnostics,
 * never approval. Novel paraphrases are rejected because a blacklist cannot prove their fidelity.
 */
export const VALIDATOR_VERSION = 'report-validator.v3';
export type ValidationResult = { ok: true; report: GeneratedReport } | { ok: false; issues: string[] };

const FORBIDDEN: [string, RegExp][] = [
  ['medical or diagnostic term', /\b(diagnos\w*|disease\w*|disorder\w*|syndrome|condition\w*|stroke\w*|hemipare\w*|pares[ie]s|plegi\w*|paraly\w*|palsy|spastic\w*|neurolog\w*|impair\w*|deficit\w*|lesion\w*|symptom\w*|pain\w*|ache\w*|aching|sore\w*|stiff\w*|numb\w*|cramp\w*|spasm\w*|swell\w*|dizz\w*|nause\w*|arthrit\w*|injur\w*|weak\w*|fatigu\w*|tired\w*|exhaust\w*|tremor\w*|balance|fall\w*|frailty|mobility)\b/i],
  ['treatment or prescription', /\b(treat\w*|therap\w*|medic\w*|drug\w*|dose\w*|dosage|prescri\w*|rehab\w*|physio\w*|doctor\w*|surgery)\b/i],
  ['progress or prognosis claim', /\b(recover\w*|improv\w*|progress\w*|deteriorat\w*|declin\w*|worsen\w*|prognos\w*|better|worse|baseline level)\b/i],
  ['safety, correctness or performance judgement', /\b(safe\w*|unsafe|danger\w*|risk\w*|harm\w*|correct\w*|incorrect\w*|proper\w*|improper\w*|normal\w*|abnormal\w*|healthy|unhealthy|good|bad|poor\w*|excellent|great|well|nicely|ideal\w*|optimal\w*|success\w*|fail\w*|achiev\w*|acceptabl\w*|unacceptabl\w*|adequate\w*|inadequate\w*|stable|unstable|smooth\w*|consistent\w*|inconsistent\w*|strong\w*|limited range)\b/i],
  ['advice or instruction', /\b(should|must|ought|recommend\w*|advis\w*|suggest\w*|try|consider\w*|need(s)? to|keep|aim|push\w*|farther|further|harder|increase\w*|decrease\w*|practi[cs]e\w*|continue\w*|avoid\w*|consult\w*|contact\w*|seek|please|ensure|make sure|be sure|slow down|speak (to|with)|ask (a|your|the)|next time|encourag\w*|focus on|remember|take care)\b/i],
  ['speculative or causal interpretation', /\b(indicat\w*|signs? of|consistent with|likely|unlikely|probabl\w*|possibl\w*|perhaps|may (be|have|indicate|reflect)|might|could (be|reflect|indicate)|reflects?|attribut\w*|because|due to|as a result|caus\w*|leads? to|results? in)\b/i],
  ['statistic or quantifier not in source facts', /\b(average\w*|mean|median|typical\w*|overall score|score\w*|percentile|grade\w*|all|every|each|both|most|majority|several|many|few|some|neither|either|half|double|triple)\b/i],
  ['instruction, link or markup', /(https?:\/\/|www\.|<\/?[a-z!][^>]*>|```|\]\(|\bignore\b|system\s*prompt|\binstruction\w*|\bas an ai\b|language model|\bjson\b)/i],
  ['second-person attribution', /\b(you have|you are|your (arm|body|movement|reach|elbow|shoulder|torso|form|posture|condition))\b/i],
];
/** Causal phrasing is allowed only when restating why the deterministic engine excluded an attempt. */
const CAUSE_OK_KINDS = new Set<ReportFact['kind']>(['exclusion', 'capture']);
const COMPARISON = /\b(exceed\w*|above|below|over|under|greater|less|higher|lower|more than|fewer than|beyond|surpass\w*|longer|shorter|faster|slower|larger|smaller|bigger|most|least|similar\w*|same|different|differ\w*|compared|than|relative|versus|vs)\b/gi;
const ABOVE_ONLY = /\b(above|over|greater|higher|more than|beyond)\b/i;
const BELOW_ONLY = /\b(below|under|less|lower|fewer than)\b/i;
const NEGATION = /\b(no|not|none|neither|without|zero)\b/i;
const NULL_WORDING = /\b(not available|unavailable|not measured|could not be measured|no value|was not reported|not reported)\b/i;
const UNIT_PATTERNS: Record<ReportUnit, RegExp> = { degrees: /\b(degrees?|deg)\b|°/i, 'reference lengths': /\breference[- ]lengths?\b/i, seconds: /\b(seconds?|secs?)\b|\d\s*s\b/i };
/** Distinctive words per metric; another metric's word is rejected unless it is part of this metric's own label. */
const METRIC_WORDS: Record<ReportMetric, RegExp> = {
  elbowPeakDeg: /\belbow\b/i, minElbowDeg: /\belbow\b/i, bendExcursionDeg: /\bexcursion\b/i, torsoForwardPeakDeg: /\b(torso|trunk)\b/i,
  wristForwardPeak: /\bwrist\b/i, reachDurationSec: /\bduration\b/i, bendDurationSec: /\bbend\b/i, returnDurationSec: /\breturn\b/i,
  peakUpperArmAngleDeg: /\bupper[- ]arm\b/i, peakWristElevation: /\bwrist\b/i, raiseDurationSec: /\braise\b/i,
  peakKneeAngleDeg: /\bknee\b/i, projectedExtensionExcursionDeg: /\bextension\b/i, extensionDurationSec: /\bextension\b/i,
  peakKneeElevation: /\bknee\b/i, liftDurationSec: /\blift\b/i,
  orientedAngleDeg: /\bshank\b/i, signedChangeDeg: /\bsigned\b/i, peakExcursionDeg: /\bexcursion\b/i, outwardDurationSec: /\boutward\b/i,
};
const ANY_METRIC_WORD = /\b(elbow|torso|trunk|wrist|knee|shank|foot|upper.arm|angle|inclination|displacement|excursion|elevation|duration)\b/i;
const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export type NumberClaim = { raw: string; value: number; decimals: number; index: number };

/** NFKC plus removal of invisible characters; returns null when characters remain that the checks cannot read. */
export function normalizeText(text: string): string | null {
  const normalized = text.normalize('NFKC').replace(/[­​-‏⁠﻿]/g, '');
  if (/[^\x20-\x7E°–—‘’“”…]/.test(normalized)) return null;
  return normalized.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');
}

/** Extracts numeric claims, including number words up to ninety-nine and digits glued to letters ("52.9deg"). */
export function numbersIn(text: string): NumberClaim[] {
  const t = text.replace(/\b[23]D\b/gi, '  ').replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(new RegExp(`\\b(${ORDINALS.join('|')})\\b(?=\\s+(attempt|repetition|reach|one))`, 'gi'), (w) => String(ORDINALS.indexOf(w.toLowerCase()) + 1).padEnd(w.length));
  const out: NumberClaim[] = [];
  for (const m of t.matchAll(/(-?)(?<![\d.])(\d+(?:\.\d+)?)/g)) {
    const signed = m[1] === '-' && !/[\w]/.test(t[m.index - 1] ?? ' ');
    out.push({ raw: m[0], value: Number(signed ? `-${m[2]}` : m[2]), decimals: m[2]!.split('.')[1]?.length ?? 0, index: m.index + m[1]!.length });
  }
  const words = new RegExp(`\\b(${[...TENS.filter(Boolean)].join('|')})(?:[- ](${SMALL_NUMBERS.slice(1, 10).join('|')}))?\\b|\\b(${SMALL_NUMBERS.join('|')}|once|twice)\\b|\\b(hundred|thousand|million|dozen)\\b`, 'gi');
  for (const m of t.matchAll(words)) {
    const lower = m[0].toLowerCase();
    let value: number;
    if (m[4]) value = Number.NaN;
    else if (m[1]) value = TENS.indexOf(m[1].toLowerCase()) * 10 + (m[2] ? SMALL_NUMBERS.indexOf(m[2].toLowerCase()) : 0);
    else value = lower === 'once' ? 1 : lower === 'twice' ? 2 : SMALL_NUMBERS.indexOf(lower);
    out.push({ raw: m[0], value, decimals: 0, index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True when `claim` is `source` rounded at the claim's own precision (full precision also accepted). */
export function isRoundingOf(claim: { value: number; decimals: number }, source: number): boolean {
  if (!Number.isFinite(claim.value)) return false;
  if (claim.value === source || claim.value === Number(source.toFixed(claim.decimals))) return true;
  const factor = 10 ** claim.decimals;
  return Math.abs(claim.value - Math.round(source * factor) / factor) < 1e-9;
}

const tokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function echoesContext(text: string, contextTexts: string[]): boolean {
  const out = ` ${tokens(text).join(' ')} `;
  for (const original of contextTexts) {
    const words = tokens(original.replace(/^FICTIONAL FIXTURE:\s*/i, ''));
    const size = Math.min(4, words.length);
    if (size < 2) continue;
    for (let i = 0; i + size <= words.length; i++) {
      const window = words.slice(i, i + size);
      if (window.filter((w) => w.length >= 3).length >= 2 && out.includes(` ${window.join(' ')} `)) return true;
    }
  }
  return false;
}

type Scope = { label: string; fact: ReportFact | null; allowed: number[]; input: ReportInput };

function lexicalIssues(scope: Scope, text: string, issues: string[]): void {
  const factText = scope.fact?.text.toLowerCase() ?? '';
  for (const [name, pattern] of FORBIDDEN) {
    const global = new RegExp(pattern.source, 'gi');
    for (const hit of text.matchAll(global)) {
      const word = hit[0].toLowerCase();
      if (factText && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(factText)) continue; // the deterministic fact uses it
      if (name.startsWith('speculative') && /^(because|due to|as a result)$/.test(word) && scope.fact && CAUSE_OK_KINDS.has(scope.fact.kind)) continue;
      issues.push(`${scope.label}: ${name} ("${hit[0].slice(0, 30)}")`);
      break;
    }
  }
}

function comparisonIssues(scope: Scope, text: string, issues: string[]): void {
  const fact = scope.fact;
  const negated = NEGATION.test(text);
  for (const hit of text.matchAll(COMPARISON)) {
    const word = hit[0].toLowerCase();
    if (fact?.kind === 'flag') {
      if ((fact.operator === '>' && BELOW_ONLY.test(text)) || (fact.operator === '<' && ABOVE_ONLY.test(text))) { issues.push(`${scope.label}: comparison direction contradicts the ${fact.operator} criterion`); return; }
      continue;
    }
    if (fact && fact.text.toLowerCase().includes(word)) continue;
    if (!fact && /^exceed/.test(word) && (scope.input.counts.flagged > 0 || negated)) continue;
    if (negated && /^exceed/.test(word)) continue;
    issues.push(`${scope.label}: comparison "${hit[0]}" is not supported by the source fact`);
    return;
  }
}

function unitAndMetricIssues(scope: Scope, text: string, issues: string[]): void {
  const fact = scope.fact;
  if (!fact) return;
  const def = fact.metric ? scope.input.metricDefinitions.find((d) => d.metric === fact.metric) : undefined;
  const own = def?.label.toLowerCase() ?? '';
  if (def && !fact.nullValue) {
    if (!UNIT_PATTERNS[def.unit].test(text)) issues.push(`${scope.label}: missing unit "${def.unit}"`);
    for (const [unit, pattern] of Object.entries(UNIT_PATTERNS) as [ReportUnit, RegExp][]) if (unit !== def.unit && pattern.test(text)) issues.push(`${scope.label}: wrong unit "${unit}" for ${def.unit} metric`);
  }
  if (def) {
    if (!METRIC_WORDS[def.metric].test(text)) issues.push(`${scope.label}: does not name the cited metric`);
    for (const other of scope.input.metricDefinitions) {
      if (other.metric === def.metric) continue;
      const word = METRIC_WORDS[other.metric];
      if (word.test(text) && !word.test(own)) { issues.push(`${scope.label}: names a different metric than the cited fact`); break; }
    }
    return;
  }
  // Non-metric facts (counts, attempt range, quality, exclusion, capture) carry no angle/length values.
  if ((UNIT_PATTERNS.degrees.test(text) || UNIT_PATTERNS['reference lengths'].test(text)) && !UNIT_PATTERNS.degrees.test(fact.text)) issues.push(`${scope.label}: angle/length unit on a non-metric fact`);
  const metricWord = text.match(ANY_METRIC_WORD)?.[0];
  if (metricWord && !fact.text.toLowerCase().includes(metricWord.toLowerCase())) issues.push(`${scope.label}: names a metric the cited fact does not contain`);
}

function numberIssues(scope: Scope, text: string, issues: string[]): void {
  for (const claim of numbersIn(text)) if (!scope.allowed.some((v) => isRoundingOf(claim, v))) { issues.push(`${scope.label}: number "${claim.raw}" is not in the cited source fact`); }
}

type CountLabel = 'detected' | 'measurable' | 'excluded' | 'flagged' | 'criteria';
const SPECIFIC_LABELS: [CountLabel, RegExp][] = [['measurable', /^measurable$/], ['excluded', /^(excluded|unmeasurable)$/], ['flagged', /^(flag|flags|flagged|exceed|exceeded|exceeds)$/], ['detected', /^detected$/]];
const GENERIC_LABEL = /^(attempts?|repetitions?|reaches|bends)$/;

/** Summary counts: each number (or "no") must equal the count named in its own clause. */
function summaryCountIssues(input: ReportInput, text: string, issues: string[]): void {
  const counts: Record<CountLabel, number> = { ...input.counts, criteria: input.criteria.length };
  const durations = [input.capture.recordingDurationSec, ...input.criteria.map((c) => c.threshold), ...input.attempts.flatMap((a) => a.flags.flatMap((f) => [f.observed, f.threshold]))].filter((v): v is number => v !== null);
  for (const clause of text.split(/[.;:,!?()]|\band\b|\bbut\b|\bwhile\b|\bwhereas\b/i)) {
    const words = tokens(clause);
    if (!words.length) continue;
    const claims = numbersIn(clause);
    const labelAt = (position: number): CountLabel | null => {
      let best: { label: CountLabel; distance: number } | null = null;
      words.forEach((w, i) => {
        const specific = SPECIFIC_LABELS.find(([, re]) => re.test(w))?.[0];
        if (!specific) return;
        const distance = Math.abs(i - position) - (i > position ? 0.5 : 0); // ties prefer the label after the number
        if (!best || distance < best.distance) best = { label: specific, distance };
      });
      if (best) return (best as { label: CountLabel }).label;
      if (words.some((w) => GENERIC_LABEL.test(w))) return 'detected';
      return words.some((w) => /^criteri(a|on)$/.test(w)) ? 'criteria' : null;
    };
    const wordIndexOf = (charIndex: number) => tokens(clause.slice(0, charIndex)).length;
    for (const claim of claims) {
      const at = wordIndexOf(claim.index);
      if (/^(attempt|repetition|number)$/.test(words[at - 1] ?? '')) {
        if (!(Number.isInteger(claim.value) && claim.value >= 1 && claim.value <= input.attempts.length)) issues.push(`summary: attempt number "${claim.raw}" does not exist`);
        continue;
      }
      const label = labelAt(at);
      if (label) { if (claim.value !== counts[label]) issues.push(`summary: "${claim.raw}" does not equal the ${label} count (${counts[label]})`); }
      else if (!durations.some((v) => isRoundingOf(claim, v))) issues.push(`summary: number "${claim.raw}" is not a count, criterion, flag or duration fact`);
    }
    if (/\b(no|none|zero|not any)\b/.test(words.join(' ')) && !claims.length) {
      const label = labelAt(words.findIndex((w) => /^(no|none|zero|not)$/.test(w)));
      if (label && counts[label] !== 0) issues.push(`summary: claims no ${label} but the count is ${counts[label]}`);
    }
  }
}

/** Only case/spacing normalization is allowed; it cannot add, remove or change a factual claim. */
function sameEvidenceText(actual: string, expected: string): boolean {
  const normalized = (text: string) => normalizeText(text)?.replace(/\s+/g, ' ').trim().toLowerCase();
  const candidate = normalized(actual);
  return candidate !== null && candidate !== undefined && candidate === normalized(expected);
}

export function validateGeneratedReport(input: ReportInput, raw: unknown): ValidationResult {
  const parsed = generatedReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 10).map((i) => `schema: ${i.path.join('.') || '(root)'} ${i.message}`) };
  const report = parsed.data;
  const facts = reportFacts(input);
  const byId = new Map<string, ReportFact>(facts.map((f) => [f.id, f]));
  const contextTexts = [...input.context.selfReport.map((s) => s.originalText), ...input.context.clinician.map((c) => c.text)];
  const issues: string[] = [];
  const check = (scope: Scope, rawText: string) => {
    const text = normalizeText(rawText);
    if (text === null) { issues.push(`${scope.label}: unsupported or invisible characters`); return null; }
    lexicalIssues(scope, text, issues);
    comparisonIssues(scope, text, issues);
    unitAndMetricIssues(scope, text, issues);
    if (echoesContext(text, contextTexts)) issues.push(`${scope.label}: repeats reported context wording`);
    return text;
  };

  const summary = check({ label: 'summary', fact: null, allowed: [], input }, report.summary);
  if (summary !== null) {
    summaryCountIssues(input, summary, issues);
    if (!sameEvidenceText(summary, deterministicSummary(input))) issues.push('summary: must match the deterministic source summary');
  }
  if (summary !== null && input.counts.measurable === 0 && /\bmeasured (values?|at)\b/i.test(summary)) issues.push('summary: claims measured values with zero measurable attempts');

  const seen = new Set<string>();
  report.observations.forEach((o, i) => {
    const label = `observation ${i + 1}`;
    const fact = byId.get(o.factId);
    if (!fact || fact.kind === 'context') { issues.push(`${label}: cites unknown or context fact "${o.factId.slice(0, 40)}"`); return; }
    if (seen.has(o.factId)) issues.push(`${label}: duplicate fact citation`);
    seen.add(o.factId);
    const scope = { label, fact, allowed: fact.values, input };
    const text = check(scope, o.text);
    if (text === null) return;
    numberIssues(scope, text, issues);
    if (!sameEvidenceText(text, fact.text)) issues.push(`${label}: must copy the cited source fact without additional claims`);
    if (fact.nullValue && !NULL_WORDING.test(text)) issues.push(`${label}: presents an unavailable metric as measured`);
    if (fact.kind === 'exclusion' && /\bmeasurable\b/i.test(text) && !NEGATION.test(text)) issues.push(`${label}: calls an excluded attempt measurable`);
  });
  report.limitations.forEach((l, i) => {
    const label = `limitation ${i + 1}`;
    const fact = l.factId === 'none' ? null : byId.get(l.factId) ?? null;
    if (l.factId !== 'none' && (!fact || fact.kind === 'context')) { issues.push(`${label}: cites unknown fact`); return; }
    const scope = { label, fact, allowed: fact?.values ?? [], input };
    const text = check(scope, l.text);
    if (text !== null) {
      numberIssues(scope, text, issues);
      const matchesEvidence = fact ? sameEvidenceText(text, fact.text) : GENERAL_LIMITATIONS.some((allowed) => sameEvidenceText(text, allowed));
      if (!matchesEvidence) issues.push(`${label}: must match a cited source fact or an approved general limitation`);
    }
  });

  const contextIds = new Set([...input.context.selfReport, ...input.context.clinician].map((c) => c.contextId));
  const referenced = report.reportedContext.map((r) => r.contextId);
  if (new Set(referenced).size !== referenced.length) issues.push('reportedContext: duplicate reference');
  for (const id of referenced) if (!contextIds.has(id)) issues.push(`reportedContext: unknown context "${id.slice(0, 40)}"`);

  issues.push(...chartIssues(input, report.chart));
  return issues.length ? { ok: false, issues: [...new Set(issues)].slice(0, 20) } : { ok: true, report };
}

/** Allowlisted chart choice only; the app draws it from record values (G3). */
export function chartIssues(input: ReportInput, chart: GeneratedReport['chart']): string[] {
  if (chart.type === 'none') return chart.metric === 'none' && !chart.showThreshold ? [] : ['chart: "none" cannot carry a metric or threshold'];
  if (chart.type === 'attempt_counts') {
    if (chart.metric !== 'none' || chart.showThreshold) return ['chart: count chart cannot carry a metric or threshold'];
    return input.counts.detected > 0 ? [] : ['chart: no attempts to chart'];
  }
  if (chart.metric === 'none' || !input.metricDefinitions.some((d) => d.metric === chart.metric)) return ['chart: metric is not defined for this exercise'];
  const values = input.attempts.filter((a) => a.classification === 'measurable').map((a) => a.metrics.find((m) => m.metric === chart.metric)?.value ?? null).filter((v) => v !== null);
  if (!values.length) return ['chart: no measurable values for this metric'];
  if (chart.showThreshold && !input.criteria.some((c) => c.metric === chart.metric)) return ['chart: threshold line without a configured criterion'];
  return [];
}
