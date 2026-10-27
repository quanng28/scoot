import { pipelineMetricsSchema } from '../../../src/contracts/report-pipeline.js';
import type { PipelineMetrics } from './types.js';

/** Strict allowlist before either local structured logging or an injected evaluation/test observer. */
export function emitPipelineMetrics(metrics: PipelineMetrics, observer?: (metrics: PipelineMetrics) => void): void {
  try {
    const event = pipelineMetricsSchema.parse(metrics);
    if (observer) observer(event);
    else process.stdout.write(`${JSON.stringify(event)}\n`);
  } catch { /* Observability cannot gate the local report. */ }
}

/** Instrument the direct path without changing its transport, validation or response envelope. */
export function directMetrics(metadata: Pick<PipelineMetrics, 'branch' | 'exerciseId' | 'promptVersion' | 'validatorVersion' | 'modelId' | 'inputDigest'>,
  live: boolean, observer?: (metrics: PipelineMetrics) => void) {
  const started = performance.now();
  const metrics: PipelineMetrics = { ...metadata, pipeline: 'direct', steps: [], attempts: live ? 1 : 0, repaired: false,
    outcome: 'accepted_first_pass', failureClass: null, durationMs: 0 };
  let generated = false, validated = false, validatedAt = started;
  return {
    generated(usage?: PipelineMetrics['usage']) {
      if (generated) return;
      generated = true; validatedAt = performance.now();
      metrics.steps.push({ step: 'generate', outcome: 'pass', durationMs: validatedAt - started, attempt: metrics.attempts, codes: [], ...(usage ? { usage } : {}) });
      if (usage) metrics.usage = usage;
    },
    finish(failure: PipelineMetrics['failureClass'] = null, codes: PipelineMetrics['steps'][number]['codes'] = [], usage?: PipelineMetrics['usage']) {
      const end = performance.now();
      if (!generated) metrics.steps.push({ step: 'generate', outcome: 'error', durationMs: end - started, attempt: metrics.attempts, codes: [], ...(usage ? { usage } : {}) });
      if (usage) metrics.usage = usage;
      if (generated && !validated) { validated = true; metrics.steps.push({ step: 'validate', outcome: failure ? 'reject' : 'pass', durationMs: end - validatedAt, attempt: metrics.attempts, codes }); }
      metrics.failureClass = failure;
      if (failure) {
        metrics.outcome = failure === 'CANCELLED' ? 'cancelled' : failure === 'VALIDATION' ? 'fallback_validation' : 'fallback_provider_error';
        metrics.steps.push({ step: 'fallback', outcome: 'pass', durationMs: 0, attempt: metrics.attempts, codes: [] });
      }
      metrics.durationMs = end - started;
      emitPipelineMetrics(metrics, observer);
    },
  };
}
