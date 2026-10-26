import { CUE_CATALOG_VERSION, cueDefinition, MAX_CUE_TEXT_CHARS, TTS_REQUEST_BYTES, ttsRequestSchema, type CueId, type TtsErrorCode } from '../../src/contracts/cue.js';
import { loadGeminiConfig, type GeminiConfig } from './config.js';
import { AccessGuard, checkAccess, cors, jsonReply, preflight, readBoundedJson, RequestFailure, SECURITY_HEADERS } from './http.js';
import { InstanceBudget } from './limits.js';
import { generateContent } from './provider.js';
import { isWav, mockToneWav, wrapPcm16 } from './wav.js';
import { abortable } from '../../src/net/abort.js';

/**
 * POST /api/gemini-tts (checklist D3). Accepts an approved cue ID only; the spoken text comes from the
 * versioned catalog on the server, so arbitrary text, landmarks, video or clinical context can never be
 * synthesized. Audio is cached per model/voice/catalog/cue for the instance lifetime and concurrent
 * requests for one cue share a single provider call.
 */
export const TTS_TIMEOUT_MS = 10_000;
export const MAX_TTS_AUDIO_BYTES = 1_500_000;
const MAX_PROVIDER_BYTES = 2_200_000; // base64 of the audio bound plus JSON overhead
const TTS_SAMPLE_RATE = 24_000;

const messages: Record<TtsErrorCode, string> = {
  METHOD_NOT_ALLOWED: 'Use POST.', ORIGIN_DENIED: 'This origin may not request cue audio.', ACCESS_DENIED: 'Demo access code required for cloud voice.',
  PROTECTION_UNCONFIGURED: 'Cloud voice is not configured. Captions and local voice remain available.',
  PROVIDER_DISABLED: 'Cloud voice is disabled. Captions and local voice remain available.',
  INVALID_INPUT: 'Unknown cue or catalog version.', REQUEST_TOO_LARGE: 'Request too large.',
  RATE_LIMITED: 'Cloud voice limit reached. Captions and local voice remain available.', BUDGET_EXHAUSTED: 'Cloud voice budget exhausted. Captions remain available.',
  TIMEOUT: 'Cloud voice timed out.', CANCELLED: 'Cancelled.', PROVIDER_ERROR: 'Cloud voice failed.', REFUSED: 'Cloud voice declined this cue.',
  MALFORMED_RESPONSE: 'Cloud voice returned unusable audio.',
};
const status: Partial<Record<TtsErrorCode, number>> = { METHOD_NOT_ALLOWED: 405, ORIGIN_DENIED: 403, ACCESS_DENIED: 401, PROTECTION_UNCONFIGURED: 503, PROVIDER_DISABLED: 503,
  INVALID_INPUT: 400, REQUEST_TOO_LARGE: 413, RATE_LIMITED: 429, BUDGET_EXHAUSTED: 429, TIMEOUT: 504, CANCELLED: 499 };
const fail = (code: TtsErrorCode, origin: string | null = null) => jsonReply({ ok: false, error: { code, message: messages[code] } }, status[code] ?? 502, origin);

type Audio = { ok: true; bytes: Uint8Array } | { ok: false; code: TtsErrorCode };
export type TtsDeps = { env?: Record<string, string | undefined>; config?: GeminiConfig; fetch?: typeof fetch; budget?: InstanceBudget; guard?: AccessGuard; now?: () => number; timeoutMs?: number };

export function createTtsEndpoint(deps: TtsDeps = {}): (request: Request) => Promise<Response> {
  const cache = new Map<string, Promise<Audio>>();
  let budget = deps.budget ?? null;
  const guard = deps.guard ?? new AccessGuard();
  return async (request) => {
    const loaded = deps.config ? { ok: true as const, config: deps.config } : loadGeminiConfig(deps.env ?? process.env);
    if (!loaded.ok) return fail(loaded.problem);
    const config = loaded.config;
    if (request.method === 'OPTIONS') return preflight(request, config);
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED');
    if (request.signal.aborted) return fail('CANCELLED');
    const access = checkAccess(request, config, guard);
    if (!access.ok) return fail(access.code);
    let id: CueId;
    try {
      const parsed = ttsRequestSchema.safeParse(await readBoundedJson(request, TTS_REQUEST_BYTES));
      if (!parsed.success) return fail('INVALID_INPUT', access.origin);
      id = parsed.data.cueId;
    } catch (error) { return fail(error instanceof RequestFailure ? error.code : 'INVALID_INPUT', access.origin); }
    const text = cueDefinition(id).text;
    if (text.length > MAX_CUE_TEXT_CHARS) return fail('INVALID_INPUT', access.origin);
    const key = `${config.mode}|${config.ttsModel}|${config.ttsVoice}|${CUE_CATALOG_VERSION}|${id}`;
    let pending = cache.get(key);
    if (!pending) {
      budget ??= new InstanceBudget(config.limits.maxPerInstance, deps.now);
      const rejected = budget.reserve('tts', config.limits.ttsPerHour);
      if (rejected) return fail(rejected, access.origin);
      pending = synthesize(config, text, deps.fetch, deps.timeoutMs ?? TTS_TIMEOUT_MS);
      cache.set(key, pending);
      void pending.then((r) => { if (!r.ok) cache.delete(key); });
    }
    // The shared provider call is not tied to this client; a client abort only stops this response.
    let audio: Audio;
    try { audio = await abortable(pending, request.signal); }
    catch { return fail('CANCELLED', access.origin); }
    if (!audio.ok) return fail(audio.code, access.origin);
    return new Response(audio.bytes.slice().buffer, { status: 200, headers: { ...SECURITY_HEADERS, ...cors(access.origin), 'Content-Type': 'audio/wav',
      'Cache-Control': 'private, max-age=86400', 'X-Cue-Id': id, 'X-Cue-Catalog-Version': CUE_CATALOG_VERSION,
      'X-TTS-Model': config.ttsModel, 'X-TTS-Voice': config.ttsVoice, 'X-Provenance': config.mode === 'live' ? 'gemini' : 'mock_provider',
      'Access-Control-Expose-Headers': 'X-Cue-Id, X-Cue-Catalog-Version, X-TTS-Model, X-TTS-Voice, X-Provenance' } });
  };
}

async function synthesize(config: GeminiConfig, text: string, fetchImpl: typeof fetch | undefined, timeoutMs: number): Promise<Audio> {
  if (config.mode === 'mock') return { ok: true, bytes: mockToneWav(TTS_SAMPLE_RATE) };
  const result = await generateContent({ model: config.ttsModel, apiKey: config.apiKey!, timeoutMs, maxResponseBytes: MAX_PROVIDER_BYTES, signal: new AbortController().signal,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    body: { contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'],
      responseFormat: { audio: { mimeType: 'AUDIO_WAV', sampleRate: TTS_SAMPLE_RATE } }, speechConfig: { voiceConfig: { voice: config.ttsVoice } } } } });
  if (!result.ok) return result;
  const inline = result.parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data || inline.data.length > MAX_PROVIDER_BYTES) return { ok: false, code: 'MALFORMED_RESPONSE' };
  const raw = new Uint8Array(Buffer.from(inline.data, 'base64'));
  let bytes: Uint8Array;
  if (isWav(raw)) bytes = raw;
  else if (/audio\/(l16|pcm)/i.test(inline.mimeType ?? '')) bytes = wrapPcm16(raw, Number(/rate=(\d+)/i.exec(inline.mimeType ?? '')?.[1] ?? TTS_SAMPLE_RATE));
  else return { ok: false, code: 'MALFORMED_RESPONSE' };
  return bytes.length > 44 && bytes.length <= MAX_TTS_AUDIO_BYTES ? { ok: true, bytes } : { ok: false, code: 'MALFORMED_RESPONSE' };
}
