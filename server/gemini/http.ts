import { createHash, timingSafeEqual } from 'node:crypto';
import type { GeminiConfig } from './config.js';
import { abortable, anySignal, timeoutSignal } from '../../src/net/abort.js';

/** Shared request/response helpers for the Gemini routes. Nothing here logs request bodies or secrets. */
export const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } as const;

export function jsonReply(body: unknown, status: number, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...cors(origin) } });
}

export const cors = (origin: string | null): Record<string, string> => origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

export class RequestFailure extends Error {
  constructor(readonly code: 'REQUEST_TOO_LARGE' | 'INVALID_INPUT' | 'CANCELLED') { super(code); }
}

/** Reads at most `limit` bytes of UTF-8 JSON, aborting early on oversize or client cancellation. */
export async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  if (request.signal.aborted) throw new RequestFailure('CANCELLED');
  const signal = anySignal([request.signal, timeoutSignal(5000)]);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new RequestFailure('REQUEST_TOO_LARGE');
  if (!request.body) throw new RequestFailure('INVALID_INPUT');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (request.signal.aborted) throw new RequestFailure('CANCELLED');
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new RequestFailure('REQUEST_TOO_LARGE');
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (signal.aborted) throw new RequestFailure(request.signal.aborted ? 'CANCELLED' : 'INVALID_INPUT');
    throw error;
  } finally { void reader.cancel().catch(() => undefined); }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)) as unknown; } catch { throw new RequestFailure('INVALID_INPUT'); }
}

export type AccessResult = { ok: true; origin: string } | { ok: false; code: 'ORIGIN_DENIED' | 'ACCESS_DENIED' | 'RATE_LIMITED' };
/** Access codes must be at least this long; use a random code (e.g. `openssl rand -base64 18`), so the unsalted hash resists guessing. */
export const MIN_ACCESS_CODE_LENGTH = 16;

/**
 * Throttles failed access attempts per client address (15-minute window). `Origin` is spoofable outside
 * browsers, so the long random code is the protection and online guessing is bounded per client. There is
 * deliberately no instance-wide lock: unauthenticated failures must not lock out holders of a valid code.
 */
export class AccessGuard {
  private readonly failures = new Map<string, number[]>();
  constructor(private readonly perClient = 10, private readonly now: () => number = () => Date.now(), private readonly maxClients = 10_000) {}
  private recent(key: string): number[] { const t = this.now(); return (this.failures.get(key) ?? []).filter((x) => t - x < 900_000); }
  locked(client: string): boolean { return this.recent(client).length >= this.perClient; }
  fail(client: string): void {
    if (this.failures.size >= this.maxClients && !this.failures.has(client)) this.failures.delete(this.failures.keys().next().value!); // bounded memory
    this.failures.set(client, [...this.recent(client), this.now()]);
  }
}

/**
 * Client address from headers the platform sets and callers cannot override on Vercel
 * (x-vercel-forwarded-for, x-real-ip); otherwise the rightmost x-forwarded-for hop, added by the nearest proxy.
 */
export function clientKey(request: Request): string {
  const platform = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip');
  if (platform?.trim()) return platform.split(',')[0]!.trim();
  return request.headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean).at(-1) ?? 'unknown';
}

/** Exact-origin allowlist plus a runtime-entered access code compared by hash in constant time. */
export function checkAccess(request: Request, config: GeminiConfig, guard?: AccessGuard): AccessResult {
  const origin = request.headers.get('origin');
  if (!origin || !config.allowedOrigins.includes(origin)) return { ok: false, code: 'ORIGIN_DENIED' };
  const client = clientKey(request);
  const match = new RegExp(`^Bearer ([\\x21-\\x7e]{${MIN_ACCESS_CODE_LENGTH},128})$`).exec(request.headers.get('authorization') ?? '');
  const supplied = createHash('sha256').update(match?.[1] ?? '', 'utf8').digest();
  const expected = Buffer.from(config.accessCodeSha256, 'hex');
  if (match && expected.length === supplied.length && timingSafeEqual(expected, supplied)) return { ok: true, origin };
  // Failed guesses cannot deny service to a caller who supplies the correct code.
  if (guard?.locked(client)) return { ok: false, code: 'RATE_LIMITED' };
  guard?.fail(client);
  return { ok: false, code: 'ACCESS_DENIED' };
}

/** CORS preflight for allowed origins only (needed when a dev origin calls a deployed preview). */
export function preflight(request: Request, config: GeminiConfig): Response {
  const origin = request.headers.get('origin');
  if (!origin || !config.allowedOrigins.includes(origin)) return new Response(null, { status: 403, headers: SECURITY_HEADERS });
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...cors(origin), 'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
}
