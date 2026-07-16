# Review package: 2a5a51f187fcc1bdc2995eb6172e7b6abb128b74..cc52c4c9384484a562d968d5a3d155ca977d7567

## Commits
cc52c4c9 perf(synth): process only top-level parameters per sample

## Files changed
 .../synth/include/synth/ParameterModulation.hpp    | 11 +++++
 projects/synth/src/ParameterModulation.cpp         | 16 +++++++-
 projects/synth/tests/braid4_system_tests.cpp       | 31 ++++++++++++++
 .../synth/tests/parameter_modulation_tests.cpp     | 48 ++++++++++++++++++++++
 4 files changed, 104 insertions(+), 2 deletions(-)

## Diff
diff --git a/projects/synth/include/synth/ParameterModulation.hpp b/projects/synth/include/synth/ParameterModulation.hpp
index b474352b..72054230 100644
--- a/projects/synth/include/synth/ParameterModulation.hpp
+++ b/projects/synth/include/synth/ParameterModulation.hpp
@@ -135,20 +135,27 @@ inline constexpr float kDefaultUiDisplaySpreadAlpha = 0.0013089969f;  // about 1
 float ConvertOnePoleAlpha(float referenceAlpha, double referenceRate, double processingRate);
 std::size_t ConvertSampleInterval(std::size_t referenceInterval, double referenceRate, double processingRate);
 
 struct ParameterProcessingTiming {
     float processLiteAlpha;
     std::size_t targetComputeIntervalSamples;
     float uiDisplayCenterAlpha;
     float uiDisplaySpreadAlpha;
 };
 
+struct ParameterProcessingObserver {
+    std::size_t topLevelProcessLiteCalls = 0;
+    std::size_t localRecursiveComputeCalls = 0;
+    std::size_t activeRouteVisits = 0;
+    std::size_t activeGestureVisits = 0;
+};
+
 struct ParameterGroupConfig {
     std::size_t numVoices = 0;
     std::size_t numModulators = 0;
     std::size_t numScenes = 0;
     std::size_t maxParameters = 0;
     float processLiteAlpha = kDefaultProcessLiteAlpha;
     float targetCenterAlpha = kDefaultTargetCenterAlpha;
     std::size_t targetComputeIntervalSamples = kDefaultTargetComputeIntervalSamples;
     float uiDisplayCenterAlpha = kDefaultUiDisplayCenterAlpha;
     float uiDisplaySpreadAlpha = kDefaultUiDisplaySpreadAlpha;
@@ -294,38 +301,42 @@ public:
                              ModulatorMetadata metadata);
     void UpdateModValues();
     void SelectGesture(std::size_t gestureIx);
     void DeselectGesture(std::size_t gestureIx);
     bool GestureSelected(std::size_t gestureIx) const;
     void SetGestureValue(std::size_t gestureIx, float value);
     float GestureValue(std::size_t gestureIx) const;
     void ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx);
     void ConfigureProcessingTiming(const ParameterProcessingTiming& timing);
     void ProcessSample(std::uint64_t sampleIndex);
+    void SetProcessingObserverForTests(ParameterProcessingObserver* observer) { processingObserver_ = observer; }
 
 private:
     friend class Parameter;
     friend class ParameterManager;
     friend class Bank;
 
     Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
+    void RegisterTopLevelParameter(Parameter& parameter);
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
+    std::vector<Parameter*> topLevelParameters_;
+    ParameterProcessingObserver* processingObserver_ = nullptr;
     std::vector<std::unique_ptr<Parameter>> parameters_;
     std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
     bool storageRequestPending_ = false;
     std::vector<float> currentCenterScaleArena_;
     std::vector<float> targetCenterScaleArena_;
     std::vector<float> currentNormalizationOffsetArena_;
     std::vector<float> targetNormalizationOffsetArena_;
     std::vector<float> currentMinValueArena_;
     std::vector<float> targetMinValueArena_;
     std::vector<float> currentMaxValueArena_;
diff --git a/projects/synth/src/ParameterModulation.cpp b/projects/synth/src/ParameterModulation.cpp
index 216cf708..926afb28 100644
--- a/projects/synth/src/ParameterModulation.cpp
+++ b/projects/synth/src/ParameterModulation.cpp
@@ -368,20 +368,21 @@ void Gestures::CheckIndex(std::size_t gestureIx) const {
     }
 }
 
 ParameterGroup::ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount)
     : config_(ValidateConfig(config)),
       manager_(&manager),
       gestureCount_(gestureCount),
       modulators_(config.numVoices, config.numModulators),
       parameterCount_(0) {
     parameters_.reserve(config_.maxParameters);
+    topLevelParameters_.reserve(config_.maxParameters);
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
@@ -443,20 +444,24 @@ Parameter& ParameterGroup::CreateLocalParameter(ParameterConfig config, Paramete
         Parameter& result = *parameter;
         batch->parameters.push_back(std::move(parameter));
         ++parameterCount_;
         RequestParameterStorageBatchIfLow();
         return result;
     }
 
     throw std::length_error("parameter group capacity exhausted");
 }
 
+void ParameterGroup::RegisterTopLevelParameter(Parameter& parameter) {
+    topLevelParameters_.push_back(&parameter);
+}
+
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
@@ -509,22 +514,25 @@ void ParameterGroup::UpdateModValues() {
 
 void ParameterGroup::ConfigureProcessingTiming(const ParameterProcessingTiming& timing) {
     ValidateProcessingTiming(timing);
     config_.processLiteAlpha = timing.processLiteAlpha;
     config_.targetComputeIntervalSamples = timing.targetComputeIntervalSamples;
     config_.uiDisplayCenterAlpha = timing.uiDisplayCenterAlpha;
     config_.uiDisplaySpreadAlpha = timing.uiDisplaySpreadAlpha;
 }
 
 void ParameterGroup::ProcessSample(std::uint64_t sampleIndex) {
-    for (std::size_t localIx = 0; localIx < parameterCount_; ++localIx) {
-        ParameterByLocalIndex(localIx).ProcessSample(sampleIndex);
+    for (Parameter* parameter : topLevelParameters_) {
+        parameter->ProcessSample(sampleIndex);
+        if (processingObserver_ != nullptr) {
+            ++processingObserver_->topLevelProcessLiteCalls;
+        }
     }
 }
 
 Parameter::Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx)
     : id_(id),
       group_(group),
       config_(std::move(config)),
       slotIx_(slotIx),
       currentCenter_(ClampToRange(config_.defaultValue, config_.range)),
       targetCenter_(currentCenter_),
@@ -1396,20 +1404,23 @@ float Parameter::ComputeRawCenter(const SceneState& scene) const {
     }
 
     if (activeWeightSum == 0.0f) {
         return base;
     }
     return weightedMixSum / activeWeightSum;
 }
 
 void Parameter::ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth, bool smoothTargetCenter) {
     recursionDepth_ = recursionDepth;
+    if (recursionDepth > 0 && group_.processingObserver_ != nullptr) {
+        ++group_.processingObserver_->localRecursiveComputeCalls;
+    }
     const float rawCenter = ClampToRange(ComputeRawCenter(scene), config_.range);
     if (smoothTargetCenter && recursionDepth == 0) {
         const float alpha = group_.Config().targetCenterAlpha;
         targetCenter_ += alpha * (rawCenter - targetCenter_);
         targetCenter_ = ClampToRange(targetCenter_, config_.range);
     } else {
         targetCenter_ = rawCenter;
     }
 
     for (Parameter* depthParameter : modulationDepths_) {
@@ -2166,20 +2177,21 @@ ParameterId ParameterManager::RegisterParameter(ParameterGroup& group, Parameter
     if (parameters_.size() >= static_cast<std::size_t>(kLocalParameterId)) {
         throw std::overflow_error("parameter ID space exhausted");
     }
 
     const ParameterId id = static_cast<ParameterId>(parameters_.size());
     const std::string name = config.name;
     Parameter& created = group.CreateLocalParameter(std::move(config), id);
     Parameter* result = &created;
     parameters_.push_back(result);
     parameterNames_.push_back(name);
+    group.RegisterTopLevelParameter(created);
     return id;
 }
 
 Parameter& ParameterManager::CreateParameter(ParameterGroup& group, ParameterConfig config) {
     return ParameterById(RegisterParameter(group, std::move(config)));
 }
 
 Parameter& ParameterManager::ParameterById(ParameterId id) {
     return *parameters_.at(static_cast<std::size_t>(id));
 }
diff --git a/projects/synth/tests/braid4_system_tests.cpp b/projects/synth/tests/braid4_system_tests.cpp
index 184b4e2a..3d62aa38 100644
--- a/projects/synth/tests/braid4_system_tests.cpp
+++ b/projects/synth/tests/braid4_system_tests.cpp
@@ -433,20 +433,51 @@ TEST_CASE(braid_and_matrix_banks_expose_required_encoder_cells) {
     }
 
     REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
     REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
     REQUIRE_TRUE(core.LfoModule().Parameters().pmIndex[0] == core.MonoGroup()->ParameterByLocalIndex(24).Id());
     REQUIRE_TRUE(core.LfoModule().Parameters().frequency[3] == core.MonoGroup()->ParameterByLocalIndex(31).Id());
     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(32).Id());
     REQUIRE_TRUE(core.LfoMatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(47).Id());
 }
 
+TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
+    synth_rig::SynthRig<synth_braid4::Braid4Core> rig(
+        64,
+        UseScratchRuntimeDataPaths("braid4_parameter_processing_ignores_materialized_local_depths"));
+    auto& core = rig.Engine().Application();
+    const std::array<synth::ParameterGroup*, 3> groups{
+        core.StereoGroup(),
+        core.QuadGroup(),
+        core.MonoGroup(),
+    };
+
+    std::size_t rootCount = 0;
+    std::array<synth::ParameterProcessingObserver, 3> work{};
+    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
+        synth::ParameterGroup& group = *groups[groupIx];
+        rootCount += group.ParameterCount();
+        REQUIRE_TRUE(group.ParameterByLocalIndex(0).EnsureModulationDepth(0) != nullptr);
+        group.SetProcessingObserverForTests(&work[groupIx]);
+    }
+
+    REQUIRE_TRUE(rootCount == rig.Engine().Manager().ParameterCount());
+    for (synth::ParameterGroup* group : groups) {
+        group->ProcessSample(1);
+    }
+
+    const std::size_t visited = work[0].topLevelProcessLiteCalls +
+                                work[1].topLevelProcessLiteCalls +
+                                work[2].topLevelProcessLiteCalls;
+    REQUIRE_TRUE(visited == rootCount);
+}
+
 TEST_CASE(braid_palette_roles_propagate_from_literal_configuration) {
     synth::ParameterManager manager;
     synth::MessageInBus uiBus(&manager);
     synth::MidiInstrumentConfig instrument;
     synth::RuntimeConfig config = synth_braid4::Braid4::Config();
     synth::AppContext context;
     context.parameterManager = &manager;
     context.uiBus = &uiBus;
     context.instrument = &instrument;
     context.config = &config;
diff --git a/projects/synth/tests/parameter_modulation_tests.cpp b/projects/synth/tests/parameter_modulation_tests.cpp
index 9c7c98e9..597702eb 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -1696,20 +1696,68 @@ TEST_CASE(parameter_group_process_sample_covers_top_level_and_modulation_depth_t
     depth->SceneCenter(0) = 0.75f;
 
     group.ProcessSample(0);
 
     REQUIRE_NEAR(carrier.TargetCenter(), 0.2f, 0.0001f);
     REQUIRE_NEAR(sibling.TargetCenter(), 0.4f, 0.0001f);
     REQUIRE_NEAR(depth->TargetCenter(), 0.75f, 0.0001f);
     REQUIRE_NEAR(carrier.CurrentDepths(0)[0], 0.25f, 0.0001f);
 }
 
+TEST_CASE(group_process_sample_visits_only_registered_roots) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numModulators = 2,
+        .numScenes = 1,
+        .maxParameters = 8,
+        .targetComputeIntervalSamples = 16,
+    });
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
+    (void)manager.CreateParameter(group, {.name = "Tone"});
+    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
+    (void)depth.EnsureModulationDepth(1, {.name = "Carrier M1 M2", .defaultValue = 0.5f});
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    group.ProcessSample(1);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 2);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 0);
+
+    group.ProcessSample(16);
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 4);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 2);
+}
+
+TEST_CASE(recursive_local_compute_seeds_display_without_audio_rate_processing) {
+    synth::ParameterManager manager;
+    auto& group = manager.CreateGroup({
+        .numVoices = 1,
+        .numModulators = 1,
+        .numScenes = 1,
+        .maxParameters = 4,
+        .targetComputeIntervalSamples = 16,
+    });
+    auto& carrier = manager.CreateParameter(group, {.name = "Carrier"});
+    auto& depth = carrier.EnsureModulationDepth(0, {.name = "Carrier M1", .defaultValue = 0.5f});
+    depth.SceneCenter(0) = 0.75f;
+    synth::ParameterProcessingObserver work{};
+    group.SetProcessingObserverForTests(&work);
+
+    group.ProcessSample(16);
+
+    REQUIRE_TRUE(work.topLevelProcessLiteCalls == 1);
+    REQUIRE_TRUE(work.localRecursiveComputeCalls == 1);
+    REQUIRE_NEAR(depth.UIDisplayCenter(0), depth.GetRaw(0), 0.000001f);
+    REQUIRE_NEAR(depth.UIDisplaySpread(0), 0.0f, 0.000001f);
+}
+
 TEST_CASE(mapping_helpers_use_cached_process_lite_knob_value) {
     synth::ParameterManager manager;
     synth::ParameterGroupConfig config{
         .numVoices = 1,
         .numModulators = 1,
         .numScenes = 1,
         .maxParameters = 4,
         .processLiteAlpha = 1.0f,
         .targetCenterAlpha = 1.0f,
     };
