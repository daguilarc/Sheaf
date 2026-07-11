## Why

Fast scene, gesture, and encoder edits currently replace `targetCenter_` directly from `ComputeRawCenter()`, so the target side of a parameter can step before the existing `ProcessLite()` smoothing has a chance to shape the motion. Adding a separate target-center smoothing stage gives parameter motion a softer control-rate contour while preserving the existing audio-rate current-value slew.

## What Changes

- Add a bounded `targetCenterAlpha` field to `ParameterGroupConfig`.
- Default `targetCenterAlpha` to a 50 Hz-style one-pole alpha at the default target-compute cadence.
- Change top-level `Parameter::ComputeAtDepth` target-center updates to slew from the previous target center toward `ComputeRawCenter(scene)` instead of assigning directly.
- Preserve recursive modulation-depth behavior: parameters computed at recursion depth greater than zero still snap current state to target during recursive computation so parents consume immediate modulation-depth values.
- Keep existing current-value `ProcessLite()` smoothing, target center scale/depth/min/max computation, UI display smoothing, routing, persistence topology, and allocation behavior otherwise unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: parameter group configuration and compute behavior gain target-center smoothing before the existing current-value slew.

## Impact

- Affected code: `projects/synth/include/synth/ParameterModulation.hpp`, `projects/synth/src/ParameterModulation.cpp`, and focused synth parameter modulation tests.
- Public API impact: `ParameterGroupConfig` gains a new alpha field with validation and a default.
- Behavioral impact: top-level parameter target centers move through an additional one-pole smoothing stage; recursive modulation-depth source parameters keep immediate current-state snapping when computed by a parent.
- No new dependencies or file formats are introduced.
