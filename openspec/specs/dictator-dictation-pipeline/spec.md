# Capability: Dictation Pipeline

Project: `projects/dictator`
ID prefix: `dp` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The dictation pipeline is dictator's core service: it accepts WAV audio over
`POST /v1/dictate-audio`, transcribes it locally with whisper.cpp, refines the
transcript through a configurable LLM provider (local Ollama or cloud OpenAI
with fallback), records the interaction, and returns the raw transcript plus
refined text. The web UI test panel, the iOS keyboard host app, and the
Launchpad controller (in-process) are all clients of this pipeline.
## Requirements
### Requirement: dp-1 — HTTP surface: Valid request handling
WHEN it receives `POST /v1/dictate-audio` with a valid WAV body and valid `Content-Type`, `X-Sample-Rate`, `X-Locale`, and `X-Session-Id` headers, THE service SHALL send Talon a sleep command, then run transcription and refinement, and respond 200 with `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}` (see Contracts).

#### Scenario: Valid dictate-audio request
- **WHEN** the service receives `POST /v1/dictate-audio` with a valid WAV body and valid `Content-Type`, `X-Sample-Rate`, `X-Locale`, and `X-Session-Id` headers
- **THEN** the service sends Talon a sleep command, runs transcription then refinement, and responds 200 with `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}`

### Requirement: dp-2 — HTTP surface: Content-Type validation
IF the `Content-Type` header does not start with `audio/wav` or `audio/x-wav` (case-insensitive), THEN THE service SHALL respond 400 with `Content-Type must be audio/wav.`

#### Scenario: Invalid Content-Type
- **WHEN** the `Content-Type` header does not start with `audio/wav` or `audio/x-wav` (case-insensitive)
- **THEN** the service responds 400 with `Content-Type must be audio/wav.`

### Requirement: dp-3 — HTTP surface: X-Sample-Rate validation
IF `X-Sample-Rate` is missing or not a positive integer, THEN THE service SHALL respond 400 with `X-Sample-Rate must be a positive integer.`

#### Scenario: Missing or invalid X-Sample-Rate
- **WHEN** `X-Sample-Rate` is missing or not a positive integer
- **THEN** the service responds 400 with `X-Sample-Rate must be a positive integer.`

### Requirement: dp-4 — HTTP surface: X-Locale validation
IF `X-Locale` is missing, has surrounding whitespace, contains control characters, or does not match `^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$`, THEN THE service SHALL respond 400 with `X-Locale must be a non-empty BCP-47 locale.`

#### Scenario: Invalid X-Locale
- **WHEN** `X-Locale` is missing, has surrounding whitespace, contains control characters, or does not match `^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$`
- **THEN** the service responds 400 with `X-Locale must be a non-empty BCP-47 locale.`

### Requirement: dp-5 — HTTP surface: X-Session-Id validation
IF `X-Session-Id` is missing or blank after trimming, THEN THE service SHALL respond 400 with `X-Session-Id is required.`

#### Scenario: Missing or blank X-Session-Id
- **WHEN** `X-Session-Id` is missing or blank after trimming
- **THEN** the service responds 400 with `X-Session-Id is required.`

### Requirement: dp-6 — HTTP surface: WAV magic validation
IF the body is shorter than 44 bytes or does not carry the `RIFF`/`WAVE` magic (bytes 0–3 and 8–11), THEN THE service SHALL respond 422 with `Payload must be a valid WAV stream.`

#### Scenario: Invalid WAV body
- **WHEN** the body is shorter than 44 bytes or does not carry the `RIFF`/`WAVE` magic (bytes 0–3 and 8–11)
- **THEN** the service responds 422 with `Payload must be a valid WAV stream.`

### Requirement: dp-7 — HTTP surface: Sample rate validation
IF `X-Sample-Rate` is not one of `8000, 16000, 22050, 24000, 32000, 44100, 48000`, THEN THE service SHALL respond 422 with `Unsupported sample rate <n>.`; IF it is supported but does not equal the sample rate in the WAV header (little-endian uint32 at bytes 24–27), THEN THE service SHALL respond 422 with `X-Sample-Rate (<header>) does not match WAV header sample rate (<wav>).`

#### Scenario: Unsupported sample rate
- **WHEN** `X-Sample-Rate` is not one of `8000, 16000, 22050, 24000, 32000, 44100, 48000`
- **THEN** the service responds 422 with `Unsupported sample rate <n>.`

#### Scenario: Sample rate header/WAV mismatch
- **WHEN** `X-Sample-Rate` is a supported value but does not equal the sample rate in the WAV header (little-endian uint32 at bytes 24–27)
- **THEN** the service responds 422 with `X-Sample-Rate (<header>) does not match WAV header sample rate (<wav>).`

### Requirement: dp-8 — HTTP surface: Optional JSON headers
WHERE `X-Context-Json` or `X-Style-Prefs-Json` is supplied non-blank, THE service SHALL parse it as a JSON object and stringify each value into a `[String: String]` map; IF the header is not valid JSON or not a JSON object, THEN THE service SHALL respond 400 with `<HeaderName> must be valid JSON.` / `<HeaderName> must be a JSON object.`

#### Scenario: Valid optional JSON header
- **WHEN** `X-Context-Json` or `X-Style-Prefs-Json` is supplied non-blank and is valid JSON
- **THEN** the service parses it as a JSON object and stringifies each value into a `[String: String]` map

#### Scenario: Invalid JSON in optional header
- **WHEN** `X-Context-Json` or `X-Style-Prefs-Json` is supplied but is not valid JSON or not a JSON object
- **THEN** the service responds 400 with `<HeaderName> must be valid JSON.` / `<HeaderName> must be a JSON object.`

### Requirement: dp-9 — HTTP surface: Payload size limit
IF the request body exceeds 25 MiB (26 214 400 bytes), THEN THE service SHALL respond 413 with `Audio payload exceeds configured size limit.` and close the connection without running the pipeline.

#### Scenario: Oversized audio payload
- **WHEN** the request body exceeds 25 MiB (26 214 400 bytes)
- **THEN** the service responds 413 with `Audio payload exceeds configured size limit.` and closes the connection without running the pipeline

### Requirement: dp-10 — HTTP surface: Pipeline failure response
IF transcription or refinement throws, THEN THE service SHALL respond 500 with `Dictation failed: <localized description>` and record a failed interaction (mode `revision`, edit summary `Dictation pipeline failed.`, `error_message` set, zero timings).

#### Scenario: Pipeline throws
- **WHEN** transcription or refinement throws
- **THEN** the service responds 500 with `Dictation failed: <localized description>` and records a failed interaction with mode `revision`, edit summary `Dictation pipeline failed.`, `error_message` set, and zero timings

### Requirement: dp-11 — HTTP surface: Internal routes not exposed
THE service SHALL NOT expose `POST /v1/transcribe` or `POST /v1/refine` as HTTP routes; both respond 404. Transcribe and refine remain internal `DictatorCoreClient` operations.

#### Scenario: POST to internal transcribe route
- **WHEN** a `POST /v1/transcribe` request arrives
- **THEN** the service responds 404

#### Scenario: POST to internal refine route
- **WHEN** a `POST /v1/refine` request arrives
- **THEN** the service responds 404

### Requirement: dp-12 — HTTP surface: Request ID generation
WHERE `X-Request-Id` is omitted, THE service SHALL generate an 8-character request id for tracing; the id (client-supplied or generated) is recorded in the interaction context, not echoed in the response body.

#### Scenario: X-Request-Id omitted
- **WHEN** `X-Request-Id` is omitted
- **THEN** the service generates an 8-character request id for tracing and records it in the interaction context without echoing it in the response body

### Requirement: dp-13 — Pipeline behavior: Whisper transcription
THE service SHALL transcribe with whisper.cpp using the model at the resolved `stt_model_path` and language `stt_language` from [`config/dictator.json`](../../../projects/dictator/docs/contracts/config.md); audio is written to a unique temp directory and deleted after transcription.

#### Scenario: Transcription runs
- **WHEN** the dictation pipeline processes an audio request
- **THEN** the service transcribes using whisper.cpp with `stt_model_path` and `stt_language` from config, writing audio to a unique temp directory that is deleted after transcription

### Requirement: dp-14 — Pipeline behavior: Empty transcript skip
IF the transcript is empty after trimming, THEN THE service SHALL skip refinement and respond 200 with empty `raw_transcript` and `revised_text`, `edit_summary` = `Transcription empty; skipped refinement.`, `uncertainty_flags` = `["empty_transcript_skipped_refinement"]`, and `refine_ms` = 0.

#### Scenario: Empty transcript
- **WHEN** the transcript is empty after trimming
- **THEN** the service skips refinement and responds 200 with empty `raw_transcript` and `revised_text`, `edit_summary` = `Transcription empty; skipped refinement.`, `uncertainty_flags` = `["empty_transcript_skipped_refinement"]`, and `refine_ms` = 0

### Requirement: dp-15 — Pipeline behavior: Refinement provider selection
THE service SHALL choose the refinement provider per request from the current runtime config: `use_cloud: true` → OpenAI with `cloud_model`; `use_cloud: false` → Ollama at `ollama_host` with `local_model`. The system prompt body is loaded per request from `system_prompts_dir`/`system_prompt`; an unreadable or empty prompt file falls back to the built-in refiner instructions (`RefinementPromptBuilder.fallbackInstructions`), never fails the request.

#### Scenario: Cloud provider selected
- **WHEN** the current runtime config has `use_cloud: true`
- **THEN** the service uses OpenAI with `cloud_model` for refinement

#### Scenario: Local provider selected
- **WHEN** the current runtime config has `use_cloud: false`
- **THEN** the service uses Ollama at `ollama_host` with `local_model` for refinement

#### Scenario: Unreadable prompt file
- **WHEN** the system prompt file at `system_prompts_dir`/`system_prompt` is unreadable or empty
- **THEN** the service falls back to `RefinementPromptBuilder.fallbackInstructions` and does not fail the request

### Requirement: dp-16 — Pipeline behavior: Ollama-to-OpenAI fallback
WHEN the Ollama provider fails AND `fallback_mode` is `openai` AND an OpenAI key is configured, THE service SHALL retry refinement with OpenAI and mark the interaction `fallback_used: true`; otherwise the original error propagates. The OpenAI provider has no fallback.

#### Scenario: Ollama fails with fallback configured
- **WHEN** the Ollama provider fails and `fallback_mode` is `openai` and an OpenAI key is configured
- **THEN** the service retries refinement with OpenAI and marks the interaction `fallback_used: true`

#### Scenario: Ollama fails without fallback
- **WHEN** the Ollama provider fails and fallback conditions are not met
- **THEN** the original error propagates

### Requirement: dp-17 — Pipeline behavior: Ollama engine HTTP call
THE Ollama engine SHALL call `POST <ollama_host>/api/generate` with body `{"model", "prompt", "system", "stream": false}` and read `response`; a non-2xx status or missing/empty output text fails refinement (error text truncated to 220 characters).

#### Scenario: Ollama generate call
- **WHEN** the Ollama engine performs refinement
- **THEN** it calls `POST <ollama_host>/api/generate` with body `{"model", "prompt", "system", "stream": false}` and reads `response`

#### Scenario: Ollama non-2xx or empty response
- **WHEN** the Ollama engine receives a non-2xx status or missing/empty output text
- **THEN** refinement fails with error text truncated to 220 characters

### Requirement: dp-18 — Pipeline behavior: OpenAI engine HTTP call
THE OpenAI engine SHALL call `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <key>` and body containing `model`, `instructions`, and `input`; WHERE optional `reasoning_effort` is configured, THE engine SHALL additionally send `"reasoning": {"effort": "<configured-value>"}`, and WHERE it is absent the engine SHALL omit `reasoning`; the engine SHALL read `output_text` or the first non-empty `output[].content[].text`; a missing key fails with `Missing OpenAI API key`, HTTP 401/403 with `Invalid OpenAI API key`, and connectivity errors with `Network unavailable`.

#### Scenario: OpenAI responses call without reasoning effort
- **WHEN** the OpenAI engine performs refinement and `reasoning_effort` is absent
- **THEN** it calls `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <key>` and body containing `model`, `instructions`, and `input` while omitting `reasoning`, then reads `output_text` or the first non-empty `output[].content[].text`

#### Scenario: OpenAI responses call with reasoning effort
- **WHEN** the OpenAI engine performs refinement and `reasoning_effort` is `low`
- **THEN** its request body includes `"reasoning": {"effort": "low"}`

#### Scenario: Missing OpenAI API key
- **WHEN** no OpenAI API key is configured
- **THEN** refinement fails with `Missing OpenAI API key`

#### Scenario: OpenAI 401/403 response
- **WHEN** the OpenAI API responds with HTTP 401 or 403
- **THEN** refinement fails with `Invalid OpenAI API key`

#### Scenario: OpenAI connectivity error
- **WHEN** a connectivity error occurs reaching the OpenAI API
- **THEN** refinement fails with `Network unavailable`

### Requirement: dp-19 — Pipeline behavior: Refinement input construction
WHEN building the refinement input, THE service SHALL use the selected-text transform template when `optional_context.selected_text` is non-empty (`Take the following input and modify it based on the following request. ...`); otherwise it SHALL prefix `Context:` bullet lines for non-empty `dictation_context`, `active_app`, and `active_site` context keys; with no context keys the input is the raw transcript alone.

#### Scenario: Selected text context present
- **WHEN** building the refinement input and `optional_context.selected_text` is non-empty
- **THEN** the service uses the selected-text transform template (`Take the following input and modify it based on the following request. ...`)

#### Scenario: Other context keys present
- **WHEN** building the refinement input and `optional_context.selected_text` is empty but `dictation_context`, `active_app`, or `active_site` are non-empty
- **THEN** the service prefixes `Context:` bullet lines for each non-empty context key

#### Scenario: No context keys
- **WHEN** building the refinement input with no context keys
- **THEN** the input is the raw transcript alone

### Requirement: dp-20 — Pipeline behavior: Interaction recording
WHEN a dictation succeeds or fails, THE service SHALL append an interaction record (shape: [interactions](../../../projects/dictator/docs/contracts/interactions.md)) with `request_source: "http"` plus `session_id`, `request_id`, `sample_rate`, and `locale` merged into `optional_context`; success records use mode `revision` with measured `transcribe_ms`/`refine_ms`, `insert_ms: 0`, and `total_pipeline_ms` equal to elapsed request time.

#### Scenario: Successful dictation recorded
- **WHEN** a dictation succeeds
- **THEN** the service appends an interaction record with `request_source: "http"`, `session_id`, `request_id`, `sample_rate`, and `locale` in `optional_context`, mode `revision`, measured `transcribe_ms`/`refine_ms`, `insert_ms: 0`, and `total_pipeline_ms` equal to elapsed request time

#### Scenario: Failed dictation recorded
- **WHEN** a dictation fails
- **THEN** the service appends a failed interaction record with `request_source: "http"` and the relevant context merged into `optional_context`

### Requirement: dp-21 — Pipeline behavior: Dictation state reporting
WHILE a dictation request is being processed, THE service SHALL report `dictation_state: "processing"` on `GET /api/status`, returning to `"idle"` when done (see [web-ui](../dictator-web-ui/spec.md)).

#### Scenario: Request in progress
- **WHEN** a dictation request is being processed
- **THEN** `GET /api/status` reports `dictation_state: "processing"`

#### Scenario: Request complete
- **WHEN** a dictation request completes
- **THEN** `GET /api/status` returns `dictation_state: "idle"`

### Requirement: dp-23 — Reusable refinement context blocks
WHEN a dictation or refinement mode provides structured context blocks, THE dictation pipeline SHALL render those blocks into the refinement input in a stable delimited form before the raw transcript so mode-specific context can be reused without custom prompt string assembly.

#### Scenario: Context blocks included
- **WHEN** a refinement request contains one or more structured context blocks
- **THEN** the refinement input includes each block title, metadata, and body text before the raw transcript

#### Scenario: No context blocks
- **WHEN** a refinement request contains no structured context blocks
- **THEN** the pipeline preserves the existing refinement input behavior for standard dictation

#### Scenario: Future modes reuse context blocks
- **WHEN** a future dictation mode needs to inject non-hunk context
- **THEN** it can supply additional structured context blocks without adding a new prompt assembly path

### Requirement: dp-25 — Injectable refinement rules
WHEN building the system prompt for a non-empty refinement request, THE dictation pipeline SHALL read `injectable_rules` from the current runtime config, case-insensitively match each non-empty key against the raw Whisper transcript using simple substring matching, resolve each matching value as a prompt file path relative to `system_prompts_dir`, and append the contents of each resolved prompt file to the end of the system prompt sent to the selected refinement provider.

#### Scenario: Matching rule appended to prompt
- **WHEN** `injectable_rules` contains `"dogs": "dog_rules.md"`, `dog_rules.md` contains `dogs are cool`, and the raw Whisper transcript contains `Dogs`
- **THEN** the refinement provider receives a system prompt with `dogs are cool` appended after the selected system prompt body

#### Scenario: Non-matching rule omitted
- **WHEN** `injectable_rules` contains `"dogs": "dog_rules.md"` and the raw Whisper transcript does not contain `dogs` in any casing
- **THEN** the refinement provider receives the selected system prompt body without loading or appending `dog_rules.md`

#### Scenario: Transcript and refinement input preserved
- **WHEN** one or more injectable rules match a raw Whisper transcript
- **THEN** the pipeline preserves the raw transcript and refinement input content and only changes the system prompt sent to the refinement provider

#### Scenario: Multiple matches are deterministic
- **WHEN** multiple injectable rule keys match the raw Whisper transcript
- **THEN** the pipeline appends each matching prompt file's contents in stable case-insensitive key order

#### Scenario: Missing injectable prompt file skipped
- **WHEN** an injectable rule matches but its configured prompt file cannot be resolved or read from the prompt catalog
- **THEN** the pipeline skips that injectable rule for the current request and continues refinement with the remaining prompt content

#### Scenario: Empty rules produce existing prompt
- **WHEN** `injectable_rules` is missing or empty in runtime config
- **THEN** the pipeline uses the selected system prompt body exactly as it did before injectable rules

### Requirement: dp-26 — Non-Talon dictation forces Talon asleep
WHEN any non-Talon Dictator dictation starts, THE Dictator service SHALL send a Talon sleep command before recording or processing begins, regardless of Talon's cached, queried, or expected current state.

#### Scenario: HTTP dictation starts
- **WHEN** `POST /v1/dictate-audio` starts processing a valid dictation request
- **THEN** Dictator sends Talon a sleep command before transcription begins

#### Scenario: Launchpad standard dictation starts
- **WHEN** Launchpad standard dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Launchpad auxiliary dictation starts
- **WHEN** Launchpad auxiliary dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Talon already asleep
- **WHEN** Dictator starts non-Talon dictation and Talon is already asleep
- **THEN** Dictator still sends the Talon sleep command

#### Scenario: Talon bridge unavailable
- **WHEN** Dictator starts non-Talon dictation and the Talon bridge is unavailable
- **THEN** Dictator logs the failed sleep attempt and continues starting the non-Talon dictation

### Requirement: dp-27 — Runtime configuration: Optional OpenAI reasoning effort
WHEN Dictator loads runtime configuration, THE service SHALL accept an optional `reasoning_effort` value from the supported vocabulary `none`, `low`, `medium`, `high`, `xhigh`, or `max`, carry it through `LLMRuntimeConfiguration` to every OpenAI refinement path, preserve it when runtime configuration is saved or otherwise patched, and reject values outside that vocabulary.

#### Scenario: Low reasoning is configured
- **WHEN** `config/dictator.json` contains `"reasoning_effort": "low"`
- **THEN** the loaded runtime and LLM configurations expose low reasoning to both primary OpenAI and Ollama-to-OpenAI fallback refinement paths

#### Scenario: Reasoning effort is omitted
- **WHEN** `reasoning_effort` is absent from runtime configuration
- **THEN** the loaded value is absent and OpenAI request behavior remains compatible with the pre-change configuration

#### Scenario: Runtime configuration is patched
- **WHEN** a runtime setting other than reasoning effort is patched while reasoning effort is configured
- **THEN** the resulting persisted configuration preserves the configured reasoning effort

#### Scenario: Unsupported reasoning effort is loaded
- **WHEN** runtime configuration contains a `reasoning_effort` value outside the supported vocabulary
- **THEN** configuration decoding rejects the unsupported value rather than silently changing or omitting it

### Requirement: dp-28 — Pipeline behavior: Whisper backend initialization
WHEN native Whisper transcription first prepares to create a Whisper context, THE service SHALL load discoverable ggml backends once for the process, verify that at least one backend device is available before model initialization, and preserve the configured `stt_model_path` and `stt_language` behavior.

#### Scenario: Dynamic backend plugins are installed
- **WHEN** transcription first runs against a ggml installation whose CPU, Metal, or accelerator backends are dynamic plugins
- **THEN** the service loads the discoverable plugins before creating the Whisper context and transcribes with an available backend device

#### Scenario: Backends are bundled or already registered
- **WHEN** transcription first runs against a supported layout whose backends are bundled or already registered
- **THEN** backend initialization preserves the registered devices and transcription continues normally

#### Scenario: Repeated transcription
- **WHEN** more than one transcription runs in the same Dictator process
- **THEN** process-wide backend loading executes only once while every transcription verifies the cached initialization result before creating its Whisper context

#### Scenario: No backend device is available
- **WHEN** backend loading completes without registering any backend device
- **THEN** transcription fails with a `DictatorError.sttFailed` diagnostic before Whisper model initialization and the Dictator service remains running

#### Scenario: Existing model configuration is used
- **WHEN** backend initialization succeeds
- **THEN** the service initializes Whisper with the resolved `stt_model_path` and `stt_language` exactly as configured

## Contracts

### `POST /v1/dictate-audio`

Request headers:

| Header | Required | Meaning |
|---|---|---|
| `Content-Type` | yes | `audio/wav` or `audio/x-wav` (prefix match, case-insensitive) |
| `X-Sample-Rate` | yes | Positive integer Hz; must be in the supported set and match the WAV header |
| `X-Locale` | yes | BCP-47 locale, e.g. `en-US` |
| `X-Session-Id` | yes | Non-blank client session identifier |
| `X-Request-Id` | no | Trace id; an 8-char id is generated when omitted |
| `X-Context-Json` | no | JSON object; copied into interaction `optional_context` |
| `X-Style-Prefs-Json` | no | JSON object; parsed and forwarded but currently unused (see coverage) |

Body: raw WAV bytes (Content-Length or chunked), max 25 MiB.

Success — 200:

```json
{
  "raw_transcript": "hello world",
  "revised_text": "Hello world.",
  "edit_summary": "Refined with Ollama model.",
  "uncertainty_flags": [],
  "transcribe_ms": 120,
  "refine_ms": 45
}
```

All errors return `{"error": "<message>"}`.

### Error catalogue

| Condition | Status | Message (exact) |
|---|---|---|
| Wrong/missing content type | 400 | `Content-Type must be audio/wav.` |
| Bad `X-Sample-Rate` header | 400 | `X-Sample-Rate must be a positive integer.` |
| Bad `X-Locale` | 400 | `X-Locale must be a non-empty BCP-47 locale.` |
| Missing `X-Session-Id` | 400 | `X-Session-Id is required.` |
| Invalid context/style-prefs header | 400 | `X-Context-Json must be valid JSON.` / `X-Context-Json must be a JSON object.` (same pattern for `X-Style-Prefs-Json`) |
| Body too large | 413 | `Audio payload exceeds configured size limit.` |
| Not a WAV stream | 422 | `Payload must be a valid WAV stream.` |
| Unsupported rate | 422 | `Unsupported sample rate <n>.` |
| Header/WAV rate mismatch | 422 | `X-Sample-Rate (<n>) does not match WAV header sample rate (<m>).` |
| Pipeline failure | 500 | `Dictation failed: <description>` |
| `POST /v1/transcribe`, `POST /v1/refine` | 404 | `Not found.` |
| Wrong method on `/v1/dictate-audio` | 405 | `Method not allowed.` |

Edit summaries pinned by the engines: `Refined with Ollama model.`,
`Refined with OpenAI model.`, `Transcription empty; skipped refinement.`

A machine-readable copy of this endpoint contract is kept at
`src/contracts/dictation_v1.yaml` (informative; this file is normative).

## Design

- `src/Sources/DictatorService/DictationHTTPServer.swift` — SwiftNIO HTTP/1.1
  server on a single event-loop thread; `DictationHTTPRouter` (health, exit,
  dictate-audio), `DictationHTTPValidation` (sample-rate set, locale regex,
  WAV magic/rate parsing), and `DictationHTTPHandler.handleDictateAudio`. Web
  routes are matched first (see [web-ui](../dictator-web-ui/spec.md)); the 25 MiB cap is the
  `maxBodyBytes` init default, enforced while the body streams in.
- `src/Sources/DictatorCore/PipelineOrchestrator.swift` — `dictate` =
  transcribe → empty-check → refine, with `ContinuousClock` timing.
- `src/Sources/DictatorCore/WhisperCPPBridgeSTTEngine.swift` — base64 decode,
  temp-file write, native whisper.cpp call through the `CWhisper` system
  library; `parseWhisperJSON` maps segments (10 µs offsets → ms) and averages
  `exp(avg_logprob)` for confidence. Before creating a Whisper context it uses
  `WhisperBackendBootstrap` to load discoverable ggml backends once and fail
  with a typed diagnostic if no backend device is available.
  Segments/confidence are internal — the HTTP response carries only the transcript.
- `src/Sources/DictatorCore/RuntimeConfigRefinementEngine.swift` — builds a
  fresh `ProviderRoutingRefinementEngine` per request from the current
  `RuntimeConfigProvider` snapshot, so config patches apply to the next
  request without restart.
- `src/Sources/DictatorCore/ProviderRoutingRefinementEngine.swift` — provider
  switch + Ollama→OpenAI fallback; attaches
  `provider_metadata {provider, model, fallback_used}` consumed by the
  interaction recorder.
- `src/Sources/DictatorCore/OllamaRefinementEngine.swift`,
  `OpenAIRefinementEngine.swift`, `RefinementPromptBuilder.swift` — provider
  HTTP clients and prompt assembly; URL errors in
  `{notConnectedToInternet, networkConnectionLost, timedOut, cannotFindHost,
  cannotConnectToHost}` map to `Network unavailable`.
- `src/Sources/DictatorService/HTTPInteractionRecorder.swift` — success and
  failure handlers invoked off the response path (recording is asynchronous
  and best-effort; a persistence failure is logged, never surfaced).
- Tests: `tests/DictatorServiceTests/DictationHTTPServerTests.swift` (every
  status code above, retired routes), `tests/DictatorCoreTests/PipelineTests.swift`,
  `RefinementProviderRoutingTests.swift`, `OllamaRefinementEngineTests.swift`,
  `WhisperCPPBridgeSTTEngineTests.swift`; `tests/DictatorServiceTests/WAVFixture.swift`
  builds valid in-memory WAVs.

## Interactions

- [service-lifecycle](../dictator-service-lifecycle/spec.md) — owns the listener, `/health`,
  `/exit`, 404/405 fallbacks, and startup wiring of the engines.
- [web-ui](../dictator-web-ui/spec.md) — reads recorded interactions and pipeline status;
  its "Dictation API workflow" panel posts to this endpoint from the browser.
- [launchpad](../dictator-launchpad/spec.md) — drives the same `PipelineOrchestrator`
  in-process (no HTTP) and records `request_source: "launchpad"` interactions.
- [ios-keyboard](../dictator-ios-keyboard/spec.md) — remote client of this endpoint.
- [Config contract](../../../projects/dictator/docs/contracts/config.md) — all knobs consumed here.
- [Interactions contract](../../../projects/dictator/docs/contracts/interactions.md) — record shape and
  persistence.
