# Task 2 Implementation Report

## Scope

Implemented Task 2 only: 64-bit sparse gesture selection/activation, 64-bit parameter and encoder masks, high-index gesture UI/controller/persistence behavior, and set-bit traversal for compute and editing. No OpenSpec checkboxes or progress files were edited.

## RED evidence

The tests were added before production changes and the prescribed binaries were built/run.

- `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation` failed because `SetGestureCount(65)` returned true.
- `gesture_masks_visit_only_active_bits_through_index_63` failed because `activeGestureVisits` remained zero.
- `ui_state_reports_affecting_masks_through_gesture_index_63` failed because the UI field was still 32-bit.
- `portable_ui_tests` aborted at `gesture 16 badge is one-based`; the bit-63 assignment also produced the expected 64-to-32-bit narrowing warning.
- After adding the explicit manager UI aggregation boundary assertion, it failed at `bankAffectingCount[63] == 2` while the implementation still truncated the gesture selector/local iteration to 32 bits.
- After adding direct `Gestures(65)` validation coverage, it failed because the public selector-owning type still accepted an unrepresentable topology.

`instrument_tests` already preserved a `MessageIn::gestureIx` of 63 through JSON, confirming that its index field itself was not the truncation point.

## GREEN implementation

- Added `synth::GestureMask = std::uint64_t` and used it for manager selection, per-parameter/per-scene active masks, parameter snapshots, bank gesture unions, and encoder draw snapshots.
- Replaced `Gestures::selected_` with `selectedMask_` and exposed `SelectedMask()`.
- Replaced per-scene/per-gesture active byte arenas with one 64-bit active mask per parameter scene in both initial and extra storage batches.
- Added a checked count-mask helper and one `std::countr_zero`/clear-low-bit iterator.
- Migrated gesture compute, selected-gesture arming, and active edit distribution to set-bit iteration. `activeGestureVisits` increments exactly once for each active bit evaluated by compute.
- Preserved selection-versus-activation and scene blend weighting semantics.
- Rejected counts above 64 before manager topology mutation and rejected direct `Gestures` construction above 64.
- Widened parameter/UI/bank/encoder gesture-affecting masks through bit 63.
- Kept `GestureManagerUIState::bankAffectingMask` and MIDI controller reads at 32 bits because that mask selects banks, not gestures. Widened only the temporary gesture selector used to populate it and extended its gesture-index loop through 63.
- Preserved gesture badges 0-15 and assigned one-based numeric labels 17-64 to indices 16-63.
- Extended deterministic coverage for boundary indices, sparse visits, high-index arming/editing, scene-union UI masks, rendered badge 64, message input, parameter patch persistence, manager bank-affecting publication, and the randomized UI oracle mask type.

## Files changed

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/include/synth/EncoderDraw.hpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/portable_ui_tests.cpp`
- `projects/synth/tests/instrument_tests.cpp`

## GREEN verification

Executed exactly:

```text
make -C projects/synth build/parameter_modulation_tests build/portable_ui_tests build/instrument_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/portable_ui_tests
projects/synth/build/instrument_tests
```

Final result: all builds and all three binaries exited 0 with no compiler warnings.

Also ran `git diff --check`; it exited 0.

## Claude review fix

The first Claude code-quality review identified one Important encapsulation issue: `ParameterManager` granted all of `Parameter` friendship solely to read the selection mask. The fix added the narrow, const, O(1) `ParameterManager::SelectedGestureMask()` accessor, updated gesture arming to use it, and removed the broad friendship.

Strict TDD evidence for the fix:

- RED: the focused manager boundary assertion failed to compile with `no member named 'SelectedGestureMask' in 'synth::ParameterManager'`.
- GREEN: after adding the accessor and removing friendship, the prescribed parameter modulation, portable UI, and instrument builds/binaries all exited 0 with no warnings.
- `git diff --check` exited 0 after the review fix.
