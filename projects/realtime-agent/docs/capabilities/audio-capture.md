# Capability: Audio Capture

ID prefix: `aud`

## Purpose

Both consumers stream microphone audio into sessions as base64 PCM frames.
This capability owns device listing and selection, the two capture backends
(PortAudio via `naudiodon`, and a sox `rec` subprocess used on macOS for the
default device), and the frame format.

## Requirements

- **[aud-1]** THE library SHALL produce audio frames of 100 ms of 16-bit
  little-endian signed mono PCM at 24 000 Hz (`REALTIME_PCM_SAMPLE_RATE`),
  i.e. 4 800 bytes per frame, delivered base64-encoded to `onFrame`;
  partial trailing bytes SHALL be buffered until a full frame accumulates.
- **[aud-2]** WHEN `CreateMicrophoneCapture({inputDevice?, onFrame, onError})`
  is called on macOS (`darwin`) with no `inputDevice` (or a blank one), THE
  library SHALL use the sox backend (aud-5); in every other case it SHALL
  use the PortAudio backend with the resolved device id.
- **[aud-3]** THE library SHALL resolve `inputDevice` against PortAudio
  input devices (`maxInputChannels > 0`): blank/undefined → device id `-1`
  (PortAudio default); an integer-parsable value → the device with that
  exact id; otherwise a case-insensitive substring match on device names
  that must be unique. Resolution failures throw the errors in the
  catalogue.
- **[aud-4]** THE device list (`ListInputDevices`) SHALL contain
  `{id, name, hostAPIName, defaultSampleRate}` per input device, and
  `FormatInputDeviceList` SHALL render one tab-separated line per device —
  `<id>\t<name>\t<hostAPIName>\t<defaultSampleRate>` — or exactly
  `No input devices found.` when empty.
- **[aud-5]** THE sox backend SHALL spawn
  `rec -q -t raw -b 16 -e signed-integer -L - channels 1 rate 24000`,
  resolving the binary from the `REALTIME_AGENT_REC_PATH` environment
  variable when set and non-blank, else `/opt/homebrew/bin/rec` when that
  file exists, else `rec` on `PATH`.
- **[aud-6]** IF the sox process writes a non-empty stderr chunk not
  containing ` WARN `, THEN THE capture SHALL call
  `onError(Error("microphone recorder error: <message>"))`; IF the process
  exits before `stop()`, THEN it SHALL call
  `onError(Error("microphone recorder exited unexpectedly: code=<code|null> signal=<signal|null>"))`.
- **[aud-7]** IF opening the PortAudio stream throws, THEN
  `CreateMicrophoneCapture` SHALL throw
  `Error("Failed to open microphone input: <message>")`; stream errors after
  start SHALL go to `onError`.
- **[aud-8]** THE returned `MicrophoneCapture` SHALL expose `start()` and
  `stop()`; `stop()` SHALL be idempotent, halt frame delivery, and (sox)
  SIGTERM the subprocess without reporting its exit as an error, or
  (PortAudio) abort the stream.

## Contracts

### Public API

`realtime-agent-lib` exports `CreateMicrophoneCapture`,
`CreateSoxMicrophoneCapture`, `REALTIME_PCM_SAMPLE_RATE`, and the types
`MicrophoneCapture` (`{start(): void; stop(): void}`) and
`MicrophoneCaptureOptions` (`{inputDevice?, onFrame(pcmBase64), onError(error)}`).
`ListInputDevices`, `FormatInputDeviceList`, `ResolveInputDeviceId`, and
`CreateFakeMicrophoneCapture` (deterministic frame playback for tests) are
package-internal, consumed by [cli](cli.md).

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

- [cli](cli.md) — `--input-device`, `--list-input-devices`, frame
  forwarding into `sendAudioFrame`.
- [vscode-extension](vscode-extension.md) — same capture API driven by the
  `sheaf.realtime.inputDevice` setting.
- [session-lifecycle](session-lifecycle.md) — frames become
  `input_audio_buffer.append` events.
