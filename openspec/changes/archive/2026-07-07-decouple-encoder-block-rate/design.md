## Context

The current runtime-hosted mini app has a three-way split for parameter audio work:

- `Engine::ProcessBlock()` drains patch/UI/MIDI messages, then calls `ParameterManager::ComputeAllTargets()` once per device block.
- `MiniAppCore::ProcessBlock()` loops over samples and calls `ProcessLiteParameters(parameters_)`.
- `Parameter::ProcessLite()` slews current values and samples cached knob values, but does not recompute targets.

That means the target update rate is effectively the audio device buffer size. A 256-frame buffer recomputes targets every 256 samples; a 64-frame test buffer recomputes every 64 samples. The application also has to know that `Compute()` happens elsewhere before its `ProcessLite()` calls. This is the wrong boundary for a simple synth app.

The parameter code already has the right configuration home for this: `ParameterGroupConfig` owns voice/modulator/scene shape, smoothing alphas, UI display smoothing, and group allocation guarantees. A target compute interval is another group-level control-rate/audio-rate behavior, and group ownership lets future apps use different cadences for groups with different cost profiles.

## Goals / Non-Goals

**Goals:**

- Make parameter target recomputation independent of host buffer size.
- Default steady-state target recomputation to every 16 audio samples.
- Move the `Compute()` plus `ProcessLite()` cadence into parameter/group APIs so applications do not manually coordinate the split.
- Give applications a monotonic audio sample index for buffer-size-independent per-sample scheduling.
- Update the mini app to use the new parameter processing API and keep its UI, module topology, MIDI routing, patch behavior, and output behavior intact.

**Non-Goals:**

- Do not move DSP module processing into the runtime.
- Do not remove `ProcessLite()`; it remains the low-level slew-only operation for tests and specialized callers.
- Do not change patch file format or persisted parameter values.
- Do not introduce a global manager-level cadence for all groups.

## Decisions

### Put the cadence on `ParameterGroupConfig`

Add `targetComputeIntervalSamples` to `ParameterGroupConfig`, defaulting to `16`, and require it to be positive in `IsValid()`.

Alternative considered: a `ParameterManager` field. This would make cadence global across all groups, but group config already owns process-lite alpha, UI smoothing alpha, voice count, modulator count, and allocation shape. The compute interval is consumed by parameters in a group and has the same "group behavior" character as the existing alphas. Group-level configuration also supports future higher-cost groups without making simple groups slower.

Alternative considered: application/runtime config. This keeps the wrong dependency: the application still has to own parameter control-rate policy.

### Add a per-sample process API and keep `ProcessLite()`

Add a helper next to `ProcessLite()` with semantics equivalent to:

```cpp
if ((sampleIndex % group.Config().targetComputeIntervalSamples) == 0) {
    Compute(group.Manager().Scene());
}
ProcessLite();
```

The helper should use a monotonic audio sample index, not a frame index local to the current device block. A group-level convenience API should iterate the group's parameters and invoke the per-parameter helper so app code can process a whole group per sample.

`ProcessLite()` remains unchanged as the "advance current state toward existing targets" primitive. That keeps current tests and explicit snap/load paths clear.

The group-level API is the application-facing default. It avoids app-maintained
parameter lists becoming a second source of truth for which top-level
parameters receive target refreshes. Tests should also cover parameters with
modulation-depth child parameters so the new path is proven to keep the
manager-wide `ComputeAllTargets()` target coverage for modulation routes.

### Stop using host block boundaries as the steady-state target cadence

Remove `Engine::ProcessBlock()`'s normal once-per-block `ComputeAllTargets()` call from the steady-state pump. The runtime still owns block-boundary message and patch drain order, then delegates to the app exactly once per block. The parameter processing helper, called from the app's per-sample loop, owns when targets refresh.

This changes the existing `ProcessFrame()` hook contract. The hook can still run once per block after message drain and before `ProcessBlock()`, but it must no longer be documented or tested as observing freshly computed parameter targets from `ComputeAllTargets()`. If callers need target refresh, they should use the new parameter processing path.

### Put block start sample in the application-facing block view

Add a monotonic `startSample` field to `AudioBlock`, set by the engine before application delegation. Apps calculate the sample index as `block.startSample + frame`. This avoids accidental cadence resets at buffer boundaries and keeps the implementation deterministic in `SynthRig`.

Using `frame % interval` inside each `ProcessBlock()` was rejected because it would still couple the cadence to device blocks whenever block sizes are not exact multiples of the interval.

### Mini app impact

This change does require mini app changes. `MiniAppCore::ProcessBlock()` should replace its `ProcessLiteParameters(parameters_)` call with the new per-sample group processing helper using `block.startSample + frame`. The mini app does not need to explicitly configure the interval unless it wants a value other than the default 16 samples.

The mini app's module order remains:

1. process parameters for this sample,
2. set/process VCO,
3. set/process filter,
4. set/process LFO,
5. update group modulator values for the next sample,
6. write outputs and advance scope.

This preserves the existing one-sample modulation-source delay formalized by cached knob reads.

## Risks / Trade-offs

- Behavior changes for tests that assumed once-per-block target computation -> update those tests to assert 16-sample default cadence and buffer-size independence.
- A local frame index could accidentally be used instead of absolute sample index -> expose `AudioBlock::startSample` and test with block sizes that are not multiples of 16.
- `ProcessFrame()` tests currently depend on post-`ComputeAllTargets()` state -> revise that hook's test/contract so the new parameter helper owns target refresh.
- Multi-group apps may choose different intervals and observe cross-group target refreshes at different samples -> this is an intended trade-off of group-level configuration; apps that need identical cadence can configure groups with the same interval.
- Defaulting to 16 samples increases compute frequency versus common 64/128/256 frame buffers -> this is intentional for responsiveness, but tests should cover finite output and no unexpected allocation in steady-state.

## Migration Plan

1. Add `targetComputeIntervalSamples` to `ParameterGroupConfig` with validation and default `16`.
2. Add per-sample parameter/group processing helpers.
3. Add `AudioBlock::startSample` and set it from the engine's monotonic sample counter before app delegation.
4. Remove steady-state `ComputeAllTargets()` from the engine block pump and revise `ProcessFrame()` expectations.
5. Update the mini app helper/call site to use the new per-sample helper.
6. Update unit, engine, rig, and mini app system tests.

Rollback is local: restore the engine's once-per-block `ComputeAllTargets()` call and revert mini app usage to `ProcessLiteParameters()`. No persisted data migration is involved.

## Open Questions

None. The design chooses `ParameterGroupConfig` for the cadence and specifies that the mini app must change.
