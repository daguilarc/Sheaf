# Physical Plan: Dictation API And Pipeline Integration

## Objective

Complete the public Dictator service API and pipeline wiring: preserve `POST /v1/dictate-audio`, add standard `GET /health` and `POST /exit`, remove unused public `POST /v1/transcribe` and `POST /v1/refine`, and ensure transcription/refinement/provider fallback behavior works through migrated project-local config, prompts, logs, and data paths.

Expected outcome:

- `GET /health` returns the standard Sheaf shape: `healthy`, `uptime`, and optional `warning`.
- `POST /exit` triggers graceful service shutdown.
- `POST /v1/dictate-audio` remains compatible with the existing iOS keyboard contract and validates WAV content type, WAV shape, sample rate, locale, session identity, optional context, and style preferences.
- Internal transcription and refinement APIs remain available to the pipeline but are not exposed as public HTTP routes.
- Pipeline success and failure records are persisted to `data/dictator/` and logged under `logs/dictator/`.
- The canonical project-local API reference excludes `/v1/transcribe` and `/v1/refine` as public routes.

## Key Files And Systems

Likely affected files:

- `projects/dictator/src/Sources/DictatorService/DictationHTTPServer.swift`
- `projects/dictator/src/Sources/DictatorService/ServiceLifecycle.swift`
- `projects/dictator/src/Sources/DictatorService/main.swift`
- `projects/dictator/src/Sources/DictatorService/InteractionHistory.swift`
- `projects/dictator/src/Sources/DictatorService/TraceLogger.swift`
- `projects/dictator/src/Sources/DictatorCore/Contracts.swift`
- `projects/dictator/src/Sources/DictatorCore/PipelineOrchestrator.swift`
- `projects/dictator/src/Sources/DictatorCore/ProviderRoutingRefinementEngine.swift`
- `projects/dictator/src/Sources/DictatorCore/RuntimeConfigRefinementEngine.swift`
- `projects/dictator/src/contracts/dictation_v1.yaml`
- `projects/dictator/tests/DictatorServiceTests/DictationHTTPServerTests.swift`
- `projects/dictator/tests/DictatorCoreTests/PipelineTests.swift`
- `projects/dictator/tests/fixtures/audio/**`
- `projects/dictator/docs/reference/api.md` if docs are started before final doc hardening.

## Existing APIs To Reuse As-Is

- Reuse `DictatorCoreClient` and `PipelineOrchestrator` as the service boundary.
- Reuse `DictateRequest`, `DictateResponse`, `TranscribeRequest`, `TranscribeResponse`, and `DictateCallResult` internally.
- Reuse existing request headers from `DictationHTTPServer`:
  - `Content-Type: audio/wav` or `audio/x-wav`
  - `X-Sample-Rate`
  - `X-Locale`
  - `X-Session-Id`
  - `X-Context-Json`
  - `X-Style-Prefs-Json`
  - `X-Request-Id`
- Reuse `DictationHTTPSuccessRecord` and `DictationHTTPFailureRecord` as inputs to interaction history persistence, expanding fields only if the web UI needs stable IDs or error metadata.
- Reuse `SystemPromptCatalog` and `RefinementPromptBuilder` for prompt selection and prompt-based refinement.
- Reuse `ProviderRoutingRefinementEngine` for cloud/local/fallback behavior and `ModelAvailabilityChecker` for local model availability.

## APIs To Extend Or Modify

- Replace the old health response `{"status":"ok"}` with:

```json
{
  "healthy": true,
  "uptime": 123.45,
  "warning": "optional human-readable warning"
}
```

- Add `POST /exit` with a small JSON response before shutdown, for example:

```json
{
  "exiting": true
}
```

- Keep `POST /v1/dictate-audio` response shape compatible:

```json
{
  "raw_transcript": "string",
  "revised_text": "string",
  "edit_summary": "string",
  "uncertainty_flags": ["string"],
  "transcribe_ms": 10,
  "refine_ms": 20
}
```

- Standardize error responses for all service routes as JSON:

```json
{
  "error": "human-readable message"
}
```

- Return clear status codes:
  - `400` for invalid headers, invalid context/style JSON, missing sample rate/locale/session ID, and unsupported content type
  - `404` for unknown routes, including `/v1/transcribe` and `/v1/refine`
  - `405` for wrong method on known routes
  - `413` for payloads over the configured max size
  - `422` for invalid WAV payloads or unsupported sample rate
  - `500` for pipeline failures.
- Add WAV sample-rate validation that inspects the WAV header instead of trusting only `X-Sample-Rate`. The header and `X-Sample-Rate` must agree when both are parseable.
- Add locale validation for non-empty BCP-47-ish values such as `en`, `en-US`, or `fr-CA`; reject whitespace and control characters.
- Add route tests that prove `/v1/transcribe` and `/v1/refine` are absent publicly while `coreClient.transcribe` and refinement engine code remain available internally.
- Update `projects/dictator/src/contracts/dictation_v1.yaml` or replace it with a project-local canonical contract that contains only active public routes. If keeping the YAML file, remove public `/v1/transcribe` and `/v1/refine` endpoint entries.

## Implementation Notes

Keep the NIO server rather than introducing a new web framework. Add a small router layer around the existing `DictationHTTPHandler` so health, exit, dictation, web UI APIs, and static routes can share request parsing and JSON response helpers without becoming a single large `if` block.

The pipeline composition in `main.swift` should use:

- `WhisperCPPBridgeSTTEngine` with `stt_model_path` and `stt_language` from `config/dictator.json`
- `RuntimeConfigRefinementEngine`
- `ProviderRoutingRefinementEngine` using `use_cloud`, `fallback_mode`, OpenAI key status, Ollama availability, and selected cloud/local model settings
- `RuntimeConfigTalonLiteLLMCorrectionEngine` and `TalonLitePipelineOrchestrator` where Talon Lite behavior is preserved.

Preserve platform integration behavior as service/domain capabilities rather than native UI:

- keep WAV audio input through `POST /v1/dictate-audio`
- keep migrated `AudioRecorder`/`RecordingController` available for macOS service-side capture if the service exposes a recording workflow
- keep `ActiveTargetContextProvider` as the macOS context source where accessibility permissions allow it
- keep `ClipboardInserter`/`KeyboardInjector` for insertion paths that still apply on macOS, with permission failures logged and surfaced through status/errors.

The service should log:

- startup config source and endpoint
- missing API key status without secret values
- missing STT model or Ollama prerequisites
- request start/finish/failure with request IDs
- pipeline timings
- dictation state transitions
- shutdown.

Interaction persistence should record both successful and failed HTTP dictation attempts with enough metadata for slice 4:

- stable interaction ID
- timestamp
- source `http`
- optional context
- raw transcript when available
- final revised text when available
- edit summary
- uncertainty flags
- provider/model/fallback info when available
- timings
- error message when failed
- sample rate, locale, and request/session IDs.

Do not reintroduce old public JSON `/v1/transcribe` or `/v1/refine` routes as compatibility aliases. The spec says they have no active non-test callers.

## Validation

- `make -C projects/dictator test`
- Focused HTTP tests using an injected fake `DictatorCoreClient`:
  - `GET /health` shape and uptime
  - `POST /exit` response and shutdown callback
  - valid `POST /v1/dictate-audio` with WAV fixture returns expected transcript/refinement/timings
  - unsupported content type rejected
  - invalid/missing `X-Sample-Rate` rejected
  - WAV header/sample-rate mismatch rejected
  - missing/blank `X-Locale` rejected
  - missing/blank `X-Session-Id` rejected
  - invalid `X-Context-Json` and `X-Style-Prefs-Json` rejected
  - over-large payload rejected
  - malformed WAV rejected
  - pipeline failure returns JSON error and records failure
  - `/v1/transcribe` and `/v1/refine` return 404.
- Focused core tests:
  - pipeline success/failure
  - provider fallback behavior for missing OpenAI key, unavailable Ollama, and selected fallback mode
  - Talon Lite parser/recovery/correction paths.
- Manual smoke:
  - start with `make dictator-run`
  - `curl http://127.0.0.1:9003/health`
  - `curl -X POST http://127.0.0.1:9003/exit`.
