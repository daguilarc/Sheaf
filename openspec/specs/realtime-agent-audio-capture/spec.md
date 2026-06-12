# Capability: Audio Capture

Project: `projects/realtime-agent`
ID prefix: `aud` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Both consumers stream microphone audio into sessions as base64 PCM frames.
This capability owns device listing and selection, the two capture backends
(PortAudio via `naudiodon`, and a sox `rec` subprocess used on macOS for the
default device), and the frame format.

## Requirements

### Requirement: aud-1 — Frame format and buffering

THE library SHALL produce audio frames of 100 ms of 16-bit little-endian signed mono PCM at 24 000 Hz (`REALTIME_PCM_SAMPLE_RATE`), i.e. 4 800 bytes per frame, delivered base64-encoded to `onFrame`; partial trailing bytes SHALL be buffered until a full frame accumulates.

#### Scenario: Audio frame produced

- **WHEN** the library captures audio from a microphone
- **THEN** frames of 4 800 bytes (100 ms of 16-bit little-endian signed mono PCM at 24 000 Hz) are delivered base64-encoded to `onFrame`, and partial trailing bytes are buffered until a full frame accumulates

### Requirement: aud-2 — Backend selection

WHEN `CreateMicrophoneCapture({inputDevice?, onFrame, onError})` is called on macOS (`darwin`) with no `inputDevice` (or a blank one), THE library SHALL use the sox backend (aud-5); in every other case it SHALL use the PortAudio backend with the resolved device id.

#### Scenario: macOS with no inputDevice

- **WHEN** `CreateMicrophoneCapture` is called on macOS (`darwin`) with no `inputDevice` or a blank one
- **THEN** the library uses the sox backend (aud-5)

#### Scenario: Non-macOS or explicit inputDevice

- **WHEN** `CreateMicrophoneCapture` is called on a non-macOS platform, or on macOS with an explicit non-blank `inputDevice`
- **THEN** the library uses the PortAudio backend with the resolved device id

### Requirement: aud-3 — Device resolution

THE library SHALL resolve `inputDevice` against PortAudio input devices (`maxInputChannels > 0`): blank/undefined → device id `-1` (PortAudio default); an integer-parsable value → the device with that exact id; otherwise a case-insensitive substring match on device names that must be unique. Resolution failures throw the errors in the catalogue.

#### Scenario: Blank or undefined inputDevice

- **WHEN** `inputDevice` is blank or undefined
- **THEN** the resolved device id is `-1` (PortAudio default)

#### Scenario: Integer-parsable inputDevice

- **WHEN** `inputDevice` is an integer-parsable value
- **THEN** the device with that exact id is used

#### Scenario: Name substring match

- **WHEN** `inputDevice` is a non-integer string
- **THEN** a case-insensitive substring match is performed on device names, which must be unique; resolution failures throw the errors in the catalogue

### Requirement: aud-4 — Device list and formatting

THE device list (`ListInputDevices`) SHALL contain `{id, name, hostAPIName, defaultSampleRate}` per input device, and `FormatInputDeviceList` SHALL render one tab-separated line per device — `<id>\t<name>\t<hostAPIName>\t<defaultSampleRate>` — or exactly `No input devices found.` when empty.

#### Scenario: Devices present

- **WHEN** `ListInputDevices` is called and input devices exist
- **THEN** each device entry contains `{id, name, hostAPIName, defaultSampleRate}` and `FormatInputDeviceList` renders one tab-separated line per device in the format `<id>\t<name>\t<hostAPIName>\t<defaultSampleRate>`

#### Scenario: No devices present

- **WHEN** `ListInputDevices` is called and no input devices exist
- **THEN** `FormatInputDeviceList` returns exactly `No input devices found.`

### Requirement: aud-5 — Sox backend command

THE sox backend SHALL spawn `rec -q -t raw -b 16 -e signed-integer -L - channels 1 rate 24000`, resolving the binary from the `REALTIME_AGENT_REC_PATH` environment variable when set and non-blank, else `/opt/homebrew/bin/rec` when that file exists, else `rec` on `PATH`.

#### Scenario: REALTIME_AGENT_REC_PATH set

- **WHEN** the sox backend is used and `REALTIME_AGENT_REC_PATH` is set and non-blank
- **THEN** the binary is resolved from that environment variable

#### Scenario: REALTIME_AGENT_REC_PATH unset, homebrew path exists

- **WHEN** the sox backend is used and `REALTIME_AGENT_REC_PATH` is not set or blank, and `/opt/homebrew/bin/rec` exists
- **THEN** `/opt/homebrew/bin/rec` is used

#### Scenario: Fallback to PATH

- **WHEN** the sox backend is used and neither `REALTIME_AGENT_REC_PATH` nor `/opt/homebrew/bin/rec` is available
- **THEN** `rec` is resolved from `PATH`

### Requirement: aud-6 — Sox error and unexpected exit handling

IF the sox process writes a non-empty stderr chunk not containing ` WARN `, THEN THE capture SHALL call `onError(Error("microphone recorder error: <message>"))`; IF the process exits before `stop()`, THEN it SHALL call `onError(Error("microphone recorder exited unexpectedly: code=<code|null> signal=<signal|null>"))`.

#### Scenario: Sox stderr non-WARN chunk

- **WHEN** the sox process writes a non-empty stderr chunk not containing ` WARN `
- **THEN** the capture calls `onError(Error("microphone recorder error: <message>"))`

#### Scenario: Sox unexpected exit

- **WHEN** the sox process exits before `stop()` is called
- **THEN** the capture calls `onError(Error("microphone recorder exited unexpectedly: code=<code|null> signal=<signal|null>"))`

### Requirement: aud-7 — PortAudio stream open failure and stream errors

IF opening the PortAudio stream throws, THEN `CreateMicrophoneCapture` SHALL throw `Error("Failed to open microphone input: <message>")`; stream errors after start SHALL go to `onError`.

#### Scenario: PortAudio stream open failure

- **WHEN** opening the PortAudio stream throws
- **THEN** `CreateMicrophoneCapture` throws `Error("Failed to open microphone input: <message>")`

#### Scenario: PortAudio stream error after start

- **WHEN** a stream error occurs after the PortAudio stream has started
- **THEN** the error is delivered to `onError`

### Requirement: aud-8 — MicrophoneCapture start/stop interface

THE returned `MicrophoneCapture` SHALL expose `start()` and `stop()`; `stop()` SHALL be idempotent, halt frame delivery, and (sox) SIGTERM the subprocess without reporting its exit as an error, or (PortAudio) abort the stream.

#### Scenario: start and stop exposed

- **WHEN** `CreateMicrophoneCapture` returns a `MicrophoneCapture`
- **THEN** it exposes both `start()` and `stop()`

#### Scenario: stop is idempotent and halts frames

- **WHEN** `stop()` is called (including multiple times)
- **THEN** frame delivery is halted and subsequent calls are no-ops

#### Scenario: stop on sox backend

- **WHEN** `stop()` is called on a sox-backed capture
- **THEN** the subprocess receives SIGTERM and its exit is not reported as an error

#### Scenario: stop on PortAudio backend

- **WHEN** `stop()` is called on a PortAudio-backed capture
- **THEN** the stream is aborted

## Contracts

### Public API

`realtime-agent-lib` exports `CreateMicrophoneCapture`,
`CreateSoxMicrophoneCapture`, `REALTIME_PCM_SAMPLE_RATE`, and the types
`MicrophoneCapture` (`{start(): void; stop(): void}`) and
`MicrophoneCaptureOptions` (`{inputDevice?, onFrame(pcmBase64), onError(error)}`).
`ListInputDevices`, `FormatInputDeviceList`, `ResolveInputDeviceId`, and
`CreateFakeMicrophoneCapture` (deterministic frame playback for tests) are
package-internal, consumed by [cli](../realtime-agent-cli/spec.md).

### Error catalogue

| Condition | Behavior | Message (exact) |
|---|---|---|
| No input devices at all | throw | `No microphone input devices are available.` |
| Numeric id not found | throw | `No input device found with id <n>.` |
| Name substring matches nothing | throw | `No input device matched "<value>".` |
| Name substring ambiguous | throw | `Input device "<value>" matched multiple devices; use --list-input-devices and pass an id.` |
| PortAudio stream open failure | throw | `Failed to open microphone input: <message>` |
| sox stderr (non-WARN) | `onError` | `microphone recorder error: <message>` |
| sox unexpected exit | `onError` | `microphone recorder exited unexpectedly: code=<c> signal=<s>` |

## Design

- `src/agent/src/audio_input.ts` — `PcmFrameProcessor` (frame chunking),
  `ResolveInputDeviceId` / `ResolveRequestedInputDeviceId`,
  `CreateSoxMicrophoneCapture`, `CreateMicrophoneCapture`,
  `ResampleInt16Mono` (linear-interpolation helper, currently unused by the
  capture paths). `naudiodon` is loaded lazily via `createRequire` so the
  module imports cleanly where PortAudio is unavailable.
- PortAudio stream options: `sampleFormat 16`, `channelCount 1`,
  `framesPerBuffer 2400` (100 ms at 24 kHz).
- The darwin default-device sox path exists because PortAudio device
  selection is unreliable for the macOS default input; explicitly selecting
  a device forces the PortAudio path even on macOS.
- Tests: `tests/agent/audio/audio_input.test.ts`.

## Interactions

- [cli](../realtime-agent-cli/spec.md) — `--input-device`, `--list-input-devices`, frame
  forwarding into `sendAudioFrame`.
- [vscode-extension](../realtime-agent-vscode-extension/spec.md) — same capture API driven by the
  `sheaf.realtime.inputDevice` setting.
- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — frames become
  `input_audio_buffer.append` events.
