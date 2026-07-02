# MF Twister MIDI Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MF Twister synth MIDI profile with input-only side buttons and richer encoder feedback for value, color, brightness, indicator position, and indicator color.

**Architecture:** Keep side buttons in the existing generic `systemMessages` input path, but do not generate output processors for MF Twister side-button controls. Extend the existing encoder UI snapshot and encoder output processors so Twister and WRLD.Bldr both consume per-cell brightness from UI state.

`EncoderMidiOutConfig` must identify its output protocol. Existing configs default to WRLD.Bldr for backwards compatibility; MF Twister configs set Twister explicitly so `CreateMidiControllerProfile()` and JSON-loaded profiles rebuild the same output processor type.

**Tech Stack:** C++20, existing `projects/synth` library, existing single-file synth test harness in `projects/synth/tests/parameter_modulation_tests.cpp`, OpenSpec change `add-mf-twister-midi-profile`, Smart Grid reference files under `/Users/joyo/theallelectricsmartgrid/private/src`.

---

## File Structure

- Modify `projects/synth/include/synth/ParameterModulation.hpp`: add `Parameter::UIState::brightness`.
- Modify `projects/synth/src/ParameterModulation.cpp`: initialize and populate brightness.
- Modify `projects/synth/include/synth/MidiController.hpp`: add brightness to `CellSnapshot`, extend Twister cache fields, add MF Twister default profile options and factory declarations.
- Modify `projects/synth/src/MidiController.cpp`: load brightness, update Twister output, dim WRLD.Bldr button colors, replace `ColorToTwister`, add MF Twister profile config/factory, add encoder-output protocol dispatch, and prevent side-button output from generic profile creation for the new default.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: add/extend tests around brightness, Twister output, MF Twister side-button input-only profile behavior, and JSON round-trip.
- Maybe modify `projects/synth/miniapp/Main.cpp`: only if inspection during implementation finds Twister-specific manual processor creation; current baseline appears WRLD.Bldr-profile-driven, so no change is expected.
- Update `openspec/changes/add-mf-twister-midi-profile/tasks.md`: mark OpenSpec tasks complete only after implementation and reviews pass.

Baseline already verified: `make synth-test` passed before implementation.

## Task 1: UI-State Brightness Snapshot

**Files:**
- Modify: `projects/synth/include/synth/ParameterModulation.hpp`
- Modify: `projects/synth/src/ParameterModulation.cpp`
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Write failing UI-state brightness tests**

Add assertions to `parameter_and_slot_ui_state_reports_values_colors_and_target_cell_metadata` or a nearby UI-state test:

```cpp
REQUIRE_NEAR(slotState.cells[0].brightness.load(std::memory_order_relaxed), 1.0f, 0.000001f);
slotState.cells[1].SetDisconnected();
REQUIRE_NEAR(slotState.cells[1].brightness.load(std::memory_order_relaxed), 0.0f, 0.000001f);
```

If no suitable disconnected cell exists in that test, add a focused test near the MIDI output tests:

```cpp
TEST_CASE(parameter_ui_state_brightness_defaults_connected_and_disconnected) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "Level", .defaultValue = 0.5f});
    synth::Parameter::UIState state(1);

    parameter.PopulateUIState(state);
    REQUIRE_TRUE(state.connected.load(std::memory_order_relaxed));
    REQUIRE_NEAR(state.brightness.load(std::memory_order_relaxed), 1.0f, 0.000001f);

    state.SetDisconnected();
    REQUIRE_TRUE(!state.connected.load(std::memory_order_relaxed));
    REQUIRE_NEAR(state.brightness.load(std::memory_order_relaxed), 0.0f, 0.000001f);
}
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure because `Parameter::UIState` has no `brightness` member.

- [x] **Step 3: Add brightness to UI state and snapshots**

In `ParameterModulation.hpp`, add one per-cell atomic beside `color`:

```cpp
AtomicColor color;
std::atomic<float> brightness{0.0f};
std::atomic<const char*> shortName{nullptr};
```

In `Parameter::UIState::SetDisconnected()`:

```cpp
color.Store(Color::Off);
brightness.store(0.0f, std::memory_order_relaxed);
shortName.store(nullptr, std::memory_order_relaxed);
```

In `Parameter::PopulateUIState()` before publishing `connected=true`:

```cpp
state.color.Store(config_.color);
state.brightness.store(1.0f, std::memory_order_relaxed);
```

In `MidiController.hpp`, extend `MidiOutProcessor::CellSnapshot`:

```cpp
float brightness = 0.0f;
```

In `MidiOutProcessor::LoadCellSnapshot()`, load it within the revision window:

```cpp
snapshot.brightness = state.brightness.load(std::memory_order_relaxed);
```

- [x] **Step 4: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass or only later Twister-output expectations fail after Task 2 tests are added.

## Task 2: Twister Encoder Output And Smart Grid Color Mapping

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Write failing tests for Twister output expansion**

Update `twister_output_debounces_reset_and_uses_channels` to expect five messages on first render: channel 1 color, channel 2 brightness, channel 4 indicator position, channel 5 indicator color, channel 0 value. The exact order should follow the implementation's current color/brightness/value phase style, extended before value:

```cpp
REQUIRE_TRUE(sink.sent.size() == 5);
REQUIRE_TRUE(sink.sent[0].Channel() == 1);
REQUIRE_TRUE(sink.sent[1].Channel() == 2);
REQUIRE_TRUE(sink.sent[2].Channel() == 4);
REQUIRE_TRUE(sink.sent[2].GetValue() == 64);
REQUIRE_TRUE(sink.sent[3].Channel() == 5);
REQUIRE_TRUE(sink.sent[3].GetValue() != 0);
REQUIRE_TRUE(sink.sent[4].Channel() == 0);
REQUIRE_TRUE(sink.sent[4].GetValue() == 64);
```

Update `twister_output_skips_unstable_snapshot_without_cache_update` and `twister_output_blanks_disconnected_mapped_cells_once` from 3 messages to 5 messages. For disconnected blanking:

```cpp
REQUIRE_TRUE(sink.sent.size() == 5);
REQUIRE_TRUE(sink.sent[0].Channel() == 1);
REQUIRE_TRUE(sink.sent[0].GetValue() == 0);
REQUIRE_TRUE(sink.sent[1].Channel() == 2);
REQUIRE_TRUE(sink.sent[1].GetValue() == 0);
REQUIRE_TRUE(sink.sent[2].Channel() == 4);
REQUIRE_TRUE(sink.sent[2].GetValue() == 0);
REQUIRE_TRUE(sink.sent[3].Channel() == 5);
REQUIRE_TRUE(sink.sent[3].GetValue() == 0);
REQUIRE_TRUE(sink.sent[4].Channel() == 0);
REQUIRE_TRUE(sink.sent[4].GetValue() == 0);
```

Add a direct color helper test near the MIDI helper tests:

```cpp
TEST_CASE(twister_color_helper_matches_smart_grid_hue_shape) {
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Off) == 0);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Blue) == 8);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Red) == 85);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Green) == 35);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Yellow) == 67);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::White) == 1);
    REQUIRE_TRUE(synth::ColorToTwister(synth::Color::Grey) == 1);
}
```

These expected values come from applying `/Users/joyo/theallelectricsmartgrid/private/src/HSV.hpp` to the actual Sheaf RGB palette constants with `h0_deg = 240` and `1 + round(t / (360 / 126))`; achromatic colors use the blue anchor because their hue is undefined and should not render as red.

Add a half-brightness output test by constructing a manual UI state:

```cpp
TEST_CASE(twister_output_uses_ui_state_brightness) {
    synth::ParameterManager::UIState ui;
    ui.Configure(1, 1, 1, 0);
    auto& cell = ui.slots[0].cells[0];
    cell.connected.store(true);
    cell.voiceCount.store(1);
    cell.values[0].store(0.25f);
    cell.color.Store(synth::Color::Red);
    cell.indicatorColors[0].Store(synth::Color::Cyan);
    cell.brightness.store(0.5f);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::TwisterDefault(0);
    config.KeepFirstPositions(1);
    synth::TwisterMidiOutProcessor processor(config, &sender, &ui);
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();

    REQUIRE_TRUE(sink.sent.size() == 5);
    REQUIRE_TRUE(sink.sent[1].Channel() == 2);
    REQUIRE_TRUE(sink.sent[1].GetValue() == 32);
}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
make -C projects/synth test
```

Expected: Twister output tests fail because only 3 messages are sent and `ColorToTwister` still uses the compact 64-step mapping.

- [x] **Step 3: Implement Twister color, brightness, and indicator output**

In `MidiController.cpp`, add a helper near `FloatTo7Bit`:

```cpp
std::uint8_t BrightnessToTwisterAnimationValue(float brightness) {
    if (brightness <= 0.0f) {
        return 0;
    }
    return Clamp7Bit(static_cast<int>(std::lround(17.0f + std::clamp(brightness, 0.0f, 1.0f) * 30.0f)));
}
```

Replace `ColorToTwister` with the Smart Grid-derived shape:

```cpp
std::uint8_t ColorToTwister(Color color) {
    if (color == Color::Off) {
        return 0;
    }
    const HSV hsv = ToHSV(color);
    constexpr float h0 = 240.0f / 360.0f;
    constexpr float step = 1.0f / 126.0f;
    float t = std::fmod(h0 - hsv.h + 1.0f, 1.0f);
    int code = 1 + static_cast<int>(std::lround(t / step));
    return static_cast<std::uint8_t>(std::clamp(code, 1, 126));
}
```

In `TwisterMidiOutProcessor::CacheEntry`, add fields:

```cpp
std::uint8_t indicatorValue = 0;
std::uint8_t indicatorColor = 0;
```

In `TwisterMidiOutProcessor::Process()`, compute:

```cpp
const std::uint8_t indicatorValue = value;
const std::uint8_t indicatorColor = blank ? 0 : ColorToTwister(snapshot->indicatorColor);
const std::uint8_t brightness = blank ? 0 : BrightnessToTwisterAnimationValue(snapshot->brightness);
```

Emit channel 4 and 5 before channel 0 value:

```cpp
if (!cache.valid || cache.indicatorValue != indicatorValue) {
    Enqueue(BasicMidi::CC(0, 4, mapping.cc, indicatorValue));
}
if (!cache.valid || cache.indicatorColor != indicatorColor) {
    Enqueue(BasicMidi::CC(0, 5, mapping.cc, indicatorColor));
}
```

Update cache assignment with all five fields.

- [x] **Step 4: Update WRLD.Bldr button color brightness**

In `WrldBldrMidiOutProcessor::Process()`, change:

```cpp
const Color buttonColor = blank ? Color::Off : snapshot->color;
```

to:

```cpp
const Color buttonColor = blank ? Color::Off : snapshot->color.AdjustBrightness(snapshot->brightness);
```

Add or update a test in `wrld_bldr_output_sends_value_and_source_derived_sysex` by setting `ui->slots[0].cells[0].brightness.store(0.5f)` after `PopulateUIState`, then expecting `Color::Orange.AdjustBrightness(0.5f)` in the button SysEx bytes while leaving indicator color unchanged.

- [x] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

## Task 3: MF Twister Default Profile And Input-Only Side Buttons

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`

- [x] **Step 1: Write failing tests for MF Twister profile**

Add a test near `wrld_bldr_default_profile_maps_encoders_analogs_and_system_buttons`:

```cpp
TEST_CASE(mf_twister_default_profile_maps_encoders_and_input_only_side_buttons) {
    synth::MessageInBus bus(nullptr, 64);
    synth::MfTwisterDefaultProfileOptions options;
    options.visibleEncoderCount = 2;
    options.sideButtons[0] = synth::MidiControllerSystemMessageAssociation{
        .control = synth::MidiControlAddress{.channel = 3, .cc = 8},
        .press = synth::MessageIn::SetShift(0, true),
        .release = synth::MessageIn::SetShift(0, false),
    };
    options.sideButtons[1] = synth::MidiControllerSystemMessageAssociation{
        .control = synth::MidiControlAddress{.channel = 3, .cc = 9},
        .press = synth::MessageIn::SceneSelect(0, 1),
    };

    const synth::MidiControllerProfileConfig config = synth::MfTwisterDefaultProfileConfig(options);
    REQUIRE_TRUE(config.encoderInput.has_value());
    REQUIRE_TRUE(config.encoderOutput.has_value());
    REQUIRE_TRUE(!config.analogInput.has_value());
    REQUIRE_TRUE(config.encoderInput->turns.size() == 2);
    REQUIRE_TRUE(config.encoderInput->pushes.size() == 2);
    REQUIRE_TRUE(config.encoderInput->turns[0].control.channel == 0);
    REQUIRE_TRUE(config.encoderInput->pushes[0].control.channel == 1);
    REQUIRE_TRUE(config.systemMessages.size() == 2);
    REQUIRE_TRUE(config.systemMessages[0].control->channel == 3);
    REQUIRE_TRUE(config.systemMessages[0].control->cc == 8);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    synth::ParameterManager::UIState ui;
    ui.Configure(1, 2, 1, 0, 0);
    synth::MidiControllerProfileResult profile =
        synth::CreateMfTwisterDefaultProfile(options, &bus, &sender, &ui, [] { return 321; });
    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(profile.inputThru.size() == 1);
    REQUIRE_TRUE(profile.outputs.size() == 1);
    REQUIRE_TRUE(dynamic_cast<synth::TwisterMidiOutProcessor*>(profile.outputs[0].get()) != nullptr);

    profile.input->Process(synth::BasicMidi::CC(0, 3, 8, 127));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 321));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 3, 8, 0));
    REQUIRE_TRUE(bus.Pop(message, 321));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(!message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 3, 13, 127));
    REQUIRE_TRUE(!bus.Pop(message, 321));

    profile.outputs[0]->Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    for (const synth::BasicMidi& midi : sink.sent) {
        REQUIRE_TRUE(!(midi.IsCC() && midi.Channel() == 3 && midi.GetCC() >= 8 && midi.GetCC() <= 13));
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
make -C projects/synth test
```

Expected: compile failure because `MfTwisterDefaultProfileOptions`, `MfTwisterDefaultProfileConfig`, and `CreateMfTwisterDefaultProfile` do not exist.

- [x] **Step 3: Add MF Twister API declarations**

In `MidiController.hpp`, add an encoder-output protocol with a backwards-compatible default, then add the MF Twister profile options after `WrldBldrDefaultProfileOptions`:

```cpp
enum class EncoderMidiOutProtocol {
    WrldBldr,
    Twister,
};
```

Add `EncoderMidiOutProtocol protocol = EncoderMidiOutProtocol::WrldBldr;` to `EncoderMidiOutConfig`. `EncoderMidiOutConfig::WrldBldrDefault()` keeps `WrldBldr`; `EncoderMidiOutConfig::TwisterDefault()` sets `Twister`.

```cpp
struct MfTwisterDefaultProfileOptions {
    std::size_t slotIx = 0;
    std::size_t visibleEncoderCount = 16;
    std::array<std::optional<MidiControllerSystemMessageAssociation>, 6> sideButtons{};
};

MidiControllerProfileConfig MfTwisterDefaultProfileConfig(MfTwisterDefaultProfileOptions options = {});
MidiControllerProfileResult CreateMfTwisterDefaultProfile(
    MfTwisterDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});
```

Add `#include <array>` to the header if needed.

- [x] **Step 4: Implement MF Twister config/factory**

In `MidiController.cpp`, add after the WRLD.Bldr helpers:

```cpp
MidiControllerProfileConfig MfTwisterDefaultProfileConfig(MfTwisterDefaultProfileOptions options) {
    MidiControllerProfileConfig config;
    config.encoderInput = EncoderMidiInConfig::TwisterDefault(options.slotIx);
    config.encoderInput->KeepFirstPositions(options.visibleEncoderCount);
    config.encoderOutput = EncoderMidiOutConfig::TwisterDefault(options.slotIx);
    config.encoderOutput->KeepFirstPositions(options.visibleEncoderCount);

    for (std::size_t ix = 0; ix < options.sideButtons.size(); ++ix) {
        if (!options.sideButtons[ix].has_value()) {
            continue;
        }
        MidiControllerSystemMessageAssociation association = *options.sideButtons[ix];
        association.control = MidiControlAddress{.channel = 3, .cc = static_cast<std::uint8_t>(8 + ix)};
        association.wrldBldrPosition = std::nullopt;
        association.launchpadPosition = std::nullopt;
        config.systemMessages.push_back(std::move(association));
    }
    return config;
}

MidiControllerProfileResult CreateMfTwisterDefaultProfile(
    MfTwisterDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider) {
    return CreateMidiControllerProfile(MfTwisterDefaultProfileConfig(options), bus, sender, uiState,
                                       std::move(timestampProvider));
}
```

Update `CreateMidiControllerProfile()` so `encoderOutput->protocol == EncoderMidiOutProtocol::Twister` creates `TwisterMidiOutProcessor`, and `WrldBldr` creates `WrldBldrMidiOutProcessor`.

Important: the generic `CreateMidiControllerProfile` currently turns every `control` association into a `SystemCcMidiOutProcessor`. Add a backwards-compatible `bool outputFeedback = true` (or similarly named) field to `MidiControllerSystemMessageAssociation`, serialize it optionally/defaulting to true, and skip `SystemCcMidiOutProcessor` creation when it is false. Set `outputFeedback = false` for MF Twister side buttons. Keep existing WRLD.Bldr and Launchpad tests passing.

- [x] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

## Task 4: JSON Round Trip And Miniapp Integration Check

**Files:**
- Modify: `projects/synth/tests/parameter_modulation_tests.cpp`
- Maybe modify: `projects/synth/src/MidiController.cpp`
- Maybe modify: `projects/synth/include/synth/MidiController.hpp`
- Maybe modify: `projects/synth/miniapp/Main.cpp`

- [x] **Step 1: Write failing or confirming JSON test**

Add a test near the existing MIDI profile JSON tests:

```cpp
TEST_CASE(midi_profile_config_json_round_trips_mf_twister_side_buttons) {
    synth::MfTwisterDefaultProfileOptions options;
    options.visibleEncoderCount = 3;
    options.sideButtons[0] = synth::MidiControllerSystemMessageAssociation{
        .press = synth::MessageIn::SetShift(0, true),
        .release = synth::MessageIn::SetShift(0, false),
    };
    options.sideButtons[5] = synth::MidiControllerSystemMessageAssociation{
        .press = synth::MessageIn::SceneSelect(0, 2),
    };
    const synth::MidiControllerProfileConfig source = synth::MfTwisterDefaultProfileConfig(options);

    synth::JsonArena arena(262144);
    synth::JSON json = synth::ToJSON(arena, source);
    REQUIRE_TRUE(!arena.Failed());

    synth::MidiControllerProfileConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(json, loaded));
    REQUIRE_TRUE(loaded.encoderInput.has_value());
    REQUIRE_TRUE(loaded.encoderOutput.has_value());
    REQUIRE_TRUE(loaded.encoderOutput->protocol == synth::EncoderMidiOutProtocol::Twister);
    REQUIRE_TRUE(!loaded.analogInput.has_value());
    REQUIRE_TRUE(loaded.encoderInput->turns.size() == 3);
    REQUIRE_TRUE(loaded.systemMessages.size() == 2);
    REQUIRE_TRUE(loaded.systemMessages[0].control.has_value());
    REQUIRE_TRUE(loaded.systemMessages[0].control->channel == 3);
    REQUIRE_TRUE(loaded.systemMessages[0].control->cc == 8);
    REQUIRE_TRUE(loaded.systemMessages[0].press.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(loaded.systemMessages[0].release.has_value());
    REQUIRE_TRUE(loaded.systemMessages[1].control->cc == 13);
    REQUIRE_TRUE(loaded.systemMessages[1].press.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(loaded.systemMessages[1].press.sceneIx == 2);
    REQUIRE_TRUE(!loaded.systemMessages[0].outputFeedback);
    REQUIRE_TRUE(!loaded.systemMessages[1].outputFeedback);
}
```

- [x] **Step 2: Implement JSON persistence for output protocol and side-button output feedback**

Extend `ToJSON`/`FromJSON` for `EncoderMidiOutConfig` with an optional protocol field. Missing protocol loads as `WrldBldr` so old profile JSON stays compatible. Extend system-message association JSON with optional `outputFeedback`; missing loads as true. MF Twister defaults serialize `outputFeedback=false` for side buttons.

Also add a rebuild assertion to the JSON test: call `CreateMidiControllerProfile(loaded, ...)` and verify the single encoder output is a `TwisterMidiOutProcessor` and no side-button `SystemCcMidiOutProcessor` is created.

- [x] **Step 3: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

- [x] **Step 4: Check miniapp wiring**

Inspect `projects/synth/miniapp/Main.cpp`. If it still contains manual Twister processor creation, replace it with `CreateMfTwisterDefaultProfile` or `MfTwisterDefaultProfileConfig`. If it only uses `midiProfileConfig_` plus `CreateMidiControllerProfile` and defaults to WRLD.Bldr, leave it unchanged and note this in the task review.

- [x] **Step 5: Run tests**

Run:

```bash
make -C projects/synth test
```

Expected: all synth tests pass.

## Task 5: OpenSpec Progress, Full Verification, And Hardware Note

**Files:**
- Modify: `openspec/changes/add-mf-twister-midi-profile/tasks.md`
- No source code changes expected unless verification finds a bug.

- [x] **Step 1: Mark completed OpenSpec tasks**

After Tasks 1-4 are implemented, reviewed, and verified, update `openspec/changes/add-mf-twister-midi-profile/tasks.md` by changing every completed checkbox from `- [ ]` to `- [x]`.

- [x] **Step 2: Run OpenSpec status**

Run:

```bash
openspec status --change "add-mf-twister-midi-profile"
```

Expected: all planning artifacts complete and task checkboxes reflect implementation completion.

- [x] **Step 3: Run full synth verification**

Run:

```bash
make synth-test
```

Expected: all `parameter_modulation_tests`, `dsp_tests`, and `module_tests` pass.

- [x] **Step 4: Hardware smoke-test note**

If no MF Twister hardware is attached and available to the agent, record in the final implementation summary: `Not run: MF Twister hardware smoke test unavailable in this session.` Do not mark this as a test failure.

## Review Requirements For Execution

After each task:

1. Dispatch a Claude spec-compliance reviewer with xagent using `plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<prompt>"`.
2. The spec reviewer must compare the code diff against `openspec/changes/add-mf-twister-midi-profile/specs/synth-parameter-modulation/spec.md`, `design.md`, and the task section in this plan.
3. Fix and re-review any spec issues before code-quality review.
4. Dispatch a Claude code-quality reviewer with xagent using the same launcher/model.
5. Fix and re-review any critical or important issues before moving to the next task.

Use fresh implementation subagents per task. Do not run implementation tasks in parallel because `projects/synth/src/MidiController.cpp`, `projects/synth/include/synth/MidiController.hpp`, and `projects/synth/tests/parameter_modulation_tests.cpp` overlap.

## Coverage Checklist

- `spm-60`: Task 1 adds UI-state brightness and stable snapshot loading.
- `spm-61`: Task 3 adds MF Twister side-button channel/CC mappings and press/release tests.
- `spm-62`: Task 3 adds default MF Twister profile and asserts no side-button output processor.
- Modified `spm-35`: Task 2 extends Twister encoder feedback and color mapping.
- Modified `spm-36`: Task 2 dims WRLD.Bldr button color by UI brightness.
- Modified `spm-44`: Task 3 verifies profile factory wiring and no side-button feedback output.
- Modified `spm-52`: Task 4 verifies JSON round-trip for MF Twister side-button associations.
