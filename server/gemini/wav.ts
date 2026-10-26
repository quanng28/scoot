/** WAV helpers for TTS output. Gemini unary TTS returns WAV by default; raw L16 PCM is wrapped defensively. */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 44 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE';
}

export function wrapPcm16(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); header.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE'); write(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, channels, true); header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * channels * 2, true); header.setUint16(32, channels * 2, true); header.setUint16(34, 16, true);
  write(36, 'data'); header.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header.buffer), 0); out.set(pcm, 44);
  return out;
}

/** Labelled mock audio: a short 440 Hz tone, deliberately not speech, so it is never mistaken for TTS. */
export function mockToneWav(sampleRate = 24_000, ms = 250): Uint8Array {
  const samples = Math.round((sampleRate * ms) / 1000);
  const pcm = new DataView(new ArrayBuffer(samples * 2));
  for (let i = 0; i < samples; i++) pcm.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 6000), true);
  return wrapPcm16(new Uint8Array(pcm.buffer), sampleRate);
}

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
