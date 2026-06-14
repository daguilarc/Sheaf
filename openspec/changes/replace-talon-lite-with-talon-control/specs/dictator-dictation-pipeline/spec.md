## MODIFIED Requirements

### Requirement: dp-1 — HTTP surface: Valid request handling
WHEN it receives `POST /v1/dictate-audio` with a valid WAV body and valid `Content-Type`, `X-Sample-Rate`, `X-Locale`, and `X-Session-Id` headers, THE service SHALL send Talon a sleep command, then run transcription and refinement, and respond 200 with `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}` (see Contracts).

#### Scenario: Valid dictate-audio request
- **WHEN** the service receives `POST /v1/dictate-audio` with a valid WAV body and valid `Content-Type`, `X-Sample-Rate`, `X-Locale`, and `X-Session-Id` headers
- **THEN** the service sends Talon a sleep command, runs transcription then refinement, and responds 200 with `{raw_transcript, revised_text, edit_summary, uncertainty_flags, transcribe_ms, refine_ms}`

## ADDED Requirements

### Requirement: dp-26 — Non-Talon dictation forces Talon asleep
WHEN any non-Talon Dictator dictation starts, THE Dictator service SHALL send a Talon sleep command before recording or processing begins, regardless of Talon's cached, queried, or expected current state.

#### Scenario: HTTP dictation starts
- **WHEN** `POST /v1/dictate-audio` starts processing a valid dictation request
- **THEN** Dictator sends Talon a sleep command before transcription begins

#### Scenario: Launchpad standard dictation starts
- **WHEN** Launchpad standard dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Launchpad auxiliary dictation starts
- **WHEN** Launchpad auxiliary dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Launchpad review dictation starts
- **WHEN** Launchpad voice diff review dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Talon already asleep
- **WHEN** Dictator starts non-Talon dictation and Talon is already asleep
- **THEN** Dictator still sends the Talon sleep command

#### Scenario: Talon bridge unavailable
- **WHEN** Dictator starts non-Talon dictation and the Talon bridge is unavailable
- **THEN** Dictator logs the failed sleep attempt and continues starting the non-Talon dictation
