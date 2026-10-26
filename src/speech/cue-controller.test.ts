import { describe, expect, it } from 'vitest';
import { CueController } from './cue-controller.js';

function setup(phase: 'previewing' | 'recording' | 'finalizing' = 'recording', analyzerState: string | null = 'REST') {
  let t = 0;
  const c = new CueController(() => t);
  c.setScope('run-1|session-1|config-1');
  c.updateContext({ phase, analyzerState });
  return { c, advance: (ms: number) => { t += ms; } };
}

describe('CueController', () => {
  it('deduplicates queued cues and rate-limits repeated warnings by cooldown', () => {
    const { c, advance } = setup();
    expect(c.enqueue('tracking.wrist').accepted).toBe(true);
    expect(c.enqueue('tracking.wrist')).toEqual({ accepted: false, reason: 'cooldown' });
    expect(c.pending).toHaveLength(1);
    c.next();
    advance(1000);
    expect(c.enqueue('tracking.wrist')).toEqual({ accepted: false, reason: 'cooldown' });
    advance(4100);
    expect(c.enqueue('tracking.wrist').accepted).toBe(true);
  });

  it('serves stop, then tracking, before narration, and a stop clears queued instructions', () => {
    const { c } = setup();
    c.enqueue('phase.rest'); c.enqueue('tracking.wrist');
    expect(c.next()?.cue.id).toBe('tracking.wrist');
    c.enqueue('tracking.hip'); c.enqueue('stop.stopped');
    expect(c.pending.map((q) => q.cue.id)).toEqual(['stop.stopped']);
    expect(c.next()?.cue.id).toBe('stop.stopped');
  });

  it('expires outdated phase cues instead of speaking them late', () => {
    const { c, advance } = setup();
    c.enqueue('phase.rest');
    advance(1600);
    expect(c.next()).toBeNull();
  });

  it('rejects a phase cue whose analyzer state has moved on (stale instruction)', () => {
    const { c } = setup('recording', 'TARGET');
    const result = c.enqueue('phase.target');
    if (!result.accepted) throw new Error('expected accepted');
    const item = c.next()!;
    expect(c.isCurrent(item)).toBe(true);
    c.updateContext({ phase: 'recording', analyzerState: 'RETURN' });
    expect(c.isCurrent(item)).toBe(false);
  });

  it('invalidates dequeued/in-flight cues on cancel and on scope change', () => {
    const { c } = setup();
    c.enqueue('tracking.elbow');
    const item = c.next()!;
    c.cancel();
    expect(c.isCurrent(item)).toBe(false);
    c.enqueue('tracking.hip');
    const second = c.next()!;
    c.setScope('run-2|session-2|config-2');
    expect(c.isCurrent(second)).toBe(false);
    expect(c.pending).toHaveLength(0);
  });

  it('only allows cues in their permitted capture phases', () => {
    const { c } = setup('previewing', null);
    expect(c.enqueue('countdown.3')).toEqual({ accepted: false, reason: 'phase_not_allowed' });
    expect(c.enqueue('setup.reference').accepted).toBe(true);
    c.updateContext({ phase: 'recording', analyzerState: 'REST' });
    expect(c.next()).toBeNull(); // setup instruction is no longer valid once recording starts
  });

  it('replaces an older queued countdown number with the newer one', () => {
    const { c } = setup();
    c.enqueue('countdown.3'); c.enqueue('countdown.2');
    expect(c.pending.map((q) => q.cue.id)).toEqual(['countdown.2']);
  });

  it('keeps the queue bounded by dropping the lowest-priority oldest item', () => {
    const { c } = setup();
    c.enqueue('tracking.restored'); c.enqueue('tracking.shoulder'); c.enqueue('tracking.elbow'); c.enqueue('tracking.wrist'); c.enqueue('tracking.hip');
    expect(c.pending).toHaveLength(4);
    expect(c.pending.some((q) => q.cue.id === 'tracking.restored')).toBe(false);
  });

  it('reports that a higher-priority cue should interrupt current narration', () => {
    const { c } = setup('recording', 'REST');
    c.enqueue('phase.rest');
    const playing = c.next()!;
    expect(c.shouldInterrupt(playing)).toBe(false);
    c.enqueue('tracking.wrist');
    expect(c.shouldInterrupt(playing)).toBe(true);
  });

  it('accepts nothing without a scope', () => {
    const c = new CueController(() => 0);
    c.updateContext({ phase: 'recording', analyzerState: 'REST' });
    expect(c.enqueue('tracking.wrist')).toEqual({ accepted: false, reason: 'no_scope' });
  });
});
