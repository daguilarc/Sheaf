## Why

Dictator's native Whisper bridge was built against Homebrew's older `whisper-cpp 1.8.3` layout, where ggml libraries and backends were packaged under the Whisper installation. Current Homebrew installs `whisper-cpp` and ggml separately and requires embedders to load ggml backend plugins explicitly; without that initialization, ending a recording aborts the entire Dictator process.

## What Changes

- Resolve Whisper and ggml headers and libraries from stable Homebrew prefixes for both the `whisper-cpp 1.8.3` bundled layout and the current split-package layout, on Apple Silicon and Intel macOS.
- Remove version-specific Homebrew Cellar paths from Dictator's Swift package and C bridge.
- Initialize ggml backends once before creating the first Whisper context, then verify that at least one backend device is available.
- Convert missing-backend initialization into a normal transcription failure instead of allowing ggml to abort the service.
- Add automated coverage for discovery rules, once-only backend initialization, initialization ordering, and zero-device failure behavior, plus native verification against supported Homebrew installations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dictator-build-workflow`: Dictator builds against supported stable Homebrew Whisper/ggml layouts without version-specific Cellar paths.
- `dictator-dictation-pipeline`: Whisper transcription initializes available ggml backends before model loading and reports missing backends without terminating the service.

## Impact

- Affected project: `projects/dictator`.
- Primary code: `Package.swift`, the `CWhisper` bridge, and `WhisperCPPBridgeSTTEngine.swift`.
- Tests: Dictator build-workflow and core transcription tests, with native smoke verification on both Homebrew packaging generations.
- Dependencies: supports rebuilds against `whisper-cpp 1.8.3` through the current Homebrew `whisper-cpp`/ggml packages; no model or runtime-configuration migration is required.
