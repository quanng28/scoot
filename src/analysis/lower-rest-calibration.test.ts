import { expect, it } from 'vitest';
import { calibrateAnklePumpsBaseline, calibrateKneeExtensionBaseline, calibrateLegLiftBaseline } from './rest-calibration.js';
import { anklePose, kneePose, liftPose } from './seated-exercise.test-fixtures.js';
import type { Sample } from '../pose/observations.js';

function samples(pose: Record<string, { x: number; y: number }>): Sample[] {
  return Array.from({ length: 7 }, (_, i) => ({ timestampMs: i * 200,
    landmarks: Object.fromEntries(Object.entries(pose).map(([key, point]) => [key, { x: point.x / 600, y: point.y / 400, confidence: 0.9 }])) }));
}
it('calibrates each lower-limb workflow using only its own required landmarks in intrinsic pixels', () => {
  expect(calibrateKneeExtensionBaseline(samples(kneePose()), 600, 400)).toEqual(kneePose());
  expect(calibrateLegLiftBaseline(samples(liftPose()), 600, 400)).toEqual(liftPose());
  expect(calibrateAnklePumpsBaseline(samples(anklePose()), 600, 400)).toEqual(anklePose());
});
it('rejects missing heel, gapped time support and moving leg baselines', () => {
  const ankle = samples(anklePose()); delete ankle[1]!.landmarks.heel;
  expect(() => calibrateAnklePumpsBaseline(ankle, 600, 400)).toThrow('heel');
  const knee = samples(kneePose()); knee.forEach((sample, i) => { if (i > 0) sample.timestampMs += 301; });
  expect(() => calibrateKneeExtensionBaseline(knee, 600, 400)).toThrow('gap');
  const lift = samples(liftPose()); lift[1]!.landmarks.knee!.y -= 0.1;
  expect(() => calibrateLegLiftBaseline(lift, 600, 400)).toThrow('moved');
});
