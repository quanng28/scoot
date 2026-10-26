import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { parseSessionRecord, type SessionRecord } from '../contracts/reach-session.js';
import { DB_NAME, SessionStore, StorageError } from './session-store.js';

let counter = 0;
const stores: SessionStore[] = [];
function freshStore(name = `${DB_NAME}-test-${++counter}`) { const store = new SessionStore(name); stores.push(store); return { store, name }; }
afterEach(() => { stores.splice(0).forEach((s) => s.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A recorded-session shape built from the fixture's real engine attempts plus an in-memory video blob. */
function recorded(id: string, bytes = 'fake-webm-bytes'): { record: SessionRecord; video: Blob } {
  const base = syntheticReachSession(id, new Date('2026-10-25T12:00:00Z'));
  const video = new Blob([bytes], { type: 'video/webm' });
  const record = parseSessionRecord({ ...base, provenance: { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' },
    capture: { stopReason: 'STOPPED', stoppedAtMs: 9000, message: null },
    recording: { status: 'complete', mimeType: 'video/webm', sizeBytes: video.size, durationMs: 9000, reason: null, timing: 'estimated_recorder_start' } });
  return { record, video };
}

describe('SessionStore', () => {
  it('round-trips metadata, attempts and video, and survives a new store instance (reload)', async () => {
    const { store, name } = freshStore();
    const { record, video } = recorded('s1');
    const notes = { ...record, notes: 'Attempt 2 shows trunk lean; review replay.', discomfort: { ...record.discomfort, response: 'no' as const } };
    await store.save(notes, video);
    store.close();
    const reopened = await freshStore(name).store.load('s1');
    expect(reopened.record).toEqual(notes);
    expect(reopened.videoProblem).toBeNull();
    expect(await reopened.video!.text()).toBe('fake-webm-bytes');
  });

  it('deletes only the selected session, its attempts and its video', async () => {
    const { store, name } = freshStore();
    const a = recorded('keep'), b = recorded('remove', 'other-bytes');
    await store.save(a.record, a.video); await store.save(b.record, b.video);
    expect((await store.list()).map((l) => l.sessionId).sort()).toEqual(['keep', 'remove']);
    await store.delete('remove');
    await expect(store.load('remove')).rejects.toMatchObject({ kind: 'not_found' });
    const kept = await store.load('keep');
    expect(kept.record.attempts).toHaveLength(a.record.attempts.length);
    expect(await kept.video!.text()).toBe('fake-webm-bytes');
    store.close();
    const raw = await openDB(name);
    expect((await raw.getAll('attempts')).every((x: { sessionId: string }) => x.sessionId === 'keep')).toBe(true);
    expect(await raw.getAllKeys('videos')).toEqual(['keep']);
    raw.close();
  });

  it('re-saving replaces attempts without orphans and stores fixtures without video', async () => {
    const { store } = freshStore();
    const fixture = syntheticReachSession('fx');
    await store.save(fixture, null);
    await store.save({ ...fixture, attempts: fixture.attempts.slice(0, 1) }, null);
    const loaded = await store.load('fx');
    expect(loaded.record.attempts).toHaveLength(1);
    expect(loaded.video).toBeNull(); expect(loaded.videoProblem).toBeNull();
    expect((await store.list())[0]).toMatchObject({ readable: true, provenance: 'labeled_synthetic_fixture', hasVideo: false, counts: { detected: 1 } });
  });

  it('reports quota failure explicitly and leaves no partial session', async () => {
    const { store } = freshStore();
    const { record, video } = recorded('quota');
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'videos') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(store.save(record, video)).rejects.toMatchObject({ kind: 'quota' });
    vi.restoreAllMocks();
    expect(await store.list()).toEqual([]);
    await expect(store.load('quota')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('rejects invalid sessions and mismatched video before writing', async () => {
    const { store } = freshStore();
    const { record, video } = recorded('bad');
    await expect(store.save({ ...record, attempts: [...record.attempts, record.attempts[0]!] }, video)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(store.save(record, new Blob(['x']))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(store.save(record, null)).rejects.toMatchObject({ kind: 'invalid' });
    expect(await store.list()).toEqual([]);
  });

  it('reports unavailable storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const error = await new SessionStore('none').list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ kind: 'unavailable' });
  });

  it('surfaces corrupted rows and missing video instead of hiding them', async () => {
    const { store, name } = freshStore();
    const { record, video } = recorded('ok');
    await store.save(record, video);
    store.close();
    const raw = await openDB(name);
    await raw.put('sessions', { sessionId: 'broken', savedAt: 'not-a-date', attemptIds: [], hasVideo: false, record: {} });
    await raw.delete('videos', 'ok');
    raw.close();
    const { store: again } = freshStore(name);
    const listing = await again.list();
    expect(listing.find((l) => l.sessionId === 'broken')).toMatchObject({ readable: false });
    expect(listing.find((l) => l.sessionId === 'ok')).toMatchObject({ readable: true });
    const loaded = await again.load('ok');
    expect(loaded.video).toBeNull();
    expect(loaded.videoProblem).toMatch(/missing or unreadable/);
    await again.delete('broken');
    expect((await again.list()).map((l) => l.sessionId)).toEqual(['ok']);
  });
});
