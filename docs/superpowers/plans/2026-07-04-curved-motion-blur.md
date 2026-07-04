# Curved Motion Blur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render audio-rate parameter motion as a curved melted value indicator and fix nested modulation-depth UI state.

**Architecture:** Nested/local depth parameters keep simple truthful UI by seeding their cached UI state during recursive compute. Encoder rendering keeps range arcs unchanged but replaces the separate spread arc with a value indicator that widens along the knob curve and fades its outline as motion grows.

**Tech Stack:** C++20, JUCE component rendering, existing synth parameter tests, existing miniapp geometry tests.

---

### Task 1: Nested Depth UI State Regression

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`

- [ ] **Step 1: Write the failing test**

Add a test near the existing UI display tests. It must use `ComputeAllTargets()`, not `ComputeAllParameters()`, after mutating a child depth parameter:

```cpp
TEST_CASE(nested_modulation_depth_ui_state_uses_true_value_without_motion) {
    synth::ParameterManager manager;
    synth::ParameterGroupConfig config{
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .uiDisplayCenterAlpha = 0.25f,
        .uiDisplaySpreadAlpha = 0.5f,
    };
    synth::ParameterGroup& group = manager.CreateGroup(config);
    float modValue = 0.75f;
    std::array<float*, 1> source{&modValue};
    group.SetModulationSource(0, source, {.name = "VCO", .shortName = "VCO", .connected = true});

    synth::Parameter& target =
        manager.CreateParameter(group, {.name = "Phase", .shortName = "Phas", .defaultValue = 0.0f});
    synth::Parameter* depth = target.EnsureModulationDepth(0);
    REQUIRE_TRUE(depth != nullptr);

    manager.ComputeAllParameters();
    REQUIRE_NEAR(depth->UIDisplayCenter(0), depth->GetRaw(0), 0.0001f);

    depth->SceneCenter(0) = 1.0f;
    manager.ComputeAllTargets();

    REQUIRE_NEAR(depth->GetRaw(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(depth->UIDisplayCenter(0), depth->GetRaw(0), 0.0001f);
    REQUIRE_NEAR(depth->UIDisplaySpread(0), 0.0f, 0.0001f);
}
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected before implementation: the new test fails because `UIDisplayCenter(0)` remains stale after `ComputeAllTargets()`.

- [ ] **Step 3: Implement minimal recursive seeding**

In `Parameter::ComputeAtDepth`, inside the existing `if (recursionDepth_ > 0)` block, call `SeedCachedKnobAndUiDisplayState()` after the current-state copies.

- [ ] **Step 4: Re-run targeted test and verify pass**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: PASS.

### Task 2: Curved Melted Dot Geometry Helpers

**Files:**
- Modify: `projects/synth/juce/EncoderComponent.hpp`
- Modify: `projects/synth/juce/EncoderComponentGeometryTests.cpp`

- [ ] **Step 1: Replace obsolete spread-width geometry tests**

Remove the `DisplaySpreadToStrokeWidth` assertions and add tests for:

```cpp
RequireNear(synth_juce::EncoderComponent::MotionBlurAmount(0.0f), 0.0f, tolerance, "zero motion blur amount");
RequireNear(synth_juce::EncoderComponent::MotionBlurAmount(1.0f), 1.0f, tolerance, "large motion blur amount clamps");
RequireTrue(synth_juce::EncoderComponent::MotionBlurArcHalfWidth(40.0f, 0.2f) >
                synth_juce::EncoderComponent::MotionBlurArcHalfWidth(40.0f, 0.0f),
            "motion blur arc widens with motion");
RequireNear(synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.0f), 0.55f, tolerance,
            "resting outline alpha matches existing dot");
RequireTrue(synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.5f) <
                synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.0f),
            "motion blur outline fades with motion");
```

- [ ] **Step 2: Run miniapp geometry tests and verify failure**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected before implementation: compile failure because the helper functions do not exist.

- [ ] **Step 3: Add helper functions**

Add public static helpers to `EncoderComponent`:

```cpp
static float MotionBlurAmount(float displaySpread);
static float MotionBlurArcHalfWidth(float radius, float motionAmount);
static float MotionBlurOutlineAlpha(float motionAmount);
```

At motion zero, `MotionBlurArcHalfWidth` must return the same radius as the current dot radius calculation.

- [ ] **Step 4: Run miniapp geometry tests and verify pass**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected: PASS.

### Task 3: Curved Melted Dot Rendering

**Files:**
- Modify: `projects/synth/juce/EncoderComponent.hpp`

- [ ] **Step 1: Replace separate spread arc with curved value indicator**

In `DrawVoiceIndicators`, remove the separate `DrawArc(... spreadStart, spreadEnd, spreadStrokeWidth)` block. Draw the value indicator through a helper that:

- Uses the already-normalized `value`.
- Computes `displaySpread` with the existing bipolar halving.
- Draws a crisp dot when motion is zero.
- Draws three centered curved strokes when motion is nonzero: wide low-alpha, medium middle-alpha, bright core.
- Draws the black outline with `MotionBlurOutlineAlpha(motion)`.

- [ ] **Step 2: Run miniapp geometry tests**

Run:

```bash
make -C projects/synth/apps/miniapp test
```

Expected: PASS.

### Task 4: Full Verification and Review

**Files:**
- All changed files.

- [ ] **Step 1: Run targeted tests**

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
make -C projects/synth/apps/miniapp test
```

- [ ] **Step 2: Run synth suite**

```bash
make -C projects/synth test
```

- [ ] **Step 3: Request final Claude review**

Ask xagent Claude/Opus to review the final diff for correctness, visual semantics, and regressions.
