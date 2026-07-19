I've completed a thorough read of the brief and the uncommitted diff. Here is my spec-compliance review.

## Verdict: No actionable findings

The diff faithfully implements Task 1 as specified in `task-1-brief.md`. All six focus areas check out. (Per my reviewer constraints I read only — I did not build or run the tests.)

## Focus-area verification

**1. Capacity legacy tests connect all configured sources — ✅**
`MarkAllModulatorsConnectedForUi` is defined exactly as prescribed (`parameter_modulation_tests.cpp:144`) and applied to every fixture named in the brief, including all open/return/capacity/materialization/nesting/pinning tests, the message-bus view tests, and all five randomized simulations. Critically, `modulation_view_open_is_noop_when_capacity_cannot_fill_all_modulators` receives the helper (`:3510`), preserving its intent as an *insufficient-connected-capacity* refusal rather than the new all-disconnected empty-view path — exactly as the brief requires.

**2. Partial-connectivity Random Mod regression — ✅**
`random_mod_maps_connected_ordinals_and_skips_disconnected_sources` (`:4023`) configures five modulators, connects only `0` and `4`, leaves `1..3` disconnected, feeds coins `{0.1, 0.7}`, asserts `exclusiveMax == 2`, and returns ordinal `1`. I traced the mapping: ordinal 1 decrements past connected index `0`, scans across disconnected `1/2/3`, and lands on `4`. Assertions confirm only index `4` materializes with value `0.8`, `coinIx==2`, `indexCalls==1`, `valueCalls==1`. Matches the brief precisely.

**3. Disconnected explicit depths remain hidden and inert — ✅**
`EnsureModulationDepthParameter` (`ParameterModulation.cpp:2338-2340`) returns `nullptr` for a disconnected source *before* returning any existing depth, so the explicitly-assigned `hiddenDepth` at index 1 is never surfaced. `OpenModulationView` (`:2398`) routes cell placement through `EnsureModulationDepthParameter`, so position 11 becomes a null cell. The test (`:3630`) asserts `ModulationDepthParameter(1) == &hiddenDepth` (still stored), `VisibleParameter(11) == nullptr` (hidden), and that pressing position 11 under None/Reset/Random/RandomMod leaves the hidden value, target, param count, and all three random counters unchanged (inert).

**4. Preflight counts only connected missing depths — ✅**
`MissingModulationDepthCount` (`:2359-2360`) now increments only when `Metadata(modIx).connected && depth == nullptr`. `modulation_view_capacity_counts_only_connected_missing_depths` (`:3711`) proves it: 3 modulators, 1 free slot, only index 2 connected → view opens, materializes only index 2 (`ParameterCount == 2`), leaves 0/1 null, preserves the return cell at 13.

**5. Connected ordinal mapping is allocation-free — ✅**
`RandomizeModulationDepths` (`:2440-2459`) uses `std::count_if` over the `Metadata()` span plus an in-place ordinal-decrement scan — no temporary vector. `<algorithm>` and `<array>` are already included. Early-returns when `connectedCount == 0`. `random_mod_with_no_connected_sources_is_a_noop` (`:4073`) confirms zero callback calls, null depths, closed view, and unconsumed storage.

**6. Sparse active-route processing unaltered — ✅**
The `.cpp` diff touches only the three prescribed functions (`EnsureModulationDepthParameter`, `MissingModulationDepthCount`, `RandomizeModulationDepths`). `OpenModulationView`'s fixed-index loop, null-cell insertion, pinning, return-cell placement, and low-storage request path are untouched (`:2367-2413`), as is all active-route computation.

## Uncertainty / notes (non-blocking, not findings)

- **Metadata/span size consistency:** `MissingModulationDepthCount` iterates `Config().numModulators` while `RandomizeModulationDepths` iterates `metadata.size()`. `Metadata()` spans `metadata_`, sized to `numModulators` (`ParameterModulation.hpp:251`), so the two are equivalent — no defect, just worth noting the two idioms coexist.
- **Ordinal scan relies on the `NextRandomIndex` contract** (result `< connectedCount`). If a future test double returned `ordinal >= connectedCount`, the scan would exit with `modIx == metadata.size()` and `Metadata(modIx)` would throw via `.at()`. This exactly mirrors the brief's prescribed code and the pre-existing `NextRandomIndex(modulatorCount)` contract, so it is not a regression — flagging only for awareness.
- I did **not** execute the suite (reviewer constraint), so the RED→GREEN transitions in Steps 2/5 are verified by reading the logic, not by running.

The diff is a clean, complete match to the brief. I recommend it pass the spec-compliance gate.