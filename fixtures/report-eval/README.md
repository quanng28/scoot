# Fictional report evaluation fixtures

All 26 cases are synthetic, allowlisted DTOs with `fictional: true`. No video, URLs, landmarks, session labels, real symptoms or clinical notes are included. Measured provenance is explicitly `labeled_synthetic_fixture`. They are frozen inputs, not model outputs or measured performance results.

Reach inputs reuse `syntheticReachSession`; the four other implemented workflow examples reuse `fourWorkflowRecords` (generated from synthetic geometry); elbow uses its existing fixed metric definitions with declared fictional DTO values. Quick examples reuse the existing `buildVideoReportInput`. No analyzer code is changed.

Coverage: six measured exercises and six quick variants; empty, excluded-only/null metrics, all 18 current exclusion reason codes (including the four exercise-specific families), no criteria, 30 attempts, quoted fictional context and an instruction-like context that must be blocked before calls; insufficient angle data, unknown coverage, low coverage, 30 repetitions/30 events with 1000 warnings, unassigned events, interrupted/discomfort capture and unavailable speed. These are engineering inputs, not clinical examples or recommended settings.

The default fake model schedule rotates deterministically by fixture index and repetition: valid, invalid then valid, invalid twice, schema-valid but incomplete/status-inconsistent output, rate limit, refusal. Both arms receive the same first response. This deliberately tests failure handling and the accepted-but-may-be-wrong section; its rates must never be presented as provider performance. Selecting one fixture resets its schedule index. Fake models do not fabricate token usage.

Run `npm run eval:report`; outputs go only to ignored `eval-results/`. The harness uses the actual protected endpoint for each arm, with isolated synthetic access credentials and a shared call budget. Default three repetitions have an unconstrained maximum of 234 calls; the hard cap remains 200, and rows after exhaustion retain a typed budget failure. The observed default fake run dispatched 177 simulated calls; live calls and results are not yet run.
