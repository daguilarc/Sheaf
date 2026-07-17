# Task 5 Report: Grid Mapping Model and View-Model Ownership

## Summary

Implemented the JUCE-free Task 5 model and the dispatched pure/model portion of OpenSpec 6.4:

- Added `GridButton`, `GridBlock`, paired `GridMappingExpansion`, and reconstruction result types.
- Added exclusive signed rectangle expansion with x varying fastest, shared physical/logical `(x,y)`, momentary press/release, feedback, and derived polyphonic pressure.
- Made expansion all-or-nothing across system and pressure vectors, including overflow, physical-shape, and duplicate-address validation.
- Added exact one-to-one grid-pair reconstruction, deterministic maximal rectangle coalescing, broken-run splitting, duplicate exclusion, and caller-order orphan pressure preservation.
- Extended the Controllers view model with grid-button/grid-block presentation rows, stable open-session ownership, atomic edit/add/delete/flush behavior, normalization, and a hidden orphan-pressure sidecar.
- Kept portable/JUCE rendering out of scope for Task 6.

Grid concepts have no toggle field and never expose a standalone pressure/aftertouch row.

## Files Changed and Committed

- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

No OpenSpec checkbox, shared progress file, prior report, portable UI, JUCE, plan artifact, or `projects/synth/miniapp/` file was staged.

## RED Evidence

1. Expansion RED
   - Command: `make -C projects/synth build/blocks_tests`
   - Result: exit 2; compile failed on missing `GridButton`, `GridBlock`, `GridMappingExpansion`, `ExpandGridButton`, and `ExpandGridBlock`.

2. Reconstruction RED
   - Command: `make -C projects/synth build/blocks_tests`
   - Result: exit 2; compile failed on missing `ReconstructGridMappings`.

3. View-model/session RED
   - Command: `make -C projects/synth build/viewmodel_tests`
   - Result: exit 2; compile failed on missing grid row kinds, `GridSlotIx`, `AddGridButton`, and `AddGridBlock`.

4. Audit regression RED
   - Command: `make -C projects/synth build/blocks_tests && projects/synth/build/blocks_tests`
   - Result: exit 1; repeated expansion at an existing physical address was incorrectly accepted. The expansion preflight was then extended to reject collisions with existing output atomically.

## GREEN and Verification Evidence

- Focused pure model:
  - `make -C projects/synth build/blocks_tests && projects/synth/build/blocks_tests`
  - Result: exit 0, all block/model tests passed.
- Focused view model:
  - `make -C projects/synth build/viewmodel_tests && projects/synth/build/viewmodel_tests`
  - Result: exit 0, all view-model tests passed.
- Final focused gate:
  - `make -C projects/synth build/blocks_tests build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests && git diff --check`
  - Result: exit 0, both binaries passed and whitespace audit was clean.
- Full synth suite:
  - `make -C projects/synth test`
  - Result: exit 0. This included the UI-boundary check and all JUCE-free synth targets, including blocks, view model, portable Controllers UI, runtime, engine, MIDI, rigs, browser, and deadline coverage.

## Commit

- Commit: `4f7b613e`
- Message: `feat(synth): model grid mapping blocks`
- Staged scope: exactly the six files listed above.

## Risks / Minors

- Reconstruction canonicalizes matching rectangles to ascending-y row-major form so shuffled inputs converge. Descending authored blocks remain supported by expansion and round-trip to identical normalized system/pressure meaning, but their presentation direction is canonicalized on reopen.
- Launchpad derived pressure uses MIDI channel 0 with `LaunchpadPositionToNote`; WRLD.Bldr uses the configured channel with `WrldBldrPositionToCC`, matching the existing controller address helpers.
- Duplicate physical system associations are intentionally not claimed as grid rows because ownership is ambiguous; they stay ordinary system mappings and their pressure entries stay hidden/orphaned.
- Task 6 still needs to add portable/JUCE rendering and action routing for the new row kinds/fields. Existing portable tests compile and pass, but no new renderer surface was added here.

## Review Fix: Restore Approved Task 5 Scope

Claude review correctly identified that the original Task 5 implementation over-scoped the approved brief/plan by including Controllers view-model/session work. Task 5 is restricted to the pure grid model in `MidiConfigBlocks`; all view-model behavior, including the planned `RowGroup::Grid` and `hiddenPressureMappings` design, belongs to Task 6.

This section supersedes the earlier report statements that claimed Task 5 implemented OpenSpec 6.4 or committed view-model files.

### Mechanical restoration

Restored these files byte-for-byte from reviewed Task 4 base `a193309e`:

- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

The three correct Task 5 files remain unchanged:

- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/tests/blocks_tests.cpp`

### Verification after restoration

- `make -C projects/synth build/blocks_tests build/viewmodel_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests`
  - Result: exit 0; both focused binaries passed.
- `make -C projects/synth test`
  - Result: exit 0; full synth suite and UI-boundary check passed.
- `git diff --quiet a193309e -- <three view-model files>`
  - Result: exit 0; all three view-model files exactly match the reviewed base.
- `git diff --name-only a193309e -- projects/synth`
  - Result: exactly the three `MidiConfigBlocks` Task 5 files listed above.
- `git diff --check`
  - Result: exit 0.

### Correction commit

- Commit: `2ea3a2794abd6cf67d552ebae543e41ff9314e36`
- Message: `fix(synth): keep grid model task pure`
- Staged scope: exactly the three restored view-model files; no report, plan, OpenSpec, progress, prior-report, or miniapp artifact was staged.

### Final Task 5 scope

The cumulative synth source/test diff from `a193309e` now contains exactly:

1. `projects/synth/include/synth/MidiConfigBlocks.hpp`
2. `projects/synth/src/MidiConfigBlocks.cpp`
3. `projects/synth/tests/blocks_tests.cpp`

Task 6 must implement Controllers view-model/session ownership using its approved planned structures rather than the reverted Task 5 approach.
