import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildElbowConfig, buildElbowSessionRecord, emptySetup, setupErrors } from './setup-model.js';
import { SessionStore } from '../../storage/session-store.js';

const baseline = { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 50, y: 150 }, hip: { x: 50, y: 160 } };

describe('elbow choice through saved review', () => {
  it('requires endpoint and stores an elbow session without reach target fields', async () => {
    const draft = emptySetup('2026-10-25', 'seated_elbow_flexion_extension');
    Object.assign(draft, { mode: 'rehabilitation', participantLabel: 'TEST-01', supervisorLabel: 'TEST-SUPERVISOR',
      attestationContext: 'Team validation', attested: true, side: 'left', seatingSupport: 'none', assignedRangeOrGoal: 'Bend to 90 degrees', teamTestConfirmed: true });
    draft.elbowEndpointDeg = '';
    expect(setupErrors(draft)).toContain('Enter an elbow bend endpoint from 0 to 180 degrees.');
    draft.elbowEndpointDeg = '90';
    expect(setupErrors(draft)).toEqual([]);
    const config = buildElbowConfig(draft, { baseline, width: 400, height: 300 }, 'elbow-save');
    const record = buildElbowSessionRecord({ draft, config, attempts: [], recording: { status: 'unavailable', mimeType: null, sizeBytes: 0,
      durationMs: null, reason: 'No recording was produced.', timing: 'estimated_recorder_start' },
      createdAt: '2026-10-25T12:00:00.000Z', endedAt: '2026-10-25T12:00:01.000Z', stopReason: 'STOPPED', stoppedAtMs: 0, message: null, discomfortAtMs: null });
    const store = new SessionStore('elbow-save-test');
    await store.save(record, null);
    expect((await store.load('elbow-save')).record).toEqual(record);
    expect((await store.list())[0]).toMatchObject({ readable: true, exerciseId: 'seated_elbow_flexion_extension', counts: { detected: 0 } });
    await store.delete('elbow-save');
    expect(await store.list()).toEqual([]);
    store.close();
  });
});
