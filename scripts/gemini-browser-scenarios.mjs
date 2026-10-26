// Actual HTML UI -> actual protected handlers in explicit mock mode. No provider fetch or credentials.
import { createHash } from 'node:crypto';
import { createReportEndpoint } from '../dist/server/gemini/report-endpoint.js';
import { createTtsEndpoint } from '../dist/server/gemini/tts-endpoint.js';

export async function verifyGeminiBrowser({ page, base, log }) {
  const code = 'browser-fixture-access-0123456789';
  const config = { mode: 'mock', apiKey: null, textModel: 'gemini-3.8-flash', ttsModel: 'gemini-3.8-flash-lite-tts', ttsVoice: 'Kore',
    accessCodeSha256: createHash('sha256').update(code).digest('hex'), allowedOrigins: [new URL(base).origin],
    limits: { reportPerHour: 10, ttsPerHour: 60, maxPerInstance: 100 } };
  const report = createReportEndpoint({ config });
  const tts = createTtsEndpoint({ config });
  let mode = 'failure', releaseLate = () => undefined, reportCalls = 0, ttsCalls = 0;
  let lateStarted = () => undefined;
  const calls = [];
  const fulfill = async (route, response) => route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  await page.route('**/api/gemini-report', async (route) => {
    reportCalls++;
    const request = route.request(), body = request.postDataJSON();
    calls.push(body);
    if (request.headers().authorization !== `Bearer ${code}`) throw new Error('HTML report request omitted its runtime access code');
    if (JSON.stringify(body).includes('LOCAL_ONLY_')) throw new Error('Local context crossed the browser boundary');
    if (body.input.context.selfReport.length || body.input.context.clinician.length) throw new Error('Real context was transferred');
    if (mode === 'failure') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'PROVIDER_ERROR', message: 'Mocked provider outage.' } }) });
    const response = await report(new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postData() }));
    if (response.status !== 200) throw new Error(`Mock handler rejected UI input: ${await response.text()}`);
    if (mode === 'late') { lateStarted(); await new Promise((resolve) => { releaseLate = resolve; }); }
    await fulfill(route, response).catch(() => undefined); // navigation can abort the intentionally stale request
  });
  await page.route('**/api/gemini-tts', async (route) => {
    ttsCalls++;
    const request = route.request(), body = request.postDataJSON();
    if (Object.keys(body).sort().join(',') !== 'catalogVersion,cueId') throw new Error('Speech payload contains more than an approved catalog cue');
    const response = await tts(new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postData() }));
    if (response.status !== 200) throw new Error(`Mock TTS rejected UI cue: ${await response.text()}`);
    await fulfill(route, response);
  });
  const openSettings = async () => { await page.locator('#btn-settings').click(); await page.locator('#settings-panel').waitFor({ state: 'visible' }); };
  const closeSettings = async () => { await page.locator('#btn-close-settings').click(); await page.locator('#settings-panel').waitFor({ state: 'hidden' }); };
  const waitText = (id, text) => page.waitForFunction(([id, text]) => document.getElementById(id)?.textContent?.includes(text), [id, text]);
  const openFirst = async (index = 0) => {
    await page.locator('#btn-sessions').click();
    await page.locator('.session-row').nth(index).getByRole('button', { name: 'Open saved session' }).click();
    await waitText('save-status', 'Saved on this device');
    await page.waitForFunction(() => document.querySelector('#btn-generate-report') && !document.querySelector('#btn-generate-report').disabled);
  };
  await page.reload(); // restore any deliberate quota-failure monkeypatch
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('scoot-review'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('extras', 'readwrite'), store = tx.objectStore('extras'), rows = store.getAll();
      rows.onsuccess = () => { for (const row of rows.result) { row.context = { schemaVersion: 'session-context.v1', selfReport: [{ id: 'sr-1', kind: 'self_report', originalText: 'LOCAL_ONLY_SELF_REPORT_FIXTURE', reportedAt: '2026-10-25T12:00:00Z', timing: 'after_recording', source: 'participant', confirmation: 'unconfirmed', dataClass: 'real' }], clinician: [{ id: 'cc-1', kind: 'clinician_context', text: 'LOCAL_ONLY_CLINICIAN_FIXTURE', category: 'restriction', suppliedAt: '2026-10-25T12:00:00Z', suppliedBy: 'supervisor_relaying_clinician', verification: 'unverified', dataClass: 'real' }] }; store.put(row); } };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  });
  await openFirst();
  await waitText('report-details', 'LOCAL_ONLY_SELF_REPORT_FIXTURE');
  await waitText('report-details', 'LOCAL_ONLY_CLINICIAN_FIXTURE');
  const originalFacts = await page.locator('#report-details').innerText();
  await openSettings();
  await page.locator('#gemini-access-code').fill(code);
  await page.locator('#enable-gemini').check();
  await closeSettings();
  await page.locator('#btn-generate-report').click();
  await waitText('gemini-summary-text', 'PROVIDER_ERROR');
  if (await page.locator('#report-details').innerText() !== originalFacts) throw new Error('Provider failure changed authoritative facts');
  if (!(await page.locator('#playback-video').getAttribute('src'))?.startsWith('blob:')) throw new Error('Provider failure discarded video');
  mode = 'success';
  await page.locator('#btn-generate-report').click();
  await waitText('gemini-summary-text', 'Mock provider explanation, not live Gemini evidence');
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => { const r = indexedDB.open('scoot-review'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise((resolve) => { const r = db.transaction('extras').objectStore('extras').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return rows.filter((x) => x.acceptedReport !== null).length === 1;
  });
  await page.reload(); await openFirst();
  await waitText('gemini-summary-text', 'Mock provider explanation, not live Gemini evidence');
  log('PASS enabled HTML report -> protected mock handler; failure preserves facts/video; local context withheld; accepted explanation survives reload');
  await openSettings();
  await page.locator('#gemini-access-code').fill(code); await page.locator('#enable-gemini').check();
  await closeSettings();
  mode = 'late';
  const started = new Promise((resolve) => { lateStarted = resolve; });
  await page.locator('#btn-generate-report').click(); await started;
  await page.locator('#btn-return-home').click(); await openFirst(1);
  releaseLate();
  await page.waitForTimeout(200);
  await waitText('gemini-summary-text', 'Deterministic local facts');
  log('PASS late mock report after navigation cannot attach to another saved session');
  await page.locator('#btn-return-home').click();
  await openSettings();
  await page.locator('#btn-enable-audio').click();
  await closeSettings();
  await page.locator('.exercise-select[data-exercise-id="seated_forward_reach"]').click();
  await page.locator('#btn-confirm-exercise').click();
  await waitText('cue-caption', 'Mock provider tone, not speech');
  await page.locator('#btn-home').click();
  if (reportCalls !== 3 || !ttsCalls) throw new Error(`Unexpected mock provider wiring counts: ${reportCalls} reports, ${ttsCalls} speech`);
  log('PASS gesture-enabled TTS -> protected mock handler; catalog-only input and honest mock-tone caption; no microphone');
  return { reportCalls, ttsCalls, contextWithheld: calls.every((c) => !c.input.context.selfReport.length && !c.input.context.clinician.length), realProvider: false };
}
