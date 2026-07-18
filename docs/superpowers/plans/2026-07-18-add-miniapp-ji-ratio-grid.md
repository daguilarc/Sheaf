# MiniApp Just-Intonation Ratio Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MiniApp one runtime button-grid slot whose two rows independently choose a fixed just-intonation ratio for its two VCO voices.

**Architecture:** `Engine` retains sole ownership of `GridManager`; it exposes a documented, non-owning, topology-declaration pointer through `AppContext` only while app `Init` runs. MiniApp declares one selected `(0,0)`–`(8,2)` grid filled with two rows of `StateCell<std::size_t>` in `SetOnly` mode. Each audio sample applies the selected row ratio to the matching prepared VCO input immediately before VCO processing, leaving the shared Tune parameter unchanged.

**Tech Stack:** C++20, JUCE-free synth runtime, `SynthRig` system tests, Make, OpenSpec, xagent Claude review.

## Global Constraints

- The single MiniApp grid slot and its assigned grid use the signed half-open range `[0,8) x [0,2)` and contain exactly sixteen registered cells.
- Ratio columns, in required x order, are `1/2`, `3/4`, `2/3`, `1/1`, `5/4`, `3/2`, `4/3`, `2/1`; `6/5` is deliberately absent.
- Row 0 controls VCO voice 0 and row 1 controls VCO voice 1. Their selection state is independent, and both begin at x 3 (`1/1`).
- A selected cell uses its full stable ratio color; an unselected cell uses the same RGB family at dim brightness. Grid publication owns alpha and packs it to exactly 1 or 0, so dimness must not use alpha.
- `AppContext::gridManager` is non-owning and must be documented as **Init-only topology declaration**. It is not an application runtime-control path after topology finalization.
- All topology calls must be checked. MiniApp must throw `std::logic_error` for a null manager, missing creation result/object, failed cell registration, or failed slot selection; a partial grid must never silently start audio.
- Apply ratios only between `vcoModule_.SetInput(...)` and `vcoModule_.Process()`. Do not write Tune values, parameter state, MIDI mappings, persistence, or on-screen UI behavior.
- No default MIDI mapping is introduced. Existing profile configuration can map the slot where desired; tests drive the manager directly.

---

### Task 1: Expose runtime-owned grid topology during application initialization

**OpenSpec coverage:** `synth-app-runtime` sar-3; tasks 1.1–1.2.

**Files:**

- Modify: `projects/synth/include/synth/AppContext.hpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp`

**Interfaces:**

- Produces: `synth::AppContext::gridManager`, a stable non-owning pointer to the `Engine`-owned manager.
- Preserves: `Engine` ownership, the existing UI-state-finalization order, and `AppContext::uiState` remaining parameter-only.

- [ ] **Step 1: Write the focused failing lifecycle assertion**

  Extend `EngineTestApp` with an Init-time observation of `ctx->gridManager`, or add a small dedicated test app that uses it in `Init`. Assert that the pointer is non-null during `Init`, can create one matching grid/slot and register/select a cell before finalization, and that after `engine.Initialize()` the manager is finalized and the published runtime grid state contains the configured slot.

  Run: `make -C projects/synth build/engine_tests && projects/synth/build/engine_tests`

  Expected before implementation: compilation fails because `AppContext` has no `gridManager` member.

- [ ] **Step 2: Add the pointer and wire it before `app_.Init`**

  In `AppContext.hpp`, forward-declare `GridManager` in namespace `synth` (or include the narrow grid header if required) and add:

  ```cpp
  // Init-only topology declaration; Engine owns this manager. Do not use it
  // for application runtime mutation after Engine finalizes grid topology.
  GridManager* gridManager = nullptr;
  ```

  Keep it alongside the other non-owning framework pointers and explicitly state its thread role in the comment. In `Engine`'s constructor body, assign `context_.gridManager = &gridManager_` before the context is exposed to application initialization. Do not change manager construction/destruction order or snapshot publishing.

- [ ] **Step 3: Verify the lifecycle contract**

  Run: `make -C projects/synth build/engine_tests && projects/synth/build/engine_tests`

  Expected: the new Init-declaration test and every existing engine test exit 0.

- [ ] **Step 4: Review Task 1**

  Ask an xagent Claude reviewer to inspect the Task 1 diff against sar-3, focusing on pointer ownership, thread-role documentation, and `Initialize()` ordering. Resolve only concrete findings, reusing the native implementer and the same reviewer for a small correction.

### Task 2: Create MiniApp’s ratio grid and apply its independent pitch offsets

**OpenSpec coverage:** `synth-miniapp-ratio-grid` mrg-1 through mrg-3; tasks 2.1–2.3.

**Files:**

- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`

**Interfaces:**

- Consumes: Task 1 `AppContext::gridManager`, existing `GridRange`, `GridManager`, `StateCell`, and `RuntimeUIState` publication.
- Produces: one MiniApp grid slot, its selected ratio grid, two row-selection values, and per-voice pre-process frequency multipliers.
- Preserves: parameter banks, Tune raw value, persistence, existing default instrument config, and the portable/JUCE MiniApp UI.

- [ ] **Step 1: Write failing MiniApp grid topology and interaction tests**

  Replace the existing `miniapp_existing_surface_keeps_parameter_ui_contract_without_grid_integration` assertion with coverage that creates a `SynthRig<MiniApp>`, then asserts:

  ```cpp
  const auto& grids = *rig.Engine().RuntimeUIStateForTest().grids;
  REQUIRE_TRUE(grids.slots.size() == 1);
  REQUIRE_TRUE(grids.slots[0]->range == *synth::GridRange::Create(0, 8, 0, 2));
  REQUIRE_TRUE(grids.slots[0]->colors.size() == 16);
  REQUIRE_TRUE(rig.Engine().GridManagerForTest().SlotAt(0)->SelectedGrid() != nullptr);
  ```

  Before an audio block, assert x=3 is on for each row and all other cells are off, while all colors retain nonzero RGB. Drive `GridManagerForTest().HandlePress(0, 0, 0, velocity)` and a different column in row 1; publish through a rig block; then assert independent selections, one on cell per row, full RGB for each selected cell, dimmer same-family RGB for unselected cells, and alpha 1/0 respectively. Also call release and pressure-change and assert neither changes selection.

  Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

  Expected before implementation: the old no-grid assertion fails.

- [ ] **Step 2: Declare the fixed topology safely in `MiniAppCore::Init`**

  Include `synth/ButtonGrid.hpp`. Add fixed `std::array<float, 8>` ratio constants in the specified order and a fixed eight-color palette. Store two `std::size_t` selections initialized to `3`.

  At `Init` time, require a non-null `context_->gridManager`, create matching grid and slot from `GridRange::Create(0, 8, 0, 2)`, and obtain the grid object. For each `y in {0,1}` and `x in [0,8)`, register:

  ```cpp
  std::make_unique<synth::StateCell<std::size_t>>(
      ratioColor.AdjustBrightness(0.35f), ratioColor,
      &ratioSelections_[y], x, 0,
      synth::StateCell<std::size_t>::Mode::SetOnly)
  ```

  Check every optional, pointer, `RegisterCell`, and `SelectGridForSlot` result and throw `std::logic_error` on failure. The tests should observe slot/grid index 0 because MiniApp creates exactly one of each.

- [ ] **Step 3: Write and implement the independent signal-path test**

  Add a MiniApp system test that sets a known Tune value or inspects the prepared `VcoModuleInstance().CurrentInput()` after processing enough frames. Select a non-unity ratio for row 0 and a different non-unity ratio for row 1, process one block, and prove:

  - voice 0 prepared frequency is the unmodified base frequency multiplied by its selected ratio;
  - voice 1 prepared frequency is the unmodified base frequency multiplied by its own selected ratio;
  - the two values differ when the selected ratios differ; and
  - `Tune`'s raw value remains exactly unchanged by grid presses and processing.

  In `ProcessBlock`, preserve the current order, then add exactly:

  ```cpp
  vcoModule_.SetInput(*context_->parameterManager);
  for (std::size_t voiceIx = 0; voiceIx < kVoiceCount; ++voiceIx) {
      vcoModule_.CurrentInput().voices[voiceIx].vco.freq *=
          kJiRatios[ratioSelections_[voiceIx]];
  }
  vcoModule_.Process();
  ```

  Use the ratio-table lookup rather than multiplying an already-mutated value across frames; `SetInput` refreshes the normalized inputs each sample.

- [ ] **Step 4: Run the focused MiniApp tests**

  Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

  Expected: exact geometry, feedback, set-only behavior, independent audio offsets, and all pre-existing MiniApp tests pass.

- [ ] **Step 5: Review Task 2**

  Ask an xagent Claude reviewer to inspect the completed MiniApp diff against mrg-1/2/3. Require checks for exact ratio order, excluding `6/5`, RGB rather than alpha dimming, checked topology calls, and correct placement of the frequency multiplier. Resolve small corrections with the same native implementer and reviewer; use fresh contexts for substantial redesign.

### Task 3: End-to-end verification and OpenSpec traceability

**OpenSpec coverage:** tasks 3.1–3.2.

**Files:**

- Modify: `openspec/changes/add-miniapp-ji-ratio-grid/tasks.md`
- Optionally modify: proposal/design/spec artifacts only if a reviewed implementation discovery requires a normative correction.

- [ ] **Step 1: Run the required verification set**

  Run:

  ```bash
  make -C projects/synth build/engine_tests build/miniapp_system_tests test
  projects/synth/build/engine_tests
  projects/synth/build/miniapp_system_tests
  openspec validate add-miniapp-ji-ratio-grid --type change --strict --no-interactive
  git diff --check
  rg 'TODO|TBD' projects/synth/apps/miniapp/MiniAppCore.hpp projects/synth/include/synth/AppContext.hpp
  ```

  Expected: all requested targets/tests return 0, OpenSpec strict validation is valid, diff check is clean, and the final search finds no placeholders.

- [ ] **Step 2: Mark completed OpenSpec tasks only with evidence**

  Check off each completed task in `openspec/changes/add-miniapp-ji-ratio-grid/tasks.md`; retain a concise note in the implementation handoff or commit message naming the focused test commands and both Claude reviews.

- [ ] **Step 3: Final review and handoff**

  Run one final xagent Claude code-quality review on the complete diff. Inspect `git diff --check` and `git status --short` yourself, preserving the pre-existing untracked `projects/synth/miniapp/` directory. Do not land, fast-forward main, push, or archive the OpenSpec change unless the user asks.
