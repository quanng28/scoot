# Seated Reach: Measurement and Repetition Analysis Guide

Date: October 24, 2026

Status: Shared measurement guarantees and detailed SR01 reach module; expanded scope revision October 24, 2026; not clinically validated

Product scope: [Post-Stroke Seated Reach Review PRD](prd-post-stroke-seated-reach-review.md)

## 1. How an implementation agent must use this file

Read the PRD and exercise library first, then implement the shared guarantees and reach measurements/gates below. Keep supervised, silent capture with local video/session storage by default. The later public-video MVP in PRD FR-33 permits an explicit Share video action after recording: publish only the finalized compressed video as a direct HTTPS URL anyone can open without an account. This is separate from local measurement validity and Jev consent; no video goes to Jev. Only minimal derived movement features may leave the device for required experimental Jev recognition after explicit opt-in, through the protected proxy in [technology decisions](technology-decisions.md). This document translates the proposed “form checking” functions into an explainable seated-reach review pipeline. The accepted six-exercise catalog and separate rehabilitation/wellness flows are defined in the [exercise library](seated-exercise-library.md). This file supplies shared guarantees and the reach module only; its wrist/target formulas and reach states must not be copied unchanged into other exercise analyzers.

The output is **measurable / unable to measure**, followed, for measurable repetitions only, by **criterion exceeded / no configured criterion exceeded**. There is no `isFormCorrect` boolean. A therapist interprets the results with the replay and task context.

This is an engineering contract, not clinical guidance. Equations define projected geometry; they do not establish diagnostic validity. Do not infer pain, weakness, fatigue, tremor, instability, or recovery from these measurements.

### Scope and shared guarantees

The library owns exercise IDs, views/landmarks, mode-specific assignments, clinical/technical enablement status, exercise-specific metrics/states, recognition and release gates. Six visible entries do not establish six available analyzers. Keep unavailable analysis blocked; manual logs are not measured attempts. Recent-stroke participation requires treating-team suitability; local confirmation is an attestation, not verified clearance. No standing/walking, muscle or health percentages, or prevention/recovery efficacy claims.

Sections 3–6 describe SR01 only. Reuse the coordinate conventions, monotonic timing, finite geometry, time-aware gaps/coverage, filter resets, immutable calibration, null reasons, strict criteria, idempotent finalization and replay guarantees for the other modules, substituting their required landmarks, metrics and states from the library. Summaries and count invariants apply separately to each mode/exercise/compatible configuration; never pool unlike metrics. Recognition operates separately, cannot silently change the active analyzer and is not a prerequisite to manual selection. Jev integration is required for the experimental demo, but opt-in is optional for the user; no-consent/provider-failure sessions keep local manual operation. Raw landmarks, recordings, notes and participant identifiers must not be sent to Jev. Separately, the user-approved Share video action may publish the finalized recording through the direct public-video URL defined in FR-33; notes, identifiers and measurement records remain local. Required feature-payload, access and failure gates are in technology decisions §§3–5.

## 2. Disposition of the proposed functions

| Proposed function | Prototype decision | Reason / adaptation |
| --- | --- | --- |
| ROM / three-point joint angle | Required for reach: projected elbow angle; other joints only per library | Use affected shoulder, elbow, wrist. Peak projected angle is not a validated clinical ROM examination or full available range. |
| CoM / base of support | Excluded | An ankle boundary and weighted upper-body landmarks do not establish the support geometry of this seated task. Do not implement a fall-prevention alarm or balance-safety metric from them. |
| Temporal segmentation / FSM | Required | Use rest → outward reach → target phase → return, with explicit interruption handling. |
| Bilateral symmetry | Deferred | Both sides are not required to be visible in the prescribed side view; do not invent missing-side values or assume symmetry is the therapeutic goal. |
| Angular velocity / jerk | Deferred as reported metrics | Optional internal velocity may assist segmentation. Numerical derivatives need sampling and noise validation; spikes must not be interpreted as fatigue, tremor, or loss of control. |
| Torso alignment | Required, narrowed to torso inclination change | Use the visible affected-side shoulder–hip line, relative to its resting baseline and image vertical. This is not spinal alignment or a neutral-posture score. |
| Frontal knee valgus / varus | Excluded | Requires a different task and camera view; does not belong in the side-view reaching prototype. Do not carry the supplied causal knee-health claims into the app. |
| Linear displacement / trajectory | Required: normalized wrist displacement | Preserve image-plane movement and forward projection in fixed calibration-reference units. Do not label it physical distance or introduce standing-height analysis. |
| Eccentric-to-concentric ratio | Deferred | Outward/return phases do not establish which muscles act concentrically or eccentrically. A universal “3 seconds down / 1 second up” prescription is not a requirement. |

Excluded functions remain excluded under the expanded seated-only library. Deferred functions are not hidden requirements. Library knee/ankle projected angles do not authorize knee-valgus, balance, tremor, muscle or force assessments.

## 3. Coordinate and landmark contract

Use one affected side throughout a session. Map landmarks using the pinned model's documented indices; verify this mapping during integration:

| Side | Shoulder | Elbow | Wrist | Hip |
| --- | --- | --- | --- | --- |
| Left | 11 | 13 | 15 | 23 |
| Right | 12 | 14 | 16 | 24 |

These indices come from the [official MediaPipe Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker), checked October 24, 2026. The guide describes normalized image coordinates and model-estimated world coordinates. This prototype deliberately uses image-plane geometry; do not silently substitute world-coordinate distances.

Before geometry, convert normalized coordinates into a common pixel coordinate system: `P = (x * frameWidth, y * frameHeight)`. Pixel x increases rightward; pixel y increases downward. Use the intrinsic dimensions of the frame submitted to inference, not CSS display dimensions. Transform user-selected target/calibration points from displayed preview coordinates into that same space, accounting for cropping, rotation, and letterboxing.

Keep analysis coordinates unmirrored; any mirrored preview must transform overlays and user taps consistently. Never change anatomical left/right because the preview is mirrored. Store the frame dimensions, orientation, and display transform. Changes to analysis orientation, dimensions, or setup invalidate the calibration and require setup again.

Do not substitute the opposite-side shoulder or hip when the affected side becomes hidden. Do not require bilateral midpoints for this task. Confidence values are tracking inputs, not probabilities that an angle is clinically accurate.

## 4. Calibration and definitions

Before recording, capture a stable resting baseline with all four required landmarks valid:

- `S0, E0, W0, H0`: baseline landmark positions; use a robust aggregate over the valid readiness window.
- `T`: therapist-selected fixed target reference in the analysis frame.
- `C1, C2`: fixed calibration endpoints; `L = norm(C2 - C1)` in pixels.
- `d = (T - W0) / norm(T - W0)`: unit direction from the resting wrist toward the target.
- `forwardSign = sign(T.x - W0.x)`: maps screen-left or screen-right forward to a positive torso change.

Reject calibration if reference lengths are zero or below declared engineering minima, the rest/target regions overlap, or the horizontal rest-to-target component is too small to establish the prescribed side-view forward direction. Validate that onset, rest, and target tolerances allow distinct states. A valid mathematical calibration still requires therapist confirmation of task placement.

Do not update `L`, `W0`, `T`, or the torso baseline per frame. A moving normalization reference would change the meaning of measurements within a repetition. Recalibrate after a reported camera, seating, support, or target change.

### 4.1 Projected elbow angle

For `A = shoulder`, `B = elbow`, and `C = wrist`:

```text
u = A - B
v = C - B
cosine = dot(u, v) / (norm(u) * norm(v))
thetaDeg = acos(clamp(cosine, -1, 1)) * 180 / pi
```

This repairs the malformed dot-product equation in the proposal. Check finite coordinates, landmark quality, and non-negligible segment lengths before division. Return unavailable with a reason if they fail. Clamping handles floating-point rounding; it must not disguise invalid input.

A projected straight arm is approximately 180°, a right angle is 90°. Display “estimated 2D elbow angle.” Do not call the value an anatomical flexion angle without defining a separate convention. For this prototype, “peak elbow angle” is the maximum accepted angle in the outward measurement interval defined below. Do not silently change it to `max - min` or a clinical ROM score.

### 4.2 Torso inclination change

For shoulder `S` and same-side hip `H`:

```text
v = S - H
alphaDeg = atan2(v.x, -v.y) * 180 / pi
deltaDeg = forwardSign * wrapTo180(alphaDeg - alpha0Deg)
```

`alpha0Deg` is computed from the resting shoulder–hip baseline. `wrapTo180` returns the smallest signed angular difference. Reject a near-zero shoulder–hip vector. The reported peak forward change is `max(0, max(deltaDeg))` over accepted outward measurements; retain signed samples for replay inspection, including backward movement.

This formulation retains direction, unlike an unsigned angle to vertical. Image vertical is not a gravity sensor. A fixed tilted camera can affect interpretation; baseline subtraction does not establish anatomical spinal alignment or clinical correctness. Label the result “torso inclination change (2D proxy).”

### 4.3 Wrist displacement

```text
displacement = W(t) - W0
imagePlaneDisplacement = norm(displacement) / L
forwardDisplacement = dot(displacement, d) / L
```

Retain these as distinct metrics. The PRD's criterion uses peak `forwardDisplacement`, not total path length or peak vertical change. Report in “reference lengths.” Do not label model-estimated depth or image pixels as measured centimeters.

If a future trajectory display needs vertical displacement, use `(W0.y - W(t).y) / L` so upward is positive. It is not a required reach report metric. Knee and arm elevation belong to their separately defined seated library modules; squat and sit-to-stand remain excluded.

### 4.4 Time and aggregation window

Use monotonic frame-capture timestamps mapped to recording-relative milliseconds, not frame count divided by an assumed frame rate or asynchronous inference completion time. Ignore duplicate timestamps and reject out-of-order results rather than feeding them into the state machine.

The outward measurement interval runs from accepted movement onset to accepted first target entry, inclusive. Compute the three required peaks over this same interval. Do not include return-phase values in those peaks. Reach duration is `(targetEntryMs - onsetMs) / 1000`.

Debounce confirmation occurs later than the event it confirms: retain the first timestamp in the sustained onset/target sequence, then accept it only once its dwell requirement is satisfied. Target entry means wrist entry into the configured image-plane region, not verified physical contact. If target entry is not observed, reach duration is unavailable.

## 5. Frame quality before measurements

Process frames in this order:

1. Validate timestamp, frame geometry, selected person, and unchanged calibration.
2. Require finite, in-frame affected shoulder/elbow/wrist/hip coordinates and the declared per-landmark quality checks. Missing required confidence fields must have an explicit adapter policy; do not default missing fields to perfect confidence.
3. Reject degenerate segment geometry.
4. Apply versioned time-aware smoothing to accepted observations only.
5. Compute metrics, update state, accumulate attempt quality, and retain replay timestamps.

Keep raw accepted observations and the filtered analysis stream distinguishable. Do not interpolate across missing landmarks for reported measurements. Brief rejected gaps may be tolerated only within explicit limits; they contribute to missing-data duration and cannot satisfy onset, target, return, or readiness dwell. Reset the corresponding dwell candidate after a gap. Reset smoothing after a gap exceeding its declared reset limit; never smooth across attempts using a stale previous position after tracking loss.

An attempt is measurable only if it completes all movement phases, meets minimum valid-observation count and elapsed-time coverage requirements, stays within the maximum gap limit, and has valid evidence for onset, target entry, return, and required peaks. Define time coverage from timestamp intervals with a capped sample-support interval, not “valid frames / total frames”; otherwise dropped frames may disappear from the denominator. Specify that calculation in the analysis configuration.

Even high overall coverage is insufficient if a gap could conceal the target phase or invalidate a peak. Reject such attempts conservatively with a reason. Coverage does not prove that a sampled peak equals the person's true peak; all reported values remain estimates.

## 6. Repetition state machine

Use `REST`, `OUTWARD`, `TARGET`, `RETURN`, and `REACQUIRE_REST`. Completion/exclusion is an emitted record, not a persistent state that repeatedly increments counts.

| State | Event / guard | Action and next state |
| --- | --- | --- |
| REST | Sustained valid departure beyond onset threshold | Open one attempt, retain first departure timestamp, enter OUTWARD |
| OUTWARD | Sustained valid entry into target region | Set accepted first target-entry timestamp; enter TARGET |
| OUTWARD | Sustained return to rest before target | Finalize once as excluded: target not reached; enter REST |
| TARGET | Sustained departure in the return direction | Enter RETURN; do not create another attempt |
| RETURN | Sustained valid re-entry into resting region | Finalize once, apply quality gates, evaluate criteria only if measurable; enter REST |
| Active attempt | Timeout, stop, discomfort stop, calibration change, or excessive tracking loss | Finalize once as excluded with all applicable reasons; enter REACQUIRE_REST if capture continues |
| REST | Required tracking lost beyond tolerance | Enter REACQUIRE_REST without inventing an attempt |
| REACQUIRE_REST | Required landmarks valid and resting region occupied for readiness dwell | Reset dwell/filter history as configured; enter REST |

Define return-direction departure as a sustained decrease in projected forward wrist position from its accepted target-phase maximum, exceeding a configured hysteresis margin. Define the target region using Euclidean wrist-to-target distance normalized by `L`. Define the resting region similarly around `W0`. Onset must require departure outside the resting region plus positive forward displacement above the onset threshold. State-dependent hysteresis and elapsed-time dwell prevent jitter from creating attempts.

If a frame skips directly from TARGET into the rest region, allow return confirmation to use that first resting sample as its candidate while preserving the dwell requirement. The stop/discomfort event takes precedence over a same-timestamp completion. All finalization paths must be idempotent for a given attempt identifier.

Do not resume an interrupted attempt after a long gap. Require re-acquired rest first. Fully obscured movement may go undetected; expose “detected attempts,” and allow the therapist to note a missed attempt without adding invented metrics.

Run monotonic attempt-timeout and maximum-gap deadlines independently of valid inference arrivals. A watchdog must compare current recording-relative time against attempt onset and last valid observation even when no results arrive or every frame is rejected. Do not let an early return from the frame-quality gate suppress these deadlines. On expiry, finalize an open attempt once with the applicable timeout/tracking-loss reason, enter `REACQUIRE_REST` if capture continues, and reject late results for that attempt. If background suspension prevents timely execution, evaluate elapsed deadlines immediately on resumption before accepting a new frame; do not pretend capture was continuously observed. Apply this rule to every exercise module.

## 7. Criteria, result shape, and explanations

Suggested module boundaries: coordinate adapter → quality gate → smoothing/geometry → state machine → attempt validation → criterion evaluation → summary/replay. Keep these pure and independently testable where possible; browser capture and IndexedDB are separate adapters.

An attempt record must contain:

- Stable session/attempt identifiers and recording-relative start/end/target timestamps, with unavailable target time represented as null.
- `classification`: measurable or excluded; an array of reason codes plus readable explanations.
- Required metric values with units, or null with reasons; distinguish optional diagnostic samples from valid report metrics.
- Quality coverage, longest gap, observation count, and analysis/configuration version.
- All matching criterion flags, including metric, operator, threshold, observed value, and replay range.

For measurable attempts, evaluate enabled strict `<` or `>` criteria against full-precision values. Equality is not an exceedance. Round only for display, using enough precision in flag explanations to avoid apparently equal observed/threshold values. No enabled criteria means no flags. Excluded attempts have an empty criterion-flag list, even if some diagnostic samples exist.

Example reason codes: `LOW_LANDMARK_QUALITY`, `OUT_OF_FRAME`, `TRACKING_GAP`, `DEGENERATE_GEOMETRY`, `INVALID_CALIBRATION`, `TARGET_NOT_REACHED`, `RETURN_NOT_OBSERVED`, `TIMEOUT`, `STOPPED_EARLY`, `DISCOMFORT_STOP`. Missing replay is a separate evidence status; it must not be hidden by otherwise valid geometry.

Use: “Torso inclination change 11.2° exceeded the configured > 8° review criterion. Review replay.” Those numbers are illustrative fixture values, not recommended clinical settings. Avoid “bad posture,” “unsafe,” “weak arm,” “fatigue detected,” or “normal movement.”

## 8. Engineering parameters and deferred derivatives

Keep an immutable, versioned analysis configuration separate from therapist review criteria. Required engineering fields include readiness duration, per-landmark quality limits, segment-length minima, calibration minima, region radii, onset and return hysteresis thresholds, dwell durations, timeouts, smoothing parameters, minimum observations, coverage rule/threshold, maximum sample-support interval, maximum missing gap, and filter reset gap.

Values are not established by this document. Start with explicitly labeled experimental settings, document units and rationale, and select them through the early supported-device spike and labeled fixtures. Record the actual settings in every session. Never describe an SDK confidence default or engineering cutoff as a validated clinical threshold.

If angular velocity is later used internally, compute `omega = delta(theta) / delta(t)` using actual elapsed seconds and valid filtered samples. Do not differentiate across tracking gaps. Angular acceleration is the second derivative; angular jerk is the third derivative, with units deg/s³. Positional jerk has distance/s³ units. The proposal's acceleration-spike and jerk descriptions must not be treated as interchangeable or diagnostic.

A future outward/return duration ratio must use explicitly defined event boundaries, exclude target dwell, reject zero/missing denominators, and remain descriptive unless the therapist configures a supported task-specific criterion. Do not enable it in this prototype or label it an eccentric/concentric ratio.

## 9. Required verification fixtures

These tests establish implementation behavior, not clinical validity. Fixtures must supply explicit engineering settings and quality/timestamp data.

| Fixture | Expected behavior |
| --- | --- |
| Three points forming 90° and 180° | Correct projected angle within declared numerical tolerance |
| Identical elbow and shoulder | Unavailable angle with degenerate-geometry reason; never NaN in report |
| Same geometry encoded in portrait and landscape frames | Correct result after pixel conversion; no aspect-ratio distortion |
| Mirrored preview / reverse forward direction | Identical anatomical-side selection and positive-forward semantics after transform |
| Upright torso baseline, known forward/backward changes | Correct sign, wrap handling, and forward peak without an unsigned backward peak |
| Fixed reference 100 pixels; forward displacement 50 pixels | 0.5 reference lengths; lateral displacement distinguished from forward projection |
| Known onset/target dwell sequences | Duration uses accepted first timestamps, not delayed confirmation times |
| Held target and jittering rest | One attempt, no duplicate counts |
| Target-to-rest frame jump | Return can complete after valid resting dwell; no stuck TARGET state |
| Return before target, timeout, stop, discomfort | Exactly one excluded attempt per opened identifier with appropriate reason(s) |
| Brief / excessive / target-obscuring gaps | Dwell resets; explicit coverage accounting; invalid evidence excluded; no fabricated target entry |
| Return after long tracking loss | No resumed old attempt; rest must be reacquired before a new one |
| No more inference results / only rejected frames after onset | Independent deadline emits exactly one exclusion; late frames cannot complete the old attempt; rest reacquisition required |
| Duplicate/out-of-order timestamps, irregular sampling | No negative durations, duplicate transitions, or frame-rate-based timing |
| Metric exactly at threshold, multiple criteria exceeded, all disabled | No equality flag; all exceeded reasons retained; zero flags when disabled |
| Zero measurable attempts / null metrics | No invented medians or percentages; null never converted to zero |
| Twelve labeled attempts, two excluded, four flagged among ten measurable | Counts 12/10/2/4 with consistent denominators and linked replay ranges |

Also verify the real capture-to-replay timestamp mapping on the supported browser. Synthetic geometry cannot establish whether recorded video and displayed flag times align on a physical device.

## 10. Source and claim boundaries

The official pose documentation above supports the landmark mapping and coordinate-output descriptions only. The equations and state rules here are explicit engineering definitions for this product, not published clinical validation. Derivative, quality, camera, and task exclusions are conservative implementation choices requiring testing.

The supplied claims about fall prevention, specific muscle weakness, fatigue/tremor detection, knee loading, and universal exercise tempo have not been established for this app and must not appear as capabilities or clinical explanations. Existing research references in the PRD remain subject to its evidence-verification requirement.
