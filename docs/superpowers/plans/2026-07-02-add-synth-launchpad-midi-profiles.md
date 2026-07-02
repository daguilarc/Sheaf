# Add Synth Launchpad MIDI Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement JUCE-free Launchpad X, Launchpad Pro MK3, and Launchpad Mini MK3 MIDI profile support for synth system-message input and RGB SysEx output.

**Architecture:** Extend the existing synth MIDI profile layer instead of adding a Launchpad-only input path. Launchpad positions become another address form on `MidiControllerSystemMessageAssociation`; `SystemButtonMidiInProcessor` remains the generic system-message input processor and learns to match Launchpad notes/CCs. Launchpad-specific code is limited to coordinate helpers, RGB SysEx output, profile defaults, and JSON persistence.

**Tech Stack:** C++20, existing `projects/synth` Makefile test harness, OpenSpec change `add-synth-launchpad-midi-profiles`, sibling mapping reference `/Users/joyo/theallelectricsmartgrid/private/src/LaunchPadMidi.hpp`.

---

## Source Of Truth

- OpenSpec proposal: `openspec/changes/add-synth-launchpad-midi-profiles/proposal.md`
- OpenSpec design: `openspec/changes/add-synth-launchpad-midi-profiles/design.md`
- OpenSpec delta spec: `openspec/changes/add-synth-launchpad-midi-profiles/specs/synth-parameter-modulation/spec.md`
- OpenSpec tasks: `openspec/changes/add-synth-launchpad-midi-profiles/tasks.md`

Baseline passed before implementation:

```bash
make -C projects/synth test
```

## Files

- Modify: `projects/synth/include/synth/MidiController.hpp`
  - Add Launchpad enum/position/config/output/default declarations.
  - Extend generic system-message association/input config declarations.
- Modify: `projects/synth/src/MidiController.cpp`
  - Implement mapping helpers, generic input matching, Launchpad SysEx output, profile factory grouping, JSON, and defaults.
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
  - Add focused unit tests near existing MIDI tests and JSON profile tests.
- Modify: `openspec/changes/add-synth-launchpad-midi-profiles/tasks.md`
  - Mark checkboxes only after implementation, tests, and review pass.

## Task 1: Launchpad Mapping Helpers

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add failing mapping tests**

Add a test near `midi_encoder_default_presets_map_row_major_and_trim`:

```cpp
TEST_CASE(launchpad_position_helpers_match_smart_grid_mapping) {
    using synth::LaunchpadController;
    REQUIRE_TRUE(synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadX, 0, 7));
    REQUIRE_TRUE(synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadX, 8, -1));
    REQUIRE_TRUE(!synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadX, -1, 0));
    REQUIRE_TRUE(synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadMiniMk3, 8, 0));
    REQUIRE_TRUE(!synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadMiniMk3, -1, 0));
    REQUIRE_TRUE(synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadProMk3, -1, 0));
    REQUIRE_TRUE(synth::LaunchpadShapeSupports(LaunchpadController::LaunchpadProMk3, 0, 9));

    auto note = synth::LaunchpadPositionToNote(LaunchpadController::LaunchpadX, 0, 7);
    REQUIRE_TRUE(note.has_value());
    REQUIRE_TRUE(*note == 11);
    note = synth::LaunchpadPositionToNote(LaunchpadController::LaunchpadX, 0, -1);
    REQUIRE_TRUE(note.has_value());
    REQUIRE_TRUE(*note == 91);
    note = synth::LaunchpadPositionToNote(LaunchpadController::LaunchpadX, -1, 0);
    REQUIRE_TRUE(!note.has_value());

    auto position = synth::LaunchpadNoteToPosition(LaunchpadController::LaunchpadX, 11);
    REQUIRE_TRUE(position.has_value());
    REQUIRE_TRUE(position->controller == LaunchpadController::LaunchpadX);
    REQUIRE_TRUE(position->x == 0);
    REQUIRE_TRUE(position->y == 7);
}
```

- [x] **Step 2: Run the focused failing test build**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure because `LaunchpadController`, `LaunchpadShapeSupports`, `LaunchpadPositionToNote`, and `LaunchpadNoteToPosition` do not exist.

- [x] **Step 3: Add public types and helper declarations**

In `MidiController.hpp`, before `WrldBldrSystemPosition`, add:

```cpp
enum class LaunchpadController {
    LaunchpadX,
    LaunchpadProMk3,
    LaunchpadMiniMk3,
};

struct LaunchpadGridPosition {
    LaunchpadController controller = LaunchpadController::LaunchpadX;
    int x = 0;
    int y = 0;

    bool operator==(const LaunchpadGridPosition& other) const = default;
};

bool LaunchpadShapeSupports(LaunchpadController controller, int x, int y);
std::optional<std::uint8_t> LaunchpadPositionToNote(LaunchpadController controller, int x, int y);
std::optional<LaunchpadGridPosition> LaunchpadNoteToPosition(LaunchpadController controller, std::uint8_t note);
std::optional<std::uint8_t> LaunchpadProductByte(LaunchpadController controller);
```

- [x] **Step 4: Implement Smart Grid-compatible mapping helpers**

In `MidiController.cpp`, near `WrldBldrPositionToCC`, implement the sibling `LPMidi` logic:

```cpp
bool LaunchpadShapeSupports(LaunchpadController controller, int x, int y) {
    if (controller == LaunchpadController::LaunchpadX ||
        controller == LaunchpadController::LaunchpadMiniMk3) {
        return x >= 0 && x < 9 && y >= -1 && y < 8;
    }
    if (controller == LaunchpadController::LaunchpadProMk3) {
        return x >= -1 && x < 9 && y >= -1 && y < 10;
    }
    return false;
}

std::optional<std::uint8_t> LaunchpadPositionToNote(LaunchpadController controller, int x, int y) {
    if (!LaunchpadShapeSupports(controller, x, y)) {
        return std::nullopt;
    }
    int physicalY = 8 - y - 1;
    if (physicalY == -1) {
        physicalY = 9;
    } else if (physicalY == -2) {
        physicalY = -1;
    }
    const int note = 11 + 10 * physicalY + x;
    if (note < 0 || note > 127) {
        return std::nullopt;
    }
    return static_cast<std::uint8_t>(note);
}

std::optional<LaunchpadGridPosition> LaunchpadNoteToPosition(LaunchpadController controller, std::uint8_t note) {
    int x = 0;
    int y = 0;
    if (note < 10) {
        x = static_cast<int>(note) - 1;
        y = 9;
    } else {
        y = (static_cast<int>(note) - 11) / 10;
        x = (static_cast<int>(note) - 11) % 10;
        if (y == 9) {
            y = -1;
        }
        if (x == 9) {
            x = -1;
            y += 1;
        }
        y = 7 - y;
    }
    if (!LaunchpadShapeSupports(controller, x, y)) {
        return std::nullopt;
    }
    return LaunchpadGridPosition{.controller = controller, .x = x, .y = y};
}

std::optional<std::uint8_t> LaunchpadProductByte(LaunchpadController controller) {
    switch (controller) {
    case LaunchpadController::LaunchpadX:
        return 0x0C;
    case LaunchpadController::LaunchpadMiniMk3:
        return 0x0D;
    case LaunchpadController::LaunchpadProMk3:
        return 0x0E;
    }
    return std::nullopt;
}
```

- [x] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass.

## Task 2: Generic System Input Launchpad Matching

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add failing input tests**

Add a test after `midi_system_button_input_maps_press_release_timestamps_and_thru`:

```cpp
TEST_CASE(midi_system_button_input_matches_launchpad_positions_generically) {
    synth::MessageInBus bus(nullptr, 16);
    synth::SystemButtonMidiInConfig config;
    config.associations.push_back({
        .launchpadPosition = synth::LaunchpadGridPosition{
            .controller = synth::LaunchpadController::LaunchpadX,
            .x = 0,
            .y = 7,
        },
        .press = synth::MessageIn::SceneSelect(0, 0),
    });
    config.associations.push_back({
        .launchpadPosition = synth::LaunchpadGridPosition{
            .controller = synth::LaunchpadController::LaunchpadProMk3,
            .x = 0,
            .y = 0,
        },
        .press = synth::MessageIn::SetGestureSelect(0, 0, true),
        .release = synth::MessageIn::SetGestureSelect(0, 0, false),
    });

    synth::SystemButtonMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 55; });
    CountingMidiInProcessor thru;
    processor.SetThru(&thru);

    processor.Process(synth::BasicMidi::Note(9, 0, 11, 127));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 55));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(message.sceneIx == 0);
    REQUIRE_TRUE(message.timestamp == 55);

    auto gestureNote = synth::LaunchpadPositionToNote(synth::LaunchpadController::LaunchpadProMk3, 0, 0);
    REQUIRE_TRUE(gestureNote.has_value());
    processor.Process(synth::BasicMidi::Note(9, 0, *gestureNote, 0));
    REQUIRE_TRUE(bus.Pop(message, 55));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(!message.boolValue);

    processor.Process(synth::BasicMidi::CC(9, 0, *gestureNote, 127));
    REQUIRE_TRUE(bus.Pop(message, 55));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.boolValue);

    processor.Process(synth::BasicMidi::Note(9, 0, 12, 127));
    REQUIRE_TRUE(!bus.Pop(message, 55));
    REQUIRE_TRUE(thru.count == 1);
}
```

- [x] **Step 2: Run the failing tests**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure because `SystemButtonMidiAssociation` has no `launchpadPosition`.

- [x] **Step 3: Extend the generic association type**

In `MidiController.hpp`, change `SystemButtonMidiAssociation` to:

```cpp
struct SystemButtonMidiAssociation {
    std::optional<MidiControlAddress> control;
    std::optional<LaunchpadGridPosition> launchpadPosition;
    MessageIn press;
    std::optional<MessageIn> release;
};
```

Update existing call sites that initialize `.control = {...}` to wrap automatically via optional aggregate initialization. If aggregate initialization becomes noisy, use `.control = MidiControlAddress{...}`.

- [x] **Step 4: Implement generic matching**

In `SystemButtonMidiInProcessor`, replace `FindAssociation(const BasicMidi&)` with logic that checks:

```cpp
if (association.control.has_value() && midi.IsCC()) {
    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    if (*association.control == address) return &association;
}
if (association.launchpadPosition.has_value() &&
    (midi.Status() == BasicMidi::kStatusNote ||
     midi.Status() == BasicMidi::kStatusNoteOff ||
     midi.Status() == BasicMidi::kStatusCC)) {
    const auto position = LaunchpadNoteToPosition(association.launchpadPosition->controller,
                                                  midi.Status() == BasicMidi::kStatusCC ? midi.GetCC() : midi.GetNote());
    if (position.has_value() && *position == *association.launchpadPosition) {
        return &association;
    }
}
```

Keep existing press/release behavior, but treat Note Off as release even when velocity storage is zero. For supported-but-unmapped notes/CCs, pass to thru exactly once.

- [x] **Step 5: Update existing tests and config construction**

Update existing `SystemButtonMidiAssociation` construction in tests and `CreateMidiControllerProfile` to use optional `control`. Existing WRLD.Bldr behavior must not change.

- [x] **Step 6: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass.

## Task 3: Launchpad RGB Output

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [ ] **Step 1: Add failing SysEx/output tests**

Add tests near `system_output_processors_debounce_reset_and_render_cc_and_wrld_bldr`:

```cpp
TEST_CASE(launchpad_color_sysex_uses_controller_product_and_rgb_note) {
    auto midi = synth::LaunchpadColorSysex(7, synth::LaunchpadController::LaunchpadX, 0, 7, synth::Color::White);
    REQUIRE_TRUE(midi.IsSysEx());
    REQUIRE_TRUE(midi.timestamp == 7);
    REQUIRE_TRUE(midi.raw[0] == 0xF0);
    REQUIRE_TRUE(midi.raw[1] == 0x00);
    REQUIRE_TRUE(midi.raw[2] == 0x20);
    REQUIRE_TRUE(midi.raw[3] == 0x29);
    REQUIRE_TRUE(midi.raw[4] == 0x02);
    REQUIRE_TRUE(midi.raw[5] == 0x0C);
    REQUIRE_TRUE(midi.raw[6] == 0x03);
    REQUIRE_TRUE(midi.raw[7] == 0x03);
    REQUIRE_TRUE(midi.raw[8] == 11);
    REQUIRE_TRUE(midi.raw[9] == 127);
    REQUIRE_TRUE(midi.raw[10] == 127);
    REQUIRE_TRUE(midi.raw[11] == 127);

    midi = synth::LaunchpadColorSysex(7, synth::LaunchpadController::LaunchpadMiniMk3, 0, 7, synth::Color::Orange);
    REQUIRE_TRUE(midi.raw[5] == 0x0D);
    REQUIRE_TRUE(midi.raw[9] == synth::Color::Orange.r / 2);
    REQUIRE_TRUE(midi.raw[10] == synth::Color::Orange.g / 2);
    REQUIRE_TRUE(midi.raw[11] == synth::Color::Orange.b / 2);

    midi = synth::LaunchpadColorSysex(7, synth::LaunchpadController::LaunchpadProMk3, -1, 0, synth::Color::Green);
    REQUIRE_TRUE(midi.raw[5] == 0x0E);
}

TEST_CASE(launchpad_output_processor_debounces_reset_and_uses_system_info) {
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 0, 0);
    ui.shiftHeld.store(true);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();

    synth::LaunchpadGridMidiOutConfig config;
    config.associations.push_back({
        .position = {.controller = synth::LaunchpadController::LaunchpadX, .x = 0, .y = 7},
        .message = synth::MessageIn::ToggleShift(0),
    });
    synth::LaunchpadGridMidiOutProcessor processor(config, &sender, &ui);
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 1);
    REQUIRE_TRUE(sink.sent[0].raw[5] == 0x0C);
    REQUIRE_TRUE(sink.sent[0].raw[9] == 127);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 1);

    ui.shiftHeld.store(false);
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 2);
    REQUIRE_TRUE(sink.sent[1].raw[9] == synth::Color::Grey.r / 2);

    processor.Reset();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 3);
}
```

- [x] **Step 2: Run failing tests**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure for missing Launchpad output types/functions.

- [x] **Step 3: Add output declarations**

Declare `LaunchpadGridMidiOutAssociation`, `LaunchpadGridMidiOutConfig`, `LaunchpadGridMidiOutProcessor`, and:

```cpp
BasicMidi LaunchpadColorSysex(std::uint64_t timestamp, LaunchpadController controller, int x, int y, Color color);
```

Use the same constructor/setter/cache style as `WrldBldrSystemMidiOutProcessor`.

- [x] **Step 4: Implement SysEx and output processor**

Implement `LaunchpadColorSysex` as:

```cpp
const auto product = LaunchpadProductByte(controller);
const auto note = LaunchpadPositionToNote(controller, x, y);
if (!product.has_value() || !note.has_value()) return {};
return BasicMidi::SysEx(timestamp, {0xF0, 0x00, 0x20, 0x29, 0x02, *product, 0x03, 0x03, *note,
                                   static_cast<std::uint8_t>(color.r / 2),
                                   static_cast<std::uint8_t>(color.g / 2),
                                   static_cast<std::uint8_t>(color.b / 2),
                                   0xF7});
```

Implement `LaunchpadGridMidiOutProcessor::Process()` like `WrldBldrSystemMidiOutProcessor::Process()`, but enqueue `LaunchpadColorSysex`.

- [x] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass.

## Task 4: Profile Factory, JSON, And Defaults

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Add failing profile and JSON tests**

Add tests near the existing profile factory and JSON tests:

```cpp
TEST_CASE(midi_controller_profile_routes_launchpad_associations_through_generic_input_and_output) {
    synth::MessageInBus bus(nullptr, 32);
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 0, 0);
    ui.shiftHeld.store(true);

    synth::MidiControllerProfileConfig config;
    config.systemMessages.push_back({
        .launchpadPosition = synth::LaunchpadGridPosition{
            .controller = synth::LaunchpadController::LaunchpadX,
            .x = 0,
            .y = 7,
        },
        .press = synth::MessageIn::SceneSelect(0, 0),
        .feedback = synth::MessageIn::ToggleShift(0),
    });

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    synth::MidiControllerProfileResult profile =
        synth::CreateMidiControllerProfile(config, &bus, &sender, &ui, [] { return 66; });

    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(dynamic_cast<synth::SystemButtonMidiInProcessor*>(profile.input.get()) != nullptr);
    REQUIRE_TRUE(profile.outputs.size() == 1);
    REQUIRE_TRUE(dynamic_cast<synth::LaunchpadGridMidiOutProcessor*>(profile.outputs[0].get()) != nullptr);

    profile.input->Process(synth::BasicMidi::Note(0, 0, 11, 127));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 66));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SceneSelect);

    profile.outputs[0]->Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 1);
    REQUIRE_TRUE(sink.sent[0].raw[5] == 0x0C);
}

TEST_CASE(midi_profile_config_json_round_trips_launchpad_positions_and_legacy_wrld_bldr) {
    synth::MidiControllerProfileConfig source;
    source.systemMessages.push_back({
        .control = synth::MidiControlAddress{.channel = 5, .cc = 32},
        .wrldBldrPosition = synth::WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 4},
        .launchpadPosition = synth::LaunchpadGridPosition{
            .controller = synth::LaunchpadController::LaunchpadMiniMk3,
            .x = 1,
            .y = 1,
        },
        .press = synth::MessageIn::SetShift(0, true),
        .release = synth::MessageIn::SetShift(0, false),
        .feedback = synth::MessageIn::ToggleShift(0),
    });
    synth::JsonArena arena(65536);
    synth::JSON json = synth::ToJSON(arena, source);
    synth::MidiControllerProfileConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(json, loaded));
    REQUIRE_TRUE(loaded.systemMessages.size() == 1);
    REQUIRE_TRUE(loaded.systemMessages[0].control.has_value());
    REQUIRE_TRUE(loaded.systemMessages[0].wrldBldrPosition.has_value());
    REQUIRE_TRUE(loaded.systemMessages[0].launchpadPosition.has_value());
    REQUIRE_TRUE(loaded.systemMessages[0].launchpadPosition->controller == synth::LaunchpadController::LaunchpadMiniMk3);
    REQUIRE_TRUE(loaded.systemMessages[0].launchpadPosition->x == 1);
    REQUIRE_TRUE(loaded.systemMessages[0].launchpadPosition->y == 1);
}

TEST_CASE(launchpad_default_profiles_are_grid_only_and_create_processors) {
    synth::LaunchpadDefaultProfileOptions options;
    options.controller = synth::LaunchpadController::LaunchpadX;
    options.sceneCount = 4;
    options.bankButtonCount = 3;
    options.gestureSelectorCount = 2;
    const synth::MidiControllerProfileConfig config = synth::LaunchpadDefaultProfileConfig(options);
    REQUIRE_TRUE(!config.encoderInput.has_value());
    REQUIRE_TRUE(!config.encoderOutput.has_value());
    REQUIRE_TRUE(!config.analogInput.has_value());
    REQUIRE_TRUE(config.systemMessages.size() >= 9);
    REQUIRE_TRUE(config.systemMessages[0].launchpadPosition.has_value());

    synth::MidiControllerProfileResult profile =
        synth::CreateLaunchpadDefaultProfile(options, nullptr, nullptr, nullptr);
    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(dynamic_cast<synth::SystemButtonMidiInProcessor*>(profile.input.get()) != nullptr);
    REQUIRE_TRUE(profile.outputs.size() == 1);
    REQUIRE_TRUE(dynamic_cast<synth::LaunchpadGridMidiOutProcessor*>(profile.outputs[0].get()) != nullptr);
}
```

- [x] **Step 2: Run failing tests**

Run:

```bash
make -C projects/synth test
```

Expected: compile errors for missing profile/default/JSON types and optional `control` expectations.

- [x] **Step 3: Extend profile association and JSON**

Update `MidiControllerSystemMessageAssociation`:

```cpp
struct MidiControllerSystemMessageAssociation {
    std::optional<MidiControlAddress> control;
    std::optional<WrldBldrSystemPosition> wrldBldrPosition;
    std::optional<LaunchpadGridPosition> launchpadPosition;
    MessageIn press;
    std::optional<MessageIn> release;
    MessageIn feedback;
};
```

Add `ToJSON`/`FromJSON` for `LaunchpadController` using strings:

- `"launchpadX"`
- `"launchpadProMk3"`
- `"launchpadMiniMk3"`

Add `ToJSON`/`FromJSON` for `LaunchpadGridPosition` with `controller`, `x`, and `y`. Validate with `LaunchpadShapeSupports`. Update system association JSON to allow `control` to be null and include `launchpadPosition`.

- [x] **Step 4: Update `CreateMidiControllerProfile`**

When building `SystemButtonMidiInConfig`, copy both optional `control` and optional `launchpadPosition`.

When building outputs:

- Add a `SystemCcMidiOutAssociation` only when `association.control.has_value()`.
- Add a `WrldBldrSystemMidiOutAssociation` only when `wrldBldrPosition.has_value()`.
- Group Launchpad output associations by controller and create one `LaunchpadGridMidiOutProcessor` per represented controller.

- [x] **Step 5: Add default profile declarations and implementation**

Declare and implement:

```cpp
struct LaunchpadDefaultProfileOptions {
    LaunchpadController controller = LaunchpadController::LaunchpadX;
    std::size_t slotIx = 0;
    std::size_t sceneCount = 8;
    std::size_t bankButtonCount = 8;
    std::size_t gestureSelectorCount = 0;
    std::optional<LaunchpadGridPosition> shiftPosition;
};

MidiControllerProfileConfig LaunchpadDefaultProfileConfig(LaunchpadDefaultProfileOptions options = {});
MidiControllerProfileResult CreateLaunchpadDefaultProfile(
    LaunchpadDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});
```

Defaults:

- Scenes: bottom row `y = -1`, `x = 0..sceneCount-1`, message `SceneSelect(sceneIx)`.
- Banks: right column `x = 8`, `y = 0..bankButtonCount-1`, message `SelectParamBank(slotIx, bankIx)`.
- Gestures: row `y = 0`, `x = 0..gestureSelectorCount-1`, press `SetGestureSelect(ix,true)`, release `SetGestureSelect(ix,false)`.
- Shift: default `(8,-1)` when supported; press `SetShift(true)`, release `SetShift(false)`. If unsupported, omit.

- [x] **Step 6: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all tests pass.

## Task 5: OpenSpec Sync, Review, And Final Verification

**Files:**
- Modify: `openspec/changes/add-synth-launchpad-midi-profiles/tasks.md`

- [x] **Step 1: Run full verification**

Run:

```bash
make -C projects/synth test
openspec status --change "add-synth-launchpad-midi-profiles"
```

Expected: synth tests pass and OpenSpec reports all artifacts complete.

- [x] **Step 2: Review spec coverage**

Check implementation against:

- `spm-56`: mapping helpers and shape rejection.
- `spm-57`: generic system-message input processor handles Launchpad positions.
- `spm-58`: Launchpad RGB output processor and SysEx bytes.
- `spm-59`: default Launchpad profiles are grid-only.
- modified `spm-44`: profile factory shares associations.
- modified `spm-52`: profile JSON round trips Launchpad and legacy WRLD.Bldr configs.

- [x] **Step 3: Mark OpenSpec tasks complete**

After tests and review pass, mark all task checkboxes in:

```text
openspec/changes/add-synth-launchpad-midi-profiles/tasks.md
```

- [x] **Step 4: Final status**

Run:

```bash
git status --short
```

Expected: only intentional changes in synth MIDI files, synth tests, the OpenSpec task file, and this plan.
