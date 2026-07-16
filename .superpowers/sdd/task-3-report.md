# Task 3 Report — Absolute Message Serialization and Routing

## Status

DONE. Implemented OpenSpec tasks 3.1 and 3.2 in commit `a3de4ecc` (`feat(synth): route absolute parameter messages`). The OpenSpec checklist itself was intentionally not edited; the orchestrator will update it only after external spec and quality review.

## Scope Implemented

- Added `MessageIn::Type::ParamSetAbsolute` adjacent to `ParamIncDec`, with the static constructor payload `(timestamp, slotIx, position, normalizedValue)`.
- Added exact JSON name `paramSetAbsolute`, parsing, round-trip preservation, and controller system-association preservation.
- Added parallel `HandleSetAbsolute` routing through `ParameterManager`, `BankSlot`, and `Bank`, for both physical encoder IDs and `(slotIx, position)` addresses.
- Routed the selected bank's currently visible cell using the owning manager scene, including a visible modulation-depth parameter without changing its hidden parent.
- Added the same effective-modifier gate as `ParamIncDec` and preserved no-op behavior for absent slots, out-of-range positions, disconnected slots, and empty mapped cells.
- Updated declaration-order sort metadata, exhaustive switches, system-message output classification, the view-model system-message catalog, and its argument/edit handling.

## TDD Evidence

### RED

Command:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests
```

Result: exit `2`, expected compile failure before production changes. Representative diagnostics:

```text
error: no member named 'ParamSetAbsolute' in 'synth::MessageIn'
error: no member named 'ParamSetAbsolute' in 'synth::MessageIn::Type'
error: no member named 'HandleSetAbsolute' in 'synth::ParameterManager'
13 errors generated.
make: *** [build/parameter_modulation_tests] Error 1
```

This RED directly proved the new message and routing APIs did not exist.

### GREEN

Command, rerun after the commit:

```bash
make -C projects/synth build/parameter_modulation_tests build/blocks_tests build/viewmodel_tests && \
projects/synth/build/parameter_modulation_tests && \
projects/synth/build/blocks_tests && \
projects/synth/build/viewmodel_tests
```

Result: exit `0`. All three binaries passed, including the new tests:

- `param_set_absolute_message_constructs_and_round_trips_exact_payload`
- `param_set_absolute_survives_controller_system_association_round_trip`
- `param_set_absolute_routes_by_selected_bank_slot_position_and_physical_encoder`
- `param_set_absolute_edits_visible_modulation_depth_not_hidden_parent`
- `param_set_absolute_is_blocked_by_every_effective_modifier`
- `param_set_absolute_unmapped_boundaries_are_no_ops`
- `SortKeyIncludesAbsolutePayloadAddressAdjacentToRelativeTurns`
- `UISystemMessageCatalogExpansionCoversPressAndReleaseSemantics`

`git diff --check` also exited `0` after the commit.

## Changed Files

- `projects/synth/include/synth/ParameterModulation.hpp`
- `projects/synth/src/ParameterModulation.cpp`
- `projects/synth/src/MidiController.cpp`
- `projects/synth/include/synth/MidiConfigBlocks.hpp`
- `projects/synth/src/MidiConfigBlocks.cpp`
- `projects/synth/include/synth/MidiConfigViewModel.hpp`
- `projects/synth/src/MidiConfigViewModel.cpp`
- `projects/synth/tests/parameter_modulation_tests.cpp`
- `projects/synth/tests/blocks_tests.cpp`
- `projects/synth/tests/viewmodel_tests.cpp`

## Self-Review

- The bus checks `GetCurrentModifier() == Modifier::None` before dispatch, exactly matching relative turns.
- The route resolves the slot position to a physical encoder, checks selected-bank ownership, then looks up the bank's visible cell; this makes modulation views authoritative and preserves every existing no-op boundary.
- The manager supplies its own `scene_`; callers cannot accidentally provide a foreign scene through the message path.
- Existing `ParamIncDec` logic and message payload behavior were not changed.
- Only task-scoped synth source/tests were committed. Existing report/progress/OpenSpec/plan changes and `projects/synth/miniapp/` remain uncommitted and untouched by this task.

## Concerns

None blocking. `ParamSetAbsolute` is intentionally exposed in the generic system-message catalog because Task 3 requires catalog/exhaustive handling; its feedback evaluation is intentionally empty, like other parameter-edit messages.
