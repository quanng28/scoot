# LangChain report pipeline handoff

October 27, 2026. Work is local on `codex/langchain-report-pipeline`, based on `origin/main` at `88f3f54`. Nothing was pushed, merged, rebased, deployed or published. No Gemini or LangSmith request was made. The initial working tree was clean; only task changes are committed.

The new server-only flag defaults to **direct**. `SCOOT_LLM_PIPELINE=langchain` enables generate → existing validation → at most one targeted repair → existing validation → deterministic fallback for both report branches. Local capture, measurement, video, replay, Save, Stop, tracking rejection and speech do not wait for it. Provider failure keeps the existing error envelope so the browser retains its already-visible local report. Invalid generated content is never returned as a successful repaired report.

## First three things in the morning

1. Add `GEMINI_API_KEY` securely to the server/evaluation environment. Do not use a browser-prefixed variable, commit it, paste it into chat or include it in a command saved to history. Review the existing provider/data gate before any real context use.
2. With Node 22.13+ within Node 22 and npm 10, run `npm ci`, `npm run check`, then `npm run eval:report`. This is offline by default. Review the accepted-output caveats, especially the existing quick-validator status gap.
3. Run a small **synthetic** live evaluation only after deciding to do so: `npm run eval:report -- --live --yes --fixture measured-forward_reach --runs 1 --max-calls 3`. The script prints the unconstrained maximum/settings before checking approval/key guards. No live result is claimed here. Keep the application flag at direct until live acceptance and the separate validator review are complete.

## Exact commands

```sh
node --version                         # supported: >=22.13.0 <23
npm --version                          # supported: >=10 <11
npm ci
npm run typecheck
npm run lint
npm test                               # full Vitest plus the 13 catalog checks
npm run build
# Or all four checks:
npm run check
git diff --check
npm run eval:report                    # 26 fixtures x 3 repetitions x 2 actual endpoint arms
npm run eval:report -- --runs 1 --max-calls 12
npm run eval:report -- --live --yes --fixture measured-forward_reach --runs 1 --max-calls 3
# If settings are stored in ignored .env.local rather than inherited process env:
node --env-file=.env.local dist/scripts/eval-report.js --live --yes --fixture measured-forward_reach --runs 1 --max-calls 3
```

The npm evaluation command compiles TypeScript first. It does not automatically load .env.local. Inherited SDK verbose logging is disabled inside the evaluation process so fixture prompts/outputs cannot be printed by debug callbacks; an end-to-end CLI regression covers this. `--yes` alone, an API key alone, or inherited provider/tracing flags do not select live mode. `--live` needs both a key and `--yes`; `--trace` separately needs `LANGSMITH_API_KEY` and `--yes`. Numeric arguments are bounded and invalid arguments fail closed. Neither mode retries provider failures. The global hard cap covers both arms, including repairs; exhausted units receive budget failures rather than disappearing from the denominator.

Artifacts are timestamped JSON and Markdown in ignored `eval-results/`. They retain outcomes and allowlisted metadata, never prompts, model text, context or credentials. The CLI default fake run produced **156 outcomes and 177 simulated calls** under the 200-call cap. The unconstrained bound was 234 calls. These are harness observations, not provider quality, latency or cost evidence. Live results, live token counts/cost and clinical usefulness: **not yet run**.

## Environment variable names

New: `SCOOT_LLM_PIPELINE` (unset/empty/unrecognized → direct; explicit langchain opts in).

Existing server configuration remains `GEMINI_PROVIDER_MODE`, `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_ACCESS_CODE_SHA256`, `GEMINI_ALLOWED_ORIGINS`, `GEMINI_REPORT_MAX_PER_HOUR`, `GEMINI_MAX_REQUESTS_PER_INSTANCE`. TTS settings are unchanged.

Evaluation-only optional tracing names: `LANGSMITH_API_KEY`, `LANGSMITH_TRACING`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID`, `LANGSMITH_HIDE_INPUTS`, `LANGSMITH_HIDE_OUTPUTS`. New .env.example entries are empty placeholders. Never enable tracing for server requests: the server creates a disabled asynchronous tracing context even when inherited LangSmith/legacy flags are true. The evaluation executable exports metadata-only traces only with explicit `--trace --yes`; it hides all inputs and outputs. Spans are exported retrospectively: their service-side duration is export time, while attached durationMs and the evaluation wallDurationMs tables contain measured execution latency.

## Decisions and compatibility

- Installed exact dependencies: `@langchain/core` **1.3.0**, `langsmith` **0.11.1**. Zod stays **4.6.7**. Core supports this Node/Zod combination. No Google SDK, agent loop, LangGraph, tools, memory or retrieval was added. The [environment record](report-eval/environment.md) lists official sources read before coding and dependency compatibility.
- LangChain runnables wrap the existing pinned REST transport and generation configuration. This avoids SDK default retries or a provider/schema migration. Named runnable inputs/outputs contain only attempt/step metadata; facts and model text stay in closures. The module is loaded only when the flag selects LangChain.
- Validators are untouched. New diagnostic adapters call them and map failures to fixed codes/templates; quick numeric/format/risk/event errors receive targeted guidance. Repair includes only the original prompt, bounded JSON-quoted previous output, fixed guidance and unchanged constraints. The previous output is limited to 8000 characters. New instructions are separately versioned `report-repair.v1`; existing prompt and validator versions are not bumped.
- Both model calls share the original 20000ms chain budget, including validation; elapsed-time checks also catch synchronous validation overruns. Cancellation/deadline checks run before acceptance and before repair dispatch. Each repair reserves another hourly/lifetime slot. Provider failures/refusal/rate errors/truncation do not repair. Malformed JSON inside an otherwise successful model response is a validation rejection and can repair once.
- Optional pipeline provenance is additive to the existing strict success schema. No database version bump is necessary. Legacy IndexedDB v1 migration, old accepted-report provenance, extended provenance and tampered-report rejection are tested. Input digest/session binding and controller states remain unchanged. Failed chains return the existing typed error and leave the immediate local template visible.
- Runtime events are strict allowlisted metadata, with per-step outcomes/durations, validation codes, attempts, final class and usage when returned. Provider usage on failed calls is retained; missing usage stays unknown. The direct path is instrumented without changing its requests, validation, response bodies or retry behavior. Preflight-rejected eval units are recorded without dispatching a provider call.
- Evaluation invokes the actual protected endpoint twice per unit, using the flag for each arm. The deterministic fake chat model schedule feeds the same first response to both arms. The harness measures outer endpoint/body-read wall time separately from runtime step durations. Fake outcomes cannot satisfy the preregistered live criteria.

## Historical-document disagreements

The five historical documents are in `tasks/`, not `docs/`. Source already uses measured `report-validator.v3` and `report-prompt.v2`, despite the task/historical F3 reference to v2 validation. Quick prompt/validator and input are v2. Source limits recordings to 30 seconds rather than the historical 60, implements all six measured DTOs, and auto-requests quick summaries when configured. Historical recognition/public sharing proposals are not active runtime features. These areas were not changed. A short dated technology-decision addendum points to the current [architecture decision and reversal test](scoot-architecture.md#decision-record-bounded-report-repair-with-langchain-october-27-2026).

## Verification and review

Before the first change: **672 Vitest tests in 51 files, 13 catalog checks**, typecheck/lint/build passed on the host's initial Node 24.19.0/npm 11.9.0. Every subsequent phase uses downloaded Node **22.13.1**/npm **10.9.2**, within project engine bounds. Dependencies and verification tooling were installed under /tmp/project node_modules, without changing project engine requirements.

**After the final implementation: 745 Vitest tests in 57 files and 13 catalog checks pass**, along with strict typecheck, lint, production build and git diff --check. The full suite passed again on its own; no existing assertion or timeout was weakened.

Fake-model tests cover both branches: first-pass acceptance; repair success; two failures; malformed JSON/schema/number/injection rejection; refusal/rate/provider/truncation failures; timeout/cancellation before/during/after validation; elapsed deadline; no repair on validator exceptions; budget exhaustion; unchanged default/direct behavior; offline mock mode; stale/late controller behavior; old/new storage provenance; metrics/tracing hygiene; and strict call-count bounds. Existing measured adversarial families and the rich quick fixture (with events) are shared with the original validator tests and run through both attempts. Original assertions are preserved.

An independent review agent audited the full diff and passed 79 focused offline tests across five files. Findings fixed: evaluation wall timing, post-validation cancellation/deadline, validator exceptions incorrectly triggering repair, token usage lost on failure/late abort, duplicate fallback generation, lazy dependency loading, targeted quick diagnostics and richer adversarial coverage. No validator weakening or forbidden capture/TTS changes were found. Full self-review also checks contracts/storage, tracing/secrets, cancellation, budgets, default flag, direct behavior and exact pins. One full run hit two 5000ms timeouts in unchanged UI workflow tests while independent verification ran concurrently; verification was rerun alone without loosening timeouts or assertions.

## Remaining evidence and risks

Live Gemini model/account availability, supported response schema, one-repair efficacy, real latency/usage/cost, actual LangSmith export and clinician review are **not yet run**. No provider key or provider/tracing call was needed to verify mechanics. Fake timing is machine-local, not a latency prediction. Synthetic data cannot establish clinical validity.

The existing quick validator checks numeric vocabulary, banned claims/formatting, hedging and event coverage, but can accept a headline that contradicts the input status or misattributes numbers. Measured validation enforces copy-only text but does not require complete observation coverage. The harness deliberately demonstrates and lists these accepted-output caveats; status contradictions are marked release blockers. This task does not alter validator acceptance. A separate tightening review is needed before promotion, and no claim of improved report correctness is made.

The default 200-call cap can truncate a live run whose theoretical bound is 234 calls; the summary records budget failures, so incomplete runs cannot establish repair efficacy. Use a small fixture selection for the initial smoke, then plan a sufficient paired run within an explicitly chosen cap. Per-instance server quotas remain a backstop, not a global provider spend guarantee. Dependency/maintenance cost remains part of the reversal test.
