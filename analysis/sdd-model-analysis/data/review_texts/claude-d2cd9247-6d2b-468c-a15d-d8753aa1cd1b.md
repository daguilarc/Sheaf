# Task 1 Spec-Compliance Review

## Findings

### Critical
None.

### Important
None.

### Minor

1. **`projects/synth/src/ParameterModulation.cpp:96`** (post-diff numbering, within `RandomizeModulationDepths`) — the call to `EnsureModulationDepthParameter(parameter, modIx)` re-checks `metadata[modIx].connected`, which is already guaranteed true by the preceding ordinal-mapping scan. This is harmless (matches the brief's own reference implementation verbatim) and not a spec deviation — noting only as a redundant-but-intentional guard, not an actionable defect.

2. **Report process note** — `task-1-report.md:127` states the Claude xagent spec-compliance and code-quality reviews were not run by the implementer, with review-gate ownership explicitly retained by the controller (this review fulfills that gate). Not a code defect.

## Verification against requested behavior

- **Disconnected metadata never exposes/materializes a UI depth, even with an explicit depth**: `Bank::EnsureModulationDepthParameter` (diff lines 27-40) checks `Metadata(modIx).connected` *before* returning any existing depth pointer. Confirmed via `modulation_view_leaves_disconnected_sources_empty_and_hides_explicit_depths` (diff lines 330-409): `carrier.ModulationDepthParameter(1) == &hiddenDepth` (explicit depth still exists via the direct Parameter API) while `bank.VisibleParameter(11) == nullptr` (hidden at the UI/Bank layer).

- **Fixed disconnected physical cells stay null/noninteractive**: same test asserts `ui->slots[0].cells[1].connected.load() == false`, and turning/pressing physical position 11 under no-modifier, Reset, Random, and Random Mod all leave the hidden depth value, selected target, parameter count, and all three random callback counters unchanged. `OpenModulationView` itself is untouched by the diff — the gating flows entirely through the modified `EnsureModulationDepthParameter`.

- **Capacity preflight counts connected missing depths only**: `Bank::MissingModulationDepthCount` (diff lines 46-56) now requires both `connected` and a null depth pointer. Confirmed via `modulation_view_capacity_counts_only_connected_missing_depths` — with one free slot and only index 2 connected, the view opens, materializes only index 2, and indexes 0/1 stay null while the return cell is preserved.

- **Random Mod counts/samples connected sources only, maps ordinal in configured-index order without allocation, no-ops at zero connected, preserves stop-on-materialization-failure**: `Bank::RandomizeModulationDepths` (diff lines 68-103) computes `connectedCount` via `count_if` over the metadata span (no vector allocation), returns immediately when zero, passes `connectedCount` as the exclusive max to `NextRandomIndex`, and walks metadata in index order decrementing the sampled ordinal to find `modIx`. Confirmed via `random_mod_maps_connected_ordinals_and_skips_disconnected_sources` (asserts `exclusiveMax == 2` with 5 configured but 2 connected sources, and that only index 4 materializes after scanning across three disconnected positions) and `random_mod_with_no_connected_sources_is_a_noop` (all three random callback counters stay at zero, no parameter storage consumed). Stop-on-materialization-failure is preserved unchanged (`if (depthParameter == nullptr) return;`).

- **Existing explicit depth APIs, persistence, DSP routes, fixed topology unchanged**: the diff touches only three `Bank` methods; `OpenModulationView`'s fixed-index loop, null-cell insertion, pinning, return-cell placement, and low-storage request path are untouched (no diff hunk over that function body).

- **Engine fixture expansion minimality**: `engine_tests.cpp` gains exactly a 3-line loop marking both configured modulator sources connected in `engine_tick_replies_to_storage_batch_requests`, preserving that test's prior "two missing UI depths trigger `ParameterStorageBatchNeeded`" contract without any other behavioral change to the fixture.

- **Test migration completeness**: every fixture the brief named — modulation-view open/return/capacity/materialization/nesting/pinning tests, the capacity-no-op test, the geometric Random Mod test, and all five named randomized-simulation tests — has `MarkAllModulatorsConnectedForUi` (or equivalent explicit `connected = true` metadata) applied in the diff, matching the brief's helper implementation verbatim.

No gaps between the brief's prescribed code/tests and the landed diff were found; the implementation is a near-literal realization of the brief.

SPEC COMPLIANCE: PASS