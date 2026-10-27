import type { PaceSummary } from '../analysis/pace-monitor.js';
import { buildVideoReportInput } from './video-report.js';

export const videoReportTestPace: PaceSummary = {
  trackedSec: 17.25, angleMinDeg: 8.04, angleMaxDeg: 164.7, peakSpeedDegPerSec: 844.4, peakLimbLengthsPerSec: 6.123, fastWarnings: 2,
  events: [{ index: 1, tMs: 24_300, rep: 1, peakDegPerSec: 844.4, peakLimbPerSec: 6.12, severity: 'high' }, { index: 2, tMs: 41_000, rep: 2, peakDegPerSec: 230, peakLimbPerSec: 2.7, severity: 'moderate' }],
  reps: [{ index: 1, startMs: 23_000, endMs: 26_000, minDeg: 9, maxDeg: 160, excursionDeg: 150.2, peakDegPerSec: 844.4, peakLimbPerSec: 6.12, warnings: 1 },
    { index: 2, startMs: 40_000, endMs: 43_500, minDeg: 9, maxDeg: 120, excursionDeg: 110, peakDegPerSec: 230, peakLimbPerSec: 2.7, warnings: 1 },
    { index: 3, startMs: 50_000, endMs: 54_000, minDeg: 9, maxDeg: 100, excursionDeg: 90, peakDegPerSec: 95, peakLimbPerSec: 1.1, warnings: 0 }],
  series: [],
};
export const videoReportTestInput = buildVideoReportInput({ exerciseId: 'seated_forward_arm_raise', side: 'left', stopReason: 'STOPPED', recordingDurationMs: 60_010, hasVideo: true, pace: videoReportTestPace });
