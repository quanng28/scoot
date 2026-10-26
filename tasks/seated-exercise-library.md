# Seated Exercise Library and Recognition Contract

> **Historical design document.** Preserved for engineering context; planned features and earlier decisions may differ from the current app. See the [current README](../README.md) and [architecture](../docs/scoot-architecture.md) for implemented behavior.

Date / scope revision: October 24, 2026

Status: Six candidate catalog entries accepted; clinical review, parameters, adapters, and per-exercise physical-device validation pending. No analyzer is certified available by this document.

Read with the [PRD](prd-post-stroke-seated-reach-review.md), [shared measurement guarantees and detailed reach module](seated-reach-measurement-guide.md), [parent tasks](tasks-post-stroke-seated-reach-review.md), and Quan N handoff (historical reference; retained in the private development archive).

## 1. Product boundary and two flows

- **Rehabilitation:** supervised, clinician-assigned seated activity after stroke. Recent-stroke participation requires the treating team's suitability decision; the app does not provide acute care or establish medical readiness.
- **Wellness:** a separate supervised flow using suitable clinician-confirmed seated activities, activity logging, and vascular-health education. It is not a stroke-prevention treatment or an individual risk calculator.
- The same catalog can support either flow, but an assignment belongs to one explicit mode and has its own settings. Recognition never changes mode or creates a prescription. One active exercise at a time; a change ends the task and requires new setup.
- Record suitability context/date, pseudonymous supervisor label, side, seating/support, clinician-selected range/goal, repetitions/rest instructions where assigned, and criteria. A local checkbox is reported supervisor attestation, not verified clinician identity or AI medical clearance. No universal dose, posture target, or automatic progression.
- Manual logging of an activity is allowed when explicitly labeled; it is not a measured repetition or substitute for an unavailable analyzer.

## 2. Shared implementation contract

Each definition has `exerciseId`, version, supported modes, instructions, camera view, required landmarks, side policy, baseline/calibration schema, metric definitions/units/windows, state machine, quality/exclusion rules, supported criteria, and readiness evidence. An assignment snapshots that definition plus settings and analysis version. An attempt includes its mode/exercise/configuration ID, timestamps, measurable/excluded classification, metric values or null/reasons, tracking quality, flags, and evidence status.

All positions use intrinsic-frame pixels after normalized x/y conversion. Preview mirroring/cropping must be reversible for taps and overlays without swapping anatomical sides. Use monotonic capture timestamps, explicit elapsed-time dwell/hysteresis, finite/nondegenerate geometry, and fixed session calibration. Apply the reach guide's time-aware gap/coverage, smoothing reset, interruption, strict-criterion, replay, and idempotent-finalization guarantees to every module. Required landmarks are exercise-specific; never require a wrist for knee extension or invent missing points from the other side.

Common definitions:

```text
angle(A,B,C) = acos(clamp(dot(A-B,C-B)/(norm(A-B)*norm(C-B)), -1, 1)) * 180/pi
L = norm(C2-C1) > declared calibration minimum        # fixed image reference
up(P,t) = (P0.y-P(t).y)/L                             # upward positive
phaseDuration = (confirmedEventFirstTime - onsetFirstTime)/1000
```

For modules reporting torso change without a reach target, record the clinician-confirmed screen-forward direction at setup. Use `alpha = atan2(S.x-H.x, -(S.y-H.y)) * 180/pi` and `delta = forwardSign * wrapTo180(alpha-alpha0)`; `forwardSign` is fixed as +1 for screen-right forward, -1 for screen-left forward. The report metric is `max(0,max(delta))` over the outward interval, with signed samples retained. Reject setup if forward direction is ambiguous; do not silently borrow a target that does not exist.

These are projected engineering measurements, not validated clinical ROM, anatomical strength, or muscle activation. Straight projected limb approaches 180°. Angular change, peak angle, and available clinical range are different quantities. Use degrees, seconds, or reference lengths as specified; never centimeters without a separate validated scale. Reject degenerate vectors, invalid calibration, unobserved endpoints, and untrusted peak intervals with null reasons. No numerical engineering/clinical cutoff is established here.

Each exercise uses `REST → ACTIVE → ENDPOINT → RETURN → REST`; names and guards below specialize that pattern. Sustained departure opens one attempt. Sustained configured endpoint evidence is required; endpoint dwell never creates another attempt. Sustained return finalizes once; return-before-endpoint, timeout, stop/discomfort, setup change, or excessive/critical tracking loss emits one excluded record and requires reacquired rest. Endpoint event time is the first valid sample in its confirmed dwell. All required peaks use onset-to-first-endpoint inclusive; phase duration excludes endpoint hold. Long gaps cannot be interpolated into completion. Segmentation does not certify the intended muscle action or physical contact.

## 3. Six candidate exercise definitions

### SR01 — Seated forward reach (`seated_forward_reach`)

- **View / landmarks:** fixed side view of assigned arm; same-side shoulder, elbow, wrist, hip visible. Side is explicitly left/right.
- **Setup / assignment:** seated/support description, fixed target, assigned reach range and review criteria. Capture resting shoulder/elbow/wrist/hip baseline; select fixed reference `C1,C2` and target `T`. Reject overlapping rest/target regions or ambiguous forward direction.
- **Measurements:** peak elbow angle `angle(S,E,W)` (degrees); peak positive signed change of shoulder–hip inclination relative to baseline (degrees, 2D torso proxy); peak wrist projection onto `(T-W0)/norm(T-W0)` divided by `L` (reference lengths); onset-to-first-target-region duration (seconds). Exact formulas, sign conventions and phases remain in the reach guide.
- **States:** `REST → OUTWARD → TARGET → RETURN`; wrist departure, image target entry, and return-to-rest guards as specified in the reach guide. Entry is not proof of target contact.
- **Reject / ambiguity:** obscured arm/hip, critical peak gap, missing target/return, invalid calibration. Reach may resemble arm raise or elbow straightening; neither label is inferable from one still frame.
- **Fixtures:** all reach-guide fixtures, including 12/10/2/4 accounting, angle/aspect-ratio/mirror tests, held target, interruption and target-obscuring gaps.

### SR02 — Seated elbow bend and straighten (`seated_elbow_flexion_extension`)

- **View / landmarks:** side view; same-side shoulder, elbow, wrist and hip. Clinician selects one arm and its permitted support. Hip is required for the torso proxy, not as a substitute for elbow evidence.
- **Setup / assignment:** clinician defines resting position, bend endpoint, permitted upper-arm/support arrangement and return instruction. This module starts at a comparatively straight resting position, bends, then returns; a reverse-start exercise requires a separately specified variant. Capture stable baseline `S0,E0,W0,H0`; pixel angle needs no distance scale, but any displayed displacement requires fixed `L`.
- **Measurements:** minimum elbow angle in onset-to-endpoint window (degrees); projected bend excursion `thetaRest - min(theta)` (degrees); baseline-relative signed torso inclination change (degrees); bend and return duration (seconds, return from confirmed departure from endpoint to rest). Do not call excursion total available ROM.
- **States:** `REST → BENDING → BEND_ENDPOINT → STRAIGHTENING`; decreasing angle beyond onset hysteresis, entry into clinician-configured angular endpoint region, then sustained baseline-angle return. Endpoint/return bands and engineering dwell must be distinct.
- **Reject / ambiguity:** hidden wrist/elbow, changing support, unobservable endpoint/return, degenerate arm vectors. Shoulder movement can make reach/raise ambiguous; uncertain recognition stays unknown. Do not infer weakness from limited bend.
- **Fixtures:** known angle decrease/return, held bend once, opposite-side/mirror transforms, torso baseline, endpoint gap, premature return, and strict criterion equality.

### SR03 — Seated forward arm raise (`seated_forward_arm_raise`)

- **View / landmarks:** fixed side view; same-side shoulder, elbow, wrist, hip. Clinician selects permitted bend/support; no assumed requirement for a straight elbow.
- **Setup / assignment:** resting arm baseline, clinician-defined raised endpoint, support and range. Use fixed `L` for wrist displacement; upper-arm angle is relative to downward trunk segment rather than a gravity estimate.
- **Measurements:** projected upper-arm-to-trunk angle `angle(E,S,H)` (degrees; alongside torso approaches 0°); peak normalized wrist elevation `up(W,t)` (reference lengths); signed baseline-relative torso inclination change (degrees); raise and return duration (seconds). Angle and wrist elevation are separate metrics.
- **States:** `REST → RAISING → RAISE_ENDPOINT → LOWERING`; sustained increase in projected elevation from baseline, entry into configured endpoint band, return to baseline region. Select and snapshot the endpoint driver (angle or wrist elevation) before capture; do not switch driver mid-attempt.
- **Reject / ambiguity:** overlapping baseline/endpoint regions, hidden landmarks, major out-of-plane movement reported by supervisor, unreliable angle/peak, missing return. Forward reach shares wrist elevation; recognition may need unknown rather than a confident label.
- **Fixtures:** known shoulder-vertex geometry, bent versus straight elbow without falsely requiring straightness, torso movement, held endpoint, incomplete return, mirror/frame transforms and missing driver evidence.

### SR04 — Seated knee extension (`seated_knee_extension`)

- **View / landmarks:** side view with assigned same-side hip, knee and ankle visible; chair/support instructions must not obscure knee/ankle. No automatic bilateral comparison.
- **Setup / assignment:** clinician-selected leg, seated starting knee position, extension endpoint, foot/limb support and return instruction. Capture resting leg baseline; angular metric needs no scale.
- **Measurements:** peak projected knee angle `angle(H,K,A)` (degrees); projected extension excursion `max(theta)-thetaRest` (degrees); extension and return duration (seconds). No force, muscle strength, knee-valgus or fall-risk interpretation.
- **States:** `REST → EXTENDING → EXTENSION_ENDPOINT → RETURN`; angle increases from baseline, enters configured endpoint band, then returns to baseline band with dwell.
- **Reject / ambiguity:** ankle/chair occlusion, nearly overlapping projected segments, endpoint gap, missing return. A leg lift can mimic parts of extension; recognition needs a temporal window and may reject.
- **Fixtures:** known knee-angle extension/return, held extension once, lift without endpoint, ankle loss, fixed side and frame transforms, interruption and all-zero-measurable report.

### SR05 — Seated single-leg march/lift (`seated_single_leg_lift`)

- **View / landmarks:** side or slightly oblique view with assigned shoulder, hip, knee and ankle visible. Snapshot the approved view; require a fresh setup when changing it. Capture one assigned leg at a time; alternating-leg automatic analysis is deferred.
- **Setup / assignment:** stable seated/support arrangement, clinician-selected leg/lift endpoint and fixed image reference `L`; capture `S0,H0,K0,A0`. This is a knee-elevation task, not walking.
- **Measurements:** peak normalized knee elevation `up(K,t)` (reference lengths); baseline-relative signed torso inclination change (degrees); lift and return duration (seconds). Hip/knee angles may be diagnostic only until separately specified and tested; do not insert them into required report metrics.
- **States:** `REST → LIFTING → LIFT_ENDPOINT → LOWERING`; positive knee elevation above onset, configured elevation endpoint, return to resting knee region. Ankle visibility helps establish the observed leg, but cannot establish foot contact or balance safety.
- **Reject / ambiguity:** obscured hip/knee/ankle, moving camera/reference, endpoint not observed, support change or incomplete return. Torso motion is contextual, not automatically incorrect.
- **Fixtures:** known upward-positive displacement, unchanged reference, lift versus knee-extension ambiguity, held lift, below-endpoint attempt, mirrored view and occlusion/gap rejection.

### SR06 — Seated ankle pumps (`seated_ankle_pumps`)

- **View / landmarks:** close side view of assigned knee, ankle, heel, and foot-index landmark; camera must resolve the foot and shank. Chair/feet/footwear can obscure the very small movement. Whole-body views may be inadequate.
- **Setup / assignment:** clinician specifies supported lower-leg/foot arrangement, resting foot position, pump endpoint, and return instruction. Define one cycle as movement from the prescribed rest toward the specified endpoint and back; no alternating endpoint convention or heel-lift substitution. Record support/footwear and stable baseline.
- **Measurements:** oriented projected shank-to-foot angle, baseline-relative signed change and prescribed-direction excursion (degrees); outward and return duration (seconds). For `u=K-A`, `v=F-A` and foot-index `F`, use `beta=atan2(u.x*v.y-u.y*v.x, dot(u,v))*180/pi`, not the shared unsigned `acos` angle. Set `delta=wrapTo180(screenForwardSign*(beta-beta0))`, where screen-forward is fixed +1 for right, -1 for left in unmirrored analysis coordinates. Set `excursion=pumpDirectionSign*delta`; setup records `pumpDirectionSign` (+1/-1) so the clinician-specified outward direction is positive, verified against a labeled small setup motion. Reject ambiguous direction or a gap/step large enough to make angular unwrapping ambiguous. Report peak positive excursion in the outward interval and retain signed change for inspection. This is a foot-segment proxy, not a validated anatomical ankle joint angle. Heel is required for visibility/shape checks; do not label it measured clinical dorsiflexion.
- **States:** `REST → PUMP_OUT → PUMP_ENDPOINT → RETURN`; signed angle departure in the calibrated clinician-specified direction, endpoint band, return band. Sign/angle wrapping and nonoverlapping bands must be fixed and tested at setup.
- **Reject / feasibility gate:** foot hidden, short projected segments, footwear/occlusion, sub-resolution movement, unstable foot-index/heel tracking, or ambiguous motion. Do not replace an unreliable ankle angle with synthetic counts. Keep analyzer unavailable unless the early close-view physical iPhone trial resolves these risks. Manual logging remains clearly separate.
- **Fixtures:** known oriented shank/foot angles and signed excursion, crossing the ±180° representation boundary without folding/reversing motion, opposite-direction movement not satisfying the prescribed endpoint, and mirror/direction normalization; tiny-jitter versus real movement; hidden heel/foot-index; near-zero segments; held endpoint; gap and missing return. Real-device video must establish usable tracking, not just synthetic geometry.

## 4. Catalog readiness and release evidence

Every entry has separate `clinicalReviewStatus` and `technicalStatus` plus evidence references. Start clinical review pending and technical validation pending. Derived display labels may include **Needs clinical review**, **Needs technical validation**, and **Available**; both pending reasons must remain inspectable. Clinical review of the definition does not replace the patient's treating-team decision, and engineering approval never certifies clinical validity.

To enable any analyzer, require documented exercise-definition review, an implemented Quan P adapter, approved versioned engineering settings, exercise-specific synthetic/labeled fixtures, camera/calibration/rejection behavior, replay timing, and a physical iPhone Safari trial documenting model/iOS/browser/origin/date. State exactly what was observed. Ankle pumps need their close-view feasibility evidence first. If only reach passes, deliver a reaching pilot plus five visibly gated candidates; do not call the six-exercise implementation complete. No promise that all six can be validated in 24–48 hours.

To collect technical evidence before availability, provide a separate approved **developer validation** path using synthetic input or a consenting team member for whom the activity is suitable. It may run a pending analyzer, but is explicitly marked experimental, is not accessible through normal participant-start controls, and cannot change its catalog readiness automatically. Validation records/reports must be segregated and labeled; they never certify clinical approval. Do not use this path to bypass patient suitability or clinical review; participation by stroke patients requires the relevant treating-team decision and approved evaluation process. This prevents availability from being required before its own evidence can be collected.

Fixtures must test numeric geometry and independent event sequences rather than mirror code. For every exercise include measurable/excluded accounting, held endpoint, incomplete movement, long/critical gap, duplicates/out-of-order timestamps, nulls, no enabled criteria, multiple criteria, stop/discomfort and recording/storage failures. Record useful values only after phase/quality gates; exclusions never acquire criterion flags.

## 5. Recognition experiment and abstention

MediaPipe supplies landmarks, not exercise names. Recognition input is a timestamped window of observed movement features with units, coordinate convention, tracking coverage/gaps and feature version. Keep the selected exercise out of prediction input and labels; it configures analysis only after selection/confirmation. Camera-view metadata may be used transparently, but no answer-bearing task text. Recognition is not needed for a manual-selection session.

Allowed output labels: the six exercise IDs, `rest`, `transition`, `other_movement`, or `unknown`. Missing/poor tracking produces a separate `unable_to_measure` quality status and suppresses confident suggestions. Unknown is not a new exercise. Rest and transition do not create repetitions. Reach/raise/bend and knee-extension/lift can overlap; abstain whenever the window does not distinguish them. Never force a six-way probability choice on unrelated movement.

Compare a local explainable-rules baseline with the required experimental Jev integration. Demonstrate a real consented feature request through the protected server proxy on approved team/synthetic inputs; participant-facing recognition requires the evaluation below and applicable data-handling confirmation. Jev is not established as the best model and is not an LLM coaching requirement. Only minimal allowlisted derived movement features may be transmitted to Jev after explicit session-scoped opt-in; video stays local unless the user explicitly chooses the separate public Share video action in PRD FR-33; raw landmarks, notes, participant identifiers and measurement records stay local. No recording is ever sent to Jev. Manual/local operation must remain usable after necessary static assets load when consent is declined, revoked, or the provider fails. Do not embed secret API keys in Vite bundles. Follow [technology decisions §§3–5](technology-decisions.md) for disclosure, payload validation, access/rate/budget gates, late-response rejection and genuine-vs-mocked evidence.

Any suggestion needs user confirmation before changing active analysis; reject/dismiss preserves the selected task. A mismatch pauses or flags the segment for review and requires a new confirmed task/setup; no mid-repetition automatic switch and no retroactive valid metrics for rejected intervals. Clearly distinguish selected label, predicted label, confirmation and measurement validity.

Before use with participants, preregister engineering acceptance targets and compare on representative held-out participants not used for training/tuning. Report per-class precision/recall, confident wrong labels, rest/transition/other rejection, unknown and poor-quality handling, and latency; document dataset coverage and untested impairment/support/view conditions. Synthetic fixtures test code paths, not real recognition accuracy. Do not manufacture numeric performance targets as clinical validity.

If activity distribution is later displayed: `labeled duration / explicitly stated observed session duration`. Retain unknown, rest, transition, rejected and unobserved intervals so the denominator is auditable, with mutually exclusive intervals and no double-counting. Probabilities describe model uncertainty, not time distribution, muscle-use shares, health or risk scores.

## 6. Storage, summaries, and sources

Public-video MVP exception: after recording, an explicit Share video action may upload only the finalized compressed recording and return a public HTTPS URL that opens straight to the video without viewer accounts. Anyone with the link can view/forward it; this is not a private report portal or Jev input. Publication is a copy: original in-app/local playback stays available when the link is copied/opened, while the hosted URL plays independently even after the sender page closes. Local measurement/replay statuses stay independent of upload status. Sharing implementation and second-device playback evidence remain pending (H10).

Store mode/exercise/configuration and definition versions with every result; do not combine degrees/reference-lengths or different exercises into a single median. Per compatible task: `detected = measurable + excluded`, `flagged <= measurable`, and `flagged / measurable` only when the denominator is nonzero. Manual logs do not enter these counts. Compare only the same exercise with compatible settings/reference definitions; changes are context, not evidence of recovery. HTML reports include mode, attestation limits, task conditions, available metric units, null reasons and replay limitations.

Clinical context, checked October 24, 2026: [Stroke Clinical Care Standard](https://www.safetyandquality.gov.au/clinical-care-standards/stroke) supports individualized clinically appropriate rehabilitation; [UHB stroke booklet](https://www.uhb.nhs.uk/media/zhajlskn/stroke-exercise-booklet_stroke-team_pi.pdf) and [NHS sitting exercises](https://www.nhs.uk/live-well/exercise/sitting-exercises/) inform seated activity examples, not validation of these six algorithms. [AHA/ASA prevention guideline](https://www.ahajournals.org/doi/pdf/10.1161/STR.0000000000000475) includes physical activity in broader vascular-risk management; no app-specific prevention effect is established. [MediaPipe Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) describes landmarks; [TypeSafe primitives](https://docs.typesafe.ai/primitives) describes choices/probabilities and [Jev image announcement](https://typesafe.ai/blog/jev-1-14) experimental image support. These sources do not validate this app's geometry, prescriptions or recognition performance.
