## Why

Bipolar parameter centers are currently stored in `[-1, 1]` and mixed directly with unipolar `[0, 1]` modulation sources, so the existing crossfade law produces inconsistent bipolar behavior. A single normalized internal domain makes modulation coherent while preserving the crossfade behavior we want.

## What Changes

- **BREAKING** Store, edit, smooth, modulate, and cache every parameter value in normalized `[0, 1]` space, including parameters presented or consumed as bipolar.
- Preserve the existing bounded crossfade modulation law and overfull-depth normalization; only its coordinate system changes.
- Interpret bipolar parameters at read boundaries by converting normalized values with `bipolar = 2 * normalized - 1` before applying bipolar linear, exponential, or zero-based exponential mappings.
- Keep bipolar metadata for presentation and mapping validation, but remove bipolar range behavior from the parameter core.
- Store modulation-depth controls in `[0, 1]`, with `0.5` as neutral, and convert them to signed depth before applying the depth curve.
- Change the modulation-depth curve halfpoint magnitude from `0.125` to `0.25`, while retaining signed endpoints of `-1`, `0`, and `1`.
- **BREAKING** Make raw reads explicitly normalized and update bipolar defaults, scene values, UI publication, tests, and module consumers accordingly; bipolar UI snapshots remain signed presentation values.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Change the parameter value domain, bipolar mapping boundary, modulation-depth encoding and curve, while preserving crossfade modulation semantics.

## Impact

- Affects the synth parameter engine, parameter manager mapping helpers, module parameter declarations and reads, UI-state consumers, simulation oracle, and parameter/module/system tests under `projects/synth`.
- Changes normalized-value API contracts for bipolar parameters and modulation-depth parameters; callers and fixtures using signed stored values must migrate with `normalized = (bipolar + 1) / 2`.
- Does not introduce new dependencies or change the modulation-source `[0, 1]` contract.
