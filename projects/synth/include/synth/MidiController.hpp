#pragma once

#include "synth/ParameterModulation.hpp"
#include "synth/RuntimeUIState.hpp"

#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace synth {

struct BasicMidi {
    static constexpr std::uint8_t kStatusNoteOff = 0x80;
    static constexpr std::uint8_t kStatusNote = 0x90;
    static constexpr std::uint8_t kStatusPolyPressure = 0xA0;
    static constexpr std::uint8_t kStatusCC = 0xB0;
    static constexpr std::uint8_t kStatusChannelPressure = 0xD0;
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
    static BasicMidi PolyPressure(std::uint64_t timestamp, std::uint8_t channel,
                                  std::uint8_t note, std::uint8_t pressure);
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
    std::uint8_t GetPressure() const;
    std::uint8_t GetValue() const;
    std::uint16_t GetPitchBend() const;
    std::size_t Size() const { return raw.size(); }
    bool IsCC() const { return Status() == kStatusCC && raw.size() >= 3; }
    bool IsPolyPressure() const { return Status() == kStatusPolyPressure && raw.size() >= 3; }
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

enum class EncoderMode {
    Signed7Bit,
    DirectionOnly,
    Absolute,
};

class AbsoluteFeedbackCoordinator {
private:
    struct RouteRecord;

public:
    static constexpr std::size_t kMaxRoutes = 4096;

    struct RouteKey {
        std::size_t controllerSlot = 0;
        std::size_t parameterSlot = 0;
        std::size_t position = 0;

        bool operator==(const RouteKey& other) const = default;
    };

    class RouteReservation {
    public:
        RouteReservation() = default;
        bool IsTracked() const { return index_ < kMaxRoutes; }
        bool operator==(const RouteReservation& other) const = default;

    private:
        friend class AbsoluteFeedbackCoordinator;
        explicit RouteReservation(std::size_t index)
            : index_(index) {}

        std::size_t index_ = kMaxRoutes;
    };

    struct Expectation {
        std::uint64_t epoch = 0;
        std::uint8_t receivedValue = 0;
        bool pending = false;

        bool operator==(const Expectation& other) const = default;
    };

    class InputAlert {
    public:
        bool IsPublished() const { return published_; }
        std::uint64_t Epoch() const { return published_ ? epoch_ : 0; }

    private:
        friend class AbsoluteFeedbackCoordinator;
        RouteReservation route_;
        Expectation previous_;
        std::uint64_t epoch_ = 0;
        bool published_ = false;
    };

    class RouteGuard {
    public:
        RouteGuard(const RouteGuard&) = delete;
        RouteGuard& operator=(const RouteGuard&) = delete;
        ~RouteGuard();

        bool IsTracked() const { return record_ != nullptr; }
        Expectation Snapshot() const;
        bool Resolve(std::uint64_t expectedEpoch);

    private:
        friend class AbsoluteFeedbackCoordinator;
        explicit RouteGuard(RouteRecord* record);
        void Publish(std::uint64_t epoch, std::uint8_t receivedValue);
        void Restore(const Expectation& expectation);

        RouteRecord* record_ = nullptr;
    };

    RouteReservation ReserveRoute(RouteKey key);
    InputAlert BeginInput(RouteReservation route, std::uint8_t receivedValue);
    bool Rollback(const InputAlert& alert);
    std::optional<Expectation> Snapshot(RouteReservation route);
    RouteGuard GuardRoute(RouteReservation route);
    // Deterministic concurrency-test seam. Observing the existing guard does
    // not add work to normal alert/output critical sections.
    bool RouteGuardHeldForTests(RouteReservation route) const;

private:
    struct RouteRecord {
        std::atomic_flag guard = ATOMIC_FLAG_INIT;
        RouteKey key;
        Expectation expectation;
        bool occupied = false;
    };

    static std::size_t RouteHash(RouteKey key);
    std::uint64_t AllocateEpoch();

    std::array<RouteRecord, kMaxRoutes> routes_{};
    std::atomic_flag reservationGuard_ = ATOMIC_FLAG_INIT;
    std::atomic<std::uint64_t> nextEpoch_{1};
};

enum class MidiControlType { Cc, Note };

struct MidiControlAddress {
    std::uint8_t channel = 0;
    std::uint8_t cc = 0;
    MidiControlType type = MidiControlType::Cc;

    bool operator==(const MidiControlAddress& other) const = default;
};

struct EncoderMidiMapping {
    MidiControlAddress control;
    std::size_t slotIx = 0;
    std::size_t position = 0;
};

struct EncoderMidiInConfig {
    EncoderMode mode = EncoderMode::Signed7Bit;
    float turnStep = 1.0f / 128.0f;
    std::vector<EncoderMidiMapping> turns;
    std::vector<EncoderMidiMapping> pushes;

    static EncoderMidiInConfig TwisterDefault(std::size_t slotIx);
    static EncoderMidiInConfig WrldBldrDefault(std::size_t slotIx);
    void KeepFirstPositions(std::size_t count);
};

class EncoderMidiInProcessor final : public MidiInProcessor {
public:
    EncoderMidiInProcessor(EncoderMidiInConfig config, MessageInBus* bus = nullptr,
                           AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
                           std::size_t controllerSlot = 0);

    void SetConfig(EncoderMidiInConfig config);
    const EncoderMidiInConfig& Config() const { return config_; }
    void Process(const BasicMidi& midi) override;

private:
    const EncoderMidiMapping* FindTurn(const BasicMidi& midi) const;
    const EncoderMidiMapping* FindPush(const BasicMidi& midi) const;
    std::optional<float> DecodeDelta(std::uint8_t value) const;
    void ReserveAbsoluteRoutes();

    EncoderMidiInConfig config_;
    AbsoluteFeedbackCoordinator* absoluteFeedback_ = nullptr;
    std::size_t controllerSlot_ = 0;
    std::vector<AbsoluteFeedbackCoordinator::RouteReservation> absoluteTurnRoutes_;
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

inline bool operator==(const MessageIn& lhs, const MessageIn& rhs) {
    return lhs.timestamp == rhs.timestamp && lhs.type == rhs.type && lhs.slotIx == rhs.slotIx &&
           lhs.position == rhs.position && lhs.gestureIx == rhs.gestureIx && lhs.bankIx == rhs.bankIx &&
           lhs.sceneIx == rhs.sceneIx && lhs.value == rhs.value && lhs.delta == rhs.delta &&
           lhs.boolValue == rhs.boolValue && lhs.hasBoolValue == rhs.hasBoolValue &&
           lhs.gridSlotIx == rhs.gridSlotIx && lhs.gridIx == rhs.gridIx && lhs.gridX == rhs.gridX &&
           lhs.gridY == rhs.gridY && lhs.velocity == rhs.velocity;
}

struct MidiNoteAddress {
    std::uint8_t channel = 0;
    std::uint8_t note = 0;
    bool operator==(const MidiNoteAddress&) const = default;
};

struct PolyphonicPressureMapping {
    MidiNoteAddress address;
    MessageIn pressure;
    bool operator==(const PolyphonicPressureMapping&) const = default;
};

struct PolyphonicPressureMidiInConfig {
    std::vector<PolyphonicPressureMapping> mappings;
};

class PolyphonicPressureMidiInProcessor final : public MidiInProcessor {
public:
    PolyphonicPressureMidiInProcessor(PolyphonicPressureMidiInConfig config = {},
                                      MessageInBus* bus = nullptr);

    bool SetConfig(PolyphonicPressureMidiInConfig config);
    const PolyphonicPressureMidiInConfig& Config() const { return config_; }
    void Process(const BasicMidi& midi) override;

private:
    PolyphonicPressureMidiInConfig config_;
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
    static constexpr std::size_t kMaxSinks = 8;

    class QueueGuardForTests {
    public:
        QueueGuardForTests(QueueGuardForTests&&) = default;
        QueueGuardForTests& operator=(QueueGuardForTests&&) = default;
        void Release() { lock_.unlock(); }

    private:
        friend class MidiSender;
        explicit QueueGuardForTests(std::mutex& mutex)
            : lock_(mutex) {}

        std::unique_lock<std::mutex> lock_;
    };

    explicit MidiSender(std::size_t capacity = 4096);
    ~MidiSender();

    MidiSender(const MidiSender&) = delete;
    MidiSender& operator=(const MidiSender&) = delete;

    // nullptr clears the sink at sinkIx; sinkIx >= kMaxSinks is ignored. Does
    // NOT synchronize with an in-flight Send() on that sink -- a Send() the
    // worker already dequeued and started before this call may still be
    // executing against the old pointer after SetSink returns. Callers that
    // are about to destroy the sink object MUST use ClearSinkSync instead
    // (see its doc comment); SetSink remains safe for registering a new sink,
    // or clearing one whose destruction is not imminent.
    void SetSink(std::size_t sinkIx, IMidiOutputSink* sink);
    // Clears the sink at sinkIx (as SetSink(sinkIx, nullptr) would) and BLOCKS
    // until the worker thread is not, and will never again be, mid-Send() on
    // that sink. Guarantee: once ClearSinkSync returns, the worker will never
    // call that sink again -- it is then safe for the caller to destroy the
    // sink object. This synchronizes only against the specific sinkIx being
    // cleared; the worker remains free to run Send() for other sinks
    // concurrently with a ClearSinkSync call (Send() itself always executes
    // outside the lock). Safe to call from any thread; sinkIx >= kMaxSinks is
    // a no-op. Must not be called from within the sink's own Send()
    // implementation (the worker thread) -- that would deadlock waiting on
    // itself.
    void ClearSinkSync(std::size_t sinkIx);
    void Start();
    void Stop();
    // false when the queue is full or sinkIx >= kMaxSinks. A queued message
    // whose sink is null (or cleared before drain) at drain time is dropped
    // silently by the worker (smi-7 offline drop) — it does not block the
    // worker or affect other sinks' traffic.
    bool Enqueue(std::size_t sinkIx, const BasicMidi& midi);
    bool IsRunning() const;
    bool FlushForTests(std::chrono::milliseconds timeout);
    // Deterministic concurrency-test seam. It uses the sender's existing
    // queue mutex and leaves the production Enqueue path unchanged.
    QueueGuardForTests GuardQueueForTests() { return QueueGuardForTests(mutex_); }

private:
    struct QueueEntry {
        std::size_t sinkIx = 0;
        BasicMidi midi;
    };

    void Run();

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::condition_variable drainedCv_;
    // Notified whenever sendingSinkIx_ changes (a Send() begins or ends) --
    // separate from drainedCv_ (which only fires when the whole queue is
    // idle) so ClearSinkSync can wait on the narrower "not sending THIS sink
    // right now" condition without waiting for unrelated sinks' traffic to
    // drain too.
    std::condition_variable sendingCv_;
    std::vector<QueueEntry> queue_;
    std::size_t head_ = 0;
    std::size_t size_ = 0;
    std::size_t inFlight_ = 0;
    bool running_ = false;
    bool stopRequested_ = false;
    std::array<IMidiOutputSink*, kMaxSinks> sinks_{};
    // The sink index the worker is currently inside sink->Send() for, or
    // kMaxSinks when the worker is not in the middle of a Send() call. Set
    // (under mutex_) immediately before Send() is invoked (outside the lock)
    // and cleared (under mutex_, with sendingCv_ notified) immediately after
    // Send() returns. ClearSinkSync waits on sendingCv_ until this no longer
    // equals the sink it is clearing, which -- combined with clearing
    // sinks_[sinkIx] first, under the same lock -- guarantees the worker can
    // never dequeue a fresh entry for that sink after the clear either.
    std::size_t sendingSinkIx_ = kMaxSinks;
    std::thread thread_;
};

struct EncoderMidiOutMapping {
    std::size_t slotIx = 0;
    std::size_t position = 0;
    std::uint8_t cc = 0;
};

enum class EncoderMidiOutProtocol {
    WrldBldr,
    Twister,
};

struct EncoderMidiOutConfig {
    EncoderMidiOutProtocol protocol = EncoderMidiOutProtocol::WrldBldr;
    std::vector<EncoderMidiOutMapping> mappings;
    std::size_t wrldBldrColorBudgetPerProcess = 4;

    static EncoderMidiOutConfig TwisterDefault(std::size_t slotIx);
    static EncoderMidiOutConfig WrldBldrDefault(std::size_t slotIx);
    void KeepFirstPositions(std::size_t count);
};

class MidiOutProcessor : public MidiOutputProcessor {
public:
    MidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState,
                     std::size_t sinkIx = 0, EncoderMode feedbackMode = EncoderMode::Signed7Bit,
                     AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
                     std::size_t controllerSlot = 0);
    virtual ~MidiOutProcessor() = default;

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetUIState(ParameterManager::UIState* uiState) { uiState_ = uiState; }
    void SetSinkIx(std::size_t sinkIx) { sinkIx_ = sinkIx; }
    void SetConfig(EncoderMidiOutConfig config);
    const EncoderMidiOutConfig& Config() const { return config_; }

    void Reset() override;

protected:
    struct CellSnapshot {
        bool connected = false;
        bool bipolar = false;
        std::size_t voiceCount = 0;
        float value = 0.0f;
        float rawKnobValue = 0.0f;
        std::uint64_t processedAbsoluteEpoch = 0;
        Color baseColor = Color::Off;
        Color indicatorColor = Color::Off;
    };

    std::optional<CellSnapshot> LoadCellSnapshot(const EncoderMidiOutMapping& mapping) const;
    void ProcessPosition(std::size_t mappingIx, MidiControlAddress outputAddress,
                         const CellSnapshot& snapshot, bool blank,
                         bool& cacheValid, std::uint8_t& cachedValue);
    bool Enqueue(const BasicMidi& midi);
    static float NormalizeForDisplay(float value, bool bipolar);
    void ReserveAbsoluteRoutes();

    EncoderMidiOutConfig config_;
    MidiSender* sender_ = nullptr;
    ParameterManager::UIState* uiState_ = nullptr;
    // Sink index this processor's Enqueue() routes to (MidiSender::kMaxSinks
    // routing) -- the per-controller output-routing index
    // CreateMidiControllerProfile threads through from the engine's per-slot
    // rebuild. Defaults to 0 for every direct/legacy construction site that
    // predates per-controller routing.
    std::size_t sinkIx_ = 0;
    EncoderMode feedbackMode_ = EncoderMode::Signed7Bit;
    AbsoluteFeedbackCoordinator* absoluteFeedback_ = nullptr;
    std::size_t controllerSlot_ = 0;
    std::vector<AbsoluteFeedbackCoordinator::RouteReservation> absoluteRoutes_;
};

class GenericMidiOutProcessor final : public MidiOutProcessor {
public:
    GenericMidiOutProcessor(const EncoderMidiInConfig& input,
                            MidiSender* sender,
                            ParameterManager::UIState* uiState,
                            std::size_t sinkIx = 0,
                            AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
                            std::size_t controllerSlot = 0);

    void Reset() override;
    void Process() override;

private:
    struct Projection {
        EncoderMidiOutConfig config;
        std::vector<MidiControlAddress> outputAddresses;
        EncoderMode mode = EncoderMode::Signed7Bit;
    };

    struct CacheEntry {
        bool valid = false;
        std::uint8_t value = 0;
    };

    GenericMidiOutProcessor(Projection projection,
                            MidiSender* sender,
                            ParameterManager::UIState* uiState,
                            std::size_t sinkIx,
                            AbsoluteFeedbackCoordinator* absoluteFeedback,
                            std::size_t controllerSlot);
    static Projection ProjectInput(const EncoderMidiInConfig& input);
    // The projected mappings and full MIDI addresses are one immutable
    // construction-time unit; exposing the base reconfiguration API here
    // could let their indexes diverge.
    using MidiOutProcessor::SetConfig;

    std::vector<MidiControlAddress> outputAddresses_;
    std::vector<CacheEntry> cache_;
};

class TwisterMidiOutProcessor final : public MidiOutProcessor {
public:
    using MidiOutProcessor::MidiOutProcessor;

    void Reset() override;
    void Process() override;

private:
    struct CacheEntry {
        bool valid = false;
        bool encoderRingValueValid = false;
        std::uint8_t encoderRingValue = 0;
        std::uint8_t rgbColor = 0;
        std::uint8_t rgbBrightness = 0;
        std::uint8_t ringBrightness = 0;
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
        bool valueValid = false;
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
    SystemMessageOutputInfo() = default;
    explicit SystemMessageOutputInfo(RuntimeUIState* uiState);
    explicit SystemMessageOutputInfo(ParameterManager::UIState* uiState);

    void SetRuntimeUIState(RuntimeUIState* uiState) {
        uiState_ = uiState;
        compatibilityUIState_ = nullptr;
    }
    void SetUIState(ParameterManager::UIState* uiState) {
        uiState_ = nullptr;
        compatibilityUIState_ = uiState;
    }
    ParameterManager::UIState* UIState() const {
        return uiState_ != nullptr ? uiState_->parameters : compatibilityUIState_;
    }
    SystemMessageOutputState Evaluate(const MessageIn& message) const;

private:
    Color GestureColor(std::size_t gestureIx) const;
    RuntimeUIState* uiState_ = nullptr;
    ParameterManager::UIState* compatibilityUIState_ = nullptr;
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
    SystemCcMidiOutProcessor(SystemCcMidiOutConfig config, MidiSender* sender, RuntimeUIState* uiState,
                             std::size_t sinkIx = 0);
    SystemCcMidiOutProcessor(SystemCcMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState,
                             std::size_t sinkIx = 0);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetRuntimeUIState(RuntimeUIState* uiState) { info_.SetRuntimeUIState(uiState); }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetSinkIx(std::size_t sinkIx) { sinkIx_ = sinkIx; }
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
    std::size_t sinkIx_ = 0;
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
                                   RuntimeUIState* uiState, std::size_t sinkIx = 0);
    WrldBldrSystemMidiOutProcessor(WrldBldrSystemMidiOutConfig config, MidiSender* sender,
                                   ParameterManager::UIState* uiState, std::size_t sinkIx = 0);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetRuntimeUIState(RuntimeUIState* uiState) { info_.SetRuntimeUIState(uiState); }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetSinkIx(std::size_t sinkIx) { sinkIx_ = sinkIx; }
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
    std::size_t sinkIx_ = 0;
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
                                  RuntimeUIState* uiState, std::size_t sinkIx = 0);
    LaunchpadGridMidiOutProcessor(LaunchpadGridMidiOutConfig config, MidiSender* sender,
                                  ParameterManager::UIState* uiState, std::size_t sinkIx = 0);

    void SetSender(MidiSender* sender) { sender_ = sender; }
    void SetRuntimeUIState(RuntimeUIState* uiState) { info_.SetRuntimeUIState(uiState); }
    void SetUIState(ParameterManager::UIState* uiState) { info_.SetUIState(uiState); }
    void SetSinkIx(std::size_t sinkIx) { sinkIx_ = sinkIx; }
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
    std::size_t sinkIx_ = 0;
};

struct MidiControllerSystemMessageAssociation {
    std::optional<MidiControlAddress> control;
    std::optional<WrldBldrSystemPosition> wrldBldrPosition;
    std::optional<LaunchpadGridPosition> launchpadPosition;
    MessageIn press;
    std::optional<MessageIn> release;
    MessageIn feedback;
    bool outputFeedback = true;
};

struct MidiControllerProfileConfig {
    std::optional<EncoderMidiInConfig> encoderInput;
    std::optional<EncoderMidiOutConfig> encoderOutput;
    std::optional<AnalogMidiInConfig> analogInput;
    std::optional<PolyphonicPressureMidiInConfig> pressureInput;
    std::vector<MidiControllerSystemMessageAssociation> systemMessages;
};

struct MidiControllerProfileResult {
    std::unique_ptr<MidiInProcessor> input;
    std::vector<std::unique_ptr<MidiInProcessor>> inputThru;
    std::vector<std::unique_ptr<MidiOutputProcessor>> outputs;
};

enum class MidiProfileKind { WrldBldr, MfTwister, Launchpad, Generic };

const char* MidiProfileKindName(MidiProfileKind kind);
bool MidiProfileKindFromName(std::string_view name, MidiProfileKind& out);

struct MidiKindSupport {
    bool encoders;
    bool systemMessages;
    bool analogs;
};

MidiKindSupport KindSupport(MidiProfileKind kind);

struct MidiEndpointRef {
    std::string identifier;   // empty = unconfigured
    std::string name;         // device display name captured at match time
    bool IsConfigured() const { return !identifier.empty() || !name.empty(); }
};

struct MidiControllerSlot {
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiControllerProfileConfig config;
    MidiEndpointRef input;
    MidiEndpointRef output;
};

// Sections + address variants (Global Constraints matrices). Returns false and
// fills `reason` (for UI/status) when invalid.
bool SlotValidForKind(const MidiControllerSlot& slot, std::string* reason = nullptr);

struct MidiInstrumentConfig {
    std::vector<MidiControllerSlot> controllers;

    bool AddController(MidiControllerSlot slot);
    bool RenameController(std::size_t ix, std::string name);
    bool ReplaceController(std::size_t ix, MidiControllerSlot slot);
    void RemoveController(std::size_t ix);
    const MidiControllerSlot* FindController(std::string_view name) const;
};

// sinkIx: the MidiSender::kMaxSinks index every output processor built here
// enqueues to (see MidiOutputProcessor-derived classes' sinkIx_ member).
// Defaults to 0 for every caller that predates per-controller sink routing
// (the three whole-profile factories below, and every direct test call);
// Engine::RebuildMidiProcessors() is the only caller that passes a
// controller-slot-specific index. The optional coordinator/controllerSlot
// pair is likewise supplied by Engine: it is active only when encoderInput
// explicitly selects Absolute mode. Relative and output-only profiles keep
// their source-compatible, post-modulation feedback behavior. Engine also
// supplies profileKind so Generic input-only profiles can derive same-address
// position output; direct callers that omit it retain legacy behavior.
MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config, MessageInBus* bus, MidiSender* sender,
    RuntimeUIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {},
    std::size_t sinkIx = 0, AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
    std::size_t controllerSlot = 0,
    std::optional<MidiProfileKind> profileKind = std::nullopt);
MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {},
    std::size_t sinkIx = 0, AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
    std::size_t controllerSlot = 0,
    std::optional<MidiProfileKind> profileKind = std::nullopt);
MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config, MessageInBus* bus, MidiSender* sender,
    std::nullptr_t uiState, MidiInProcessor::TimestampProvider timestampProvider = {},
    std::size_t sinkIx = 0, AbsoluteFeedbackCoordinator* absoluteFeedback = nullptr,
    std::size_t controllerSlot = 0,
    std::optional<MidiProfileKind> profileKind = std::nullopt);

struct WrldBldrDefaultProfileOptions {
    std::size_t slotIx = 0;
    std::size_t visibleEncoderCount = 16;
    std::size_t sceneCount = 8;
    std::size_t bankButtonCount = 16;
    std::size_t gestureSelectorCount = 1;
};

MidiControllerProfileConfig WrldBldrDefaultProfileConfig(WrldBldrDefaultProfileOptions options = {});
MidiControllerSlot WrldBldrDefaultControllerSlot(std::string name = "wrldbldr",
                                                 WrldBldrDefaultProfileOptions options = {});
MidiInstrumentConfig DefaultMidiInstrumentConfig();
MidiControllerProfileResult CreateWrldBldrDefaultProfile(
    WrldBldrDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});

struct MfTwisterDefaultProfileOptions {
    std::size_t slotIx = 0;
    std::size_t visibleEncoderCount = 16;
    std::array<std::optional<MidiControllerSystemMessageAssociation>, 6> sideButtons{};
};

MidiControllerProfileConfig MfTwisterDefaultProfileConfig(MfTwisterDefaultProfileOptions options = {});
MidiControllerProfileResult CreateMfTwisterDefaultProfile(
    MfTwisterDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});

struct LaunchpadDefaultProfileOptions {
    LaunchpadController controller = LaunchpadController::LaunchpadX;
    std::size_t slotIx = 0;
    std::size_t sceneCount = 8;
    std::size_t bankButtonCount = 8;
    std::size_t gestureSelectorCount = 0;
    std::optional<LaunchpadGridPosition> resetPosition;
};

MidiControllerProfileConfig LaunchpadDefaultProfileConfig(LaunchpadDefaultProfileOptions options = {});
MidiControllerProfileResult CreateLaunchpadDefaultProfile(
    LaunchpadDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider = {});

JSON ToJSON(JsonArena& arena, EncoderMode value);
bool FromJSON(JSON json, EncoderMode& value);
JSON ToJSON(JsonArena& arena, const MidiControlAddress& value);
bool FromJSON(JSON json, MidiControlAddress& value);
JSON ToJSON(JsonArena& arena, const MidiNoteAddress& value);
bool FromJSON(JSON json, MidiNoteAddress& value);
JSON ToJSON(JsonArena& arena, const PolyphonicPressureMapping& value);
bool FromJSON(JSON json, PolyphonicPressureMapping& value);
JSON ToJSON(JsonArena& arena, const PolyphonicPressureMidiInConfig& value);
bool FromJSON(JSON json, PolyphonicPressureMidiInConfig& value);
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
// Legacy MessageIn variants retain their established full object shape.
// Grid variants use flat gridSlot/grid/x/y/velocity keys per event semantics.
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
inline constexpr const char* kMidiControllerProfileSchema = "synth.midiControllerProfileConfig";
inline constexpr int kMidiControllerProfileSchemaVersion = 2;
JSON ToJSON(JsonArena& arena, const MidiControllerProfileConfig& value);
bool FromJSON(JSON json, MidiControllerProfileConfig& value);

inline constexpr const char* kMidiInstrumentSchema = "synth.midiInstrument";
inline constexpr int kMidiInstrumentSchemaVersion = 1;
JSON ToJSON(JsonArena& arena, const MidiEndpointRef& value);
bool FromJSON(JSON json, MidiEndpointRef& value);
JSON ToJSON(JsonArena& arena, const MidiControllerSlot& value);
bool FromJSON(JSON json, MidiControllerSlot& value);
JSON ToJSON(JsonArena& arena, const MidiInstrumentConfig& instrument);
bool FromJSON(JSON json, MidiInstrumentConfig& out); // false: unknown kind, dup name, invalid slot, bad schema

std::uint8_t EncoderPositionToCC(std::size_t position);
std::uint8_t WrldBldrPositionToCC(std::uint8_t x, std::uint8_t y);
std::uint8_t ColorToTwister(Color color);
std::uint8_t FullBrightnessAnimationValue();
BasicMidi WrldBldrColorSysex(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, Color color);
BasicMidi LaunchpadColorSysex(std::uint64_t timestamp, LaunchpadController controller, int x, int y, Color color);

} // namespace synth
