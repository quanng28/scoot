import { useCallback, useEffect, useState } from 'react';
import { exerciseName } from '../setup/setup-model.js';
import { StorageError, type SessionListing, type SessionStore } from '../../storage/session-store.js';

type Props = { store: SessionStore; notice: string | null; onOpen: (sessionId: string) => Promise<void>; onDeleted: (sessionId: string) => void; onHome: () => void };

export function SessionsScreen({ store, notice, onOpen, onDeleted, onHome }: Props) {
  const [rows, setRows] = useState<SessionListing[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setRows(await store.list()); setProblem(null); }
    catch (e) { setRows([]); setProblem(e instanceof StorageError ? e.message : 'Saved sessions could not be listed.'); }
    const estimate = await store.estimate();
    setUsage(estimate ? `${(estimate.usage / 1048576).toFixed(1)} MiB used of about ${(estimate.quota / 1048576).toFixed(0)} MiB available to this site.` : null);
  }, [store]);
  useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (id: string) => {
    try { await store.delete(id); setPending(null); onDeleted(id); await refresh(); }
    catch (e) { setProblem(e instanceof StorageError ? e.message : 'Delete failed; the session was not removed.'); }
  };
  const open = async (id: string) => {
    try { await onOpen(id); } catch (e) { setProblem(e instanceof StorageError ? e.message : 'The session could not be opened.'); }
  };

  return (
    <section aria-labelledby="sessions-title">
      <h1 id="sessions-title">Saved sessions on this device</h1>
      <p className="muted">Sessions and videos are stored only in this browser. Clearing site data or browser eviction removes them; this is not a durable clinical archive.</p>
      {usage && <p className="muted">{usage}</p>}
      {notice && <p className="status" role="status">{notice}</p>}
      {problem && <p className="status status-problem" role="alert">{problem}</p>}
      {rows === null ? <p>Loading…</p> : rows.length === 0 ? <p data-testid="no-sessions">No saved sessions.</p> : (
        <ul className="sessions">
          {rows.map((row) => (
            <li key={row.sessionId} data-testid="session-row">
              {row.readable ? (
                <div>
                  <strong>{row.participantLabel}</strong> · {exerciseName(row.exerciseId)} · {row.taskLabel} · {row.mode}
                  {row.provenance === 'labeled_synthetic_fixture' && <span className="badge badge-fixture">Synthetic fixture</span>}
                  <div className="muted">Saved {new Date(row.savedAt).toLocaleString()} · {row.counts.detected} detected / {row.counts.measurable} measurable / {row.counts.excluded} excluded / {row.counts.flagged} flagged · {row.hasVideo ? 'video stored' : 'no video'}</div>
                </div>
              ) : <div><strong>Unreadable session</strong> <span className="muted">{row.sessionId}: {row.problem}</span></div>}
              <div className="actions">
                {row.readable && <button type="button" onClick={() => void open(row.sessionId)}>Open</button>}
                {pending === row.sessionId ? (
                  <><button type="button" className="danger" onClick={() => void remove(row.sessionId)}>Confirm delete</button><button type="button" onClick={() => setPending(null)}>Cancel</button></>
                ) : <button type="button" onClick={() => setPending(row.sessionId)}>Delete…</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="actions"><button type="button" onClick={onHome}>Home</button></div>
    </section>
  );
}
