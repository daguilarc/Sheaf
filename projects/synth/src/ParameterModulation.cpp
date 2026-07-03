#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace synth {

namespace {

// Local modulation-depth controls are intentionally not addressable through ParameterManager::ParameterById.
constexpr ParameterId kLocalParameterId = std::numeric_limits<ParameterId>::max();

ParameterGroupConfig ValidateConfig(ParameterGroupConfig config) {
    if (!config.IsValid()) {
        throw std::invalid_argument("invalid parameter group config");
    }
    return config;
}

template <typename T>
std::span<T> ArenaSlice(std::vector<T>& arena, std::size_t offset, std::size_t count) {
    if (count == 0) {
        return {};
    }
    return std::span<T>(arena.data() + offset, count);
}

float Blend(float left, float right, float blend) {
    return left * (1.0f - blend) + right * blend;
}

bool OutsideRange(float value, RangeKind range) {
    return ClampToRange(value, range) != value;
}

float RangeMin(RangeKind range) {
    return range == RangeKind::Bipolar ? -1.0f : 0.0f;
}

float RangeMax(RangeKind) {
    return 1.0f;
}

float LinearMap(float minValue, float maxValue, float normalized) {
    return minValue + (maxValue - minValue) * normalized;
}

float ExponentialMap(float minValue, float maxValue, float normalized) {
    if (minValue <= 0.0f || maxValue <= 0.0f) {
        throw std::invalid_argument("exponential mapping endpoints must be positive");
    }
    return minValue * std::pow(maxValue / minValue, normalized);
}

float ZeroBasedExponentialMap(float maxValue, float midpointValue, float normalized) {
    if (maxValue <= 0.0f || midpointValue <= 0.0f || midpointValue >= maxValue) {
        throw std::invalid_argument("zero-based exponential mapping requires 0 < midpoint < max");
    }
    if (normalized <= 0.0f) {
        return 0.0f;
    }
    const float exponent = std::log(midpointValue / maxValue) / std::log(0.5f);
    return maxValue * std::pow(normalized, exponent);
}

std::uint8_t ToByte(float value) {
    return static_cast<std::uint8_t>(std::clamp(std::round(value * 255.0f), 0.0f, 255.0f));
}

Color DefaultVoiceColor(std::size_t voiceIx) {
    static constexpr std::array<Color, 6> kPalette = {
        Color{.r = 0, .g = 255, .b = 255, .a = 255},
        Color{.r = 255, .g = 128, .b = 0, .a = 255},
        Color{.r = 0, .g = 200, .b = 80, .a = 255},
        Color{.r = 75, .g = 0, .b = 130, .a = 255},
        Color{.r = 255, .g = 220, .b = 0, .a = 255},
        Color{.r = 0, .g = 80, .b = 255, .a = 255},
    };
    if (voiceIx < kPalette.size()) {
        return kPalette[voiceIx];
    }
    return Color::FromHSV(std::fmod(static_cast<float>(voiceIx) * 0.61803398875f, 1.0f), 0.7f, 0.95f);
}

void ApplySceneDistribution(float& left, float& right, float blend, float delta, RangeKind range) {
    blend = std::clamp(blend, 0.0f, 1.0f);
    if (&left == &right) {
        left = ClampToRange(left + delta, range);
        return;
    }

    if (blend <= 0.0f) {
        left = ClampToRange(left + delta, range);
        return;
    }
    if (blend >= 1.0f) {
        right = ClampToRange(right + delta, range);
        return;
    }

    const float inverseBlend = 1.0f - blend;
    const float targetBlended = ClampToRange(Blend(left, right, blend) + delta, range);
    const float proposedLeft = left + delta * inverseBlend;
    const float proposedRight = right + delta * blend;

    if (OutsideRange(proposedLeft, range)) {
        left = ClampToRange(proposedLeft, range);
        right = (targetBlended - left * inverseBlend) / blend;
    } else if (OutsideRange(proposedRight, range)) {
        right = ClampToRange(proposedRight, range);
        left = (targetBlended - right * blend) / inverseBlend;
    } else {
        left = proposedLeft;
        right = proposedRight;
    }
}

bool IsJsonArray(JSON json) {
    return json.m_node != nullptr && json.m_node->m_type == JsonType::Array;
}

bool IsJsonObject(JSON json) {
    return json.m_node != nullptr && json.m_node->m_type == JsonType::Object;
}

const JsonMember* JsonObjectMembers(JSON json) {
    if (!IsJsonObject(json)) {
        return nullptr;
    }
    return static_cast<const JsonMember*>(json.m_node->m_container.m_entries);
}

bool ParseDecimalIndex(std::string_view text, std::size_t& result) {
    if (text.empty()) {
        return false;
    }
    result = 0;
    const auto* begin = text.data();
    const auto* end = begin + text.size();
    const std::from_chars_result parsed = std::from_chars(begin, end, result);
    return parsed.ec == std::errc{} && parsed.ptr == end;
}

} // namespace

const Color Color::Off{.r = 0, .g = 0, .b = 0, .a = 255};
const Color Color::White{.r = 255, .g = 255, .b = 255, .a = 255};
const Color Color::Red{.r = 255, .g = 0, .b = 0, .a = 255};
const Color Color::Orange{.r = 255, .g = 128, .b = 0, .a = 255};
const Color Color::Yellow{.r = 255, .g = 220, .b = 0, .a = 255};
const Color Color::Green{.r = 0, .g = 200, .b = 80, .a = 255};
const Color Color::Cyan{.r = 0, .g = 255, .b = 255, .a = 255};
const Color Color::Blue{.r = 0, .g = 80, .b = 255, .a = 255};
const Color Color::Indigo{.r = 75, .g = 0, .b = 130, .a = 255};
const Color Color::Grey{.r = 128, .g = 128, .b = 128, .a = 255};

std::uint32_t Color::Packed() const {
    return static_cast<std::uint32_t>(r) | (static_cast<std::uint32_t>(g) << 8) |
           (static_cast<std::uint32_t>(b) << 16) | (static_cast<std::uint32_t>(a) << 24);
}

Color Color::FromPacked(std::uint32_t packed) {
    return {
        .r = static_cast<std::uint8_t>(packed & 0xff),
        .g = static_cast<std::uint8_t>((packed >> 8) & 0xff),
        .b = static_cast<std::uint8_t>((packed >> 16) & 0xff),
        .a = static_cast<std::uint8_t>((packed >> 24) & 0xff),
    };
}

Color Color::AdjustBrightness(float scale) const {
    return {
        .r = static_cast<std::uint8_t>(std::clamp(std::round(static_cast<float>(r) * scale), 0.0f, 255.0f)),
        .g = static_cast<std::uint8_t>(std::clamp(std::round(static_cast<float>(g) * scale), 0.0f, 255.0f)),
        .b = static_cast<std::uint8_t>(std::clamp(std::round(static_cast<float>(b) * scale), 0.0f, 255.0f)),
        .a = a,
    };
}

Color Color::FromHSV(float h, float s, float v) {
    h = std::fmod(h, 1.0f);
    if (h < 0.0f) {
        h += 1.0f;
    }
    s = std::clamp(s, 0.0f, 1.0f);
    v = std::clamp(v, 0.0f, 1.0f);
    const float c = v * s;
    const float hPrime = h * 6.0f;
    const float x = c * (1.0f - std::fabs(std::fmod(hPrime, 2.0f) - 1.0f));
    float r = 0.0f;
    float g = 0.0f;
    float b = 0.0f;
    if (hPrime < 1.0f) {
        r = c;
        g = x;
    } else if (hPrime < 2.0f) {
        r = x;
        g = c;
    } else if (hPrime < 3.0f) {
        g = c;
        b = x;
    } else if (hPrime < 4.0f) {
        g = x;
        b = c;
    } else if (hPrime < 5.0f) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }
    const float m = v - c;
    return {.r = ToByte(r + m), .g = ToByte(g + m), .b = ToByte(b + m), .a = 255};
}

HSV ToHSV(Color color) {
    const float r = static_cast<float>(color.r) / 255.0f;
    const float g = static_cast<float>(color.g) / 255.0f;
    const float b = static_cast<float>(color.b) / 255.0f;
    const float maxValue = std::max({r, g, b});
    const float minValue = std::min({r, g, b});
    const float delta = maxValue - minValue;
    float h = 0.0f;
    if (delta != 0.0f) {
        if (maxValue == r) {
            h = std::fmod((g - b) / delta, 6.0f);
        } else if (maxValue == g) {
            h = ((b - r) / delta) + 2.0f;
        } else {
            h = ((r - g) / delta) + 4.0f;
        }
        h /= 6.0f;
        if (h < 0.0f) {
            h += 1.0f;
        }
    }
    return {.h = h, .s = maxValue == 0.0f ? 0.0f : delta / maxValue, .v = maxValue};
}

float ClampToRange(float value, RangeKind range) {
    if (range == RangeKind::Bipolar) {
        return std::clamp(value, -1.0f, 1.0f);
    }
    return std::clamp(value, 0.0f, 1.0f);
}

bool ParameterGroupConfig::IsValid() const {
    return numVoices > 0 && numScenes > 0 && maxParameters > 0 && processLiteAlpha >= 0.0f &&
           processLiteAlpha <= 1.0f;
}

ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config, std::size_t gestureCount,
                                             std::size_t capacity)
    : numVoices(config.numVoices),
      numModulators(config.numModulators),
      numScenes(config.numScenes),
      gestureCount(gestureCount),
      capacity(capacity),
      currentCenterScaleArena(capacity * config.numVoices),
      targetCenterScaleArena(capacity * config.numVoices),
      currentNormalizationOffsetArena(capacity * config.numVoices),
      targetNormalizationOffsetArena(capacity * config.numVoices),
      currentMinValueArena(capacity * config.numVoices),
      targetMinValueArena(capacity * config.numVoices),
      currentMaxValueArena(capacity * config.numVoices),
      targetMaxValueArena(capacity * config.numVoices),
      currentDepthArena(capacity * config.numVoices * config.numModulators),
      targetDepthArena(capacity * config.numVoices * config.numModulators),
      modulationDepthArena(capacity * config.numModulators, nullptr),
      sceneCenterArena(capacity * config.numScenes),
      gestureValueArena(capacity * config.numScenes * gestureCount),
      gestureActiveArena(capacity * config.numScenes * gestureCount, 0) {
    parameters.reserve(capacity);
}

bool ParameterStorageBatch::Compatible(const ParameterGroupConfig& config, std::size_t liveGestureCount) const {
    return numVoices == config.numVoices && numModulators == config.numModulators &&
           numScenes == config.numScenes && gestureCount == liveGestureCount && capacity > 0;
}

std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                 std::size_t gestureCount,
                                                                 std::size_t capacity) {
    return std::make_unique<ParameterStorageBatch>(config, gestureCount, capacity);
}

Modulators::Modulators(std::size_t voices, std::size_t modulators)
    : numVoices_(voices),
      numModulators_(modulators),
      values_(voices * modulators, 0.0f),
      metadata_(modulators),
      sourcePointers_(voices * modulators, nullptr) {}

float& Modulators::Value(std::size_t voiceIx, std::size_t modIx) {
    return values_.at(Index(voiceIx, modIx));
}

float Modulators::Value(std::size_t voiceIx, std::size_t modIx) const {
    return values_.at(Index(voiceIx, modIx));
}

float Modulators::Apply(std::size_t voiceIx, std::span<const float> depths) const {
    if (voiceIx >= numVoices_) {
        throw std::out_of_range("modulator voice index out of range");
    }
    if (depths.size() != numModulators_) {
        throw std::invalid_argument("modulation depth row size does not match modulator count");
    }

    const std::size_t rowStart = voiceIx * numModulators_;
    float result = 0.0f;
    for (std::size_t modIx = 0; modIx < numModulators_; ++modIx) {
        result += values_[rowStart + modIx] * depths[modIx];
    }
    return result;
}

void Modulators::SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                                     ModulatorMetadata metadata) {
    if (modIx >= numModulators_) {
        throw std::out_of_range("modulator index out of range");
    }
    if (sourcePointers.size() != numVoices_) {
        throw std::invalid_argument("modulation source pointer count does not match voice count");
    }
    if (metadata.connected) {
        for (float* sourcePointer : sourcePointers) {
            if (sourcePointer == nullptr) {
                throw std::invalid_argument("connected modulation source pointer must not be null");
            }
        }
    }

    metadata_[modIx] = std::move(metadata);
    for (std::size_t voiceIx = 0; voiceIx < numVoices_; ++voiceIx) {
        sourcePointers_[voiceIx * numModulators_ + modIx] = sourcePointers[voiceIx];
    }
}

void Modulators::UpdateModValues() {
    for (std::size_t modIx = 0; modIx < numModulators_; ++modIx) {
        if (!metadata_[modIx].connected) {
            continue;
        }
        for (std::size_t voiceIx = 0; voiceIx < numVoices_; ++voiceIx) {
            const std::size_t index = voiceIx * numModulators_ + modIx;
            if (sourcePointers_[index] != nullptr) {
                values_[index] = *sourcePointers_[index];
            }
        }
    }
}

ModulatorMetadata& Modulators::Metadata(std::size_t modIx) {
    return metadata_.at(modIx);
}

const ModulatorMetadata& Modulators::Metadata(std::size_t modIx) const {
    return metadata_.at(modIx);
}

std::size_t Modulators::Index(std::size_t voiceIx, std::size_t modIx) const {
    if (voiceIx >= numVoices_) {
        throw std::out_of_range("modulator voice index out of range");
    }
    if (modIx >= numModulators_) {
        throw std::out_of_range("modulator index out of range");
    }
    return voiceIx * numModulators_ + modIx;
}

Gestures::Gestures(std::size_t gestures)
    : values_(gestures, 0.0f),
      selected_(gestures, false),
      metadata_(gestures) {}

float& Gestures::Value(std::size_t gestureIx) {
    CheckIndex(gestureIx);
    return values_[gestureIx];
}

float Gestures::Value(std::size_t gestureIx) const {
    CheckIndex(gestureIx);
    return values_[gestureIx];
}

void Gestures::Select(std::size_t gestureIx, bool selected) {
    CheckIndex(gestureIx);
    selected_[gestureIx] = selected;
}

bool Gestures::Selected(std::size_t gestureIx) const {
    CheckIndex(gestureIx);
    return selected_[gestureIx];
}

void Gestures::ClearSelection() {
    std::fill(selected_.begin(), selected_.end(), false);
}

GestureMetadata& Gestures::Metadata(std::size_t gestureIx) {
    CheckIndex(gestureIx);
    return metadata_[gestureIx];
}

const GestureMetadata& Gestures::Metadata(std::size_t gestureIx) const {
    CheckIndex(gestureIx);
    return metadata_[gestureIx];
}

void Gestures::CheckIndex(std::size_t gestureIx) const {
    if (gestureIx >= values_.size()) {
        throw std::out_of_range("gesture index out of range");
    }
}

ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
    : config_(ValidateConfig(config)),
      manager_(&manager),
      gestureCount_(gestureCount),
      voiceIndicatorColors_(config.voiceIndicatorColors),
      modulators_(config.numVoices, config.numModulators),
      parameterCount_(0) {
    if (voiceIndicatorColors_.size() < config_.numVoices) {
        const std::size_t existing = voiceIndicatorColors_.size();
        voiceIndicatorColors_.resize(config_.numVoices);
        for (std::size_t voiceIx = existing; voiceIx < config_.numVoices; ++voiceIx) {
            voiceIndicatorColors_[voiceIx] = DefaultVoiceColor(voiceIx);
        }
    }
    parameters_.reserve(config_.maxParameters);
    currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
    targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
    currentNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
    targetNormalizationOffsetArena_.resize(config_.maxParameters * config_.numVoices);
    currentMinValueArena_.resize(config_.maxParameters * config_.numVoices);
    targetMinValueArena_.resize(config_.maxParameters * config_.numVoices);
    currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
    targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
    currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
    targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
    modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
    sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
    gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
    gestureActiveArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_, 0);
}

ParameterGroup::~ParameterGroup() = default;

bool ParameterGroup::CanAllocate() const {
    return AvailableParameterSlots() > 0;
}

std::size_t ParameterGroup::AvailableParameterSlots() const {
    const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
    std::size_t available = config_.maxParameters - initialAllocated;
    for (const auto& batch : extraStorageBatches_) {
        available += batch->Available();
    }
    return available;
}

void ParameterGroup::AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch) {
    if (batch == nullptr || !batch->Compatible(config_, gestureCount_)) {
        throw std::invalid_argument("parameter storage batch does not match group shape");
    }
    storageRequestPending_ = false;
    extraStorageBatches_.push_back(std::move(batch));
}

Parameter& ParameterGroup::CreateLocalParameter(ParameterConfig config, ParameterId id) {
    if (config.name.empty()) {
        throw std::logic_error("parameter name must not be empty");
    }
    if (!CanAllocate()) {
        throw std::length_error("parameter group capacity exhausted");
    }

    if (parameterCount_ < config_.maxParameters) {
        auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), parameterCount_);
        Parameter& result = *parameter;
        parameters_.push_back(std::move(parameter));
        ++parameterCount_;
        RequestParameterStorageBatchIfLow();
        return result;
    }

    for (const auto& batch : extraStorageBatches_) {
        if (batch->Available() == 0) {
            continue;
        }
        const std::size_t slotIx = batch->allocated++;
        auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), *batch, slotIx);
        Parameter& result = *parameter;
        batch->parameters.push_back(std::move(parameter));
        ++parameterCount_;
        RequestParameterStorageBatchIfLow();
        return result;
    }

    throw std::length_error("parameter group capacity exhausted");
}

Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) {
    if (localIx < parameters_.size()) {
        return *parameters_.at(localIx);
    }
    std::size_t remaining = localIx - parameters_.size();
    for (const auto& batch : extraStorageBatches_) {
        if (remaining < batch->parameters.size()) {
            return *batch->parameters.at(remaining);
        }
        remaining -= batch->parameters.size();
    }
    throw std::out_of_range("parameter local index out of range");
}

const Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) const {
    if (localIx < parameters_.size()) {
        return *parameters_.at(localIx);
    }
    std::size_t remaining = localIx - parameters_.size();
    for (const auto& batch : extraStorageBatches_) {
        if (remaining < batch->parameters.size()) {
            return *batch->parameters.at(remaining);
        }
        remaining -= batch->parameters.size();
    }
    throw std::out_of_range("parameter local index out of range");
}

void ParameterGroup::RequestParameterStorageBatch(std::size_t minimumAdditionalParameters) {
    if (storageRequestPending_ || manager_ == nullptr || minimumAdditionalParameters == 0) {
        return;
    }
    if (manager_->RequestParameterStorageBatch(*this, minimumAdditionalParameters)) {
        storageRequestPending_ = true;
    }
}

void ParameterGroup::RequestParameterStorageBatchIfLow() {
    const std::size_t lowWatermark = config_.numModulators * 2;
    if (lowWatermark == 0) {
        return;
    }
    const std::size_t available = AvailableParameterSlots();
    if (available < lowWatermark) {
        RequestParameterStorageBatch(lowWatermark - available);
    }
}

Color ParameterGroup::VoiceIndicatorColor(std::size_t voiceIx) const {
    if (voiceIx >= config_.numVoices) {
        throw std::out_of_range("voice indicator index out of range");
    }
    return voiceIndicatorColors_[voiceIx];
}

void ParameterGroup::SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                                         ModulatorMetadata metadata) {
    modulators_.SetModulationSource(modIx, sourcePointers, std::move(metadata));
}

void ParameterGroup::UpdateModValues() {
    modulators_.UpdateModValues();
}

Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
    : id_(id),
      group_(group),
      config_(std::move(config)),
      slotIx_(slotIx),
      currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
      targetCenter_(currentCenter_),
      currentCenterScales_(ArenaSlice(group_.currentCenterScaleArena_, slotIx_ * group_.Config().numVoices,
                                      group_.Config().numVoices)),
      targetCenterScales_(ArenaSlice(group_.targetCenterScaleArena_, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
      currentNormalizationOffsets_(ArenaSlice(group_.currentNormalizationOffsetArena_,
                                             slotIx_ * group_.Config().numVoices,
                                             group_.Config().numVoices)),
      targetNormalizationOffsets_(ArenaSlice(group_.targetNormalizationOffsetArena_,
                                            slotIx_ * group_.Config().numVoices,
                                            group_.Config().numVoices)),
      currentMinValues_(ArenaSlice(group_.currentMinValueArena_,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
      targetMinValues_(ArenaSlice(group_.targetMinValueArena_,
                                  slotIx_ * group_.Config().numVoices,
                                  group_.Config().numVoices)),
      currentMaxValues_(ArenaSlice(group_.currentMaxValueArena_,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
      targetMaxValues_(ArenaSlice(group_.targetMaxValueArena_,
                                  slotIx_ * group_.Config().numVoices,
                                  group_.Config().numVoices)),
      currentDepths_(ArenaSlice(group_.currentDepthArena_,
                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                group_.Config().numVoices * group_.Config().numModulators)),
      targetDepths_(ArenaSlice(group_.targetDepthArena_,
                               slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                               group_.Config().numVoices * group_.Config().numModulators)),
      modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
                                   group_.Config().numModulators)),
      sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
                               group_.Config().numScenes)),
      gestureValues_(ArenaSlice(group_.gestureValueArena_,
                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                group_.Config().numScenes * group_.GestureCount())),
      gestureActive_(ArenaSlice(group_.gestureActiveArena_,
                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                group_.Config().numScenes * group_.GestureCount())) {
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
    std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
    std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
    std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
    std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
}

Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
                     ParameterStorageBatch& storageBatch, std::size_t slotIx)
    : id_(id),
      group_(group),
      config_(std::move(config)),
      slotIx_(slotIx),
      currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
      targetCenter_(currentCenter_),
      currentCenterScales_(ArenaSlice(storageBatch.currentCenterScaleArena, slotIx_ * group_.Config().numVoices,
                                      group_.Config().numVoices)),
      targetCenterScales_(ArenaSlice(storageBatch.targetCenterScaleArena, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
      currentNormalizationOffsets_(ArenaSlice(storageBatch.currentNormalizationOffsetArena,
                                             slotIx_ * group_.Config().numVoices,
                                             group_.Config().numVoices)),
      targetNormalizationOffsets_(ArenaSlice(storageBatch.targetNormalizationOffsetArena,
                                            slotIx_ * group_.Config().numVoices,
                                            group_.Config().numVoices)),
      currentMinValues_(ArenaSlice(storageBatch.currentMinValueArena,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
      targetMinValues_(ArenaSlice(storageBatch.targetMinValueArena,
                                  slotIx_ * group_.Config().numVoices,
                                  group_.Config().numVoices)),
      currentMaxValues_(ArenaSlice(storageBatch.currentMaxValueArena,
                                   slotIx_ * group_.Config().numVoices,
                                   group_.Config().numVoices)),
      targetMaxValues_(ArenaSlice(storageBatch.targetMaxValueArena,
                                  slotIx_ * group_.Config().numVoices,
                                  group_.Config().numVoices)),
      currentDepths_(ArenaSlice(storageBatch.currentDepthArena,
                                slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                                group_.Config().numVoices * group_.Config().numModulators)),
      targetDepths_(ArenaSlice(storageBatch.targetDepthArena,
                               slotIx_ * group_.Config().numVoices * group_.Config().numModulators,
                               group_.Config().numVoices * group_.Config().numModulators)),
      modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
                                   group_.Config().numModulators)),
      sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
                               group_.Config().numScenes)),
      gestureValues_(ArenaSlice(storageBatch.gestureValueArena,
                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                group_.Config().numScenes * group_.GestureCount())),
      gestureActive_(ArenaSlice(storageBatch.gestureActiveArena,
                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                group_.Config().numScenes * group_.GestureCount())) {
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
    std::fill(currentMinValues_.begin(), currentMinValues_.end(), currentCenter_);
    std::fill(targetMinValues_.begin(), targetMinValues_.end(), currentCenter_);
    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), currentCenter_);
    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), currentCenter_);
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
    std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
    std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
}

ParameterStorageBatch::~ParameterStorageBatch() = default;

void Parameter::UIState::Configure(std::size_t newVoiceCapacity) {
    voiceCapacity = newVoiceCapacity;
    values = std::make_unique<std::atomic<float>[]>(voiceCapacity);
    minValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
    maxValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
    switchValue = std::make_unique<std::atomic<std::size_t>[]>(voiceCapacity);
    indicatorColors = std::make_unique<AtomicColor[]>(voiceCapacity);
    SetDisconnected();
}

void Parameter::UIState::SetDisconnected() {
    revision.fetch_add(1, std::memory_order_acq_rel);
    connected.store(false, std::memory_order_relaxed);
    bipolar.store(false, std::memory_order_relaxed);
    switchValues.store(0, std::memory_order_relaxed);
    modulatorsAffectingMask.store(0, std::memory_order_relaxed);
    gesturesAffectingMask.store(0, std::memory_order_relaxed);
    color.Store(Color::Off);
    brightness.store(0.0f, std::memory_order_relaxed);
    shortName.store(nullptr, std::memory_order_relaxed);
    voiceCount.store(0, std::memory_order_relaxed);
    for (std::size_t voiceIx = 0; voiceIx < voiceCapacity; ++voiceIx) {
        values[voiceIx].store(0.0f, std::memory_order_relaxed);
        minValues[voiceIx].store(0.0f, std::memory_order_relaxed);
        maxValues[voiceIx].store(0.0f, std::memory_order_relaxed);
        switchValue[voiceIx].store(0, std::memory_order_relaxed);
        indicatorColors[voiceIx].Store(Color::Off);
    }
    revision.fetch_add(1, std::memory_order_release);
}

std::size_t Parameter::SwitchValues() const {
    return config_.switchValues;
}

bool Parameter::IsSwitch() const {
    return config_.switchValues > 1;
}

float Parameter::Get(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return ClampToRange(currentCenter_ * currentCenterScales_[voiceIx] + currentNormalizationOffsets_[voiceIx] +
                            group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
                        config_.range);
}

std::size_t Parameter::GetSwitchVal(std::size_t voiceIx) const {
    if (config_.switchValues <= 1) {
        if (voiceIx >= group_.Config().numVoices) {
            throw std::out_of_range("parameter voice index out of range");
        }
        return 0;
    }

    float normalized = TargetValue(voiceIx);
    if (config_.range == RangeKind::Bipolar) {
        normalized = (normalized + 1.0f) * 0.5f;
    }
    normalized = std::clamp(normalized, 0.0f, 1.0f);
    const double maxBucket = static_cast<double>(config_.switchValues - 1);
    const double rounded = std::round(static_cast<double>(normalized) * maxBucket);
    return static_cast<std::size_t>(std::clamp(rounded, 0.0, maxBucket));
}

void Parameter::PopulateUIState(UIState& state) const {
    const std::size_t voices = std::min(state.voiceCapacity, group_.Config().numVoices);
    state.revision.fetch_add(1, std::memory_order_acq_rel);
    state.bipolar.store(config_.range == RangeKind::Bipolar, std::memory_order_relaxed);
    state.switchValues.store(config_.switchValues, std::memory_order_relaxed);
    state.modulatorsAffectingMask.store(ModulatorsAffectingMask(), std::memory_order_relaxed);
    state.gesturesAffectingMask.store(GesturesAffectingMask(), std::memory_order_relaxed);
    state.color.Store(config_.color);
    state.brightness.store(1.0f, std::memory_order_relaxed);
    state.shortName.store(config_.shortName.c_str(), std::memory_order_relaxed);
    state.voiceCount.store(voices, std::memory_order_relaxed);
    for (std::size_t voiceIx = 0; voiceIx < voices; ++voiceIx) {
        state.values[voiceIx].store(Get(voiceIx), std::memory_order_relaxed);
        state.minValues[voiceIx].store(currentMinValues_[voiceIx], std::memory_order_relaxed);
        state.maxValues[voiceIx].store(currentMaxValues_[voiceIx], std::memory_order_relaxed);
        state.switchValue[voiceIx].store(GetSwitchVal(voiceIx), std::memory_order_relaxed);
        state.indicatorColors[voiceIx].Store(group_.VoiceIndicatorColor(voiceIx));
    }
    for (std::size_t voiceIx = voices; voiceIx < state.voiceCapacity; ++voiceIx) {
        state.values[voiceIx].store(0.0f, std::memory_order_relaxed);
        state.minValues[voiceIx].store(0.0f, std::memory_order_relaxed);
        state.maxValues[voiceIx].store(0.0f, std::memory_order_relaxed);
        state.switchValue[voiceIx].store(0, std::memory_order_relaxed);
        state.indicatorColors[voiceIx].Store(Color::Off);
    }
    state.connected.store(true, std::memory_order_relaxed);
    state.revision.fetch_add(1, std::memory_order_release);
}

void Parameter::Compute(const SceneState& scene) {
    ComputeAtDepth(scene, 0);
}

JSON Parameter::ToValueJSON(JsonArena& arena) const {
    JSON root = arena.Object();

    JSON sceneCenters = arena.Array();
    for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
        sceneCenters.AppendNew(arena.Real(SceneCenter(sceneIx)));
    }
    root.SetNew("sceneCenters", sceneCenters);

    JSON gestureValues = arena.Array();
    for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
        JSON row = arena.Array();
        for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
            row.AppendNew(arena.Real(GestureValue(sceneIx, gestureIx)));
        }
        gestureValues.AppendNew(row);
    }
    root.SetNew("gestureValues", gestureValues);

    JSON gestureActive = arena.Array();
    for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
        JSON row = arena.Array();
        for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
            row.AppendNew(arena.Boolean(GestureActive(sceneIx, gestureIx)));
        }
        gestureActive.AppendNew(row);
    }
    root.SetNew("gestureActive", gestureActive);

    JSON modDepths = arena.Object();
    for (std::size_t modIx = 0; modIx < modulationDepths_.size(); ++modIx) {
        const Parameter* depthParameter = modulationDepths_[modIx];
        if (depthParameter == nullptr || !depthParameter->HasNonDefaultState()) {
            continue;
        }
        const std::string key = std::to_string(modIx);
        modDepths.SetNew(key.c_str(), depthParameter->ToValueJSON(arena));
    }
    root.SetNew("modDepths", modDepths);

    return root;
}

bool Parameter::LoadValuesFromJSON(JSON json) {
    if (!IsJsonObject(json)) {
        return false;
    }

    JSON sceneCenters = json.Get("sceneCenters");
    if (!sceneCenters.IsNull() && IsJsonArray(sceneCenters) && sceneCenters.Size() == group_.Config().numScenes) {
        for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
            SceneCenter(sceneIx) = static_cast<float>(sceneCenters.GetAt(sceneIx).NumberValue());
        }
    }

    JSON gestureValues = json.Get("gestureValues");
    bool gestureValuesShapeMatches = !gestureValues.IsNull() && IsJsonArray(gestureValues) &&
                                     gestureValues.Size() == group_.Config().numScenes;
    if (gestureValuesShapeMatches) {
        for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
            JSON row = gestureValues.GetAt(sceneIx);
            if (!IsJsonArray(row) || row.Size() != group_.GestureCount()) {
                gestureValuesShapeMatches = false;
                break;
            }
        }
    }
    if (gestureValuesShapeMatches) {
        for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
            JSON row = gestureValues.GetAt(sceneIx);
            for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
                GestureValue(sceneIx, gestureIx) = static_cast<float>(row.GetAt(gestureIx).NumberValue());
            }
        }
    }

    JSON gestureActive = json.Get("gestureActive");
    bool gestureActiveShapeMatches = !gestureActive.IsNull() && IsJsonArray(gestureActive) &&
                                     gestureActive.Size() == group_.Config().numScenes;
    if (gestureActiveShapeMatches) {
        for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
            JSON row = gestureActive.GetAt(sceneIx);
            if (!IsJsonArray(row) || row.Size() != group_.GestureCount()) {
                gestureActiveShapeMatches = false;
                break;
            }
        }
    }
    if (gestureActiveShapeMatches) {
        for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
            JSON row = gestureActive.GetAt(sceneIx);
            for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
                SetGestureActive(sceneIx, gestureIx, row.GetAt(gestureIx).BooleanValue());
            }
        }
    }

    JSON modDepths = json.Get("modDepths");
    if (IsJsonObject(modDepths)) {
        const JsonMember* members = JsonObjectMembers(modDepths);
        for (std::size_t ix = 0; ix < modDepths.Size(); ++ix) {
            if (members[ix].m_key == nullptr) {
                continue;
            }
            std::size_t modIx = 0;
            if (!ParseDecimalIndex(members[ix].m_key, modIx) || modIx >= modulationDepths_.size()) {
                continue;
            }
            Parameter* depthParameter = modulationDepths_[modIx];
            if (depthParameter == nullptr) {
                depthParameter = EnsureModulationDepth(modIx);
            }
            if (depthParameter == nullptr) {
                continue;
            }
            depthParameter->LoadValuesFromJSON(JSON(members[ix].m_value));
        }
    }

    return true;
}

void Parameter::ProcessLite() {
    const float alpha = group_.Config().processLiteAlpha;
    currentCenter_ += alpha * (targetCenter_ - currentCenter_);
    for (std::size_t voiceIx = 0; voiceIx < currentCenterScales_.size(); ++voiceIx) {
        currentCenterScales_[voiceIx] +=
            alpha * (targetCenterScales_[voiceIx] - currentCenterScales_[voiceIx]);
        currentNormalizationOffsets_[voiceIx] +=
            alpha * (targetNormalizationOffsets_[voiceIx] - currentNormalizationOffsets_[voiceIx]);
        currentMinValues_[voiceIx] += alpha * (targetMinValues_[voiceIx] - currentMinValues_[voiceIx]);
        currentMaxValues_[voiceIx] += alpha * (targetMaxValues_[voiceIx] - currentMaxValues_[voiceIx]);
    }
    for (std::size_t ix = 0; ix < currentDepths_.size(); ++ix) {
        currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
    }
}

void Parameter::HandleIncDec(const SceneState& scene, float delta) {
    ValidateSceneEndpoints(scene);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);

    auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
        if (GestureActive(sceneIx, gestureIx)) {
            return false;
        }
        GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
        SetGestureActive(sceneIx, gestureIx, true);
        return true;
    };

    bool armedGesture = false;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        if (!group_.Manager().GestureSelected(gestureIx)) {
            continue;
        }

        if (blend <= 0.0f) {
            armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
        } else if (blend >= 1.0f) {
            armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
        } else {
            armedGesture = armSelectedGesture(scene.leftScene, gestureIx) || armedGesture;
            if (scene.rightScene != scene.leftScene) {
                armedGesture = armSelectedGesture(scene.rightScene, gestureIx) || armedGesture;
            }
        }
    }

    if (armedGesture) {
        return;
    }

    float activeEffectiveWeightSum = 0.0f;
    float baseShareNumerator = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }
        activeEffectiveWeightSum += effectiveWeight;
        baseShareNumerator += effectiveWeight * (1.0f - effectiveWeight);
    }

    if (activeEffectiveWeightSum == 0.0f) {
        ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
        return;
    }

    ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
                           delta * (baseShareNumerator / activeEffectiveWeightSum), config_.range);

    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }

        const float gestureDelta = delta * ((effectiveWeight * effectiveWeight) / activeEffectiveWeightSum);
        ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
                               blend, gestureDelta, config_.range);
    }
}

void Parameter::RevertToDefault(const SceneState& scene) {
    ValidateSceneEndpoints(scene);
    for (Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr) {
            depthParameter->ResetModulationDepthToNeutral(scene);
        }
    }
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    if (blend <= 0.0f) {
        ResetSceneToDefault(scene.leftScene, defaultValue);
    } else if (blend >= 1.0f) {
        ResetSceneToDefault(scene.rightScene, defaultValue);
    } else {
        ResetSceneToDefault(scene.leftScene, defaultValue);
        if (scene.rightScene != scene.leftScene) {
            ResetSceneToDefault(scene.rightScene, defaultValue);
        }
    }

    currentCenter_ = defaultValue;
    targetCenter_ = defaultValue;
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentMinValues_.begin(), currentMinValues_.end(), defaultValue);
    std::fill(targetMinValues_.begin(), targetMinValues_.end(), defaultValue);
    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), defaultValue);
    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), defaultValue);
}

void Parameter::RevertAllToDefault() {
    for (Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr) {
            depthParameter->RevertAllToDefault();
        }
    }
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
    for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
        ResetSceneToDefault(sceneIx, defaultValue);
        for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
            GestureValue(sceneIx, gestureIx) = defaultValue;
        }
    }

    currentCenter_ = defaultValue;
    targetCenter_ = defaultValue;
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentMinValues_.begin(), currentMinValues_.end(), defaultValue);
    std::fill(targetMinValues_.begin(), targetMinValues_.end(), defaultValue);
    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), defaultValue);
    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), defaultValue);
}

bool Parameter::AssignModulationDepth(std::size_t modIx, Parameter* parameter) {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    if (parameter != nullptr && &parameter->Group() != &group_) {
        return false;
    }
    if (parameter != nullptr && WouldCreateCycle(parameter)) {
        return false;
    }

    modulationDepths_[modIx] = parameter;
    return true;
}

Parameter* Parameter::EnsureModulationDepth(std::size_t modIx) {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    if (Parameter* existing = modulationDepths_[modIx]; existing != nullptr) {
        return existing;
    }
    if (!group_.CanAllocate()) {
        group_.RequestParameterStorageBatch(1);
        return nullptr;
    }
    return &EnsureModulationDepth(modIx, ModulationDepthConfig(modIx));
}

Parameter& Parameter::EnsureModulationDepth(std::size_t modIx, ParameterConfig config) {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    if (Parameter* existing = modulationDepths_[modIx]; existing != nullptr) {
        return *existing;
    }

    Parameter& created = group_.CreateLocalParameter(std::move(config), kLocalParameterId);
    if (!AssignModulationDepth(modIx, &created)) {
        throw std::logic_error("created modulation depth could not be assigned");
    }
    return created;
}

void Parameter::ClearModulationDepths() {
    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
}

Parameter* Parameter::ModulationDepthParameter(std::size_t modIx) const {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    return modulationDepths_[modIx];
}

ParameterConfig Parameter::ModulationDepthConfig(std::size_t modIx) const {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    const ModulatorMetadata& modulator = group_.GetModulators().Metadata(modIx);
    return {
        .name = modulator.name.empty()
                    ? Name() + " Mod Depth " + std::to_string(modIx + 1)
                    : Name() + " " + modulator.name,
        .shortName = modulator.shortName.empty() ? ShortName() : modulator.shortName,
        .defaultValue = 0.0f,
        .range = RangeKind::Bipolar,
        .color = modulator.color,
    };
}

float& Parameter::SceneCenter(std::size_t sceneIx) {
    if (sceneIx >= group_.Config().numScenes) {
        throw std::out_of_range("parameter scene index out of range");
    }
    return sceneCenters_[sceneIx];
}

float Parameter::SceneCenter(std::size_t sceneIx) const {
    if (sceneIx >= group_.Config().numScenes) {
        throw std::out_of_range("parameter scene index out of range");
    }
    return sceneCenters_[sceneIx];
}

float& Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) {
    return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
}

float Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) const {
    return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
}

void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active) {
    gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] = active ? 1 : 0;
}

bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
    return gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] != 0;
}

std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    if (group_.Config().numModulators == 0) {
        return {};
    }
    const std::size_t rowStart = voiceIx * group_.Config().numModulators;
    return std::span<float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
}

std::span<const float> Parameter::CurrentDepths(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    if (group_.Config().numModulators == 0) {
        return {};
    }
    const std::size_t rowStart = voiceIx * group_.Config().numModulators;
    return std::span<const float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
}

std::span<float> Parameter::TargetDepths(std::size_t voiceIx) {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    if (group_.Config().numModulators == 0) {
        return {};
    }
    const std::size_t rowStart = voiceIx * group_.Config().numModulators;
    return std::span<float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
}

std::span<const float> Parameter::TargetDepths(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    if (group_.Config().numModulators == 0) {
        return {};
    }
    const std::size_t rowStart = voiceIx * group_.Config().numModulators;
    return std::span<const float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
}

float Parameter::CurrentCenterScale(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return currentCenterScales_[voiceIx];
}

float Parameter::TargetCenterScale(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return targetCenterScales_[voiceIx];
}

float Parameter::CurrentNormalizationOffset(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return currentNormalizationOffsets_[voiceIx];
}

float Parameter::TargetNormalizationOffset(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return targetNormalizationOffsets_[voiceIx];
}

std::size_t Parameter::VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    if (modIx >= group_.Config().numModulators) {
        throw std::out_of_range("parameter modulator index out of range");
    }
    return voiceIx * group_.Config().numModulators + modIx;
}

std::size_t Parameter::SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const {
    if (sceneIx >= group_.Config().numScenes) {
        throw std::out_of_range("parameter scene index out of range");
    }
    if (gestureIx >= group_.GestureCount()) {
        throw std::out_of_range("parameter gesture index out of range");
    }
    return sceneIx * group_.GestureCount() + gestureIx;
}

void Parameter::ValidateSceneEndpoints(const SceneState& scene) const {
    if (scene.leftScene >= group_.Config().numScenes || scene.rightScene >= group_.Config().numScenes) {
        throw std::out_of_range("parameter scene index out of range");
    }
}

float Parameter::EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const {
    const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
    const float groupWeight = group_.Manager().GestureValue(gestureIx);
    const float leftWeight = GestureActive(scene.leftScene, gestureIx) ? groupWeight * (1.0f - clampedBlend) : 0.0f;
    const float rightWeight = GestureActive(scene.rightScene, gestureIx) ? groupWeight * clampedBlend : 0.0f;
    return leftWeight + rightWeight;
}

void Parameter::ResetSceneToDefault(std::size_t sceneIx, float defaultValue) {
    SceneCenter(sceneIx) = defaultValue;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        SetGestureActive(sceneIx, gestureIx, false);
    }
}

void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
    ValidateSceneEndpoints(scene);
    for (Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr) {
            depthParameter->ResetModulationDepthToNeutral(scene);
        }
    }

    constexpr float neutralDepth = 0.0f;
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    if (blend <= 0.0f) {
        ResetSceneToDefault(scene.leftScene, neutralDepth);
    } else if (blend >= 1.0f) {
        ResetSceneToDefault(scene.rightScene, neutralDepth);
    } else {
        ResetSceneToDefault(scene.leftScene, neutralDepth);
        if (scene.rightScene != scene.leftScene) {
            ResetSceneToDefault(scene.rightScene, neutralDepth);
        }
    }

    currentCenter_ = neutralDepth;
    targetCenter_ = neutralDepth;
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
    std::fill(currentMinValues_.begin(), currentMinValues_.end(), neutralDepth);
    std::fill(targetMinValues_.begin(), targetMinValues_.end(), neutralDepth);
    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), neutralDepth);
    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), neutralDepth);
    std::fill(currentDepths_.begin(), currentDepths_.end(), neutralDepth);
    std::fill(targetDepths_.begin(), targetDepths_.end(), neutralDepth);
}

float Parameter::ComputeRawCenter(const SceneState& scene) const {
    ValidateSceneEndpoints(scene);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    const float inverseBlend = 1.0f - blend;
    const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;

    float weightedMixSum = 0.0f;
    float activeWeightSum = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }

        const float gestureValue = GestureValue(scene.leftScene, gestureIx) * inverseBlend +
                                   GestureValue(scene.rightScene, gestureIx) * blend;
        const float mix = base * (1.0f - effectiveWeight) + gestureValue * effectiveWeight;
        weightedMixSum += effectiveWeight * mix;
        activeWeightSum += effectiveWeight;
    }

    if (activeWeightSum == 0.0f) {
        return base;
    }
    return weightedMixSum / activeWeightSum;
}

void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth) {
    recursionDepth_ = recursionDepth;
    targetCenter_ = ClampToRange(ComputeRawCenter(scene), config_.range);

    for (Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr) {
            depthParameter->ComputeAtDepth(scene, recursionDepth_ + 1);
        }
    }

    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
        float weightSum = 0.0f;
        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
            const Parameter* depthParameter = modulationDepths_[modIx];
            const float depth = depthParameter == nullptr ? 0.0f : depthParameter->Get(voiceIx);
            targetDepths_[VoiceModIndex(voiceIx, modIx)] = depth;
            weightSum += std::fabs(depth);
        }

        if (weightSum < 1.0f) {
            targetCenterScales_[voiceIx] = 1.0f - weightSum;
        } else {
            targetCenterScales_[voiceIx] = 0.0f;
            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
                targetDepths_[VoiceModIndex(voiceIx, modIx)] /= weightSum;
            }
        }

        float normalizationOffset = 0.0f;
        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceModIndex(voiceIx, modIx)]);
        }
        targetNormalizationOffsets_[voiceIx] = normalizationOffset;

        if (weightSum > 1.0f) {
            targetMinValues_[voiceIx] = RangeMin(config_.range);
            targetMaxValues_[voiceIx] = RangeMax(config_.range);
        } else {
            float minContribution = 0.0f;
            float maxContribution = 0.0f;
            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
                const float depth = targetDepths_[VoiceModIndex(voiceIx, modIx)];
                minContribution += std::min(0.0f, depth);
                maxContribution += std::max(0.0f, depth);
            }
            const float base = targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx];
            targetMinValues_[voiceIx] = ClampToRange(base + minContribution, config_.range);
            targetMaxValues_[voiceIx] = ClampToRange(base + maxContribution, config_.range);
        }
    }

    if (recursionDepth_ > 0) {
        currentCenter_ = targetCenter_;
        std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
        std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(),
                  currentNormalizationOffsets_.begin());
        std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
        std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
        std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
    }
}

void Parameter::SnapCurrentToTarget() {
    currentCenter_ = targetCenter_;
    std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
    std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), currentNormalizationOffsets_.begin());
    std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
    std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
    std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
    for (Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr) {
            depthParameter->SnapCurrentToTarget();
        }
    }
}

bool Parameter::WouldCreateCycle(const Parameter* candidate) const {
    if (candidate == this) {
        return true;
    }

    for (const Parameter* route : candidate->modulationDepths_) {
        if (route != nullptr && WouldCreateCycle(route)) {
            return true;
        }
    }
    return false;
}

float Parameter::TargetValue(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return ClampToRange(targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx] +
                            group_.GetModulators().Apply(voiceIx, TargetDepths(voiceIx)),
                        config_.range);
}

std::uint32_t Parameter::ModulatorsAffectingMask() const {
    std::uint32_t mask = 0;
    const std::size_t count = std::min<std::size_t>(modulationDepths_.size(), 32);
    for (std::size_t modIx = 0; modIx < count; ++modIx) {
        if (modulationDepths_[modIx] != nullptr && modulationDepths_[modIx]->HasNonZeroState()) {
            mask |= (std::uint32_t{1} << modIx);
        }
    }
    return mask;
}

bool Parameter::HasNonZeroState() const {
    constexpr float tolerance = 0.000001f;

    if (std::fabs(currentCenter_) > tolerance || std::fabs(targetCenter_) > tolerance) {
        return true;
    }
    for (const float center : sceneCenters_) {
        if (std::fabs(center) > tolerance) {
            return true;
        }
    }
    for (const std::uint8_t active : gestureActive_) {
        if (active != 0) {
            return true;
        }
    }
    for (const float depth : currentDepths_) {
        if (std::fabs(depth) > tolerance) {
            return true;
        }
    }
    for (const float depth : targetDepths_) {
        if (std::fabs(depth) > tolerance) {
            return true;
        }
    }
    for (const float offset : currentNormalizationOffsets_) {
        if (std::fabs(offset) > tolerance) {
            return true;
        }
    }
    for (const float offset : targetNormalizationOffsets_) {
        if (std::fabs(offset) > tolerance) {
            return true;
        }
    }
    for (const Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr && depthParameter->HasNonZeroState()) {
            return true;
        }
    }
    return false;
}

bool Parameter::HasNonDefaultState() const {
    constexpr float tolerance = 0.000001f;
    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);

    if (std::fabs(currentCenter_ - defaultValue) > tolerance ||
        std::fabs(targetCenter_ - defaultValue) > tolerance) {
        return true;
    }
    for (const float center : sceneCenters_) {
        if (std::fabs(center - defaultValue) > tolerance) {
            return true;
        }
    }
    for (const float value : gestureValues_) {
        if (std::fabs(value - defaultValue) > tolerance) {
            return true;
        }
    }
    for (const std::uint8_t active : gestureActive_) {
        if (active != 0) {
            return true;
        }
    }
    for (const float depth : currentDepths_) {
        if (std::fabs(depth) > tolerance) {
            return true;
        }
    }
    for (const float depth : targetDepths_) {
        if (std::fabs(depth) > tolerance) {
            return true;
        }
    }
    for (const float scale : currentCenterScales_) {
        if (std::fabs(scale - 1.0f) > tolerance) {
            return true;
        }
    }
    for (const float scale : targetCenterScales_) {
        if (std::fabs(scale - 1.0f) > tolerance) {
            return true;
        }
    }
    for (const float offset : currentNormalizationOffsets_) {
        if (std::fabs(offset) > tolerance) {
            return true;
        }
    }
    for (const float offset : targetNormalizationOffsets_) {
        if (std::fabs(offset) > tolerance) {
            return true;
        }
    }
    for (const Parameter* depthParameter : modulationDepths_) {
        if (depthParameter != nullptr && depthParameter->HasNonDefaultState()) {
            return true;
        }
    }
    return false;
}

std::uint32_t Parameter::GesturesAffectingMask() const {
    std::uint32_t mask = 0;
    const SceneState& scene = group_.Manager().Scene();
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    const std::size_t count = std::min<std::size_t>(group_.GestureCount(), 32);
    const bool leftSceneValid = scene.leftScene < group_.Config().numScenes;
    const bool rightSceneValid = scene.rightScene < group_.Config().numScenes;
    for (std::size_t gestureIx = 0; gestureIx < count; ++gestureIx) {
        bool active = false;
        if (blend <= 0.0f) {
            active = leftSceneValid && GestureActive(scene.leftScene, gestureIx);
        } else if (blend >= 1.0f) {
            active = rightSceneValid && GestureActive(scene.rightScene, gestureIx);
        } else {
            active = (leftSceneValid && GestureActive(scene.leftScene, gestureIx)) ||
                     (rightSceneValid && GestureActive(scene.rightScene, gestureIx));
        }
        if (active) {
            mask |= (std::uint32_t{1} << gestureIx);
        }
    }
    return mask;
}

void ParameterGroup::SelectGesture(std::size_t gestureIx) {
    manager_->SelectGesture(gestureIx);
}

void ParameterGroup::DeselectGesture(std::size_t gestureIx) {
    manager_->DeselectGesture(gestureIx);
}

bool ParameterGroup::GestureSelected(std::size_t gestureIx) const {
    return manager_->GestureSelected(gestureIx);
}

void ParameterGroup::SetGestureValue(std::size_t gestureIx, float value) {
    manager_->SetGestureValue(gestureIx, value);
}

float ParameterGroup::GestureValue(std::size_t gestureIx) const {
    return manager_->GestureValue(gestureIx);
}

void ParameterGroup::ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx) {
    if (gestureIx >= gestureCount_) {
        throw std::out_of_range("gesture index out of range");
    }
    if (scene.leftScene >= config_.numScenes || scene.rightScene >= config_.numScenes) {
        throw std::out_of_range("scene index out of range");
    }

    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    auto clearParameter = [&](Parameter& parameter) {
        if (blend <= 0.0f) {
            parameter.SetGestureActive(scene.leftScene, gestureIx, false);
        } else if (blend >= 1.0f) {
            parameter.SetGestureActive(scene.rightScene, gestureIx, false);
        } else {
            parameter.SetGestureActive(scene.leftScene, gestureIx, false);
            if (scene.rightScene != scene.leftScene) {
                parameter.SetGestureActive(scene.rightScene, gestureIx, false);
            }
        }
    };

    for (const auto& parameter : parameters_) {
        clearParameter(*parameter);
    }
    for (const auto& batch : extraStorageBatches_) {
        for (const auto& parameter : batch->parameters) {
            clearParameter(*parameter);
        }
    }
}

Bank::Bank(ParameterManager* manager)
    : manager_(manager) {}

void Bank::AddMapping(PhysicalEncoderId encoderId, Parameter& parameter) {
    for (Cell& cell : topLevel_) {
        if (cell.encoderId == encoderId) {
            cell.parameter = &parameter;
            if (!ShowingModulation()) {
                visible_ = topLevel_;
            }
            return;
        }
    }

    topLevel_.push_back({.encoderId = encoderId, .parameter = &parameter});
    if (!ShowingModulation()) {
        visible_ = topLevel_;
    }
}

void Bank::RegisterParameters(std::span<Parameter* const> parameters, std::size_t offset) {
    if (slot_ == nullptr) {
        throw std::logic_error("bank registration requires an associated bank slot");
    }

    const std::span<const PhysicalEncoderId> layout = slot_->PhysicalEncoders();
    if (offset > layout.size() || parameters.size() > layout.size() - offset) {
        throw std::logic_error("bank registration exceeds slot capacity");
    }

    for (std::size_t parameterIx = 0; parameterIx < parameters.size(); ++parameterIx) {
        if (parameters[parameterIx] == nullptr) {
            throw std::logic_error("bank registration parameter must not be null");
        }
        for (std::size_t otherIx = parameterIx + 1; otherIx < parameters.size(); ++otherIx) {
            if (parameters[otherIx] == nullptr) {
                throw std::logic_error("bank registration parameter must not be null");
            }
            if (parameters[parameterIx]->Name() == parameters[otherIx]->Name()) {
                throw std::logic_error("duplicate visible parameter name in bank registration");
            }
        }
    }

    for (std::size_t slotIx = offset; slotIx < offset + parameters.size(); ++slotIx) {
        for (std::size_t otherIx = slotIx + 1; otherIx < offset + parameters.size(); ++otherIx) {
            if (layout[slotIx] == layout[otherIx]) {
                throw std::logic_error("duplicate physical slot in bank registration");
            }
        }
    }

    std::vector<Cell> next = topLevel_;
    for (std::size_t parameterIx = 0; parameterIx < parameters.size(); ++parameterIx) {
        const PhysicalEncoderId encoderId = layout[offset + parameterIx];
        bool replaced = false;
        for (Cell& cell : next) {
            if (cell.encoderId == encoderId) {
                cell.parameter = parameters[parameterIx];
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            next.push_back({.encoderId = encoderId, .parameter = parameters[parameterIx]});
        }
    }

    topLevel_ = std::move(next);
    if (!ShowingModulation()) {
        visible_ = topLevel_;
    }
}

std::size_t Bank::SlotCapacity() const {
    if (slot_ == nullptr) {
        throw std::logic_error("bank has no associated slot layout");
    }
    return slot_->PhysicalEncoders().size();
}

bool Bank::OwnsVisible(PhysicalEncoderId encoderId) const {
    return FindVisibleCell(encoderId) != nullptr;
}

void Bank::HandlePress(PhysicalEncoderId encoderId) {
    const std::vector<PhysicalEncoderId> layout = CompactPhysicalLayout();
    HandlePress(encoderId, layout);
}

void Bank::HandlePress(PhysicalEncoderId encoderId, std::span<const PhysicalEncoderId> physicalLayout) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr) {
        return;
    }
    if (ShowingModulation() && cell->parameter == selected_) {
        Deselect();
        return;
    }
    if (cell->parameter != nullptr) {
        OpenModulationView(*cell->parameter, physicalLayout);
    }
}

void Bank::HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr || cell->parameter == nullptr) {
        return;
    }
    cell->parameter->RevertToDefault(scene);
}

void Bank::HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr || cell->parameter == nullptr) {
        return;
    }
    cell->parameter->HandleIncDec(scene, delta);
}

void Bank::Deselect() {
    selected_ = nullptr;
    visible_ = topLevel_;
}

bool Bank::ShowingModulation() const {
    return selected_ != nullptr;
}

std::size_t Bank::VisibleMappingCount() const {
    return visible_.size();
}

Parameter* Bank::VisibleParameter(PhysicalEncoderId encoderId) const {
    const Cell* cell = FindVisibleCell(encoderId);
    return cell == nullptr ? nullptr : cell->parameter;
}

Bank::VisibleCell Bank::VisibleCellFor(PhysicalEncoderId encoderId) const {
    const Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr) {
        return {};
    }
    return {
        .parameter = cell->parameter,
    };
}

Parameter* Bank::TargetParameter() const {
    return ShowingModulation() ? selected_ : nullptr;
}

std::uint32_t Bank::GesturesAffectingMask() const {
    std::uint32_t mask = 0;
    for (const Cell& cell : topLevel_) {
        if (cell.parameter != nullptr) {
            mask |= cell.parameter->GesturesAffectingMask();
        }
    }
    return mask;
}

void BankSlot::UIState::Configure(std::size_t newCellCapacity, std::size_t voiceCapacity) {
    cellCapacity = newCellCapacity;
    cells = std::make_unique<Parameter::UIState[]>(cellCapacity);
    for (std::size_t cellIx = 0; cellIx < cellCapacity; ++cellIx) {
        cells[cellIx].Configure(voiceCapacity);
    }
    connected.store(false, std::memory_order_relaxed);
    showingModulationView.store(false, std::memory_order_relaxed);
}

Bank::Cell* Bank::FindVisibleCell(PhysicalEncoderId encoderId) {
    for (Cell& cell : visible_) {
        if (cell.encoderId == encoderId) {
            return &cell;
        }
    }
    return nullptr;
}

const Bank::Cell* Bank::FindVisibleCell(PhysicalEncoderId encoderId) const {
    for (const Cell& cell : visible_) {
        if (cell.encoderId == encoderId) {
            return &cell;
        }
    }
    return nullptr;
}

void Bank::AssociateSlot(BankSlot& slot) {
    if (slot_ != nullptr && slot_ != &slot) {
        throw std::logic_error("bank is already associated with a different slot");
    }
    slot_ = &slot;
}

Parameter* Bank::EnsureModulationDepthParameter(Parameter& parameter, std::size_t modIx) {
    Parameter* depthParameter = parameter.ModulationDepthParameter(modIx);
    if (depthParameter != nullptr || manager_ == nullptr) {
        return depthParameter;
    }
    if (!parameter.Group().CanAllocate()) {
        return nullptr;
    }

    return parameter.EnsureModulationDepth(modIx);
}

bool Bank::CanOpenModulationView(const Parameter& parameter) const {
    return parameter.Group().AvailableParameterSlots() >= MissingModulationDepthCount(parameter);
}

std::size_t Bank::MissingModulationDepthCount(const Parameter& parameter) const {
    std::size_t missing = 0;
    for (std::size_t modIx = 0; modIx < parameter.Group().Config().numModulators; ++modIx) {
        if (parameter.ModulationDepthParameter(modIx) == nullptr) {
            ++missing;
        }
    }
    return missing;
}

void Bank::OpenModulationView(Parameter& parameter, std::span<const PhysicalEncoderId> physicalLayout) {
    if (physicalLayout.empty()) {
        throw std::logic_error("modulation view requires at least one physical position");
    }

    const std::size_t modulatorCount = parameter.Group().Config().numModulators;
    if (modulatorCount > physicalLayout.size() - 1) {
        throw std::logic_error("modulation view has more modulators than slot depth positions");
    }

    const std::size_t missing = MissingModulationDepthCount(parameter);
    const std::size_t available = parameter.Group().AvailableParameterSlots();
    if (available < missing) {
        parameter.Group().RequestParameterStorageBatch(missing - available);
        return;
    }

    selected_ = &parameter;
    visible_.clear();

    for (std::size_t cellIx = 0; cellIx < modulatorCount; ++cellIx) {
        visible_.push_back({
            .encoderId = physicalLayout[cellIx],
            .parameter = EnsureModulationDepthParameter(parameter, cellIx),
        });
    }

    visible_.push_back({
        .encoderId = physicalLayout.back(),
        .parameter = &parameter,
    });
    parameter.Group().RequestParameterStorageBatchIfLow();
}

std::vector<PhysicalEncoderId> Bank::CompactPhysicalLayout() const {
    std::vector<PhysicalEncoderId> layout;
    layout.reserve(topLevel_.size());
    for (const Cell& cell : topLevel_) {
        layout.push_back(cell.encoderId);
    }
    return layout;
}

void BankSlot::SelectBank(Bank* bank) {
    if (bank != nullptr) {
        bank->AssociateSlot(*this);
    }
    if (selectedBank_ != nullptr && selectedBank_ != bank) {
        selectedBank_->Deselect();
    }
    selectedBank_ = bank;
}

bool BankSlot::Owns(PhysicalEncoderId encoderId) const {
    return selectedBank_ != nullptr && OwnsPhysicalEncoder(encoderId) && selectedBank_->OwnsVisible(encoderId);
}

void BankSlot::AddPhysicalEncoder(PhysicalEncoderId encoderId) {
    if (OwnsPhysicalEncoder(encoderId)) {
        throw std::logic_error("duplicate physical encoder in bank slot");
    }
    physicalEncoders_.push_back(encoderId);
}

void BankSlot::HandlePress(PhysicalEncoderId encoderId) {
    if (Owns(encoderId)) {
        selectedBank_->HandlePress(encoderId, physicalEncoders_);
    }
}

void BankSlot::HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene) {
    if (Owns(encoderId)) {
        selectedBank_->HandleShiftPress(encoderId, scene);
    }
}

void BankSlot::HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta) {
    if (Owns(encoderId)) {
        selectedBank_->HandleTick(encoderId, scene, delta);
    }
}

bool BankSlot::ResolvePosition(std::size_t position, PhysicalEncoderId& encoderId) const {
    if (position >= physicalEncoders_.size()) {
        return false;
    }
    encoderId = physicalEncoders_[position];
    return true;
}

void BankSlot::PopulateUIState(UIState& state) const {
    state.connected.store(selectedBank_ != nullptr, std::memory_order_relaxed);
    state.showingModulationView.store(selectedBank_ != nullptr && selectedBank_->ShowingModulation(),
                                      std::memory_order_relaxed);
    for (std::size_t cellIx = 0; cellIx < state.cellCapacity; ++cellIx) {
        if (cellIx >= physicalEncoders_.size() || selectedBank_ == nullptr) {
            state.cells[cellIx].SetDisconnected();
            continue;
        }
        const Bank::VisibleCell cell = selectedBank_->VisibleCellFor(physicalEncoders_[cellIx]);
        if (cell.parameter == nullptr) {
            state.cells[cellIx].SetDisconnected();
            continue;
        }
        cell.parameter->PopulateUIState(state.cells[cellIx]);
    }
}

bool BankSlot::OwnsPhysicalEncoder(PhysicalEncoderId encoderId) const {
    return std::find(physicalEncoders_.begin(), physicalEncoders_.end(), encoderId) != physicalEncoders_.end();
}

ParameterMessageOut ParameterMessageOut::ParameterStorageBatchNeeded(ParameterGroup& group,
                                                                     std::size_t minimumAdditionalParameters,
                                                                     std::size_t requestedParameters) {
    ParameterMessageOut message;
    message.type = Type::ParameterStorageBatchNeeded;
    message.group = &group;
    message.minimumAdditionalParameters = minimumAdditionalParameters;
    message.requestedParameters = requestedParameters;
    return message;
}

ParameterMessageOutBus::ParameterMessageOutBus(std::size_t capacity)
    : queue_(capacity == 0 ? 1 : capacity) {}

bool ParameterMessageOutBus::Push(const ParameterMessageOut& message) {
    const std::size_t size = size_.load(std::memory_order_acquire);
    if (size >= queue_.size()) {
        return false;
    }
    const std::size_t tail = tail_.load(std::memory_order_relaxed);
    queue_[tail] = message;
    tail_.store((tail + 1) % queue_.size(), std::memory_order_release);
    size_.fetch_add(1, std::memory_order_release);
    return true;
}

bool ParameterMessageOutBus::Pop(ParameterMessageOut& message) {
    const std::size_t size = size_.load(std::memory_order_acquire);
    if (size == 0) {
        return false;
    }
    const std::size_t head = head_.load(std::memory_order_relaxed);
    message = queue_[head];
    head_.store((head + 1) % queue_.size(), std::memory_order_release);
    size_.fetch_sub(1, std::memory_order_release);
    return true;
}

bool ParameterManager::SetGestureCount(std::size_t count) {
    if (!groups_.empty()) {
        return false;
    }
    gestures_ = Gestures(count);
    return true;
}

ParameterGroup& ParameterManager::CreateGroup(ParameterGroupConfig config) {
    auto group = std::make_unique<ParameterGroup>(std::move(config), *this, gestures_.NumGestures());
    ParameterGroup& result = *group;
    groups_.push_back(std::move(group));
    return result;
}

ParameterId ParameterManager::RegisterParameter(ParameterGroup& group, ParameterConfig config) {
    if (!OwnsGroup(group)) {
        throw std::logic_error("parameter group is not owned by this manager");
    }
    if (config.name.empty()) {
        throw std::logic_error("parameter name must not be empty");
    }
    if (std::find(parameterNames_.begin(), parameterNames_.end(), config.name) != parameterNames_.end()) {
        throw std::logic_error("duplicate parameter name");
    }
    if (!group.CanAllocate()) {
        throw std::length_error("parameter group capacity exhausted");
    }
    if (parameters_.size() >= static_cast<std::size_t>(kLocalParameterId)) {
        throw std::overflow_error("parameter ID space exhausted");
    }

    const ParameterId id = static_cast<ParameterId>(parameters_.size());
    const std::string name = config.name;
    Parameter& created = group.CreateLocalParameter(std::move(config), id);
    Parameter* result = &created;
    parameters_.push_back(result);
    parameterNames_.push_back(name);
    return id;
}

Parameter& ParameterManager::CreateParameter(ParameterGroup& group, ParameterConfig config) {
    return ParameterById(RegisterParameter(group, std::move(config)));
}

Parameter& ParameterManager::ParameterById(ParameterId id) {
    return *parameters_.at(static_cast<std::size_t>(id));
}

const Parameter& ParameterManager::ParameterById(ParameterId id) const {
    return *parameters_.at(static_cast<std::size_t>(id));
}

Parameter* ParameterManager::FindParameterByName(std::string_view name) {
    for (Parameter* parameter : parameters_) {
        if (parameter != nullptr && parameter->Name() == name) {
            return parameter;
        }
    }
    return nullptr;
}

const Parameter* ParameterManager::FindParameterByName(std::string_view name) const {
    for (const Parameter* parameter : parameters_) {
        if (parameter != nullptr && parameter->Name() == name) {
            return parameter;
        }
    }
    return nullptr;
}

JSON ParameterManager::ParameterValuesToJSON(JsonArena& arena) const {
    JSON root = arena.Object();
    for (const Parameter* parameter : parameters_) {
        if (parameter == nullptr) {
            continue;
        }
        root.SetNew(parameter->Name().c_str(), parameter->ToValueJSON(arena));
    }
    return root;
}

bool ParameterManager::LoadParameterValuesFromJSON(JSON json) {
    if (!IsJsonObject(json)) {
        return false;
    }

    for (Parameter* parameter : parameters_) {
        if (parameter != nullptr) {
            parameter->RevertAllToDefault();
        }
    }

    const JsonMember* members = JsonObjectMembers(json);
    for (std::size_t ix = 0; ix < json.Size(); ++ix) {
        if (members[ix].m_key == nullptr) {
            continue;
        }
        Parameter* parameter = FindParameterByName(members[ix].m_key);
        if (parameter == nullptr) {
            continue;
        }
        parameter->LoadValuesFromJSON(JSON(members[ix].m_value));
    }

    ComputeAllParameters();
    return true;
}

void ParameterManager::ComputeAllParameters() {
    for (Parameter* parameter : parameters_) {
        if (parameter == nullptr) {
            continue;
        }
        parameter->Compute(scene_);
        parameter->SnapCurrentToTarget();
    }
}

void ParameterManager::ComputeAllTargets() {
    for (Parameter* parameter : parameters_) {
        if (parameter == nullptr) {
            continue;
        }
        parameter->Compute(scene_);
    }
}

void ParameterManager::CaptureDefaultControlState() {
    defaultControlState_.scene = scene_;
    defaultControlState_.shiftHeld = shiftHeld_;
    defaultControlState_.activePageOrdinal = activePageOrdinal_;
    defaultControlState_.gestureValues.clear();
    defaultControlState_.gestureSelected.clear();
    defaultControlState_.gestureValues.reserve(GestureCount());
    defaultControlState_.gestureSelected.reserve(GestureCount());
    for (std::size_t gestureIx = 0; gestureIx < GestureCount(); ++gestureIx) {
        defaultControlState_.gestureValues.push_back(GestureValue(gestureIx));
        defaultControlState_.gestureSelected.push_back(GestureSelected(gestureIx));
    }
}

void ParameterManager::RevertAllToDefaults() {
    for (Parameter* parameter : parameters_) {
        if (parameter != nullptr) {
            parameter->RevertAllToDefault();
        }
    }

    if (SceneEndpointsValid(defaultControlState_.scene.leftScene, defaultControlState_.scene.rightScene)) {
        scene_ = defaultControlState_.scene;
    } else {
        scene_ = {};
    }
    scene_.blend = std::clamp(scene_.blend, 0.0f, 1.0f);
    shiftHeld_ = defaultControlState_.shiftHeld;
    activePageOrdinal_ = defaultControlState_.activePageOrdinal;
    if (activePageOrdinal_.has_value() && FindPage(*activePageOrdinal_) == nullptr) {
        activePageOrdinal_.reset();
    }

    for (std::size_t gestureIx = 0; gestureIx < GestureCount(); ++gestureIx) {
        const float value = gestureIx < defaultControlState_.gestureValues.size()
                                ? defaultControlState_.gestureValues[gestureIx]
                                : 0.0f;
        SetGestureValue(gestureIx, value);
        const bool selected = gestureIx < defaultControlState_.gestureSelected.size() &&
                              defaultControlState_.gestureSelected[gestureIx];
        if (selected) {
            SelectGesture(gestureIx);
        } else {
            DeselectGesture(gestureIx);
        }
    }

    ComputeAllParameters();
}

float ParameterManager::GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
    const float normalized = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f);
    return LinearMap(minValue, maxValue, normalized);
}

float ParameterManager::GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
    const float normalized = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f);
    return ExponentialMap(minValue, maxValue, normalized);
}

float ParameterManager::GetZeroBasedExponential(float maxValue, float midpointValue, std::size_t voiceIx,
                                                ParameterId id) const {
    const float normalized = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f);
    return ZeroBasedExponentialMap(maxValue, midpointValue, normalized);
}

float ParameterManager::GetBipolarLinear(float maxAbsValue, std::size_t voiceIx, ParameterId id) const {
    if (maxAbsValue < 0.0f) {
        throw std::invalid_argument("bipolar linear maximum must be non-negative");
    }
    const float bipolar = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f) * 2.0f - 1.0f;
    return bipolar * maxAbsValue;
}

float ParameterManager::GetBipolarExponential(float minAbsValue, float maxAbsValue, std::size_t voiceIx,
                                              ParameterId id) const {
    if (minAbsValue <= 0.0f || maxAbsValue <= 0.0f) {
        throw std::invalid_argument("bipolar exponential endpoints must be positive");
    }
    const float bipolar = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f) * 2.0f - 1.0f;
    if (bipolar == 0.0f) {
        return 0.0f;
    }
    const float magnitude = ExponentialMap(minAbsValue, maxAbsValue, std::fabs(bipolar));
    return std::copysign(magnitude, bipolar);
}

float ParameterManager::GetBipolarZeroBasedExponential(float maxAbsValue, float midpointAbsValue,
                                                       std::size_t voiceIx, ParameterId id) const {
    if (maxAbsValue <= 0.0f || midpointAbsValue <= 0.0f || midpointAbsValue >= maxAbsValue) {
        throw std::invalid_argument("zero-based exponential mapping requires 0 < midpoint < max");
    }
    const float bipolar = std::clamp(ParameterById(id).Get(voiceIx), 0.0f, 1.0f) * 2.0f - 1.0f;
    if (bipolar == 0.0f) {
        return 0.0f;
    }
    const float magnitude = ZeroBasedExponentialMap(maxAbsValue, midpointAbsValue, std::fabs(bipolar));
    return std::copysign(magnitude, bipolar);
}

void ParameterManager::UpdateModValues(ParameterGroup& group) {
    if (!OwnsGroup(group)) {
        throw std::logic_error("parameter group is not owned by this manager");
    }
    group.UpdateModValues();
}

void ParameterManager::UpdateModValues() {
    for (const std::unique_ptr<ParameterGroup>& group : groups_) {
        group->UpdateModValues();
    }
}

bool ParameterManager::SceneEndpointsValid(std::size_t leftScene, std::size_t rightScene) const {
    for (const auto& group : groups_) {
        if (leftScene >= group->Config().numScenes || rightScene >= group->Config().numScenes) {
            return false;
        }
    }
    return true;
}

bool ParameterManager::OwnsGroup(const ParameterGroup& group) const {
    return std::any_of(groups_.begin(), groups_.end(),
                       [&group](const std::unique_ptr<ParameterGroup>& owned) { return owned.get() == &group; });
}

bool ParameterManager::SetSceneEndpoints(std::size_t leftScene, std::size_t rightScene) {
    if (!SceneEndpointsValid(leftScene, rightScene)) {
        return false;
    }
    scene_.leftScene = leftScene;
    scene_.rightScene = rightScene;
    return true;
}

bool ParameterManager::SetLessSelectedScene(std::size_t sceneIx) {
    const float blend = std::clamp(scene_.blend, 0.0f, 1.0f);
    if (blend <= 0.5f) {
        return SetSceneEndpoints(scene_.leftScene, sceneIx);
    }
    return SetSceneEndpoints(sceneIx, scene_.rightScene);
}

void ParameterManager::SetSceneBlend(float blend) {
    scene_.blend = std::clamp(blend, 0.0f, 1.0f);
}

Page& ParameterManager::CreatePage(std::string name) {
    auto page = std::make_unique<Page>();
    page->ordinal = static_cast<PageOrdinal>(pages_.size());
    page->name = std::move(name);
    Page& result = *page;
    pages_.push_back(std::move(page));
    if (!activePageOrdinal_.has_value()) {
        activePageOrdinal_ = result.ordinal;
    }
    return result;
}

bool ParameterManager::AssignParameterToPage(PageOrdinal ordinal, Parameter& parameter) {
    Page* page = FindPage(ordinal);
    if (page == nullptr) {
        return false;
    }
    if (std::find(page->parameters.begin(), page->parameters.end(), &parameter) == page->parameters.end()) {
        page->parameters.push_back(&parameter);
    }
    return true;
}

bool ParameterManager::SelectActivePage(PageOrdinal ordinal) {
    if (FindPage(ordinal) == nullptr) {
        return false;
    }
    activePageOrdinal_ = ordinal;
    return true;
}

void ParameterManager::SetActivePage(PageOrdinal ordinal) {
    if (!SelectActivePage(ordinal)) {
        throw std::out_of_range("page ordinal out of range");
    }
}

Page* ParameterManager::ActivePage() {
    if (!activePageOrdinal_.has_value()) {
        return nullptr;
    }
    return FindPage(*activePageOrdinal_);
}

const Page* ParameterManager::ActivePage() const {
    if (!activePageOrdinal_.has_value()) {
        return nullptr;
    }
    return FindPage(*activePageOrdinal_);
}

std::optional<PageOrdinal> ParameterManager::ActivePageOrdinal() const {
    return activePageOrdinal_;
}

Bank& ParameterManager::CreateBank() {
    auto bank = std::make_unique<Bank>(this);
    Bank& result = *bank;
    banks_.push_back(std::move(bank));
    return result;
}

Bank* ParameterManager::BankAt(std::size_t bankIx) {
    return bankIx >= banks_.size() ? nullptr : banks_[bankIx].get();
}

const Bank* ParameterManager::BankAt(std::size_t bankIx) const {
    return bankIx >= banks_.size() ? nullptr : banks_[bankIx].get();
}

BankSlot& ParameterManager::CreateBankSlot() {
    auto slot = std::make_unique<BankSlot>();
    BankSlot& result = *slot;
    slots_.push_back(std::move(slot));
    return result;
}

BankSlot* ParameterManager::BankSlotAt(std::size_t slotIx) {
    return slotIx >= slots_.size() ? nullptr : slots_[slotIx].get();
}

const BankSlot* ParameterManager::BankSlotAt(std::size_t slotIx) const {
    return slotIx >= slots_.size() ? nullptr : slots_[slotIx].get();
}

void ParameterManager::HandlePress(PhysicalEncoderId encoderId) {
    for (const auto& slot : slots_) {
        if (slot->Owns(encoderId)) {
            slot->HandlePress(encoderId);
            return;
        }
    }
}

void ParameterManager::HandleShiftPress(PhysicalEncoderId encoderId) {
    for (const auto& slot : slots_) {
        if (slot->Owns(encoderId)) {
            slot->HandleShiftPress(encoderId, scene_);
            return;
        }
    }
}

void ParameterManager::HandleTick(PhysicalEncoderId encoderId, float delta) {
    for (const auto& slot : slots_) {
        if (slot->Owns(encoderId)) {
            slot->HandleTick(encoderId, scene_, delta);
            return;
        }
    }
}

void ParameterManager::HandlePress(std::size_t slotIx, std::size_t position) {
    BankSlot* slot = BankSlotAt(slotIx);
    PhysicalEncoderId encoderId = 0;
    if (slot != nullptr && slot->ResolvePosition(position, encoderId)) {
        slot->HandlePress(encoderId);
    }
}

void ParameterManager::HandleShiftPress(std::size_t slotIx, std::size_t position) {
    BankSlot* slot = BankSlotAt(slotIx);
    PhysicalEncoderId encoderId = 0;
    if (slot != nullptr && slot->ResolvePosition(position, encoderId)) {
        slot->HandleShiftPress(encoderId, scene_);
    }
}

void ParameterManager::HandleTick(std::size_t slotIx, std::size_t position, float delta) {
    BankSlot* slot = BankSlotAt(slotIx);
    PhysicalEncoderId encoderId = 0;
    if (slot != nullptr && slot->ResolvePosition(position, encoderId)) {
        slot->HandleTick(encoderId, scene_, delta);
    }
}

bool ParameterManager::SelectBankForSlot(std::size_t slotIx, std::size_t bankIx) {
    BankSlot* slot = BankSlotAt(slotIx);
    Bank* bank = BankAt(bankIx);
    if (slot == nullptr || bank == nullptr) {
        return false;
    }
    slot->SelectBank(bank);
    return true;
}

void ParameterManager::SelectGesture(std::size_t gestureIx) {
    gestures_.Select(gestureIx, true);
}

void ParameterManager::DeselectGesture(std::size_t gestureIx) {
    gestures_.Select(gestureIx, false);
}

void ParameterManager::ToggleGestureSelected(std::size_t gestureIx) {
    gestures_.Select(gestureIx, !gestures_.Selected(gestureIx));
}

bool ParameterManager::GestureSelected(std::size_t gestureIx) const {
    return gestures_.Selected(gestureIx);
}

void ParameterManager::SetGestureValue(std::size_t gestureIx, float value) {
    gestures_.Value(gestureIx) = std::clamp(value, 0.0f, 1.0f);
}

float ParameterManager::GestureValue(std::size_t gestureIx) const {
    return gestures_.Value(gestureIx);
}

GestureMetadata& ParameterManager::GestureMetadataAt(std::size_t gestureIx) {
    return gestures_.Metadata(gestureIx);
}

const GestureMetadata& ParameterManager::GestureMetadataAt(std::size_t gestureIx) const {
    return gestures_.Metadata(gestureIx);
}

void ParameterManager::ClearGestureActiveFlagsForActiveSceneSelection(std::size_t gestureIx) {
    for (const auto& group : groups_) {
        group->ClearGestureActiveFlagsForActiveSceneSelection(scene_, gestureIx);
    }
}

std::size_t ParameterManager::MaxVoiceCount() const {
    std::size_t result = 0;
    for (const auto& group : groups_) {
        result = std::max(result, group->Config().numVoices);
    }
    return result;
}

std::size_t ParameterManager::SceneCapacity() const {
    if (groups_.empty()) {
        return 0;
    }
    std::size_t result = groups_.front()->Config().numScenes;
    for (const auto& group : groups_) {
        result = std::min(result, group->Config().numScenes);
    }
    return result;
}

std::size_t ParameterManager::MaxSlotCellCount() const {
    std::size_t result = 0;
    for (const auto& slot : slots_) {
        result = std::max(result, slot->PhysicalEncoders().size());
    }
    return result;
}

void ParameterManager::GestureManagerUIState::Configure(std::size_t newGestureCapacity) {
    gestureCapacity = newGestureCapacity;
    values = std::make_unique<std::atomic<float>[]>(gestureCapacity);
    selected = std::make_unique<std::atomic<bool>[]>(gestureCapacity);
    colors = std::make_unique<AtomicColor[]>(gestureCapacity);
    connected = std::make_unique<std::atomic<bool>[]>(gestureCapacity);
    bankAffectingMask = std::make_unique<std::atomic<std::uint32_t>[]>(gestureCapacity);
    bankAffectingCount = std::make_unique<std::atomic<std::size_t>[]>(gestureCapacity);
    for (std::size_t gestureIx = 0; gestureIx < gestureCapacity; ++gestureIx) {
        values[gestureIx].store(0.0f, std::memory_order_relaxed);
        selected[gestureIx].store(false, std::memory_order_relaxed);
        colors[gestureIx].Store(Color::Off);
        connected[gestureIx].store(false, std::memory_order_relaxed);
        bankAffectingMask[gestureIx].store(0, std::memory_order_relaxed);
        bankAffectingCount[gestureIx].store(0, std::memory_order_relaxed);
    }
}

void ParameterManager::UIState::Configure(std::size_t newSlotCapacity, std::size_t cellCapacity,
                                          std::size_t voiceCapacity, std::size_t gestureCapacity,
                                          std::size_t newBankCapacity) {
    slotCapacity = newSlotCapacity;
    slots = std::make_unique<BankSlot::UIState[]>(slotCapacity);
    for (std::size_t slotIx = 0; slotIx < slotCapacity; ++slotIx) {
        slots[slotIx].Configure(cellCapacity, voiceCapacity);
    }
    bankCapacity = newBankCapacity;
    banks = std::make_unique<BankUIState[]>(bankCapacity);
    for (std::size_t bankIx = 0; bankIx < bankCapacity; ++bankIx) {
        banks[bankIx].connected.store(false, std::memory_order_relaxed);
        banks[bankIx].selected.store(false, std::memory_order_relaxed);
        banks[bankIx].color.Store(Color::Off);
    }
    gestures.Configure(gestureCapacity);
}

std::unique_ptr<ParameterManager::UIState> ParameterManager::CreateUIState() const {
    auto state = std::make_unique<UIState>();
    state->Configure(slots_.size(), MaxSlotCellCount(), MaxVoiceCount(), gestures_.NumGestures(), banks_.size());
    state->sceneCapacity = SceneCapacity();
    return state;
}

void ParameterManager::PopulateUIState(UIState& state) const {
    state.leftScene.store(scene_.leftScene, std::memory_order_relaxed);
    state.rightScene.store(scene_.rightScene, std::memory_order_relaxed);
    state.sceneBlend.store(scene_.blend, std::memory_order_relaxed);
    state.shiftHeld.store(shiftHeld_, std::memory_order_relaxed);
    state.sceneCapacity = SceneCapacity();
    for (std::size_t slotIx = 0; slotIx < state.slotCapacity; ++slotIx) {
        if (slotIx < slots_.size()) {
            slots_[slotIx]->PopulateUIState(state.slots[slotIx]);
        } else {
            state.slots[slotIx].connected.store(false, std::memory_order_relaxed);
            state.slots[slotIx].showingModulationView.store(false, std::memory_order_relaxed);
            for (std::size_t cellIx = 0; cellIx < state.slots[slotIx].cellCapacity; ++cellIx) {
                state.slots[slotIx].cells[cellIx].SetDisconnected();
            }
        }
    }
    for (std::size_t bankIx = 0; bankIx < state.bankCapacity; ++bankIx) {
        const bool connected = bankIx < banks_.size();
        state.banks[bankIx].connected.store(connected, std::memory_order_relaxed);
        state.banks[bankIx].selected.store(false, std::memory_order_relaxed);
        state.banks[bankIx].color.Store(connected ? banks_[bankIx]->GetColor() : Color::Off);
    }
    for (const auto& slot : slots_) {
        Bank* selectedBank = slot->SelectedBank();
        if (selectedBank == nullptr) {
            continue;
        }
        for (std::size_t bankIx = 0; bankIx < std::min(state.bankCapacity, banks_.size()); ++bankIx) {
            if (banks_[bankIx].get() == selectedBank) {
                state.banks[bankIx].selected.store(true, std::memory_order_relaxed);
                break;
            }
        }
    }
    for (std::size_t gestureIx = 0; gestureIx < state.gestures.gestureCapacity; ++gestureIx) {
        const bool connected = gestureIx < gestures_.NumGestures();
        state.gestures.connected[gestureIx].store(connected, std::memory_order_relaxed);
        state.gestures.bankAffectingMask[gestureIx].store(0, std::memory_order_relaxed);
        state.gestures.bankAffectingCount[gestureIx].store(0, std::memory_order_relaxed);
        if (!connected) {
            state.gestures.values[gestureIx].store(0.0f, std::memory_order_relaxed);
            state.gestures.selected[gestureIx].store(false, std::memory_order_relaxed);
            state.gestures.colors[gestureIx].Store(Color::Off);
            continue;
        }
        state.gestures.values[gestureIx].store(gestures_.Value(gestureIx), std::memory_order_relaxed);
        state.gestures.selected[gestureIx].store(gestures_.Selected(gestureIx), std::memory_order_relaxed);
        state.gestures.colors[gestureIx].Store(gestures_.Metadata(gestureIx).color);
    }
    const std::size_t compactBankCount = std::min<std::size_t>({state.bankCapacity, banks_.size(), 32});
    for (std::size_t bankIx = 0; bankIx < compactBankCount; ++bankIx) {
        const std::uint32_t affecting = banks_[bankIx]->GesturesAffectingMask();
        for (std::size_t gestureIx = 0;
             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 32);
             ++gestureIx) {
            if ((affecting & (std::uint32_t{1} << gestureIx)) == 0) {
                continue;
            }
            std::uint32_t mask = state.gestures.bankAffectingMask[gestureIx].load(std::memory_order_relaxed);
            mask |= (std::uint32_t{1} << bankIx);
            state.gestures.bankAffectingMask[gestureIx].store(mask, std::memory_order_relaxed);
            state.gestures.bankAffectingCount[gestureIx].fetch_add(1, std::memory_order_relaxed);
        }
    }
}

bool ParameterManager::RequestParameterStorageBatch(ParameterGroup& group, std::size_t minimumAdditionalParameters) {
    if (!OwnsGroup(group) || parameterMessageOutBus_ == nullptr || minimumAdditionalParameters == 0) {
        return false;
    }
    const std::size_t lowWatermark = group.Config().numModulators * 2;
    const std::size_t requested = std::max(minimumAdditionalParameters, lowWatermark);
    return parameterMessageOutBus_->Push(
        ParameterMessageOut::ParameterStorageBatchNeeded(group, minimumAdditionalParameters, requested));
}

MessageIn MessageIn::ParamIncDec(std::uint64_t timestamp, std::size_t slotIx, std::size_t position, float delta) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::ParamIncDec;
    message.slotIx = slotIx;
    message.position = position;
    message.delta = delta;
    return message;
}

MessageIn MessageIn::ParamPush(std::uint64_t timestamp, std::size_t slotIx, std::size_t position) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::ParamPush;
    message.slotIx = slotIx;
    message.position = position;
    return message;
}

MessageIn MessageIn::ToggleShift(std::uint64_t timestamp) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::ToggleShift;
    return message;
}

MessageIn MessageIn::SetShift(std::uint64_t timestamp, bool held) {
    MessageIn message = ToggleShift(timestamp);
    message.boolValue = held;
    message.hasBoolValue = true;
    return message;
}

MessageIn MessageIn::ToggleGestureSelect(std::uint64_t timestamp, std::size_t gestureIx) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::ToggleGestureSelect;
    message.gestureIx = gestureIx;
    return message;
}

MessageIn MessageIn::SetGestureSelect(std::uint64_t timestamp, std::size_t gestureIx, bool selected) {
    MessageIn message = ToggleGestureSelect(timestamp, gestureIx);
    message.type = Type::SetGestureSelect;
    message.boolValue = selected;
    message.hasBoolValue = true;
    return message;
}

MessageIn MessageIn::SelectParamBank(std::uint64_t timestamp, std::size_t slotIx, std::size_t bankIx) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::SelectParamBank;
    message.slotIx = slotIx;
    message.bankIx = bankIx;
    return message;
}

MessageIn MessageIn::Start(std::uint64_t timestamp) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::Start;
    return message;
}

MessageIn MessageIn::Stop(std::uint64_t timestamp) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::Stop;
    return message;
}

MessageIn MessageIn::Clock(std::uint64_t timestamp) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::Clock;
    return message;
}

MessageIn MessageIn::SetGestureValue(std::uint64_t timestamp, std::size_t gestureIx, float value) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::SetGestureValue;
    message.gestureIx = gestureIx;
    message.value = value;
    return message;
}

MessageIn MessageIn::SceneSelect(std::uint64_t timestamp, std::size_t sceneIx) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::SceneSelect;
    message.sceneIx = sceneIx;
    return message;
}

MessageIn MessageIn::SetSceneBlend(std::uint64_t timestamp, float blend) {
    MessageIn message;
    message.timestamp = timestamp;
    message.type = Type::SetSceneBlend;
    message.value = blend;
    return message;
}

MessageInBus::MessageInBus(ParameterManager* manager, std::size_t capacity)
    : manager_(manager),
      queue_(capacity == 0 ? 1 : capacity) {}

bool MessageInBus::Push(const MessageIn& message) {
    const std::size_t size = size_.load(std::memory_order_acquire);
    if (size >= queue_.size()) {
        return false;
    }
    const std::size_t tail = tail_.load(std::memory_order_relaxed);
    queue_[tail] = message;
    tail_.store((tail + 1) % queue_.size(), std::memory_order_release);
    size_.fetch_add(1, std::memory_order_release);
    return true;
}

bool MessageInBus::Pop(MessageIn& message, std::uint64_t timestamp) {
    const std::size_t size = size_.load(std::memory_order_acquire);
    if (size == 0) {
        return false;
    }
    const std::size_t head = head_.load(std::memory_order_relaxed);
    if (queue_[head].timestamp > timestamp) {
        return false;
    }
    message = queue_[head];
    head_.store((head + 1) % queue_.size(), std::memory_order_release);
    size_.fetch_sub(1, std::memory_order_release);
    return true;
}

void MessageInBus::Apply(const MessageIn& message) {
    if (manager_ == nullptr) {
        return;
    }
    switch (message.type) {
    case MessageIn::Type::ParamIncDec:
        if (!manager_->ShiftHeld()) {
            manager_->HandleTick(message.slotIx, message.position, message.delta);
        }
        break;
    case MessageIn::Type::ParamPush:
        if (manager_->ShiftHeld()) {
            manager_->HandleShiftPress(message.slotIx, message.position);
        } else {
            manager_->HandlePress(message.slotIx, message.position);
        }
        break;
    case MessageIn::Type::ToggleShift:
        if (message.hasBoolValue) {
            manager_->SetShiftHeld(message.boolValue);
        } else {
            manager_->ToggleShiftHeld();
        }
        break;
    case MessageIn::Type::ToggleGestureSelect:
        if (message.gestureIx < manager_->GestureCount()) {
            manager_->ToggleGestureSelected(message.gestureIx);
        }
        break;
    case MessageIn::Type::SetGestureSelect:
        if (message.gestureIx < manager_->GestureCount()) {
            if (message.boolValue) {
                manager_->SelectGesture(message.gestureIx);
            } else {
                manager_->DeselectGesture(message.gestureIx);
            }
        }
        break;
    case MessageIn::Type::SelectParamBank:
        manager_->SelectBankForSlot(message.slotIx, message.bankIx);
        break;
    case MessageIn::Type::SetGestureValue:
        if (message.gestureIx < manager_->GestureCount()) {
            manager_->SetGestureValue(message.gestureIx, message.value);
        }
        break;
    case MessageIn::Type::SceneSelect:
        manager_->SetLessSelectedScene(message.sceneIx);
        break;
    case MessageIn::Type::SetSceneBlend:
        manager_->SetSceneBlend(message.value);
        break;
    case MessageIn::Type::Start:
    case MessageIn::Type::Stop:
    case MessageIn::Type::Clock:
        break;
    }
}

void MessageInBus::Process(std::uint64_t timestamp) {
    MessageIn message;
    while (Pop(message, timestamp)) {
        Apply(message);
    }
}

Page* ParameterManager::FindPage(PageOrdinal ordinal) {
    for (const auto& page : pages_) {
        if (page->ordinal == ordinal) {
            return page.get();
        }
    }
    return nullptr;
}

const Page* ParameterManager::FindPage(PageOrdinal ordinal) const {
    for (const auto& page : pages_) {
        if (page->ordinal == ordinal) {
            return page.get();
        }
    }
    return nullptr;
}

} // namespace synth
