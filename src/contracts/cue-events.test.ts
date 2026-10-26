import { expect, it } from 'vitest';
import { CUE_CATALOG, countdownCueEvents, createCueEvent, cueEventSchema } from './cue-events.js';

const binding = { sessionId: 's', configurationId: 'c', exerciseId: 'seated_knee_extension' as const };
it('creates bounded versioned neutral cue events from exact allowlisted IDs', () => {
  const event = createCueEvent(binding, 'phase.target', 337, 'attempt-1');
  expect(event).toMatchObject({ timestampMs: 337, expiresAtMs: 1837, phase: 'endpoint', source: 'deterministic_capture_event' });
  expect(createCueEvent(binding, 'phase.target', 337, 'attempt-1')).toEqual(event);
  expect(CUE_CATALOG['stop.stopped'].priority).toBeGreaterThan(CUE_CATALOG['recording.started'].priority);
  expect(cueEventSchema.safeParse({ ...event, text: 'Push farther' }).success).toBe(false);
  expect(cueEventSchema.safeParse({ ...event, phase: 'return' }).success).toBe(false);
  expect(cueEventSchema.safeParse({ ...event, expiresAtMs: Infinity }).success).toBe(false);
});
it('retains irregular observed countdown times without inventing skipped seconds', () => {
  const events = countdownCueEvents(binding, [{ remainingSeconds: 5, timestampMs: 25080 }, { remainingSeconds: 3, timestampMs: 27600 }, { remainingSeconds: 1, timestampMs: 29990 }]);
  expect(events.map((e) => [e.cueId, e.timestampMs])).toEqual([['countdown.5', 25080], ['countdown.3', 27600], ['countdown.1', 29990]]);
});
it('rejects duplicate, stale, mismatched and post-stop countdown events', () => {
  for (const ticks of [
    [{ remainingSeconds: 5, timestampMs: 25000 }, { remainingSeconds: 5, timestampMs: 25050 }],
    [{ remainingSeconds: 5, timestampMs: 24000 }], [{ remainingSeconds: 3, timestampMs: 25000 }],
    [{ remainingSeconds: 1, timestampMs: 30000 }], [{ remainingSeconds: 1, timestampMs: 30001 }],
  ]) expect(() => countdownCueEvents(binding, ticks)).toThrow();
});
