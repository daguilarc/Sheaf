# Reset And Random Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the synth reset modifier away from shift and add random/random-mod modifiers for encoder presses and bank actions.

**Architecture:** Keep the existing `ParameterManager`/`Bank`/`BankSlot`/`MessageInBus` routing shape, but replace the single `shiftHeld_` flag with reset/random/random-mod held state plus a `Modifier` enum. Random behavior is centralized behind a deterministic manager random source so unit tests and randomized simulation oracles consume the same value, coin, and slot-selection samples.

**Tech Stack:** C++20 synth library under `projects/synth`, custom test harness in `projects/synth/tests/parameter_modulation_tests.cpp`, Makefile target `make -C projects/synth test`, OpenSpec change `rename-shift-reset-add-random-modifiers`.

---

## Files And Responsibilities

- `projects/synth/include/synth/ParameterModulation.hpp`: public modifier enum, random source hook, reset/random/random-mod manager APIs, renamed message factories, UI-state fields.
- `projects/synth/src/ParameterModulation.cpp`: parameter randomization helpers, modifier-aware bank/slot/manager routing, message bus application, UI-state population, default reset behavior.
- `projects/synth/include/synth/MidiController.hpp`: no major type reshaping expected, but keep declarations consistent if output-info helpers need signature changes.
- `projects/synth/src/MidiController.cpp`: message type JSON names, legacy shift string migration, output-info feedback, WRLD.Bldr default reset/random/random-mod positions.
- `projects/synth/apps/miniapp/MiniApp.hpp`, `projects/synth/apps/miniapp/README.md`, `projects/synth/README.md`: visible labels/docs and UI-state reads from shift to reset plus random/random-mod controls where present.
- `projects/synth/tests/support/SynthRig.hpp`: test helper rename from shift to reset and helpers for random/random-mod press sequences when the helper layer already wraps system-button presses.
- `projects/synth/tests/parameter_modulation_tests.cpp`: focused unit tests, JSON/profile tests, randomized oracle updates, message-bus UI-state simulation updates.
- `projects/synth/tests/rig_tests.cpp`, `projects/synth/tests/miniapp_system_tests.cpp`, `projects/synth/tests/engine_tests.cpp`: update helper call sites and profile expectations if compilation reveals references.
- `openspec/changes/rename-shift-reset-add-random-modifiers/tasks.md`: mark OpenSpec checkboxes only after reviewed, verified work is complete.

## Context

- Spec source: `openspec/changes/rename-shift-reset-add-random-modifiers/{proposal.md,design.md,tasks.md}` and `openspec/changes/rename-shift-reset-add-random-modifiers/specs/synth-parameter-modulation/spec.md`.
- Claude Opus spec review passed after the spec repair. Remaining intentional `shift` references in the delta are the `spm-15` source header and legacy JSON migration language.
- Baseline `make -C projects/synth test` passed before implementation in linked worktree `/Users/joyo/.codex/worktrees/0c9e/Sheaf` (detached HEAD, externally managed).

### Task 1: Core Modifier API And Random Source

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Write failing modifier-state tests**

Add tests near `message_bus_set_shift_and_set_gesture_select_are_idempotent`:

```cpp
TEST_CASE(manager_tracks_reset_random_and_random_mod_precedence) {
    synth::ParameterManager manager;
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);

    manager.SetResetHeld(true);
    REQUIRE_TRUE(manager.ResetHeld());
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Reset);

    manager.SetRandomHeld(true);
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Random);

    manager.SetRandomModHeld(true);
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::RandomMod);

    manager.SetRandomModHeld(false);
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Random);

    manager.SetRandomHeld(false);
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Reset);

    manager.ToggleResetHeld();
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);
}

TEST_CASE(message_bus_sets_reset_random_and_random_mod_idempotently) {
    synth::ParameterManager manager;
    synth::MessageInBus bus(&manager, 16);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(1, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandom(2, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandomMod(3, true)));
    bus.Process(3);

    REQUIRE_TRUE(manager.ResetHeld());
    REQUIRE_TRUE(manager.RandomHeld());
    REQUIRE_TRUE(manager.RandomModHeld());
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::RandomMod);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandomMod(4, false)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandom(5, false)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(6, false)));
    bus.Process(6);

    REQUIRE_TRUE(!manager.ResetHeld());
    REQUIRE_TRUE(!manager.RandomHeld());
    REQUIRE_TRUE(!manager.RandomModHeld());
    REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);
}
```

- [x] **Step 2: Run focused tests to verify failure**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: compile failure for missing `synth::Modifier`, `SetReset`, `SetRandom`, `SetRandomMod`, and manager accessors.

- [x] **Step 3: Implement the public modifier state and random source declarations**

In `ParameterModulation.hpp`, add `<functional>` and `<random>`, then add:

```cpp
enum class Modifier {
    None,
    Reset,
    Random,
    RandomMod,
};

using ParameterRandomFloat = std::function<float()>;
using ParameterRandomIndex = std::function<std::size_t(std::size_t)>;
```

In `ParameterManager::UIState`, replace `shiftHeld` with:

```cpp
std::atomic<bool> resetHeld{false};
std::atomic<bool> randomHeld{false};
std::atomic<bool> randomModHeld{false};
```

In `ParameterManager`, replace shift accessors with:

```cpp
Modifier GetCurrentModifier() const;

bool ResetHeld() const { return resetHeld_; }
void SetResetHeld(bool held) { resetHeld_ = held; }
void ToggleResetHeld() { resetHeld_ = !resetHeld_; }

bool RandomHeld() const { return randomHeld_; }
void SetRandomHeld(bool held) { randomHeld_ = held; }
void ToggleRandomHeld() { randomHeld_ = !randomHeld_; }

bool RandomModHeld() const { return randomModHeld_; }
void SetRandomModHeld(bool held) { randomModHeld_ = held; }
void ToggleRandomModHeld() { randomModHeld_ = !randomModHeld_; }

void SetRandomSource(ParameterRandomFloat valueSource, ParameterRandomFloat coinSource,
                     ParameterRandomIndex indexSource);
float NextRandomValue();
float NextRandomCoin();
std::size_t NextRandomIndex(std::size_t exclusiveMax);
```

Update `DefaultControlState` and private fields:

```cpp
struct DefaultControlState {
    SceneState scene;
    bool resetHeld = false;
    bool randomHeld = false;
    bool randomModHeld = false;
    std::vector<float> gestureValues;
    std::vector<bool> gestureSelected;
    std::optional<PageOrdinal> activePageOrdinal;
};

bool resetHeld_ = false;
bool randomHeld_ = false;
bool randomModHeld_ = false;
ParameterRandomFloat randomValueSource_;
ParameterRandomFloat randomCoinSource_;
ParameterRandomIndex randomIndexSource_;
std::mt19937 randomEngine_{0x51EA5EEDu};
```

Keep no permanent `ShiftHeld` aliases in the public contract unless needed only as temporary local compile scaffolding; the final grep in Task 5 must justify any retained compatibility names.

- [x] **Step 4: Implement modifier state in `ParameterModulation.cpp`**

Add implementations:

```cpp
Modifier ParameterManager::GetCurrentModifier() const {
    if (randomModHeld_) {
        return Modifier::RandomMod;
    }
    if (randomHeld_) {
        return Modifier::Random;
    }
    if (resetHeld_) {
        return Modifier::Reset;
    }
    return Modifier::None;
}

void ParameterManager::SetRandomSource(ParameterRandomFloat valueSource,
                                       ParameterRandomFloat coinSource,
                                       ParameterRandomIndex indexSource) {
    randomValueSource_ = std::move(valueSource);
    randomCoinSource_ = std::move(coinSource);
    randomIndexSource_ = std::move(indexSource);
}

float ParameterManager::NextRandomValue() {
    if (randomValueSource_) {
        return std::clamp(randomValueSource_(), 0.0f, 1.0f);
    }
    return std::generate_canonical<float, 24>(randomEngine_);
}

float ParameterManager::NextRandomCoin() {
    if (randomCoinSource_) {
        return randomCoinSource_();
    }
    return std::generate_canonical<float, 24>(randomEngine_);
}

std::size_t ParameterManager::NextRandomIndex(std::size_t exclusiveMax) {
    if (exclusiveMax == 0) {
        return 0;
    }
    if (randomIndexSource_) {
        return randomIndexSource_(exclusiveMax) % exclusiveMax;
    }
    std::uniform_int_distribution<std::size_t> dist(0, exclusiveMax - 1);
    return dist(randomEngine_);
}
```

Update `CaptureDefaultControlState`, `RevertAllToDefaults`, and `PopulateUIState` to save/restore/store reset/random/random-mod held states.

- [x] **Step 5: Rename and add message factories**

In `MessageIn::Type`, replace `ToggleShift` with:

```cpp
ToggleReset,
ToggleRandom,
ToggleRandomMod,
```

Add factories:

```cpp
static MessageIn ToggleReset(std::uint64_t timestamp);
static MessageIn SetReset(std::uint64_t timestamp, bool held);
static MessageIn ToggleRandom(std::uint64_t timestamp);
static MessageIn SetRandom(std::uint64_t timestamp, bool held);
static MessageIn ToggleRandomMod(std::uint64_t timestamp);
static MessageIn SetRandomMod(std::uint64_t timestamp, bool held);
```

Implement them by mirroring the old `ToggleShift`/`SetShift` pattern.

- [x] **Step 6: Run tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: both tests pass.

### Task 2: Modifier-Aware Press, Random, Random-Mod, And Bank Actions

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Write focused press and bank tests**

Add tests near existing press/reset tests:

```cpp
TEST_CASE(random_modifier_press_randomizes_visible_value_without_modulation_changes) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 2, .maxParameters = 4});
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
    auto& depth = carrier.EnsureModulationDepth(0);
    depth.HandleIncDec(manager.Scene(), 0.4f);

    auto& bank = manager.CreateBank();
    bank.AddMapping(10, carrier);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);

    manager.SetRandomSource([] { return 0.8f; }, [] { return 1.0f; },
                            [](std::size_t max) { return max == 0 ? 0 : 0; });
    manager.SetRandomHeld(true);
    manager.HandlePress(0, 0);
    carrier.Compute(manager.Scene());
    depth.Compute(manager.Scene());

    REQUIRE_NEAR(carrier.TargetCenter(), 0.8f, 0.0001f);
    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == &depth);
    REQUIRE_NEAR(depth.TargetCenter(), 0.4f, 0.0001f);
}

TEST_CASE(random_mod_modifier_press_uses_geometric_slots_with_replacement) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, carrier);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);

    std::array<float, 3> coins{0.25f, 0.25f, 0.75f};
    std::array<float, 2> values{0.6f, 0.2f};
    std::size_t coinIx = 0;
    std::size_t valueIx = 0;
    std::size_t indexCalls = 0;
    manager.SetRandomSource(
        [&] { return values[valueIx++]; },
        [&] { return coins[coinIx++]; },
        [&](std::size_t max) {
            ++indexCalls;
            return max == 0 ? 0 : 1 % max;
        });
    manager.SetRandomModHeld(true);
    manager.HandlePress(0, 0);

    synth::Parameter* depth = carrier.ModulationDepthParameter(1);
    REQUIRE_TRUE(depth != nullptr);
    depth->Compute(manager.Scene());
    REQUIRE_NEAR(depth->TargetCenter(), 0.2f, 0.0001f);
    REQUIRE_TRUE(indexCalls == 2);
    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
}

TEST_CASE(modified_bank_select_applies_modifier_to_target_bank_without_selection_change) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 8});
    auto& a = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.1f});
    auto& b = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.2f});
    auto& bankA = manager.CreateBank();
    bankA.AddMapping(10, a);
    auto& bankB = manager.CreateBank();
    bankB.AddMapping(11, b);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bankA);

    manager.SetRandomSource([] { return 0.9f; }, [] { return 1.0f; },
                            [](std::size_t max) { return max == 0 ? 0 : 0; });
    manager.SetRandomHeld(true);
    REQUIRE_TRUE(manager.SelectBankForSlot(0, 1));
    b.Compute(manager.Scene());

    REQUIRE_TRUE(slot.SelectedBank() == &bankA);
    REQUIRE_NEAR(b.TargetCenter(), 0.9f, 0.0001f);
}
```

- [x] **Step 2: Run tests to verify failure**

Build and run the full parameter-modulation binary; this custom harness does not filter by test name:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: compile or assertion failures until routing exists.

- [x] **Step 3: Add parameter and bank helper declarations**

In `Parameter`, add:

```cpp
void RandomizeValue(const SceneState& scene, float normalizedValue);
```

In `Bank`, replace `HandleShiftPress` with:

```cpp
void HandlePress(PhysicalEncoderId encoderId, Modifier modifier, const SceneState& scene,
                 std::span<const PhysicalEncoderId> physicalLayout);
void HandleModifierAction(PhysicalEncoderId encoderId, Modifier modifier, const SceneState& scene);
void ApplyModifierToTopLevel(Modifier modifier, const SceneState& scene);
```

In `ParameterManager`, add private helpers:

```cpp
void ApplyModifierToParameter(Parameter& parameter, Modifier modifier);
void ApplyModifierToBank(Bank& bank, Modifier modifier);
```

- [x] **Step 4: Implement random value and random-mod behavior**

Implement:

```cpp
void Parameter::RandomizeValue(const SceneState& scene, float normalizedValue) {
    Compute(scene);
    const float target = ClampToRange(normalizedValue, config_.range);
    HandleIncDec(scene, target - targetCenter_);
    Compute(scene);
}
```

Implement `ParameterManager::ApplyModifierToParameter`:

```cpp
void ParameterManager::ApplyModifierToParameter(Parameter& parameter, Modifier modifier) {
    switch (modifier) {
    case Modifier::Reset:
        parameter.RevertToDefault(scene_);
        break;
    case Modifier::Random:
        parameter.RandomizeValue(scene_, NextRandomValue());
        break;
    case Modifier::RandomMod: {
        const std::size_t modulatorCount = parameter.Group().Config().numModulators;
        if (modulatorCount == 0) {
            return;
        }
        while (NextRandomCoin() < 0.5f) {
            const std::size_t modIx = NextRandomIndex(modulatorCount);
            Parameter* depth = parameter.ModulationDepthParameter(modIx);
            if (depth == nullptr) {
                depth = parameter.EnsureModulationDepth(modIx);
                if (depth == nullptr) {
                    return;
                }
            }
            depth->RandomizeValue(scene_, NextRandomValue());
        }
        break;
    }
    case Modifier::None:
        break;
    }
}
```

- [x] **Step 5: Refactor press routing**

Make `BankSlot::HandlePress` pass `selectedBank_->HandlePress(encoderId, managerModifier, scene, physicalEncoders_)`. Since `BankSlot` has no manager, have `ParameterManager::HandlePress` resolve the slot and call a new slot method:

```cpp
void BankSlot::HandlePress(PhysicalEncoderId encoderId, Modifier modifier, const SceneState& scene);
```

Rules:
- `Modifier::None`: existing open/close modulation behavior.
- `Modifier::Reset`, `Random`, `RandomMod`: call `ParameterManager::ApplyModifierToParameter` on the visible cell parameter and do not open/close modulation.
- `HandleTick`: unchanged except message bus suppresses tick when modifier is not none.

- [x] **Step 6: Implement modified bank selection**

Update `ParameterManager::SelectBankForSlot`:

```cpp
bool ParameterManager::SelectBankForSlot(std::size_t slotIx, std::size_t bankIx) {
    BankSlot* slot = BankSlotAt(slotIx);
    Bank* bank = BankAt(bankIx);
    if (slot == nullptr || bank == nullptr) {
        return false;
    }
    const Modifier modifier = GetCurrentModifier();
    if (modifier != Modifier::None) {
        ApplyModifierToBank(*bank, modifier);
        return true;
    }
    slot->SelectBank(bank);
    return true;
}
```

Implement `Bank::ApplyModifierToTopLevel` or a manager-side loop over a new `Bank::TopLevelParameters()` accessor. Do not iterate visible modulation cells for bulk bank actions; use top-level mappings only.

- [x] **Step 7: Update `MessageInBus::Apply`**

Rules:
- `ParamIncDec`: only call `HandleTick` when `GetCurrentModifier() == Modifier::None`.
- `ParamPush`: always call `manager_->HandlePress(slotIx, position)`; that method reads `GetCurrentModifier()`.
- Reset/random/random-mod messages set or toggle the corresponding held state.
- `SelectParamBank`: uses updated `SelectBankForSlot`.

- [x] **Step 8: Run focused tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: all pass.

### Task 3: MIDI Serialization, Feedback, WRLD.Bldr, Miniapp, And Helper Rename

**Files:**
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/apps/miniapp/MiniApp.hpp`
- Modify: `projects/synth/tests/support/SynthRig.hpp`
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify call sites from compile errors in `projects/synth/tests/*.cpp`

- [x] **Step 1: Write profile and output-info tests**

Update/add tests near MIDI profile tests:

```cpp
TEST_CASE(system_message_output_info_reports_modifier_colors_and_on_state) {
    synth::ParameterManager manager;
    auto ui = manager.CreateUIState();
    synth::SystemMessageOutputInfo info(ui.get());

    ui->resetHeld.store(true);
    REQUIRE_TRUE(info.Evaluate(synth::MessageIn::ToggleReset(0)).isOn);
    ui->resetHeld.store(false);
    REQUIRE_TRUE(!info.Evaluate(synth::MessageIn::ToggleReset(0)).isOn);

    ui->randomHeld.store(true);
    REQUIRE_TRUE(info.Evaluate(synth::MessageIn::ToggleRandom(0)).isOn);
    ui->randomHeld.store(false);
    REQUIRE_TRUE(!info.Evaluate(synth::MessageIn::ToggleRandom(0)).isOn);

    ui->randomModHeld.store(true);
    REQUIRE_TRUE(info.Evaluate(synth::MessageIn::ToggleRandomMod(0)).isOn);
}

TEST_CASE(midi_profile_config_json_migrates_legacy_shift_actions_to_reset) {
    synth::JsonArena arena;
    synth::MidiControllerProfileConfig profile = synth::WrldBldrDefaultProfileConfig({});
    synth::JSON root = synth::ToJSON(arena, profile);
    char* dumped = root.Dumps(JSON_ENCODE_ANY);
    REQUIRE_TRUE(dumped != nullptr);
    std::string text(dumped);
    std::free(dumped);

    std::size_t pos = text.find("toggleReset");
    REQUIRE_TRUE(pos != std::string::npos);
    text.replace(pos, std::string("toggleReset").size(), "toggleShift");

    synth::JsonArena parseArena(262144);
    synth::JSON parsed = parseArena.Loads(text.c_str());
    while (parsed.IsNull() && parseArena.Failed()) {
        parseArena.GrowAndReset();
        parsed = parseArena.Loads(text.c_str());
    }

    synth::MidiControllerProfileConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(parsed, loaded));
    REQUIRE_TRUE(!loaded.systemMessages.empty());
    REQUIRE_TRUE(loaded.systemMessages.front().press.type == synth::MessageIn::Type::ToggleReset);
    REQUIRE_TRUE(loaded.systemMessages.front().press.hasBoolValue);
    REQUIRE_TRUE(loaded.systemMessages.front().press.boolValue);
}

TEST_CASE(wrld_bldr_default_profile_maps_reset_random_and_random_mod_aux_buttons) {
    synth::MidiControllerProfileConfig profile = synth::WrldBldrDefaultProfileConfig({});
    auto hasMessageAt = [&](std::uint8_t x, std::uint8_t y, synth::MessageIn::Type type) {
        const std::uint8_t cc = synth::WrldBldrPositionToCC(x, y);
        return std::any_of(profile.systemMessages.begin(), profile.systemMessages.end(), [&](const auto& assoc) {
            return assoc.control.has_value() && assoc.control->channel == 5 && assoc.control->cc == cc &&
                   assoc.press.type == type && assoc.release.has_value() &&
                   assoc.release->type == type && assoc.release->boolValue == false;
        });
    };
    REQUIRE_TRUE(hasMessageAt(0, 4, synth::MessageIn::Type::ToggleReset));
    REQUIRE_TRUE(hasMessageAt(1, 4, synth::MessageIn::Type::ToggleRandom));
    REQUIRE_TRUE(hasMessageAt(2, 4, synth::MessageIn::Type::ToggleRandomMod));
}
```

- [x] **Step 2: Update MIDI message names and legacy parsing**

In `MessageTypeName`, emit:
- `toggleReset`
- `toggleRandom`
- `toggleRandomMod`

In `ParseMessageType`, accept:
- `toggleReset` and legacy `toggleShift` as `ToggleReset`
- `setReset` and legacy `setShift` as `ToggleReset` with `hasBoolValue` handled by existing bool payload parsing
- `toggleRandom`
- `toggleRandomMod`

If the parser only returns the enum, leave bool handling in the existing `FromJSON(MessageIn&)` path and only map the enum names here.

- [x] **Step 3: Update `SystemMessageOutputInfo::Evaluate`**

Add cases:

```cpp
case MessageIn::Type::ToggleReset: {
    const bool held = uiState_->resetHeld.load(std::memory_order_relaxed);
    return {.color = held ? Color::White : Color::Grey, .isOn = held};
}
case MessageIn::Type::ToggleRandom: {
    const bool held = uiState_->randomHeld.load(std::memory_order_relaxed);
    return {.color = held ? Color::White : Color::Grey, .isOn = held};
}
case MessageIn::Type::ToggleRandomMod: {
    const bool held = uiState_->randomModHeld.load(std::memory_order_relaxed);
    return {.color = held ? Color::White : Color::Grey, .isOn = held};
}
```

- [x] **Step 4: Update WRLD.Bldr default profile**

Change aux mapping comments and positions:

```cpp
addSystemPosition(0, 4, MessageIn::SetReset(0, true), MessageIn::SetReset(0, false));
addSystemPosition(1, 4, MessageIn::SetRandom(0, true), MessageIn::SetRandom(0, false));
addSystemPosition(2, 4, MessageIn::SetRandomMod(0, true), MessageIn::SetRandomMod(0, false));
```

Keep bank row mappings unchanged.

- [x] **Step 5: Update miniapp labels and UI-state reads**

In `MiniApp.hpp`, rename `shiftButton_` to `resetButton_`, label it `"Reset"`, read `uiState.resetHeld`, and add `randomButton_`/`randomModButton_` next to the reset control. Keep scene/start/stop layout usable by extending or rebalancing the existing button row rather than omitting the new controls.

- [x] **Step 6: Update SynthRig helpers**

In `SynthRig.hpp`, rename:

```cpp
void ShiftPress(std::size_t slotIx, std::size_t position)
```

to:

```cpp
void ResetPress(std::size_t slotIx, std::size_t position)
```

and implement via `SetReset(true)`, `Press`, `SetReset(false)`. Add `SetRandom` and `SetRandomMod` helpers mirroring `SetReset`.

- [x] **Step 7: Run focused MIDI/profile tests**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: all pass.

### Task 4: Randomized Simulation And Repository-Wide Rename Cleanup

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Modify: any compile-failing synth files surfaced by `rg`
- Modify: `projects/synth/README.md`, `projects/synth/apps/miniapp/README.md` if they still say shift for the active modifier
- Modify: `openspec/changes/rename-shift-reset-add-random-modifiers/tasks.md` only after reviewed completion

- [x] **Step 1: Extend simulation oracle state**

In `SimOracle`, replace `shiftHeld` with:

```cpp
bool resetHeld = false;
bool randomHeld = false;
bool randomModHeld = false;
```

Add:

```cpp
synth::Modifier SimCurrentModifier(const SimOracle& oracle) {
    if (oracle.randomModHeld) return synth::Modifier::RandomMod;
    if (oracle.randomHeld) return synth::Modifier::Random;
    if (oracle.resetHeld) return synth::Modifier::Reset;
    return synth::Modifier::None;
}
```

- [x] **Step 2: Add oracle random helpers**

Add helpers beside `SimHandleShiftPress` replacement:

```cpp
void SimRandomizeValue(SimOracle& oracle, SimParam& parameter, float value);
void SimRandomMod(SimOracle& oracle, SimParam& parameter, std::mt19937& rng,
                  std::vector<std::string>* samples);
void SimHandleModifierPress(SimOracle& oracle, synth::PhysicalEncoderId encoder,
                            std::mt19937& rng, std::vector<std::string>* samples);
```

Mirror production sample order:
1. random value uses one `unipolarDist(rng)` sample.
2. random-mod samples coin first.
3. each successful coin samples slot index with replacement.
4. then samples the value for the chosen depth parameter.
5. stop on first coin `>= 0.5` or failed materialization.

- [x] **Step 3: Update randomized action loops**

Replace shift action cases with reset/random/random-mod press/release and modified bank actions in both `randomized_parameter_modulation_simulation` and `randomized_message_bus_ui_state_simulation`. Ensure failure action strings include consumed samples:

```cpp
action = "random-mod press position " + std::to_string(position) + " samples=" + JoinSamples(samples);
```

For message-bus modified bank actions, push `SetReset/SetRandom/SetRandomMod(true)`, `SelectParamBank`, then the matching `false` message at nondecreasing timestamps.

- [x] **Step 4: Update UI-state checks**

In `SimCheckUIState`, assert:

```cpp
REQUIRE_TRUE(ui.resetHeld.load(std::memory_order_relaxed) == oracle.resetHeld);
REQUIRE_TRUE(ui.randomHeld.load(std::memory_order_relaxed) == oracle.randomHeld);
REQUIRE_TRUE(ui.randomModHeld.load(std::memory_order_relaxed) == oracle.randomModHeld);
```

- [x] **Step 5: Repository rename scan**

Run:

```bash
rg -n "Shift|shift|SetShift|ToggleShift|HandleShiftPress|ShiftHeld|shiftHeld" projects/synth openspec/changes/rename-shift-reset-add-random-modifiers
```

Expected remaining matches only:
- legacy migration strings such as `setShift`/`toggleShift`
- OpenSpec historical context or exact source header note
- documentation lines explicitly describing migration from shift to reset

Update code/docs for every other match.

- [x] **Step 6: Run simulations**

Run:

```bash
make -C projects/synth build/parameter_modulation_tests
projects/synth/build/parameter_modulation_tests
```

Expected: both pass with default seeds.

### Task 5: Full Verification, OpenSpec Sync, And Review Readiness

**Files:**
- Modify: `openspec/changes/rename-shift-reset-add-random-modifiers/tasks.md`
- Read/verify: all changed files

- [x] **Step 1: Run full synth tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth test binaries pass.

- [x] **Step 2: Run OpenSpec status**

Run:

```bash
openspec status --change "rename-shift-reset-add-random-modifiers"
```

Expected: planning artifacts complete; implementation tasks may still show unchecked until this task updates them.

- [x] **Step 3: Mark OpenSpec tasks complete**

After Tasks 1-4 pass their spec compliance and code quality reviews, update `openspec/changes/rename-shift-reset-add-random-modifiers/tasks.md` checkboxes from `[ ]` to `[x]` for each implemented item. Do not mark verification items complete until Step 1 and Step 2 pass.

- [x] **Step 4: Final rename audit**

Run:

```bash
rg -n "Shift|shift|SetShift|ToggleShift|HandleShiftPress|ShiftHeld|shiftHeld" projects/synth openspec/changes/rename-shift-reset-add-random-modifiers
```

Record the remaining intentional compatibility/documentation hits in the task completion note or final response.

- [x] **Step 5: Final code review gates**

Dispatch:
- Claude spec compliance review against the OpenSpec change and changed code.
- Claude code quality review against the diff.

Fix all Critical/Important findings and rerun the relevant tests before declaring completion.

## Spec Coverage Checklist

- `spm-63`: Tasks 1 and 2 implement held state, precedence, deterministic random source, random, and random-mod semantics.
- `spm-4`, `spm-13`, `spm-15`, `spm-24`, `spm-38`, `spm-48`, `spm-54`: Tasks 1, 2, and 4 cover routing, reset, allocation, safe no-ops, and full reset.
- `spm-18`, `spm-25`: Task 4 updates randomized direct and message-bus simulations.
- `spm-21`, `spm-26`: Tasks 1, 3, and 4 update UI state and miniapp/helper usage.
- `spm-22`, `spm-41`, `spm-42`, `spm-43`, `spm-45`, `spm-52`, `spm-58`, `spm-61`: Task 3 covers message factories, serialization, feedback, WRLD.Bldr/Launchpad/Twister behavior, and legacy shift migration.
