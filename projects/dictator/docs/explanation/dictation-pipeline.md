# Dictation Pipeline

Dictator's dictation path runs entirely inside `POST /v1/dictate-audio`. The HTTP handler decodes WAV audio, invokes `PipelineOrchestrator`, records the interaction, and returns JSON.

## Audio input

Clients send raw WAV bytes with required metadata headers:

- `Content-Type: audio/wav`
- `X-Sample-Rate`, `X-Locale`, `X-Session-Id`, `X-Request-Id`
- optional context and style headers for refinement

The iOS host app and integration tests use the same contract.

## Speech-to-text

`WhisperCPPBridgeSTTEngine` runs local whisper.cpp inference using the model at `stt_model_path` from `config/dictator.json`. Language comes from `stt_language`.

Empty transcripts skip refinement and return uncertainty flag `empty_transcript_skipped_refinement`.

## Prompt building

`RuntimeConfigRefinementEngine` loads the selected system prompt files from `system_prompts_dir`. The web UI and `POST /api/prompts/selection` choose primary and auxiliary prompt paths persisted in `config/dictator.json`.

Optional client context headers are passed through as `optional_context` for refinement.

## Provider routing

`use_cloud` in `config/dictator.json` selects the primary provider:

| Mode | Engine | Model field |
|------|--------|-------------|
| Cloud | `OpenAIRefinementEngine` | `cloud_model` |
| Local | `OllamaRefinementEngine` | `local_model` |

`ProviderRoutingRefinementEngine` wraps the chosen engine and applies fallback behavior using `fallback_mode` when the primary provider fails or is unavailable (for example missing OpenAI key or unreachable Ollama).

## Cloud and local model selection

- Cloud presets are listed by `GET /api/models?provider=cloud`.
- Local models are discovered from Ollama `GET /api/tags` via `GET /api/models?provider=local`.
- Runtime config fields `cloud_model` and `local_model` hold the active model names.

## Fallback behavior

When cloud refinement is requested but the OpenAI key is missing or the request fails, the routing engine can fall back according to `fallback_mode`. Provider metadata on successful responses indicates whether fallback ran.

## Talon Lite parsing and correction

`DictatorCore` contains Talon Lite grammar parsing, rendering, LLM correction, and recovery orchestration for structured voice commands. `TalonLitePipelineOrchestrator` coordinates parse → correct → reparse → render stages for Talon Lite mode interactions. Unit tests under `DictatorCoreTests` cover parser, renderer, correction, and recovery behavior.

## Context capture and insertion

HTTP dictation returns revised text to the caller. Platform insertion behavior differs by client:

- **Web UI** displays interaction history; it does not perform OS-level text insertion.
- **macOS service helpers** such as `ClipboardInserter` and `ActiveTargetContextProvider` support optional local insertion workflows outside the public HTTP API.
- **iOS keyboard extension** inserts completed transcripts into the host text field via app-group session state.

## Internal vs public APIs

`PipelineOrchestrator.transcribe` and `PipelineOrchestrator.refine` remain available internally for tests and composition. They are not exposed as separate public HTTP routes in the migrated service.
