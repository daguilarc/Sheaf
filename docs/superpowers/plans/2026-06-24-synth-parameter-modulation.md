# Synth Parameter Modulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `projects/synth`, a C++20 parameter/modulation library with Smart Grid-style scenes, gestures, modulation normalization, bank/slot routing, and deterministic randomized tests.

**Architecture:** Implement one focused public API in `include/synth/ParameterModulation.hpp` backed by `src/ParameterModulation.cpp`. Keep audio-rate methods inline or allocation-free, with all dynamic storage allocated at group/manager setup time. Use a tiny self-contained C++ test harness in `tests/parameter_modulation_tests.cpp` so the project has no external dependency.

**Tech Stack:** C++20, `clang++`, `make`, standard library only.

---

## File Structure

- Create `projects/synth/include/synth/ParameterModulation.hpp`: public types and method declarations for manager, groups, parameters, modulators, gestures, banks, slots, and normalized helpers.
- Create `projects/synth/src/ParameterModulation.cpp`: implementation for allocation/setup, compute/editing, routing, and safety checks.
- Create `projects/synth/tests/parameter_modulation_tests.cpp`: unit tests and randomized simulation tests.
- Create `projects/synth/Makefile`: build static library and test binary.
- Create `projects/synth/README.md`: boundary docs and formulas.
- Modify root `Makefile`: add `synth` project and shortcut targets.
- Modify `openspec/changes/add-synth-parameter-modulation-system/tasks.md`: check boxes only after implementation and review completion.

## Task 1: Project Scaffolding and Test Harness

**Files:**
- Create: `projects/synth/include/synth/ParameterModulation.hpp`
- Create: `projects/synth/src/ParameterModulation.cpp`
- Create: `projects/synth/tests/parameter_modulation_tests.cpp`
- Create: `projects/synth/Makefile`
- Create: `projects/synth/README.md`
- Modify: `Makefile`

- [x] **Step 1: Add the project directories and minimal public header**

Create `projects/synth/include/synth/ParameterModulation.hpp` with this initial shell:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace synth {

using ParameterId = std::uint32_t;
using PhysicalEncoderId = std::uint32_t;

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
};

enum class RangeKind {
    Unipolar,
    Bipolar,
};

float ClampToRange(float value, RangeKind range);

} // namespace synth
```

- [x] **Step 2: Add the minimal implementation file**

Create `projects/synth/src/ParameterModulation.cpp`:

```cpp
#include "synth/ParameterModulation.hpp"

#include <algorithm>

namespace synth {

float ClampToRange(float value, RangeKind range) {
    if (range == RangeKind::Bipolar) {
        return std::clamp(value, -1.0f, 1.0f);
    }
    return std::clamp(value, 0.0f, 1.0f);
}

} // namespace synth
```

- [x] **Step 3: Add the test harness**

Create `projects/synth/tests/parameter_modulation_tests.cpp`:

```cpp
#include "synth/ParameterModulation.hpp"

#include <cmath>
#include <exception>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

} // namespace

TEST_CASE(smoke_clamps_ranges) {
    REQUIRE_NEAR(synth::ClampToRange(2.0f, synth::RangeKind::Unipolar), 1.0f, 0.0001f);
    REQUIRE_NEAR(synth::ClampToRange(-2.0f, synth::RangeKind::Bipolar), -1.0f, 0.0001f);
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
```

- [x] **Step 4: Add the project Makefile**

Create `projects/synth/Makefile`:

```make
CXX ?= clang++
CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
CPPFLAGS ?= -Iinclude
BUILD_DIR := build
LIB := $(BUILD_DIR)/libsynth.a
TEST_BIN := $(BUILD_DIR)/parameter_modulation_tests
SRC := src/ParameterModulation.cpp
OBJ := $(BUILD_DIR)/ParameterModulation.o

.PHONY: all build test clean

all: build test

build: $(LIB)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(OBJ): $(SRC) include/synth/ParameterModulation.hpp | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(LIB): $(OBJ)
	ar rcs $@ $^

$(TEST_BIN): tests/parameter_modulation_tests.cpp $(LIB)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(LIB) -o $@

test: $(TEST_BIN)
	$(TEST_BIN)

clean:
	rm -rf $(BUILD_DIR)
```

- [x] **Step 5: Wire root Makefile**

Modify the root `Makefile`:

```make
PROJECTS := conductor web quest-runner dictator realtime-agent sheaf-chat agents xagent synth
```

Add `.PHONY` entries:

```make
.PHONY: synth-build synth-test synth-clean
```

Add targets:

```make
synth-build:
	$(MAKE) -C projects/synth build

synth-test:
	$(MAKE) -C projects/synth test

synth-clean:
	$(MAKE) -C projects/synth clean
```

- [x] **Step 6: Add project README**

Create `projects/synth/README.md`:

```markdown
# Synth

`projects/synth` contains C++ libraries and utilities for building synthesizers.
The first library is the parameter/modulation system.

The audio-rate parameter read is intentionally compact:

```text
Get(voice) = clamp(currentCenter * currentCenterScale[voice]
                   + dot(modulatorValues[voice], currentDepths[voice]))
```

Scene and gesture data are global per parameter, not per voice. Modulator values
and modulation depths are per voice. Modulation depths are signed normalized
values; the Smart Grid weight sum uses `abs(depth)` for range accounting while
the signed depth remains in the dot product.
```

- [x] **Step 7: Verify the scaffold**

Run:

```bash
make synth-test
```

Expected output includes:

```text
[PASS] smoke_clamps_ranges
```

## Task 2: Core Model, Group Allocation, Modulators, and Gestures

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Extend public types**

Add declarations for configs, scene state, modulators, gestures, groups, and manager:

```cpp
struct SceneState {
    std::size_t leftScene = 0;
    std::size_t rightScene = 1;
    float blend = 0.0f;
};

struct ParameterGroupConfig {
    std::size_t numVoices = 0;
    std::size_t numModulators = 0;
    std::size_t numGestures = 0;
    std::size_t numScenes = 0;
    std::size_t maxParameters = 0;
    float processLiteAlpha = 1.0f;
    bool IsValid() const;
};

struct ModulatorMetadata {
    std::string name;
    Color color;
    bool connected = false;
};

struct GestureMetadata {
    std::string name;
    Color color;
};

class Modulators {
public:
    explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);
    float& Value(std::size_t voiceIx, std::size_t modIx);
    float Value(std::size_t voiceIx, std::size_t modIx) const;
    float Apply(std::size_t voiceIx, std::span<const float> depths) const;
    std::size_t NumVoices() const { return numVoices_; }
    std::size_t NumModulators() const { return numModulators_; }
    std::vector<ModulatorMetadata>& Metadata() { return metadata_; }
    const std::vector<ModulatorMetadata>& Metadata() const { return metadata_; }
private:
    std::size_t Index(std::size_t voiceIx, std::size_t modIx) const;
    std::size_t numVoices_ = 0;
    std::size_t numModulators_ = 0;
    std::vector<float> values_;
    std::vector<ModulatorMetadata> metadata_;
};

class Gestures {
public:
    explicit Gestures(std::size_t gestures = 0);
    float& Value(std::size_t gestureIx);
    float Value(std::size_t gestureIx) const;
    void Select(std::size_t gestureIx, bool selected);
    bool Selected(std::size_t gestureIx) const;
    void ClearSelection();
    std::size_t NumGestures() const { return values_.size(); }
    std::vector<GestureMetadata>& Metadata() { return metadata_; }
    const std::vector<GestureMetadata>& Metadata() const { return metadata_; }
private:
    std::vector<float> values_;
    std::vector<bool> selected_;
    std::vector<GestureMetadata> metadata_;
};

class Parameter;

class ParameterGroup {
public:
    explicit ParameterGroup(ParameterGroupConfig config);
    const ParameterGroupConfig& Config() const { return config_; }
    Modulators& GetModulators() { return modulators_; }
    Gestures& GetGestures() { return gestures_; }
    const Modulators& GetModulators() const { return modulators_; }
    const Gestures& GetGestures() const { return gestures_; }
    bool CanAllocate() const;
private:
    friend class ParameterManager;
    ParameterGroupConfig config_;
    Modulators modulators_;
    Gestures gestures_;
    std::vector<std::unique_ptr<Parameter>> parameters_;
};

class ParameterManager {
public:
    ParameterManager() = default;
    ParameterGroup& CreateGroup(ParameterGroupConfig config);
    ParameterId NextParameterId();
    SceneState& Scene() { return scene_; }
    const SceneState& Scene() const { return scene_; }
private:
    ParameterId nextId_ = 1;
    SceneState scene_;
    std::vector<std::unique_ptr<ParameterGroup>> groups_;
};
```

- [x] **Step 2: Implement validation and storage**

Implement `ParameterGroupConfig::IsValid`, `Modulators`, `Gestures`, `ParameterGroup`, and `ParameterManager` in `ParameterModulation.cpp`. Use `std::out_of_range` for invalid indices.

- [x] **Step 3: Add focused tests**

Add tests named:

```cpp
TEST_CASE(group_config_validation)
TEST_CASE(manager_assigns_unique_ids)
TEST_CASE(modulators_use_voice_major_dot_product)
TEST_CASE(gestures_store_values_and_selection)
```

Verify exact expected values from the OpenSpec examples, including the dot product `-0.1`.

- [x] **Step 4: Run tests**

Run:

```bash
make synth-test
```

Expected: all scaffold and core tests pass.

## Task 3: Parameter State, Compute, Get, and ProcessLite

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add parameter declarations**

Add `ParameterConfig` and `Parameter`:

```cpp
struct ParameterConfig {
    std::string name;
    std::string shortName;
    float defaultValue = 0.0f;
    RangeKind range = RangeKind::Unipolar;
};

class Parameter {
public:
    Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config);
    ParameterId Id() const { return id_; }
    const std::string& Name() const { return config_.name; }
    ParameterGroup& Group() { return group_; }
    const ParameterGroup& Group() const { return group_; }
    float Get(std::size_t voiceIx) const;
    void Compute(const SceneState& scene);
    void ProcessLite();
    bool AssignModulationDepth(std::size_t modIx, Parameter* parameter);
    void ClearModulationDepths();
    float& SceneCenter(std::size_t sceneIx);
    float SceneCenter(std::size_t sceneIx) const;
    float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
    float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
    bool& GestureActive(std::size_t sceneIx, std::size_t gestureIx);
    bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
    std::span<float> CurrentDepths(std::size_t voiceIx);
    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
    float CurrentCenter() const { return currentCenter_; }
    float TargetCenter() const { return targetCenter_; }
    float CurrentCenterScale(std::size_t voiceIx) const;
    float TargetCenterScale(std::size_t voiceIx) const;
private:
    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
    std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
    float ComputeRawCenter(const SceneState& scene) const;
    bool WouldCreateCycle(const Parameter* candidate) const;

    ParameterId id_;
    ParameterGroup& group_;
    ParameterConfig config_;
    std::size_t recursionDepth_ = 0;
    float currentCenter_ = 0.0f;
    float targetCenter_ = 0.0f;
    std::vector<float> currentCenterScales_;
    std::vector<float> targetCenterScales_;
    std::vector<float> currentDepths_;
    std::vector<float> targetDepths_;
    std::vector<Parameter*> modulationDepths_;
    std::vector<float> sceneCenters_;
    std::vector<float> gestureValues_;
    std::vector<bool> gestureActive_;
};
```

Also add manager creation:

```cpp
Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
```

- [x] **Step 2: Implement initialization and `Get`**

Initialize scene centers/current/target center to default, center scales to `1.0f`, depths to `0`, and routes to null. Implement:

```cpp
float Parameter::Get(std::size_t voiceIx) const {
    return ClampToRange(
        currentCenter_ * currentCenterScales_.at(voiceIx) +
        group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
        config_.range);
}
```

- [x] **Step 3: Implement compute**

Implement scene blend, gesture weighted average, route recursion, signed depth normalization with `abs`, and nested route bypass. `AssignModulationDepth` must reject direct/indirect cycles. The parent depth read is `depthParameter->Get(voiceIx)`.

- [x] **Step 4: Implement `ProcessLite`**

Use:

```cpp
current += alpha * (target - current);
```

for `currentCenter_`, each center scale, and each depth.

- [x] **Step 5: Add compute tests**

Add tests named:

```cpp
TEST_CASE(parameter_default_state)
TEST_CASE(scene_and_gesture_interpolation)
TEST_CASE(modulation_normalization_under_one)
TEST_CASE(modulation_normalization_over_one_preserves_sign)
TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew)
TEST_CASE(process_lite_slews_center_scale_and_depths)
```

Use the spec examples: scene `0.2/0.8/0.25 => 0.35`, gesture `0.4/0.9/0.5 => 0.65`, center scale `0.25 => 0.75`, and depth sum `2.0 => divide by 2`.

- [x] **Step 6: Run tests**

Run:

```bash
make synth-test
```

Expected: all parameter compute/audio-path tests pass.

## Task 4: Editing Semantics and Defaults

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add edit APIs**

Add to `Parameter`:

```cpp
void HandleIncDec(const SceneState& scene, float delta);
void RevertToDefault(const SceneState& scene);
```

- [x] **Step 2: Implement Smart Grid scene distribution**

Use the exact OpenSpec contract:

```cpp
if (blend <= 0) left = clamp(left + delta);
else if (blend >= 1) right = clamp(right + delta);
else {
    targetBlended = clamp(Blend(sceneCenters) + delta);
    proposedLeft = left + delta * (1 - blend);
    proposedRight = right + delta * blend;
    if proposedLeft outside range: left = clamp(proposedLeft); right = solve;
    else if proposedRight outside range: right = clamp(proposedRight); left = solve;
    else: left = proposedLeft; right = proposedRight;
}
```

Do not re-clamp the solved opposite scene value.

- [x] **Step 3: Implement selected gesture edit distribution**

When any group gesture is selected, activate selected gestures for active scenes before editing. Activation snapshots the parent scene value into the gesture value. Apply the same scene distribution to gesture values for the selected gesture. Apply remaining base edit using the effective gesture weight rule from the design.

- [x] **Step 4: Implement revert**

`RevertToDefault` clears all depth routes, zeros current/target depths, deactivates active-scene gesture flags, sets active scene centers to the default, and sets center/current scale state consistently.

- [x] **Step 5: Add editing tests**

Add tests named:

```cpp
TEST_CASE(handle_inc_dec_endpoint_scene)
TEST_CASE(handle_inc_dec_mid_blend_matches_smart_grid_attenuation)
TEST_CASE(handle_inc_dec_saturation_solve_matches_smart_grid)
TEST_CASE(selected_gesture_activation_snapshots_parent_value)
TEST_CASE(revert_to_default_clears_modulation_and_gestures)
```

Use `left=right=0.5`, `blend=0.5`, `delta=0.2` and expect both scenes to become `0.6`, with blended output `0.6` rather than `0.7`.

- [x] **Step 6: Run tests**

Run:

```bash
make synth-test
```

Expected: editing tests pass.

## Task 5: Pages, Banks, Slots, and Routed Controls

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add page/bank/slot declarations**

Add:

```cpp
struct Page {
    std::size_t ordinal = 0;
    std::string name;
    std::vector<Parameter*> parameters;
};

class Bank {
public:
    void AddMapping(PhysicalEncoderId encoderId, Parameter& parameter);
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    void Deselect();
    bool ShowingModulation() const;
private:
    struct Cell { PhysicalEncoderId encoderId; Parameter* parameter; bool returnCell = false; };
    std::vector<Cell> topLevel_;
    std::vector<Cell> visible_;
    Parameter* selected_ = nullptr;
};

class BankSlot {
public:
    void SelectBank(Bank* bank);
    bool Owns(PhysicalEncoderId encoderId) const;
    void AddPhysicalEncoder(PhysicalEncoderId encoderId);
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
private:
    std::vector<PhysicalEncoderId> physicalEncoders_;
    Bank* selectedBank_ = nullptr;
};
```

Add manager page and routing APIs:

```cpp
Page& CreatePage(std::string name);
void SetActivePage(std::size_t ordinal);
std::optional<std::size_t> ActivePage() const;
Bank& CreateBank();
BankSlot& CreateBankSlot();
void HandlePress(PhysicalEncoderId encoderId);
void HandleShiftPress(PhysicalEncoderId encoderId);
void HandleTick(PhysicalEncoderId encoderId, float delta);
```

- [x] **Step 2: Implement top-level and modulation views**

Pressing a top-level parameter populates visible cells with modulation-depth parameters for each modulator and a final return cell. If a modulation-depth parameter does not exist yet, create it in the selected parameter's group with bipolar range and default `0`. Pressing the return cell restores `topLevel_`. Pressing a modulation cell opens nested modulation for that parameter.

- [x] **Step 3: Implement slot and manager routing**

Slots own physical IDs. Manager routed methods find the first slot whose selected bank owns the ID and dispatch. Unmapped IDs are ignored.

- [x] **Step 4: Add routing tests**

Add tests named:

```cpp
TEST_CASE(pages_change_routing_only)
TEST_CASE(bank_press_opens_modulation_view_and_return_cell_closes_it)
TEST_CASE(shift_press_reverts_parameter)
TEST_CASE(slot_switch_deselects_previous_bank)
TEST_CASE(manager_ignores_unmapped_physical_encoder)
TEST_CASE(manager_tick_routes_to_selected_bank)
```

- [x] **Step 5: Run tests**

Run:

```bash
make synth-test
```

Expected: routing tests pass.

## Task 6: Randomized Simulation, Docs, and OpenSpec Progress

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: `projects/synth/README.md`
- Modify: `openspec/changes/add-synth-parameter-modulation-system/tasks.md`

- [x] **Step 1: Add deterministic randomized simulation fixture**

Build a fixture with:

```cpp
ParameterManager manager;
auto& group = manager.CreateGroup({4, 3, 2, 3, 32, 0.25f});
// Multiple parameters, two banks, one slot, three scenes, two gestures.
```

Use `std::mt19937` and fixed default seeds `{0x51A7u, 0xC0FFEEu, 0xA11CEu}`.

- [x] **Step 2: Add independent oracle**

Keep separate plain structs for expected scene centers, gesture values/active flags, group gesture values/selection, bank view state, and modulation values. Do not call implementation index helpers from oracle calculations.

- [x] **Step 3: Add random actions**

Randomly choose among:

```text
turn encoder, press encoder, shift press, select gesture, deselect gesture,
change gesture value, change page, select bank, change scene, change blend,
change modulator value, compute, process-lite
```

After each step compare expected and actual values for active page, bank mode, selected gestures, scene centers, gesture state, target/current center scale, depth rows, and `Get(voiceIx)`.

- [x] **Step 4: Add stress controls**

Read optional environment variables:

```text
SYNTH_RANDOM_SEEDS
SYNTH_RANDOM_STEPS
```

Default should stay bounded for routine `make synth-test`.

- [x] **Step 5: Finish README formulas**

Document scene blend, Smart Grid scene edit distribution, gesture target center, and modulation normalization formulas from the OpenSpec contract.

- [x] **Step 6: Run full verification**

Run:

```bash
make synth-test
make synth-build
```

Then from the repo root:

```bash
make synth-test
make synth-build
openspec validate add-synth-parameter-modulation-system
```

Expected: all commands exit zero.

- [x] **Step 7: Update OpenSpec checkboxes**

After implementation, tests, and xagent reviews pass, mark all 37 checkboxes in `openspec/changes/add-synth-parameter-modulation-system/tasks.md` complete.

## Review Gates

After each implementation task:

1. Run the task's local verification command.
2. Run an xagent Opus spec-compliance review scoped to that task and changed files.
3. Fix any blocking or important findings.
4. Run an xagent Opus code-quality review scoped to that task and changed files.
5. Fix any blocking or important findings.
6. Only then mark the task complete and continue.

Use:

```bash
node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<review prompt>"
```

## Self-Review

- Spec coverage: Tasks 1-6 cover spm-1 through spm-18, plus docs, root Makefile wiring, randomized oracle, and OpenSpec checkbox synchronization.
- Placeholder scan: no task says to add unspecified behavior; each task names concrete files, APIs, tests, and commands.
- Type consistency: `ParameterManager`, `ParameterGroup`, `Parameter`, `Modulators`, `Gestures`, `Bank`, and `BankSlot` names match the OpenSpec artifacts and stay consistent across tasks.
