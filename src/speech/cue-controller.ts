import { cueDefinition, type CueDefinition, type CueId, type CuePhase } from '../contracts/cue.js';

/**
 * Deterministic speech queue for one camera/session/configuration scope (checklist D2). Pure: no audio,
 * no network, injected clock. It decides *whether* and *which* approved cue may be spoken; the speaker
 * decides *how*. Stop and scope changes cancel everything; queued items carry a generation token so
 * audio that arrives late for an older generation, scope or analyzer state is rejected.
 */
export type CueContext = {
  phase: CuePhase | 'idle' | 'opening'; analyzerState: string | null;
  /** Current setup/readiness/tracking facts, supplied by the authoritative snapshot adapter. */
  transientCueIds?: readonly CueId[];
};
export type QueuedCue = { cue: CueDefinition; scope: string; generation: number; enqueuedAt: number; seq: number };
export type CueDropReason = 'phase_not_allowed' | 'cooldown' | 'already_queued' | 'no_scope';
export type EnqueueResult = { accepted: true; item: QueuedCue } | { accepted: false; reason: CueDropReason };

export class CueController {
  private queue: QueuedCue[] = [];
  private readonly lastAccepted = new Map<CueId, number>();
  private generationValue = 0;
  private seq = 0;
  private scopeKey: string | null = null;
  private context: CueContext = { phase: 'idle', analyzerState: null };

  constructor(private readonly now: () => number = () => performance.now(), private readonly maxQueue = 4) {}

  get generation(): number { return this.generationValue; }
  get scope(): string | null { return this.scopeKey; }
  get pending(): readonly QueuedCue[] { return this.queue; }

  /** One scope per camera run + session + configuration. Any change cancels queued and in-flight speech. */
  setScope(scope: string | null): void {
    if (scope === this.scopeKey) return;
    this.cancel();
    this.scopeKey = scope;
    this.lastAccepted.clear();
  }

  updateContext(context: CueContext): void {
    this.context = context;
    this.queue = this.queue.filter((item) => this.valid(item));
  }

  enqueue(id: CueId): EnqueueResult {
    if (this.scopeKey === null) return { accepted: false, reason: 'no_scope' };
    const cue = cueDefinition(id);
    const phase = this.context.phase;
    if (!(cue.allowedPhases as readonly string[]).includes(phase) || !this.contextAllowsCue(cue)) return { accepted: false, reason: 'phase_not_allowed' };
    const now = this.now();
    const last = this.lastAccepted.get(id);
    if (last !== undefined && now - last < cue.cooldownMs) return { accepted: false, reason: 'cooldown' };
    if (this.queue.some((q) => q.cue.id === id)) return { accepted: false, reason: 'already_queued' };
    // A stop makes every lower-priority instruction stale; a newer countdown number replaces an older one.
    if (cue.category === 'stop') this.queue = [];
    if (cue.category === 'countdown') this.queue = this.queue.filter((q) => q.cue.category !== 'countdown');
    if (cue.category === 'phase') this.queue = this.queue.filter((q) => q.cue.category !== 'phase');
    const item: QueuedCue = { cue, scope: this.scopeKey, generation: this.generationValue, enqueuedAt: now, seq: ++this.seq };
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) {
      const lowest = [...this.queue].sort((a, b) => a.cue.priority - b.cue.priority || a.seq - b.seq)[0]!;
      this.queue = this.queue.filter((q) => q !== lowest);
    }
    this.lastAccepted.set(id, now);
    return { accepted: true, item };
  }

  /** Highest priority, then oldest, among still-valid items. Expired/stale items are discarded. */
  next(): QueuedCue | null {
    this.queue = this.queue.filter((item) => this.valid(item));
    if (!this.queue.length) return null;
    const best = [...this.queue].sort((a, b) => b.cue.priority - a.cue.priority || a.seq - b.seq)[0]!;
    this.queue = this.queue.filter((q) => q !== best);
    return best;
  }

  /** May this cue still *start*? Re-checked right before playback, e.g. after audio finished downloading. Includes expiry. */
  isCurrent(item: QueuedCue): boolean {
    return this.isLive(item) && this.now() - item.enqueuedAt <= item.cue.expiryMs;
  }

  /**
   * May a cue that already started keep playing? Expiry only limits how late a cue may *start*; a sentence
   * longer than its expiry is not cut off. Cancel, scope change, phase change or a stale analyzer state still stop it.
   */
  isLive(item: QueuedCue): boolean {
    return item.generation === this.generationValue && item.scope === this.scopeKey && this.contextAllows(item);
  }

  /** A higher-priority cue (stop, tracking loss) may interrupt lower-priority narration. */
  shouldInterrupt(playing: QueuedCue): boolean {
    return !this.isLive(playing) || this.queue.some((q) => q.cue.priority > playing.cue.priority && this.valid(q));
  }

  /** A user-requested replay of an earlier cue, revalidated against the current generation and context. */
  replayItem(previous: QueuedCue): QueuedCue | null {
    const item: QueuedCue = { ...previous, generation: this.generationValue, enqueuedAt: this.now(), seq: ++this.seq };
    return previous.scope === this.scopeKey && this.contextAllows(item) ? item : null;
  }

  /** Clears the queue and invalidates everything already dequeued or in flight. Synchronous. */
  cancel(): void {
    this.queue = [];
    this.generationValue++;
  }

  private valid(item: QueuedCue): boolean {
    return this.now() - item.enqueuedAt <= item.cue.expiryMs && this.contextAllows(item);
  }

  private contextAllows(item: QueuedCue): boolean {
    return this.contextAllowsCue(item.cue);
  }

  private contextAllowsCue(cue: CueDefinition): boolean {
    if (!(cue.allowedPhases as readonly string[]).includes(this.context.phase)) return false;
    if (this.context.transientCueIds && (cue.category === 'setup' || cue.category === 'tracking' || cue.category === 'readiness') && !this.context.transientCueIds.includes(cue.id)) return false;
    const states = cue.requiresAnalyzerState;
    return !states || (this.context.analyzerState !== null && states.includes(this.context.analyzerState));
  }
}
