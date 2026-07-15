# Constant Modulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable immutable per-voice constant modulation source, its ordered bar visualizer, and the source at MiniApp modulator index `5`.

**Architecture:** A runtime-sized `ConstantModulatorProcessor` owns construction-time values and stable source pointers. A JUCE-free `ConstantBarVisualizer` borrows the immutable value span. MiniApp retains both in lifetime-safe member order, registers the pointers and visualizer in its sixth slot, and performs no per-sample constant work.

**Tech Stack:** C++20, portable synth draw commands, existing `ParameterGroup` pointer-backed modulation, Make, OpenSpec, JUCE-free custom test harnesses.

## Global Constraints

- Zero voices is invalid; one voice publishes exactly `0`.
- For `n = 2m`, permutation entry `2k` is `k` and entry `2k + 1` is `m + k`.
- For `n = 2m + 1 > 1`, entries `0,1` are `0,m`, entries `2k,2k+1` are `m+k,k`, and entry `2m` is `2m`.
- Voice `j` publishes permutation entry `j / (n - 1)`; values and pointer addresses never change after construction.
- The processor has no per-sample `Process()` operation and knows no parameter, UI, bank, page, or modulator index.
- The visualizer borrows immutable normalized values and emits exactly one filled rectangle per voice in voice order, with no other draw commands.
- Visual data range is exactly `[-0.1, 1.1]`: zero fills `1/12` of the height and one leaves `1/12` clear at the top.
- MiniApp keeps indexes `0` through `4` unchanged, registers connected yellow `Constant` at index `5`, configures six modulators, and uses capacity `84`.
- No new parameter, page, bank, scope, persistence field, controller mapping, backend-specific type, or audio routing.
- Follow strict red-green-refactor: observe the focused test fail for the missing feature before adding production code.

---

### Task 1: Immutable Constant DSP Processor

**Files:**
- Create: `projects/synth/include/synth/DspConstant.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `openspec/changes/add-constant-modulator/tasks.md`

**Interfaces:**
- Consumes: `ParameterGroup::SetModulationSource(std::size_t, std::span<float* const>, ModulatorMetadata)`.
- Produces: `synth::ConstantModulatorProcessor(std::size_t)`, `VoiceCount()`, `Output(std::size_t)`, `Outputs()`, and `SourcePointers()`.

- [ ] **Step 1: Write processor contract tests before the header exists**

Add `#include "synth/DspConstant.hpp"`, a `HasProcessMethod` concept, compile-time lifetime assertions, and these behavioral cases to `dsp_tests.cpp`:

```cpp
template<typename Processor>
concept HasProcessMethod = requires(Processor& processor) { processor.Process(); };

static_assert(!std::is_copy_constructible_v<synth::ConstantModulatorProcessor>);
static_assert(!std::is_copy_assignable_v<synth::ConstantModulatorProcessor>);
static_assert(!std::is_move_constructible_v<synth::ConstantModulatorProcessor>);
static_assert(!std::is_move_assignable_v<synth::ConstantModulatorProcessor>);
static_assert(!HasProcessMethod<synth::ConstantModulatorProcessor>);

TEST_CASE(constant_modulator_validates_runtime_voice_count_and_bounds) {
    bool rejectedZero = false;
    try {
        synth::ConstantModulatorProcessor invalid(0);
        (void)invalid;
    } catch (const std::invalid_argument&) {
        rejectedZero = true;
    }
    REQUIRE_TRUE(rejectedZero);

    synth::ConstantModulatorProcessor mono(1);
    REQUIRE_TRUE(mono.VoiceCount() == 1);
    REQUIRE_TRUE(mono.Outputs().size() == 1);
    REQUIRE_TRUE(mono.SourcePointers().size() == 1);
    REQUIRE_TRUE(mono.Output(0) == 0.0f);
    bool rejectedPastEnd = false;
    try {
        (void)mono.Output(1);
    } catch (const std::out_of_range&) {
        rejectedPastEnd = true;
    }
    REQUIRE_TRUE(rejectedPastEnd);
}

TEST_CASE(constant_modulator_uses_exact_greedy_even_and_odd_assignments) {
    const std::vector<std::vector<float>> expected{
        {},
        {0.0f},
        {0.0f, 1.0f},
        {0.0f, 0.5f, 1.0f},
        {0.0f, 2.0f / 3.0f, 1.0f / 3.0f, 1.0f},
        {0.0f, 0.5f, 0.75f, 0.25f, 1.0f},
        {0.0f, 3.0f / 5.0f, 1.0f / 5.0f, 4.0f / 5.0f, 2.0f / 5.0f, 1.0f},
        {0.0f, 0.5f, 2.0f / 3.0f, 1.0f / 6.0f,
         5.0f / 6.0f, 1.0f / 3.0f, 1.0f},
    };
    for (std::size_t voices = 1; voices < expected.size(); ++voices) {
        synth::ConstantModulatorProcessor processor(voices);
        for (std::size_t voice = 0; voice < voices; ++voice) {
            REQUIRE_NEAR(processor.Output(voice), expected[voices][voice], 1.0e-6f);
        }
    }
}

TEST_CASE(constant_modulator_covers_ranks_and_maximizes_cyclic_distance) {
    for (std::size_t voices = 2; voices <= 16; ++voices) {
        synth::ConstantModulatorProcessor processor(voices);
        std::vector<std::size_t> ranks;
        ranks.reserve(voices);
        for (const float output : processor.Outputs()) {
            ranks.push_back(static_cast<std::size_t>(
                std::lround(output * static_cast<float>(voices - 1))));
        }
        auto sorted = ranks;
        std::sort(sorted.begin(), sorted.end());
        for (std::size_t rank = 0; rank < voices; ++rank) {
            REQUIRE_TRUE(sorted[rank] == rank);
        }
        std::size_t distance = 0;
        for (std::size_t voice = 0; voice < voices; ++voice) {
            const std::size_t next = (voice + 1) % voices;
            distance += ranks[voice] > ranks[next]
                ? ranks[voice] - ranks[next]
                : ranks[next] - ranks[voice];
        }
        REQUIRE_TRUE(distance == (voices * voices) / 2);
    }
}

TEST_CASE(constant_modulator_keeps_values_and_registered_addresses_stable) {
    synth::ConstantModulatorProcessor processor(4);
    const auto pointers = processor.SourcePointers();
    const std::array<float*, 4> initialPointers{pointers[0], pointers[1], pointers[2], pointers[3]};
    const std::array<float, 4> initialValues{
        processor.Output(0), processor.Output(1), processor.Output(2), processor.Output(3)};
    for (std::size_t voice = 0; voice < processor.VoiceCount(); ++voice) {
        REQUIRE_TRUE(processor.SourcePointers()[voice] == initialPointers[voice]);
        REQUIRE_TRUE(*initialPointers[voice] == initialValues[voice]);
        REQUIRE_TRUE(*initialPointers[voice] == processor.Output(voice));
    }
}

TEST_CASE(constant_modulator_registers_directly_as_pointer_backed_group_source) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 4, .numModulators = 1, .numScenes = 1, .maxParameters = 1,
    });
    synth::ConstantModulatorProcessor processor(4);
    group.SetModulationSource(0, processor.SourcePointers(), {
        .name = "Constant", .shortName = "Const", .connected = true,
    });
    for (int update = 0; update < 2; ++update) {
        group.UpdateModValues();
        for (std::size_t voice = 0; voice < processor.VoiceCount(); ++voice) {
            REQUIRE_TRUE(group.GetModulators().Value(voice, 0) == processor.Output(voice));
        }
    }
}
```

- [ ] **Step 2: Run RED and confirm the missing processor is the cause**

Run: `make -C projects/synth build/dsp_tests`

Expected: compilation fails because `synth/DspConstant.hpp` or `ConstantModulatorProcessor` does not exist. Do not add production code until this failure is observed and recorded in the task report.

- [ ] **Step 3: Implement the minimal immutable processor**

Create `DspConstant.hpp` with this API and closed-form construction:

```cpp
#pragma once

#include <cstddef>
#include <span>
#include <stdexcept>
#include <vector>

namespace synth {

class ConstantModulatorProcessor {
public:
    explicit ConstantModulatorProcessor(std::size_t voiceCount)
        : outputs_(voiceCount) {
        if (voiceCount == 0) {
            throw std::invalid_argument("constant modulator requires at least one voice");
        }
        InitializeOutputs();
        sourcePointers_.reserve(outputs_.size());
        for (float& output : outputs_) {
            sourcePointers_.push_back(&output);
        }
    }

    ConstantModulatorProcessor(const ConstantModulatorProcessor&) = delete;
    ConstantModulatorProcessor& operator=(const ConstantModulatorProcessor&) = delete;
    ConstantModulatorProcessor(ConstantModulatorProcessor&&) = delete;
    ConstantModulatorProcessor& operator=(ConstantModulatorProcessor&&) = delete;

    std::size_t VoiceCount() const noexcept { return outputs_.size(); }
    float Output(std::size_t voice) const { return outputs_.at(voice); }
    std::span<const float> Outputs() const noexcept { return outputs_; }
    std::span<float* const> SourcePointers() const noexcept { return sourcePointers_; }

private:
    void InitializeOutputs() noexcept {
        const std::size_t voices = outputs_.size();
        if (voices == 1) {
            outputs_[0] = 0.0f;
            return;
        }
        const float denominator = static_cast<float>(voices - 1);
        const std::size_t half = voices / 2;
        if ((voices % 2) == 0) {
            for (std::size_t k = 0; k < half; ++k) {
                outputs_[2 * k] = static_cast<float>(k) / denominator;
                outputs_[2 * k + 1] = static_cast<float>(half + k) / denominator;
            }
            return;
        }
        outputs_[0] = 0.0f;
        outputs_[1] = static_cast<float>(half) / denominator;
        for (std::size_t k = 1; k < half; ++k) {
            outputs_[2 * k] = static_cast<float>(half + k) / denominator;
            outputs_[2 * k + 1] = static_cast<float>(k) / denominator;
        }
        outputs_[voices - 1] = 1.0f;
    }

    std::vector<float> outputs_;
    std::vector<float*> sourcePointers_;
};

} // namespace synth
```

- [ ] **Step 4: Add dependency tracking and run GREEN**

Add `include/synth/DspConstant.hpp` to `DSP_HEADERS`. Run:

```bash
make -C projects/synth build/dsp_tests
projects/synth/build/dsp_tests
```

Expected: build succeeds and all DSP cases pass, including the five constant-modulator cases.

- [ ] **Step 5: Synchronize OpenSpec and commit**

Mark OpenSpec tasks `1.1`, `1.2`, and `1.3` complete only after GREEN. Run `openspec validate add-constant-modulator --strict`, then commit:

```bash
git add projects/synth/include/synth/DspConstant.hpp projects/synth/tests/dsp_tests.cpp projects/synth/Makefile openspec/changes/add-constant-modulator/tasks.md
git commit -m "feat(synth): add constant modulator processor"
```

### Task 2: Ordered Portable Constant Bar Visualizer

**Files:**
- Create: `projects/synth/include/synth/ConstantBarVisualizer.hpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `openspec/changes/add-constant-modulator/tasks.md`

**Interfaces:**
- Consumes: `std::span<const float>`, `synth::Color`, `Visualizer::GetBounds()`, and `DrawCommand::Fill(Bounds, Color)`.
- Produces: `synth::ui::ConstantBarVisualizer(std::span<const float>, Color)`.

- [ ] **Step 1: Write visualizer tests before the header exists**

Include `synth/ConstantBarVisualizer.hpp` in `portable_ui_tests.cpp`. Add focused blocks beside the noise visualizer contract tests that assert:

```cpp
{
    const std::array<float, 4> values{0.0f, 2.0f / 3.0f, 1.0f / 3.0f, 1.0f};
    synth::ui::ConstantBarVisualizer visualizer(values, synth::Color::Yellow);
    const synth::ui::Bounds bounds{10.0f, 20.0f, 80.0f, 120.0f};
    visualizer.SetBounds(bounds);
    const auto commands = visualizer.Draw();
    Require(commands.size() == values.size(), "constant visualizer emits one command per voice");
    for (std::size_t voice = 0; voice < values.size(); ++voice) {
        Require(commands[voice].kind == synth::ui::DrawCommand::Kind::Fill,
                "constant visualizer emits only filled rectangles");
        Require(commands[voice].color == synth::Color::Yellow,
                "constant visualizer retains source color");
        Require(commands[voice].bounds.width > 0.0f,
                "constant visualizer keeps positive bar width");
        Require(commands[voice].bounds.x >= bounds.x &&
                commands[voice].bounds.x + commands[voice].bounds.width <= bounds.x + bounds.width,
                "constant visualizer bar stays horizontally bounded");
        RequireNear(commands[voice].bounds.y + commands[voice].bounds.height,
                    bounds.y + bounds.height, 0.0001f,
                    "constant visualizer bars share the bottom edge");
    }
    RequireNear(commands[0].bounds.height, bounds.height / 12.0f, 0.0001f,
                "zero voice remains visible");
    RequireNear(commands[3].bounds.y, bounds.y + bounds.height / 12.0f, 0.0001f,
                "one voice keeps a top margin");
    Require(commands[1].bounds.height > commands[2].bounds.height,
            "bar heights retain voice-order values without sorting");
    const auto repeated = visualizer.Draw();
    for (std::size_t voice = 0; voice < values.size(); ++voice) {
        RequireNear(repeated[voice].bounds.y, commands[voice].bounds.y, 0.0001f,
                    "immutable repeated draw keeps bar geometry");
    }
}

{
    const std::array<float, 2> values{0.0f, 1.0f};
    synth::ui::ConstantBarVisualizer narrow(values, synth::Color::Cyan);
    narrow.SetBounds({1.0f, 2.0f, 0.5f, 3.0f});
    const auto commands = narrow.Draw();
    Require(commands.size() == 2, "narrow constant visualizer retains both bars");
    Require(commands[0].bounds.width > 0.0f && commands[1].bounds.width > 0.0f,
            "slot-relative gaps preserve positive width");

    const std::span<const float> empty;
    synth::ui::ConstantBarVisualizer emptyVisualizer(empty, synth::Color::White);
    emptyVisualizer.SetBounds({0.0f, 0.0f, 10.0f, 10.0f});
    Require(emptyVisualizer.Draw().empty(), "empty constant values draw nothing");
    for (const synth::ui::Bounds invalid : {
             synth::ui::Bounds{0.0f, 0.0f, 0.0f, 1.0f},
             synth::ui::Bounds{0.0f, 0.0f, 1.0f, 0.0f},
             synth::ui::Bounds{0.0f, 0.0f, -1.0f, 1.0f},
             synth::ui::Bounds{0.0f, 0.0f, std::numeric_limits<float>::infinity(), 1.0f},
             synth::ui::Bounds{std::numeric_limits<float>::quiet_NaN(), 0.0f, 1.0f, 1.0f}}) {
        narrow.SetBounds(invalid);
        Require(narrow.Draw().empty(), "invalid constant visualizer bounds are safe");
    }
}
```

Also add non-copyable/non-movable assertions and a `Builder::Visualizer` composition block proving the draw node preserves bounds, precedes an encoder node, disappears when hidden, and carries exactly the bar commands.

```cpp
static_assert(!std::is_copy_constructible_v<synth::ui::ConstantBarVisualizer>);
static_assert(!std::is_copy_assignable_v<synth::ui::ConstantBarVisualizer>);
static_assert(!std::is_move_constructible_v<synth::ui::ConstantBarVisualizer>);
static_assert(!std::is_move_assignable_v<synth::ui::ConstantBarVisualizer>);

const std::array<float, 2> stackValues{0.0f, 1.0f};
synth::ui::ConstantBarVisualizer stackingVisualizer(stackValues, synth::Color::Yellow);
const synth::ui::Bounds stackBounds{20.0f, 20.0f, 64.0f, 64.0f};
stackingVisualizer.SetBounds(stackBounds);
synth::ui::Visualizer* const stableAddress = &stackingVisualizer;
synth::ui::Builder builder;
builder.Root("constant.stack.root", {0.0f, 0.0f, 100.0f, 100.0f})
    .Visualizer("constant.stack.visualizer", &stackingVisualizer)
    .DrawInteractive("constant.stack.encoder", stackBounds,
                     {synth::ui::DrawCommand::StrokeEllipse(
                         stackBounds, synth::Color::White, 1.0f)},
                     synth::ui::Action::Named("drag"));
const synth::ui::NodeTree tree = builder.Build();
const synth::ui::Node* root = FindNodeById(tree, "constant.stack.root");
const synth::ui::Node* node = FindNodeById(tree, "constant.stack.visualizer");
Require(stableAddress == static_cast<synth::ui::Visualizer*>(&stackingVisualizer),
        "constant visualizer remains address-stable");
Require(node != nullptr && node->drawCommands.size() == stackValues.size(),
        "constant builder carries one bar per voice");
RequireNear(node->bounds.width, stackBounds.width, 0.0001f,
            "constant builder preserves bounds");
Require(root != nullptr && root->children.size() == 2,
        "constant visualizer and encoder are both appended");
Require(root->children[0] == synth::ui::NodeId("constant.stack.visualizer"),
        "constant visualizer precedes encoder");
Require(root->children[1] == synth::ui::NodeId("constant.stack.encoder"),
        "constant encoder follows visualizer");
stackingVisualizer.SetVisible(false);
synth::ui::Builder hiddenBuilder;
hiddenBuilder.Root("constant.hidden.root", {0.0f, 0.0f, 100.0f, 100.0f})
    .Visualizer("constant.hidden.visualizer", &stackingVisualizer);
Require(FindNodeById(hiddenBuilder.Build(), "constant.hidden.visualizer") == nullptr,
        "hidden constant visualizer emits no builder node");
```

- [ ] **Step 2: Run RED and confirm the missing visualizer is the cause**

Run: `make -C projects/synth build/portable_ui_tests`

Expected: compilation fails because `ConstantBarVisualizer.hpp` or its class is absent.

- [ ] **Step 3: Implement the minimal bar visualizer**

Create `ConstantBarVisualizer.hpp`:

```cpp
#pragma once

#include "synth/PortableUI.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>
#include <vector>

namespace synth::ui {

class ConstantBarVisualizer final : public Visualizer {
public:
    explicit ConstantBarVisualizer(
        std::span<const float> values,
        Color color = Color::White) noexcept
        : values_(values), color_(color) {}

protected:
    std::vector<DrawCommand> DrawVisible() const override {
        const Bounds bounds = GetBounds();
        if (values_.empty() || !std::isfinite(bounds.x) || !std::isfinite(bounds.y) ||
            !std::isfinite(bounds.width) || !std::isfinite(bounds.height) ||
            bounds.width <= 0.0f || bounds.height <= 0.0f) {
            return {};
        }
        for (const float value : values_) {
            if (!std::isfinite(value)) {
                return {};
            }
        }

        constexpr float kMinimum = -0.1f;
        constexpr float kMaximum = 1.1f;
        constexpr float kRange = kMaximum - kMinimum;
        const float slotWidth = bounds.width / static_cast<float>(values_.size());
        const float gap = std::min(2.0f, slotWidth * 0.2f);
        const float barWidth = slotWidth - gap;
        const float bottom = bounds.y + bounds.height;
        std::vector<DrawCommand> commands;
        commands.reserve(values_.size());
        for (std::size_t voice = 0; voice < values_.size(); ++voice) {
            const float value = std::clamp(values_[voice], 0.0f, 1.0f);
            const float top = bounds.y + ((kMaximum - value) / kRange) * bounds.height;
            commands.push_back(DrawCommand::Fill({
                bounds.x + static_cast<float>(voice) * slotWidth + gap * 0.5f,
                top,
                barWidth,
                bottom - top,
            }, color_));
        }
        return commands;
    }

private:
    std::span<const float> values_;
    Color color_;
};

} // namespace synth::ui
```

- [ ] **Step 4: Add dependency tracking and run GREEN**

Add `include/synth/ConstantBarVisualizer.hpp` to the portable UI and MiniApp system test dependency lists. Run:

```bash
make -C projects/synth build/portable_ui_tests
projects/synth/build/portable_ui_tests
```

Expected: all portable UI tests pass; no text, stroke, background, or other extra command is emitted for the constant chart.

- [ ] **Step 5: Synchronize OpenSpec and commit**

Mark OpenSpec tasks `2.1`, `2.2`, and `2.3` complete after GREEN. Validate and commit:

```bash
openspec validate add-constant-modulator --strict
git add projects/synth/include/synth/ConstantBarVisualizer.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/Makefile openspec/changes/add-constant-modulator/tasks.md
git commit -m "feat(synth): add constant bar visualizer"
```

### Task 3: MiniApp Sixth Slot, Coverage, and Final Verification

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-constant-modulator/tasks.md`

**Interfaces:**
- Consumes: `ConstantModulatorProcessor::SourcePointers()` and `Outputs()`, `ConstantBarVisualizer`, and existing MiniApp modulation registration.
- Produces: six connected MiniApp modulators, `ConstantModulatorInstance()` and `ConstantBarVisualizerInstance()` accessors, and coverage for `sdsp-39`, `sdsp-40`, and `spv-8`.

- [ ] **Step 1: Write the failing six-slot MiniApp tests**

Update existing topology assertions from five to six modulators, `72` to `84` capacity, metadata/color vector sizes from five to six, and modulation-view parameter count from `17` to `18`. Preserve all existing index-`0` through index-`4` assertions and append yellow at index `5`.

Extend the distinct-visualizer test with `mod5`, assert it equals `ConstantBarVisualizerInstance()`, is visible, and differs from every visualizer at indexes `0` through `4`. Add this focused integration case:

```cpp
TEST_CASE(miniapp_registers_constant_as_the_sixth_modulator_without_sample_work) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        8, UseScratchRuntimeDataPaths("miniapp_registers_constant_as_the_sixth_modulator"));
    auto& core = rig.Application();
    auto& group = *core.Group();
    const auto& modulators = group.GetModulators();
    const auto metadata = modulators.Metadata();

    REQUIRE_TRUE(group.Config().numVoices == 2);
    REQUIRE_TRUE(group.Config().numModulators == 6);
    REQUIRE_TRUE(group.Config().maxParameters == 84);
    REQUIRE_TRUE(metadata.size() == 6);
    REQUIRE_TRUE(metadata[5].connected);
    REQUIRE_TRUE(metadata[5].name == "Constant");
    REQUIRE_TRUE(metadata[5].shortName == "Const");
    REQUIRE_TRUE(metadata[5].sourceColor == synth::Color::Yellow);
    REQUIRE_TRUE(metadata[5].visualizer == &core.ConstantBarVisualizerInstance());

    const auto pointers = core.ConstantModulatorInstance().SourcePointers();
    REQUIRE_TRUE(pointers.size() == 2);
    REQUIRE_TRUE(*pointers[0] == 0.0f);
    REQUIRE_TRUE(*pointers[1] == 1.0f);
    float* const pointer0 = pointers[0];
    float* const pointer1 = pointers[1];

    rig.RunBlocks(1);
    REQUIRE_TRUE(modulators.Value(0, 5) == 0.0f);
    REQUIRE_TRUE(modulators.Value(1, 5) == 1.0f);
    rig.RunBlocks(2);
    REQUIRE_TRUE(core.ConstantModulatorInstance().SourcePointers()[0] == pointer0);
    REQUIRE_TRUE(core.ConstantModulatorInstance().SourcePointers()[1] == pointer1);
    REQUIRE_TRUE(*pointer0 == 0.0f && *pointer1 == 1.0f);
    REQUIRE_TRUE(modulators.Value(0, 5) == 0.0f);
    REQUIRE_TRUE(modulators.Value(1, 5) == 1.0f);
}
```

Run: `make -C projects/synth build/miniapp_system_tests`

Expected RED: assertions fail or compilation fails because MiniApp still has five sources and no constant accessors.

- [ ] **Step 2: Register and retain the constant source without touching the sample loop**

In `MiniAppCore.hpp`:

```cpp
#include "synth/ConstantBarVisualizer.hpp"
#include "synth/DspConstant.hpp"
```

Change group configuration to `.numModulators = 6` and `.maxParameters = 84`, with comment `12 + 12 * 6 = 84`. Immediately after registering noise at index `4`, register:

```cpp
group.SetModulationSource(5, constantModulator_.SourcePointers(), {
    .name = "Constant",
    .shortName = "Const",
    .sourceColor = synth::Color::Yellow,
    .connected = true,
});
```

Add these public const/non-const accessors:

```cpp
synth::ConstantModulatorProcessor& ConstantModulatorInstance() {
    return constantModulator_;
}
const synth::ConstantModulatorProcessor& ConstantModulatorInstance() const {
    return constantModulator_;
}
synth::ui::ConstantBarVisualizer& ConstantBarVisualizerInstance() {
    return constantBarVisualizer_;
}
const synth::ui::ConstantBarVisualizer& ConstantBarVisualizerInstance() const {
    return constantBarVisualizer_;
}
```

Declare the processor before the visualizer so the borrowed span remains valid:

```cpp
synth::ConstantModulatorProcessor constantModulator_{kVoiceCount};
synth::ui::ConstantBarVisualizer constantBarVisualizer_{
    constantModulator_.Outputs(), synth::Color::Yellow};
```

Append:

```cpp
group.GetModulators().Metadata(5).visualizer = &constantBarVisualizer_;
```

Do not add any constant call, copy, publication, or branch inside `PrepareToPlay`, `ProcessBlock`, or the sample loop.

- [ ] **Step 3: Run focused GREEN and inspect topology-sensitive assertions**

Run:

```bash
make -C projects/synth build/miniapp_system_tests
projects/synth/build/miniapp_system_tests
```

Expected: all MiniApp tests pass, the open modulation view materializes six depth parameters (`12 + 6 = 18` total), and noise remains at index `4`.

- [ ] **Step 4: Update Make dependencies and requirement coverage**

Ensure `DspConstant.hpp` and `ConstantBarVisualizer.hpp` are dependencies of every target that includes `MiniAppCore.hpp`, including MiniApp system and portable tests; `DspConstant.hpp` remains in `DSP_HEADERS` from Task 1.

Update the coverage audit heading to include the constant modulator. Add:

```markdown
| `spv-8` | covered | `projects/synth/tests/portable_ui_tests.cpp` ordered minimal constant bars, exact zero/top framing, invalid bounds, immutable redraw, and builder composition; existing JUCE/browser fill-command parity |
| `sdsp-39` | covered | `projects/synth/tests/dsp_tests.cpp` zero/one voice construction, exact even/odd greedy assignments, normalized rank coverage, maximal cyclic distance, immutable stable pointers, and direct `ParameterGroup` publication |
| `sdsp-40` | covered | `projects/synth/tests/miniapp_system_tests.cpp` combined six-slot topology, yellow constant at index 5, retained visualizer, fixed `(0, 1)` values, stable pointers, and no constant sample-path recomputation |
```

Revise the existing `sdsp-13` row to name the six-slot/capacity topology tests and the `sdsp-33` row to distinguish the three scope-backed visualizers from ganged, noise, and constant visualizers.

- [ ] **Step 5: Complete focused and full verification**

Run fresh commands and require exit code zero from each:

```bash
make -C projects/synth build/dsp_tests build/portable_ui_tests build/miniapp_system_tests
projects/synth/build/dsp_tests
projects/synth/build/portable_ui_tests
projects/synth/build/miniapp_system_tests
make -C projects/synth test
openspec validate add-noise-modulator --strict
openspec validate add-constant-modulator --strict
openspec status --change add-constant-modulator
git diff --check
```

- [ ] **Step 6: Synchronize all remaining OpenSpec tasks and commit**

Only after Step 5 passes, mark OpenSpec tasks `3.1` through `4.3` complete. Re-run `openspec instructions apply --change add-constant-modulator --json` and require `12/12`, `remaining: 0`, and `state: all_done`. Commit:

```bash
git add projects/synth/apps/miniapp/MiniAppCore.hpp projects/synth/tests/miniapp_system_tests.cpp projects/synth/Makefile projects/synth/docs/coverage.md openspec/changes/add-constant-modulator/tasks.md
git commit -m "feat(miniapp): add sixth constant modulator"
```
