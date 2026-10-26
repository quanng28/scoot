> Historical evidence from October 25, 2026. Old source identifiers describe the pre-publication development snapshot. See [current verification](verification.md) for the clean public SCOOT snapshot. Historical screenshots are intentionally omitted.

# Integrated HTML application verification

Date: October 25, 2026, America/New_York. Branch: `codex/integrate-seated-demo-gemini`. The final tested SHA is recorded in the PR and delivery; the integration commit containing this document is the reproducible source snapshot. This is engineering/developer validation, not patient readiness.

## Sources and deliberate reconciliation

Refreshed origin: main `cb7d64f`, workflows `2faed59`, Gemini `536d5fa`, preferred demo `e300b0c`. Ancestry inspection established workflow/demo descend from current main; Gemini diverged at `1632e04`. Isolated worktree `/private/tmp/scoot-integration` preserves original checkout `.gitignore`/`.omc` changes. Workflow branch fast-forwarded, Gemini merged deliberately, and the demo's two HTML/TypeScript files supplied the retained visual design before replacing prototype behavior.

Conflicts were reconciled in reports, IndexedDB and the active task checklist. The Gemini security commit is retained as a merge ancestor. No wholesale conflict-side replacement was used for combined storage/contracts.

- Workflow `session-report.ts` remains six-exercise source-linked facts/chart data. Provider `provider-report.ts` is a distinct strict contract. `buildProviderReportInput` revalidates/adapts actual source facts exhaustively; no non-reach elbow fallback remains.
- HTML controls use shared `CaptureController`, recorder/timing/calibration and a framework-independent typed outcome bridge extracted from the React consumer. Six canonical IDs route to their matching analyzers, result units and storage schema. The normal root build is HTML/TypeScript in `dist/app`; React remains only a regression/reference consumer.
- All chart values come from validated per-attempt source records; exclusions remain null gaps. Ankle oriented-angle plots use scatter without interpolation across the circular representation boundary; circular aggregation remains in the shared authority. Zero-measurable sessions show no invented medians or percentages.
- One `seated-cues.v2` catalog backs capture event v2, speech queue and server TTS. Scope, phase, current setup step and required-joint evidence invalidate stale audio. Captions/browser voice/mock tone have distinct labels. No microphone is requested.
- IndexedDB v2 retains six-exercise schemas, atomic save/rollback/collision protection, extras and atomic extras updates. Reopen checks report digest and semantics; corrupt/obsolete explanation is isolated from facts/video/context. Save acceptance races and navigation callbacks use stable session/draft binding and target guards.
- Protected endpoints retain exact-origin, code, trusted-client-address and rate/budget limits. Valid code validation precedes failed-guess lockout. Ignored-abort fetches and stalled response bodies have bounded waits. No provider body/secret is logged.
- Prompt v2/validator v3 constrain generated wording to supplied exact summary/fact/limitation selections. Novel paraphrases are rejected; this deliberately trades prose variety for enforceable provenance. Numerical displays always use source records directly.
- Production Vercel and Vite/legacy preview responses apply `Content-Security-Policy: connect-src 'self'`, including the worker script response. The bundled SDK periodically attempts telemetry; accelerated real-worker testing proves its off-origin request is blocked. Host static servers must preserve this response header; an HTML meta tag alone is insufficient.
- Public sharing is explicitly unavailable. No public URLs, cloud resources, deployment or paid model call were created.

## Final automated checks

Commands are rerun after the integration commit is created; final SHA/results are in PR evidence. Last complete source verification before commit:

| Check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 607 Vitest tests / 47 files passed; 13/13 catalog checks passed |
| `npm run build` | Passed: TypeScript compilation, same-origin pose assets, Vite HTML root `dist/app` (~405 kB JS / ~96 kB gzip; exact size can vary with final status text) |
| `APP_BROWSER_PORT=4192 npm run app:browser-check` | Passed: actual production HTML, six calibration/analyzer/recorder/result/storage paths; protected mock endpoints; phone screenshots; no page errors or off-origin requests |

Node v22.17.1 / npm 10.9.2. Coast discovery returned `coast: command not found`; repository has no Coastfile. Browser harness uses a temporary host static Vite preview without database/container services. Installed dependencies were copied from the existing workflow worktree with no upgrades. The default preview port was occupied during an early run; subsequent runs use explicit temporary ports. No force clicks or weakened assertions bypass the discovered UI obstruction.

### Browser coverage and limits

Real CPU worker/model/WASM startup with synthetic camera is tested separately from controlled-landmark analysis. The worker test accelerates only the SDK's 60-second telemetry interval, observes its actual flush, preserves genuine inference and verifies CSP on the worker response. Strict production worker-message validation is unchanged; test-only probe messages are isolated from its stream.

Each of reach, elbow, arm raise, knee extension, leg lift and ankle pumps completes its own calibration and one held-endpoint/outward/return cycle. Browser verifies matching exercise facts, actual recording decode, per-attempt seek/play/pause, local save/reload/reopen and isolated deletion. Unit/module fixtures additionally cover geometry, rectangular frames/anatomical side/mirror transforms, gaps and interruptions, delayed recorder start/countdown/single finalization, legacy/blocked/failed upgrades, quota/corruption isolation and semantic/data-boundary attacks.

Browser zero-tracking session produces zero measured attempts and no fabricated chart values; discomfort/Stop works, quota failure preserves facts, and Home ignores late finalization. Preview overlay/taps use intrinsic aspect ratio rather than cropped portrait geometry. Stop/discomfort remain visible in the phone viewport during recording. Phone design comparison retains original monochrome cards, seated illustrations and circular controls with honest labels and accessible setup/results.

Mocked provider browser scenarios pass through the real protected handlers in `mock` mode: three report requests (failure, validated acceptance/persistence, stale response after navigation) and one TTS request. They check runtime access code, catalog-only TTS input, original-wording local-context display, withholding of real-class fixture context, preservation of facts/video on failure, accepted-report reopen, stale-response isolation and honest mock-tone captions. These counts are mock transport evidence only.

## Independent review

Separate read-only reviewer evaluated numerical provenance, six-exercise mappings, Gemini official-documentation evidence, access/data boundaries, capture lifecycle, migration, actual entrypoint and visual fidelity. Independent targeted runs passed 170 math/contract tests and 113 report/speech/storage/endpoint tests, plus typecheck; these overlap the full suite and are not additive totals.

Actionable findings were fixed: unsupported nonnumeric generated claims; seating/support calibration reuse; stale capture/load navigation callbacks; accepted-report save races; outdated setup/tracking speech/captions; ankle direction proof reuse; preview/tap crop geometry; invisible overlapping selection button; and periodic SDK telemetry egress. Final independent approval is recorded against the final commit in the PR/delivery; authoring context does not self-approve.

## Per-exercise and release status

| Path | Automated integration | Physical/clinical evidence |
| --- | --- | --- |
| SR01 forward reach | Matching calibration/analyzer/results/replay/storage/report mapping passed | Physical timing/clinical acceptance pending |
| SR02 elbow | Matching calibration/analyzer/results/replay/storage/report mapping passed | Physical/clinical acceptance pending |
| SR03 arm raise | Matching calibration/analyzer/results/replay/storage/report mapping passed | Physical/clinical acceptance pending |
| SR04 knee extension | Matching calibration/analyzer/results/replay/storage/report mapping passed | Physical/clinical acceptance pending |
| SR05 leg lift | Matching calibration/analyzer/results/replay/storage/report mapping passed | Physical/clinical acceptance pending |
| SR06 ankle pumps | Matching direction-confirmed calibration/analyzer/results/replay/storage/report mapping passed | Close-view foot/heel feasibility and clinical acceptance pending |
| Gemini text/TTS | Protected mock transport, validation, persistence and failure paths passed | Genuine account/model/voice access and real smoke unverified |

Physical iPhone Safari camera/audio/storage/backgrounding/timing alignment, clinical review and patient suitability remain pending. No synthetic/desktop result closes them. Real provider smoke needs configured credentials, origin/access controls, actual spending cap and separate explicit live-call authorization; no automatic paid retries. Real clinical context remains local under unresolved standard-service/intended-use restrictions. Optional context editing remains separate from displaying/restoring existing entries. Public sharing and production deployment were not performed.

Official sources and current model/voice/format/data-use/retention findings: the historical official-documentation check. Configuration: the historical next-steps record. Old onboarding instructions remain only in the private archive.
