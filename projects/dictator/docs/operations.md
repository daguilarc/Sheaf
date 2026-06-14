# Operations

Normative build/run/test procedures for dictator, from a fresh Sheaf
checkout. Repo-wide lane rules: [Testing](../../../structure/testing.md),
[Makefile](../../../structure/makefile.md),
[Services](../../../structure/services.md).

## Prerequisites

- macOS 13+ with a Swift 5.10 toolchain.
- Optional, quarantined iOS checks: Xcode with an available iOS Simulator.
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
- Optional full-Talon Launchpad control needs Talon installed. Dictator talks
  to Talon through the Sheaf-owned bridge installed below; normal dictation
  still works when Talon or the bridge is unavailable.

## Build

From `projects/dictator/`:

```bash
make build        # = swift-build (service + core only; no Xcode needed)
make swift-build  # swift build (service + core only; no Xcode needed)
```

From the Sheaf root: `make dictator-build` (delegates to `make -C
projects/dictator build`). Build output stays in git-ignored `.build/`
(SwiftPM).

The retained iOS keyboard app and extension are quarantined. They are not part
of default build validation, but can be checked manually:

```bash
make ios-build    # xcodebuild -project src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj \
                  #   -scheme DictatorKeyboardHost -sdk iphonesimulator \
                  #   -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO build
```

Manual iOS build output stays in git-ignored `.build/xcode/` (DerivedData).

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

## Talon Bridge

The Launchpad Talon pad controls the full Talon app through a Talon user
script kept in this repository at `src/talon/sheaf_control`. Install it as a
symlink into Talon's user directory:

```bash
make dictator-install-talon-bridge
```

The project-local form is equivalent:

```bash
make -C projects/dictator install-talon-bridge
```

The target creates `~/.talon/user/sheaf_control -> <repo>/projects/dictator/src/talon/sheaf_control`.
It is idempotent for the correct symlink and refuses to replace an existing
different symlink or directory. After installing, reload Talon scripts or
restart Talon so the bridge starts.

Manual bridge probes:

```bash
curl http://127.0.0.1:28579/status
curl -X POST http://127.0.0.1:28579/sleep
curl -X POST http://127.0.0.1:28579/wake
```

Dictator sends `POST /sleep` before every non-Talon dictation start. A bridge
failure is logged and does not block normal Dictator dictation.

## Hunk Review Controls

Dictator exposes a local REST-compatible control protocol for focused hunk
review providers such as Sheaf Chat Agent Review Mode:

- `POST /api/hunk-review/state`
- `POST /api/hunk-review/disconnect`
- `GET /api/hunk-review/command?provider_id=<id>`
- `POST /api/hunk-review/command-result`
- `GET /api/hunk-review/diagnostics`

Each provider reports a generated provider id, focus state, review-surface
visibility, current file/hunk metadata, and action availability. Dictator uses
the most recent healthy focused provider as the active target. If no healthy
focused provider has actionable hunks, the Launchpad hunk LEDs stay off and
button presses in the hunk-control region do not send keyboard fallback
commands.

Launchpad hunk mapping:

| Coordinate | Action |
| --- | --- |
| `(0,2)` | Revert current hunk |
| `(1,2)` | Previous hunk |
| `(2,2)` | Stage current hunk |
| `(3,2)` | Undo last stage/revert |
| `(0,3)` | Previous changed file |
| `(1,3)` | Next hunk |
| `(2,3)` | Next changed file |
| `(3,3)` | Unused/off |

## Test

From `projects/dictator/`:

```bash
make test         # = swift-test (service + core tests only; no iOS simulator needed)
make swift-test   # swift test — all DictatorCoreTests + DictatorServiceTests
make test-core    # swift test --filter DictatorCoreTests
```

From the Sheaf root: `make dictator-test` (delegates to `make test`, which
excludes the quarantined iOS lane). Focused suites run with SwiftPM filters,
e.g.:

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

The retained iOS tests are quarantined manual checks:

```bash
make ios-test     # xcodebuild ... -destination 'platform=iOS Simulator,name=iPhone 16' test
```

After running manual iOS lanes, verify no build artifacts became tracked:

```bash
git status --short projects/dictator
```

## Clean

```bash
make clean        # rm -rf .build .swiftpm .swiftpm-module-cache DerivedData build
```
