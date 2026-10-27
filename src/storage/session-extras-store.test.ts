import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTED_REPORT_VERSION, EXPERIMENTAL_LABEL, REPORT_INPUT_VERSION } from '../contracts/provider-report.js';
import { defaultExtras, sessionExtrasSchema, SESSION_EXTRAS_VERSION, type SessionExtras } from '../contracts/session-extras.js';
import { emptyContext } from '../contracts/session-context.js';
import { fourWorkflowRecords } from '../contracts/seated-workflow.test-fixtures.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { buildProviderReportInput, reportInputDigest } from '../report/report-input.js';
import { syntheticContext } from '../report/synthetic-context.js';
import { ReportController } from '../report/report-controller.js';
import { templateReport } from '../report/template-report.js';
import { DB_NAME, SessionStore, StorageError } from './session-store.js';

let counter = 0;
const stores: SessionStore[] = [];
const fresh = (name = `${DB_NAME}-extras-${++counter}`) => { const store = new SessionStore(name); stores.push(store); return { store, name }; };
afterEach(() => { stores.splice(0).forEach((s) => s.close()); });
const record = (id: string) => syntheticReachSession(id, new Date('2026-10-25T12:00:00Z'));

async function extrasFor(id: string): Promise<SessionExtras> {
  const r = record(id);
  const { input } = buildProviderReportInput(r, syntheticContext());
  return { schemaVersion: SESSION_EXTRAS_VERSION, sessionId: id, context: syntheticContext(), publicVideo: { url: 'https://videos.example/abc.mp4', publishedAt: '2026-10-25T12:10:00.000Z' },
    acceptedReport: { schemaVersion: ACCEPTED_REPORT_VERSION, sessionId: id, inputDigest: await reportInputDigest(input), inputSchemaVersion: REPORT_INPUT_VERSION, label: EXPERIMENTAL_LABEL,
      provenance: { source: 'mock_provider', model: 'offline-template-mock', promptVersion: 'report-prompt.v1', validatorVersion: 'report-validator.v1', generatedAt: '2026-10-25T12:00:01.000Z' },
      report: templateReport(input, syntheticContext()).report, acceptedAt: '2026-10-25T12:00:02.000Z' } };
}

describe('session extras contract (A5)', () => {
  it('defaults to nothing reported, no explanation and no public link', () => {
    expect(defaultExtras('s')).toEqual({ schemaVersion: 'session-extras.v1', sessionId: 's', context: { schemaVersion: 'session-context.v1', selfReport: [], clinician: [] }, acceptedReport: null, publicVideo: null });
  });

  it('rejects malformed new fields: blob/http links, foreign reports, unprovenanced context', async () => {
    const good = (await extrasFor('s1'));
    expect(sessionExtrasSchema.safeParse(good).success).toBe(true);
    expect(sessionExtrasSchema.safeParse({ ...good, publicVideo: { url: 'blob:https://app/123', publishedAt: good.publicVideo!.publishedAt } }).success).toBe(false);
    expect(sessionExtrasSchema.safeParse({ ...good, publicVideo: { url: 'http://videos.example/a.mp4', publishedAt: good.publicVideo!.publishedAt } }).success).toBe(false);
    expect(sessionExtrasSchema.safeParse({ ...good, acceptedReport: { ...good.acceptedReport!, sessionId: 'other' } }).success).toBe(false);
    const noSource = structuredClone(good) as unknown as { context: { selfReport: Record<string, unknown>[] } };
    delete noSource.context.selfReport[0]!.source;
    expect(sessionExtrasSchema.safeParse(noSource).success).toBe(false);
    expect(sessionExtrasSchema.safeParse({ ...good, context: { ...good.context, symptomsPresent: false } }).success).toBe(false);
  });
});

describe('SessionStore extras (F4 storage migration)', () => {
  it('opens a database written by the v1 schema and reopens its sessions with default extras', async () => {
    const name = `${DB_NAME}-legacy-${++counter}`;
    const r = record('legacy-1');
    const { attempts, ...meta } = r;
    const v1 = await openDB(name, 1, { upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'sessionId' }); db.createObjectStore('attempts', { keyPath: 'id' }).createIndex('bySession', 'sessionId'); db.createObjectStore('videos', { keyPath: 'sessionId' });
    } });
    await v1.put('sessions', { sessionId: r.sessionId, savedAt: '2026-10-25T12:00:00.000Z', attemptIds: attempts.map((a) => a.id), hasVideo: false, record: meta });
    for (const a of attempts) await v1.put('attempts', a);
    v1.close();
    const loaded = await fresh(name).store.load('legacy-1');
    expect(loaded.record).toEqual(r);
    expect(loaded.extras).toEqual(defaultExtras('legacy-1'));
    expect(loaded.extrasProblem).toBeNull();
  });

  it('saves extras with the session atomically, keeps them on a re-save without extras, and updates them separately', async () => {
    const { store, name } = fresh();
    const extras = (await extrasFor('s1'));
    await store.save(record('s1'), null, extras);
    await store.save(record('s1'), null); // e.g. a notes edit; extras untouched
    expect((await fresh(name).store.load('s1')).extras).toEqual(extras);
    await store.saveExtras({ ...extras, publicVideo: null });
    expect((await store.load('s1')).extras.publicVideo).toBeNull();
    await expect(store.saveExtras(defaultExtras('never-saved'))).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('refuses a save whose extras are invalid or belong to another session, writing nothing', async () => {
    const { store } = fresh();
    await expect(store.save(record('s2'), null, (await extrasFor('s3')))).rejects.toBeInstanceOf(StorageError);
    await expect(store.load('s2')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('reports corrupt extras without hiding valid measurements, and never attaches another session\'s report', async () => {
    const { store, name } = fresh();
    await store.save(record('s4'), null, (await extrasFor('s4')));
    await store.save(record('s5'), null);
    store.close();
    const db = await openDB(name);
    await db.put('extras', { ...(await extrasFor('s4')), sessionId: 's5' });           // a row keyed to s5 holding s4's report
    await db.put('extras', { sessionId: 's4', schemaVersion: 'session-extras.v0' }); // corrupt
    db.close();
    const reopened = fresh(name).store;
    const s4 = await reopened.load('s4');
    expect(s4.extrasProblem).toMatch(/unreadable/);
    expect(s4.extras).toEqual(defaultExtras('s4'));
    expect(s4.record.attempts).toHaveLength(4);
    const s5 = await reopened.load('s5');
    expect(s5.extras.acceptedReport).toBeNull();
    expect(s5.extrasProblem).toMatch(/unreadable/);
  });

  it('deletes one session\'s extras without touching another', async () => {
    const { store } = fresh();
    await store.save(record('keep'), null, (await extrasFor('keep')));
    await store.save(record('drop'), null, (await extrasFor('drop')));
    await store.delete('drop');
    expect((await store.load('keep')).extras).toEqual((await extrasFor('keep')));
    await expect(store.load('drop')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('updateExtras merges inside one transaction, so a late explanation keeps context edited meanwhile', async () => {
    const { store } = fresh();
    const base = (await extrasFor('m1'));
    await store.save(record('m1'), null, { ...base, acceptedReport: null, publicVideo: null });
    await store.updateExtras('m1', (x) => ({ ...x, publicVideo: base.publicVideo }));          // e.g. a later share
    await store.updateExtras('m1', (x) => ({ ...x, acceptedReport: base.acceptedReport }));   // late report
    const merged = (await store.load('m1')).extras;
    expect(merged.publicVideo).toEqual(base.publicVideo);
    expect(merged.acceptedReport).toEqual(base.acceptedReport);
    expect(merged.context).toEqual(base.context);
    await expect(store.updateExtras('m1', (x) => ({ ...x, sessionId: 'other' }))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(store.updateExtras('missing', (x) => x)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('reports an upgrade blocked by an older open tab instead of hanging', async () => {
    const name = `${DB_NAME}-blocked-${++counter}`;
    const old = await openDB(name, 1, { upgrade(db) { db.createObjectStore('sessions', { keyPath: 'sessionId' }); } }); // never closes on versionchange
    const store = fresh(name).store;
    await expect(store.list()).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringMatching(/Close other tabs/) });
    old.close();
    await expect(store.list()).resolves.toEqual([]); // retry after the other tab closes
  }, 10_000);
});

it('discards a stale digest or semantically corrupted stored report without hiding its session', async () => {
  const { store, name } = fresh();
  const extras = await extrasFor('stale');
  await store.save(record('stale'), null, extras);
  const raw = await openDB(name);
  await raw.put('extras', { ...extras, acceptedReport: { ...extras.acceptedReport!, inputDigest: 'f'.repeat(64) } });
  const stale = await store.load('stale');
  expect(stale.record).toEqual(record('stale'));
  expect(stale.extras.context).toEqual(extras.context);
  expect(stale.extras.acceptedReport).toBeNull();
  expect(stale.extrasProblem).toMatch(/no longer matches/);
  await raw.put('extras', { ...extras, acceptedReport: { ...extras.acceptedReport!, report: { ...extras.acceptedReport!.report, summary: 'The patient has fully recovered.' } } });
  raw.close();
  expect((await store.load('stale')).extras.acceptedReport).toBeNull();
});

it('rolls back extras and session replacement together when video storage fails', async () => {
  const { store } = fresh();
  const extras = await extrasFor('atomic');
  const r = record('atomic');
  await store.save(r, null, extras);
  const changed = { ...extras, publicVideo: null };
  const original = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'sessions') throw new DOMException('Full', 'QuotaExceededError');
    return original.apply(this, args);
  });
  try { await expect(store.save({ ...r, notes: 'must roll back' }, null, changed)).rejects.toMatchObject({ kind: 'quota' }); }
  finally { spy.mockRestore(); }
  const loaded = await store.load(r.sessionId);
  expect(loaded.record).toEqual(r);
  expect(loaded.extras).toEqual(extras);
});

it('reports a newer unsupported database version without changing stored rows', async () => {
  const name = `${DB_NAME}-future-${++counter}`;
  const raw = await openDB(name, 3, { upgrade(db) { db.createObjectStore('future'); } });
  await raw.put('future', 'preserved', 'key');
  raw.close();
  await expect(fresh(name).store.list()).rejects.toMatchObject({ kind: 'failed' });
  const unchanged = await openDB(name, 3);
  expect(await unchanged.get('future', 'key')).toBe('preserved');
  unchanged.close();
});


it.each([0, 1, 2, 3])('reopens matching accepted report with four-workflow exercise %i facts and video', async (index) => {
  const { store, name } = fresh();
  const r = fourWorkflowRecords(name)[index]!;
  const { input } = buildProviderReportInput(r, emptyContext());
  const extras: SessionExtras = { ...defaultExtras(r.sessionId), acceptedReport: {
    schemaVersion: ACCEPTED_REPORT_VERSION, sessionId: r.sessionId, inputDigest: await reportInputDigest(input),
    inputSchemaVersion: REPORT_INPUT_VERSION, label: EXPERIMENTAL_LABEL,
    provenance: { source: 'mock_provider', model: 'offline-template-mock', promptVersion: 'report-prompt.v1', validatorVersion: 'report-validator.v1', generatedAt: '2026-10-25T12:00:01.000Z' },
    report: templateReport(input, emptyContext()).report, acceptedAt: '2026-10-25T12:00:02.000Z',
  } };
  await store.save(r, new Blob(['video'], { type: 'video/webm' }), extras);
  store.close();
  const reopened = await fresh(name).store.load(r.sessionId);
  expect(reopened.record).toEqual(r);
  expect(await reopened.video?.text()).toBe('video');
  expect(reopened.extras).toEqual(extras);
  expect(reopened.extrasProblem).toBeNull();
});

it.each([false, true])('revalidates stored reports with optional pipeline provenance: %s', async (extended) => {
  const { store, name } = fresh();
  const id = `provenance-${extended}`;
  const extras = await extrasFor(id);
  const accepted = extras.acceptedReport;
  if (!accepted) throw new Error('accepted fixture required');
  const input = buildProviderReportInput(record(id), extras.context).input;
  if (extended) accepted.provenance.pipeline = {
    pipeline: 'langchain', branch: 'measured', exerciseId: input.exercise.id, promptVersion: accepted.provenance.promptVersion,
    validatorVersion: accepted.provenance.validatorVersion, modelId: accepted.provenance.model, inputDigest: accepted.inputDigest,
    steps: [{ step: 'generate', outcome: 'pass', durationMs: 1, attempt: 1, codes: [] }, { step: 'validate', outcome: 'pass', durationMs: 1, attempt: 1, codes: [] }],
    attempts: 1, repaired: false, outcome: 'accepted_first_pass', failureClass: null, durationMs: 2,
  };
  await store.save(record(id), null, extras);
  store.close();
  const loaded = await fresh(name).store.load(id);
  expect(loaded.extras.acceptedReport).toEqual(accepted);
  expect(loaded.extrasProblem).toBeNull();
  const controller = new ReportController({ sessionId: id, input, inputDigest: accepted.inputDigest,
    existing: loaded.extras.acceptedReport, transport: async () => ({ ok: false, error: { code: 'PROVIDER_DISABLED', message: 'Offline' } }) });
  expect(controller.state.status).toBe('accepted');
  const raw = await openDB(name);
  await raw.put('extras', { ...extras, acceptedReport: { ...accepted, report: { ...accepted.report, summary: 'The patient has fully recovered.' } } });
  raw.close();
  expect((await fresh(name).store.load(id)).extras.acceptedReport).toBeNull();
});
