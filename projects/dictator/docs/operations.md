# Operations

Normative build/run/test procedures for dictator, from a fresh Sheaf
checkout. Repo-wide lane rules: [Testing](../../../structure/testing.md),
[Makefile](../../../structure/makefile.md),
[Services](../../../structure/services.md).

## Prerequisites

- macOS 13+ with a Swift 5.10 toolchain; Xcode (with an `iPhone 16` iOS
  Simulator) is required only for the iOS lanes.
- whisper.cpp libraries via Homebrew — the package links `-lwhisper -lggml
  -lggml-base` with library search paths
  `/opt/homebrew/Cellar/whisper-cpp/1.8.3/libexec/lib`, `/opt/homebrew/lib`,
  `/usr/local/lib` (pinned in `Package.swift`):

  ```bash
  brew install whisper-cpp
  ```

- An STT model binary at the repo root, default path
  `models/ggml-base.en.bin` (configurable via `stt_model_path`; see
  [config contract](contracts/config.md)). Model binaries are not vendored
  in git.
- Optional: a local Ollama at `http://127.0.0.1:11434` with the configured
  `local_model` pulled, for local refinement; an OpenAI key in
  `config/api_keys.json` (copy `config/api_keys.example.json`), for cloud
  refinement and fallback. The service starts without either, with health
  warnings.
- Runtime use of the Launchpad surface additionally needs macOS microphone
  and Accessibility permissions and a Launchpad Pro Mk3.

## Build

From `projects/dictator/`:

```bash
make build        # = swift-build + ios-build
make swift-build  # swift build (service + core only; no Xcode needed)
make ios-build    # xcodebuild -project src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj \
                  #   -scheme DictatorKeyboardHost -sdk iphonesimulator \
                  #   -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO build
```

From the Sheaf root: `make dictator-build` (delegates to `make -C
projects/dictator build`). Build output stays in git-ignored `.build/`
(SwiftPM) and `.build/xcode/` (DerivedData).

## Run

From the Sheaf root (the registered service command):

```bash
make dictator-run          # = make -C projects/dictator run = swift run DictatorService
```

The service must run with the Sheaf repo root discoverable from its working
directory (both Make paths satisfy this). It binds the `dictator` entry from
`config/services.json` — host `0.0.0.0`, port `9003` — unless overridden:

```bash
swift run DictatorService --host 127.0.0.1 --port 9099
```

Probe and stop:

```bash
curl http://127.0.0.1:9003/health
curl -X POST http://127.0.0.1:9003/exit     # clean shutdown (or SIGINT)
```

Web UI: `http://127.0.0.1:9003/`. Trace log: `logs/dictator/trace.log`
(also mirrored to stderr). Runtime data: `data/dictator/interactions/`.

## Test

From `projects/dictator/`:

```bash
make test         # swift-test then ios-test (needs Xcode + iPhone 16 simulator)
make swift-test   # swift test — all DictatorCoreTests + DictatorServiceTests
make test-core    # swift test --filter DictatorCoreTests
make ios-test     # xcodebuild ... -destination 'platform=iOS Simulator,name=iPhone 16' test
```

From the Sheaf root: `make dictator-test` (delegates to `make test`, so it
includes the iOS lane). Use `make swift-test` on machines without simulator
support. Focused suites run with SwiftPM filters, e.g.:

```bash
swift test --filter LaunchpadTests
swift test --filter DictationHTTPServerTests
```

The Swift package tests run hermetically: no live network, Launchpad
hardware, or whisper model is required (engines are faked; WAV fixtures are
generated in-memory). `MigrationExclusionTests` additionally asserts repo
hygiene — no legacy external-repo paths in `src/`/`tests/`, no tracked build
artifacts or secrets in `git ls-files projects/dictator`, and git-ignored
SwiftPM/Xcode output paths.

After running iOS lanes, verify no build artifacts became tracked:

```bash
git status --short projects/dictator
```

## Clean

```bash
make clean        # rm -rf .build .swiftpm .swiftpm-module-cache DerivedData build
```
