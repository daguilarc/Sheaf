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

These cover configuration loading, service registration, dictation HTTP behavior, web UI APIs, and pipeline logic under `tests/`.

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

Runs Swift package tests and iOS tests when the local environment supports them.

## Generated output checks

After `make ios-build` or `make ios-test`, verify no Xcode artifacts are tracked:

```bash
git status --short projects/dictator
git check-ignore projects/dictator/.build/xcode
```

Build products must remain under git-ignored paths such as `.build/xcode/`.
