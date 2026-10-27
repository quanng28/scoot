import { z } from 'zod';

/** Backward-compatible optional provenance; no open-ended metadata or payload properties. */
const usage = z.strictObject({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), total: z.number().int().nonnegative() });
export const pipelineMetricsSchema = z.strictObject({
  pipeline: z.enum(['direct', 'langchain']), branch: z.enum(['quick', 'measured']),
  exerciseId: z.enum(['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps']),
  promptVersion: z.string().min(1).max(40), validatorVersion: z.string().min(1).max(40), modelId: z.string().min(1).max(80), inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  steps: z.array(z.strictObject({ step: z.enum(['generate', 'validate', 'repair', 'fallback']), outcome: z.enum(['pass', 'reject', 'error']),
    durationMs: z.number().finite().nonnegative(), attempt: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    codes: z.array(z.enum(['JSON', 'SCHEMA', 'SUMMARY', 'OBSERVATION', 'LIMITATION', 'CONTEXT', 'CHART', 'NUMBER', 'FORMAT', 'RISK', 'EVENTS', 'EVIDENCE'])).max(12), usage: usage.optional() })).max(5),
  attempts: z.union([z.literal(0), z.literal(1), z.literal(2)]), repaired: z.boolean(),
  outcome: z.enum(['accepted_first_pass', 'accepted_after_repair', 'fallback_validation', 'fallback_provider_error', 'cancelled']),
  failureClass: z.enum(['METHOD_NOT_ALLOWED', 'ORIGIN_DENIED', 'ACCESS_DENIED', 'PROTECTION_UNCONFIGURED', 'PROVIDER_DISABLED', 'INVALID_INPUT',
    'CONTEXT_NOT_PERMITTED', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'BUDGET_EXHAUSTED', 'TIMEOUT', 'CANCELLED', 'PROVIDER_ERROR', 'REFUSED', 'MALFORMED_RESPONSE',
    'REJECTED_CONTENT', 'NETWORK_ERROR', 'STALE_RESPONSE', 'MISSING_KEY', 'VALIDATION', 'VALIDATOR_ERROR']).nullable(),
  durationMs: z.number().finite().nonnegative(), usage: usage.optional(),
});
