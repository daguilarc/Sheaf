# Review package: f27ff53b..159a0dd1

## Commits
159a0dd1 perf(synth): traverse only active modulation routes

## Files changed
 .../synth/include/synth/ParameterModulation.hpp    |  32 +-
 projects/synth/src/ParameterModulation.cpp         | 242 +++++++++++++--
 projects/synth/tests/module_tests.cpp              |   6 +
 .../synth/tests/parameter_modulation_tests.cpp     | 325 ++++++++++++++++++---
 4 files changed, 542 insertions(+), 63 deletions(-)

## Diff
diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
index 1a9a09c2..9e83531e 100644
--- a/projects/synth/include/synth/ParameterModulation.hpp
+++ b/projects/synth/include/synth/ParameterModulation.hpp
@@ -181,20 +181,22 @@ struct ParameterStorageBatch {
     std::vector<float> currentCenterScaleArena;
     std::vector<float> targetCenterScaleArena;
     std::vector<float> currentNormalizationOffsetArena;
     std::vector<float> targetNormalizationOffsetArena;
     std::vector<float> currentMinValueArena;
     std::vector<float> targetMinValueArena;
     std::vector<float> currentMaxValueArena;
     std::vector<float> targetMaxValueArena;
     std::vector<float> currentDepthArena;
     std::vector<float> targetDepthArena;
+    std::vector<std::size_t> routeSourceIndexArena;
+    std::vector<std::size_t> sourceRoutePositionArena;
     std::vector<float> currentKnobValueArena;
     std::vector<float> uiDisplayCenterArena;
     std::vector<float> uiDisplaySpreadEnergyArena;
     std::vector<Parameter*> modulationDepthArena;
     std::vector<float> sceneCenterArena;
     std::vector<float> gestureValueArena;
     std::vector<GestureMask> gestureActiveMaskArena;
 };

 std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
@@ -225,20 +227,22 @@ struct ParameterConfig {
     std::vector<Color> indicatorColors;
 };

 class Modulators {
 public:
     explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);

     float& Value(std::size_t voiceIx, std::size_t modIx);
     float Value(std::size_t voiceIx, std::size_t modIx) const;
     float Apply(std::size_t voiceIx, std::span<const float> depths) const;
+    float ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
+                      std::span<const std::size_t> sourceIndices) const;
     // Source pointers are caller-owned and must remain address-stable while registered.
     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                              ModulatorMetadata metadata);
     void UpdateModValues();

     std::size_t NumVoices() const { return numVoices_; }
     std::size_t NumModulators() const { return numModulators_; }

     ModulatorMetadata& Metadata(std::size_t modIx);
     const ModulatorMetadata& Metadata(std::size_t modIx) const;
@@ -338,20 +342,22 @@ private:
     std::vector<float> currentCenterScaleArena_;
     std::vector<float> targetCenterScaleArena_;
     std::vector<float> currentNormalizationOffsetArena_;
     std::vector<float> targetNormalizationOffsetArena_;
     std::vector<float> currentMinValueArena_;
     std::vector<float> targetMinValueArena_;
     std::vector<float> currentMaxValueArena_;
     std::vector<float> targetMaxValueArena_;
     std::vector<float> currentDepthArena_;
     std::vector<float> targetDepthArena_;
+    std::vector<std::size_t> routeSourceIndexArena_;
+    std::vector<std::size_t> sourceRoutePositionArena_;
     std::vector<float> currentKnobValueArena_;
     std::vector<float> uiDisplayCenterArena_;
     std::vector<float> uiDisplaySpreadEnergyArena_;
     std::vector<Parameter*> modulationDepthArena_;
     std::vector<float> sceneCenterArena_;
     std::vector<float> gestureValueArena_;
     std::vector<GestureMask> gestureActiveMaskArena_;
 };

 class Parameter {
@@ -431,51 +437,64 @@ public:
     Parameter* ModulationDepthParameter(std::size_t modIx) const;

     float& SceneCenter(std::size_t sceneIx);
     float SceneCenter(std::size_t sceneIx) const;
     float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
     float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
     void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
     bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
     GestureMask GesturesAffectingMask() const;

-    std::span<float> CurrentDepths(std::size_t voiceIx);
-    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
-    std::span<float> TargetDepths(std::size_t voiceIx);
-    std::span<const float> TargetDepths(std::size_t voiceIx) const;
+    std::span<float> CurrentDepthSlots(std::size_t voiceIx);
+    std::span<const float> CurrentDepthSlots(std::size_t voiceIx) const;
+    std::span<float> TargetDepthSlots(std::size_t voiceIx);
+    std::span<const float> TargetDepthSlots(std::size_t voiceIx) const;
+    float CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
+    float TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const;
+    std::size_t ActiveRouteCount() const { return activeRouteCount_; }
+    std::span<const std::size_t> ActiveRouteSourceIndices() const {
+        return routeSourceIndices_.first(activeRouteCount_);
+    }
+    std::size_t RouteSourceIndex(std::size_t slot) const;
+    std::size_t RoutePositionForSource(std::size_t sourceIx) const;

     float CurrentCenter() const { return currentCenter_; }
     float TargetCenter() const { return targetCenter_; }
     float CurrentCenterScale(std::size_t voiceIx) const;
     float TargetCenterScale(std::size_t voiceIx) const;
     float CurrentNormalizationOffset(std::size_t voiceIx) const;
     float TargetNormalizationOffset(std::size_t voiceIx) const;
     std::size_t RecursionDepth() const { return recursionDepth_; }
     JSON ToValueJSON(JsonArena& arena) const;
     bool LoadValuesFromJSON(JSON json);

 private:
     friend class ParameterManager;

-    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
     std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
     void ValidateSceneEndpoints(const SceneState& scene) const;
     float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
     void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
     void ResetModulationDepthToNeutral(const SceneState& scene);
     float ComputeRawCenter(const SceneState& scene) const;
     void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter);
     void SnapCurrentToTarget();
     void SeedCachedKnobAndUiDisplayState();
     bool WouldCreateCycle(const Parameter* candidate) const;
     ParameterConfig ModulationDepthConfig(std::size_t modIx) const;
     float TargetValue(std::size_t voiceIx) const;
+    std::size_t VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const;
+    void EnsureRouteActive(std::size_t sourceIx);
+    void RemoveActiveRoute(std::size_t routeSlot);
+    bool RouteNeutralAcrossVoices(std::size_t routeSlot) const;
+    void PruneNeutralActiveRoutes();
+    void AssertRouteBijection() const;
     std::uint32_t ModulatorsAffectingMask() const;
     bool HasNonDefaultState() const;
     bool HasNonZeroState() const;

     ParameterId id_;
     ParameterGroup& group_;
     ParameterConfig config_;
     std::size_t slotIx_ = 0;
     std::size_t recursionDepth_ = 0;
     float currentCenter_ = 0.0f;
@@ -483,20 +502,23 @@ private:
     std::span<float> currentCenterScales_;
     std::span<float> targetCenterScales_;
     std::span<float> currentNormalizationOffsets_;
     std::span<float> targetNormalizationOffsets_;
     std::span<float> currentMinValues_;
     std::span<float> targetMinValues_;
     std::span<float> currentMaxValues_;
     std::span<float> targetMaxValues_;
     std::span<float> currentDepths_;
     std::span<float> targetDepths_;
+    std::span<std::size_t> routeSourceIndices_;
+    std::span<std::size_t> sourceRoutePositions_;
+    std::size_t activeRouteCount_ = 0;
     std::span<float> currentKnobValues_;
     std::span<float> uiDisplayCenters_;
     std::span<float> uiDisplaySpreadEnergies_;
     std::span<Parameter*> modulationDepths_;
     std::span<float> sceneCenters_;
     std::span<float> gestureValues_;
     std::span<GestureMask> gestureActiveMasks_;
 };

 class Bank {
diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
index 3322b5fc..daaac76e 100644
--- a/projects/synth/src/ParameterModulation.cpp
+++ b/projects/synth/src/ParameterModulation.cpp
@@ -1,14 +1,15 @@
 #include "synth/ParameterModulation.hpp"

 #include <algorithm>
 #include <array>
+#include <cassert>
 #include <bit>
 #include <charconv>
 #include <cmath>
 #include <limits>
 #include <stdexcept>
 #include <utility>

 namespace synth {

 namespace {
@@ -227,20 +228,22 @@ ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config,
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
+      routeSourceIndexArena(capacity * config.numModulators),
+      sourceRoutePositionArena(capacity * config.numModulators),
       currentKnobValueArena(capacity * config.numVoices),
       uiDisplayCenterArena(capacity * config.numVoices),
       uiDisplaySpreadEnergyArena(capacity * config.numVoices),
       modulationDepthArena(capacity * config.numModulators, nullptr),
       sceneCenterArena(capacity * config.numScenes),
       gestureValueArena(capacity * config.numScenes * gestureCount),
       gestureActiveMaskArena(capacity * config.numScenes, 0) {
     parameters.reserve(capacity);
 }

@@ -279,20 +282,40 @@ float Modulators::Apply(std::size_t voiceIx, std::span<const float> depths) cons
     }

     const std::size_t rowStart = voiceIx * numModulators_;
     float result = 0.0f;
     for (std::size_t modIx = 0; modIx < numModulators_; ++modIx) {
         result += values_[rowStart + modIx] * depths[modIx];
     }
     return result;
 }

+float Modulators::ApplyActive(std::size_t voiceIx, std::span<const float> activeDepths,
+                              std::span<const std::size_t> sourceIndices) const {
+    if (voiceIx >= numVoices_) {
+        throw std::out_of_range("modulator voice index out of range");
+    }
+    if (activeDepths.size() != sourceIndices.size()) {
+        throw std::invalid_argument("active depth and source index counts differ");
+    }
+
+    const std::size_t rowStart = voiceIx * numModulators_;
+    float result = 0.0f;
+    for (std::size_t slot = 0; slot < activeDepths.size(); ++slot) {
+        if (sourceIndices[slot] >= numModulators_) {
+            throw std::out_of_range("modulator source index out of range");
+        }
+        result += values_[rowStart + sourceIndices[slot]] * activeDepths[slot];
+    }
+    return result;
+}
+
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
@@ -404,20 +427,22 @@ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& ma
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
+    routeSourceIndexArena_.resize(config_.maxParameters * config_.numModulators);
+    sourceRoutePositionArena_.resize(config_.maxParameters * config_.numModulators);
     currentKnobValueArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplayCenterArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplaySpreadEnergyArena_.resize(config_.maxParameters * config_.numVoices);
     modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
     sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
     gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
     gestureActiveMaskArena_.resize(config_.maxParameters * config_.numScenes, 0);
 }

 ParameterGroup::~ParameterGroup() = default;
@@ -582,20 +607,26 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
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
+      routeSourceIndices_(ArenaSlice(group_.routeSourceIndexArena_,
+                                     slotIx_ * group_.Config().numModulators,
+                                     group_.Config().numModulators)),
+      sourceRoutePositions_(ArenaSlice(group_.sourceRoutePositionArena_,
+                                       slotIx_ * group_.Config().numModulators,
+                                       group_.Config().numModulators)),
       currentKnobValues_(ArenaSlice(group_.currentKnobValueArena_, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
       uiDisplayCenters_(ArenaSlice(group_.uiDisplayCenterArena_, slotIx_ * group_.Config().numVoices,
                                    group_.Config().numVoices)),
       uiDisplaySpreadEnergies_(ArenaSlice(group_.uiDisplaySpreadEnergyArena_,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
@@ -609,20 +640,24 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
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
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
     : id_(id),
@@ -652,20 +687,26 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
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
+      routeSourceIndices_(ArenaSlice(storageBatch.routeSourceIndexArena,
+                                     slotIx_ * group_.Config().numModulators,
+                                     group_.Config().numModulators)),
+      sourceRoutePositions_(ArenaSlice(storageBatch.sourceRoutePositionArena,
+                                       slotIx_ * group_.Config().numModulators,
+                                       group_.Config().numModulators)),
       currentKnobValues_(ArenaSlice(storageBatch.currentKnobValueArena, slotIx_ * group_.Config().numVoices,
                                     group_.Config().numVoices)),
       uiDisplayCenters_(ArenaSlice(storageBatch.uiDisplayCenterArena, slotIx_ * group_.Config().numVoices,
                                    group_.Config().numVoices)),
       uiDisplaySpreadEnergies_(ArenaSlice(storageBatch.uiDisplaySpreadEnergyArena,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
@@ -679,20 +720,24 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
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
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 ParameterStorageBatch::~ParameterStorageBatch() = default;

 void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
@@ -754,21 +799,23 @@ Color Parameter::IndicatorColor(std::size_t voiceIx) const {
         throw std::out_of_range("parameter indicator color index out of range");
     }
     return config_.indicatorColors[voiceIx];
 }

 float Parameter::GetRaw(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return ClampToRange(currentCenter_ * currentCenterScales_[voiceIx] + currentNormalizationOffsets_[voiceIx] +
-                            group_.GetModulators().Apply(voiceIx, CurrentDepths(voiceIx)),
+                            group_.GetModulators().ApplyActive(
+                                voiceIx, CurrentDepthSlots(voiceIx).first(activeRouteCount_),
+                                ActiveRouteSourceIndices()),
                         config_.range);
 }

 float Parameter::CachedKnobValue(std::size_t voiceIx) const {
     if (voiceIx >= currentKnobValues_.size()) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return currentKnobValues_[voiceIx];
 }

@@ -983,22 +1030,28 @@ void Parameter::ProcessLite() {
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
-    for (std::size_t ix = 0; ix < currentDepths_.size(); ++ix) {
-        currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
+    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            const std::size_t ix = VoiceRouteIndex(voiceIx, routeSlot);
+            currentDepths_[ix] += alpha * (targetDepths_[ix] - currentDepths_[ix]);
+            if (group_.processingObserver_ != nullptr) {
+                ++group_.processingObserver_->activeRouteVisits;
+            }
+        }
     }
     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
         const float knob = GetRaw(voiceIx);
         currentKnobValues_[voiceIx] = knob;
         uiDisplayCenters_[voiceIx] += group_.Config().uiDisplayCenterAlpha * (knob - uiDisplayCenters_[voiceIx]);
         const float residual = knob - uiDisplayCenters_[voiceIx];
         uiDisplaySpreadEnergies_[voiceIx] +=
             group_.Config().uiDisplaySpreadAlpha * ((residual * residual) - uiDisplaySpreadEnergies_[voiceIx]);
     }
 }
@@ -1090,20 +1143,21 @@ void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized)

 void Parameter::RevertToDefault(const SceneState& scene) {
     ValidateSceneEndpoints(scene);
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ResetModulationDepthToNeutral(scene);
         }
     }
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     if (blend <= 0.0f) {
         ResetSceneToDefault(scene.leftScene, defaultValue);
     } else if (blend >= 1.0f) {
         ResetSceneToDefault(scene.rightScene, defaultValue);
     } else {
@@ -1125,20 +1179,21 @@ void Parameter::RevertToDefault(const SceneState& scene) {
 }

 void Parameter::RevertAllToDefault() {
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->RevertAllToDefault();
         }
     }
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);

     const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
     for (std::size_t sceneIx = 0; sceneIx < group_.Config().numScenes; ++sceneIx) {
         ResetSceneToDefault(sceneIx, defaultValue);
         for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
             GestureValue(sceneIx, gestureIx) = defaultValue;
         }
     }
@@ -1258,64 +1313,86 @@ void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, boo
     } else {
         gestureActiveMasks_[sceneIx] &= ~bit;
     }
 }

 bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
     (void)SceneGestureIndex(sceneIx, gestureIx);
     return (gestureActiveMasks_[sceneIx] & (GestureMask{1} << gestureIx)) != 0;
 }

-std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
+std::span<float> Parameter::CurrentDepthSlots(std::size_t voiceIx) {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<const float> Parameter::CurrentDepths(std::size_t voiceIx) const {
+std::span<const float> Parameter::CurrentDepthSlots(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<const float>(currentDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<float> Parameter::TargetDepths(std::size_t voiceIx) {
+std::span<float> Parameter::TargetDepthSlots(std::size_t voiceIx) {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
 }

-std::span<const float> Parameter::TargetDepths(std::size_t voiceIx) const {
+std::span<const float> Parameter::TargetDepthSlots(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
     return std::span<const float>(targetDepths_.data() + rowStart, group_.Config().numModulators);
 }

+float Parameter::CurrentDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
+    return currentDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
+}
+
+float Parameter::TargetDepthForSource(std::size_t voiceIx, std::size_t sourceIx) const {
+    return targetDepths_[VoiceRouteIndex(voiceIx, RoutePositionForSource(sourceIx))];
+}
+
+std::size_t Parameter::RouteSourceIndex(std::size_t slot) const {
+    if (slot >= routeSourceIndices_.size()) {
+        throw std::out_of_range("parameter route slot out of range");
+    }
+    return routeSourceIndices_[slot];
+}
+
+std::size_t Parameter::RoutePositionForSource(std::size_t sourceIx) const {
+    if (sourceIx >= sourceRoutePositions_.size()) {
+        throw std::out_of_range("parameter modulator index out of range");
+    }
+    return sourceRoutePositions_[sourceIx];
+}
+
 float Parameter::CurrentCenterScale(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return currentCenterScales_[voiceIx];
 }

 float Parameter::TargetCenterScale(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
@@ -1330,28 +1407,110 @@ float Parameter::CurrentNormalizationOffset(std::size_t voiceIx) const {
     return currentNormalizationOffsets_[voiceIx];
 }

 float Parameter::TargetNormalizationOffset(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return targetNormalizationOffsets_[voiceIx];
 }

-std::size_t Parameter::VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const {
+std::size_t Parameter::VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
-    if (modIx >= group_.Config().numModulators) {
+    if (routeSlot >= group_.Config().numModulators) {
+        throw std::out_of_range("parameter route slot out of range");
+    }
+    return voiceIx * group_.Config().numModulators + routeSlot;
+}
+
+void Parameter::AssertRouteBijection() const {
+#ifndef NDEBUG
+    assert(activeRouteCount_ <= routeSourceIndices_.size());
+    for (std::size_t slot = 0; slot < routeSourceIndices_.size(); ++slot) {
+        assert(routeSourceIndices_[slot] < sourceRoutePositions_.size());
+        assert(sourceRoutePositions_[routeSourceIndices_[slot]] == slot);
+    }
+#endif
+}
+
+void Parameter::EnsureRouteActive(std::size_t sourceIx) {
+    if (sourceIx >= sourceRoutePositions_.size()) {
         throw std::out_of_range("parameter modulator index out of range");
     }
-    return voiceIx * group_.Config().numModulators + modIx;
+    const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
+    if (routeSlot < activeRouteCount_) {
+        return;
+    }
+
+    const std::size_t destination = activeRouteCount_;
+    if (routeSlot != destination) {
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      currentDepths_[VoiceRouteIndex(voiceIx, destination)]);
+            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      targetDepths_[VoiceRouteIndex(voiceIx, destination)]);
+        }
+        const std::size_t displacedSource = routeSourceIndices_[destination];
+        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[destination]);
+        sourceRoutePositions_[sourceIx] = destination;
+        sourceRoutePositions_[displacedSource] = routeSlot;
+    }
+    ++activeRouteCount_;
+    AssertRouteBijection();
+}
+
+void Parameter::RemoveActiveRoute(std::size_t routeSlot) {
+    if (routeSlot >= activeRouteCount_) {
+        throw std::out_of_range("active parameter route slot out of range");
+    }
+    const std::size_t lastActive = activeRouteCount_ - 1;
+    if (routeSlot != lastActive) {
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            std::swap(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      currentDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
+            std::swap(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)],
+                      targetDepths_[VoiceRouteIndex(voiceIx, lastActive)]);
+        }
+        const std::size_t removedSource = routeSourceIndices_[routeSlot];
+        const std::size_t movedSource = routeSourceIndices_[lastActive];
+        std::swap(routeSourceIndices_[routeSlot], routeSourceIndices_[lastActive]);
+        sourceRoutePositions_[movedSource] = routeSlot;
+        sourceRoutePositions_[removedSource] = lastActive;
+    }
+    --activeRouteCount_;
+    AssertRouteBijection();
+}
+
+bool Parameter::RouteNeutralAcrossVoices(std::size_t routeSlot) const {
+    constexpr float tolerance = 0.000001f;
+    for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+        if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > tolerance ||
+            std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]) > tolerance) {
+            return false;
+        }
+    }
+    return true;
+}
+
+void Parameter::PruneNeutralActiveRoutes() {
+    for (std::size_t routeSlot = activeRouteCount_; routeSlot-- > 0;) {
+        if (!RouteNeutralAcrossVoices(routeSlot)) {
+            continue;
+        }
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            currentDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
+            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] = 0.0f;
+        }
+        RemoveActiveRoute(routeSlot);
+    }
 }

 std::size_t Parameter::SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const {
     if (sceneIx >= group_.Config().numScenes) {
         throw std::out_of_range("parameter scene index out of range");
     }
     if (gestureIx >= group_.GestureCount()) {
         throw std::out_of_range("parameter gesture index out of range");
     }
     return sceneIx * group_.GestureCount() + gestureIx;
@@ -1402,20 +1561,21 @@ void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
     std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
     std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
     std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
     std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
     std::fill(currentMinValues_.begin(), currentMinValues_.end(), neutralDepth);
     std::fill(targetMinValues_.begin(), targetMinValues_.end(), neutralDepth);
     std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), neutralDepth);
     std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), neutralDepth);
     std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
     std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    activeRouteCount_ = 0;
     SeedCachedKnobAndUiDisplayState();
 }

 float Parameter::ComputeRawCenter(const SceneState& scene) const {
     ValidateSceneEndpoints(scene);
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     const float inverseBlend = 1.0f - blend;
     const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;

     float weightedMixSum = 0.0f;
@@ -1458,81 +1618,115 @@ void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDep
     } else {
         targetCenter_ = rawCenter;
     }

     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ComputeAtDepth(scene, recursionDepth_ + 1, smoothTargetCenter);
         }
     }

+    constexpr float neutralTolerance = 0.000001f;
+    for (std::size_t sourceIx = 0; sourceIx < group_.Config().numModulators; ++sourceIx) {
+        const Parameter* depthParameter = modulationDepths_[sourceIx];
+        bool targetNonNeutral = false;
+        if (depthParameter != nullptr) {
+            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+                if (std::fabs(ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx))) >
+                    neutralTolerance) {
+                    targetNonNeutral = true;
+                    break;
+                }
+            }
+        }
+
+        const std::size_t oldRouteSlot = sourceRoutePositions_[sourceIx];
+        bool currentNonNeutral = false;
+        if (oldRouteSlot < activeRouteCount_) {
+            for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+                if (std::fabs(currentDepths_[VoiceRouteIndex(voiceIx, oldRouteSlot)]) > neutralTolerance) {
+                    currentNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        if (targetNonNeutral || currentNonNeutral) {
+            EnsureRouteActive(sourceIx);
+        }
+
+        const std::size_t routeSlot = sourceRoutePositions_[sourceIx];
+        for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
+            targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] =
+                depthParameter == nullptr ? 0.0f
+                                          : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
+        }
+    }
+
     for (std::size_t voiceIx = 0; voiceIx < group_.Config().numVoices; ++voiceIx) {
         float weightSum = 0.0f;
-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-            const Parameter* depthParameter = modulationDepths_[modIx];
-            const float depth =
-                depthParameter == nullptr ? 0.0f : ModulationDepthTargetFromKnob(depthParameter->GetRaw(voiceIx));
-            targetDepths_[VoiceModIndex(voiceIx, modIx)] = depth;
-            weightSum += std::fabs(depth);
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            weightSum += std::fabs(targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
         }

         if (weightSum < 1.0f) {
             targetCenterScales_[voiceIx] = 1.0f - weightSum;
         } else {
             targetCenterScales_[voiceIx] = 0.0f;
-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-                targetDepths_[VoiceModIndex(voiceIx, modIx)] /= weightSum;
+            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+                targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)] /= weightSum;
             }
         }

         float normalizationOffset = 0.0f;
-        for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceModIndex(voiceIx, modIx)]);
+        for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+            normalizationOffset -= std::min(0.0f, targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)]);
         }
         targetNormalizationOffsets_[voiceIx] = normalizationOffset;

         if (weightSum > 1.0f) {
             targetMinValues_[voiceIx] = RangeMin(config_.range);
             targetMaxValues_[voiceIx] = RangeMax(config_.range);
         } else {
             float minContribution = 0.0f;
             float maxContribution = 0.0f;
-            for (std::size_t modIx = 0; modIx < group_.Config().numModulators; ++modIx) {
-                const float depth = targetDepths_[VoiceModIndex(voiceIx, modIx)];
+            for (std::size_t routeSlot = 0; routeSlot < activeRouteCount_; ++routeSlot) {
+                const float depth = targetDepths_[VoiceRouteIndex(voiceIx, routeSlot)];
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
         SeedCachedKnobAndUiDisplayState();
     }
+    PruneNeutralActiveRoutes();
 }

 void Parameter::SnapCurrentToTarget() {
     currentCenter_ = targetCenter_;
     std::copy(targetCenterScales_.begin(), targetCenterScales_.end(), currentCenterScales_.begin());
     std::copy(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), currentNormalizationOffsets_.begin());
     std::copy(targetMinValues_.begin(), targetMinValues_.end(), currentMinValues_.begin());
     std::copy(targetMaxValues_.begin(), targetMaxValues_.end(), currentMaxValues_.begin());
     std::copy(targetDepths_.begin(), targetDepths_.end(), currentDepths_.begin());
+    PruneNeutralActiveRoutes();
     SeedCachedKnobAndUiDisplayState();
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->SnapCurrentToTarget();
         }
     }
 }

 void Parameter::SeedCachedKnobAndUiDisplayState() {
     for (std::size_t voiceIx = 0; voiceIx < currentKnobValues_.size(); ++voiceIx) {
@@ -1553,21 +1747,23 @@ bool Parameter::WouldCreateCycle(const Parameter* candidate) const {
         }
     }
     return false;
 }

 float Parameter::TargetValue(std::size_t voiceIx) const {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     return ClampToRange(targetCenter_ * targetCenterScales_[voiceIx] + targetNormalizationOffsets_[voiceIx] +
-                            group_.GetModulators().Apply(voiceIx, TargetDepths(voiceIx)),
+                            group_.GetModulators().ApplyActive(
+                                voiceIx, TargetDepthSlots(voiceIx).first(activeRouteCount_),
+                                ActiveRouteSourceIndices()),
                         config_.range);
 }

 std::uint32_t Parameter::ModulatorsAffectingMask() const {
     std::uint32_t mask = 0;
     const std::size_t count = std::min<std::size_t>(modulationDepths_.size(), 32);
     for (std::size_t modIx = 0; modIx < count; ++modIx) {
         if (modulationDepths_[modIx] != nullptr && modulationDepths_[modIx]->HasNonZeroState()) {
             mask |= (std::uint32_t{1} << modIx);
         }
diff --git a/projects/synth/tests/module_tests.cpp b/projects/synth/tests/module_tests.cpp
index e6a73de1..4295c7bc 100644
--- a/projects/synth/tests/module_tests.cpp
+++ b/projects/synth/tests/module_tests.cpp
@@ -1467,40 +1467,46 @@ TEST_CASE(demo_modulation_process_parameters_applies_direct_vco_modulation) {
     constexpr float tolerance = 0.0001f;

     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 2,
         .numModulators = 3,
         .numScenes = 1,
         .maxParameters = 4,
         .processLiteAlpha = 1.0f,
     });
+    synth::ParameterProcessingObserver work;
+    group.SetProcessingObserverForTests(&work);
     auto& phase = manager.CreateParameter(group, {.name = "Phase", .defaultValue = 0.0f});
     auto& directDepth = manager.CreateParameter(group, {
         .name = "Phase Direct Depth",
         .defaultValue = 1.0f,
     });
     REQUIRE_TRUE(phase.AssignModulationDepth(0, &directDepth));
     phase.Compute(manager.Scene());
     directDepth.Compute(manager.Scene());

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(1, 0) = 1.0f;
     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/0);
     REQUIRE_NEAR(phase.GetRaw(0), 0.0f, tolerance);
     REQUIRE_NEAR(phase.GetRaw(1), 1.0f, tolerance);
+    REQUIRE_TRUE(phase.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(phase.ActiveRouteSourceIndices()[0] == 0);
+    REQUIRE_TRUE(work.activeRouteVisits == 2);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(1, 0) = 0.0f;
     synth_miniapp::ProcessParameters(group, /*sampleIndex=*/1);
     REQUIRE_NEAR(phase.GetRaw(0), 1.0f, tolerance);
     REQUIRE_NEAR(phase.GetRaw(1), 0.0f, tolerance);
+    REQUIRE_TRUE(work.activeRouteVisits == 4);
 }

 int main() {
     int failed = 0;
     for (const auto& test : Registry()) {
         try {
             test.fn();
             std::cout << "[PASS] " << test.name << "\n";
         } catch (const std::exception& ex) {
             ++failed;
diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
index 1133fe03..c5aac2c8 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -79,20 +79,22 @@ struct TestVisualizer final : synth::ui::Visualizer {
 };

 std::string JsonToString(synth::JSON json) {
     char* dumped = json.Dumps(JSON_ENCODE_ANY);
     REQUIRE_TRUE(dumped != nullptr);
     std::string text(dumped);
     std::free(dumped);
     return text;
 }

+void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount);
+
 // Wraps a single WrldBldr-kind MidiControllerProfileConfig (as produced by
 // WrldBldrDefaultProfileConfig, whose system-message associations always
 // carry both a control address and a wrldBldrPosition -- see
 // SlotValidForKind's WrldBldr branch) plus a pair of endpoint identifiers
 // into a one-controller MidiInstrumentConfig, for patch-persistence tests
 // that used to build a bare MidiControllerProfileConfig + MidiEndpointState
 // pair directly. Named "controller" to match MidiControllerSlot's default
 // name so assertions reading loaded.controllers[0] read naturally.
 synth::MidiInstrumentConfig MakeInstrumentFromProfile(const synth::MidiControllerProfileConfig& profile,
                                                        std::string_view inputIdentifier = "",
@@ -326,41 +328,41 @@ TEST_CASE(parameter_group_timing_reconfiguration_preserves_topology_values_and_p
     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     carrier.SceneCenter(1) = 0.75f;
     depth->SceneCenter(0) = 0.5f;
     manager.ComputeAllTargets();
     carrier.ProcessLite();

     synth::Parameter* const carrierPointer = &carrier;
     synth::Parameter* const depthPointer = depth;
-    float* const currentDepthPointer = carrier.CurrentDepths(0).data();
+    float* const currentDepthPointer = carrier.CurrentDepthSlots(0).data();
     const float currentCenter = carrier.CurrentCenter();
-    const float currentDepth = carrier.CurrentDepths(0)[0];
+    const float currentDepth = carrier.CurrentDepthForSource(0, 0);
     const float sceneValue = carrier.SceneCenter(1);

     group.ConfigureProcessingTiming({
         .processLiteAlpha = 0.125f,
         .targetComputeIntervalSamples = 64,
         .uiDisplayCenterAlpha = 0.25f,
         .uiDisplaySpreadAlpha = 0.5f,
     });

     REQUIRE_TRUE(&group.ParameterByLocalIndex(0) == carrierPointer);
     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depthPointer);
-    REQUIRE_TRUE(carrier.CurrentDepths(0).data() == currentDepthPointer);
+    REQUIRE_TRUE(carrier.CurrentDepthSlots(0).data() == currentDepthPointer);
     REQUIRE_TRUE(group.Config().numVoices == 2);
     REQUIRE_TRUE(group.Config().numModulators == 1);
     REQUIRE_TRUE(group.Config().numScenes == 2);
     REQUIRE_TRUE(group.Config().maxParameters == 4);
     REQUIRE_NEAR(carrier.CurrentCenter(), currentCenter, 0.0001f);
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], currentDepth, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), currentDepth, 0.0001f);
     REQUIRE_NEAR(carrier.SceneCenter(1), sceneValue, 0.0001f);
     REQUIRE_NEAR(group.Config().processLiteAlpha, 0.125f, 0.0001f);
     REQUIRE_TRUE(group.Config().targetComputeIntervalSamples == 64);
     REQUIRE_NEAR(group.Config().uiDisplayCenterAlpha, 0.25f, 0.0001f);
     REQUIRE_NEAR(group.Config().uiDisplaySpreadAlpha, 0.5f, 0.0001f);
 }

 TEST_CASE(parameter_group_timing_reconfiguration_is_non_compounding) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
@@ -1046,22 +1048,22 @@ TEST_CASE(parameter_default_state) {
     REQUIRE_TRUE(&parameter.Group() == &group);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenter(), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.3f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == nullptr);
     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
     REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.3f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(1)[1], 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 1), 0.0f, 0.0001f);
 }

 TEST_CASE(bipolar_parameter_core_stores_normalized_center) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 2,
         .maxParameters = 1,
         .processLiteAlpha = 1.0f,
@@ -1240,21 +1242,21 @@ TEST_CASE(modulation_normalization_under_one) {
         .maxParameters = 2,
     });

     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.75f});
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.75f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
 }

 TEST_CASE(modulation_normalization_over_one_preserves_sign) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 3,
@@ -1270,22 +1272,22 @@ TEST_CASE(modulation_normalization_over_one_preserves_sign) {
         .name = "Negative",
         .defaultValue = 0.0f,
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
 }

 TEST_CASE(negative_modulation_depths_add_normalization_offset) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 3,
         .processLiteAlpha = 1.0f,
@@ -1304,22 +1306,22 @@ TEST_CASE(negative_modulation_depths_add_normalization_offset) {
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.5f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.25f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
@@ -1350,22 +1352,22 @@ TEST_CASE(overfull_negative_modulation_offset_uses_normalized_depths) {
         .range = synth::RangeKind::Bipolar,
     });
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
     REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

     parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 1), -0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 0.5f, 0.0001f);

     group.GetModulators().Value(0, 0) = 1.0f;
     group.GetModulators().Value(0, 1) = 0.0f;
     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);

     group.GetModulators().Value(0, 0) = 0.0f;
@@ -1395,21 +1397,21 @@ TEST_CASE(recursive_modulation_depth_targets_use_bipolar_zero_based_exponential_
         {.knob = 0.25f, .expectedDepth = -0.25f},
         {.knob = 0.5f, .expectedDepth = 0.0f},
         {.knob = 0.75f, .expectedDepth = 0.25f},
         {.knob = 1.0f, .expectedDepth = 1.0f},
     }};

     for (const Case& testCase : cases) {
         depth->SceneCenter(0) = testCase.knob;
         carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
         REQUIRE_NEAR(depth->GetRaw(0), testCase.knob, 0.0001f);
-        REQUIRE_NEAR(carrier.TargetDepths(0)[0], testCase.expectedDepth, 0.0001f);
+        REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), testCase.expectedDepth, 0.0001f);
     }
 }

 TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for_parent_reads) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -1419,40 +1421,40 @@ TEST_CASE(recursive_modulation_depth_compute_ignores_target_center_smoothing_for
     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);

     depth->SceneCenter(0) = 1.0f;
     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

     REQUIRE_NEAR(depth->TargetCenter(), 1.0f, 0.0001f);
     REQUIRE_NEAR(depth->CurrentCenter(), 1.0f, 0.0001f);
     REQUIRE_NEAR(depth->GetRaw(0), 1.0f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 1.0f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 1.0f, 0.0001f);
 }

 TEST_CASE(recursive_modulation_depth_three_quarter_turn_sets_quarter_raw_depth_before_normalization) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
     });

     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     depth->SceneCenter(0) = 0.75f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.25f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.75f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.0f, 0.0001f);
 }

 TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
@@ -1467,22 +1469,22 @@ TEST_CASE(curved_modulation_depth_targets_still_use_signed_normalization) {
     REQUIRE_TRUE(positive != nullptr);
     REQUIRE_TRUE(negative != nullptr);
     positive->SceneCenter(0) = 1.0f;
     negative->SceneCenter(0) = 0.0f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     carrier.ProcessLite();

     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.0f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetNormalizationOffset(0), 0.5f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.5f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[1], -0.5f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.5f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 1), -0.5f, 0.0001f);
 }

 TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
         .processLiteAlpha = 1.0f,
@@ -1491,21 +1493,21 @@ TEST_CASE(curved_modulation_depth_targets_keep_modulator_dot_product_linear) {

     auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
     synth::Parameter* depth = carrier.EnsureModulationDepth(0);
     REQUIRE_TRUE(depth != nullptr);
     depth->SceneCenter(0) = 0.75f;

     carrier.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
     carrier.ProcessLite();

     group.GetModulators().Value(0, 0) = 0.8f;
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
     REQUIRE_NEAR(carrier.GetRaw(0), 0.2f, 0.0001f);
 }

 TEST_CASE(parameter_get_raw_includes_normalization_offset) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 8,
@@ -1617,21 +1619,21 @@ TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew) {
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.0f});
     depth.SceneCenter(0) = 0.8f;
     depth.SceneCenter(1) = 0.8f;
     REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));

     carrier.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});

     REQUIRE_TRUE(depth.RecursionDepth() == 1);
     REQUIRE_NEAR(depth.CurrentCenter(), 0.8f, 0.0001f);
     REQUIRE_NEAR(depth.GetRaw(0), 0.8f, 0.0001f);
-    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.3421493f, 0.0001f);
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.3421493f, 0.0001f);
     REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.6578507f, 0.0001f);
 }

 TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 2,
@@ -1649,21 +1651,21 @@ TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
     parameter.SceneCenter(0) = 1.0f;
     parameter.SceneCenter(1) = 1.0f;
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

     parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
     parameter.ProcessLite();

     REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 0.9375f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentNormalizationOffset(0), 0.0625f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], -0.0625f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), -0.0625f, 0.0001f);

     synth::Parameter::UIState ui(1);
     parameter.PopulateUIState(ui);
     REQUIRE_NEAR(ui.minValues[0].load(), 0.1875f, 0.0001f);
     REQUIRE_NEAR(ui.maxValues[0].load(), 0.25f, 0.0001f);
 }

 TEST_CASE(process_lite_samples_cached_knob_after_slew) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
@@ -1750,21 +1752,21 @@ TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_t

     carrier.SceneCenter(0) = 0.2f;
     sibling.SceneCenter(0) = 0.4f;
     depth->SceneCenter(0) = 0.75f;

     group.ProcessSample(0);

     REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
     REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(depth->TargetCenter(), 0.75f, 0.0001f);
-    REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.25f, 0.0001f);
 }

 TEST_CASE(group_process_sample_visits_only_registered_roots) {
     synth::ParameterManager manager;
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 2,
         .numScenes = 1,
         .maxParameters = 8,
         .targetComputeIntervalSamples = 16,
@@ -2254,26 +2256,28 @@ TEST_CASE(modulation_depth_assignment_rejects_cross_group_routes) {
     REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
 }

 TEST_CASE(get_clamps_and_rejects_out_of_range_voice) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
-        .maxParameters = 1,
+        .maxParameters = 2,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Clamp", .defaultValue = 1.0f});
+    auto* depth = parameter.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 1.0f;
     group.GetModulators().Value(0, 0) = 1.0f;
-    parameter.TargetDepths(0)[0] = 1.0f;
-    parameter.ProcessLite();
+    manager.ComputeAllParameters();

     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 0.0001f);

     bool threw = false;
     try {
         (void)parameter.GetRaw(1);
     } catch (const std::out_of_range&) {
         threw = true;
     }
     REQUIRE_TRUE(threw);
@@ -3008,22 +3012,22 @@ TEST_CASE(revert_to_default_clears_modulation_and_gestures) {
     parameter.Compute(scene);
     parameter.ProcessLite();

     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
     REQUIRE_NEAR(depth.SceneCenter(0), 0.5f, 0.0001f);
     REQUIRE_NEAR(depth.SceneCenter(1), 0.5f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.4f, 0.0001f);
     REQUIRE_TRUE(!parameter.GestureActive(0, 0));
     REQUIRE_TRUE(!parameter.GestureActive(1, 0));
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
-    REQUIRE_NEAR(parameter.TargetDepths(1)[0], 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(1, 0), 0.0f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.GetRaw(0), 0.4f, 0.0001f);
     REQUIRE_NEAR(parameter.GetRaw(1), 0.4f, 0.0001f);
 }

 TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
     synth::ParameterManager manager;
@@ -3032,36 +3036,39 @@ TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
     auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.5f});
     parameter.SceneCenter(0) = 0.9f;
     parameter.SetGestureActive(0, 0, true);
     REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
-    parameter.TargetDepths(0)[0] = 0.75f;
-    parameter.CurrentDepths(0)[0] = 0.5f;
+    depth.SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    const std::size_t routeSlot = parameter.RoutePositionForSource(0);
+    parameter.TargetDepthSlots(0)[routeSlot] = 0.75f;
+    parameter.CurrentDepthSlots(0)[routeSlot] = 0.5f;

     bool threw = false;
     try {
         parameter.RevertToDefault({.leftScene = 3, .rightScene = 0, .blend = 0.0f});
     } catch (const std::out_of_range&) {
         threw = true;
     }

     REQUIRE_TRUE(threw);
     REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.9f, 0.0001f);
     REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.75f, 0.0001f);
-    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.5f, 0.0001f);
+    REQUIRE_NEAR(parameter.TargetDepthForSource(0, 0), 0.75f, 0.0001f);
+    REQUIRE_NEAR(parameter.CurrentDepthForSource(0, 0), 0.5f, 0.0001f);
 }

 TEST_CASE(page_routing_changes_without_mutating_parameter_state) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 2,
         .maxParameters = 2,
@@ -7044,42 +7051,67 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
             const synth::Parameter* expectedRoute = route < 0 ? nullptr : params[static_cast<std::size_t>(route)];
             if (actual.ModulationDepthParameter(modIx) != expectedRoute) {
                 SimFailBool(seed, step, action,
                             SimParamField(actual, paramIx, "modIx=" + std::to_string(modIx) + " route"));
             }
         }
         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "target center"), expected.targetCenter,
                      actual.TargetCenter());
         SimCheckNear(seed, step, action, SimParamField(actual, paramIx, "current center"), expected.currentCenter,
                      actual.CurrentCenter());
+        RequireRouteBijection(actual, kSimMods);
+        std::array<bool, kSimMods> expectedActiveRoutes{};
+        std::size_t expectedActiveRouteCount = 0;
+        for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
+            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                if (std::fabs(expected.targetDepth[voiceIx][modIx]) > 0.000001f ||
+                    std::fabs(expected.currentDepth[voiceIx][modIx]) > 0.000001f) {
+                    expectedActiveRoutes[modIx] = true;
+                    break;
+                }
+            }
+            expectedActiveRouteCount += expectedActiveRoutes[modIx] ? 1 : 0;
+        }
+        if (actual.ActiveRouteCount() != expectedActiveRouteCount) {
+            SimFail(seed, step, action, SimParamField(actual, paramIx, "active route count"),
+                    static_cast<float>(expectedActiveRouteCount), static_cast<float>(actual.ActiveRouteCount()));
+        }
+        for (std::size_t routeSlot = 0; routeSlot < actual.ActiveRouteCount(); ++routeSlot) {
+            const std::size_t sourceIx = actual.RouteSourceIndex(routeSlot);
+            if (!expectedActiveRoutes[sourceIx]) {
+                SimFailBool(seed, step, action,
+                            SimParamField(actual, paramIx,
+                                          "active route prefix sourceIx=" + std::to_string(sourceIx)));
+            }
+        }
         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
             const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
                          expected.targetCenterScale[voiceIx],
                          actual.TargetCenterScale(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
                          expected.currentCenterScale[voiceIx],
                          actual.CurrentCenterScale(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target normalization offset"),
                          expected.targetNormalizationOffset[voiceIx],
                          actual.TargetNormalizationOffset(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current normalization offset"),
                          expected.currentNormalizationOffset[voiceIx],
                          actual.CurrentNormalizationOffset(voiceIx));
             for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
                 const std::string modField = voiceField + " modIx=" + std::to_string(modIx);
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " target depth"),
                              expected.targetDepth[voiceIx][modIx],
-                             actual.TargetDepths(voiceIx)[modIx]);
+                             actual.TargetDepthForSource(voiceIx, modIx));
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " current depth"),
                              expected.currentDepth[voiceIx][modIx],
-                             actual.CurrentDepths(voiceIx)[modIx]);
+                             actual.CurrentDepthForSource(voiceIx, modIx));
             }
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " raw"),
                          SimGetRaw(oracle, paramIx, voiceIx), actual.GetRaw(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " cached knob"),
                          expected.cachedKnob[voiceIx], actual.CachedKnobValue(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display center"),
                          expected.uiDisplayCenter[voiceIx], actual.UIDisplayCenter(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " ui display spread"),
                          std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
                          actual.UIDisplaySpread(voiceIx));
@@ -8625,26 +8657,26 @@ TEST_CASE(randomized_recursive_modulation_ui_tree_round_trips_into_fresh_initial
                 return true;
             }
             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
                 if (std::fabs(parameter.GestureValue(sceneIx, gestureIx) - defaultValue) > tolerance ||
                     parameter.GestureActive(sceneIx, gestureIx)) {
                     return true;
                 }
             }
         }
         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
-            for (const float depth : parameter.CurrentDepths(voiceIx)) {
+            for (const float depth : parameter.CurrentDepthSlots(voiceIx)) {
                 if (std::fabs(depth) > tolerance) {
                     return true;
                 }
             }
-            for (const float depth : parameter.TargetDepths(voiceIx)) {
+            for (const float depth : parameter.TargetDepthSlots(voiceIx)) {
                 if (std::fabs(depth) > tolerance) {
                     return true;
                 }
             }
             if (std::fabs(parameter.CurrentCenterScale(voiceIx) - 1.0f) > tolerance ||
                 std::fabs(parameter.TargetCenterScale(voiceIx) - 1.0f) > tolerance ||
                 std::fabs(parameter.CurrentNormalizationOffset(voiceIx)) > tolerance ||
                 std::fabs(parameter.TargetNormalizationOffset(voiceIx)) > tolerance) {
                 return true;
             }
@@ -10750,20 +10782,243 @@ TEST_CASE(compute_all_targets_preserves_process_lite_slew) {
     const float afterOneSlew = parameter.GetRaw(0);
     REQUIRE_TRUE(afterOneSlew > 0.0f);
     REQUIRE_TRUE(afterOneSlew < 1.0f);        // approaching, not jumped

     manager.ComputeAllParameters();           // existing API still snaps
     REQUIRE_NEAR(parameter.GetRaw(0), 1.0f, 1e-4f);
 }

 namespace {

+float FullScanApply(const synth::Modulators& modulators, std::size_t voiceIx,
+                    std::span<const float> depthsBySource) {
+    float sum = 0.0f;
+    for (std::size_t sourceIx = 0; sourceIx < depthsBySource.size(); ++sourceIx) {
+        sum += modulators.Value(voiceIx, sourceIx) * depthsBySource[sourceIx];
+    }
+    return sum;
+}
+
+void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount) {
+    const auto sources = parameter.ActiveRouteSourceIndices();
+    REQUIRE_TRUE(sources.size() == parameter.ActiveRouteCount());
+    std::vector<bool> seen(sourceCount, false);
+    for (std::size_t slot = 0; slot < sourceCount; ++slot) {
+        const std::size_t sourceIx = parameter.RouteSourceIndex(slot);
+        REQUIRE_TRUE(sourceIx < sourceCount);
+        REQUIRE_TRUE(!seen[sourceIx]);
+        seen[sourceIx] = true;
+        REQUIRE_TRUE(parameter.RoutePositionForSource(sourceIx) == slot);
+    }
+}
+
+void RequireFullScanCurrentMatch(const synth::Parameter& parameter) {
+    const std::size_t sourceCount = parameter.Group().Config().numModulators;
+    RequireRouteBijection(parameter, sourceCount);
+    std::vector<float> depthsBySource(sourceCount, 0.0f);
+    for (std::size_t voiceIx = 0; voiceIx < parameter.Group().Config().numVoices; ++voiceIx) {
+        for (std::size_t sourceIx = 0; sourceIx < sourceCount; ++sourceIx) {
+            depthsBySource[sourceIx] = parameter.CurrentDepthForSource(voiceIx, sourceIx);
+        }
+        const float expected = synth::ClampToRange(
+            parameter.CurrentCenter() * parameter.CurrentCenterScale(voiceIx) +
+                parameter.CurrentNormalizationOffset(voiceIx) +
+                FullScanApply(parameter.Group().GetModulators(), voiceIx, depthsBySource),
+            parameter.Range());
+        REQUIRE_NEAR(parameter.GetRaw(voiceIx), expected, 0.000001f);
+    }
+}
+
+}  // namespace
+
+TEST_CASE(modulators_apply_active_uses_explicit_stable_source_indices) {
+    synth::Modulators modulators(1, 4);
+    modulators.Value(0, 0) = 0.2f;
+    modulators.Value(0, 1) = -0.4f;
+    modulators.Value(0, 2) = 0.7f;
+    modulators.Value(0, 3) = 0.9f;
+    const std::array<float, 2> depths = {0.5f, -0.25f};
+    const std::array<std::size_t, 2> sources = {3, 0};
+    const std::array<float, 4> fullDepths = {-0.25f, 0.0f, 0.0f, 0.5f};
+
+    REQUIRE_NEAR(modulators.ApplyActive(0, depths, sources),
+                 FullScanApply(modulators, 0, fullDepths), 0.000001f);
+
+    bool threw = false;
+    try {
+        (void)modulators.ApplyActive(0, depths, std::span<const std::size_t>(sources).first(1));
+    } catch (const std::invalid_argument&) {
+        threw = true;
+    }
+    REQUIRE_TRUE(threw);
+}
+
+TEST_CASE(active_modulation_routes_preserve_identity_and_settling_tail) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 4,
+                                       .numScenes = 2,
+                                       .maxParameters = 16,
+                                       .processLiteAlpha = 1.0f,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Metadata(0) = {.name = "Zero", .shortName = "Z", .sourceColor = synth::Color::Red};
+    group.GetModulators().Metadata(1) = {.name = "One", .shortName = "O", .sourceColor = synth::Color::Orange};
+    group.GetModulators().Metadata(2) = {.name = "Two", .shortName = "T", .sourceColor = synth::Color::Green};
+    group.GetModulators().Metadata(3) = {.name = "Three", .shortName = "H", .sourceColor = synth::Color::Cyan};
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth3 = carrier.EnsureModulationDepth(3);
+    auto* depth0 = carrier.EnsureModulationDepth(0);
+    auto* depth2 = carrier.EnsureModulationDepth(2);
+    auto* depth1 = carrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(depth3 != nullptr);
+    REQUIRE_TRUE(depth0 != nullptr);
+    REQUIRE_TRUE(depth2 != nullptr);
+    REQUIRE_TRUE(depth1 != nullptr);
+    group.GetModulators().Value(0, 0) = -0.25f;
+    group.GetModulators().Value(0, 2) = 0.5f;
+    group.GetModulators().Value(0, 3) = 0.75f;
+    group.GetModulators().Value(1, 0) = 0.4f;
+    group.GetModulators().Value(1, 2) = -0.6f;
+    group.GetModulators().Value(1, 3) = 0.1f;
+
+    depth3->SceneCenter(0) = 0.75f;
+    depth3->SceneCenter(1) = 0.75f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth0->SceneCenter(0) = 0.7f;
+    depth0->SceneCenter(1) = 0.7f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 0);
+
+    depth2->SceneCenter(0) = 0.8f;
+    depth2->SceneCenter(1) = 0.8f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[2] == 2);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth1->SceneCenter(0) = 0.65f;
+    depth1->SceneCenter(1) = 0.65f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    RequireFullScanCurrentMatch(carrier);
+
+    depth0->SceneCenter(0) = 0.5f;
+    depth0->SceneCenter(1) = 0.5f;
+    depth0->GestureValue(0, 0) = 0.6f;  // latent persisted state must retain source key 0
+    depth1->SceneCenter(0) = 0.5f;
+    depth1->SceneCenter(1) = 0.5f;
+    manager.ComputeAllTargets();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    carrier.ProcessLite();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 4);
+    manager.ComputeAllTargets();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 2);
+    REQUIRE_TRUE(carrier.RoutePositionForSource(0) >= carrier.ActiveRouteCount());
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 3);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[1] == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(2) == depth2);
+    REQUIRE_TRUE(depth0->Name() == "Carrier Zero");
+    REQUIRE_TRUE(depth2->Name() == "Carrier Two");
+    synth::Parameter::UIState ui(2, 4, 1);
+    carrier.PopulateUIState(ui);
+    REQUIRE_TRUE(ui.modulatorSourceColors[0].Load() == synth::Color::Red);
+    REQUIRE_TRUE(ui.modulatorSourceColors[2].Load() == synth::Color::Green);
+    synth::JsonArena arena(16384);
+    const synth::JSON values = carrier.ToValueJSON(arena);
+    REQUIRE_TRUE(!values.Get("modDepths").Get("0").IsNull());
+    REQUIRE_TRUE(values.Get("modDepths").Get("1").IsNull());
+    REQUIRE_TRUE(!values.Get("modDepths").Get("2").IsNull());
+    REQUIRE_TRUE(!values.Get("modDepths").Get("3").IsNull());
+    RequireFullScanCurrentMatch(carrier);
+}
+
+TEST_CASE(active_modulation_route_union_keeps_source_with_only_voice_one_nonzero) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 3,
+                                       .numScenes = 1,
+                                       .maxParameters = 12,
+                                       .processLiteAlpha = 1.0f,
+                                       .targetCenterAlpha = 1.0f});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
+    auto* depth = carrier.EnsureModulationDepth(2);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(0);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->SceneCenter(0) = 0.75f;
+    group.GetModulators().Value(0, 0) = 0.5f;
+    group.GetModulators().Value(1, 0) = 1.0f;
+    group.GetModulators().Value(0, 2) = -0.8f;
+    group.GetModulators().Value(1, 2) = 0.6f;
+
+    manager.ComputeAllParameters();
+
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 2), 0.0f, 0.000001f);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(1, 2)) > 0.000001f);
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(carrier.ActiveRouteSourceIndices()[0] == 2);
+    RequireFullScanCurrentMatch(carrier);
+}
+
+TEST_CASE(active_modulation_routes_randomized_full_scan_oracle_and_work_bound) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 2,
+                                       .numModulators = 4,
+                                       .numScenes = 2,
+                                       .maxParameters = 16,
+                                       .processLiteAlpha = 0.25f,
+                                       .targetCenterAlpha = 1.0f});
+    synth::ParameterProcessingObserver work;
+    group.SetProcessingObserverForTests(&work);
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.35f});
+    std::array<synth::Parameter*, 4> depths{};
+    for (std::size_t sourceIx = 0; sourceIx < depths.size(); ++sourceIx) {
+        depths[sourceIx] = carrier.EnsureModulationDepth(sourceIx);
+        REQUIRE_TRUE(depths[sourceIx] != nullptr);
+    }
+    std::mt19937 random(0x5a17eU);
+    std::uniform_int_distribution<int> sourceDistribution(0, 3);
+    std::uniform_int_distribution<int> valueDistribution(0, 4);
+    std::uniform_real_distribution<float> modulatorDistribution(-1.0f, 1.0f);
+
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
+    for (std::size_t step = 0; step < 128; ++step) {
+        const std::size_t sourceIx = static_cast<std::size_t>(sourceDistribution(random));
+        const float knob = 0.5f + 0.1f * static_cast<float>(valueDistribution(random) - 2);
+        depths[sourceIx]->SceneCenter(step & 1U) = knob;
+        for (std::size_t voiceIx = 0; voiceIx < 2; ++voiceIx) {
+            for (std::size_t modIx = 0; modIx < 4; ++modIx) {
+                group.GetModulators().Value(voiceIx, modIx) = modulatorDistribution(random);
+            }
+        }
+
+        REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+        manager.SetSceneBlend(static_cast<float>(step % 5) * 0.25f);
+        manager.ComputeAllTargets();
+        const std::size_t visitsBefore = work.activeRouteVisits;
+        carrier.ProcessLite();
+        REQUIRE_TRUE(work.activeRouteVisits - visitsBefore == carrier.ActiveRouteCount() * 2);
+        RequireFullScanCurrentMatch(carrier);
+    }
+}
+
+namespace {
+
 // Regression for slog-2: MidiSender's worker thread (Run()) must tag itself
 // with ThreadId::MidiSender so log messages produced while sending (and any
 // future thread-identity-sensitive code on that thread) observe the correct
 // identity. This sink records synth::GetCurrentThreadId() as observed from
 // inside Send(), which runs on the sender's worker thread.
 struct RecordingMidiOutputSink final : synth::IMidiOutputSink {
     std::mutex mutex;
     std::optional<synth::ThreadId> observedThreadId;

     void Send(const synth::BasicMidi&) override {
