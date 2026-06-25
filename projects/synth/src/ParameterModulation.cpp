#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace synth {

namespace {

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

} // namespace

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

Modulators::Modulators(std::size_t voices, std::size_t modulators)
    : numVoices_(voices),
      numModulators_(modulators),
      values_(voices * modulators, 0.0f),
      metadata_(modulators) {}

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

ParameterGroup::ParameterGroup(ParameterGroupConfig config)
    : config_(ValidateConfig(config)),
      modulators_(config.numVoices, config.numModulators),
      gestures_(config.numGestures) {
    parameters_.reserve(config_.maxParameters);
    currentCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
    targetCenterScaleArena_.resize(config_.maxParameters * config_.numVoices);
    currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
    targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
    modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
    sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
    gestureValueArena_.resize(config_.maxParameters * config_.numScenes * config_.numGestures);
    gestureActiveArena_.resize(config_.maxParameters * config_.numScenes * config_.numGestures, 0);
}

ParameterGroup::~ParameterGroup() = default;

bool ParameterGroup::CanAllocate() const {
    return parameterCount_ < config_.maxParameters;
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
                                slotIx_ * group_.Config().numScenes * group_.Config().numGestures,
                                group_.Config().numScenes * group_.Config().numGestures)),
      gestureActive_(ArenaSlice(group_.gestureActiveArena_,
                                slotIx_ * group_.Config().numScenes * group_.Config().numGestures,
                                group_.Config().numScenes * group_.Config().numGestures)) {
    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
    std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
    std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
}

float Parameter::Get(std::size_t voiceIx) const {
    if (voiceIx >= group_.Config().numVoices) {
        throw std::out_of_range("parameter voice index out of range");
    }
    return ClampToRange(currentCenter_ * currentCenterScales_[voiceIx] +
                            group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
                        config_.range);
}

void Parameter::Compute(const SceneState& scene) {
    ComputeAtDepth(scene, 0);
}

void Parameter::ProcessLite() {
    const float alpha = group_.Config().processLiteAlpha;
    currentCenter_ += alpha * (targetCenter_ - currentCenter_);
    for (std::size_t voiceIx = 0; voiceIx < currentCenterScales_.size(); ++voiceIx) {
        currentCenterScales_[voiceIx] +=
            alpha * (targetCenterScales_[voiceIx] - currentCenterScales_[voiceIx]);
    }
    for (std::size_t ix = 0; ix < currentDepths_.size(); ++ix) {
        currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
    }
}

void Parameter::HandleIncDec(const SceneState& scene, float delta) {
    ValidateSceneEndpoints(scene);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);

    bool hasSelectedGesture = false;
    float selectedEffectiveWeightSum = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < group_.Config().numGestures; ++gestureIx) {
        if (!group_.GetGestures().Selected(gestureIx)) {
            continue;
        }

        hasSelectedGesture = true;
        if (blend <= 0.0f) {
            ActivateGestureForScene(scene.leftScene, gestureIx);
        } else if (blend >= 1.0f) {
            ActivateGestureForScene(scene.rightScene, gestureIx);
        } else {
            ActivateGestureForScene(scene.leftScene, gestureIx);
            if (scene.rightScene != scene.leftScene) {
                ActivateGestureForScene(scene.rightScene, gestureIx);
            }
        }

        selectedEffectiveWeightSum += EffectiveGestureWeight(scene, gestureIx, blend);
    }

    if (!hasSelectedGesture) {
        ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
        return;
    }

    const float gestureEditWeight = std::clamp(selectedEffectiveWeightSum, 0.0f, 1.0f);
    ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
                           delta * (1.0f - gestureEditWeight), config_.range);

    if (selectedEffectiveWeightSum == 0.0f) {
        return;
    }

    for (std::size_t gestureIx = 0; gestureIx < group_.Config().numGestures; ++gestureIx) {
        if (!group_.GetGestures().Selected(gestureIx)) {
            continue;
        }

        const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
        if (effectiveWeight == 0.0f) {
            continue;
        }

        const float gestureDelta = delta * gestureEditWeight * (effectiveWeight / selectedEffectiveWeightSum);
        ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
                               blend, gestureDelta, config_.range);
    }
}

void Parameter::RevertToDefault(const SceneState& scene) {
    ValidateSceneEndpoints(scene);
    ClearModulationDepths();
    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);

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
}

bool Parameter::AssignModulationDepth(std::size_t modIx, Parameter* parameter) {
    if (modIx >= modulationDepths_.size()) {
        throw std::out_of_range("modulation depth index out of range");
    }
    if (parameter != nullptr && WouldCreateCycle(parameter)) {
        return false;
    }

    modulationDepths_[modIx] = parameter;
    return true;
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
    if (gestureIx >= group_.Config().numGestures) {
        throw std::out_of_range("parameter gesture index out of range");
    }
    return sceneIx * group_.Config().numGestures + gestureIx;
}

void Parameter::ValidateSceneEndpoints(const SceneState& scene) const {
    if (scene.leftScene >= group_.Config().numScenes || scene.rightScene >= group_.Config().numScenes) {
        throw std::out_of_range("parameter scene index out of range");
    }
}

float Parameter::EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const {
    const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
    const float groupWeight = group_.GetGestures().Value(gestureIx);
    const float leftWeight = GestureActive(scene.leftScene, gestureIx) ? groupWeight * (1.0f - clampedBlend) : 0.0f;
    const float rightWeight = GestureActive(scene.rightScene, gestureIx) ? groupWeight * clampedBlend : 0.0f;
    return leftWeight + rightWeight;
}

void Parameter::ActivateGestureForScene(std::size_t sceneIx, std::size_t gestureIx) {
    if (!GestureActive(sceneIx, gestureIx)) {
        GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
        SetGestureActive(sceneIx, gestureIx, true);
    }
}

void Parameter::ResetSceneToDefault(std::size_t sceneIx, float defaultValue) {
    SceneCenter(sceneIx) = defaultValue;
    for (std::size_t gestureIx = 0; gestureIx < group_.Config().numGestures; ++gestureIx) {
        SetGestureActive(sceneIx, gestureIx, false);
    }
}

float Parameter::ComputeRawCenter(const SceneState& scene) const {
    ValidateSceneEndpoints(scene);
    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    const float inverseBlend = 1.0f - blend;
    const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;

    float weightedMixSum = 0.0f;
    float activeWeightSum = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < group_.Config().numGestures; ++gestureIx) {
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
    }

    if (recursionDepth_ > 0) {
        currentCenter_ = targetCenter_;
        std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
        std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
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

void ParameterGroup::SelectGesture(std::size_t gestureIx) {
    gestures_.Select(gestureIx, true);
}

void ParameterGroup::DeselectGesture(std::size_t gestureIx) {
    gestures_.Select(gestureIx, false);
}

bool ParameterGroup::GestureSelected(std::size_t gestureIx) const {
    return gestures_.Selected(gestureIx);
}

void ParameterGroup::SetGestureValue(std::size_t gestureIx, float value) {
    gestures_.Value(gestureIx) = value;
}

float ParameterGroup::GestureValue(std::size_t gestureIx) const {
    return gestures_.Value(gestureIx);
}

void ParameterGroup::ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx) {
    if (gestureIx >= config_.numGestures) {
        throw std::out_of_range("gesture index out of range");
    }
    if (scene.leftScene >= config_.numScenes || scene.rightScene >= config_.numScenes) {
        throw std::out_of_range("scene index out of range");
    }

    const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
    for (const auto& parameter : parameters_) {
        if (blend <= 0.0f) {
            parameter->SetGestureActive(scene.leftScene, gestureIx, false);
        } else if (blend >= 1.0f) {
            parameter->SetGestureActive(scene.rightScene, gestureIx, false);
        } else {
            parameter->SetGestureActive(scene.leftScene, gestureIx, false);
            if (scene.rightScene != scene.leftScene) {
                parameter->SetGestureActive(scene.rightScene, gestureIx, false);
            }
        }
    }
}

Bank::Bank(ParameterManager* manager)
    : manager_(manager) {}

void Bank::AddMapping(PhysicalEncoderId encoderId, Parameter& parameter) {
    for (Cell& cell : topLevel_) {
        if (cell.encoderId == encoderId) {
            cell.parameter = &parameter;
            cell.returnCell = false;
            if (!ShowingModulation()) {
                visible_ = topLevel_;
            }
            return;
        }
    }

    topLevel_.push_back({.encoderId = encoderId, .parameter = &parameter, .returnCell = false});
    if (!ShowingModulation()) {
        visible_ = topLevel_;
    }
}

bool Bank::OwnsVisible(PhysicalEncoderId encoderId) const {
    return FindVisibleCell(encoderId) != nullptr;
}

void Bank::HandlePress(PhysicalEncoderId encoderId) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr) {
        return;
    }
    if (cell->returnCell) {
        Deselect();
        return;
    }
    if (cell->parameter != nullptr) {
        OpenModulationView(*cell->parameter);
    }
}

void Bank::HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr || cell->returnCell || cell->parameter == nullptr) {
        return;
    }
    cell->parameter->RevertToDefault(scene);
}

void Bank::HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta) {
    Cell* cell = FindVisibleCell(encoderId);
    if (cell == nullptr || cell->returnCell || cell->parameter == nullptr) {
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

Parameter* Bank::ReturnParameter() const {
    for (const Cell& cell : visible_) {
        if (cell.returnCell) {
            return cell.parameter;
        }
    }
    return nullptr;
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

Parameter* Bank::EnsureModulationDepthParameter(Parameter& parameter, std::size_t modIx) {
    Parameter* depthParameter = parameter.ModulationDepthParameter(modIx);
    if (depthParameter != nullptr || manager_ == nullptr) {
        return depthParameter;
    }
    if (!parameter.Group().CanAllocate()) {
        return nullptr;
    }

    ParameterConfig config{
        .name = parameter.Name() + " Mod Depth " + std::to_string(modIx + 1),
        .shortName = parameter.ShortName(),
        .defaultValue = 0.0f,
        .range = RangeKind::Bipolar,
    };
    Parameter& created = manager_->CreateParameter(parameter.Group(), std::move(config));
    if (!parameter.AssignModulationDepth(modIx, &created)) {
        return nullptr;
    }
    return &created;
}

void Bank::OpenModulationView(Parameter& parameter) {
    selected_ = &parameter;
    visible_.clear();

    if (topLevel_.empty()) {
        return;
    }

    const std::size_t modulatorCount = parameter.Group().Config().numModulators;
    const std::size_t depthCellCount = std::min(modulatorCount, topLevel_.size() - 1);
    for (std::size_t cellIx = 0; cellIx < depthCellCount; ++cellIx) {
        visible_.push_back({
            .encoderId = topLevel_[cellIx].encoderId,
            .parameter = EnsureModulationDepthParameter(parameter, cellIx),
            .returnCell = false,
        });
    }

    visible_.push_back({
        .encoderId = topLevel_[depthCellCount].encoderId,
        .parameter = &parameter,
        .returnCell = true,
    });
}

void BankSlot::SelectBank(Bank* bank) {
    if (selectedBank_ != nullptr && selectedBank_ != bank) {
        selectedBank_->Deselect();
    }
    selectedBank_ = bank;
}

bool BankSlot::Owns(PhysicalEncoderId encoderId) const {
    return selectedBank_ != nullptr && OwnsPhysicalEncoder(encoderId) && selectedBank_->OwnsVisible(encoderId);
}

void BankSlot::AddPhysicalEncoder(PhysicalEncoderId encoderId) {
    if (!OwnsPhysicalEncoder(encoderId)) {
        physicalEncoders_.push_back(encoderId);
    }
}

void BankSlot::HandlePress(PhysicalEncoderId encoderId) {
    if (Owns(encoderId)) {
        selectedBank_->HandlePress(encoderId);
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

bool BankSlot::OwnsPhysicalEncoder(PhysicalEncoderId encoderId) const {
    return std::find(physicalEncoders_.begin(), physicalEncoders_.end(), encoderId) != physicalEncoders_.end();
}

ParameterGroup& ParameterManager::CreateGroup(ParameterGroupConfig config) {
    auto group = std::make_unique<ParameterGroup>(config);
    ParameterGroup& result = *group;
    groups_.push_back(std::move(group));
    return result;
}

Parameter& ParameterManager::CreateParameter(ParameterGroup& group, ParameterConfig config) {
    if (!group.CanAllocate()) {
        throw std::length_error("parameter group capacity exhausted");
    }

    auto parameter = std::make_unique<Parameter>(NextParameterId(), group, std::move(config), group.parameterCount_);
    Parameter& result = *parameter;
    group.parameters_.push_back(std::move(parameter));
    ++group.parameterCount_;
    return result;
}

ParameterId ParameterManager::NextParameterId() {
    if (nextId_ == std::numeric_limits<ParameterId>::max()) {
        throw std::overflow_error("parameter ID space exhausted");
    }
    return nextId_++;
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

BankSlot& ParameterManager::CreateBankSlot() {
    auto slot = std::make_unique<BankSlot>();
    BankSlot& result = *slot;
    slots_.push_back(std::move(slot));
    return result;
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

void ParameterManager::SelectGesture(ParameterGroup& group, std::size_t gestureIx) {
    group.SelectGesture(gestureIx);
}

void ParameterManager::DeselectGesture(ParameterGroup& group, std::size_t gestureIx) {
    group.DeselectGesture(gestureIx);
}

bool ParameterManager::GestureSelected(const ParameterGroup& group, std::size_t gestureIx) const {
    return group.GestureSelected(gestureIx);
}

void ParameterManager::SetGestureValue(ParameterGroup& group, std::size_t gestureIx, float value) {
    group.SetGestureValue(gestureIx, value);
}

float ParameterManager::GestureValue(const ParameterGroup& group, std::size_t gestureIx) const {
    return group.GestureValue(gestureIx);
}

void ParameterManager::ClearGestureActiveFlagsForActiveSceneSelection(ParameterGroup& group, std::size_t gestureIx) {
    group.ClearGestureActiveFlagsForActiveSceneSelection(scene_, gestureIx);
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
