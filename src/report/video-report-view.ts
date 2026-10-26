import { PACE_ANGLE_LABEL, type PacePoint } from '../analysis/pace-monitor.js';
import { clock, OVERALL_LABEL, type ClinicianReport, type VideoReportInput } from '../contracts/video-report.js';

/**
 * DOM rendering of the clinician report for video-only recordings. Text is inserted with textContent only;
 * the one supported markup, **bold**, becomes <strong> elements (no innerHTML from generated text).
 */
const STATUS_ICON = { controlled: '🟢', review: '🟠', high: '🔴' } as const;
const SEVERITY = { high: { icon: '🔴', label: 'HIGH STRAIN RISK' }, moderate: { icon: '🟠', label: 'MODERATE STRAIN RISK' } } as const;
const SVG = 'http://www.w3.org/2000/svg';

export type VideoReportElements = { root: HTMLElement; bannerIcon: HTMLElement; bannerStatus: HTMLElement; headline: HTMLElement; rom: HTMLElement; speed: HTMLElement;
  alerts: HTMLElement; timeline: HTMLElement; charts: HTMLElement; tracking: HTMLElement; points: HTMLElement };

export function richText(target: HTMLElement, text: string): void {
  target.replaceChildren();
  text.split('**').forEach((part, i) => {
    if (!part) return;
    if (i % 2) { const strong = document.createElement('strong'); strong.textContent = part; target.append(strong); }
    else target.append(document.createTextNode(part));
  });
}

export function renderClinicianReport(ui: VideoReportElements, input: VideoReportInput, report: ClinicianReport, series: readonly PacePoint[], seek: (sec: number) => void): void {
  ui.root.hidden = false;
  ui.root.dataset.status = input.overall;
  ui.bannerIcon.textContent = STATUS_ICON[input.overall];
  ui.bannerStatus.textContent = `Overall: ${OVERALL_LABEL[input.overall]}`;
  richText(ui.headline, report.headline);
  richText(ui.rom, report.rangeOfMotion);
  richText(ui.speed, report.speedAndControl);
  richText(ui.tracking, report.trackingQuality);

  ui.alerts.replaceChildren();
  for (const alert of report.riskAlerts) {
    const event = input.events.find((e) => e.index === alert.event);
    if (!event) continue;
    const box = document.createElement('article'); box.className = 'vr-alert'; box.dataset.severity = event.severity;
    const title = document.createElement('h4');
    title.textContent = `${SEVERITY[event.severity].icon} ${SEVERITY[event.severity].label} — ${event.rep === null ? `Event ${event.index}` : `Rep ${event.rep}`} (${clock(event.tSec)})`;
    const body = document.createElement('p'); richText(body, alert.text);
    const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'vr-jump';
    jump.textContent = `👉 Clinician: review replay at ${clock(event.tSec)}`;
    jump.addEventListener('click', () => seek(event.tSec));
    box.append(title, body, jump); ui.alerts.append(box);
  }

  ui.points.replaceChildren();
  for (const point of report.clinicianPoints) { const li = document.createElement('li'); richText(li, point); ui.points.append(li); }

  renderTimeline(ui.timeline, input, seek);
  ui.charts.replaceChildren(
    chart(`${PACE_ANGLE_LABEL[input.exercise.id]} (degrees)`, series.map((p) => [p.tMs / 1000, p.angleDeg]), input, { min: 0, max: 180 }),
    chart('Angular speed (degrees per second)', series.map((p) => [p.tMs / 1000, p.degPerSec]), input, { min: 0, threshold: input.pace.fastDegPerSec }),
  );
}

function renderTimeline(host: HTMLElement, input: VideoReportInput, seek: (sec: number) => void): void {
  host.replaceChildren();
  const duration = input.capture.recordingDurationSec ?? Math.max(1, ...input.events.map((e) => e.tSec + 1), ...input.reps.map((r) => r.endSec + 1));
  const track = document.createElement('div'); track.className = 'vr-track';
  for (const rep of input.reps) {
    const band = document.createElement('span'); band.className = 'vr-rep'; band.dataset.warn = String(rep.warnings > 0);
    band.style.left = `${(rep.startSec / duration) * 100}%`; band.style.width = `${Math.max(0.6, ((rep.endSec - rep.startSec) / duration) * 100)}%`;
    band.title = `Rep ${rep.index}: ${clock(rep.startSec)}–${clock(rep.endSec)}`;
    track.append(band);
  }
  for (const event of input.events) {
    const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'vr-marker'; marker.dataset.severity = event.severity;
    marker.style.left = `${Math.min(100, (event.tSec / duration) * 100)}%`;
    marker.textContent = SEVERITY[event.severity].icon;
    marker.setAttribute('aria-label', `${SEVERITY[event.severity].label} at ${clock(event.tSec)}. Jump the replay there.`);
    marker.addEventListener('click', () => seek(event.tSec));
    track.append(marker);
  }
  const scale = document.createElement('div'); scale.className = 'vr-scale';
  for (const label of ['0:00', clock(duration / 2), clock(duration)]) { const span = document.createElement('span'); span.textContent = label; scale.append(span); }
  const legend = document.createElement('p'); legend.className = 'vr-hint';
  legend.textContent = input.events.length ? '🔴 high · 🟠 moderate strain risk · bars = repetitions (amber when a warning occurred). Tap a marker to jump the replay.'
    : 'No fast-movement events. Bars show segmented repetitions.';
  host.append(track, scale, legend);
}

function chart(title: string, points: [number, number | null][], input: VideoReportInput, axis: { min: number; max?: number; threshold?: number }): HTMLElement {
  const figure = document.createElement('figure'); figure.className = 'vr-chart';
  const caption = document.createElement('figcaption'); caption.textContent = title; figure.append(caption);
  const values = points.flatMap(([, v]) => v === null ? [] : [v]);
  if (!values.length) { const empty = document.createElement('p'); empty.className = 'vr-hint'; empty.textContent = 'Not measured in this recording.'; figure.append(empty); return figure; }
  const W = 600, H = 170, L = 44, R = 8, T = 10, B = 22;
  const duration = input.capture.recordingDurationSec ?? Math.max(...points.map(([t]) => t), 1);
  const max = axis.max ?? Math.max(...values, (axis.threshold ?? 0) * 1.6, 1);
  const x = (t: number) => L + (Math.min(t, duration) / duration) * (W - L - R);
  const y = (v: number) => T + (1 - (Math.min(v, max) - axis.min) / (max - axis.min)) * (H - T - B);
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', title);
  const add = (name: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text) node.textContent = text;
    svg.append(node); return node;
  };
  for (const v of [axis.min, (axis.min + max) / 2, max]) {
    add('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'vr-grid' });
    add('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'vr-axis' }, String(Math.round(v)));
  }
  add('text', { x: L, y: H - 4, class: 'vr-axis' }, '0:00'); add('text', { x: W - R, y: H - 4, 'text-anchor': 'end', class: 'vr-axis' }, clock(duration));
  for (const event of input.events) add('line', { x1: x(event.tSec), x2: x(event.tSec), y1: T, y2: H - B, class: `vr-event vr-event-${event.severity}` });
  if (axis.threshold !== undefined) {
    add('line', { x1: L, x2: W - R, y1: y(axis.threshold), y2: y(axis.threshold), class: 'vr-threshold' });
    add('text', { x: W - R - 4, y: y(axis.threshold) - 5, 'text-anchor': 'end', class: 'vr-threshold-label' }, `fast limit ${axis.threshold}`);
  }
  // Tracking gaps break the line instead of drawing a false straight segment across them.
  let run: string[] = [];
  const flush = () => { if (run.length > 1) add('polyline', { points: run.join(' '), class: 'vr-line' }); run = []; };
  let lastT = -Infinity;
  for (const [t, v] of points) {
    if (v === null || t - lastT > 0.5) flush();
    if (v !== null) { run.push(`${x(t).toFixed(1)},${y(v).toFixed(1)}`); lastT = t; }
  }
  flush();
  figure.append(svg);
  return figure;
}
