import { z } from 'zod';

/**
 * Server-only Gemini configuration (PRD FR-20). Nothing here is bundled into the browser.
 *
 * Model and voice IDs are restricted to those found in the official documentation on 2026-10-25
 * (docs/gemini-integration.md lists the sources). They have NOT been verified against a specific
 * account/project; that remains part of the authorised smoke tests (D5/F5). Unknown IDs fail closed.
 */
export const VERIFIED_TEXT_MODELS = ['gemini-3.8-flash'] as const;
export const VERIFIED_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'] as const;
/** Voices shown in official speech-generation examples. */
export const VERIFIED_TTS_VOICES = ['Kore', 'Puck'] as const;
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const positiveInt = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback);
const envSchema = z.object({
  /** 'live' sends real requests; 'mock' serves a labelled offline stand-in; anything else disables the provider. */
  GEMINI_PROVIDER_MODE: z.enum(['disabled', 'mock', 'live']).default('disabled'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TEXT_MODEL: z.enum(VERIFIED_TEXT_MODELS).default('gemini-3.8-flash'),
  GEMINI_TTS_MODEL: z.enum(VERIFIED_TTS_MODELS).default('gemini-3.8-flash-lite-tts'),
  GEMINI_TTS_VOICE: z.enum(VERIFIED_TTS_VOICES).default('Kore'),
  /** SHA-256 hex of the demo access code testers type at runtime. Required in every mode except disabled. */
  GEMINI_ACCESS_CODE_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Comma-separated exact origins allowed to call the endpoints, e.g. the Vercel preview origin. */
  GEMINI_ALLOWED_ORIGINS: z.string().optional(),
  GEMINI_REPORT_MAX_PER_HOUR: positiveInt(10, 1000),
  GEMINI_TTS_MAX_PER_HOUR: positiveInt(60, 5000),
  /** Lifetime cap per server instance; the provider-side project quota/budget must be configured too. */
  GEMINI_MAX_REQUESTS_PER_INSTANCE: positiveInt(200, 100_000),
});

export type GeminiConfig = {
  mode: 'mock' | 'live'; apiKey: string | null; textModel: string; ttsModel: string; ttsVoice: string;
  accessCodeSha256: string; allowedOrigins: string[];
  limits: { reportPerHour: number; ttsPerHour: number; maxPerInstance: number };
};
export type ConfigProblem = 'PROVIDER_DISABLED' | 'PROTECTION_UNCONFIGURED';

export function loadGeminiConfig(env: Record<string, string | undefined>): { ok: true; config: GeminiConfig } | { ok: false; problem: ConfigProblem } {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) return { ok: false, problem: 'PROTECTION_UNCONFIGURED' };
  const e = parsed.data;
  if (e.GEMINI_PROVIDER_MODE === 'disabled') return { ok: false, problem: 'PROVIDER_DISABLED' };
  const origins = (e.GEMINI_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!e.GEMINI_ACCESS_CODE_SHA256 || !origins.length || origins.some((o) => !/^https?:\/\/[^/\s]+$/.test(o))) return { ok: false, problem: 'PROTECTION_UNCONFIGURED' };
  const apiKey = e.GEMINI_API_KEY?.trim() || null;
  if (e.GEMINI_PROVIDER_MODE === 'live' && !apiKey) return { ok: false, problem: 'PROVIDER_DISABLED' };
  return { ok: true, config: { mode: e.GEMINI_PROVIDER_MODE, apiKey: e.GEMINI_PROVIDER_MODE === 'live' ? apiKey : null,
    textModel: e.GEMINI_TEXT_MODEL, ttsModel: e.GEMINI_TTS_MODEL, ttsVoice: e.GEMINI_TTS_VOICE, accessCodeSha256: e.GEMINI_ACCESS_CODE_SHA256, allowedOrigins: origins,
    limits: { reportPerHour: e.GEMINI_REPORT_MAX_PER_HOUR, ttsPerHour: e.GEMINI_TTS_MAX_PER_HOUR, maxPerInstance: e.GEMINI_MAX_REQUESTS_PER_INSTANCE } } };
}
