import { defineConfig } from 'vite';

// The preferred HTML/TypeScript interface is the shipped root application.
// Pose inference stays in the shared classic worker with same-origin model/WASM assets.
export default defineConfig({
  base: './',
  // MediaPipe includes optional periodic telemetry. Enforce this on the worker response too:
  // local pose/model/WASM and explicit same-origin Gemini calls work; SDK egress cannot leave.
  server: { headers: { 'Content-Security-Policy': "connect-src 'self'" } },
  preview: { headers: { 'Content-Security-Policy': "connect-src 'self'" } },
  build: { outDir: 'dist/app', emptyOutDir: true, target: 'safari17' },
});
