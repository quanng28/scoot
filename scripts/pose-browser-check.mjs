// Uses an externally supplied Playwright install; no production browser dependency.
import { pathToFileURL } from 'node:url';
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the absolute Playwright index.mjs path');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: process.env.POSE_BROWSER_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : 'msedge'), headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const url = process.env.POSE_PREVIEW_URL ?? 'http://127.0.0.1:4173';
process.stdout.write(`Browser ${browser.version()} / Node ${process.version}\n`);
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith(url) && !request.url().startsWith(`blob:${url}/`)) external.push(request.url()); });
  await page.goto(url);
  if (await page.locator('#stop').isEnabled()) throw new Error('Camera started automatically');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('CPU / Lite'), {}, { timeout: 45_000 });
  process.stdout.write(`Real CPU worker / synthetic camera: ${await page.locator('#stats').innerText()}\n`);
  await page.screenshot({ path: 'dist/pose-demo-smoke.png', fullPage: true });
  await page.locator('#record').click();
  await page.waitForTimeout(1200);
  await page.locator('#mark').click();
  await page.waitForTimeout(1200);
  await page.locator('#finish-record').click();
  await page.waitForFunction(() => document.querySelector('#recording-status').textContent.includes('Recording finalized'));
  await page.waitForFunction(() => { const video = document.querySelector('#replay'); return video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0; });
  await page.waitForFunction(() => document.querySelector('#marks button') !== null);
  await page.evaluate(() => {
    const video = document.querySelector('#replay');
    Object.defineProperty(video, 'duration', { configurable: true, value: 0.001 });
    video.dispatchEvent(new Event('durationchange'));
  });
  if (await page.locator('#marks button').count()) throw new Error('Truncated decoded video retained uncovered marker links');
  await page.evaluate(() => { const video = document.querySelector('#replay'); delete video.duration; video.dispatchEvent(new Event('durationchange')); });
  await page.waitForFunction(() => document.querySelector('#marks button') !== null);
  await page.locator('#marks button').first().click();
  await page.waitForFunction(() => document.querySelector('#replay').currentTime > 0.5);
  await page.locator('#discard').click();
  if (await page.locator('#replay').getAttribute('src')) throw new Error('Discard retained recording URL');
  process.stdout.write('PASS: real MediaRecorder final data, local decode, marker seek, discard. Timing accuracy remains unverified.\n');
  await page.locator('#stop').click();
  if (await page.evaluate(() => document.querySelector('video').srcObject !== null)) throw new Error('Stream not cleared');
  await page.selectOption('#delegate', 'GPU');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('GPU / Lite') || !document.querySelector('#start').disabled, {}, { timeout: 45_000 });
  process.stdout.write(`GPU observation (not a release pass): ${await page.locator('#status').innerText()} / ${await page.locator('#stats').innerText()}\n`);
  if (await page.locator('#stop').isEnabled()) await page.locator('#stop').click();
  if (errors.length || external.length) throw new Error(JSON.stringify({ errors, external }));

  // Controlled landmarks test UI/calibration/extractor wiring, not pose accuracy.
  await page.route('**/pose-worker.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = ({data}) => {
      if(data.type === 'init') { self.postMessage({type:'ready'}); return; }
      const points=Array.from({length:33},()=>({x:0.5,y:0.5,visibility:0.9}));
      points[11]={x:0.4,y:0.2,visibility:0.9}; points[13]={x:0.4,y:0.4,visibility:0.9};
      points[15]={x:data.testMotion==='outward'?0.72:data.testMotion==='target'?0.85:0.6,y:0.4,visibility:0.9}; points[23]={x:0.4,y:0.8,visibility:0.9};
      const {width,height}=data.bitmap; data.bitmap.close();
      if(data.testExercise==='elbow') {
        const radians=(data.testMotion==='outward'?150:data.testMotion==='target'?90:180)*Math.PI/180;
        points[15]={x:0.4+96*Math.sin(radians)/width,y:0.4-96*Math.cos(radians)/height,visibility:0.9};
      }
      const hands=[0.25,0.65].map(x=>Array.from({length:21},(_,i)=>({x:x+(i%4)*0.015,y:0.3+Math.floor(i/4)*0.02})));
      self.postMessage({type:'pose',sequence:data.sequence,timestampMs:data.timestampMs,width,height,inferenceMs:1,points,hands});
    };` }));
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      postMessage(message, transfer) { super.postMessage({ ...message, testMotion: window.__testMotion, testExercise: window.__testExercise }, transfer); }
    };
  });
  await page.selectOption('#delegate', 'CPU');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('CPU / Lite'));
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('2/2 hands'));
  await page.locator('#overlay').click({ position: { x: 40, y: 40 } });
  await page.locator('#overlay').click({ position: { x: 180, y: 40 } });
  // Six or more observations over >= 1 second are required by calibration.
  await page.waitForTimeout(1500);
  await page.locator('#calibrate').click();
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('elbowAngleDeg'));
  const displayed = JSON.parse(await page.locator('#output').innerText());
  if (displayed.samples[0].features.elbowAngleDeg !== 90) throw new Error('Known elbow geometry mismatch');
  await page.locator('#choose-target').click();
  const bounds = await page.locator('#overlay').boundingBox();
  await page.locator('#overlay').click({ position: { x: bounds.width * 0.15, y: bounds.height * 0.4 } });
  await page.locator('#reach-suitable').check();
  await page.locator('#reach-start').click();
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('REST'));
  await page.evaluate(() => { window.__testMotion = 'outward'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('OUTWARD'));
  await page.evaluate(() => { window.__testMotion = 'target'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('TARGET'));
  await page.evaluate(() => { window.__testMotion = 'rest'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.includes('1 measurable'));
  await page.locator('#finish-record').click();
  await page.waitForFunction(() => document.querySelector('#reach-results button') !== null);
  await page.locator('#reach-results button').first().click();
  await page.waitForFunction(() => document.querySelector('#replay').currentTime > 0);
  const measuredReach = await page.locator('#reach-results').innerText();
  await page.evaluate(() => {
    const video = document.querySelector('#replay');
    Object.defineProperty(video, 'duration', { configurable: true, value: 0.001 });
    video.dispatchEvent(new Event('durationchange'));
  });
  if (await page.locator('#reach-results button').count()) throw new Error('Truncated decoded video retained uncovered attempt replay');
  if (!(await page.locator('#reach-results').innerText()).includes('measurable') || !(await page.locator('#reach-status').innerText()).includes('1 measurable')) throw new Error('Replay failure changed measured attempt');
  await page.evaluate(() => { const video = document.querySelector('#replay'); delete video.duration; video.dispatchEvent(new Event('durationchange')); });
  await page.waitForFunction(() => document.querySelector('#reach-results button') !== null);
  if ((await page.locator('#reach-results').innerText()) !== measuredReach) throw new Error('Restored decoded duration changed measurements');
  process.stdout.write('PASS: controlled reach setup, recording anchor, complete attempt, summary, replay link and decoded-duration rejection/restoration.\n');
  await page.locator('#reach-start').click();
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('REST'));
  await page.evaluate(() => { window.__testMotion = 'outward'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('OUTWARD'));
  await page.locator('#reach-discomfort').click();
  await page.waitForFunction(() => document.querySelector('#reach-results').textContent.includes('reported discomfort'));
  if (await page.evaluate(() => document.querySelector('video').srcObject !== null)) throw new Error('Discomfort retained camera');
  process.stdout.write('PASS: discomfort finalized one excluded attempt and released camera.\n');
  await page.waitForFunction(() => !document.querySelector('#exercise').disabled);
  await page.selectOption('#exercise', 'elbow');
  await page.evaluate(() => { window.__testExercise = 'elbow'; window.__testMotion = 'rest'; });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('CPU / Lite'));
  await page.waitForTimeout(1500);
  await page.locator('#calibrate').click();
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('Elbow resting baseline captured'));
  await page.locator('#elbow-endpoint').fill('90');
  await page.locator('#reach-start').click();
  if (!(await page.locator('#reach-status').innerText()).includes('Describe elbow support')) throw new Error('Missing support allowed');
  await page.locator('#elbow-support').fill('None — synthetic test');
  await page.locator('#elbow-support').blur();
  await page.waitForTimeout(1500);
  await page.locator('#calibrate').click();
  await page.locator('#reach-start').click();
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('REST'));
  if (await page.locator('#exercise').isEnabled()) throw new Error('Exercise setup not locked during recording');
  await page.evaluate(() => { window.__testMotion = 'outward'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('BENDING'));
  await page.evaluate(() => { window.__testMotion = 'target'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.startsWith('BEND_ENDPOINT'));
  await page.evaluate(() => { window.__testMotion = 'rest'; });
  await page.waitForFunction(() => document.querySelector('#reach-status').textContent.includes('1 measurable'));
  await page.locator('#finish-record').click();
  await page.waitForFunction(() => document.querySelector('#reach-results button') !== null);
  const result = await page.locator('#reach-results').innerText();
  if (!result.includes('minElbowDeg: 90.00') || !result.includes('bendExcursionDeg: 90.00') || !result.includes('None — synthetic test')) throw new Error('Elbow metrics/support mismatch: ' + result);
  await page.locator('#reach-results button').first().click();
  await page.waitForFunction(() => document.querySelector('#replay').currentTime > 0);
  await page.selectOption('#exercise', 'reach');
  await page.locator('#reach-start').click();
  if (!(await page.locator('#reach-status').innerText()).includes('needs a running camera and baseline')) throw new Error('Exercise switch reused elbow baseline');
  process.stdout.write('PASS: SR02 baseline without reference, required support, setup locking, angle cycle, metrics, recording/replay, and exercise-switch reset.\n');
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  if (!await page.locator('#start').isEnabled()) throw new Error('Orientation change did not stop capture');
  if (await page.evaluate(() => document.querySelector('video').srcObject !== null)) throw new Error('Orientation retained stream');
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  });
  await page.reload(); await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('permission denied'));
  if (!await page.locator('#start').isEnabled()) throw new Error('Permission rejection left controls locked');
  process.stdout.write('PASS: no auto start; local assets; CPU frames; stop; controlled calibration/features; orientation cleanup; permission rejection. No physical-device evidence.\n');
} finally { await browser.close(); }
