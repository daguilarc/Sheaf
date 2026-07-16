# Review package: 0b42e995..dda1aeee

## Commits
dda1aeee perf(synth): recycle neutral modulation controls

## Files changed
 .../synth/include/synth/ParameterModulation.hpp    |  24 ++
 projects/synth/src/ParameterModulation.cpp         | 193 ++++++++-
 projects/synth/src/PatchPersistence.cpp            |   5 +-
 .../synth/tests/parameter_modulation_tests.cpp     | 469 ++++++++++++++++++++-
 4 files changed, 683 insertions(+), 8 deletions(-)

## Diff
diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
index 9e83531e..66bbe893 100644
--- a/projects/synth/include/synth/ParameterModulation.hpp
+++ b/projects/synth/include/synth/ParameterModulation.hpp
@@ -111,20 +111,21 @@ struct SceneState {
     float blend = 0.0f;
 };
 
 struct PageDescriptor {
     PageOrdinal ordinal = 0;
     std::string name;
 };
 
 class Parameter;
 class ParameterManager;
+class Bank;
 class BankSlot;
 struct ParameterStorageBatch;
 
 struct Page {
     PageOrdinal ordinal = 0;
     std::string name;
     std::vector<Parameter*> parameters;
 };
 
 inline constexpr float kDefaultProcessLiteAlpha = 0.1226942309f;  // 1 kHz one-pole cutoff at 48 kHz
@@ -293,20 +294,23 @@ public:
     const ParameterGroupConfig& Config() const { return config_; }
     Modulators& GetModulators() { return modulators_; }
     const Modulators& GetModulators() const { return modulators_; }
     ParameterManager& Manager() { return *manager_; }
     const ParameterManager& Manager() const { return *manager_; }
 
     bool CanAllocate() const;
     std::size_t AvailableParameterSlots() const;
     void AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch);
     std::size_t ParameterCount() const { return parameterCount_; }
+    std::size_t LiveLocalParameterCount() const { return liveLocalParameterCount_; }
+    std::size_t FreeLocalParameterSlotCount() const { return recycledLocalSlots_.size(); }
+    std::size_t CollectNeutralLocalParameters();
     Parameter& ParameterByLocalIndex(std::size_t localIx);
     const Parameter& ParameterByLocalIndex(std::size_t localIx) const;
     std::size_t GestureCount() const { return gestureCount_; }
     void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                              ModulatorMetadata metadata);
     void UpdateModValues();
     void SelectGesture(std::size_t gestureIx);
     void DeselectGesture(std::size_t gestureIx);
     bool GestureSelected(std::size_t gestureIx) const;
     void SetGestureValue(std::size_t gestureIx, float value);
@@ -315,36 +319,45 @@ public:
     void ConfigureProcessingTiming(const ParameterProcessingTiming& timing);
     void ProcessSample(std::uint64_t sampleIndex);
     void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }
 
 private:
     friend class Parameter;
     friend class ParameterManager;
     friend class Bank;
 
     Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
+    void RecycleLocalParameter(Parameter& parameter);
     void RegisterTopLevelParameter(Parameter& parameter);
     void RequestParameterStorageBatch(std::size_t minimumAdditionalParameters);
     void RequestParameterStorageBatchIfLow();
 
     // Groups own parameter objects and all same-shaped per-parameter arenas.
     // Parameter instances hold spans into these arenas; callers must not move a
     // group after handing out Parameter references.
     ParameterGroupConfig config_;
     ParameterManager* manager_ = nullptr;
     std::size_t gestureCount_ = 0;
     Modulators modulators_;
     std::size_t parameterCount_ = 0;
+    std::size_t liveLocalParameterCount_ = 0;
     std::vector<Parameter*> topLevelParameters_;
     ParameterProcessingObserver* processingObserver_ = nullptr;
     std::vector<std::unique_ptr<Parameter>> parameters_;
     std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
+    struct RecycledLocalSlot {
+        Parameter* parameter = nullptr;
+        ParameterStorageBatch* batch = nullptr;
+        std::size_t slotIx = 0;
+        std::size_t storageLocalIx = 0;
+    };
+    std::vector<RecycledLocalSlot> recycledLocalSlots_;
     bool storageRequestPending_ = false;
     std::vector<float> currentCenterScaleArena_;
     std::vector<float> targetCenterScaleArena_;
     std::vector<float> currentNormalizationOffsetArena_;
     std::vector<float> targetNormalizationOffsetArena_;
     std::vector<float> currentMinValueArena_;
     std::vector<float> targetMinValueArena_;
     std::vector<float> currentMaxValueArena_;
     std::vector<float> targetMaxValueArena_;
     std::vector<float> currentDepthArena_;
@@ -462,47 +475,57 @@ public:
     float CurrentCenterScale(std::size_t voiceIx) const;
     float TargetCenterScale(std::size_t voiceIx) const;
     float CurrentNormalizationOffset(std::size_t voiceIx) const;
     float TargetNormalizationOffset(std::size_t voiceIx) const;
     std::size_t RecursionDepth() const { return recursionDepth_; }
     JSON ToValueJSON(JsonArena& arena) const;
     bool LoadValuesFromJSON(JSON json);
 
 private:
     friend class ParameterManager;
+    friend class ParameterGroup;
+    friend class Bank;
 
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
     std::size_t VoiceRouteIndex(std::size_t voiceIx, std::size_t routeSlot) const;
     void EnsureRouteActive(std::size_t sourceIx);
     void RemoveActiveRoute(std::size_t routeSlot);
     bool RouteNeutralAcrossVoices(std::size_t routeSlot) const;
     void PruneNeutralActiveRoutes();
     void AssertRouteBijection() const;
+    void PinLocalForView();
+    void UnpinLocalForView();
+    bool CanRecycleLocal() const;
+    std::size_t CollectNeutralChildren();
+    void ResetLocalForReuse(ParameterId id, ParameterConfig config);
     std::uint32_t ModulatorsAffectingMask() const;
     bool HasNonDefaultState() const;
     bool HasNonZeroState() const;
 
     ParameterId id_;
     ParameterGroup& group_;
     ParameterConfig config_;
+    ParameterStorageBatch* storageBatch_ = nullptr;
     std::size_t slotIx_ = 0;
+    std::size_t storageLocalIx_ = 0;
+    std::size_t localViewPinCount_ = 0;
     std::size_t recursionDepth_ = 0;
     float currentCenter_ = 0.0f;
     float targetCenter_ = 0.0f;
     std::span<float> currentCenterScales_;
     std::span<float> targetCenterScales_;
     std::span<float> currentNormalizationOffsets_;
     std::span<float> targetNormalizationOffsets_;
     std::span<float> currentMinValues_;
     std::span<float> targetMinValues_;
     std::span<float> currentMaxValues_;
@@ -703,20 +726,21 @@ public:
     ParameterGroup& CreateGroup(ParameterGroupConfig config);
     ParameterId RegisterParameter(ParameterGroup& group, ParameterConfig config);
     Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
     Parameter& ParameterById(ParameterId id);
     const Parameter& ParameterById(ParameterId id) const;
     std::size_t ParameterCount() const { return parameters_.size(); }
     Parameter* FindParameterByName(std::string_view name);
     const Parameter* FindParameterByName(std::string_view name) const;
     JSON ParameterValuesToJSON(JsonArena& arena) const;
     bool LoadParameterValuesFromJSON(JSON json);
+    std::size_t CollectNeutralLocalParameters();
     void ComputeAllParameters();
     // Control-rate target computation for the steady-state audio pump:
     // Compute() every parameter without snapping current values, so
     // ProcessLite() slewing stays audible (sar-6). Use ComputeAllParameters()
     // only for non-steady-state moments (init, patch load, revert).
     void ComputeAllTargets();
     void CaptureDefaultControlState();
     void RevertAllToDefaults();
 
     float GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
index daaac76e..9382e9c1 100644
--- a/projects/synth/src/ParameterModulation.cpp
+++ b/projects/synth/src/ParameterModulation.cpp
@@ -417,20 +417,21 @@ void Gestures::CheckIndex(std::size_t gestureIx) const {
 }
 
 ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
     : config_(ValidateConfig(config)),
       manager_(&manager),
       gestureCount_(gestureCount),
       modulators_(config.numVoices, config.numModulators),
       parameterCount_(0) {
     parameters_.reserve(config_.maxParameters);
     topLevelParameters_.reserve(config_.maxParameters);
+    recycledLocalSlots_.reserve(config_.maxParameters);
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
@@ -450,64 +451,114 @@ ParameterGroup::~ParameterGroup() = default;
 bool ParameterGroup::CanAllocate() const {
     return AvailableParameterSlots() > 0;
 }
 
 std::size_t ParameterGroup::AvailableParameterSlots() const {
     const std::size_t initialAllocated = std::min(parameterCount_, config_.maxParameters);
     std::size_t available = config_.maxParameters - initialAllocated;
     for (const auto& batch : extraStorageBatches_) {
         available += batch->Available();
     }
-    return available;
+    return available + recycledLocalSlots_.size();
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
 
+    if (id == kLocalParameterId && !recycledLocalSlots_.empty()) {
+        RecycledLocalSlot recycled = recycledLocalSlots_.back();
+        recycledLocalSlots_.pop_back();
+        if (recycled.parameter == nullptr || recycled.parameter->storageBatch_ != recycled.batch ||
+            recycled.parameter->slotIx_ != recycled.slotIx ||
+            recycled.parameter->storageLocalIx_ != recycled.storageLocalIx ||
+            &ParameterByLocalIndex(recycled.storageLocalIx) != recycled.parameter ||
+            (recycled.batch != nullptr && !recycled.batch->Compatible(config_, gestureCount_))) {
+            throw std::logic_error("recycled local parameter slot identity is invalid");
+        }
+        recycled.parameter->ResetLocalForReuse(id, std::move(config));
+        ++liveLocalParameterCount_;
+        RequestParameterStorageBatchIfLow();
+        return *recycled.parameter;
+    }
+
     if (parameterCount_ < config_.maxParameters) {
         auto parameter = std::make_unique<Parameter>(id, *this, std::move(config), parameterCount_);
         Parameter& result = *parameter;
         parameters_.push_back(std::move(parameter));
         ++parameterCount_;
+        if (id == kLocalParameterId) {
+            ++liveLocalParameterCount_;
+        }
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
+        if (id == kLocalParameterId) {
+            ++liveLocalParameterCount_;
+        }
         RequestParameterStorageBatchIfLow();
         return result;
     }
 
     throw std::length_error("parameter group capacity exhausted");
 }
 
+void ParameterGroup::RecycleLocalParameter(Parameter& parameter) {
+    if (parameter.id_ != kLocalParameterId || parameter.localViewPinCount_ != 0) {
+        throw std::logic_error("only unpinned local parameters can be recycled");
+    }
+    if (liveLocalParameterCount_ == 0) {
+        throw std::logic_error("local parameter accounting underflow");
+    }
+    if (parameter.storageLocalIx_ >= parameterCount_ ||
+        &ParameterByLocalIndex(parameter.storageLocalIx_) != &parameter) {
+        throw std::logic_error("local parameter storage identity is invalid");
+    }
+    recycledLocalSlots_.push_back({
+        .parameter = &parameter,
+        .batch = parameter.storageBatch_,
+        .slotIx = parameter.slotIx_,
+        .storageLocalIx = parameter.storageLocalIx_,
+    });
+    --liveLocalParameterCount_;
+}
+
+std::size_t ParameterGroup::CollectNeutralLocalParameters() {
+    std::size_t collected = 0;
+    for (Parameter* root : topLevelParameters_) {
+        collected += root->CollectNeutralChildren();
+    }
+    return collected;
+}
+
 void ParameterGroup::RegisterTopLevelParameter(Parameter& parameter) {
     topLevelParameters_.push_back(&parameter);
 }
 
 Parameter& ParameterGroup::ParameterByLocalIndex(std::size_t localIx) {
     if (localIx < parameters_.size()) {
         return *parameters_.at(localIx);
     }
     std::size_t remaining = localIx - parameters_.size();
     for (const auto& batch : extraStorageBatches_) {
@@ -577,20 +628,21 @@ void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
             ++processingObserver_->topLevelProcessLiteCalls;
         }
     }
 }
 
 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
       slotIx_(slotIx),
+      storageLocalIx_(group.parameterCount_),
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
@@ -656,21 +708,23 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }
 
 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
                      ParameterStorageBatch& storageBatch, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
+      storageBatch_(&storageBatch),
       slotIx_(slotIx),
+      storageLocalIx_(group.parameterCount_),
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
@@ -733,20 +787,114 @@ Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig conf
     }
     std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
     std::fill(sceneCenters_.begin(), sceneCenters_.end(), currentCenter_);
     std::fill(gestureValues_.begin(), gestureValues_.end(), currentCenter_);
     std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
     SeedCachedKnobAndUiDisplayState();
 }
 
 ParameterStorageBatch::~ParameterStorageBatch() = default;
 
+void Parameter::PinLocalForView() {
+    if (id_ == kLocalParameterId) {
+        ++localViewPinCount_;
+    }
+}
+
+void Parameter::UnpinLocalForView() {
+    if (id_ != kLocalParameterId) {
+        return;
+    }
+    if (localViewPinCount_ == 0) {
+        throw std::logic_error("local parameter view pin underflow");
+    }
+    --localViewPinCount_;
+}
+
+bool Parameter::CanRecycleLocal() const {
+    constexpr float tolerance = 0.000001f;
+    if (id_ != kLocalParameterId || localViewPinCount_ != 0 || activeRouteCount_ != 0 ||
+        HasNonDefaultState() || HasNonZeroState()) {
+        return false;
+    }
+    if (std::any_of(modulationDepths_.begin(), modulationDepths_.end(),
+                    [](const Parameter* child) { return child != nullptr; })) {
+        return false;
+    }
+
+    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+    const auto allNear = [&](std::span<const float> values, float expected) {
+        return std::all_of(values.begin(), values.end(), [&](float value) {
+            return std::fabs(value - expected) <= tolerance;
+        });
+    };
+    return allNear(currentMinValues_, defaultValue) && allNear(targetMinValues_, defaultValue) &&
+           allNear(currentMaxValues_, defaultValue) && allNear(targetMaxValues_, defaultValue) &&
+           allNear(currentKnobValues_, defaultValue) && allNear(uiDisplayCenters_, defaultValue) &&
+           allNear(uiDisplaySpreadEnergies_, 0.0f);
+}
+
+std::size_t Parameter::CollectNeutralChildren() {
+    std::size_t collected = 0;
+    for (std::size_t sourceIx = 0; sourceIx < modulationDepths_.size(); ++sourceIx) {
+        Parameter* child = modulationDepths_[sourceIx];
+        if (child == nullptr) {
+            continue;
+        }
+        collected += child->CollectNeutralChildren();
+        if (!child->CanRecycleLocal()) {
+            continue;
+        }
+
+        modulationDepths_[sourceIx] = nullptr;
+        group_.RecycleLocalParameter(*child);
+        ++collected;
+    }
+    return collected;
+}
+
+void Parameter::ResetLocalForReuse(ParameterId id, ParameterConfig config) {
+    if (id != kLocalParameterId) {
+        throw std::logic_error("recycled parameter slots are local-only");
+    }
+    id_ = id;
+    config_ = std::move(config);
+    recursionDepth_ = 0;
+    localViewPinCount_ = 0;
+    const float defaultValue = ClampToRange(config_.defaultValue, config_.range);
+    currentCenter_ = defaultValue;
+    targetCenter_ = defaultValue;
+    std::fill(currentCenterScales_.begin(), currentCenterScales_.end(), 1.0f);
+    std::fill(targetCenterScales_.begin(), targetCenterScales_.end(), 1.0f);
+    std::fill(currentNormalizationOffsets_.begin(), currentNormalizationOffsets_.end(), 0.0f);
+    std::fill(targetNormalizationOffsets_.begin(), targetNormalizationOffsets_.end(), 0.0f);
+    std::fill(currentMinValues_.begin(), currentMinValues_.end(), defaultValue);
+    std::fill(targetMinValues_.begin(), targetMinValues_.end(), defaultValue);
+    std::fill(currentMaxValues_.begin(), currentMaxValues_.end(), defaultValue);
+    std::fill(targetMaxValues_.begin(), targetMaxValues_.end(), defaultValue);
+    std::fill(currentDepths_.begin(), currentDepths_.end(), 0.0f);
+    std::fill(targetDepths_.begin(), targetDepths_.end(), 0.0f);
+    for (std::size_t sourceIx = 0; sourceIx < routeSourceIndices_.size(); ++sourceIx) {
+        routeSourceIndices_[sourceIx] = sourceIx;
+        sourceRoutePositions_[sourceIx] = sourceIx;
+    }
+    activeRouteCount_ = 0;
+    std::fill(currentKnobValues_.begin(), currentKnobValues_.end(), defaultValue);
+    std::fill(uiDisplayCenters_.begin(), uiDisplayCenters_.end(), defaultValue);
+    std::fill(uiDisplaySpreadEnergies_.begin(), uiDisplaySpreadEnergies_.end(), 0.0f);
+    std::fill(modulationDepths_.begin(), modulationDepths_.end(), nullptr);
+    std::fill(sceneCenters_.begin(), sceneCenters_.end(), defaultValue);
+    std::fill(gestureValues_.begin(), gestureValues_.end(), defaultValue);
+    std::fill(gestureActiveMasks_.begin(), gestureActiveMasks_.end(), 0);
+    AssertRouteBijection();
+}
+
 void Parameter::UIState::Configure(std::size_t newVoiceCapacity, std::size_t newModulatorColorCapacity,
                                    std::size_t newGestureColorCapacity) {
     voiceCapacity = newVoiceCapacity;
     modulatorColorCapacity = newModulatorColorCapacity;
     gestureColorCapacity = newGestureColorCapacity;
     values = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     spreadValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     minValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     maxValues = std::make_unique<std::atomic<float>[]>(voiceCapacity);
     switchValue = std::make_unique<std::atomic<std::size_t>[]>(voiceCapacity);
@@ -2074,22 +2222,34 @@ void Bank::ApplyModifierToTopLevel(Modifier modifier, const SceneState& scene) {
         }
         if (std::find(visited.begin(), visited.end(), cell.parameter) != visited.end()) {
             continue;
         }
         visited.push_back(cell.parameter);
         ApplyModifierToParameter(*cell.parameter, modifier, scene);
     }
 }
 
 void Bank::Deselect() {
-    selected_ = nullptr;
+    ParameterGroup* affectedGroup = selected_ == nullptr ? nullptr : &selected_->Group();
+    if (selected_ != nullptr) {
+        for (const Cell& cell : visible_) {
+            if (cell.parameter != nullptr && cell.parameter != selected_) {
+                cell.parameter->UnpinLocalForView();
+            }
+        }
+        selected_->UnpinLocalForView();
+    }
     visible_ = topLevel_;
+    selected_ = nullptr;
+    if (affectedGroup != nullptr) {
+        affectedGroup->CollectNeutralLocalParameters();
+    }
 }
 
 bool Bank::ShowingModulation() const {
     return selected_ != nullptr;
 }
 
 std::size_t Bank::VisibleMappingCount() const {
     return visible_.size();
 }
 
@@ -2194,55 +2354,73 @@ void Bank::OpenModulationView(Parameter& parameter, std::span<const PhysicalEnco
         throw std::logic_error("modulation view has more modulators than slot depth positions");
     }
 
     const std::size_t missing = MissingModulationDepthCount(parameter);
     const std::size_t available = parameter.Group().AvailableParameterSlots();
     if (available < missing) {
         parameter.Group().RequestParameterStorageBatch(missing - available);
         return;
     }
 
+    if (selected_ != nullptr) {
+        for (const Cell& cell : visible_) {
+            if (cell.parameter != nullptr && cell.parameter != selected_) {
+                cell.parameter->UnpinLocalForView();
+            }
+        }
+        selected_->UnpinLocalForView();
+    }
+
     selected_ = &parameter;
+    selected_->PinLocalForView();
     visible_.clear();
 
     for (std::size_t cellIx = 0; cellIx < modulatorCount; ++cellIx) {
+        Parameter* depthParameter = EnsureModulationDepthParameter(parameter, cellIx);
+        if (depthParameter != nullptr) {
+            depthParameter->PinLocalForView();
+        }
         visible_.push_back({
             .encoderId = physicalLayout[cellIx],
-            .parameter = EnsureModulationDepthParameter(parameter, cellIx),
+            .parameter = depthParameter,
         });
     }
 
     visible_.push_back({
         .encoderId = physicalLayout.back(),
         .parameter = &parameter,
     });
     parameter.Group().RequestParameterStorageBatchIfLow();
 }
 
 void Bank::ApplyModifierToParameter(Parameter& parameter, Modifier modifier, const SceneState& scene) {
     if (manager_ == nullptr) {
         return;
     }
 
+    ParameterGroup* affectedGroup = &parameter.Group();
     switch (modifier) {
     case Modifier::None:
         break;
     case Modifier::Reset:
         parameter.RevertToDefault(scene);
         break;
     case Modifier::Random:
         parameter.RandomizeVisibleValue(scene, manager_->NextRandomValue());
         break;
     case Modifier::RandomMod:
         RandomizeModulationDepths(parameter, scene);
         break;
     }
+    if (modifier == Modifier::Reset) {
+        affectedGroup->CollectNeutralLocalParameters();
+    }
 }
 
 void Bank::RandomizeModulationDepths(Parameter& parameter, const SceneState& scene) {
     if (manager_ == nullptr) {
         return;
     }
 
     const std::size_t modulatorCount = parameter.Group().Config().numModulators;
     if (modulatorCount == 0) {
         return;
@@ -2473,20 +2651,28 @@ bool ParameterManager::LoadParameterValuesFromJSON(JSON json) {
         if (parameter == nullptr) {
             continue;
         }
         parameter->LoadValuesFromJSON(JSON(members[ix].m_value));
     }
 
     ComputeAllParameters();
     return true;
 }
 
+std::size_t ParameterManager::CollectNeutralLocalParameters() {
+    std::size_t collected = 0;
+    for (const auto& group : groups_) {
+        collected += group->CollectNeutralLocalParameters();
+    }
+    return collected;
+}
+
 void ParameterManager::ComputeAllParameters() {
     for (Parameter* parameter : parameters_) {
         if (parameter == nullptr) {
             continue;
         }
         parameter->ComputeAtDepth(scene_, 0, false);
         parameter->SnapCurrentToTarget();
     }
 }
 
@@ -2544,20 +2730,21 @@ void ParameterManager::RevertAllToDefaults() {
         const bool selected = gestureIx < defaultControlState_.gestureSelected.size() &&
                               defaultControlState_.gestureSelected[gestureIx];
         if (selected) {
             SelectGesture(gestureIx);
         } else {
             DeselectGesture(gestureIx);
         }
     }
 
     ComputeAllParameters();
+    CollectNeutralLocalParameters();
 }
 
 float ParameterManager::GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
     return LinearMap(minValue, maxValue, normalized);
 }
 
 float ParameterManager::GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const {
     const float normalized = std::clamp(ParameterById(id).CachedKnobValue(voiceIx), 0.0f, 1.0f);
     return ExponentialMap(minValue, maxValue, normalized);
diff --git a/projects/synth/src/PatchPersistence.cpp b/projects/synth/src/PatchPersistence.cpp
index e0f76629..ea3d7bbf 100644
--- a/projects/synth/src/PatchPersistence.cpp
+++ b/projects/synth/src/PatchPersistence.cpp
@@ -283,21 +283,24 @@ bool LoadPatchJSON(JSON root, ParameterManager& manager,
     (void)audioDevice;
     if (!ValidPatchRoot(root) || !IsString(root.Get("patchName"))) {
         return false;
     }
 
     const JSON parameterValues = root.Get("parameterValues");
     if (!IsObject(parameterValues)) {
         return false;
     }
 
-    manager.LoadParameterValuesFromJSON(parameterValues);
+    if (!manager.LoadParameterValuesFromJSON(parameterValues)) {
+        return false;
+    }
+    manager.CollectNeutralLocalParameters();
     return true;
 }
 
 bool ValidatePatchJSON(JSON root) {
     return ValidPatchRoot(root) && IsString(root.Get("patchName")) && IsObject(root.Get("parameterValues"));
 }
 
 std::string TimestampPatchFilename(std::chrono::system_clock::time_point now) {
     const std::time_t time = std::chrono::system_clock::to_time_t(now);
     std::tm tm{};
diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
index c5aac2c8..98326aeb 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -79,20 +79,73 @@ struct TestVisualizer final : synth::ui::Visualizer {
 };
 
 std::string JsonToString(synth::JSON json) {
     char* dumped = json.Dumps(JSON_ENCODE_ANY);
     REQUIRE_TRUE(dumped != nullptr);
     std::string text(dumped);
     std::free(dumped);
     return text;
 }
 
+bool JsonSemanticallyEqual(synth::JSON left, synth::JSON right) {
+    if (left.IsNull() || right.IsNull()) {
+        return left.IsNull() && right.IsNull();
+    }
+    const synth::JsonType leftType = left.m_node->m_type;
+    const synth::JsonType rightType = right.m_node->m_type;
+    const bool leftNumber = leftType == synth::JsonType::Integer || leftType == synth::JsonType::Real;
+    const bool rightNumber = rightType == synth::JsonType::Integer || rightType == synth::JsonType::Real;
+    if (leftNumber || rightNumber) {
+        return leftNumber && rightNumber && left.NumberValue() == right.NumberValue();
+    }
+    if (leftType != rightType) {
+        return false;
+    }
+
+    switch (leftType) {
+    case synth::JsonType::Null:
+        return true;
+    case synth::JsonType::Object: {
+        if (left.Size() != right.Size()) {
+            return false;
+        }
+        const synth::JsonMember* members =
+            static_cast<const synth::JsonMember*>(left.m_node->m_container.m_entries);
+        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
+            if (members[ix].m_key == nullptr ||
+                !JsonSemanticallyEqual(synth::JSON(members[ix].m_value), right.Get(members[ix].m_key))) {
+                return false;
+            }
+        }
+        return true;
+    }
+    case synth::JsonType::Array:
+        if (left.Size() != right.Size()) {
+            return false;
+        }
+        for (std::size_t ix = 0; ix < left.Size(); ++ix) {
+            if (!JsonSemanticallyEqual(left.GetAt(ix), right.GetAt(ix))) {
+                return false;
+            }
+        }
+        return true;
+    case synth::JsonType::String:
+        return std::string(left.StringValue()) == std::string(right.StringValue());
+    case synth::JsonType::Boolean:
+        return left.BooleanValue() == right.BooleanValue();
+    case synth::JsonType::Integer:
+    case synth::JsonType::Real:
+        return false;
+    }
+    return false;
+}
+
 void RequireRouteBijection(const synth::Parameter& parameter, std::size_t sourceCount);
 
 // Wraps a single WrldBldr-kind MidiControllerProfileConfig (as produced by
 // WrldBldrDefaultProfileConfig, whose system-message associations always
 // carry both a control address and a wrldBldrPosition -- see
 // SlotValidForKind's WrldBldr branch) plus a pair of endpoint identifiers
 // into a one-controller MidiInstrumentConfig, for patch-persistence tests
 // that used to build a bare MidiControllerProfileConfig + MidiEndpointState
 // pair directly. Named "controller" to match MidiControllerSlot's default
 // name so assertions reading loaded.controllers[0] read naturally.
@@ -3629,27 +3682,33 @@ TEST_CASE(modulation_view_lazy_depth_names_include_target_parameter_for_duplicat
     slot.AddPhysicalEncoder(1);
     slot.AddPhysicalEncoder(2);
     slot.SelectBank(&bank);
 
     slot.HandlePress(1);
     slot.HandlePress(2);
     slot.HandlePress(2);
 
     synth::Parameter* firstDepth = first.ModulationDepthParameter(0);
     synth::Parameter* secondDepth = second.ModulationDepthParameter(0);
-    REQUIRE_TRUE(firstDepth != nullptr);
+    REQUIRE_TRUE(firstDepth == nullptr);
     REQUIRE_TRUE(secondDepth != nullptr);
-    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
     REQUIRE_TRUE(secondDepth->Name() == "Carrier B Filter Env");
-    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
     REQUIRE_TRUE(secondDepth->ShortName() == "Env");
-    REQUIRE_TRUE(group.ParameterCount() == 4);
+    const std::size_t highWater = group.ParameterCount();
+
+    bank.Deselect();
+    slot.HandlePress(1);
+    firstDepth = first.ModulationDepthParameter(0);
+    REQUIRE_TRUE(firstDepth != nullptr);
+    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
+    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
     REQUIRE_TRUE(manager.ParameterCount() == 2);
 }
 
 TEST_CASE(pressing_modulation_cell_opens_nested_modulation_view) {
     synth::ParameterManager manager;
     manager.SetGestureCount(2);
     auto& group = manager.CreateGroup({
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
@@ -8427,20 +8486,31 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
             1, {.name = "Cutoff Env", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         auto& lfoCurve = cutoffLfo.EnsureModulationDepth(
             2, {.name = "Cutoff LFO Curve", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         auto& resonanceLfo = resonance.EnsureModulationDepth(
             0, {.name = "Resonance LFO", .defaultValue = 0.5f, .range = synth::RangeKind::Bipolar});
         REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
         manager.SetSceneBlend(0.25f);
         manager.CaptureDefaultControlState();
 
         std::vector<synth::Parameter*> tracked{&cutoff, &resonance, &cutoffLfo, &cutoffEnv, &lfoCurve, &resonanceLfo};
+        auto refreshTrackedTopology = [&] {
+            synth::Parameter* liveCutoffLfo = cutoff.EnsureModulationDepth(0);
+            synth::Parameter* liveCutoffEnv = cutoff.EnsureModulationDepth(1);
+            synth::Parameter* liveResonanceLfo = resonance.EnsureModulationDepth(0);
+            REQUIRE_TRUE(liveCutoffLfo != nullptr);
+            REQUIRE_TRUE(liveCutoffEnv != nullptr);
+            REQUIRE_TRUE(liveResonanceLfo != nullptr);
+            synth::Parameter* liveLfoCurve = liveCutoffLfo->EnsureModulationDepth(2);
+            REQUIRE_TRUE(liveLfoCurve != nullptr);
+            tracked = {&cutoff, &resonance, liveCutoffLfo, liveCutoffEnv, liveLfoCurve, liveResonanceLfo};
+        };
         RecursivePatchSnapshot expected = captureValues(tracked);
         const RecursivePatchSnapshot defaultExpected = expected;
 
         synth::WrldBldrDefaultProfileOptions midiOptions;
         midiOptions.visibleEncoderCount = 5;
         midiOptions.sceneCount = kSimScenes;
         midiOptions.bankButtonCount = 2;
         midiOptions.gestureSelectorCount = kSimGestures;
         const synth::MidiControllerProfileConfig defaultProfile = synth::WrldBldrDefaultProfileConfig(midiOptions);
         const synth::MidiInstrumentConfig defaultInstrument = MakeInstrumentFromProfile(defaultProfile);
@@ -8460,20 +8530,21 @@ TEST_CASE(randomized_patch_lifecycle_preserves_recursive_local_modulation_depths
         auto processPatchMessages = [&] {
             synth::PatchMessageIn message;
             while (inputBus.Pop(message)) {
                 const synth::PatchApplyStatus status =
                     synth::ApplyPatchMessage(message, manager, instrument, defaultInstrument,
                                              audioDevice, defaultAudioDevice, outputBus);
                 REQUIRE_TRUE(status == synth::PatchApplyStatus::Applied ||
                              status == synth::PatchApplyStatus::Reverted ||
                              status == synth::PatchApplyStatus::Serialized);
             }
+            refreshTrackedTopology();
         };
 
         auto completePendingSave = [&](const RecursivePatchSnapshot& snapshot) {
             processPatchMessages();
             const auto now = std::chrono::system_clock::from_time_t(1700005000 + writeCounter++);
             const synth::PatchCommandResult completion = patchManager.ProcessResponses(now);
             REQUIRE_TRUE(completion.status == synth::PatchCommandStatus::Written);
             savedVersions.push_back({completion.path, snapshot});
             expectedCurrentPatchDir = completion.path.parent_path();
         };
@@ -11003,20 +11074,410 @@ TEST_CASE(active_modulation_routes_randomized_full_scan_oracle_and_work_bound) {
         REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
         manager.SetSceneBlend(static_cast<float>(step % 5) * 0.25f);
         manager.ComputeAllTargets();
         const std::size_t visitsBefore = work.activeRouteVisits;
         carrier.ProcessLite();
         REQUIRE_TRUE(work.activeRouteVisits - visitsBefore == carrier.ActiveRouteCount() * 2);
         RequireFullScanCurrentMatch(carrier);
     }
 }
 
+TEST_CASE(neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 2,
+                                       .numScenes = 1,
+                                       .maxParameters = 5});
+    group.GetModulators().Metadata(0) = {.name = "Old", .shortName = "Old", .sourceColor = synth::Color::Red};
+    group.GetModulators().Metadata(1) = {.name = "New", .shortName = "New", .sourceColor = synth::Color::Cyan};
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .shortName = "Car", .defaultValue = 0.4f});
+    auto& other = manager.CreateParameter(group, {.name = "Other", .shortName = "Oth", .defaultValue = 0.6f});
+    synth::Parameter* oldLocal = &carrier.EnsureModulationDepth(
+        0, {.name = "Old Local",
+            .shortName = "Old",
+            .defaultValue = 0.5f,
+            .range = synth::RangeKind::Bipolar,
+            .switchValues = 7,
+            .baseColor = synth::Color::Red,
+            .indicatorColors = {synth::Color::Orange}});
+    REQUIRE_TRUE(oldLocal != nullptr);
+    const synth::Parameter* carrierAddress = &carrier;
+    const synth::Parameter* otherAddress = &other;
+    const std::size_t recycledStorageIx = group.ParameterCount() - 1;
+    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == oldLocal);
+
+    const std::size_t highWater = group.ParameterCount();
+    const std::size_t availableBefore = group.AvailableParameterSlots();
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+    REQUIRE_TRUE(group.AvailableParameterSlots() == availableBefore + 1);
+
+    synth::Parameter* reused = other.EnsureModulationDepth(1);
+    REQUIRE_TRUE(reused != nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 1);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 0);
+    REQUIRE_TRUE(&carrier == carrierAddress);
+    REQUIRE_TRUE(&other == otherAddress);
+    REQUIRE_TRUE(&group.ParameterByLocalIndex(recycledStorageIx) == reused);
+    REQUIRE_TRUE(reused->Name() == "Other New");
+    REQUIRE_TRUE(reused->ShortName() == "New");
+    REQUIRE_TRUE(reused->BaseColor() == synth::Color::Cyan);
+    REQUIRE_TRUE(reused->Range() == synth::RangeKind::Bipolar);
+    REQUIRE_TRUE(reused->SwitchValues() == 0);
+    REQUIRE_NEAR(reused->SceneCenter(0), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentCenter(), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetCenter(), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentCenterScale(0), 1.0f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetCenterScale(0), 1.0f, 0.000001f);
+    REQUIRE_NEAR(reused->CurrentNormalizationOffset(0), 0.0f, 0.000001f);
+    REQUIRE_NEAR(reused->TargetNormalizationOffset(0), 0.0f, 0.000001f);
+    REQUIRE_TRUE(reused->ActiveRouteCount() == 0);
+    REQUIRE_TRUE(reused->RouteSourceIndex(0) == 0);
+    REQUIRE_TRUE(reused->RouteSourceIndex(1) == 1);
+    REQUIRE_TRUE(reused->ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(reused->ModulationDepthParameter(1) == nullptr);
+    REQUIRE_NEAR(reused->GestureValue(0, 32), 0.5f, 0.000001f);
+    REQUIRE_NEAR(reused->GestureValue(0, 63), 0.5f, 0.000001f);
+    REQUIRE_TRUE(!reused->GestureActive(0, 32));
+    REQUIRE_TRUE(!reused->GestureActive(0, 63));
+    synth::Parameter::UIState ui(1, 2, 64);
+    reused->PopulateUIState(ui);
+    REQUIRE_NEAR(ui.values[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.spreadValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.minValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_NEAR(ui.maxValues[0].load(), 0.0f, 0.000001f);
+    REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == 0);
+    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == 0);
+}
+
+TEST_CASE(neutral_local_collection_retains_non_default_scene_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 2, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(1) = 0.6f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_inactive_latent_gesture_value) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->GestureValue(0, 63) = 0.6f;
+    REQUIRE_TRUE(!depth->GestureActive(0, 63));
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_active_gesture_at_default_value) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SetGestureActive(0, 32, true);
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_unsnapped_runtime_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 2,
+                                       .targetCenterAlpha = 1.0f});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    depth->SceneCenter(0) = 0.5f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+}
+
+TEST_CASE(neutral_local_collection_retains_nonzero_normalization_state) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 3,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Value(0, 0) = 1.0f;
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(0);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->SceneCenter(0) = 0.25f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(depth->CurrentNormalizationOffset(0) > 0.0f);
+    REQUIRE_TRUE(depth->TargetNormalizationOffset(0) > 0.0f);
+
+    depth->ClearModulationDepths();
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+
+    REQUIRE_TRUE(depth->AssignModulationDepth(0, nested));
+    depth->RevertAllToDefault();
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+}
+
+TEST_CASE(neutral_local_collection_retains_parent_with_non_collectible_child) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    auto* nested = depth->EnsureModulationDepth(1);
+    REQUIRE_TRUE(nested != nullptr);
+    nested->GestureValue(0, 0) = 0.6f;
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == depth);
+    REQUIRE_TRUE(depth->ModulationDepthParameter(1) == nested);
+}
+
+TEST_CASE(neutral_local_collection_collapses_recursive_subtree_bottom_up) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    REQUIRE_TRUE(depth->EnsureModulationDepth(1) != nullptr);
+    const std::size_t highWater = group.ParameterCount();
+
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 2);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.ParameterCount() == highWater);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+}
+
+TEST_CASE(neutral_local_collection_detaches_child_while_parent_route_finishes_settling) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 1,
+                                       .numScenes = 1,
+                                       .maxParameters = 2,
+                                       .processLiteAlpha = 0.5f,
+                                       .targetCenterAlpha = 1.0f});
+    group.GetModulators().Value(0, 0) = 1.0f;
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    manager.ComputeAllParameters();
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
+
+    depth->SceneCenter(0) = 0.5f;
+    manager.ComputeAllTargets();
+    REQUIRE_NEAR(carrier.TargetDepthForSource(0, 0), 0.0f, 0.000001f);
+    REQUIRE_TRUE(std::fabs(carrier.CurrentDepthForSource(0, 0)) > 0.000001f);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 1);
+
+    for (std::size_t step = 0; step < 32 && carrier.ActiveRouteCount() != 0; ++step) {
+        carrier.ProcessLite();
+        manager.ComputeAllTargets();
+    }
+    REQUIRE_TRUE(carrier.ActiveRouteCount() == 0);
+    REQUIRE_NEAR(carrier.CurrentDepthForSource(0, 0), 0.0f, 0.000001f);
+}
+
+TEST_CASE(modulation_view_pins_visible_locals_until_deselect_boundary) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 3});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, carrier);
+    auto& slot = manager.CreateBankSlot();
+    slot.AddPhysicalEncoder(10);
+    slot.AddPhysicalEncoder(11);
+    slot.AddPhysicalEncoder(12);
+    slot.SelectBank(&bank);
+
+    slot.HandlePress(10);
+    REQUIRE_TRUE(bank.ShowingModulation());
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 2);
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == bank.VisibleParameter(10));
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == bank.VisibleParameter(11));
+
+    bank.Deselect();
+    REQUIRE_TRUE(!bank.ShowingModulation());
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 2);
+}
+
+TEST_CASE(revert_all_collects_neutral_local_topology_at_control_boundary) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
+    manager.CaptureDefaultControlState();
+    auto* depth = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+
+    manager.RevertAllToDefaults();
+
+    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(neutral_local_reuse_stays_bounded_beyond_configured_capacity) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 1, .numScenes = 1, .maxParameters = 2});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 1));
+
+    for (std::size_t iteration = 0; iteration < group.Config().maxParameters * 4; ++iteration) {
+        synth::Parameter& parent = (iteration & 1U) == 0 ? first : second;
+        REQUIRE_TRUE(parent.EnsureModulationDepth(0) != nullptr);
+        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+        REQUIRE_TRUE(parent.ModulationDepthParameter(0) == nullptr);
+    }
+    REQUIRE_TRUE(group.ParameterCount() == 3);
+    REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(randomized_neutral_local_collection_reuses_slots_without_stale_topology) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(64);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 2, .maxParameters = 5});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.5f});
+    std::array<synth::Parameter*, 3> parents = {&first, &second, &third};
+    std::mt19937 random(0x74c011ecU);
+
+    for (std::size_t step = 0; step < 128; ++step) {
+        synth::Parameter& parent = *parents[random() % parents.size()];
+        const std::size_t sourceIx = random() % 2;
+        synth::Parameter* local = parent.EnsureModulationDepth(sourceIx);
+        REQUIRE_TRUE(local != nullptr);
+        if ((random() & 3U) == 0) {
+            local->GestureValue(1, 63) = 0.75f;
+            REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0);
+            REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == local);
+            local->RevertAllToDefault();
+        }
+        REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+        REQUIRE_TRUE(parent.ModulationDepthParameter(sourceIx) == nullptr);
+        REQUIRE_TRUE(group.LiveLocalParameterCount() == 0);
+        REQUIRE_TRUE(group.ParameterCount() <= 4);
+    }
+    REQUIRE_TRUE(group.FreeLocalParameterSlotCount() == 1);
+}
+
+TEST_CASE(patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions) {
+    synth::ParameterManager source;
+    source.SetGestureCount(64);
+    auto& sourceGroup = source.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
+    auto& sourceCarrier = source.CreateParameter(sourceGroup, {.name = "Carrier", .defaultValue = 0.25f});
+    auto* sourceDepth = sourceCarrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(sourceDepth != nullptr);
+    auto* sourceNested = sourceDepth->EnsureModulationDepth(1);
+    REQUIRE_TRUE(sourceNested != nullptr);
+    sourceDepth->GestureValue(0, 32) = 0.7f;
+    sourceDepth->SetGestureActive(0, 32, true);
+    sourceNested->GestureValue(0, 63) = 0.8f;
+    sourceNested->SetGestureActive(0, 63, true);
+
+    synth::JsonArena patchArena(262144);
+    synth::MidiInstrumentConfig instrument;
+    synth::AudioDeviceState audio;
+    synth::JSON patch = synth::BuildPatchJSON(patchArena, "GC", source, instrument, audio);
+    REQUIRE_TRUE(!patchArena.Failed());
+
+    synth::ParameterManager target;
+    target.SetGestureCount(64);
+    auto& targetGroup = target.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 5});
+    auto& targetCarrier = target.CreateParameter(targetGroup, {.name = "Carrier", .defaultValue = 0.25f});
+    REQUIRE_TRUE(targetCarrier.EnsureModulationDepth(1) != nullptr);  // absent/default dirty topology
+    REQUIRE_TRUE(synth::LoadPatchJSON(patch, target, instrument, &audio));
+
+    auto* targetDepth = targetCarrier.ModulationDepthParameter(0);
+    REQUIRE_TRUE(targetDepth != nullptr);
+    auto* targetNested = targetDepth->ModulationDepthParameter(1);
+    REQUIRE_TRUE(targetNested != nullptr);
+    REQUIRE_NEAR(targetDepth->GestureValue(0, 32), 0.7f, 0.000001f);
+    REQUIRE_TRUE(targetDepth->GestureActive(0, 32));
+    REQUIRE_NEAR(targetNested->GestureValue(0, 63), 0.8f, 0.000001f);
+    REQUIRE_TRUE(targetNested->GestureActive(0, 63));
+    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
+
+    const float outputBeforeRematerialization = targetCarrier.GetRaw(0);
+    synth::Parameter* rematerialized = targetCarrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(rematerialized != nullptr);
+    target.ComputeAllParameters();
+    REQUIRE_NEAR(targetCarrier.GetRaw(0), outputBeforeRematerialization, 0.000001f);
+    REQUIRE_TRUE(rematerialized->Name() == "Carrier Mod Depth 2");
+    REQUIRE_NEAR(rematerialized->SceneCenter(0), 0.5f, 0.000001f);
+    REQUIRE_NEAR(rematerialized->GestureValue(0, 32), 0.5f, 0.000001f);
+    REQUIRE_NEAR(rematerialized->GestureValue(0, 63), 0.5f, 0.000001f);
+    REQUIRE_TRUE(!rematerialized->GestureActive(0, 32));
+    REQUIRE_TRUE(!rematerialized->GestureActive(0, 63));
+    REQUIRE_TRUE(rematerialized->ActiveRouteCount() == 0);
+    REQUIRE_TRUE(targetGroup.CollectNeutralLocalParameters() == 1);
+    REQUIRE_TRUE(targetCarrier.ModulationDepthParameter(1) == nullptr);
+    REQUIRE_TRUE(targetGroup.LiveLocalParameterCount() == 2);
+}
+
+TEST_CASE(eligible_collection_preserves_semantic_parameter_json) {
+    synth::ParameterManager manager;
+    manager.SetGestureCount(1);
+    auto& group = manager.CreateGroup({.numVoices = 1, .numModulators = 2, .numScenes = 1, .maxParameters = 4});
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.25f});
+    auto* neutral = carrier.EnsureModulationDepth(0);
+    REQUIRE_TRUE(neutral != nullptr);
+    auto* retained = carrier.EnsureModulationDepth(1);
+    REQUIRE_TRUE(retained != nullptr);
+    retained->GestureValue(0, 0) = 0.75f;
+
+    synth::JsonArena beforeArena(65536);
+    const synth::JSON before = manager.ParameterValuesToJSON(beforeArena);
+    REQUIRE_TRUE(!beforeArena.Failed());
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 1);
+    synth::JsonArena afterArena(65536);
+    const synth::JSON after = manager.ParameterValuesToJSON(afterArena);
+    REQUIRE_TRUE(!afterArena.Failed());
+    REQUIRE_TRUE(JsonSemanticallyEqual(before, after));
+}
+
 namespace {
 
 // Regression for slog-2: MidiSender's worker thread (Run()) must tag itself
 // with ThreadId::MidiSender so log messages produced while sending (and any
 // future thread-identity-sensitive code on that thread) observe the correct
 // identity. This sink records synth::GetCurrentThreadId() as observed from
 // inside Send(), which runs on the sender's worker thread.
 struct RecordingMidiOutputSink final : synth::IMidiOutputSink {
     std::mutex mutex;
     std::optional<synth::ThreadId> observedThreadId;
