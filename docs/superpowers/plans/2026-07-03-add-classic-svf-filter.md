# Classic SVF Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JUCE-free classic two-pole SVF processor, a polyphonic parameter-backed filter module, and miniapp VCO-page filter controls/output routing.

**Architecture:** Implement the filter in the DSP layer first, then wrap it in `ClassicSvfModule<Polyphony>`, then wire `ClassicSvfModule<2>` into the miniapp. The processor owns low/band/high state and transfer-function UI state; the module maps parameters and accepts per-voice live audio via `SetVoiceInput`; the miniapp filters each VCO voice before mixing output.

**Tech Stack:** C++20, existing synth `ParameterManager`, existing header-only module pattern, OpenSpec change `add-classic-svf-filter`, synth make targets.

---

## Context

OpenSpec source of truth:
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/proposal.md`
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/design.md`
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/specs/synth-dsp-classes/spec.md`
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/specs/synth-modules/spec.md`
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/specs/synth-app-runtime/spec.md`
- `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/tasks.md`

Implementation rules:
- Follow TDD: write failing tests, run them and confirm the expected failure, then implement.
- Core DSP/module code must stay JUCE-free.
- Do not revert unrelated user changes.
- Use Codex worker subagents for implementation tasks.
- Use Claude through `plugins/xagent/scripts/xagent run --harness claude_code --model opus` for spec and code-quality reviews after each implementation task.
- Tasks are sequential because each depends on files introduced by the previous task.

## Task 1: DSP Processor

**OpenSpec tasks covered:** 1.1, 1.2, 1.3.

**Files:**
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/include/synth/DspFilters.hpp`
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/tests/dsp_tests.cpp`

- [ ] **Step 1: Add failing DSP tests**

Add tests to `projects/synth/tests/dsp_tests.cpp` for a new `synth::ClassicStateVariableFilter` processor.

Required test coverage:
- Blend endpoints:
  - `blend = -1.0f` output equals `m_low`
  - `blend = 0.0f` output equals `m_band`
  - `blend = 1.0f` output equals `m_high`
- Blend amount helper behavior, either through public fields or observable output:
  - low amount is `max(-blend, 0)`
  - high amount is `max(blend, 0)`
  - band amount is `sqrt(1 - blend * blend)`
- Repeated constant input with low-pass blend converges toward the input.
- Finite output at cutoff values corresponding to the 20 Hz-20 kHz range and resonance `5.5f`.
- `UIState` snapshots can be populated and return finite `FrequencyResponse` and `TransferFunctionValue` values.

Use these exact test names so later review can find the coverage:
- `classic_svf_blend_selects_low_band_and_high_outputs`
- `classic_svf_low_pass_converges_and_high_resonance_stays_finite`
- `classic_svf_ui_state_publishes_finite_blended_transfer_function`

- [ ] **Step 2: Run DSP test target and confirm RED**

Run:
```bash
make -C projects/synth build/dsp_tests
```

Expected before implementation: compile failure naming `ClassicStateVariableFilter` or its missing members.

- [ ] **Step 3: Implement `ClassicStateVariableFilter`**

In `projects/synth/include/synth/DspFilters.hpp`, add a JUCE-free processor near the existing filter utilities.

Required public shape:
```cpp
struct ClassicStateVariableFilter {
    static constexpr float kMaxCutoff = 0.499f;

    struct Input {
        float value = 0.0f;
        float cutoff = 0.0f;     // cycles per sample
        float resonance = 1.0f;  // Q-like resonance, finite and positive
        float blend = 0.0f;      // -1 low, 0 band, +1 high
    };

    struct UIState : TransferFunction {
        std::atomic<float> cutoff{0.0f};
        std::atomic<float> resonance{1.0f};
        std::atomic<float> blend{0.0f};

        float FrequencyResponse(float normalizedFrequency) const override;
        std::complex<float> TransferFunctionValue(float normalizedFrequency) const override;
    };

    float m_low = 0.0f;
    float m_band = 0.0f;
    float m_high = 0.0f;
    float m_output = 0.0f;
    float m_cutoff = 0.0f;
    float m_resonance = 1.0f;
    float m_blend = 0.0f;

    float Process(const Input& input);
    void PopulateUIState(UIState& state) const;
};
```

Implementation guidance:
- Use a topology-preserving SVF form with finite clamped cutoff and positive resonance.
- Interpret resonance as Q and use damping `r = 1 / max(resonance, epsilon)`.
- Compute and store low, band, high, and blended output every sample.
- Clamp blend to `[-1, 1]`.
- Implement `UIState::TransferFunctionValue` using the same low/band/high blend law as audio output.
- Keep all code in `DspFilters.hpp`; no JUCE includes.

- [ ] **Step 4: Run DSP test target and confirm GREEN**

Run:
```bash
make -C projects/synth build/dsp_tests && projects/synth/build/dsp_tests
```

Expected: new and existing DSP tests pass.

- [ ] **Step 5: Claude/xagent review**

Run an Opus review scoped to Task 1:
```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review Task 1 of add-classic-svf-filter. Scope: projects/synth/include/synth/DspFilters.hpp and projects/synth/tests/dsp_tests.cpp. Check spec compliance against openspec/changes/add-classic-svf-filter/specs/synth-dsp-classes/spec.md, especially sdsp-23, UIState, PopulateUIState, and TransferFunction behavior. Findings first with file/line references. Then code-quality risks. Say clearly whether Task 1 is approved."
```

Fix any findings and re-review until approved.

## Task 2: Classic SVF Module

**OpenSpec tasks covered:** 2.1, 2.2, 2.3.

**Files:**
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/include/synth/Modules.hpp`
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/tests/module_tests.cpp`

- [ ] **Step 1: Add failing module tests**

Add tests for `synth::ClassicSvfModule<2>` in `projects/synth/tests/module_tests.cpp`.

Required test coverage:
- Static non-copyable/non-movable assertions matching existing module classes.
- Registers `Filter Cutoff`, `Filter Resonance`, and `Filter Blend` with stored IDs in that order.
- Rejects repeat registration.
- Rejects insufficient parameter capacity without partial registration.
- Rejects duplicate effective names without partial registration.
- Registers to bank at an offset and maps visible parameters in order.
- Rejects bank registration before parameter registration.
- Maps parameter values:
  - Cutoff normalized `0 -> 20 / sampleRate`, `1 -> 20000 / sampleRate`
  - Resonance normalized `0 -> 0.5`, `1 -> 5.5`
  - Blend bipolar value `-1 -> -1`, `0 -> 0`, `1 -> 1`
- Registers Blend with `RangeKind::Bipolar`.
- `SetVoiceInput(voiceIx, sample)` writes per-voice live audio input and rejects out-of-range voice indices.
- `Process()` produces separate per-voice outputs.
- `PopulateUIState()` exposes one transfer-function-capable filter UI state per voice.

- [ ] **Step 2: Run module test target and confirm RED**

Run:
```bash
make -C projects/synth build/module_tests
```

Expected before implementation: compile failure naming `ClassicSvfModule` or its missing members.

- [ ] **Step 3: Implement `ClassicSvfModule<Polyphony>`**

In `projects/synth/include/synth/Modules.hpp`, add a templated module after `BasicLfoModule` or near other module classes.

Required public shape:
```cpp
template<std::size_t Polyphony>
class ClassicSvfModule {
public:
    static constexpr std::size_t kVoiceCount = Polyphony;
    static constexpr float kMinCutoffHz = 20.0f;
    static constexpr float kMaxCutoffHz = 20000.0f;
    static constexpr float kMinResonance = 0.5f;
    static constexpr float kMaxResonance = 5.5f;

    struct ParameterIds {
        ParameterId cutoff = 0;
        ParameterId resonance = 0;
        ParameterId blend = 0;
    };

    struct VoiceInput {
        ClassicStateVariableFilter::Input filter;
    };

    struct Input {
        std::array<VoiceInput, kVoiceCount> voices{};
    };

    struct UIState {
        std::array<ClassicStateVariableFilter::UIState, kVoiceCount> filters;
    };

    explicit ClassicSvfModule(float sampleRate = 48000.0f);
    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {});
    void RegisterToBank(Bank& bank, std::size_t offset);
    void SetInput(ParameterManager& manager);
    void SetVoiceInput(std::size_t voiceIx, float value);
    void Process();
    void PopulateUIState(UIState& state) const;
    void SetSampleRate(float sampleRate);
    float SampleRate() const;
    bool Registered() const;
    const ParameterIds& Parameters() const;
    const Input& CurrentInput() const;
    Input& CurrentInput();
    float Output(std::size_t voiceIx) const;
};
```

Implementation guidance:
- Reuse the same registration validation helper style as `WavetableVcoModule` and `BasicLfoModule`.
- Register default parameter values as: Cutoff `1.0f` (20 kHz), Resonance `0.0f` (maps to 0.5), Blend `-1.0f` (low-pass mode on a bipolar parameter).
- Register Blend with `.range = RangeKind::Bipolar`.
- `SetInput(manager)` maps only cutoff/resonance/blend; use `GetExponential` for Cutoff and Resonance, and `GetBipolarLinear(1.0f, voiceIx, parameterIds_.blend)` for Blend.
- `SetVoiceInput` maps live audio into `input_.voices[voiceIx].filter.value`.
- `Process` calls the internal `ClassicStateVariableFilter` for each voice and stores outputs.

- [ ] **Step 4: Run module test target and confirm GREEN**

Run:
```bash
make -C projects/synth build/module_tests && projects/synth/build/module_tests
```

Expected: module tests pass.

- [ ] **Step 5: Claude/xagent review**

Run an Opus review scoped to Task 2:
```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review Task 2 of add-classic-svf-filter. Scope: projects/synth/include/synth/Modules.hpp and projects/synth/tests/module_tests.cpp. Check spec compliance against openspec/changes/add-classic-svf-filter/specs/synth-modules/spec.md, especially smod-8, Blend bipolar metadata, SetVoiceInput, per-voice processing, and UIState. Findings first with file/line references. Then code-quality risks. Say clearly whether Task 2 is approved."
```

Fix any findings and re-review until approved.

## Task 3: Miniapp Integration

**OpenSpec tasks covered:** 3.1, 3.2, 3.3, 3.4.

**Files:**
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/apps/miniapp/MiniAppCore.hpp`
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/apps/miniapp/MiniApp.hpp`
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/projects/synth/tests/miniapp_system_tests.cpp`

- [ ] **Step 1: Add failing miniapp system tests**

Update `projects/synth/tests/miniapp_system_tests.cpp`.

Required test coverage:
- Add constants:
```cpp
constexpr std::size_t kFilterCutoffPosition = 4;
constexpr std::size_t kFilterResonancePosition = 5;
constexpr std::size_t kFilterBlendPosition = 6;
```
- Update expected `rig.Application().Parameters().size()` from `9` to `12`.
- Add a test asserting the active VCO page exposes Tune, Phase, Shape, Volume, Cutoff, Resonance, Blend in positions 0 through 6.
- Preserve the LFO page expectation: Frequency, Shape, Phase Offset, Skew, Exponent remain positions 0 through 4 after selecting the LFO bank.
- Add an audible-output test where turning filter Cutoff or Blend through the production `rig.Turn(kSlotIx, position, delta)` path changes a settled output window while samples remain finite.

- [ ] **Step 2: Run miniapp system test target and confirm RED**

Run:
```bash
make -C projects/synth build/miniapp_system_tests
```

Expected before implementation: compile failure or failing assertions for missing filter accessors/page bindings.

- [ ] **Step 3: Wire `ClassicSvfModule<2>` into `MiniAppCore.hpp`**

Implementation checklist:
- Add `using FilterModule = synth::ClassicSvfModule<kVoiceCount>;`.
- Increase group `maxParameters` only if needed; current `24` should still fit 12 top-level parameters.
- Register `filterModule_.RegisterParameters(*context_->parameterManager, group, "Filter");`.
- Store pointers for Cutoff, Resonance, Blend.
- Append filter parameter pointers to `parameters_` so `ProcessLiteParameters(parameters_)` slews them.
- Assign filter parameters to the VCO page after Volume.
- Expand the shared bank-slot physical encoder layout to at least seven encoders.
- Register `filterModule_` to `vcoBank_` at offset `4`.
- In `PrepareToPlay`, call `filterModule_.SetSampleRate`.
- Per frame:
  - run VCO module as before
  - call `filterModule_.SetInput(*context_->parameterManager)`
  - for each voice call `filterModule_.SetVoiceInput(voiceIx, vcoModule_.Output(voiceIx))`
  - call `filterModule_.Process()`
  - mix `filterModule_.Output(0)` and `filterModule_.Output(1)` instead of raw VCO outputs
- Add `FilterParameterIds()` and `FilterModuleInstance()` accessors if tests need them.

- [ ] **Step 4: Expand `MiniApp.hpp` encoder UI**

Update the JUCE UI wrapper:
- Change `std::array<synth_juce::EncoderComponent, 5> encoders_;` to size `7`.
- Ensure `BindMessages`, `Bind`, and layout loops continue to use `encoders_.size()`.
- Verify text/buttons/waveforms do not depend on exactly five encoders.

- [ ] **Step 5: Run miniapp system test target and confirm GREEN**

Run:
```bash
make -C projects/synth build/miniapp_system_tests && projects/synth/build/miniapp_system_tests
```

Expected: miniapp system tests pass and output remains finite.

- [ ] **Step 6: Claude/xagent review**

Run an Opus review scoped to Task 3:
```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review Task 3 of add-classic-svf-filter. Scope: projects/synth/apps/miniapp/MiniAppCore.hpp, projects/synth/apps/miniapp/MiniApp.hpp, and projects/synth/tests/miniapp_system_tests.cpp. Check spec compliance against openspec/changes/add-classic-svf-filter/specs/synth-app-runtime/spec.md and tasks 3.1-3.4, especially seven VCO controls, five LFO controls, parameters_ slewing, shared BankSlot growth, and filtered output. Findings first with file/line references. Then code-quality risks. Say clearly whether Task 3 is approved."
```

Fix any findings and re-review until approved.

## Task 4: Full Verification and OpenSpec Sync

**OpenSpec tasks covered:** 4.1, 4.2.

**Files:**
- Modify: `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/tasks.md`
- Inspect only unless mismatch found: `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/specs/**/*.md`

- [ ] **Step 1: Run full synth suite**

Run:
```bash
make -C projects/synth test
```

Expected: all synth test binaries pass, including DSP, module, and miniapp system tests.

- [ ] **Step 2: Review implementation against OpenSpec**

Read the final implementation and verify:
- `sdsp-23` behavior is implemented.
- `smod-8` behavior is implemented.
- modified `sar-11` behavior is implemented.
- The OpenSpec tasks are still accurate; if implementation differs for a good reason, update the relevant OpenSpec artifact before proceeding.

- [ ] **Step 3: Mark OpenSpec tasks complete**

Only after tests and reviews pass, update `/Users/joyo/.codex/worktrees/d239/Sheaf/openspec/changes/add-classic-svf-filter/tasks.md` checkboxes from `[ ]` to `[x]` for completed items.

- [ ] **Step 4: Final Claude/xagent review**

Run:
```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Final review for add-classic-svf-filter. Scope: all git changes in this worktree. Check implementation against OpenSpec proposal/design/specs/tasks, look for bugs, missing tests, DSP stability issues, module lifecycle issues, miniapp regressions, and any unrelated changes. Findings first with file/line references. Say clearly whether the implementation is ready."
```

Fix any findings and re-review until approved.

- [ ] **Step 5: Final status**

Run:
```bash
git status --short
openspec status --change add-classic-svf-filter
```

Report changed files, test command results, and final OpenSpec status.
