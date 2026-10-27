# SCOOT documentation

Start with the [project overview](../README.md), then use these references:

| Document | Purpose |
| --- | --- |
| [Architecture](scoot-architecture.md) | Browser pipeline, component responsibilities, storage, and optional provider boundaries |
| [Measurement guide](../tasks/seated-reach-measurement-guide.md) | Joint geometry, fixed calibration, time windows, quality gates, and repetition analysis |
| [Exercise library](../tasks/seated-exercise-library.md) | Exercise-specific metrics, landmarks, and readiness conditions |
| [Gemini integration](gemini-integration.md) | Grounded report schemas, approved speech, validation, and failure behavior |
| [LangChain handoff](langchain-handoff.md) | Flag, bounded repair, exact commands, verification and known limitations |
| [Report evaluation acceptance](report-eval/acceptance.md) | Preregistered synthetic evaluation metrics and reversal criteria |
| [Current verification](verification.md) | Automated checks on the clean SCOOT snapshot and their limits |
| [Historical integration evidence](integrated-application-verification.md) | Earlier integration checks; not current physical-device acceptance |
| [Device verification pending](device-verification-pending.md) | Observations still required on actual devices |
| [Upper-body engineering policy](upper-body-engineering-policy.md) | Historical recognition experiment and calibration settings; not the active manual-selection flow |

Task documents preserve design decisions and some historical requirements. Their planned features and old test totals do not override the implemented behavior described by current source and the root README.

## Visual reference

![SCOOT recording with tracking overlay](../assets/scoot-recording.png)

This screenshot shows recording, not a completed Gemini response. The [system diagram](../tasks/mermaid-diagram.png) is a conceptual overview; availability and verification limits are described in the architecture document.
