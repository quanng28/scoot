import type { ContextEntry, SessionContext } from '../contracts/session-context.js';
import { FICTIONAL_PREFIX, type ReportInput } from '../contracts/provider-report.js';

/**
 * Deployment/data-policy gate for optional context (PRD FR-21, checklist E3).
 *
 * Google's standard Gemini API terms restrict clinical-practice/medical-advice use, and unpaid services
 * may use content to improve products. A paid key or a checkbox does not resolve that. Until the actual
 * service agreement and intended use are reviewed, only fictional fixture context may leave the device.
 * Real entries always stay local and still appear in the deterministic local report.
 *
 * Changing this requires a new CONTEXT_POLICY_VERSION, a reviewed agreement reference, and a matching
 * change to the report input schema (which also rejects real context server-side).
 */
export const CONTEXT_POLICY_VERSION = 'context-transfer.v1';

export type ContextTransferPolicy = {
  /** Explicit per-request choice to include fixture context; off by default. */
  includeSyntheticContext: boolean;
};
export const DEFAULT_CONTEXT_POLICY: ContextTransferPolicy = { includeSyntheticContext: false };

export type WithheldReason = 'NOT_REQUESTED' | 'REAL_CONTEXT_STAYS_LOCAL' | 'NOT_MARKED_FICTIONAL' | 'SUSPECTED_INSTRUCTION';
export type ContextSelection = { selfReport: ReportInput['context']['selfReport']; clinician: ReportInput['context']['clinician']; withheld: { contextId: string; reason: WithheldReason }[] };

/** Text that reads like an instruction to a model, markup or a link is never forwarded (prompt-injection guard). */
const INSTRUCTION_PATTERNS = [/\bignore\b/i, /\bdisregard\b/i, /\boverride\b/i, /system\s*prompt/i, /\binstructions?\b/i, /\bprompt\b/i,
  /\byou are (now )?(an?|the)\b/i, /\b(assistant|chatbot|model|gemini|llm)\b/i, /\brespond\b/i, /\bjson\b/i, /\bschema\b/i,
  /<\/?[a-z!][^>]*>/i, /```/, /https?:\/\//i, /www\./i, /\{|\}/];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

function reason(entry: ContextEntry, policy: ContextTransferPolicy): WithheldReason | null {
  if (entry.dataClass === 'real') return 'REAL_CONTEXT_STAYS_LOCAL';
  if (!policy.includeSyntheticContext) return 'NOT_REQUESTED';
  const text = entry.kind === 'self_report' ? entry.originalText : entry.text;
  if (!text.startsWith(FICTIONAL_PREFIX)) return 'NOT_MARKED_FICTIONAL';
  if (looksLikeInstruction(text)) return 'SUSPECTED_INSTRUCTION';
  return null;
}

export function selectTransferableContext(context: SessionContext, policy: ContextTransferPolicy = DEFAULT_CONTEXT_POLICY): ContextSelection {
  const out: ContextSelection = { selfReport: [], clinician: [], withheld: [] };
  for (const entry of [...context.selfReport, ...context.clinician]) {
    const why = reason(entry, policy);
    if (why) { out.withheld.push({ contextId: entry.id, reason: why }); continue; }
    if (entry.kind === 'self_report') out.selfReport.push({ contextId: entry.id, dataClass: 'synthetic_fixture', originalText: entry.originalText, timing: entry.timing, source: entry.source, confirmation: entry.confirmation });
    else out.clinician.push({ contextId: entry.id, dataClass: 'synthetic_fixture', category: entry.category, text: entry.text, suppliedBy: entry.suppliedBy, verification: entry.verification });
  }
  return out;
}
