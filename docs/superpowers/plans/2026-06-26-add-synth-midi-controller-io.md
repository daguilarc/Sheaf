# Add Synth MIDI Controller I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add JUCE-free synth MIDI encoder input/output processors, JUCE MIDI device handlers, and miniapp controller configuration for Twister and Wrld.Bldr encoder control.

**Architecture:** Add a focused core MIDI module under `projects/synth/include/synth/MidiController.hpp` and `projects/synth/src/MidiController.cpp`, keeping JUCE out of core. The miniapp keeps its existing UI `MessageInBus` and adds a dedicated MIDI input `MessageInBus` so the JUCE MIDI callback remains the only producer for the MIDI bus; both buses drain on the timer thread into one `ParameterManager`. Output processors read stable `Parameter::UIState` snapshots, reduce multi-voice state to voice 0, debounce changes, and enqueue `BasicMidi`/SysEx through a sender thread and JUCE output sink.

**Tech Stack:** C++20, existing synth parameter modulation library, JUCE miniapp layer, Makefiles, doctest-style local `CHECK` macros in `projects/synth/tests/parameter_modulation_tests.cpp`, Smart Grid source references under `/Users/joyo/theallelectricsmartgrid`, xagent Claude reviews after each task.

---

## File Structure

- Create `projects/synth/include/synth/MidiController.hpp`: JUCE-free `BasicMidi`, MIDI input configs/processors, output sink/sender, output configs/processors, and helper declarations.
- Create `projects/synth/src/MidiController.cpp`: implementations for MIDI decoding, presets, sender thread, snapshot helper, Twister output, Wrld.Bldr SysEx output.
- Modify `projects/synth/include/synth/ParameterModulation.hpp`: include nothing from MIDI; only add accessors if implementation proves necessary. Prefer keeping MIDI in the new header.
- Modify `projects/synth/Makefile`: compile `src/MidiController.cpp` into `build/libsynth.a`.
- Modify `projects/synth/tests/parameter_modulation_tests.cpp`: add core MIDI tests near existing message bus tests, using fake sinks and helper UI-state fixtures.
- Create `projects/synth/juce/MidiHandlers.hpp`: JUCE input handler and output sink wrappers around core `synth::MidiInProcessor`/`synth::IMidiOutputSink`.
- Modify `projects/synth/miniapp/Main.cpp`: add compact MIDI config controls, dedicated MIDI bus, MIDI handlers/processors, output processing after UI-state population, and shutdown cleanup.
- Modify `projects/synth/miniapp/Makefile`: include the new core source and JUCE header dependencies.
- Modify `openspec/changes/add-synth-midi-controller-io/tasks.md`: mark OpenSpec task checkboxes as completed only after implementation, review, and verification.

---

### Task 1: Core MIDI Message And Input Processors

**Files:**
- Create: `projects/synth/include/synth/MidiController.hpp`
- Create: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/Makefile`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Reference: `/Users/joyo/theallelectricsmartgrid/private/src/BasicMidi.hpp`
- Reference: `/Users/joyo/theallelectricsmartgrid/private/src/EncoderMidi.hpp`
- Reference: `/Users/joyo/theallelectricsmartgrid/private/src/WrldBLDRMidi.hpp`

- [x] **Step 1: Add failing tests for `BasicMidi`**

Append tests in `projects/synth/tests/parameter_modulation_tests.cpp` after the existing message bus tests:

```cpp
TEST_CASE(midi_basic_cc_and_realtime_messages) {
    const synth::BasicMidi cc = synth::BasicMidi::CC(10, 2, 7, 99);
    REQUIRE_TRUE(cc.timestamp == 10);
    REQUIRE_TRUE(cc.Size() == 3);
    REQUIRE_TRUE(cc.Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(cc.Channel() == 2);
    REQUIRE_TRUE(cc.GetCC() == 7);
    REQUIRE_TRUE(cc.GetValue() == 99);

    const synth::BasicMidi clock = synth::BasicMidi::Clock(44);
    REQUIRE_TRUE(clock.timestamp == 44);
    REQUIRE_TRUE(clock.Size() == 1);
    REQUIRE_TRUE(clock.raw[0] == synth::BasicMidi::kStatusClock);
    REQUIRE_TRUE(synth::BasicMidi::IsSupportedRealtimeStatus(clock.raw[0]));
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `make -C projects/synth test`

Expected: compile failure mentioning `synth::BasicMidi` is not declared.

- [x] **Step 3: Declare core MIDI input APIs**

Create `projects/synth/include/synth/MidiController.hpp`:

```cpp
#pragma once

#include "synth/ParameterModulation.hpp"

#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>

namespace synth {

struct BasicMidi {
    static constexpr std::uint8_t kStatusNote = 0x90;
    static constexpr std::uint8_t kStatusNoteOff = 0x80;
    static constexpr std::uint8_t kStatusCC = 0xB0;
    static constexpr std::uint8_t kStatusPitchBend = 0xE0;
    static constexpr std::uint8_t kStatusTransportStart = 0xFA;
    static constexpr std::uint8_t kStatusTransportContinue = 0xFB;
    static constexpr std::uint8_t kStatusTransportStop = 0xFC;
    static constexpr std::uint8_t kStatusClock = 0xF8;

    std::uint64_t timestamp = 0;
    std::array<std::uint8_t, 3> raw{};

    BasicMidi() = default;
    BasicMidi(std::uint64_t timestamp, std::uint8_t status, std::uint8_t data1, std::uint8_t data2);

    static BasicMidi CC(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, std::uint8_t value);
    static BasicMidi Note(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note, std::uint8_t velocity);
    static BasicMidi NoteOff(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note);
    static BasicMidi PitchBend(std::uint64_t timestamp, std::uint8_t channel, std::uint16_t value);
    static BasicMidi Realtime(std::uint64_t timestamp, std::uint8_t status);
    static BasicMidi Clock(std::uint64_t timestamp);
    static BasicMidi TransportStart(std::uint64_t timestamp);
    static BasicMidi TransportContinue(std::uint64_t timestamp);
    static BasicMidi TransportStop(std::uint64_t timestamp);
    static bool IsSupportedRealtimeStatus(std::uint8_t status);

    std::uint8_t Status() const;
    std::uint8_t Channel() const;
    std::uint8_t GetCC() const;
    std::uint8_t GetNote() const;
    std::uint8_t GetValue() const;
    std::uint16_t GetPitchBend() const;
    std::size_t Size() const;
};

class MidiInProcessor {
public:
    using TimestampProvider = std::function<std::uint64_t()>;

    explicit MidiInProcessor(MessageInBus* bus = nullptr);
    virtual ~MidiInProcessor() = default;

    void SetMessageInBus(MessageInBus* bus);
    void SetThru(MidiInProcessor* thru);
    void SetTimestampProvider(TimestampProvider provider);
    MessageInBus* Bus() const { return bus_; }
    MidiInProcessor* Thru() const { return thru_; }
    std::uint64_t NextTimestamp() const;

    virtual void Process(const BasicMidi& midi) = 0;

protected:
    bool Push(const MessageIn& message);
    void PassToThru(const BasicMidi& midi);

private:
    MessageInBus* bus_ = nullptr;
    MidiInProcessor* thru_ = nullptr;
    TimestampProvider timestampProvider_;
};

enum class EncoderRelativeMode {
    Signed7Bit,
    DirectionOnly,
};

struct MidiControlAddress {
    std::uint8_t channel = 0;
    std::uint8_t cc = 0;
    bool operator==(const MidiControlAddress& other) const = default;
};

struct EncoderMidiMapping {
    MidiControlAddress control;
    std::size_t slotIx = 0;
    std::size_t position = 0;
};

struct EncoderMidiInConfig {
    EncoderRelativeMode relativeMode = EncoderRelativeMode::Signed7Bit;
    float turnStep = 1.0f / 128.0f;
    std::vector<EncoderMidiMapping> turns;
    std::vector<EncoderMidiMapping> pushes;

    static EncoderMidiInConfig TwisterDefault(std::size_t slotIx);
    static EncoderMidiInConfig WrldBldrDefault(std::size_t slotIx);
    void KeepFirstPositions(std::size_t count);
};

class EncoderMidiInProcessor final : public MidiInProcessor {
public:
    EncoderMidiInProcessor(EncoderMidiInConfig config, MessageInBus* bus = nullptr);

    void SetConfig(EncoderMidiInConfig config);
    const EncoderMidiInConfig& Config() const { return config_; }
    void Process(const BasicMidi& midi) override;

private:
    const EncoderMidiMapping* FindTurn(const BasicMidi& midi) const;
    const EncoderMidiMapping* FindPush(const BasicMidi& midi) const;
    std::optional<float> DecodeDelta(std::uint8_t value) const;

    EncoderMidiInConfig config_;
};

std::uint8_t EncoderPositionToCC(std::size_t position);

} // namespace synth
```

- [x] **Step 4: Implement `BasicMidi` and input processors**

Create `projects/synth/src/MidiController.cpp` with `BasicMidi` plus input processor implementation. Use these exact behaviors:

```cpp
#include "synth/MidiController.hpp"

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <cstring>

namespace synth {

BasicMidi::BasicMidi(std::uint64_t newTimestamp, std::uint8_t status, std::uint8_t data1, std::uint8_t data2)
    : timestamp(newTimestamp), raw{status, data1, data2} {}

BasicMidi BasicMidi::CC(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, std::uint8_t value) {
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusCC | (channel & 0x0F)), cc, value);
}

BasicMidi BasicMidi::Note(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note, std::uint8_t velocity) {
    if (velocity == 0) {
        return NoteOff(timestamp, channel, note);
    }
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusNote | (channel & 0x0F)), note, velocity);
}

BasicMidi BasicMidi::NoteOff(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note) {
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusNoteOff | (channel & 0x0F)), note, 0);
}

BasicMidi BasicMidi::PitchBend(std::uint64_t timestamp, std::uint8_t channel, std::uint16_t value) {
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusPitchBend | (channel & 0x0F)),
                     static_cast<std::uint8_t>((value >> 7) & 0x7F), static_cast<std::uint8_t>(value & 0x7F));
}

BasicMidi BasicMidi::Realtime(std::uint64_t timestamp, std::uint8_t status) {
    return BasicMidi(timestamp, status, 0, 0);
}

BasicMidi BasicMidi::Clock(std::uint64_t timestamp) { return Realtime(timestamp, kStatusClock); }
BasicMidi BasicMidi::TransportStart(std::uint64_t timestamp) { return Realtime(timestamp, kStatusTransportStart); }
BasicMidi BasicMidi::TransportContinue(std::uint64_t timestamp) { return Realtime(timestamp, kStatusTransportContinue); }
BasicMidi BasicMidi::TransportStop(std::uint64_t timestamp) { return Realtime(timestamp, kStatusTransportStop); }

bool BasicMidi::IsSupportedRealtimeStatus(std::uint8_t status) {
    return status == kStatusClock || status == kStatusTransportStart || status == kStatusTransportContinue ||
           status == kStatusTransportStop;
}

std::uint8_t BasicMidi::Status() const { return raw[0] & 0xF0; }
std::uint8_t BasicMidi::Channel() const { return raw[0] & 0x0F; }
std::uint8_t BasicMidi::GetCC() const { return raw[1]; }
std::uint8_t BasicMidi::GetNote() const { return raw[1]; }
std::uint8_t BasicMidi::GetValue() const { return raw[2]; }
std::uint16_t BasicMidi::GetPitchBend() const { return static_cast<std::uint16_t>((raw[1] << 7) | raw[2]); }
std::size_t BasicMidi::Size() const { return IsSupportedRealtimeStatus(raw[0]) ? 1 : 3; }

MidiInProcessor::MidiInProcessor(MessageInBus* bus) : bus_(bus) {}
void MidiInProcessor::SetMessageInBus(MessageInBus* bus) { bus_ = bus; }
void MidiInProcessor::SetThru(MidiInProcessor* thru) { thru_ = thru; }
void MidiInProcessor::SetTimestampProvider(TimestampProvider provider) { timestampProvider_ = std::move(provider); }
std::uint64_t MidiInProcessor::NextTimestamp() const { return timestampProvider_ ? timestampProvider_() : 0; }
bool MidiInProcessor::Push(const MessageIn& message) { return bus_ != nullptr && bus_->Push(message); }
void MidiInProcessor::PassToThru(const BasicMidi& midi) {
    if (thru_ != nullptr) {
        thru_->Process(midi);
    }
}

std::uint8_t EncoderPositionToCC(std::size_t position) {
    return static_cast<std::uint8_t>(position & 0x7F);
}

static std::vector<EncoderMidiMapping> RowMajorMappings(std::size_t slotIx, std::uint8_t channel) {
    std::vector<EncoderMidiMapping> mappings;
    mappings.reserve(16);
    for (std::size_t position = 0; position < 16; ++position) {
        mappings.push_back({.control = {.channel = channel, .cc = EncoderPositionToCC(position)},
                            .slotIx = slotIx,
                            .position = position});
    }
    return mappings;
}

EncoderMidiInConfig EncoderMidiInConfig::TwisterDefault(std::size_t slotIx) {
    EncoderMidiInConfig config;
    config.relativeMode = EncoderRelativeMode::Signed7Bit;
    config.turnStep = 1.0f / 128.0f;
    config.turns = RowMajorMappings(slotIx, 0);
    config.pushes = RowMajorMappings(slotIx, 1);
    return config;
}

EncoderMidiInConfig EncoderMidiInConfig::WrldBldrDefault(std::size_t slotIx) {
    return TwisterDefault(slotIx);
}

void EncoderMidiInConfig::KeepFirstPositions(std::size_t count) {
    const auto keep = [count](const EncoderMidiMapping& mapping) { return mapping.position < count; };
    turns.erase(std::remove_if(turns.begin(), turns.end(), [&](const auto& mapping) { return !keep(mapping); }),
                turns.end());
    pushes.erase(std::remove_if(pushes.begin(), pushes.end(), [&](const auto& mapping) { return !keep(mapping); }),
                 pushes.end());
}

EncoderMidiInProcessor::EncoderMidiInProcessor(EncoderMidiInConfig config, MessageInBus* bus)
    : MidiInProcessor(bus), config_(std::move(config)) {}

void EncoderMidiInProcessor::SetConfig(EncoderMidiInConfig config) { config_ = std::move(config); }

void EncoderMidiInProcessor::Process(const BasicMidi& midi) {
    if (midi.Status() != BasicMidi::kStatusCC) {
        PassToThru(midi);
        return;
    }

    if (const EncoderMidiMapping* mapping = FindTurn(midi)) {
        if (std::optional<float> delta = DecodeDelta(midi.GetValue())) {
            Push(MessageIn::ParamIncDec(NextTimestamp(), mapping->slotIx, mapping->position, *delta));
        }
        return;
    }

    if (const EncoderMidiMapping* mapping = FindPush(midi)) {
        if (midi.GetValue() > 0) {
            Push(MessageIn::ParamPush(NextTimestamp(), mapping->slotIx, mapping->position));
        }
        return;
    }

    PassToThru(midi);
}

const EncoderMidiMapping* EncoderMidiInProcessor::FindTurn(const BasicMidi& midi) const {
    return FindMapping(config_.turns, midi);
}

const EncoderMidiMapping* EncoderMidiInProcessor::FindPush(const BasicMidi& midi) const {
    return FindMapping(config_.pushes, midi);
}

std::optional<float> EncoderMidiInProcessor::DecodeDelta(std::uint8_t value) const {
    int rawTick = 0;
    if (config_.relativeMode == EncoderRelativeMode::Signed7Bit) {
        rawTick = static_cast<int>(value) - 64;
    } else if (value > 64) {
        rawTick = 1;
    } else if (value < 64) {
        rawTick = -1;
    }
    if (rawTick == 0) {
        return std::nullopt;
    }
    return static_cast<float>(rawTick) * config_.turnStep;
}

} // namespace synth
```

Also add a private helper before `FindTurn`:

```cpp
namespace {
const synth::EncoderMidiMapping* FindMapping(const std::vector<synth::EncoderMidiMapping>& mappings,
                                             const synth::BasicMidi& midi) {
    for (const synth::EncoderMidiMapping& mapping : mappings) {
        if (mapping.control.channel == midi.Channel() && mapping.control.cc == midi.GetCC()) {
            return &mapping;
        }
    }
    return nullptr;
}
} // namespace
```

- [x] **Step 5: Update Makefile**

Modify `projects/synth/Makefile`:

```make
SRC := src/ParameterModulation.cpp src/MidiController.cpp
OBJ := $(patsubst src/%.cpp,$(BUILD_DIR)/%.o,$(SRC))

$(BUILD_DIR)/%.o: src/%.cpp include/synth/ParameterModulation.hpp include/synth/MidiController.hpp | $(BUILD_SENTINEL)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@
```

Keep `$(LIB): $(OBJ)` unchanged.

- [x] **Step 6: Run BasicMidi test**

Run: `make -C projects/synth test`

Expected: `midi_basic_cc_and_realtime_messages` passes; subsequent MIDI input tests are not written yet.

- [x] **Step 7: Add input processor tests**

Append tests:

```cpp
struct CountingMidiInProcessor : synth::MidiInProcessor {
    int count = 0;
    synth::BasicMidi last;
    void Process(const synth::BasicMidi& midi) override {
        ++count;
        last = midi;
    }
};

TEST_CASE(midi_encoder_input_maps_scaled_turns_pushes_and_timestamps) {
    synth::ParameterManager manager;
    synth::MessageInBus bus(&manager, 16);
    synth::EncoderMidiInConfig config = synth::EncoderMidiInConfig::TwisterDefault(1);
    config.turnStep = 0.01f;
    config.KeepFirstPositions(6);
    synth::EncoderMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 0; });

    processor.Process(synth::BasicMidi::CC(9999, 0, 5, 66));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.timestamp == 0);
    REQUIRE_TRUE(message.slotIx == 1);
    REQUIRE_TRUE(message.position == 5);
    REQUIRE_NEAR(message.delta, 0.02f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(9999, 1, 5, 127));
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamPush);
    REQUIRE_TRUE(message.slotIx == 1);
    REQUIRE_TRUE(message.position == 5);
}

TEST_CASE(midi_encoder_input_direction_only_zero_and_thru_behavior) {
    synth::MessageInBus bus(nullptr, 16);
    synth::EncoderMidiInConfig config;
    config.relativeMode = synth::EncoderRelativeMode::DirectionOnly;
    config.turnStep = 0.01f;
    config.turns.push_back({.control = {.channel = 0, .cc = 1}, .slotIx = 0, .position = 0});
    config.pushes.push_back({.control = {.channel = 1, .cc = 1}, .slotIx = 0, .position = 0});
    synth::EncoderMidiInProcessor processor(config, &bus);
    CountingMidiInProcessor thru;
    processor.SetThru(&thru);

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 1));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_NEAR(message.delta, -0.01f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 64));
    REQUIRE_TRUE(!bus.Pop(message, 0));

    processor.Process(synth::BasicMidi::CC(1, 1, 1, 0));
    REQUIRE_TRUE(!bus.Pop(message, 0));
    REQUIRE_TRUE(thru.count == 0);

    processor.Process(synth::BasicMidi::CC(1, 9, 9, 99));
    REQUIRE_TRUE(thru.count == 1);
    REQUIRE_TRUE(thru.last.Channel() == 9);
    REQUIRE_TRUE(thru.last.GetCC() == 9);
}
```

- [x] **Step 8: Run tests**

Run: `make -C projects/synth test`

Expected: all tests pass.

- [x] **Step 9: Verify Smart Grid Wrld.Bldr input source**

Run:

```bash
sed -n '1,90p' /Users/joyo/theallelectricsmartgrid/private/src/WrldBLDRMidi.hpp
sed -n '1,70p' /Users/joyo/theallelectricsmartgrid/private/src/EncoderMidi.hpp
```

Expected: `WrldBLDRMidi::FromMidi` delegates channels `0` and `1` to `EncoderMidi::FromMidi`, and `EncoderMidi::FromMidi` maps channel `0` CC values by `value - 64` and channel `1` nonzero values to push. If this differs, update `WrldBldrDefault` and tests before continuing.

### Task 1 Review

- [x] **Step 10: xagent Claude spec review**

Run `node projects/xagent/dist/src/main.js run --harness claude_code --subagent "<prompt>"` with a prompt naming Task 1, the OpenSpec requirements spm-29 through spm-32, changed files, and test output. Require `Approval: approved` before proceeding.

- [x] **Step 11: xagent Claude code-quality review**

Run xagent Claude again with a code-quality prompt focused on `MidiController.hpp/.cpp`, tests, and Makefile. Fix any Important/Critical findings and re-review.

---

### Task 2: Core MIDI Output Sender And Processors

**Files:**
- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Test: `projects/synth/tests/parameter_modulation_tests.cpp`
- Reference: `/Users/joyo/theallelectricsmartgrid/private/src/EncoderMidi.hpp`
- Reference: `/Users/joyo/theallelectricsmartgrid/private/src/WrldBLDRMidi.hpp`

- [x] **Step 1: Add failing output tests**

Append tests that create a fake sink:

```cpp
struct FakeMidiSink : synth::IMidiOutputSink {
    std::vector<synth::BasicMidi> sent;
    void Send(const synth::BasicMidi& midi) override { sent.push_back(midi); }
};

TEST_CASE(midi_sender_delivers_fifo_and_stops_cleanly) {
    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    sender.Enqueue(synth::BasicMidi::CC(0, 0, 1, 2));
    sender.Enqueue(synth::BasicMidi::CC(0, 0, 3, 4));
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 2);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 1);
    REQUIRE_TRUE(sink.sent[1].GetCC() == 3);
}
```

Expected initially: compile failure because `IMidiOutputSink` and `MidiSender` do not exist.

- [x] **Step 2: Extend header with output APIs**

Add to `MidiController.hpp`:

```cpp
class IMidiOutputSink {
public:
    virtual ~IMidiOutputSink() = default;
    virtual void Send(const BasicMidi& midi) = 0;
};

class MidiSender {
public:
    MidiSender() = default;
    ~MidiSender();

    void SetSink(IMidiOutputSink* sink);
    void Start();
    void Stop();
    bool Enqueue(const BasicMidi& midi);
    void FlushForTests(std::chrono::milliseconds timeout);

private:
    void Run();

    std::mutex mutex_;
    std::condition_variable cv_;
    std::vector<BasicMidi> queue_;
    IMidiOutputSink* sink_ = nullptr;
    std::thread worker_;
    bool running_ = false;
    bool stopRequested_ = false;
};

struct MidiOutputMapping {
    std::size_t slotIx = 0;
    std::size_t position = 0;
    std::uint8_t cc = 0;
};

struct EncoderMidiOutConfig {
    std::vector<MidiOutputMapping> mappings;
    std::size_t budget = 256;

    static EncoderMidiOutConfig TwisterDefault(std::size_t slotIx);
    static EncoderMidiOutConfig WrldBldrDefault(std::size_t slotIx);
    void KeepFirstPositions(std::size_t count);
};

struct MidiCellSnapshot {
    bool valid = false;
    bool connected = false;
    float value = 0.0f;
    Color parameterColor = Color::Off;
    Color indicatorColor = Color::Off;
};

std::optional<MidiCellSnapshot> LoadMidiCellSnapshot(const Parameter::UIState& state);
std::uint8_t ColorToTwister(Color color);
std::uint8_t FullBrightnessAnimationValue();

class MidiOutProcessor {
public:
    MidiOutProcessor(MidiSender* sender, const ParameterManager::UIState* uiState);
    virtual ~MidiOutProcessor() = default;
    void SetSender(MidiSender* sender);
    void SetUIState(const ParameterManager::UIState* uiState);
    virtual void Reset() = 0;
    virtual void Process() = 0;

protected:
    bool Send(const BasicMidi& midi);
    const Parameter::UIState* CellFor(const MidiOutputMapping& mapping) const;

    MidiSender* sender_ = nullptr;
    const ParameterManager::UIState* uiState_ = nullptr;
};
```

- [x] **Step 3: Implement sender and snapshot helper**

In `MidiController.cpp`, implement:

- `MidiSender::Start` starts one worker if not already running.
- `Stop` sets `stopRequested_`, notifies, joins if joinable, and is safe when called twice.
- `Enqueue` pushes under mutex and returns false only if stopped.
- `Run` waits on `cv_`, pops FIFO, copies `sink_` under the mutex, and calls `sink->Send(midi)` outside the lock.
- `FlushForTests` loops until queue is empty or timeout expires.
- `LoadMidiCellSnapshot` retries four times like `EncoderComponent::LoadSnapshot`, returns `std::nullopt` if revision remains odd/changed, returns `valid=false` for disconnected or zero voice count, and clamps voice-0 values to `[0,1]` for hardware bytes. Bipolar values should map to display-normalized `(value + 1) * 0.5`.

- [x] **Step 4: Add output processor tests**

Add tests:

```cpp
TEST_CASE(twister_output_debounces_reset_and_uses_channels) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 2, .maxParameters = 4});
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .shortName = "Cut", .defaultValue = 0.5f, .color = synth::Color::Green});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::TwisterDefault(0);
    config.KeepFirstPositions(1);
    synth::TwisterMidiOutProcessor processor(config, &sender, ui.get());
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[0].Channel() == 1);
    REQUIRE_TRUE(sink.sent[1].Channel() == 2);
    REQUIRE_TRUE(sink.sent[2].Channel() == 0);
    const std::size_t afterFirst = sink.sent.size();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == afterFirst);
    processor.Reset();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() > afterFirst);
    sender.Stop();
}
```

Add analogous Wrld.Bldr tests that assert:

- first value CC uses channel `0` and CC `0`,
- SysEx messages have bytes beginning `F0 79 74 78 00 01 00 20`,
- the channel byte is `1` for encoder button color and `0` for indicator color,
- final byte is `F7`,
- repeat processing with no UI changes sends nothing,
- reset re-renders.

- [x] **Step 5: Declare concrete output processors**

Add declarations:

```cpp
class TwisterMidiOutProcessor final : public MidiOutProcessor {
public:
    TwisterMidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, const ParameterManager::UIState* uiState);
    void Reset() override;
    void Process() override;
private:
    struct SentState { bool sent = false; bool connected = false; float value = 0.0f; Color color = Color::Off; };
    EncoderMidiOutConfig config_;
    std::vector<SentState> sent_;
};

class WrldBldrMidiOutProcessor final : public MidiOutProcessor {
public:
    WrldBldrMidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, const ParameterManager::UIState* uiState);
    void Reset() override;
    void Process() override;
private:
    struct SentState {
        bool sent = false;
        bool connected = false;
        float value = 0.0f;
        Color parameterColor = Color::Off;
        Color indicatorColor = Color::Off;
        std::uint8_t cooldown = 0;
    };
    void SendColorPacket(std::uint8_t channel, std::uint8_t cc, Color color);
    EncoderMidiOutConfig config_;
    std::vector<SentState> sent_;
};
```

- [x] **Step 6: Implement Twister output**

Use Smart Grid conventions from `EncoderMidiWriter`:

- Channel 1, CC position, value `ColorToTwister(snapshot.parameterColor)`.
- Channel 2, CC position, value `FullBrightnessAnimationValue()` where `FullBrightnessAnimationValue()` returns `47`.
- Channel 0, CC position, value `round(snapshot.value * 127)`.
- Send in color, brightness, value phase order on first render/reset.
- Skip disconnected cells with no sends.

Implement a compact `ColorToTwister` mapping using HSV hue buckets, with explicit `Off -> 0` and `White/Grey -> 64`; tests only need deterministic nonzero values for colored parameters.

- [x] **Step 7: Implement Wrld.Bldr output**

Port the encoder subset from Smart Grid `WrldBLDRMidi.hpp`:

- SysEx prefix: `F0 79 74 78 00 01 00 20`.
- After prefix write color-channel byte.
- For each color entry write `cc`, `r/2`, `g/2`, `b/2`.
- Terminate with `F7`.
- Use color channel `1` for parameter button color and `0` for indicator color.
- Value feedback uses CC channel `0`, mapped CC, `round(snapshot.value * 127)`.
- Honor `config_.budget`: each value or color entry consumes one budget unit; leave unsent changed state for the next `Process`.
- Decrement cooldowns per `Process` and skip color resend while cooldown is nonzero; set cooldown to `1` after sending a color.

- [x] **Step 8: Run tests**

Run: `make -C projects/synth test`

Expected: all synth tests pass, including sender lifecycle, Twister output, Wrld.Bldr output, debounce, reset, and unstable snapshot skip.

### Task 2 Review

- [x] **Step 9: xagent Claude spec review**

Use xagent Claude to review spm-34 through spm-36 against `MidiController` implementation and tests.

- [x] **Step 10: xagent Claude code-quality review**

Use xagent Claude to review thread lifecycle, locking, snapshot correctness, output debounce, and SysEx byte fidelity. Fix and re-review any Important/Critical findings.

---

### Task 3: JUCE MIDI Device Handlers

**Files:**
- Create: `projects/synth/juce/MidiHandlers.hpp`
- Modify: `projects/synth/miniapp/Makefile`
- Reference: `/Users/joyo/theallelectricsmartgrid/JUCE/SmartGridOne/Source/MidiHandlers.hpp`

- [x] **Step 1: Create JUCE MIDI handler header**

Create `projects/synth/juce/MidiHandlers.hpp`:

```cpp
#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

#include "synth/MidiController.hpp"

#include <memory>

namespace synth_juce {

class MidiInHandler final : private juce::MidiInputCallback {
public:
    explicit MidiInHandler(std::unique_ptr<synth::MidiInProcessor> processor = {});
    ~MidiInHandler() override;

    void SetProcessor(std::unique_ptr<synth::MidiInProcessor> processor);
    synth::MidiInProcessor* Processor() const { return processor_.get(); }
    bool Open(const juce::String& deviceIdentifier);
    void Close();
    bool IsOpen() const { return midiInput_ != nullptr; }
    juce::String DeviceName() const { return deviceName_; }
    juce::String LastError() const { return lastError_; }

private:
    void handleIncomingMidiMessage(juce::MidiInput* source, const juce::MidiMessage& message) override;

    std::unique_ptr<synth::MidiInProcessor> processor_;
    std::unique_ptr<juce::MidiInput> midiInput_;
    juce::String deviceName_;
    juce::String lastError_;
};

class MidiOutputSink final : public synth::IMidiOutputSink {
public:
    bool Open(const juce::String& deviceIdentifier);
    void Close();
    bool IsOpen() const { return midiOutput_ != nullptr; }
    juce::String DeviceName() const { return deviceName_; }
    juce::String LastError() const { return lastError_; }
    void Send(const synth::BasicMidi& midi) override;

private:
    std::mutex mutex_;
    std::unique_ptr<juce::MidiOutput> midiOutput_;
    juce::String deviceName_;
    juce::String lastError_;
};

} // namespace synth_juce
```

- [x] **Step 2: Implement inline methods**

In the same header, implement methods inline:

- `MidiInHandler::Open` closes any current input, calls `juce::MidiInput::openDevice(deviceIdentifier, this)`, stores `lastError_` on failure, stores name and starts input on success.
- `handleIncomingMidiMessage` returns early if `processor_ == nullptr`.
- For 3-byte messages: `processor_->Process(synth::BasicMidi(timestampUs, raw[0], raw[1], raw[2]))`.
- For 1-byte supported realtime messages: `processor_->Process(synth::BasicMidi::Realtime(timestampUs, raw[0]))`.
- `MidiOutputSink::Send` locks, returns if closed, constructs `juce::MidiMessage(midi.raw.data(), static_cast<int>(midi.Size()))`, sends now.

Use:

```cpp
const auto timestampUs = static_cast<std::uint64_t>(message.getTimeStamp() * 1000.0 * 1000.0);
```

- [x] **Step 3: Update miniapp Makefile dependencies**

Ensure `SYNTH_JUCE_HEADERS := $(wildcard $(SYNTH_ROOT)/juce/*.hpp)` already captures `MidiHandlers.hpp`. Update `SYNTH_SRC` to include the new core MIDI source:

```make
SYNTH_SRC := $(SYNTH_ROOT)/src/ParameterModulation.cpp $(SYNTH_ROOT)/src/MidiController.cpp
SYNTH_HEADER := $(SYNTH_ROOT)/include/synth/ParameterModulation.hpp $(SYNTH_ROOT)/include/synth/MidiController.hpp
```

- [x] **Step 4: Build miniapp tests**

Run: `make -C projects/synth/miniapp test`

Expected when `~/JUCE` exists: geometry and demo modulation tests pass. If `~/JUCE` is absent, the command should fail with the documented missing-JUCE message.

### Task 3 Review

- [x] **Step 5: xagent Claude spec review**

Ask Claude to review spm-33 and task 4.4 against `MidiHandlers.hpp` and the miniapp Makefile.

- [x] **Step 6: xagent Claude code-quality review**

Ask Claude to review JUCE device lifetime, callback thread behavior, locking, and source timestamp conversion. Fix and re-review important findings.

---

### Task 4: Miniapp MIDI Configuration And Wiring

**Files:**
- Modify: `projects/synth/miniapp/Main.cpp`
- Modify: `projects/synth/miniapp/Makefile` if dependency gaps appear

- [x] **Step 1: Include MIDI headers and add fields**

In `Main.cpp`, add:

```cpp
#include "MidiHandlers.hpp"
#include "synth/MidiController.hpp"
```

Add fields to `MainComponent`:

```cpp
enum class ControllerPreset { Twister, WrldBldr };

synth::MessageInBus midiBus_{&manager_};
synth::MidiSender midiSender_;
synth_juce::MidiInHandler midiIn_;
synth_juce::MidiOutputSink midiOutSink_;
std::unique_ptr<synth::MidiOutProcessor> midiOutProcessor_;
ControllerPreset controllerPreset_ = ControllerPreset::Twister;
juce::ComboBox presetBox_;
juce::ComboBox midiInputBox_;
juce::ComboBox midiOutputBox_;
juce::TextButton openMidiInputButton_;
juce::TextButton closeMidiInputButton_;
juce::TextButton openMidiOutputButton_;
juce::TextButton closeMidiOutputButton_;
juce::Label midiStatusLabel_;
```

- [x] **Step 2: Add config helper methods**

Add private methods:

```cpp
void refreshMidiDeviceLists();
void configureMidiProcessors();
synth::EncoderMidiInConfig currentInputConfig() const;
synth::EncoderMidiOutConfig currentOutputConfig() const;
void openSelectedMidiInput();
void openSelectedMidiOutput();
void closeMidiInput();
void closeMidiOutput();
void updateMidiStatus();
```

Implementation details:

- `currentInputConfig` selects `TwisterDefault(0)` or `WrldBldrDefault(0)`, then `KeepFirstPositions(encoders_.size())`.
- `currentOutputConfig` selects matching output default and trims to three positions.
- `configureMidiProcessors` creates `EncoderMidiInProcessor`, sets timestamp provider `[] { return 0; }`, binds it to `midiBus_`, installs it in `midiIn_`, creates the matching `TwisterMidiOutProcessor` or `WrldBldrMidiOutProcessor`, and calls `Reset`.
- `openSelectedMidiInput` reads `midiInputBox_.getSelectedId() - 1`, maps it to `juce::MidiInput::getAvailableDevices()`, and opens by `.identifier`.
- `openSelectedMidiOutput` opens the selected output, calls `midiSender_.SetSink(&midiOutSink_)`, `midiSender_.Start()`, and resets the output processor.
- `closeMidiOutput` closes the sink and calls `midiSender_.Stop()`.

- [x] **Step 3: Wire controls in constructor**

In `MainComponent()` after encoder setup:

```cpp
presetBox_.addItem("Twister", 1);
presetBox_.addItem("Wrld.Bldr", 2);
presetBox_.setSelectedId(1);
presetBox_.onChange = [this] {
    controllerPreset_ = presetBox_.getSelectedId() == 2 ? ControllerPreset::WrldBldr : ControllerPreset::Twister;
    configureMidiProcessors();
};
addAndMakeVisible(presetBox_);
addAndMakeVisible(midiInputBox_);
addAndMakeVisible(midiOutputBox_);
addButton(openMidiInputButton_, "Open In", [this] { openSelectedMidiInput(); });
addButton(closeMidiInputButton_, "Close In", [this] { closeMidiInput(); });
addButton(openMidiOutputButton_, "Open Out", [this] { openSelectedMidiOutput(); });
addButton(closeMidiOutputButton_, "Close Out", [this] { closeMidiOutput(); });
addAndMakeVisible(midiStatusLabel_);
refreshMidiDeviceLists();
configureMidiProcessors();
```

- [x] **Step 4: Layout controls**

Increase window size to `920 x 460`. In `resized`, add a top MIDI config row below the title:

```cpp
auto midiRow = area.removeFromTop(36);
presetBox_.setBounds(midiRow.removeFromLeft(120).reduced(4));
midiInputBox_.setBounds(midiRow.removeFromLeft(180).reduced(4));
openMidiInputButton_.setBounds(midiRow.removeFromLeft(80).reduced(4));
closeMidiInputButton_.setBounds(midiRow.removeFromLeft(80).reduced(4));
midiOutputBox_.setBounds(midiRow.removeFromLeft(180).reduced(4));
openMidiOutputButton_.setBounds(midiRow.removeFromLeft(85).reduced(4));
closeMidiOutputButton_.setBounds(midiRow.removeFromLeft(85).reduced(4));
midiStatusLabel_.setBounds(midiRow.reduced(4));
```

Keep the rest of the UI functional and avoid nested cards.

- [x] **Step 5: Drain both buses and process MIDI output**

In `timerCallback`:

```cpp
const std::uint64_t processTimestamp = nextTimestamp_++;
bus_.Process(processTimestamp);
midiBus_.Process(processTimestamp);
```

Replace the existing single `bus_.Process(nextTimestamp_++);`.

After `manager_.PopulateUIState(*uiState_);`, add:

```cpp
if (midiOutProcessor_ != nullptr) {
    midiOutProcessor_->Process();
}
```

- [x] **Step 6: Add destructor cleanup**

Add:

```cpp
~MainComponent() override {
    closeMidiInput();
    closeMidiOutput();
}
```

- [x] **Step 7: Build miniapp**

Run: `make -C projects/synth miniapp`

Expected when `~/JUCE` exists: app bundle builds. If `~/JUCE` is absent, documented missing-JUCE error.

### Task 4 Review

- [x] **Step 8: xagent Claude spec review**

Ask Claude to review spm-37 and the miniapp tasks against `Main.cpp`.

- [x] **Step 9: xagent Claude code-quality review**

Ask Claude to review UI wiring, bus isolation, device lifecycle, timer ordering, and output processing. Fix and re-review important findings.

---

### Task 5: Verification And OpenSpec Sync

**Files:**
- Modify: `openspec/changes/add-synth-midi-controller-io/tasks.md`
- Possibly modify: `projects/synth/README.md` or `projects/synth/miniapp/README.md` only if implementation adds user-facing commands not already discoverable in UI.

- [x] **Step 1: Full synth tests**

Run: `make -C projects/synth test`

Expected: all tests pass.

- [x] **Step 2: JUCE miniapp tests**

Run: `make -C projects/synth/miniapp test`

Expected when `~/JUCE` exists: both miniapp test binaries pass. If missing, record exact missing-JUCE output.

- [x] **Step 3: Miniapp build**

Run: `make -C projects/synth miniapp`

Expected when `~/JUCE` exists: app bundle builds. If missing, record exact missing-JUCE output.

- [x] **Step 4: Optional hardware smoke**

If a MIDI controller is available, launch `projects/synth/miniapp/build/SynthMiniapp.app`, select Twister or Wrld.Bldr, open input, turn CC 0, press CC 0, open output, and verify hardware feedback. If no hardware is available, record "not run: no MIDI hardware available" and do not mark this as a test failure.

Outcome: not run in this session; no physical Twister/Wrld.Bldr controller was available to the agent.

- [x] **Step 5: Mark OpenSpec tasks complete**

After implementation, reviews, and verification pass, update every checkbox in `openspec/changes/add-synth-midi-controller-io/tasks.md` from `- [x]` to `- [x]`.

- [x] **Step 6: Validate OpenSpec**

Run:

```bash
openspec validate add-synth-midi-controller-io
openspec status --change add-synth-midi-controller-io
```

Expected: valid, all tasks complete.

- [x] **Step 7: Final xagent Claude review**

Use xagent Claude for a final whole-change review covering OpenSpec requirements spm-29 through spm-37, all changed files, and verification output. Fix any Critical/Important findings and re-review.

---

## Self-Review Checklist

- spm-29 maps to Task 1 `BasicMidi` tests and implementation.
- spm-30 through spm-32 map to Task 1 input processor config, timestamp provider, presets, Smart Grid verification, and tests.
- spm-33 maps to Task 3 JUCE input handler.
- spm-34 through spm-36 map to Task 2 sender, output processors, snapshot helper, Twister/Wrld.Bldr tests.
- spm-37 maps to Task 4 miniapp UI, bus isolation, device lifecycle, and output processing.
- Verification and OpenSpec task synchronization map to Task 5.
- No `TODO`, `TBD`, or unspecified placeholders remain; optional hardware smoke has an explicit no-hardware outcome.
