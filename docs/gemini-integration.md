# Gemini integration

SCOOT uses Gemini as an optional explanation and speech service. Local TypeScript analyzers own every measurement, count, exclusion, and review flag. Video, raw landmarks, and real clinical notes stay on the device.

## Results after recording

The browser immediately renders a deterministic report. Quick recordings can request optional Gemini wording when the service is enabled and configured. Calibrated sessions use a separate measured-session report flow.

Quick-recording output follows a bounded schema: `headline`, `rangeOfMotion`, `speedAndControl`, event-linked `riskAlerts`, `trackingQuality`, and `clinicianPoints`. The request contains allowlisted finalized movement facts, not video or unrestricted text. See the [quick-report contract](../src/contracts/video-report.ts).

Calibrated reports use fact-linked observations and limitations, an exact required summary, attributed permitted context, and an allowlisted chart structure. Real context remains local; selected fictional fixtures support provider testing. See the [provider contract](../src/contracts/provider-report.ts) and [report prompt](../src/report/report-prompt.ts).

The server and browser validate generated responses against source facts. Invalid numbers, unsupported claims, stale responses, and schema failures are rejected. The local report remains available when generation fails. Charts render validated numeric data rather than AI-generated images or arbitrary code.

## Approved spoken cues

Local capture events select approved phrases from a versioned catalog. The TTS endpoint accepts cue identifiers and returns audio for the approved phrase. It does not receive camera frames or invent exercise instructions. The speech queue handles priority, expiry, mute, cancellation, and stale playback. Browser speech and captions provide fallback paths. Audible playback still needs physical-device verification; a successful request or visible caption does not prove sound.

See the [cue controller](../src/speech/cue-controller.ts), [audio adapters](../src/speech/browser-audio.ts), and [TTS endpoint](../api/gemini-tts.ts).

## Server configuration and boundaries

Provider access defaults to disabled. Configure server-only settings using [.env.example](../.env.example). Never put provider keys in browser-prefixed variables or source control. Report and TTS endpoints enforce configured access codes, exact allowed origins, payload limits, timeouts, and request limits. Mock mode is a labeled stand-in and does not establish live provider availability.

Local Stop, capture, measurement, replay, and supported save flows do not depend on a model response. This experimental integration does not establish clinical validity or authorize sending real patient information. Current source is authoritative where older task specifications differ.

## Verification

See [current automated checks](verification.md), [historical integration evidence](integrated-application-verification.md), and [pending device observations](device-verification-pending.md). Live Gemini output and physical-device sound were not verified by the latest local check run.
