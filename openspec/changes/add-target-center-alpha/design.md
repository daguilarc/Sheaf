## Context

`Parameter::HandleIncDec` edits per-scene and per-gesture stored knob values. `Parameter::Compute()` then derives a raw center from those values, scene blend, and active gesture weights, stores it in `targetCenter_`, and `ProcessLite()` slews `currentCenter_` toward that target. This means target center can jump at the target recompute cadence even though current center remains smoothed.

The parameter group already owns timing and smoothing configuration through `processLiteAlpha`, `targetComputeIntervalSamples`, `uiDisplayCenterAlpha`, and `uiDisplaySpreadAlpha`. Target-center smoothing belongs in the same config shape because it is a group-wide control-rate behavior, not individual UI routing state.

## Goals / Non-Goals

**Goals:**

- Add `ParameterGroupConfig::targetCenterAlpha` as a bounded one-pole alpha.
- Default target-center smoothing to a value matching roughly 50 Hz motion at the default target recompute cadence.
- Slew top-level `targetCenter_` toward `ComputeRawCenter(scene)` during target recompute.
- Preserve recursive modulation-depth source behavior so depth parameters computed under a parent still provide immediate current values to the parent.
- Cover direct compute, per-sample processing, and validation behavior in focused parameter tests.

**Non-Goals:**

- Replace or remove `processLiteAlpha`.
- Change scene/gesture edit distribution, modulation-depth target curve mapping, or UI display smoothing.
- Add file-format migration or persist the new config field in patch value JSON.
- Change MIDI controller scaling or encoder routing semantics.

## Decisions

1. Add an alpha, not a frequency field.

   `ParameterGroupConfig` already exposes alphas for control smoothing. Keeping `targetCenterAlpha` as an alpha avoids introducing sample-rate plumbing into parameter configuration and matches existing validation patterns. The default constant can be documented as a 50 Hz-style value at the default recompute cadence, while callers that need a different feel can set the raw alpha explicitly.

2. Smooth only top-level target center assignment.

   Public `Parameter::Compute()` enters `ComputeAtDepth(scene, 0)` and should update `targetCenter_` as `targetCenter += targetCenterAlpha * (rawCenter - targetCenter)`. Recursive modulation-depth calls enter with `recursionDepth > 0`; those should keep assigning target center from raw center and snapping current state to target. That keeps parent depth calculation immediate and avoids adding an extra lag inside modulation-depth paths.

3. Keep dependent target state derived from the smoothed target center.

   Center scales, normalization offsets, min/max values, and modulation depths should continue to be computed after `targetCenter_` is updated, using the smoothed `targetCenter_`. `ProcessLite()` then slews current center, scale, offsets, min/max, and depths toward those targets as it does today.

4. Keep snap-to-target paths as snaps.

   Initialization, patch load, revert, and explicit `SnapCurrentToTarget()` paths should continue to seed current state from target state. This change is about steady-state target recomputation, not lifecycle resets.

## Risks / Trade-offs

- Target smoothing changes the response feel of scene and gesture edits. Mitigation: keep the alpha configurable and default it to a moderately fast 50 Hz-style value.
- Two smoothing stages can make parameter motion feel slower than expected when `processLiteAlpha` is also low. Mitigation: document and test that target-center alpha and process-lite alpha are independent stages.
- Recursive depth parameters could become sluggish if target smoothing is applied there. Mitigation: explicitly preserve the existing recursion-depth snap behavior.
- Exact "50 Hz" interpretation depends on target recompute cadence. Mitigation: define the default as an alpha constant chosen for the default 16-sample recompute cadence rather than adding hidden sample-rate assumptions.
