## Why

Audio-rate parameter modulation currently reaches the encoder UI as the instantaneous knob value, which aliases visually when modulators move faster than the paint rate. The audio path also hides two meanings behind `Get`: raw instantaneous normalized evaluation and the value consumed by mapped DSP helpers.

## What Changes

- Rename `Parameter::Get(voiceIx)` to `Parameter::GetRaw(voiceIx)` for the instantaneous normalized expression, used by recursive modulation-depth computation and direct raw inspection.
- Cache each voice's current normalized knob value during per-sample `ProcessLite`, after coefficient slewing and using the current modulator table.
- Change normalized mapping helpers to read the cached per-sample knob value, preserving the expected one-sample modular-simulator modulation model.
- Align the audio-read formula with the existing normalization-offset requirements from `spm-9`.
- Add per-voice UI smoothing state: a low-frequency EMA center and an EMA residual-energy spread value derived from the cached knob value.
- Publish smoothed UI center and spread through `Parameter::UIState` so encoder components can render stable centers plus modulation blur clouds instead of aliased instantaneous positions.
- Add group-owned smoothing configuration for UI center and spread, defaulting to a cutoff suitable for visual display.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: audio-rate parameter reads, mapping helpers, `ProcessLite`, and parameter UI-state publication gain explicit cached knob and UI smoothing semantics.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, synth parameter tests, and encoder UI consumers in `projects/synth/juce/EncoderComponent.hpp`.
- API impact: `Parameter::Get` is renamed to `Parameter::GetRaw`; a cached knob read path is added for mapping helpers; `Parameter::UIState` gains per-voice smoothed center and spread fields.
- Runtime behavior: mapped DSP reads use the value sampled by the most recent per-sample `ProcessLite`; this formalizes a one-sample modulation delay when modulators are updated after module processing.
- Dependencies: no new third-party dependencies.
