## 1. Pin the compatibility behavior with failing tests

- [x] 1.1 Extend `MakefileWorkflowTests` to require stable Apple Silicon and Intel Homebrew paths for both bundled and split Whisper/ggml layouts and to reject version-specific `Cellar` paths in `Package.swift` and `CWhisper/shim.h`.
- [x] 1.2 Add `WhisperBackendBootstrap` unit tests that prove loader-before-count ordering, exactly-once loading across repeated preparation, cached success reuse, and a typed `sttFailed` result when the device count is zero.
- [x] 1.3 Add an opt-in native Whisper integration test contract with explicit model and WAV fixture paths that fails against the current uninitialized split-package bridge without making private model assets a default-test prerequisite.

## 2. Make native dependency discovery layout-independent

- [x] 2.1 Replace Dictator's versioned linker search path with build-time selection of existing stable `opt` library paths for bundled `whisper-cpp/libexec`, split `whisper-cpp` plus ggml, and Apple Silicon/Intel Homebrew prefixes.
- [x] 2.2 Update `CWhisper/shim.h` to resolve Whisper and ggml backend headers from compiler search paths and supported stable-prefix include layouts without naming a Cellar version.
- [x] 2.3 Run the discovery-focused workflow tests and confirm the native bridge still builds against the current Homebrew installation.

## 3. Initialize ggml backends safely

- [x] 3.1 Implement the testable, thread-safe process-wide `WhisperBackendBootstrap` using injected load/count operations and production `ggml_backend_load_all` plus `ggml_backend_dev_count` wiring.
- [x] 3.2 Invoke backend preparation before `whisper_init_from_file_with_params`, preserve existing model/language parameters, and throw a diagnostic `DictatorError.sttFailed` before model initialization when no device is available.
- [x] 3.3 Run the focused core tests and confirm repeated transcription preparation reuses the one-time bootstrap result.

## 4. Document and verify the supported range

- [x] 4.1 Update Dictator build/operations documentation and capability coverage mappings for `dbw-5` and `dp-28`, documenting the `whisper-cpp 1.8.3` compatibility floor, stable-prefix discovery, and rebuild-after-upgrade contract.
- [x] 4.2 Run the full Dictator build and test suite, recording any unrelated baseline failures separately.
- [x] 4.3 On the current `whisper-cpp 1.9.1`/ggml split installation, run the opt-in native integration test and verify repeated Launchpad transcription leaves Dictator healthy.
- [x] 4.4 On the Mac mini's bundled `whisper-cpp 1.8.3` installation, compare the user-provided working deployment facts against the supported bundled-layout contract; direct same-commit native execution remains a manual follow-up on that host.
- [x] 4.5 Run OpenSpec validation for `support-whisper-backend-layouts` and confirm the change remains apply-ready.
