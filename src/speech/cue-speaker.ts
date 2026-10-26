import type { CueId } from '../contracts/cue.js';
import { cueDefinition } from '../contracts/cue.js';
import type { CueContext, CueController, QueuedCue } from './cue-controller.js';

/**
 * Plays approved cues (checklist D2/D4 adapter). Every dequeued cue is shown as a caption first, so the
 * visible text never depends on audio, a key or the network. Cloud audio is optional; on failure it uses
 * a local voice if one exists, otherwise captions only. stop() is synchronous and cancels queued,
 * downloading and playing speech before anything else happens.
 */
/** `provenance` comes from the server's X-Provenance header; mock audio is a tone, never speech. */
export type CueAudio = { audio: Blob; provenance: 'gemini' | 'mock_provider' };
export interface CueAudioSource { load(id: CueId, signal: AbortSignal): Promise<CueAudio> }
export interface AudioOutput { unlock(): Promise<boolean>; play(audio: Blob, signal: AbortSignal): Promise<void>; stop(): void }
export interface LocalVoice { available(): boolean; unlock(): void; speak(text: string, signal: AbortSignal): Promise<void>; cancel(): void }

export type Caption = { cueId: CueId; text: string; delivery: 'cloud_audio' | 'mock_audio' | 'local_voice' | 'caption_only' };
/** Audio that arrived after its cue expired. Not a provider failure, so it does not disable cloud voice. */
class TooLate extends Error { constructor() { super('Cloud speech arrived too late for this cue.'); this.name = 'TooLate'; } }
export type SpeakerStatus = { enabled: boolean; muted: boolean; cloudFailures: number; lastProblem: string | null };

/** Time kept back from cloud audio so the local voice can still speak a cue before it expires. */
export const LOCAL_VOICE_RESERVE_MS = 700;

export class CueSpeaker {
  private enabled = false;
  private muted = false;
  private pumping = false;
  private playing: { item: QueuedCue; abort: AbortController } | null = null;
  private captioned: QueuedCue | null = null;
  private last: QueuedCue | null = null;
  private failures = 0;
  private problem: string | null = null;
  private disposed = false;

  constructor(private readonly options: {
    controller: CueController; source?: CueAudioSource | null; output?: AudioOutput | null; localVoice?: LocalVoice | null;
    onCaption: (caption: Caption | null) => void; onStatus?: (status: SpeakerStatus) => void;
    /** After this many cloud failures in a scope, stop asking the server and use local voice/captions. */
    maxCloudFailures?: number;
    /** Same monotonic clock as the controller. */
    now?: () => number;
  }) {}

  get status(): SpeakerStatus { return { enabled: this.enabled, muted: this.muted, cloudFailures: this.failures, lastProblem: this.problem }; }

  /** Call from a tap/click handler: iOS Safari only allows later programmatic playback after a gesture. */
  async enable(): Promise<boolean> {
    this.options.localVoice?.unlock();
    const unlocked = (await this.options.output?.unlock().catch(() => false)) ?? false;
    this.enabled = unlocked || !!this.options.localVoice?.available();
    if (!this.enabled) this.problem = 'Audio playback is unavailable in this browser; captions remain visible.';
    this.emit();
    return this.enabled;
  }

  /** Warms the audio cache (e.g. countdown numbers, whose expiry is shorter than a cold request). Errors are ignored. */
  prefetch(ids: CueId[], signal: AbortSignal): void {
    if (!this.options.source) return;
    for (const id of ids) void this.options.source.load(id, signal).catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.interrupt();
    this.emit();
  }

  /** New scope (camera run/session/configuration): cancels everything and resets cloud-failure tracking. */
  setScope(scope: string | null): void {
    if (scope === this.options.controller.scope) return;
    this.halt(); this.options.controller.setScope(scope); this.failures = 0; this.last = null;
  }

  updateContext(context: CueContext): void {
    this.options.controller.updateContext(context);
    if (this.playing && !this.options.controller.isLive(this.playing.item)) this.interrupt();
    // A caption stays visible while its instruction is still true; stop captions persist after capture ends.
    if (this.captioned && !this.options.controller.isLive(this.captioned) && this.captioned.cue.category !== 'stop') { this.captioned = null; this.options.onCaption(null); }
  }

  submit(ids: CueId[]): void {
    if (this.disposed) return;
    for (const id of ids) this.options.controller.enqueue(id);
    if (this.playing && this.options.controller.shouldInterrupt(this.playing.item)) this.interrupt();
    this.pump().catch(() => { this.pumping = false; });
  }

  /** Stop/discomfort path. Synchronous cancellation first; then the stop sentence, if given. */
  stop(stopCueId?: CueId): void {
    this.halt();
    if (stopCueId) this.submit([stopCueId]);
  }

  /** Explicit user replay of the last spoken cue in this scope. */
  replay(): void {
    const item = this.last && !this.playing ? this.options.controller.replayItem(this.last) : null;
    if (item) this.deliver(item, true).catch(() => undefined);
  }

  dispose(): void { this.halt(); this.disposed = true; }

  private halt(): void {
    this.options.controller.cancel();
    this.interrupt();
    this.options.localVoice?.cancel();
    if (this.captioned) { this.captioned = null; this.options.onCaption(null); }
  }

  private interrupt(): void {
    this.playing?.abort.abort();
    this.options.output?.stop();
    this.options.localVoice?.cancel();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let item = this.options.controller.next(); item && !this.disposed; item = this.options.controller.next()) await this.deliver(item, false);
    } finally { this.pumping = false; }
  }

  private async deliver(item: QueuedCue, replay: boolean): Promise<void> {
    const text = cueDefinition(item.cue.id).text;
    const controller = this.options.controller;
    const silent = !this.enabled || this.muted;
    const useCloud = !silent && !!this.options.source && !!this.options.output && this.failures < (this.options.maxCloudFailures ?? 2);
    const voice = this.options.localVoice?.available() ? this.options.localVoice : null;
    this.caption(item, silent || useCloud || !voice ? 'caption_only' : 'local_voice');
    this.last = item;
    if (silent) return;
    const abort = new AbortController();
    this.playing = { item, abort };
    const now = this.options.now ?? (() => performance.now());
    try {
      if (useCloud) {
        try {
          // Cloud audio may use only part of the cue's validity; the rest is reserved so a late provider
          // falls back to the instant local voice instead of leaving a safety cue as caption-only.
          const remaining = Math.max(0, item.cue.expiryMs - (now() - item.enqueuedAt));
          const cloudBudget = replay ? 10_000 : voice ? Math.max(0, remaining - LOCAL_VOICE_RESERVE_MS) : remaining;
          const { audio, provenance } = await withDeadline(this.options.source!.load(item.cue.id, abort.signal), cloudBudget, abort.signal);
          if (abort.signal.aborted || !(replay ? controller.isLive(item) : controller.isCurrent(item))) return; // stale: cancel, scope change, phase or analyzer state moved on
          this.caption(item, provenance === 'gemini' ? 'cloud_audio' : 'mock_audio');
          await this.options.output!.play(audio, abort.signal);
          return;
        } catch (error) {
          if (abort.signal.aborted) return;
          if (error instanceof TooLate) {
            // Never speak an expired cue late. A cue that is still current falls through to the local voice below.
            if (!voice) { this.caption(item, 'caption_only'); return; }
          } else {
            this.failures++;
            this.problem = error instanceof Error ? error.message : 'Cloud speech failed.';
            this.emit();
          }
        }
      }
      if (voice && (replay ? controller.isLive(item) : controller.isCurrent(item))) { this.caption(item, 'local_voice'); await voice.speak(text, abort.signal).catch(() => undefined); }
      else this.caption(item, 'caption_only');
    } finally {
      if (this.playing?.abort === abort) this.playing = null;
    }
  }

  private caption(item: QueuedCue, delivery: Caption['delivery']): void {
    this.captioned = item;
    this.options.onCaption({ cueId: item.cue.id, text: cueDefinition(item.cue.id).text, delivery });
  }

  private emit(): void { this.options.onStatus?.(this.status); }
}

function withDeadline<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new TooLate()); }, ms);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => {
      cleanup(); reject(error instanceof Error ? error : new Error('Cloud speech failed.'));
    });
  });
}
