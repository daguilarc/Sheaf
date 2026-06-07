# Dictator Architecture

## Overview

The migrated Dictator project under `projects/dictator/` contains:

- a Swift service and shared core library under `src/`
- a web UI served by the Dictator service
- an iOS keyboard host app and extension under `src/ios-keyboard/`
- automated tests under `tests/`

Dictator is registered in Sheaf `config/services.json` as service `dictator` on port **9003**.

## Project layout

```text
projects/dictator/
  Package.swift
  Makefile
  src/
    Sources/DictatorCore/     # pipeline, config, STT, refinement, Talon Lite
    Sources/DictatorService/  # HTTP server, web APIs, interaction history
    Sources/CWhisper/         # whisper.cpp module map
    web/                      # static operational UI
    prompts/                  # system prompt catalogs
    contracts/                # API contract source material
    ios-keyboard/             # Xcode host app + keyboard extension
  tests/
    DictatorCoreTests/
    DictatorServiceTests/
    ios-keyboard/
    fixtures/
  docs/                       # current-state documentation
```

Configuration, secrets, logs, and data use Sheaf repository-root paths (`config/`, `logs/dictator/`, `data/dictator/`).

## Service composition

`DictatorServiceMain` wires:

1. Sheaf repo-root discovery
2. `config/services.json` endpoint resolution
3. `config/dictator.json` runtime config and `config/api_keys.json` secrets
4. `WhisperCPPBridgeSTTEngine` for local STT
5. `RuntimeConfigRefinementEngine` for cloud/local LLM refinement with fallback
6. `PipelineOrchestrator` as the shared dictation client
7. `DictationHTTPServer` for health, exit, dictate-audio, and web routes
8. `InteractionHistoryStore` for in-memory plus on-disk interaction history

## Dictation pipeline

Audio enters through `POST /v1/dictate-audio`, is transcribed and refined through `DictatorCore`, and returns transcript, revised text, edit summary, uncertainty flags, and timing fields. See [Dictation pipeline](dictation-pipeline.md).

## Web UI and service APIs

The legacy macOS AppKit menu-bar UI was not migrated. Operational workflows (status, config edit/reset, prompt selection, interaction history, API key status) are served by static assets at `/` and JSON routes under `/api/*`. See [Web UI](web-ui.md).

## iOS keyboard relationship

The host app records audio and uploads WAV payloads to the Dictator service. The keyboard extension inserts completed transcripts via app-group session state and Darwin notifications. The iOS client targets port `9003` and does not call Conductor trace or service-manager APIs.

| Component | Path | Role |
|-----------|------|------|
| Host app | `src/ios-keyboard/DictatorKeyboardHost/HostApp/` | Records audio, uploads to Dictator, persists transcripts and diagnostics |
| Keyboard extension | `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension/` | Custom keyboard UI, dictation controls, transcript insertion |
| Shared code | `src/ios-keyboard/Shared/` | App-group session state, Darwin notifications, endpoint helpers |
| Xcode project | `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj` | Source-of-truth build metadata |
| Tests | `tests/ios-keyboard/` | Unit and UI tests referenced by the Xcode project |

### Cross-process coordination

- App group: `group.com.joyo.dictator`
- Darwin notifications: `dictation.start`, `dictation.stop`, `dictation.cancel-take`, `session-updated`
- Shared session state tracks launch, recording, processing, completion, failure, and cancellation phases

## Build layout

- Swift package build output: `.build/`
- Xcode DerivedData for iOS builds: `.build/xcode/`

Both paths are git-ignored. Only source and project metadata are tracked under `src/ios-keyboard/`.

## Intentionally not migrated

The following external Dictator repository surfaces were left behind:

- realtime-agent app (`apps/realtime-agent/`)
- VS Code extension
- external quest records from the standalone repository
- AppKit menu-bar UI and fullscreen overlays
- legacy public `POST /v1/transcribe` and `POST /v1/refine` routes
- app-local `Config/` and `Data/` trees
- Conductor service-manager trace/restart integration
- generated build output, caches, local secrets, crash logs, and runtime data copied during the external repo's development history

The migration quest under `projects/dictator/quests/` is Sheaf quest-runner scaffolding for this migration, not imported external quest debris.
