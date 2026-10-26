import { RECORDING_LIMIT_MS } from '../contracts/cue-events.js';
export type Recording = { blob: Blob; mimeType: string; startMs: number; endMs: number; complete: boolean; reason: string | null };
export type RecordingStop = { captureMs: number; reason: string | null };
export const RECORDING_TYPES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** Estimated mapping until visible-marker offset/drift is verified on the device. */
export function replaySeconds(captureMs: number, recording: Pick<Recording, 'startMs' | 'endMs'>): number | null {
  if (![captureMs,recording.startMs,recording.endMs].every(Number.isFinite) || recording.startMs<0 || recording.endMs<recording.startMs || captureMs < recording.startMs || captureMs > recording.endMs) return null;
  return (captureMs - recording.startMs) / 1000;
}

export class LocalRecorder {
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;
  get startTimeMs(): number | null { return this.startedAt; }
  /** Freeze analysis at this capture-clock instant while final data is pending. */
  get stopTimeMs(): number | null { return this.stoppedAt; }
  private recorder: MediaRecorder | null = null;
  private result: Promise<Recording> | null = null;
  private stopRequested = false;
  private stopEvent: RecordingStop | null = null;
  private stopListener: ((event: RecordingStop) => void) | null = null;
  /** One capture owner; replay a stop that occurred synchronously during startup. */
  onStopped(listener: (event: RecordingStop) => void): void {
    this.stopListener = listener;
    if (this.stopEvent) listener({ ...this.stopEvent });
  }
  private notifyStopped(captureMs: number, reason: string | null): void {
    this.stoppedAt = captureMs; this.stopEvent = { captureMs, reason };
    this.stopListener?.({ ...this.stopEvent });
  }
  constructor(private readonly clock: () => number, private readonly factory = (stream: MediaStream, options: MediaRecorderOptions) => new MediaRecorder(stream, options),
    private readonly supported = (type: string) => MediaRecorder.isTypeSupported(type)) {}

  start(stream: MediaStream): Promise<Recording> {
    if (this.result) throw new Error('Recorder already used');
    const mimeType = RECORDING_TYPES.find(this.supported);
    if (!mimeType) throw new Error('No supported recording format');
    const recorder = this.factory(stream, { mimeType });
    this.recorder = recorder;
    const chunks: Blob[] = [];
    let bytes = 0, startMs = this.clock(), endMs = startMs, started = false, settled = false;
    let reason: string | null = null;
    let deadline: ReturnType<typeof setTimeout>;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const finish = (fallback = false) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(limit);
      recorder.ondataavailable = null; recorder.onstart = null; recorder.onstop = null; recorder.onerror = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      resolveResult({ blob, mimeType: blob.type, startMs, endMs, complete: started && !reason && !fallback && blob.size > 0,
        reason: reason ?? (fallback ? 'Final recording data timed out' : blob.size === 0 ? 'Recording is empty' : !started ? 'Recording never started' : null) });
    };
    let resolveResult!: (value: Recording) => void;
    this.result = new Promise((resolve) => { resolveResult = resolve; });
    const requestStop = (why: string | null) => {
      if (settled || this.stopRequested) return;
      this.stopRequested = true; reason = why; endMs = this.clock(); clearTimeout(deadline);
      deadline = setTimeout(() => finish(true), 5000);
      this.notifyStopped(endMs, reason);
      try { if (recorder.state !== 'inactive') recorder.stop(); else finish(true); }
      catch { finish(true); }
    };
    this.requestStop = requestStop;
    recorder.onstart = () => {
      if (this.stopRequested) return;
      started = true; startMs = this.clock(); this.startedAt = startMs; clearTimeout(deadline);
      // The duration limit shares the recorded time origin, including delayed recorder startup.
      limit = setTimeout(() => this.stop(), RECORDING_LIMIT_MS);
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      bytes += event.data.size;
      if (bytes > 64 * 1024 * 1024) { requestStop('Recording memory limit reached (64 MiB)'); return; }
      chunks.push(event.data);
    };
    recorder.onerror = () => requestStop('Browser recording error');
    recorder.onstop = () => { if (!this.stopRequested) { this.stopRequested = true; endMs = this.clock(); reason = 'Recording ended unexpectedly'; this.notifyStopped(endMs, reason); } finish(); };
    deadline = setTimeout(() => requestStop('Recording start timed out'), 5000);
    try { recorder.start(500); } catch { requestStop('Recording could not start'); }
    return this.result;
  }
  private requestStop: (reason: string | null) => void = () => {};
  stop(reason: string | null = null): Promise<Recording> | null {
    this.requestStop(reason);
    return this.result;
  }
}
