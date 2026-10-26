import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fourWorkflowRecords } from '../contracts/seated-workflow.test-fixtures.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { summarizeReviewRecord } from '../contracts/review-session.js';
import { replayWindow } from '../contracts/reach-session.js';
import { SessionStore } from './session-store.js';

let next = 0;
const stores: SessionStore[] = [];
const openStore = (name: string) => { const store = new SessionStore(name); stores.push(store); return store; };
afterEach(() => { stores.splice(0).forEach((store) => store.close()); vi.restoreAllMocks(); });

describe.each([0, 1, 2, 3])('seated exercise storage path %i', (index) => {
  it('round-trips the finalized exercise facts/video across reload and isolates deletion from legacy reach', async () => {
    const name = `four-workflow-storage-${++next}`, record = fourWorkflowRecords(name)[index]!;
    const video = new Blob(['video'], { type: 'video/webm' });
    const store = openStore(name), reach = syntheticReachSession(`${name}-legacy`);
    await store.save(reach, null);
    await store.save(record, video);
    store.close();
    const reopened = openStore(name), loaded = await reopened.load(record.sessionId);
    expect(loaded.record).toEqual(record);
    expect(loaded.videoProblem).toBeNull();
    expect(await loaded.video?.text()).toBe('video');
    expect(summarizeReviewRecord(loaded.record)).toMatchObject({ detected: 1, measurable: 1, excluded: 0, flagged: 0 });
    expect((await reopened.list()).find((row) => row.sessionId === record.sessionId)).toMatchObject({ readable: true, exerciseId: record.exercise.id, hasVideo: true });
    expect(replayWindow(loaded.record.attempts[0]!, loaded.record.recording, true, 1000)).toMatchObject({ available: true, startSec: 0, endSec: 1 });
    expect(replayWindow(loaded.record.attempts[0]!, loaded.record.recording, true, 500)).toMatchObject({ available: false });
    await reopened.delete(record.sessionId);
    await expect(reopened.load(record.sessionId)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await reopened.load(reach.sessionId)).record).toEqual(reach);
  });

  it('rejects malformed stored facts and mismatched video without reporting successful save', async () => {
    const name = `four-workflow-invalid-${++next}`, record = fourWorkflowRecords(name)[index]!;
    const video = new Blob(['video'], { type: 'video/webm' });
    const store = openStore(name);
    await expect(store.save(record, new Blob(['wrong-size']))).rejects.toMatchObject({ kind: 'invalid' });
    expect(await store.list()).toEqual([]);
    await store.save(record, video);
    store.close();
    const raw = await openDB(name), attempt = record.attempts[0]!;
    await raw.put('attempts', { ...attempt, returnStartMs: null });
    raw.close();
    const again = openStore(name);
    await expect(again.load(record.sessionId)).rejects.toMatchObject({ kind: 'invalid' });
    expect((await again.list())[0]).toMatchObject({ readable: false, sessionId: record.sessionId });
  });

  it('keeps prior sessions intact when an exercise video write runs out of quota', async () => {
    const name = `four-workflow-quota-${++next}`, record = fourWorkflowRecords(name)[index]!;
    const store = openStore(name), reach = syntheticReachSession(`${name}-keep`);
    await store.save(reach, null);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'videos') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(store.save(record, new Blob(['video'], { type: 'video/webm' }))).rejects.toMatchObject({ kind: 'quota' });
    vi.restoreAllMocks();
    expect((await store.list()).map((row) => row.sessionId)).toEqual([reach.sessionId]);
  });

  it('rolls back replacement of existing facts and video when the new video write fails', async () => {
    const name = `four-workflow-replace-${++next}`, record = fourWorkflowRecords(name)[index]!;
    const store = openStore(name), video = new Blob(['video'], { type: 'video/webm' });
    await store.save(record, video);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'videos') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(store.save({ ...record, attempts: [], notes: 'replacement that must not commit' }, video)).rejects.toMatchObject({ kind: 'quota' });
    vi.restoreAllMocks();
    const loaded = await store.load(record.sessionId);
    expect(loaded.record).toEqual(record);
    expect(await loaded.video?.text()).toBe('video');
  });
});

it('rejects cross-session attempt-key collisions before any existing session can be overwritten', async () => {
  const name = `four-workflow-collision-${++next}`, [arm, knee] = fourWorkflowRecords(name);
  const store = openStore(name), video = new Blob(['video'], { type: 'video/webm' });
  await store.save(arm, video);
  const collision = { ...knee, attempts: [{ ...knee.attempts[0]!, id: arm.attempts[0]!.id }] };
  await expect(store.save(collision, video)).rejects.toMatchObject({ kind: 'invalid' });
  expect((await store.load(arm.sessionId)).record).toEqual(arm);
  expect((await store.list()).map((row) => row.sessionId)).toEqual([arm.sessionId]);
});

it('detects corrupt stored identity and video metadata while preserving measurement facts', async () => {
  const name = `four-workflow-corrupt-${++next}`, [arm] = fourWorkflowRecords(name);
  const store = openStore(name), video = new Blob(['video'], { type: 'video/webm' });
  await store.save(arm, video);
  store.close();
  const raw = await openDB(name);
  await raw.put('videos', { sessionId: arm.sessionId, blob: video, mimeType: 'video/mp4', sizeBytes: video.size });
  raw.close();
  const again = openStore(name), loaded = await again.load(arm.sessionId);
  expect(loaded.record).toEqual(arm);
  expect(loaded.video).toBeNull();
  expect(loaded.videoProblem).toContain('metadata does not match');
  again.close();
  const broken = await openDB(name);
  const { attempts, ...metadata } = arm;
  await broken.put('sessions', { sessionId: arm.sessionId, savedAt: '2026-10-25T12:00:00Z', attemptIds: attempts.map((attempt) => attempt.id), hasVideo: true,
    record: { ...metadata, sessionId: 'another-session' } });
  broken.close();
  await expect(openStore(name).load(arm.sessionId)).rejects.toMatchObject({ kind: 'invalid' });
});
