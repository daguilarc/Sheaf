## Why

Modulation-depth knobs currently feed recursive modulation as linear signed normalized values, so most useful subtle depth control is crowded near the center of a bipolar knob. The parameter system already has the desired signed zero-based exponential mapping, and depth targeting should use that curve while preserving the existing linear audio-rate dot product once the depth target is established.

## What Changes

- Map modulation-depth parameter knob values through the bipolar zero-based exponential curve when `Parameter::Compute()` derives per-voice `targetDepths`.
- Use a maximum absolute depth of the full knob (`1.0`) and a halfpoint absolute depth of one-eighth knob travel (`0.125`) so a half-turned depth control produces `0.125` signed depth and a fully turned control produces `1.0`.
- Compute the zero-based exponential base from that halfpoint once as a constant, rather than deriving it from midpoint/max on every depth read.
- Preserve existing depth normalization, center-scale, normalization-offset, min/max, smoothing, and audio-rate read semantics after raw depth targets have been curved.
- Preserve the existing `GetRaw()`/modulator dot-product behavior: the modulation source still linearly dots with the effective depth value.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: recursive modulation-depth target computation changes from directly using the depth parameter's signed raw normalized value to using the bipolar zero-based exponential mapping of that knob value.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, and `projects/synth/tests/parameter_modulation_tests.cpp`.
- API impact: no public API removal is expected. A small internal or public helper may be added if needed to expose the constant-base depth mapping cleanly to tests.
- Runtime behavior: existing patches retain the same stored knob positions, but non-center modulation-depth values produce smaller effective depths near center and the same full-scale depths at knob extremes.
- Dependencies: no new third-party dependencies.
