// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildVideoReportInput, videoTemplateReport } from '../contracts/video-report.js';
import { renderClinicianReport, richText } from './video-report-view.js';

const input = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: 60_000, hasVideo: true, pace: {
  trackedSec: 50, angleMinDeg: 10, angleMaxDeg: 150, peakSpeedDegPerSec: 600, peakLimbLengthsPerSec: 5, fastWarnings: 1,
  events: [{ index: 1, tMs: 24_000, rep: 1, peakDegPerSec: 600, peakLimbPerSec: 5, severity: 'high' }],
  reps: [{ index: 1, startMs: 23_000, endMs: 26_000, minDeg: 10, maxDeg: 150, excursionDeg: 140, peakDegPerSec: 600, peakLimbPerSec: 5, warnings: 1 }],
  series: [{ tMs: 0, angleDeg: 10, degPerSec: 0, limbPerSec: 0 }, { tMs: 100, angleDeg: 12, degPerSec: 20, limbPerSec: 0.2 }, { tMs: 24_000, angleDeg: 90, degPerSec: 600, limbPerSec: 5 }, { tMs: 24_100, angleDeg: 120, degPerSec: 550, limbPerSec: 4.5 }],
} });

describe('clinician report view', () => {
  it('renders **bold** as <strong> without interpreting markup', () => {
    const p = document.createElement('p');
    richText(p, 'Peak **600 degrees per second** <img src=x onerror=alert(1)>');
    expect(p.querySelector('strong')?.textContent).toBe('600 degrees per second');
    expect(p.querySelector('img')).toBeNull();
  });

  it('shows the status banner, a red risk alert, a timeline marker that seeks the replay and two charts', () => {
    const ids = ['root', 'bannerIcon', 'bannerStatus', 'headline', 'rom', 'speed', 'alerts', 'timeline', 'charts', 'tracking', 'points'] as const;
    const ui = Object.fromEntries(ids.map((id) => [id, document.createElement('div')])) as unknown as Parameters<typeof renderClinicianReport>[0];
    const seek = vi.fn();
    renderClinicianReport(ui, input, videoTemplateReport(input), [], seek);
    expect(ui.root.dataset.status).toBe('high');
    expect(ui.bannerStatus.textContent).toBe('Overall: High strain risk');
    expect(ui.alerts.querySelector('h4')?.textContent).toBe('🔴 HIGH STRAIN RISK — Rep 1 (0:24)');
    (ui.timeline.querySelector('.vr-marker') as HTMLButtonElement).click();
    expect(seek).toHaveBeenCalledWith(24);
    expect(ui.charts.querySelectorAll('figure')).toHaveLength(2);
    expect(ui.points.querySelectorAll('li').length).toBeGreaterThan(0);
  });
});
