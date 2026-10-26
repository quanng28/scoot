import { FilesetResolver, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { z } from 'zod';

const initSchema = z.object({ type: z.literal('init'), root: z.string().url(), delegate: z.enum(['CPU', 'GPU']) });
const frameSchema = z.object({ type: z.literal('frame'), sequence: z.number().int().nonnegative(), timestampMs: z.number().finite().nonnegative(), bitmap: z.instanceof(ImageBitmap) });
let engine: PoseLandmarker | null = null;
let hands: HandLandmarker | null = null;
let initializing = false;
let lastTime = -1;
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = (event) => { void handle(event.data); };

async function handle(raw: unknown): Promise<void> {
  const init = initSchema.safeParse(raw);
  if (init.success) {
    if (engine || initializing) return;
    initializing = true;
    try {
      const root = new URL(init.data.root);
      if (root.origin !== globalThis.location.origin) throw new Error('Assets must be same-origin');
      engine = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(new URL('wasm/', root).href), {
        baseOptions: { modelAssetPath: new URL('pose_landmarker_lite.task', root).href, delegate: init.data.delegate },
        runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
        canvas: new OffscreenCanvas(1, 1), minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      hands = await HandLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(new URL('wasm/', root).href), {
        baseOptions: { modelAssetPath: new URL('hand_landmarker.task', root).href, delegate: init.data.delegate },
        runningMode: 'VIDEO', numHands: 2, canvas: new OffscreenCanvas(1, 1),
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      scope.postMessage({ type: 'ready' });
    } catch {
      scope.postMessage({ type: 'error', message: 'Body/hand worker initialization failed. Check local assets and try the other delegate; this browser may be unsupported.' });
    }
    return;
  }
  const parsed = frameSchema.safeParse(raw);
  if (!parsed.success) {
    // Release a transferred bitmap even when the surrounding envelope is invalid.
    if (raw && typeof raw === 'object' && 'bitmap' in raw && raw.bitmap instanceof ImageBitmap) raw.bitmap.close();
    scope.postMessage({ type: 'error', message: 'Invalid pose frame message' });
    return;
  }
  const { bitmap, sequence, timestampMs } = parsed.data;
  try {
    if (!engine || timestampMs <= lastTime) throw new Error('Worker not ready or stale frame');
    lastTime = timestampMs;
    const started = performance.now();
    const result = engine.detectForVideo(bitmap, timestampMs);
    try {
      const handResult = hands?.detectForVideo(bitmap, timestampMs);
      scope.postMessage({ type: 'pose', sequence, timestampMs, width: bitmap.width, height: bitmap.height,
        inferenceMs: performance.now() - started,
        points: (result.landmarks[0] ?? []).map((p) => ({ x: p.x, y: p.y, visibility: Number.isFinite(p.visibility) ? p.visibility : null })),
        hands: (handResult?.landmarks ?? []).map((points) => points.map((p) => ({ x: p.x, y: p.y }))),
      });
    } finally { result.close(); }
  } catch {
    scope.postMessage({ type: 'error', message: 'Pose inference failed; capture stopped. No fallback measurements were generated.' });
  } finally { bitmap.close(); }
}
