#pragma once

#include "synth/ParameterModulation.hpp"

#include <chrono>
#include <condition_variable>
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
    static constexpr std::uint8_t kStatusNoteOff = 0x80;
    static constexpr std::uint8_t kStatusNote = 0x90;
    static constexpr std::uint8_t kStatusCC = 0xB0;
    static constexpr std::uint8_t kStatusPitchBend = 0xE0;
    static constexpr std::uint8_t kStatusClock = 0xF8;
    static constexpr std::uint8_t kStatusTransportStart = 0xFA;
    static constexpr std::uint8_t kStatusTransportContinue = 0xFB;
    static constexpr std::uint8_t kStatusTransportStop = 0xFC;

    std::uint64_t timestamp = 0;
    std::vector<std::uint8_t> raw;

    BasicMidi() = default;
    BasicMidi(std::uint64_t timestamp, std::uint8_t status, std::uint8_t data1, std::uint8_t data2);
    BasicMidi(std::uint64_t timestamp, std::vector<std::uint8_t> bytes);

    static BasicMidi CC(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, std::uint8_t value);
    static BasicMidi Note(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note, std::uint8_t velocity);
    static BasicMidi NoteOff(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note);
    static BasicMidi PitchBend(std::uint64_t timestamp, std::uint8_t channel, std::uint16_t value);
    static BasicMidi Realtime(std::uint64_t timestamp, std::uint8_t status);
    static BasicMidi Clock(std::uint64_t timestamp);
    static BasicMidi TransportStart(std::uint64_t timestamp);
    static BasicMidi TransportContinue(std::uint64_t timestamp);
    static BasicMidi TransportStop(std::uint64_t timestamp);
    static BasicMidi SysEx(std::uint64_t timestamp, std::vector<std::uint8_t> bytes);
    static bool IsSupportedRealtimeStatus(std::uint8_t status);

    std::uint8_t Status() const;
    std::uint8_t Channel() const;
    std::uint8_t GetCC() const;
    std::uint8_t GetNote() const;
    std::uint8_t GetValue() const;
    std::uint16_t GetPitchBend() const;
    std::size_t Size() const { return raw.size(); }
    bool IsCC() const { return Status() == kStatusCC && raw.size() >= 3; }
    bool IsSysEx() const { return raw.size() >= 2 && raw.front() == 0xF0 && raw.back() == 0xF7; }
};

class MidiInProcessor {
public:
    using TimestampProvider = std::function<std::uint64_t()>;

    explicit MidiInProcessor(MessageInBus* bus = nullptr);
    virtual ~MidiInProcessor() = default;

    void SetMessageInBus(MessageInBus* bus) { bus_ = bus; }
    void SetThru(MidiInProcessor* thru) { thru_ = thru; }
    void SetTimestampProvider(TimestampProvider provider) { timestampProvider_ = std::move(provider); }
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

struct AnalogMidiMapping {
    MidiControlAddress control;
    std::size_t gestureIx = 0;
};

struct AnalogMidiInConfig {
    std::vector<AnalogMidiMapping> gestures;
    std::optional<MidiControlAddress> sceneBlend;
};

class AnalogMidiInProcessor final : public MidiInProcessor {
public:
    AnalogMidiInProcessor(AnalogMidiInConfig config, MessageInBus* bus = nullptr);

    void SetConfig(AnalogMidiInConfig config);
    const AnalogMidiInConfig& Config() const { return config_; }
    void Process(const BasicMidi& midi) override;

private:
    const AnalogMidiMapping* FindGesture(const BasicMidi& midi) const;

    AnalogMidiInConfig config_;
};

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

struct SystemButtonMidiAssociation {
    std::optional<MidiControlAddress> control;
    std::optional<LaunchpadGridPosition> launchpadPosition;
    MessageIn press;
    std::optional<MessageIn> release;
};

struct SystemButtonMidiInConfig {
    std::vector<SystemButtonMidiAssociation> associations;
};

class SystemButtonMidiInProcessor final : public MidiInProcessor {
public:
    SystemButtonMidiInProcessor(SystemButtonMidiInConfig config, MessageInBus* bus = nullptr);

    void SetConfig(SystemButtonMidiInConfig config);
    const SystemButtonMidiInConfig& Config() const { return config_; }
    void Process(const BasicMidi& midi) override;

private:
    const SystemButtonMidiAssociation* FindAssociation(const BasicMidi& midi) const;
    void PushStamped(MessageIn message);

    SystemButtonMidiInConfig config_;
};

struct IMidiOutputSink {
    virtual ~IMidiOutputSink() = default;
    virtual void Send(const BasicMidi& midi) = 0;
};

class MidiOutputProcessor {
public:
    virtual ~MidiOutputProcessor() = default;
    virtual void Reset() = 0;
    virtual void Process() = 0;
};

class MidiSender {
public:
    explicit MidiSender(std::size_t capacity = 4096);
    ~MidiSender();

    MidiSender(const MidiSender&) = delete;
    MidiSender& operator=(const MidiSender&) = delete;

    void SetSink(IMidiOutputSink* sink);
    void Start();
    void Stop();
    bool Enqueue(const BasicMidi& midi);
    bool IsRunning() const;
    bool FlushForTests(std::chrono::milliseconds timeout);

private:
    void Run();

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::condition_variable drainedCv_;
    std::vector<BasicMidi> queue_;
    std::size_t head_ = 0;
    std::size_t size_ = 0;
    std::size_t inFlight_ = 0;
    bool running_ = false;
    bool stopRequested_ = false;
    IMidiOutputSink* sink_ = nullptr;
    std::thread thread_;
};

struct EncoderMidiOutMapping {
    std::size_t slotIx = 0;
    std::size_t position = 0;
    std::uint8_t cc = 0;
};

struct EncoderMidiOutConfig {
    std::vector<EncoderMidiOutMapping> mappings;
    std::size_t wrldBldrColorBudgetPerProcess = 4;

    static EncoderMidiOutConfig TwisterDefault(std::size_t slotIx);
    static EncoderMidiOutConfig WrldBldrDefault(std::size_t slotIx);
    void KeepFirstPositions(std::size_t count);
};

class MidiOutProcessor : public MidiOutputProcessor {
public:
    MidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState);
    virtual ~MidiOutProcessor() = default;

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { uiState_ = uiState; }
    void SetConfig(EncoderMidiOutConfig config);
    const EncoderMidiOutConfig& Config() const { return config_; }

    void Reset() override;

protected:
    struct CellSnapshot {
        bool connected = false;
        bool bipolar = false;
        std::size_t voiceCount = 0;
        float value = 0.0f;
        Color color = Color::Off;
        Color indicatorColor = Color::Off;
    };

    std::optional<CellSnapshot> LoadCellSnapshot(const EncoderMidiOutMapping& mapping) const;
    bool Enqueue(const BasicMidi& midi);
    static float NormalizeForDisplay(float value, bool bipolar);

    EncoderMidiOutConfig config_;
    MidiSender* sender_ = nullptr;
    ParameterManager::UIState* uiState_ = nullptr;
};

class TwisterMidiOutProcessor final : public MidiOutProcessor {
public:
    using MidiOutProcessor::MidiOutProcessor;

    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        std::uint8_t value = 0;
        std::uint8_t color = 0;
        std::uint8_t brightness = 0;
    };

    std::vector<CacheEntry> cache_;
};

class WrldBldrMidiOutProcessor final : public MidiOutProcessor {
public:
    using MidiOutProcessor::MidiOutProcessor;

    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        std::uint8_t value = 0;
        Color buttonColor = Color::Off;
        Color indicatorColor = Color::Off;
        bool pendingButtonColor = false;
        bool pendingIndicatorColor = false;
    };

    std::vector<CacheEntry> cache_;
};

struct SystemMessageOutputState {
    Color color = Color::Off;
    bool isOn = false;
};

class SystemMessageOutputInfo {
public:
    explicit SystemMessageOutputInfo(ParameterManager::UIState* uiState = nullptr);

    void SetUIState(ParameterManager::UIState* uiState) { uiState_ = uiState; }
    ParameterManager::UIState* UIState() const { return uiState_; }
    SystemMessageOutputState Evaluate(const MessageIn& message) const;

private:
    Color GestureColor(std::size_t gestureIx) const;
    ParameterManager::UIState* uiState_ = nullptr;
};

struct SystemCcMidiOutAssociation {
    MidiControlAddress control;
    MessageIn message;
};

struct SystemCcMidiOutConfig {
    std::vector<SystemCcMidiOutAssociation> associations;
};

class SystemCcMidiOutProcessor final : public MidiOutputProcessor {
public:
    SystemCcMidiOutProcessor(SystemCcMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetConfig(SystemCcMidiOutConfig config);
    const SystemCcMidiOutConfig& Config() const { return config_; }
    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        bool isOn = false;
    };

    bool Enqueue(const BasicMidi& midi);

    SystemCcMidiOutConfig config_;
    MidiSender* sender_ = nullptr;
    SystemMessageOutputInfo info_;
    std::vector<CacheEntry> cache_;
};

struct WrldBldrSystemPosition {
    std::uint8_t channel = 0;
    std::uint8_t x = 0;
    std::uint8_t y = 0;
};

struct WrldBldrSystemMidiOutAssociation {
    WrldBldrSystemPosition position;
    MessageIn message;
};

struct WrldBldrSystemMidiOutConfig {
    std::vector<WrldBldrSystemMidiOutAssociation> associations;
};

class WrldBldrSystemMidiOutProcessor final : public MidiOutputProcessor {
public:
    WrldBldrSystemMidiOutProcessor(WrldBldrSystemMidiOutConfig config, MidiSender* sender,
                                   ParameterManager::UIState* uiState);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetConfig(WrldBldrSystemMidiOutConfig config);
    const WrldBldrSystemMidiOutConfig& Config() const { return config_; }
    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        Color color = Color::Off;
    };

    bool Enqueue(const BasicMidi& midi);

    WrldBldrSystemMidiOutConfig config_;
    MidiSender* sender_ = nullptr;
    SystemMessageOutputInfo info_;
    std::vector<CacheEntry> cache_;
};

struct LaunchpadGridMidiOutAssociation {
    LaunchpadGridPosition position;
    MessageIn message;
};

struct LaunchpadGridMidiOutConfig {
    std::vector<LaunchpadGridMidiOutAssociation> associations;
};

class LaunchpadGridMidiOutProcessor final : public MidiOutputProcessor {
public:
    LaunchpadGridMidiOutProcessor(LaunchpadGridMidiOutConfig config, MidiSender* sender,
                                  ParameterManager::UIState* uiState);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetConfig(LaunchpadGridMidiOutConfig config);
    const LaunchpadGridMidiOutConfig& Config() const { return config_; }
    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        Color color = Color::Off;
    };

    bool Enqueue(const BasicMidi& midi);

    LaunchpadGridMidiOutConfig config_;
    MidiSender* sender_ = nullptr;
    SystemMessageOutputInfo info_;
    std::vector<CacheEntry> cache_;
};

struct MidiControllerSystemMessageAssociation {
    std::optional<MidiControlAddress> control;
    std::optional<WrldBldrSystemPosition> wrldBldrPosition;
    std::optional<LaunchpadGridPosition> launchpadPosition;
    MessageIn press;
    std::optional<MessageIn> release;
    MessageIn feedback;
};

struct MidiControllerProfileConfig {
    std::optional<EncoderMidiInConfig> encoderInput;
    std::optional<EncoderMidiOutConfig> encoderOutput;
    std::optional<AnalogMidiInConfig> analogInput;
    std::vector<MidiControllerSystemMessageAssociation> systemMessages;
};

struct MidiControllerProfileResult {
    std::unique_ptr<MidiInProcessor> input;
    std::vector<std::unique_ptr<MidiInProcessor>> inputThru;
    std::vector<std::unique_ptr<MidiOutputProcessor>> outputs;
};

MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});

struct WrldBldrDefaultProfileOptions {
    std::size_t slotIx = 0;
    std::size_t visibleEncoderCount = 16;
    std::size_t sceneCount = 8;
    std::size_t bankButtonCount = 16;
    std::size_t gestureSelectorCount = 0;
};

MidiControllerProfileConfig WrldBldrDefaultProfileConfig(WrldBldrDefaultProfileOptions options = {});
MidiControllerProfileResult CreateWrldBldrDefaultProfile(
    WrldBldrDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});

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

JSON ToJSON(JsonArena& arena, EncoderRelativeMode value);
bool FromJSON(JSON json, EncoderRelativeMode& value);
JSON ToJSON(JsonArena& arena, const MidiControlAddress& value);
bool FromJSON(JSON json, MidiControlAddress& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiMapping& value);
bool FromJSON(JSON json, EncoderMidiMapping& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiInConfig& value);
bool FromJSON(JSON json, EncoderMidiInConfig& value);
JSON ToJSON(JsonArena& arena, const AnalogMidiMapping& value);
bool FromJSON(JSON json, AnalogMidiMapping& value);
JSON ToJSON(JsonArena& arena, const AnalogMidiInConfig& value);
bool FromJSON(JSON json, AnalogMidiInConfig& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiOutMapping& value);
bool FromJSON(JSON json, EncoderMidiOutMapping& value);
JSON ToJSON(JsonArena& arena, const EncoderMidiOutConfig& value);
bool FromJSON(JSON json, EncoderMidiOutConfig& value);
JSON ToJSON(JsonArena& arena, const MessageIn& value);
bool FromJSON(JSON json, MessageIn& value);
JSON ToJSON(JsonArena& arena, const WrldBldrSystemPosition& value);
bool FromJSON(JSON json, WrldBldrSystemPosition& value);
JSON ToJSON(JsonArena& arena, LaunchpadController value);
bool FromJSON(JSON json, LaunchpadController& value);
JSON ToJSON(JsonArena& arena, const LaunchpadGridPosition& value);
bool FromJSON(JSON json, LaunchpadGridPosition& value);
JSON ToJSON(JsonArena& arena, const MidiControllerSystemMessageAssociation& value);
bool FromJSON(JSON json, MidiControllerSystemMessageAssociation& value);
JSON ToJSON(JsonArena& arena, const MidiControllerProfileConfig& value);
bool FromJSON(JSON json, MidiControllerProfileConfig& value);

std::uint8_t EncoderPositionToCC(std::size_t position);
std::uint8_t WrldBldrPositionToCC(std::uint8_t x, std::uint8_t y);
std::uint8_t ColorToTwister(Color color);
std::uint8_t FullBrightnessAnimationValue();
BasicMidi WrldBldrColorSysex(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, Color color);
BasicMidi LaunchpadColorSysex(std::uint64_t timestamp, LaunchpadController controller, int x, int y, Color color);

} // namespace synth
