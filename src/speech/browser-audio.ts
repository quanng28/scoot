import { CUE_CATALOG_VERSION, ttsErrorSchema, type CueId } from '../contracts/cue.js';
import { anySignal, timeoutSignal } from '../net/abort.js';
import type { AudioOutput, CueAudio, CueAudioSource, LocalVoice } from './cue-speaker.js';

/** 44-byte silent mono WAV, played inside the enabling gesture so iOS Safari permits later playback. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
export const MAX_CUE_AUDIO_BYTES = 1_500_000;

/** One reusable <audio> element; playback never requests microphone permission (FR-05). */
export class HtmlAudioOutput implements AudioOutput {
  private readonly element: HTMLAudioElement;
  private url: string | null = null;
  constructor(element?: HTMLAudioElement) { this.element = element ?? new Audio(); this.element.preload = 'auto'; }

  async unlock(): Promise<boolean> {
    try { this.element.src = SILENT_WAV; await this.element.play(); this.element.pause(); return true; } catch { return false; }
  }

  play(audio: Blob, signal: AbortSignal): Promise<void> {
    this.stop();
    const url = URL.createObjectURL(audio);
    this.url = url;
    this.element.src = url;
    return new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        this.element.removeEventListener('ended', ended); this.element.removeEventListener('error', failed); signal.removeEventListener('abort', aborted);
        if (this.url === url) { URL.revokeObjectURL(url); this.url = null; }
        if (error) reject(error); else resolve();
      };
      const ended = () => done();
      const failed = () => done(new Error('The cue audio could not be played.'));
      const aborted = () => { this.element.pause(); done(new DOMException('Cancelled', 'AbortError')); };
      this.element.addEventListener('ended', ended); this.element.addEventListener('error', failed); signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      this.element.play().catch(() => done(new Error('Playback was blocked. Tap Enable audio again.')));
    });
  }

  stop(): void {
    this.element.pause();
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
}

/** On-device speechSynthesis fallback (FR-13 "local speech"). Voice quality varies by device. */
export class BrowserLocalVoice implements LocalVoice {
  available(): boolean { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'; }
  unlock(): void { if (this.available()) speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
  cancel(): void { if (this.available()) speechSynthesis.cancel(); }
  speak(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    if (!this.available()) return Promise.reject(new Error('Local speech is unavailable.'));
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error('Local speech failed.'));
      signal.addEventListener('abort', () => { speechSynthesis.cancel(); resolve(); }, { once: true });
      speechSynthesis.speak(utterance);
    });
  }
}

export class TtsClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TtsClientError'; }
}

/**
 * Fetches approved cue audio from POST /api/gemini-tts by cue ID only. Successful audio is cached per
 * catalog version for this page; concurrent requests for one cue share a single network request; failures
 * are not cached, so a later explicit enable can try again. The access code is supplied at runtime.
 */
export class GeminiCueAudioSource implements CueAudioSource {
  private readonly cache = new Map<CueId, { promise: Promise<CueAudio>; abort: AbortController; waiters: number; settled: boolean }>();
  constructor(private readonly options: { accessCode: () => string | null; endpoint?: string; fetch?: typeof fetch; timeoutMs?: number }) {}

  load(id: CueId, signal: AbortSignal): Promise<CueAudio> {
    if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    const code = this.options.accessCode();
    if (!code) return Promise.reject(new TtsClientError('ACCESS_DENIED', 'Cloud voice needs explicit enablement and the demo access code; captions remain visible.'));
    let pending = this.cache.get(id);
    if (!pending) {
      const abort = new AbortController();
      pending = { promise: this.request(id, code, abort.signal), abort, waiters: 0, settled: false };
      const entry = pending;
      this.cache.set(id, entry);
      entry.promise.then(() => { entry.settled = true; }, () => {
        entry.settled = true;
        if (this.cache.get(id) === entry) this.cache.delete(id);
      });
    }
    const entry = pending;
    entry.waiters++;
    return raceAbort(entry.promise, signal).finally(() => {
      entry.waiters--;
      // Keep useful shared/cached audio, but cancel a request after the last live cue leaves its scope.
      if (!entry.settled && entry.waiters === 0) {
        entry.abort.abort();
        if (this.cache.get(id) === entry) this.cache.delete(id);
      }
    });
  }

  private async request(id: CueId, code: string, signal: AbortSignal): Promise<CueAudio> {
    let response: Response;
    try {
      // One waiter cannot cancel another; the shared signal aborts when no live cue needs this request.
      response = await (this.options.fetch ?? fetch)(this.options.endpoint ?? '/api/gemini-tts', { method: 'POST', credentials: 'same-origin',
        signal: anySignal([signal, timeoutSignal(this.options.timeoutMs ?? 12_000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` }, body: JSON.stringify({ catalogVersion: CUE_CATALOG_VERSION, cueId: id }) });
    } catch { throw new TtsClientError('NETWORK_ERROR', 'Cloud voice could not be reached; using local voice or captions.'); }
    if (!response.ok) {
      const body = ttsErrorSchema.safeParse(await response.json().catch(() => null));
      throw new TtsClientError(body.success ? body.data.error.code : 'PROVIDER_ERROR', body.success ? body.data.error.message : 'Cloud voice failed; using local voice or captions.');
    }
    const blob = await response.blob();
    if (!/^audio\/wav\b/i.test(response.headers.get('content-type') ?? '') || blob.size < 44 || blob.size > MAX_CUE_AUDIO_BYTES || response.headers.get('x-cue-id') !== id)
      throw new TtsClientError('MALFORMED_RESPONSE', 'Cloud voice returned unexpected audio; using local voice or captions.');
    const provenance = response.headers.get('x-provenance') === 'gemini' ? 'gemini' : 'mock_provider';
    return { audio: blob.type ? blob : new Blob([blob], { type: 'audio/wav' }), provenance };
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then((v) => { signal.removeEventListener('abort', aborted); resolve(v); }, (e: unknown) => { signal.removeEventListener('abort', aborted); reject(e instanceof Error ? e : new Error('Cloud voice failed.')); });
  });
}
