import { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Action, CurrentSession } from '../../app/state.js';
import { summarizeElbowSession, type ElbowSessionRecord } from '../../contracts/elbow-session.js';
import { replayWindow } from '../../contracts/reach-session.js';
import { formatSeconds, recordingText, STOP_TEXT } from './format.js';

type Props = { current: CurrentSession & { record: ElbowSessionRecord }; dispatch: Dispatch<Action>; onSave: () => void; onDelete: () => void; onNewSession: (() => void) | null; onHome: () => void };
const metrics = {
  minElbowDeg: 'Minimum projected elbow angle', bendExcursionDeg: 'Bend excursion', torsoForwardPeakDeg: 'Peak forward torso change',
  bendDurationSec: 'Bend duration', returnDurationSec: 'Return duration',
} as const;
const formatValue = (metric: keyof typeof metrics, value: number) => `${value.toFixed(metric.endsWith('Sec') ? 2 : 1)}${metric.endsWith('Sec') ? ' s' : '°'}`;

export function ElbowResultsScreen({ current, dispatch, onSave, onDelete, onNewSession, onHome }: Props) {
  const { record, save } = current;
  const summary = summarizeElbowSession(record);
  const [url, setUrl] = useState<string | null>(null);
  const [decodable, setDecodable] = useState<boolean | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    if (!current.video) { setUrl(null); setDecodable(false); return; }
    const objectUrl = URL.createObjectURL(current.video);
    setUrl(objectUrl); setDecodable(null); setDurationMs(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [current.video]);
  const play = (attempt: ElbowSessionRecord['attempts'][number]) => {
    const window = replayWindow(attempt, record.recording, decodable, durationMs);
    if (!window.available || !player.current) return;
    stopAt.current = window.endSec;
    player.current.currentTime = window.startSec;
    void player.current.play().catch(() => setDecodable(false));
  };
  return <section aria-labelledby="results-title">
    <p className="badge badge-dev">Developer/judge validation · experimental · not participant use</p>
    <h1 id="results-title">Seated elbow bend results</h1>
    <dl className="context">
      <div><dt>Exercise</dt><dd>Seated elbow bend and straighten · definition {record.exercise.definitionVersion} · analysis {record.configuration.version}</dd></div>
      <div><dt>Participant / task</dt><dd>{record.participantLabel} · {record.taskLabel}</dd></div>
      <div><dt>Side / support</dt><dd>{record.configuration.side} arm · {record.setup.seatingSupport}</dd></div>
      <div><dt>Assigned endpoint / goal</dt><dd>{record.configuration.endpointDeg}° · {record.setup.assignedRangeOrGoal}</dd></div>
      <div><dt>Capture</dt><dd>{STOP_TEXT[record.capture.stopReason]} {record.capture.message}</dd></div>
      <div><dt>Evidence</dt><dd>{recordingText(record.recording)} Replay timing is estimated.</dd></div>
    </dl>
    {current.videoProblem && <p className="status status-problem" role="alert">{current.videoProblem} This session is incomplete for review.</p>}
    <h2>Summary</h2>
    <p data-testid="summary-counts">{summary.detected} detected attempts = {summary.measurable} measurable + {summary.excluded} excluded. {summary.flagged} flagged.</p>
    {summary.measurable === 0 && <p>No measurable repetitions.</p>}
    <h2>Replay</h2>
    {url ? <video ref={player} src={url} controls playsInline data-testid="replay" aria-label="Recorded session video"
      onLoadedData={(event) => { setDecodable(true); setDurationMs(event.currentTarget.duration * 1000); }}
      onDurationChange={(event) => setDurationMs(event.currentTarget.duration * 1000)} onError={() => setDecodable(false)}
      onTimeUpdate={(event) => { if (stopAt.current !== null && event.currentTarget.currentTime >= stopAt.current) { event.currentTarget.pause(); stopAt.current = null; } }} />
      : <p>Replay unavailable: {record.recording.reason ?? 'Video missing.'}</p>}
    <h2>Attempts</h2>
    <ol className="attempts">{record.attempts.map((attempt, index) => {
      const window = replayWindow(attempt, record.recording, decodable, durationMs);
      return <li key={attempt.id} className="attempt" data-testid="attempt">
        <h3>Attempt {index + 1} · {attempt.classification === 'measurable' ? 'Measurable' : 'Unable to measure'}</h3>
        <p>Recording time {formatSeconds(attempt.startMs)} – {formatSeconds(attempt.endMs)}{attempt.endpointMs !== null ? ` · endpoint ${formatSeconds(attempt.endpointMs)}` : ''}</p>
        {attempt.classification === 'excluded' && <ul className="reasons">{attempt.explanations.map((explanation, i) => <li key={i}>{explanation}</li>)}</ul>}
        <table><tbody>{(Object.keys(metrics) as (keyof typeof metrics)[]).map((name) => <tr key={name}><th scope="row">{metrics[name]}</th><td>{attempt.metrics[name].value === null ? 'Unable to measure' : formatValue(name, attempt.metrics[name].value)}</td></tr>)}</tbody></table>
        <p className="muted">Tracking coverage {(attempt.quality.coverage * 100).toFixed(0)}% · longest gap {attempt.quality.longestGapMs.toFixed(0)} ms</p>
        {window.available ? <button type="button" onClick={() => play(attempt)}>Replay attempt {index + 1} ({window.startSec.toFixed(1)}–{window.endSec.toFixed(1)} s, estimated)</button>
          : <p>Replay unavailable: {window.reason}</p>}
      </li>;
    })}</ol>
    <h2>Session report details</h2>
    <fieldset disabled={save.kind === 'saving'}><legend>Discomfort at session end</legend>
      {(['yes', 'no', 'not_reported'] as const).map((response) => <label key={response} className="choice"><input type="radio" name="discomfort" checked={record.discomfort.response === response}
        disabled={record.capture.stopReason === 'DISCOMFORT_STOP' && response !== 'yes'}
        onChange={() => dispatch({ type: 'discomfort', response, note: record.discomfort.note })} />{response === 'not_reported' ? 'Not reported' : response}</label>)}
      <label className="field">Discomfort note<input value={record.discomfort.note} maxLength={1000} onChange={(event) => dispatch({ type: 'discomfort', response: record.discomfort.response, note: event.target.value })} /></label>
    </fieldset>
    <label className="field">Therapist notes<textarea rows={4} maxLength={5000} value={record.notes} onChange={(event) => dispatch({ type: 'notes', notes: event.target.value })} /></label>
    <div className="actions"><button type="button" className="primary" disabled={save.kind === 'saving' || save.kind === 'saved'} onClick={onSave}>{save.kind === 'saved' ? 'Saved' : 'Save on this device'}</button>
      {onNewSession && <button type="button" onClick={onNewSession}>New recording with this setup</button>}<button type="button" onClick={onHome}>Home</button></div>
    <p className={save.kind === 'failed' ? 'status status-problem' : 'status'} role="status">{save.kind === 'unsaved' ? 'Not saved.' : save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? `Saved in this browser at ${new Date(save.savedAt).toLocaleString()}.` : `Save failed: ${save.message}`}</p>
    {save.kind === 'saved' && (confirmDelete ? <div className="actions"><span>Delete this session and its local video?</span><button type="button" className="danger" onClick={onDelete}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>
      : <button type="button" onClick={() => setConfirmDelete(true)}>Delete session…</button>)}
  </section>;
}
