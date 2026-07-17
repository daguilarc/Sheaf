## Why

Seven-bit MIDI has no exact numeric midpoint: `64 / 127` is slightly greater than `0.5`, so an absolute encoder's physical center does not select the parameter midpoint. A subtle, reversible power curve should make MIDI byte `64` map exactly to normalized parameter value `0.5` without changing endpoint behavior or debounce semantics.

## What Changes

- Keep `ParamSetAbsolute` as a parameter-space float in `[0, 1]`, independent of the raw MIDI velocity byte.
- Convert absolute encoder input byte `B` to `(B / 127)^a`, where `a = log(0.5) / log(64 / 127) ≈ 1.011444814893185`.
- Convert normalized absolute knob position `x` back through the inverse curve `x^(1/a)` before quantizing it to a 7-bit MIDI byte.
- Continue causal acknowledgement and debounce comparisons in the final raw 7-bit MIDI domain.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Change absolute encoder input and output conversion so MIDI byte `64` corresponds exactly to normalized parameter midpoint `0.5` while preserving 7-bit acknowledgement and debounce.

## Impact

- Affects the synth `MessageIn` absolute-value contract and absolute branches of the MIDI encoder input/output processors.
- Requires focused unit coverage for endpoints, midpoint, round-trip conversion, and unchanged 7-bit debounce/acknowledgement behavior.
- Adds no dependency, profile-format, relative-encoder, analog-input, or core parameter-state changes.
