## Why

Braid4's parameter framework spends audio-thread time in proportion to allocated modulation-depth nodes and configured gestures, even when most routes and gestures are inactive. Sixty top-level parameters are already a material part of the buffer deadline, and the framework needs to scale toward 2–4 times as many top-level parameters, more modulation sources, and 64 gestures without making inactive topology an audio-rate cost.

## What Changes

- Restore the intended processing boundary: group-level per-sample processing runs `ProcessLite()` only for manager-registered top-level parameters, while recursive control-rate compute continues to evaluate materialized modulation-depth parameters and seed their cached/UI state.
- Maintain stable source identities plus an active-prefix permutation/count for each parameter's modulation routes so per-sample depth slew and modulation application visit only active or still-settling routes.
- Represent manager gesture selection and each parameter/scene's active gesture set with 64-bit masks, support gesture indices `0..63`, reject configurations above 64 gestures, and iterate only set gesture bits during compute and editing.
- Widen parameter/UI gesture-affecting selectors from 32 to 64 bits so gestures `32..63`, which are already routable, become visible in selectors and encoder badges.
- Garbage-collect neutral leaf modulation-depth parameters at explicit safe control boundaries: detach them from their parent and recycle their local storage slot when they have zero/default depth state, no child modulation routes, no active/non-default gesture state, and no live modulation-view reference.
- Preserve top-level parameter address stability, source/gesture indices, scene and patch semantics, one-pole settling for routes that are returning to zero, and allocation-free audio processing.
- Add deterministic unit, randomized-oracle, persistence, lifecycle, boundary-index, and Braid4 deadline/regression tests that prove audio and patch behavior is unchanged while inactive work no longer scales with allocated local nodes or unused gestures. Local modulation-depth UI state is intentionally refreshed only at recursive compute cadence after its audio-rate `ProcessLite()` calls are removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Tighten top-level audio-rate processing, add sparse active modulation/gesture traversal with a 64-gesture contract, widen gesture-affecting masks, and define safe reclamation/reuse of neutral local modulation-depth nodes.

## Impact

- Primary implementation: `projects/synth/include/synth/ParameterModulation.hpp` and `projects/synth/src/ParameterModulation.cpp`.
- UI and controller consumers of gesture masks: parameter snapshots, encoder/portable draw state, MIDI-controller gesture indication, and associated tests. Browser command-buffer payloads already contain rendered draw commands rather than gesture masks, so no command layout or compatibility migration is required.
- Parameter-group local storage ownership gains explicit top-level/live-local separation and recyclable local slots; public top-level `ParameterId` and parameter addresses remain stable.
- Patch JSON remains backward compatible and continues to omit default modulation-depth subtrees; loading materializes only persisted non-default routes.
- Test impact: parameter modulation unit/oracle tests, patch round trips, bank/modulation-view lifecycle tests, Braid4 system/deadline tests, and new sparse-scaling instrumentation.
