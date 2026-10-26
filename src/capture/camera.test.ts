import { describe, expect, it, vi } from 'vitest';
import { Camera } from './camera.js';
function stream() {
  const stop = vi.fn();
  return { value: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}
describe('camera ownership', () => {
  it('requests video only and releases tracks idempotently', async () => {
    const s = stream();
    const getUserMedia = vi.fn().mockResolvedValue(s.value);
    const camera = new Camera({ getUserMedia });
    await camera.open('environment'); camera.stop(); camera.stop();
    expect(getUserMedia.mock.calls[0]![0]).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    expect(s.stop).toHaveBeenCalledTimes(1);
  });
  it('releases a permission result arriving after cancellation', async () => {
    const s = stream(); let resolve!: (value: MediaStream) => void;
    const camera = new Camera({ getUserMedia: () => new Promise((r) => { resolve = r; }) });
    const pending = camera.open('user'); camera.stop(); resolve(s.value);
    await expect(pending).rejects.toThrow('canceled');
    expect(s.stop).toHaveBeenCalledTimes(1);
  });
  it('does not discard permission failures', async () => {
    const camera = new Camera({ getUserMedia: async () => { throw new Error('denied'); } });
    await expect(camera.open('user')).rejects.toThrow('denied');
    camera.stop();
  });
});
