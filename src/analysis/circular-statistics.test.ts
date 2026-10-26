import { expect, it } from 'vitest';
import { circularMedianDegrees } from './circular-statistics.js';

it('summarizes the circular neighborhood across the ±180 representation boundary', () => {
  expect(circularMedianDegrees([179, -179])).toBe(-180);
  expect(circularMedianDegrees([-179, 179])).toBe(-180);
  expect(circularMedianDegrees([179, -180, -179])).toBe(-180);
  expect(circularMedianDegrees([90, 100])).toBe(95);
});
it('keeps empty, invalid and circularly ambiguous summaries unavailable', () => {
  expect(circularMedianDegrees([])).toBeNull();
  expect(circularMedianDegrees([NaN])).toBeNull();
  expect(circularMedianDegrees([0, 180])).toBeNull();
  expect(circularMedianDegrees([0, 120, -120])).toBeNull();
});
