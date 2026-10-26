import { extractUpperBodyWindow, type UpperBodyInput, UPPER_BODY_POLICY_VERSION } from './upper-body-engineering.js';

export const EXTRACTED_FIXTURE_STATUS = 'SYNTHETIC ONLY — FIXED UPPER-BODY ENGINEERING PROFILE; NOT PHYSICAL OR CLINICAL VALIDATION';
/** Invented normalized upper-body landmarks; no camera observations or intended label. */
export function buildSyntheticUpperBodyInput(): UpperBodyInput {
  const resting = {
    shoulder: { x: 0.4, y: 0.2, confidence: 1 }, elbow: { x: 0.4, y: 0.4, confidence: 1 },
    wrist: { x: 0.55, y: 0.4, confidence: 1 }, hip: { x: 0.4, y: 0.8, confidence: 1 },
  };
  return {
    startMs: 0, endMs: 2000, frameWidth: 640, frameHeight: 480, side: 'right', forwardSign: 1,
    reference: [{ x: 20, y: 20 }, { x: 120, y: 20 }],
    restSamples: Array.from({ length: 6 }, (_, index) => ({ timestampMs: index * 200, landmarks: structuredClone(resting) })),
    samples: Array.from({ length: 21 }, (_, index) => {
      const progress = Math.sin(Math.PI * index / 20);
      return { timestampMs: index * 100, landmarks: {
        ...structuredClone(resting),
        wrist: { x: 0.55 + progress * 0.1, y: 0.4 - progress * 0.05, confidence: 1 },
      } };
    }),
  };
}
export function buildSyntheticUpperBodyFixture() {
  return { fixtureStatus: EXTRACTED_FIXTURE_STATUS, policyVersion: UPPER_BODY_POLICY_VERSION,
    window: extractUpperBodyWindow(buildSyntheticUpperBodyInput()) };
}
