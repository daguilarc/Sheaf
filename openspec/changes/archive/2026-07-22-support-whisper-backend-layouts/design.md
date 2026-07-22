## Context

Dictator links whisper.cpp through the `CWhisper` Swift system-library target. Its current header and linker search order names the `whisper-cpp 1.8.3` Cellar directory directly. That Homebrew release packages Whisper and ggml together under `whisper-cpp/libexec`; current Homebrew packages `whisper-cpp` and ggml separately, places ggml backends in loadable modules under the ggml installation, and requires embedding applications to call `ggml_backend_load_all()`.

The unchanged bridge can compile against current libraries because broad Homebrew library symlinks satisfy its fallback linker paths, but it never loads the dynamic backends. The first model initialization consequently observes zero devices and aborts in native ggml code. The same model and bridge work on the Mac mini's bundled `whisper-cpp 1.8.3` installation. Rebuilding after native dependency changes is acceptable; preserving ABI compatibility for an already-built binary across Homebrew upgrades is not required.

## Goals / Non-Goals

**Goals:**

- Build one Dictator source tree against supported Homebrew `whisper-cpp` installations from 1.8.3 through the current split-package layout.
- Discover native headers and libraries through stable Homebrew prefixes on Apple Silicon and Intel macOS without repository edits for package-version changes.
- Load ggml backends before the first Whisper context, exactly once per process.
- Convert the zero-device condition into a recoverable Dictator transcription error before native model initialization.
- Preserve the existing STT model, language, and backend-selection behavior.

**Non-Goals:**

- Keep an already-compiled Dictator binary ABI-compatible across Homebrew upgrades.
- Support arbitrary pre-1.8.3 whisper.cpp installations or unversioned custom filesystem layouts.
- Add a new STT model, choose a backend manually, or change runtime configuration.
- Vendor whisper.cpp or ggml into the repository.

## Decisions

### Discover supported layouts at build time through stable prefixes

`Package.swift` will derive linker search paths from existing directories beneath `/opt/homebrew/opt` and `/usr/local/opt`. Candidate paths cover the bundled `whisper-cpp/libexec/lib` layout, the split `whisper-cpp/lib` and `ggml/lib` layout, and standard library locations. The C shim will use `__has_include` over corresponding stable include locations, preferring compiler-provided headers and active `opt` symlinks. Versioned `Cellar/<formula>/<version>` paths will be removed.

This keeps rebuilds deterministic without adding `pkgconf` as a developer prerequisite. Stable `opt` symlinks identify Homebrew's active package version, while filtering candidates to paths that exist avoids misleading linker search entries. If both supported layouts exist, the active `whisper-cpp` `opt` tree supplies Whisper and its matching bundled path takes precedence over the separate ggml fallback.

Alternatives considered:

- `pkg-config` would consume package metadata directly, but it adds a tool and environment-path prerequisite that is not installed on every working Dictator host.
- Runtime `dlopen` path probing would weaken link-time validation and duplicate ggml's own backend loader despite rebuilds being acceptable.

### Use the ggml backend loader as the compatibility operation

The C bridge will expose the ggml backend declarations required by Swift. A process-wide bootstrap will invoke `ggml_backend_load_all()` before the first call to `whisper_init_from_file_with_params`. The API is present in the supported 1.8.3 headers and is the required embedding sequence for the current Homebrew package. On bundled or statically registered installations, the operation preserves existing devices; on split installations, ggml discovers its packaged backend modules.

The bootstrap result will be initialized lazily with Swift's thread-safe one-time initialization. Transcription will require the cached device count to be greater than zero before entering Whisper model initialization. Backend choice remains with Whisper: available GPU acceleration may be used, with CPU available through the loaded CPU backend.

Alternatives considered:

- Setting `use_gpu = false` is insufficient because current ggml also packages its CPU backend as a loadable module.
- Detecting a package version and calling the loader conditionally creates unnecessary version coupling; calling the compatibility operation for every supported layout is simpler.

### Separate testable bootstrap policy from native calls

The bootstrap policy will accept loader and device-count operations so unit tests can prove call ordering, once-only caching, successful reuse, and zero-device errors without invoking native libraries. Production wiring will supply `ggml_backend_load_all` and `ggml_backend_dev_count` through `CWhisper`.

Build-workflow tests will read `Package.swift` and the C shim to require stable bundled/split prefixes and reject version-specific Cellar paths. An opt-in native integration test will exercise backend discovery and real transcription using the installed Homebrew libraries and an explicitly supplied model/audio fixture, so the default test suite remains usable on hosts without private model assets. Release verification will run that integration test once on current Homebrew and once on the Mac mini's 1.8.3 layout.

### Fail before unsafe native initialization

If backend loading produces zero devices, the bridge will throw `DictatorError.sttFailed` with a diagnostic that identifies missing ggml backend devices. This happens before model initialization, allowing the existing dictation-pipeline failure handling to report and record the error while leaving the service alive. Model-loading and inference errors continue through their existing `sttFailed` paths.

## Risks / Trade-offs

- [A future Homebrew release removes or incompatibly changes the loader API] → The rebuild fails at compile/link time, making the unsupported transition explicit instead of producing a runtime abort.
- [Multiple Homebrew installations make path selection ambiguous] → Restrict discovery to active stable `opt` prefixes with a documented bundled-before-split precedence and test the resolved paths.
- [A backend plugin exists but cannot initialize on the host] → Treat zero registered devices as a recoverable transcription error and retain ggml's native diagnostics in service stderr.
- [Default CI lacks Homebrew native libraries or model assets] → Keep policy and discovery checks in the default suite and make real-model native verification opt-in with explicit fixture paths.
- [The supported range grows indefinitely] → Define the compatibility floor as `whisper-cpp 1.8.3`; require a deliberate design update when upstream removes the shared loader/device API.

## Migration Plan

1. Implement discovery and bootstrap changes and run default Dictator tests.
2. Rebuild and run the opt-in native transcription verification on the current `whisper-cpp 1.9.1`/ggml installation.
3. Confirm the service remains healthy after repeated Launchpad transcription.
4. Build the same commit on the Mac mini's `whisper-cpp 1.8.3` installation and run the native verification there.
5. Leave the Mac mini packages pinned until the compatible code is deployed; future package upgrades are followed by a Dictator rebuild.

Rollback is a source rollback plus rebuild. The Mac mini's existing 1.8.3 deployment remains a known-good operational fallback during rollout.

## Open Questions

None.
