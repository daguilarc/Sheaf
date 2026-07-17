# Task 3 Report: Runtime ownership, global UI facade, and grid feedback

## Status

Complete. Task 3 was implemented with RED-GREEN-REFACTOR TDD and committed as
`018da6359e3f48dd284528e74c7235533ffa1c12`
(`feat(synth): own grid runtime UI state`).

## Summary

- Added the internal `RuntimeUIState` facade with non-owning parameter and grid
  snapshot pointers; `AppContext::uiState` remains a
  `ParameterManager::UIState*` and `AppContext` gained no grid surface.
- Made `Engine` own exactly one `GridManager` immediately after its
  `ParameterManager`, then bound both UI and MIDI buses to both managers before
  publishing the buses through `AppContext`.
- Finalized, allocated, and initially populated grid UI state before the first
  MIDI processor rebuild. Both parameter and grid snapshots are republished at
  the existing throttled UI cadence.
- Used the required destruction order:
  `uiState_`, `gridUIState_`, `runtimeUIState_`, `midiProcessors_`. Reverse
  destruction therefore removes processors before the facade and snapshots,
  while both managers outlive the buses that reference them.
- Converted controller-profile and system-output construction to receive the
  stable runtime facade. Encoder output still receives only
  `state->parameters`.
- Added delegating compatibility constructors for the three concrete system
  output processors that still accept `ParameterManager::UIState*`. Retained a
  legacy profile-factory overload and an explicit `nullptr_t` overload so old
  literal-null call sites remain unambiguous.
- Evaluated grid press/release/pressure feedback only through immutable
  `GridManager::UIState` range metadata and one atomic packed-color load. No
  live `GridManager`, `Grid`, or `Cell` is read by output evaluation.
- Returned RGB plus `a != 0` for connected grid feedback and off/false for
  invalid coordinates, disconnected slots, missing slots, or missing facade
  state.
- Added Engine, Instrument, Rig, and MiniApp coverage for lifetime, both-bus
  routing, initial/throttled publication, stable facade/member addresses,
  snapshot-only feedback, negative coordinates, missing targets, and existing
  applications with no grid topology.

## Files

- `projects/synth/include/synth/RuntimeUIState.hpp`
- `projects/synth/include/synth/Engine.hpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/tests/engine_tests.cpp`
- `projects/synth/tests/instrument_tests.cpp`
- `projects/synth/tests/rig_tests.cpp`
- `projects/synth/tests/miniapp_system_tests.cpp`
- `projects/synth/Makefile`

## TDD Evidence

### RED 1: missing facade and runtime ownership

After adding only the Task 3 ownership/facade/feedback tests, ran:

```text
make -C projects/synth build/engine_tests build/instrument_tests build/rig_tests build/miniapp_system_tests
```

Result: exit code 2 with the expected missing-feature compilation failures,
including:

```text
error: no type named 'RuntimeUIState' in namespace 'synth'
error: no member named 'GridManagerForTest' in 'synth::Engine<...>'
error: no member named 'RuntimeUIStateForTest' in 'synth::Engine<...>'
error: incomplete type 'synth::GridManager' named in nested name specifier
```

There was no unrelated harness or infrastructure failure.

### GREEN 1

After the minimal facade, Engine ownership, factory conversion, and snapshot
lookup implementation, all four focused targets built. The first execution
exposed one test-fixture error: the new Engine test checked a throttled UI
publication after one block while the established cadence at 48 kHz/256 frames
is six blocks. The test was corrected to use that existing cadence; Engine,
Instrument, Rig, and MiniApp then exited 0.

### RED 2: initial publication before processor rebuild

The Engine test was tightened to require the selected cell's packed color
immediately after `Initialize`, before audio blocks or MIDI output processing.
Running:

```text
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

exited 1 at the intended assertion because a newly allocated grid snapshot
still contained its default packed zero.

### GREEN 2

`Engine::Initialize` now calls `GridManager::PopulateUIState` immediately after
`CreateUIState` and before binding the facade/rebuilding MIDI processors. The
same focused Engine command then exited 0.

## Verification

Exact Task 3 focused command, exit 0:

```text
make -C projects/synth build/engine_tests build/instrument_tests build/rig_tests build/miniapp_system_tests && projects/synth/build/engine_tests && projects/synth/build/instrument_tests && projects/synth/build/rig_tests && projects/synth/build/miniapp_system_tests
```

MIDI/output protocol regression command, exit 0:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

This retained the byte-level generic CC/monochrome, WRLD.Bldr, Launchpad,
cache suppression, reset, encoder color-budget, bank, scene, gesture, and
modifier feedback assertions.

Complete synth suite, exit 0:

```text
make -C projects/synth test
```

The full target also passed UI-boundary checking and every JUCE-free synth,
runtime, browser, app-system, controller-model, and deadline binary.

Additional checks:

- `git diff --check`: clean before staging.
- `git diff --cached --check`: clean before commit.
- Staged path audit contained exactly the nine Task 3 files listed above.
- `GridManagerForTest` has exactly one Engine definition.
- `AppContext.hpp` contains no `RuntimeUIState` or `GridManager` exposure.
- Engine member audit confirmed the required manager and snapshot declaration
  order.

## Commit

`018da6359e3f48dd284528e74c7235533ffa1c12 feat(synth): own grid runtime UI state`

## Risks / Minors

- `RuntimeUIState` is intentionally a non-owning facade. Engine lifetime order
  makes its processor use safe; direct construction outside Engine must keep
  the referenced snapshots alive.
- `GridManagerForTest` and `RuntimeUIStateForTest` are narrow test inspection
  hooks on the templated Engine. Applications still receive no grid pointer.
- No application defines grid topology in this change; Rig and MiniApp coverage
  confirms empty-grid initialization retains their prior visible/runtime
  contracts.
- No unresolved Task 3 correctness issue or blocker remains.

## Scope Preservation

The shared progress ledger, prior task reports, OpenSpec artifacts, plan file,
and `projects/synth/miniapp/` were not staged or committed. OpenSpec checkboxes
were not modified.
