# Task 5 Report: Randomized, Persistence, UI, and Controller Integration

## Outcome

Implemented Task 5 as a test-only change. No production defect was found and no production or browser protocol/layout file was changed.

## Test changes

- Migrated the shared randomized parameter oracle from two gestures and per-gesture booleans to 64 gesture values, 64-bit per-scene active masks, and a 64-bit manager selection mask.
- Added exact reference-model route state: stable route-source permutation, inverse source positions, and active-prefix count. The randomized checks now compare every route slot and inverse position, as well as every source-indexed current/target depth and output value.
- Added deterministic MessageInBus coverage for gesture indices 32 and 63, including selection, values, edit arming, and visible UI mask bits.
- Added seed/step/action/random-consumption diagnostics to every message-bus randomized action. The random-value, coin, and index streams still enforce exact drain order.
- Extended periodic UI comparison to include selected bank/view state, all 64 gesture selected/value entries, all visible modulator and gesture mask bits, source and gesture colors/counts, centers, spreads, switch buckets, bipolar/min/max values, and manager modifiers/scenes.
- Added a MessageInBus/public-manager lifecycle model covering open, reset while pinned, explicit collect, close, exact storage-identity reuse under a distinct parent, gesture-63 persistence, revert, and patch-load rematerialization. It compares live/free counts at every boundary.
- Replaced the portable UI's manually constructed high-gesture draw state with a real `Parameter::UIState` carrying bit 63 through `EncoderDrawStateFromParameter` and renderer output, asserting badge `64`.
- Added controller integration using real system-button and analog MIDI processors through `MessageInBus`; gesture 63 selects, receives a value, arms, and edits the same manager gesture. The test also statically and dynamically verifies that `bankAffectingMask` remains a 32-bit bank selector.
- Left `browser_command_buffer_tests.cpp` unchanged because rendered command expectations and wire layout did not change; the existing binary was rebuilt and run.

## TDD evidence

RED was observed after widening the oracle to 64 gestures but before wiring every simulation manager:

```text
[FAIL] randomized_parameter_modulation_simulation: gesture index out of range
```

All unrelated tests in that run passed. Wiring the simulation manager to the 64-gesture topology made the seeded run green. A later lifecycle assertion initially failed because the gesture weight was still zero; the test was corrected to drive the existing `SetGestureValue` message before editing, then passed without a production change.

## Verification

The prescribed build and binaries all exited 0:

```text
make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests build/browser_command_buffer_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/portable_ui_tests
projects/synth/build/instrument_tests
projects/synth/build/browser_command_buffer_tests
```

The parameter binary was then repeated twice with identical explicit inputs; both runs exited 0 and used the same seed/step schedule:

```text
SYNTH_RANDOM_SEEDS=0x51A7,0xC0FFEE,0xA11CE SYNTH_RANDOM_STEPS=250 projects/synth/build/parameter_modulation_tests
```

`git diff --check` passed. Builds emitted no warnings after the final edits.

## Files intended for the Task 5 commit

- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/portable_ui_tests.cpp`
- `projects/synth/tests/instrument_tests.cpp`

The Task 5 brief and this report remain uncommitted as requested.
