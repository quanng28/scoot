import { expect, it } from 'vitest';
import { developerReachConfig, ReachSession } from './reach-session.js';
import type { PoseFrame } from '../pose/observations.js';
const baseline = { shoulder: { x: 50, y: 50 }, elbow: { x: 50, y: 100 }, wrist: { x: 100, y: 100 }, hip: { x: 50, y: 150 } };
function session() { return new ReachSession(developerReachConfig(baseline, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 200, y: 100 }, 400, 300, 'left', 'test', null), 5000); }
function frame(time: number, x = 100): PoseFrame {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [key, index] of [['shoulder', 11], ['elbow', 13], ['wrist', 15], ['hip', 23]] as const) {
    const p = baseline[key]; points[index] = { x: (key === 'wrist' ? x : p.x) / 400, y: p.y / 300, visibility: 1 };
  }
  return { type: 'pose', sequence: time, timestampMs: time, width: 400, height: 300, inferenceMs: 1, points };
}
it('ignores pre-recording frames and produces recording-relative attempts', () => {
  const run = session(); run.frame(frame(4900, 200));
  for (let t = 0; t <= 500; t += 100) run.frame(frame(5000 + t));
  for (let t = 600; t <= 800; t += 100) run.frame(frame(5000 + t, 130));
  for (let t = 900; t <= 1100; t += 100) run.frame(frame(5000 + t, 200));
  for (let t = 1200; t <= 1400; t += 100) run.frame(frame(5000 + t));
  run.tick(6401);
  expect(run.summary()).toMatchObject({ detected: 1, measurable: 1 });
  expect(run.attempts[0]).toMatchObject({ startMs: 600, targetMs: 900, endMs: 1400 });
});
it('independent tick finalizes a silent attempt and discomfort stops future input', () => {
  const run = session();
  for (let t = 0; t <= 500; t += 100) run.frame(frame(5000 + t));
  for (let t = 600; t <= 800; t += 100) run.frame(frame(5000 + t, 130));
  run.tick(6900); expect(run.attempts[0]!.reasons).toContain('TRACKING_GAP');
  run.stop(7000, 'DISCOMFORT_STOP'); run.frame(frame(7100)); run.tick(8000);
  expect(run.attempts).toHaveLength(1);
});
