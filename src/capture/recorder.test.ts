import { afterEach, expect, it, vi } from 'vitest';
import { LocalRecorder, replaySeconds } from './recorder.js';
class FakeRecorder {
  state = 'inactive'; mimeType = 'video/webm';
  onstart: (() => void) | null = null; onstop: (() => void) | null = null;
  onerror: (() => void) | null = null; ondataavailable: ((event: { data: Blob }) => void) | null = null;
  start() { this.state = 'recording'; this.onstart?.(); }
  stop = vi.fn(() => { this.state = 'inactive'; });
  finish() { this.ondataavailable?.({ data: new Blob(['video']) }); this.onstop?.(); }
}
afterEach(() => vi.useRealTimers());
it('waits for final data and finalizes repeated stop once', async () => {
  vi.useFakeTimers(); let now = 100;
  const fake = new FakeRecorder();
  const recorder = new LocalRecorder(() => now, () => fake as unknown as MediaRecorder, (type) => type === 'video/webm');
  const result = recorder.start({} as MediaStream);
  now = 2100; recorder.stop(); recorder.stop();
  expect(recorder.stopTimeMs).toBe(2100);
  expect(fake.stop).toHaveBeenCalledTimes(1);
  fake.finish(); const recorded = await result;
  expect(recorded.complete).toBe(true); expect(recorded.blob.size).toBe(5);
  expect(replaySeconds(1100, recorded)).toBe(1);
  expect(replaySeconds(99, recorded)).toBeNull();
  expect(replaySeconds(2101, recorded)).toBeNull();
});
it('rejects malformed clock anchors rather than returning NaN replay time',()=>{
  expect(replaySeconds(100,{startMs:NaN,endMs:200})).toBeNull();
  expect(replaySeconds(100,{startMs:0,endMs:Infinity})).toBeNull();
  expect(replaySeconds(100,{startMs:200,endMs:0})).toBeNull();
});
it('preserves partial evidence with interruption reason', async () => {
  vi.useFakeTimers(); const fake = new FakeRecorder();
  const recorder = new LocalRecorder(() => 100, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream); recorder.stop('Camera lost'); fake.finish();
  expect(await result).toMatchObject({ complete: false, reason: 'Camera lost' });
});
it('bounds missing final events and reports failure', async () => {
  vi.useFakeTimers(); const fake = new FakeRecorder();
  const recorder = new LocalRecorder(() => 100, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream); recorder.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({ complete: false, reason: 'Final recording data timed out' });
});
it('handles recorder errors without fabricating complete evidence', async () => {
  vi.useFakeTimers(); const fake = new FakeRecorder();
  const recorder = new LocalRecorder(() => 100, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream); fake.onerror?.(); fake.finish();
  expect(await result).toMatchObject({ complete: false, reason: 'Browser recording error' });
});
it('rejects unsupported formats before recorder creation', () => {
  const factory = vi.fn(); const recorder = new LocalRecorder(() => 0, factory, () => false);
  expect(() => recorder.start({} as MediaStream)).toThrow('No supported'); expect(factory).not.toHaveBeenCalled();
});

it.each(['limit', 'memory', 'error', 'unexpected'] as const)('notifies %s stop at the capture instant before final data, once', async (kind) => {
  vi.useFakeTimers(); let now = 100;
  const fake = new FakeRecorder(), stopped = vi.fn();
  const recorder = new LocalRecorder(() => now, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream); recorder.onStopped(stopped);
  let settled = false; void result.then(() => { settled = true; });
  now = 2100;
  if (kind === 'limit') await vi.advanceTimersByTimeAsync(30_000);
  if (kind === 'memory') fake.ondataavailable?.({ data: { size: 64 * 1024 * 1024 + 1 } as Blob });
  if (kind === 'error') fake.onerror?.();
  if (kind === 'unexpected') fake.onstop?.();
  expect(stopped).toHaveBeenCalledExactlyOnceWith({ captureMs: 2100, reason: kind === 'limit' ? null : expect.any(String) });
  expect(recorder.stopTimeMs).toBe(2100);
  if (kind !== 'unexpected') {
    expect(settled).toBe(false); now = 7000; fake.finish();
  }
  expect(await result).toMatchObject({ endMs: 2100, complete: kind === 'limit' });
  recorder.stop(); expect(stopped).toHaveBeenCalledTimes(1);
});
it('starts the duration deadline at the recorder start event, not the button gesture', async () => {
  vi.useFakeTimers(); let now = 0;
  const fake = new FakeRecorder();
  fake.start = () => { fake.state = 'recording'; };
  const recorder = new LocalRecorder(() => now, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream);
  await vi.advanceTimersByTimeAsync(4000); now = 4000; fake.onstart?.();
  expect(recorder.startTimeMs).toBe(4000);
  await vi.advanceTimersByTimeAsync(29999); expect(fake.stop).not.toHaveBeenCalled();
  now = 34000; await vi.advanceTimersByTimeAsync(1);
  expect(fake.stop).toHaveBeenCalledTimes(1); fake.finish();
  expect(await result).toMatchObject({ startMs: 4000, endMs: 34000, complete: true, reason: null });
});
it('replays an already stopped startup to the capture owner', async () => {
  vi.useFakeTimers(); const fake = new FakeRecorder();
  fake.start = () => { throw new Error('startup failed'); };
  const recorder = new LocalRecorder(() => 100, () => fake as unknown as MediaRecorder, () => true);
  const result = recorder.start({} as MediaStream), stopped = vi.fn(); recorder.onStopped(stopped);
  expect(stopped).toHaveBeenCalledExactlyOnceWith({ captureMs: 100, reason: 'Recording could not start' });
  expect(await result).toMatchObject({ complete: false, endMs: 100 });
});
