import { GEMINI_REPORT_JSON_SCHEMA, REPORT_REQUEST_BYTES, reportInputSchema, type ReportInput } from '../../../src/contracts/provider-report.js';
import { buildVideoReportPrompt, GEMINI_CLINICIAN_REPORT_JSON_SCHEMA, VIDEO_REPORT_PROMPT_VERSION, VIDEO_REPORT_SYSTEM_INSTRUCTION,
  VIDEO_REPORT_VALIDATOR_VERSION, videoReportInputSchema, videoTemplateReport, type VideoReportInput } from '../../../src/contracts/video-report.js';
import { emptyContext } from '../../../src/contracts/session-context.js';
import { looksLikeInstruction } from '../../../src/report/context-policy.js';
import { canonicalDigest } from '../../../src/report/report-input.js';
import { validateMeasuredWithCodes, validateQuickWithCodes } from '../../../src/report/report-diagnostics.js';
import { buildReportPrompt, REPORT_PROMPT_VERSION, REPORT_SYSTEM_INSTRUCTION } from '../../../src/report/report-prompt.js';
import { VALIDATOR_VERSION } from '../../../src/report/report-validator.js';
import { templateReport } from '../../../src/report/template-report.js';
import type { FailureClass } from './types.js';

const tooLarge = (body: unknown) => new TextEncoder().encode(JSON.stringify(body)).byteLength > REPORT_REQUEST_BYTES;

export async function measuredSpec(input: ReportInput) {
  const valid = reportInputSchema.safeParse(input).success;
  const blocked: FailureClass | null = !valid ? 'INVALID_INPUT' : tooLarge({ input }) ? 'REQUEST_TOO_LARGE'
    : [...input.context.selfReport.map((s) => s.originalText), ...input.context.clinician.map((c) => c.text)].some(looksLikeInstruction) ? 'CONTEXT_NOT_PERMITTED' : null;
  return { branch: 'measured' as const, exerciseId: input.exercise.id, promptVersion: REPORT_PROMPT_VERSION, validatorVersion: VALIDATOR_VERSION,
    inputDigest: await canonicalDigest(input), prompt: blocked ? '' : buildReportPrompt(input), system: REPORT_SYSTEM_INSTRUCTION, schema: GEMINI_REPORT_JSON_SCHEMA, blocked,
    validate: (raw: unknown) => validateMeasuredWithCodes(input, raw), fallback: () => templateReport(input, emptyContext()).report };
}

export async function quickSpec(input: VideoReportInput) {
  const blocked: FailureClass | null = !videoReportInputSchema.safeParse(input).success ? 'INVALID_INPUT' : tooLarge({ videoInput: input }) ? 'REQUEST_TOO_LARGE' : null;
  return { branch: 'quick' as const, exerciseId: input.exercise.id, promptVersion: VIDEO_REPORT_PROMPT_VERSION, validatorVersion: VIDEO_REPORT_VALIDATOR_VERSION,
    inputDigest: await canonicalDigest(input), prompt: blocked ? '' : buildVideoReportPrompt(input), system: VIDEO_REPORT_SYSTEM_INSTRUCTION, schema: GEMINI_CLINICIAN_REPORT_JSON_SCHEMA, blocked,
    validate: (raw: unknown) => validateQuickWithCodes(input, raw), fallback: () => videoTemplateReport(input) };
}
