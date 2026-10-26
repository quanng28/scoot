// Bundles Quan P's unchanged pose worker and copies local model/WASM assets for the Vite app.
// Output is ignored (public/pose/); Vite serves it in dev and copies it into dist/app on build.
import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = resolve('public/pose');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Classic (IIFE) worker: MediaPipe's pinned WASM loader uses importScripts.
await build({ entryPoints: ['src/pose/pose-worker.ts'], outfile: `${output}/pose-worker.js`, bundle: true, format: 'iife', platform: 'browser', target: 'safari17', logLevel: 'warning' });
await copyFile('pose_landmarker_lite.task', `${output}/pose_landmarker_lite.task`);
await copyFile('hand_landmarker.task', `${output}/hand_landmarker.task`);
await cp('node_modules/@mediapipe/tasks-vision/wasm', `${output}/wasm`, { recursive: true });
const assets = ['pose_landmarker_lite.task', 'hand_landmarker.task', ...(await readdir(`${output}/wasm`)).map((name) => `wasm/${name}`)];
const hashes = {};
for (const asset of assets) hashes[asset] = createHash('sha256').update(await readFile(`${output}/${asset}`)).digest('hex');
await writeFile(`${output}/assets.json`, JSON.stringify({ sdk: '@mediapipe/tasks-vision@1.1.1', model: 'existing-repository-lite-asset; source version unverified', hashes }, null, 2));
process.stdout.write(`App pose assets prepared at ${output}\n`);
