import { REPORT_RESPONSE_BYTES } from '../contracts/provider-report.js';
import { validateVideoReport, videoReportResponseSchema, VIDEO_REPORT_INPUT_VERSION, type VideoReportInput, type VideoReportResponse } from '../contracts/video-report.js';
import { anySignal, timeoutSignal } from '../net/abort.js';
import { canonicalDigest } from './report-input.js';

/**
 * Client side of the video-only explanation. Mirrors createReportTransport: explicit request, bounded
 * response, binding checked against this exact input digest, and the copy-only validator re-applied in
 * the browser before anything generated is shown.
 */
export async function requestVideoReport(input: VideoReportInput, options: { accessCode: string | null; signal: AbortSignal; endpoint?: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<VideoReportResponse> {
  if (!options.accessCode) return { ok: false, error: { code: 'ACCESS_DENIED', message: 'Enable Gemini and enter the demo access code in Settings to request an explanation.' } };
  const timeout = timeoutSignal(options.timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(options.endpoint ?? '/api/gemini-report', { method: 'POST', signal: anySignal([options.signal, timeout]), credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.accessCode}` }, body: JSON.stringify({ videoInput: input }) });
  } catch {
    if (options.signal.aborted) return { ok: false, error: { code: 'CANCELLED', message: 'Explanation request cancelled.' } };
    if (timeout.aborted) return { ok: false, error: { code: 'TIMEOUT', message: 'The explanation took too long. The local summary is unaffected.' } };
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'The explanation service could not be reached. The local summary is unaffected.' } };
  }
  let parsed: VideoReportResponse;
  try {
    const text = await response.text();
    if (text.length > REPORT_RESPONSE_BYTES) throw new Error('oversize');
    parsed = videoReportResponseSchema.parse(JSON.parse(text));
  } catch { return { ok: false, error: { code: 'MALFORMED_RESPONSE', message: 'The explanation service returned an unreadable response.' } }; }
  if (!parsed.ok) return parsed;
  if (parsed.binding.inputSchemaVersion !== VIDEO_REPORT_INPUT_VERSION || parsed.binding.inputDigest !== await canonicalDigest(input))
    return { ok: false, error: { code: 'STALE_RESPONSE', message: 'The explanation was for different recording data and was discarded.' } };
  const checked = validateVideoReport(input, parsed.report);
  if (!checked.ok) return { ok: false, error: { code: 'REJECTED_CONTENT', message: 'The generated explanation did not match the recorded facts and was not shown.' }, issues: checked.issues };
  return { ...parsed, report: checked.report };
}
