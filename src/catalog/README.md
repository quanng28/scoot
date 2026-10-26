# Seated exercise catalog

This batch translates the approved October 24, 2026 library into inspectable JSON. It contains six candidate definitions and two mode policies. Every analyzer starts with clinical review and technical validation `pending`, availability `blocked`, and empty `validationEvidence`.

## Run and inspect

Use **Node.js 22 or newer**; no package installation or build step is required. From the repository/worktree root:

```sh
node --version
node --test src/catalog/*.test.mjs
node -e 'console.log(JSON.stringify(require("./src/catalog/exercises.json"), null, 2))'
node -e 'console.log(JSON.stringify(require("./src/catalog/modes.json"), null, 2))'
```

The tests use only Node's built-in test runner, strict assertions and filesystem reader. They check catalog consistency, not tracking accuracy, clinical validity or safety. The actual run and six-row inspection summary are in [the verification record](../../docs/exercise-catalog-verification.md).

## Data structure

`exercises.json` has a `schemaVersion`, source-document references, catalog conventions and an `exercises` array. Each entry contains:

- `id`, `definitionVersion`, display name, description and supported mode IDs.
- Seated posture, permitted camera views, required same-side anatomical landmark roles, explicit left/right selection, support and fixed calibration requirements.
- Metric IDs, labels, units, textual definitions, measurement windows, limitations and source references. Definitions describe existing library measurements; this batch implements no geometry.
- Exercise-specific state labels, exclusion reasons and limitations. These are data, not an analyzer or state-machine implementation.
- Separate `clinicalReviewStatus` and `technicalStatus`, `availability` with required evidence kinds and blockers, and `validationEvidence`.

Exercise machine IDs are unchanged from the library. Metric IDs use the user-approved **catalog-local snake_case namespace**. `definitionVersion: "1.0.0"` identifies this initial translation; it is not a clinical approval or an analysis implementation version. Consumers must use the exercise ID and definition version together with the metric ID. Mapping to shared contracts remains pending integration; no competing TypeScript contract is supplied.

Landmarks describe anatomical roles on the selected side, without SDK indices. `reference_lengths` means displacement divided by a fixed image reference, not centimeters. `degrees` describes projected angles/proxies; `seconds` describes observed phase duration. Missing or unreliable measurement evidence must eventually produce null values with reasons, not fabricated values.

No universal repetition count, range target, rest duration, numerical engineering threshold or progression is supplied. `numericDefaults: null` leaves those decisions unresolved. Clinician-assigned settings and versioned engineering settings have separate responsibilities.

## Readiness and evidence

Source-document references establish provenance only. A future readiness change requires exercise- and definition-version-matched completed evidence for definition review, the Quan P adapter, approved versioned engineering settings, exercise-specific fixtures, camera/calibration/rejection behavior, replay timing and a physical iPhone Safari trial. Ankle pumps additionally require close-view feasibility evidence.

The test-local evidence shape includes an ID, kind, exercise ID, definition version, result, reference and observed scope. Engineering settings evidence includes its settings version. Physical-device records include model, iOS version, Safari/browser version, origin and date. These records describe what must be documented; the checks cannot verify the truth or quality of the referenced evidence.

The consistency checks require `approved` clinical review to have definition-review evidence and `validated` technical status to have every technical evidence kind. Availability requires both statuses and all evidence, with no remaining blockers. A display-name edit cannot enable an analyzer. Synthetic completed-evidence fixtures are created only in test memory and are never shipped as completed catalog evidence.

`catalog.test.mjs` contains **test-local checks**, not runtime enforcement. Integrators must enforce blocked participant capture and metrics in their own approved application boundaries. The separately approved experimental developer-validation path described by the library must remain outside normal participant start controls and must not promote readiness automatically.

## Mode policies

`modes.json` defines explicit, supervised `rehabilitation` and `wellness` modes with separate assigned goals/settings. Both require a clinician-suitability attestation with date, context and a pseudonymous supervisor label. A checkbox records reported attestation; it verifies neither clinician identity nor medical clearance. Recent-stroke suitability belongs to the treating team.

Policies prohibit automatic prescriptions, progression, mode switching and efficacy claims. Manual activity logs require explicit labeling and stay outside measured-repetition counts and denominators. Recognition cannot change mode or silently reuse a prescription across modes.

## Integration boundary

Future work must map this catalog into the agreed contracts, implement mode and participant-start enforcement, connect real exercise-specific adapters, validate calibration/quality/replay behavior and collect clinical/device evidence. This batch supplies no UI, recording, storage, recognition or server implementation and makes no physical iPhone test claim.
