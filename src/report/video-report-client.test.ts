import { FakeListChatModel } from '@langchain/core/utils/testing';
import { expect, it, vi } from 'vitest';
import { buildVideoReportInput } from '../contracts/video-report.js';
import { quickSpec } from '../../server/gemini/langchain/specs.js';
import { runReportPipeline } from '../../server/gemini/langchain/pipeline.js';
import { requestVideoReport } from './video-report-client.js';

const input = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'SYNTHETIC_FIXTURE', recordingDurationMs: null, hasVideo: false, pace: null });
async function repaired() {
  const spec = await quickSpec(input);
  const model = new FakeListChatModel({ responses: ['{}', JSON.stringify(spec.fallback())], maxRetries: 0 });
  const result = await runReportPipeline(spec, { modelId: 'offline-template-mock', signal: new AbortController().signal,
    call: async (prompt, signal) => ({ ok: true, text: (await model.invoke(prompt, { signal, callbacks: [] })).text }) });
  return { ok: true as const, binding: { inputSchemaVersion: input.schemaVersion, inputDigest: spec.inputDigest },
    provenance: { source: 'mock_provider' as const, model: 'offline-template-mock', promptVersion: spec.promptVersion, validatorVersion: spec.validatorVersion,
      generatedAt: '2026-10-27T00:00:00.000Z', pipeline: result.metrics }, report: result.report };
}
const request = (fetcher: typeof fetch, signal = new AbortController().signal) => requestVideoReport(input, { accessCode: 'fictional-access-code', signal, fetch: fetcher });

it('accepts digest-bound repaired provenance and revalidates the report in the quick client', async () => {
  const response = await repaired();
  const result = await request(async () => new Response(JSON.stringify(response)));
  expect(result.ok && result.provenance.pipeline?.outcome).toBe('accepted_after_repair');
});

it('rejects stale digest even when repaired provenance and output are otherwise valid', async () => {
  const response = await repaired();
  const result = await request(async () => new Response(JSON.stringify({ ...response, binding: { ...response.binding, inputDigest: 'f'.repeat(64) } })));
  expect(result).toMatchObject({ ok: false, error: { code: 'STALE_RESPONSE' } });
});

it('rejects altered repaired content despite successful server provenance', async () => {
  const response = await repaired();
  const result = await request(async () => new Response(JSON.stringify({ ...response, report: { ...response.report, headline: 'This will cause an injury.' } })));
  expect(result).toMatchObject({ ok: false, error: { code: 'REJECTED_CONTENT' } });
});

it('returns typed cancellation and preserves the no-access-code offline gate', async () => {
  const abort = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
  }));
  const pending = request(fetcher, abort.signal);
  abort.abort();
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  fetcher.mockClear();
  expect(await requestVideoReport(input, { accessCode: null, signal: new AbortController().signal, fetch: fetcher })).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
  expect(fetcher).not.toHaveBeenCalled();
});
