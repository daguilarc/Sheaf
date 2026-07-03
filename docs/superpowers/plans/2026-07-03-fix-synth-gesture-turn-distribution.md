# Fix Synth Gesture Turn Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement OpenSpec change `fix-synth-gesture-turn-distribution` so gesture selection only arms inactive gesture state, while every non-arming knob turn distributes across all active gestures and the base value.

**Architecture:** Keep the behavior inside `Parameter::HandleIncDec`, the existing routed-edit boundary. Add tests around the existing gesture edit test cluster, then refactor the handler into an arming pass followed by an all-active-gesture distribution pass.

**Tech Stack:** C++20, custom single-file synth test harness in `projects/synth/tests/parameter_modulation_tests.cpp`, Makefile targets under `projects/synth`.

---

## File Structure

- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
  - Add regression coverage for first-turn arming, deselected active-gesture distribution, blended arming, and multi-active gesture distribution.
  - Update existing selected-gesture tests whose expectations assume same-turn activation and edit.
- Modify: `projects/synth/src/ParameterModulation.cpp`
  - Refactor `Parameter::HandleIncDec` to use selected gestures only for arming.
  - Distribute all non-arming turns across all active gestures regardless of selection.
- Modify: `openspec/changes/fix-synth-gesture-turn-distribution/tasks.md`
  - Check off OpenSpec tasks only after implementation, review, and verification are complete.

Baseline evidence already gathered:

```bash
make -C projects/synth build
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected baseline: both commands exit `0`.

## Task 1: Regression Tests

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add first-turn arming and deselected-active high gesture tests**

Insert these tests after `selected_gesture_activation_snapshots_parent_value`:

```cpp
TEST_CASE(selected_inactive_gesture_first_turn_arms_without_applying_delta) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.25f});
    parameter.SceneCenter(0) = 0.25f;
    parameter.GestureValue(0, 0) = 1.0f;
    manager.SetGestureValue(0, 1.0f);
    manager.SelectGesture(0);

    const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
    parameter.HandleIncDec(scene, 0.2f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
}

TEST_CASE(active_high_gesture_distributes_after_deselection) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.25f});
    parameter.SceneCenter(0) = 0.25f;
    parameter.GestureValue(0, 0) = 0.9f;
    parameter.SetGestureActive(0, 0, true);
    manager.SetGestureValue(0, 1.0f);
    manager.DeselectGesture(0);

    const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
    parameter.HandleIncDec(scene, 0.2f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(!manager.GestureSelected(0));
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 1.0f, 0.0001f);
}
```

- [x] **Step 2: Add blended arming test**

Replace `selected_gesture_mid_blend_activates_both_scenes` with:

```cpp
TEST_CASE(selected_gesture_mid_blend_arms_both_scenes_without_applying_delta) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.2f;
    parameter.SceneCenter(1) = 0.8f;
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.GestureValue(1, 0) = 0.0f;
    manager.SelectGesture(0);
    manager.SetGestureValue(0, 0.5f);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.5f}, 0.4f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.2f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(1), 0.8f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.2f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.8f, 0.0001f);
}
```

- [x] **Step 3: Update existing same-turn selected gesture tests to pre-activate**

For `selected_gesture_weight_one_edits_gesture_without_moving_base`, remove `manager.SelectGesture(0);`, add:

```cpp
    parameter.SetGestureActive(0, 0, true);
```

Keep the expected values:

```cpp
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.7f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.7f, 0.0001f);
```

For `selected_gesture_weight_biases_gesture_edit_over_base_edit`, remove `manager.SelectGesture(0);`, add:

```cpp
    parameter.SetGestureActive(0, 0, true);
```

Update expected values to Smart Grid-style active distribution:

```cpp
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.55f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.65f, 0.0001f);
```

- [x] **Step 4: Replace multiple-selected test with multiple-active distribution**

Replace `selected_gesture_weight_sum_over_one_leaves_base_unmoved` with:

```cpp
TEST_CASE(active_gesture_distribution_ignores_current_selection) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.GestureValue(0, 0) = 0.5f;
    parameter.GestureValue(0, 1) = 0.5f;
    parameter.SetGestureActive(0, 0, true);
    parameter.SetGestureActive(0, 1, true);
    manager.SetGestureValue(0, 0.8f);
    manager.SetGestureValue(1, 0.4f);
    manager.DeselectGesture(0);
    manager.DeselectGesture(1);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.3f);

    REQUIRE_TRUE(!manager.GestureSelected(0));
    REQUIRE_TRUE(!manager.GestureSelected(1));
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.6f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.66f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 1), 0.54f, 0.0001f);
}
```

The expected math is active weight sum `0.8 + 0.4 = 1.2`; base share is `0.3 * ((0.8 * 0.2) + (0.4 * 0.6)) / 1.2 = 0.1`, so the base moves from `0.5` to `0.6`; gesture 0 share is `0.3 * 0.64 / 1.2 = 0.16`; gesture 1 share is `0.3 * 0.16 / 1.2 = 0.04`.

- [x] **Step 5: Run focused tests to verify RED**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: exits non-zero before production changes. At least these new/changed cases should fail because current code still applies activation and selected-only distribution in the same call.

## Task 2: Production Implementation

**Files:**
- Modify: `projects/synth/src/ParameterModulation.cpp`

- [x] **Step 1: Replace `Parameter::HandleIncDec`**

Replace the full body of `Parameter::HandleIncDec` with:

```cpp
void Parameter::HandleIncDec(const SceneState& scene, float delta) {
    ValidateSceneEndpoints(scene);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);

    auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
        if (GestureActive(sceneIx, gestureIx)) {
            return false;
        }
        GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
        SetGestureActive(sceneIx, gestureIx, true);
        return true;
    };

    bool armedGesture = false;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        if (!group_.Manager().GestureSelected(gestureIx)) {
            continue;
        }

        if (blend <= 0.0f) {
            armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
        } else if (blend >= 1.0f) {
            armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
        } else {
            armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
            if (scene.rightScene != scene.leftScene) {
                armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
            }
        }
    }

    if (armedGesture) {
        return;
    }

    float activeEffectiveWeightSum = 0.0f;
    float baseShareNumerator = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }
        activeEffectiveWeightSum += effectiveWeight;
        baseShareNumerator += effectiveWeight * (1.0f - effectiveWeight);
    }

    if (activeEffectiveWeightSum == 0.0f) {
        ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
        return;
    }

    ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
                           delta * (baseShareNumerator / activeEffectiveWeightSum), config_.range);

    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }

        const float gestureDelta = delta * ((effectiveWeight * effectiveWeight) / activeEffectiveWeightSum);
        ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
                               blend, gestureDelta, config_.range);
    }
}
```

- [x] **Step 2: Run focused tests to verify GREEN**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: exits `0`; all parameter modulation tests pass.

- [x] **Step 3: Run xagent Claude spec review**

Run:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review the current working tree for OpenSpec change fix-synth-gesture-turn-distribution. Focus only on spec compliance. Requirements: selected gestures only arm inactive gesture state; arming copies SceneCenter into GestureValue for touched scene endpoints and applies no delta; non-arming turns distribute across all active gestures regardless of selection using weight*weight/activeWeightSum for gestures and sum(weight*(1-weight))/activeWeightSum for base. Inspect projects/synth/src/ParameterModulation.cpp, projects/synth/tests/parameter_modulation_tests.cpp, and openspec/changes/fix-synth-gesture-turn-distribution. Findings first, ordered by severity, with file/line references. If no findings, say so."
```

Expected: reviewer reports no Critical or Important spec-compliance findings. Fix any valid findings before continuing.

- [x] **Step 4: Run xagent Claude code quality review**

Run:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model sonnet --subagent "Review the current working tree code quality for fix-synth-gesture-turn-distribution. Scope: projects/synth/src/ParameterModulation.cpp and projects/synth/tests/parameter_modulation_tests.cpp. Look for correctness bugs, brittle tests, unintended behavior changes, and maintainability issues. Findings first, ordered by severity, with file/line references. If no findings, say so."
```

Expected: reviewer reports no Critical or Important findings. Fix any valid findings and rerun the relevant review.

## Task 3: OpenSpec Progress and Full Verification

**Files:**
- Modify: `openspec/changes/fix-synth-gesture-turn-distribution/tasks.md`

- [x] **Step 1: Mark OpenSpec tasks complete**

After Task 1 and Task 2 pass review, update every checkbox in:

```text
openspec/changes/fix-synth-gesture-turn-distribution/tasks.md
```

from `- [ ]` to `- [x]`.

- [x] **Step 2: Run focused verification**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: exits `0`.

- [x] **Step 3: Run broader synth verification**

Run:

```bash
make -C projects/synth test
```

Expected: exits `0`.

- [x] **Step 4: Inspect final diff**

Run:

```bash
git diff -- projects/synth/src/ParameterModulation.cpp projects/synth/tests/parameter_modulation_tests.cpp openspec/changes/fix-synth-gesture-turn-distribution docs/superpowers/plans/2026-07-03-fix-synth-gesture-turn-distribution.md
```

Expected: diff is limited to tests, `Parameter::HandleIncDec`, OpenSpec task checkboxes, and this plan. No MIDI profile schema or patch JSON schema files are changed.

- [x] **Step 5: Run final xagent Claude review**

Run:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Final review for fix-synth-gesture-turn-distribution. Review the full working tree diff. Check OpenSpec compliance, test adequacy, unintended schema/API changes, and correctness of gesture arming/distribution. Findings first, ordered by severity, with file/line references. If no findings, say so."
```

Expected: reviewer reports no Critical or Important findings. Fix valid findings and repeat focused verification plus final review.

## Self-Review

- Spec coverage: `spm-12` arming is covered by Task 1 steps 1-2 and Task 2 step 1; deselected active distribution is covered by Task 1 step 1 and Task 2 step 1; multi-active distribution is covered by Task 1 step 4; verification and no unrelated schema changes are covered by Task 3.
- Placeholder scan: no TBD/TODO/fill-in steps remain; every code-changing step has exact code or exact replacement instructions.
- Type consistency: the plan uses existing `Parameter::HandleIncDec`, `SceneState`, `GestureValue`, `SetGestureActive`, `GestureActive`, `SceneCenter`, `ParameterManager::SelectGesture`, and `ParameterManager::DeselectGesture` APIs as present in the current codebase.
