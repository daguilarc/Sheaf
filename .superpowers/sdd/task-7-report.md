# Task 7 Report: Documentation And Full Verification

## Status

Complete.

- Reviewed base: `5b9653a1208efe93ae021676c0cfc2c3365dba2f`
- Commit: `f9da0bc7` (`docs(synth): verify runtime button grids`)
- Review fix commit: `f99981d1`
  (`docs(openspec): complete runtime button grid verification`)
- Committed files:
  - `projects/synth/README.md`
  - `projects/synth/docs/coverage.md`
- `projects/synth/Makefile` required no change: the grid core, all focused
  binaries, the full test target, and JUCE harness dependencies were already
  wired.
- Review fix: the first Task 7 commit incorrectly omitted OpenSpec task items
  7.1-7.4 and the shared progress entry even though their verification evidence
  had passed. The final reviewer returned `NEEDS_CHANGES` solely for that
  traceability gap. This follow-up marks exactly 7.1-7.4 complete and records
  Task 7 in the shared progress ledger; no production or documentation content
  changes in the fix.

## Documentation

The README now documents the JUCE-free `ButtonGrid` architecture, signed
half-open ranges, independent parameter/grid slot namespaces, exact selection,
the finalization and realtime contract, packed atomic colors, all four grid
`MessageIn` variants, `RuntimeUIState`, profile schema 1 reads/schema 2 writes,
polyphonic-pressure derivation, exact Controllers pairing, hidden orphan
preservation, and unchanged output protocols. It explicitly records that
application grid creation, exposure, and rendering are intentionally out of
scope.

The coverage document now maps `bgr-1` through `bgr-5`, `spm-75` through
`spm-78`, `sar-24`, `sru-26`, and `sru-27` to named test files/binaries and
records the allocation/pointer-stability and output-golden evidence.

## Verification Commands And Results

### Focused JUCE-free feature matrix

```text
make -C projects/synth build/button_grid_tests build/parameter_modulation_tests build/instrument_tests build/blocks_tests build/viewmodel_tests build/engine_tests build/rig_tests build/miniapp_system_tests build/controllers_page_ui_tests && projects/synth/build/button_grid_tests && projects/synth/build/parameter_modulation_tests && projects/synth/build/instrument_tests && projects/synth/build/blocks_tests && projects/synth/build/viewmodel_tests && projects/synth/build/engine_tests && projects/synth/build/rig_tests && projects/synth/build/miniapp_system_tests && projects/synth/build/controllers_page_ui_tests
```

Result: exit 0. All nine binaries passed. No compiler warning was emitted. The
engine logging test printed its expected missing/save runtime-config records.

### Controllers JUCE harness and simulation

```text
make -C projects/synth/apps/miniapp test
```

Result: exit 0. All eight JUCE harness executables passed, including:

```text
ControllersPageJuceTests passed
GridControllersSimulation passed seed=0x6a1d2026 operations=320 accepted=200
ControllersPageSimulationTests passed seed=0x5eaf2026
```

The host printed the existing CoreMIDI no-device diagnostic; it did not affect
any executable result.

### Complete synth suite

```text
make -C projects/synth test
```

Result: exit 0. The UI boundary and every synth test binary passed. The known
host-scheduling-sensitive Braid benchmark did not flake in this run:

```text
[deadline] baseline 96000Hz/384000Hz-internal avg=1.07493ms p99=1.18687ms block=2.66667ms
[PASS] braid4_meets_96000hz_256_frame_deadline_and_continuity
```

Its p99 limit is 2.13333 ms. Because the full-suite case passed, no isolated
rerun was needed and no test threshold was changed.

### Build, static boundary, and app wiring

```text
make -C projects/synth build
make -C projects/synth check-ui-boundary
make -C projects/synth/apps/miniapp
```

Result: all exit 0. The miniapp rebuilt and linked the complete synth/JUCE
source set under `-Wall -Wextra -Wpedantic` without compiler warnings. There is
no separate synth formatter or static-analyzer target; the warning-enabled
build, UI dependency boundary, placeholder scan, and diff checks are the
repository-provided static/format gates.

### OpenSpec and repository checks

```text
openspec validate add-runtime-button-grids --type change --strict --no-interactive
```

Result: exit 0, `Change 'add-runtime-button-grids' is valid`.

```text
openspec status --change add-runtime-button-grids --json
```

Result: exit 0. JSON reports `isComplete: true` and proposal, design, specs,
and tasks all `done`.

```text
rg -n "T[B]D|T[O]DO|implement la[t]er|fill i[n]" openspec/changes/add-runtime-button-grids docs/superpowers/plans/2026-07-16-add-runtime-button-grids.md
```

Result: no matches (the direct `rg` no-match exit is 1, which is the expected
successful audit result).

```text
git diff --check
git diff --cached --check
```

Result: both silent/exit 0 before commit. The staged path audit contained only
the two documentation files listed above.

### Allocation, pointer stability, and unchanged output goldens

`projects/synth/tests/button_grid_tests.cpp` test
`finalization_rejects_late_topology_and_runtime_operations_keep_storage_stable`
records grid/slot pointers, snapshot vector capacities, and snapshot backing
storage addresses, then selects, routes press/pressure/release, and publishes
after finalization. It asserts every capacity/address/pointer remains unchanged
and asserts late topology mutation throws. The focused and full-suite runs both
passed this test. This is the approved capacity/storage-address evidence; no
global allocation interceptor was introduced.

The existing output golden blocks were checked against the pre-feature base:

```text
git diff --unified=0 d4498d81..HEAD -- projects/synth/tests/parameter_modulation_tests.cpp
```

The Task 1-6 range adds the mixed grid-bus test and extends its seeded oracle;
it does not edit or regenerate the existing WRLD.Bldr, Launchpad, Twister,
generic/monochrome output byte assertions. The freshly run
`parameter_modulation_tests` passed those exact byte, cache, reset, brightness,
and budget assertions.

## Normative Scenario Audit

Every scenario in the four delta specs has at least one covering test below.

### `synth-button-grid-runtime`

#### `bgr-1`

- **Exclusive signed range addresses expected cells** —
  `tests/button_grid_tests.cpp`:
  `grid_range_is_checked_signed_half_open_and_row_major`.
- **Two controllers may use the same coordinates** —
  `tests/button_grid_tests.cpp`:
  `equal_range_slots_keep_selection_and_routing_independent`.
- **Parameter and grid slots do not alias** —
  `tests/parameter_modulation_tests.cpp`:
  `message_bus_routes_parameter_and_grid_families_without_namespace_aliasing`.
- **Invalid range is rejected atomically** —
  `tests/button_grid_tests.cpp`:
  `grid_range_is_checked_signed_half_open_and_row_major`.

#### `bgr-2`

- **Matching grid selects into slot** — `tests/button_grid_tests.cpp`:
  `grid_routing_calls_each_callback_and_ignores_invalid_targets`.
- **Range mismatch preserves selection** — `tests/button_grid_tests.cpp`:
  `grid_routing_calls_each_callback_and_ignores_invalid_targets`.
- **Events reach the matching callback** — `tests/button_grid_tests.cpp`:
  `grid_routing_calls_each_callback_and_ignores_invalid_targets`.
- **Empty and invalid coordinates are no-ops** —
  `tests/button_grid_tests.cpp`:
  `grid_routing_calls_each_callback_and_ignores_invalid_targets`.
- **Duplicate cell registration is rejected** —
  `tests/button_grid_tests.cpp`:
  `grid_routing_calls_each_callback_and_ignores_invalid_targets`.

#### `bgr-3`

- **Toggle changes between on and off** — `tests/button_grid_tests.cpp`:
  `state_cell_modes_follow_toggle_momentary_set_only_and_show_only_contracts`.
- **Momentary releases to off** — `tests/button_grid_tests.cpp`:
  `state_cell_modes_follow_toggle_momentary_set_only_and_show_only_contracts`.
- **Set-only and show-only preserve their contracts** —
  `tests/button_grid_tests.cpp`:
  `state_cell_modes_follow_toggle_momentary_set_only_and_show_only_contracts`.
- **Flash affects color but not on/off** — `tests/button_grid_tests.cpp`:
  `state_cell_flash_policies_choose_palette_without_changing_on_off`.
- **StateCell does not own observed state** — `tests/button_grid_tests.cpp`:
  `state_cell_observes_but_does_not_own_stack_state`.

#### `bgr-4`

- **Colored on cell publishes one atomic value** —
  `tests/button_grid_tests.cpp`:
  `ui_publication_packs_on_off_and_clears_empty_disconnected_and_stale_cells`.
- **Colored off cell retains RGB** — `tests/button_grid_tests.cpp`:
  `ui_publication_packs_on_off_and_clears_empty_disconnected_and_stale_cells`.
- **Empty cell is neutral** — `tests/button_grid_tests.cpp`:
  `ui_publication_packs_on_off_and_clears_empty_disconnected_and_stale_cells`.
- **Grid switch clears stale state** — `tests/button_grid_tests.cpp`:
  `ui_publication_packs_on_off_and_clears_empty_disconnected_and_stale_cells`.

#### `bgr-5`

- **Finalized routing allocates nothing** — `tests/button_grid_tests.cpp`:
  `finalization_rejects_late_topology_and_runtime_operations_keep_storage_stable`
  (capacity and backing-address stability evidence).
- **Late topology mutation fails loudly** — `tests/button_grid_tests.cpp`:
  `finalization_rejects_late_topology_and_runtime_operations_keep_storage_stable`.
- **No arena is required** — `tests/button_grid_tests.cpp`:
  `finalization_rejects_late_topology_and_runtime_operations_keep_storage_stable`
  (dense snapshot storage remains fixed; no growth message exists).

### `synth-parameter-modulation`

#### `spm-75`

- **Grid messages preserve signed coordinates and velocity** —
  `tests/instrument_tests.cpp`:
  `GridMessageInFactoriesCarryFlatSemanticFields` and
  `GridMessageInJsonUsesFlatPerVariantShapeAndRoundTrips`.
- **Grid selection carries a distinct grid index** —
  `tests/parameter_modulation_tests.cpp`:
  `message_bus_routes_parameter_and_grid_families_without_namespace_aliasing`.
- **Mixed messages retain FIFO order** —
  `tests/parameter_modulation_tests.cpp`:
  `message_bus_routes_parameter_and_grid_families_without_namespace_aliasing`
  and `randomized_message_bus_ui_state_simulation`.
- **Invalid external grid target is ignored** —
  `tests/parameter_modulation_tests.cpp`:
  `message_bus_routes_parameter_and_grid_families_without_namespace_aliasing`.

#### `spm-76`

- **Mapped aftertouch becomes grid pressure** — `tests/instrument_tests.cpp`:
  `PolyPressureProcessorStampsMappedPressureAndConsumesExactMatch`.
- **Unmapped aftertouch passes through** — `tests/instrument_tests.cpp`:
  `PolyPressureProcessorPassesUnmatchedAndNonPressureToThruExactlyOnce`.
- **Other MIDI statuses are not consumed** — `tests/instrument_tests.cpp`:
  `BasicMidiPolyPressureRecognizesOnlyCompletePolyphonicAftertouch` and
  `PolyPressureProcessorPassesUnmatchedAndNonPressureToThruExactlyOnce`.
- **Profile factory chains pressure input** — `tests/instrument_tests.cpp`:
  `CreateMidiControllerProfileBuildsPressureOnlyAndSharedMixedThruChains`.

#### `spm-77`

- **Old profile loads without pressure mappings** —
  `tests/instrument_tests.cpp`:
  `ControllerProfileJsonReadsVersionOneWithoutPressureAndPreservesLegacyData`.
- **New profile round-trips grid mapping** — `tests/instrument_tests.cpp`:
  `ControllerProfileJsonWritesSchemaTwoAndRoundTripsPressureInput`, plus
  `tests/blocks_tests.cpp`:
  `ExpandGridButtonProducesAtomicMomentarySystemAndPressurePair`.
- **Normalization is deterministic** — `tests/blocks_tests.cpp`:
  `NormalizeSortsPressureMappingsByLogicalTargetThenPhysicalAddress` and
  `NormalizePressureOrderingConvergesAndKeepsEqualKeysStable`.
- **Instrument schema delegates nested profile version** —
  `tests/instrument_tests.cpp`:
  `InstrumentJsonKeepsEnvelopeSchemaAndDelegatesPressureProfileVersion`, and
  `tests/rig_tests.cpp`:
  `rig_runtime_config_round_trips_nested_pressure_profile_without_changing_envelopes`.

#### `spm-78`

- **Colored grid feedback uses RGB** — `tests/instrument_tests.cpp`:
  `GridFeedbackReadsOnlyTheImmutableRuntimeSnapshot`, composed with the existing
  color-protocol golden tests in `tests/parameter_modulation_tests.cpp`:
  `system_output_processors_debounce_reset_and_render_cc_and_wrld_bldr` and
  `launchpad_color_sysex_uses_controller_product_and_rgb_note`.
- **Monochrome grid feedback uses on/off** — `tests/instrument_tests.cpp`:
  `GridFeedbackReadsOnlyTheImmutableRuntimeSnapshot`, composed with
  `tests/parameter_modulation_tests.cpp`:
  `system_output_processors_debounce_reset_and_render_cc_and_wrld_bldr`.
- **Missing grid target is blank** — `tests/instrument_tests.cpp`:
  `GridFeedbackReadsOnlyTheImmutableRuntimeSnapshot`.
- **Existing output protocols remain stable** —
  `tests/parameter_modulation_tests.cpp`:
  `system_output_processors_debounce_reset_and_render_cc_and_wrld_bldr`,
  `launchpad_color_sysex_uses_controller_product_and_rgb_note`,
  `launchpad_output_processor_debounces_reset_and_uses_system_info`,
  `twister_output_debounces_reset_and_uses_channels`, and the remaining
  WRLD.Bldr/Twister blanking, cache, and budget cases. The history audit proves
  these golden blocks were not regenerated.

### `synth-app-runtime`

#### `sar-24`

- **Grid manager follows runtime lifetime** — `tests/engine_tests.cpp`:
  `engine_owns_stable_runtime_grid_state_and_routes_both_buses`.
- **Initialization allocates before processors start** —
  `tests/engine_tests.cpp`:
  `engine_owns_stable_runtime_grid_state_and_routes_both_buses`.
- **Both buses can route both control families** — `tests/engine_tests.cpp`:
  `engine_owns_stable_runtime_grid_state_and_routes_both_buses`.
- **MIDI processors receive global state** — `tests/engine_tests.cpp`:
  `engine_owns_stable_runtime_grid_state_and_routes_both_buses`, plus
  `tests/instrument_tests.cpp`:
  `GridFeedbackReadsOnlyTheImmutableRuntimeSnapshot`.
- **Existing apps require no grid integration** — `tests/rig_tests.cpp`:
  `rig_existing_app_keeps_parameter_ui_contract_with_empty_grid_snapshot`, and
  `tests/miniapp_system_tests.cpp`:
  `miniapp_existing_surface_keeps_parameter_ui_contract_without_grid_integration`.

Application-level grid creation, exposure, and rendering remain intentionally
out of scope. This is the approved non-goal, not incomplete implementation.

### `synth-runtime-ui`

#### `sru-26`

- **Grid block expands all input behavior** — `tests/blocks_tests.cpp`:
  `ExpandGridBlockTraversesSignedExclusiveRangeXFastAndPairsEveryCell`.
- **Single grid button hides MIDI mechanics** —
  `tests/viewmodel_tests.cpp`:
  `GridPresentationReconstructsWrldBldrBlockAndLaunchpadButtonWithoutPressureRows`,
  plus `controllers_page_ui_tests` and `controllers_page_juce_tests`.
- **Exact mappings reconstruct to one block** — `tests/blocks_tests.cpp`:
  `ReconstructGridMappingsCoalescesShuffledExactPairsIntoMaximalRectangle`.
- **Negative coordinates round-trip** — `tests/blocks_tests.cpp`:
  `ExpandGridBlockTraversesSignedExclusiveRangeXFastAndPairsEveryCell` and
  `ReconstructGridMappingsDescendingExpansionRoundTripsCanonicalMeaning`, plus
  `controllers_page_simulation_tests` JSON reload operations.
- **Grid mappings are always momentary** — `tests/blocks_tests.cpp`:
  `ExpandGridButtonProducesAtomicMomentarySystemAndPressurePair` and
  `ExpandGridBlockTraversesSignedExclusiveRangeXFastAndPairsEveryCell`.
- **Orphan pressure data is preserved but hidden** —
  `tests/viewmodel_tests.cpp`:
  `GridOpenSessionOwnsPairsAndPreservesHiddenOrphanAcrossEditDeleteAndReopen`.
- **Pair edit is atomic** — `tests/viewmodel_tests.cpp`:
  `GridInvalidRectangleAndDuplicatePairEditsRefuseAtomically` and
  `GridAddSkipsPhysicalAddressesOwnedByHiddenOrphans`.

#### `sru-27`

- **Pure model builds without JUCE** — `build/blocks_tests`:
  `ExpandGridButtonProducesAtomicMomentarySystemAndPressurePair` and
  `ExpandGridBlockTraversesSignedExclusiveRangeXFastAndPairsEveryCell`.
- **Seeded simulation preserves paired mappings** —
  `controllers_page_simulation_tests`: independent grid oracle seed
  `0x6a1d2026`, 320 operations, 200 accepted mutations.
- **Renderer never exposes aftertouch** — `controllers_page_ui_tests` and
  `controllers_page_juce_tests`: visible Grid Button/Grid Block labels and
  fields with no aftertouch, polyphonic-pressure, MIDI-status, or standalone
  note controls.

## Scope And Residuals

- Fresh post-commit verification reran
  `make -C projects/synth test && make -C projects/synth/apps/miniapp test`;
  both targets exited 0. A fresh strict OpenSpec validation also exited 0,
  committed docs matched `HEAD`, cached/working diff checks were clean, and the
  scenario audit counted 52 delta-spec scenarios and 52 report coverage lines.
- No implementation or test fix was required, so no TDD code cycle was
  triggered and no test was weakened.
- No Makefile change was required.
- The review-fix commit contains the OpenSpec task artifact and accumulated
  Runtime Button Grids progress ledger. The full plan, prior reports, ignored
  Task 7 report, and `projects/synth/miniapp/` remain outside the commit.
- The only known residual is environmental: the 96 kHz Braid deadline test can
  be host-scheduling-sensitive after the logging-heavy suite, but it passed in
  the Task 7 full run. The existing CoreMIDI no-device diagnostics in JUCE
  tests are also environmental and non-failing.
- Application-level grid exposure is intentionally out of scope.
