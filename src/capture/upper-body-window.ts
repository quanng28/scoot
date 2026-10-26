import { extractionInputSchema, extractMovementWindow, type ExtractionInput } from '../analysis/movement-features.js';
import type { Sample } from '../pose/observations.js';

// One immutable recognition policy shared by fixture and live capture paths.
export { UPPER_BODY_SETTINGS } from '../analysis/upper-body-engineering.js';
import { UPPER_BODY_SETTINGS, UPPER_BODY_WINDOW_MS } from '../analysis/upper-body-engineering.js';
/** Fixed recognition profile, independent of the selected exercise. Reset on setup changes. */
export class UpperBodyWindow {
  private samples: Sample[] = [];
  private start: number | null = null;
  private setup: { calibration: ExtractionInput['calibration']; width: number; height: number; side: 'left' | 'right' } | null = null;
  reset(): void { this.samples = []; this.start = null; this.setup = null; }
  calibrate(calibration: ExtractionInput['calibration'], width: number, height: number, side: 'left' | 'right'): void {
    this.reset();
    calibration = extractionInputSchema.shape.calibration.parse(calibration);
    if (![width,height].every(v => Number.isFinite(v) && v>0 && v<=16384) || !['left','right'].includes(side) ||
        calibration.referenceLengthPx<20 || !calibration.wristRest || calibration.torsoRestDeg===null ||
        calibration.forwardUnit?.x!==calibration.forwardSign || calibration.forwardUnit.y!==0 ||
        calibration.wristRest.x<0 || calibration.wristRest.x>width || calibration.wristRest.y<0 || calibration.wristRest.y>height) throw new Error('Invalid fixed upper-body calibration');
    this.setup = { calibration: structuredClone(calibration), width, height, side };
  }
  accept(sample: Sample, width: number, height: number, side: 'left' | 'right') {
    const setup = this.setup;
    if (!setup) return null;
    if (setup.width !== width || setup.height !== height || setup.side !== side) { this.reset(); return null; }
    const parsed = extractionInputSchema.shape.samples.element.safeParse(sample);
    if (!parsed.success) { this.reset(); throw new Error('Malformed capture sample; recalibrate before recognition'); }
    sample = parsed.data;
    if (this.samples.length && sample.timestampMs <= this.samples.at(-1)!.timestampMs) return null;
    this.start ??= sample.timestampMs;
    // Lower-limb readiness is pending: never derive lower-limb features in this profile.
    const landmarks: Sample['landmarks'] = {};
    for (const key of ['shoulder', 'elbow', 'wrist', 'hip'] as const) if (sample.landmarks[key]) landmarks[key] = sample.landmarks[key];
    this.samples.push({ timestampMs: sample.timestampMs, landmarks });
    const startMs = sample.timestampMs - UPPER_BODY_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.timestampMs >= startMs).slice(-128);
    if (sample.timestampMs - this.start < UPPER_BODY_WINDOW_MS || this.samples.length < 2) return null;
    return extractMovementWindow({ startMs, endMs: sample.timestampMs, frameWidth: width, frameHeight: height, side,
      calibration: { ...setup.calibration, kneeRest: null, ankleRestDeg: null }, settings: { ...UPPER_BODY_SETTINGS, requiredFeatures: [...UPPER_BODY_SETTINGS.requiredFeatures] }, samples: this.samples });
  }
}
