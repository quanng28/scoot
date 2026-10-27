# Report pipeline implementation notes

Baseline: origin/main `88f3f54`, clean working tree; branch `codex/langchain-report-pipeline`.
No provider or LangSmith requests are authorized during implementation.

Read current README, architecture, five historical task documents and both report paths before the LangChain docs. Historical documents live in tasks/, not docs/. Source takes precedence: recording is 30 seconds, all six measured exercise DTOs exist, quick recording requests optional explanations automatically when configured. Historical sharing/recognition proposals are not active features.

Measured: strict session-report-input.v1 -> existing prompt/JSON schema -> generatedReportSchema and report-validator.v2 -> deterministic templateReport on client failure. Session input digest plus controller session binding; server 20s provider timeout, client 30s, cancellation and late-result rejection; controller idle/loading/accepted/failed/cancelled. Stored accepted-report.v1 is revalidated on reopen; IndexedDB v2 migration already covered.

Quick: strict video-report-input.v2 pace DTO -> existing prompt/clinician schema -> validateVideoReport v2 -> immediate videoTemplateReport remains on failure. Canonical digest checked by browser; same 20s server/30s client limits; UI abort identity rejects cancelled/superseded replies. No free-text context permitted.

Both: protected exact-origin/access-code endpoint, byte bounds, instance/hour call reservation, mock provider mode. Real context and instruction-like fictional context rejected before any provider call. Direct behavior must remain unchanged.

Plan: preregister acceptance and commit; add code-only diagnostic adapters without changing validators; compose bounded generation/validation/one-repair/fallback with @langchain/core runnables around existing REST adapter (preserves pinned Gemini configuration); then flag, safe metrics/provenance, fixtures/harness, docs and independent review. No agents or LangGraph in application code. An independent review agent is explicitly requested by the task after implementation.

Runtime initially Node 24.19.0/npm 11.9.0 (outside project engine range); baseline check passed 672 Vitest tests in 51 files and catalog/build checks. Obtain pinned Node 22/npm 10 for subsequent verification. Package manager cache stays in /tmp because the default home cache is unwritable.
