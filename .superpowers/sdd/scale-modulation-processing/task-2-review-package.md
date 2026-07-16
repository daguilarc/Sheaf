# Review package: 94b2b700..b7537817

## Commits
b7537817 refactor(synth): narrow gesture selection access
3549f01b feat(synth): support sparse 64-bit gestures

## Files changed
 projects/synth/include/synth/EncoderDraw.hpp       |  20 ++-
 .../synth/include/synth/ParameterModulation.hpp    |  17 ++-
 projects/synth/src/ParameterModulation.cpp         | 152 +++++++++++--------
 projects/synth/tests/instrument_tests.cpp          |  12 ++
 .../synth/tests/parameter_modulation_tests.cpp     | 165 +++++++++++++++++----
 projects/synth/tests/portable_ui_tests.cpp         |  14 ++
 6 files changed, 276 insertions(+), 104 deletions(-)

## Diff
diff --git a/projects/synth/include/synth/EncoderDraw.hpp b/projects/synth/include/synth/EncoderDraw.hpp
index 67fa75f2..45c54471 100644
--- a/projects/synth/include/synth/EncoderDraw.hpp
+++ b/projects/synth/include/synth/EncoderDraw.hpp
@@ -210,21 +210,21 @@ inline void AppendArcWithSwitchGaps(std::vector<DrawCommand>& commands,
         if (endAngle <= startAngle)
         {
             continue;
         }

         commands.push_back(DrawCommand::Arc(
             ArcBoundsFor(centerX, centerY, radius), startAngle, endAngle, color, strokeWidth));
     }
 }

-inline std::size_t CountMaskBits(std::uint32_t mask)
+inline std::size_t CountMaskBits(std::uint64_t mask)
 {
     std::size_t count = 0;
     while (mask != 0)
     {
         count += mask & 1u;
         mask >>= 1u;
     }
     return count;
 }

@@ -232,21 +232,25 @@ inline std::string BadgeText(bool modulator, std::size_t index)
 {
     if (modulator)
     {
         return "M" + std::to_string(index + 1);
     }
     if (index < 8)
     {
         return std::to_string(index + 1);
     }
     static constexpr const char* x_Symbols[] = {"U", "R", "D", "L", "UU", "RR", "DD", "LL"};
-    return x_Symbols[std::min<std::size_t>(index - 8, 7)];
+    if (index < 16)
+    {
+        return x_Symbols[index - 8];
+    }
+    return std::to_string(index + 1);
 }

 inline void GetBadgePosition(float centerX,
                              float centerY,
                              float radius,
                              std::size_t ix,
                              std::size_t total,
                              bool upper,
                              float& badgeX,
                              float& badgeY,
@@ -282,21 +286,21 @@ struct EncoderVoiceDrawState
     synth::Color indicatorColor = synth::Color::Grey;
 };

 struct EncoderDrawState
 {
     bool connected = false;
     bool hasVisualizerUnderlay = false;
     bool bipolar = false;
     std::size_t switchValues = 0;
     std::uint32_t modulatorsAffectingMask = 0;
-    std::uint32_t gesturesAffectingMask = 0;
+    synth::GestureMask gesturesAffectingMask = 0;
     synth::Color baseColor = synth::Color::Off;
     std::string shortLabel;
     std::size_t voiceCount = 0;
     std::vector<EncoderVoiceDrawState> voices;
     std::vector<synth::Color> modulatorColors;
     std::vector<synth::Color> gestureColors;
 };

 inline EncoderDrawState EncoderDrawStateFromParameter(const synth::Parameter::UIState& state)
 {
@@ -679,32 +683,32 @@ inline std::vector<DrawCommand> BuildEncoderDrawCommands(const EncoderDrawState&
             {body.x + inset, body.y + inset, body.width - inset * 2.0f, body.height - inset * 2.0f},
             synth::ScaleAlpha(state.baseColor, state.hasVisualizerUnderlay ? 0.14f : 0.28f)));
     }
     commands.push_back(DrawCommand::StrokeEllipse(body, synth::ScaleAlpha(state.baseColor, 0.9f), 1.5f));
     commands.push_back(DrawCommand::StrokeRoundedRect(
         {bounds.x + 1.0f, bounds.y + 1.0f, bounds.width - 2.0f, bounds.height - 2.0f},
         6.0f,
         Color::Rgb(8, 9, 10),
         1.0f));

-    const auto drawBadges = [&](std::uint32_t mask, bool upper, bool modulator) {
+    const auto drawBadges = [&](std::uint64_t mask, bool upper, bool modulator) {
         const std::vector<synth::Color>& colors = modulator ? state.modulatorColors : state.gestureColors;
-        const std::uint32_t validMask = colors.size() >= 32
-                                            ? std::numeric_limits<std::uint32_t>::max()
-                                            : (colors.empty() ? 0u : (std::uint32_t{1} << colors.size()) - 1u);
+        const std::uint64_t validMask = colors.size() >= 64
+                                            ? std::numeric_limits<std::uint64_t>::max()
+                                            : (colors.empty() ? 0u : (std::uint64_t{1} << colors.size()) - 1u);
         assert((mask & ~validMask) == 0u && "badge mask index exceeds published color count");
         mask &= validMask;
         const std::size_t total = EncoderGeometry::CountMaskBits(mask);
         std::size_t badgeIndex = 0;
         for (std::size_t bit = 0; bit < colors.size() && badgeIndex < total; ++bit)
         {
-            if ((mask & (1u << bit)) == 0)
+            if ((mask & (std::uint64_t{1} << bit)) == 0)
             {
                 continue;
             }

             float x = 0.0f;
             float y = 0.0f;
             float length = 0.0f;
             EncoderGeometry::GetBadgePosition(
                 centerX, centerY, baseRadius * 0.72f, badgeIndex, total, upper, x, y, length);
             AppendBadge(commands, x, y, length, colors[bit], EncoderGeometry::BadgeText(modulator, bit));
diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
index 72054230..1a9a09c2 100644
--- a/projects/synth/include/synth/ParameterModulation.hpp
+++ b/projects/synth/include/synth/ParameterModulation.hpp
@@ -20,20 +20,21 @@

 namespace synth::ui {
 class Visualizer;
 }

 namespace synth {

 using ParameterId = std::uint32_t;
 using PhysicalEncoderId = std::uint32_t;
 using PageOrdinal = std::uint32_t;
+using GestureMask = std::uint64_t;

 struct AtomicColor {
     AtomicColor() = default;
     explicit AtomicColor(Color color) { Store(color); }
     AtomicColor(const AtomicColor&) = delete;
     AtomicColor& operator=(const AtomicColor&) = delete;

     void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
         value.store(color.Packed(), order);
     }
@@ -186,21 +187,21 @@ struct ParameterStorageBatch {
     std::vector<float> currentMaxValueArena;
     std::vector<float> targetMaxValueArena;
     std::vector<float> currentDepthArena;
     std::vector<float> targetDepthArena;
     std::vector<float> currentKnobValueArena;
     std::vector<float> uiDisplayCenterArena;
     std::vector<float> uiDisplaySpreadEnergyArena;
     std::vector<Parameter*> modulationDepthArena;
     std::vector<float> sceneCenterArena;
     std::vector<float> gestureValueArena;
-    std::vector<std::uint8_t> gestureActiveArena;
+    std::vector<GestureMask> gestureActiveMaskArena;
 };

 std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                  std::size_t gestureCount,
                                                                  std::size_t capacity);

 struct ModulatorMetadata {
     std::string name;
     std::string shortName;
     Color sourceColor;
@@ -255,34 +256,35 @@ private:
 };

 class Gestures {
 public:
     explicit Gestures(std::size_t gestures = 0);

     float& Value(std::size_t gestureIx);
     float Value(std::size_t gestureIx) const;
     void Select(std::size_t gestureIx, bool selected);
     bool Selected(std::size_t gestureIx) const;
+    GestureMask SelectedMask() const { return selectedMask_; }
     void ClearSelection();

     std::size_t NumGestures() const { return values_.size(); }

     GestureMetadata& Metadata(std::size_t gestureIx);
     const GestureMetadata& Metadata(std::size_t gestureIx) const;
     std::span<GestureMetadata> Metadata() { return metadata_; }
     std::span<const GestureMetadata> Metadata() const { return metadata_; }

 private:
     void CheckIndex(std::size_t gestureIx) const;

     std::vector<float> values_;
-    std::vector<bool> selected_;
+    GestureMask selectedMask_ = 0;
     std::vector<GestureMetadata> metadata_;
 };

 class ParameterGroup {
 public:
     ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount);
     ~ParameterGroup();

     const ParameterGroupConfig& Config() const { return config_; }
     Modulators& GetModulators() { return modulators_; }
@@ -342,21 +344,21 @@ private:
     std::vector<float> currentMaxValueArena_;
     std::vector<float> targetMaxValueArena_;
     std::vector<float> currentDepthArena_;
     std::vector<float> targetDepthArena_;
     std::vector<float> currentKnobValueArena_;
     std::vector<float> uiDisplayCenterArena_;
     std::vector<float> uiDisplaySpreadEnergyArena_;
     std::vector<Parameter*> modulationDepthArena_;
     std::vector<float> sceneCenterArena_;
     std::vector<float> gestureValueArena_;
-    std::vector<std::uint8_t> gestureActiveArena_;
+    std::vector<GestureMask> gestureActiveMaskArena_;
 };

 class Parameter {
 public:
     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx);
     Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
               ParameterStorageBatch& storageBatch, std::size_t slotIx);

     struct UIState {
         UIState() = default;
@@ -369,21 +371,21 @@ public:

         void Configure(std::size_t voiceCapacity, std::size_t modulatorColorCapacity = 0,
                        std::size_t gestureColorCapacity = 0);
         void SetDisconnected();

         std::atomic<std::uint32_t> revision{0};
         std::atomic<bool> connected{false};
         std::atomic<bool> bipolar{false};
         std::atomic<std::size_t> switchValues{0};
         std::atomic<std::uint32_t> modulatorsAffectingMask{0};
-        std::atomic<std::uint32_t> gesturesAffectingMask{0};
+        std::atomic<GestureMask> gesturesAffectingMask{0};
         AtomicColor baseColor;
         std::atomic<synth::ui::Visualizer*> visualizer{nullptr};
         std::atomic<const char*> shortName{nullptr};
         std::atomic<std::size_t> voiceCount{0};
         std::size_t voiceCapacity = 0;
         std::atomic<std::size_t> modulatorColorCount{0};
         std::size_t modulatorColorCapacity = 0;
         std::unique_ptr<AtomicColor[]> modulatorSourceColors;
         std::atomic<std::size_t> gestureColorCount{0};
         std::size_t gestureColorCapacity = 0;
@@ -427,21 +429,21 @@ public:
     Parameter& EnsureModulationDepth(std::size_t modIx, ParameterConfig config);
     void ClearModulationDepths();
     Parameter* ModulationDepthParameter(std::size_t modIx) const;

     float& SceneCenter(std::size_t sceneIx);
     float SceneCenter(std::size_t sceneIx) const;
     float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
     float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
     void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
     bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
-    std::uint32_t GesturesAffectingMask() const;
+    GestureMask GesturesAffectingMask() const;

     std::span<float> CurrentDepths(std::size_t voiceIx);
     std::span<const float> CurrentDepths(std::size_t voiceIx) const;
     std::span<float> TargetDepths(std::size_t voiceIx);
     std::span<const float> TargetDepths(std::size_t voiceIx) const;

     float CurrentCenter() const { return currentCenter_; }
     float TargetCenter() const { return targetCenter_; }
     float CurrentCenterScale(std::size_t voiceIx) const;
     float TargetCenterScale(std::size_t voiceIx) const;
@@ -487,21 +489,21 @@ private:
     std::span<float> currentMaxValues_;
     std::span<float> targetMaxValues_;
     std::span<float> currentDepths_;
     std::span<float> targetDepths_;
     std::span<float> currentKnobValues_;
     std::span<float> uiDisplayCenters_;
     std::span<float> uiDisplaySpreadEnergies_;
     std::span<Parameter*> modulationDepths_;
     std::span<float> sceneCenters_;
     std::span<float> gestureValues_;
-    std::span<std::uint8_t> gestureActive_;
+    std::span<GestureMask> gestureActiveMasks_;
 };

 class Bank {
 public:
     explicit Bank(ParameterManager* manager = nullptr);

     struct VisibleCell {
         Parameter* parameter = nullptr;
     };

@@ -519,21 +521,21 @@ public:
     void Deselect();
     bool ShowingModulation() const;
     void SetBankColor(Color color) { bankColor_ = color; }
     Color BankColor() const { return bankColor_; }

     std::size_t VisibleMappingCount() const;
     Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
     VisibleCell VisibleCellFor(PhysicalEncoderId encoderId) const;
     Parameter* SelectedParameter() const { return selected_; }
     Parameter* TargetParameter() const;
-    std::uint32_t GesturesAffectingMask() const;
+    GestureMask GesturesAffectingMask() const;

 private:
     friend class BankSlot;

     struct Cell {
         PhysicalEncoderId encoderId = 0;
         Parameter* parameter = nullptr;
     };

     void AssociateSlot(BankSlot& slot);
@@ -751,20 +753,21 @@ public:
     void SetRandomSource(ParameterRandomFloat valueSource, ParameterRandomFloat coinSource,
                          ParameterRandomIndex indexSource);
     float NextRandomValue();
     float NextRandomCoin();
     std::size_t NextRandomIndex(std::size_t exclusiveMax);

     void SelectGesture(std::size_t gestureIx);
     void DeselectGesture(std::size_t gestureIx);
     void ToggleGestureSelected(std::size_t gestureIx);
     bool GestureSelected(std::size_t gestureIx) const;
+    GestureMask SelectedGestureMask() const { return gestures_.SelectedMask(); }
     void SetGestureValue(std::size_t gestureIx, float value);
     float GestureValue(std::size_t gestureIx) const;
     GestureMetadata& GestureMetadataAt(std::size_t gestureIx);
     const GestureMetadata& GestureMetadataAt(std::size_t gestureIx) const;
     void ClearGestureActiveFlagsForActiveSceneSelection(std::size_t gestureIx);

     std::unique_ptr<UIState> CreateUIState() const;
     void PopulateUIState(UIState& state) const;
     void SetParameterMessageOutBus(ParameterMessageOutBus* bus) { parameterMessageOutBus_ = bus; }
     bool RequestParameterStorageBatch(ParameterGroup& group, std::size_t minimumAdditionalParameters);
diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
index 926afb28..3322b5fc 100644
--- a/projects/synth/src/ParameterModulation.cpp
+++ b/projects/synth/src/ParameterModulation.cpp
@@ -1,27 +1,44 @@
 #include "synth/ParameterModulation.hpp"

 #include <algorithm>
 #include <array>
+#include <bit>
 #include <charconv>
 #include <cmath>
 #include <limits>
 #include <stdexcept>
 #include <utility>

 namespace synth {

 namespace {

 // Local modulation-depth controls are intentionally not addressable through ParameterManager::ParameterById.
 constexpr ParameterId kLocalParameterId = std::numeric_limits<ParameterId>::max();

+GestureMask GestureCountMask(std::size_t count) {
+    if (count >= std::numeric_limits<GestureMask>::digits) {
+        return std::numeric_limits<GestureMask>::max();
+    }
+    return count == 0 ? GestureMask{0} : (GestureMask{1} << count) - GestureMask{1};
+}
+
+template <class Fn>
+void ForEachGestureBit(GestureMask mask, Fn&& fn) {
+    while (mask != 0) {
+        const std::size_t gestureIx = std::countr_zero(mask);
+        mask &= mask - 1;
+        fn(gestureIx);
+    }
+}
+
 void ValidateProcessingRates(double referenceRate, double processingRate) {
     if (!(std::isfinite(referenceRate) && referenceRate > 0.0 && std::isfinite(processingRate) &&
           processingRate > 0.0)) {
         throw std::invalid_argument("processing timing rates must be positive and finite");
     }
 }

 void ValidateOnePoleAlpha(float alpha) {
     if (!(alpha >= 0.0f && alpha <= 1.0f)) {
         throw std::invalid_argument("one-pole alpha must be in [0,1]");
@@ -216,21 +233,21 @@ ParameterStorageBatch::ParameterStorageBatch(const ParameterGroupConfig& config,
       currentMaxValueArena(capacity * config.numVoices),
       targetMaxValueArena(capacity * config.numVoices),
       currentDepthArena(capacity * config.numVoices * config.numModulators),
       targetDepthArena(capacity * config.numVoices * config.numModulators),
       currentKnobValueArena(capacity * config.numVoices),
       uiDisplayCenterArena(capacity * config.numVoices),
       uiDisplaySpreadEnergyArena(capacity * config.numVoices),
       modulationDepthArena(capacity * config.numModulators, nullptr),
       sceneCenterArena(capacity * config.numScenes),
       gestureValueArena(capacity * config.numScenes * gestureCount),
-      gestureActiveArena(capacity * config.numScenes * gestureCount, 0) {
+      gestureActiveMaskArena(capacity * config.numScenes, 0) {
     parameters.reserve(capacity);
 }

 bool ParameterStorageBatch::Compatible(const ParameterGroupConfig& config, std::size_t liveGestureCount) const {
     return numVoices == config.numVoices && numModulators == config.numModulators &&
            numScenes == config.numScenes && gestureCount == liveGestureCount && capacity > 0;
 }

 std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                  std::size_t gestureCount,
@@ -318,45 +335,53 @@ std::size_t Modulators::Index(std::size_t voiceIx, std::size_t modIx) const {
         throw std::out_of_range("modulator voice index out of range");
     }
     if (modIx >= numModulators_) {
         throw std::out_of_range("modulator index out of range");
     }
     return voiceIx * numModulators_ + modIx;
 }

 Gestures::Gestures(std::size_t gestures)
     : values_(gestures, 0.0f),
-      selected_(gestures, false),
-      metadata_(gestures) {}
+      metadata_(gestures) {
+    if (gestures > std::numeric_limits<GestureMask>::digits) {
+        throw std::invalid_argument("gesture count exceeds 64-bit selector capacity");
+    }
+}

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
-    selected_[gestureIx] = selected;
+    const GestureMask bit = GestureMask{1} << gestureIx;
+    if (selected) {
+        selectedMask_ |= bit;
+    } else {
+        selectedMask_ &= ~bit;
+    }
 }

 bool Gestures::Selected(std::size_t gestureIx) const {
     CheckIndex(gestureIx);
-    return selected_[gestureIx];
+    return (selectedMask_ & (GestureMask{1} << gestureIx)) != 0;
 }

 void Gestures::ClearSelection() {
-    std::fill(selected_.begin(), selected_.end(), false);
+    selectedMask_ = 0;
 }

 GestureMetadata& Gestures::Metadata(std::size_t gestureIx) {
     CheckIndex(gestureIx);
     return metadata_[gestureIx];
 }

 const GestureMetadata& Gestures::Metadata(std::size_t gestureIx) const {
     CheckIndex(gestureIx);
     return metadata_[gestureIx];
@@ -385,21 +410,21 @@ ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& ma
     currentMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
     targetMaxValueArena_.resize(config_.maxParameters * config_.numVoices);
     currentDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
     targetDepthArena_.resize(config_.maxParameters * config_.numVoices * config_.numModulators);
     currentKnobValueArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplayCenterArena_.resize(config_.maxParameters * config_.numVoices);
     uiDisplaySpreadEnergyArena_.resize(config_.maxParameters * config_.numVoices);
     modulationDepthArena_.resize(config_.maxParameters * config_.numModulators, nullptr);
     sceneCenterArena_.resize(config_.maxParameters * config_.numScenes);
     gestureValueArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_);
-    gestureActiveArena_.resize(config_.maxParameters * config_.numScenes * gestureCount_, 0);
+    gestureActiveMaskArena_.resize(config_.maxParameters * config_.numScenes, 0);
 }

 ParameterGroup::~ParameterGroup() = default;

 bool ParameterGroup::CanAllocate() const {
     return AvailableParameterSlots() > 0;
 }

 std::size_t ParameterGroup::AvailableParameterSlots() const {
     const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
@@ -571,37 +596,37 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
       uiDisplaySpreadEnergies_(ArenaSlice(group_.uiDisplaySpreadEnergyArena_,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(group_.modulationDepthArena_, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(group_.sceneCenterArena_, slotIx_ * group_.Config().numScenes,
                                group_.Config().numScenes)),
       gestureValues_(ArenaSlice(group_.gestureValueArena_,
                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                 group_.Config().numScenes * group_.GestureCount())),
-      gestureActive_(ArenaSlice(group_.gestureActiveArena_,
-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
-                                group_.Config().numScenes * group_.GestureCount())) {
+      gestureActiveMasks_(ArenaSlice(group_.gestureActiveMaskArena_,
+                                     slotIx_ * group_.Config().numScenes,
+                                     group_.Config().numScenes)) {
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
-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
       slotIx_(slotIx),
       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
@@ -641,37 +666,37 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
       uiDisplaySpreadEnergies_(ArenaSlice(storageBatch.uiDisplaySpreadEnergyArena,
                                           slotIx_ * group_.Config().numVoices,
                                           group_.Config().numVoices)),
       modulationDepths_(ArenaSlice(storageBatch.modulationDepthArena, slotIx_ * group_.Config().numModulators,
                                    group_.Config().numModulators)),
       sceneCenters_(ArenaSlice(storageBatch.sceneCenterArena, slotIx_ * group_.Config().numScenes,
                                group_.Config().numScenes)),
       gestureValues_(ArenaSlice(storageBatch.gestureValueArena,
                                 slotIx_ * group_.Config().numScenes * group_.GestureCount(),
                                 group_.Config().numScenes * group_.GestureCount())),
-      gestureActive_(ArenaSlice(storageBatch.gestureActiveArena,
-                                slotIx_ * group_.Config().numScenes * group_.GestureCount(),
-                                group_.Config().numScenes * group_.GestureCount())) {
+      gestureActiveMasks_(ArenaSlice(storageBatch.gestureActiveMaskArena,
+                                     slotIx_ * group_.Config().numScenes,
+                                     group_.Config().numScenes)) {
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
-    std::fill(gestureActive_.begin(), gestureActive_.end(), 0);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }

 ParameterStorageBatch::~ParameterStorageBatch() = default;

 void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
                                    std::size_t newGestureColorCapacity) {
     voiceCapacity = newVoiceCapacity;
     modulatorColorCapacity = newModulatorColorCapacity;
     gestureColorCapacity = newGestureColorCapacity;
@@ -992,70 +1017,70 @@ void Parameter::HandleIncDec(const SceneState& scene, float delta) {
     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
         if (GestureActive(sceneIx, gestureIx)) {
             return false;
         }
         GestureValue(sceneIx, gestureIx) = SceneCenter(sceneIx);
         SetGestureActive(sceneIx, gestureIx, true);
         return true;
     };

     bool armedGesture = false;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
-        if (!group_.Manager().GestureSelected(gestureIx)) {
-            continue;
-        }
-
+    ForEachGestureBit(group_.Manager().SelectedGestureMask() & GestureCountMask(group_.GestureCount()),
+                      [&](std::size_t gestureIx) {
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
-    }
+    });

     if (armedGesture) {
         return;
     }

     float activeEffectiveWeightSum = 0.0f;
     float baseShareNumerator = 0.0f;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    const GestureMask activeGestures =
+        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
+        GestureCountMask(group_.GestureCount());
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }
         activeEffectiveWeightSum += effectiveWeight;
         baseShareNumerator += effectiveWeight * (1.0f - effectiveWeight);
-    }
+    });

     if (activeEffectiveWeightSum == 0.0f) {
         ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend, delta, config_.range);
         return;
     }

     ApplySceneDistribution(SceneCenter(scene.leftScene), SceneCenter(scene.rightScene), blend,
                            delta * (baseShareNumerator / activeEffectiveWeightSum), config_.range);

-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }

         const float gestureDelta = delta * ((effectiveWeight * effectiveWeight) / activeEffectiveWeightSum);
         ApplySceneDistribution(GestureValue(scene.leftScene, gestureIx), GestureValue(scene.rightScene, gestureIx),
                                blend, gestureDelta, config_.range);
-    }
+    });
 }

 void Parameter::RandomizeVisibleValue(const SceneState& scene, float normalized) {
     ValidateSceneEndpoints(scene);
     const float target = LinearMap(RangeMin(config_.range), RangeMax(config_.range),
                                    std::clamp(normalized, 0.0f, 1.0f));
     Compute(scene);
     SnapCurrentToTarget();
     const float delta = target - TargetValue(0);
     HandleIncDec(scene, delta);
@@ -1219,25 +1244,32 @@ float Parameter::SceneCenter(std::size_t sceneIx) const {

 float& Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) {
     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
 }

 float Parameter::GestureValue(std::size_t sceneIx, std::size_t gestureIx) const {
     return gestureValues_[SceneGestureIndex(sceneIx, gestureIx)];
 }

 void Parameter::SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active) {
-    gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] = active ? 1 : 0;
+    (void)SceneGestureIndex(sceneIx, gestureIx);
+    const GestureMask bit = GestureMask{1} << gestureIx;
+    if (active) {
+        gestureActiveMasks_[sceneIx] |= bit;
+    } else {
+        gestureActiveMasks_[sceneIx] &= ~bit;
+    }
 }

 bool Parameter::GestureActive(std::size_t sceneIx, std::size_t gestureIx) const {
-    return gestureActive_[SceneGestureIndex(sceneIx, gestureIx)] != 0;
+    (void)SceneGestureIndex(sceneIx, gestureIx);
+    return (gestureActiveMasks_[sceneIx] & (GestureMask{1} << gestureIx)) != 0;
 }

 std::span<float> Parameter::CurrentDepths(std::size_t voiceIx) {
     if (voiceIx >= group_.Config().numVoices) {
         throw std::out_of_range("parameter voice index out of range");
     }
     if (group_.Config().numModulators == 0) {
         return {};
     }
     const std::size_t rowStart = voiceIx * group_.Config().numModulators;
@@ -1334,23 +1366,21 @@ void Parameter::ValidateSceneEndpoints(const SceneState& scene) const {
 float Parameter::EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const {
     const float clampedBlend = std::clamp(blend, 0.0f, 1.0f);
     const float groupWeight = group_.Manager().GestureValue(gestureIx);
     const float leftWeight = GestureActive(scene.leftScene, gestureIx) ? groupWeight * (1.0f - clampedBlend) : 0.0f;
     const float rightWeight = GestureActive(scene.rightScene, gestureIx) ? groupWeight * clampedBlend : 0.0f;
     return leftWeight + rightWeight;
 }

 void Parameter::ResetSceneToDefault(std::size_t sceneIx, float defaultValue) {
     SceneCenter(sceneIx) = defaultValue;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
-        SetGestureActive(sceneIx, gestureIx, false);
-    }
+    gestureActiveMasks_[sceneIx] = 0;
 }

 void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
     ValidateSceneEndpoints(scene);
     for (Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr) {
             depthParameter->ResetModulationDepthToNeutral(scene);
         }
     }

@@ -1383,32 +1413,38 @@ void Parameter::ResetModulationDepthToNeutral(const SceneState& scene) {
 }

 float Parameter::ComputeRawCenter(const SceneState& scene) const {
     ValidateSceneEndpoints(scene);
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
     const float inverseBlend = 1.0f - blend;
     const float base = SceneCenter(scene.leftScene) * inverseBlend + SceneCenter(scene.rightScene) * blend;

     float weightedMixSum = 0.0f;
     float activeWeightSum = 0.0f;
-    for (std::size_t gestureIx = 0; gestureIx < group_.GestureCount(); ++gestureIx) {
+    const GestureMask activeGestures =
+        (gestureActiveMasks_[scene.leftScene] | gestureActiveMasks_[scene.rightScene]) &
+        GestureCountMask(group_.GestureCount());
+    ForEachGestureBit(activeGestures, [&](std::size_t gestureIx) {
+        if (group_.processingObserver_ != nullptr) {
+            ++group_.processingObserver_->activeGestureVisits;
+        }
         const float effectiveWeight = EffectiveGestureWeight(scene, gestureIx, blend);
         if (effectiveWeight == 0.0f) {
-            continue;
+            return;
         }

         const float gestureValue = GestureValue(scene.leftScene, gestureIx) * inverseBlend +
                                    GestureValue(scene.rightScene, gestureIx) * blend;
         const float mix = base * (1.0f - effectiveWeight) + gestureValue * effectiveWeight;
         weightedMixSum += effectiveWeight * mix;
         activeWeightSum += effectiveWeight;
-    }
+    });

     if (activeWeightSum == 0.0f) {
         return base;
     }
     return weightedMixSum / activeWeightSum;
 }

 void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter) {
     recursionDepth_ = recursionDepth;
     if (recursionDepth > 0 && group_.processingObserver_ != nullptr) {
@@ -1545,22 +1581,22 @@ bool Parameter::HasNonZeroState() const {

     if (std::fabs(currentCenter_ - neutralDepthCenter) > tolerance ||
         std::fabs(targetCenter_ - neutralDepthCenter) > tolerance) {
         return true;
     }
     for (const float center : sceneCenters_) {
         if (std::fabs(center - neutralDepthCenter) > tolerance) {
             return true;
         }
     }
-    for (const std::uint8_t active : gestureActive_) {
-        if (active != 0) {
+    for (const GestureMask activeMask : gestureActiveMasks_) {
+        if (activeMask != 0) {
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
@@ -1596,22 +1632,22 @@ bool Parameter::HasNonDefaultState() const {
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
-    for (const std::uint8_t active : gestureActive_) {
-        if (active != 0) {
+    for (const GestureMask activeMask : gestureActiveMasks_) {
+        if (activeMask != 0) {
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
@@ -1639,42 +1675,34 @@ bool Parameter::HasNonDefaultState() const {
         }
     }
     for (const Parameter* depthParameter : modulationDepths_) {
         if (depthParameter != nullptr && depthParameter->HasNonDefaultState()) {
             return true;
         }
     }
     return false;
 }

-std::uint32_t Parameter::GesturesAffectingMask() const {
-    std::uint32_t mask = 0;
+GestureMask Parameter::GesturesAffectingMask() const {
     const SceneState& scene = group_.Manager().Scene();
     const float blend = std::clamp(scene.blend, 0.0f, 1.0f);
-    const std::size_t count = std::min<std::size_t>(group_.GestureCount(), 32);
     const bool leftSceneValid = scene.leftScene < group_.Config().numScenes;
     const bool rightSceneValid = scene.rightScene < group_.Config().numScenes;
-    for (std::size_t gestureIx = 0; gestureIx < count; ++gestureIx) {
-        bool active = false;
-        if (blend <= 0.0f) {
-            active = leftSceneValid && GestureActive(scene.leftScene, gestureIx);
-        } else if (blend >= 1.0f) {
-            active = rightSceneValid && GestureActive(scene.rightScene, gestureIx);
-        } else {
-            active = (leftSceneValid && GestureActive(scene.leftScene, gestureIx)) ||
-                     (rightSceneValid && GestureActive(scene.rightScene, gestureIx));
-        }
-        if (active) {
-            mask |= (std::uint32_t{1} << gestureIx);
-        }
+    if (blend <= 0.0f) {
+        return leftSceneValid ? gestureActiveMasks_[scene.leftScene] & GestureCountMask(group_.GestureCount()) : 0;
     }
-    return mask;
+    if (blend >= 1.0f) {
+        return rightSceneValid ? gestureActiveMasks_[scene.rightScene] & GestureCountMask(group_.GestureCount()) : 0;
+    }
+    const GestureMask leftMask = leftSceneValid ? gestureActiveMasks_[scene.leftScene] : 0;
+    const GestureMask rightMask = rightSceneValid ? gestureActiveMasks_[scene.rightScene] : 0;
+    return (leftMask | rightMask) & GestureCountMask(group_.GestureCount());
 }

 void ParameterGroup::SelectGesture(std::size_t gestureIx) {
     manager_->SelectGesture(gestureIx);
 }

 void ParameterGroup::DeselectGesture(std::size_t gestureIx) {
     manager_->DeselectGesture(gestureIx);
 }

@@ -1881,22 +1909,22 @@ Bank::VisibleCell Bank::VisibleCellFor(PhysicalEncoderId encoderId) const {
     }
     return {
         .parameter = cell->parameter,
     };
 }

 Parameter* Bank::TargetParameter() const {
     return ShowingModulation() ? selected_ : nullptr;
 }

-std::uint32_t Bank::GesturesAffectingMask() const {
-    std::uint32_t mask = 0;
+GestureMask Bank::GesturesAffectingMask() const {
+    GestureMask mask = 0;
     for (const Cell& cell : topLevel_) {
         if (cell.parameter != nullptr) {
             mask |= cell.parameter->GesturesAffectingMask();
         }
     }
     return mask;
 }

 void BankSlot::UIState::Configure(std::size_t newCellCapacity, std::size_t voiceCapacity,
                                   std::size_t modulatorColorCapacity, std::size_t gestureColorCapacity) {
@@ -2139,21 +2167,21 @@ bool ParameterMessageOutBus::Pop(ParameterMessageOut& message) {
         return false;
     }
     const std::size_t head = head_.load(std::memory_order_relaxed);
     message = queue_[head];
     head_.store((head + 1) % queue_.size(), std::memory_order_release);
     size_.fetch_sub(1, std::memory_order_release);
     return true;
 }

 bool ParameterManager::SetGestureCount(std::size_t count) {
-    if (!groups_.empty()) {
+    if (count > std::numeric_limits<GestureMask>::digits || !groups_.empty()) {
         return false;
     }
     gestures_ = Gestures(count);
     return true;
 }

 ParameterGroup& ParameterManager::CreateGroup(ParameterGroupConfig config) {
     auto group = std::make_unique<ParameterGroup>(std::move(config), *this, gestures_.NumGestures());
     ParameterGroup& result = *group;
     groups_.push_back(std::move(group));
@@ -2782,25 +2810,25 @@ void ParameterManager::PopulateUIState(UIState& state) const {
             state.gestures.selected[gestureIx].store(false, std::memory_order_relaxed);
             state.gestures.colors[gestureIx].Store(Color::Off);
             continue;
         }
         state.gestures.values[gestureIx].store(gestures_.Value(gestureIx), std::memory_order_relaxed);
         state.gestures.selected[gestureIx].store(gestures_.Selected(gestureIx), std::memory_order_relaxed);
         state.gestures.colors[gestureIx].Store(gestures_.Metadata(gestureIx).gestureColor);
     }
     const std::size_t compactBankCount = std::min<std::size_t>({state.bankCapacity, banks_.size(), 32});
     for (std::size_t bankIx = 0; bankIx < compactBankCount; ++bankIx) {
-        const std::uint32_t affecting = banks_[bankIx]->GesturesAffectingMask();
+        const GestureMask affecting = banks_[bankIx]->GesturesAffectingMask();
         for (std::size_t gestureIx = 0;
-             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 32);
+             gestureIx < std::min<std::size_t>(state.gestures.gestureCapacity, 64);
              ++gestureIx) {
-            if ((affecting & (std::uint32_t{1} << gestureIx)) == 0) {
+            if ((affecting & (GestureMask{1} << gestureIx)) == 0) {
                 continue;
             }
             std::uint32_t mask = state.gestures.bankAffectingMask[gestureIx].load(std::memory_order_relaxed);
             mask |= (std::uint32_t{1} << bankIx);
             state.gestures.bankAffectingMask[gestureIx].store(mask, std::memory_order_relaxed);
             state.gestures.bankAffectingCount[gestureIx].fetch_add(1, std::memory_order_relaxed);
         }
     }
 }

diff --git a/projects/synth/tests/instrument_tests.cpp b/projects/synth/tests/instrument_tests.cpp
index 3dbb6b3b..b9525422 100644
--- a/projects/synth/tests/instrument_tests.cpp
+++ b/projects/synth/tests/instrument_tests.cpp
@@ -110,20 +110,32 @@ TEST_CASE(KindNameRoundTrip) {
     REQUIRE_TRUE(synth::MidiProfileKindFromName("wrldbldr", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::WrldBldr);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("twister", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::MfTwister);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("launchpad", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::Launchpad);
     REQUIRE_TRUE(synth::MidiProfileKindFromName("generic", kind));
     REQUIRE_TRUE(kind == MidiProfileKind::Generic);
 }

+TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
+    synth::JsonArena arena(4096);
+    const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
+    const synth::JSON json = synth::ToJSON(arena, source);
+    synth::MessageIn target;
+    REQUIRE_TRUE(synth::FromJSON(json, target));
+    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
+    REQUIRE_TRUE(target.gestureIx == 63);
+    REQUIRE_TRUE(target.boolValue);
+    REQUIRE_TRUE(target.hasBoolValue);
+}
+
 TEST_CASE(KindNameFromUnknownRejected) {
     MidiProfileKind kind = MidiProfileKind::Generic;
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("bogus", kind));
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("", kind));
     REQUIRE_TRUE(!synth::MidiProfileKindFromName("WrldBldr", kind));
 }

 TEST_CASE(KindSupportMatrix) {
     const MidiKindSupport wrldbldr = synth::KindSupport(MidiProfileKind::WrldBldr);
     REQUIRE_TRUE(wrldbldr.encoders);
diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
index 597702eb..1133fe03 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -459,20 +459,77 @@ TEST_CASE(manager_gesture_count_is_fixed_before_groups) {
     REQUIRE_TRUE(manager.SetGestureCount(2));
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numScenes = 1,
         .maxParameters = 1,
     });
     REQUIRE_TRUE(group.GestureCount() == 2);
     REQUIRE_TRUE(!manager.SetGestureCount(3));
 }

+TEST_CASE(manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation) {
+    for (const std::size_t count : {std::size_t{0}, std::size_t{1}, std::size_t{32},
+                                    std::size_t{33}, std::size_t{64}}) {
+        synth::ParameterManager manager;
+        REQUIRE_TRUE(manager.SetGestureCount(count));
+        REQUIRE_TRUE(manager.GestureCount() == count);
+        if (count != 0) {
+            manager.SelectGesture(count - 1);
+            REQUIRE_TRUE(manager.GestureSelected(count - 1));
+        }
+    }
+
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    manager.SelectGesture(63);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+    REQUIRE_TRUE(manager.SelectedGestureMask() == (synth::GestureMask{1} << 63));
+    REQUIRE_TRUE(!manager.SetGestureCount(65));
+    REQUIRE_TRUE(manager.GestureCount() == 64);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+
+    bool threw = false;
+    try {
+        (void)synth::Gestures(65);
+    } catch (const std::invalid_argument&) {
+        threw = true;
+    }
+    REQUIRE_TRUE(threw);
+}
+
+TEST_CASE(gesture_masks_visit_only_active_bits_through_index_63) {
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 2,
+        .maxParameters = 1,
+        .processLiteAlpha = 1.0f,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& parameter = manager.CreateParameter(group, {.name = "Gesture sparse", .defaultValue = 0.25f});
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    parameter.Compute(manager.Scene());
+    REQUIRE_TRUE(work.activeGestureVisits == 0);
+
+    parameter.SetGestureActive(0, 63, true);
+    parameter.GestureValue(0, 63) = 0.75f;
+    manager.SetGestureValue(63, 1.0f);
+    parameter.Compute(manager.Scene());
+    REQUIRE_TRUE(work.activeGestureVisits == 1);
+    REQUIRE_TRUE((parameter.GesturesAffectingMask() & (std::uint64_t{1} << 63)) != 0);
+    parameter.ProcessLite();
+    REQUIRE_NEAR(parameter.GetRaw(0), 0.75f, 0.000001f);
+}
+
 TEST_CASE(validated_scene_endpoint_setter_preserves_state_on_reject) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 1});
     (void)manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});

     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 0));
     manager.SetSceneBlend(0.25f);
     REQUIRE_TRUE(!manager.SetSceneEndpoints(1, 0));
     REQUIRE_TRUE(manager.Scene().leftScene == 0);
@@ -2070,57 +2127,66 @@ TEST_CASE(parameter_ui_state_clears_semantic_colors_when_disconnected) {
     state.SetDisconnected();
     REQUIRE_TRUE(!state.connected.load(std::memory_order_relaxed));
     REQUIRE_TRUE(state.baseColor.Load() == synth::Color::Off);
     REQUIRE_TRUE(state.indicatorColors[0].Load() == synth::Color::Off);
     REQUIRE_TRUE(state.modulatorColorCount.load() == 0);
     REQUIRE_TRUE(state.gestureColorCount.load() == 0);
     REQUIRE_TRUE(state.modulatorSourceColors[0].Load() == synth::Color::Off);
     REQUIRE_TRUE(state.gestureColors[0].Load() == synth::Color::Off);
 }

-TEST_CASE(ui_state_reports_affecting_masks_for_first_32_indices) {
+TEST_CASE(ui_state_reports_affecting_masks_through_gesture_index_63) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(33);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 33,
         .numScenes = 2,
         .maxParameters = 4,
     });

     auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
     auto& depth31 = manager.CreateParameter(group, {.name = "Depth31", .defaultValue = 0.25f});
     auto& depth32 = manager.CreateParameter(group, {.name = "Depth32", .defaultValue = 0.25f});
     REQUIRE_TRUE(parameter.AssignModulationDepth(31, &depth31));
     REQUIRE_TRUE(parameter.AssignModulationDepth(32, &depth32));
     depth31.SceneCenter(0) = 0.75f;
     parameter.SetGestureActive(0, 0, true);
     parameter.SetGestureActive(0, 31, true);
     parameter.SetGestureActive(0, 32, true);
+    parameter.SetGestureActive(0, 63, true);
     parameter.SetGestureActive(1, 1, true);
     parameter.SetGestureActive(1, 31, true);
+    parameter.SetGestureActive(1, 32, true);

     synth::Parameter::UIState ui(1);
     REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));

     manager.SetSceneBlend(0.0f);
     parameter.PopulateUIState(ui);
     REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == (1u << 31));
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 31) |
+                  (std::uint64_t{1} << 32) | (std::uint64_t{1} << 63)));

     manager.SetSceneBlend(1.0f);
     parameter.PopulateUIState(ui);
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 1) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 1) | (std::uint64_t{1} << 31) |
+                  (std::uint64_t{1} << 32)));

     manager.SetSceneBlend(0.5f);
     parameter.PopulateUIState(ui);
-    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 1) | (1u << 31)));
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() ==
+                 ((std::uint64_t{1} << 0) | (std::uint64_t{1} << 1) |
+                  (std::uint64_t{1} << 31) | (std::uint64_t{1} << 32) |
+                  (std::uint64_t{1} << 63)));
 }

 TEST_CASE(ui_state_ignores_inactive_depth_gesture_values_for_modulator_mask) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -2638,41 +2704,41 @@ TEST_CASE(handle_inc_dec_saturation_solve_matches_smart_grid) {
     parameter.HandleIncDec(scene, 0.2f);
     parameter.Compute(scene);

     REQUIRE_NEAR(parameter.SceneCenter(0), 1.0f, 0.0001f);
     REQUIRE_NEAR(parameter.SceneCenter(1), 0.7f, 0.0001f);
     REQUIRE_NEAR(parameter.TargetCenter(), 0.925f, 0.0001f);
 }

 TEST_CASE(selected_gesture_activation_snapshots_parent_value) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(2);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 2,
         .maxParameters = 1,
         .targetCenterAlpha = 1.0f,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.1f});
     parameter.SceneCenter(0) = 0.25f;
     parameter.SceneCenter(1) = 0.75f;
-    parameter.GestureValue(0, 0) = 0.9f;
-    parameter.GestureValue(1, 0) = 0.9f;
-    manager.SelectGesture(0);
+    parameter.GestureValue(0, 63) = 0.9f;
+    parameter.GestureValue(1, 63) = 0.9f;
+    manager.SelectGesture(63);

     parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.0f);

-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.9f, 0.0001f);
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(!parameter.GestureActive(1, 63));
+    REQUIRE_NEAR(parameter.GestureValue(0, 63), 0.25f, 0.0001f);
+    REQUIRE_NEAR(parameter.GestureValue(1, 63), 0.9f, 0.0001f);
 }

 TEST_CASE(selected_inactive_gesture_first_turn_arms_without_applying_delta) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
@@ -2709,41 +2775,41 @@ TEST_CASE(selected_zero_weight_gesture_first_turn_arms_without_applying_delta) {
     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
     parameter.HandleIncDec(scene, 0.2f);

     REQUIRE_TRUE(parameter.GestureActive(0, 0));
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
     REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
 }

 TEST_CASE(active_high_gesture_distributes_after_deselection) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(1);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
     });
     auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.25f});
     parameter.SceneCenter(0) = 0.25f;
-    parameter.GestureValue(0, 0) = 0.9f;
-    parameter.SetGestureActive(0, 0, true);
-    manager.SetGestureValue(0, 1.0f);
-    manager.DeselectGesture(0);
+    parameter.GestureValue(0, 63) = 0.9f;
+    parameter.SetGestureActive(0, 63, true);
+    manager.SetGestureValue(63, 1.0f);
+    manager.DeselectGesture(63);

     const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
     parameter.HandleIncDec(scene, 0.2f);

-    REQUIRE_TRUE(parameter.GestureActive(0, 0));
-    REQUIRE_TRUE(!manager.GestureSelected(0));
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(!manager.GestureSelected(63));
     REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
-    REQUIRE_NEAR(parameter.GestureValue(0, 0), 1.0f, 0.0001f);
+    REQUIRE_NEAR(parameter.GestureValue(0, 63), 1.0f, 0.0001f);
 }

 TEST_CASE(selected_gesture_weight_one_edits_gesture_without_moving_base) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 0,
         .numScenes = 1,
         .maxParameters = 1,
@@ -4084,20 +4150,62 @@ TEST_CASE(message_bus_set_reset_and_set_gesture_select_are_idempotent) {
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetReset(0, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, true)));
     REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, false)));
     bus.Process(0);

     REQUIRE_TRUE(manager.ResetHeld());
     REQUIRE_TRUE(!manager.GestureSelected(1));
 }

+TEST_CASE(message_bus_and_patch_round_trip_gesture_indices_32_and_63) {
+    synth::ParameterManager source;
+    REQUIRE_TRUE(source.SetGestureCount(64));
+    auto& sourceGroup = source.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 1,
+        .maxParameters = 1,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& sourceParameter = source.CreateParameter(sourceGroup, {.name = "High gestures", .defaultValue = 0.25f});
+    synth::MessageInBus bus(&source, 8);
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 32, true)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 63, true)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 32, 0.4f)));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 63, 0.8f)));
+    bus.Process(0);
+    REQUIRE_TRUE(source.GestureSelected(32));
+    REQUIRE_TRUE(source.GestureSelected(63));
+
+    sourceParameter.GestureValue(0, 32) = 0.45f;
+    sourceParameter.GestureValue(0, 63) = 0.85f;
+    sourceParameter.SetGestureActive(0, 32, true);
+    sourceParameter.SetGestureActive(0, 63, true);
+
+    synth::JsonArena arena(65536);
+    const synth::JSON saved = source.ParameterValuesToJSON(arena);
+    synth::ParameterManager target;
+    REQUIRE_TRUE(target.SetGestureCount(64));
+    auto& targetGroup = target.CreateGroup({
+        .numVoices = 1,
+        .numScenes = 1,
+        .maxParameters = 1,
+        .targetCenterAlpha = 1.0f,
+    });
+    auto& targetParameter = target.CreateParameter(targetGroup, {.name = "High gestures", .defaultValue = 0.25f});
+    REQUIRE_TRUE(target.LoadParameterValuesFromJSON(saved));
+    REQUIRE_NEAR(targetParameter.GestureValue(0, 32), 0.45f, 0.000001f);
+    REQUIRE_NEAR(targetParameter.GestureValue(0, 63), 0.85f, 0.000001f);
+    REQUIRE_TRUE(targetParameter.GestureActive(0, 32));
+    REQUIRE_TRUE(targetParameter.GestureActive(0, 63));
+}
+
 TEST_CASE(manager_tracks_reset_random_and_random_mod_precedence) {
     synth::ParameterManager manager;
     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::None);

     manager.SetResetHeld(true);
     REQUIRE_TRUE(manager.ResetHeld());
     REQUIRE_TRUE(manager.GetCurrentModifier() == synth::Modifier::Reset);

     manager.SetRandomHeld(true);
     REQUIRE_TRUE(manager.RandomHeld());
@@ -4161,30 +4269,31 @@ TEST_CASE(manager_random_source_hooks_are_deterministic_and_bounded) {
     REQUIRE_NEAR(manager.NextRandomValue(), 0.4f, 0.0001f);
     REQUIRE_NEAR(manager.NextRandomCoin(), 0.8f, 0.0001f);
     REQUIRE_NEAR(manager.NextRandomCoin(), 0.2f, 0.0001f);
     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
     REQUIRE_TRUE(manager.NextRandomIndex(5) == 2);
     REQUIRE_TRUE(manager.NextRandomIndex(0) == 0);
 }

 TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting) {
     synth::ParameterManager manager;
-    manager.SetGestureCount(4);
+    manager.SetGestureCount(64);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numScenes = 2,
         .maxParameters = 4,
     });
     auto& affected = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
     auto& unaffected = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.5f});
     auto& drillHidden = manager.CreateParameter(group, {.name = "C", .defaultValue = 0.75f});
     affected.SetGestureActive(0, 0, true);
+    affected.SetGestureActive(0, 63, true);
     unaffected.SetGestureActive(0, 1, true);
     drillHidden.SetGestureActive(0, 2, true);

     auto& bankA = manager.CreateBank();
     bankA.SetBankColor(synth::Color::Green);
     bankA.AddMapping(10, affected);
     bankA.AddMapping(13, drillHidden);
     auto& bankB = manager.CreateBank();
     bankB.SetBankColor(synth::Color::Blue);
     bankB.AddMapping(11, unaffected);
@@ -4193,21 +4302,21 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
     bankC.AddMapping(12, affected);

     auto& slot = manager.CreateBankSlot();
     slot.AddPhysicalEncoder(10);
     slot.AddPhysicalEncoder(13);
     slot.SelectBank(&bankA);
     manager.HandlePress(0, 0);
     REQUIRE_TRUE(bankA.ShowingModulation());

     synth::ParameterManager::UIState ui;
-    ui.Configure(1, 2, 1, 0, 4, 4);
+    ui.Configure(1, 2, 1, 0, 64, 4);
     manager.PopulateUIState(ui);

     REQUIRE_TRUE(ui.bankCapacity == 4);
     REQUIRE_TRUE(ui.banks[0].connected.load());
     REQUIRE_TRUE(ui.banks[0].selected.load());
     REQUIRE_TRUE(ui.banks[0].bankColor.Load() == synth::Color::Green);
     REQUIRE_TRUE(ui.banks[1].connected.load());
     REQUIRE_TRUE(!ui.banks[1].selected.load());
     REQUIRE_TRUE(ui.banks[1].bankColor.Load() == synth::Color::Blue);
     REQUIRE_TRUE(ui.banks[2].connected.load());
@@ -4217,20 +4326,22 @@ TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting)
     REQUIRE_TRUE(!ui.banks[3].selected.load());
     REQUIRE_TRUE(ui.banks[3].bankColor.Load() == synth::Color::Off);
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[0].load() == 2);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[0].load() == ((1u << 0u) | (1u << 2u)));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[1].load() == 1);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[1].load() == (1u << 1u));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[2].load() == 1);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[2].load() == (1u << 0u));
     REQUIRE_TRUE(ui.gestures.bankAffectingCount[3].load() == 0);
     REQUIRE_TRUE(ui.gestures.bankAffectingMask[3].load() == 0);
+    REQUIRE_TRUE(ui.gestures.bankAffectingCount[63].load() == 2);
+    REQUIRE_TRUE(ui.gestures.bankAffectingMask[63].load() == ((1u << 0u) | (1u << 2u)));
 }

 TEST_CASE(message_bus_routes_modulation_target_position_to_visible_parameter) {
     synth::ParameterManager manager;
     manager.SetGestureCount(1);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 2,
@@ -6326,35 +6437,35 @@ std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam
     std::uint32_t mask = 0;
     for (std::size_t modIx = 0; modIx < std::min<std::size_t>(kSimMods, 32); ++modIx) {
         const int route = parameter.route[modIx];
         if (route >= 0 && SimHasNonNeutralDepthState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
             mask |= (std::uint32_t{1} << modIx);
         }
     }
     return mask;
 }

-std::uint32_t SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
-    std::uint32_t mask = 0;
+synth::GestureMask SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
+    synth::GestureMask mask = 0;
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     for (std::size_t gestureIx = 0; gestureIx < std::min<std::size_t>(kSimGestures, 32); ++gestureIx) {
         bool active = false;
         if (blend <= 0.0f) {
             active = parameter.gestureActive[oracle.scene.leftScene][gestureIx];
         } else if (blend >= 1.0f) {
             active = parameter.gestureActive[oracle.scene.rightScene][gestureIx];
         } else {
             active = parameter.gestureActive[oracle.scene.leftScene][gestureIx] ||
                      parameter.gestureActive[oracle.scene.rightScene][gestureIx];
         }
         if (active) {
-            mask |= (std::uint32_t{1} << gestureIx);
+            mask |= (synth::GestureMask{1} << gestureIx);
         }
     }
     return mask;
 }

 void SimSeedDisplayState(SimOracle& oracle, std::size_t paramIx);

 void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
     SimParam& parameter = oracle.params[paramIx];
     parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);
@@ -7035,21 +7146,21 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
             const std::size_t paramIx = static_cast<std::size_t>(cell->parameter);
             const SimParam& expected = oracle.params[paramIx];
             if (actual.bipolar.load() != (expected.range == synth::RangeKind::Bipolar)) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " bipolar");
             }
             if (actual.baseColor.Load() != synth::Color::Grey) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color");
             }
             const std::size_t expectedSwitchValues = expected.switchValues;
             const std::uint32_t expectedModulatorMask = SimModulatorsAffectingMask(oracle, expected);
-            const std::uint32_t expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
+            const synth::GestureMask expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
             if (actual.switchValues.load() != expectedSwitchValues) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " switch values");
             }
             if (actual.modulatorsAffectingMask.load() != expectedModulatorMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " modulator mask");
             }
             if (actual.gesturesAffectingMask.load() != expectedGestureMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " gesture mask");
             }
             for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
diff --git a/projects/synth/tests/portable_ui_tests.cpp b/projects/synth/tests/portable_ui_tests.cpp
index eace7945..485fbd4f 100644
--- a/projects/synth/tests/portable_ui_tests.cpp
+++ b/projects/synth/tests/portable_ui_tests.cpp
@@ -429,20 +429,34 @@ int main()
     const synth::ui::EncoderDrawState snapshotEncoder =
         synth::ui::EncoderDrawStateFromParameter(parameterState);
     Require(snapshotEncoder.baseColor == synth::Color::Red, "encoder uses snapshot base color");
     Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
             "encoder uses snapshot voice-zero indicator color");
     Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
             "encoder uses snapshot source badge colors");
     Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
             "encoder uses snapshot gesture badge colors");

+    Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
+    Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
+    Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
+    synth::ui::EncoderDrawState highGestureEncoder;
+    highGestureEncoder.connected = true;
+    highGestureEncoder.gesturesAffectingMask = std::uint64_t{1} << 63;
+    highGestureEncoder.gestureColors.resize(64, synth::Color::Orange);
+    const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
+        highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
+    Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
+                return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
+            }),
+            "encoder renders gesture 63 as badge 64");
+
     static_assert(synth::SynthApplication<TestApp>);
     static_assert(!synth::ui::kPortableUiUsesJuce);
     static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
     static_assert(!std::is_copy_constructible_v<synth::ui::Visualizer>);
     static_assert(!std::is_copy_assignable_v<synth::ui::Visualizer>);
     static_assert(!std::is_move_constructible_v<synth::ui::Visualizer>);
     static_assert(!std::is_move_assignable_v<synth::ui::Visualizer>);
     TestVisualizer visualizer;
     Require(visualizer.Visible(), "visualizer is visible by default");
     visualizer.SetBounds({11.0f, 12.0f, 44.0f, 45.0f});
