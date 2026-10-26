// Shipped HTML entrypoint integration: real MediaRecorder/IndexedDB, controlled pose worker.
// Synthetic landmarks verify wiring and deterministic math, not device accuracy or clinical readiness.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { verifyGeminiBrowser } from './gemini-browser-scenarios.mjs';
import { verifyResponsiveSelection } from './responsive-browser-scenarios.mjs';

const PORT = Number(process.env.APP_BROWSER_PORT ?? 4174), BASE = `http://127.0.0.1:${PORT}/`;
const log = (message) => process.stdout.write(`${message}\n`);
await mkdir('test-results', { recursive: true });
const server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Vite static preview did not start')), 20_000);
  server.stdout.on('data', (chunk) => { if (String(chunk).includes(String(PORT))) { clearTimeout(timer); resolve(); } });
  server.on('exit', (code) => reject(new Error(`Vite preview exited ${code}`)));
});
const browser = await chromium.launch({ channel: process.env.APP_BROWSER_CHANNEL ?? 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], external = [], providerRequests = [];
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { const u = request.url(); if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u); if (u.includes('/api/gemini')) providerRequests.push(request); });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__motion = 'rest'; window.__exercise = 'seated_forward_reach'; window.__missing = false;
    window.__privacyProbes = []; window.__realPoseResults = 0; window.__recordingStarts = 0;
    window.__denyNextCamera = false; window.__cameraAttempts = 0;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__cameraAttempts++;
      if (window.__denyNextCamera) {
        window.__denyNextCamera = false;
        throw new DOMException('Test camera permission denial', 'NotAllowedError');
      }
      return originalGetUserMedia(...args);
    };
    const originalRecordStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(...args) { window.__recordingStarts++; return originalRecordStart.apply(this, args); };
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', (event) => { const {data}=event; if(data.type === 'privacy_probe') { window.__privacyProbes.push(data.url); event.stopImmediatePropagation(); } if(data.type === 'pose') window.__realPoseResults++; }); }
      postMessage(message, transfer) { super.postMessage({ ...message, motion: window.__motion, exercise: window.__exercise, missing: window.__missing }, transfer); }
    };
  });
  let controlled = false;
  await page.route('**/pose/pose-worker.js', (route) => controlled ? route.fulfill({ contentType: 'text/javascript', body: `
    self.onmessage = ({ data }) => {
      if (data.type === 'init') { self.postMessage({ type: 'ready' }); return; }
      const { width, height } = data.bitmap; data.bitmap.close();
      const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
      const stage = data.motion, id = data.exercise, endpoint = stage === 'endpoint', rest = stage === 'rest';
      const set = (index, x, y) => { points[index] = { x: x / width, y: y / height, visibility: data.missing ? 0 : .99 }; };
      set(11,200,100); set(13,200,160); set(15,260,160); set(23,200,300); set(25,250,300); set(27,250,350); set(29,230,350); set(31,300,350);
      if (id === 'seated_forward_reach') set(15,rest ? 260 : endpoint ? 400 : 320,160);
      if (id === 'seated_elbow_flexion_extension') { set(15,rest ? 220 : endpoint ? 260 : 250,rest ? 220 : endpoint ? 160 : 200); }
      if (id === 'seated_forward_arm_raise') { const angle=(rest ? 0 : endpoint ? 90 : 45)*Math.PI/180; set(23,200,250); set(13,200+50*Math.sin(angle),100+50*Math.cos(angle));set(15,200+100*Math.sin(angle),100+100*Math.cos(angle)); }
      if (id === 'seated_knee_extension') { const angle=(rest ? 90 : endpoint ? 150 : 120)*Math.PI/180;set(23,150,150);set(25,200,150);set(27,200-50*Math.cos(angle),150+50*Math.sin(angle)); }
      if (id === 'seated_single_leg_lift') { const elevation=rest ? 0 : endpoint ? 20 : 12;set(23,200,250);set(25,250,250-elevation);set(27,250,300-elevation); }
      if (id === 'seated_ankle_pumps') { const angle=(rest ? 0 : endpoint ? 15 : 8)*Math.PI/180;set(25,200,150);set(27,200,250);set(31,200+50*Math.cos(angle),250+50*Math.sin(angle));set(29,200-20*Math.cos(angle),250-20*Math.sin(angle)); }
      // Both anatomical sides have distinct positions; selection must retain fixed side indices.
      for (const [l,r] of [[11,12],[13,14],[15,16],[23,24],[25,26],[27,28],[29,30],[31,32]]) points[r]={...points[l]};
      self.postMessage({ type: 'pose', sequence: data.sequence, timestampMs: data.timestampMs, width, height, inferenceMs: 1, points, hands: [] });
    };` }) : (async () => {
      const response = await route.fetch();
      if (!response.headers()['content-security-policy']?.includes("connect-src 'self'")) throw new Error('The real worker response is missing the egress policy');
      // Test instrumentation only: exercise the SDK's actual periodic flush without a minute wait.
      const probe = `const originalInterval = self.setInterval; self.setInterval = (fn, ms, ...args) => originalInterval(fn, ms === 60000 ? 150 : ms, ...args);
        const originalFetch = self.fetch; self.fetch = (...args) => { self.postMessage({type:'privacy_probe', url:String(args[0])}); return originalFetch(...args); };
        const originalOpen = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url, ...args) { self.postMessage({type:'privacy_probe', url:String(url)}); return originalOpen.call(this, method, url, ...args); };\n`;
      await route.fulfill({ response, body: probe + await response.text() });
    })());
  const waitText = (id, text, timeout = 15000) => page.waitForFunction(([id, text]) => document.getElementById(id)?.textContent?.includes(text), [id, text], { timeout });
  const motion = (stage, missing = false) => page.evaluate(([m, missing]) => { window.__motion = m; window.__missing = missing; }, [stage, missing]);
  const ids = ['seated_forward_reach', 'seated_elbow_flexion_extension', 'seated_forward_arm_raise', 'seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'];

  const responsiveEvidence = await verifyResponsiveSelection({ page, base: BASE, log });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  if (await page.locator('.exercise-card').count() !== 6) throw new Error('The shipped root did not open the six HTML exercise cards');
  if (await page.locator('#root').count()) throw new Error('React entrypoint is still shipped');
  if (await page.locator('#setup-mirror').isChecked()) throw new Error('Camera preview must start unmirrored');
  if (await page.evaluate(() => document.querySelector('#live-video').srcObject !== null)) throw new Error('Camera started without user action');
  await page.screenshot({ path: 'test-results/html-selection-phone.png', fullPage: true });
  log('PASS shipped HTML root: six canonical exercise selections; camera and Gemini idle until enabled');

  // Real worker smoke uses fake camera, with model and WASM from the exact shipped asset paths.
  await page.evaluate(() => { window.__denyNextCamera = true; });
  await page.locator('.exercise-select[data-exercise-id="seated_forward_reach"]').click();
  await page.locator('#btn-confirm-exercise').click();
  await waitText('capture-status', 'Camera permission denied');
  const retry = page.locator('#btn-start-record');
  if (await retry.isDisabled() || await retry.getAttribute('aria-label') !== 'Open camera') throw new Error('Primary Open camera is disabled after permission denial');
  if ((await page.locator('#tracking-status').innerText()).includes('not clearly visible')) throw new Error('Permission denial incorrectly blames body framing');
  if (await page.evaluate(() => window.__recordingStarts !== 0 || document.querySelector('#live-video').srcObject !== null)) throw new Error('Permission denial started a recording or retained a camera');
  await page.locator('#setup-goal').fill('Preserve my setup on retry');
  await page.evaluate(() => { window.__denyNextCamera = true; });
  await retry.click();
  await page.waitForFunction(() => window.__cameraAttempts === 2);
  await waitText('capture-status', 'Camera permission denied');
  if (await retry.isDisabled()) throw new Error('A second permission denial disabled retry');
  await retry.click();
  await waitText('capture-technical-status', 'Tap two', 60000);
  if (await page.locator('#setup-goal').inputValue() !== 'Preserve my setup on retry') throw new Error('Camera retry erased entered setup');
  if (await page.evaluate(() => window.__cameraAttempts !== 3 || window.__recordingStarts !== 0)) throw new Error('Camera retry duplicated access or started recording prematurely');
  log('PASS permission denial: primary Open camera retries, repeated denial stays actionable, no framing blame or premature recording, setup preserved');
  await page.waitForFunction(() => window.__realPoseResults > 0 && window.__privacyProbes.some((url) => url.includes('odml.pa.googleapis.com')), null, { timeout:60000 });
  if (!(await page.locator('#capture-technical-status').textContent()).includes('Tap two')) throw new Error('Real worker preview did not become available');
  await page.locator('#btn-home').click();
  if (await page.evaluate(() => document.querySelector('#live-video').srcObject !== null)) throw new Error('Navigation failed to release camera');
  controlled = true;
  log('PASS real CPU pose worker loads model/WASM; accelerated SDK telemetry is blocked by worker CSP; navigation releases camera');

  for (const id of ids) {
    await page.evaluate((id) => { window.__exercise = id; }, id);
    await page.locator(`.exercise-select[data-exercise-id="${id}"]`).click();
    await page.locator('#btn-confirm-exercise').click();
    await page.waitForFunction(() => document.querySelector('#btn-start-record').dataset.recordReady === 'true');
    const before = await page.evaluate(() => window.__recordingStarts);
    await page.locator('#btn-start-record').click();
    await waitText('live-counts', 'Recording video');
    await motion('rest', true); await page.waitForTimeout(400);
    if (await page.evaluate(() => window.__recordingStarts) !== before + 1) throw new Error('Quick Record did not start exactly one recorder');
    await page.locator('#btn-stop-record').click();
    await page.waitForFunction(() => !document.querySelector('#video-only-results').hidden);
    await page.waitForFunction(() => document.querySelector('#playback-video').readyState >= 2);
    if (!await page.locator('#download-recording').getAttribute('href')) throw new Error('Quick recording has no downloadable video');
    if (!await page.locator('#page-5').isHidden()) throw new Error('Uncalibrated recording fabricated measured results');
    await page.locator('#btn-video-home').click();
    if (await page.evaluate(() => document.querySelector('#live-video').srcObject !== null)) throw new Error('Quick recording leaked camera tracks');
    await motion('rest');
  }
  log('PASS all six exercises: immediate Record with no setup; missing joints do not block video; Stop, playable replay and download; no invented measurements');

  async function setup(id) {
    await motion('rest'); await page.evaluate((id) => { window.__exercise = id; }, id);
    if (await page.locator('#btn-close-sessions').isVisible()) await page.locator('#btn-close-sessions').click();
    await page.locator(`.exercise-select[data-exercise-id="${id}"]`).click();
    await page.locator('#btn-confirm-exercise').click();
    await waitText('capture-technical-status', id === 'seated_ankle_pumps' ? 'Position camera' : id === 'seated_forward_reach' || id === 'seated_forward_arm_raise' || id === 'seated_single_leg_lift' ? 'Tap two' : 'Hold the resting');
    if (await page.locator('#btn-confirm-exercise').isVisible()) throw new Error('Selection Continue remains over camera preview');
    await page.waitForFunction(() => document.querySelector('#btn-start-record').dataset.recordReady === 'true');
    const expectedMetric = {
      seated_forward_reach: 'wrist', seated_elbow_flexion_extension: 'bend', seated_forward_arm_raise: 'upper-arm',
      seated_knee_extension: 'knee', seated_single_leg_lift: 'knee elevation', seated_ankle_pumps: 'shank-to-foot',
    }[id];
    const measurements = (await page.locator('#measurement-metrics').textContent()).toLowerCase();
    if (!measurements.includes(expectedMetric)) throw new Error(`${id}: What is measured does not use the matching exercise metrics`);
    if (['seated_knee_extension', 'seated_single_leg_lift', 'seated_ankle_pumps'].includes(id) && measurements.includes('elbow')) throw new Error(`${id}: measurement help fell back to elbow metrics`);
    if (!(await page.locator('#measurement-state').textContent()).includes('Preview')) throw new Error(`${id}: preview falsely claims analysis is recording`);
    await page.locator('#setup-mode').selectOption('rehabilitation');
    await page.locator('#setup-support').fill('Synthetic engineering fixture, chair support, no limb support'); await page.locator('#setup-support').blur();
    await page.locator('#setup-goal').fill('Synthetic assigned test endpoint'); await page.locator('#setup-goal').blur();
    if (id === 'seated_forward_reach') { await page.locator('#setup-target').fill('Fixed image target at (400,160)'); await page.locator('#setup-target').blur(); }
    await page.locator('#setup-attestation-context').fill('Explicit automated engineering fixture; no clinical attestation'); await page.locator('#setup-attestation-context').blur();
    await page.locator('#setup-attested').check(); await page.locator('#setup-team').check();
    const canvas = page.locator('#overlay-canvas');
    const geometry = await page.evaluate(() => { const v=document.querySelector('#live-video'), c=document.querySelector('#overlay-canvas'), b=c.getBoundingClientRect(), vb=v.getBoundingClientRect(); return { intrinsic:c.width/c.height, display:b.width/b.height, video:vb.width/vb.height, fit:getComputedStyle(v).objectFit }; });
    if (Math.abs(geometry.intrinsic-geometry.display)>.01 || Math.abs(geometry.video-geometry.display)>.01 || geometry.fit!=='fill') throw new Error(`Preview and intrinsic rectangular geometry disagree: ${JSON.stringify(geometry)}`);
    async function tap(x, y) {
      const size = await canvas.evaluate((c) => ({ w: c.width, h: c.height })); const box = await canvas.boundingBox();
      const mirror = await page.locator('#setup-mirror').isChecked();
      await canvas.click({ position: { x: (mirror ? 1 - x/size.w : x/size.w)*box.width, y: y/size.h*box.height } });
    }
    if (['seated_forward_reach','seated_forward_arm_raise','seated_single_leg_lift'].includes(id)) { await tap(20,20); await tap(120,20); }
    await page.waitForTimeout(1600); await page.locator('#btn-baseline').click();
    await page.waitForFunction(() => /baseline captured/i.test(document.querySelector('#capture-technical-status')?.textContent ?? ''));
    if (id === 'seated_forward_reach') await tap(400,160);
    if (id === 'seated_ankle_pumps') await page.locator('#setup-ankle-direction').check();
    await page.locator('#setup-confirmed').check();
    await page.waitForFunction(() => document.querySelector('#btn-start-record').dataset.recordReady === 'true');
  }
  for (const [index, id] of ids.entries()) {
    await setup(id);
    if (index === 0) {
      await page.locator('#setup-mirror').uncheck();
      if (await page.locator('#live-video').evaluate((v) => v.style.transform) !== '') throw new Error('Mirror did not update display');
      await page.locator('#setup-mirror').check();
      await page.locator('#shared-camera').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/html-preview-phone.png', fullPage: true });
    }
    await page.locator('#btn-start-record').click(); await page.waitForFunction(() => document.querySelector('#live-counts')?.textContent?.startsWith('REST ·'));
    if (!(await page.locator('#measurement-state').textContent()).includes('Recording')) throw new Error(`${id}: measurement state did not transition to actual recording`);
    if (!(await page.locator('#btn-settings').isDisabled())) throw new Error('Settings can obscure immediate Stop during recording');
    const stopBounds=await page.locator('#btn-discomfort').boundingBox(); if (!stopBounds || stopBounds.y<0 || stopBounds.y+stopBounds.height>844) throw new Error('Discomfort Stop is outside the visible phone viewport during recording');
    await motion('outward'); await page.waitForTimeout(450);
    await motion('endpoint'); await page.waitForTimeout(900);
    if (!(await page.locator('#live-counts').innerText()).includes('0 detected')) throw new Error(`${id}: held endpoint fabricated an attempt`);
    await motion('returning'); await page.waitForTimeout(450); await motion('rest');
    await waitText('live-counts', '1 detected · 1 measurable · 0 excluded').catch(async (error) => { log(`DIAGNOSTIC ${id}: ${await page.locator('#live-counts').innerText()} | ${await page.locator('#capture-status').innerText()}`); await page.screenshot({path:'test-results/html-failure.png',fullPage:true}); throw error; });
    await page.locator('#btn-stop-record').click();
    await waitText('report-details', id);
    await waitText('report-details', '1 detected = 1 measurable + 0 excluded');
    if (!(await page.locator('#report-details').innerText()).includes(id)) throw new Error(`${id}: report routed to another exercise`);
    await page.waitForFunction(() => document.querySelector('#playback-video').readyState >= 2);
    await page.getByRole('button', { name: 'Replay attempt 1', exact: true }).click();
    await page.waitForFunction(() => { const v=document.querySelector('#playback-video'); return !v.paused && v.currentTime>0; });
    await page.waitForFunction(() => document.querySelector('#playback-video').paused, null, { timeout:15000 });
    await page.locator('#btn-scroll-to-report').click();
    if (await page.locator('#playback-video').count() !== 1) throw new Error('Report navigation discarded the player');
    await page.locator('#btn-save-session').click(); await waitText('save-status','Saved on this device');
    if (index === 0) { await page.locator('#playback-video').scrollIntoViewIfNeeded(); await page.screenshot({path:'test-results/html-replay-phone.png',fullPage:true}); await page.locator('#metric-charts').scrollIntoViewIfNeeded(); await page.screenshot({path:'test-results/html-report-phone.png',fullPage:true}); }
    log(`PASS ${id}: matching calibration/analyzer, held endpoint, factual metric/chart, replay/seek, save`);
    await page.locator('#btn-return-home').click();
  }
  // Fresh page and real IndexedDB roundtrip: reopening one exercise must not mix it with others.
  await page.reload(); await page.locator('#btn-sessions').click();
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 6);
  if (await page.locator('.session-row').count() !== 6) throw new Error('Saved sessions were lost on reload');
  await page.locator('.session-row').first().getByRole('button',{name:'Open saved session'}).click();
  await waitText('save-status','Saved on this device');
  await page.waitForFunction(() => document.querySelector('#playback-video').readyState >= 2);
  page.once('dialog', (dialog) => dialog.accept()); await page.locator('#btn-delete-session').click(); await waitText('save-status','Deleted the saved copy');
  await page.locator('#btn-return-home').click(); await page.locator('#btn-sessions').click();
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 5);
  if (await page.locator('.session-row').count() !== 5) throw new Error('Deleting one session altered unrelated sessions');
  log('PASS save/reload/reopen restores correct facts/video; single deletion preserves five unrelated sessions');

  // Missing tracking and zero measured outcomes must stay zero/null, never sine-wave success.
  await setup('seated_elbow_flexion_extension'); await page.locator('#btn-start-record').click(); await page.waitForFunction(() => document.querySelector('#live-counts')?.textContent?.startsWith('REST ·'));
  await motion('rest',true); await page.waitForTimeout(1200); await page.locator('#btn-discomfort').click();
  await waitText('report-details','0 detected = 0 measurable + 0 excluded');
  await waitText('report-details','No measurable repetitions');
  if (await page.locator('#metric-charts circle').count()) throw new Error('Missing tracking fabricated chart values');
  await page.locator('#btn-generate-report').click();
  if (providerRequests.length) throw new Error('Provider called without explicit enablement/access code');
  log('PASS missing tracking, zero measurable, discomfort Stop, no synthetic charts or unauthorized provider requests');

  // Storage error remains separate from valid playback/facts.
  await page.evaluate(() => { const original=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args) { if(this.name==='videos') throw new DOMException('test quota','QuotaExceededError'); return original.apply(this,args); }; });
  await page.locator('#btn-save-session').click(); await waitText('save-status','Not enough browser storage');
  if (!(await page.locator('#report-details').innerText()).includes('0 detected')) throw new Error('Storage failure hid valid facts');
  log('PASS quota failure preserves local report and does not claim saved');

  // Leaving during asynchronous recorder finalization must not route back to stale results.
  await page.locator('#btn-return-home').click(); await setup('seated_knee_extension'); await page.locator('#btn-start-record').click();
  await page.locator('#btn-home').click(); await page.waitForTimeout(2500);
  if (!(await page.locator('#page-1').getAttribute('class')).includes('active')) throw new Error('Late recorder finalization navigated back after Home');
  log('PASS Home during recording ignores stale finalization and releases camera');

  const geminiEvidence = await verifyGeminiBrowser({ page, base: BASE, log });

  // Visual baseline retains demo cards, illustrations, monochrome surfaces and controls.
  const originalHtml=execFileSync('git',['show','origin/demo(html+ts)_QP:src/capture/developer-demo.html'],{encoding:'utf8'});
  const originalTs=execFileSync('git',['show','origin/demo(html+ts)_QP:src/capture/developer-demo.ts'],{encoding:'utf8'});
  const array=originalTs.slice(originalTs.indexOf('const SEATED_EXERCISES'),originalTs.indexOf('// Helper to safely')).replace('const SEATED_EXERCISES: ExerciseItem[]','const SEATED_EXERCISES');
  const refPage=await context.newPage(); await refPage.route('**/source-design-reference',route=>route.fulfill({contentType:'text/html',body:originalHtml.replace(/<script type="module"[^>]*><\/script>/g,'')}));
  await refPage.goto(`${BASE}source-design-reference`);
  await refPage.evaluate(`${array}; document.getElementById('exercise-list').innerHTML=SEATED_EXERCISES.map(e=>'<div class="exercise-card"><div class="card-left"><div class="exercise-title">'+e.title+'</div><div class="exercise-desc">'+e.desc+'</div><span class="radio-circle"></span></div><div class="card-right">'+e.svgIcon+'</div></div>').join('');`);
  await refPage.screenshot({path:'test-results/source-demo-phone.png',fullPage:true});
  await writeFile('test-results/html-browser-evidence.json',JSON.stringify({exercises:ids,errors,external,providerRequests:providerRequests.length,geminiEvidence,responsiveEvidence,sourceComparison:'Responsive phone, landscape and desktop screenshots verify native viewport layout; source-demo-phone.png retained as historical visual reference',physicalDevice:'not tested',realProvider:'not tested'},null,2));
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  if (external.length) throw new Error(`Unintended off-origin requests: ${external.join('; ')}`);
  log('PASS phone screenshots captured against source demo; zero page errors/off-origin/video uploads');
} catch (error) { failed = true; console.error(error); }
finally { await browser.close(); server.kill('SIGTERM'); }
if (failed) process.exitCode=1;
