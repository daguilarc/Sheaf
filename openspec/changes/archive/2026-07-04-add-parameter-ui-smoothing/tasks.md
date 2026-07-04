## 1. Parameter Core Tests

- [x] 1.1 Add tests proving `GetRaw` matches the normalized audio-read formula from `spm-9`/`spm-11`, including normalization offset and per-voice modulator rows.
- [x] 1.2 Add tests proving `ProcessLite` samples cached knob values after slewing center, center scale, normalization offset, and depths.
- [x] 1.3 Add tests proving mapping helpers read the cached knob value from the most recent `ProcessLite` rather than recomputing from later modulator-row updates.
- [x] 1.4 Add tests proving recursive modulation-depth `ComputeAtDepth` uses the raw normalized read path and is not dependent on stale cached mapped-read values.
- [x] 1.5 Add tests proving construction and snap-to-target paths seed cached knob values, display centers, and zero display spread before the first steady-state `ProcessLite`.
- [x] 1.6 Add tests pinning UI spread numeric ordering: update display center first, then update spread energy from the squared residual to the updated center.

## 2. Parameter Core Implementation

- [x] 2.1 Extend `ParameterGroupConfig`, storage batches, and group arenas with per-group UI smoothing alphas plus per-parameter/per-voice cached knob, UI center, and UI spread-energy storage.
- [x] 2.2 Rename `Parameter::Get` to `Parameter::GetRaw` and add a cached knob read path for mapping helpers, preserving clamping and range behavior.
- [x] 2.3 Update `Parameter::ProcessLite` to slew existing current state, sample cached knob values from the raw path, and update UI center/spread EMA state.
- [x] 2.4 Update `ComputeAtDepth`, switch bucket computation, mapping helpers, modules, and tests to use the correct raw, target, or cached read path.
- [x] 2.5 Ensure switch/discrete parameters publish zero display spread while retaining target-based switch bucket behavior.

## 3. UI State and Encoder Rendering

- [x] 3.1 Extend `Parameter::UIState` setup, disconnected defaults, and population to publish smoothed display center and non-negative display spread per voice.
- [x] 3.2 Update UI-state simulation/oracle tests to expect display center/spread fields while preserving min/max arcs, switch buckets, colors, and affecting masks.
- [x] 3.3 Update `EncoderComponent` snapshots to read display spread and render a spread-proportional blur/cloud around each voice display center.
- [x] 3.4 Add or update encoder component geometry/rendering tests for zero spread, nonzero spread, bipolar normalization, and disconnected neutral spread.

## 4. Verification

- [x] 4.1 Run focused synth parameter modulation tests.
- [x] 4.2 Run synth module tests covering mapped parameter reads in module `SetInput` paths.
- [x] 4.3 Run encoder component tests.
- [x] 4.4 Run the full synth test target.
