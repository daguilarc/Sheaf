# Dictator Testing

## Swift package tests

From `projects/dictator/`:

```bash
make swift-test
# or
swift test
```

Core-only tests:

```bash
make test-core
```

These cover configuration loading, API key loading, service registration, health and exit endpoints, dictation HTTP behavior, web UI APIs, pipeline logic, and migration exclusion checks under `tests/`.

From the Sheaf root:

```bash
make dictator-test
```

`make dictator-test` delegates to the project `test` target, so it includes iOS testing as well as Swift package tests.

## iOS keyboard tests

iOS unit and UI tests live under `tests/ios-keyboard/` and are referenced by the Xcode project at `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`.

From `projects/dictator/`:

```bash
make ios-build
make ios-test
```

`ios-test` requires Xcode and an available iOS Simulator destination (currently configured for `iPhone 16`).

### iOS unit test coverage

Focused tests under `DictatorKeyboardHostTests` cover:

- default server URL on port `9003`
- configured server URL overrides
- dictation upload targeting `/v1/dictate-audio`
- required request headers
- migrated dictation response decoding
- keyboard session launch, stale reconciliation, and failure paths
- transcript insertion tracking
- Darwin notification callback delivery
- local diagnostics log persistence (no remote Conductor trace posting)

## Full project test target

```bash
make test
```

Runs Swift package tests and then `ios-test`. This target requires Xcode and the configured simulator destination. Use `make swift-test` for service/core-only validation on machines without iOS simulator support.

## HTTP and web smoke tests

`DictationHTTPServerTests` exercises `GET /health`, `POST /exit`, and `POST /v1/dictate-audio` including validation and success/failure paths. It also verifies `/v1/transcribe` and `/v1/refine` return `404`.

`WebAPITests` covers static shell delivery, status/config/prompt/interaction/model/API-key endpoints, and confirms the web UI does not reference retired AppKit controls.

## Static exclusion checks

`MigrationExclusionTests` validates:

- no legacy external-repo, app-local config, or Conductor trace patterns in `src/` or `tests/`
- no tracked generated build artifacts, secrets files, or excluded external trees in `git ls-files projects/dictator`
- git-ignored SwiftPM and Xcode output paths

Manual static checks from the repository root:

```bash
rg "/Users/joyo/dictator|apps/dictator-main|apps/realtime-agent|apps/vscode-extension|Config/runtime-config|Config/secrets|/tmp/dictator-trace|8787|192\.168\.1\.56|ProcessInfo\.processInfo\.environment" \
  projects/dictator/src projects/dictator/tests

git ls-files projects/dictator | rg "(/\.build/|/build/|/node_modules/|/dist/|crash\.log$|secrets\.json$|\.secrets\.json$|\.env$|\.swiftpm-module-cache|\.xctest/|\.swiftmodule$|\.appex/|\.app/)"

git check-ignore projects/dictator/.build/debug projects/dictator/.build/xcode projects/dictator/.swiftpm-module-cache/cache
```

After `make ios-build` or `make ios-test`, verify no Xcode artifacts are tracked:

```bash
git status --short projects/dictator
```

Build products must remain under git-ignored paths such as `.build/xcode/`.
