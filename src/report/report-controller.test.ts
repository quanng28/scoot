import { describe, expect, it, vi } from 'vitest';
import { emptyContext } from '../contracts/session-context.js';
import { ACCEPTED_REPORT_VERSION, EXPERIMENTAL_LABEL, REPORT_INPUT_VERSION, type AcceptedReport, type ReportResponse } from '../contracts/provider-report.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { createReportTransport, ReportController, type ReportState, type ReportTransport } from './report-controller.js';
import { buildProviderReportInput, reportInputDigest } from './report-input.js';
import { templateReport } from './template-report.js';

async function fixture(sessionId = 'ctrl-session') {
  const { input } = buildProviderReportInput(syntheticReachSession(sessionId, new Date('2026-10-25T12:00:00Z')), emptyContext());
  return { input, digest: await reportInputDigest(input), sessionId };
}
const okResponse = (digest: string, report: ReturnType<typeof templateReport>['report']): ReportResponse => ({ ok: true,
  binding: { inputSchemaVersion: REPORT_INPUT_VERSION, inputDigest: digest },
  provenance: { source: 'mock_provider', model: 'offline-template-mock', promptVersion: 'report-prompt.v1', validatorVersion: 'report-validator.v1', generatedAt: '2026-10-25T12:00:01.000Z' }, report });
function deferred() {
  const calls: { resolve: (r: ReportResponse) => void; signal: AbortSignal }[] = [];
  const transport: ReportTransport = (_input, signal) => new Promise((resolve) => calls.push({ resolve, signal }));
  return { calls, transport };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ReportController (F4)', () => {
  it('starts idle (local report only) and accepts a bound, re-validated response', async () => {
    const f = await fixture();
    const { calls, transport } = deferred();
    const states: ReportState[] = [];
    const c = new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport, onChange: (s) => states.push(s), now: () => new Date('2026-10-25T12:00:02Z') });
    expect(c.state).toEqual({ status: 'idle' });
    expect(c.request()).toBe(true);
    expect(c.request()).toBe(false); // one in flight
    calls[0]!.resolve(okResponse(f.digest, templateReport(f.input, emptyContext()).report));
    await flush();
    expect(states.map((s) => s.status)).toEqual(['loading', 'accepted']);
    const accepted = c.state.status === 'accepted' ? c.state.accepted : null;
    expect(accepted).toMatchObject({ sessionId: 'ctrl-session', inputDigest: f.digest, label: 'Experimental explanation · not a clinical assessment', acceptedAt: '2026-10-25T12:00:02.000Z' });
    expect(accepted?.provenance.source).toBe('mock_provider');
  });

  it('rejects a response bound to different session data (stale/other-session report)', async () => {
    const f = await fixture();
    const other = await fixture('other-session');
    const changed = structuredClone(other.input); changed.attempts[0]!.startSec += 1;
    const { calls, transport } = deferred();
    const c = new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport });
    c.request();
    calls[0]!.resolve(okResponse(await reportInputDigest(changed), templateReport(f.input, emptyContext()).report));
    await flush();
    expect(c.state).toMatchObject({ status: 'failed', code: 'STALE_RESPONSE' });
  });

  it('re-validates content in the browser even if the server says ok', async () => {
    const f = await fixture();
    const bad = templateReport(f.input, emptyContext()).report;
    bad.summary = 'Four attempts were detected and the movement looks safe.';
    const c = new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport: async () => okResponse(f.digest, bad) });
    c.request();
    await flush();
    expect(c.state).toMatchObject({ status: 'failed', code: 'REJECTED_CONTENT' });
  });

  it('ignores a late response after cancel or dispose, and aborts the transport', async () => {
    const f = await fixture();
    const { calls, transport } = deferred();
    const c = new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport });
    c.request(); c.cancel();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.resolve(okResponse(f.digest, templateReport(f.input, emptyContext()).report));
    await flush();
    expect(c.state).toEqual({ status: 'cancelled' });
    c.request(); c.dispose();
    calls[1]!.resolve(okResponse(f.digest, templateReport(f.input, emptyContext()).report));
    await flush();
    expect(c.state.status).toBe('loading'); // disposed controller never updates again
    expect(c.request()).toBe(false);
  });

  it('bounds explicit retries and never retries automatically', async () => {
    const f = await fixture();
    const transport = vi.fn<ReportTransport>(async () => ({ ok: false, error: { code: 'TIMEOUT', message: 'slow' } }));
    const c = new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport, maxRequests: 2 });
    c.request(); await flush();
    expect(c.state).toMatchObject({ status: 'failed', code: 'TIMEOUT' });
    expect(transport).toHaveBeenCalledTimes(1);
    c.request(); await flush();
    expect(c.request()).toBe(false);
    expect(c.remainingRequests).toBe(0);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('reopens a stored accepted report only for the same session and digest', async () => {
    const f = await fixture();
    const accepted: AcceptedReport = { schemaVersion: ACCEPTED_REPORT_VERSION, sessionId: f.sessionId, inputDigest: f.digest, inputSchemaVersion: REPORT_INPUT_VERSION, label: EXPERIMENTAL_LABEL,
      provenance: { source: 'mock_provider', model: 'offline-template-mock', promptVersion: 'report-prompt.v1', validatorVersion: 'report-validator.v1', generatedAt: '2026-10-25T12:00:01.000Z' },
      report: templateReport(f.input, emptyContext()).report, acceptedAt: '2026-10-25T12:00:02.000Z' };
    const transport: ReportTransport = async () => ({ ok: false, error: { code: 'X', message: '' } });
    expect(new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport, existing: accepted }).state.status).toBe('accepted');
    expect(new ReportController({ sessionId: 'another', input: f.input, inputDigest: f.digest, transport, existing: accepted }).state.status).toBe('idle');
    expect(new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: 'f'.repeat(64), transport, existing: accepted }).state.status).toBe('idle');
    const tampered = { ...accepted, report: { ...accepted.report, summary: 'Movement looks safe; no review needed.' } };
    expect(new ReportController({ sessionId: f.sessionId, input: f.input, inputDigest: f.digest, transport, existing: tampered }).state.status).toBe('idle');
  });
});

describe('createReportTransport', () => {
  it('maps missing code, network failure, malformed and oversized bodies to typed errors', async () => {
    const f = await fixture();
    const signal = new AbortController().signal;
    expect(await createReportTransport({ accessCode: () => null })(f.input, signal)).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    const net = createReportTransport({ accessCode: () => 'code-123', fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch });
    expect(await net(f.input, signal)).toMatchObject({ ok: false, error: { code: 'NETWORK_ERROR' } });
    const garbled = createReportTransport({ accessCode: () => 'code-123', fetch: (async () => new Response('<html>')) as typeof fetch });
    expect(await garbled(f.input, signal)).toMatchObject({ ok: false, error: { code: 'MALFORMED_RESPONSE' } });
    const huge = createReportTransport({ accessCode: () => 'code-123', fetch: (async () => new Response('x'.repeat(40_000))) as typeof fetch });
    expect(await huge(f.input, signal)).toMatchObject({ ok: false, error: { code: 'MALFORMED_RESPONSE' } });
  });

  it('sends only the report DTO with the runtime access code, and reports cancellation', async () => {
    const f = await fixture();
    let sent: RequestInit | undefined;
    const abort = new AbortController();
    const transport = createReportTransport({ accessCode: () => 'code-123', fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
      sent = init; abort.abort(); throw new DOMException('aborted', 'AbortError'); }) as typeof fetch });
    expect(await transport(f.input, abort.signal)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(Object.keys(JSON.parse(sent!.body as string))).toEqual(['input']);
    expect((sent!.headers as Record<string, string>).Authorization).toBe('Bearer code-123');
  });
});
