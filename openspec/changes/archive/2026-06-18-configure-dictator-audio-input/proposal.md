## Why

Dictator Launchpad recording currently always uses the macOS default audio input, which makes the record control silently bind to the wrong microphone when the operator needs a specific device. The service should make that choice explicit and fail closed when a named input is unavailable so the user can see that recording is disabled before pressing the pad or dashboard button.

## What Changes

- Add a nullable/string `audio_input` runtime config value: `null`, missing, or blank means use the default audio input; a non-blank value selects the matching configured audio input.
- Use the selected input's first channel for Launchpad recording; no channel picker is introduced.
- Do not fall back when a configured non-blank input cannot be resolved or opened.
- Hide/disable the dashboard record button when the selected audio input is unavailable.
- Hide the Launchpad record-status cell `(0,7)` when the selected audio input is unavailable so the absence of the pad communicates that Dictator recording is not available.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `dictator-launchpad`: Launchpad recording input selection changes from always-default input to config-driven default-or-selected input, with no fallback and `(0,7)` hidden when unavailable.
- `dictator-web-ui`: Runtime config/status gains `audio_input` and dashboard recording availability so the record control disappears when a selected input is unavailable.

## Impact

- Config contract and runtime config model: `config/dictator.json`, `RuntimeConfigFile`, config patch/reset/default handling, and docs under `projects/dictator/docs/contracts/config.md`.
- Audio capture: `projects/dictator/src/Sources/DictatorService/AudioRecorder.swift` and recording controller call sites must resolve an input device before recording and bind AVFoundation capture to the selected device where configured.
- Launchpad: `LaunchpadServiceController` and render logic must gate record-status rendering and dictation actions on selected-input availability.
- Web/API/UI: `/api/status`, `/api/config`, `/api/config/options`, `PATCH /api/config`, dashboard state, and tests need to expose and validate the audio input setting and availability.
- Tests: Dictator core config tests, web API tests, audio-recorder/device-resolution tests, and Launchpad rendering/action tests.
