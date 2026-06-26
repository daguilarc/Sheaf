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

struct IMidiOutputSink {
    virtual ~IMidiOutputSink() = default;
    virtual void Send(const BasicMidi& midi) = 0;
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

class MidiOutProcessor {
public:
    MidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState);
    virtual ~MidiOutProcessor() = default;

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { uiState_ = uiState; }
    void SetConfig(EncoderMidiOutConfig config);
    const EncoderMidiOutConfig& Config() const { return config_; }

    virtual void Reset();
    virtual void Process() = 0;

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

std::uint8_t EncoderPositionToCC(std::size_t position);
std::uint8_t ColorToTwister(Color color);
std::uint8_t FullBrightnessAnimationValue();
BasicMidi WrldBldrColorSysex(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, Color color);

} // namespace synth
