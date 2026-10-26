import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { replayWindow } from '../../contracts/reach-session.js';
import type { Action, CurrentSession } from '../../app/state.js';
import { STOP_TEXT, formatSeconds, recordingText } from './format.js';
import { exerciseReason, formatExerciseMetric, getExerciseResults, type ExerciseResults } from './exercise-metrics.js';

type Filter = 'all' | 'flagged' | 'measurable' | 'excluded';
type Props = { current: CurrentSession; dispatch: Dispatch<Action>; onSave: () => void; onDelete: () => void; onNewSession: (() => void) | null; onHome: () => void };
export function ResultsScreen({ current, dispatch, onSave, onDelete, onNewSession, onHome }: Props) {
  const { record, save } = current;
  const results = useMemo(() => getExerciseResults(record), [record]);
  const { summary } = results;
  const [filter, setFilter] = useState<Filter>('all');
  const [decodable, setDecodable] = useState<boolean | null>(current.video ? null : false);
  const [decodedDurationMs, setDecodedDurationMs] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const report = useRef<HTMLHeadingElement>(null);
  const stopAt = useRef<number | null>(null);
  const helperSeek = useRef(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!current.video) { setUrl(null); setDecodable(false); return; }
    const objectUrl = URL.createObjectURL(current.video);
    setUrl(objectUrl); setDecodable(null); setDecodedDurationMs(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [current.video]);

  const fixture = record.provenance.kind === 'labeled_synthetic_fixture';
  const evidenceProblem = current.videoProblem ?? (record.recording.status !== 'unavailable' && !current.video ? 'The video is not available in this view.' : null);
  const visible = results.attempts.filter((a) => filter === 'all' || (filter === 'flagged' ? a.flags.length > 0 : a.classification === filter));
  const counts: Record<Filter, number> = { all: summary.detected, flagged: summary.flagged, measurable: summary.measurable, excluded: summary.excluded };

  const play = (attempt: ExerciseResults['attempts'][number]) => {
    const window = replayWindow(attempt, record.recording, decodable, decodedDurationMs);
    const video = player.current;
    if (!window.available || !video) return;
    setSelected(attempt.id); stopAt.current = window.endSec; helperSeek.current = true;
    video.currentTime = window.startSec;
    void video.play().catch(() => setDecodable(false));
  };

  return (
    <section aria-labelledby="results-title">
      {fixture ? <p className="badge badge-fixture" role="note">Synthetic fixture · not a live measurement</p>
        : <p className="badge badge-dev">Developer/judge validation · experimental · not participant use</p>}
      <h1 id="results-title">Session results</h1>
      <dl className="context">
        <div><dt>Exercise</dt><dd>{results.name} · definition {record.exercise.definitionVersion} · analysis {record.configuration.version}</dd></div>
        <div><dt>Mode</dt><dd>{record.mode === 'rehabilitation' ? 'Rehabilitation' : 'Wellness'}</dd></div>
        <div><dt>Participant / task</dt><dd>{record.participantLabel} · {record.taskLabel}</dd></div>
        <div><dt>Side / support</dt><dd>{record.configuration.side} {results.limb} · {record.setup.seatingSupport}</dd></div>
        <div><dt>Target / goal</dt><dd>{'targetPlacement' in record.setup ? `${record.setup.targetPlacement} · ` : ''}{record.setup.assignedRangeOrGoal}</dd></div>
        <div><dt>Attestation</dt><dd>Reported by {record.attestation.supervisorLabel} on {record.attestation.date} ({record.attestation.context}); not verified.</dd></div>
        <div><dt>Review criteria</dt><dd>{results.criteria.length ? results.criteria.join('; ') : 'None enabled — no automatic flags.'}</dd></div>
        <div><dt>Capture</dt><dd>{STOP_TEXT[record.capture.stopReason]}{record.capture.message ? ` ${record.capture.message}` : ''}</dd></div>
        <div><dt>Evidence</dt><dd data-testid="recording-evidence">{recordingText(record.recording)}{record.recording.status !== 'unavailable' ? ' Replay timing is estimated from the recorder start and has not been verified on a physical device.' : ''}</dd></div>
      </dl>
      {evidenceProblem && <p className="status status-problem" role="alert">{evidenceProblem} This session is incomplete for review.</p>}

      <h2>Replay</h2>
      {url ? (
        <video ref={player} src={url} controls playsInline data-testid="replay" aria-label="Recorded session video"
          onLoadedData={(e) => { setDecodable(true); setDecodedDurationMs(e.currentTarget.duration * 1000); }}
          onDurationChange={(e) => setDecodedDurationMs(e.currentTarget.duration * 1000)} onError={() => setDecodable(false)}
          onSeeked={() => { if (helperSeek.current) helperSeek.current = false; else { stopAt.current = null; setSelected(null); } }}
          onTimeUpdate={(e) => { if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null; } }} />
      ) : <p className="muted">{record.recording.status === 'unavailable' ? `Replay unavailable: ${record.recording.reason}` : 'Replay unavailable: video missing.'}</p>}
      {url && decodable === false && <p className="status status-problem" role="alert">The recorded video could not be decoded. Evidence unavailable.</p>}

      <button type="button" onClick={() => report.current?.scrollIntoView({ behavior: 'smooth' })}>View report</button>

      <h2 ref={report} id="session-report">Summary</h2>
      <p data-testid="summary-counts"><strong>{summary.detected}</strong> detected {summary.detected === 1 ? 'attempt' : 'attempts'} = <strong>{summary.measurable}</strong> measurable + <strong>{summary.excluded}</strong> excluded.
        {summary.measurable > 0 ? <> Review criterion exceeded in <strong>{summary.flagged}</strong> of {summary.measurable} measurable repetitions.</> : null}</p>
      <p className="muted">Fully obscured movement cannot be detected, so counts describe detected attempts only.</p>
      {summary.measurable === 0 ? <p data-testid="no-measurable">No measurable repetitions. No medians are shown.</p> : (
        <dl className="medians" data-testid="medians">
          {results.medians.map((metric) => <div key={metric.id}><dt>Median: {metric.label}</dt><dd>{metric.value === null ? 'Unavailable' : formatExerciseMetric(metric, metric.value)}</dd></div>)}
        </dl>
      )}

      <h2>Attempts</h2>
      <div className="filters" role="group" aria-label="Filter attempts">
        {(['all', 'flagged', 'measurable', 'excluded'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)} ({counts[f]})</button>
        ))}
      </div>
      {visible.length === 0 && <p className="muted">No attempts in this view.</p>}
      <ol className="attempts">
        {visible.map((a) => {
          const index = results.attempts.indexOf(a) + 1;
          const window = replayWindow(a, record.recording, decodable, decodedDurationMs);
          return (
            <li key={a.id} className={`attempt ${selected === a.id ? 'selected' : ''}`} data-testid="attempt">
              <h3>Attempt {index} · {a.classification === 'measurable' ? 'Measurable' : 'Unable to measure'}{a.flags.length ? ' · Review criterion exceeded' : ''}</h3>
              <p className="muted">Recording time {formatSeconds(a.startMs)} – {formatSeconds(a.endMs)}{a.endpointMs !== null ? ` · ${results.endpointLabel} ${formatSeconds(a.endpointMs)}` : ''}</p>
              {a.classification === 'excluded' && <ul className="reasons">{a.explanations.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
              <table>
                <tbody>
                  {a.metrics.map((metric) => <tr key={metric.id}><th scope="row">{metric.label}</th><td>
                    {metric.value === null ? <><span>Unable to measure</span><span className="hint">{metric.reasons.map(exerciseReason).join('; ')}</span></> : formatExerciseMetric(metric, metric.value)}
                  </td></tr>)}
                </tbody>
              </table>
              {a.flagTexts.map((text) => <p key={text} className="flag">{text}</p>)}
              <p className="muted">Tracking coverage {(a.quality.coverage * 100).toFixed(0)}% · longest gap {a.quality.longestGapMs.toFixed(0)} ms · {a.quality.observationCount} observations</p>
              {window.available
                ? <button type="button" onClick={() => play(a)}>Replay attempt {index} ({window.startSec.toFixed(1)}–{window.endSec.toFixed(1)} s, estimated)</button>
                : <p className="muted">Replay unavailable: {window.reason}</p>}
            </li>
          );
        })}
      </ol>

      <h2>Session report details</h2>
      <fieldset disabled={save.kind === 'saving'}>
        <legend>Discomfort at session end</legend>
        {(['yes', 'no', 'not_reported'] as const).map((r) => (
          <label key={r} className="choice"><input type="radio" name="discomfort" checked={record.discomfort.response === r}
            disabled={record.capture.stopReason === 'DISCOMFORT_STOP' && r !== 'yes'}
            onChange={() => dispatch({ type: 'discomfort', response: r, note: record.discomfort.note })} />{r === 'not_reported' ? 'Not reported' : r === 'yes' ? 'Yes' : 'No'}</label>
        ))}
        {record.discomfort.reportedDuringCaptureAtMs !== null && <p className="muted">Discomfort reported during capture at {formatSeconds(record.discomfort.reportedDuringCaptureAtMs)}.</p>}
        <label className="field">Discomfort note (optional)<input maxLength={1000} value={record.discomfort.note} onChange={(e) => dispatch({ type: 'discomfort', response: record.discomfort.response, note: e.target.value })} /></label>
      </fieldset>
      <label className="field">Therapist notes<textarea rows={4} maxLength={5000} value={record.notes} onChange={(e) => dispatch({ type: 'notes', notes: e.target.value })} /></label>

      <div className="actions">
        <button type="button" className="primary" disabled={save.kind === 'saving' || save.kind === 'saved'} onClick={onSave}>{save.kind === 'saved' ? 'Saved' : 'Save on this device'}</button>
        {onNewSession && <button type="button" onClick={onNewSession}>New setup for this exercise</button>}
        <button type="button" onClick={onHome}>Home</button>
      </div>
      <p className={save.kind === 'failed' ? 'status status-problem' : 'status'} role="status" data-testid="save-status">
        {save.kind === 'unsaved' && 'Not saved. Results will be lost if you leave or reload this page.'}
        {save.kind === 'saving' && 'Saving…'}
        {save.kind === 'saved' && `Saved in this browser at ${new Date(save.savedAt).toLocaleString()}.`}
        {save.kind === 'failed' && `Save failed: ${save.message}`}
      </p>
      <p className="muted">Browser storage stays on this device and can be cleared or evicted by the browser. It is not a durable clinical archive.</p>
      {save.kind === 'saved' && (confirmDelete ? (
        <div className="actions"><span>Delete this session and its local video?</span>
          <button type="button" className="danger" onClick={onDelete}>Confirm delete</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>
      ) : <div className="actions"><button type="button" onClick={() => setConfirmDelete(true)}>Delete session…</button></div>)}
    </section>
  );
}
