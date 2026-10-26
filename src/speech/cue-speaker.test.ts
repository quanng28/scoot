import { describe, expect, it, vi } from 'vitest';
import type { CueId } from '../contracts/cue.js';
import { CUE_CATALOG_VERSION } from '../contracts/cue.js';
import { GeminiCueAudioSource } from './browser-audio.js';
import { CueController } from './cue-controller.js';
import { CueSpeaker, type AudioOutput, type Caption, type CueAudio, type CueAudioSource, type LocalVoice } from './cue-speaker.js';

/** Manually resolved TTS source: lets tests decide exactly when "network" audio arrives. */
class ControlledSource implements CueAudioSource {
  readonly calls: { id: CueId; resolve: (b: CueAudio) => void; reject: (e: Error) => void }[] = [];
  load(id: CueId): Promise<CueAudio> { return new Promise((resolve, reject) => this.calls.push({ id, resolve, reject })); }
}
const audio = (text: string, provenance: CueAudio['provenance'] = 'gemini'): CueAudio => ({ audio: new Blob([text]), provenance });
/** Playback lasts until finish() or abort, like a real sentence. */
class RecordingOutput implements AudioOutput {
  played: string[] = []; aborted: string[] = []; stops = 0; finish: (() => void) | null = null;
  constructor(private readonly instant = true) {}
  async unlock() { return true; }
  async play(blob: Blob, signal: AbortSignal) {
    const text = await blob.text();
    this.played.push(text);
    if (this.instant) return;
    await new Promise<void>((resolve, reject) => { this.finish = resolve; signal.addEventListener('abort', () => { this.aborted.push(text); reject(new DOMException('a', 'AbortError')); }, { once: true }); });
  }
  stop() { this.stops++; }
}
class FakeVoice implements LocalVoice {
  spoken: string[] = [];
  available() { return true; } unlock() {} cancel() {}
  async speak(text: string) { this.spoken.push(text); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(options: { source?: CueAudioSource | null; voice?: LocalVoice | null; instant?: boolean } = {}) {
  let t = 0;
  const controller = new CueController(() => t);
  const captions: (Caption | null)[] = [];
  const output = new RecordingOutput(options.instant ?? true);
  const speaker = new CueSpeaker({ controller, source: options.source === undefined ? new ControlledSource() : options.source, output, localVoice: options.voice ?? null, onCaption: (c) => captions.push(c), now: () => t });
  speaker.setScope('scope-a');
  speaker.updateContext({ phase: 'recording', analyzerState: 'REST' });
  return { controller, speaker, captions, output, advance: (ms: number) => { t += ms; } };
}

describe('CueSpeaker', () => {
  it('rejects delayed setup audio after its step changes and tracking audio after recovery', async () => {
    const source = new ControlledSource();
    const { speaker, output } = rig({ source });
    await speaker.enable();
    speaker.updateContext({ phase: 'previewing', analyzerState: null, transientCueIds: ['setup.reference'] });
    speaker.submit(['setup.reference']);
    await flush();
    speaker.updateContext({ phase: 'previewing', analyzerState: null, transientCueIds: ['setup.hold_rest'] });
    source.calls[0]!.resolve(audio('old-reference'));
    await flush(); await flush();
    expect(output.played).toEqual([]);
    speaker.updateContext({ phase: 'recording', analyzerState: 'REST', transientCueIds: ['tracking.wrist'] });
    speaker.submit(['tracking.wrist']);
    await flush();
    speaker.updateContext({ phase: 'recording', analyzerState: 'REST', transientCueIds: ['tracking.restored'] });
    source.calls[1]!.resolve(audio('old-wrist-loss'));
    await flush(); await flush();
    speaker.replay();
    await flush();
    expect(source.calls).toHaveLength(2);
    expect(output.played).toEqual([]);
  });

  it('shows a caption for every cue even before (or without) audio', async () => {
    const { speaker, captions } = rig({ source: null });
    speaker.submit(['tracking.wrist']);
    await flush();
    expect(captions).toEqual([{ cueId: 'tracking.wrist', text: 'Your wrist is out of view. Pause.', delivery: 'caption_only' }]);
  });

  it('plays cloud audio after enable, and captions only when muted', async () => {
    const source = new ControlledSource();
    const { speaker, captions, output } = rig({ source });
    await speaker.enable();
    speaker.submit(['tracking.wrist']);
    await flush();
    source.calls[0]!.resolve(audio('wrist-audio'));
    await flush(); await flush();
    expect(output.played).toEqual(['wrist-audio']);
    speaker.setMuted(true);
    speaker.submit(['tracking.hip']);
    await flush();
    expect(captions.at(-1)?.delivery).toBe('caption_only');
    expect(source.calls).toHaveLength(1);
  });

  it('never plays audio that arrives after Stop, and Stop is synchronous', async () => {
    const source = new ControlledSource();
    const { speaker, output, captions } = rig({ source });
    await speaker.enable();
    speaker.submit(['phase.rest']);
    await flush();
    speaker.stop('stop.stopped');           // user pressed Stop while TTS was in flight
    expect(captions.includes(null)).toBe(true); // stale caption cleared immediately
    source.calls[0]!.resolve(audio('late-phase-audio'));
    source.calls[1]?.resolve(audio('stop-audio'));
    await flush(); await flush(); await flush();
    expect(output.played).not.toContain('late-phase-audio');
    expect(captions.at(-1)?.cueId).toBe('stop.stopped');
  });

  it('drops audio for a previous session scope', async () => {
    const source = new ControlledSource();
    const { speaker, output } = rig({ source });
    await speaker.enable();
    speaker.submit(['tracking.elbow']);
    await flush();
    speaker.setScope('scope-b');
    source.calls[0]!.resolve(audio('old-session-audio'));
    await flush(); await flush();
    expect(output.played).toEqual([]);
  });

  it('speaks a cue whose cloud audio is late with the local voice while it is still valid, and never plays the late audio', async () => {
    vi.useFakeTimers();
    try {
      const source = new ControlledSource();
      const voice = new FakeVoice();
      const { speaker, output, captions } = rig({ source, voice });
      await speaker.enable();
      speaker.submit(['countdown.3']);       // 800 ms expiry
      await vi.advanceTimersByTimeAsync(900); // TTS never answered in time
      source.calls[0]!.resolve(audio('too-late'));
      await vi.advanceTimersByTimeAsync(10);
      expect(output.played).toEqual([]);      // late cloud audio is never played
      expect(voice.spoken).toEqual(['Three.']); // local voice took over inside the cue's validity window (LOCAL_VOICE_RESERVE_MS)
      expect(captions.at(-1)).toMatchObject({ cueId: 'countdown.3', delivery: 'local_voice' });
      expect(speaker.status.cloudFailures).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('falls back to local voice on provider failure and stops asking the server after repeated failures', async () => {
    const source = new ControlledSource();
    const voice = new FakeVoice();
    const { speaker } = rig({ source, voice });
    await speaker.enable();
    speaker.submit(['tracking.hip']);
    await flush();
    source.calls[0]!.reject(new Error('network down'));
    await flush(); await flush();
    expect(voice.spoken).toContain('Your hip is out of view. Pause.');
    speaker.submit(['tracking.elbow']);
    await flush();
    source.calls[1]!.reject(new Error('network down'));
    await flush(); await flush();
    speaker.submit(['tracking.shoulder']);
    await flush(); await flush();
    expect(source.calls).toHaveLength(2);
    expect(voice.spoken).toContain('Your shoulder is out of view. Pause.');
  });

  it('does not cut off a sentence that plays longer than its queue expiry while snapshots keep arriving', async () => {
    const source = new ControlledSource();
    const { speaker, output, captions, advance } = rig({ source, instant: false });
    await speaker.enable();
    speaker.submit(['countdown.5']);
    await flush();
    source.calls[0]!.resolve(audio('five'));
    await flush(); await flush();
    advance(1200);                                              // past the 800 ms expiry, mid-word
    speaker.updateContext({ phase: 'recording', analyzerState: 'REST' });
    speaker.submit([]);
    expect(output.aborted).toEqual([]);
    expect(captions.includes(null)).toBe(false);
    output.finish!();
  });

  it('keeps a setup caption visible while its step is still current, beyond the queue expiry', async () => {
    const { speaker, captions, advance } = rig({ source: null });
    speaker.updateContext({ phase: 'previewing', analyzerState: null });
    speaker.submit(['setup.reference']);
    await flush();
    advance(9000);
    speaker.updateContext({ phase: 'previewing', analyzerState: null });
    expect(captions.at(-1)?.cueId).toBe('setup.reference');
    speaker.updateContext({ phase: 'recording', analyzerState: 'REST' });  // step no longer applies
    expect(captions.at(-1)).toBeNull();
  });

  it('replays the last cue on request, and refuses a replay that no longer fits the phase', async () => {
    const source = new ControlledSource();
    const { speaker, output, advance } = rig({ source });
    await speaker.enable();
    speaker.submit(['tracking.wrist']);
    await flush();
    source.calls[0]!.resolve(audio('wrist'));
    await flush(); await flush();
    advance(20_000);
    speaker.replay();
    await flush();
    source.calls[1]!.resolve(audio('wrist-again'));
    await flush(); await flush();
    expect(output.played).toEqual(['wrist', 'wrist-again']);
    speaker.updateContext({ phase: 'closed', analyzerState: null });
    speaker.replay();
    await flush();
    expect(source.calls).toHaveLength(2);
  });

  it('labels mock-provider audio as mock in the caption', async () => {
    const source = new ControlledSource();
    const { speaker, captions } = rig({ source });
    await speaker.enable();
    speaker.submit(['tracking.wrist']);
    await flush();
    source.calls[0]!.resolve(audio('tone', 'mock_provider'));
    await flush(); await flush();
    expect(captions.at(-1)?.delivery).toBe('mock_audio');
  });
});

describe('GeminiCueAudioSource', () => {
  const wav = new Uint8Array(64).fill(1);
  const audioResponse = (id: string) => new Response(wav, { status: 200, headers: { 'Content-Type': 'audio/wav', 'X-Cue-Id': id } });

  it('sends only the cue ID and catalog version, shares concurrent requests and caches success', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { void init; return audioResponse('tracking.wrist'); });
    const source = new GeminiCueAudioSource({ accessCode: () => 'demo-code', fetch: fetchMock as typeof fetch });
    const signal = new AbortController().signal;
    const [a, b] = await Promise.all([source.load('tracking.wrist', signal), source.load('tracking.wrist', signal)]);
    await source.load('tracking.wrist', signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ catalogVersion: CUE_CATALOG_VERSION, cueId: 'tracking.wrist' });
    expect(a.audio.size).toBe(64); expect(b.audio.size).toBe(64);
    expect(a.provenance).toBe('mock_provider'); // no X-Provenance: gemini header → never presented as real speech
  });

  it('does not cache failures, rejects mismatched audio and needs an access code', async () => {
    const responses = [new Response(JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'limit' } }), { status: 429 }), audioResponse('tracking.hip'), audioResponse('tracking.wrist')];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const source = new GeminiCueAudioSource({ accessCode: () => 'demo-code', fetch: fetchMock as typeof fetch });
    const signal = new AbortController().signal;
    await expect(source.load('tracking.wrist', signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(source.load('tracking.wrist', signal)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' }); // header names another cue
    await expect(source.load('tracking.wrist', signal)).resolves.toMatchObject({ audio: expect.any(Blob) });
    await expect(new GeminiCueAudioSource({ accessCode: () => null }).load('tracking.wrist', signal)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('lets one caller abort without breaking the shared request', async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    const source = new GeminiCueAudioSource({ accessCode: () => 'demo-code', fetch: fetchMock as typeof fetch });
    const abort = new AbortController();
    const first = source.load('tracking.wrist', abort.signal);
    const second = source.load('tracking.wrist', new AbortController().signal);
    abort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    release(audioResponse('tracking.wrist'));
    await expect(second).resolves.toMatchObject({ audio: expect.any(Blob) });
  });
});

it('does not label a pending provider request as Gemini audio before provenance arrives', async () => {
  const source = new ControlledSource();
  const { speaker, captions } = rig({ source });
  await speaker.enable();
  speaker.submit(['tracking.knee']);
  await flush();
  expect(captions.at(-1)).toMatchObject({ cueId: 'tracking.knee', delivery: 'caption_only' });
  source.calls[0]!.resolve(audio('knee', 'gemini'));
  await flush(); await flush();
  expect(captions.at(-1)?.delivery).toBe('cloud_audio');
});

it('cancels lower-body phase audio when the analyzer leaves its endpoint before download completes', async () => {
  const source = new ControlledSource();
  const { speaker, output } = rig({ source });
  await speaker.enable();
  speaker.updateContext({ phase: 'recording', analyzerState: 'PUMP_ENDPOINT' });
  speaker.submit(['phase.target']);
  await flush();
  speaker.updateContext({ phase: 'recording', analyzerState: 'RETURN' });
  source.calls[0]!.resolve(audio('stale-return-instruction'));
  await flush(); await flush();
  expect(output.played).toEqual([]);
});

it('aborts transport only after the last shared cue is cancelled and rejects cached audio after cloud disablement', async () => {
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal ?? undefined;
    requestSignal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const source = new GeminiCueAudioSource({ accessCode: () => 'code', fetch: fetchMock as typeof fetch });
  const a = new AbortController(), b = new AbortController();
  const first = source.load('tracking.heel', a.signal), second = source.load('tracking.heel', b.signal);
  a.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(requestSignal?.aborted).toBe(false);
  b.abort();
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  expect(requestSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  let enabled = true;
  const cachedFetch = vi.fn(async () => new Response(new Uint8Array(64), { headers: { 'Content-Type': 'audio/wav', 'X-Cue-Id': 'tracking.heel', 'X-Provenance': 'gemini' } }));
  const cached = new GeminiCueAudioSource({ accessCode: () => enabled ? 'code' : null, fetch: cachedFetch as typeof fetch });
  await cached.load('tracking.heel', new AbortController().signal);
  enabled = false;
  await expect(cached.load('tracking.heel', new AbortController().signal)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(cachedFetch).toHaveBeenCalledTimes(1);
});

it('does not start a fallback voice after the cue has expired while its request was failing', async () => {
  const source = new ControlledSource(), voice = new FakeVoice();
  const { speaker, advance } = rig({ source, voice });
  await speaker.enable();
  speaker.submit(['phase.rest_ankle']);
  await flush();
  advance(2000);
  source.calls[0]!.reject(new Error('late network error'));
  await flush(); await flush();
  expect(voice.spoken).toEqual([]);
});
