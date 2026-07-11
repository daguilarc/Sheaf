# Add Target Center Alpha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group-configurable target-center smoothing so top-level parameter recomputes slew `targetCenter_` toward `ComputeRawCenter(scene)` before the existing `ProcessLite()` current-value slew.

**Architecture:** `ParameterGroupConfig` gains `targetCenterAlpha`, validated like existing alpha fields. `Parameter::ComputeAtDepth` computes raw center first, slews top-level `targetCenter_` with `targetCenter += alpha * (raw - targetCenter)`, and preserves recursive modulation-depth behavior by directly assigning and snapping current state when `recursionDepth > 0`.

**Tech Stack:** C++20, existing synth parameter/modulation library, existing `projects/synth/tests/parameter_modulation_tests.cpp` single-binary test harness, OpenSpec change `add-target-center-alpha`.

## Global Constraints

- OpenSpec source of truth: `openspec/changes/add-target-center-alpha/proposal.md`, `openspec/changes/add-target-center-alpha/design.md`, `openspec/changes/add-target-center-alpha/specs/synth-parameter-modulation/spec.md`, and `openspec/changes/add-target-center-alpha/tasks.md`.
- `ParameterGroupConfig` SHALL include target-center alpha as runtime configuration and SHALL validate process-lite alpha, target-center alpha, UI display-center alpha, and UI display-spread alpha in `[0, 1]`.
- Default target-center alpha SHALL be a 50 Hz-style one-pole alpha at the default target-compute cadence. Use `0.0994231307f`, computed as `1 - exp(-2*pi*(50/(48000/16)))`.
- `Parameter::Compute()` SHALL slew top-level `targetCenter` toward raw center using `targetCenter += alpha * (rawCenter - targetCenter)`.
- Recursive modulation-depth computations SHALL assign `targetCenter` from the raw center before snapping current state to target for parent consumption.
- `ProcessLite()` SHALL continue using only `processLiteAlpha` for current center, center scales, normalization offsets, min/max values, and modulation depths.
- No new dependencies, no patch value JSON migration, no routing or MIDI behavior changes.

---

### Task 1: Add Failing Target-Center Tests

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Consumes: existing `synth::ParameterGroupConfig`, `synth::Parameter::Compute`, `synth::Parameter::ProcessSample`, `synth::Parameter::EnsureModulationDepth`, `REQUIRE_TRUE`, and `REQUIRE_NEAR`.
- Produces: failing tests for `targetCenterAlpha` config validation, top-level compute smoothing, alpha-one direct assignment, recursive depth immediacy, and per-sample recompute smoothing.

- [ ] **Step 1: Update config validation test**

In `TEST_CASE(group_config_validation)`, add these checks immediately after the existing `expectedDefaultAlpha` checks:

```cpp
const float expectedDefaultTargetCenterAlpha = 0.0994231307f;
REQUIRE_NEAR(defaultAlpha.targetCenterAlpha, expectedDefaultTargetCenterAlpha, 0.000001f);
```

Add `.targetCenterAlpha = 0.5f,` to the existing `valid` config initializer.

Add invalid configs after `highAlpha`:

```cpp
const synth::ParameterGroupConfig lowTargetCenterAlpha{
    .numVoices = 1,
    .numScenes = 1,
    .maxParameters = 1,
    .targetCenterAlpha = -0.01f,
};
const synth::ParameterGroupConfig highTargetCenterAlpha{
    .numVoices = 1,
    .numScenes = 1,
    .maxParameters = 1,
    .targetCenterAlpha = 1.01f,
};
```

Add assertions after `REQUIRE_TRUE(!highAlpha.IsValid());`:

```cpp
REQUIRE_TRUE(!lowTargetCenterAlpha.IsValid());
REQUIRE_TRUE(!highTargetCenterAlpha.IsValid());
```

- [ ] **Step 2: Add focused top-level compute tests**

After `TEST_CASE(scene_and_gesture_interpolation)`, add:

```cpp
TEST_CASE(top_level_compute_slews_target_center_with_group_alpha) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
        .targetCenterAlpha = 0.25f,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Smoothed", .defaultValue = 0.0f});

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenter(), 0.25f, 0.0001f);
}

TEST_CASE(target_center_alpha_one_preserves_direct_top_level_assignment) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
        .targetCenterAlpha = 1.0f,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Direct", .defaultValue = 0.0f});

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenter(), 1.0f, 0.0001f);
}
```

- [ ] **Step 3: Add recursive modulation-depth immediacy test**

After `TEST_CASE(recursive_modulation_depth_targets_use_bipolar_zero_based_exponential_curve)`, add:

```cpp
TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for_parent_reads) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 2,
        .processLiteAlpha = 0.25f,
        .targetCenterAlpha = 0.25f,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    synth::Parameter* depth = carrier.EnsureModulationDepth(0);
    REQUIRE_TRUE(depth != nullptr);

    depth->SceneCenter(0) = 1.0f;
    carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(depth->TargetCenter(), 1.0f, 0.0001f);
    REQUIRE_NEAR(depth->CurrentCenter(), 1.0f, 0.0001f);
    REQUIRE_NEAR(depth->GetRaw(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 1.0f, 0.0001f);
}
```

- [ ] **Step 4: Add per-sample smoothing test**

After `TEST_CASE(parameter_process_sample_recomputes_on_configured_interval)`, add:

```cpp
TEST_CASE(parameter_process_sample_slews_target_center_before_process_lite) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 0.5f,
        .targetCenterAlpha = 0.25f,
        .targetComputeIntervalSamples = 16,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Probe", .defaultValue = 0.0f});

    parameter.SceneCenter(0) = 1.0f;
    parameter.ProcessSample(16);

    REQUIRE_NEAR(parameter.TargetCenter(), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenter(), 0.125f, 0.0001f);
}
```

- [ ] **Step 5: Run focused test binary and verify RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: compile fails because `ParameterGroupConfig` has no member named `targetCenterAlpha`, or tests fail because target-center smoothing is not implemented. This is the required TDD RED result.

---

### Task 2: Implement Target-Center Alpha

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Consumes: failing tests from Task 1.
- Produces: `synth::kDefaultTargetCenterAlpha`, `ParameterGroupConfig::targetCenterAlpha`, validation in `IsValid()`, and top-level-only target-center smoothing in `ComputeAtDepth`.

- [ ] **Step 1: Add header config field and default**

In `projects/synth/include/synth/ParameterModulation.hpp`, add the default constant after `kDefaultProcessLiteAlpha`:

```cpp
inline constexpr float kDefaultTargetCenterAlpha = 0.0994231307f;  // about 50 Hz at 48 kHz / 16-sample target computes
```

Add the field in `ParameterGroupConfig` after `processLiteAlpha`:

```cpp
float targetCenterAlpha = kDefaultTargetCenterAlpha;
```

- [ ] **Step 2: Extend config validation**

In `ParameterGroupConfig::IsValid()` in `projects/synth/src/ParameterModulation.cpp`, update the return expression so it includes:

```cpp
targetCenterAlpha >= 0.0f && targetCenterAlpha <= 1.0f
```

Keep the existing checks for `processLiteAlpha`, `uiDisplayCenterAlpha`, and `uiDisplaySpreadAlpha`.

- [ ] **Step 3: Implement top-level target-center smoothing**

In `Parameter::ComputeAtDepth`, replace the direct assignment:

```cpp
targetCenter_ = ClampToRange(ComputeRawCenter(scene), config_.range);
```

with:

```cpp
const float rawCenter = ClampToRange(ComputeRawCenter(scene), config_.range);
if (recursionDepth == 0) {
    const float alpha = group_.Config().targetCenterAlpha;
    targetCenter_ += alpha * (rawCenter - targetCenter_);
    targetCenter_ = ClampToRange(targetCenter_, config_.range);
} else {
    targetCenter_ = rawCenter;
}
```

Keep the existing recursive calls to `depthParameter->ComputeAtDepth(scene, recursionDepth_ + 1)` and the existing `if (recursionDepth_ > 0)` snap block unchanged.

- [ ] **Step 4: Run focused test binary and verify GREEN**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: focused parameter modulation tests pass.

---

### Task 3: Reconcile Existing Expectations And OpenSpec Tasks

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `openspec/changes/add-target-center-alpha/tasks.md`

**Interfaces:**
- Consumes: implementation from Task 2 and any failing legacy assertions that assumed direct top-level target assignment under default config.
- Produces: tests that explicitly opt into `.targetCenterAlpha = 1.0f` where they are testing unrelated legacy behavior, plus completed OpenSpec task checkboxes for implementation tasks proven by tests.

- [ ] **Step 1: Update unrelated legacy tests if needed**

If Task 2 GREEN fails because an existing test expected direct top-level target assignment while not testing target-center smoothing, update that test's `ParameterGroupConfig` initializer to include:

```cpp
.targetCenterAlpha = 1.0f,
```

Do this only for tests whose purpose is unrelated to target-center smoothing, such as modulation normalization, mapping helper, UI smoothing, message routing, or persistence behavior. Do not weaken the new tests from Task 1.

- [ ] **Step 2: Re-run focused tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: focused parameter modulation tests pass.

- [ ] **Step 3: Mark OpenSpec implementation tasks complete**

In `openspec/changes/add-target-center-alpha/tasks.md`, change these checkboxes from `[ ]` to `[x]`:

```markdown
- [x] 1.1 Add parameter-group config tests for the default `targetCenterAlpha` and rejection of values outside `[0, 1]`.
- [x] 1.2 Add focused `Parameter::Compute()` tests showing top-level target center slews toward `ComputeRawCenter(scene)` using `targetCenterAlpha`.
- [x] 1.3 Add a regression test showing `targetCenterAlpha = 1.0` preserves the previous direct target-center assignment behavior.
- [x] 1.4 Add a modulation-depth regression test showing recursive depth-parameter computation still assigns and snaps current state immediately for parent depth reads.
- [x] 1.5 Add a per-sample processing test showing recompute-on-interval applies target-center smoothing before `ProcessLite()` slews current center.
- [x] 2.1 Add `kDefaultTargetCenterAlpha` and `targetCenterAlpha` to `ParameterGroupConfig`.
- [x] 2.2 Extend `ParameterGroupConfig::IsValid()` to require `targetCenterAlpha` in `[0, 1]`.
- [x] 2.3 Change `Parameter::ComputeAtDepth` so recursion depth `0` updates `targetCenter_` with `targetCenter_ += targetCenterAlpha * (rawCenter - targetCenter_)`.
- [x] 2.4 Preserve recursion depth `> 0` behavior by assigning `targetCenter_` directly from the raw center and then snapping current state to target.
- [x] 2.5 Ensure target center scales, normalization offsets, min/max values, and target modulation depths continue deriving from the post-smoothing `targetCenter_`.
- [x] 3.1 Run focused synth parameter modulation tests.
```

Do not mark broader verification tasks complete in this task.

---

### Task 4: Broader Verification And Final OpenSpec Sync

**Files:**
- Modify: `openspec/changes/add-target-center-alpha/tasks.md`

**Interfaces:**
- Consumes: code and test updates from Tasks 1-3.
- Produces: broad synth verification evidence and final OpenSpec task synchronization.

- [ ] **Step 1: Run broader synth tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth test binaries run successfully with exit code `0`.

- [ ] **Step 2: Mark broad verification complete**

If Step 1 exits `0`, update `openspec/changes/add-target-center-alpha/tasks.md`:

```markdown
- [x] 3.2 Run the broader synth test target if focused tests pass.
```

- [ ] **Step 3: Run OpenSpec status**

Run:

```bash
openspec status --change add-target-center-alpha
```

Expected: OpenSpec reports artifacts complete and all implementation tasks except `3.3` complete.

- [ ] **Step 4: Mark final OpenSpec status task complete**

If Step 3 reports the expected status, update `openspec/changes/add-target-center-alpha/tasks.md`:

```markdown
- [x] 3.3 Run `openspec status --change add-target-center-alpha` and confirm the change remains apply-ready.
```

- [ ] **Step 5: Re-run OpenSpec status after marking final task**

Run:

```bash
openspec status --change add-target-center-alpha
```

Expected: OpenSpec reports all planning artifacts complete and all implementation tasks complete.
