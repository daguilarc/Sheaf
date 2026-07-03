# Add LFO DSP Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable arbitrary-polyphony wavetable VCO and LFO modules, replace the miniapp's ad hoc LFO, and preserve the existing two-voice miniapp patch behavior.

**Architecture:** Generalize the current fixed `DualWavetableVcoModule` into `WavetableVcoModule<Polyphony>` and use the same module lifecycle for `BasicLfoModule<Polyphony>`. Keep DSP processors natural-unit and UI-agnostic, with module code responsible for parameter registration, mapping, bank routing, modulation-source pointers, and UI-state publication.

**Tech Stack:** C++20 synth library, JUCE UI components, OpenSpec, Make-based tests under `projects/synth`.

---

## File Map

- `projects/synth/include/synth/ParameterModulation.hpp`: add `ParameterManager::GetBipolarExponentialRatio`.
- `projects/synth/src/ParameterModulation.cpp`: implement the centered exponential-ratio mapping.
- `projects/synth/tests/parameter_modulation_tests.cpp`: add mapping helper tests.
- `projects/synth/include/synth/DspOscillators.hpp`: add `LFOShape` and `BasicLFOProcessor`; keep `Incrementer` unchanged.
- `projects/synth/tests/dsp_tests.cpp`: add LFO shape/processor/scope/UI tests.
- `projects/synth/include/synth/Modules.hpp`: move templated module definitions here; rename/generalize VCO module; add LFO module.
- `projects/synth/src/Modules.cpp`: keep only non-template helpers if needed; otherwise reduce it to a minimal translation unit.
- `projects/synth/tests/module_tests.cpp`: update VCO tests for `WavetableVcoModule<2>` and add `BasicLfoModule` tests, including polyphony other than 2.
- `projects/synth/juce/WaveformComponents.hpp`: add an LFO waveform component using `BasicLFOProcessor::UIState`.
- `projects/synth/apps/miniapp/MiniAppCore.hpp`: instantiate `WavetableVcoModule<2>` and `BasicLfoModule<2>`, expand scope channels, remove app-local LFO state.
- `projects/synth/apps/miniapp/MiniApp.hpp`: draw LFO waveform UI state from the LFO module.
- `projects/synth/apps/miniapp/DemoModulation.hpp`: remove obsolete LFO helpers if no longer used; keep generic parameter slewing helpers as needed.
- `projects/synth/tests/miniapp_system_tests.cpp`: verify the five-control LFO page and module-backed LFO modulation behavior.
- `projects/synth/Makefile`: adjust dependencies if `Modules.cpp` shrinks and template definitions move to headers.
- `openspec/changes/add-lfo-dsp-module/tasks.md`: mark tasks complete only after code, tests, and review pass.

## Task 1: Parameter Mapping Helper

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add failing tests for centered exponential ratio**

Add tests near the existing `GetBipolarExponential` mapping tests:

```cpp
TEST_CASE(parameter_manager_centered_exponential_ratio_maps_endpoints) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1, .processLiteAlpha = 1.0f});
    const auto id = manager.RegisterParameter(group, {.name = "Exponent", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});

    SetAndSettle(manager, id, 0.0f);
    REQUIRE_NEAR(manager.GetBipolarExponentialRatio(5.0f, 0, id), 0.2f, 0.0001f);
    SetAndSettle(manager, id, 0.5f);
    REQUIRE_NEAR(manager.GetBipolarExponentialRatio(5.0f, 0, id), 1.0f, 0.0001f);
    SetAndSettle(manager, id, 1.0f);
    REQUIRE_NEAR(manager.GetBipolarExponentialRatio(5.0f, 0, id), 5.0f, 0.0001f);
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `make -C projects/synth build && projects/synth/build/parameter_modulation_tests`
Expected: compile fails because `GetBipolarExponentialRatio` is not declared.

- [ ] **Step 3: Implement the helper**

Add declaration:

```cpp
float GetBipolarExponentialRatio(float maxRatio, std::size_t voiceIx, ParameterId id) const;
```

Implement:

```cpp
float ParameterManager::GetBipolarExponentialRatio(float maxRatio, std::size_t voiceIx, ParameterId id) const {
    if (maxRatio <= 1.0f) {
        throw std::invalid_argument("centered exponential ratio maximum must be greater than one");
    }
    const float normalized = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f);
    const float bipolar = normalized * 2.0f - 1.0f;
    return std::pow(maxRatio, bipolar);
}
```

- [ ] **Step 4: Add invalid-ratio and modulated-read coverage**

Add tests that `maxRatio <= 1` throws and that a modulation source changing `Parameter::Get(voiceIx)` changes the mapped ratio.

- [ ] **Step 5: Run verification**

Run: `make -C projects/synth test`
Expected: all tests pass.

## Task 2: LFO DSP Processors

**Files:**
- Modify: `projects/synth/include/synth/DspOscillators.hpp`
- Modify: `projects/synth/tests/dsp_tests.cpp`

- [ ] **Step 1: Add failing DSP tests**

Add tests for `LFOShape::Tri`, `LFOShape::PD`, `LFOShape::Shape`, `LFOShape::Process`, `BasicLFOProcessor::Process`, scope writes, top markers, and UI state.

Required properties:
- `Tri(0)=0`, `Tri(0.5)=1`, `Tri(1)=0`.
- `PD(0.5, x)=x`.
- `LFOShape` uses `Tri(PD(skew, wrap(phase)))`, not `PD(Tri(...))`.
- Wrapped phase uses `x - floor(x)`.
- `BasicLFOProcessor` advances with `Incrementer` and writes unipolar scope samples.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `make -C projects/synth build && projects/synth/build/dsp_tests`
Expected: compile fails because `LFOShape` and `BasicLFOProcessor` do not exist.

- [ ] **Step 3: Implement `LFOShape`**

Add a class/struct with:

```cpp
struct LFOShape {
    struct Input {
        double inPhase = 0.0;
        float shape = 0.5f;
        float phaseOffset = 0.0f;
        float skew = 0.5f;
        float exponent = 1.0f;
    };
    static double Wrap(double x);
    static float Tri(float phase);
    static float PD(float skew, float phase);
    static float Shape(float shape, float x);
    float Process(const Input& input);
    float m_output = 0.0f;
};
```

Implement `Wrap(x)` as `x - std::floor(x)`. Clamp denominators and outputs so all paths remain finite in `[0, 1]`.

- [ ] **Step 4: Implement `BasicLFOProcessor`**

Add processor with `Incrementer`, `Input { LFOShape::Input lfoShape; double freq; }`, `SetScopeWriterHolder`, `SetColor`, `Process`, `PopulateUIState`, `m_output`, and `m_top`, following `WavetableVco` scope/UI conventions.

- [ ] **Step 5: Run verification**

Run: `make -C projects/synth test`
Expected: all tests pass.

## Task 3: Polyphonic Modules

**Files:**
- Modify: `projects/synth/include/synth/Modules.hpp`
- Modify: `projects/synth/src/Modules.cpp`
- Modify: `projects/synth/tests/module_tests.cpp`
- Modify: `projects/synth/Makefile`

- [ ] **Step 1: Convert VCO tests to the new type**

Update `DualWavetableVcoModule` references in module tests to `WavetableVcoModule<2>`. Add one test instantiating `WavetableVcoModule<3>` to prove arbitrary-polyphony storage and processing compile and work.

- [ ] **Step 2: Move VCO template implementation into the header**

Rename and templatize:

```cpp
template<std::size_t Polyphony>
class WavetableVcoModule {
public:
    static constexpr std::size_t kVoiceCount = Polyphony;
    // ParameterIds, VoiceInput, Input, UIState arrays sized by Polyphony.
};
```

Preserve public behavior for `<2>`, including direct and reversed swapped modulation source arrays.

- [ ] **Step 3: Add `BasicLfoModule<Polyphony>` tests first**

Cover registration order, input mapping endpoints, phase staggering (`BasicLfoModule<2>` voice 1 gets +0.25 cycles), shape-neutral source metadata, modulation pointer update, UI state, invalid sample rates, and polyphony `3`.

- [ ] **Step 4: Implement `BasicLfoModule<Polyphony>`**

Follow `WavetableVcoModule<Polyphony>` structure. Parameters:
- Frequency: exponential `0.1` Hz to `1000` Hz.
- Shape: linear `[0, 1]`.
- Phase Offset: linear `[0, 1]` plus `voiceIx / (2 * Polyphony)`.
- Skew: linear `[0, 1]`.
- Exponent: `GetBipolarExponentialRatio(5.0f, voiceIx, exponentId)`.

Register one LFO modulation source named `LFO` or `Shaped LFO`, not `Sine LFO`.

- [ ] **Step 5: Run verification**

Run: `make -C projects/synth test`
Expected: all tests pass.

## Task 4: Miniapp And Waveform UI

**Files:**
- Modify: `projects/synth/juce/WaveformComponents.hpp`
- Modify: `projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `projects/synth/apps/miniapp/MiniApp.hpp`
- Modify: `projects/synth/apps/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/tests/miniapp_system_tests.cpp`

- [ ] **Step 1: Add `LfoWaveformComponent`**

Create a component that accepts `BasicLFOProcessor::UIState*` pointers and draws with `DrawWaveformFromScope(..., 0.0f, 1.0f, ...)`.

- [ ] **Step 2: Update miniapp core**

Replace `DualWavetableVcoModule` with `WavetableVcoModule<2>`. Add `BasicLfoModule<2>`. Remove `lfoSpeed_`, `phase_`, `lfoModulators_`, and app-local sine/cosine publication. Expand `ScopeWriter scopeWriter_{4, 4096}` and reserve two VCO plus two LFO channels.

- [ ] **Step 3: Expand bank slot and profile**

Add five physical encoders for the slot. Register VCO parameters into positions 0-3 and leave position 4 disconnected on VCO page. Register all five LFO module parameters into positions 0-4 on LFO page. Set `visibleEncoderCount = 5`.

- [ ] **Step 4: Update UI wrapper**

Bind five encoders and add/draw the LFO waveform component from `BasicLfoModule<2>::UIState`.

- [ ] **Step 5: Add miniapp system tests**

Verify selecting LFO page exposes five connected cells, turning each LFO control changes a corresponding parameter through the production path, and extended rig runs remain finite with nonzero VCO output.

- [ ] **Step 6: Run verification**

Run: `make -C projects/synth test`
Expected: all tests pass.

## Task 5: OpenSpec And Final Review

**Files:**
- Modify: `openspec/changes/add-lfo-dsp-module/tasks.md`

- [ ] **Step 1: Mark completed OpenSpec tasks**

After code and tests pass, mark each checkbox in `openspec/changes/add-lfo-dsp-module/tasks.md` complete.

- [ ] **Step 2: Run OpenSpec validation**

Run: `openspec validate add-lfo-dsp-module --strict`
Expected: `Change 'add-lfo-dsp-module' is valid`.

- [ ] **Step 3: Run full synth tests**

Run: `make -C projects/synth test`
Expected: all synth test binaries pass.

- [ ] **Step 4: Run xagent Claude reviews**

Run a Claude Opus spec-compliance review and a Claude Sonnet/Opus code-quality review through `plugins/xagent/scripts/xagent`. Fix any findings and re-review until both pass.

## Self-Review

- Spec coverage: Tasks cover `spm-64`, `sdsp-20` through `sdsp-22`, modified `sdsp-13/14/16`, modified `smod-5/6`, added `smod-7`, and modified `sar-11/14`.
- Placeholder scan: No TODO/TBD steps are present; each task names exact files and commands.
- Type consistency: The plan consistently uses `WavetableVcoModule<Polyphony>`, `WavetableVcoModule<2>`, `BasicLfoModule<Polyphony>`, `BasicLfoModule<2>`, `LFOShape`, and `BasicLFOProcessor`.
