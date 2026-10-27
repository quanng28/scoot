import { FakeListChatModel } from '@langchain/core/utils/testing';
import { expect, it, vi } from 'vitest';
import { videoReportTestInput } from '../../../src/contracts/video-report.test-fixtures.js';
import { videoTemplateReport, validateVideoReport } from '../../../src/contracts/video-report.js';
import { goodReport, plain, fact, withContext } from '../../../src/report/report-adversarial.test-fixtures.js';
import { validateGeneratedReport } from '../../../src/report/report-validator.js';
import { validateQuickWithCodes } from '../../../src/report/report-diagnostics.js';
import { runReportPipeline } from './pipeline.js';
import { measuredSpec, quickSpec } from './specs.js';
import type { ModelCall, ReportSpec } from './types.js';

async function rejectTwice(spec: ReportSpec<unknown>, raw: unknown) {
  expect(spec.validate(raw).ok).toBe(false);
  const model = new FakeListChatModel({ responses: [JSON.stringify(raw), JSON.stringify(raw)], maxRetries: 0 });
  const call = vi.fn<ModelCall>(async (prompt, signal) => ({ ok: true, text: (await model.invoke(prompt, { signal, callbacks: [] })).text }));
  const result = await runReportPipeline(spec, { call, modelId: 'offline-template-mock', signal: new AbortController().signal });
  expect(result.metrics.outcome).toBe('fallback_validation'); expect(result.report).toEqual(spec.fallback()); expect(call).toHaveBeenCalledTimes(2);
}

it('runs the existing rich quick adversarial cases through both validation attempts unchanged', async () => {
  const input = videoReportTestInput, t = videoTemplateReport(input), spec = await quickSpec(input);
  const patches: object[] = [{ headline: 'Peak speed was **912 degrees per second**.' }, { rangeOfMotion: 'This pattern suggests a diagnosis of shoulder impingement.' },
    { speedAndControl: 'These movements will cause shoulder damage.' }, { trackingQuality: 'The patient felt pain during rep 1.' },
    { clinicianPoints: ['Prescribe 2 mg of medication.'] }, { riskAlerts: t.riskAlerts.slice(0, 1) }, { headline: '<b>2</b> warnings' }];
  for (const patch of patches) {
    const raw = { ...t, ...patch };
    expect(validateVideoReport(input, raw).ok).toBe(false); await rejectTwice(spec, raw);
  }
  expect(validateQuickWithCodes(input, { ...t, riskAlerts: [] })).toEqual({ ok: false, codes: ['EVENTS'] });
  expect(validateQuickWithCodes(input, { ...t, headline: '<b>2</b> warnings' })).toEqual({ ok: false, codes: ['FORMAT'] });
});

it('runs existing measured adversarial families through both attempts without loosening acceptance', async () => {
  const input = plain(), good = goodReport(input), spec = await measuredSpec(input);
  const torso = fact(input, 'attempt.1.torsoForwardPeakDeg'), duration = fact(input, 'attempt.1.reachDurationSec');
  const summaries = ['Three attempts were excluded and one was measurable.', '3 attempts exceeded the configured criterion.', 'No attempt was excluded.',
    'No configured review criterion was exceeded.', 'Attempt 9 was flagged.', 'All measurable attempts were flagged.', 'The second attempt was longer than the first.',
    'The lean happened due to fatigue.', 'Make sure to slow down next time.', 'The reach was successful and smooth.', 'The participant reported numbness.',
    'Movement demonstrates hypertonia.', 'Cancer detected.', 'Movement demonstrates zephyrosis.', 'The footage establishes impeccable recovery.'];
  const outputs: unknown[] = summaries.map((summary) => ({ ...good, summary }));
  for (const text of ['Attempt 1 torso change was fifty degrees.', 'Attempt 1 torso change was 12.6deg.', 'Attempt １ torso change was ５２ degrees.',
    'Attempt 1 torso change was 12.0 degrees, sa​fe.', 'Attempt 1 torso change was 12.0 degrees ½.', 'Attempt 1 elbow angle was 12.0 degrees.',
    'Attempt 1 torso change was 12.0 degrees, below the configured 10.0 degrees criterion.']) outputs.push({ ...good, observations: [{ factId: torso.id, text }] });
  outputs.push({ ...good, observations: [{ factId: duration.id, text: 'Attempt 1 reach duration was 1.50 degrees.' }] },
    { ...good, limitations: [{ factId: 'none', text: 'Cancer detected.' }] },
    { ...good, observations: [{ ...good.observations[0]!, text: good.observations[0]!.text + ' Movement demonstrates hypertonia.' }] },
    { ...good, chart: { type: 'per_attempt_metric', metric: 'minElbowDeg', showThreshold: false } });
  for (const raw of outputs) { expect(validateGeneratedReport(input, raw).ok).toBe(false); await rejectTwice(spec, raw); }
  const ctx = withContext(); ctx.context.selfReport[0]!.originalText = 'FICTIONAL FIXTURE: heavy arm, today.';
  await rejectTwice(await measuredSpec(ctx), { ...goodReport(ctx), summary: 'Four attempts were detected; the participant noted a heavy arm today.' });
});
