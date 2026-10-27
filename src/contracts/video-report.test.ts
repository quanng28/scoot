import { describe, expect, it } from 'vitest';
import { videoReportTestInput as input, videoReportTestPace as pace } from './video-report.test-fixtures.js';
import { buildVideoReportInput, buildVideoReportPrompt, validateVideoReport, videoReportFacts, videoReportInputSchema, videoTemplateReport } from './video-report.js';


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

  it('reports insufficient data for a take with no tracked pose without inventing data', () => {
    const empty = buildVideoReportInput({ exerciseId: 'seated_knee_extension', side: 'right', stopReason: 'CAPTURE_FAILED', recordingDurationMs: null, hasVideo: false, pace: null });
    expect(empty).toMatchObject({ overall: 'insufficient_data', capture: { recordingStatus: 'unavailable' }, events: [], reps: [] });
    expect(videoTemplateReport(empty).headline).toContain('**Insufficient data**');
    expect(videoTemplateReport(empty).headline).not.toContain('controlled');
    expect(buildVideoReportPrompt(empty)).toContain('Overall status: Insufficient data.');
    expect(videoReportInputSchema.safeParse({ ...empty, overall: 'controlled' }).success).toBe(false);
    expect(validateVideoReport(empty, videoTemplateReport(empty)).ok).toBe(true);
  });

  it('reports insufficient data when coverage is unknown despite measured angles and high events', () => {
    const unknown = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'CAPTURE_FAILED', recordingDurationMs: null, hasVideo: false, pace });
    expect(unknown.overall).toBe('insufficient_data');
    expect(videoTemplateReport(unknown).headline).toContain('**Insufficient data**');
    expect(validateVideoReport(unknown, videoTemplateReport(unknown)).ok).toBe(true);
  });

  it.each(['angleMinDeg', 'angleMaxDeg'] as const)('reports insufficient data when %s is missing despite known coverage', (bound) => {
    const missing = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: 60_000, hasVideo: true, pace: { ...pace, [bound]: null } });
    expect(missing.tracking.coverage).not.toBeNull();
    expect(missing.overall).toBe('insufficient_data');
  });

  it('retains controlled status with measured angles, known adequate coverage and no warnings', () => {
    const calm = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: 60_000, hasVideo: true,
      pace: { ...pace, trackedSec: 60, fastWarnings: 0, events: [] } });
    expect(calm.overall).toBe('controlled');
  });
});
