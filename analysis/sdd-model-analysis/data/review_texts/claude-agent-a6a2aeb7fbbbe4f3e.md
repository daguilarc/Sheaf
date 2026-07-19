Clean build from scratch: 534 tests pass, zero failures, zero warnings, and `make apps` links successfully.

## Summary

**Status:** Complete. Commit `5b2e5a7`.

**Fix:** `RebuildPresentationFor` in `projects/synth/src/MidiConfigViewModel.cpp` now runs a new `ReSyncBlockRow` helper (added right after `ReResolveRow`) on every Block row whose identities resolve. It resolves each covered identity back to its raw config cell, gathers just those cells, and re-runs the section's own `ReconstructEncoderBlocks`/`ReconstructAnalogBlocks`/`ReconstructSystemBlocks` over that sub-range. If it still forms exactly one block covering all the cells, the row's `block` struct is overwritten with the freshly-derived (authoritative) values; otherwise the row is dropped like a failed identity resolution, letting the existing `AppendUnresolved*Identities` pass re-append the now-uncovered cells as individual rows. Updated doc comments in `include/synth/MidiConfigViewModel.hpp` (`PresentationRow::block`, `SectionPresentation`) and the matching comment in `ApplyMappingEdit`'s block branch to describe this two-path self-heal instead of the old, incomplete "self-heals via drop/append" claim.

**Tests added** in `projects/synth/tests/viewmodel_tests.cpp` (all four TDD scenarios from the brief):
- `RebuildHealsStagedBlockRowWhenHostDiscardsEdit` — Channel edit staged, host discards, Rebuild(original) heals back to original channel.
- `BlockEditReplacesStartArgumentKeepingRowInPlace` — pre-existing, unchanged, still green.
- `RebuildDropsBlockRowWhenCoveredCellsNoLongerFormOneBlock` — one cell's channel patched to break the run under same identities; block row drops, outlier reappears as an individual row.
- `TwoBlockEditsBeforeAnyRebuildLastEditWins` — documents that each edit reads `instrument_`, not a prior uncommitted edit's `out`; final committed result after Rebuild is coherent.

**Verification:** `make -C projects/synth build test` (clean rebuild): 534 tests pass, 0 failures, 0 warnings. `make -C projects/synth apps`: links cleanly.

Fix note appended to `.superpowers/sdd/blocks-t2-report.md` (gitignored working artifact, not part of the commit).