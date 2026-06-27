#include "synth/MidiController.hpp"

#include <algorithm>
#include <cmath>

namespace synth {

namespace {

std::uint8_t Clamp7Bit(int value) {
    return static_cast<std::uint8_t>(std::clamp(value, 0, 127));
}

std::uint8_t FloatTo7Bit(float value) {
    return Clamp7Bit(static_cast<int>(std::lround(std::clamp(value, 0.0f, 1.0f) * 127.0f)));
}

EncoderMidiInConfig RowMajorInputDefault(std::size_t slotIx) {
    EncoderMidiInConfig config;
    config.relativeMode = EncoderRelativeMode::Signed7Bit;
    for (std::size_t position = 0; position < 16; ++position) {
        const std::uint8_t cc = EncoderPositionToCC(position);
        config.turns.push_back({.control = {.channel = 0, .cc = cc}, .slotIx = slotIx, .position = position});
        config.pushes.push_back({.control = {.channel = 1, .cc = cc}, .slotIx = slotIx, .position = position});
    }
    return config;
}

EncoderMidiOutConfig RowMajorOutputDefault(std::size_t slotIx) {
    EncoderMidiOutConfig config;
    for (std::size_t position = 0; position < 16; ++position) {
        config.mappings.push_back({.slotIx = slotIx, .position = position, .cc = EncoderPositionToCC(position)});
    }
    return config;
}

bool MappingIsFirstPosition(const EncoderMidiMapping& mapping, std::size_t count) {
    return mapping.position < count;
}

bool MappingIsFirstPosition(const EncoderMidiOutMapping& mapping, std::size_t count) {
    return mapping.position < count;
}

bool CacheNeedsResize(std::size_t size, std::size_t targetSize) {
    return size != targetSize;
}

} // namespace

BasicMidi::BasicMidi(std::uint64_t newTimestamp, std::uint8_t status, std::uint8_t data1, std::uint8_t data2)
    : timestamp(newTimestamp),
      raw{status, data1, data2} {}

BasicMidi::BasicMidi(std::uint64_t newTimestamp, std::vector<std::uint8_t> bytes)
    : timestamp(newTimestamp),
      raw(std::move(bytes)) {}

BasicMidi BasicMidi::CC(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, std::uint8_t value) {
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusCC | (channel & 0x0F)), cc & 0x7F, value & 0x7F);
}

BasicMidi BasicMidi::Note(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note, std::uint8_t velocity) {
    const std::uint8_t status = velocity == 0 ? kStatusNoteOff : kStatusNote;
    return BasicMidi(timestamp, static_cast<std::uint8_t>(status | (channel & 0x0F)), note & 0x7F, velocity & 0x7F);
}

BasicMidi BasicMidi::NoteOff(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t note) {
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusNoteOff | (channel & 0x0F)), note & 0x7F, 0);
}

BasicMidi BasicMidi::PitchBend(std::uint64_t timestamp, std::uint8_t channel, std::uint16_t value) {
    const std::uint16_t clamped = std::min<std::uint16_t>(value, 0x3FFF);
    return BasicMidi(timestamp, static_cast<std::uint8_t>(kStatusPitchBend | (channel & 0x0F)),
                     static_cast<std::uint8_t>(clamped & 0x7F),
                     static_cast<std::uint8_t>((clamped >> 7) & 0x7F));
}

BasicMidi BasicMidi::Realtime(std::uint64_t timestamp, std::uint8_t status) {
    if (!IsSupportedRealtimeStatus(status)) {
        return {};
    }
    return BasicMidi(timestamp, std::vector<std::uint8_t>{status});
}

BasicMidi BasicMidi::Clock(std::uint64_t timestamp) {
    return Realtime(timestamp, kStatusClock);
}

BasicMidi BasicMidi::TransportStart(std::uint64_t timestamp) {
    return Realtime(timestamp, kStatusTransportStart);
}

BasicMidi BasicMidi::TransportContinue(std::uint64_t timestamp) {
    return Realtime(timestamp, kStatusTransportContinue);
}

BasicMidi BasicMidi::TransportStop(std::uint64_t timestamp) {
    return Realtime(timestamp, kStatusTransportStop);
}

BasicMidi BasicMidi::SysEx(std::uint64_t timestamp, std::vector<std::uint8_t> bytes) {
    if (bytes.empty() || bytes.front() != 0xF0) {
        bytes.insert(bytes.begin(), 0xF0);
    }
    if (bytes.back() != 0xF7) {
        bytes.push_back(0xF7);
    }
    return BasicMidi(timestamp, std::move(bytes));
}

bool BasicMidi::IsSupportedRealtimeStatus(std::uint8_t status) {
    return status == kStatusClock || status == kStatusTransportStart || status == kStatusTransportContinue ||
           status == kStatusTransportStop;
}

std::uint8_t BasicMidi::Status() const {
    if (raw.empty()) {
        return 0;
    }
    if (raw[0] >= 0xF0) {
        return raw[0];
    }
    return raw[0] & 0xF0;
}

std::uint8_t BasicMidi::Channel() const {
    return raw.empty() || raw[0] >= 0xF0 ? 0 : static_cast<std::uint8_t>(raw[0] & 0x0F);
}

std::uint8_t BasicMidi::GetCC() const {
    return raw.size() > 1 ? raw[1] : 0;
}

std::uint8_t BasicMidi::GetNote() const {
    return raw.size() > 1 ? raw[1] : 0;
}

std::uint8_t BasicMidi::GetValue() const {
    return raw.size() > 2 ? raw[2] : 0;
}

std::uint16_t BasicMidi::GetPitchBend() const {
    if (raw.size() < 3) {
        return 0;
    }
    return static_cast<std::uint16_t>((raw[1] & 0x7F) | ((raw[2] & 0x7F) << 7));
}

MidiInProcessor::MidiInProcessor(MessageInBus* bus)
    : bus_(bus) {}

std::uint64_t MidiInProcessor::NextTimestamp() const {
    return timestampProvider_ == nullptr ? 0 : timestampProvider_();
}

bool MidiInProcessor::Push(const MessageIn& message) {
    return bus_ != nullptr && bus_->Push(message);
}

void MidiInProcessor::PassToThru(const BasicMidi& midi) {
    if (thru_ != nullptr) {
        thru_->Process(midi);
    }
}

EncoderMidiInConfig EncoderMidiInConfig::TwisterDefault(std::size_t slotIx) {
    return RowMajorInputDefault(slotIx);
}

EncoderMidiInConfig EncoderMidiInConfig::WrldBldrDefault(std::size_t slotIx) {
    return RowMajorInputDefault(slotIx);
}

void EncoderMidiInConfig::KeepFirstPositions(std::size_t count) {
    std::erase_if(turns, [count](const EncoderMidiMapping& mapping) { return !MappingIsFirstPosition(mapping, count); });
    std::erase_if(pushes, [count](const EncoderMidiMapping& mapping) { return !MappingIsFirstPosition(mapping, count); });
}

EncoderMidiInProcessor::EncoderMidiInProcessor(EncoderMidiInConfig config, MessageInBus* bus)
    : MidiInProcessor(bus),
      config_(std::move(config)) {}

void EncoderMidiInProcessor::SetConfig(EncoderMidiInConfig config) {
    config_ = std::move(config);
}

void EncoderMidiInProcessor::Process(const BasicMidi& midi) {
    if (!midi.IsCC()) {
        PassToThru(midi);
        return;
    }

    if (const EncoderMidiMapping* mapping = FindTurn(midi)) {
        if (const std::optional<float> delta = DecodeDelta(midi.GetValue())) {
            Push(MessageIn::ParamIncDec(NextTimestamp(), mapping->slotIx, mapping->position, *delta));
        }
        return;
    }

    if (const EncoderMidiMapping* mapping = FindPush(midi)) {
        if (midi.GetValue() != 0) {
            Push(MessageIn::ParamPush(NextTimestamp(), mapping->slotIx, mapping->position));
        }
        return;
    }

    PassToThru(midi);
}

const EncoderMidiMapping* EncoderMidiInProcessor::FindTurn(const BasicMidi& midi) const {
    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    const auto itr = std::find_if(config_.turns.begin(), config_.turns.end(),
                                  [address](const EncoderMidiMapping& mapping) { return mapping.control == address; });
    return itr == config_.turns.end() ? nullptr : &*itr;
}

const EncoderMidiMapping* EncoderMidiInProcessor::FindPush(const BasicMidi& midi) const {
    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    const auto itr = std::find_if(config_.pushes.begin(), config_.pushes.end(),
                                  [address](const EncoderMidiMapping& mapping) { return mapping.control == address; });
    return itr == config_.pushes.end() ? nullptr : &*itr;
}

std::optional<float> EncoderMidiInProcessor::DecodeDelta(std::uint8_t value) const {
    int ticks = 0;
    switch (config_.relativeMode) {
    case EncoderRelativeMode::Signed7Bit:
        ticks = static_cast<int>(value) - 64;
        break;
    case EncoderRelativeMode::DirectionOnly:
        if (value > 64) {
            ticks = 1;
        } else if (value < 64) {
            ticks = -1;
        }
        break;
    }
    if (ticks == 0) {
        return std::nullopt;
    }
    return static_cast<float>(ticks) * config_.turnStep;
}

AnalogMidiInProcessor::AnalogMidiInProcessor(AnalogMidiInConfig config, MessageInBus* bus)
    : MidiInProcessor(bus),
      config_(std::move(config)) {}

void AnalogMidiInProcessor::SetConfig(AnalogMidiInConfig config) {
    config_ = std::move(config);
}

void AnalogMidiInProcessor::Process(const BasicMidi& midi) {
    if (!midi.IsCC()) {
        PassToThru(midi);
        return;
    }

    const float normalized = static_cast<float>(midi.GetValue()) / 127.0f;
    if (const AnalogMidiMapping* mapping = FindGesture(midi)) {
        Push(MessageIn::SetGestureValue(NextTimestamp(), mapping->gestureIx, normalized));
        return;
    }

    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    if (config_.sceneBlend.has_value() && *config_.sceneBlend == address) {
        Push(MessageIn::SetSceneBlend(NextTimestamp(), normalized));
        return;
    }

    PassToThru(midi);
}

const AnalogMidiMapping* AnalogMidiInProcessor::FindGesture(const BasicMidi& midi) const {
    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    const auto itr = std::find_if(config_.gestures.begin(), config_.gestures.end(),
                                  [address](const AnalogMidiMapping& mapping) { return mapping.control == address; });
    return itr == config_.gestures.end() ? nullptr : &*itr;
}

SystemButtonMidiInProcessor::SystemButtonMidiInProcessor(SystemButtonMidiInConfig config, MessageInBus* bus)
    : MidiInProcessor(bus),
      config_(std::move(config)) {}

void SystemButtonMidiInProcessor::SetConfig(SystemButtonMidiInConfig config) {
    config_ = std::move(config);
}

void SystemButtonMidiInProcessor::Process(const BasicMidi& midi) {
    if (!midi.IsCC()) {
        PassToThru(midi);
        return;
    }

    const SystemButtonMidiAssociation* association = FindAssociation(midi);
    if (association == nullptr) {
        PassToThru(midi);
        return;
    }

    if (midi.GetValue() > 0) {
        PushStamped(association->press);
        return;
    }

    if (association->release.has_value()) {
        PushStamped(*association->release);
    }
}

const SystemButtonMidiAssociation* SystemButtonMidiInProcessor::FindAssociation(const BasicMidi& midi) const {
    const MidiControlAddress address{.channel = midi.Channel(), .cc = midi.GetCC()};
    const auto itr = std::find_if(config_.associations.begin(), config_.associations.end(),
                                  [address](const SystemButtonMidiAssociation& association) {
                                      return association.control == address;
                                  });
    return itr == config_.associations.end() ? nullptr : &*itr;
}

void SystemButtonMidiInProcessor::PushStamped(MessageIn message) {
    message.timestamp = NextTimestamp();
    Push(message);
}

MidiSender::MidiSender(std::size_t capacity)
    : queue_(capacity == 0 ? 1 : capacity) {}

MidiSender::~MidiSender() {
    Stop();
}

void MidiSender::SetSink(IMidiOutputSink* sink) {
    std::lock_guard lock(mutex_);
    sink_ = sink;
}

void MidiSender::Start() {
    std::lock_guard lock(mutex_);
    if (running_) {
        return;
    }
    stopRequested_ = false;
    running_ = true;
    thread_ = std::thread([this] { Run(); });
}

void MidiSender::Stop() {
    {
        std::lock_guard lock(mutex_);
        if (!running_ && !thread_.joinable()) {
            return;
        }
        stopRequested_ = true;
    }
    cv_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
    std::lock_guard lock(mutex_);
    running_ = false;
    stopRequested_ = false;
    head_ = 0;
    size_ = 0;
    drainedCv_.notify_all();
}

bool MidiSender::Enqueue(const BasicMidi& midi) {
    std::lock_guard lock(mutex_);
    if (size_ >= queue_.size()) {
        return false;
    }
    const std::size_t tail = (head_ + size_) % queue_.size();
    queue_[tail] = midi;
    ++size_;
    cv_.notify_one();
    return true;
}

bool MidiSender::IsRunning() const {
    std::lock_guard lock(mutex_);
    return running_;
}

bool MidiSender::FlushForTests(std::chrono::milliseconds timeout) {
    std::unique_lock lock(mutex_);
    return drainedCv_.wait_for(lock, timeout, [this] { return size_ == 0 && inFlight_ == 0; });
}

void MidiSender::Run() {
    for (;;) {
        BasicMidi midi;
        IMidiOutputSink* sink = nullptr;
        {
            std::unique_lock lock(mutex_);
            cv_.wait(lock, [this] { return stopRequested_ || size_ > 0; });
            if (stopRequested_ && size_ == 0) {
                break;
            }
            midi = queue_[head_];
            head_ = (head_ + 1) % queue_.size();
            --size_;
            ++inFlight_;
            sink = sink_;
        }
        if (sink != nullptr) {
            sink->Send(midi);
        }
        {
            std::lock_guard lock(mutex_);
            --inFlight_;
            if (size_ == 0 && inFlight_ == 0) {
                drainedCv_.notify_all();
            }
        }
    }
    {
        std::lock_guard lock(mutex_);
        running_ = false;
    }
    drainedCv_.notify_all();
}

EncoderMidiOutConfig EncoderMidiOutConfig::TwisterDefault(std::size_t slotIx) {
    return RowMajorOutputDefault(slotIx);
}

EncoderMidiOutConfig EncoderMidiOutConfig::WrldBldrDefault(std::size_t slotIx) {
    return RowMajorOutputDefault(slotIx);
}

void EncoderMidiOutConfig::KeepFirstPositions(std::size_t count) {
    std::erase_if(mappings, [count](const EncoderMidiOutMapping& mapping) { return !MappingIsFirstPosition(mapping, count); });
}

MidiOutProcessor::MidiOutProcessor(EncoderMidiOutConfig config, MidiSender* sender, ParameterManager::UIState* uiState)
    : config_(std::move(config)),
      sender_(sender),
      uiState_(uiState) {}

void MidiOutProcessor::SetConfig(EncoderMidiOutConfig config) {
    config_ = std::move(config);
    Reset();
}

void MidiOutProcessor::Reset() {}

std::optional<MidiOutProcessor::CellSnapshot> MidiOutProcessor::LoadCellSnapshot(
    const EncoderMidiOutMapping& mapping) const {
    if (uiState_ == nullptr || mapping.slotIx >= uiState_->slotCapacity) {
        return std::nullopt;
    }
    const BankSlot::UIState& slot = uiState_->slots[mapping.slotIx];
    if (mapping.position >= slot.cellCapacity) {
        return std::nullopt;
    }
    const Parameter::UIState& state = slot.cells[mapping.position];
    for (int attempt = 0; attempt < 4; ++attempt) {
        const std::uint32_t startRevision = state.revision.load(std::memory_order_acquire);
        if ((startRevision & 1u) != 0) {
            continue;
        }
        CellSnapshot snapshot;
        snapshot.connected = state.connected.load(std::memory_order_relaxed);
        snapshot.bipolar = state.bipolar.load(std::memory_order_relaxed);
        snapshot.voiceCount = std::min(state.voiceCount.load(std::memory_order_relaxed), state.voiceCapacity);
        snapshot.color = state.color.Load(std::memory_order_relaxed);
        if (snapshot.voiceCount > 0) {
            snapshot.value = state.values[0].load(std::memory_order_relaxed);
            snapshot.indicatorColor = state.indicatorColors[0].Load(std::memory_order_relaxed);
        }
        const std::uint32_t endRevision = state.revision.load(std::memory_order_acquire);
        if (startRevision == endRevision && (endRevision & 1u) == 0) {
            return snapshot;
        }
    }
    return std::nullopt;
}

bool MidiOutProcessor::Enqueue(const BasicMidi& midi) {
    return sender_ != nullptr && sender_->Enqueue(midi);
}

float MidiOutProcessor::NormalizeForDisplay(float value, bool bipolar) {
    const float normalized = bipolar ? (value + 1.0f) * 0.5f : value;
    return std::clamp(normalized, 0.0f, 1.0f);
}

void TwisterMidiOutProcessor::Reset() {
    cache_.clear();
}

void TwisterMidiOutProcessor::Process() {
    if (CacheNeedsResize(cache_.size(), config_.mappings.size())) {
        cache_.assign(config_.mappings.size(), {});
    }
    for (std::size_t ix = 0; ix < config_.mappings.size(); ++ix) {
        const EncoderMidiOutMapping& mapping = config_.mappings[ix];
        const std::optional<CellSnapshot> snapshot = LoadCellSnapshot(mapping);
        if (!snapshot.has_value()) {
            continue;
        }
        const bool blank = !snapshot->connected || snapshot->voiceCount == 0;
        const std::uint8_t value = blank ? 0 : FloatTo7Bit(NormalizeForDisplay(snapshot->value, snapshot->bipolar));
        const std::uint8_t color = blank ? 0 : ColorToTwister(snapshot->color);
        const std::uint8_t brightness = blank ? 0 : FullBrightnessAnimationValue();
        CacheEntry& cache = cache_[ix];
        if (!cache.valid || cache.color != color) {
            Enqueue(BasicMidi::CC(0, 1, mapping.cc, color));
        }
        if (!cache.valid || cache.brightness != brightness) {
            Enqueue(BasicMidi::CC(0, 2, mapping.cc, brightness));
        }
        if (!cache.valid || cache.value != value) {
            Enqueue(BasicMidi::CC(0, 0, mapping.cc, value));
        }
        cache = {.valid = true, .value = value, .color = color, .brightness = brightness};
    }
}

void WrldBldrMidiOutProcessor::Reset() {
    cache_.clear();
}

void WrldBldrMidiOutProcessor::Process() {
    if (CacheNeedsResize(cache_.size(), config_.mappings.size())) {
        cache_.assign(config_.mappings.size(), {});
    }

    std::size_t colorBudget = config_.wrldBldrColorBudgetPerProcess == 0 ? config_.mappings.size()
                                                                          : config_.wrldBldrColorBudgetPerProcess;
    for (std::size_t ix = 0; ix < config_.mappings.size(); ++ix) {
        const EncoderMidiOutMapping& mapping = config_.mappings[ix];
        const std::optional<CellSnapshot> snapshot = LoadCellSnapshot(mapping);
        if (!snapshot.has_value()) {
            continue;
        }

        const bool blank = !snapshot->connected || snapshot->voiceCount == 0;
        const std::uint8_t value = blank ? 0 : FloatTo7Bit(NormalizeForDisplay(snapshot->value, snapshot->bipolar));
        const Color buttonColor = blank ? Color::Off : snapshot->color;
        const Color indicatorColor = blank ? Color::Off : snapshot->indicatorColor;
        CacheEntry& cache = cache_[ix];
        if (!cache.valid || cache.value != value) {
            Enqueue(BasicMidi::CC(0, 0, mapping.cc, value));
            cache.value = value;
        }
        if (!cache.valid || cache.buttonColor != buttonColor) {
            cache.buttonColor = buttonColor;
            cache.pendingButtonColor = true;
        }
        if (!cache.valid || cache.indicatorColor != indicatorColor) {
            cache.indicatorColor = indicatorColor;
            cache.pendingIndicatorColor = true;
        }
        cache.valid = true;

        if (colorBudget > 0 && cache.pendingButtonColor) {
            Enqueue(WrldBldrColorSysex(0, 1, mapping.cc, cache.buttonColor));
            cache.pendingButtonColor = false;
            --colorBudget;
        }
        if (colorBudget > 0 && cache.pendingIndicatorColor) {
            Enqueue(WrldBldrColorSysex(0, 0, mapping.cc, cache.indicatorColor));
            cache.pendingIndicatorColor = false;
            --colorBudget;
        }
    }
}

SystemMessageOutputInfo::SystemMessageOutputInfo(ParameterManager::UIState* uiState)
    : uiState_(uiState) {}

SystemMessageOutputState SystemMessageOutputInfo::Evaluate(const MessageIn& message) const {
    if (uiState_ == nullptr) {
        return {};
    }

    switch (message.type) {
    case MessageIn::Type::SelectParamBank: {
        if (message.bankIx >= uiState_->bankCapacity) {
            return {};
        }
        const ParameterManager::BankUIState& bank = uiState_->banks[message.bankIx];
        if (!bank.connected.load(std::memory_order_relaxed)) {
            return {};
        }
        const bool selected = bank.selected.load(std::memory_order_relaxed);
        const Color color = bank.color.Load(std::memory_order_relaxed);
        return {.color = selected ? color : color.AdjustBrightness(0.35f), .isOn = selected};
    }
    case MessageIn::Type::ToggleShift: {
        const bool held = uiState_->shiftHeld.load(std::memory_order_relaxed);
        return {.color = held ? Color::White : Color::Grey, .isOn = held};
    }
    case MessageIn::Type::SceneSelect: {
        if (message.sceneIx >= uiState_->sceneCapacity) {
            return {};
        }
        const std::size_t leftScene = uiState_->leftScene.load(std::memory_order_relaxed);
        const std::size_t rightScene = uiState_->rightScene.load(std::memory_order_relaxed);
        const float blend = std::clamp(uiState_->sceneBlend.load(std::memory_order_relaxed), 0.0f, 1.0f);
        if (message.sceneIx == leftScene) {
            return {.color = Color::Orange.AdjustBrightness(0.5f + 0.5f * (1.0f - blend)), .isOn = true};
        }
        if (message.sceneIx == rightScene) {
            return {.color = Color::Green.AdjustBrightness(0.5f + 0.5f * blend), .isOn = true};
        }
        return {};
    }
    case MessageIn::Type::ToggleGestureSelect:
    case MessageIn::Type::SetGestureSelect: {
        if (message.gestureIx >= uiState_->gestures.gestureCapacity ||
            !uiState_->gestures.connected[message.gestureIx].load(std::memory_order_relaxed)) {
            return {};
        }
        const bool selected = uiState_->gestures.selected[message.gestureIx].load(std::memory_order_relaxed);
        if (selected) {
            return {.color = Color::White, .isOn = true};
        }
        return {.color = GestureColor(message.gestureIx), .isOn = false};
    }
    case MessageIn::Type::ParamIncDec:
    case MessageIn::Type::ParamPush:
    case MessageIn::Type::Start:
    case MessageIn::Type::Stop:
    case MessageIn::Type::Clock:
    case MessageIn::Type::SetGestureValue:
    case MessageIn::Type::SetSceneBlend:
        return {};
    }
    return {};
}

Color SystemMessageOutputInfo::GestureColor(std::size_t gestureIx) const {
    const std::size_t count = uiState_->gestures.bankAffectingCount[gestureIx].load(std::memory_order_relaxed);
    if (count == 0) {
        return Color::Grey.AdjustBrightness(0.5f);
    }
    if (count > 1) {
        return Color::White;
    }

    const std::uint32_t mask = uiState_->gestures.bankAffectingMask[gestureIx].load(std::memory_order_relaxed);
    const std::size_t bankCount = std::min<std::size_t>(uiState_->bankCapacity, 32);
    for (std::size_t bankIx = 0; bankIx < bankCount; ++bankIx) {
        if ((mask & (std::uint32_t{1} << bankIx)) == 0) {
            continue;
        }
        if (uiState_->banks[bankIx].connected.load(std::memory_order_relaxed)) {
            return uiState_->banks[bankIx].color.Load(std::memory_order_relaxed);
        }
    }
    return Color::Grey.AdjustBrightness(0.5f);
}

SystemCcMidiOutProcessor::SystemCcMidiOutProcessor(SystemCcMidiOutConfig config, MidiSender* sender,
                                                   ParameterManager::UIState* uiState)
    : config_(std::move(config)),
      sender_(sender),
      info_(uiState) {}

void SystemCcMidiOutProcessor::SetConfig(SystemCcMidiOutConfig config) {
    config_ = std::move(config);
    Reset();
}

void SystemCcMidiOutProcessor::Reset() {
    cache_.clear();
}

void SystemCcMidiOutProcessor::Process() {
    if (CacheNeedsResize(cache_.size(), config_.associations.size())) {
        cache_.assign(config_.associations.size(), {});
    }

    for (std::size_t ix = 0; ix < config_.associations.size(); ++ix) {
        const SystemCcMidiOutAssociation& association = config_.associations[ix];
        const SystemMessageOutputState state = info_.Evaluate(association.message);
        CacheEntry& cache = cache_[ix];
        if (!cache.valid || cache.isOn != state.isOn) {
            Enqueue(BasicMidi::CC(0, association.control.channel, association.control.cc, state.isOn ? 127 : 0));
        }
        cache = {.valid = true, .isOn = state.isOn};
    }
}

bool SystemCcMidiOutProcessor::Enqueue(const BasicMidi& midi) {
    return sender_ != nullptr && sender_->Enqueue(midi);
}

WrldBldrSystemMidiOutProcessor::WrldBldrSystemMidiOutProcessor(WrldBldrSystemMidiOutConfig config,
                                                               MidiSender* sender,
                                                               ParameterManager::UIState* uiState)
    : config_(std::move(config)),
      sender_(sender),
      info_(uiState) {}

void WrldBldrSystemMidiOutProcessor::SetConfig(WrldBldrSystemMidiOutConfig config) {
    config_ = std::move(config);
    Reset();
}

void WrldBldrSystemMidiOutProcessor::Reset() {
    cache_.clear();
}

void WrldBldrSystemMidiOutProcessor::Process() {
    if (CacheNeedsResize(cache_.size(), config_.associations.size())) {
        cache_.assign(config_.associations.size(), {});
    }

    for (std::size_t ix = 0; ix < config_.associations.size(); ++ix) {
        const WrldBldrSystemMidiOutAssociation& association = config_.associations[ix];
        const Color color = info_.Evaluate(association.message).color;
        CacheEntry& cache = cache_[ix];
        if (!cache.valid || cache.color != color) {
            Enqueue(WrldBldrColorSysex(0, association.position.channel,
                                       WrldBldrPositionToCC(association.position.x, association.position.y), color));
        }
        cache = {.valid = true, .color = color};
    }
}

bool WrldBldrSystemMidiOutProcessor::Enqueue(const BasicMidi& midi) {
    return sender_ != nullptr && sender_->Enqueue(midi);
}

MidiControllerProfileResult CreateMidiControllerProfile(
    const MidiControllerProfileConfig& config, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider) {
    MidiControllerProfileResult result;
    MidiInProcessor* tail = nullptr;
    auto appendInput = [&](std::unique_ptr<MidiInProcessor> processor) {
        processor->SetMessageInBus(bus);
        processor->SetTimestampProvider(timestampProvider);
        if (result.input == nullptr) {
            result.input = std::move(processor);
            tail = result.input.get();
            return;
        }
        tail->SetThru(processor.get());
        tail = processor.get();
        result.inputThru.push_back(std::move(processor));
    };

    if (config.encoderInput.has_value()) {
        appendInput(std::make_unique<EncoderMidiInProcessor>(*config.encoderInput, bus));
    }
    if (config.analogInput.has_value()) {
        appendInput(std::make_unique<AnalogMidiInProcessor>(*config.analogInput, bus));
    }
    if (!config.systemMessages.empty()) {
        SystemButtonMidiInConfig systemInput;
        systemInput.associations.reserve(config.systemMessages.size());
        for (const MidiControllerSystemMessageAssociation& association : config.systemMessages) {
            systemInput.associations.push_back({
                .control = association.control,
                .press = association.press,
                .release = association.release,
            });
        }
        appendInput(std::make_unique<SystemButtonMidiInProcessor>(std::move(systemInput), bus));
    }

    if (config.encoderOutput.has_value()) {
        result.outputs.push_back(std::make_unique<WrldBldrMidiOutProcessor>(*config.encoderOutput, sender, uiState));
    }

    SystemCcMidiOutConfig ccOutput;
    WrldBldrSystemMidiOutConfig wrldOutput;
    for (const MidiControllerSystemMessageAssociation& association : config.systemMessages) {
        ccOutput.associations.push_back({
            .control = association.control,
            .message = association.feedback,
        });
        if (association.wrldBldrPosition.has_value()) {
            wrldOutput.associations.push_back({
                .position = *association.wrldBldrPosition,
                .message = association.feedback,
            });
        }
    }
    if (!ccOutput.associations.empty()) {
        result.outputs.push_back(std::make_unique<SystemCcMidiOutProcessor>(std::move(ccOutput), sender, uiState));
    }
    if (!wrldOutput.associations.empty()) {
        result.outputs.push_back(std::make_unique<WrldBldrSystemMidiOutProcessor>(std::move(wrldOutput), sender, uiState));
    }

    return result;
}

MidiControllerProfileConfig WrldBldrDefaultProfileConfig(WrldBldrDefaultProfileOptions options) {
    MidiControllerProfileConfig config;
    config.encoderInput = EncoderMidiInConfig::WrldBldrDefault(options.slotIx);
    config.encoderInput->KeepFirstPositions(options.visibleEncoderCount);
    config.encoderOutput = EncoderMidiOutConfig::WrldBldrDefault(options.slotIx);
    config.encoderOutput->KeepFirstPositions(options.visibleEncoderCount);

    auto addAnalogLogical = [&](MidiControlAddress control, std::size_t logicalIx) {
        if (logicalIx == 0) {
            config.analogInput->sceneBlend = control;
        } else if (logicalIx <= 16) {
            config.analogInput->gestures.push_back({.control = control, .gestureIx = logicalIx - 1});
        }
    };

    config.analogInput = AnalogMidiInConfig{};
    for (std::uint8_t cc = 0; cc <= 16; ++cc) {
        addAnalogLogical({.channel = 2, .cc = cc}, cc);
    }
    for (std::uint8_t cc = 0; cc <= 14; ++cc) {
        addAnalogLogical({.channel = 14, .cc = cc}, static_cast<std::size_t>(cc) + 2);
    }

    auto addSystemPosition = [&](std::uint8_t x, std::uint8_t y, MessageIn press,
                                 std::optional<MessageIn> release = std::nullopt) {
        const WrldBldrSystemPosition position{.channel = 5, .x = x, .y = y};
        config.systemMessages.push_back({
            .control = {.channel = 5, .cc = WrldBldrPositionToCC(x, y)},
            .wrldBldrPosition = position,
            .press = press,
            .release = release,
            .feedback = press,
        });
    };

    // Source-derived from TheNonagonSquiggleBoyWrldBldr.hpp AuxGrid:
    // channel 5 maps x = cc % 8, y = cc / 8; shift is (0,4),
    // scene selectors live on row 6, gesture selectors on rows 0/1, and
    // bank selectors occupy rows 3 (first eight) and 2 (second eight).
    addSystemPosition(0, 4, MessageIn::SetShift(0, true), MessageIn::SetShift(0, false));

    for (std::size_t sceneIx = 0; sceneIx < options.sceneCount; ++sceneIx) {
        addSystemPosition(static_cast<std::uint8_t>(sceneIx % 8), 6, MessageIn::SceneSelect(0, sceneIx));
    }

    for (std::size_t bankIx = 0; bankIx < options.bankButtonCount; ++bankIx) {
        const std::uint8_t x = static_cast<std::uint8_t>(bankIx % 8);
        const std::uint8_t y = static_cast<std::uint8_t>(bankIx < 8 ? 3 : 2);
        addSystemPosition(x, y, MessageIn::SelectParamBank(0, options.slotIx, bankIx));
    }

    for (std::size_t gestureIx = 0; gestureIx < options.gestureSelectorCount; ++gestureIx) {
        const std::uint8_t x = static_cast<std::uint8_t>(gestureIx % 8);
        const std::uint8_t y = static_cast<std::uint8_t>(gestureIx < 8 ? 0 : 1);
        addSystemPosition(x, y, MessageIn::SetGestureSelect(0, gestureIx, true),
                          MessageIn::SetGestureSelect(0, gestureIx, false));
    }

    return config;
}

MidiControllerProfileResult CreateWrldBldrDefaultProfile(
    WrldBldrDefaultProfileOptions options, MessageInBus* bus, MidiSender* sender,
    ParameterManager::UIState* uiState, MidiInProcessor::TimestampProvider timestampProvider) {
    return CreateMidiControllerProfile(WrldBldrDefaultProfileConfig(options), bus, sender, uiState,
                                       std::move(timestampProvider));
}

std::uint8_t EncoderPositionToCC(std::size_t position) {
    return static_cast<std::uint8_t>(position % 16);
}

std::uint8_t WrldBldrPositionToCC(std::uint8_t x, std::uint8_t y) {
    return static_cast<std::uint8_t>((static_cast<unsigned>(y) * 8u + static_cast<unsigned>(x)) & 0x7F);
}

std::uint8_t ColorToTwister(Color color) {
    if (color == Color::Off) {
        return 0;
    }
    const HSV hsv = ToHSV(color);
    if (hsv.s < 0.08f) {
        return 1;
    }
    return static_cast<std::uint8_t>(2 + std::clamp(static_cast<int>(std::lround(hsv.h * 64.0f)), 0, 63));
}

std::uint8_t FullBrightnessAnimationValue() {
    return 47;
}

BasicMidi WrldBldrColorSysex(std::uint64_t timestamp, std::uint8_t channel, std::uint8_t cc, Color color) {
    return BasicMidi::SysEx(timestamp, {
                                           0xF0,
                                           0x79,
                                           0x74,
                                           0x78,
                                           0x00,
                                           0x01,
                                           0x00,
                                           0x20,
                                           channel,
                                           cc,
                                           static_cast<std::uint8_t>(color.r / 2),
                                           static_cast<std::uint8_t>(color.g / 2),
                                           static_cast<std::uint8_t>(color.b / 2),
                                           0xF7,
                                       });
}

} // namespace synth
