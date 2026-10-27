import { describe, expect, it } from 'vitest';
import { emptyContext } from '../contracts/session-context.js';
import { buildVideoReportInput, validateVideoReport, videoTemplateReport } from '../contracts/video-report.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { buildProviderReportInput } from './report-input.js';
import { validateGeneratedReport } from './report-validator.js';
import { templateReport } from './template-report.js';
import { VALIDATION_MESSAGES, validateMeasuredWithCodes, validateQuickWithCodes } from './report-diagnostics.js';

const measured = buildProviderReportInput(syntheticReachSession('diagnostics'), emptyContext()).input;
const quick = buildVideoReportInput({ exerciseId: 'seated_forward_reach', side: 'left', stopReason: 'SYNTHETIC_FIXTURE', recordingDurationMs: null, hasVideo: false, pace: null });

describe('payload-free diagnostic adapters', () => {
  it('preserves schema and semantic acceptance for both branches', () => {
    const m = templateReport(measured, emptyContext()).report, q = videoTemplateReport(quick);
    const corpus: unknown[] = [null, {}, [], 'secret-context', m, q, { ...m, summary: '999 measurable repetitions; secret-context' },
      { ...m, chart: { type: 'per_attempt_metric', metric: 'none', showThreshold: true } },
      { ...q, headline: '9999 degrees; secret-context' }, { ...q, headline: 'This will cause an injury.' }, { ...m, extra: 'secret-context' }];
    for (const raw of corpus) {
      expect(validateMeasuredWithCodes(measured, raw).ok).toBe(validateGeneratedReport(measured, raw).ok);
      expect(validateQuickWithCodes(quick, raw).ok).toBe(validateVideoReport(quick, raw).ok);
    }
  });
  it('exposes only fixed codes and fixed repair guidance', () => {
    const result = validateMeasuredWithCodes(measured, { ...templateReport(measured, emptyContext()).report, summary: 'PRIVATE_SENTINEL 999' });
    expect(result).toEqual({ ok: false, codes: ['NUMBER', 'SUMMARY'] });
    expect(JSON.stringify({ result, messages: VALIDATION_MESSAGES })).not.toContain('PRIVATE_SENTINEL');
    expect(validateQuickWithCodes(quick, {})).toEqual({ ok: false, codes: ['SCHEMA'] });
  });
});
