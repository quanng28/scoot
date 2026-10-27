import { emptyContext } from '../contracts/session-context.js';
import type { GeneratedReport } from '../contracts/provider-report.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { buildProviderReportInput, reportFacts } from './report-input.js';
import { syntheticContext } from './synthetic-context.js';
import { templateReport } from './template-report.js';

export const record = () => syntheticReachSession('validator-session', new Date('2026-10-25T12:00:00Z'));
export const withContext = () => buildProviderReportInput(record(), syntheticContext(), { includeSyntheticContext: true }).input;
export const plain = () => buildProviderReportInput(record(), emptyContext()).input;
export const fact = (input: ReturnType<typeof plain>, id: string) => reportFacts(input).find((f) => f.id === id)!;

/** Evidence-bound model output selects exact source facts; individual tests corrupt one part. */
export function goodReport(input = plain()): GeneratedReport {
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
