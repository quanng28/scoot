import { z } from 'zod';

/**
 * Approved spoken-cue catalog (PRD FR-12, checklist D1). Every sentence the app may speak is listed here
 * verbatim. TTS renders only these strings, selected by ID; nothing generated, no clinical advice, no
 * "reach farther", no safety/correctness claims. Changing any text requires a new CUE_CATALOG_VERSION so
 * cached audio and saved evidence stay attributable.
 */
export const CUE_CATALOG_VERSION = 'seated-cues.v2';

/** 3 stop/discomfort · 2 tracking loss/countdown · 1 setup/phase/readiness · 0 informational. */
export type CuePriority = 0 | 1 | 2 | 3;
/** Capture phases from CaptureController in which a cue may still be spoken. */
export type CuePhase = 'previewing' | 'recording' | 'finalizing' | 'closed';
export type CueDefinition = {
  id: CueId; text: string; category: 'setup' | 'readiness' | 'phase' | 'tracking' | 'countdown' | 'stop';
  priority: CuePriority;
  /** The same cue is not repeated within this window (rate limit for repeated warnings). */
  cooldownMs: number;
  /** A queued cue older than this is dropped instead of spoken late. */
  expiryMs: number;
  allowedPhases: readonly CuePhase[];
  /** Phase cues stay valid only while the analyzer is still in one of these states. */
  requiresAnalyzerState?: readonly string[];
};

const SETUP = ['previewing'] as const, RECORDING = ['recording'] as const;
// Stop is spoken from the Stop handler itself, possibly before the snapshot leaves 'recording'.
const ENDED = ['recording', 'finalizing', 'closed'] as const;

export const CUE_CATALOG = {
  'setup.reference': { text: 'Tap two points on a fixed object.', category: 'setup', priority: 1, cooldownMs: 8000, expiryMs: 5000, allowedPhases: SETUP },
  'setup.hold_rest': { text: 'Hold your starting position.', category: 'setup', priority: 1, cooldownMs: 8000, expiryMs: 5000, allowedPhases: SETUP },
  'setup.target': { text: 'Tap the reach target on the screen.', category: 'setup', priority: 1, cooldownMs: 8000, expiryMs: 5000, allowedPhases: SETUP },
  'setup.confirm': { text: 'Supervisor, please confirm the setup.', category: 'setup', priority: 1, cooldownMs: 8000, expiryMs: 5000, allowedPhases: SETUP },
  'ready.record': { text: 'Tracking is ready. You can press Record.', category: 'readiness', priority: 1, cooldownMs: 10000, expiryMs: 3000, allowedPhases: SETUP },
  'recording.started': { text: 'Recording. Hold your starting position.', category: 'phase', priority: 1, cooldownMs: 5000, expiryMs: 3000, allowedPhases: RECORDING },
  'phase.rest': { text: 'Starting position found. Reach toward the target when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'phase.rest_elbow': { text: 'Starting position found. Bend your elbow when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'phase.rest_arm_raise': { text: 'Starting position found. Raise your arm when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'phase.rest_knee': { text: 'Starting position found. Extend your knee when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'phase.rest_leg_lift': { text: 'Starting position found. Lift your leg when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'phase.rest_ankle': { text: 'Starting position found. Move your foot in the confirmed direction when ready.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['REST'] },
  'setup.ankle_direction': { text: 'Supervisor, confirm the foot direction after a small labelled movement.', category: 'setup', priority: 1, cooldownMs: 8000, expiryMs: 5000, allowedPhases: SETUP },
  'phase.target': { text: 'Return to your starting position.', category: 'phase', priority: 1, cooldownMs: 3000, expiryMs: 1500, allowedPhases: RECORDING, requiresAnalyzerState: ['TARGET', 'BEND_ENDPOINT', 'RAISE_ENDPOINT', 'EXTENSION_ENDPOINT', 'LIFT_ENDPOINT', 'PUMP_ENDPOINT'] },
  // Calibration-free pace monitor (src/analysis/pace-monitor.ts). Spoken in video-only and measured recordings alike.
  'pace.slow_down': { text: 'Please slow down. Move gently and with control.', category: 'phase', priority: 2, cooldownMs: 2500, expiryMs: 2000, allowedPhases: RECORDING },
  'tracking.shoulder': { text: 'Your shoulder is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.elbow': { text: 'Your elbow is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.wrist': { text: 'Your wrist is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.hip': { text: 'Your hip is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.knee': { text: 'Your knee is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.ankle': { text: 'Your ankle is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.heel': { text: 'Your heel is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.footIndex': { text: 'The front of your foot is out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.multiple': { text: 'Required joints are out of view. Pause.', category: 'tracking', priority: 2, cooldownMs: 5000, expiryMs: 2000, allowedPhases: [...SETUP, ...RECORDING] },
  'tracking.restored': { text: 'Tracking restored.', category: 'tracking', priority: 0, cooldownMs: 5000, expiryMs: 1500, allowedPhases: [...SETUP, ...RECORDING] },
  'countdown.5': { text: 'Five.', category: 'countdown', priority: 2, cooldownMs: 900, expiryMs: 800, allowedPhases: RECORDING },
  'countdown.4': { text: 'Four.', category: 'countdown', priority: 2, cooldownMs: 900, expiryMs: 800, allowedPhases: RECORDING },
  'countdown.3': { text: 'Three.', category: 'countdown', priority: 2, cooldownMs: 900, expiryMs: 800, allowedPhases: RECORDING },
  'countdown.2': { text: 'Two.', category: 'countdown', priority: 2, cooldownMs: 900, expiryMs: 800, allowedPhases: RECORDING },
  'countdown.1': { text: 'One.', category: 'countdown', priority: 2, cooldownMs: 900, expiryMs: 800, allowedPhases: RECORDING },
  'stop.stopped': { text: 'Recording stopped.', category: 'stop', priority: 3, cooldownMs: 0, expiryMs: 5000, allowedPhases: ENDED },
  'stop.time_limit': { text: 'Time limit reached. Recording stopped.', category: 'stop', priority: 3, cooldownMs: 0, expiryMs: 5000, allowedPhases: ENDED },
  'stop.discomfort': { text: 'Recording stopped after reported discomfort.', category: 'stop', priority: 3, cooldownMs: 0, expiryMs: 5000, allowedPhases: ENDED },
  'stop.interrupted': { text: 'Recording stopped. Setup must be repeated.', category: 'stop', priority: 3, cooldownMs: 0, expiryMs: 5000, allowedPhases: ENDED },
} as const satisfies Record<string, Omit<CueDefinition, 'id'>>;

export type CueId = keyof typeof CUE_CATALOG;
export const CUE_IDS = Object.keys(CUE_CATALOG) as [CueId, ...CueId[]];
export const cueIdSchema = z.enum(CUE_IDS);
/** Hard bound shared with the TTS server; the longest approved sentence is well below it. */
export const MAX_CUE_TEXT_CHARS = 120;

export function cueDefinition(id: CueId): CueDefinition {
  return { id, ...CUE_CATALOG[id] };
}

/** Body of POST /api/gemini-tts. Text is never accepted from the client; the server looks it up by ID. */
export const ttsRequestSchema = z.strictObject({ catalogVersion: z.literal(CUE_CATALOG_VERSION), cueId: cueIdSchema });
export type TtsRequest = z.infer<typeof ttsRequestSchema>;
export const TTS_REQUEST_BYTES = 256;

export type TtsErrorCode = 'METHOD_NOT_ALLOWED' | 'ORIGIN_DENIED' | 'ACCESS_DENIED' | 'PROTECTION_UNCONFIGURED' | 'PROVIDER_DISABLED' |
  'INVALID_INPUT' | 'REQUEST_TOO_LARGE' | 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' | 'TIMEOUT' | 'CANCELLED' | 'PROVIDER_ERROR' |
  'REFUSED' | 'MALFORMED_RESPONSE';
export const ttsErrorSchema = z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string().min(1).max(40), message: z.string().max(300) }) });
