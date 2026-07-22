# Architecture

Dictator is a single macOS Swift process (`DictatorService`). The service owns
one HTTP listener (SwiftNIO, one event-loop thread) on the registered Sheaf
port `9003` and serves three surfaces from it: the dictation API, the
operational web UI, and the standard service endpoints. A fourth surface, the
Launchpad hardware controller, runs in-process alongside the server and
shares the same pipeline and stores. The iOS keyboard client remains in the
repository as quarantined source, but it is not built or tested by default.

## Project layout

```text
projects/dictator/
  Package.swift               # SwiftPM: DictatorCore (lib), DictatorService (exe), CWhisper (system lib)
  Makefile                    # build/test/run lanes (see operations.md)
  src/
    Sources/DictatorCore/     # pipeline, runtime config, STT, refinement
    Sources/DictatorService/  # HTTP server, web APIs, Launchpad, Talon control client, interaction history
    Sources/CWhisper/         # whisper.cpp module map + shim header
    web/                      # static dashboard (index.html, app.js, styles.css)
    launchpad/                # product Launchpad layout JSON
    talon/sheaf_control/      # Talon user script bridge, symlinked into ~/.talon/user
    prompts/system-prompts/   # refinement prompt catalog
    contracts/                # dictation_v1.yaml (informative API sketch)
    ios-keyboard/             # quarantined Xcode project: host app + keyboard extension + shared code
  tests/                      # DictatorCoreTests, DictatorServiceTests, fixtures, ios-keyboard tests
  docs/                       # this living spec
```

Configuration, secrets, logs, and data live at the Sheaf repo root
(`config/`, `logs/dictator/`, `data/dictator/`), never inside the project
tree.

## Composition

`DictatorServiceMain` wires everything at startup, in order: Sheaf repo-root
discovery → trace logger → CLI overrides → `config/services.json` registry
entry → `RuntimeConfigProvider` (`config/dictator.json` over
`config/dictator.example.json` defaults) → `APIKeysStore` → interaction
store (async reload of recent JSONL history) → `WhisperCPPBridgeSTTEngine` →
`RuntimeConfigRefinementEngine` → `PipelineOrchestrator` → `WebAPIService` →
`LaunchpadServiceController` → `DictationHTTPServer`. Shutdown (via
`POST /exit` or SIGINT) is funneled through an idempotent coordinator that
closes the listener and stops the Launchpad controller.

Two design choices shape most of the code:

- **In-process core, no internal HTTP.** Transcription and refinement are
  library calls behind the `DictatorCoreClient` protocol. The HTTP layer
  exposes only the composed `dictate` operation; the legacy public
  `/v1/transcribe` and `/v1/refine` routes were deliberately retired (they
  404). The Launchpad path calls the same orchestrator directly.
- **Config is re-read per request.** The refinement engine and prompt
  catalogs are rebuilt from the current `RuntimeConfigProvider` snapshot on
  every dictation, so web-UI patches (provider, models, prompts) take effect
  on the next request without restart.
- **Talon control is a local bridge.** Dictator does not drive Talon's private
  REPL protocol. A Sheaf-owned Talon user script exposes local-only
  wake/sleep/status operations on `127.0.0.1:28579`, and Dictator's
  `TalonControlClient` treats bridge failures as `unavailable` rather than a
  service-startup failure.

## Dictation data flow

```text
WAV (HTTP client / Launchpad mic / retained iOS host app)
  → header + WAV validation (HTTP) or AudioRecorder capture (Launchpad)
  → WhisperCPPBridgeSTTEngine (native whisper.cpp, temp file, stt_model_path)
  → empty-transcript short-circuit
  → RefinementPromptBuilder input (selected-text transform or context-bullet mode)
  → ProviderRoutingRefinementEngine: use_cloud ? OpenAI /v1/responses : Ollama /api/generate
       └─ Ollama failure + fallback_mode=openai + key present → OpenAI (fallback_used)
  → response {raw_transcript, revised_text, edit_summary, uncertainty_flags, timings}
  → InteractionHistoryStore.append → in-memory ring + hourly JSONL under data/dictator/interactions/
  → (Launchpad only) ClipboardInserter pastes revised text into the active app
```

Before any HTTP or Launchpad dictation path starts recording or processing
non-Talon audio, Dictator sends a best-effort Talon sleep command through the
bridge. The Launchpad Talon pad refuses to wake Talon while this tracker says
Dictator is recording or processing.

The web UI reads the same store back through `/api/interactions`, and
`/api/status` merges service health, config, key status, STT-model presence,
and a live Ollama probe into one dashboard payload.

## Concurrency model

The NIO channel handler parses and validates requests on the event loop and
runs pipeline work in detached Swift tasks, posting responses back to the
loop; per-channel tasks are cancelled when the connection drops. State
holders are actors (`RuntimeConfigProvider`, `InteractionHistoryStore`,
`WebAPIService`, `DictationActivityTracker`) or lock-guarded classes; the
Launchpad controller is `@MainActor` because it touches AppKit, CoreMIDI,
and CGEvent APIs.

## Present but unwired

`DictatorCore`/`DictatorService` contain components that compile and have
unit tests but are not reachable from the running service:
`SpeechFrameworkSTTEngine`, `ModelAvailabilityChecker`, the voice-config
interaction stack (`VoiceConfigDecision`,
`VoiceConfigInteractionOrchestrator` — `PipelineOrchestrator` throws
`configInteractionUnavailable` as wired), `OllamaBootstrapper`,
`FocusedInputDetector`, `InMemorySecretStore`, and the
`LaunchpadArrowCycle*` event-tap trio. They are tracked in
[coverage](coverage.md), not specified as behavior.

## Retained but quarantined

The iOS keyboard host app and keyboard extension remain under
`src/ios-keyboard/`, with tests under `tests/ios-keyboard/`, for possible
future reactivation. They are not part of the default `build`, `test`,
`dictator-build`, or `dictator-test` workflows. Use the explicit `ios-build`
and `ios-test` targets only for manual revival checks.

## Intentionally not migrated

Relative to the pre-Sheaf external Dictator repository: the AppKit menu-bar
UI, fullscreen overlay, and native Launchpad navigation; the realtime-agent
app and VS Code extension; Conductor trace/restart integration; app-local
`Config/`/`Data/` trees and environment-variable configuration; and the
public transcribe/refine routes. `MigrationExclusionTests` pins the
exclusions.
