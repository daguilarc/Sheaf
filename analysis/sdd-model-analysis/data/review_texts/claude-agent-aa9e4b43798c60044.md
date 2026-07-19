All three reviewer findings are fixed, verified, and committed.

**Status: complete.**

**Commit:** `4a719bf2ae2153fee02a619c7db530ea2d463127` — "fix(synth-runtime): schema-driven headers and VM-owned add affordances"

**Test summary:** `make -C projects/synth build test` → 539 tests pass (536 pre-existing + 3 new), 0 failures, 0 warnings (`-Wall -Wextra -Wpedantic`). `make -C projects/synth apps` links cleanly with 0 warnings/errors. Launch smoke (`SynthMiniapp` under an 8s timeout) started normally — MIDI reconcile and audio device open/prepare logged, no crash/error output.

**What changed:**
1. **Finding 1** (`runtime/ControllersPage.hpp`, `SectionBody` constructor): header runs now split whenever a row's full `editableFields` vector differs from the previous row's, not just `(RowGroup, Kind)` — fixes BankSelect vs SceneSelect/GestureSelect System Block rows silently sharing a mislabeled header.
2. **Finding 2**: added `MidiConfigViewModel::GroupSupportsAdd`/`GroupSupportsBlocks` (`include/synth/MidiConfigViewModel.hpp`, implemented next to `AddBlock` in `src/MidiConfigViewModel.cpp`); deleted the page's local `AddableGroup`/`GroupSupportsBlocks` statics and the now-unused `controllerKind` parameter threaded through `SectionBody`.
3. **Finding 3**: added `ControllersPage::FieldEditorWidth(Field)` as the single source of per-field editor width, used by `MappingRow::resized()`, `RowGroupHeader::resized()` (via a new `columnFieldWidths_` vector), and `SectionBody::RequiredRowWidth()`.

New tests in `projects/synth/tests/viewmodel_tests.cpp`: `GroupSupportsAddAndBlocksMatchesAddSingleAddBlockDispatch`, `GroupSupportsAddOutOfRangeControllerIxReturnsFalse`, `BankSelectBlockEditableFieldsDifferFromSceneSelectBlockInSameGroup`.

Fix note appended to `.superpowers/sdd/blocks-t3-report.md` (this file is gitignored, so it wasn't included in the commit).