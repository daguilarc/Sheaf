## Review: 54ce7e7a..94c2ace8

**d4-1 coverage finding — verified fixed.** Both references in `projects/synth/docs/coverage.md` now name `braid4_groups_fit_sparse_fifteen_position_modulation_views` and describe connected-only sparse materialization, not full materialization:
- `projects/synth/docs/coverage.md:93` (summary table): `d4-1 | covered | ... braid4_groups_fit_sparse_fifteen_position_modulation_views`
- `projects/synth/docs/coverage.md:126-127` (requirement mapping): "`braid4_groups_fit_sparse_fifteen_position_modulation_views` checks capacities and connected-only sparse materialization in each group."

The renamed test (`projects/synth/tests/braid4_system_tests.cpp:364-396`) backs this up: it asserts `4 + 8`, `8 + 8`, `48 + 7` connected-depth counts while `VisibleMappingCount() == 16` stays full, matching "connected-only sparse materialization." No stale references remain (`rg` for the old name/phrase in the report returns nothing, and I confirmed the same by reading the diff directly).

**Technical dispositions — all verified sound:**

1. **Relaxed-atomic ordering in `Braid4UI.hpp:58-60,65-68`**: `showingModulationView` is loaded independently from `state.connected` (itself populated through a separate acquire/release-guarded seqlock in `EncoderDrawStateFromParameter`, `projects/synth/include/synth/EncoderDraw.hpp:306-321`). These are genuinely two independently-published values with no cross-synchronization, so a torn read is possible. This matches the file's pre-existing pattern throughout (`Braid4UiModel.hpp:302-333,346-368` compose many independent relaxed loads into a snapshot with no atomic-transaction across them), so the one-frame-tolerance framing is consistent with the established architecture, not a new defect.

2. **`ParameterManager::NextRandomIndex` modulo-normalization** (`projects/synth/src/ParameterModulation.cpp:3049-3058`): confirmed `randomIndexSource_(exclusiveMax) % exclusiveMax`, so the returned ordinal is always `< connectedCount` when `connectedCount > 0`. The ordinal-to-`modIx` walk in `RandomizeModulationDepths` (`ParameterModulation.cpp:2449-2459`) is guaranteed to terminate on a connected entry within `metadata.size()`. Correct.

3. **Persistence/migration untouched**: `ModulatorMetadata::connected` (`ParameterModulation.hpp:208-214`) is a plain in-memory field set at registration time, not part of any serialized patch schema. No round-trip/migration code path is affected by this change, so excluding it from scope is appropriate.

No other Critical or Important issues found in the cumulative delta — `EnsureModulationDepthParameter`, `MissingModulationDepthCount`, `OpenModulationView`, and the new test coverage are internally consistent (e.g., explicitly-assigned depths on disconnected sources correctly stay allocated but hidden from the visible view, per `parameter_modulation_tests.cpp:672-751`).

CODE QUALITY: PASS