# SCOOT

*Stroke Coaching, Observation, and Ongoing Training*

**SCOOT turns a phone camera into a tool for reviewing seated rehabilitation exercises with stroke survivors and clinicians. Its [kinematic analysis](https://github.com/quanng28/scoot#the-math-behind-the-joints) measures joint angles, movement speed, and timing to ground AI summaries in measured evidence, with validation that rejects unsupported claims.**

## The problem

In the United States, a stroke occurs approximately **every 40 seconds**, and **more than 795,000 people** experience one each year, according to the [CDC](https://www.cdc.gov/stroke/data-research/facts-stats/).

Supporting practice beyond the clinic is a challenge. A [2020 study of 92 community-dwelling stroke survivors in India](https://doi.org/10.1002/pri.1827) found that only **28%** completed more than **70% of their prescribed home-exercise dosage**. This was one study, not a universal adherence rate. A [2020 Cochrane review of 22 trials involving 1,937 participants](https://www.cochrane.org/evidence/CD010255_telerehabilitation-services-stroke) found no clear difference in daily-living outcomes between remote and in-person rehabilitation, but the evidence was limited; it does not establish SCOOT's effectiveness.

**Exercise review needs more than a repetition count.** How far did the arm move? Did the torso lean forward? How fast was the movement? A video records what happened; SCOOT adds measured angles, timing, and replay timestamps so stroke survivors and clinicians have specific evidence to review together.

## How SCOOT helps

SCOOT is an experimental prototype for recording a short seated exercise and reviewing what happened alongside the video. Stroke survivors can see their tracked movement, while a supervising clinician can inspect joint angles, displacement, timing, and the exact moments that need a closer look.

Joint geometry turns tracked body points into estimated angles, displacement, and movement timing. This gives clinicians specific measurements and replay timestamps to inspect alongside the video, rather than relying on repetition counts alone. The phone calculates these measurements locally; optional Gemini summaries explain the recorded facts, while visible tracking limits show where evidence is missing. The goal is to support conversations about assigned exercises; clinical interpretation stays with the treating team.

## Demo

<img src="assets/scoot-recording.png" alt="SCOOT recording a seated arm raise with body and hand landmarks, elapsed time, and accessible stop controls" width="340" />

Live recording with a tracking overlay. This quick-recording view has calibrated exercise measurements off; pace monitoring runs separately. A demo video will replace this screenshot.

## From seated practice to clinician review

1. **Choose a seated exercise:** forward reach, elbow bend, arm raise, knee extension, single-leg lift, or ankle pumps.
2. **Open the camera:** see body and hand landmarks before recording. Complete exercise-specific calibration for full measurements.
3. **Record up to 30 seconds:** local analysis runs alongside video capture, with captions, spoken-cue integration, and prominent Stop, Discomfort, and Setup changed controls.
4. **Review the evidence:** replay the video alongside movement summaries, charts, tracking coverage, and timestamped events. Calibrated sessions support explicit local Save; quick recordings support replay and video download.

## The math behind the joints

To make exercise review explainable, each reported measurement follows a defined pipeline:

**Landmarks → intrinsic-frame pixels → quality checks → fixed calibration → geometry → repetition states → validated metrics → review criteria.**

Normalized landmarks become pixels using the inference frame's width and height. Analysis stays unmirrored; preview transforms preserve anatomical left/right. For seated reach, calibration fixes the resting shoulder, elbow, wrist and hip, target **T**, and reference length **L = ‖C₂ − C₁‖** between two calibration points for the entire attempt. Here **H** is the hip, **W₀** the resting wrist, **α₀** the resting torso inclination, and **s = sign(Tₓ − W₀ₓ)** the forward direction.

### Four seated-reach measurements

**1. Projected elbow angle.** With shoulder **S**, elbow **E**, and wrist **W**, the dot product measures the angle at the elbow:

$$
c = \frac{(S-E)\cdot(W-E)}{\|S-E\|\|W-E\|}
$$

$$
\theta = \arccos\left(\min(1,\max(-1,c))\right)\frac{180}{\pi}
$$

The ratio **c** is clamped to [−1, 1] to handle floating-point rounding. A projected straight arm approaches 180°. Invalid or near-zero limb vectors are rejected before division.

**2. Torso inclination change.** The shoulder–hip line is compared with its resting baseline, retaining the calibrated forward direction:

$$
\alpha = \mathrm{atan2}(S_x-H_x,-(S_y-H_y))\frac{180}{\pi}
$$

$$
\Delta\alpha = s\,\mathrm{wrapTo180}(\alpha-\alpha_0)
$$

`atan2` retains the direction of the torso line; `wrapTo180` gives the smallest signed difference from the resting angle. Report the maximum positive forward change, clipped at zero.

**3. Forward wrist displacement.** Project movement onto the fixed rest-to-target direction and normalize by the fixed reference:

$$
d=\frac{T-W_0}{\|T-W_0\|}
$$

$$
f(t)=\frac{(W(t)-W_0)\cdot d}{L}
$$

Results use **reference lengths**, not centimeters. Forward displacement is distinct from total displacement or path length.

**4. Reach duration.** Use monotonic capture timestamps in milliseconds from movement onset to first confirmed target entry, excluding target hold and return:

$$
t_{\mathrm{reach}}=\frac{t_{\mathrm{target}}-t_{\mathrm{onset}}}{1000}\ \mathrm{seconds}
$$

All three geometric peaks use that same outward interval. These are **2D kinematic estimates**, not force, muscle activation, or a clinical range-of-motion examination. Each other exercise has its own joint definitions and endpoint rules.

### Turning movement into trustworthy repetitions

The reach state machine follows **REST → OUTWARD → TARGET → RETURN**, with rest reacquisition after interruptions. Time-based dwell and hysteresis prevent jitter or a held target from adding repetitions. Quality gates check landmark visibility, finite geometry, elapsed-time coverage, and tracking gaps. Unavailable measurements retain null values and reasons.

Only measurable attempts receive configured review flags, using strict full-precision comparisons; equality does not exceed a threshold. Counts preserve **detected = measurable + excluded**. Flags request human review rather than declaring movement correct or safe.

A separate calibration-free pace monitor estimates angular and limb-normalized linear speeds using actual elapsed time, smoothing, and bounded gap handling. Its experimental warning thresholds are separate from calibrated reach criteria.

See the [measurement guide](tasks/seated-reach-measurement-guide.md) for the full geometry, calibration, quality gates, and repetition contract. The [exercise library](tasks/seated-exercise-library.md) defines each exercise; these design documents include historical requirements that may differ from the current app.

## Explaining results and keeping video and clinical notes local

Stroke survivors and their supervising clinician can review the local report without Gemini. When enabled and configured, Gemini receives allowlisted finalized facts to produce a structured explanation. Quick-recording reports contain a headline, range of motion, speed/control, event-linked alerts, tracking quality, and clinician review points. Responses are validated on the server and in the browser; rejected output leaves the local report available.

Video and raw landmarks stay on-device. Real clinical notes stay local. Gemini TTS receives approved cue identifiers through a server adapter; captions and browser speech provide fallback paths. API keys remain server-side.

## Built with

**TypeScript · HTML · Vite · MediaPipe Pose/Hand Landmarker · Web Workers/WASM · MediaRecorder · IndexedDB · Gemini API · Vercel**

## Run locally

Requires **Node 22.13+ within Node 22**, npm 10, and a camera-capable browser.

```sh
npm ci
npm run app:dev
```

Run repository checks with `npm run check`. Optional server-side Gemini configuration is documented in [.env.example](.env.example); provider access is disabled by default. The Vite development server alone does not run the serverless Gemini endpoints.

See the [documentation index](docs/README.md) for architecture, measurement contracts, and verification evidence.

## Current limits

Designed around seated exercise review for stroke survivors. This experimental prototype is not clinically validated and does not replace individualized rehabilitation guidance. Camera view, occlusion, and tracking quality limit the measurements; a camera cannot detect pain. Physical-device audio and camera behavior need further verification, particularly spoken playback and close-view ankle tracking. Browser storage can be cleared or evicted. Public video sharing and cross-session comparisons are not implemented.

## LLM pipeline and evaluation

The server-only `SCOOT_LLM_PIPELINE=direct|langchain` flag defaults to `direct` (unset, empty or unrecognized values preserve direct behavior). `langchain` adds named LangChain runnables around the existing Gemini REST adapter: generate → existing JSON/schema/semantic validation → at most one targeted repair → validation again → deterministic local fallback. Only validation rejection permits repair. Provider errors, refusals, timeouts, cancellation, missing configuration and input rejection do not retry. Both calls share the 20-second server budget and consume the existing hourly/lifetime call limits.

The measured-session and quick-recording branches keep their existing prompts, output contracts, digest binding, browser validation, controller states and immediate local reports. Optional pipeline provenance is backward compatible with stored reports. Structured local events contain timings, codes and provider-reported usage; they contain no prompts, outputs, context or secrets. Server requests suppress LangSmith tracing even when tracing environment flags are inherited.

```sh
npm ci
npm run check
npm run eval:report                         # deterministic fake provider; no external calls
npm run eval:report -- --runs 1 --max-calls 12
# Later, with server-side GEMINI_API_KEY configured:
npm run eval:report -- --live --yes --fixture measured-forward_reach --runs 1 --max-calls 3
```

The harness tests both actual endpoint paths on 26 fictional fixtures. Before live execution it prints the maximum call count and generation settings and requires `--yes`; `--max-calls` is a hard cap (default 200). JSON outcomes and a Markdown summary are written to ignored `eval-results/`. Optional `--trace --yes` requires `LANGSMITH_API_KEY` and runs only in the synthetic evaluation process; trace inputs/outputs are hidden and only allowlisted step metadata is attached.

First-pass validity means the existing validator accepts the first output; final validity includes one successful repair. Recovery uses initially rejected outputs as its denominator. Fallback includes validation/provider/preflight failures and cancellation. Latency uses measured nearest-rank p50/p95; usage is reported only when returned by the provider. See the preregistered [acceptance criteria](docs/report-eval/acceptance.md), [environment and official API references](docs/report-eval/environment.md) and [handoff](docs/langchain-handoff.md).

Current **live synthetic** results:

| Pipeline | First-pass validity | Final validity | Repair recovery | Fallback rate | p95 latency | Tokens |
| --- | --- | --- | --- | --- | --- | --- |
| direct | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |
| langchain | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |

Fake evaluations verify mechanics, not model efficacy, live cost or clinical usefulness. No clinician validation or real patient data is included. Measured validation can accept an explanation that cites only some facts (its copied summary still states every count). Quick validation (`video-report-validator.v3`) rejects headlines that omit or contradict the supplied overall status and unit-bearing numbers attributed to the wrong quantity; the evaluation still lists any accepted-output caveat its local detector finds and flags status contradictions as release blockers. Keep the default direct setting until live acceptance is complete.
