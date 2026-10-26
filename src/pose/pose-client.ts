import { FrameOrder, poseReplySchema, type PoseFrame } from './observations.js';

/** One bitmap in flight, bounded startup/frame deadlines, no queued backlog. */
export class PoseClient {
  private readonly worker: Worker;
  private busy = false;
  private closed = false;
  private sequence = 0;
  private pendingSequence = -1;
  private readonly order = new FrameOrder();
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private rejectInit: ((reason: Error) => void) | undefined;

  constructor(url: URL, private readonly onFrame: (frame: PoseFrame) => void, private readonly onFailure: (message: string) => void) {
    this.worker = new Worker(url); // Classic worker: MediaPipe's pinned WASM loader uses importScripts.
  }
  initialize(root: URL, delegate: 'CPU' | 'GPU'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.rejectInit = reject;
      const fail = (message: string) => { if (!this.closed) { this.close(); this.onFailure(message); } };
      this.worker.onerror = () => fail('Pose worker failed to load or execute');
      this.worker.onmessageerror = () => fail('Pose worker message could not be decoded');
      this.worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.closed) return;
        const parsed = poseReplySchema.safeParse(event.data);
        if (!parsed.success) { fail('Invalid worker result'); return; }
        const reply = parsed.data;
        if (reply.type === 'error') { fail(reply.message); return; }
        if (reply.type === 'ready') {
          if (this.ready) return;
          clearTimeout(this.deadline); this.ready = true; this.rejectInit = undefined; resolve(); return;
        }
        if (!this.ready || reply.sequence !== this.pendingSequence || !this.order.accept(reply)) return;
        clearTimeout(this.deadline); this.busy = false;
        this.onFrame(reply);
      };
      this.deadline = setTimeout(() => fail('Pose startup timed out after 30 seconds'), 30_000);
      this.worker.postMessage({ type: 'init', root: root.href, delegate });
    });
  }
  async send(video: HTMLVideoElement, timestampMs: number): Promise<boolean> {
    if (this.closed || !this.ready || this.busy) return false;
    this.busy = true;
    this.deadline = setTimeout(() => {
      if (this.closed) return;
      this.close(); this.onFailure('No pose result within 3 seconds; capture stopped');
    }, 3000);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(video);
      if (this.closed) { bitmap.close(); return false; }
      this.pendingSequence = this.sequence++;
      this.worker.postMessage({ type: 'frame', sequence: this.pendingSequence, timestampMs, bitmap }, [bitmap]);
      return true;
    } catch {
      bitmap?.close();
      if (!this.closed) { this.close(); this.onFailure('Could not transfer camera frame to pose worker'); }
      return false;
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.deadline);
    this.worker.terminate();
    this.rejectInit?.(new Error('Pose initialization stopped'));
    this.rejectInit = undefined;
  }
}
