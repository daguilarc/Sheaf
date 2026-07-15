# Noise Modulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable runtime-polyphonic unipolar noise modulator, a deliberately flickering model-free noise visualizer, and register both as MiniApp's fifth modulator while leaving index `3` available to the parallel fourth-modulator branch.

**Architecture:** A focused JUCE-free DSP header owns a small PCG32-style generator, stable output storage, and stable source pointers; its audio hot path advances the generator exactly once per voice and maps the upper 23 bits strictly into `(0, 1)`. A separate portable visualizer owns an independent UI-only generator and creates a fresh monophonic per-pixel polyline on every visible draw. MiniApp owns both address-stable objects, registers noise at index `4` in a five-slot group, and processes it immediately before modulation values are updated.

**Tech Stack:** C++20, header-only JUCE-free synth DSP and portable UI components, existing custom C++ test binaries, `ParameterGroup`, OpenSpec change `add-noise-modulator`, native Codex implementer subagents, and xagent Claude Opus reviewers.

## Global Constraints

- The DSP processor receives only a positive runtime voice count and optional seed; it has no `ParameterGroup`, modulator-index, metadata, UI, page, bank, persistence, or controller knowledge.
- The processor is non-copyable and non-movable; output floats and the parallel source-pointer array are allocated only during construction and never resized.
- Every `Process()` call emits one independent float per voice strictly in `(0, 1)` and advances one shared PCG32-style stream exactly once per voice.
- The open-interval mapping is exactly `(bits + 0.5) * 2^-23` using the upper 23 random bits, with representable endpoints `2^-24` and `1 - 2^-24`.
- The audio hot path performs no allocation, lock, system-entropy call, standard distribution setup, cryptographic operation, or exception path.
- Normal construction seeds once during initialization; explicit seed construction is deterministic for tests.
- The noise visualizer owns an independent UI-only random stream, reads no DSP output or scope history, has no `UIState`, and emits one monophonic polyline with a fresh random y coordinate for every covered integer x column on every visible draw.
- MiniApp configures exactly five modulator slots, registers noise only at index `4`, and makes no registration, metadata, or visualizer assignment at index `3` in this change.
- Existing MiniApp scope-backed visualizer topology remains exactly three distinct retained instances at indexes `0`, `1`, and `2`; the index-`4` noise visualizer is separate and model-free.
- This change adds no parameters, bank positions, pages, scope channels, patch-persistence fields, backend-specific code, or audio-output routing.
- Production code follows TDD: record a focused failing run before implementation, then a passing focused run after implementation.
- Each implementation task is committed by a fresh native Codex implementer and must pass a task-scoped Claude Opus xagent spec-and-quality review before its OpenSpec checkboxes are marked complete.

---

## File Structure

- Create `projects/synth/include/synth/DspNoise.hpp`: reusable fast generator and runtime-sized `NoiseModulatorProcessor`; this is the only file that owns DSP random generation and stable source storage.
- Create `projects/synth/include/synth/NoiseWaveformVisualizer.hpp`: portable, model-free, UI-only noise waveform drawing; it reuses the generator primitive but never a processor instance or processor output.
- Modify `projects/synth/tests/dsp_tests.cpp`: processor unit, lifetime, statistical sanity, hot-path, and pointer-backed `ParameterGroup` integration tests.
- Modify `projects/synth/tests/portable_ui_tests.cpp`: noise visualizer geometry, redraw, determinism, invalid-bounds, and base-contract tests.
- Modify `projects/synth/apps/miniapp/MiniAppCore.hpp`: retain/register/process the two-voice noise source and retain/register its visualizer at modulator index `4`.
- Modify `projects/synth/tests/miniapp_system_tests.cpp`: five-slot topology, noise metadata/visualizer, stable pointers, audio-rate publication, and preserved scope visualizer tests.
- Modify `projects/synth/Makefile`: add the new headers to the exact focused test target dependency lists.
- Modify `projects/synth/docs/coverage.md`: map `sdsp-13`, `sdsp-33`, `sdsp-37`, `sdsp-38`, and `spv-7` to exact tests.
- Modify `openspec/changes/add-noise-modulator/tasks.md`: mark each checklist item only after the corresponding task implementation, tests, and Claude review pass.

---

### Task 1: Runtime-Polyphonic Noise DSP Processor

**Files:**
- Create: `projects/synth/include/synth/DspNoise.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-noise-modulator/tasks.md` items `1.1`, `1.2`, and `1.3`

**Interfaces:**
- Produces: `synth::FastPcg32::FastPcg32(std::uint64_t seed) noexcept`, `std::uint32_t NextWord() noexcept`, and `float UniformOpen01() noexcept` for Task 2's private UI random state.
- Produces: `synth::NoiseModulatorProcessor::NoiseModulatorProcessor(std::size_t voiceCount)` and `NoiseModulatorProcessor(std::size_t voiceCount, std::uint64_t seed)`.
- Produces: `void Process() noexcept`, `std::size_t VoiceCount() const noexcept`, `float Output(std::size_t voice) const`, `std::span<const float> Outputs() const noexcept`, and `std::span<float* const> SourcePointers() const noexcept`.
- Consumes: existing `ParameterGroup::SetModulationSource(std::size_t, std::span<float* const>, ModulatorMetadata)` and `ParameterGroup::UpdateModValues()`.

- [ ] **Step 1: Add the failing processor contract tests**

Add `#include "synth/DspNoise.hpp"`, `#include "synth/ParameterModulation.hpp"`, and explicit standard includes for `<array>` and `<utility>` to `dsp_tests.cpp`. Add compile-time contract checks and the following behavior as separate `TEST_CASE`s:

```cpp
static_assert(!std::is_copy_constructible_v<synth::NoiseModulatorProcessor>);
static_assert(!std::is_copy_assignable_v<synth::NoiseModulatorProcessor>);
static_assert(!std::is_move_constructible_v<synth::NoiseModulatorProcessor>);
static_assert(!std::is_move_assignable_v<synth::NoiseModulatorProcessor>);
static_assert(noexcept(std::declval<synth::NoiseModulatorProcessor&>().Process()));

TEST_CASE(noise_modulator_requires_positive_runtime_voice_count) {
    bool threw = false;
    try {
        synth::NoiseModulatorProcessor processor(0, 1);
        (void)processor;
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    synth::NoiseModulatorProcessor processor(3, 1);
    REQUIRE_TRUE(processor.VoiceCount() == 3);
    REQUIRE_TRUE(processor.Outputs().size() == 3);
    REQUIRE_TRUE(processor.SourcePointers().size() == 3);
}

TEST_CASE(noise_modulator_explicit_seed_is_repeatable_and_strictly_open) {
    synth::NoiseModulatorProcessor left(4, 0x12345678ULL);
    synth::NoiseModulatorProcessor right(4, 0x12345678ULL);
    for (std::size_t sample = 0; sample < 4096; ++sample) {
        left.Process();
        right.Process();
        for (std::size_t voice = 0; voice < left.VoiceCount(); ++voice) {
            REQUIRE_TRUE(left.Output(voice) == right.Output(voice));
            REQUIRE_TRUE(left.Output(voice) > 0.0f);
            REQUIRE_TRUE(left.Output(voice) < 1.0f);
        }
    }
}

TEST_CASE(noise_modulator_advances_one_shared_word_per_voice) {
    synth::NoiseModulatorProcessor stereo(2, 0x9abcdef0ULL);
    synth::NoiseModulatorProcessor mono(1, 0x9abcdef0ULL);
    stereo.Process();
    mono.Process();
    REQUIRE_TRUE(stereo.Output(0) == mono.Output(0));
    mono.Process();
    REQUIRE_TRUE(stereo.Output(1) == mono.Output(0));
}

TEST_CASE(noise_modulator_fixed_seed_has_sane_unipolar_distribution) {
    synth::NoiseModulatorProcessor processor(1, 0xdecafbadULL);
    std::array<std::size_t, 8> bins{};
    double sum = 0.0;
    constexpr std::size_t kSamples = 32768;
    for (std::size_t sample = 0; sample < kSamples; ++sample) {
        processor.Process();
        const float value = processor.Output(0);
        sum += value;
        const std::size_t bin = std::min<std::size_t>(7, static_cast<std::size_t>(value * 8.0f));
        ++bins[bin];
    }
    REQUIRE_NEAR(sum / static_cast<double>(kSamples), 0.5, 0.015);
    for (const std::size_t count : bins) {
        REQUIRE_TRUE(count > 3500);
        REQUIRE_TRUE(count < 4700);
    }
}

TEST_CASE(noise_modulator_keeps_registered_output_addresses_stable) {
    synth::NoiseModulatorProcessor processor(2, 7);
    const auto initialPointers = processor.SourcePointers();
    float* const voice0 = initialPointers[0];
    float* const voice1 = initialPointers[1];
    for (std::size_t sample = 0; sample < 4096; ++sample) {
        processor.Process();
        REQUIRE_TRUE(processor.SourcePointers()[0] == voice0);
        REQUIRE_TRUE(processor.SourcePointers()[1] == voice1);
        REQUIRE_TRUE(*voice0 == processor.Output(0));
        REQUIRE_TRUE(*voice1 == processor.Output(1));
    }
}
```

Also verify `Output(voiceCount)` throws `std::out_of_range` so inspection remains bounds checked.

- [ ] **Step 2: Run the DSP test and preserve RED evidence**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: compilation fails because `synth/DspNoise.hpp` and `synth::NoiseModulatorProcessor` do not exist. Record the command, the missing-header/type diagnostic, and why it is expected in the task report.

- [ ] **Step 3: Implement the fast generator and processor**

Create `DspNoise.hpp` as a header-only JUCE-free component with this public shape and algorithm:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <random>
#include <span>
#include <stdexcept>
#include <vector>

namespace synth {

class FastPcg32 {
public:
    explicit FastPcg32(std::uint64_t seed) noexcept { Seed(seed); }

    std::uint32_t NextWord() noexcept {
        const std::uint64_t previous = state_;
        state_ = previous * 6364136223846793005ULL + increment_;
        const std::uint32_t xorshifted =
            static_cast<std::uint32_t>(((previous >> 18U) ^ previous) >> 27U);
        const std::uint32_t rotation = static_cast<std::uint32_t>(previous >> 59U);
        return (xorshifted >> rotation) | (xorshifted << ((-rotation) & 31U));
    }

    float UniformOpen01() noexcept {
        const std::uint32_t bits = NextWord() >> 9U;
        return (static_cast<float>(bits) + 0.5f) * 0x1p-23f;
    }

private:
    void Seed(std::uint64_t seed) noexcept {
        state_ = 0;
        NextWord();
        state_ += seed;
        NextWord();
    }

    std::uint64_t state_ = 0;
    static constexpr std::uint64_t increment_ = 1442695040888963407ULL;
};

inline std::uint64_t NoiseInitializationSeed() {
    std::random_device entropy;
    return (static_cast<std::uint64_t>(entropy()) << 32U) ^
           static_cast<std::uint64_t>(entropy());
}

class NoiseModulatorProcessor {
public:
    explicit NoiseModulatorProcessor(std::size_t voiceCount)
        : NoiseModulatorProcessor(voiceCount, NoiseInitializationSeed()) {}

    NoiseModulatorProcessor(std::size_t voiceCount, std::uint64_t seed)
        : outputs_(voiceCount), random_(seed) {
        if (voiceCount == 0) {
            throw std::invalid_argument("noise modulator requires at least one voice");
        }
        sourcePointers_.reserve(outputs_.size());
        for (float& output : outputs_) {
            sourcePointers_.push_back(&output);
        }
    }

    NoiseModulatorProcessor(const NoiseModulatorProcessor&) = delete;
    NoiseModulatorProcessor& operator=(const NoiseModulatorProcessor&) = delete;
    NoiseModulatorProcessor(NoiseModulatorProcessor&&) = delete;
    NoiseModulatorProcessor& operator=(NoiseModulatorProcessor&&) = delete;

    void Process() noexcept {
        for (float& output : outputs_) {
            output = random_.UniformOpen01();
        }
    }

    std::size_t VoiceCount() const noexcept { return outputs_.size(); }
    float Output(std::size_t voice) const { return outputs_.at(voice); }
    std::span<const float> Outputs() const noexcept { return outputs_; }
    std::span<float* const> SourcePointers() const noexcept { return sourcePointers_; }

private:
    std::vector<float> outputs_;
    std::vector<float*> sourcePointers_;
    FastPcg32 random_;
};

} // namespace synth
```

Keep the exact PCG constants and mapping above. If the compiler rejects hexadecimal floating literals under the existing flags, use `1.0f / 8388608.0f`, preserving the exact power-of-two value.

- [ ] **Step 4: Add the pointer-backed group integration test**

Add a test that creates one two-voice/one-modulator group, registers `processor.SourcePointers()` directly, and proves the latest processor values are published without any topology knowledge in the processor:

```cpp
TEST_CASE(noise_modulator_registers_directly_as_pointer_backed_group_source) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    synth::NoiseModulatorProcessor processor(2, 42);
    group.SetModulationSource(0, processor.SourcePointers(), {
        .name = "Noise",
        .shortName = "Noise",
        .connected = true,
    });
    processor.Process();
    group.UpdateModValues();
    REQUIRE_TRUE(group.GetModulators().Value(0, 0) == processor.Output(0));
    REQUIRE_TRUE(group.GetModulators().Value(1, 0) == processor.Output(1));
}
```

- [ ] **Step 5: Track the new DSP header in the Makefile**

Append `include/synth/DspNoise.hpp` to `DSP_HEADERS` so changes to the header rebuild the DSP test and library dependents that consume the shared DSP header list.

- [ ] **Step 6: Run focused GREEN and the full suite once**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: exit code `0` with every DSP test passing and no compiler warnings.

Run: `make -C projects/synth test`

Expected: exit code `0`, including `check-ui-boundary`, with pristine output. Record both runs in the task report.

- [ ] **Step 7: Self-review and commit Task 1**

Confirm `Process()` is `noexcept`, performs only fixed-state integer arithmetic plus existing-vector writes, and calls neither entropy nor allocation. Confirm no public resize/mutation API exists and the class cannot move after pointer registration.

```bash
git add projects/synth/include/synth/DspNoise.hpp projects/synth/tests/dsp_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add reusable noise modulator processor"
```

- [ ] **Step 8: Pass the Claude Opus task gate and update OpenSpec**

After the controller generates the Superpowers task brief, implementer report, and `review-package` diff, an xagent Claude Opus reviewer must return both `✅ Spec compliant` and `Task quality: Approved`. Critical or Important findings go to a native Codex fix subagent and the same task is re-reviewed. Only after approval, mark OpenSpec tasks `1.1`, `1.2`, and `1.3` checked and commit that checklist update with the next approved task or the final documentation task.

---

### Task 2: Model-Free Flickering Noise Visualizer

**Files:**
- Create: `projects/synth/include/synth/NoiseWaveformVisualizer.hpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-noise-modulator/tasks.md` items `2.1`, `2.2`, and `2.3`

**Interfaces:**
- Consumes: `synth::FastPcg32` from Task 1 and `synth::ui::Visualizer`.
- Produces: `synth::ui::NoiseWaveformVisualizer(Color color = Color::White)` and deterministic test constructor `NoiseWaveformVisualizer(Color color, std::uint64_t seed)`.
- Produces through the inherited contract: `SetBounds`, `GetBounds`, `SetVisible`, `Visible`, and `Draw() const`; it adds no processor, scope, or `UIState` interface.

- [ ] **Step 1: Add failing portable visualizer tests**

Include `synth/NoiseWaveformVisualizer.hpp`. `portable_ui_tests.cpp` is one assertion-driven `main()`, so add the following scoped assertion blocks inside `main()` near the existing visualizer contract checks rather than introducing a second test harness:

```cpp
{
    synth::ui::NoiseWaveformVisualizer left(synth::Color::Yellow, 1234);
    synth::ui::NoiseWaveformVisualizer right(synth::Color::Yellow, 1234);
    const synth::ui::Bounds bounds{10.0f, 20.0f, 64.0f, 30.0f};
    left.SetBounds(bounds);
    right.SetBounds(bounds);
    const auto leftCommands = left.Draw();
    const auto rightCommands = right.Draw();
    Require(leftCommands.size() == 1, "noise visualizer emits one polyline");
    Require(leftCommands[0].kind == synth::ui::DrawCommand::Kind::Polyline,
            "noise visualizer command is a polyline");
    Require(leftCommands[0].color == synth::Color::Yellow,
            "noise visualizer retains its color");
    Require(leftCommands[0].points.size() == 65,
            "noise visualizer covers integer columns including both edges");
    Require(leftCommands[0].points.size() == rightCommands[0].points.size(),
            "same seed produces same point count");
    for (std::size_t point = 0; point < leftCommands[0].points.size(); ++point) {
        RequireNear(leftCommands[0].points[point].x,
                    bounds.x + static_cast<float>(point), 0.0001f,
                    "noise visualizer x matches integer column");
        RequireNear(leftCommands[0].points[point].x, rightCommands[0].points[point].x,
                    0.0001f, "same seed reproduces x");
        RequireNear(leftCommands[0].points[point].y, rightCommands[0].points[point].y,
                    0.0001f, "same seed reproduces y");
        Require(leftCommands[0].points[point].y > bounds.y,
                "noise visualizer y is above the open lower edge");
        Require(leftCommands[0].points[point].y < bounds.y + bounds.height,
                "noise visualizer y is below the open upper edge");
    }
}

{
    synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::White, 99);
    visualizer.SetBounds({0.0f, 0.0f, 16.0f, 10.0f});
    const auto first = visualizer.Draw();
    const auto second = visualizer.Draw();
    Require(first.size() == 1 && second.size() == 1,
            "consecutive visible noise draws emit one polyline each");
    bool differs = false;
    for (std::size_t point = 0; point < first[0].points.size(); ++point) {
        differs = differs || first[0].points[point].y != second[0].points[point].y;
    }
    Require(differs, "noise visualizer regenerates geometry on every visible draw");
}

{
    synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::White, 7);
    visualizer.SetBounds({3.0f, 4.0f, 8.0f, 9.0f});
    Require(visualizer.Visible(), "noise visualizer is intrinsically visible");
    Require(!visualizer.Draw().empty(), "visible noise visualizer draws");
    visualizer.SetVisible(false);
    Require(visualizer.Draw().empty(), "hidden noise visualizer does not draw");
    visualizer.SetVisible(true);
    for (const synth::ui::Bounds invalid : {
             synth::ui::Bounds{0.0f, 0.0f, 0.0f, 1.0f},
             synth::ui::Bounds{0.0f, 0.0f, 1.0f, 0.0f},
             synth::ui::Bounds{0.0f, 0.0f, -1.0f, 1.0f}}) {
        visualizer.SetBounds(invalid);
        Require(visualizer.Draw().empty(), "invalid noise visualizer bounds are safe");
    }
}
```

Add one more scoped block for width `2.25f`: require exactly four x coordinates `x`, `x+1`, `x+2`, and the right edge `x+2.25`, all distinct and in bounds. Add `std::numeric_limits<float>::infinity()` and `quiet_NaN()` bounds cases to the invalid-bounds loop, with `<limits>` included explicitly. This makes “every covered integer x column across the bounds” precise without drawing beyond the right edge and covers the implementation's finite-boundary guard.

- [ ] **Step 2: Run the portable UI test and preserve RED evidence**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: compilation fails because `synth/NoiseWaveformVisualizer.hpp` and its class do not exist. Record the diagnostic in the task report.

- [ ] **Step 3: Implement the portable visualizer**

Create the focused header with no model pointer and no backend include:

```cpp
#pragma once

#include "synth/DspNoise.hpp"
#include "synth/PortableUI.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace synth::ui {

class NoiseWaveformVisualizer final : public Visualizer {
public:
    explicit NoiseWaveformVisualizer(Color color = Color::White)
        : NoiseWaveformVisualizer(color, NoiseInitializationSeed()) {}

    NoiseWaveformVisualizer(Color color, std::uint64_t seed)
        : color_(color), random_(seed) {}

protected:
    std::vector<DrawCommand> DrawVisible() const override {
        const Bounds bounds = GetBounds();
        if (!std::isfinite(bounds.x) || !std::isfinite(bounds.y) ||
            !std::isfinite(bounds.width) || !std::isfinite(bounds.height) ||
            bounds.width <= 0.0f || bounds.height <= 0.0f) {
            return {};
        }

        std::vector<Point> points;
        const std::size_t wholeColumns = static_cast<std::size_t>(std::floor(bounds.width));
        points.reserve(wholeColumns + 2);
        const auto appendPoint = [&](float x) {
            points.push_back({x, bounds.y + random_.UniformOpen01() * bounds.height});
        };
        for (std::size_t column = 0; column <= wholeColumns; ++column) {
            appendPoint(bounds.x + static_cast<float>(column));
        }
        const float right = bounds.x + bounds.width;
        if (points.back().x < right) {
            appendPoint(right);
        }
        return {DrawCommand::Polyline(std::move(points), color_, 1.4f)};
    }

private:
    Color color_;
    mutable FastPcg32 random_;
};

} // namespace synth::ui
```

The mutable state is UI-thread-only and exists solely because `Visualizer::Draw()` is const. Do not cache a path: each visible call must advance and rebuild it.

- [ ] **Step 4: Verify base visualizer composition contracts**

Use the existing portable `Builder::Visualizer` test path with the noise visualizer to require: the emitted node keeps the exact assigned bounds; the visualizer remains address-stable/non-copyable/non-movable through the base class; hidden state emits no node; and the builder appends the draw node before the existing encoder node when called first. Do not modify builder production code.

- [ ] **Step 5: Track the visualizer header in focused test dependencies**

Add `include/synth/NoiseWaveformVisualizer.hpp` and `include/synth/DspNoise.hpp` to `$(PORTABLE_UI_TEST_BIN)` dependencies in `projects/synth/Makefile`.

- [ ] **Step 6: Run focused GREEN and the full suite once**

Run: `make -C projects/synth build/portable_ui_tests && projects/synth/build/portable_ui_tests`

Expected: exit code `0`, all portable UI tests passing, no warnings.

Run: `make -C projects/synth test`

Expected: exit code `0`, including the UI-boundary check. Record both runs.

- [ ] **Step 7: Self-review and commit Task 2**

Confirm the new header contains no scope, processor, UI-state, JUCE, browser, DOM, or canvas dependency; production redraws are intentionally different; explicit seeds reproduce a draw sequence; and every x/y lies inside bounds.

```bash
git add projects/synth/include/synth/NoiseWaveformVisualizer.hpp projects/synth/tests/portable_ui_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add flickering noise visualizer"
```

- [ ] **Step 8: Pass the Claude Opus task gate and update OpenSpec**

Require `✅ Spec compliant` and `Task quality: Approved` from the task-scoped xagent review. Route Critical or Important findings through a native Codex fix subagent and re-review. Only then mark OpenSpec tasks `2.1`, `2.2`, and `2.3` checked.

---

### Task 3: MiniApp Fifth-Modulator Integration

**Files:**
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify after review: `openspec/changes/add-noise-modulator/tasks.md` items `3.1`, `3.2`, and `3.3`

**Interfaces:**
- Consumes: `NoiseModulatorProcessor(std::size_t)` and `SourcePointers()` from Task 1.
- Consumes: `NoiseWaveformVisualizer(Color)` from Task 2.
- Produces: MiniApp `ParameterGroupConfig.numModulators == 5`; connected `Noise` source metadata at index `4`; exactly two stable index-`4` source pointers; one retained model-free visualizer at index `4`; one new noise value per voice per processed sample before `UpdateModValues()`.
- Preserves: scope-backed visualizer instances at indexes `0`, `1`, and `2`; index `3` is not written by this change and tests do not require it to be disconnected.

- [ ] **Step 1: Add failing MiniApp topology and publication tests**

Extend the existing modulator topology tests rather than creating an alternate MiniApp fixture:

```cpp
TEST_CASE(miniapp_registers_noise_as_the_fifth_modulator) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        1, UseScratchRuntimeDataPaths("miniapp_registers_noise_as_the_fifth_modulator"));
    auto* group = rig.Engine().Application().Group();
    REQUIRE_TRUE(group != nullptr);
    REQUIRE_TRUE(group->Config().numVoices == 2);
    REQUIRE_TRUE(group->Config().numModulators == 5);

    const auto& modulators = group->GetModulators();
    const auto metadata = modulators.Metadata();
    REQUIRE_TRUE(metadata.size() == 5);
    REQUIRE_TRUE(metadata[4].connected);
    REQUIRE_TRUE(metadata[4].name == "Noise");
    REQUIRE_TRUE(metadata[4].shortName == "Noise");
    REQUIRE_TRUE(metadata[4].sourceColor == synth::Color::White);
    REQUIRE_TRUE(metadata[4].visualizer != nullptr);
    REQUIRE_TRUE(metadata[4].visualizer != metadata[0].visualizer);
    REQUIRE_TRUE(metadata[4].visualizer != metadata[1].visualizer);
    REQUIRE_TRUE(metadata[4].visualizer != metadata[2].visualizer);
}

TEST_CASE(miniapp_publishes_new_noise_values_before_each_modulation_update) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        1, UseScratchRuntimeDataPaths("miniapp_publishes_new_noise_values_before_each_modulation_update"));
    auto& modulators = rig.Engine().Application().Group()->GetModulators();
    rig.RunBlocks(1);
    const float first0 = modulators.Value(0, 4);
    const float first1 = modulators.Value(1, 4);
    rig.RunBlocks(1);
    const float second0 = modulators.Value(0, 4);
    const float second1 = modulators.Value(1, 4);
    REQUIRE_TRUE(first0 > 0.0f && first0 < 1.0f);
    REQUIRE_TRUE(first1 > 0.0f && first1 < 1.0f);
    REQUIRE_TRUE(second0 > 0.0f && second0 < 1.0f);
    REQUIRE_TRUE(second1 > 0.0f && second1 < 1.0f);
    REQUIRE_TRUE(first0 != second0 || first1 != second1);
}
```

Update `miniapp_registers_distinct_scope_visualizers_for_modulators` to keep its checks scoped to metadata `0`, `1`, and `2`, then separately require metadata `4` is non-null and distinct. Update `miniapp_color_flow_keeps_semantic_roles_independent` to expect metadata size `5` and White at index `4`, without inspecting or asserting index `3` connection state. If the public API exposes registered source pointers, assert the two index-`4` addresses remain unchanged across processing; otherwise rely on the Task 1 pointer contract and MiniApp value publication rather than adding a test-only accessor.

- [ ] **Step 2: Run the MiniApp test and preserve RED evidence**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: a new assertion fails because the current MiniApp config has three modulators and metadata index `4` is unavailable. Record the exact failure.

- [ ] **Step 3: Retain and register the fifth modulator**

In `MiniAppCore.hpp`:

1. Include `synth/DspNoise.hpp` and `synth/NoiseWaveformVisualizer.hpp`.
2. Change only `.numModulators = 3` to `.numModulators = 5`; keep `.maxParameters = 24` and all parameter/page/bank topology unchanged.
3. Add address-stable members near the existing modules/visualizers:

```cpp
synth::NoiseModulatorProcessor noiseModulator_{kVoiceCount};
synth::ui::NoiseWaveformVisualizer noiseVisualizer_{synth::Color::White};
```

4. Immediately after the existing module source registrations, register index `4`:

```cpp
group.SetModulationSource(4, noiseModulator_.SourcePointers(), {
    .name = "Noise",
    .shortName = "Noise",
    .sourceColor = synth::Color::White,
    .connected = true,
});
```

5. In `RegisterModulatorVisualizers`, retain existing assignments at indexes `0`, `1`, and `2`, and set only index `4` metadata's visualizer to `&noiseVisualizer_`. Do not set any index-`3` field.
6. In the inner per-sample loop, call `noiseModulator_.Process()` exactly once after the existing signal modulators have produced their values and immediately before `context_->parameterManager->UpdateModValues(*group_)`.

- [ ] **Step 4: Track MiniApp's new header dependencies**

Add `include/synth/DspNoise.hpp` and `include/synth/NoiseWaveformVisualizer.hpp` to `$(MINIAPP_SYSTEM_TEST_BIN)` dependencies. Do not add new compiled sources because both components are header-only.

- [ ] **Step 5: Run focused GREEN and the full suite once**

Run: `make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests`

Expected: exit code `0`, including the five-slot, publication, color-flow, and three-scope-visualizer tests.

Run: `make -C projects/synth test`

Expected: exit code `0`, including Braid and deadline regressions and the UI-boundary check. Record both runs.

- [ ] **Step 6: Self-review and commit Task 3**

Confirm exactly one production `SetModulationSource(4, ...)`, no `SetModulationSource(3, ...)`, exactly one noise `Process()` per sample, processing precedes `UpdateModValues`, and there are no parameter/page/bank/scope/audio-output changes.

```bash
git add projects/synth/apps/miniapp/MiniAppCore.hpp projects/synth/tests/miniapp_system_tests.cpp projects/synth/Makefile
git commit -m "feat(miniapp): register fifth noise modulator"
```

- [ ] **Step 7: Pass the Claude Opus task gate and update OpenSpec**

Require `✅ Spec compliant` and `Task quality: Approved`. Route Critical or Important findings through a native Codex fix subagent and re-review. Only then mark OpenSpec tasks `3.1`, `3.2`, and `3.3` checked.

---

### Task 4: Coverage, OpenSpec Completion, and Whole-Change Verification

**Files:**
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-noise-modulator/tasks.md` items `4.1`, `4.2`, and `4.3`, plus any approved task checkboxes not yet committed

**Interfaces:**
- Consumes: all approved implementation from Tasks 1 through 3.
- Produces: exact coverage mappings, clean full-suite evidence, strict OpenSpec validation, completed OpenSpec apply checklist, and final whole-branch Claude review evidence.

- [ ] **Step 1: Add exact coverage mappings**

Update the coverage table with these meanings and exact owning tests:

```markdown
| `sdsp-13` (modified) | covered | `projects/synth/tests/dsp_tests.cpp` deterministic seeded noise, strict open interval, one advance per voice, distribution sanity, stable pointers, and direct `ParameterGroup` publication |
| `sdsp-33` (modified) | covered | `projects/synth/tests/miniapp_system_tests.cpp` exactly three distinct retained scope-backed MiniApp visualizers at indexes 0, 1, and 2, separately from model-free noise |
| `sdsp-37` | covered | `projects/synth/tests/dsp_tests.cpp` positive runtime voice count, zero rejection, non-copyable/non-movable lifetime, bounds-checked access, stable source pointers, and allocation-free/noexcept processing contract |
| `sdsp-38` | covered | `projects/synth/tests/miniapp_system_tests.cpp` five-slot topology, connected noise at index 4, retained distinct visualizer, and per-sample noise publication before modulation update |
| `spv-7` | covered | `projects/synth/tests/portable_ui_tests.cpp` fresh visible-draw noise path; `projects/synth/tests/miniapp_system_tests.cpp` retained index-4 noise visualizer distinct from the three scope visualizers |
```

Replace the existing `sdsp-33` row rather than duplicating it.

- [ ] **Step 2: Run focused and full verification from the final tree**

Run these commands without relying on earlier task output:

```bash
make -C projects/synth build/dsp_tests build/portable_ui_tests build/miniapp_system_tests
projects/synth/build/dsp_tests
projects/synth/build/portable_ui_tests
projects/synth/build/miniapp_system_tests
make -C projects/synth test
git diff --check
```

Expected: every command exits `0`; all three focused binaries and the full suite pass; the UI-boundary check passes; `git diff --check` prints nothing.

- [ ] **Step 3: Validate and complete OpenSpec**

After all task gates are approved, check every item in `openspec/changes/add-noise-modulator/tasks.md`, then run:

```bash
openspec validate add-noise-modulator --strict
openspec status --change add-noise-modulator
openspec instructions apply --change add-noise-modulator --json
```

Expected: strict validation succeeds; all proposal artifacts remain complete; apply instructions report all `12/12` tasks complete and state `all_done` (or the installed CLI's equivalent completed state).

- [ ] **Step 4: Self-review and commit documentation/checklist completion**

Confirm coverage names the actual tests added, every OpenSpec checkbox corresponds to implemented and reviewed work, and no implementation file is accidentally staged.

```bash
git add projects/synth/docs/coverage.md openspec/changes/add-noise-modulator/tasks.md
git commit -m "docs(synth): cover noise modulator requirements"
```

- [ ] **Step 5: Pass the Task 4 Claude Opus gate**

Generate a Task 4 review package and require the same task-scoped spec and quality approval. Fix and re-review any Critical or Important findings before proceeding.

- [ ] **Step 6: Run the final whole-branch Claude Opus review**

Generate `review-package MERGE_BASE HEAD`, where `MERGE_BASE` is the commit recorded before Task 1. Give the reviewer this plan, the complete OpenSpec change directory, all implementation reports, the full final diff package, and the fresh verification results. The final reviewer must assess the complete change for requirement coverage, architecture, real-time safety, lifetime/address stability, test quality, MiniApp integration, and production readiness. A `Ready to merge: No` or any Critical/Important finding returns to a fresh native Codex fix subagent, followed by focused/full verification and a new final Claude review.

- [ ] **Step 7: Final verification after the last review-driven fix**

Run again:

```bash
make -C projects/synth test
openspec validate add-noise-modulator --strict
openspec status --change add-noise-modulator
git diff --check
git status --short
```

Expected: tests and validation exit `0`; OpenSpec is complete; diff check is empty; status contains only intentional task artifacts, reports, and progress tracking permitted by the Superpowers workflow.
