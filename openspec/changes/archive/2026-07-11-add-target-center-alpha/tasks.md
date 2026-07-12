## 1. Tests

- [x] 1.1 Add parameter-group config tests for the default `targetCenterAlpha` and rejection of values outside `[0, 1]`.
- [x] 1.2 Add focused `Parameter::Compute()` tests showing top-level target center slews toward `ComputeRawCenter(scene)` using `targetCenterAlpha`.
- [x] 1.3 Add a regression test showing `targetCenterAlpha = 1.0` preserves the previous direct target-center assignment behavior.
- [x] 1.4 Add a modulation-depth regression test showing recursive depth-parameter computation still assigns and snaps current state immediately for parent depth reads.
- [x] 1.5 Add a per-sample processing test showing recompute-on-interval applies target-center smoothing before `ProcessLite()` slews current center.

## 2. Core Implementation

- [x] 2.1 Add `kDefaultTargetCenterAlpha` and `targetCenterAlpha` to `ParameterGroupConfig`.
- [x] 2.2 Extend `ParameterGroupConfig::IsValid()` to require `targetCenterAlpha` in `[0, 1]`.
- [x] 2.3 Change `Parameter::ComputeAtDepth` so recursion depth `0` updates `targetCenter_` with `targetCenter_ += targetCenterAlpha * (rawCenter - targetCenter_)`.
- [x] 2.4 Preserve recursion depth `> 0` behavior by assigning `targetCenter_` directly from the raw center and then snapping current state to target.
- [x] 2.5 Ensure target center scales, normalization offsets, min/max values, and target modulation depths continue deriving from the post-smoothing `targetCenter_`.

## 3. Verification

- [x] 3.1 Run focused synth parameter modulation tests.
- [x] 3.2 Run the broader synth test target if focused tests pass.
- [x] 3.3 Run `openspec status --change add-target-center-alpha` and confirm the change remains apply-ready.
