# Dictator Architecture

## Overview

The migrated Dictator project under `projects/dictator/` contains:

- a Swift service and shared core library under `src/`
- a web UI served by the Dictator service
- an iOS keyboard host app and extension under `src/ios-keyboard/`
- automated tests under `tests/`

Dictator is registered in Sheaf `config/services.json` as service `dictator` on port **9003**.

## Service layer

The Dictator service exposes:

- standard Sheaf endpoints (`GET /health`, `POST /exit`)
- the dictation API (`POST /v1/dictate-audio`)
- web UI static assets and operational JSON APIs

Configuration is read from `config/dictator.json`. Secrets are read from `config/api_keys.json`. Logs write to `logs/dictator/` and runtime data to `data/dictator/`.

## Dictation pipeline

Audio enters through `POST /v1/dictate-audio`, is transcribed and refined through the shared `DictatorCore` pipeline, and returns raw transcript, revised text, edit summary, uncertainty flags, and timing fields.

## iOS keyboard integration

The iOS surface is split into:

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

### Network model

The host app uploads WAV audio to `POST /v1/dictate-audio` on the configured Dictator base URL (default `http://127.0.0.1:9003`). Physical devices must use the Mac LAN address with port `9003`.

Diagnostics are persisted locally in the app group (`host_diagnostics.log`). The migrated iOS client does not post diagnostics to a separate Conductor trace API.

## Build layout

- Swift package build output: `.build/`
- Xcode DerivedData for iOS builds: `.build/xcode/`

Both paths are git-ignored. Only source and project metadata are tracked under `src/ios-keyboard/`.
