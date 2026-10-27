import { GEMINI_REPORT_JSON_SCHEMA, REPORT_INPUT_VERSION, REPORT_REQUEST_BYTES, reportRequestSchema, type ReportErrorCode, type ReportInput, type ReportResponse } from '../../src/contracts/provider-report.js';
import { looksLikeInstruction } from '../../src/report/context-policy.js';
import { canonicalDigest, reportInputDigest } from '../../src/report/report-input.js';
import { buildVideoReportPrompt, GEMINI_CLINICIAN_REPORT_JSON_SCHEMA, validateVideoReport, VIDEO_REPORT_INPUT_VERSION, VIDEO_REPORT_PROMPT_VERSION, VIDEO_REPORT_SYSTEM_INSTRUCTION,
  VIDEO_REPORT_VALIDATOR_VERSION, videoReportRequestSchema, videoTemplateReport, type VideoReportInput, type VideoReportResponse } from '../../src/contracts/video-report.js';
import { buildReportPrompt, REPORT_PROMPT_VERSION, REPORT_SYSTEM_INSTRUCTION } from '../../src/report/report-prompt.js';
import { validateGeneratedReport, VALIDATOR_VERSION } from '../../src/report/report-validator.js';
import { templateReport } from '../../src/report/template-report.js';
import { emptyContext } from '../../src/contracts/session-context.js';
import { loadGeminiConfig, type GeminiConfig } from './config.js';
import { AccessGuard, checkAccess, jsonReply, preflight, readBoundedJson, RequestFailure } from './http.js';
import { InstanceBudget } from './limits.js';
import { generateContent } from './provider.js';
import { measuredSpec, quickSpec } from './langchain/specs.js';
import { restModelCall } from './langchain/model.js';
import { directMetrics, emitPipelineMetrics } from './langchain/metrics.js';
import type { FailureClass, PipelineMetrics, ReportSpec } from './langchain/types.js';

/**
 * POST /api/gemini-report (checklist F2/F3). Takes the allowlisted report DTO only, re-applies the
 * context gate, sends deterministic facts plus quoted context to the pinned text model with a JSON
 * schema, then validates the result semantically before returning it. Invalid content is rejected with
 * issue codes; the client shows its deterministic template instead. Bodies and keys are never logged.
 */
export const REPORT_TIMEOUT_MS = 20_000;
const MAX_PROVIDER_BYTES = 200_000;
const MAX_OUTPUT_TOKENS = 2048;

const messages: Partial<Record<ReportErrorCode, string>> = {
  METHOD_NOT_ALLOWED: 'Use POST.', ORIGIN_DENIED: 'This origin may not request explanations.', ACCESS_DENIED: 'Demo access code required.',
  PROTECTION_UNCONFIGURED: 'Explanations are not configured. The local report remains available.', PROVIDER_DISABLED: 'Generated explanations are disabled. The local report remains available.',
  INVALID_INPUT: 'Report input was rejected.', CONTEXT_NOT_PERMITTED: 'Only fictional fixture context may be sent; real context stays on this device.',
  REQUEST_TOO_LARGE: 'Report input is too large.', RATE_LIMITED: 'Explanation limit reached. No automatic retry is scheduled.',
  BUDGET_EXHAUSTED: 'Explanation budget exhausted.', TIMEOUT: 'The explanation timed out.', CANCELLED: 'Cancelled.', PROVIDER_ERROR: 'The explanation service failed.',
  REFUSED: 'The model declined to produce an explanation.', MALFORMED_RESPONSE: 'The model returned an unreadable explanation.',
  REJECTED_CONTENT: 'The generated explanation did not match the measured facts and was discarded.',
};
const status: Partial<Record<ReportErrorCode, number>> = { METHOD_NOT_ALLOWED: 405, ORIGIN_DENIED: 403, ACCESS_DENIED: 401, PROTECTION_UNCONFIGURED: 503, PROVIDER_DISABLED: 503,
  INVALID_INPUT: 400, CONTEXT_NOT_PERMITTED: 403, REQUEST_TOO_LARGE: 413, RATE_LIMITED: 429, BUDGET_EXHAUSTED: 429, TIMEOUT: 504, CANCELLED: 499, REJECTED_CONTENT: 422 };
const fail = (code: ReportErrorCode, origin: string | null = null, issues?: string[]) =>
  jsonReply({ ok: false, error: { code, message: messages[code] ?? 'Explanation unavailable.' }, ...(issues ? { issues } : {}) } satisfies ReportResponse, status[code] ?? 502, origin);

export type ReportDeps = { env?: Record<string, string | undefined>; config?: GeminiConfig; fetch?: typeof fetch; budget?: InstanceBudget; guard?: AccessGuard; now?: () => number; clock?: () => Date; timeoutMs?: number; onMetrics?: (metrics: PipelineMetrics) => void };

/** True when the body tries to send context that is not a fictional fixture (FR-21). */
function carriesRealContext(body: unknown): boolean {
  const ctx = (body as { input?: { context?: { selfReport?: unknown; clinician?: unknown } } } | null)?.input?.context;
  const entries = [ctx?.selfReport, ctx?.clinician].flatMap((list) => Array.isArray(list) ? list : []);
  return entries.some((e) => typeof e !== 'object' || e === null || (e as { dataClass?: unknown }).dataClass !== 'synthetic_fixture');
}

export function createReportEndpoint(deps: ReportDeps = {}): (request: Request) => Promise<Response> {
  let budget = deps.budget ?? null;
  const guard = deps.guard ?? new AccessGuard();
  return async (request) => {
    const loaded = deps.config ? { ok: true as const, config: deps.config } : loadGeminiConfig(deps.env ?? process.env);
    if (!loaded.ok) return fail(loaded.problem);
    const config = loaded.config;
    if (request.method === 'OPTIONS') return preflight(request, config);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED');
    const access = checkAccess(request, config, guard, config.publicReports);
    if (!access.ok) return fail(access.code);
    const origin = access.origin;
    let body: unknown;
    try { body = await readBoundedJson(request, REPORT_REQUEST_BYTES); } catch (error) { return fail(error instanceof RequestFailure ? error.code : 'INVALID_INPUT', origin); }
    if (body !== null && typeof body === 'object' && 'videoInput' in body) {
      // Video-only recordings (no measurement setup) carry only the allowlisted pace summary.
      const parsed = videoReportRequestSchema.safeParse(body);
      if (!parsed.success) return fail('INVALID_INPUT', origin);
      budget ??= new InstanceBudget(config.limits.maxPerInstance, deps.now);
      const rejected = budget.reserve('report', config.limits.reportPerHour);
      if (rejected) return fail(rejected, origin);
      const requestBudget = budget;
      if ((deps.env ?? process.env).SCOOT_LLM_PIPELINE === 'langchain') return chainedReport(await quickSpec(parsed.data.videoInput), config, request.signal, origin, deps, () => requestBudget.reserve('report', config.limits.reportPerHour));
      return videoReport(parsed.data.videoInput, config, request.signal, origin, deps);
    }
    if (carriesRealContext(body)) return fail('CONTEXT_NOT_PERMITTED', origin);
    const parsed = reportRequestSchema.safeParse(body);
    if (!parsed.success) return fail('INVALID_INPUT', origin);
    const input: ReportInput = parsed.data.input;
    if ([...input.context.selfReport.map((s) => s.originalText), ...input.context.clinician.map((c) => c.text)].some(looksLikeInstruction)) return fail('CONTEXT_NOT_PERMITTED', origin);

    budget ??= new InstanceBudget(config.limits.maxPerInstance, deps.now);
    const rejected = budget.reserve('report', config.limits.reportPerHour);
    if (rejected) return fail(rejected, origin);

    const requestBudget = budget;
    if ((deps.env ?? process.env).SCOOT_LLM_PIPELINE === 'langchain') return chainedReport(await measuredSpec(input), config, request.signal, origin, deps, () => requestBudget.reserve('report', config.limits.reportPerHour));
    const inputDigest = await reportInputDigest(input);
    const observe = directMetrics({ branch: 'measured', exerciseId: input.exercise.id, promptVersion: REPORT_PROMPT_VERSION, validatorVersion: VALIDATOR_VERSION, modelId: config.mode === 'live' ? config.textModel : 'offline-template-mock', inputDigest }, config.mode === 'live', deps.onMetrics);
    let raw: unknown;
    if (config.mode === 'mock') raw = templateReport(input, emptyContext()).report; // labelled mock: deterministic, never real-provider evidence
    else {
      const result = await generateContent({ model: config.textModel, apiKey: config.apiKey!, signal: request.signal, timeoutMs: deps.timeoutMs ?? REPORT_TIMEOUT_MS, maxResponseBytes: MAX_PROVIDER_BYTES,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        body: { system_instruction: { parts: [{ text: REPORT_SYSTEM_INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: buildReportPrompt(input) }] }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'low' },
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: GEMINI_REPORT_JSON_SCHEMA } } } } });
      if (!result.ok) { observe.finish(result.code, [], result.usage); return fail(result.code, origin); }
      observe.generated(result.usage);
      try { raw = JSON.parse(result.parts.map((p) => p.text ?? '').join('')); } catch { observe.finish('MALFORMED_RESPONSE', ['JSON']); return fail('MALFORMED_RESPONSE', origin); }
    }
    observe.generated();
    const checked = validateGeneratedReport(input, raw);
    if (!checked.ok) { observe.finish('VALIDATION', ['EVIDENCE']); return fail('REJECTED_CONTENT', origin, checked.issues); }
    observe.finish();
    return jsonReply({ ok: true, binding: { inputSchemaVersion: REPORT_INPUT_VERSION, inputDigest },
      provenance: { source: config.mode === 'live' ? 'gemini' : 'mock_provider', model: config.mode === 'live' ? config.textModel : 'offline-template-mock',
        promptVersion: REPORT_PROMPT_VERSION, validatorVersion: VALIDATOR_VERSION, generatedAt: (deps.clock?.() ?? new Date()).toISOString() },
      report: checked.report } satisfies ReportResponse, 200, origin);
  };
}

async function videoReport(input: VideoReportInput, config: GeminiConfig, signal: AbortSignal, origin: string | null, deps: ReportDeps): Promise<Response> {
  const inputDigest = await canonicalDigest(input);
  const observe = directMetrics({ branch: 'quick', exerciseId: input.exercise.id, promptVersion: VIDEO_REPORT_PROMPT_VERSION, validatorVersion: VIDEO_REPORT_VALIDATOR_VERSION, modelId: config.mode === 'live' ? config.textModel : 'offline-template-mock', inputDigest }, config.mode === 'live', deps.onMetrics);
  let raw: unknown;
  if (config.mode === 'mock') raw = videoTemplateReport(input);
  else {
    const result = await generateContent({ model: config.textModel, apiKey: config.apiKey!, signal, timeoutMs: deps.timeoutMs ?? REPORT_TIMEOUT_MS, maxResponseBytes: MAX_PROVIDER_BYTES,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      body: { system_instruction: { parts: [{ text: VIDEO_REPORT_SYSTEM_INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: buildVideoReportPrompt(input) }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'low' },
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: GEMINI_CLINICIAN_REPORT_JSON_SCHEMA } } } } });
    if (!result.ok) { observe.finish(result.code, [], result.usage); return fail(result.code, origin); }
    observe.generated(result.usage);
    try { raw = JSON.parse(result.parts.map((p) => p.text ?? '').join('')); } catch { observe.finish('MALFORMED_RESPONSE', ['JSON']); return fail('MALFORMED_RESPONSE', origin); }
  }
  observe.generated();
  const checked = validateVideoReport(input, raw);
  if (!checked.ok) { observe.finish('VALIDATION', ['EVIDENCE']); return fail('REJECTED_CONTENT', origin, checked.issues); }
  observe.finish();
  return jsonReply({ ok: true, binding: { inputSchemaVersion: VIDEO_REPORT_INPUT_VERSION, inputDigest },
    provenance: { source: config.mode === 'live' ? 'gemini' : 'mock_provider', model: config.mode === 'live' ? config.textModel : 'offline-template-mock',
      promptVersion: VIDEO_REPORT_PROMPT_VERSION, validatorVersion: VIDEO_REPORT_VALIDATOR_VERSION, generatedAt: (deps.clock?.() ?? new Date()).toISOString() },
    report: checked.report } satisfies VideoReportResponse, 200, origin);
}

/** Failure keeps the existing error envelope: the browser retains its already-visible local report. */
async function chainedReport<T>(spec: ReportSpec<T>, config: GeminiConfig, signal: AbortSignal, origin: string | null, deps: ReportDeps, reserveRepair: () => FailureClass | null): Promise<Response> {
  const { runReportPipeline } = await import('./langchain/pipeline.js');
  const result = await runReportPipeline(spec, { modelId: config.mode === 'mock' ? 'offline-template-mock' : config.textModel, signal,
    timeoutMs: deps.timeoutMs ?? REPORT_TIMEOUT_MS, reserveRepair,
    call: config.mode === 'mock' ? async () => ({ ok: true, text: JSON.stringify(spec.fallback()) }) : restModelCall(spec, config, deps.fetch),
    onMetrics: (metrics) => emitPipelineMetrics(metrics, deps.onMetrics) });
  switch (result.metrics.outcome) {
    case 'accepted_first_pass':
    case 'accepted_after_repair':
      return jsonReply({ ok: true, binding: { inputSchemaVersion: spec.branch === 'quick' ? VIDEO_REPORT_INPUT_VERSION : REPORT_INPUT_VERSION, inputDigest: spec.inputDigest },
        provenance: { source: config.mode === 'live' ? 'gemini' : 'mock_provider', model: config.mode === 'live' ? config.textModel : 'offline-template-mock',
          promptVersion: spec.promptVersion, validatorVersion: spec.validatorVersion, generatedAt: (deps.clock?.() ?? new Date()).toISOString(), pipeline: result.metrics }, report: result.report }, 200, origin);
    case 'cancelled': return fail('CANCELLED', origin);
    case 'fallback_validation': return fail('REJECTED_CONTENT', origin, [...new Set(result.metrics.steps.flatMap((s) => s.codes))]);
    case 'fallback_provider_error': {
      const code = result.metrics.failureClass;
      return fail(code === 'MISSING_KEY' ? 'PROVIDER_DISABLED' : code === 'VALIDATION' || code === 'VALIDATOR_ERROR' || code === null ? 'PROVIDER_ERROR' : code, origin);
    }
  }
}
