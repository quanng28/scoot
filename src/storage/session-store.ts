import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { parseReviewAttempt, parseReviewRecord, summarizeReviewRecord, type ReviewAttempt, type ReviewRecord } from '../contracts/review-session.js';
import { defaultExtras, sessionExtrasSchema, type SessionExtras } from '../contracts/session-extras.js';
import { buildProviderReportInput, reportInputDigest } from '../report/report-input.js';
import { validateGeneratedReport } from '../report/report-validator.js';

/**
 * Same-browser IndexedDB persistence (FR-24/FR-26). Sessions, attempts and videos are separate stores,
 * written and deleted in one transaction so a failed save leaves no partial session. Browser storage
 * can be cleared or evicted; it is not a durable clinical archive.
 */
/** Browser-local storage for SCOOT sessions. */
export const DB_NAME = 'scoot-review';
/** v2 adds the `extras` store (context, accepted explanation, public URL). v1 data is kept unchanged. */
export const DB_VERSION = 2;
const BLOCKED_UPGRADE_MS = 3000;

type StoredSession = { sessionId: string; savedAt: string; attemptIds: string[]; hasVideo: boolean; record: Omit<ReviewRecord, 'attempts'> };
type StoredVideo = { sessionId: string; blob: Blob; mimeType: string; sizeBytes: number };
interface ReviewDB extends DBSchema {
  sessions: { key: string; value: StoredSession };
  attempts: { key: string; value: ReviewAttempt; indexes: { bySession: string } };
  videos: { key: string; value: StoredVideo };
  extras: { key: string; value: SessionExtras };
}

export type StorageErrorKind = 'unavailable' | 'quota' | 'invalid' | 'not_found' | 'failed';
export class StorageError extends Error {
  constructor(readonly kind: StorageErrorKind, message: string) { super(message); this.name = 'StorageError'; }
}

export type SessionListing =
  | { readable: true; sessionId: string; savedAt: string; createdAt: string; participantLabel: string; taskLabel: string; mode: ReviewRecord['mode'];
      exerciseId: ReviewRecord['exercise']['id']; provenance: ReviewRecord['provenance']['kind']; counts: { detected: number; measurable: number; excluded: number; flagged: number }; hasVideo: boolean }
  | { readable: false; sessionId: string; problem: string };
/** `extras` falls back to defaults for sessions saved before v2; a corrupt row is reported, never guessed. */
export type LoadedSession = { record: ReviewRecord; savedAt: string; video: Blob | null; videoProblem: string | null; extras: SessionExtras; extrasProblem: string | null };

const storedVideoSchema = z.object({ sessionId: z.string(), blob: z.instanceof(Blob), mimeType: z.string(), sizeBytes: z.number().int().positive() });
const storedSessionSchema = z.object({ sessionId: z.string().min(1), savedAt: z.iso.datetime(), attemptIds: z.array(z.string()), hasVideo: z.boolean(), record: z.record(z.string(), z.unknown()) });

function translate(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return new StorageError('quota', `Not enough browser storage to ${action}. Free space or delete older sessions; nothing was saved.`);
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError') return new StorageError('unavailable', `Browser storage is unavailable, so the app could not ${action}. Private browsing or blocked site data can cause this.`);
  return new StorageError('failed', `Could not ${action}: ${error instanceof Error ? error.message : 'unknown storage error'}.`);
}

export class SessionStore {
  private db: Promise<IDBPDatabase<ReviewDB>> | null = null;
  constructor(private readonly name = DB_NAME) {}

  private open(): Promise<IDBPDatabase<ReviewDB>> {
    if (!globalThis.indexedDB) return Promise.reject(new StorageError('unavailable', 'This browser does not provide IndexedDB storage.'));
    if (this.db) return this.db;
    let fail: (error: StorageError) => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const opening = openDB<ReviewDB>(this.name, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('sessions', { keyPath: 'sessionId' });
          db.createObjectStore('attempts', { keyPath: 'id' }).createIndex('bySession', 'sessionId');
          db.createObjectStore('videos', { keyPath: 'sessionId' });
        }
        if (oldVersion < 2) db.createObjectStore('extras', { keyPath: 'sessionId' });
      },
      // An older tab holding v1 open blocks the v2 upgrade: report it instead of waiting forever.
      blocked: () => { timer ??= setTimeout(() => fail(new StorageError('unavailable', 'Another tab of this app is using older local storage. Close other tabs of this app, then retry.')), BLOCKED_UPGRADE_MS); },
      // This connection yields to a later upgrade from a newer tab.
      blocking: () => this.close(),
    });
    const pending = new Promise<IDBPDatabase<ReviewDB>>((resolve, reject) => {
      fail = reject;
      opening.then((db) => { clearTimeout(timer); resolve(db); }, (error: unknown) => { clearTimeout(timer); reject(translate(error, 'open local storage')); });
    });
    pending.catch(() => {
      if (this.db === pending) this.db = null;
      void opening.then((db) => db.close()).catch(() => undefined); // a connection that opens after we gave up is closed
    });
    this.db = pending;
    return pending;
  }

  /**
   * Atomic upsert of metadata, attempts, video and (optionally) extras. Re-saving replaces the previous copy of this
   * session only; omitting `extras` keeps any stored extras unchanged.
   */
  async save(input: ReviewRecord, video: Blob | null, extrasInput?: SessionExtras): Promise<{ savedAt: string }> {
    let record: ReviewRecord;
    try { record = parseReviewRecord(input); } catch { throw new StorageError('invalid', 'Session data failed validation and was not saved.'); }
    const extras = extrasInput === undefined ? undefined : sessionExtrasSchema.safeParse(extrasInput);
    if (extras && (!extras.success || extras.data.sessionId !== record.sessionId)) throw new StorageError('invalid', 'Session context or explanation failed validation; nothing was saved.');
    if (record.recording.status !== 'unavailable' && (!video || video.size !== record.recording.sizeBytes)) throw new StorageError('invalid', 'Recording evidence does not match the video to be stored; nothing was saved.');
    const db = await this.open();
    const savedAt = new Date().toISOString();
    const { attempts, ...meta } = record;
    try {
      const tx = db.transaction(['sessions', 'attempts', 'videos', 'extras'], 'readwrite');
      // Observe rejection immediately, including a synchronous quota failure before the final await.
      void tx.done.catch(() => undefined);
      const writes: Promise<unknown>[] = [];
      try {
        const attemptStore = tx.objectStore('attempts');
        const [previousKeys, existingAttempts] = await Promise.all([
          attemptStore.index('bySession').getAllKeys(record.sessionId),
          Promise.all(attempts.map((attempt) => attemptStore.get(attempt.id))),
        ]);
        if (existingAttempts.some((attempt) => attempt && attempt.sessionId !== record.sessionId))
          throw new StorageError('invalid', 'An attempt identifier belongs to another saved session; nothing was saved.');
        if (extras?.success) writes.push(tx.objectStore('extras').put(extras.data));
        for (const key of previousKeys) writes.push(attemptStore.delete(key));
        for (const attempt of attempts) writes.push(attemptStore.put(attempt));
        const hasVideo = !!video && record.recording.status !== 'unavailable';
        writes.push(hasVideo ? tx.objectStore('videos').put({ sessionId: record.sessionId, blob: video!, mimeType: record.recording.mimeType!, sizeBytes: video!.size }) : tx.objectStore('videos').delete(record.sessionId));
        writes.push(tx.objectStore('sessions').put({ sessionId: record.sessionId, savedAt, attemptIds: attempts.map((a) => a.id), hasVideo, record: meta }));
        await Promise.all([...writes, tx.done]);
      } catch (error) {
        const settledWrites = Promise.allSettled(writes);
        try { tx.abort(); } catch { /* A failed or completed transaction is already closed. */ }
        await Promise.all([settledWrites, tx.done.catch(() => undefined)]);
        throw error;
      }
    } catch (error) { throw translate(error, 'save this session'); }
    return { savedAt };
  }

  async list(): Promise<SessionListing[]> {
    const db = await this.open();
    let rows: unknown[];
    try { rows = await db.getAll('sessions'); } catch (error) { throw translate(error, 'list saved sessions'); }
    const listings: SessionListing[] = [];
    for (const row of rows) {
      const id = typeof row === 'object' && row && 'sessionId' in row && typeof row.sessionId === 'string' ? row.sessionId : '(unknown id)';
      try {
        const loaded = await this.load(id, false);
        const r = loaded.record;
        const s = summarizeReviewRecord(r);
        listings.push({ readable: true, sessionId: r.sessionId, savedAt: loaded.savedAt, createdAt: r.createdAt, participantLabel: r.participantLabel, taskLabel: r.taskLabel, exerciseId: r.exercise.id,
          mode: r.mode, provenance: r.provenance.kind, counts: { detected: s.detected, measurable: s.measurable, excluded: s.excluded, flagged: s.flagged }, hasVideo: r.recording.status !== 'unavailable' });
      } catch (error) {
        listings.push({ readable: false, sessionId: id, problem: error instanceof StorageError ? error.message : 'Stored data is unreadable.' });
      }
    }
    return listings.sort((a, b) => (b.readable ? b.savedAt : '').localeCompare(a.readable ? a.savedAt : ''));
  }

  /** Reassembles and re-validates a stored session. A missing/corrupt video is reported, not hidden. */
  async load(sessionId: string, withVideo = true): Promise<LoadedSession> {
    const db = await this.open();
    let stored: unknown, attempts: unknown[], videoRow: unknown, extrasRow: unknown;
    try {
      const tx = db.transaction(['sessions', 'attempts', 'videos', 'extras'], 'readonly');
      [stored, attempts, videoRow, extrasRow] = await Promise.all([tx.objectStore('sessions').get(sessionId), tx.objectStore('attempts').index('bySession').getAll(sessionId),
        withVideo ? tx.objectStore('videos').get(sessionId) : Promise.resolve(undefined), tx.objectStore('extras').get(sessionId), tx.done]);
    } catch (error) { throw translate(error, 'open this session'); }
    if (!stored) throw new StorageError('not_found', 'This session is no longer stored in this browser.');
    const meta = storedSessionSchema.safeParse(stored);
    if (!meta.success) throw new StorageError('invalid', 'Stored session metadata is unreadable.');
    if (meta.data.sessionId !== sessionId || meta.data.record.sessionId !== sessionId)
      throw new StorageError('invalid', 'Stored session identity does not match its storage key.');
    const byId = new Map(attempts.map((a) => { try { const parsed = parseReviewAttempt(a); return [parsed.id, parsed] as const; } catch { return ['', null] as const; } }));
    const ordered = meta.data.attemptIds.map((id) => byId.get(id) ?? null);
    if (ordered.some((a) => a === null) || byId.size !== ordered.length) throw new StorageError('invalid', 'Stored attempts are missing or unreadable.');
    let record: ReviewRecord;
    try { record = parseReviewRecord({ ...meta.data.record, attempts: ordered }); } catch { throw new StorageError('invalid', 'Stored session failed validation.'); }
    if (meta.data.hasVideo !== (record.recording.status !== 'unavailable'))
      throw new StorageError('invalid', 'Stored video availability disagrees with its session record.');
    let video: Blob | null = null, videoProblem: string | null = null;
    if (withVideo && record.recording.status !== 'unavailable') {
      const parsed = storedVideoSchema.safeParse(videoRow);
      if (!parsed.success) videoProblem = 'The stored video is missing or unreadable. Evidence unavailable.';
      else if (parsed.data.sessionId !== record.sessionId || parsed.data.blob.size !== record.recording.sizeBytes || parsed.data.sizeBytes !== record.recording.sizeBytes || parsed.data.mimeType !== record.recording.mimeType)
        videoProblem = 'The stored video metadata does not match its recording record. Evidence unavailable.';
      else video = parsed.data.blob;
    }
    let extras = defaultExtras(record.sessionId), extrasProblem: string | null = null;
    if (extrasRow !== undefined) {
      const parsed = sessionExtrasSchema.safeParse(extrasRow);
      if (parsed.success && parsed.data.sessionId === record.sessionId) extras = parsed.data;
      else extrasProblem = 'Stored context/explanation is unreadable and is not shown. Measurements and video are unaffected.';
    }
    if (extras.acceptedReport && !(await acceptedReportMatches(record, extras))) {
      extras = { ...extras, acceptedReport: null };
      extrasProblem = 'Stored explanation no longer matches the current validated facts/context and is not shown. Measurements and video are unaffected.';
    }
    return { record, savedAt: meta.data.savedAt, video, videoProblem, extras, extrasProblem };
  }

  /**
   * Read-modify-write of one session's extras inside a single transaction, so a late explanation cannot
   * overwrite context or a share URL edited meanwhile. `update` must be synchronous (IndexedDB auto-commits).
   */
  async updateExtras(sessionId: string, update: (current: SessionExtras) => SessionExtras): Promise<SessionExtras> {
    const db = await this.open();
    try {
      const tx = db.transaction(['sessions', 'extras'], 'readwrite');
      const [exists, row] = await Promise.all([tx.objectStore('sessions').getKey(sessionId), tx.objectStore('extras').get(sessionId)]);
      if (exists === undefined) { await tx.done; throw new StorageError('not_found', 'Save the session before adding context or an explanation.'); }
      const current = sessionExtrasSchema.safeParse(row);
      const next = sessionExtrasSchema.safeParse(update(current.success && current.data.sessionId === sessionId ? current.data : defaultExtras(sessionId)));
      if (!next.success || next.data.sessionId !== sessionId) { await tx.done; throw new StorageError('invalid', 'Session context or explanation failed validation and was not saved.'); }
      await Promise.all([tx.objectStore('extras').put(next.data), tx.done]);
      return next.data;
    } catch (error) { throw translate(error, 'save session context'); }
  }

  /** Replaces the extras of an already saved session. Prefer updateExtras when other fields may have changed. */
  async saveExtras(input: SessionExtras): Promise<void> {
    const parsed = sessionExtrasSchema.safeParse(input);
    if (!parsed.success) throw new StorageError('invalid', 'Session context or explanation failed validation and was not saved.');
    const db = await this.open();
    try {
      const tx = db.transaction(['sessions', 'extras'], 'readwrite');
      const exists = await tx.objectStore('sessions').getKey(parsed.data.sessionId);
      // Nothing has been written yet, so finishing the transaction is equivalent to aborting it.
      if (exists === undefined) { await tx.done; throw new StorageError('not_found', 'Save the session before adding context or an explanation.'); }
      await Promise.all([tx.objectStore('extras').put(parsed.data), tx.done]);
    } catch (error) { throw translate(error, 'save session context'); }
  }

  /** Deletes only this session's metadata, attempts and video, in one transaction. */
  async delete(sessionId: string): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction(['sessions', 'attempts', 'videos', 'extras'], 'readwrite');
      const attemptStore = tx.objectStore('attempts');
      const keys = await attemptStore.index('bySession').getAllKeys(sessionId);
      await Promise.all([...keys.map((key) => attemptStore.delete(key)), tx.objectStore('videos').delete(sessionId), tx.objectStore('extras').delete(sessionId),
        tx.objectStore('sessions').delete(sessionId), tx.done]);
    } catch (error) { throw translate(error, 'delete this session'); }
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const result = await navigator.storage?.estimate?.();
      return result && typeof result.usage === 'number' && typeof result.quota === 'number' ? { usage: result.usage, quota: result.quota } : null;
    } catch { return null; }
  }

  close(): void { void this.db?.then((db) => db.close()).catch(() => undefined); this.db = null; }
}


/** Revalidation runs after the read transaction: hashing must not suspend an IndexedDB transaction. */
async function acceptedReportMatches(record: ReviewRecord, extras: SessionExtras): Promise<boolean> {
  const accepted = extras.acceptedReport;
  if (!accepted || accepted.sessionId !== record.sessionId) return false;
  // These are the only permitted transfer variants. Real clinical context remains local in both.
  for (const includeSyntheticContext of [false, true]) {
    try {
      const { input } = buildProviderReportInput(record, extras.context, { includeSyntheticContext });
      if (await reportInputDigest(input) === accepted.inputDigest && validateGeneratedReport(input, accepted.report).ok) return true;
    } catch { /* An obsolete or corrupt explanation never hides otherwise valid session evidence. */ }
  }
  return false;
}
