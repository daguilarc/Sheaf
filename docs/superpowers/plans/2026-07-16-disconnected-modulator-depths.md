# Disconnected Modulator Depths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make disconnected modulator indexes behave like empty UI positions by avoiding depth materialization and excluding them from UI-driven Random Mod.

**Architecture:** Keep the existing fixed physical layout and sparse `Bank::Cell` representation. The generic bank layer consults `ModulatorMetadata.connected` before exposing or creating a depth, counts only connected missing depths during preflight, and maps Random Mod's connected-source ordinal back to the configured modulator index without allocating. Explicit parameter APIs, DSP route storage, and persistence remain unchanged.

**Tech Stack:** C++20, `ParameterManager`/`Bank`/`ParameterGroup`, custom Make-based JUCE-free test binaries, OpenSpec change `add-standard-modulators`, native Codex implementer subagents, and Claude xagent reviewers.

## Global Constraints

- Every configured modulator index retains its physical position; the final physical position remains the selected-parameter return cell.
- A source is UI-available only when `parameter.Group().GetModulators().Metadata(modIx).connected` is true.
- A disconnected source position has a null visible parameter, publishes `Parameter::UIState.connected=false`, and ignores turn, press, Reset, Random, and nested-view actions through the existing empty-cell behavior.
- Opening a modulation view creates and pins depth parameters only for connected indexes. Capacity preflight counts only connected depths that are missing.
- `Bank::EnsureModulationDepthParameter` returns null for a disconnected index even when an explicit programmatic or legacy depth already exists there.
- Random Mod samples uniformly from connected-source ordinals, maps the ordinal to the corresponding configured index, and preserves the existing geometric loop and replacement behavior. With no connected sources it consumes no random samples and creates no depth.
- Do not add source reconnection behavior, persistence migration, index aliases, parameter deletion, a second UI-connectivity flag, or app-specific production branches.
- Preserve the newly landed active-route processing, local-node pin/reclamation, and storage-batch behavior.
- Production work follows TDD: record a focused RED result before implementation and GREEN results after implementation.
- Each task is implemented by a fresh native Codex subagent, then passes Claude xagent spec-compliance review before Claude xagent code-quality review. Fix and re-review until both pass.
- Do not modify or stage `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-3-standard-modulators-report.md`, or the untracked `projects/synth/miniapp/` directory.

---

## File Structure

- Modify `projects/synth/src/ParameterModulation.cpp`: connected-source filtering for UI depth lookup/materialization, capacity preflight, and Random Mod ordinal mapping.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: generic disconnected-cell, capacity, input, hidden-explicit-depth, Random Mod, and existing connected-fixture coverage.
- Modify `projects/synth/tests/miniapp_system_tests.cpp`: nine connected MiniApp depths, six empty gaps, UI state, and parameter-count acceptance.
- Modify `projects/synth/tests/braid4_system_tests.cpp`: polyphonic/monophonic connected-depth and empty-gap acceptance.
- Modify `projects/synth/tests/portable_ui_tests.cpp`: the monophonic constant position has no encoder or visualizer node.
- Modify `projects/synth/docs/coverage.md`: map `spm-75` to exact generic and app tests.
- Modify after review `openspec/changes/add-standard-modulators/tasks.md`: mark `6.1..6.3` only after the matching implementation and review gates pass.

---

### Task 1: Generic Sparse Modulation-View Materialization

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify after both reviews: `openspec/changes/add-standard-modulators/tasks.md` items `6.1` and `6.2`

**Interfaces:**
- Consumes: `ModulatorMetadata.connected`, `Parameter::ModulationDepthParameter(std::size_t)`, `Parameter::EnsureModulationDepth(std::size_t)`, and existing null `Bank::Cell` behavior.
- Produces: `Bank::EnsureModulationDepthParameter` returns null for disconnected sources; `Bank::MissingModulationDepthCount` counts connected missing depths; `Bank::RandomizeModulationDepths` samples connected-source ordinals only.

- [ ] **Step 1: Add a connected-fixture helper and failing disconnected-view tests**

Add this test helper near the other test utilities:

```cpp
void MarkAllModulatorsConnectedForUi(synth::ParameterGroup& group) {
    for (synth::ModulatorMetadata& metadata : group.GetModulators().Metadata()) {
        metadata.connected = true;
    }
}
```

Use it in existing fixtures whose contract assumes all configured sources are available, including the modulation-view open/return/capacity/materialization/nesting/pinning tests, `modulation_view_open_is_noop_when_capacity_cannot_fill_all_modulators`, `random_mod_modifier_press_uses_geometric_slot_loop_with_replacement_and_stops_on_materialization_failure`, `randomized_parameter_modulation_simulation`, `randomized_message_bus_ui_state_simulation`, `randomized_patch_lifecycle_simulation`, `randomized_patch_lifecycle_preserves_recursive_local_modulation_depths`, and `randomized_recursive_modulation_ui_tree_round_trips_into_fresh_initialization` before they dispatch modulation-view or Random Mod actions. The capacity-no-op test must mark every source connected so its expected refusal continues to test insufficient connected-depth capacity rather than the new all-disconnected empty-view behavior.

Add `modulation_view_leaves_disconnected_sources_empty_and_hides_explicit_depths`. Configure three modulators with indexes `0` and `2` connected and `1` disconnected; explicitly assign a depth at index `1`; open a four-position slot; and assert:

```cpp
REQUIRE_TRUE(carrier.ModulationDepthParameter(0) != nullptr);
REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == &hiddenDepth);
REQUIRE_TRUE(carrier.ModulationDepthParameter(2) != nullptr);
REQUIRE_TRUE(bank.VisibleParameter(10) == carrier.ModulationDepthParameter(0));
REQUIRE_TRUE(bank.VisibleParameter(11) == nullptr);
REQUIRE_TRUE(bank.VisibleParameter(12) == carrier.ModulationDepthParameter(2));
REQUIRE_TRUE(bank.VisibleParameter(13) == &carrier);
REQUIRE_TRUE(!ui->slots[0].cells[1].connected.load());
```

Turn and press physical position `11` with no modifier, Reset, Random, and Random Mod held. Assert the hidden depth value, selected target, group parameter count, and every random callback counter remain unchanged.

Add `modulation_view_capacity_counts_only_connected_missing_depths`. Give a group three modulator indexes, one free parameter slot, and only index `2` connected. Opening the view must succeed, materialize only index `2`, keep indexes `0/1` null, and preserve the return cell; this is the RED proof that disconnected indexes no longer participate in preflight.

- [ ] **Step 2: Add failing connected-only Random Mod tests**

Add `random_mod_maps_connected_ordinals_and_skips_disconnected_sources`. Configure five modulator indexes, connect `0` and `4`, leave `1..3` disconnected, return coin samples `0.1` then `0.7`, and make the index source assert `exclusiveMax == 2` before returning ordinal `1`. Assert only source index `4` materializes and receives the configured random value. This exercises ordinal decrement at connected index `0` and scanning across three disconnected positions before index `4` is selected.

Add `random_mod_with_no_connected_sources_is_a_noop`. Attach counters to all three random callbacks, hold Random Mod, press the target, and assert all counters remain zero, all depth pointers remain null, the view stays closed, and no parameter storage is consumed.

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected RED: the new disconnected-view test exposes or materializes index `1`, the capacity test refuses to open, and connected-only Random Mod samples the configured count rather than the connected count.

- [ ] **Step 3: Implement connected-only UI depth lookup and preflight**

Change `Bank::EnsureModulationDepthParameter` so metadata is checked before an existing depth is returned:

```cpp
if (!parameter.Group().GetModulators().Metadata(modIx).connected) {
    return nullptr;
}
Parameter* depthParameter = parameter.ModulationDepthParameter(modIx);
```

Change `Bank::MissingModulationDepthCount` to increment only when metadata is connected and the corresponding depth pointer is null. Leave `OpenModulationView`'s fixed-index loop, null cell insertion, pinning, return-cell placement, and low-storage request behavior unchanged.

- [ ] **Step 4: Implement allocation-free connected-only Random Mod mapping**

Count connected metadata entries before the geometric loop and return immediately when the count is zero. Pass that count to `NextRandomIndex`, interpret its result as a connected-source ordinal, and scan metadata in configured-index order to map the ordinal to `modIx`:

```cpp
const auto metadata = parameter.Group().GetModulators().Metadata();
const std::size_t connectedCount = static_cast<std::size_t>(
    std::count_if(metadata.begin(), metadata.end(),
                  [](const ModulatorMetadata& source) { return source.connected; }));
if (connectedCount == 0) {
    return;
}

while (manager_->NextRandomCoin() < 0.5f) {
    std::size_t ordinal = manager_->NextRandomIndex(connectedCount);
    std::size_t modIx = 0;
    for (; modIx < metadata.size(); ++modIx) {
        if (!metadata[modIx].connected) {
            continue;
        }
        if (ordinal == 0) {
            break;
        }
        --ordinal;
    }
    Parameter* depthParameter = EnsureModulationDepthParameter(parameter, modIx);
    if (depthParameter == nullptr) {
        return;
    }
    depthParameter->RandomizeVisibleValue(scene, manager_->NextRandomValue());
}
```

Keep the existing stop-on-materialization-failure behavior and do not allocate a temporary vector.

- [ ] **Step 5: Verify, commit, and review**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected GREEN: all generic parameter-modulation tests pass, including deterministic randomized simulations. Commit only the task files with subject `feat(synth): hide disconnected modulation depths`. Submit the task diff first to a Claude xagent spec-compliance reviewer and then to a fresh Claude xagent code-quality reviewer. Resolve every actionable finding and repeat the failed review gate before marking OpenSpec `6.1` and `6.2` complete.

---

### Task 2: MiniApp and Braid4 Sparse-Position Acceptance

**Files:**
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/tests/braid4_system_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/docs/coverage.md`
- Modify after both reviews: `openspec/changes/add-standard-modulators/tasks.md` item `6.3`

**Interfaces:**
- Consumes: Task 1's connected-only generic bank behavior and the fixed MiniApp/Braid4 modulator metadata registered by `StandardModulators`.
- Produces: application-level acceptance proving connected depths remain visible and disconnected standard-topology gaps are empty, non-interactive UI positions.

- [ ] **Step 1: Update MiniApp assertions for nine connected depths and six gaps**

In `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`, replace the fifteen-depth loop and `group.ParameterCount() == 27` assertion. For connected indexes `{0,1,2,3,4,5,6,11,14}`, assert the depth exists, the visible parameter matches it, and the UI cell is connected. For gaps `{7,8,9,10,12,13}`, assert both `ModulationDepthParameter(gap)` and `VisibleParameter(10 + gap)` are null and the UI cell is disconnected. Assert the return cell remains at physical ID `25`, and assert `group.ParameterCount() == 21` for twelve top-level parameters plus nine connected depths.

- [ ] **Step 2: Add Braid4 polyphonic and monophonic sparse-view assertions**

Extend `braid4_standard_modulation_view_renders_underlay_and_app_sources_remain_encoder_only` to assert the stereo view opened by `rig.Press(0, 0)` has visible depth parameters at connected indexes `{0,1,2,3,4,5,11,14}` and null/disconnected cells at gaps `{6,7,8,9,10,12,13}`.

Open a monophonic matrix parameter's modulation view and assert connected indexes `{0,1,2,3,4,5,14}` are present, while `{6,7,8,9,10,11,12,13}` are null/disconnected and `ModulationDepthParameter(11) == nullptr`.

In `TestBraid4StandardModulationViewsRemainPortable`, replace the old index-`11` encoder-only expectation with:

```cpp
Require(FindNodeById(monoTree, "braid4.encoder.11") == nullptr,
        "Braid4 mono disconnected constant position has no encoder cell");
Require(FindNodeById(monoTree, "braid4.encoder.11.visualizer") == nullptr,
        "Braid4 mono disconnected constant position has no visualizer");
```

- [ ] **Step 3: Run focused application verification**

Run:

```bash
make -C projects/synth build/miniapp_system_tests build/braid4_system_tests build/portable_ui_tests
projects/synth/build/miniapp_system_tests
projects/synth/build/braid4_system_tests
projects/synth/build/portable_ui_tests
```

Expected: all focused application and portable UI tests pass.

- [ ] **Step 4: Update coverage and run full verification**

Add a covered `spm-75` row and a `### spm-75 - Disconnected Sources Are Empty Modulation-View Positions` section to `projects/synth/docs/coverage.md`, naming the new generic tests plus the MiniApp and Braid4 sparse-position assertions.

Run:

```bash
make -C projects/synth test
openspec validate add-standard-modulators --strict
git diff --check
```

Expected: every synth test target passes, OpenSpec reports `Change 'add-standard-modulators' is valid`, and `git diff --check` emits no output.

- [ ] **Step 5: Commit, review, and close OpenSpec task 6**

Commit the application tests and coverage mapping with subject `test(synth): cover disconnected modulation positions`. Submit the cumulative Task 1–2 implementation first to a Claude xagent spec-compliance reviewer and then to a fresh Claude xagent code-quality reviewer. Resolve every actionable finding and repeat the failed gate. After both pass and the full verification remains green, mark OpenSpec item `6.3` complete in a separate documentation commit with subject `spec(synth): complete disconnected modulation positions`.
