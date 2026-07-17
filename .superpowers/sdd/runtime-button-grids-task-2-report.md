# Task 2 Report: Grid MessageIn variants and shared-bus routing

## Status

Complete. Task 2 was implemented with strict RED-GREEN-REFACTOR TDD and committed as `e611221c` (`feat(synth): route button grid messages`).

## Implementation

- Appended `GridPress`, `GridRelease`, `GridPressureChange`, and `SelectGrid` to `MessageIn::Type`, preserving every existing enum numeric value.
- Added the flat semantic fields `gridSlotIx`, `gridIx`, signed `gridX`/`gridY`, and byte `velocity`, plus the four required factories.
- Added variant-specific JSON names and flat shapes:
  - press/pressure: `type`, `gridSlot`, `x`, `y`, `velocity`
  - release: `type`, `gridSlot`, `x`, `y`
  - select: `type`, `gridSlot`, `grid`
- Preserved the legacy JSON code path and field insertion order for every pre-existing message type.
- Added checked signed-coordinate parsing and full byte-range velocity/pressure parsing; negative values and values above 255 reject without mutating the target.
- Kept `MessageInBus(ParameterManager*, std::size_t)` unchanged and source-compatible, including literal-zero capacity calls.
- Added `SetParameterManager`, `SetGridManager`, and retained `SetManager` as the parameter-manager compatibility alias.
- Routed parameter types only to `ParameterManager` and grid types only to `GridManager`; missing managers and invalid slots/grids/coordinates are nonthrowing no-ops.
- Extended output-evaluation defaults, canonical sort semantics, semantic equality test oracles, JSON type names, and view-model descriptions.
- Extended the seeded message-bus state-machine oracle with valid grid selection, all three callbacks, missing slots/grids, signed out-of-range coordinates, and same-timestamp interleaving with parameter messages.

## TDD Evidence

### RED

After adding only the new tests, ran:

```text
make -C projects/synth build/parameter_modulation_tests build/instrument_tests
```

Result: exit code 2, with the expected missing-feature compilation failures, including:

```text
error: no member named 'SetGridManager' in 'synth::MessageInBus'
error: no member named 'SelectGrid' in 'synth::MessageIn'
error: no member named 'GridPress' in 'synth::MessageIn'
error: no member named 'GridPressureChange' in 'synth::MessageIn'
error: no member named 'GridRelease' in 'synth::MessageIn'
```

These were the intended RED failures; there were no unrelated syntax, harness, or infrastructure failures.

### GREEN

After the minimal production implementation, the focused build succeeded with exit code 0:

```text
make -C projects/synth build/parameter_modulation_tests build/instrument_tests
```

Both focused binaries then exited 0, including the new construction, JSON, validation, bus-routing, namespace-isolation, and seeded-oracle tests.

### REFACTOR

- Updated public comments for the appended enum range, grid sort semantics, and flat JSON contract.
- Re-ran the exact required focused build-and-test command after refactoring; it exited 0.

## Verification

Required focused command, exit 0:

```text
make -C projects/synth build/button_grid_tests build/parameter_modulation_tests build/instrument_tests build/blocks_tests build/viewmodel_tests && projects/synth/build/button_grid_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/instrument_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests
```

Full synth suite, exit 0:

```text
make -C projects/synth test
```

The full target also passed `scripts/check_ui_boundary.sh` and all JUCE-free synth binaries, including engine, rig, miniapp, Braid 4, reconciliation, portable UI, runtime, and browser support tests.

Additional checks:

- `git diff --check`: clean.
- Exhaustive `MessageIn::Type` switch audit with `rg`: all exhaustive switches include the four appended cases; limited-oracle switches retain explicit defaults.
- Cached diff check before commit: clean.
- Cached path list contained exactly the eleven Task 2 files.

## Files

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/include/synth/MidiController.hpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/instrument_tests.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

## Self-review

- Existing enum cases remain in their original order; new values are 14 through 17.
- No constructor overload was added, so `MessageInBus(&manager, 16)` and `MessageInBus(&manager, 0)` remain unambiguous.
- Parameter and grid slot namespaces use distinct fields and distinct manager dispatch paths.
- Grid release ignores byte storage semantically and omits `velocity` from JSON and sorting.
- Grid pressure uses the shared `velocity` byte field while its type name and description identify pressure.
- Legacy JSON serialization remains on its original statements and insertion order.
- No Engine wiring was added in this task; the new explicit setter is ready for the later Engine task specified by the brief.
- No user-owned planning artifacts or `projects/synth/miniapp/` files were staged, edited, deleted, or committed.

## Concerns

None. The deliberate remaining integration point is the later Engine task calling `SetGridManager` before producers can push.
