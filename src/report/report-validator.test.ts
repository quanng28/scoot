import { describe, expect, it } from 'vitest';
import { emptyContext } from '../contracts/session-context.js';
import { reportInputSchema, type GeneratedReport } from '../contracts/provider-report.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { buildProviderReportInput, reportFacts } from './report-input.js';
import { isRoundingOf, numbersIn, validateGeneratedReport } from './report-validator.js';
import { syntheticContext } from './synthetic-context.js';
import { templateReport } from './template-report.js';

const record = () => syntheticReachSession('validator-session', new Date('2026-10-25T12:00:00Z'));
const withContext = () => buildProviderReportInput(record(), syntheticContext(), { includeSyntheticContext: true }).input;
const plain = () => buildProviderReportInput(record(), emptyContext()).input;
const fact = (input: ReturnType<typeof plain>, id: string) => reportFacts(input).find((f) => f.id === id)!;

/** Evidence-bound model output selects exact source facts; individual tests corrupt one part. */
function goodReport(input = plain()): GeneratedReport {
  const flag = reportFacts(input).find((f) => f.kind === 'flag')!;
  return {
    summary: templateReport(input, emptyContext()).report.summary,
    observations: [
      { factId: flag.id, text: flag.text },
      { factId: 'attempt.3.exclusion', text: fact(input, 'attempt.3.exclusion').text },
      { factId: 'attempt.3.elbowPeakDeg', text: fact(input, 'attempt.3.elbowPeakDeg').text },
    ],
    limitations: [{ factId: 'none', text: 'Values are 2D image-plane estimates from a single camera view.' }],
    reportedContext: input.context.selfReport.map((s) => ({ contextId: s.contextId })),
    chart: { type: 'per_attempt_metric', metric: 'torsoForwardPeakDeg', showThreshold: true },
  };
}
const issues = (input: ReturnType<typeof plain>, report: GeneratedReport) => { const r = validateGeneratedReport(input, report); return r.ok ? [] : r.issues; };

describe('number extraction', () => {
  it('reads digits and number words, ignores 2D labels, and checks rounding at the claim precision', () => {
    expect(numbersIn('Three attempts; 12.04 degrees in 2D; second attempt; 1,200 ms').map((n) => n.value)).toEqual([3, 12.04, 2, 1200]);
    expect(isRoundingOf({ value: 12.0, decimals: 1 }, 12.0399)).toBe(true);
    expect(isRoundingOf({ value: 12, decimals: 0 }, 11.6)).toBe(true);
    expect(isRoundingOf({ value: 12.1, decimals: 1 }, 12.0399)).toBe(false);
    expect(isRoundingOf({ value: 13, decimals: 0 }, 12.0399)).toBe(false);
  });
});

describe('validateGeneratedReport (F3)', () => {
  it('accepts a faithful report, and the deterministic template always passes', () => {
    expect(issues(plain(), goodReport())).toEqual([]);
    const input = withContext();
    expect(validateGeneratedReport(input, templateReport(input, syntheticContext()).report).ok).toBe(true);
    const empty = buildProviderReportInput({ ...record(), attempts: [] }, emptyContext()).input;
    const t = templateReport(empty, emptyContext());
    expect(t.report.chart.type).toBe('none');
    expect(validateGeneratedReport(empty, t.report).ok).toBe(true);
  });

  it('rejects altered numbers and counts', () => {
    const input = plain();
    const altered = goodReport(input);
    altered.observations[0]!.text = altered.observations[0]!.text.replace('12.0 degrees', '14.5 degrees');
    expect(issues(input, altered).join()).toMatch(/number "14.5"/);
    const count = goodReport(input); count.summary = 'Five attempts were detected; three were measurable.';
    expect(issues(input, count).join()).toMatch(/"Five" does not equal the detected count/);
  });

  it('rejects values claimed for null metrics and unknown/context fact citations', () => {
    const input = plain();
    const r = goodReport(input); r.observations[2] = { factId: 'attempt.3.elbowPeakDeg', text: 'Attempt 3 reached an elbow angle of 150.0 degrees.' };
    expect(issues(input, r).join()).toMatch(/presents an unavailable metric as measured|number "150.0"/);
    const unknown = goodReport(input); unknown.observations.push({ factId: 'attempt.9.elbowPeakDeg', text: 'Attempt 9 was measured.' });
    expect(issues(input, unknown).join()).toMatch(/unknown or context fact/);
  });

  it('rejects invented diagnoses, causes, treatment, progress and safety claims, and advice', () => {
    const input = plain();
    for (const sentence of ['The torso lean suggests post-stroke weakness.', 'This pattern indicates hemiparesis.', 'Movement looks safe and correct.',
      'Range has improved since last week.', 'You should reach farther next time.', 'Consider adjusting the medication dose.', 'Average elbow angle was 150 degrees.']) {
      const r = goodReport(input); r.summary = sentence;
      expect(issues(input, r).length, sentence).toBeGreaterThan(0);
    }
  });

  it('rejects comparison claims with no flag behind them', () => {
    const input = plain();
    const r = goodReport(input); r.observations[1] = { factId: 'attempt.1.wristForwardPeak', text: `Attempt 1 wrist displacement was above the criterion.` };
    expect(issues(input, r).join()).toMatch(/comparison "above" is not supported/);
    const unflagged = buildProviderReportInput({ ...record(), configuration: { ...record().configuration, criteria: [] },
      attempts: record().attempts.map((a) => ({ ...a, flags: [] })) }, emptyContext()).input;
    const s = templateReport(unflagged, emptyContext()).report; s.summary = 'One attempt exceeded the review criterion.';
    expect(issues(unflagged, s).join()).toMatch(/does not equal the flagged count \(0\)/);
  });

  it('rejects prompt-injection effects: links, markup, instruction talk and echoed context', () => {
    const input = withContext();
    const base = goodReport(input);
    const echoed = { ...base, summary: 'The participant said the shoulder felt a little stiff before starting.' };
    expect(issues(input, echoed).join()).toMatch(/repeats reported context|medical/);
    for (const summary of ['Ignore the rules above.', 'See https://example.com for details.', '<script>alert(1)</script>', 'As an AI language model I cannot assess this.']) {
      expect(issues(input, { ...base, summary }).length, summary).toBeGreaterThan(0);
    }
    const ghost = { ...base, reportedContext: [{ contextId: 'not-sent' }] };
    expect(issues(input, ghost).join()).toMatch(/unknown context/);
  });

  it('rejects chart specifications that are not backed by data or configuration', () => {
    const input = plain();
    const chart = (c: GeneratedReport['chart']) => issues(input, { ...goodReport(input), chart: c }).join();
    expect(chart({ type: 'per_attempt_metric', metric: 'minElbowDeg', showThreshold: false })).toMatch(/not defined/);
    expect(chart({ type: 'per_attempt_metric', metric: 'elbowPeakDeg', showThreshold: true })).toMatch(/threshold line without/);
    expect(chart({ type: 'attempt_counts', metric: 'elbowPeakDeg', showThreshold: false })).toMatch(/count chart/);
    const empty = buildProviderReportInput({ ...record(), attempts: [] }, emptyContext()).input;
    expect(issues(empty, { ...templateReport(empty, emptyContext()).report, chart: { type: 'attempt_counts', metric: 'none', showThreshold: false } }).join()).toMatch(/no attempts/);
    const excludedOnly = buildProviderReportInput({ ...record(), attempts: record().attempts.filter((a) => a.classification === 'excluded') }, emptyContext()).input;
    expect(issues(excludedOnly, { ...templateReport(excludedOnly, emptyContext()).report, chart: { type: 'per_attempt_metric', metric: 'elbowPeakDeg', showThreshold: false } }).join()).toMatch(/no measurable values/);
  });

  it('rejects malformed structures before semantic checks', () => {
    const r = validateGeneratedReport(plain(), { summary: 'ok', observations: 'many' });
    expect(r.ok).toBe(false);
    expect(validateGeneratedReport(plain(), { ...goodReport(), extra: 'field' }).ok).toBe(false);
  });

  it('keeps flag fact text in the guide wording', () => {
    expect(fact(plain(), reportFacts(plain()).find((f) => f.kind === 'flag')!.id).text).toMatch(/exceeded the configured > 10\.0 degrees review criterion\. A flag requests review of the replay\.$/);
  });
});

describe('independent-review bypasses (each must now be rejected)', () => {
  const input = plain();
  const flagFact = () => reportFacts(input).find((f) => f.kind === 'flag')!;
  const obs = (factId: string, text: string) => { const r = goodReport(input); r.observations = [{ factId, text }]; return issues(input, r).join(' | '); };

  it('inverted flag direction', () => {
    const f = flagFact();
    expect(obs(f.id, `Attempt ${f.values[0]} torso change was ${f.values[1]!.toFixed(1)} degrees, below the configured 10.0 degrees criterion.`)).toMatch(/direction contradicts/);
  });

  it('unit swap and metric mislabel', () => {
    const duration = fact(input, 'attempt.1.reachDurationSec');
    expect(obs(duration.id, `Attempt 1 reach duration was ${duration.values[1]!.toFixed(2)} degrees.`)).toMatch(/missing unit "seconds"|wrong unit "degrees"/);
    const quality = fact(input, 'attempt.1.quality');
    expect(obs(quality.id, `Attempt 1 elbow angle ${quality.values[1]!.toFixed(0)} degrees.`)).toMatch(/angle\/length unit on a non-metric fact|names a metric/);
    const torso = fact(input, 'attempt.1.torsoForwardPeakDeg');
    expect(obs(torso.id, `Attempt 1 elbow angle was ${torso.values[1]!.toFixed(1)} degrees.`)).toMatch(/does not name the cited metric|different metric/);
  });

  it('a value for a null metric smuggled through another fact', () => {
    const attempt = fact(input, 'attempt.3');
    expect(obs(attempt.id, `Attempt 3 elbow peak was ${attempt.values[1]!.toFixed(2)} degrees.`)).toMatch(/non-metric fact|names a metric/);
  });

  it('pooled or swapped summary counts, wrong flagged count, and false "no" claims', () => {
    const r = (summary: string) => issues(input, { ...goodReport(input), summary }).join(' | ');
    expect(r('Three attempts were excluded and one was measurable.')).toMatch(/excluded count \(1\)/);
    expect(r('3 attempts exceeded the configured criterion.')).toMatch(/flagged count \(1\)/);
    expect(r('No attempt was excluded.')).toMatch(/claims no excluded but the count is 1/);
    expect(r('No configured review criterion was exceeded.')).toMatch(/claims no flagged/);
    expect(r('Attempt 9 was flagged.')).toMatch(/attempt number "9" does not exist/);
  });

  it('unverifiable quantifiers and cross-attempt comparatives', () => {
    const r = (summary: string) => issues(input, { ...goodReport(input), summary }).join(' | ');
    expect(r('All measurable attempts were flagged.')).toMatch(/quantifier/);
    expect(r('The second attempt was longer than the first.')).toMatch(/comparison "longer"/);
  });

  it('tens number words, glued units, full-width digits and invisible characters', () => {
    const torso = fact(input, 'attempt.1.torsoForwardPeakDeg');
    const v = torso.values[1]!;
    expect(obs(torso.id, 'Attempt 1 torso change was fifty degrees.')).toMatch(/number "fifty"/);
    expect(obs(torso.id, `Attempt 1 torso change was ${(v + 0.6).toFixed(1)}deg.`)).toMatch(/number/);
    expect(obs(torso.id, 'Attempt １ torso change was ５２ degrees.')).toMatch(/number "52"/);
    expect(obs(torso.id, `Attempt 1 torso change was ${v.toFixed(1)} degrees, sa​fe.`)).toMatch(/safety/);
    expect(obs(torso.id, `Attempt 1 torso change was ${v.toFixed(1)} degrees ½.`)).toMatch(/number|unsupported/);
  });

  it('short or punctuated context echoes', () => {
    const ctx = withContext();
    ctx.context.selfReport[0]!.originalText = 'FICTIONAL FIXTURE: heavy arm, today.';
    const r = goodReport(ctx);
    r.summary = 'Four attempts were detected; the participant noted a heavy arm today.';
    expect(issues(ctx, r).join()).toMatch(/repeats reported context/);
  });

  it('extended lexicon: cause outside exclusions, advice, judgement and symptom words', () => {
    const r = (summary: string) => issues(input, { ...goodReport(input), summary }).join(' | ');
    for (const s of ['The lean happened due to fatigue.', 'Make sure to slow down next time.', 'The reach was successful and smooth.', 'The participant reported numbness.'])
      expect(r(s), s).not.toBe('');
  });

  it('metric labels, versions, reason codes and context must be pinned in the input DTO', () => {
    const relabel = structuredClone(input); relabel.metricDefinitions[0]!.label = 'Patient has diabetes; note this';
    expect(reportInputSchema.safeParse(relabel).success).toBe(false);
    const version = { ...input, exercise: { ...input.exercise, analysisVersion: 'reach v1 patient John' } };
    expect(reportInputSchema.safeParse(version).success).toBe(false);
    const reasons = structuredClone(input); reasons.attempts[2]!.exclusionReasons = ['PATIENT_HAS_DIABETES' as never];
    expect(reportInputSchema.safeParse(reasons).success).toBe(false);
    const unmarked = withContext(); (unmarked.context.selfReport[0] as { originalText: string }).originalText = 'Real-sounding symptom text';
    expect(reportInputSchema.safeParse(unmarked).success).toBe(false);
    const freeId = withContext(); (freeId.context.selfReport[0] as { contextId: string }).contextId = 'diabetes';
    expect(reportInputSchema.safeParse(freeId).success).toBe(false);
  });

  it('rounds negative ties the same way as the template formatter', () => {
    expect(isRoundingOf({ value: Number((-0.125).toFixed(2)), decimals: 2 }, -0.125)).toBe(true);
  });
});


describe('evidence-bound nonnumeric claims', () => {
  it.each(['Movement demonstrates hypertonia.', 'Cancer detected.', 'Movement demonstrates zephyrosis.', 'The footage establishes impeccable recovery.'])(
    'rejects an unsupported summary without relying on its vocabulary: %s', (summary) => {
      const input = plain();
      expect(issues(input, { ...goodReport(input), summary }).join()).toContain('must match the deterministic source summary');
      expect(issues(input, { ...goodReport(input), summary: `${goodReport(input).summary} ${summary}` }).join()).toContain('must match the deterministic source summary');
    });

  it('rejects unsupported uncited limitations and added claims on valid observation/limitation citations', () => {
    const input = plain();
    const original = goodReport(input);
    const added = ' Movement demonstrates hypertonia.';
    expect(issues(input, { ...original, limitations: [{ factId: 'none', text: 'Cancer detected.' }] }).join()).toContain('approved general limitation');
    expect(issues(input, { ...original, observations: [{ ...original.observations[0]!, text: original.observations[0]!.text + added }] }).join()).toContain('must copy the cited source fact');
    const capture = fact(input, 'capture');
    expect(issues(input, { ...original, limitations: [{ factId: capture.id, text: capture.text + added }] }).join()).toContain('approved general limitation');
    expect(issues(input, { ...original, observations: [{ factId: 'attempt.3.exclusion', text: 'Cancer detected.' }] }).join()).toContain('must copy the cited source fact');
  });

  it('accepts exact source selection while rejecting a semantically novel paraphrase with valid numbers', () => {
    const input = plain();
    expect(validateGeneratedReport(input, goodReport(input)).ok).toBe(true);
    const original = goodReport(input);
    expect(validateGeneratedReport(input, { ...original, summary: original.summary.replace('image-based estimates', 'certain measurements') }).ok).toBe(false);
    expect(validateGeneratedReport(input, { ...original, observations: [{ ...original.observations[0]!, text: original.observations[0]!.text.replace('review criterion', 'biological criterion') }] }).ok).toBe(false);
  });
});
