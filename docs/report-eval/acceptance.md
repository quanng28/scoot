# Preregistered synthetic report evaluation acceptance

Set before building or running the harness, October 27, 2026. Do not retune these criteria using the results of this fixture set. Changes require a new version and a fresh held-out fixture set.

Unit: one fixture, repetition and pipeline. Use the same ordered synthetic fixtures and pinned model/configuration in each arm. Default three repetitions; all six measured exercises and quick reports must be represented. Direct permits one call; LangChain permits at most two, with repair only after output validation rejection. Preflight-rejected inputs remain in the denominator and make zero calls.

- First-pass validity: existing schema AND semantic validator accepts the initial model output / all requested units. Preflight/provider failures are failures. Deterministic fallbacks never count as accepted provider output.
- Final provider validity: accepted first pass or accepted after one repair / all requested units.
- Recovery: initially invalid outputs accepted on the sole repair / initially invalid outputs. Report numerator and denominator; zero denominator is not applicable.
- Fallback rate: units retaining deterministic local output / all requested units, with validation, provider, preflight, timeout and cancellation classes separated. Cancellation is never acceptance.
- Latency: wall-clock milliseconds for the whole unit and each step; report nearest-rank p50/p95, separately for one-call and repaired units. The same server timeout covers the whole chain. Compare whole-arm p95 on paired runs.
- Tokens: provider-returned input/output/total usage per call and aggregate, grouped by repair status. Missing usage is unknown, never zero or an estimate. Fake models do not establish token cost or live latency.
- Calls: actual dispatched provider calls; hard maximum two per LangChain unit, one per direct unit; no provider-error retries. Every dispatched repair must consume both hourly and lifetime budgets.

Keep LangChain only if a later LIVE synthetic paired run improves final provider-valid rate by at least 5 absolute percentage points versus direct, recovers at least 20% of first-pass validation rejections, and adds at most 3000ms to whole-arm p95 latency while remaining within the existing 20000ms server budget. Require at least 20 first-pass validation rejections before concluding repair efficacy; otherwise evidence is inconclusive. Any accepted adversarial invalid output, privacy regression, unbounded calls, changed default behavior or broken storage compatibility is a release blocker regardless of rates. Dependency/maintenance cost can also justify removal.

Fake runs test mechanics only. Live results, provider token usage/cost, live latency, clinician usefulness and clinical validation: not yet run. No real patient data. A validator pass is not clinical correctness: report omissions, weak quick-branch semantic checks and potentially misleading accepted wording must be listed in the evaluation report and reviewed by a human.
