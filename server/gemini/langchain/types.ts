import type { ReportErrorCode } from '../../../src/contracts/provider-report.js';
import type { ValidationCode } from '../../../src/report/report-diagnostics.js';

export type PipelineName = 'direct' | 'langchain';
export type Branch = 'quick' | 'measured';
export type FinalOutcome = 'accepted_first_pass' | 'accepted_after_repair' | 'fallback_validation' | 'fallback_provider_error' | 'cancelled';
export type FailureClass = ReportErrorCode | 'MISSING_KEY' | 'VALIDATION';
export type TokenUsage = { input: number; output: number; total: number };
export type Step = { step: 'generate' | 'validate' | 'repair' | 'fallback'; outcome: 'pass' | 'reject' | 'error'; durationMs: number; attempt: 0 | 1 | 2;
  codes: ValidationCode[]; usage?: TokenUsage };
export type PipelineMetrics = {
  pipeline: PipelineName; branch: Branch; exerciseId: string; promptVersion: string; validatorVersion: string; modelId: string; inputDigest: string;
  steps: Step[]; attempts: 0 | 1 | 2; repaired: boolean; outcome: FinalOutcome; failureClass: FailureClass | null; durationMs: number;
  /** Omitted unless usage was reported for EVERY dispatched call. Never treat unknown as zero. */
  usage?: TokenUsage;
};
export type CallResult = { ok: true; text: string; usage?: TokenUsage } | { ok: false; code: FailureClass };
export type ModelCall = (prompt: string, signal: AbortSignal) => Promise<CallResult>;
export type ReportSpec<T> = {
  branch: Branch; exerciseId: string; promptVersion: string; validatorVersion: string; inputDigest: string; prompt: string; system: string;
  schema: object; blocked: FailureClass | null;
  validate: (raw: unknown) => { ok: true; report: T } | { ok: false; codes: ValidationCode[] };
  fallback: () => T;
};
export type PipelineResult<T> = { report: T; metrics: PipelineMetrics };
