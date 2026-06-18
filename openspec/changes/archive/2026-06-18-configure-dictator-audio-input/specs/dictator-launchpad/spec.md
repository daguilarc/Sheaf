## MODIFIED Requirements

### Requirement: lp-7 — Dictation pads: Recording start
WHEN recording starts, THE controller SHALL capture 16 kHz mono 16-bit PCM WAV from the resolved Dictator audio input and snapshot dictation context: frontmost app/site context plus the current selection captured via a synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard restored). The resolved Dictator audio input is the system default input when `audio_input` in runtime config is missing, null, or blank after trimming; otherwise it is the configured input's first channel, with no fallback to the default input if the configured input is unavailable.

#### Scenario: Recording starts with default audio input
- **WHEN** recording starts and `audio_input` is missing, null, or blank after trimming
- **THEN** the controller captures 16 kHz mono 16-bit PCM WAV from the system default input and snapshots the frontmost app/site context plus the current selection via synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard restored)

#### Scenario: Recording starts with configured audio input
- **WHEN** recording starts and `audio_input` resolves to an available input device
- **THEN** the controller captures 16 kHz mono 16-bit PCM WAV from that device's first input channel and snapshots the frontmost app/site context plus the current selection via synthetic Cmd+C (≤ 12 000 chars, 0.25 s pasteboard wait, prior clipboard restored)

#### Scenario: Configured audio input unavailable
- **WHEN** recording would start and `audio_input` is non-blank but does not resolve to an available input device
- **THEN** the controller does not start recording and does not fall back to the system default input

## ADDED Requirements

### Requirement: lp-26 — Dictation pads: Record control availability
WHERE `audio_input` in runtime config is non-blank and unavailable, THE Launchpad controller SHALL render the record-status cell `(0,7)` as off/unlit and SHALL ignore dictation actions for that unavailable record control.

#### Scenario: Selected audio input unavailable at render time
- **WHEN** `audio_input` is non-blank and unavailable
- **THEN** the Launchpad controller renders `(0,7)` off/unlit instead of rendering the record-status color

#### Scenario: Selected audio input unavailable when record pad is pressed
- **WHEN** the user presses `(0,7)` while `audio_input` is non-blank and unavailable
- **THEN** the Launchpad controller ignores the dictation action and does not start recording

#### Scenario: Selected audio input becomes available
- **WHEN** `audio_input` is non-blank and later resolves to an available input device
- **THEN** the Launchpad controller resumes rendering `(0,7)` with the normal record-status color for the current dictation state
