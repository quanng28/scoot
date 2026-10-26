import { z } from 'zod';
import { abortable, anySignal, timeoutSignal } from '../../src/net/abort.js';
import { GEMINI_API_BASE } from './config.js';

/**
 * Minimal REST adapter for models/{model}:generateContent (official REST shape, checked 2026-10-25).
 * fetch is used directly instead of @google/genai: the docs note audio responseFormat overrides are
 * REST-only for now, and this keeps cancellation explicit. Aborting stops waiting but cannot recall a
 * request already sent or its charge. Provider error bodies are never forwarded or logged.
 */
export type ProviderFailure = 'TIMEOUT' | 'CANCELLED' | 'PROVIDER_ERROR' | 'REFUSED' | 'RATE_LIMITED' | 'MALFORMED_RESPONSE';
export type Part = { text?: string | undefined; inlineData?: { mimeType?: string | undefined; data?: string | undefined } | undefined };
export type ProviderResult = { ok: true; parts: Part[] } | { ok: false; code: ProviderFailure };

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional(),
      inlineData: z.object({ mimeType: z.string().optional(), data: z.string().optional() }).optional() })).optional() }).optional(),
    finishReason: z.string().optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
const BLOCK_CODES = /\b(safety|prohibited_content|blocklist|spii|recitation|jailbreak|content_blocked|blocked)\b/i;

export async function generateContent(options: { model: string; apiKey: string; body: unknown; signal: AbortSignal; timeoutMs: number; maxResponseBytes: number; fetch?: typeof fetch }): Promise<ProviderResult> {
  const timeout = timeoutSignal(options.timeoutMs);
  const signal = anySignal([options.signal, timeout]);
  const fail = (code: ProviderFailure): ProviderResult => ({ ok: false, code: options.signal.aborted ? 'CANCELLED' : timeout.aborted ? 'TIMEOUT' : code });
  let response: Response;
  if (signal.aborted) return fail('CANCELLED');
  try {
    response = await abortable((options.fetch ?? fetch)(`${GEMINI_API_BASE}/models/${encodeURIComponent(options.model)}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey }, body: JSON.stringify(options.body) }), signal);
  } catch { return fail('PROVIDER_ERROR'); }
  let text: string;
  try { text = await readBoundedText(response, options.maxResponseBytes, signal); } catch { return fail('MALFORMED_RESPONSE'); }
  if (!response.ok) {
    if (response.status === 429) return fail('RATE_LIMITED');
    if (response.status === 400 && BLOCK_CODES.test(text)) return fail('REFUSED');
    return fail('PROVIDER_ERROR');
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return fail('MALFORMED_RESPONSE'); }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return fail('MALFORMED_RESPONSE');
  if (parsed.data.promptFeedback?.blockReason) return fail('REFUSED');
  const candidate = parsed.data.candidates?.[0];
  if (!candidate) return fail('REFUSED');
  const finish = candidate.finishReason;
  if (finish === 'MAX_TOKENS') return fail('MALFORMED_RESPONSE');
  if (finish !== undefined && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') return fail('REFUSED');
  const parts = (candidate.content?.parts ?? []).filter((p) => !p.thought).map((p) => ({ text: p.text, inlineData: p.inlineData }));
  return parts.length ? { ok: true, parts } : fail('MALFORMED_RESPONSE');
}

async function readBoundedText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error('oversize');
      chunks.push(chunk.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
