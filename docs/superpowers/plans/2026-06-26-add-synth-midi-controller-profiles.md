# Add Synth MIDI Controller Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement analog MIDI input, system-button MIDI input/output, bank/gesture system feedback state, and the default WRLD.Bldr MIDI controller profile for the synth miniapp.

**Architecture:** Extend the existing JUCE-free synth MIDI layer in `MidiController.hpp/.cpp` and the manager/UI-state model in `ParameterModulation.hpp/.cpp`. Keep JUCE device ownership in `projects/synth/juce/MidiHandlers.hpp` and make the miniapp consume a profile-created input chain plus independent output processors.

**Tech Stack:** C++20, custom synth test harness in `projects/synth/tests/parameter_modulation_tests.cpp`, Makefile builds, JUCE miniapp, xagent + Claude Opus reviews.

---

## Source Of Truth

- OpenSpec change: `openspec/changes/add-synth-midi-controller-profiles/`
- Delta spec: `openspec/changes/add-synth-midi-controller-profiles/specs/synth-parameter-modulation/spec.md`
- Design: `openspec/changes/add-synth-midi-controller-profiles/design.md`
- Tasks: `openspec/changes/add-synth-midi-controller-profiles/tasks.md`
- Accepted xagent review: `xrun_20260626224306578_54480c71` (`ACCEPTED_WITH_NONBLOCKING_NOTES`)

Baseline already passed:

```bash
make -C projects/synth test
```

Expected after implementation: all existing and added tests pass.

## Files

- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
  - Add `Bank` color API.
  - Add manager bank UI-state and gesture-bank-affecting UI-state storage.
  - Add `MessageIn::Type::SetGestureSelect` and factory.
- Modify: `projects/synth/src/ParameterModulation.cpp`
  - Implement safe message no-ops, explicit gesture select, bank UI-state population, and gesture-bank-affecting population.
- Modify: `projects/synth/include/synth/MidiController.hpp`
  - Add analog/system-button input configs and processors.
  - Add system output info and output processors.
  - Add MIDI controller profile config/result/factory types.
- Modify: `projects/synth/src/MidiController.cpp`
  - Implement new processors, output info, output processors, and default WRLD.Bldr profile.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
  - Add tests for every new requirement and processor.
- Modify: `projects/synth/miniapp/Main.cpp`
  - Replace direct MIDI processor construction with the default WRLD.Bldr profile.
- Maybe modify: `projects/synth/miniapp/Makefile`
  - Only if dependency tracking needs additional headers.
- Modify: `openspec/changes/add-synth-midi-controller-profiles/tasks.md`
  - Mark OpenSpec tasks complete only after the corresponding implementation, tests, and xagent reviews pass.

## Review Protocol

After each task below:

1. Run the task-specific test command and `make -C projects/synth test`.
2. Run xagent Claude Opus spec-compliance review:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<prompt>"
```

The prompt must name the task, changed files, relevant OpenSpec requirements, and ask for findings first plus `APPROVED` or `CHANGES_REQUESTED`.

3. If spec review approves, run a second xagent Claude Opus code-quality review with the same changed files and test output.
4. Fix and re-review until both pass.

## Task 1: Message Safety, Explicit Gesture Select, Bank UI State

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Update: `openspec/changes/add-synth-midi-controller-profiles/tasks.md` items 1.1-1.8 after review

- [x] **Step 1: Add failing message-safety tests**

Add tests near `message_bus_routes_external_messages_and_timestamps`:

```cpp
TEST_CASE(message_bus_ignores_out_of_bounds_targets) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 2});
    auto& parameter = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    manager.SetSceneEndpoints(0, 1);
    manager.SetSceneBlend(0.25f);
    manager.SetGestureValue(0, 0.5f);

    synth::MessageInBus bus(&manager, 16);
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SelectParamBank(0, 0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 99, 1.0f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(0, 99, 0, 0.5f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(0, 0, 99, 0.5f)));
    bus.Process(0);

    REQUIRE_TRUE(slot.SelectedBank() == &bank);
    REQUIRE_TRUE(!manager.GestureSelected(0));
    REQUIRE_NEAR(manager.GestureValue(0), 0.5f, 0.0001f);
    REQUIRE_TRUE(manager.Scene().leftScene == 0);
    REQUIRE_TRUE(manager.Scene().rightScene == 1);
    REQUIRE_NEAR(manager.Scene().blend, 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
}

TEST_CASE(message_bus_set_shift_and_set_gesture_select_are_idempotent) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    (void)manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    synth::MessageInBus bus(&manager, 8);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(0, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(0, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, false)));
    bus.Process(0);

    REQUIRE_TRUE(manager.ShiftHeld());
    REQUIRE_TRUE(!manager.GestureSelected(1));
}
```

- [x] **Step 2: Run failing tests**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure for missing `SetGestureSelect` and/or failing invalid-index behavior.

- [x] **Step 3: Implement message and safe no-op support**

In `ParameterModulation.hpp`, extend `MessageIn::Type`:

```cpp
enum class Type {
    ParamIncDec,
    ParamPush,
    ToggleShift,
    ToggleGestureSelect,
    SetGestureSelect,
    SelectParamBank,
    Start,
    Stop,
    Clock,
    SetGestureValue,
    SceneSelect,
    SetSceneBlend,
};
```

Add factory:

```cpp
static MessageIn SetGestureSelect(std::uint64_t timestamp, std::size_t gestureIx, bool selected);
```

In `ParameterModulation.cpp`, implement:

```cpp
MessageIn MessageIn::SetGestureSelect(std::uint64_t timestamp, std::size_t gestureIx, bool selected) {
    MessageIn message = ToggleGestureSelect(timestamp, gestureIx);
    message.type = Type::SetGestureSelect;
    message.boolValue = selected;
    message.hasBoolValue = true;
    return message;
}
```

Update `MessageInBus::Apply` so invalid targets are no-ops. Use manager APIs that already return or throw safely where possible, and add explicit bounds before gesture calls:

```cpp
case MessageIn::Type::SetGestureSelect:
    if (message.gestureIx < manager_->GestureCount()) {
        if (message.boolValue) manager_->SelectGesture(message.gestureIx);
        else manager_->DeselectGesture(message.gestureIx);
    }
    break;
case MessageIn::Type::ToggleGestureSelect:
    if (message.gestureIx < manager_->GestureCount()) manager_->ToggleGestureSelected(message.gestureIx);
    break;
case MessageIn::Type::SetGestureValue:
    if (message.gestureIx < manager_->GestureCount()) manager_->SetGestureValue(message.gestureIx, message.value);
    break;
```

Make sure `ParamIncDec`, `ParamPush`, `SelectParamBank`, and `SceneSelect` cannot throw or mutate on invalid indices.

- [x] **Step 4: Add bank and gesture-affecting UI state tests**

Add tests:

```cpp
TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 4});
    auto& affected = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
    auto& unaffected = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.5f});
    affected.SetGestureActive(0, 0, true);

    auto& bankA = manager.CreateBank();
    bankA.SetColor(synth::Color::Green);
    bankA.AddMapping(10, affected);
    auto& bankB = manager.CreateBank();
    bankB.SetColor(synth::Color::Blue);
    bankB.AddMapping(11, unaffected);

    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bankA);

    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    REQUIRE_TRUE(ui->bankCapacity == 2);
    REQUIRE_TRUE(ui->banks[0].connected.load());
    REQUIRE_TRUE(ui->banks[0].selected.load());
    REQUIRE_TRUE(ui->banks[0].color.Load() == synth::Color::Green);
    REQUIRE_TRUE(ui->banks[1].connected.load());
    REQUIRE_TRUE(!ui->banks[1].selected.load());
    REQUIRE_TRUE(ui->banks[1].color.Load() == synth::Color::Blue);
    REQUIRE_TRUE(ui->gestures.bankAffectingCount[0].load() == 1);
    REQUIRE_TRUE(ui->gestures.bankAffectingCount[1].load() == 0);
}
```

- [x] **Step 5: Implement bank/UI-state additions**

Add a nested `ParameterManager::BankUIState` with `connected`, `selected`, and `AtomicColor color`. Add to `ParameterManager::UIState`:

```cpp
std::size_t bankCapacity = 0;
std::unique_ptr<BankUIState[]> banks;
```

Extend `GestureManagerUIState` with compact first-32 bank affectation:

```cpp
std::unique_ptr<std::atomic<std::uint32_t>[]> bankAffectingMask;
std::unique_ptr<std::atomic<std::size_t>[]> bankAffectingCount;
```

Add `Bank::SetColor(Color)` and `Bank::GetColor() const`. During `CreateUIState`, size banks from `banks_.size()` and gesture arrays from `GestureCount()`. During `PopulateUIState`, clear bank entries, mark existing banks connected and colored, mark selected if any slot selects that bank, and compute gesture-bank masks from each bank's visible parameters and active-scene gesture masks.

- [x] **Step 6: Run tests and review**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass.

Run xagent Opus spec and code reviews for Task 1. Mark OpenSpec tasks 1.1-1.8 complete only after both reviews approve.

## Task 2: Analog And System Button MIDI Input

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Update: OpenSpec tasks 2.1-2.4 after review

- [x] **Step 1: Write failing input processor tests**

Add tests after encoder input tests:

```cpp
TEST_CASE(midi_analog_input_maps_gestures_scene_blend_and_thru) {
    synth::MessageInBus bus(nullptr, 16);
    synth::AnalogMidiInConfig config;
    config.gestures.push_back({.control = {.channel = 2, .cc = 3}, .gestureIx = 3});
    config.sceneBlend = synth::MidiControlAddress{.channel = 2, .cc = 0};
    synth::AnalogMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 77; });

    processor.Process(synth::BasicMidi::CC(999, 2, 3, 64));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 77));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.timestamp == 77);
    REQUIRE_TRUE(message.gestureIx == 3);
    REQUIRE_NEAR(message.value, 64.0f / 127.0f, 0.0001f);

    processor.Process(synth::BasicMidi::CC(999, 2, 0, 127));
    REQUIRE_TRUE(bus.Pop(message, 77));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetSceneBlend);
    REQUIRE_NEAR(message.value, 1.0f, 0.0001f);

    FakeMidiInProcessor thru;
    processor.SetThru(&thru);
    processor.Process(synth::BasicMidi::CC(1, 9, 9, 99));
    REQUIRE_TRUE(thru.seen == 1);
}

TEST_CASE(midi_system_button_input_maps_press_release_and_thru) {
    synth::MessageInBus bus(nullptr, 16);
    synth::SystemButtonMidiInConfig config;
    config.associations.push_back({
        .control = {.channel = 5, .cc = 32},
        .press = synth::MessageIn::SetShift(0, true),
        .release = synth::MessageIn::SetShift(0, false),
    });
    config.associations.push_back({
        .control = {.channel = 5, .cc = 0},
        .press = synth::MessageIn::SetGestureSelect(0, 0, true),
        .release = synth::MessageIn::SetGestureSelect(0, 0, false),
    });
    synth::SystemButtonMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 88; });

    processor.Process(synth::BasicMidi::CC(1, 5, 32, 127));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue && message.boolValue);

    processor.Process(synth::BasicMidi::CC(1, 5, 32, 0));
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.hasBoolValue && !message.boolValue);

    processor.Process(synth::BasicMidi::CC(1, 5, 0, 0));
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.hasBoolValue && !message.boolValue);
}
```

- [x] **Step 2: Run failing tests**

Run `make -C projects/synth test`.

- [x] **Step 3: Implement configs and processors**

Add in `MidiController.hpp`:

```cpp
struct AnalogMidiMapping { MidiControlAddress control; std::size_t gestureIx = 0; };
struct AnalogMidiInConfig {
    std::vector<AnalogMidiMapping> gestures;
    std::optional<MidiControlAddress> sceneBlend;
};
class AnalogMidiInProcessor final : public MidiInProcessor { ... };

struct SystemButtonMidiAssociation {
    MidiControlAddress control;
    MessageIn press;
    std::optional<MessageIn> release;
};
struct SystemButtonMidiInConfig { std::vector<SystemButtonMidiAssociation> associations; };
class SystemButtonMidiInProcessor final : public MidiInProcessor { ... };
```

Implement lookup by `MidiControlAddress`. Normalize CC value as `static_cast<float>(value) / 127.0f`. Stamp copied messages with `NextTimestamp()` before pushing.

- [x] **Step 4: Run tests and review**

Run `make -C projects/synth test`, then xagent Opus spec/code reviews for Task 2. Mark OpenSpec tasks 2.1-2.4 complete after approval.

## Task 3: System Output Info And Processors

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Update: OpenSpec tasks 3.1-3.5 after review

- [x] **Step 1: Add failing output-info tests**

Add tests that set up two banks, two scenes, shift, and gestures. Assert:

```cpp
synth::SystemMessageOutputInfo info(ui.get());
auto bank = info.Evaluate(synth::MessageIn::SelectParamBank(0, 0, 0));
REQUIRE_TRUE(bank.color == synth::Color::Green);
REQUIRE_TRUE(bank.isOn);
auto missing = info.Evaluate(synth::MessageIn::SelectParamBank(0, 0, 99));
REQUIRE_TRUE(missing.color == synth::Color::Off);
REQUIRE_TRUE(!missing.isOn);
```

Also assert scene colors:

```cpp
manager.SetSceneEndpoints(0, 1);
manager.SetSceneBlend(0.25f);
manager.PopulateUIState(*ui);
REQUIRE_TRUE(info.Evaluate(synth::MessageIn::SceneSelect(0, 0)).color == synth::Color::Orange.AdjustBrightness(0.875f));
REQUIRE_TRUE(info.Evaluate(synth::MessageIn::SceneSelect(0, 1)).color == synth::Color::Green.AdjustBrightness(0.625f));
```

- [x] **Step 2: Add failing output processor tests**

Add tests with `FakeMidiSink`/`MidiSender`:

```cpp
synth::SystemCcMidiOutConfig ccConfig;
ccConfig.associations.push_back({.control = {.channel = 5, .cc = 32}, .message = synth::MessageIn::SetShift(0, true)});
synth::SystemCcMidiOutProcessor ccProcessor(ccConfig, &sender, ui.get());
ccProcessor.Process();
REQUIRE_TRUE(sink.sent.back().Channel() == 5);
REQUIRE_TRUE(sink.sent.back().GetCC() == 32);
REQUIRE_TRUE(sink.sent.back().GetValue() == 127);
```

Add WRLD.Bldr position color test for channel 5, x 0, y 4 expecting `WrldBldrColorSysex(0, 5, 32, color)` bytes.

- [x] **Step 3: Implement output info and processors**

Add:

```cpp
struct SystemMessageOutputState { Color color = Color::Off; bool isOn = false; };
class SystemMessageOutputInfo { public: SystemMessageOutputState Evaluate(const MessageIn& message) const; };
struct SystemCcMidiOutAssociation { MidiControlAddress control; MessageIn message; };
class SystemCcMidiOutProcessor final : public MidiOutProcessorBaseOrStandalone { ... };
struct WrldBldrPosition { std::uint8_t channel = 5; std::uint8_t x = 0; std::uint8_t y = 0; };
struct WrldBldrSystemMidiOutAssociation { WrldBldrPosition position; MessageIn message; };
class WrldBldrSystemMidiOutProcessor final { ... };
```

Use existing `MidiSender`, `BasicMidi::CC`, `Color::AdjustBrightness`, and `WrldBldrColorSysex`. Debounce by cached `color`, `isOn`, and validity per association. `Reset()` clears caches.

- [x] **Step 4: Run tests and review**

Run `make -C projects/synth test`, then xagent Opus spec/code reviews for Task 3. Mark OpenSpec tasks 3.1-3.5 complete after approval.

## Task 4: Controller Profile Factory And Default WRLD.Bldr Profile

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Update: OpenSpec tasks 4.1-5.5 after review

- [x] **Step 1: Add failing profile tests**

Add tests:

```cpp
TEST_CASE(midi_profile_builds_wrld_bldr_input_chain_and_outputs) {
    synth::MessageInBus bus(nullptr, 64);
    synth::MidiSender sender;
    FakeMidiSink sink;
    sender.SetSink(&sink);
    synth::ParameterManager::UIState ui;
    auto profile = synth::MidiControllerProfile::WrldBldrDefault({
        .slotIx = 0,
        .visibleEncoderCount = 3,
        .gestureCount = 1,
        .sceneCount = 3,
        .bankButtonCount = 16,
        .bus = &bus,
        .uiState = &ui,
        .sender = &sender,
        .timestampProvider = [] { return 0; },
    });
    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(!profile.outputs.empty());

    profile.input->Process(synth::BasicMidi::CC(0, 0, 2, 65));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.position == 2);

    profile.input->Process(synth::BasicMidi::CC(0, 5, 32, 127));
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue && message.boolValue);
}
```

Add assertions for logical analog index 0 scene blend, logical 1 gesture 0, scene row 6, and bank row 2/3 positions.

- [x] **Step 2: Implement profile types**

Use move-only result:

```cpp
struct MidiControllerProfileBindings {
    MessageInBus* bus = nullptr;
    ParameterManager::UIState* uiState = nullptr;
    MidiSender* sender = nullptr;
    MidiInProcessor::TimestampProvider timestampProvider;
};

struct WrldBldrProfileOptions {
    std::size_t slotIx = 0;
    std::size_t visibleEncoderCount = 16;
    std::size_t gestureCount = 16;
    std::size_t sceneCount = 8;
};

struct MidiControllerProfileResult {
    std::unique_ptr<MidiInProcessor> input;
    std::vector<std::unique_ptr<MidiOutProcessorLike>> outputs;
};
```

If a common output base is needed, add a small abstract base:

```cpp
class MidiOutProcessorBase {
public:
    virtual ~MidiOutProcessorBase() = default;
    virtual void Reset() = 0;
    virtual void Process() = 0;
};
```

Have existing encoder output processors inherit from it.

- [x] **Step 3: Implement WRLD.Bldr defaults**

Rules:

- Encoder input/output: existing `WrldBldrDefault(slotIx)`, trimmed by visible encoder count.
- Analog: channel 2 CC `N` -> logical `N`; channel 14 CC `N` -> logical `N + 2`; logical 0 scene blend; logical 1..16 gesture 0..15. Preserve the sibling repo overlap intentionally and note it in a short comment.
- System:
  - shift aux `(0,4)` -> channel 5 CC 32 -> `SetShift(true/false)`.
  - scenes aux row 6 -> channel 5 CC `48..55` -> `SceneSelect(0..7)`.
  - gestures aux row 0/1 -> channel 5 CC `0..15` -> `SetGestureSelect(g,true/false)`, trimmed by requested gesture count.
  - banks: voice row 3 x 0..3 -> bank 0..3; quad/global row 2 x 0..6 -> bank 4..10.
  - no aux focus `(0,5)`.

- [x] **Step 4: Run tests and review**

Run `make -C projects/synth test`, then xagent Opus spec/code reviews for Task 4. Mark OpenSpec tasks 4.1-5.5 complete after approval.

## Task 5: Miniapp Profile Integration

**Files:**
- Modify: `projects/synth/miniapp/Main.cpp`
- Maybe modify: `projects/synth/miniapp/Makefile`
- Test: `projects/synth/miniapp/DemoModulationTests.cpp` only if a compile-time helper is added
- Update: OpenSpec tasks 6.1-6.5 after review

- [x] **Step 1: Replace miniapp processor fields**

Replace:

```cpp
std::unique_ptr<synth::MidiOutProcessor> midiOutProcessor_;
```

with profile result storage:

```cpp
synth::MidiControllerProfileResult midiProfile_;
```

- [x] **Step 2: Use WRLD.Bldr default profile**

In `rebuildMidiProcessors()`, remove Twister/WRLD.Bldr branch logic and create the default WRLD.Bldr profile:

```cpp
midiProfile_ = synth::CreateWrldBldrDefaultProfile({
    .bindings = {
        .bus = &midiBus_,
        .uiState = uiState_.get(),
        .sender = &midiSender_,
        .timestampProvider = [] { return 0; },
    },
    .slotIx = 0,
    .visibleEncoderCount = encoders_.size(),
    .gestureCount = 1,
    .sceneCount = 3,
});
midiInHandler_.SetProcessor(std::move(midiProfile_.input));
```

Keep the preset UI if useful, but WRLD.Bldr should be the active/default behavior for this change. If the Twister selector becomes misleading, remove or disable it.

- [x] **Step 3: Invoke all outputs**

Replace:

```cpp
if (midiOutputHandler_.IsOpen() && midiOutProcessor_ != nullptr) {
    midiOutProcessor_->Process();
}
```

with:

```cpp
if (midiOutputHandler_.IsOpen()) {
    for (auto& output : midiProfile_.outputs) {
        output->Process();
    }
}
```

On output open, reset every output processor.

- [x] **Step 4: Compile/test miniapp targets**

Run:

```bash
make -C projects/synth miniapp
make -C projects/synth/miniapp test
```

Expected: pass if `~/JUCE` is present; otherwise record the precise documented missing-JUCE result.

- [x] **Step 5: Run reviews**

Run `make -C projects/synth test`, then xagent Opus spec/code reviews for Task 5. Mark OpenSpec tasks 6.1-6.5 complete after approval.

## Task 6: Final Verification And OpenSpec Sync

**Files:**
- Modify: `openspec/changes/add-synth-midi-controller-profiles/tasks.md`
- Review: full diff

- [x] **Step 1: Run full verification**

Run:

```bash
make -C projects/synth test
make -C projects/synth miniapp
make -C projects/synth/miniapp test
openspec validate add-synth-midi-controller-profiles
```

Expected: synth tests pass; miniapp targets pass or have documented missing-JUCE result; OpenSpec validates.

- [x] **Step 2: Run final xagent reviews**

Spec compliance:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "Final spec compliance review for add-synth-midi-controller-profiles. Review the implementation diff, OpenSpec tasks, and verification output. Findings first. End APPROVED or CHANGES_REQUESTED."
```

Code quality:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "Final code quality review for add-synth-midi-controller-profiles. Review the implementation diff for correctness, maintainability, API boundaries, tests, and hidden regressions. Findings first. End APPROVED or CHANGES_REQUESTED."
```

- [x] **Step 3: Mark final OpenSpec verification tasks**

Only after all verification and final reviews pass, mark OpenSpec tasks 7.1-7.4 according to actual results. For 7.4, if no hardware is available, leave it unchecked or add a note in the final response; do not claim hardware smoke coverage.

- [x] **Step 4: Final status**

Run:

```bash
git status --short
openspec status --change "add-synth-midi-controller-profiles"
```

Report changed files, verification commands, and any remaining unchecked hardware/manual tasks.
