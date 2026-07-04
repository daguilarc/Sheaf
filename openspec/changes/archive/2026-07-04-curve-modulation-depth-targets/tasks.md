## 1. Depth Curve Tests

- [x] 1.1 Add focused tests for recursive modulation-depth target mapping at knob values `-1`, `-0.5`, `0`, `0.5`, and `1`.
- [x] 1.2 Add a test showing `0.5` depth knob travel produces an effective raw depth of `0.125` before normalization.
- [x] 1.3 Add a test showing two overfull curved depths still use the existing signed normalization and normalization-offset rules.
- [x] 1.4 Add a test showing the audio-rate contribution remains a linear modulator dot product with the curved depth coefficient.

## 2. Core Implementation

- [x] 2.1 Add constants or a helper for modulation-depth target mapping with max absolute depth `1.0`, halfpoint absolute depth `0.125`, and a precomputed zero-based exponential base.
- [x] 2.2 Update `Parameter::ComputeAtDepth()` so existing modulation-depth parameters are recursively computed, read as signed knob values, mapped through the depth curve, and then stored in `targetDepths`.
- [x] 2.3 Preserve direct zero depth for missing modulation-depth parameters and preserve existing signed-depth normalization, min/max, center-scale, and normalization-offset behavior after mapping.
- [x] 2.4 Keep mapping scoped to depth target computation so ordinary `GetRaw()`, cached knob reads, persistence, and manager-level mapping helpers continue to expose knob values as before.

## 3. Oracle and Compatibility

- [x] 3.1 Update deterministic simulation/oracle code to distinguish modulation-depth knob values from curved effective depth targets.
- [x] 3.2 Update existing parameter modulation tests that expected linear depth targets to expect curved targets where they inspect `TargetDepths`.
- [x] 3.3 Confirm patch persistence tests still store and restore modulation-depth knob positions without migration.

## 4. Verification

- [x] 4.1 Run `make -C projects/synth build/parameter_modulation_tests`.
- [x] 4.2 Run `projects/synth/build/parameter_modulation_tests`.
- [x] 4.3 Run `make synth-test` from the repository root.
