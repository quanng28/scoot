import type { GeminiConfig } from '../config.js';
import { generateContent } from '../provider.js';
import type { ModelCall, ReportSpec } from './types.js';

/** The existing pinned REST configuration, no SDK retries or provider exception propagation. */
export function restModelCall<T>(spec: ReportSpec<T>, config: GeminiConfig, fetcher?: typeof fetch): ModelCall {
  return async (prompt, signal) => {
    if (!config.apiKey) return { ok: false, code: 'MISSING_KEY' };
    const result = await generateContent({ model: config.textModel, apiKey: config.apiKey, signal, timeoutMs: 20_000, maxResponseBytes: 200_000,
      ...(fetcher ? { fetch: fetcher } : {}),
      body: { system_instruction: { parts: [{ text: spec.system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' }, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: spec.schema } } } } });
    return result.ok ? { ok: true, text: result.parts.map((p) => p.text ?? '').join(''), ...(result.usage ? { usage: result.usage } : {}) } : result;
  };
}
