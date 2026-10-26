import { reasonText, type Metric, type Reason } from '../../analysis/reach-contract.js';
import { CATALOG_METRIC_MAP, type AttemptRecord, type RecordingEvidence, type SessionRecord } from '../../contracts/reach-session.js';

const UNIT_SUFFIX: Record<Metric, string> = { elbowPeakDeg: '°', torsoForwardPeakDeg: '°', wristForwardPeak: ' reference lengths', reachDurationSec: ' s' };
const DIGITS: Record<Metric, number> = { elbowPeakDeg: 1, torsoForwardPeakDeg: 1, wristForwardPeak: 2, reachDurationSec: 2 };

/** Display rounding only; criteria are evaluated on full-precision values by the engine. */
export function formatMetric(metric: Metric, value: number): string {
  return `${value.toFixed(DIGITS[metric])}${UNIT_SUFFIX[metric]}`;
}
export const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
export const reasonList = (reasons: readonly Reason[]) => reasons.map((r) => reasonText[r]);

/** Enough precision that observed and threshold never look equal when the engine found a strict exceedance. */
export function flagText(flag: AttemptRecord['flags'][number]): string {
  let digits = DIGITS[flag.metric];
  while (digits < 6 && flag.observed.toFixed(digits) === flag.threshold.toFixed(digits)) digits++;
  const unit = UNIT_SUFFIX[flag.metric];
  return `${CATALOG_METRIC_MAP[flag.metric].short} ${flag.observed.toFixed(digits)}${unit} exceeded the configured ${flag.operator} ${flag.threshold}${unit} review criterion. Review replay.`;
}

export function criterionText(c: SessionRecord['configuration']['criteria'][number]): string {
  return `${CATALOG_METRIC_MAP[c.metric].short} ${c.operator} ${c.threshold}${UNIT_SUFFIX[c.metric]}`;
}

export function recordingText(r: RecordingEvidence): string {
  if (r.status === 'unavailable') return `Recording unavailable: ${r.reason ?? 'no video'}`;
  const size = `${(r.sizeBytes / 1024).toFixed(0)} KiB`;
  const base = `${r.mimeType}, ${size}, ${formatSeconds(r.durationMs ?? 0)}`;
  return r.status === 'complete' ? `Recording finalized (${base}).` : `Incomplete recording (${base}): ${r.reason}.`;
}

export const STOP_TEXT: Record<SessionRecord['capture']['stopReason'], string> = {
  STOPPED: 'Stopped by the supervisor or participant.', DISCOMFORT_STOP: 'Stopped after reported discomfort.', SETUP_CHANGED: 'Stopped after a setup change.',
  CAPTURE_FAILED: 'Capture ended because of a camera, tracking or recording failure.', SYNTHETIC_FIXTURE: 'Synthetic fixture: no capture occurred.',
};

export const STATE_TEXT: Record<string, string> = {
  WAITING_FOR_RECORDER: 'Starting the recorder…', REACQUIRE_REST: 'Hold the resting position until REST is shown.', REST: 'REST — ready. Reach toward the target and return when instructed.',
  OUTWARD: 'OUTWARD — moving toward the target.', TARGET: 'TARGET — in the image target region.', RETURN: 'RETURN — returning to rest.',
};
