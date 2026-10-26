> Historical engineering experiment, October 24–25, 2026. Automatic recognition is retired from the active SCOOT flow; manual selection is authoritative. These settings are retained for design provenance, not current release approval.

# Upper-body engineering policy

Status: the user approved `upper-body-engineering-v1` on October 24, 2026 for engineering tests only. This adopts the existing Quan P demo settings as a reproducible baseline; it is not clinical validation or a claim that Quan P has accepted every integration detail. Physical-device validation and six-exercise readiness remain pending.

## Fixed recognition input

Use the same profile regardless of the selected or expected exercise. Keep task labels, raw landmarks, calibration, extraction settings and identifiers out of provider state. The provider receives only the existing strict `movement-features.draft-v1` window. Preserve draft and synthetic-input provenance.

| Setting | Engineering value |
| --- | --- |
| Window | Exactly 2,000 ms; wait for a complete window |
| Required features | Elbow angle, upper-arm/trunk angle, wrist forward displacement, wrist elevation, torso inclination change |
| Landmark confidence | At least 0.5; missing/null confidence rejects that landmark |
| Minimum projected segment | 2 intrinsic-frame pixels |
| Observation support | At most 150 ms, capped at the next observation, including an invalid observation |
| Required coverage | At least 0.8 of elapsed window time |
| Maximum unsupported gap | At most 300 ms, including leading/trailing missing time |
| Minimum valid observations | At least two, in addition to coverage/gap requirements |

Do not smooth, interpolate, replace missing observations with zero, or alter these values according to the expected exercise. Lower-limb calibration and features remain unavailable in this upper-body fixture. Keeping ten possible response labels does not establish this profile's ability to recognize leg/ankle exercises.

## Calibration and capture responsibilities

The engineering rest baseline follows Quan P's pure calibration implementation:

- At least six observations spanning at least 1,000 ms, with strictly increasing times and gaps no greater than 250 ms.
- Shoulder, elbow, wrist and hip must be visible, finite and within the intrinsic frame, with confidence at least 0.5.
- Each landmark's maximum Euclidean distance from its median position is at most 20 pixels. This is not a 20-pixel pairwise-span limit.
- The fixed reference and shoulder-to-hip baseline must each be at least 20 pixels long.
- Use intrinsic pixels, a fixed anatomical side and the original unmirrored coordinates. The current engineering forward direction is horizontal and explicitly signed. Knee and ankle rest baselines remain null.

These pixel thresholds depend on resolution and have not been validated as clinical or device-independent limits. The capture owner must reset calibration and discard buffered windows when camera/setup, frame geometry, orientation or measurement side changes, or when tracking must restart. A pure extraction function cannot independently establish that the camera stayed fixed. Preview mirroring must not modify measurement coordinates or anatomical side. Recording/replay alignment remains a separate pending responsibility.

## Synthetic smoke evidence

Build the smoke window through the extractor using 21 synthetic observations at 100 ms intervals over 2,000 ms, with a stable synthetic rest baseline. Compute coverage and gap from those observations; do not handwrite quality values. The older three-sample JSON fixture remains a generic adapter test and is not evidence of compliance with this profile.

Before a genuine request, run the same extracted input through a permanent mock transport and test quality rejection, calibration boundaries, payload exclusion and the one-attempt gate. The user approved exactly one genuine request using `jev-1.14.0`, then explicitly deferred execution until creating the key later. No genuine request has run; no automatic execution is scheduled. Approval does not authorize retries: a timeout or provider rejection after sending consumes that attempt. No patient input, camera frames or raw landmarks are authorized for transmission.

## Note for Quan P

Please align the capture-to-extractor path with `upper-body-engineering-v1`: five fixed upper-body features, a complete two-second window, confidence ≥0.5, coverage ≥80%, and maximum unsupported gap 300 ms. Keep calibration fixed and clear it plus buffered windows on setup/side/orientation changes. Confirm the rest-calibration rules above and collect physical-device evidence; leg/ankle readiness stays blocked. This gives local rules and Jev the same independently measured input and prevents unreliable tracking or the selected exercise from biasing recognition.

## October 25 offline application integration

The React practice path now reuses `UpperBodyWindow` with a separately captured recognition rest baseline and explicit horizontal forward direction chosen independently of the reach target. Its relative timestamps follow the camera-run clock; recognition does not establish recording/replay synchronization. Reference, target, baseline, direction, setup/geometry and capture lifecycle changes invalidate the recognition buffer and pending suggestions. Tracking-quality loss invalidates a previously measurable window; a fresh baseline is then required. No request is automatic, and revocation clears recognition state.

The protected offline endpoint checks two-second duration, null lower-limb features and recomputed feature support/coverage/gap before reserving limits. This can reject dishonest encoding but cannot verify physical tracking from derived values alone. Generic draft schema abuse bounds now limit relative times to 24 hours and normalized displacement to ±1,000 reference lengths; they are encoding guards, not clinical ranges or revised extraction thresholds. The corresponding offline integration record remains in the private development archive. The approved genuine single synthetic test and physical-device testing remain deferred.
