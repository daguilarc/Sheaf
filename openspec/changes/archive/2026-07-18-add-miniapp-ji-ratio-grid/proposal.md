## Why

The runtime button-grid facility is available to controller mappings but has no
application that configures a grid. MiniApp can exercise the complete runtime
path with useful, independently selectable just-intonation pitch offsets for
its two VCO voices.

## What Changes

- Expose the runtime-owned `GridManager` to applications through a non-owning
  pre-audio `AppContext` pointer, without transferring ownership or changing
  runtime UI-state ownership.
- Configure MiniApp with one `(0,0)`–`(8,2)` grid slot and selected grid.
- Register two rows of eight set-only cells for ratios `1/2`, `3/4`, `2/3`,
  `1/1`, `5/4`, `3/2`, `4/3`, and `2/1`; `6/5` is intentionally excluded.
- Apply the two row selections as independent, application-local multipliers
  to the two prepared VCO frequencies, with unity selected at startup.
- Publish distinct dim/off versus full/on cell colors through existing grid UI
  state and add MiniApp integration coverage.

## Capabilities

### New Capabilities

- `synth-miniapp-ratio-grid`: MiniApp's fixed just-intonation grid topology,
  state-cell behavior, audio routing, and feedback contract.

### Modified Capabilities

- `synth-app-runtime`: Applications may configure runtime-owned button-grid
  topology through `AppContext` during initialization.

## Impact

- `projects/synth/include/synth/AppContext.hpp` and `Engine.hpp` gain the
  initialization-only non-owning manager access.
- `projects/synth/apps/miniapp/MiniAppCore.hpp` owns its selections and
  declares/uses the fixed grid.
- `projects/synth/tests/miniapp_system_tests.cpp` verifies topology, state,
  feedback, and per-voice DSP behavior.
- No MIDI-output protocol, MiniApp on-screen UI, patch format, or external
  dependencies change.
