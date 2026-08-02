## Why

The synth application contract declares an audio-input count and can carry host input pointers, but current applications request zero inputs and the browser host deliberately creates an output-only graph. Applications need a portable, realtime-safe way to request any practical channel count and consume either whole input blocks or one cross-channel sample frame without embedding JUCE or Web Audio behavior in application DSP.

## What Changes

- Define arbitrary nonnegative application-requested audio input channel counts, explicit requested-versus-active negotiation, and observable diagnostics when a host or selected device cannot provide the request.
- Add a JUCE-free, non-owning, zero-copy input view over `AudioBlock` with channel-block, sample-frame, and safe missing-channel-as-silence access.
- Keep input and output independent: hosts never monitor or copy input to output unless application DSP explicitly does so.
- Extend the JUCE runtime and headless `SynthRig` paths to honor application input requests, preserve actual channel counts, and support deterministic multichannel test injection.
- Extend the browser runtime's output-only audio graph with permission-gated input capture for applications requesting inputs, routed into the existing native Wasm AudioWorklet callback; applications requesting zero inputs continue without microphone permission.
- Expose browser input-device state, a user-initiated retry action, and clear permission, device, and channel-shortfall diagnostics through the portable Audio page while retaining System-Default-only output behavior.
- Add contract, desktop-host, browser-host, and end-to-end coverage for zero-input, mono, stereo, multichannel, unavailable-channel, denied-permission, and input-to-output processing cases.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-app-runtime`: Strengthen the runtime configuration and `AudioBlock` contract so applications can request arbitrary input counts and consume portable zero-copy block/frame views with defined negotiation and silence behavior.
- `synth-browser-wasm-runtime`: Extend the output-only browser base with user-activated browser capture, device/status reporting, and delivery of input channels into the native AudioWorklet engine pump.
- `synth-runtime-ui`: Extend the Audio page contract with browser input options, permission/active-channel status, and the user-initiated retry action.

## Impact

- Affected code: `projects/synth/include/synth/AppContext.hpp`, application concepts as needed, `projects/synth/runtime/Runtime.hpp`, `projects/synth/tests/support/SynthRig.hpp`, browser runtime/ABI/TypeScript audio activation and device services, portable Audio page state, browser hosting headers, input-capable macOS bundle permission metadata, and synth/browser tests.
- Application API: additive input-view helpers on the existing `AudioBlock`; existing output-only applications remain valid and continue to request zero inputs.
- Browser platform: applications requesting inputs require `getUserMedia()`, microphone permission, a compatible input device, and an appropriate `Permissions-Policy`; output-only launches do not request microphone access.
- Specification sequencing: `synth-browser-wasm-runtime` is established by the archived `2026-08-02-add-browser-wasm-runtime` base, and this change is downstream of that output-only callback contract.
