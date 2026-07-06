# Decouple Encoder Block Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move synth parameter target recomputation from host audio block boundaries into group-owned per-sample parameter processing with a default 16-sample interval.

**Architecture:** `ParameterGroupConfig` owns the cadence. `Parameter::ProcessSample(sampleIndex)` refreshes targets when `sampleIndex % targetComputeIntervalSamples == 0`, then delegates to existing `ProcessLite()`. `ParameterGroup::ProcessSample(sampleIndex)` is the application-facing helper; `Engine` exposes a monotonic block start sample through `AudioBlock::startSample`, and the mini app calls group-level processing once per sample.

**Tech Stack:** C++20 synth library under `projects/synth`, custom single-file test harness macros, OpenSpec artifacts under `openspec/changes/decouple-encoder-block-rate`.

## Global Constraints

- `targetComputeIntervalSamples` defaults to exactly `16`.
- `targetComputeIntervalSamples` must be positive; zero is invalid.
- `ProcessLite()` remains the low-level slew-only helper.
- Steady-state `Engine::ProcessBlock()` must not call `ComputeAllTargets()` once per host block.
- `AudioBlock` must expose the block's monotonic starting audio sample index.
- Mini app must use the group-level per-sample processing API with `block.startSample + frame`.
- Do not change patch file format or persisted parameter values.
- Do not move DSP module processing into the runtime.
- Ignore the pre-existing untracked `projects/synth/miniapp/` build directory; do not add, edit, or delete it.
- Worker routing: use xagent Codex subagents for implementation tasks and xagent Claude reviewers for review passes.

---

## File Structure

- `projects/synth/include/synth/ParameterModulation.hpp`: add `kDefaultTargetComputeIntervalSamples`, `ParameterGroupConfig::targetComputeIntervalSamples`, `Parameter::ProcessSample(std::uint64_t)`, and `ParameterGroup::ProcessSample(std::uint64_t)`.
- `projects/synth/src/ParameterModulation.cpp`: validate the interval and implement per-sample parameter/group helpers.
- `projects/synth/include/synth/AppContext.hpp`: add `AudioBlock::startSample`.
- `projects/synth/include/synth/Engine.hpp`: set `block.startSample` before application delegation and remove the steady-state `ComputeAllTargets()` call.
- `projects/synth/apps/miniapp/DemoModulation.hpp`: replace parameter-list `ProcessLiteParameters(...)` helper with group-level `ProcessParameters(...)`.
- `projects/synth/apps/miniapp/MiniAppCore.hpp`: call the group-level helper with `block.startSample + frame`.
- `projects/synth/tests/parameter_modulation_tests.cpp`: add config, per-sample cadence, group coverage, and modulation-depth coverage tests.
- `projects/synth/tests/engine_tests.cpp`: add block start sample and no-block-compute tests; revise the `ProcessFrame` hook test.
- `projects/synth/tests/miniapp_system_tests.cpp`: update default interval assertion and preserve existing behavioral coverage.
- `openspec/changes/decouple-encoder-block-rate/tasks.md`: mark task checkboxes complete after reviewed implementation.

### Task 1: Parameter Group Cadence API

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

**Interfaces:**
- Produces: `inline constexpr std::size_t kDefaultTargetComputeIntervalSamples = 16;`
- Produces: `ParameterGroupConfig::targetComputeIntervalSamples`
- Produces: `void Parameter::ProcessSample(std::uint64_t sampleIndex)`
- Produces: `void ParameterGroup::ProcessSample(std::uint64_t sampleIndex)`

- [ ] **Step 1: Add failing config validation coverage**

In `projects/synth/tests/parameter_modulation_tests.cpp`, extend `TEST_CASE(group_config_validation)` so it asserts:

```cpp
REQUIRE_TRUE(defaultAlpha.targetComputeIntervalSamples == 16);

valid.targetComputeIntervalSamples = 32;
REQUIRE_TRUE(valid.IsValid());

const synth::ParameterGroupConfig zeroTargetInterval{
    .numVoices = 1,
    .numScenes = 1,
    .maxParameters = 1,
    .targetComputeIntervalSamples = 0,
};
REQUIRE_TRUE(!zeroTargetInterval.IsValid());
```

- [ ] **Step 2: Add failing per-sample processing tests**

Add these tests near existing `ProcessLite`/audio-path tests in `projects/synth/tests/parameter_modulation_tests.cpp`:

```cpp
TEST_CASE(parameter_process_sample_recomputes_on_configured_interval) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
        .targetComputeIntervalSamples = 16,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Probe", .defaultValue = 0.0f});

    parameter.SceneCenter(0) = 0.25f;
    parameter.ProcessSample(0);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);

    parameter.SceneCenter(0) = 0.75f;
    parameter.ProcessSample(15);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.25f, 0.0001f);

    parameter.ProcessSample(16);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.75f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenter(), 0.75f, 0.0001f);
}

TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_targets) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .targetComputeIntervalSamples = 16,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
    auto& sibling = manager.CreateParameter(group, {.name = "Sibling", .defaultValue = 0.1f});
    synth::Parameter* depth = carrier.EnsureModulationDepth(0);
    REQUIRE_TRUE(depth != nullptr);

    carrier.SceneCenter(0) = 0.2f;
    sibling.SceneCenter(0) = 0.4f;
    depth->SceneCenter(0) = 0.5f;

    group.ProcessSample(0);

    REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
    REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
    REQUIRE_NEAR(depth->TargetCenter(), 0.5f, 0.0001f);
    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.5f, 0.0001f);
}
```

- [ ] **Step 3: Run focused test and confirm failure**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected before implementation: compile failure for missing `targetComputeIntervalSamples`, `ProcessSample`, or both.

- [ ] **Step 4: Implement config and helpers**

In `projects/synth/include/synth/ParameterModulation.hpp`:

```cpp
#include <cstdint>

inline constexpr std::size_t kDefaultTargetComputeIntervalSamples = 16;

struct ParameterGroupConfig {
    std::size_t numVoices = 0;
    std::size_t numModulators = 0;
    std::size_t numScenes = 0;
    std::size_t maxParameters = 0;
    float processLiteAlpha = kDefaultProcessLiteAlpha;
    std::size_t targetComputeIntervalSamples = kDefaultTargetComputeIntervalSamples;
    float uiDisplayCenterAlpha = kDefaultUiDisplayCenterAlpha;
    float uiDisplaySpreadAlpha = kDefaultUiDisplaySpreadAlpha;
    std::vector<Color> voiceIndicatorColors;
    bool IsValid() const;
};

class ParameterGroup {
public:
    void ProcessSample(std::uint64_t sampleIndex);
};

class Parameter {
public:
    void ProcessSample(std::uint64_t sampleIndex);
};
```

Keep existing declarations and ordering where they already live; do not duplicate class declarations.

In `projects/synth/src/ParameterModulation.cpp`, update validation:

```cpp
bool ParameterGroupConfig::IsValid() const {
    return numVoices > 0 && numScenes > 0 && maxParameters > 0 &&
           targetComputeIntervalSamples > 0 &&
           processLiteAlpha >= 0.0f && processLiteAlpha <= 1.0f &&
           uiDisplayCenterAlpha >= 0.0f && uiDisplayCenterAlpha <= 1.0f &&
           uiDisplaySpreadAlpha >= 0.0f && uiDisplaySpreadAlpha <= 1.0f;
}
```

Add implementations near the existing `Parameter::ProcessLite()` and `ParameterGroup` methods:

```cpp
void Parameter::ProcessSample(std::uint64_t sampleIndex) {
    if (sampleIndex % group_.Config().targetComputeIntervalSamples == 0) {
        Compute(group_.Manager().Scene());
    }
    ProcessLite();
}

void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
    for (std::size_t localIx = 0; localIx < parameterCount_; ++localIx) {
        parameters_.at(localIx)->ProcessSample(sampleIndex);
    }
}
```

- [ ] **Step 5: Run focused test and confirm pass**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Expected: parameter modulation tests pass.

- [ ] **Step 6: Mark OpenSpec parameter tasks complete**

After review approval, change tasks `1.1` through `1.5` in `openspec/changes/decouple-encoder-block-rate/tasks.md` from `- [ ]` to `- [x]`.

### Task 2: Runtime Monotonic Sample Position

**Files:**
- Modify: `projects/synth/include/synth/AppContext.hpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp`

**Interfaces:**
- Consumes: `ParameterGroup::ProcessSample(std::uint64_t sampleIndex)` from Task 1.
- Produces: `AudioBlock::startSample`.
- Produces: `Engine::ProcessBlock` no longer calls `manager_.ComputeAllTargets()` during steady-state block processing.

- [ ] **Step 1: Add failing engine coverage for block start samples**

In `projects/synth/tests/engine_tests.cpp`, add `std::uint64_t lastBlockStartSample = 0;` to `EngineTestApp`, reset it with other static-ish test state if needed, and set it in `EngineTestApp::ProcessBlock`:

```cpp
lastBlockStartSample = block.startSample;
```

Add:

```cpp
TEST_CASE(engine_audio_block_exposes_monotonic_start_sample) {
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 10);

    TestBlockBuffers buffers(2, 10);
    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }
    REQUIRE_TRUE(engine.Application().lastBlockStartSample == 0);

    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/1);
    }
    REQUIRE_TRUE(engine.Application().lastBlockStartSample == 10);
}
```

- [ ] **Step 2: Add failing coverage that engine does not compute targets per block**

Add to `EngineTestApp::ProcessBlock`:

```cpp
lastProbeDuringBlock = context->parameterManager->ParameterById(probeId).CurrentCenter();
```

Add:

```cpp
TEST_CASE(engine_process_block_does_not_compute_targets_at_host_block_boundary) {
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 10);

    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/0, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 10);
    {
        synth::AudioBlock block = buffers.Block(10);
        engine.ProcessBlock(block, /*timestamp=*/0);
    }

    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, 0.25f, 1e-4f);
    engine.Application().context->parameterManager->ParameterById(engine.Application().probeId).ProcessSample(0);
    REQUIRE_NEAR(engine.Application().context->parameterManager->ParameterById(engine.Application().probeId).CurrentCenter(), 0.55f, 1e-4f);
}
```

- [ ] **Step 3: Revise ProcessFrame test**

Rename `engine_process_frame_hook_runs_once_per_block_after_targets_before_process_block` to `engine_process_frame_hook_runs_once_per_block_after_messages_before_process_block`.

Remove target-computation expectations from comments and assertions. Keep the scene-center assertion:

```cpp
REQUIRE_NEAR(engine.Application().probeSceneCenterDuringProcessFrame, 0.55f, 1e-4f);
```

Rename `probeTargetDuringProcessFrame` to `probeSceneCenterDuringProcessFrame` and keep it reading `SceneCenter(0)`.

- [ ] **Step 4: Run focused engine test and confirm failure**

Run:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Expected before implementation: compile failure for missing `AudioBlock::startSample`, or failure showing the engine still computes targets at block boundary.

- [ ] **Step 5: Implement runtime sample position and remove block-boundary target compute**

In `projects/synth/include/synth/AppContext.hpp`, extend `AudioBlock`:

```cpp
std::uint64_t startSample = 0;
```

In `projects/synth/include/synth/Engine.hpp`, replace:

```cpp
manager_.ComputeAllTargets();
if constexpr (HasProcessFrame<App>) {
    app_.ProcessFrame();
}
sampleCounter_.fetch_add(block.numFrames, std::memory_order_relaxed);
app_.ProcessBlock(block);
```

with:

```cpp
if constexpr (HasProcessFrame<App>) {
    app_.ProcessFrame();
}
const std::uint64_t blockStartSample =
    sampleCounter_.fetch_add(block.numFrames, std::memory_order_relaxed);
block.startSample = blockStartSample;
app_.ProcessBlock(block);
```

Update comments above `ProcessBlock` to remove `ComputeAllTargets()` from the steady-state binding order and describe `startSample`.

- [ ] **Step 6: Run focused engine test and confirm pass**

Run:

```bash
make -C projects/synth build/engine_tests && projects/synth/build/engine_tests
```

Expected: engine tests pass.

- [ ] **Step 7: Mark OpenSpec runtime tasks complete**

After review approval, mark tasks `2.1` through `2.5` complete in `openspec/changes/decouple-encoder-block-rate/tasks.md`.

### Task 3: Mini App Migration

**Files:**
- Modify: `projects/synth/apps/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify as needed: `projects/synth/Makefile` comments that mention the old helper

**Interfaces:**
- Consumes: `AudioBlock::startSample` from Task 2.
- Consumes: `ParameterGroup::ProcessSample(std::uint64_t sampleIndex)` from Task 1.

- [ ] **Step 1: Add/update mini app interval assertion**

In `TEST_CASE(miniapp_rig_initializes_headlessly_and_runs)`, replace the old expected default alpha-only check with both checks:

```cpp
const float expectedDefaultAlpha = 0.1226942309f;
REQUIRE_NEAR(rig.Application().Group()->Config().processLiteAlpha, expectedDefaultAlpha, 0.000001f);
REQUIRE_TRUE(rig.Application().Group()->Config().targetComputeIntervalSamples == 16);
```

- [ ] **Step 2: Update mini app helper**

In `projects/synth/apps/miniapp/DemoModulation.hpp`, replace `ProcessLiteParameters(std::span<synth::Parameter*> parameters)` with:

```cpp
inline void ProcessParameters(synth::ParameterGroup& group, std::uint64_t sampleIndex) {
    group.ProcessSample(sampleIndex);
}
```

Keep the include of `synth/ParameterModulation.hpp`; remove `<span>` if unused.

- [ ] **Step 3: Update mini app per-sample loop**

In `MiniAppCore::ProcessBlock`, replace:

```cpp
ProcessLiteParameters(parameters_);
```

with:

```cpp
ProcessParameters(*group_, block.startSample + frame);
```

Keep the module order unchanged: parameter processing first, then VCO, filter, LFO, `UpdateModValues`, output write, scope advance.

- [ ] **Step 4: Update stale comments**

Update comments in `MiniAppCore.hpp` and `projects/synth/Makefile` that refer to the old per-sample `ProcessLite` helper so they describe group-level per-sample parameter processing.

- [ ] **Step 5: Run focused mini app tests**

Run:

```bash
make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests
```

Expected: mini app system tests pass.

- [ ] **Step 6: Mark OpenSpec mini app tasks complete**

After review approval, mark tasks `3.1` through `3.3` complete in `openspec/changes/decouple-encoder-block-rate/tasks.md`.

### Task 4: Verification and OpenSpec Completion

**Files:**
- Modify: `openspec/changes/decouple-encoder-block-rate/tasks.md`

**Interfaces:**
- Consumes all previous task implementations.
- Produces completed OpenSpec task checklist.

- [ ] **Step 1: Run focused test binaries**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests build/engine_tests build/rig_tests build/miniapp_system_tests
projects/synth/build/parameter_modulation_tests
projects/synth/build/engine_tests
projects/synth/build/rig_tests
projects/synth/build/miniapp_system_tests
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run full synth test target**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

- [ ] **Step 3: Validate OpenSpec**

Run:

```bash
openspec validate --strict decouple-encoder-block-rate
openspec status --change decouple-encoder-block-rate
```

Expected: validation succeeds and status reports all artifacts complete.

- [ ] **Step 4: Mark verification tasks complete**

Mark tasks `4.1` through `4.3` complete in `openspec/changes/decouple-encoder-block-rate/tasks.md`.

- [ ] **Step 5: Final review package**

Prepare the final branch diff for a Claude whole-branch review. Include the implementation diff, tests run, and OpenSpec status output.

---

## Plan Self-Review

- Spec coverage: Task 1 covers `spm-4` and `spm-11`; Task 2 covers `sar-6`; Task 3 covers `sar-11`; Task 4 covers OpenSpec verification tasks.
- Placeholder scan: no placeholders or TBDs remain.
- Type consistency: uses `std::uint64_t sampleIndex`, `Parameter::ProcessSample`, `ParameterGroup::ProcessSample`, and `AudioBlock::startSample` consistently.
