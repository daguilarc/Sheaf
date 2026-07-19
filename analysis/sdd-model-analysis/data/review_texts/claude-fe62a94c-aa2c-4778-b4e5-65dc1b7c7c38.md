I've completed a thorough read of the spec artifacts and verified the plan against the actual code. Here is my review.

## Findings (ordered by severity)

### 1. [Medium] `MarkAllModulatorsConnectedForUi` blast radius is larger than the plan's enumerated list, and one named-behavior test *inverts* rather than merely breaks
`ModulatorMetadata.connected` defaults to **false** (`include/synth/ParameterModulation.hpp:213`). Because Task 1 Step 3 gates both `Bank::EnsureModulationDepthParameter` (`src/ParameterModulation.cpp:2352`) and `Bank::MissingModulationDepthCount` (`:2368`) on `connected`, every existing fixture that materializes depths but never registered a real source will change behavior. The plan's list (plan lines 62) is explicitly non-exhaustive ("including…"), and several affected tests set only `name`/`shortName`/`sourceColor` without `connected` — e.g. `parameter_modulation_tests.cpp:3575-3577`, `:3927-3929`, and the geometric test at `:3918`.

Most break to RED and are self-correcting under GREEN. But `modulation_view_open_is_noop_when_capacity_cannot_fill_all_modulators` (`:3564`) is different: with no modulator marked connected, the new `MissingModulationDepthCount` returns 0, so the view now **opens** instead of no-opping — its core assertion `!bank.ShowingModulation()` (`:3589`) flips to a false failure. The plan should call this test out by name as one requiring `MarkAllModulatorsConnectedForUi`, so the implementer treats the flip as expected re-marking, not a real regression to "fix" by weakening the new semantics. This is the one place a well-intentioned implementer could go wrong.

### 2. [Low] Randomized simulations only ever exercise *full* connectivity
The plan marks all modulators connected in the deterministic simulations (`randomized_parameter_modulation_simulation`, etc.) so the reference oracle (`SimDrawRandomIndex(kSimMods)`, `:7166`) keeps matching production. That is correct and necessary — but it means the ordinal→index remapping under *partial* connectivity is covered only by the single hand-built `random_mod_maps_connected_ordinals_and_skips_disconnected_sources` case. Acceptable, but worth noting the sims give no fuzz coverage of the new mapping. Consider having that one unit test use ≥2 disconnected indexes between two connected ones to exercise the scan's decrement path more than once.

### 3. [Informational] Transient spec/implementation inconsistency for already-landed tasks
Tasks 1–5 are marked complete and landed with 15-depth materialization (`miniapp_system_tests.cpp:905` asserts `ParameterCount() == 27`), yet the delta specs already assert disconnected-empty-cell behavior (spm-71 "Fifteen modulation cells fit the MIN-16 slot", d4-1 "disconnected positions remain empty", d4-9 mono index 11). Until Task 6 lands, the completed tasks contradict the current spec text. This is exactly what Task 6 reconciles, so it is not a plan defect — but note `openspec validate --strict` is structural only and will not catch this window.

### 4. [Informational] `CanOpenModulationView` has no callers
`MissingModulationDepthCount` feeds `CanOpenModulationView` (`:2364`), which is dead (no references in `src/`, `apps/`, or `tests/`). The plan's preflight change is exercised only through `OpenModulationView`'s inline `missing` computation (`:2388`). Harmless; just don't expect the query wrapper to be independently tested.

## Verification performed
- **Function/signature reality:** All hooks the plan edits exist as described — `EnsureModulationDepthParameter` (`:2352`), `MissingModulationDepthCount` (`:2368`), `RandomizeModulationDepths` (`:2446`), `OpenModulationView` (`:2378`), and the no-arg `Modulators::Metadata()` span accessor the snippets rely on (`ParameterModulation.hpp:251-252`). `<algorithm>` is already included.
- **Empty-cell semantics:** The plan's mechanism (null-parameter cell with a real encoder ID) correctly resolves to `SetDisconnected()`/`connected=false` via `BankSlot::PopulateUIState` (`:2527-2528`); disconnected cells already ignore turn (`:2231`) and press (`:2224`). Existing test `modulation_view_places_return_at_final_slot_position` (`:3499`) confirms the publish path.
- **Hidden-explicit-depth split:** `Parameter::ModulationDepthParameter` returns the raw pointer (ungated), `LoadValuesFromJSON` creates via `Parameter::EnsureModulationDepth` (`:1170`, ungated) and `ToValueJSON` serializes any non-null depth (`:1090`) — so approved semantic #5 (data remains, UI hidden, no migration) holds with only the Bank helper gated.
- **Random seam:** `SetRandomSource(value, coin, index)` with `index(exclusiveMax)` (`:3026`, `:3047`) supports the plan's `exclusiveMax == 2` assertion and the no-op zero-sample case.
- **App anchors:** `portable_ui_tests.cpp:488` currently asserts `braid4.encoder.11 != nullptr` (flips to `== nullptr`) and `:490` already checks the null visualizer; `miniapp_system_tests.cpp:905` is the `== 27`→`== 21` target. Arithmetic checks out (MiniApp 12+9=21; connected {0,1,2,3,4,5,6,11,14}=9, gaps=6; Braid stereo/quad connected=8, mono connected=7).
- **Approved semantics 1–7:** all reflected without contradiction across design doc, OpenSpec design.md decision 6, spm-75, and d4-1/3/8/9. All five spm-75 scenarios have matching acceptance cases in the plan.

None of the findings are blockers; #1 is a "watch item" for the implementer, and the rest are advisory. TDD structure (RED before GREEN, explicit expected-failure notes) is sound, the change is allocation-free as claimed, and it preserves active-route processing, reclamation, storage-batch, fixed positions, and the return cell.

Spec verdict: PASS
Plan verdict: PASS
Ready to implement: YES