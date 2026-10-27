import { CaptureController, type CaptureSnapshot } from '../features/practice/capture-controller.js';
import { emptySetup, setupErrors, buildReachConfig, buildElbowConfig, buildArmRaiseConfig, buildKneeExtensionConfig, buildLegLiftConfig, buildAnklePumpsConfig, type SetupDraft, type ExerciseId } from '../features/setup/setup-model.js';
import { captureGuidance, mvpCaptureGuidance, canSaveStartingPosition, framingInstruction, trackingGuidance, primaryCaptureDisabled, REFERENCE_EXPLANATION, MEASUREMENT_EXPLANATIONS } from '../demo/capture-guidance.js';
import { EXERCISE_METRIC_MAP } from '../contracts/exercise-metrics.js';
import { captureOutcomeToRecord } from '../demo/capture-outcome.js';
import { buildVideoReportInput, videoTemplateReport, VIDEO_REPORT_LABEL, type ClinicianReport, type VideoReportInput } from '../contracts/video-report.js';
import type { PacePoint } from '../analysis/pace-monitor.js';
import { requestVideoReport } from '../report/video-report-client.js';
import { renderClinicianReport } from '../report/video-report-view.js';
import { getExerciseResults, formatExerciseMetric, exerciseReason } from '../features/review/exercise-metrics.js';
import { EXERCISE_REQUIRED_LANDMARKS, JOINT_STATUS_TEXT } from '../features/practice/tracking.js';
import { buildSessionMetricSeries, buildSessionReportInput } from '../contracts/session-report.js';
import { replayWindow } from '../contracts/reach-session.js';
import type { ReviewRecord } from '../contracts/review-session.js';
import { defaultExtras, type SessionExtras } from '../contracts/session-extras.js';
import { SessionStore } from '../storage/session-store.js';
import { ReportController, createReportTransport, type ReportState } from '../report/report-controller.js';
import { buildProviderReportInput, reportInputDigest } from '../report/report-input.js';
import { CueController } from '../speech/cue-controller.js';
import { CueSpeaker } from '../speech/cue-speaker.js';
import { CueEventDeriver } from '../speech/cue-events.js';
import { BrowserLocalVoice, GeminiCueAudioSource, HtmlAudioOutput } from '../speech/browser-audio.js';
interface ExerciseItem {
  id: ExerciseId;
  title: string;
  desc: string;
  svgIcon: string;
}

const SEATED_EXERCISES: ExerciseItem[] = [
  {
    id: 'seated_forward_reach',
    title: 'Seated Forward Reach',
    desc: 'Reach forward with arm at shoulder level toward target and return to rest.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Seated Leg -->
        <path d="M38 57h20v22" />
        <!-- Reaching Arm -->
        <path d="M38 38h38" stroke-width="2.5" />
        <!-- Target dot -->
        <circle cx="82" cy="38" r="2.5" fill="#ffffff" />
      </svg>
    `,
  },
  {
    id: 'seated_elbow_flexion_extension',
    title: 'Seated Elbow Bend / Straighten',
    desc: 'Bend elbow upward toward target angle and straighten smoothly back.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Seated Leg -->
        <path d="M38 57h20v22" />
        <!-- Bent Arm -->
        <path d="M38 38h16l-10-14" stroke-width="2.5" />
        <circle cx="54" cy="38" r="2" fill="#ffffff" />
      </svg>
    `,
  },
  {
    id: 'seated_forward_arm_raise',
    title: 'Seated Active Arm Raise',
    desc: 'Raise assigned arm forward and upward toward eye level, then lower.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Seated Leg -->
        <path d="M38 57h20v22" />
        <!-- Upward Raised Arm -->
        <path d="M38 38l30-22" stroke-width="2.5" />
        <circle cx="68" cy="16" r="2" fill="#ffffff" />
      </svg>
    `,
  },
  {
    id: 'seated_knee_extension',
    title: 'Seated Knee Extension',
    desc: 'Extend lower leg forward until knee is nearly straight, then return.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Other Leg -->
        <path d="M36 57h16v22" stroke="#444444" stroke-width="1.8" />
        <!-- Extended Leg -->
        <path d="M38 57h18l24-6" stroke-width="2.5" />
        <circle cx="56" cy="57" r="2" fill="#ffffff" />
      </svg>
    `,
  },
  {
    id: 'seated_single_leg_lift',
    title: 'Seated Single-Leg Lift',
    desc: 'Lift thigh gently off the seat surface with knee bent, then lower.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Lifted Leg -->
        <path d="M38 57l16-12v22" stroke-width="2.5" />
        <path d="M36 57h16v22" stroke="#444444" stroke-width="1.8" />
        <circle cx="54" cy="45" r="2" fill="#ffffff" />
      </svg>
    `,
  },
  {
    id: 'seated_ankle_pumps',
    title: 'Seated Ankle Pumps',
    desc: 'Point toes upward (dorsiflex) and downward (plantarflex) in rhythm.',
    svgIcon: `
      <svg viewBox="0 0 100 100" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <!-- Chair -->
        <path d="M28 40v35M28 60h24v15M52 60v15" stroke="#444444" stroke-width="2" />
        <!-- Head -->
        <circle cx="38" cy="26" r="7" />
        <!-- Torso -->
        <path d="M38 33v24" />
        <!-- Seated Leg & Foot Pump -->
        <path d="M38 57h20v18" />
        <path d="M58 75l14-6" stroke-width="2.5" />
        <path d="M72 69l-4-4" stroke-width="1.8" />
      </svg>
    `,
  },
];


function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}
const text = (id: string, value: string) => { el(id).textContent = value; };
const input = (id: string) => el<HTMLInputElement>(id);
const value = (id: string) => (el<HTMLInputElement | HTMLSelectElement>(id)).value;
const checked = (id: string) => input(id).checked;
const on = (id: string, action: () => void) => el(id).addEventListener('click', action);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
const status = (message: string) => text('app-status', message);
const today = () => new Date().toISOString().slice(0, 10);
const needsReference = (id: ExerciseId) => id === 'seated_forward_reach' || id === 'seated_forward_arm_raise' || id === 'seated_single_leg_lift';
const store = new SessionStore();
let draft = emptySetup(today());
let selected: ExerciseItem | null = null;
let current: { record: ReviewRecord; video: Blob | null; extras: SessionExtras; saved: boolean } | null = null;
let reportController: ReportController | null = null;
let viewGeneration = 0;
let videoUrl: string | null = null;
let decodedDurationMs: number | null = null;
let decodable: boolean | null = null;
let replayEndSec: number | null = null;
let helperSeeking = false;
let lastSetupSignature = '';
let expectedCaptureId: string | null = null;
let videoReport: { input: VideoReportInput; series: PacePoint[]; abort: AbortController | null; requests: number } | null = null;
const VIDEO_REPORT_MAX_REQUESTS = 2;
let captureDraft: SetupDraft | null = null;
let deriver = new CueEventDeriver(draft.exerciseId);
const preview = el<HTMLVideoElement>('live-video');
const canvas = el<HTMLCanvasElement>('overlay-canvas');
const playback = el<HTMLVideoElement>('playback-video');
const cloudAccess = () => checked('enable-gemini') ? value('gemini-access-code').trim() || null : null;
/** Explanations need only the explicit opt-in; the server decides whether a code is required (public demo). */
const geminiEnabled = () => checked('enable-gemini');
/** Recording cues whose expiry is shorter than a cold Gemini TTS request: cache them before they are needed. */
const PREFETCH_CUES = ['recording.started', 'pace.slow_down', 'tracking.multiple', 'countdown.5', 'countdown.4', 'countdown.3', 'countdown.2', 'countdown.1', 'stop.stopped', 'stop.time_limit'] as const;
let cuePrefetch: AbortController | null = null;
function prefetchCueAudio(): void {
  if (!cloudAccess()) return;
  cuePrefetch?.abort(); cuePrefetch = new AbortController();
  speaker.prefetch([...PREFETCH_CUES], cuePrefetch.signal);
}
const speaker = new CueSpeaker({
  controller: new CueController(),
  source: new GeminiCueAudioSource({ accessCode: cloudAccess }),
  output: new HtmlAudioOutput(), localVoice: new BrowserLocalVoice(),
  onCaption: (caption) => {
    if (!caption) { text('cue-caption', 'Captions appear here when a current instruction is available.'); return; }
    const delivery = { cloud_audio: 'Gemini audio', mock_audio: 'Mock provider tone, not speech', local_voice: 'Browser voice fallback', caption_only: 'Caption' };
    text('cue-caption', `${delivery[caption.delivery]}: ${caption.text}`);
  },
  onStatus: (s) => text('audio-status', `${s.muted ? 'Muted' : s.enabled ? 'Audio enabled' : 'Captions only'}. ${s.lastProblem ?? 'No microphone is requested.'}`),
});

const controller = new CaptureController(renderCapture, (outcome) => {
  if (outcome.config.sessionId !== expectedCaptureId || !captureDraft) return;
  const finalizedDraft = captureDraft;
  expectedCaptureId = null; captureDraft = null;
  try {
    const record = captureOutcomeToRecord(finalizedDraft, outcome);
    const video = outcome.recording && outcome.recording.blob.size > 0 ? outcome.recording.blob : null;
    showResults(record, video, defaultExtras(record.sessionId), false);
  } catch (error) { status(`Finalized facts failed validation: ${errorText(error)}`); }
}, () => performance.now(), (outcome) => {
  if (outcome.captureId !== expectedCaptureId) return;
  expectedCaptureId = null; captureDraft = null;
  clearResults(); speaker.stop();
  navigate(4);
  el('page-5').hidden = true; el('btn-scroll-to-report').hidden = true;
  el('video-only-results').hidden = false;
  const recording = outcome.recording;
  if (recording?.blob.size) {
    videoUrl = URL.createObjectURL(recording.blob); playback.src = videoUrl; playback.load();
    const download = el<HTMLAnchorElement>('download-recording');
    download.href = videoUrl; download.download = `exercise-recording.${recording.mimeType.includes('mp4') ? 'mp4' : 'webm'}`; download.hidden = false;
  } else el('download-recording').hidden = true;
  text('replay-status', recording?.blob.size ? `Video ready to replay or download.${outcome.message ? ` ${outcome.message}` : ''}` : 'No video was produced.');
  try {
    const input = buildVideoReportInput({ exerciseId: outcome.exerciseId, side: draft.side === 'right' ? 'right' : 'left', stopReason: outcome.stopReason ?? 'CAPTURE_FAILED',
      recordingDurationMs: recording ? Math.max(0, recording.endMs - recording.startMs) : null, hasVideo: !!recording?.blob.size, pace: outcome.pace });
    videoReport = { input, series: outcome.pace?.series ?? [], abort: null, requests: 0 };
    renderVideoReport(videoTemplateReport(input));
    status('Recording ended. The clinician movement report is shown below the replay.');
    // The report is the purpose of this view: request the Gemini version straight away when Gemini is set up.
    if (geminiEnabled()) requestVideoExplanation();
    else renderVideoReportStatus('Local report from measured angles and speeds. Turn on Gemini in Settings to generate the AI clinician report. No video or landmarks are ever sent.', false);
  } catch (error) {
    el('video-report').hidden = true;
    status(`Recording ended. The movement summary is unavailable: ${errorText(error)}`);
  }
});
function renderVideoReport(report: ClinicianReport): void {
  if (!videoReport) return;
  renderClinicianReport({ root: el('video-report'), bannerIcon: el('vr-banner-icon'), bannerStatus: el('vr-banner-status'), headline: el('vr-headline'), rom: el('vr-rom'),
    speed: el('vr-speed'), alerts: el('vr-alerts'), timeline: el('vr-timeline'), charts: el('vr-charts'), tracking: el('vr-tracking'), points: el('vr-points') },
    videoReport.input, report, videoReport.series, (sec) => {
      playback.currentTime = sec; playback.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    });
}
function renderVideoReportStatus(message: string, loading: boolean): void {
  text('video-report-status', message);
  el<HTMLButtonElement>('btn-video-report').disabled = loading || !videoReport || videoReport.requests >= VIDEO_REPORT_MAX_REQUESTS;
  el<HTMLButtonElement>('btn-video-report-cancel').disabled = !loading;
}
function requestVideoExplanation(): void {
  const target = videoReport;
  if (!target || target.abort || target.requests >= VIDEO_REPORT_MAX_REQUESTS) return;
  const abort = new AbortController();
  target.abort = abort; target.requests++;
  renderVideoReportStatus('Generating the Gemini clinician report… The local report is shown meanwhile.', true);
  void requestVideoReport(target.input, { accessCode: cloudAccess(), signal: abort.signal }).then((response) => {
    if (videoReport !== target || target.abort !== abort) return; // cancelled, superseded or view closed
    target.abort = null;
    if (!response.ok) { renderVideoReportStatus(`Gemini report unavailable: ${response.error.message} The local report above is unaffected.`, false); return; }
    renderVideoReport(response.report);
    renderVideoReportStatus(`${VIDEO_REPORT_LABEL} · ${response.provenance.source === 'gemini' ? `Gemini ${response.provenance.model}` : 'labelled offline mock'} · every number checked against the measured data.`, false);
  });
}
controller.attach(preview, canvas);

function navigate(page: 1 | 2 | 4): void {
  for (const id of [1, 2, 4]) el(`page-${id}`).classList.toggle('active', id === page);
  el('btn-home').hidden = page === 1;
  const settings = el<HTMLDialogElement>('settings-panel');
  if (settings.open) settings.close();
  text('view-label', page === 1 ? 'Choose an exercise' : page === 2 ? 'Preview and recording' : 'Replay and report');
  window.scrollTo(0, 0);
  updateContinueVisibility();
}
function clearResults(): void {
  el('page-5').hidden = false; el('btn-scroll-to-report').hidden = false;
  el('video-only-results').hidden = true; el('download-recording').removeAttribute('href');
  videoReport?.abort?.abort(); videoReport = null;
  viewGeneration++;
  reportController?.dispose(); reportController = null;
  playback.pause(); playback.removeAttribute('src'); playback.load();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null; current = null; decodedDurationMs = null; decodable = null; replayEndSec = null;
}
function home(): void {
  expectedCaptureId = null; captureDraft = null;
  speaker.stop(); speaker.setScope(null);
  controller.close('Capture view closed. Camera and pose worker released.');
  clearResults();
  el('selection-intro').hidden = false; el('exercise-list').hidden = false;
  el('session-list').hidden = true; el('sessions-heading').hidden = true;
  navigate(1); status('');
}
function updateContinueVisibility(): void {
  const visible = el('page-1').classList.contains('active') && !el('exercise-list').hidden && selected !== null;
  el('btn-confirm-exercise').hidden = !visible;
  el('page-1').classList.toggle('has-selection', visible);
}
function renderExercises(): void {
  const list = el('exercise-list'); list.replaceChildren();
  for (const exercise of SEATED_EXERCISES) {
    const card = document.createElement('article'); card.className = 'exercise-card'; card.dataset.exerciseId = exercise.id;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'exercise-select'; button.dataset.exerciseId = exercise.id;
    button.setAttribute('aria-pressed', 'false');
    const illustration = document.createElement('div'); illustration.className = 'card-right'; illustration.innerHTML = exercise.svgIcon; illustration.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div'); content.className = 'card-left';
    const title = document.createElement('div'); title.className = 'exercise-title'; title.textContent = exercise.title;
    const description = document.createElement('div'); description.className = 'exercise-desc'; description.textContent = exercise.desc;
    const radio = document.createElement('span'); radio.className = 'radio-circle'; radio.setAttribute('aria-hidden', 'true');
    content.append(title, description, radio); button.append(content, illustration); card.append(button);
    button.addEventListener('click', (event) => {
      selected = exercise;
      for (const item of list.querySelectorAll<HTMLElement>('.exercise-card')) item.classList.toggle('selected', item === card);
      for (const item of list.querySelectorAll<HTMLButtonElement>('.exercise-select')) item.setAttribute('aria-pressed', String(item === button));
      el('btn-confirm-exercise').setAttribute('aria-label', `Continue with ${exercise.title}`);
      el('btn-confirm-exercise').dataset.exerciseId = exercise.id;
      updateContinueVisibility();
      // Keyboard selection leads directly to the persistent Continue action; pointer selection stays on its card.
      (event.detail === 0 ? el('btn-confirm-exercise') : button).focus({ preventScroll: true });

    });
    list.append(card);
  }
  updateContinueVisibility();
}
function endpointFields(): void {
  const fields = el('endpoint-fields'); fields.replaceChildren();
  function field(label: string, key: 'elbowEndpointDeg' | 'armRaiseEndpointDeg' | 'kneeEndpointDeg' | 'legLiftEndpointElevation' | 'ankleEndpointDeg'): void {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const entry = document.createElement('input'); entry.type = 'number'; entry.step = 'any'; entry.value = draft[key]; entry.dataset.draft = key;
    entry.addEventListener('change', () => { draft[key] = entry.value; invalidateSetup(); }); wrapper.append(entry); fields.append(wrapper);
  }
  function direction(label: string, key: 'elbowForwardSign' | 'armRaiseForwardSign' | 'legLiftForwardSign' | 'ankleForwardSign' | 'ankleDirectionSign'): void {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const entry = document.createElement('select'); entry.dataset.draft = key;
    for (const [number, label] of [[1, 'Positive / screen-right'], [-1, 'Negative / screen-left']] as const) {
      const option = document.createElement('option'); option.value = String(number); option.textContent = label; entry.append(option);
    }
    entry.value = String(draft[key]); entry.addEventListener('change', () => { draft[key] = entry.value === '-1' ? -1 : 1; invalidateSetup(); });
    wrapper.append(entry); fields.append(wrapper);
  }
  switch (draft.exerciseId) {
    case 'seated_forward_reach': break;
    case 'seated_elbow_flexion_extension': field('Assigned bend endpoint (projected degrees)', 'elbowEndpointDeg'); direction('Fixed forward screen direction', 'elbowForwardSign'); break;
    case 'seated_forward_arm_raise': field('Assigned upper-arm angle endpoint (degrees)', 'armRaiseEndpointDeg'); direction('Fixed forward screen direction', 'armRaiseForwardSign'); break;
    case 'seated_knee_extension': field('Assigned knee extension endpoint (degrees)', 'kneeEndpointDeg'); break;
    case 'seated_single_leg_lift': field('Assigned knee elevation endpoint (fixed reference lengths)', 'legLiftEndpointElevation'); direction('Fixed forward screen direction', 'legLiftForwardSign'); break;
    case 'seated_ankle_pumps': {
      field('Assigned ankle excursion endpoint (degrees)', 'ankleEndpointDeg'); direction('Fixed forward screen direction', 'ankleForwardSign'); direction('Prescribed signed pump direction', 'ankleDirectionSign');
      const label = document.createElement('label'); label.className = 'choice';
      const entry = document.createElement('input'); entry.type = 'checkbox'; entry.id = 'setup-ankle-direction';
      entry.addEventListener('change', () => { draft.setupDirectionVerified = entry.checked; refreshReadiness(); });
      label.append(entry, 'I verified the prescribed direction against a labelled small setup motion. Close-view physical iPhone feasibility remains unverified.'); fields.append(label);
      break;
    }
  }
}
function criteriaFields(): void {
  const host = el('criteria-fields'); host.replaceChildren();
  for (const criterion of draft.criteria) {
    const row = document.createElement('div');
    const label = document.createElement('label'); label.className = 'choice';
    const enabled = document.createElement('input'); enabled.type = 'checkbox';
    enabled.addEventListener('change', () => { criterion.enabled = enabled.checked; input('setup-confirmed').checked = false; refreshReadiness(); });
    label.append(enabled, criterion.label); row.append(label);
    const op = document.createElement('select'); op.setAttribute('aria-label', `${criterion.label} operator`);
    for (const sign of ['>', '<'] as const) { const option = document.createElement('option'); option.value = sign; option.textContent = sign; op.append(option); }
    op.addEventListener('change', () => { criterion.operator = op.value === '<' ? '<' : '>'; input('setup-confirmed').checked = false; refreshReadiness(); });
    const threshold = document.createElement('input'); threshold.type = 'number'; threshold.step = 'any'; threshold.setAttribute('aria-label', `${criterion.label} threshold`);
    threshold.addEventListener('change', () => { criterion.threshold = threshold.value; input('setup-confirmed').checked = false; refreshReadiness(); });
    row.append(op, threshold); appendText(row, criterion.unit); host.append(row);
  }
}
function updateDraft(): void {
  const mode = value('setup-mode'); draft.mode = mode === 'rehabilitation' || mode === 'wellness' ? mode : '';
  draft.seatingSupport = value('setup-support'); draft.assignedRangeOrGoal = value('setup-goal'); draft.targetPlacement = value('setup-target');
  draft.attestationContext = value('setup-attestation-context'); draft.attested = checked('setup-attested'); draft.teamTestConfirmed = checked('setup-team');
  draft.previewMirrored = checked('setup-mirror');
}
function invalidateSetup(): void {
  speaker.stop(); deriver.reset(); input('setup-confirmed').checked = false;
  draft.setupDirectionVerified = false;
  const directionProof = document.getElementById('setup-ankle-direction');
  if (directionProof instanceof HTMLInputElement) directionProof.checked = false;
  if (controller.snapshot.phase === 'recording') controller.reportSetupChange(); else controller.resetSetup();
  refreshReadiness();
}
function refreshReadiness(): void {
  updateDraft();
  const snapshot = controller.snapshot;
  const errors = setupErrors(draft);
  text('setup-errors', errors.join('\n'));
  const calibrated = !!controller.calibration();
  input('setup-confirmed').disabled = !calibrated;
  const directionProof = document.getElementById('setup-ankle-direction');
  if (directionProof instanceof HTMLInputElement) directionProof.disabled = !snapshot.baseline;
  const guidance = mvpCaptureGuidance(snapshot, draft, calibrated, checked('setup-confirmed'));
  const recordButton = el<HTMLButtonElement>('btn-start-record');
  recordButton.disabled = primaryCaptureDisabled(snapshot);
  recordButton.dataset.recordReady = String(guidance.ready);
  recordButton.setAttribute('aria-label', guidance.ready ? 'Start recording' : guidance.recordLabel);
  text('record-action-label', guidance.recordLabel);
  text('capture-status', guidance.message);
  el<HTMLButtonElement>('btn-baseline').disabled = !canSaveStartingPosition(snapshot, draft.exerciseId);
}
async function openCamera(): Promise<void> {
  if (!selected) return;
  speaker.stop(); clearResults();
  const side = value('setup-side') === 'right' ? 'right' : 'left';
  draft = { ...emptySetup(today(), selected.id), participantLabel: `Anonymous demo ${crypto.randomUUID().slice(0, 8)}`, supervisorLabel: 'Demo supervisor (self-reported)', side };
  for (const id of ['setup-support', 'setup-goal', 'setup-target', 'setup-attestation-context']) input(id).value = '';
  for (const id of ['setup-attested', 'setup-team', 'setup-confirmed']) input(id).checked = false;
  el<HTMLSelectElement>('setup-mode').value = '';
  draft.cameraFacing = value('setup-camera') === 'user' ? 'user' : 'environment'; draft.previewMirrored = checked('setup-mirror');
  endpointFields(); criteriaFields();
  el('target-description-label').hidden = draft.exerciseId !== 'seated_forward_reach';
  text('setup-title', selected.title);
  text('setup-instruction', 'Press Record as soon as the MediaPipe skeleton appears. The steps below are optional and enable exercise measurements.');
  const steps = el('setup-steps'); steps.replaceChildren();
  const instructions = [framingInstruction(draft.exerciseId)];
  if (needsReference(draft.exerciseId)) instructions.push(REFERENCE_EXPLANATION);
  instructions.push('Hold the assigned starting position still for one second, then choose “Save starting position”.');
  if (draft.exerciseId === 'seated_forward_reach') instructions.push('Tap the assigned fixed reach target in the camera picture. Do not move the camera or the target afterwards.');
  if (draft.exerciseId === 'seated_ankle_pumps') instructions.push('Check the assigned foot direction with a labelled small setup motion, then confirm the direction below.');
  instructions.push('For optional measurements, complete the session details and confirmations below. You can record video without these steps.');
  for (const instruction of instructions) { const row = document.createElement('li'); row.textContent = instruction; steps.append(row); }
  text('measurement-explanation', MEASUREMENT_EXPLANATIONS[draft.exerciseId]);
  const metrics = el('measurement-metrics'); metrics.replaceChildren();
  for (const definition of Object.values(EXERCISE_METRIC_MAP[draft.exerciseId])) { const row = document.createElement('li'); row.textContent = `${definition.label} (${definition.unit === 'reference_lengths' ? 'fixed reference lengths' : definition.unit})`; metrics.append(row); }
  deriver = new CueEventDeriver(draft.exerciseId); speaker.setScope(crypto.randomUUID()); prefetchCueAudio();
  navigate(2);
  await controller.open({ facing: draft.cameraFacing, delegate: draft.delegate, mirrored: draft.previewMirrored, side, exerciseId: draft.exerciseId });
  refreshReadiness();
}
function renderCapture(snapshot: CaptureSnapshot): void {
  text('capture-technical-status', snapshot.message); el('capture-status').dataset.problem = String(snapshot.problem);
  if (snapshot.frameSize) el('shared-camera').style.aspectRatio = `${snapshot.frameSize.width} / ${snapshot.frameSize.height}`;
  const active = snapshot.phase === 'recording' || snapshot.phase === 'finalizing';
  el<HTMLButtonElement>('btn-settings').disabled = active;
  input('setup-side').disabled = active;
  input('setup-mirror').disabled = active;
  if (active && el<HTMLDialogElement>('settings-panel').open) el<HTMLDialogElement>('settings-panel').close();
  el('setup-fields').hidden = active; el('recording-actions').hidden = !active;
  el('recording-timer').hidden = !active;
  el('btn-start-record').hidden = active;
  for (const id of ['btn-stop-record', 'btn-discomfort', 'btn-setup-changed']) el<HTMLButtonElement>(id).disabled = snapshot.phase !== 'recording';
  const elapsed = Math.floor((snapshot.recordingMs ?? 0) / 1000); text('recording-timer', `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
  el('countdown-overlay').classList.toggle('active', snapshot.countdownSeconds !== null); text('countdown-digit', snapshot.countdownSeconds === null ? '' : String(snapshot.countdownSeconds));
  text('live-counts', snapshot.analyzerState === 'VIDEO_ONLY' ? 'Recording video · exercise measurements off' : `${snapshot.analyzerState ?? ''} · ${snapshot.counts?.detected ?? 0} detected · ${snapshot.counts?.measurable ?? 0} measurable · ${snapshot.counts?.excluded ?? 0} excluded · ${snapshot.counts?.flagged ?? 0} flagged`);
  const required = EXERCISE_REQUIRED_LANDMARKS[draft.exerciseId];
  text('tracking-status', trackingGuidance(snapshot, draft));
  const hasTracking = (snapshot.phase === 'previewing' || snapshot.phase === 'recording') && !!snapshot.tracking;
  text('tracking-details', hasTracking ? `${draft.side} side · ${required.map((joint) => `${joint}: ${snapshot.tracking?.[joint] ? JOINT_STATUS_TEXT[snapshot.tracking[joint]!] : 'No tracking'}`).join(' · ')}\nVisible and stable for ${(Math.min(snapshot.stableMs, 1000) / 1000).toFixed(1)} / 1.0 seconds.` : 'Joint visibility has not been assessed. Camera preview and body tracking must be running first.');
  el('tracking-details').parentElement?.toggleAttribute('open', !active && hasTracking && required.some((joint) => snapshot.tracking?.[joint] !== 'ok'));
  text('measurement-state', snapshot.analyzerState === 'VIDEO_ONLY' ? `Recording video without exercise measurements. Pace monitor on: ${snapshot.paceWarnings ?? 0} fast-movement warnings.` : snapshot.phase === 'recording' ? `Recording: the local ${selected?.title ?? 'selected exercise'} analyzer is processing accepted joint observations. Movement phase: ${snapshot.analyzerState ?? 'waiting for recorder start'}. Tracking visibility alone does not count a repetition.` : 'Preview only. Press Record when the skeleton appears; complete optional setup for exercise measurements.');
  const signature = JSON.stringify([snapshot.reference, snapshot.baseline, snapshot.target, snapshot.frameSize]);
  if (signature !== lastSetupSignature) { input('setup-confirmed').checked = false; draft.setupDirectionVerified = false; const proof = document.getElementById('setup-ankle-direction'); if (proof instanceof HTMLInputElement) proof.checked = false; lastSetupSignature = signature; }
  speaker.updateContext(deriver.context(snapshot));
  if (snapshot.phase === 'finalizing' || snapshot.phase === 'closed') speaker.stop();
  else speaker.submit(deriver.update(snapshot, performance.now()));
  refreshReadiness();
}
function retryCamera(): void {
  void speaker.enable();
  updateDraft();
  input('setup-confirmed').checked = false;
  void controller.open({ facing: draft.cameraFacing, delegate: draft.delegate, mirrored: draft.previewMirrored, side: draft.side === 'right' ? 'right' : 'left', exerciseId: draft.exerciseId });
}
function startRecording(): void {
  // Record is a user tap, which browsers require before audio may play: switch spoken cues on here.
  void speaker.enable(); prefetchCueAudio();
  el<HTMLDialogElement>('settings-panel').close();
  if (controller.snapshot.phase === 'idle' || controller.snapshot.phase === 'closed') {
    retryCamera();
    return;
  }
  updateDraft();
  const calibration = controller.calibration();
  const guidance = captureGuidance(controller.snapshot, draft, !!calibration, checked('setup-confirmed'));
  if (!guidance.ready || !calibration) {
    const id = crypto.randomUUID();
    expectedCaptureId = id;
    const error = controller.startVideoOnly(id);
    if (error) { expectedCaptureId = null; status(error); }
    else status('Recording video. Press Stop when finished.');
    return;
  }
  const id = crypto.randomUUID();
  captureDraft = structuredClone(draft);
  try {
    let error: string | null;
    switch (draft.exerciseId) {
      case 'seated_forward_reach': if (calibration.kind !== 'reach') throw new Error('Reach calibration required'); error = controller.start(buildReachConfig(draft, calibration, id), draft.seatingSupport); break;
      case 'seated_elbow_flexion_extension': if (calibration.kind !== 'elbow') throw new Error('Elbow calibration required'); error = controller.start(buildElbowConfig(draft, calibration, id), draft.seatingSupport); break;
      case 'seated_forward_arm_raise': if (calibration.kind !== 'arm_raise') throw new Error('Arm raise calibration required'); error = controller.start(buildArmRaiseConfig(draft, calibration, id), draft.seatingSupport); break;
      case 'seated_knee_extension': if (calibration.kind !== 'knee_extension') throw new Error('Knee calibration required'); error = controller.start(buildKneeExtensionConfig(draft, calibration, id), draft.seatingSupport); break;
      case 'seated_single_leg_lift': if (calibration.kind !== 'leg_lift') throw new Error('Leg lift calibration required'); error = controller.start(buildLegLiftConfig(draft, calibration, id), draft.seatingSupport); break;
      case 'seated_ankle_pumps': if (calibration.kind !== 'ankle_pumps') throw new Error('Ankle calibration required'); error = controller.start(buildAnklePumpsConfig(draft, calibration, id), draft.seatingSupport); break;
    }
    if (error) { expectedCaptureId = null; captureDraft = null; status(error); } else { expectedCaptureId = id; status('Recording locally. Stop immediately if uncomfortable.'); }
  } catch (error) { status(errorText(error)); }
}

function appendText(parent: HTMLElement, textContent: string, className?: string): HTMLElement {
  const p = document.createElement('p'); p.textContent = textContent; if (className) p.className = className; parent.append(p); return p;
}
function renderCharts(record: ReviewRecord): void {
  const host = el('metric-charts'); host.replaceChildren();
  const series = buildSessionMetricSeries(buildSessionReportInput(record));
  for (const metric of series) {
    const section = document.createElement('section'); section.className = 'graph-section'; section.dataset.metricId = metric.definition.id;
    appendText(section, `${metric.definition.label} (${metric.definition.unit})`, 'graph-title');
    appendText(section, 'One source-linked value per detected attempt. Excluded or unavailable attempts remain gaps.', 'graph-legend');
    const graph = document.createElement('div'); graph.className = 'graph-canvas-container'; section.append(graph); host.append(section);
    const valid = metric.points.flatMap((p) => p.value === null ? [] : [p.value]);
    if (!valid.length) { appendText(graph, 'Unavailable: no measurable source values.'); continue; }
    const values = [...valid, ...metric.thresholds.map((t) => t.threshold)];
    const min = metric.definition.id === 'orientedAngleDeg' ? -180 : Math.min(0, ...values);
    const max = metric.definition.id === 'orientedAngleDeg' ? 180 : Math.max(min + 1, ...values);
    const y = (n: number) => 115 - 95 * (n - min) / (max - min);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 320 140'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${metric.definition.label}, per attempt; nulls are gaps`);
    const add = (tag: 'line' | 'circle' | 'text', attrs: Record<string, string>, content?: string) => {
      const item = document.createElementNS(svg.namespaceURI, tag); for (const [key, val] of Object.entries(attrs)) item.setAttribute(key, val); if (content) item.textContent = content; svg.append(item); return item;
    };
    add('line', { x1: '35', y1: '115', x2: '305', y2: '115', stroke: '#666' });
    add('text', { x: '0', y: '22', fill: '#aaa', 'font-size': '9' }, max.toFixed(1)); add('text', { x: '0', y: '118', fill: '#aaa', 'font-size': '9' }, min.toFixed(1));
    for (const threshold of metric.thresholds) add('line', { x1: '35', y1: String(y(threshold.threshold)), x2: '305', y2: String(y(threshold.threshold)), stroke: '#d4a976', 'stroke-dasharray': '4 3' });
    for (const p of metric.points) {
      const x = metric.points.length === 1 ? 170 : 42 + (p.repetition - 1) * 255 / (metric.points.length - 1);
      add('text', { x: String(x), y: '133', fill: '#aaa', 'font-size': '9', 'text-anchor': 'middle' }, String(p.repetition));
      if (p.value === null) continue;
      // Scatter avoids interpolation across gaps and the ±180° ankle wrap boundary.
      const point = add('circle', { cx: String(x), cy: String(y(p.value)), r: '4', fill: '#fff', 'data-attempt-id': p.attemptId });
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `Attempt ${p.repetition}: ${p.value} ${metric.definition.unit}`; point.append(title);
    }
    graph.append(svg);
  }
}
function renderReportState(state: ReportState): void {
  const holder = el('generated-observations'); holder.replaceChildren();
  el<HTMLButtonElement>('btn-generate-report').disabled = state.status === 'loading';
  el<HTMLButtonElement>('btn-cancel-report').disabled = state.status !== 'loading';
  if (state.status === 'accepted') {
    text('gemini-summary-text', `${state.accepted.provenance.source === 'gemini' ? 'Experimental Gemini explanation' : 'Mock provider explanation, not live Gemini evidence'} · ${state.accepted.provenance.model}: ${state.accepted.report.summary}`);
    for (const observation of state.accepted.report.observations) appendText(holder, observation.text);
    for (const limitation of state.accepted.report.limitations) appendText(holder, limitation.text);
    if (current?.record.sessionId === state.accepted.sessionId) {
      const target = current;
      target.extras = { ...target.extras, acceptedReport: state.accepted };
      if (target.saved) void store.updateExtras(target.record.sessionId, (extras) => ({ ...extras, acceptedReport: state.accepted })).catch((error: unknown) => { if (current === target) text('save-status', `Explanation is visible but could not be persisted: ${errorText(error)}`); });
    }
  } else text('gemini-summary-text', state.status === 'loading' ? 'Requesting an optional explanation. Local facts, video and Save remain available.' : state.status === 'failed' ? `Explanation unavailable (${state.code}): ${state.message} Deterministic local facts remain available.` : state.status === 'cancelled' ? 'Explanation cancelled. Deterministic local facts remain available.' : 'Deterministic local facts. No generated explanation requested.');
}
async function prepareReport(): Promise<void> {
  if (!current) return;
  const target = current, generation = viewGeneration;
  try {
    const { input: reportInput } = buildProviderReportInput(target.record, target.extras.context);
    const digest = await reportInputDigest(reportInput);
    if (generation !== viewGeneration || target !== current) return;
    reportController = new ReportController({ sessionId: target.record.sessionId, input: reportInput, inputDigest: digest,
      transport: createReportTransport({ accessCode: cloudAccess }), existing: target.extras.acceptedReport,
      onChange: (state) => { if (target === current && generation === viewGeneration) renderReportState(state); } });
    renderReportState(reportController.state);
  } catch (error) { text('gemini-summary-text', `Optional explanation unavailable: ${errorText(error)}. Local facts remain available.`); }
}
function showResults(record: ReviewRecord, video: Blob | null, extras: SessionExtras, saved: boolean): void {
  clearResults(); current = { record, video, extras, saved };
  speaker.stop();
  text('cue-caption', 'Capture ended. Review the recording and factual results below.');
  status(saved ? 'Opened a saved session. Camera and recording are stopped.' : 'Capture ended. Camera and recording are stopped; local results are ready.');
  const results = getExerciseResults(record), summary = results.summary;
  navigate(4); text('report-exercise-name', results.name);
  for (const key of ['detected', 'measurable', 'excluded', 'flagged'] as const) text(`metric-${key}`, String(summary[key]));
  const details = el('report-details'); details.replaceChildren();
  appendText(details, `${summary.detected} detected = ${summary.measurable} measurable + ${summary.excluded} excluded. ${summary.flagged} flagged among ${summary.measurable} measurable attempts.`);
  appendText(details, `Exercise ${record.exercise.id} · ${record.configuration.side} · ${record.mode} · definition ${record.exercise.definitionVersion} · analysis ${record.configuration.version}`);
  appendText(details, `${record.createdAt} — ${record.endedAt}. Capture: ${record.capture.stopReason}${record.capture.message ? `; ${record.capture.message}` : ''}.`);
  appendText(details, `Configured criteria: ${results.criteria.length ? results.criteria.join('; ') : 'None enabled; no configured flags.'}`);
  appendText(details, 'Fully obscured movement may go undetected. Flags request replay review; they are not clinical assessments.');
  appendText(details, `Discomfort: ${record.discomfort.response === 'yes' ? 'Reported; capture stopped.' : 'Not reported. This does not mean no symptoms.'}`);
  for (const entry of extras.context.selfReport) appendText(details, `Self-report (${entry.source}, ${entry.confirmation}, ${entry.reportedAt}, ${entry.timing}): ${entry.originalText}`);
  for (const entry of extras.context.clinician) appendText(details, `Existing clinician-provided ${entry.category} (${entry.suppliedBy}, ${entry.verification}, ${entry.suppliedAt}; not an app finding): ${entry.text}`);
  if (summary.measurable === 0) appendText(details, 'No measurable repetitions. No medians or percentages are shown.');
  else for (const median of results.medians) appendText(details, `Median ${median.label}: ${median.value === null ? 'Unavailable (including ambiguous circular distributions)' : formatExerciseMetric(median, median.value)}`);
  renderCharts(record);
  const attempts = el('attempt-list'); attempts.replaceChildren();
  for (const [index, attempt] of results.attempts.entries()) {
    const row = document.createElement('article'); row.className = 'attempt-row'; row.dataset.attemptId = attempt.id;
    appendText(row, `Attempt ${index + 1}: ${attempt.classification} · ${(attempt.startMs / 1000).toFixed(2)}–${(attempt.endMs / 1000).toFixed(2)} s`);
    for (const metric of attempt.metrics) appendText(row, `${metric.label}: ${metric.value === null ? `Unavailable: ${metric.reasons.map(exerciseReason).join('; ')}` : formatExerciseMetric(metric, metric.value)}`, 'metric-line');
    for (const reason of attempt.reasons) appendText(row, exerciseReason(reason));
    appendText(row, `Tracking coverage ${(attempt.quality.coverage * 100).toFixed(0)}%; longest gap ${attempt.quality.longestGapMs.toFixed(0)} ms; ${attempt.quality.observationCount} valid observations.`);
    for (const flag of attempt.flagTexts) appendText(row, flag);
    const seek = document.createElement('button'); seek.textContent = `Replay attempt ${index + 1}`; seek.disabled = !video;
    seek.addEventListener('click', () => {
      const range = replayWindow(attempt, record.recording, decodable, decodedDurationMs);
      if (!range.available) { status(range.reason); return; }
      helperSeeking = true; replayEndSec = range.endSec; playback.currentTime = range.startSec;
      void playback.play().catch(() => status('Playback was blocked or the video could not be decoded.'));
      playback.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }); row.append(seek); attempts.append(row);
  }
  if (video) { videoUrl = URL.createObjectURL(video); playback.src = videoUrl; playback.load(); }
  text('replay-status', video ? `Recording evidence: ${record.recording.status}. Capture-to-video timing remains unverified on a physical device.` : 'Replay unavailable: no recording evidence is available. Local facts remain viewable.');
  text('save-status', saved ? 'Saved on this device. Browser storage may be evicted; this is not a clinical archive.' : 'Not saved. Save stores this video and its facts only in this browser.');
  el<HTMLButtonElement>('btn-delete-session').disabled = !saved;
  el<HTMLButtonElement>('btn-save-session').disabled = false;
  renderReportState({ status: 'idle' }); void prepareReport();
}
async function listSessions(): Promise<void> {
  const generation = ++viewGeneration;
  const holder = el('session-list'); holder.hidden = false; holder.replaceChildren();
  el('selection-intro').hidden = true; el('exercise-list').hidden = true; el('sessions-heading').hidden = false;
  updateContinueVisibility();
  try {
    const rows = await store.list(); if (generation !== viewGeneration) return;
    if (!rows.length) appendText(holder, 'No saved sessions on this device.');
    for (const row of rows) {
      const container = document.createElement('article'); container.className = 'session-row';
      appendText(container, row.readable ? `${row.taskLabel} · ${row.createdAt} · ${row.counts.measurable} measurable` : `Unreadable session: ${row.problem}`);
      if (row.readable) {
        const open = document.createElement('button'); open.textContent = 'Open saved session';
        open.addEventListener('click', () => { const opening = ++viewGeneration; void store.load(row.sessionId).then((saved) => { if (opening !== viewGeneration) return; speaker.stop(); controller.close(); showResults(saved.record, saved.video, saved.extras, true); if (saved.videoProblem || saved.extrasProblem) status([saved.videoProblem, saved.extrasProblem].filter(Boolean).join(' ')); }, (error: unknown) => status(errorText(error))); }); container.append(open);
      }
      const remove = document.createElement('button'); remove.textContent = 'Delete saved session';
      remove.addEventListener('click', () => { if (!confirm('Delete this saved session and its video from this device?')) return; void store.delete(row.sessionId).then(() => listSessions(), (error: unknown) => status(errorText(error))); }); container.append(remove); holder.append(container);
    }
  } catch (error) { appendText(holder, errorText(error)); }
}

on('btn-confirm-exercise', () => { void openCamera(); });
on('btn-settings', () => el<HTMLDialogElement>('settings-panel').showModal());
on('btn-close-settings', () => el<HTMLDialogElement>('settings-panel').close());
el('settings-panel').addEventListener('close', () => el('btn-settings').focus({ preventScroll: true }));
on('btn-retry-camera', retryCamera);
on('btn-baseline', () => controller.captureBaseline()); on('btn-reset-setup', invalidateSetup);
canvas.addEventListener('click', (event) => controller.tap(event.clientX, event.clientY));
on('btn-start-record', startRecording);
on('btn-stop-record', () => { speaker.stop(); controller.stop(); });
on('btn-discomfort', () => { speaker.stop(); controller.discomfort(); });
on('btn-setup-changed', () => { speaker.stop(); controller.reportSetupChange(); });
on('btn-return-home', home); on('btn-home', home); on('btn-close-sessions', home);
on('btn-video-home', home);
on('btn-video-report', requestVideoExplanation);
on('btn-video-report-cancel', () => { const target = videoReport; if (!target?.abort) return; target.abort.abort(); target.abort = null; renderVideoReportStatus('Gemini report cancelled. The local report above is unaffected.', false); });
on('btn-sessions', () => { home(); void listSessions(); });
on('btn-scroll-to-report', () => el('page-5').scrollIntoView({ behavior: 'smooth' }));
on('btn-enable-audio', () => { void speaker.enable(); prefetchCueAudio(); }); on('btn-replay-cue', () => speaker.replay());
input('mute-audio').addEventListener('change', () => { speaker.setMuted(checked('mute-audio')); text('btn-recording-mute', checked('mute-audio') ? 'Unmute audio' : 'Mute audio'); });
on('btn-recording-mute', () => { input('mute-audio').checked = !checked('mute-audio'); speaker.setMuted(checked('mute-audio')); text('btn-recording-mute', checked('mute-audio') ? 'Unmute audio' : 'Mute audio'); });
input('enable-gemini').addEventListener('change', () => { speaker.stop(); reportController?.cancel(); text('audio-status', checked('enable-gemini') ? 'Gemini endpoints enabled for explicit requests. Account/model availability and live behavior remain unverified.' : 'Gemini requests disabled. Browser voice/captions remain available.'); prefetchCueAudio(); });
input('gemini-access-code').addEventListener('change', () => { speaker.stop(); reportController?.cancel(); prefetchCueAudio(); });
on('btn-generate-report', () => {
  if (!geminiEnabled()) { status('Enable optional Gemini in Settings before requesting an explanation.'); return; }
  if (!reportController) { status('The optional explanation adapter is not ready. Local facts remain available.'); return; }
  reportController.request();
});
on('btn-cancel-report', () => reportController?.cancel());
on('btn-save-session', () => {
  const target = current; if (!target) return;
  el<HTMLButtonElement>('btn-save-session').disabled = true;
  const extrasAtSave = target.extras;
  void store.save(target.record, target.video, extrasAtSave).then(async () => {
    target.saved = true;
    if (current === target) el<HTMLButtonElement>('btn-delete-session').disabled = false;
    // An explanation may have been accepted while the transactional video save was pending.
    // Reconcile it after the save commits, preserving context/share updates from other writers.
    if (target.extras !== extrasAtSave) {
      const accepted = target.extras.acceptedReport;
      try { await store.updateExtras(target.record.sessionId, (extras) => ({ ...extras, acceptedReport: accepted })); }
      catch (error) { if (current === target) text('save-status', `Video and facts saved; latest explanation could not be persisted: ${errorText(error)}`); return; }
    }
    if (current === target) text('save-status', 'Saved on this device, including video, facts and any accepted explanation.');
  }, (error: unknown) => { if (current === target) text('save-status', errorText(error)); }).finally(() => { if (current === target) el<HTMLButtonElement>('btn-save-session').disabled = false; });
});
on('btn-delete-session', () => {
  const target = current; if (!target || !target.saved || !confirm('Delete this saved session and its video from this device?')) return;
  void store.delete(target.record.sessionId).then(() => { if (target !== current) return; target.saved = false; text('save-status', 'Deleted the saved copy. This open replay remains available until you leave.'); el<HTMLButtonElement>('btn-delete-session').disabled = true; }, (error: unknown) => status(errorText(error)));
});
for (const id of ['setup-mode', 'setup-goal', 'setup-attestation-context', 'setup-attested', 'setup-team']) el(id).addEventListener('change', () => { updateDraft(); input('setup-confirmed').checked = false; refreshReadiness(); });
for (const id of ['setup-support', 'setup-target']) el(id).addEventListener('change', () => { updateDraft(); invalidateSetup(); });
input('setup-confirmed').addEventListener('change', refreshReadiness);
el('setup-side').addEventListener('change', () => {
  const side = value('setup-side') === 'right' ? 'right' : 'left';
  if (side === draft.side) return;
  speaker.stop(); controller.close('Measured side changed. Open camera explicitly and calibrate again.');
  draft.side = side; input('setup-confirmed').checked = false; refreshReadiness();
});
el('setup-camera').addEventListener('change', () => { speaker.stop(); controller.close('Camera selection changed. Open camera explicitly and calibrate again.'); draft.cameraFacing = value('setup-camera') === 'user' ? 'user' : 'environment'; input('setup-confirmed').checked = false; });
input('setup-mirror').addEventListener('change', () => { draft.previewMirrored = checked('setup-mirror'); controller.setMirrored(draft.previewMirrored); });
playback.addEventListener('loadeddata', () => { decodable = true; decodedDurationMs = Number.isFinite(playback.duration) ? playback.duration * 1000 : null; });
playback.addEventListener('durationchange', () => { decodedDurationMs = Number.isFinite(playback.duration) ? playback.duration * 1000 : null; });
playback.addEventListener('error', () => { decodable = false; text('replay-status', 'Recording could not be decoded. Local measurement facts remain available.'); });
playback.addEventListener('timeupdate', () => { if (replayEndSec !== null && playback.currentTime >= replayEndSec) { playback.pause(); replayEndSec = null; } });
playback.addEventListener('seeked', () => { if (helperSeeking) helperSeeking = false; else replayEndSec = null; });
window.addEventListener('pagehide', () => { speaker.dispose(); reportController?.dispose(); controller.close(); store.close(); if (videoUrl) URL.revokeObjectURL(videoUrl); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { speaker.stop(); reportController?.cancel(); } });
renderExercises(); refreshReadiness();
