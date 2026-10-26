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

export type ReportDeps = { env?: Record<string, string | undefined>; config?: GeminiConfig; fetch?: typeof fetch; budget?: InstanceBudget; guard?: AccessGuard; now?: () => number; clock?: () => Date; timeoutMs?: number };

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
    const access = checkAccess(request, config, guard);
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

    const inputDigest = await reportInputDigest(input);
    let raw: unknown;
    if (config.mode === 'mock') raw = templateReport(input, emptyContext()).report; // labelled mock: deterministic, never real-provider evidence
    else {
      const result = await generateContent({ model: config.textModel, apiKey: config.apiKey!, signal: request.signal, timeoutMs: deps.timeoutMs ?? REPORT_TIMEOUT_MS, maxResponseBytes: MAX_PROVIDER_BYTES,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        body: { system_instruction: { parts: [{ text: REPORT_SYSTEM_INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: buildReportPrompt(input) }] }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'low' },
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: GEMINI_REPORT_JSON_SCHEMA } } } } });
      if (!result.ok) return fail(result.code, origin);
      try { raw = JSON.parse(result.parts.map((p) => p.text ?? '').join('')); } catch { return fail('MALFORMED_RESPONSE', origin); }
    }
    const checked = validateGeneratedReport(input, raw);
    if (!checked.ok) return fail('REJECTED_CONTENT', origin, checked.issues);
    return jsonReply({ ok: true, binding: { inputSchemaVersion: REPORT_INPUT_VERSION, inputDigest },
      provenance: { source: config.mode === 'live' ? 'gemini' : 'mock_provider', model: config.mode === 'live' ? config.textModel : 'offline-template-mock',
        promptVersion: REPORT_PROMPT_VERSION, validatorVersion: VALIDATOR_VERSION, generatedAt: (deps.clock?.() ?? new Date()).toISOString() },
      report: checked.report } satisfies ReportResponse, 200, origin);
  };
}

async function videoReport(input: VideoReportInput, config: GeminiConfig, signal: AbortSignal, origin: string | null, deps: ReportDeps): Promise<Response> {
  const inputDigest = await canonicalDigest(input);
  let raw: unknown;
  if (config.mode === 'mock') raw = videoTemplateReport(input);
  else {
    const result = await generateContent({ model: config.textModel, apiKey: config.apiKey!, signal, timeoutMs: deps.timeoutMs ?? REPORT_TIMEOUT_MS, maxResponseBytes: MAX_PROVIDER_BYTES,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      body: { system_instruction: { parts: [{ text: VIDEO_REPORT_SYSTEM_INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: buildVideoReportPrompt(input) }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'low' },
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: GEMINI_CLINICIAN_REPORT_JSON_SCHEMA } } } } });
    if (!result.ok) return fail(result.code, origin);
    try { raw = JSON.parse(result.parts.map((p) => p.text ?? '').join('')); } catch { return fail('MALFORMED_RESPONSE', origin); }
  }
  const checked = validateVideoReport(input, raw);
  if (!checked.ok) return fail('REJECTED_CONTENT', origin, checked.issues);
  return jsonReply({ ok: true, binding: { inputSchemaVersion: VIDEO_REPORT_INPUT_VERSION, inputDigest },
    provenance: { source: config.mode === 'live' ? 'gemini' : 'mock_provider', model: config.mode === 'live' ? config.textModel : 'offline-template-mock',
      promptVersion: VIDEO_REPORT_PROMPT_VERSION, validatorVersion: VIDEO_REPORT_VALIDATOR_VERSION, generatedAt: (deps.clock?.() ?? new Date()).toISOString() },
    report: checked.report } satisfies VideoReportResponse, 200, origin);
}
