## ADDED Requirements

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
