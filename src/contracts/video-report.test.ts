import { describe, expect, it } from 'vitest';
import type { PaceSummary } from '../analysis/pace-monitor.js';
import { buildVideoReportInput, validateVideoReport, videoReportFacts, videoTemplateReport } from './video-report.js';

const pace: PaceSummary = {
  trackedSec: 17.25, angleMinDeg: 8.04, angleMaxDeg: 164.7, peakSpeedDegPerSec: 844.4, peakLimbLengthsPerSec: 6.123, fastWarnings: 2,
  events: [{ index: 1, tMs: 24_300, rep: 1, peakDegPerSec: 844.4, peakLimbPerSec: 6.12, severity: 'high' }, { index: 2, tMs: 41_000, rep: 2, peakDegPerSec: 230, peakLimbPerSec: 2.7, severity: 'moderate' }],
  reps: [{ index: 1, startMs: 23_000, endMs: 26_000, minDeg: 9, maxDeg: 160, excursionDeg: 150.2, peakDegPerSec: 844.4, peakLimbPerSec: 6.12, warnings: 1 },
    { index: 2, startMs: 40_000, endMs: 43_500, minDeg: 9, maxDeg: 120, excursionDeg: 110, peakDegPerSec: 230, peakLimbPerSec: 2.7, warnings: 1 },
    { index: 3, startMs: 50_000, endMs: 54_000, minDeg: 9, maxDeg: 100, excursionDeg: 90, peakDegPerSec: 95, peakLimbPerSec: 1.1, warnings: 0 }],
  series: [],
};
const input = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: 60_010, hasVideo: true, pace });

describe('video-only clinician report contract', () => {
  it('derives a locally computed overall status, coverage and timestamped facts', () => {
    expect(input.overall).toBe('high');
    expect(input.tracking.coverage).toBe(0.29);
    const facts = videoReportFacts(input).map((f) => f.text).join('\n');
    expect(facts).toContain('Event 1 at 0:24 during rep 1: high strain risk, peak 844 degrees per second (5.6 times the limit)');
    expect(facts).toContain('Reps without fast-movement warnings: 3.');
  });

  it('accepts its own deterministic template, which uses risk-level wording and bold numbers', () => {
    const report = videoTemplateReport(input);
    expect(validateVideoReport(input, report)).toMatchObject({ ok: true });
    expect(report.riskAlerts[0]!.text).toContain('**may increase the risk of muscle soreness or strain**');
    expect(report.headline).toContain('**2 fast-movement warnings**');
  });

  it('rejects invented numbers, diagnosis, certainty, unhedged pain claims and missing alerts', () => {
    const t = videoTemplateReport(input);
    const issues = (patch: object) => { const r = validateVideoReport(input, { ...t, ...patch }); return r.ok ? [] : r.issues.join(' | '); };
    expect(issues({ headline: 'Peak speed was **912 degrees per second**.' })).toContain('number 912');
    expect(issues({ rangeOfMotion: 'This pattern suggests a diagnosis of shoulder impingement.' })).toContain('diagnosis');
    expect(issues({ speedAndControl: 'These movements will cause shoulder damage.' })).toContain('certainty');
    expect(issues({ trackingQuality: 'The patient felt pain during rep 1.' })).toContain('unhedged risk statement');
    expect(issues({ clinicianPoints: ['Prescribe 2 mg of medication.'] })).toContain('prescription');
    expect(issues({ riskAlerts: t.riskAlerts.slice(0, 1) })).toContain('riskAlerts must cover each event');
    expect(issues({ headline: '<b>2</b> warnings' })).toContain('unsupported formatting');
  });

  it('handles a take with no tracked pose as controlled-but-limited without inventing data', () => {
    const empty = buildVideoReportInput({ exerciseId: 'seated_knee_extension', side: 'right', stopReason: 'CAPTURE_FAILED', recordingDurationMs: null, hasVideo: false, pace: null });
    expect(empty).toMatchObject({ overall: 'controlled', capture: { recordingStatus: 'unavailable' }, events: [], reps: [] });
    expect(validateVideoReport(empty, videoTemplateReport(empty)).ok).toBe(true);
  });
});
