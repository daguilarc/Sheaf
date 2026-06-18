## Context

Dictator has two recording entry points today: the Launchpad hardware controls and the dashboard test panel. Launchpad recording is implemented in-process with `AVAudioRecorder` and the current spec pins it to the default input. Runtime configuration already has durable JSON storage, safe defaults, reset, web editing, and status reporting, but it has no way to name an audio input or surface whether the named input can actually be used.

The user requirement is fail-closed: blank config means default input, non-blank config means the selected input only, and a missing selected input must remove the visible record controls rather than silently falling back.

## Goals / Non-Goals

**Goals:**

- Add a persisted `audio_input` runtime config field where missing, `null`, or blank means "default system input".
- Resolve non-blank `audio_input` against available macOS audio capture devices and use the first channel of the selected device for Dictator recording.
- Surface audio input availability through status/config APIs so both the dashboard and Launchpad can hide recording affordances when a named device is unavailable.
- Preserve existing default-input behavior for users who do not configure `audio_input`.
- Make unavailable selected inputs deterministic and testable: no fallback, no attempted default recording.

**Non-Goals:**

- No multi-channel selection UI; the first channel of the selected input is always used.
- No automatic fallback to default input when a named input disappears.
- No web browser microphone recording redesign; the existing dashboard WAV upload/test workflow remains separate from Launchpad in-process capture.
- No environment-variable configuration.

## Decisions

1. Store `audio_input` as a nullable string in `RuntimeConfigFile`.

   `nil`, missing, and strings that trim to empty all normalize to default input. A non-empty value is stored trimmed and treated as a strict selector. This matches the existing lenient config style while preserving the user's explicit null/empty semantics. Alternative considered: store a structured object with device id and channel. That adds migration and UI complexity for no current requirement.

2. Resolve devices through a small audio-input resolver used by service status and recording startup.

   The resolver should list available AVFoundation/CoreAudio input devices with stable display names and unique IDs when available. A configured selector should first match exact unique ID or exact name, then only use substring matching if the implementation can prove it is unambiguous; ambiguous matches are unavailable. Alternative considered: fuzzy match like model selection. That is too risky for microphone selection because a wrong input can silently capture the wrong source.

3. Fail closed at record-control boundaries.

   When `audio_input` is default/blank, recording availability follows microphone permission and default-input availability. When `audio_input` is non-blank and cannot resolve, `/api/status` reports recording unavailable, the dashboard hides its record button, Launchpad renders `(0,7)` off, and dictation actions from hidden/unavailable record cells are ignored. Alternative considered: show a disabled red record button/pad. The user explicitly asked for disappearance as the signal.

4. Bind recording to the selected device before capture starts.

   `AudioRecorder` should accept an optional resolved device identity and configure capture with that input before `record()` succeeds. If AVFoundation cannot select or open the resolved input, startup returns a recording setup failure and no default fallback occurs. Alternative considered: keep `AVAudioRecorder` and rely on system default routing only. That cannot satisfy non-default selection.

5. Expose selectable audio inputs as config options.

   `GET /api/config/options?name=audio_input` should include an empty/default option plus currently available input display values. The field remains editable as a string so users can paste a device name or ID even when it is temporarily disconnected. Alternative considered: reject unavailable values at PATCH time. That would prevent saving a preferred device before connecting it and would make disappearance harder to represent.

## Risks / Trade-offs

- [macOS audio device APIs differ between AVFoundation and CoreAudio] -> Keep device discovery behind one resolver abstraction and cover selector matching with unit tests; do a manual Launchpad capture check during implementation.
- [Display names may not be unique] -> Prefer unique IDs where available and treat ambiguous names/substrings as unavailable rather than guessing.
- [Hiding controls can make the UI feel broken without explanation] -> Status should include `audio_input_available`, `audio_input_effective`, and an unavailable reason so nearby status text can explain the missing control without making the control itself visible.
- [Existing configs lack the field] -> Decode leniency treats missing as default input, and bootstrap/reset writes the field only after the change is applied.
