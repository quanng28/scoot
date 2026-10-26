import { describe, expect, it, vi } from 'vitest';
import { generateContent } from './provider.js';
import { readBoundedJson } from './http.js';

const options = () => ({ model: 'gemini-3.8-flash', apiKey: 'fixture-key', body: {}, signal: new AbortController().signal, timeoutMs: 20, maxResponseBytes: 1000 });

describe('bounded provider transport (mocked only)', () => {
  it('never sends already cancelled requests', async () => {
    const controller = new AbortController(); controller.abort();
    const transport = vi.fn<typeof fetch>();
    expect(await generateContent({ ...options(), signal: controller.signal, fetch: transport })).toEqual({ ok: false, code: 'CANCELLED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('times out a transport that ignores cancellation', async () => {
    const transport = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    expect(await generateContent({ ...options(), fetch: transport })).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled response body and cancels its reader', async () => {
    const cancel = vi.fn();
    const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
    expect(await generateContent({ ...options(), fetch: transport })).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels stalled incoming JSON and rejects already cancelled bodies', async () => {
    const controller = new AbortController();
    const request = new Request('https://fixture.example/api', { method: 'POST', body: new ReadableStream(), signal: controller.signal, duplex: 'half' } as RequestInit);
    const pending = readBoundedJson(request, 100);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(readBoundedJson(request, 100)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
