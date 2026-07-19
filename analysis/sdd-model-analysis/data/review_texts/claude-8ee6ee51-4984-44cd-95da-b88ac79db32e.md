## Re-review result: d4498d81..653f8b1e (commits 8693e629, 653f8b1e)

**SPEC COMPLIANCE: PASS**
**CODE QUALITY: PASS**

### Verification performed

- Read `task-1-brief.md`, `task-1-report.md`, the full 1298-line review diff, plan `2026-07-16-add-absolute-encoder-mode.md` (Global Constraints + Tasks 1/5), and all OpenSpec artifacts (`proposal.md`, `design.md`, `tasks.md`).
- Built and ran all four Task 1 gate binaries (`parameter_modulation_tests`, `viewmodel_tests`, `blocks_tests`, `controllers_page_ui_tests`) from the actual worktree — all exit 0, no `FAIL` lines.
- Confirmed by name that the new/fixed tests pass: `EncoderModeCatalogExposesAllChoicesInDeclarationOrder`, `EncoderModeIndexRoundTripsThroughApplyMappingEditAndRowFieldValue`, `AbsoluteEncoderModeHasItsOwnCatalogIndexAndRowValue`, `EncoderModeIndexOutOfRangeIsRefused`, `encoder_mode_contract_defaults_to_signed_7_bit`, `encoder_mode_json_round_trips_absolute_and_writes_new_field_only`, `encoder_mode_json_loads_legacy_field_and_migrates_on_save`, `encoder_mode_json_new_field_is_authoritative`.
- `git log d4498d81..653f8b1e` confirms exactly the two expected commits; `git status` confirms the working tree has zero drift from `653f8b1e` for every Task-1-touched file.

### Prior Important defect — verified fixed

`EncoderModeCatalog()` now has 3 entries in declaration order (`MidiConfigViewModel.cpp:340`), and both mapping sites were converted from the old hardcoded two-value ternary to generic index↔enum casts, bounds-checked against `catalog.size()`:
- `RowFieldValue` (`MidiConfigViewModel.cpp:492-505`): returns `static_cast<double>(index)` for `Signed7Bit=0`, `DirectionOnly=1`, `Absolute=2`; returns `false` if the stored enum value is out of catalog range rather than aliasing to 0.
- `ApplyMappingEdit` (`MidiConfigViewModel.cpp:554-570`): rejects any index outside `[0, catalog.size()-1]` (index 3 now correctly refused, per updated `EncoderModeIndexOutOfRangeIsRefused` test), and maps valid indices via `static_cast<EncoderMode>(index)` instead of a hardcoded two-branch check.

All three declaration-order values now have truthful, symmetric catalog/read/edit mappings, and invalid values (out-of-range index, out-of-range stored enum) are rejected rather than silently aliased.

### Task 5 scope preserved

The fix touches only catalog size, index mapping, and comments/labels — it does not add non-deletable-row semantics, `turnStep` retention labeling, open-session identity across commit/rebuild, or live processor reconstruction, all of which remain unimplemented and correctly deferred per `tasks.md` Task 5 (`plan:165-171`) and the task report's own note ("Task 5 still owns the deeper open-session identity, commit/rebuild, and live processor reconstruction behavior"). No hardcoded catalog-size-2 assumptions remain anywhere else in the tree (`controllers_page_ui_tests.cpp`, `portable_ui_tests.cpp`, `blocks_tests.cpp` were grepped and are clean).

### Task 1 contract and JSON compatibility — reconfirmed

- `static_assert`s at `parameter_modulation_tests.cpp:853-855` pin declaration order `Signed7Bit=0, DirectionOnly=1, Absolute=2`.
- `FromJSON`/`ToJSON` for `EncoderMode` cover all three values; invalid/unknown `mode` strings fail without fallback.
- `ObjectHasKey` (`MidiController.cpp:617-629`) correctly distinguishes an absent `mode` key from an explicit JSON `null` value (`Get(key).IsNull()` conflates both, since `Get` returns `JSON::Null()` for a missing key and a real `Null`-typed node for an explicit null) — this fixes the authority edge case the self-review caught, verified by the passing `encoder_mode_json_new_field_is_authoritative` test's explicit-null case.
- Legacy `relativeMode` fallback and new-field authority both verified; only deliberate legacy fixtures/parser-compat references to `relativeMode` remain repo-wide (`rg` confirmed).

### Final verdict: **PASS** — no new issues found; approve.