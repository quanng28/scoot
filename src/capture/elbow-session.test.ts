import { expect, it } from 'vitest';
import { developerElbowConfig, ElbowSession } from './elbow-session.js';
import type { PoseFrame } from '../pose/observations.js';
const baseline = { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 50, y: 150 }, hip: { x: 50, y: 150 } };
function session() { return new ElbowSession(developerElbowConfig(baseline, 90, 1, 400, 300, 'left', 'test', null), 5000, 'none'); }
function frame(time: number, angle = 180): PoseFrame {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [key, index] of [['shoulder', 11], ['elbow', 13], ['wrist', 15], ['hip', 23]] as const) {
    const p = baseline[key]; points[index] = { x: (key === 'wrist' ? 50 + 50 * Math.sin(angle * Math.PI / 180) : p.x) / 400, y: (key === 'wrist' ? 100 - 50 * Math.cos(angle * Math.PI / 180) : p.y) / 300, visibility: 1 };
  }
  return { type: 'pose', sequence: time, timestampMs: time, width: 400, height: 300, inferenceMs: 1, points };
}
it('ignores pre-recording frames and produces recording-relative attempts', () => {
  const run = session(); run.frame(frame(4900, 90));
  for (let t = 0; t <= 500; t += 100) run.frame(frame(5000 + t));
  for (let t = 600; t <= 800; t += 100) run.frame(frame(5000 + t, 150));
  for (let t = 900; t <= 1100; t += 100) run.frame(frame(5000 + t, 90));
  for (let t = 1200; t <= 1400; t += 100) run.frame(frame(5000 + t));
  run.tick(6401);
  expect(run.summary()).toMatchObject({ detected: 1, measurable: 1 });
  expect(run.attempts[0]!.metrics.minElbowDeg.value).toBeCloseTo(90);
  expect(run.support).toBe('none');
  expect(run.attempts[0]).toMatchObject({ startMs: 600, endpointMs: 900, endMs: 1400 });
});
it('independent tick finalizes a silent attempt and discomfort stops future input', () => {
  const run = session();
  for (let t = 0; t <= 500; t += 100) run.frame(frame(5000 + t));
  for (let t = 600; t <= 800; t += 100) run.frame(frame(5000 + t, 150));
  run.tick(6900); expect(run.attempts[0]!.reasons).toContain('TRACKING_GAP');
  run.stop(7000, 'DISCOMFORT_STOP'); run.frame(frame(7100)); run.tick(8000);
  expect(run.attempts).toHaveLength(1);
});

it('rejects an incompatible endpoint and missing support before capture', () => {
  const config = developerElbowConfig(baseline, 175, 1, 400, 300, 'left', 'test', null);
  expect(() => new ElbowSession(config, 0, 'none')).toThrow('regions must be distinct');
  config.endpointDeg = 90;
  expect(() => new ElbowSession(config, 0, ' ')).toThrow('Describe elbow support');
});
