import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoseClient } from './pose-client.js';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function setup() {
  vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
  const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
  const frame = vi.fn(), failure = vi.fn();
  const client = new PoseClient(new URL('http://localhost/worker.js'), frame, failure);
  const ready = client.initialize(new URL('http://localhost/'), 'CPU');
  FakeWorker.latest.reply({ type: 'ready' }); await ready;
  return { client, worker: FakeWorker.latest, frame, failure, close };
}
describe('bounded worker client', () => {
  it('keeps one frame in flight and ignores mismatched replies', async () => {
    const { client, worker, frame } = await setup();
    const video = {} as HTMLVideoElement;
    expect(await client.send(video, 10)).toBe(true);
    expect(await client.send(video, 20)).toBe(false);
    const reply = { type: 'pose', sequence: 99, timestampMs: 10, width: 640, height: 480, inferenceMs: 1, points: [] };
    worker.reply(reply); expect(frame).not.toHaveBeenCalled();
    expect(await client.send(video, 21)).toBe(false);
    worker.reply({ ...reply, sequence: 0 }); expect(frame).toHaveBeenCalledTimes(1);
    expect(await client.send(video, 30)).toBe(true); client.close();
  });
  it('terminates on missing results and ignores later replies', async () => {
    const { client, worker, failure, frame } = await setup();
    await client.send({} as HTMLVideoElement, 10);
    await vi.advanceTimersByTimeAsync(3000);
    expect(failure).toHaveBeenCalledTimes(1); expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.reply({ type: 'pose', sequence: 0, timestampMs: 10, width: 1, height: 1, inferenceMs: 0, points: [] });
    expect(frame).not.toHaveBeenCalled();
  });
  it('releases a bitmap created after teardown', async () => {
    const { client, worker } = await setup(); let resolve!: (bitmap: { close: () => void }) => void;
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', () => new Promise((r) => { resolve = r; }));
    const send = client.send({} as HTMLVideoElement, 10); client.close(); resolve({ close });
    expect(await send).toBe(false); expect(close).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1); // init only
  });
  it('bounds startup and rejects its promise on timeout', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
    const failure = vi.fn(); const client = new PoseClient(new URL('http://localhost/worker.js'), vi.fn(), failure);
    const rejected = expect(client.initialize(new URL('http://localhost/'), 'CPU')).rejects.toThrow('stopped');
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(failure).toHaveBeenCalledTimes(1);
  });
});
