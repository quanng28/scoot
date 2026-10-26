import { z } from 'zod';
import { PACE_ANGLE_LABEL, PACE_DISTAL_LABEL, PACE_MONITOR_VERSION, PACE_SETTINGS, type PaceSummary } from '../analysis/pace-monitor.js';
import { EXERCISE_REQUIRED_LANDMARKS } from '../features/practice/tracking.js';
import { STOP_REASONS } from './reach-session.js';
import { REPORT_EXERCISES, reportProvenanceSchema } from './provider-report.js';

/**
 * Clinician report for video-only recordings (Record pressed before measurement setup). The input is an
 * allowlisted DTO of calibration-free pace facts: no video, landmarks, IDs or free text leave the device.
 * Gemini interprets the facts for a clinician under guardrails enforced by validateVideoReport (both on the
 * server and again in the browser): every number must come from the facts, no diagnosis or certainty
 * wording, and any soreness/strain statement must be hedged as a risk. A deterministic template with the
 * same structure is always shown first, so the report never depends on the provider.
 */
export const VIDEO_REPORT_INPUT_VERSION = 'video-report-input.v2';
export const VIDEO_REPORT_PROMPT_VERSION = 'video-report-prompt.v2';
export const VIDEO_REPORT_VALIDATOR_VERSION = 'video-report-validator.v2';
export const VIDEO_REPORT_LABEL = 'AI-assisted clinician summary · experimental · not a diagnosis' as const;

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const angle = finite.min(0).max(180);
const speed = nonNegative.max(100_000);
const sec = nonNegative.max(120);
export const OVERALL_STATUSES = ['controlled', 'review', 'high'] as const;
export type OverallStatus = typeof OVERALL_STATUSES[number];
export const OVERALL_LABEL: Record<OverallStatus, string> = { controlled: 'Controlled', review: 'Needs review', high: 'High strain risk' };
/** Below this share of the recording tracked, the report is at least "Needs review". */
export const MIN_TRACKING_COVERAGE = 0.6;

export const videoReportInputSchema = z.strictObject({
  schemaVersion: z.literal(VIDEO_REPORT_INPUT_VERSION),
  exercise: z.strictObject({ id: z.enum(REPORT_EXERCISES), side: z.enum(['left', 'right']) }),
  capture: z.strictObject({ stopReason: z.enum(STOP_REASONS), recordingStatus: z.enum(['complete', 'incomplete', 'unavailable']), recordingDurationSec: sec.nullable() }),
  tracking: z.strictObject({ trackedSec: sec, coverage: finite.min(0).max(1).nullable() }),
  pace: z.strictObject({
    monitorVersion: z.literal(PACE_MONITOR_VERSION),
    fastDegPerSec: z.literal(PACE_SETTINGS.fastDegPerSec), fastLimbLengthsPerSec: z.literal(PACE_SETTINGS.fastLimbLengthsPerSec),
    angleMinDeg: angle.nullable(), angleMaxDeg: angle.nullable(),
    peakDegPerSec: speed.nullable(), peakLimbLengthsPerSec: speed.nullable(),
    fastWarnings: z.number().int().nonnegative().max(1000),
  }),
  reps: z.array(z.strictObject({ index: z.number().int().min(1).max(30), startSec: sec, endSec: sec, excursionDeg: angle, peakDegPerSec: speed, peakLimbLengthsPerSec: speed,
    warnings: z.number().int().nonnegative().max(1000) })).max(PACE_SETTINGS.maxReps),
  events: z.array(z.strictObject({ index: z.number().int().min(1).max(1000), tSec: sec, rep: z.number().int().min(1).max(30).nullable(),
    peakDegPerSec: speed, peakLimbLengthsPerSec: speed, severity: z.enum(['moderate', 'high']) })).max(PACE_SETTINGS.maxEvents),
  overall: z.enum(OVERALL_STATUSES),
}).superRefine((input, ctx) => {
  if (input.overall !== overallStatus(input)) ctx.addIssue({ code: 'custom', message: 'overall status disagrees with the facts' });
  input.reps.forEach((r, i) => { if (r.index !== i + 1 || r.endSec < r.startSec) ctx.addIssue({ code: 'custom', message: `rep ${i + 1} out of order` }); });
});
export type VideoReportInput = z.infer<typeof videoReportInputSchema>;
export const videoReportRequestSchema = z.strictObject({ videoInput: videoReportInputSchema });

function overallStatus(input: Pick<VideoReportInput, 'events' | 'tracking' | 'pace'>): OverallStatus {
  if (input.events.some((e) => e.severity === 'high')) return 'high';
  if (input.pace.fastWarnings > 0 || (input.tracking.coverage !== null && input.tracking.coverage < MIN_TRACKING_COVERAGE)) return 'review';
  return 'controlled';
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);

export function buildVideoReportInput(options: { exerciseId: VideoReportInput['exercise']['id']; side: 'left' | 'right'; stopReason: VideoReportInput['capture']['stopReason'];
  recordingDurationMs: number | null; hasVideo: boolean; pace: PaceSummary | null }): VideoReportInput {
  const pace = options.pace;
  const duration = options.recordingDurationMs === null ? null : Math.min(120, options.recordingDurationMs / 1000);
  const trackedSec = Math.min(120, pace?.trackedSec ?? 0);
  // Values are rounded to their display precision here so facts, prompt and validator agree exactly.
  const draft = {
    schemaVersion: VIDEO_REPORT_INPUT_VERSION,
    exercise: { id: options.exerciseId, side: options.side },
    capture: { stopReason: options.stopReason, recordingStatus: !options.hasVideo ? 'unavailable' : options.stopReason === 'STOPPED' ? 'complete' : 'incomplete',
      recordingDurationSec: duration === null ? null : r2(duration) },
    tracking: { trackedSec: r2(trackedSec), coverage: duration ? r2(Math.min(1, trackedSec / duration)) : null },
    pace: { monitorVersion: PACE_MONITOR_VERSION, fastDegPerSec: PACE_SETTINGS.fastDegPerSec, fastLimbLengthsPerSec: PACE_SETTINGS.fastLimbLengthsPerSec,
      angleMinDeg: pace?.angleMinDeg === null || pace?.angleMinDeg === undefined ? null : r1(pace.angleMinDeg),
      angleMaxDeg: pace?.angleMaxDeg === null || pace?.angleMaxDeg === undefined ? null : r1(pace.angleMaxDeg),
      peakDegPerSec: pace?.peakSpeedDegPerSec === null || pace?.peakSpeedDegPerSec === undefined ? null : r0(pace.peakSpeedDegPerSec),
      peakLimbLengthsPerSec: pace?.peakLimbLengthsPerSec === null || pace?.peakLimbLengthsPerSec === undefined ? null : r2(pace.peakLimbLengthsPerSec),
      fastWarnings: pace?.fastWarnings ?? 0 },
    reps: (pace?.reps ?? []).map((r) => ({ index: r.index, startSec: r2(r.startMs / 1000), endSec: r2(r.endMs / 1000), excursionDeg: r1(Math.min(180, r.excursionDeg)),
      peakDegPerSec: r0(r.peakDegPerSec), peakLimbLengthsPerSec: r2(r.peakLimbPerSec), warnings: r.warnings })),
    events: (pace?.events ?? []).map((e) => ({ index: e.index, tSec: r2(Math.min(120, e.tMs / 1000)), rep: e.rep, peakDegPerSec: r0(e.peakDegPerSec), peakLimbLengthsPerSec: r2(e.peakLimbPerSec), severity: e.severity })),
  } as const;
  return videoReportInputSchema.parse({ ...draft, overall: overallStatus(draft as unknown as VideoReportInput) });
}

/** m:ss for replay timestamps. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ratio = (v: number, limit: number) => (v / limit).toFixed(1);
const pct = (c: number) => `${Math.round(c * 100)}`;
const STOP_TEXT: Record<string, string> = { STOPPED: 'stopped by the user', DISCOMFORT_STOP: 'stopped after reported discomfort', SETUP_CHANGED: 'stopped because the setup changed',
  CAPTURE_FAILED: 'ended because capture failed or was interrupted', SYNTHETIC_FIXTURE: 'synthetic fixture, no live capture' };

export type VideoReportFact = { id: string; text: string };

/** Deterministic, numbered facts: the prompt shows them and every number Gemini writes must appear in them. */
export function videoReportFacts(input: VideoReportInput): VideoReportFact[] {
  const p = input.pace, c = input.capture, t = input.tracking, label = PACE_ANGLE_LABEL[input.exercise.id], distal = PACE_DISTAL_LABEL[input.exercise.id];
  const facts: VideoReportFact[] = [
    { id: 'overall', text: `Overall status: ${OVERALL_LABEL[input.overall]}.` },
    { id: 'capture', text: `Capture ${STOP_TEXT[c.stopReason] ?? c.stopReason.toLowerCase()}. Recording: ${c.recordingStatus}${c.recordingDurationSec === null ? '' : `, ${c.recordingDurationSec.toFixed(2)} seconds`}.` },
    { id: 'tracking', text: t.coverage === null ? `The ${input.exercise.side} side was tracked for ${t.trackedSec.toFixed(2)} seconds.`
      : `Body tracking covered ${pct(t.coverage)}% of the recording (${t.trackedSec.toFixed(2)} seconds), on the ${input.exercise.side} side.` },
  ];
  if (p.angleMinDeg !== null && p.angleMaxDeg !== null)
    facts.push({ id: 'rom', text: `Observed ${label} ranged from ${p.angleMinDeg.toFixed(1)} to ${p.angleMaxDeg.toFixed(1)} degrees (span ${(p.angleMaxDeg - p.angleMinDeg).toFixed(1)} degrees).` });
  facts.push({ id: 'reps', text: `${input.reps.length} repetitions were segmented from the ${label}.` });
  for (const r of input.reps) facts.push({ id: `rep.${r.index}`, text: `Rep ${r.index} (${clock(r.startSec)} to ${clock(r.endSec)}): excursion ${r.excursionDeg.toFixed(1)} degrees, peak angular speed ${r.peakDegPerSec} degrees per second, peak ${distal} speed ${r.peakLimbLengthsPerSec.toFixed(2)} limb lengths per second, ${r.warnings} fast-movement warnings.` });
  const calm = input.reps.filter((r) => r.warnings === 0).map((r) => r.index);
  facts.push({ id: 'reps.controlled', text: calm.length ? `Reps without fast-movement warnings: ${calm.join(', ')}.` : 'No repetition was free of fast-movement warnings.' });
  if (p.peakDegPerSec !== null) facts.push({ id: 'peak.angular', text: `Peak angular speed ${p.peakDegPerSec} degrees per second, ${ratio(p.peakDegPerSec, p.fastDegPerSec)} times the ${p.fastDegPerSec} degrees per second fast-movement limit.` });
  if (p.peakLimbLengthsPerSec !== null) facts.push({ id: 'peak.linear', text: `Peak ${distal} speed ${p.peakLimbLengthsPerSec.toFixed(2)} limb lengths per second, ${ratio(p.peakLimbLengthsPerSec, p.fastLimbLengthsPerSec)} times the ${p.fastLimbLengthsPerSec} limb lengths per second limit.` });
  facts.push({ id: 'warnings', text: `Fast-movement warnings: ${p.fastWarnings}${p.fastWarnings > input.events.length ? ` (first ${input.events.length} listed)` : ''}.` });
  for (const e of input.events) facts.push({ id: `event.${e.index}`, text: `Event ${e.index} at ${clock(e.tSec)}${e.rep === null ? '' : ` during rep ${e.rep}`}: ${e.severity} strain risk, peak ${e.peakDegPerSec} degrees per second (${ratio(e.peakDegPerSec, p.fastDegPerSec)} times the limit), ${distal} ${e.peakLimbLengthsPerSec.toFixed(2)} limb lengths per second (${ratio(e.peakLimbLengthsPerSec, p.fastLimbLengthsPerSec)} times the limit).` });
  return facts;
}

/** Generated report structure (after JSON parsing). Text may use **bold** only. */
export const clinicianReportSchema = z.strictObject({
  headline: z.string().trim().min(1).max(300),
  rangeOfMotion: z.string().trim().min(1).max(600),
  speedAndControl: z.string().trim().min(1).max(800),
  riskAlerts: z.array(z.strictObject({ event: z.number().int().min(1).max(1000), text: z.string().trim().min(1).max(400) })).max(PACE_SETTINGS.maxEvents),
  trackingQuality: z.string().trim().min(1).max(500),
  clinicianPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
});
export type ClinicianReport = z.infer<typeof clinicianReportSchema>;

export const GEMINI_CLINICIAN_REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence for the coloured status banner. Bold the key numbers with **.' },
    rangeOfMotion: { type: 'string', description: 'Two sentences at most about the observed angle range and repetitions.' },
    speedAndControl: { type: 'string', description: 'Up to three sentences about peak speeds versus the limits and which reps stayed controlled.' },
    riskAlerts: { type: 'array', description: 'Exactly one entry per listed event, in event order.', items: { type: 'object', properties: {
      event: { type: 'integer', description: 'Event number from the facts.' },
      text: { type: 'string', description: 'One or two sentences: the speed and multiple of the limit in bold, then the hedged strain risk in bold.' } }, required: ['event', 'text'] } },
    trackingQuality: { type: 'string', description: 'One or two sentences on tracking coverage and how it limits the findings.' },
    clinicianPoints: { type: 'array', description: '2 to 5 short review points for the clinician, each starting with a verb such as Review, Consider or Confirm.', items: { type: 'string' } },
  },
  required: ['headline', 'rangeOfMotion', 'speedAndControl', 'riskAlerts', 'trackingQuality', 'clinicianPoints'],
} as const;

export const VIDEO_REPORT_SYSTEM_INSTRUCTION = [
  'You write a short, clear summary for a clinician (physiotherapist or doctor) who will review a recorded seated rehabilitation exercise.',
  'The data come from a single phone camera and 2D pose estimation, without measurement setup.',
  'Rules:',
  '- Use only the numbered FACTS. Every number you write must appear in the facts exactly as written. Do not compute new numbers.',
  '- Mark key numbers and risk phrases with **double asterisks** (bold). Use no other formatting, no headings, no lists, no emoji, no links.',
  '- Describe fast movements as a risk, never as a certainty: write "may increase the risk of muscle soreness or strain"; never say pain or injury will happen or has happened.',
  '- Do not diagnose, name medical conditions, predict recovery, prescribe exercises, doses or medication, or declare anything safe or unsafe.',
  '- riskAlerts: exactly one entry per listed event, in order. Lead with the speed and its multiple of the limit, then the hedged risk.',
  '- clinicianPoints: practical review suggestions for the clinician, for example reviewing the replay at a listed time, considering pacing guidance, improving camera framing, or confirming discomfort directly with the patient (the camera cannot detect pain).',
  '- Professional, concise wording. Speak about "the patient" in the third person.',
].join('\n');

export function buildVideoReportPrompt(input: VideoReportInput): string {
  return [
    `Exercise: ${input.exercise.id}. Monitored angle: ${PACE_ANGLE_LABEL[input.exercise.id]}. Pace monitor ${input.pace.monitorVersion}.`,
    `Events to cover in riskAlerts: ${input.events.length ? input.events.map((e) => e.index).join(', ') : 'none (return an empty riskAlerts array)'}.`,
    'FACTS (id: text):',
    ...videoReportFacts(input).map((f) => `${f.id}: ${f.text}`),
  ].join('\n');
}

/** Deterministic clinician report with the same structure; shown immediately and used by the mock provider. */
export function videoTemplateReport(input: VideoReportInput): ClinicianReport {
  const p = input.pace, t = input.tracking, label = PACE_ANGLE_LABEL[input.exercise.id];
  const high = input.events.filter((e) => e.severity === 'high');
  const lowCoverage = t.coverage !== null && t.coverage < MIN_TRACKING_COVERAGE;
  const headline = (input.overall === 'controlled' ? 'Movements stayed **controlled**, with no fast-movement warnings.'
    : high.length ? `**${p.fastWarnings} fast-movement warnings**, including **${high.length} high strain risk** events. Replay review is recommended.`
    : p.fastWarnings ? `**${p.fastWarnings} fast-movement warnings** were raised. Replay review is recommended.`
    : 'No fast-movement warnings, but tracking was limited.') + (lowCoverage ? ` Tracking covered only **${pct(t.coverage!)}%** of the recording.` : '');
  const rangeOfMotion = p.angleMinDeg !== null && p.angleMaxDeg !== null
    ? `Observed ${label} ranged from **${p.angleMinDeg.toFixed(1)}** to **${p.angleMaxDeg.toFixed(1)} degrees** across **${input.reps.length}** segmented repetitions.`
    : `The ${label} could not be measured in this recording.`;
  const calm = input.reps.filter((r) => r.warnings === 0).map((r) => r.index);
  const speedAndControl = [
    p.peakDegPerSec !== null ? `Peak angular speed was **${p.peakDegPerSec} degrees per second**, **${ratio(p.peakDegPerSec, p.fastDegPerSec)} times** the fast-movement limit.` : 'Angular speed was not measured.',
    input.reps.length ? (calm.length ? `Reps without fast-movement warnings: **${calm.join(', ')}**.` : 'No repetition was free of fast-movement warnings.') : '',
  ].filter(Boolean).join(' ');
  const riskAlerts = input.events.map((e) => ({ event: e.index, text: e.severity === 'high'
    ? `Movement reached **${e.peakDegPerSec} degrees per second**, about **${ratio(e.peakDegPerSec, p.fastDegPerSec)} times** the limit. Movements this fast **may increase the risk of muscle soreness or strain**.`
    : `Movement reached **${e.peakDegPerSec} degrees per second**, above the ${p.fastDegPerSec} degrees per second limit. Repeated fast movements **may increase the risk of muscle soreness**.` }));
  const trackingQuality = t.coverage === null ? 'Tracking coverage could not be determined.'
    : `Body tracking covered **${pct(t.coverage)}%** of the recording.${lowCoverage ? ' Movements outside tracked periods were not assessed, so fast movements may be under-counted.' : ''}`;
  const clinicianPoints = [
    ...(input.events.length ? [`Review the replay at ${input.events.slice(0, 5).map((e) => clock(e.tSec)).join(', ')}.`] : []),
    ...(p.fastWarnings ? ['Consider whether pacing guidance, such as a slow count during each raise, suits this patient.'] : []),
    ...(lowCoverage ? [`Consider re-recording with the ${EXERCISE_REQUIRED_LANDMARKS[input.exercise.id].join(', ')} clearly in view.`] : []),
    'Confirm any soreness or discomfort directly with the patient; the camera cannot detect pain.',
  ];
  return { headline, rangeOfMotion, speedAndControl, riskAlerts, trackingQuality, clinicianPoints };
}

const BANNED: [RegExp, string][] = [
  [/\bdiagnos/i, 'diagnosis'], [/\b(has|have|suffers?|suffering) (from )?(a |an )?(stroke|hemipare|spastic|tear|injur|tendin|bursitis|impingement|frozen)/i, 'condition claim'],
  [/\bwill (cause|hurt|lead|result|injure|damage)/i, 'certainty'], [/\b(definitely|certainly|guarantee[ds]?|always causes?)\b/i, 'certainty'],
  [/\b(torn|tear|fracture|dislocat|rupture)\w*/i, 'injury claim'], [/\b(prescri\w*|medication|drug|dose|mg)\b/i, 'prescription'],
  [/\b(is|was|are|were) (safe|unsafe)\b|\bdangerous(ly)?\b|\bemergency\b/i, 'safety judgement'],
];
const RISK_WORD = /\b(pain\w*|sore\w*|strain\w*|injur\w*|damage\w*|hurt\w*)\b/i;
const HEDGE = /\b(may|might|could|risk|possible|possibly|potential)\b/i;
const MARKUP = /[<>#[\]`_]|\*(?!\*)|https?:/;

/** Guardrail acceptance for generated (or template) clinician text. */
export function validateVideoReport(input: VideoReportInput, raw: unknown): { ok: true; report: ClinicianReport } | { ok: false; issues: string[] } {
  const parsed = clinicianReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: ['schema'] };
  const report = parsed.data, issues: string[] = [];
  const allowed = new Set<string>(Array.from({ length: 11 }, (_, i) => String(i)));
  for (const f of videoReportFacts(input)) for (const n of f.text.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(n);
  const texts: [string, string][] = [['headline', report.headline], ['rangeOfMotion', report.rangeOfMotion], ['speedAndControl', report.speedAndControl], ['trackingQuality', report.trackingQuality],
    ...report.riskAlerts.map((a, i): [string, string] => [`riskAlert.${i + 1}`, a.text]), ...report.clinicianPoints.map((p, i): [string, string] => [`clinicianPoint.${i + 1}`, p])];
  for (const [where, text] of texts) {
    for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.has(n)) { issues.push(`${where}: number ${n} is not in the facts`); break; }
    for (const [pattern, name] of BANNED) if (pattern.test(text)) issues.push(`${where}: ${name}`);
    if (MARKUP.test(text.replaceAll('**', ''))) issues.push(`${where}: unsupported formatting`);
    if ((text.match(/\*\*/g) ?? []).length % 2) issues.push(`${where}: unbalanced bold`);
    for (const sentence of text.split(/(?<=[.!?])\s+/)) if (RISK_WORD.test(sentence) && !HEDGE.test(sentence) && !/camera cannot detect pain/i.test(sentence)) { issues.push(`${where}: unhedged risk statement`); break; }
  }
  const events = input.events.map((e) => e.index);
  if (report.riskAlerts.length !== events.length || report.riskAlerts.some((a, i) => a.event !== events[i])) issues.push('riskAlerts must cover each event once, in order');
  return issues.length ? { ok: false, issues: issues.slice(0, 20) } : { ok: true, report };
}

export const videoReportResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), binding: z.strictObject({ inputSchemaVersion: z.literal(VIDEO_REPORT_INPUT_VERSION), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
    provenance: reportProvenanceSchema, report: clinicianReportSchema }),
  z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string().min(1).max(40), message: z.string().max(300) }), issues: z.array(z.string().max(200)).max(20).optional() }),
]);
export type VideoReportResponse = z.infer<typeof videoReportResponseSchema>;
