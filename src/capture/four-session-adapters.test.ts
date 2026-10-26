import { describe, expect, it } from 'vitest';
import { fourCaptureFixtures, RECORDING_ANCHOR } from '../contracts/seated-workflow.test-fixtures.js';
import { armConfig, kneeConfig, liftConfig, ankleConfig } from '../analysis/seated-exercise.test-fixtures.js';
import { developerArmRaiseConfig, ArmRaiseSession } from './arm-raise-session.js';
import { developerKneeExtensionConfig, KneeExtensionSession } from './knee-extension-session.js';
import { developerLegLiftConfig, LegLiftSession } from './leg-lift-session.js';
import { developerAnklePumpsConfig, AnklePumpsSession } from './ankle-pumps-session.js';

describe.each([0, 1, 2, 3])('exercise-specific session adapter %i', (index) => {
  it('ignores pre-anchor frames, freezes setup and emits one recording-relative attempt after a held endpoint', () => {
    const { run, frames } = fourCaptureFixtures()[index]!;
    run.frame({ ...frames[0]!, timestampMs: RECORDING_ANCHOR - 1 });
    for (const frame of frames) run.frame(frame);
    run.tick(RECORDING_ANCHOR + 890);
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({ startMs: 161, endpointMs: 337, returnStartMs: 620, endMs: 889, classification: 'measurable' });
    expect(run.summary()).toMatchObject({ detected: 1, measurable: 1, excluded: 0 });
  });
  it('ticks a silent open attempt to exclusion and makes stop idempotent against late frames', () => {
    const { run, frames } = fourCaptureFixtures()[index]!;
    for (const frame of frames.filter((frame) => frame.timestampMs <= RECORDING_ANCHOR + 270)) run.frame(frame);
    run.tick(RECORDING_ANCHOR + 500);
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({ classification: 'excluded', flags: [] });
    expect(run.attempts[0]!.reasons).toContain('TRACKING_GAP');
    run.stop(RECORDING_ANCHOR + 501, 'DISCOMFORT_STOP');
    for (const frame of frames) run.frame(frame);
    run.tick(RECORDING_ANCHOR + 3000);
    run.stop(RECORDING_ANCHOR + 3000, 'STOPPED_EARLY');
    expect(run.attempts).toHaveLength(1);
  });
});

it('developer profiles explicitly retain reference and verified direction with versioned experimental settings', () => {
  const arm = armConfig(), knee = kneeConfig(), lift = liftConfig(), ankle = ankleConfig();
  const profiles = [
    new ArmRaiseSession(developerArmRaiseConfig(arm.baseline, arm.reference, 'upperArmAngle', 90, 1, 1, 600, 400, 'left', 'arm'), 0, 'none'),
    new KneeExtensionSession(developerKneeExtensionConfig(knee.baseline, 180, 600, 400, 'left', 'knee'), 0, 'none'),
    new LegLiftSession(developerLegLiftConfig(lift.baseline, lift.reference, 0.5, 1, 600, 400, 'left', 'lift'), 0, 'none'),
    new AnklePumpsSession(developerAnklePumpsConfig(ankle.baseline, 30, 1, 1, true, 600, 400, 'left', 'ankle'), 0, 'none'),
  ] as const;
  expect(profiles.every((profile) => profile.config.version.endsWith('developer-v2'))).toBe(true);
  expect(profiles[0]!.config.reference).toEqual(arm.reference);
  expect(profiles[2]!.config.reference).toEqual(lift.reference);
  expect(profiles[3]!.config.directionVerified).toBe(true);
  expect(() => new ArmRaiseSession(arm, NaN, 'none')).toThrow('Invalid recording anchor');
  expect(() => new KneeExtensionSession(knee, 0, ' ')).toThrow('Describe leg support');
  expect(() => new LegLiftSession(lift, 0, ' ')).toThrow('Describe seating and leg support');
  expect(() => new AnklePumpsSession(ankle, 0, ' ')).toThrow('Describe foot/leg support');
});
