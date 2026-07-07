## Why

The synth parameter path currently splits target `Compute()` and per-sample `ProcessLite()` scheduling across the runtime and application, which couples control-rate updates to the host audio buffer size and makes simple synth apps write avoidable plumbing. The parameter system should own its own per-sample control cadence so applications can process parameters with one call per sample and get a stable default update rate independent of device block size.

## What Changes

- Add a group-scoped parameter target compute interval, defaulting to 16 samples.
- Add a per-sample parameter processing API next to `ProcessLite()` that refreshes targets when the current audio sample index reaches the configured interval, then runs `ProcessLite()`.
- Add a group-level convenience path so applications can process all parameters in a group per sample without manually splitting `Compute()` from `ProcessLite()`.
- Change the steady-state runtime/application contract so `ComputeAllTargets()` is no longer run once per host audio block as the normal target-refresh cadence.
- Expose or pass a monotonic audio sample index to application block processing so cadence checks use absolute audio time, not frame indexes that reset at buffer boundaries.
- Update the mini app to use the new per-sample parameter processing path. This change does require touching the mini app, because it currently calls `ProcessLiteParameters()` per sample while relying on the runtime's once-per-block `ComputeAllTargets()`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-parameter-modulation`: group configuration and audio-rate parameter processing gain an explicit target compute interval and per-sample process API.
- `synth-app-runtime`: the runtime/application audio contract changes so target recomputation is owned by the parameter processing path rather than the host buffer pump, and applications receive enough sample-position context to keep the cadence buffer-size independent.

## Impact

- Affected code:
  - `projects/synth/include/synth/ParameterModulation.hpp`
  - `projects/synth/src/ParameterModulation.cpp`
  - `projects/synth/include/synth/AppContext.hpp`
  - `projects/synth/include/synth/Engine.hpp`
  - `projects/synth/apps/miniapp/DemoModulation.hpp`
  - `projects/synth/apps/miniapp/MiniAppCore.hpp`
  - synth unit, engine, rig, and mini app system tests
- API impact:
  - `ParameterGroupConfig` gains a positive sample interval field with default `16`.
  - `Parameter` and/or `ParameterGroup` gain per-sample process helpers.
  - `AudioBlock` or an equivalent application-facing context gains the block's starting sample index.
- Behavioral impact:
  - Target recomputation defaults to every 16 samples rather than once per host buffer, making parameter response faster for common 64/128/256 sample buffers and independent of the negotiated buffer size.
  - `ProcessLite()` remains the low-level slew-only helper for tests and specialized callers.
- Dependencies:
  - No new third-party dependencies.
