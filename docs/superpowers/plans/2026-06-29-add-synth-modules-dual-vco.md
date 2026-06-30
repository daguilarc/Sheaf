# Add Synth Modules Dual VCO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable synth module pattern, pointer-backed modulation sources, zero-based parameter IDs, and a module-backed dual wavetable VCO miniapp patch.

**Architecture:** Keep DSP processors JUCE-free and UI-agnostic. Add module composition in core synth code: modules register parameters, bind visible bank slots, map normalized parameter values into natural DSP inputs, publish per-voice outputs and UI state, and register normalized modulation-source floats. Route all parameters through a single append-only manager parameter list so `ParameterId` is the zero-based lookup index.

**Tech Stack:** C++20, Makefiles, custom synth test harness, JUCE miniapp when `~/JUCE` is available, OpenSpec, xagent Claude reviews.

---

## Source Of Truth

- OpenSpec change: `openspec/changes/add-synth-modules-dual-vco/`
- Proposal: `openspec/changes/add-synth-modules-dual-vco/proposal.md`
- Design: `openspec/changes/add-synth-modules-dual-vco/design.md`
- Tasks: `openspec/changes/add-synth-modules-dual-vco/tasks.md`
- Specs:
  - `openspec/changes/add-synth-modules-dual-vco/specs/synth-modules/spec.md`
  - `openspec/changes/add-synth-modules-dual-vco/specs/synth-parameter-modulation/spec.md`
  - `openspec/changes/add-synth-modules-dual-vco/specs/synth-dsp-classes/spec.md`
- Approved xagent spec review: `xrun_20260629233101668_2f82bf2c`

## Files

- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Create: `projects/synth/include/synth/Modules.hpp`
- Create: `projects/synth/src/Modules.cpp`
- Modify: `projects/synth/include/synth/DspOscillators.hpp` only if UI-state accessors need a small hook; prefer no change.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/tests/dsp_tests.cpp` only for JUCE-free include smoke coverage if needed.
- Create or modify: `projects/synth/tests/module_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/miniapp/DemoModulationTests.cpp`
- Modify: `projects/synth/miniapp/Makefile`
- Modify as tasks complete: `openspec/changes/add-synth-modules-dual-vco/tasks.md`

## Review Protocol

After each implementation task, run a Claude spec review and a Claude code-quality review through xagent from the repo root. Use `--model opus` for spec and final reviews. Sonnet is acceptable only for narrow code-quality follow-up if Opus is unavailable, but do not silently switch if the requested harness fails.

Spec review command template:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<prompt>"
```

Each review prompt must name `add-synth-modules-dual-vco`, list changed files, include verification output, ask for findings first, and end with verdict `APPROVED` or `CHANGES_REQUESTED`.

## Task 1: Parameter IDs, Registration, And Mapping Helpers

**OpenSpec tasks covered:** 1.1-1.4, 2.1-2.5

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add failing tests for zero-based IDs and lookup**

Add tests near `manager_assigns_unique_ids` in `projects/synth/tests/parameter_modulation_tests.cpp`:

```cpp
TEST_CASE(manager_register_parameter_returns_zero_based_list_index) {
    synth::ParameterManager manager;
    auto& groupA = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& groupB = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});

    const synth::ParameterId firstId = manager.RegisterParameter(groupA, {.name = "A", .defaultValue = 0.1f});
    const synth::ParameterId secondId = manager.RegisterParameter(groupB, {.name = "B", .defaultValue = 0.2f});
    const synth::ParameterId thirdId = manager.RegisterParameter(groupA, {.name = "C", .defaultValue = 0.3f});

    REQUIRE_TRUE(firstId == 0);
    REQUIRE_TRUE(secondId == 1);
    REQUIRE_TRUE(thirdId == 2);
    REQUIRE_TRUE(&manager.ParameterById(firstId) == &groupA.ParameterByLocalIndex(0));
    REQUIRE_TRUE(&manager.ParameterById(secondId) == &groupB.ParameterByLocalIndex(0));
    REQUIRE_TRUE(&manager.ParameterById(thirdId) == &groupA.ParameterByLocalIndex(1));
}
```

Add duplicate and invalid lookup tests:

```cpp
TEST_CASE(register_parameter_rejects_duplicate_effective_names) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    (void)manager.RegisterParameter(group, {.name = "Cutoff", .defaultValue = 0.1f});
    bool threw = false;
    try {
        (void)manager.RegisterParameter(group, {.name = "Cutoff", .defaultValue = 0.2f});
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(manager.ParameterCount() == 1);
}

TEST_CASE(parameter_lookup_rejects_invalid_id) {
    synth::ParameterManager manager;
    bool threw = false;
    try {
        (void)manager.ParameterById(0);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure for missing `RegisterParameter`, `ParameterById`, `ParameterCount`, and `ParameterByLocalIndex`.

- [ ] **Step 3: Add public API declarations**

In `ParameterGroup` declare:

```cpp
Parameter& ParameterByLocalIndex(std::size_t localIx);
const Parameter& ParameterByLocalIndex(std::size_t localIx) const;
```

In `ParameterManager` declare:

```cpp
ParameterId RegisterParameter(ParameterGroup& group, ParameterConfig config);
Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
Parameter& ParameterById(ParameterId id);
const Parameter& ParameterById(ParameterId id) const;
std::size_t ParameterCount() const { return parameters_.size(); }
```

Add private members:

```cpp
std::vector<Parameter*> parameters_;
std::vector<std::string> parameterNames_;
```

Remove or stop using `nextId_` as an ID source.

- [ ] **Step 4: Implement registration path**

In `ParameterModulation.cpp`, implement `RegisterParameter` so it:

1. Throws `std::logic_error` if `config.name.empty()`.
2. Throws `std::logic_error` if `config.name` already appears in `parameterNames_`.
3. Throws `std::runtime_error` or preserves current `Exhausted` behavior if `group.CanAllocate()` is false.
4. Creates `Parameter` with `id = static_cast<ParameterId>(parameters_.size())`.
5. Appends the owned parameter pointer to `parameters_` only after allocation succeeds.
6. Appends the name to `parameterNames_` only after allocation succeeds.

Make `CreateParameter` call `RegisterParameter` and return `ParameterById(id)`.

- [ ] **Step 5: Update one-based ID assertions**

Find tests asserting `Id() == 1`, `NextParameterId() == 2`, or first/second/third IDs equal `1/2/3`. Update them to `0/1/2`, or remove `NextParameterId()` assertions if that helper is removed.

- [ ] **Step 6: Add mapping helper tests**

Add tests for:

```cpp
manager.GetLinear(10.0f, 20.0f, 0, paramId);
manager.GetExponential(32.0f, 3000.0f, 0, paramId);
manager.GetZeroBasedExponential(1.0f, 0.1f, 0, paramId);
manager.GetBipolarLinear(2.0f, 0, paramId);
```

Test endpoints by setting `SceneCenter(0)` to `0`, `0.5`, and `1`, calling `Compute` and `ProcessLite`, and verifying mapped outputs. For zero-based exponential, normalized `0.5` must equal `midpointValue` within tolerance.

- [ ] **Step 7: Implement mapping helpers**

Add manager helper declarations and definitions:

```cpp
float GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
float GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
float GetZeroBasedExponential(float maxValue, float midpointValue, std::size_t voiceIx, ParameterId id) const;
float GetBipolarLinear(float maxAbsValue, std::size_t voiceIx, ParameterId id) const;
float GetBipolarExponential(float minAbsValue, float maxAbsValue, std::size_t voiceIx, ParameterId id) const;
float GetBipolarZeroBasedExponential(float maxAbsValue, float midpointAbsValue, std::size_t voiceIx, ParameterId id) const;
```

Use `ParameterById(id).Get(voiceIx)`. Clamp normalized unipolar reads to `[0, 1]`; derive bipolar normalized as `clamped * 2 - 1`. Reject invalid exponential endpoints with `std::invalid_argument`.

- [ ] **Step 8: Verify and review**

Run:

```bash
make -C projects/synth test
openspec validate add-synth-modules-dual-vco
```

Then run xagent spec and code-quality reviews for Task 1. Fix all `CHANGES_REQUESTED` findings before marking OpenSpec tasks 1.1-1.4 and 2.1-2.5 complete.

## Task 2: Pointer-Backed Modulation Sources

**OpenSpec tasks covered:** 3.1-3.4

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add failing tests**

Add tests:

```cpp
TEST_CASE(group_modulation_source_updates_from_voice_pointers) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numModulators = 1, .numScenes = 1, .maxParameters = 1});
    float voice0 = 0.25f;
    float voice1 = 0.75f;
    std::array<float*, 2> source{&voice0, &voice1};

    group.SetModulationSource(0, source, {.name = "VCO", .shortName = "VCO", .color = synth::Color::Cyan, .connected = true});
    group.UpdateModValues();

    REQUIRE_NEAR(group.GetModulators().Value(0, 0), 0.25f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 0.75f, 0.0001f);
    REQUIRE_TRUE(group.GetModulators().Metadata(0).name == "VCO");
    REQUIRE_TRUE(group.GetModulators().Metadata(0).connected);

    voice0 = 0.6f;
    voice1 = 0.1f;
    manager.UpdateModValues(group);
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), 0.6f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 0.1f, 0.0001f);
}
```

Add failure tests for wrong pointer count and null connected pointer preserving previous metadata.

- [ ] **Step 2: Add API**

Add to `ParameterGroup`:

```cpp
void SetModulationSource(std::size_t modIx, std::span<float* const> voiceSources, ModulatorMetadata metadata);
void UpdateModValues();
```

Add to `ParameterManager`:

```cpp
void UpdateModValues(ParameterGroup& group);
void UpdateModValues();
```

Store source pointers in `ParameterGroup`:

```cpp
std::vector<float*> modulationSources_;
std::vector<bool> modulationSourceConnected_;
```

Index source pointers as `modIx * config_.numVoices + voiceIx`.

- [ ] **Step 3: Implement source registration**

`SetModulationSource` validates `modIx < numModulators`, `voiceSources.size() == numVoices`, and non-null pointers when `metadata.connected` is true. Only after validation, write metadata and pointers. `UpdateModValues` copies `*pointer` into `modulators_.Value(voiceIx, modIx)` unchanged for connected sources.

- [ ] **Step 4: Verify and review**

Run:

```bash
make -C projects/synth test
```

Run xagent Task 2 spec and code-quality reviews. Mark OpenSpec tasks 3.1-3.4 complete only after approval.

## Task 3: Bank-Slot Association And Safe Module Registration

**OpenSpec tasks covered:** 4.1-4.4

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add failing tests**

Add tests for associating two banks with one slot:

```cpp
TEST_CASE(banks_associated_with_slot_report_layout_capacity) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 3});
    auto& a = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.1f});
    auto& b = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.2f});
    auto& bankA = manager.CreateBank();
    auto& bankB = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.AddPhysicalEncoder(12);

    slot.AssociateBank(bankA);
    slot.AssociateBank(bankB);
    REQUIRE_TRUE(bankA.LayoutCapacity() == 3);
    REQUIRE_TRUE(bankB.LayoutCapacity() == 3);

    bankA.AddMappingAtOffset(0, std::span<synth::Parameter* const>{std::array<synth::Parameter*, 2>{&a, &b}});
    REQUIRE_TRUE(bankA.VisibleParameter(10) == &a);
    REQUIRE_TRUE(bankA.VisibleParameter(11) == &b);
}
```

If temporary arrays cannot bind to spans cleanly, construct named arrays before calling.

- [ ] **Step 2: Add bank association API**

Declare:

```cpp
class Bank {
public:
    void SetSlot(BankSlot* slot);
    BankSlot* Slot() const { return slot_; }
    std::size_t LayoutCapacity() const;
    void AddMappingAtOffset(std::size_t offset, std::span<Parameter* const> parameters);
private:
    BankSlot* slot_ = nullptr;
};

class BankSlot {
public:
    void AssociateBank(Bank& bank);
};
```

- [ ] **Step 3: Implement safe mapping**

`AssociateBank` sets `bank.SetSlot(this)`. `LayoutCapacity` throws `std::logic_error` if `slot_ == nullptr`; otherwise returns `slot_->PhysicalEncoders().size()`. `AddMappingAtOffset` validates capacity, duplicate parameter names in the batch, and duplicate target physical encoders before mutating. On success, map `parameters[ix]` to `slot_->PhysicalEncoders()[offset + ix]` with existing `AddMapping`.

- [ ] **Step 4: Verify and review**

Run `make -C projects/synth test`, then xagent Task 3 spec and code-quality reviews. Mark OpenSpec tasks 4.1-4.4 complete after approval.

## Task 4: Dual Wavetable VCO Module

**OpenSpec tasks covered:** 5.1-5.7

**Files:**
- Create: `projects/synth/include/synth/Modules.hpp`
- Create: `projects/synth/src/Modules.cpp`
- Create or modify: `projects/synth/tests/module_tests.cpp`
- Modify: `projects/synth/Makefile`

- [ ] **Step 1: Add test binary wiring**

Update `projects/synth/Makefile` with:

```make
MODULE_TEST_BIN := $(BUILD_DIR)/module_tests
SRC := src/ParameterModulation.cpp src/MidiController.cpp src/DspWavetable.cpp src/Modules.cpp
OBJ := $(BUILD_DIR)/ParameterModulation.o $(BUILD_DIR)/MidiController.o $(BUILD_DIR)/DspWavetable.o $(BUILD_DIR)/Modules.o
MODULE_HEADERS := include/synth/Modules.hpp

$(BUILD_DIR)/Modules.o: src/Modules.cpp include/synth/Modules.hpp include/synth/ParameterModulation.hpp include/synth/DspOscillators.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(MODULE_TEST_BIN): tests/module_tests.cpp $(LIB) $(MODULE_HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

test: $(TEST_BIN) $(DSP_TEST_BIN) $(MODULE_TEST_BIN)
	$(TEST_BIN)
	$(DSP_TEST_BIN)
	$(MODULE_TEST_BIN)
```

- [ ] **Step 2: Add failing module tests**

Create `projects/synth/tests/module_tests.cpp` with the same tiny harness style as `dsp_tests.cpp`. Include tests:

```cpp
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

TEST_CASE(dual_vco_registers_prefixed_parameters_and_rejects_repeat_registration);
TEST_CASE(dual_vco_registers_visible_parameters_to_associated_bank_slot);
TEST_CASE(dual_vco_set_input_maps_normalized_values_to_natural_units);
TEST_CASE(dual_vco_process_publishes_per_voice_outputs_and_normalized_sources);
TEST_CASE(dual_vco_populates_two_vco_ui_states);
```

Implement the full tests with `REQUIRE_TRUE` and `REQUIRE_NEAR` helpers before writing production code.

- [ ] **Step 3: Add module API**

In `Modules.hpp`, define:

```cpp
namespace synth {

class DualWavetableVcoModule {
public:
    static constexpr std::size_t kVoices = 2;

    struct Input {
        std::array<WavetableVco<12>::Input, kVoices> voices{};
    };

    struct UIState {
        std::array<WavetableVco<12>::UIState, kVoices> vcos{};
    };

    explicit DualWavetableVcoModule(double sampleRate);
    void SetScopeWriterHolder(std::size_t voiceIx, ScopeWriterHolder* holder);
    void SetColor(std::size_t voiceIx, Color color);
    void RegisterParameters(ParameterManager& manager, ParameterGroup& group, std::string_view prefix = {});
    void RegisterToBank(Bank& bank, std::size_t offset);
    void SetInput(const ParameterManager& manager, Input& input);
    void Process(const Input& input);
    void PopulateUIState(UIState& state) const;
    void RegisterModulationSources(ParameterGroup& group, std::size_t directModIx, std::size_t swappedModIx);

    ParameterId TuneId() const;
    ParameterId ShapeId() const;
    ParameterId PhaseId() const;
    ParameterId VolumeId() const;
    float Output(std::size_t voiceIx) const;
    float* DirectSourcePointer(std::size_t voiceIx);
    float* SwappedSourcePointer(std::size_t voiceIx);

private:
    double sampleRate_ = 48000.0;
    bool registered_ = false;
    std::array<ParameterId, 4> parameterIds_{};
    std::array<WavetableVco<12>, kVoices> vcos_;
    std::array<float, kVoices> outputs_{};
    std::array<float, kVoices> directSources_{};
    std::array<float, kVoices> swappedSources_{};
};

} // namespace synth
```

- [ ] **Step 4: Implement module**

Use parameter defaults:

```cpp
Tune defaultValue = 0.35f, color = Color::Cyan, shortName = "Tun";
Shape defaultValue = 0.0f, color = Color::Indigo, shortName = "Shp";
Phase defaultValue = 0.0f, color = Color::Blue, shortName = "Phs";
Volume defaultValue = 0.7f, color = Color::Yellow, shortName = "Vol";
```

Effective names are `prefix.empty() ? "Tune" : prefix + " Tune"` etc. `SetInput` reads `GetExponential(32, 3000) / sampleRate_`, `GetLinear(0, 1)` for shape/phase/volume. `Process` writes raw output, then direct and swapped normalized source arrays using `std::clamp((x + 1.0f) * 0.5f, 0.0f, 1.0f)`.

- [ ] **Step 5: Verify and review**

Run:

```bash
make -C projects/synth test
```

Run xagent Task 4 spec and code-quality reviews. Mark OpenSpec tasks 5.1-5.7 complete after approval.

## Task 5: Miniapp Integration

**OpenSpec tasks covered:** 6.1-6.6

**Files:**
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/DemoModulation.hpp`
- Modify: `projects/synth/miniapp/DemoModulationTests.cpp`
- Modify: `projects/synth/miniapp/Makefile`

- [ ] **Step 1: Update miniapp build inputs**

Add `$(SYNTH_ROOT)/src/Modules.cpp` to `SYNTH_SRC` and `$(SYNTH_ROOT)/include/synth/Modules.hpp` to `SYNTH_HEADERS` in `projects/synth/miniapp/Makefile`.

- [ ] **Step 2: Replace ad hoc VCO parameters in Main.cpp**

Include `synth/Modules.hpp`. Replace `tune_`, `phaseParam_`, `shape_`, `volume_`, `vcos_`, and raw VCO UI arrays with one `synth::DualWavetableVcoModule dualVco_{48000.0};`, one `DualWavetableVcoModule::Input`, and one `DualWavetableVcoModule::UIState`.

Call:

```cpp
dualVco_.RegisterParameters(manager_, group, "");
dualVco_.RegisterToBank(*vcoBank_, 0);
dualVco_.RegisterModulationSources(group, 0, 1);
```

Keep LFO Speed as the miniapp-owned parameter.

- [ ] **Step 3: Preserve page and bank behavior**

Associate both page banks with the slot after adding physical encoders:

```cpp
slot_->AssociateBank(*vcoBank_);
slot_->AssociateBank(*lfoBank_);
```

Register the VCO module to `vcoBank_`; add LFO Speed manually to `lfoBank_`. Page selection still calls `manager_.SelectBankForSlot(0, pageIx)` and `manager_.SetActivePage(...)`.

- [ ] **Step 4: Replace sample loop VCO formulas**

In `processDspFrame`, for each sample:

```cpp
synth_miniapp::ProcessLiteParameters(parameters_);
dualVco_.SetInput(manager_, dualVcoInput_);
dualVco_.Process(dualVcoInput_);
phase_ += synth_miniapp::LfoPhaseStep(lfoSpeed_->Get(0));
lfoSources_[0] = synth_miniapp::UnipolarSineModulator(phase_);
lfoSources_[1] = synth_miniapp::UnipolarSineModulator(phase_, juce::MathConstants<float>::halfPi);
manager_.UpdateModValues(*group_);
scopeWriter_.AdvanceIndex();
```

Register LFO source 2 with pointers to `lfoSources_`.

- [ ] **Step 5: Update miniapp helper tests**

Adjust `DemoModulationTests.cpp` so VCO modulator tests use the new pointer-backed source update system or move those checks to `module_tests.cpp`. Keep LFO helper tests for `UnipolarSineModulator`, `LfoPhaseStep`, `BipolarAudioToModulator`, and `ThreePhaseVoiceOffset`.

- [ ] **Step 6: Verify and review**

Run:

```bash
make -C projects/synth test
make -C projects/synth/miniapp test
```

If JUCE is missing, record exact output. Run xagent Task 5 spec and code-quality reviews. Mark OpenSpec tasks 6.1-6.6 complete after approval.

## Task 6: Final Verification And OpenSpec Synchronization

**OpenSpec tasks covered:** 7.1-7.5

**Files:**
- Modify: `openspec/changes/add-synth-modules-dual-vco/tasks.md`

- [ ] **Step 1: Run final commands**

Run:

```bash
openspec validate add-synth-modules-dual-vco
make -C projects/synth test
make -C projects/synth/miniapp test
make -C projects/synth miniapp
openspec status --change add-synth-modules-dual-vco
```

Record missing-JUCE output for the miniapp commands if applicable.

- [ ] **Step 2: Update OpenSpec checkboxes**

Mark only tasks whose implementation, verification, and xagent reviews are complete:

```markdown
- [x] 7.1 Run `openspec validate add-synth-modules-dual-vco`.
- [x] 7.2 Run `make -C projects/synth test`.
```

- [ ] **Step 3: Final xagent review**

Run one final Opus review covering all changed code and specs. Prompt it to check `synth-modules`, `synth-parameter-modulation`, and `synth-dsp-classes` requirements; module/DSP boundary; zero-based IDs; bank-slot association; pointer-backed modulation sources; miniapp behavior; tests; and OpenSpec task status.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short
openspec status --change add-synth-modules-dual-vco
```

Report completed tasks, verification output, xagent review run IDs, and any residual risks.
