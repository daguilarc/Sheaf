## ADDED Requirements

### Requirement: dp-28 — Pipeline behavior: Whisper backend initialization
WHEN native Whisper transcription first prepares to create a Whisper context, THE service SHALL load discoverable ggml backends once for the process, verify that at least one backend device is available before model initialization, and preserve the configured `stt_model_path` and `stt_language` behavior.

#### Scenario: Dynamic backend plugins are installed
- **WHEN** transcription first runs against a ggml installation whose CPU, Metal, or accelerator backends are dynamic plugins
- **THEN** the service loads the discoverable plugins before creating the Whisper context and transcribes with an available backend device

#### Scenario: Backends are bundled or already registered
- **WHEN** transcription first runs against a supported layout whose backends are bundled or already registered
- **THEN** backend initialization preserves the registered devices and transcription continues normally

#### Scenario: Repeated transcription
- **WHEN** more than one transcription runs in the same Dictator process
- **THEN** process-wide backend loading executes only once while every transcription verifies the cached initialization result before creating its Whisper context

#### Scenario: No backend device is available
- **WHEN** backend loading completes without registering any backend device
- **THEN** transcription fails with a `DictatorError.sttFailed` diagnostic before Whisper model initialization and the Dictator service remains running

#### Scenario: Existing model configuration is used
- **WHEN** backend initialization succeeds
- **THEN** the service initializes Whisper with the resolved `stt_model_path` and `stt_language` exactly as configured
