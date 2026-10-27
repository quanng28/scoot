import { ACCEPTED_REPORT_VERSION, EXPERIMENTAL_LABEL, REPORT_INPUT_VERSION, REPORT_RESPONSE_BYTES, reportResponseSchema,
  type AcceptedReport, type ReportErrorCode, type ReportInput, type ReportResponse } from '../contracts/provider-report.js';
import { anySignal, timeoutSignal } from '../net/abort.js';
import { validateGeneratedReport } from './report-validator.js';

/**
 * Optional report lifecycle for one finalized session (PRD FR-18, checklist F4). Local facts and the
 * template report never wait for this. Requests are explicit and bounded; a response is accepted only
 * if it is for this controller's session and exact input digest, was not cancelled, and passes the
 * client-side validator again (the browser does not trust the server's validation alone).
 */
export type ReportState =
  | { status: 'idle' }
  | { status: 'loading'; requestNumber: number }
  | { status: 'accepted'; accepted: AcceptedReport }
  | { status: 'failed'; code: ReportErrorCode; message: string; issues: string[] }
  | { status: 'cancelled' };

export type ReportTransport = (input: ReportInput, signal: AbortSignal) => Promise<ReportResponse>;

export class ReportController {
  private current: ReportState;
  private abort: AbortController | null = null;
  private requests = 0;
  private disposed = false;

  constructor(private readonly options: {
    sessionId: string; input: ReportInput; inputDigest: string; transport: ReportTransport;
    onChange?: (state: ReportState) => void; now?: () => Date;
    /** Bounded explicit retries per session view; regeneration is never automatic. */
    maxRequests?: number;
    /**
     * A previously accepted report reopened from storage. Used only if it matches this session and digest and
     * still passes the current validator (rules may have tightened, or the stored row may have been altered).
     */
    existing?: AcceptedReport | null;
  }) {
    const e = options.existing;
    const usable = !!e && e.sessionId === options.sessionId && e.inputDigest === options.inputDigest && validateGeneratedReport(options.input, e.report).ok;
    this.current = usable ? { status: 'accepted', accepted: e } : { status: 'idle' };
  }

  get state(): ReportState { return this.current; }
  get remainingRequests(): number { return Math.max(0, (this.options.maxRequests ?? 2) - this.requests); }

  /** Starts one request after an explicit user action. Returns false when not allowed right now. */
  request(): boolean {
    if (this.disposed || this.current.status === 'loading' || this.remainingRequests === 0) return false;
    const abort = new AbortController();
    this.abort = abort;
    const requestNumber = ++this.requests;
    this.set({ status: 'loading', requestNumber });
    void this.options.transport(this.options.input, abort.signal).then(
      (response) => this.settle(abort, response),
      () => this.settle(abort, { ok: false, error: { code: 'NETWORK_ERROR', message: 'The explanation request failed. Local results are unaffected.' } }),
    );
    return true;
  }

  cancel(): void {
    if (this.current.status !== 'loading') return;
    this.abort?.abort(); this.abort = null;
    this.set({ status: 'cancelled' });
  }

  /** Call when the results view closes or another session opens; late responses are then ignored. */
  dispose(): void { this.abort?.abort(); this.abort = null; this.disposed = true; }

  private settle(abort: AbortController, response: ReportResponse): void {
    // Stale: cancelled, superseded, or the view was disposed.
    if (this.disposed || this.abort !== abort || abort.signal.aborted) return;
    this.abort = null;
    if (!response.ok) { this.set({ status: 'failed', code: knownCode(response.error.code), message: response.error.message, issues: response.issues ?? [] }); return; }
    if (response.binding.inputDigest !== this.options.inputDigest || response.binding.inputSchemaVersion !== REPORT_INPUT_VERSION) {
      this.set({ status: 'failed', code: 'STALE_RESPONSE', message: 'The explanation was for different session data and was discarded.', issues: [] }); return;
    }
    const checked = validateGeneratedReport(this.options.input, response.report);
    if (!checked.ok) { this.set({ status: 'failed', code: 'REJECTED_CONTENT', message: 'The generated explanation did not match the measured facts and was not shown.', issues: checked.issues }); return; }
    this.set({ status: 'accepted', accepted: { schemaVersion: ACCEPTED_REPORT_VERSION, sessionId: this.options.sessionId, inputDigest: this.options.inputDigest,
      inputSchemaVersion: REPORT_INPUT_VERSION, label: EXPERIMENTAL_LABEL, provenance: response.provenance, report: checked.report, acceptedAt: (this.options.now?.() ?? new Date()).toISOString() } });
  }

  private set(state: ReportState): void { this.current = state; this.options.onChange?.(state); }
}

const CODES: ReportErrorCode[] = ['METHOD_NOT_ALLOWED', 'ORIGIN_DENIED', 'ACCESS_DENIED', 'PROTECTION_UNCONFIGURED', 'PROVIDER_DISABLED', 'INVALID_INPUT',
  'CONTEXT_NOT_PERMITTED', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'BUDGET_EXHAUSTED', 'TIMEOUT', 'CANCELLED', 'PROVIDER_ERROR', 'REFUSED', 'MALFORMED_RESPONSE',
  'REJECTED_CONTENT', 'NETWORK_ERROR', 'STALE_RESPONSE'];
/** JSON headers, with the bearer access code only when the tester entered one. */
export const reportHeaders = (code: string | null): Record<string, string> =>
  code ? { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` } : { 'Content-Type': 'application/json' };
const knownCode = (code: string): ReportErrorCode => (CODES as string[]).includes(code) ? code as ReportErrorCode : 'PROVIDER_ERROR';

/**
 * Browser transport for POST /api/gemini-report. The access code is typed by the tester at runtime and
 * held in memory by the caller; it is never bundled. No key or provider URL exists in the client.
 * Without a code the request is sent unauthenticated: the server decides (public demo or ACCESS_DENIED).
 */
export function createReportTransport(options: { endpoint?: string; accessCode: () => string | null; fetch?: typeof fetch; timeoutMs?: number }): ReportTransport {
  const endpoint = options.endpoint ?? '/api/gemini-report';
  return async (input, signal) => {
    const code = options.accessCode();
    const timeout = timeoutSignal(options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(endpoint, { method: 'POST', signal: anySignal([signal, timeout]), credentials: 'same-origin',
        headers: reportHeaders(code), body: JSON.stringify({ input }) });
    } catch {
      if (signal.aborted) return { ok: false, error: { code: 'CANCELLED', message: 'Explanation request cancelled.' } };
      if (timeout.aborted) return { ok: false, error: { code: 'TIMEOUT', message: 'The explanation took too long. Local results are unaffected.' } };
      return { ok: false, error: { code: 'NETWORK_ERROR', message: 'The explanation service could not be reached. Local results are unaffected.' } };
    }
    try {
      const text = await response.text();
      if (text.length > REPORT_RESPONSE_BYTES) throw new Error('oversize');
      return reportResponseSchema.parse(JSON.parse(text));
    } catch {
      if (signal.aborted) return { ok: false, error: { code: 'CANCELLED', message: 'Explanation request cancelled.' } };
      return { ok: false, error: { code: 'MALFORMED_RESPONSE', message: 'The explanation service returned an unreadable response.' } };
    }
  };
}
