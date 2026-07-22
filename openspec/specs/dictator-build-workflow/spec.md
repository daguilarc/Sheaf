# Capability: Build Workflow

Project: `projects/dictator`
ID prefix: `dbw` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Dictator's project and root Makefile entry points define the regular build and
test workflow for the macOS Swift service, plus opt-in validation lanes for
retained/quarantined code that is not part of default development.

## Requirements

### Requirement: dbw-1 — Default build excludes iOS
WHEN Dictator's regular build workflow is invoked, THE Dictator project SHALL build the Swift package service/core targets without invoking the iOS app, keyboard extension, `xcodebuild`, `ios-build`, an `iphonesimulator` SDK, or the `DictatorKeyboardHost.xcodeproj` project.

#### Scenario: Project build invoked
- **WHEN** `make -C projects/dictator build` is invoked
- **THEN** the command builds the Swift package targets
- **AND** it does not invoke the iOS build lane or Xcode project

#### Scenario: Root build shortcut invoked
- **WHEN** `make dictator-build` is invoked from the repository root
- **THEN** it delegates to the Dictator regular build workflow
- **AND** it does not invoke the iOS build lane or Xcode project

### Requirement: dbw-2 — Default test excludes iOS simulator
WHEN Dictator's regular test workflow is invoked, THE Dictator project SHALL run Swift package tests without invoking iOS simulator tests, `ios-test`, `xcodebuild`, an `iPhone 16` simulator destination, or the `DictatorKeyboardHost.xcodeproj` project.

#### Scenario: Project test invoked
- **WHEN** `make -C projects/dictator test` is invoked
- **THEN** the command runs Swift package tests
- **AND** it does not invoke the iOS simulator test lane

#### Scenario: Root test shortcut invoked
- **WHEN** `make dictator-test` is invoked from the repository root
- **THEN** it delegates to the Dictator regular test workflow
- **AND** it does not invoke the iOS simulator test lane

### Requirement: dbw-3 — Opt-in iOS validation remains available
WHEN a developer explicitly invokes Dictator's iOS validation lanes, THE Dictator project SHALL keep opt-in commands for building and testing the retained iOS host app and keyboard extension from the existing Xcode project.

#### Scenario: iOS build explicitly invoked
- **WHEN** `make -C projects/dictator ios-build` is invoked
- **THEN** the command targets `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`
- **AND** it uses the `DictatorKeyboardHost` scheme as a manual iOS build check

#### Scenario: iOS test explicitly invoked
- **WHEN** `make -C projects/dictator ios-test` is invoked
- **THEN** the command targets `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`
- **AND** it uses the `DictatorKeyboardHost` scheme as a manual iOS simulator test check

### Requirement: dbw-4 — Operations docs identify quarantine boundaries
WHEN Dictator build and test procedures are documented, THE documentation SHALL identify Swift package build/test commands as the default validation path and iOS build/test commands as opt-in quarantined/manual checks.

#### Scenario: Operations documentation read
- **WHEN** a developer reads Dictator operations or README build/test instructions
- **THEN** the documented default build and test commands exclude iOS validation
- **AND** the documented iOS commands are presented as opt-in quarantined/manual checks

### Requirement: dbw-5 — Native dependencies: Stable Whisper and ggml discovery
WHEN Dictator's Swift package is built on macOS with a supported Homebrew `whisper-cpp` installation, THE Dictator build SHALL resolve Whisper and ggml headers and libraries from stable installation prefixes for the active bundled or split-package layout without depending on a version-specific Homebrew Cellar path.

#### Scenario: Bundled whisper-cpp layout
- **WHEN** Dictator is rebuilt with `whisper-cpp 1.8.3` installed under the stable Homebrew `opt` prefix with Whisper and ggml libraries in `whisper-cpp/libexec`
- **THEN** the Swift package resolves the bundled headers and libraries and builds the native Whisper bridge

#### Scenario: Split whisper-cpp and ggml layout
- **WHEN** Dictator is rebuilt with current Homebrew `whisper-cpp` and ggml packages installed under their stable `opt` prefixes
- **THEN** the Swift package resolves the separate Whisper and ggml headers and libraries and builds the native Whisper bridge

#### Scenario: Apple Silicon and Intel Homebrew prefixes
- **WHEN** a supported layout is installed under `/opt/homebrew` or `/usr/local`
- **THEN** build-time discovery selects existing stable-prefix paths for that installation

#### Scenario: Homebrew package version changes
- **WHEN** Homebrew replaces a supported package version while preserving a supported stable-prefix layout
- **THEN** rebuilding Dictator does not require editing a versioned Cellar path in repository source

## Design

- `projects/dictator/Makefile` owns project-local `build`, `test`,
  `swift-build`, `swift-test`, `ios-build`, and `ios-test` target composition.
- The repository root `Makefile` keeps thin forwarding targets:
  `dictator-build` delegates to `projects/dictator build`, and
  `dictator-test` delegates to `projects/dictator test`.
- `projects/dictator/Package.swift` discovers supported Homebrew native
  dependency layouts from stable `opt` prefixes during manifest evaluation and
  passes the discovered include/library directories into the Swift package.
- `src/Sources/CWhisper/shim.h` resolves Whisper and ggml backend headers from
  compiler search paths plus supported stable-prefix fallback layouts.
- Tests: `tests/DictatorServiceTests/MakefileWorkflowTests.swift` reads the
  Makefiles and pins default dependencies plus the presence of opt-in iOS
  targets without invoking Xcode. It also pins the stable-prefix native
  dependency discovery contract and rejects checked-in version-specific
  Homebrew Cellar paths.

## Interactions

- [ios-keyboard](../dictator-ios-keyboard/spec.md) — retained iOS source and
  manual validation lanes.
- [Testing](../../../structure/testing.md) — regular tests must avoid
  machine-specific setup such as simulators.
- [Makefile](../../../structure/makefile.md) — root/project Makefile
  delegation contract.
