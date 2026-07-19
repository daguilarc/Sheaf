Layout fix looks correct: `MappingRow` now builds and walks `orderedEditors_` in `editableFields` order, and headers use the same `FieldEditorWidth()` walk. The Twister analog `GroupSupportsAdd == true` case is not a renderer-reachable bug: the page only constructs sections from `rowVm.sections`, and those are kind-filtered via `SectionsForKind()`, so Twister never gets an Analogs `SectionBody`.

1. **Minor**: The drift test still does not enforce the claimed strict refusal equality when `GroupSupports*` is false. It only checks `!addSucceeded` / `!blockSucceeded`; it does not assert the refusal reason is the dispatch catch-all. A future AddSingle/AddBlock branch could drift into a currently unsupported pair, refuse for an in-branch runtime reason, and this test would still pass. See [viewmodel_tests.cpp](/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/viewmodel_tests.cpp:2808).

SPEC: PASS
QUALITY: NEEDS-FIXES