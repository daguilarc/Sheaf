# ADSR DSP Processor and Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-voice ADSR processor driven by per-sample increments and a reusable `AdsrModule<Polyphony>` with exponentially mapped time parameters, without integrating it into a synth application.

**Architecture:** `DspAdsr.hpp` owns only the single-voice realtime state machine and natural-unit input contract. `AdsrModule<Polyphony>` in `Modules.hpp` owns one processor per voice, parameter IDs and mapping, sample-rate conversion, gates, and stable outputs. Existing focused DSP and module test binaries cover the two layers independently before the full synth suite runs.

**Tech Stack:** C++20, header-only synth DSP/module classes, the repository's custom C++ test harness, `ParameterManager`, and GNU Make.

## Global Constraints

- Attack is exponentially mapped from 1 ms to 2 s.
- Decay and release are exponentially mapped from 1 ms to 5 s.
- Sustain is linearly mapped from 0 to 1.
- Natural defaults are 10 ms attack, 100 ms decay, 0.7 sustain, and 250 ms release.
- DSP envelope segments are linear; only knob-to-time mapping is exponential.
- A rising gate retriggers attack from the current output in every prior state.
- The low-level processor accepts attack, decay, and release increments, sustain, and one boolean gate.
- `AdsrModule<Polyphony>` owns one independent processor and gate per voice.
- The processor and module perform no allocation, locking, or throwing on the per-sample path.
- Do not integrate ADSR into an app, instrument, runtime, standard modulator bundle, patch, controller, UI, or modulation-source registration.
- Preserve unrelated untracked files under `projects/synth/browser/` and `projects/synth/miniapp/`.

---

## File Structure

- Create `projects/synth/include/synth/DspAdsr.hpp`: the single-voice ADSR input, state machine, gate-edge logic, and inspection API.
- Modify `projects/synth/include/synth/Modules.hpp`: include the DSP header and add the templated parameter-owning polyphonic wrapper.
- Modify `projects/synth/tests/dsp_tests.cpp`: focused state, endpoint, interruption, and retrigger tests.
- Modify `projects/synth/tests/module_tests.cpp`: registration, mapping, validation, and polyphony tests.
- Modify `projects/synth/Makefile`: add `DspAdsr.hpp` to DSP header dependencies and the module test dependency list.

### Task 1: Single-Voice ADSR Processor

**Files:**
- Create: `projects/synth/include/synth/DspAdsr.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: only C++ standard-library types and math/assertion facilities.
- Produces: `synth::AdsrProcessor`, `synth::AdsrProcessor::Input`, `synth::AdsrProcessor::State`, `float Process(const Input&) noexcept`, `State GetState() const noexcept`, and `float Output() const noexcept`.

- [ ] **Step 1: Write the failing state-machine tests**

Add `#include "synth/DspAdsr.hpp"` to `dsp_tests.cpp`. Add focused cases equivalent to:

```cpp
TEST_CASE(adsr_processor_runs_linear_stages_and_exact_endpoints) {
    synth::AdsrProcessor adsr;
    synth::AdsrProcessor::Input input{
        .attackIncrement = 0.5,
        .decayIncrement = 0.5,
        .sustain = 0.25f,
        .releaseIncrement = 0.5,
        .gate = false,
    };

    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Idle);
    REQUIRE_NEAR(adsr.Process(input), 0.0f, 0.0f);

    input.gate = true;
    REQUIRE_NEAR(adsr.Process(input), 0.5f, 0.000001f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Attack);
    REQUIRE_NEAR(adsr.Process(input), 1.0f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Decay);
    REQUIRE_NEAR(adsr.Process(input), 0.625f, 0.000001f);
    REQUIRE_NEAR(adsr.Process(input), 0.25f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Sustain);

    input.gate = false;
    REQUIRE_NEAR(adsr.Process(input), 0.125f, 0.000001f);
    REQUIRE_NEAR(adsr.Process(input), 0.0f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Idle);
}

TEST_CASE(adsr_processor_interrupts_and_retriggers_from_current_value) {
    synth::AdsrProcessor adsr;
    synth::AdsrProcessor::Input input{
        .attackIncrement = 0.25,
        .decayIncrement = 0.25,
        .sustain = 0.2f,
        .releaseIncrement = 0.25,
        .gate = true,
    };

    REQUIRE_NEAR(adsr.Process(input), 0.25f, 0.000001f);
    REQUIRE_NEAR(adsr.Process(input), 0.5f, 0.000001f);
    input.gate = false;
    REQUIRE_NEAR(adsr.Process(input), 0.375f, 0.000001f);
    input.gate = true;
    REQUIRE_NEAR(adsr.Process(input), 0.53125f, 0.000001f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Attack);
}
```

Add the edge-contract case explicitly:

```cpp
TEST_CASE(adsr_processor_holds_zero_increments_and_tracks_live_sustain) {
    synth::AdsrProcessor adsr;
    synth::AdsrProcessor::Input input{
        .attackIncrement = 0.0,
        .decayIncrement = 0.5,
        .sustain = 0.5f,
        .releaseIncrement = 1.0,
        .gate = true,
    };

    REQUIRE_NEAR(adsr.Process(input), 0.0f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Attack);
    REQUIRE_NEAR(adsr.Process(input), 0.0f, 0.0f);

    input.attackIncrement = 1.0;
    REQUIRE_NEAR(adsr.Process(input), 1.0f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Decay);
    REQUIRE_NEAR(adsr.Process(input), 0.75f, 0.000001f);
    input.sustain = 0.25f;
    REQUIRE_NEAR(adsr.Process(input), 0.25f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Sustain);
    input.sustain = 0.6f;
    REQUIRE_NEAR(adsr.Process(input), 0.6f, 0.0f);
    REQUIRE_TRUE(adsr.GetState() == synth::AdsrProcessor::State::Sustain);

    input.gate = false;
    REQUIRE_NEAR(adsr.Process(input), 0.0f, 0.0f);
    REQUIRE_TRUE(adsr.Output() >= 0.0f && adsr.Output() <= 1.0f);
}
```

- [ ] **Step 2: Run the DSP target and verify RED**

Run: `make -C projects/synth build/dsp_tests`

Expected: compilation fails because `synth/DspAdsr.hpp` and `synth::AdsrProcessor` do not exist.

- [ ] **Step 3: Implement the minimal processor**

Create `DspAdsr.hpp` with this state-machine shape:

```cpp
#pragma once

#include <algorithm>
#include <cassert>
#include <cmath>

namespace synth {

class AdsrProcessor {
public:
    enum class State { Idle, Attack, Decay, Sustain, Release };

    struct Input {
        double attackIncrement = 0.0;
        double decayIncrement = 0.0;
        float sustain = 0.0f;
        double releaseIncrement = 0.0;
        bool gate = false;
    };

    float Process(const Input& input) noexcept {
        assert(std::isfinite(input.attackIncrement) && input.attackIncrement >= 0.0);
        assert(std::isfinite(input.decayIncrement) && input.decayIncrement >= 0.0);
        assert(std::isfinite(input.sustain) && input.sustain >= 0.0f && input.sustain <= 1.0f);
        assert(std::isfinite(input.releaseIncrement) && input.releaseIncrement >= 0.0);

        const bool rising = input.gate && !previousGate_;
        const bool falling = !input.gate && previousGate_;
        previousGate_ = input.gate;
        if (rising) {
            BeginStage(State::Attack);
        } else if (falling) {
            BeginStage(State::Release);
        }

        switch (state_) {
        case State::Idle:
            output_ = 0.0f;
            break;
        case State::Attack:
            progress_ = Advance(progress_, input.attackIncrement);
            output_ = Interpolate(stageSource_, 1.0f, progress_);
            if (progress_ >= 1.0) {
                output_ = 1.0f;
                state_ = State::Decay;
                progress_ = 0.0;
            }
            break;
        case State::Decay:
            progress_ = Advance(progress_, input.decayIncrement);
            output_ = Interpolate(1.0f, input.sustain, progress_);
            if (progress_ >= 1.0) {
                output_ = input.sustain;
                state_ = State::Sustain;
                progress_ = 0.0;
            }
            break;
        case State::Sustain:
            output_ = input.sustain;
            break;
        case State::Release:
            progress_ = Advance(progress_, input.releaseIncrement);
            output_ = Interpolate(stageSource_, 0.0f, progress_);
            if (progress_ >= 1.0) {
                output_ = 0.0f;
                state_ = State::Idle;
                progress_ = 0.0;
            }
            break;
        }
        return output_;
    }
    State GetState() const noexcept { return state_; }
    float Output() const noexcept { return output_; }

private:
    void BeginStage(State state) noexcept {
        state_ = state;
        progress_ = 0.0;
        stageSource_ = output_;
    }

    static double Advance(double progress, double increment) noexcept {
        return std::min(1.0, progress + increment);
    }

    static float Interpolate(float source, float target, double progress) noexcept {
        return source + (target - source) * static_cast<float>(progress);
    }

    State state_ = State::Idle;
    double progress_ = 0.0;
    float stageSource_ = 0.0f;
    float output_ = 0.0f;
    bool previousGate_ = false;
};

} // namespace synth
```

Use the inline implementation above without adding sample-rate or parameter awareness.

Add `include/synth/DspAdsr.hpp` to `DSP_HEADERS` in the Makefile so the focused binary rebuilds when the header changes.

- [ ] **Step 4: Run the DSP target and tests to verify GREEN**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: compilation succeeds, all DSP tests print `[PASS]`, and the command exits 0.

- [ ] **Step 5: Refactor names and duplicated interpolation only while green**

Keep the public names from the interface block. If attack, decay, and release duplicate interpolation arithmetic, introduce one private `Interpolate(float source, float target, double progress) noexcept` helper. Do not add curves, reset modes, or validation behavior beyond the spec.

- [ ] **Step 6: Re-run focused DSP tests**

Run: `make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests`

Expected: all DSP tests pass with no compiler warnings.

- [ ] **Step 7: Commit the processor increment**

```bash
git add projects/synth/include/synth/DspAdsr.hpp projects/synth/tests/dsp_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add ADSR DSP processor"
```

### Task 2: Polyphonic ADSR Module

**Files:**
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify: `projects/synth/tests/module_tests.cpp`
- Modify: `projects/synth/Makefile`

**Interfaces:**
- Consumes: `AdsrProcessor`, `ParameterManager::RegisterParameter`, `GetExponential`, `GetLinear`, `Bank::RegisterParameters`, and existing module registration conventions.
- Produces: `synth::AdsrModule<Polyphony>` with `ParameterIds { attack, decay, sustain, release }`, `RegisterParameters`, `RegisterToBank`, `SetInput(ParameterManager&, const std::array<bool, Polyphony>&)`, `Process`, `CurrentInput`, `Parameters`, `Registered`, `SetSampleRate`, `SampleRate`, `Output`, and `Outputs`.

- [ ] **Step 1: Write failing module contract and mapping tests**

Add compile-time checks next to the existing module checks:

```cpp
static_assert(!std::is_copy_constructible_v<synth::AdsrModule<2>>);
static_assert(!std::is_copy_assignable_v<synth::AdsrModule<2>>);
static_assert(!std::is_move_constructible_v<synth::AdsrModule<2>>);
static_assert(!std::is_move_assignable_v<synth::AdsrModule<2>>);
```

Add registration and default-mapping coverage equivalent to:

```cpp
TEST_CASE(adsr_module_registers_parameters_and_maps_natural_defaults) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .targetCenterAlpha = 1.0f,
    });
    synth::AdsrModule<2> module(1000.0f);
    module.RegisterParameters(manager, group, "Amp");

    const auto ids = module.Parameters();
    REQUIRE_TRUE(manager.ParameterById(ids.attack).Name() == "Amp Attack");
    REQUIRE_TRUE(manager.ParameterById(ids.decay).Name() == "Amp Decay");
    REQUIRE_TRUE(manager.ParameterById(ids.sustain).Name() == "Amp Sustain");
    REQUIRE_TRUE(manager.ParameterById(ids.release).Name() == "Amp Release");

    module.SetInput(manager, std::array<bool, 2>{false, true});
    REQUIRE_NEAR(module.CurrentInput().voices[0].attackIncrement, 0.1, 0.000001);
    REQUIRE_NEAR(module.CurrentInput().voices[0].decayIncrement, 0.01, 0.000001);
    REQUIRE_NEAR(module.CurrentInput().voices[0].sustain, 0.7f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].releaseIncrement, 0.004, 0.000001);
    REQUIRE_TRUE(!module.CurrentInput().voices[0].gate);
    REQUIRE_TRUE(module.CurrentInput().voices[1].gate);
}
```

Add endpoint and polyphony coverage with concrete inputs:

```cpp
TEST_CASE(adsr_module_maps_endpoints_and_processes_gates_independently) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .targetCenterAlpha = 1.0f,
    });
    synth::AdsrModule<2> module(1000.0f);
    module.RegisterParameters(manager, group, "Env");
    const auto ids = module.Parameters();

    SetAndSettle(manager, ids.attack, 0.0f);
    SetAndSettle(manager, ids.decay, 1.0f);
    SetAndSettle(manager, ids.sustain, 1.0f);
    SetAndSettle(manager, ids.release, 0.0f);
    module.SetInput(manager, std::array<bool, 2>{true, false});

    REQUIRE_NEAR(module.CurrentInput().voices[0].attackIncrement, 1.0, 0.000001);
    REQUIRE_NEAR(module.CurrentInput().voices[0].decayIncrement, 0.0002, 0.000001);
    REQUIRE_NEAR(module.CurrentInput().voices[0].sustain, 1.0f, 0.0f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].releaseIncrement, 1.0, 0.000001);
    module.Process();
    REQUIRE_NEAR(module.Output(0), 1.0f, 0.0f);
    REQUIRE_NEAR(module.Output(1), 0.0f, 0.0f);
    REQUIRE_TRUE(module.Outputs().size() == 2);
    REQUIRE_NEAR(module.Outputs()[0], module.Output(0), 0.0f);
    REQUIRE_NEAR(module.Outputs()[1], module.Output(1), 0.0f);

    module.SetSampleRate(2000.0f);
    module.SetInput(manager, std::array<bool, 2>{true, false});
    REQUIRE_NEAR(module.CurrentInput().voices[0].attackIncrement, 0.5, 0.000001);
    module.Process();
    REQUIRE_NEAR(module.Output(0), 1.0f, 0.0f);
}
```

Add registration option and bank-order coverage:

```cpp
TEST_CASE(adsr_module_applies_options_and_registers_bank_in_adsr_order) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
    synth::AdsrModule<2> module;
    synth::AdsrModule<2>::Options options;
    options.indicatorColors = {synth::Color::Yellow, synth::Color::Orange};
    module.RegisterParameters(manager, group, "Env", options);

    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    for (const synth::PhysicalEncoderId encoder : {30u, 31u, 32u, 33u, 34u}) {
        slot.AddPhysicalEncoder(encoder);
    }
    slot.SelectBank(&bank);
    module.RegisterToBank(bank, 1);

    const auto ids = module.Parameters();
    REQUIRE_TRUE(bank.VisibleParameter(31) == &manager.ParameterById(ids.attack));
    REQUIRE_TRUE(bank.VisibleParameter(32) == &manager.ParameterById(ids.decay));
    REQUIRE_TRUE(bank.VisibleParameter(33) == &manager.ParameterById(ids.sustain));
    REQUIRE_TRUE(bank.VisibleParameter(34) == &manager.ParameterById(ids.release));
    for (const auto id : {ids.attack, ids.decay, ids.sustain, ids.release}) {
        REQUIRE_TRUE(manager.ParameterById(id).IndicatorColor(0) == synth::Color::Yellow);
        REQUIRE_TRUE(manager.ParameterById(id).IndicatorColor(1) == synth::Color::Orange);
    }
}
```

Add a small exception helper beside `SetAndSettle`:

```cpp
template<typename Exception, typename Callable>
bool Throws(Callable&& callable) {
    try {
        std::forward<Callable>(callable)();
    } catch (const Exception&) {
        return true;
    }
    return false;
}
```

Use it in explicit validation cases:

```cpp
TEST_CASE(adsr_module_rejects_registration_errors_atomically) {
    synth::ParameterManager smallManager;
    auto& smallGroup = smallManager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 3});
    synth::AdsrModule<2> small;
    REQUIRE_TRUE(Throws<std::length_error>([&] { small.RegisterParameters(smallManager, smallGroup, "Env"); }));
    REQUIRE_TRUE(smallManager.ParameterCount() == 0);
    REQUIRE_TRUE(smallGroup.ParameterCount() == 0);

    synth::ParameterManager duplicateManager;
    auto& duplicateGroup = duplicateManager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 5});
    (void)duplicateManager.RegisterParameter(duplicateGroup, {.name = "Env Sustain"});
    synth::AdsrModule<2> duplicate;
    REQUIRE_TRUE(Throws<std::logic_error>([&] {
        duplicate.RegisterParameters(duplicateManager, duplicateGroup, "Env");
    }));
    REQUIRE_TRUE(duplicateManager.ParameterCount() == 1);
    REQUIRE_TRUE(duplicateGroup.ParameterCount() == 1);
}

TEST_CASE(adsr_module_rejects_invalid_lifecycle_and_sample_rates) {
    synth::AdsrModule<2> unregistered;
    synth::ParameterManager first;
    auto& firstGroup = first.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
    auto& bank = first.CreateBank();
    REQUIRE_TRUE(Throws<std::logic_error>([&] { unregistered.RegisterToBank(bank, 0); }));
    REQUIRE_TRUE(Throws<std::logic_error>([&] {
        unregistered.SetInput(first, std::array<bool, 2>{});
    }));

    unregistered.RegisterParameters(first, firstGroup, "Env");
    REQUIRE_TRUE(Throws<std::logic_error>([&] {
        unregistered.RegisterParameters(first, firstGroup, "Again");
    }));
    synth::ParameterManager second;
    REQUIRE_TRUE(Throws<std::logic_error>([&] {
        unregistered.SetInput(second, std::array<bool, 2>{});
    }));

    REQUIRE_TRUE(Throws<std::invalid_argument>([] { synth::AdsrModule<1> invalid(0.0f); }));
    REQUIRE_TRUE(Throws<std::invalid_argument>([&] {
        unregistered.SetSampleRate(std::numeric_limits<float>::infinity());
    }));
    REQUIRE_TRUE(Throws<std::invalid_argument>([&] {
        unregistered.SetSampleRate(std::numeric_limits<float>::quiet_NaN());
    }));
}
```

- [ ] **Step 2: Run the module target and verify RED**

Run: `make -C projects/synth build/module_tests`

Expected: compilation fails because `synth::AdsrModule` does not exist.

- [ ] **Step 3: Add the module type and parameter mapping**

Include `synth/DspAdsr.hpp` from `Modules.hpp`. Add a positive-polyphony template with these core declarations:

```cpp
template<std::size_t Polyphony>
class AdsrModule {
public:
    static_assert(Polyphony > 0);
    static constexpr std::size_t kVoiceCount = Polyphony;
    static constexpr float kMinAttackSeconds = 0.001f;
    static constexpr float kMaxAttackSeconds = 2.0f;
    static constexpr float kMinDecaySeconds = 0.001f;
    static constexpr float kMaxDecaySeconds = 5.0f;
    static constexpr float kMinReleaseSeconds = 0.001f;
    static constexpr float kMaxReleaseSeconds = 5.0f;

    struct ParameterIds {
        ParameterId attack = 0;
        ParameterId decay = 0;
        ParameterId sustain = 0;
        ParameterId release = 0;
    };

    struct Input {
        std::array<AdsrProcessor::Input, kVoiceCount> voices{};
    };

    struct Options {
        std::vector<Color> indicatorColors;
    };
};
```

Use the existing module validation pattern before registering all four names.
Register short names `Atk`, `Dec`, `Sus`, and `Rel`, with base colors Cyan, Blue,
Green, and Orange. Compute normalized time defaults with
`log(default / minimum) / log(maximum / minimum)` so mapping them through
`GetExponential` yields 0.010, 0.100, and 0.250 seconds.

`SetInput` must verify registration and manager identity, then fill each voice:

```cpp
input_.voices[voiceIx] = {
    .attackIncrement = 1.0 / (attackSeconds * sampleRate_),
    .decayIncrement = 1.0 / (decaySeconds * sampleRate_),
    .sustain = manager.GetLinear(0.0f, 1.0f, voiceIx, parameterIds_.sustain),
    .releaseIncrement = 1.0 / (releaseSeconds * sampleRate_),
    .gate = gates[voiceIx],
};
```

`Process` calls each owned processor once and stores its return in `outputs_`.
Expose outputs as a bounds-checked per-voice value and `std::span<const float>`.
Validate finite positive sample rates. Preserve processor state in
`SetSampleRate`. Do not add modulation-source registration or UI state.

- [ ] **Step 4: Add precise Makefile dependencies**

Add `include/synth/DspAdsr.hpp` to the `$(MODULE_TEST_BIN)` prerequisite list in
addition to its membership in `DSP_HEADERS`. Do not add the header to app-specific
dependency bundles or source includes.

- [ ] **Step 5: Run module tests to verify GREEN**

Run: `make -C projects/synth build/module_tests && projects/synth/build/module_tests`

Expected: all module tests print `[PASS]`, compilation emits no warnings, and the
command exits 0.

- [ ] **Step 6: Run both focused suites together**

Run: `make -C projects/synth build/dsp_tests build/module_tests && projects/synth/build/dsp_tests && projects/synth/build/module_tests`

Expected: both focused binaries exit 0.

- [ ] **Step 7: Commit the module increment**

```bash
git add projects/synth/include/synth/Modules.hpp projects/synth/tests/module_tests.cpp projects/synth/Makefile
git commit -m "feat(synth): add polyphonic ADSR module"
```

### Task 3: Full Verification and Scope Audit

**Files:**
- Verify only; no product integration files should change.

**Interfaces:**
- Consumes: the completed processor and module contracts from Tasks 1 and 2.
- Produces: fresh test, build-hygiene, and scope evidence for handoff.

- [ ] **Step 1: Run whitespace and compiler-warning checks through the focused build**

Run: `git diff --check HEAD~2..HEAD && make -C projects/synth build/dsp_tests build/module_tests`

Expected: no whitespace diagnostics, no compiler warnings, and exit 0.

- [ ] **Step 2: Run the complete synth suite**

Run: `make -C projects/synth test`

Expected: every synth test binary exits 0.

- [ ] **Step 3: Audit the no-integration boundary**

Run from `projects/synth`: `rg -n "Adsr(Module|Processor)|DspAdsr" . --glob '!include/synth/DspAdsr.hpp' --glob '!include/synth/Modules.hpp' --glob '!tests/dsp_tests.cpp' --glob '!tests/module_tests.cpp' --glob '!Makefile'`

Expected: no matches. This proves no app, runtime, instrument, standard-modulator,
patch, controller, or UI source began using the ADSR types.

- [ ] **Step 4: Inspect final scope and commit history**

Run: `git status --short && git log -3 --oneline && git diff HEAD~2..HEAD --stat`

Expected: only the pre-existing untracked browser/miniapp paths remain; the two
implementation commits touch `DspAdsr.hpp`, `Modules.hpp`, the two focused test
files, and `projects/synth/Makefile`.
