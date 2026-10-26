# SCOOT verification

## Clean snapshot checks

On October 26, 2026 (America/New_York), the clean SCOOT snapshot passed:

| Check | Observed result |
| --- | --- |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Vitest | 667 tests across 51 files passed |
| Catalog checks | 13 tests passed |
| Production build | TypeScript, pose asset preparation, and Vite build passed |

The checks ran through `npm run check`. The snapshot includes the SCOOT page title, header, package name, and browser-local database name. Documentation restoration followed this run; no application logic was changed by that restoration.

These are automated source/build checks. They do not establish actual phone camera performance, audible speech, live Gemini availability, clinical validity, or successful production deployment. Dependencies were reused from the existing local installation for this check; production builds should install from the lockfile in a clean environment.

## Evidence boundaries

- The [earlier integration record](integrated-application-verification.md) describes an October 25 source snapshot and separate browser fixtures. Its test totals are historical, not additive to the current totals.
- [Physical-device observations](device-verification-pending.md) remain pending, including iPhone recording timing, audio, storage, backgrounding, and close-view ankle feasibility.
- Mock provider tests do not prove that a genuine model or voice is available.
- Engineering thresholds and synthetic movement fixtures are not clinical validation.
