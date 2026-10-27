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

describe('video-report-validator.v3 status fidelity and number attribution', () => {
  const build = (patch: Partial<typeof pace>, durationMs: number | null = 60_000) =>
    buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: durationMs, hasVideo: durationMs !== null, pace: { ...pace, ...patch } });
  const statuses = {
    high: input,
    reviewWarnings: build({ trackedSec: 60, fastWarnings: 1, events: [pace.events[1]!] }),
    reviewCoverage: build({ fastWarnings: 0, events: [] }),
    controlled: build({ trackedSec: 60, fastWarnings: 0, events: [] }),
    insufficient: build({ angleMinDeg: null }),
  };
  const issues = (target: typeof input, patch: object) => { const r = validateVideoReport(target, { ...videoTemplateReport(target), ...patch }); return r.ok ? '' : r.issues.join(' | '); };

  it('derives every status fixture and accepts each deterministic template', () => {
    expect(Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, v.overall])))
      .toEqual({ high: 'high', reviewWarnings: 'review', reviewCoverage: 'review', controlled: 'controlled', insufficient: 'insufficient_data' });
    for (const target of Object.values(statuses)) expect(validateVideoReport(target, videoTemplateReport(target))).toMatchObject({ ok: true });
  });

  it('rejects a headline that contradicts or omits the supplied overall status', () => {
    expect(issues(statuses.high, { headline: 'Movements stayed **controlled**, with no fast-movement warnings.' })).toContain('headline: contradicts the overall status');
    expect(issues(statuses.insufficient, { headline: 'Movements stayed **controlled** throughout.' })).toContain('headline: contradicts the overall status');
    expect(issues(statuses.controlled, { headline: '**Insufficient data**: angles are unavailable.' })).toContain('headline: contradicts the overall status');
    expect(issues(statuses.reviewWarnings, { headline: 'Movement reached **high strain risk** levels. Replay review is recommended.' })).toContain('headline: contradicts the overall status');
    expect(issues(statuses.controlled, { headline: 'Movements **need review**.' })).toContain('headline: contradicts the overall status');
    expect(issues(statuses.high, { headline: 'The recording was analysed.' })).toContain('headline: does not state the overall status');
    expect(issues(statuses.insufficient, { speedAndControl: 'Rep 3 was **controlled**.' })).toContain('speedAndControl: describes movement as controlled with insufficient data');
    // "uncontrolled" is not the status word; legitimate review headlines still pass.
    expect(issues(statuses.high, { headline: '**2 fast-movement warnings**, including **1 high strain risk** event with uncontrolled speed. Review is recommended.' })).toBe('');
  });

  it('rejects numbers that exist in the facts but are attributed to the wrong quantity', () => {
    expect(issues(statuses.high, { trackingQuality: 'Body tracking covered **2%** of the recording.' })).toContain('trackingQuality: number 2% is not the tracking coverage');
    expect(issues(statuses.insufficient, { trackingQuality: 'Body tracking covered **100 percent** of the recording.' })).toContain('number 100%');
    expect(issues(statuses.high, { headline: '**1 fast-movement warnings**, including **2 high strain risk** events. Replay review is recommended.' }))
      .toMatch(/headline: number 1 is not the fast-movement warning count.*headline: number 2 is not the high strain risk event count/);
    expect(issues(statuses.high, { speedAndControl: 'Peak angular speed was **95 degrees per second**, **5.6 times** the limit.' })).toBe('');
    expect(issues(statuses.high, { speedAndControl: 'Peak angular speed was **8 degrees per second**.' })).toContain('number 8 is not a measured or limit angular speed');
    expect(issues(statuses.high, { speedAndControl: 'Peak wrist speed was **2 limb lengths per second**.' })).toContain('number 2 is not a measured or limit limb speed');
    expect(issues(statuses.high, { speedAndControl: 'Peak angular speed was **844 degrees per second**, **3 times** the limit.' })).toContain('number 3 is not a stated multiple of a limit');
    expect(issues(statuses.high, { rangeOfMotion: 'Observed angle ranged from **8.0** to **9 degrees**.' })).toContain('number 9 is not a measured angle');
    // Per-rep warning counts remain valid outside the overall headline.
    expect(issues(statuses.high, { speedAndControl: 'Rep 1 had **1 fast-movement warning**; reps without warnings: **3**.' })).toBe('');
  });
});
