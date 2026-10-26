import { z } from 'zod';
import { exerciseIdSchema } from './session-report.js';

// One catalog is shared by local capture events, captions, speech queues and the server TTS allowlist.
import { CUE_CATALOG_VERSION, CUE_CATALOG, cueIdSchema, cueDefinition, type CueId } from './cue.js';
export { CUE_CATALOG_VERSION, CUE_CATALOG, type CueId } from './cue.js';
export const CUE_EVENT_VERSION = 'seated-cue-event.v2';
/** Maximum recording length; the final-five-second countdown counts down to it. Single source for recorder, controller and cues. */
export const RECORDING_LIMIT_MS = 30_000;
const phaseSchema = z.enum(['setup', 'ready', 'outward', 'endpoint', 'return', 'tracking', 'recording', 'stopped']);
function eventPhase(id: CueId): z.infer<typeof phaseSchema> {
  const cue = cueDefinition(id);
  if (cue.category === 'stop') return 'stopped';
  if (cue.category === 'setup') return 'setup';
  if (cue.category === 'readiness' || id.startsWith('phase.rest')) return 'ready';
  if (cue.category === 'tracking') return 'tracking';
  if (id === 'phase.target') return 'endpoint';
  return 'recording';
}
const bindingSchema = z.strictObject({ sessionId: z.string().min(1), configurationId: z.string().min(1), exerciseId: exerciseIdSchema });
export type CueBinding = z.infer<typeof bindingSchema>;
export const cueEventSchema = bindingSchema.extend({
  schemaVersion: z.literal(CUE_EVENT_VERSION), catalogVersion: z.literal(CUE_CATALOG_VERSION),
  source: z.literal('deterministic_capture_event'), cueId: cueIdSchema, phase: phaseSchema,
  timestampMs: z.number().finite().nonnegative(), expiresAtMs: z.number().finite().nonnegative(),
  /** Stable within this session/configuration for queue deduplication; never a provider-generated ID. */
  deduplicationKey: z.string().min(1),
}).superRefine((event, ctx) => {
  const entry = CUE_CATALOG[event.cueId];
  if (event.phase !== eventPhase(event.cueId) || event.expiresAtMs !== event.timestampMs + entry.expiryMs)
    ctx.addIssue({ code: 'custom', message: 'Cue phase/expiry disagrees with fixed catalog' });
});
export type CueEvent = z.infer<typeof cueEventSchema>;

/** No network or audio. Call from confirmed deterministic capture decisions, using recording-relative time. */
export function createCueEvent(binding: CueBinding, cueId: CueId, timestampMs: number, occurrence: string): CueEvent {
  const parsed = bindingSchema.parse(binding);
  const entry = CUE_CATALOG[cueId];
  return cueEventSchema.parse({ ...parsed, schemaVersion: CUE_EVENT_VERSION, catalogVersion: CUE_CATALOG_VERSION,
    source: 'deterministic_capture_event', cueId, phase: eventPhase(cueId), timestampMs, expiresAtMs: timestampMs + entry.expiryMs,
    deduplicationKey: `${parsed.sessionId}:${parsed.configurationId}:${cueId}:${occurrence}` });
}

const countdownIds = { 1: 'countdown.1', 2: 'countdown.2', 3: 'countdown.3', 4: 'countdown.4', 5: 'countdown.5' } as const;
const countdownSchema = z.array(z.strictObject({ remainingSeconds: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), timestampMs: z.number().finite().min(RECORDING_LIMIT_MS - 5000).max(RECORDING_LIMIT_MS) })).max(5);
/** Revalidates the controller's emitted countdown events, preserving observed times and skipped ticks. */
export function countdownCueEvents(binding: CueBinding, input: unknown): CueEvent[] {
  const ticks = countdownSchema.parse(input);
  let previousSecond = 6, previousTime = -1;
  return ticks.map((tick) => {
    if (tick.remainingSeconds >= previousSecond || tick.timestampMs <= previousTime || tick.remainingSeconds !== Math.ceil((RECORDING_LIMIT_MS - tick.timestampMs) / 1000))
      throw new Error('Countdown events must be unique, ordered and match the recorder clock');
    previousSecond = tick.remainingSeconds; previousTime = tick.timestampMs;
    return createCueEvent(binding, countdownIds[tick.remainingSeconds], tick.timestampMs, String(tick.remainingSeconds));
  });
}
