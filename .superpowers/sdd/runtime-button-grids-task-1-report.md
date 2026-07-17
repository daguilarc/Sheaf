# Task 1 Report: JUCE-free button-grid core and StateCell

## Status

DONE

## Implementation summary

- Added a JUCE-free button-grid module with checked signed half-open `GridRange`
  geometry, dense owned cells, stable owned `Grid`/`GridSlot` objects, compatible
  selection, and press/release/poly-pressure routing.
- Added topology finalization at `GridManager::CreateUIState()` and allocation-free
  runtime selection, routing, and publication over preallocated snapshot storage.
- Added packed UI publication that preserves cell RGB and always overwrites alpha
  with exact on/off values `1` or `0`, including empty and disconnected paths.
- Added `NoFlash`, `BoolFlash`, legacy-named `Flash<State>`, and
  `StateCell<State, FlashPolicy>` with Toggle, Momentary, SetOnly, and ShowOnly
  behavior over non-owned state.
- Moved the existing `AtomicColor` implementation unchanged into its own focused
  header and made `ParameterModulation.hpp` consume it.
- Wired `ButtonGrid.cpp` and the new headers through the core synth library, shared
  JUCE runtime source/header lists, browser core sources, and synth test target.

## RED evidence

### Topology/build target RED

Command:

```text
make -C projects/synth build/button_grid_tests
```

Result: exit 2, expected missing-module failure:

```text
make: *** No rule to make target `include/synth/ButtonGrid.hpp', needed by `build/button_grid_tests'.  Stop.
```

### StateCell/publication RED

Command:

```text
make -C projects/synth build/button_grid_tests
```

Result: exit 2 after adding the second test increment, with expected compilation
errors beginning:

```text
tests/button_grid_tests.cpp:181:25: error: no template named 'StateCell' in namespace 'synth'
tests/button_grid_tests.cpp:229:52: error: no member named 'BoolFlash' in namespace 'synth'
tests/button_grid_tests.cpp:243:55: error: no member named 'Flash' in namespace 'synth'
```

## GREEN evidence

### Topology increment GREEN

Command:

```text
make -C projects/synth build/button_grid_tests && projects/synth/build/button_grid_tests
```

Result: exit 0; the initial two range and independent-slot tests passed.

### Complete focused GREEN

Command:

```text
make -C projects/synth build/button_grid_tests build/parameter_modulation_tests && projects/synth/build/button_grid_tests && projects/synth/build/parameter_modulation_tests
```

Result: exit 0 with no compiler warnings. All eight button-grid tests and the
complete parameter-modulation binary passed.

### Full synth suite

Command:

```text
make -C projects/synth test
```

Result: exit 0. The UI-boundary check, all synth test builds, the new button-grid
binary, and every existing binary in the synth `test` target passed.

## Files changed

- `projects/synth/include/synth/AtomicColor.hpp`
- `projects/synth/include/synth/ButtonGrid.hpp`
- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ButtonGrid.cpp`
- `projects/synth/tests/button_grid_tests.cpp`
- `projects/synth/Makefile`
- `projects/synth/runtime/juce_build.mk`
- `projects/synth/browser/Makefile`

## Self-review

- Confirmed checked signed subtraction and multiplication occur before conversion
  to `size_t`; empty and overflowing exact brief cases are rejected.
- Confirmed cell storage is one dense vector and manager-owned grids/slots live
  behind `unique_ptr`, so vector growth does not move the owned objects.
- Confirmed failed selection leaves prior selection unchanged and invalid external
  routing is a no-op.
- Confirmed all topology mutations throw before mutation after finalization.
- Confirmed every published coordinate constructs a fresh `Color`, preserves RGB
  only for a present cell, and explicitly assigns alpha for present, empty, and
  disconnected paths.
- Confirmed runtime allocation evidence uses unchanged snapshot vector capacities
  and storage addresses, plus stable `Grid*` and `GridSlot*`, rather than global
  allocation interception.
- Confirmed `StateCell` state and flash pointers are non-owning, flash affects only
  palette choice, `GetOnOff()` is exactly the on-state comparison, and pressure
  retains the base no-op.
- Confirmed `git diff --check` is clean and unrelated controller/user artifacts are
  neither edited for Task 1 nor staged.

## Concerns

None.
