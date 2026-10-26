# PRD: SCOOT — seated exercise camera, voice and review

> **Historical design document.** Preserved for engineering context; planned features and earlier decisions may differ from the current app. See the [current README](../README.md) and [architecture](../docs/scoot-architecture.md) for implemented behavior.

Updated October 25, 2026. This is the active product direction. It supersedes the earlier classifier-first plan and long pre-camera form. Previous requirements are retained as historical evidence in the archived PRD (historical reference; retained in the private development archive), not implementation instructions.

## 1. Purpose and current delivery status

Help a supervisor or suitable consenting team tester observe an assigned seated exercise using a phone camera, hear short instructions, then review the video alongside explainable movement measurements. The first complete exercise is seated forward reach. This is an experimental developer/judge demonstration, not an autonomous medical assessment or proof that movement is safe/correct.

Existing main contains MediaPipe camera/worker adapters, deterministic reach geometry and state machine, tracking rejection, configured flags, recording, local results/replay and IndexedDB storage. Reviewed source baseline `c88099f` passed 370 Vitest tests plus 13 catalog checks and documented browser regressions. These historical checks do not verify the new flow, Gemini, speech, public upload, or a physical iPhone. Those features remain planned.

The old exercise-classification provider is retired from the active design. Concurrent main commit `e4df442` has removed its runtime modules; the task plan now requires verification of that cleanup rather than restoring or repeating it. Gemini is used for speaking approved cues and explaining validated results, not choosing the active exercise or replacing measurement logic. No new provider call or deployment is authorized by editing this specification.

## 2. Confirmed user flow and wireframes

The three user-supplied October 25 wireframe screenshots define five views/states in iOS Safari on the planned HTTPS Vercel site. They are design references, not observed deployment/device acceptance. All exercise illustrations and demonstrations must show a seated person; standing stick figures in the sketches are placeholders. Safari's toolbar/address bar belongs to the browser and must not be recreated as app controls.

| View | Required experience |
| --- | --- |
| 1. Choose | Scrollable exercise cards with title, short description, seated illustration and one selected state. Selection exposes a clear Continue/Open camera confirmation. No patient-registration wall or mandatory text fields before preview. |
| 2. Preview | After confirmation and camera permission, show live video with MediaPipe joints/lines immediately when tracking arrives, before Record is pressed. Offer camera switch, measured arm and short guided calibration. Preview is not recording and does not upload. |
| 3. Record | Explicit Record starts video and analyzer on the actual recording-start clock. Show elapsed time, state/count, prominent Stop and discomfort controls. Maximum recording duration is 60 seconds. During the final five seconds show 5–4–3–2–1 remaining and optionally speak the approved countdown; at the limit stop once. No countdown before starting is implied by this design. |
| 4. Replay | After final data arrives, release camera and show the recorded video at the top with native playback controls. Missing/partial/unplayable evidence has an explicit status. A downward affordance scrolls to the report without replacing/discarding the video. |
| 5. Report | Below the player, show factual counts, per-attempt measurements, quality/exclusions, configured flags and patient-reported context, then the optional validated Gemini explanation and charts. This may be one scrollable results page, not a separate backend portal. |

After results, offer local Save and optional Share video → Copy link. Public sharing copies the recording; the original player and results remain usable. Returning from another tab must not erase them. A saved local session retains the public URL for later copying.

## 3. Scope and responsibilities

- **MediaPipe:** on-device camera frames → timestamped anatomical landmarks and skeleton overlay.
- **Deterministic analyzer:** required-joint quality, calibration, geometry, phase detection, repetition accounting, exclusions and configured comparisons. It is the authority for all numbers.
- **Cue controller:** converts validated local state events into approved short sentences; controls priority, cancellation and rate limits.
- **Gemini TTS:** renders approved text into speech. It does not diagnose movement or invent real-time instructions.
- **Gemini text:** drafts a structured explanation after Stop using validated facts and explicitly provided context. It cannot rewrite measurements or decide readiness/safety.
- **React/UI:** selection, preview, controls, video-first results, factual charts, model status and fallbacks.
- **IndexedDB:** same-browser saved recordings and results. Storage can be cleared/evicted; it is not a permanent medical archive.
- **Public video storage:** separately selected hosting for an explicitly published recording only; not a cloud patient/session database.

Quan P retains pose, calibration, analyzer, recording/timebase and local cue-event ownership. Quan N owns simplified screens, shared consumer schemas, persistence/report display, Gemini server adapters and upload/sharing. Both review contracts and phone behavior. Preserve reviewed source rather than importing the conflicting old application branch wholesale.

## 4. Functional requirements

### Entry, setup and recording

**FR-01 — Manual exercise selection.** Choose the exercise before measurement; no automatic classifier or model-confirmation workflow is required. The selected exercise determines view, landmarks, calibration and analyzer. Only implemented developer workflows can run. Six catalog entries do not mean six analyzers exist.

**FR-02 — Seated-only library.** Preserve the six candidate IDs and their definitions in [the exercise library](seated-exercise-library.md): reach, elbow bend/straighten, forward arm raise, knee extension, single-leg lift and ankle pumps. SR01 is the pilot; SR02 gained a React flow in concurrent commit `d8da0e3`, which needs acceptance against this specification; remaining analyzers stay unavailable. Do not use standing/jumping examples or require full-body standing calibration.

**FR-03 — Camera before paperwork.** A selection/confirmation action may request permission and enter preview without a long form. Auto-generate clearly labelled anonymous demo/session labels when needed by local schemas; never fabricate a clinician's attestation, diagnosis, support arrangement or consent. Keep actual measured side, suitability/demo confirmation, necessary task setup and optional advanced criteria accessible. Optional notes/context must not block preview.

**FR-04 — Brief guided calibration.** Preview and overlay work before recording. Before measured capture, require stable required landmarks, a supported recorder and exercise-specific calibration. Reach uses fixed resting shoulder/elbow/wrist/hip, two intrinsic-frame reference points and a fixed target. Show/speak one short setup step at a time. Changing camera, frame orientation/dimensions, side, seating/support or target invalidates setup. Camera visibility alone is not confirmation of appropriate placement.

**FR-05 — Permissions and controls.** Camera permission follows explicit user action; do not request microphone permission for text-to-speech. Show denied/unsupported/loading states and camera choice. Recording requires an explicit Record action; never record or publish merely because preview opens. Stop/discomfort remain accessible without a model response.

**FR-06 — Timing and termination.** Maximum 60 seconds with an elapsed timer and final-five-second countdown derived from the same monotonic recording clock. Early Stop bypasses any countdown and finalizes once. Stop analysis synchronously at recorder stop, before delayed final chunks. Timeout, app backgrounding, camera loss, orientation/setup change and missing final events preserve available data with honest status and release resources. Do not resume interrupted attempts.

### Measurement authority

**FR-07 — Preserve geometry and quality.** Follow [the reach measurement guide](seated-reach-measurement-guide.md). Use actual capture timestamps, unmirrored anatomical-side landmarks converted to intrinsic pixels and fixed calibration. Required joints for reach are shoulder, elbow, wrist and hip. Reject missing/unreliable/out-of-frame/degenerate evidence; use declared time-aware filtering and coverage/gap rules. Never substitute zero for unavailable metrics.

**FR-08 — Four reach measurements.** Report outward-interval peak projected elbow angle in degrees, peak forward baseline-relative torso inclination change in degrees, forward wrist displacement in fixed reference lengths and onset-to-first-target duration in seconds. Image-plane values are estimates, not 3D anatomical angles or measured centimeters. Preserve signed diagnostic samples separately from report metrics.

**FR-09 — Attempts.** Verify REST → OUTWARD → TARGET → RETURN → REST with reacquisition. One complete reach-return counts once; holding at target adds no count. Retain incomplete/excluded attempts once with readable reasons. Independent watchdog deadlines run even without valid inference arrivals. Counts satisfy detected = measurable + excluded; flagged ≤ measurable.

**FR-10 — Review criteria.** A supervisor may enable supported metric/operator/threshold criteria. Use strict full-precision comparisons on measurable attempts only; equality is not exceeded. Keep observed value, threshold, units, reason and replay timestamp. No enabled criterion means no flag. A flag means review requested, not wrong/unsafe movement. No universal form, disease, weakness, fatigue or recovery score.

**FR-11 — Status separation.** Measurement validity, recording completion, replay decode/range, local save, speech availability, report generation and upload success are independent. A model/upload/video failure cannot invalidate otherwise valid measurements; valid geometry cannot certify missing video. Keep all configuration and schema versions with local results.

### Spoken cues and reported context

**FR-12 — Event-driven spoken guidance.** Define approved sentence templates for setup, readiness, movement phase, tracking loss, final countdown and recording completion. Examples: “Hold your starting position”, “Your wrist is out of view. Pause”, “Return to your starting position”, “Recording stopped”. Only issue a phase cue when local state evidence supports it. No instruction to reach farther, endure discomfort, change treatment or infer medical safety.

**FR-13 — Gemini TTS and fallback.** A server-side adapter generates audio from the exact approved cue text, preferably cached/pregenerated per phrase/voice version. Do not send every frame or patient diagnosis to TTS. Start audio only following an appropriate user gesture; provide mute/replay and visible captions. Stop/discomfort cancels queued/in-flight playback and stale responses. Deduplicate transitions and rate-limit repeated warnings; prioritize stop/tracking messages over low-priority narration. Use available local/pre-recorded speech or captions on failure. Critical controls must never wait for the network.

**FR-14 — Symptoms and existing context.** Store optional explicit self-reported symptoms/discomfort separately from measured observations. Preserve who supplied text, when and whether confirmed; unknown/not reported is not “no symptoms”. Optional existing clinician-provided diagnosis/restrictions are context, not app findings. No microphone/transcription is required in this MVP. Do not infer pain or a diagnosis from pose. Current code has only discomfort yes/no/not_reported and a note; richer fields need a versioned migration.

### Results, Gemini report and charts

**FR-15 — Video-first local report.** After Stop, show playable video on top, then counts/units/quality and all attempt records, then context and generated explanation. Include per-attempt seek ranges with context clipped to both captured and decoded durations. The scroll/down button moves to the report; it never destroys the player or session. Save/reopen retains both recording and report states under actual browser limits.

**FR-16 — Minimal structured report input.** Build a separate versioned DTO from finalized validated session facts: selected exercise, metric definitions/units, observed counts/values, exclusions, tracking limits, configured flags and relevant timestamps. Selected exercise is legitimate explanation context, not a hidden exercise-classification experiment. Optional self-report/clinician context must retain provenance and only be sent if allowed by the approved deployment/data policy. Default excludes video, video URL, raw landmarks, identifiers and unrestricted notes. Do not reuse a classifier payload by silently adding medical information.

**FR-17 — Grounded Gemini explanation.** Request a bounded structured response with summary, measured observations linked to source facts, limitations and explicitly attributed reported context. Validate schema and semantic fidelity: numbers, counts, units, comparisons and nulls must match source facts; no new diagnoses, causes, treatment or exercise prescriptions. Render source numbers directly from the validated record, not generated prose. Reject unsupported content and show a deterministic template report instead. Generated text is labelled an experimental explanation, not a clinical assessment.

**FR-18 — Report lifecycle.** Stop renders local results immediately while optional report generation shows a separate loading state. Bind responses to immutable session/configuration versions; ignore late/cancelled/other-session responses. Missing key, provider failure, refusal, malformed content and timeout preserve video and local facts. Use bounded explicit requests, not uncontrolled regeneration/retries. Persist accepted report/provenance locally without making it public through the video URL.

**FR-19 — Charts.** Prefer factual visualizations as requested in the wireframe: measurable repetition counts, per-repetition metric comparisons and timestamped metric trends where accepted samples exist. The app renders charts from validated numeric data with units, null gaps, exclusions and configured threshold lines. Gemini may provide validated narrative or select from an allowlisted chart specification; it must not fabricate chart data, run arbitrary code, render arbitrary HTML or generate a picture as evidence. No misleading zero-measurable graphs or pooled incompatible units/exercises.

### Server/data boundaries

**FR-20 — Gemini server integration.** Keep credentials server-side. Separate TTS and text endpoints/adapters, strict size/schema validation, supported pinned model IDs verified against the account, timeouts, cancellation and deployment-appropriate request/spend controls. No browser VITE secret, request logging of personal context, or direct client provider key. Model IDs and approved prompt/voice/settings versions belong in evidence records, not guessed in this PRD.

**FR-21 — Clinical-use/provider gate.** Initial Gemini reporting uses synthetic measurement/context fixtures, with no real patient symptoms or diagnoses uploaded. Google's standard Gemini API terms checked October 25, 2026 restrict clinical-practice/medical-advice use and sensitive personal input to unpaid services. A paid key alone is not clinical-use approval. Before any real clinical context leaves the device, review the actual service/agreement, intended use and consent/data handling; otherwise keep context local and use the deterministic report. This gate does not prevent testing local camera math or generic approved cue audio with suitable team testers.

**FR-22 — No model safety dependency.** No model judges medical readiness, guarantees correct/safe exercise, discovers disease, selects a treatment or overrides Stop/quality rejection. A provider outage does not prevent manual selection, local capture, measurements, replay or saving.

### Storage and public sharing

**FR-23 — Local save and deletion.** Explicit local Save writes versioned session/attempt/report metadata and one video to IndexedDB transactionally; errors are visible. Reload/reopen restores saved results and playable evidence on the same origin/browser. Deleting one session does not affect another. Browser clearing/eviction and private browsing limitations are stated; unsaved memory is not promised to survive reload.

**FR-33 — Direct public video URL.** Preserve the previously approved sharing requirement: Stop → Share video → Copy link. Upload only the selected finalized usable compressed recording after this explicit action, with an inline notice that anyone with the link can view/forward it. No viewer account, private/expiring link, report portal, GIF conversion or full-session upload is required. Return a stable HTTPS URL serving video directly with remote playback/seek; not a temporary blob URL. Provider selection, duration/size/MIME/upload bounds and implementation remain pending. Expose the URL only after confirmed success; failure preserves local video/results. Keep storage upload secrets server-side.

Sharing is a copy, not a move: Copy does not navigate; Open uses a new tab; original video/results remain available when returning, including on iPhone. The public video works after the originating page closes/reloads. Save the URL with a locally saved session for future copying. Public video does not contain the textual symptom/diagnosis/report record or identifiers in filenames/metadata. Video itself may identify people; do not call it anonymous. Local deletion does not remove hosted/recipient copies or recall links; describe actual hosted retention/deletion rather than promising it. Public-copy testing is separate from local save and Gemini consent.

## 5. Technical architecture

```text
Phone Safari / React + TypeScript + Vite
  camera -> MediaPipe worker -> joint observations
       -> quality/calibration/math/state machine -> authoritative facts
       -> local cue events -> approved text -> speech controller
  camera -> MediaRecorder -> finalized video
  finalized facts -> local video-first report + validated charts
  optional explicit report request -> protected server -> Gemini text
  approved cue text -> protected server/cache -> Gemini TTS
  Save -> IndexedDB (video + facts + accepted explanation + optional shared URL)
  Share video -> separate storage upload -> public direct HTTPS video URL
```

Vercel HTTPS preview is planned for iPhone testing. Use the repository build and `dist/app` output; verify worker/models/WASM load from the deployed origin. A hosted page is not proof of Safari capture/recording support. Audio output permission, tab interruptions, rotation, model latency, saving and both local/public replay need actual device tests.

## 6. Acceptance and definition of done

- Selection/confirmation reaches seated preview without required patient text fields; joints appear before Record. Permission/unsupported states are actionable; preview alone neither records nor uploads.
- Reach calibration remains required for valid metrics. Existing 90°/180°, rectangular-frame/mirror, held-target, 12° versus illustrative 10°, missing wrist/hip, gaps, silence/watchdog and incomplete-return fixtures still pass.
- Record clock/timer/countdown agree; early Stop and 60-second expiry finalize once, cancel speech and preserve exclusions; all resources clean up.
- Approved audio/captions follow actual events without stale instructions. Test mute, denied/unavailable playback, slow TTS, duplicate events and backgrounding on physical Safari.
- Results show actual video above report/charts. Factual numbers survive all model failure modes. Synthetic Gemini tests reject altered numbers, unsupported diagnoses, prompt injection in context, misleading chart specs and late responses.
- Save/reopen/delete and explicit public-copy behavior meet FR-23/33, including second-device playback after sender closure and original-page replay after copying/opening.
- Typecheck, lint, relevant tests/builds/browser regressions and independent review pass on the integrated source. Record exact commit/device/OS/Safari/origin/model/MIME, limitations and failures. No synthetic/browser-emulation result closes physical or clinical gates.

## 7. Out of scope and references

No standing/walking exercises, universal form or disease scores, autonomous clinical coaching, microphone transcription, full-video model analysis, public symptom/report portal, account system, all-six automatic recognition or extra analyzer expansion during this pilot. Broader wellness flows, additional analyzers, reports/export and cross-session comparisons remain later work unless separately implemented/tested. The active checklist defines sequencing.

Official references checked for this revision: [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation), [Gemini API terms](https://ai.google.dev/gemini-api/terms). Structured format does not establish factual or clinical correctness. Preserve the exercise-specific math and release gates in the companion guides; legacy provider instructions there are superseded by this PRD and the new checklist until their documentation migration is complete.

## Concurrent source updates

Main advanced during this documentation work: `e4df442` removes the retired provider, `d8da0e3` adds exercise selection/elbow flow, and `24f44cf` adjusts skeleton/camera rendering. These commits were preserved through a clean merge. Their presence is not physical-device or Gemini acceptance. Reconcile the tasks against their actual behavior before implementing duplicate UI or cleanup.
