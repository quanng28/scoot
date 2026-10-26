import { describe, expect, it } from 'vitest';
import { SeatedReachAnalyzer } from '../analysis/seated-reach.js';
import { metricUnits, type Metric, type ReachFrame } from '../analysis/reach-contract.js';
import { catalog, exerciseById, participantStartAllowed, readinessLabels } from '../catalog/catalog.js';
import { syntheticReachSession } from '../features/fixtures/synthetic-reach.js';
import { emptySetup, setupErrors } from '../features/setup/setup-model.js';
import {
  CATALOG_METRIC_MAP, attemptRecordSchema, parseSessionRecord, recordingEvidence, replayWindow, sessionRecordSchema, summarizeSession, toAttemptRecord,
  type AttemptRecord, type RecordingEvidence, type SessionRecord,
} from './reach-session.js';

const fixture = () => syntheticReachSession('fixture-session', new Date('2026-10-25T12:00:00Z'));
const clone = <T>(value: T): T => structuredClone(value);
const measurable = (s: SessionRecord) => s.attempts.find((a) => a.classification === 'measurable' && !a.flags.length)!;
const excluded = (s: SessionRecord) => s.attempts.find((a) => a.classification === 'excluded')!;
const flagged = (s: SessionRecord) => s.attempts.find((a) => a.flags.length)!;

describe('labeled synthetic session through the real SR01 analyzer', () => {
  it('produces 4 detected = 3 measurable + 1 excluded with 1 flagged, labeled as non-live', () => {
    const s = fixture();
    expect(summarizeSession(s)).toMatchObject({ detected: 4, measurable: 3, excluded: 1, flagged: 1 });
    expect(s.provenance).toEqual({ kind: 'labeled_synthetic_fixture', label: 'Synthetic fixture · not a live measurement' });
    expect(s.recording.status).toBe('unavailable');
    expect(flagged(s).metrics.torsoForwardPeakDeg.value).toBeCloseTo(12, 6);
    expect(excluded(s).reasons).toContain('TARGET_NOT_REACHED');
    expect(excluded(s).metrics.elbowPeakDeg).toMatchObject({ value: null, reasons: expect.arrayContaining(['TARGET_NOT_REACHED']) });
    expect(Object.keys(s.attempts[0]!)).not.toContain('observations');
  });
});

describe('producer conformance (Quan P engine output → consumer contract)', () => {
  const base = fixture().configuration;
  const f = (t: number, wristX: number): ReachFrame => ({ timestampMs: t, width: 400, height: 300, orientation: base.orientation, side: 'left', landmarks: {
    shoulder: { x: 50 / 400, y: 50 / 300, confidence: 0.9 }, elbow: { x: 50 / 400, y: 100 / 300, confidence: 0.9 },
    wrist: { x: wristX / 400, y: 100 / 300, confidence: 0.9 }, hip: { x: 50 / 400, y: 150 / 300, confidence: 0.9 } } });
  it.each(['STOPPED_EARLY', 'DISCOMFORT_STOP', 'SETUP_CHANGED'] as const)('accepts an interrupted %s attempt as excluded', (reason) => {
    const engine = new SeatedReachAnalyzer({ ...base, criteria: [] });
    for (let t = 0; t <= 600; t += 50) engine.accept(f(t, 100));
    for (let t = 650; t <= 900; t += 50) engine.accept(f(t, 150));
    engine.interrupt(900, reason);
    const [attempt] = engine.drain().map(toAttemptRecord);
    expect(attempt).toMatchObject({ classification: 'excluded', flags: [] });
    expect(attempt!.reasons).toContain(reason);
  });
  it('accepts a tracking-gap exclusion with low-confidence frames', () => {
    const engine = new SeatedReachAnalyzer({ ...base, criteria: [] });
    for (let t = 0; t <= 600; t += 50) engine.accept(f(t, 100));
    for (let t = 650; t <= 900; t += 50) engine.accept(f(t, 150));
    engine.advance(3000);
    expect(toAttemptRecord(engine.drain()[0]!).reasons).toContain('TRACKING_GAP');
  });
});

describe('attempt record rejection', () => {
  const s = fixture();
  const reject = (mutate: (a: AttemptRecord) => void, source = measurable(s)) => { const a = clone(source); mutate(a); return attemptRecordSchema.safeParse(a).success; };
  it('accepts unchanged records', () => { for (const a of s.attempts) expect(attemptRecordSchema.safeParse(a).success).toBe(true); });
  it('rejects a measurable attempt with a missing metric', () => expect(reject((a) => { a.metrics.reachDurationSec = { value: null, unit: 'seconds', reasons: ['TIMEOUT'] }; })).toBe(false));
  it('rejects a null without reasons and a value with reasons', () => {
    expect(reject((a) => { a.metrics.elbowPeakDeg.reasons = ['TIMEOUT']; })).toBe(false);
    expect(reject((a) => { a.metrics.elbowPeakDeg.value = 3; }, excluded(s))).toBe(false);
  });
  it('rejects flags on excluded attempts and non-strict or mismatched flags', () => {
    expect(reject((a) => { a.flags = clone(flagged(s).flags); }, excluded(s))).toBe(false);
    expect(reject((a) => { a.flags[0]!.threshold = a.flags[0]!.observed; }, flagged(s))).toBe(false);
    expect(reject((a) => { a.flags[0]!.observed += 1; }, flagged(s))).toBe(false);
  });
  it('rejects wrong units, unknown reasons, extra fields and inverted ranges', () => {
    expect(reject((a) => { a.metrics.wristForwardPeak.unit = 'centimeters'; })).toBe(false);
    expect(reject((a) => { (a.reasons as string[]).push('MADE_UP'); }, excluded(s))).toBe(false);
    expect(reject((a) => { (a as Record<string, unknown>).observations = []; })).toBe(false);
    expect(reject((a) => { a.endMs = a.startMs - 1; })).toBe(false);
    expect(reject((a) => { a.metrics.elbowPeakDeg.value = Number.POSITIVE_INFINITY; })).toBe(false);
  });
});

describe('session record rejection', () => {
  const ok = fixture();
  const reject = (mutate: (s: SessionRecord) => void) => { const s = clone(ok); mutate(s); return sessionRecordSchema.safeParse(s).success; };
  it('accepts the fixture', () => expect(parseSessionRecord(ok).sessionId).toBe('fixture-session'));
  it('rejects attempts from another configuration and duplicates', () => {
    expect(reject((s) => { s.attempts[0]!.configurationId = 'other'; })).toBe(false);
    expect(reject((s) => { s.attempts.push(clone(s.attempts[0]!)); })).toBe(false);
  });
  it('rejects flags that disagree with configured criteria', () => {
    expect(reject((s) => { s.configuration.criteria = []; })).toBe(false);
    expect(reject((s) => { s.configuration.criteria[0]!.threshold = 1; })).toBe(false);
  });
  it('keeps fixture provenance and discomfort reports honest', () => {
    expect(reject((s) => { s.capture.stopReason = 'STOPPED'; })).toBe(false);
    expect(reject((s) => { s.provenance = { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' }; })).toBe(false);
    expect(reject((s) => { s.provenance = { kind: 'developer_validation_capture', label: 'Developer/judge validation · experimental · not participant use' }; s.capture.stopReason = 'DISCOMFORT_STOP'; })).toBe(false);
  });
  it('rejects incomplete attestation and recording evidence without bytes', () => {
    expect(reject((s) => { (s.attestation as { reported: boolean }).reported = false; })).toBe(false);
    expect(reject((s) => { s.recording = { ...s.recording, status: 'complete', reason: null }; })).toBe(false);
  });
});

describe('recording evidence and replay windows', () => {
  const complete: RecordingEvidence = { status: 'complete', mimeType: 'video/webm', sizeBytes: 10, durationMs: 5000, reason: null, timing: 'estimated_recorder_start' };
  it('maps recorder results without inventing completeness', () => {
    const blob = new Blob(['abc'], { type: 'video/webm' });
    expect(recordingEvidence({ blob, mimeType: 'video/webm', startMs: 100, endMs: 2100, complete: true, reason: null }, 'x')).toMatchObject({ status: 'complete', durationMs: 2000, sizeBytes: 3 });
    expect(recordingEvidence({ blob, mimeType: 'video/webm', startMs: 100, endMs: 2100, complete: false, reason: 'Camera access ended' }, 'x')).toMatchObject({ status: 'incomplete', reason: 'Camera access ended' });
    expect(recordingEvidence({ blob: new Blob([]), mimeType: 'video/webm', startMs: 0, endMs: 1, complete: false, reason: 'Recording is empty' }, 'x')).toMatchObject({ status: 'unavailable', reason: 'Recording is empty' });
    expect(recordingEvidence(null, 'No recording')).toMatchObject({ status: 'unavailable', reason: 'No recording' });
  });
  it('bounds live replay by the decoded video without changing measurement validity', () => {
    const attempt = { startMs: 200, endMs: 1500 };
    expect(replayWindow(attempt, complete, true, 1000)).toMatchObject({ available: false });
    expect(replayWindow(attempt, complete, true, 1700)).toMatchObject({ available: true, endSec: 1.7 });
    for (const duration of [null, NaN, Infinity, -1, 0]) {
      expect(replayWindow(attempt, complete, true, duration)).toMatchObject({ available: false });
    }
    const session = fixture();
    session.recording = { ...complete, durationMs: 1000 };
    expect(parseSessionRecord(session).attempts).toEqual(session.attempts);
    expect(summarizeSession(session)).toMatchObject({ detected: 4, measurable: 3, excluded: 1, flagged: 1 });
  });
  it('adds clamped context and refuses unavailable, undecodable, loading or out-of-range evidence', () => {
    expect(replayWindow({ startMs: 200, endMs: 1500 }, complete, true)).toEqual({ available: true, startSec: 0, endSec: 2, attemptStartSec: 0.2, attemptEndSec: 1.5 });
    expect(replayWindow({ startMs: 4000, endMs: 4800 }, complete, true)).toMatchObject({ available: true, endSec: 5 });
    expect(replayWindow({ startMs: 200, endMs: 1500 }, complete, false)).toMatchObject({ available: false });
    expect(replayWindow({ startMs: 200, endMs: 1500 }, complete, null)).toMatchObject({ available: false, reason: 'Video is still loading.' });
    expect(replayWindow({ startMs: 4000, endMs: 5100 }, complete, true)).toMatchObject({ available: false });
    expect(replayWindow({ startMs: 0, endMs: 1 }, { ...complete, status: 'unavailable', sizeBytes: 0, mimeType: null, durationMs: null, reason: 'none' }, true)).toEqual({ available: false, reason: 'none' });
  });
});

describe('catalog integration', () => {
  it('maps every engine metric to the catalog definition and unit', () => {
    const reach = exerciseById('seated_forward_reach');
    expect(reach.metrics.map((m) => m.id).sort()).toEqual(Object.values(CATALOG_METRIC_MAP).map((m) => m.catalogId).sort());
    for (const [metric, mapped] of Object.entries(CATALOG_METRIC_MAP)) {
      expect(reach.metrics.find((m) => m.id === mapped.catalogId)!.unit).toBe(mapped.catalogUnit);
      expect(metricUnits[metric as Metric].replace(' ', '_')).toBe(mapped.catalogUnit);
    }
  });
  it('keeps all six entries blocked for participant start; listing alone never enables', () => {
    expect(catalog.exercises).toHaveLength(6);
    for (const entry of catalog.exercises) {
      expect(participantStartAllowed(entry)).toBe(false);
      expect(readinessLabels(entry)).toEqual(['Needs clinical review', 'Needs technical validation']);
    }
    const promoted = { ...clone(catalog.exercises[0]!), clinicalReviewStatus: 'approved' as const, technicalStatus: 'validated' as const, availability: { status: 'available' as const, blockers: [] } };
    expect(participantStartAllowed(promoted)).toBe(false); // still no evidence records
    expect(participantStartAllowed({ ...promoted, validationEvidence: [{}] })).toBe(true);
  });
});

describe('setup validation blocks recording', () => {
  it('lists missing fields and blocks enabled criteria without valid thresholds', () => {
    const draft = emptySetup('2026-10-25');
    expect(setupErrors(draft).length).toBeGreaterThan(5);
    const s = fixture();
    const filled = { ...draft, mode: s.mode, participantLabel: 'P1', supervisorLabel: 'S1', attestationContext: 'Team test', attested: true, side: 'left' as const,
      seatingSupport: 'none', targetPlacement: 'desk mark', assignedRangeOrGoal: 'to target', teamTestConfirmed: true };
    expect(setupErrors(filled)).toEqual([]);
    const blank = { ...filled, criteria: filled.criteria.map((c, i) => i === 0 ? { ...c, enabled: true, threshold: '' } : c) };
    expect(setupErrors(blank)).toEqual([expect.stringContaining('numeric threshold')]);
  });
});
