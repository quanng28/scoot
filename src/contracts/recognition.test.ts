import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_SCHEMA_VERSION, movementWindowSchema, type MovementWindow,
} from './recognition.js';
const synthetic = JSON.parse(readFileSync(new URL('../../fixtures/recognition/synthetic-window.json', import.meta.url), 'utf8')) as { fixtureStatus: string; window: unknown };
function window(): MovementWindow { return movementWindowSchema.parse(structuredClone(synthetic.window)); }

describe('draft movement feature contract', () => {
  it('accepts a minimal finite timestamped synthetic feature window and nullable features', () => {
    expect(movementWindowSchema.safeParse(synthetic.window).success).toBe(true);
    expect(synthetic.fixtureStatus).toContain('DRAFT AWAITING QUAN P INTEGRATION');
    expect(synthetic.fixtureStatus).toContain('SYNTHETIC ONLY');
    expect(window().schemaVersion).toBe(FEATURE_SCHEMA_VERSION);
  });
  it.each(['video', 'rawLandmarks', 'name', 'participantId', 'sessionId', 'notes', 'selectedExercise', 'expectedExercise'])('rejects prohibited top-level %s', (key) => {
    expect(movementWindowSchema.safeParse({ ...window(), [key]: 'prohibited' }).success).toBe(false);
  });
  it('rejects metadata envelopes and prohibited fields at every nested boundary', () => {
    const value = window();
    for (const mutated of [synthetic,
      { ...value, quality: { ...value.quality, notes: 'private' } },
      { ...value, samples: [{ ...value.samples[0], participantId: 'private' }, value.samples[1]] },
      { ...value, samples: [{ ...value.samples[0], features: { ...value.samples[0]!.features, rawLandmarks: [] } }, value.samples[1]] },
    ]) expect(movementWindowSchema.safeParse(mutated).success).toBe(false);
  });
  const invalidCases: [string, (input: MovementWindow) => unknown][] = [
    ['NaN', (v) => { v.samples[0]!.features.elbowAngleDeg = NaN; return v; }],
    ['infinity', (v) => { v.samples[0]!.features.wristForwardReferenceLengths = Infinity; return v; }],
    ['unbounded finite displacement', (v) => { v.samples[0]!.features.wristForwardReferenceLengths = 1001; return v; }],
    ['unbounded recording clock', (v) => ({ ...v, startMs: 86_400_001, endMs: 86_401_001 })],
    ['negative infinity', (v) => { v.quality.maxGapMs = -Infinity; return v; }],
    ['angle bounds', (v) => { v.samples[0]!.features.kneeAngleDeg = 181; return v; }],
    ['signed angle bounds', (v) => { v.samples[0]!.features.ankleSignedChangeDeg = -181; return v; }],
    ['wrong version', (v) => ({ ...v, schemaVersion: 'agreed-v1' })],
    ['reversed window', (v) => ({ ...v, startMs: 1001 })],
    ['zero duration', (v) => ({ ...v, endMs: 0 })],
    ['long window', (v) => ({ ...v, endMs: 10001 })],
    ['sample before start', (v) => { v.samples[0]!.timestampMs = -1; return v; }],
    ['sample after end', (v) => { v.samples[2]!.timestampMs = 1001; return v; }],
    ['unordered samples', (v) => { v.samples.reverse(); return v; }],
    ['duplicate timestamp', (v) => { v.samples[1]!.timestampMs = 0; return v; }],
    ['too few samples', (v) => ({ ...v, samples: v.samples.slice(0, 1) })],
    ['too many samples', (v) => ({ ...v, samples: Array.from({ length: 129 }, (_, i) => ({ ...v.samples[0]!, timestampMs: i })) })],
    ['coverage over one', (v) => { v.quality.coverage = 1.01; return v; }],
    ['negative gap', (v) => { v.quality.maxGapMs = -1; return v; }],
    ['gap exceeds duration', (v) => { v.quality.maxGapMs = 1001; return v; }],
    ['quality status', (v) => ({ ...v, quality: { ...v.quality, status: 'safe' } })],
    ['string feature', (v) => ({ ...v, samples: [{ ...v.samples[0]!, features: { ...v.samples[0]!.features, elbowAngleDeg: '100' } }, v.samples[1]] })],
    ['oversized prohibited payload', (v) => ({ ...v, video: 'x'.repeat(65_537) })],
  ];
  it.each(invalidCases)('rejects %s', (_label, mutate) => {
    expect(movementWindowSchema.safeParse(mutate(window())).success).toBe(false);
  });
  it('accepts finite signed normalized displacement without inventing clinical cutoffs', () => {
    const value = window(); value.samples[0]!.features.wristForwardReferenceLengths = -2;
    expect(movementWindowSchema.safeParse(value).success).toBe(true);
  });
});
