# Add Parameter UI Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename raw parameter reads to `GetRaw`, cache per-sample knob values in `ProcessLite`, and publish smoothed UI center/spread for encoder rendering.

**Architecture:** `Parameter` keeps raw evaluation separate from cached DSP consumption. `ProcessLite` remains the per-sample sampling point: it slews existing state, samples cached knob values from `GetRaw`, then updates visual EMA center and spread. UI state publishes display center/spread while mapping helpers read cached knob values, giving modular one-sample modulation delay.

**Tech Stack:** C++20 synth core, hand-rolled test harness in `projects/synth/tests/parameter_modulation_tests.cpp`, JUCE encoder component and geometry test under `projects/synth/juce`, OpenSpec task tracking.

---

## File Map

- Modify `projects/synth/include/synth/ParameterModulation.hpp`: group config alphas, storage arenas, `Parameter::UIState` spread arrays, `GetRaw`, cached knob accessors, private smoothing storage.
- Modify `projects/synth/src/ParameterModulation.cpp`: storage allocation, constructors, snap/seeding, `ProcessLite`, mapping helpers, UI state population, recursive depth computation.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: focused tests plus simulation oracle fields and assertions.
- Modify `projects/synth/include/synth/Modules.hpp` only if public method rename fallout appears in module call sites.
- Modify `projects/synth/tests/module_tests.cpp` only for rename fallout or cached mapping assertions.
- Modify `projects/synth/juce/EncoderComponent.hpp`: snapshot display spread and render cloud/blur around display center.
- Modify `projects/synth/juce/EncoderComponentGeometryTests.cpp`: math helpers for spread width/normalization.
- Modify `openspec/changes/add-parameter-ui-smoothing/tasks.md`: check off tasks only after implementation, reviews, and verification pass.

## Required Review Routing

- Implement each task with a fresh Codex worker subagent.
- After each worker result, run a Claude xagent spec-compliance review:
  `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<prompt>"`
- Then run a Claude xagent code-quality review with the same launcher.
- Do not mark OpenSpec task checkboxes until the matching work passes both reviews and the listed tests.

### Task 1: Core Parameter API, Storage, and Focused Tests

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Write failing focused tests**

Add tests near the existing `ProcessLite` / mapping helper tests:

```cpp
TEST_CASE(parameter_get_raw_includes_normalization_offset) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 8,
                                       .processLiteAlpha = 1.0f};
    synth::ParameterGroup& group = manager.CreateGroup(config);
    float mod0 = 1.0f;
    float mod1 = 1.0f;
    std::array<float*, 1> source0{&mod0};
    std::array<float*, 1> source1{&mod1};
    group.SetModulationSource(0, source0, {.connected = true});
    group.SetModulationSource(1, source1, {.connected = true});
    synth::Parameter& parameter = manager.CreateParameter(group, {.name = "Cutoff", .shortName = "Cut", .defaultValue = 0.5f});
    parameter.EnsureModulationDepth(0).SceneCenter(0) = 0.25f;
    parameter.EnsureModulationDepth(1).SceneCenter(0) = -0.5f;
    manager.ComputeAllParameters();
    group.UpdateModValues();
    parameter.ProcessLite();
    REQUIRE_NEAR(parameter.GetRaw(0), 0.625f, 0.0001f);
}

TEST_CASE(process_lite_samples_cached_knob_after_slew) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 2,
                                       .processLiteAlpha = 0.25f};
    synth::ParameterGroup& group = manager.CreateGroup(config);
    synth::Parameter& parameter = manager.CreateParameter(group, {.name = "Level", .shortName = "Lvl", .defaultValue = 0.0f});
    manager.ComputeAllParameters();
    parameter.SceneCenter(0) = 1.0f;
    manager.ComputeAllTargets();
    parameter.ProcessLite();
    REQUIRE_NEAR(parameter.GetRaw(0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.CachedKnobValue(0), 0.25f, 0.0001f);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`

Expected: compile fails because `GetRaw` / `CachedKnobValue` do not exist.

- [ ] **Step 3: Implement storage and raw/cached API**

In `ParameterGroupConfig`, add:

```cpp
float uiDisplayCenterAlpha = kDefaultUiDisplayCenterAlpha;
float uiDisplaySpreadAlpha = kDefaultUiDisplaySpreadAlpha;
```

Define defaults near `kDefaultProcessLiteAlpha`:

```cpp
inline constexpr float kDefaultUiDisplayCenterAlpha = 0.0013089969f; // about 10 Hz at 48 kHz
inline constexpr float kDefaultUiDisplaySpreadAlpha = 0.0013089969f;
```

Add per-voice arenas to `ParameterStorageBatch` and `ParameterGroup`: `currentKnobValueArena`, `uiDisplayCenterArena`, `uiDisplaySpreadEnergyArena`. Slice them in both `Parameter` constructors. Rename public `Get` to `GetRaw`, add:

```cpp
float CachedKnobValue(std::size_t voiceIx) const;
float UIDisplayCenter(std::size_t voiceIx) const;
float UIDisplaySpread(std::size_t voiceIx) const;
```

Seed all three arrays in constructors and `SnapCurrentToTarget`: cached knob = `GetRaw(voiceIx)`, UI center = cached knob, spread energy = `0`.

- [ ] **Step 4: Update `ProcessLite`**

After existing slews:

```cpp
for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
    const float knob = GetRaw(voiceIx);
    currentKnobValues_[voiceIx] = knob;
    uiDisplayCenters_[voiceIx] += group_.Config().uiDisplayCenterAlpha * (knob - uiDisplayCenters_[voiceIx]);
    const float residual = knob - uiDisplayCenters_[voiceIx];
    uiDisplaySpreadEnergies_[voiceIx] +=
        group_.Config().uiDisplaySpreadAlpha * ((residual * residual) - uiDisplaySpreadEnergies_[voiceIx]);
}
```

- [ ] **Step 5: Run tests**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`

Expected: the new tests pass or expose only rename fallout handled in Task 2.

### Task 2: Mapping Helpers, Recursive Raw Reads, Switch Semantics, and Module Fallout

**Files:**
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify if needed: `projects/synth/include/synth/Modules.hpp`, `projects/synth/tests/module_tests.cpp`

- [ ] **Step 1: Add failing cached mapping and one-sample delay tests**

Add tests:

```cpp
TEST_CASE(mapping_helpers_use_cached_process_lite_knob_value) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 4,
                                       .processLiteAlpha = 1.0f};
    synth::ParameterGroup& group = manager.CreateGroup(config);
    float mod = 0.0f;
    std::array<float*, 1> source{&mod};
    group.SetModulationSource(0, source, {.connected = true});
    synth::Parameter& parameter = manager.CreateParameter(group, {.name = "Shape", .shortName = "Shp", .defaultValue = 0.0f});
    const synth::ParameterId id = parameter.Id();
    parameter.EnsureModulationDepth(0).SceneCenter(0) = 1.0f;
    manager.ComputeAllParameters();
    group.UpdateModValues();
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, id), 10.0f, 0.0001f);
    mod = 1.0f;
    group.UpdateModValues();
    REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, id), 10.0f, 0.0001f);
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, id), 20.0f, 0.0001f);
}

TEST_CASE(switch_value_uses_target_and_display_spread_is_zero) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 2,
                                       .processLiteAlpha = 0.25f, .uiDisplayCenterAlpha = 0.25f,
                                       .uiDisplaySpreadAlpha = 0.5f};
    synth::ParameterGroup& group = manager.CreateGroup(config);
    synth::Parameter& stepped = manager.CreateParameter(group, {.name = "Mode", .shortName = "Mode", .defaultValue = 0.0f,
                                                               .switchValues = 4});
    manager.ComputeAllParameters();
    stepped.SceneCenter(0) = 1.0f;
    manager.ComputeAllTargets();
    stepped.ProcessLite();
    REQUIRE_TRUE(stepped.GetSwitchVal(0) == 3);
    synth::Parameter::UIState ui(1);
    stepped.PopulateUIState(ui);
    REQUIRE_NEAR(ui.spreadValues[0].load(std::memory_order_relaxed), 0.0f, 0.0001f);
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`

Expected: failures show mapping helpers still use raw reads and UI spread field is missing.

- [ ] **Step 3: Update mapping helpers**

Change every `ParameterById(id).Get(...)` or `parameter.Get(...)` inside `GetLinear`, `GetExponential`, zero-based, bipolar, centered bipolar, and signed bipolar zero-based helpers to use `CachedKnobValue(voiceIx)`. Keep range validation unchanged.

- [ ] **Step 4: Update recursive/raw call sites**

Use `GetRaw` in `ComputeAtDepth` when reading modulation-depth parameters. Keep `GetSwitchVal` target-based by continuing to use `TargetValue(voiceIx)`. Update all direct test references from `.Get(` to `.GetRaw(` unless the test is specifically asserting cached mapping behavior.

- [ ] **Step 5: Run focused tests**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`

Expected: parameter tests pass.

Run: `make -C projects/synth build && projects/synth/build/module_tests`

Expected: module tests pass after any method rename fallout.

### Task 3: UI State Publication and Simulation Oracle

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add UI smoothing tests**

Add tests:

```cpp
TEST_CASE(ui_display_center_and_spread_follow_cached_knob_order) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 2,
                                       .processLiteAlpha = 1.0f, .uiDisplayCenterAlpha = 0.25f,
                                       .uiDisplaySpreadAlpha = 0.5f};
    synth::ParameterGroup& group = manager.CreateGroup(config);
    synth::Parameter& parameter = manager.CreateParameter(group, {.name = "Cutoff", .shortName = "Cut", .defaultValue = 0.0f});
    manager.ComputeAllParameters();
    parameter.SceneCenter(0) = 1.0f;
    manager.ComputeAllTargets();
    parameter.ProcessLite();
    synth::Parameter::UIState ui(1);
    parameter.PopulateUIState(ui);
    REQUIRE_NEAR(ui.values[0].load(std::memory_order_relaxed), 0.25f, 0.0001f);
    REQUIRE_NEAR(ui.spreadValues[0].load(std::memory_order_relaxed), std::sqrt(0.28125f), 0.0001f);
}
```

- [ ] **Step 2: Extend `Parameter::UIState`**

Add `std::unique_ptr<std::atomic<float>[]> spreadValues;` and allocate/reset it in `Configure` and `SetDisconnected`. In `PopulateUIState`, store `UIDisplayCenter(voiceIx)` into `values[voiceIx]` and `UIDisplaySpread(voiceIx)` into `spreadValues[voiceIx]`, except switch params store spread `0`.

- [ ] **Step 3: Update simulation structs**

In `SimParam`, add:

```cpp
std::array<float, kSimVoices> cachedKnob{};
std::array<float, kSimVoices> uiDisplayCenter{};
std::array<float, kSimVoices> uiDisplaySpreadEnergy{};
```

Rename `SimGet` to `SimGetRaw`, add `SimSeedDisplayState`, and update `SimProcessLiteAll` to mirror production smoothing. Use `cachedKnob` for mapped-helper oracle checks and `uiDisplayCenter` / `sqrt(uiDisplaySpreadEnergy)` for UI-state checks.

- [ ] **Step 4: Run parameter tests**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`

Expected: all parameter modulation tests pass, including randomized simulations.

### Task 4: Encoder Snapshot and Spread Rendering

**Files:**
- Modify: `projects/synth/juce/EncoderComponent.hpp`
- Modify: `projects/synth/juce/EncoderComponentGeometryTests.cpp`

- [ ] **Step 1: Add geometry helpers and failing tests**

Add public/static helpers to `EncoderComponent`:

```cpp
static float DisplaySpreadToStrokeWidth(float radius, float spread) {
    return juce::jlimit(0.0f, radius * 0.24f, radius * std::max(0.0f, spread) * 0.8f);
}
```

First add geometry tests:

```cpp
RequireNear(synth_juce::EncoderComponent::DisplaySpreadToStrokeWidth(20.0f, 0.0f), 0.0f, tolerance,
            "zero spread has no cloud");
RequireTrue(synth_juce::EncoderComponent::DisplaySpreadToStrokeWidth(20.0f, 0.2f) > 0.0f,
            "nonzero spread has cloud width");
RequireNear(synth_juce::EncoderComponent::DisplaySpreadToStrokeWidth(20.0f, 100.0f), 4.8f, tolerance,
            "spread cloud clamps");
```

- [ ] **Step 2: Snapshot spread values**

Add `std::vector<float> spreadValues;` to `Snapshot`, resize it with `voiceCount`, and load `state_->spreadValues[voiceIx]`.

- [ ] **Step 3: Render spread cloud**

In `DrawVoiceIndicators`, before drawing the dot for non-switch parameters, compute normalized spread (`spread * 0.5f` for bipolar display normalization, raw spread for unipolar), convert it to stroke width with `DisplaySpreadToStrokeWidth`, and draw a translucent arc centered on the display value. Use existing voice color with low alpha; skip when spread width is zero.

- [ ] **Step 4: Run encoder geometry tests**

Run: `make -C projects/synth/apps/miniapp test`

Expected: `Encoder geometry tests passed`.

### Task 5: OpenSpec Task Sync and Full Verification

**Files:**
- Modify: `openspec/changes/add-parameter-ui-smoothing/tasks.md`

- [ ] **Step 1: Run focused verification**

Run:

```bash
make -C projects/synth build
projects/synth/build/parameter_modulation_tests
projects/synth/build/module_tests
make -C projects/synth/apps/miniapp test
```

Expected: all commands pass.

- [ ] **Step 2: Run full synth verification**

Run: `make -C projects/synth test`

Expected: all synth core test binaries pass.

- [ ] **Step 3: Update OpenSpec task checkboxes**

Only after Tasks 1-4 and verification pass, mark all corresponding items complete in `openspec/changes/add-parameter-ui-smoothing/tasks.md`.

- [ ] **Step 4: Run status and final review**

Run: `openspec status --change "add-parameter-ui-smoothing"`

Expected: all 19 OpenSpec tasks complete.

Run Claude xagent final review:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review implementation of add-parameter-ui-smoothing. Findings first. Check OpenSpec compliance, code quality, tests, and regressions. Use concrete file/line refs."
```

Expected: PASS or only non-blocking suggestions.

