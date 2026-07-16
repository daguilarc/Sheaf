# Review package: 5115cdf9..5d0bc6fb

## Commits
5d0bc6fb test(synth): cover sparse modulation lifecycle end to end

## Files changed
 projects/synth/tests/instrument_tests.cpp          |  47 +++
 .../synth/tests/parameter_modulation_tests.cpp     | 452 ++++++++++++++++++---
 projects/synth/tests/portable_ui_tests.cpp         |  16 +-
 3 files changed, 449 insertions(+), 66 deletions(-)

## Diff
diff --git a/projects/synth/tests/instrument_tests.cpp b/projects/synth/tests/instrument_tests.cpp
index b9525422..c13dc797 100644
--- a/projects/synth/tests/instrument_tests.cpp
+++ b/projects/synth/tests/instrument_tests.cpp
@@ -1,20 +1,21 @@
 #include "synth/MidiController.hpp"
 
 #ifdef JUCE_MAJOR_VERSION
 #error "synth module tests must not see JUCE headers"
 #endif
 
 #include <iostream>
 #include <sstream>
 #include <stdexcept>
 #include <string>
+#include <type_traits>
 #include <vector>
 
 namespace {
 
 struct TestCase {
     const char* name;
     void (*fn)();
 };
 
 std::vector<TestCase>& Registry() {
@@ -122,20 +123,66 @@ TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
     const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
     const synth::JSON json = synth::ToJSON(arena, source);
     synth::MessageIn target;
     REQUIRE_TRUE(synth::FromJSON(json, target));
     REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
     REQUIRE_TRUE(target.gestureIx == 63);
     REQUIRE_TRUE(target.boolValue);
     REQUIRE_TRUE(target.hasBoolValue);
 }
 
+TEST_CASE(ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit) {
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
+    auto& parameter = manager.CreateParameter(group, {.name = "High Gesture", .defaultValue = 0.25f});
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(77, parameter);
+    auto& slot = manager.CreateBankSlot();
+    slot.AddPhysicalEncoder(77);
+    slot.SelectBank(&bank);
+
+    synth::MessageInBus bus(&manager, 16);
+    synth::SystemButtonMidiInConfig buttonConfig;
+    buttonConfig.associations.push_back({
+        .control = synth::MidiControlAddress{.channel = 2, .cc = 9},
+        .press = synth::MessageIn::SetGestureSelect(0, 63, true),
+        .release = synth::MessageIn::SetGestureSelect(0, 63, false),
+    });
+    synth::SystemButtonMidiInProcessor buttons(buttonConfig, &bus);
+    buttons.SetTimestampProvider([] { return 41; });
+    buttons.Process(synth::BasicMidi::CC(0, 2, 9, 127));
+    bus.Process(41);
+    REQUIRE_TRUE(manager.GestureSelected(63));
+
+    synth::AnalogMidiInConfig analogConfig;
+    analogConfig.gestures.push_back({.control = {.channel = 2, .cc = 10}, .gestureIx = 63});
+    synth::AnalogMidiInProcessor analog(analogConfig, &bus);
+    analog.SetTimestampProvider([] { return 42; });
+    analog.Process(synth::BasicMidi::CC(0, 2, 10, 127));
+    bus.Process(42);
+    REQUIRE_TRUE(manager.GestureValue(63) == 1.0f);
+
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(43, 0, 0, 0.1f)));
+    bus.Process(43); // first turn arms the selected gesture
+    REQUIRE_TRUE(parameter.GestureActive(0, 63));
+    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(44, 0, 0, 0.1f)));
+    bus.Process(44); // second turn edits that same active manager gesture
+    REQUIRE_TRUE(parameter.GestureValue(0, 63) > 0.25f);
+
+    auto ui = manager.CreateUIState();
+    manager.PopulateUIState(*ui);
+    static_assert(std::is_same_v<decltype(ui->gestures.bankAffectingMask[0].load()), std::uint32_t>);
+    REQUIRE_TRUE(ui->gestures.bankAffectingMask[63].load() == 1u);
+    REQUIRE_TRUE(ui->gestures.bankAffectingCount[63].load() == 1);
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
index 98326aeb..d0e6fdda 100644
--- a/projects/synth/tests/parameter_modulation_tests.cpp
+++ b/projects/synth/tests/parameter_modulation_tests.cpp
@@ -6175,72 +6175,87 @@ TEST_CASE(clear_gesture_active_flags_for_active_scene_selection) {
     REQUIRE_TRUE(first.GestureActive(2, 0));
     REQUIRE_TRUE(!second.GestureActive(0, 0));
     REQUIRE_TRUE(!second.GestureActive(1, 0));
 }
 
 namespace {
 
 constexpr std::size_t kSimParams = 3;
 constexpr std::size_t kSimVoices = 4;
 constexpr std::size_t kSimMods = 3;
-constexpr std::size_t kSimGestures = 2;
+constexpr std::size_t kSimGestures = 64;
 constexpr std::size_t kSimScenes = 3;
 constexpr std::array<synth::PhysicalEncoderId, 5> kSimSlotEncoders{10, 11, 12, 20, 21};
 
 struct SimCell {
     synth::PhysicalEncoderId encoder = 0;
     int parameter = -1;
 };
 
 struct SimBank {
     std::vector<SimCell> top;
     std::vector<SimCell> visible;
     int selectedParameter = -1;
 };
 
 struct SimParam {
     synth::RangeKind range = synth::RangeKind::Unipolar;
     float defaultValue = 0.0f;
     std::size_t switchValues = 0;
     std::array<float, kSimScenes> sceneCenter{};
     std::array<std::array<float, kSimGestures>, kSimScenes> gestureValue{};
-    std::array<std::array<bool, kSimGestures>, kSimScenes> gestureActive{};
+    std::array<synth::GestureMask, kSimScenes> gestureActiveMasks{};
     std::array<int, kSimMods> route{};
+    std::array<std::size_t, kSimMods> routeSourceIndices{};
+    std::array<std::size_t, kSimMods> sourceRoutePositions{};
+    std::size_t activeRouteCount = 0;
     float currentCenter = 0.0f;
     float targetCenter = 0.0f;
     std::array<float, kSimVoices> currentCenterScale{};
     std::array<float, kSimVoices> targetCenterScale{};
     std::array<float, kSimVoices> currentNormalizationOffset{};
     std::array<float, kSimVoices> targetNormalizationOffset{};
     std::array<float, kSimVoices> currentMinValue{};
     std::array<float, kSimVoices> targetMinValue{};
     std::array<float, kSimVoices> currentMaxValue{};
     std::array<float, kSimVoices> targetMaxValue{};
     std::array<std::array<float, kSimMods>, kSimVoices> currentDepth{};
     std::array<std::array<float, kSimMods>, kSimVoices> targetDepth{};
     std::array<float, kSimVoices> cachedKnob{};
     std::array<float, kSimVoices> uiDisplayCenter{};
     std::array<float, kSimVoices> uiDisplaySpreadEnergy{};
 };
 
+struct SimLocalSlot {
+    std::size_t storageIdentity = 0;
+    int parentParameter = -1;
+    std::size_t sourceIx = 0;
+    bool live = false;
+    bool free = false;
+    bool pinned = false;
+};
+
 struct SimOracle {
     synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.25f};
     std::optional<synth::PageOrdinal> activePage = 0;
     int selectedBank = 0;
     bool resetHeld = false;
     bool randomHeld = false;
     bool randomModHeld = false;
     std::array<SimBank, 2> banks;
     std::array<float, kSimGestures> gestureWeight{};
-    std::array<bool, kSimGestures> gestureSelected{};
+    synth::GestureMask gestureSelectedMask = 0;
     std::array<std::array<float, kSimMods>, kSimVoices> modulatorValue{};
     std::array<SimParam, kSimParams> params;
+    std::array<SimLocalSlot, kSimMods> localSlots{};
+    std::size_t liveLocalCount = 0;
+    std::size_t freeLocalCount = 0;
 };
 
 struct SimRandomSamples {
     std::vector<float> values;
     std::vector<float> coins;
     std::vector<std::size_t> indices;
     std::size_t valueIx = 0;
     std::size_t coinIx = 0;
     std::size_t indexIx = 0;
 
@@ -6277,22 +6292,103 @@ struct SimRandomSamples {
     void RequireDrained(unsigned seed, int step, const std::string& action) const {
         if (valueIx != values.size() || coinIx != coins.size() || indexIx != indices.size()) {
             std::ostringstream oss;
             oss << "seed " << seed << " step " << step << " action " << action
                 << " random samples not fully consumed values=" << valueIx << "/" << values.size()
                 << " coins=" << coinIx << "/" << coins.size()
                 << " indices=" << indexIx << "/" << indices.size();
             throw std::runtime_error(oss.str());
         }
     }
+
+    std::string ConsumptionSummary() const {
+        std::ostringstream oss;
+        oss << "values=" << valueIx << "/" << values.size()
+            << ",coins=" << coinIx << "/" << coins.size()
+            << ",indices=" << indexIx << "/" << indices.size();
+        return oss.str();
+    }
 };
 
+bool SimGestureActive(const SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx) {
+    return (parameter.gestureActiveMasks[sceneIx] & (synth::GestureMask{1} << gestureIx)) != 0;
+}
+
+void SimSetGestureActive(SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx, bool active) {
+    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
+    if (active) {
+        parameter.gestureActiveMasks[sceneIx] |= bit;
+    } else {
+        parameter.gestureActiveMasks[sceneIx] &= ~bit;
+    }
+}
+
+bool SimGestureSelected(const SimOracle& oracle, std::size_t gestureIx) {
+    return (oracle.gestureSelectedMask & (synth::GestureMask{1} << gestureIx)) != 0;
+}
+
+void SimSetGestureSelected(SimOracle& oracle, std::size_t gestureIx, bool selected) {
+    const synth::GestureMask bit = synth::GestureMask{1} << gestureIx;
+    if (selected) {
+        oracle.gestureSelectedMask |= bit;
+    } else {
+        oracle.gestureSelectedMask &= ~bit;
+    }
+}
+
+void SimEnsureRouteActive(SimParam& parameter, std::size_t sourceIx) {
+    const std::size_t routeSlot = parameter.sourceRoutePositions[sourceIx];
+    if (routeSlot < parameter.activeRouteCount) {
+        return;
+    }
+    const std::size_t destination = parameter.activeRouteCount;
+    if (routeSlot != destination) {
+        const std::size_t displacedSource = parameter.routeSourceIndices[destination];
+        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[destination]);
+        parameter.sourceRoutePositions[sourceIx] = destination;
+        parameter.sourceRoutePositions[displacedSource] = routeSlot;
+    }
+    ++parameter.activeRouteCount;
+}
+
+void SimRemoveActiveRoute(SimParam& parameter, std::size_t routeSlot) {
+    const std::size_t lastActive = parameter.activeRouteCount - 1;
+    if (routeSlot != lastActive) {
+        const std::size_t removedSource = parameter.routeSourceIndices[routeSlot];
+        const std::size_t movedSource = parameter.routeSourceIndices[lastActive];
+        std::swap(parameter.routeSourceIndices[routeSlot], parameter.routeSourceIndices[lastActive]);
+        parameter.sourceRoutePositions[movedSource] = routeSlot;
+        parameter.sourceRoutePositions[removedSource] = lastActive;
+    }
+    --parameter.activeRouteCount;
+}
+
+bool SimRouteNeutralAcrossVoices(const SimParam& parameter, std::size_t sourceIx) {
+    constexpr float tolerance = 0.000001f;
+    for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+        if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > tolerance ||
+            std::fabs(parameter.targetDepth[voiceIx][sourceIx]) > tolerance) {
+            return false;
+        }
+    }
+    return true;
+}
+
+void SimPruneNeutralActiveRoutes(SimParam& parameter) {
+    for (std::size_t routeSlot = parameter.activeRouteCount; routeSlot-- > 0;) {
+        const std::size_t sourceIx = parameter.routeSourceIndices[routeSlot];
+        if (SimRouteNeutralAcrossVoices(parameter, sourceIx)) {
+            SimRemoveActiveRoute(parameter, routeSlot);
+        }
+    }
+}
+
 synth::Modifier SimCurrentModifier(const SimOracle& oracle) {
     if (oracle.randomModHeld) {
         return synth::Modifier::RandomMod;
     }
     if (oracle.randomHeld) {
         return synth::Modifier::Random;
     }
     if (oracle.resetHeld) {
         return synth::Modifier::Reset;
     }
@@ -6390,24 +6486,26 @@ const SimCell* SimFindCell(const SimBank& bank, synth::PhysicalEncoderId encoder
         if (cell.encoder == encoder) {
             return &cell;
         }
     }
     return nullptr;
 }
 
 float SimEffectiveGestureWeight(const SimOracle& oracle, const SimParam& parameter, std::size_t gestureIx) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     const float leftWeight =
-        parameter.gestureActive[oracle.scene.leftScene][gestureIx] ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
-                                                                   : 0.0f;
+        SimGestureActive(parameter, oracle.scene.leftScene, gestureIx)
+            ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
+            : 0.0f;
     const float rightWeight =
-        parameter.gestureActive[oracle.scene.rightScene][gestureIx] ? oracle.gestureWeight[gestureIx] * blend : 0.0f;
+        SimGestureActive(parameter, oracle.scene.rightScene, gestureIx) ? oracle.gestureWeight[gestureIx] * blend
+                                                                        : 0.0f;
     return leftWeight + rightWeight;
 }
 
 float SimRawCenter(const SimOracle& oracle, const SimParam& parameter) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     const float inverseBlend = 1.0f - blend;
     const float base =
         parameter.sceneCenter[oracle.scene.leftScene] * inverseBlend + parameter.sceneCenter[oracle.scene.rightScene] * blend;
 
     float weightedMixSum = 0.0f;
@@ -6463,25 +6561,23 @@ bool SimHasNonNeutralDepthState(const SimOracle& oracle, const SimParam& paramet
     constexpr float neutralDepthCenter = 0.5f;
     if (std::fabs(parameter.currentCenter - neutralDepthCenter) > tolerance ||
         std::fabs(parameter.targetCenter - neutralDepthCenter) > tolerance) {
         return true;
     }
     for (const float center : parameter.sceneCenter) {
         if (std::fabs(center - neutralDepthCenter) > tolerance) {
             return true;
         }
     }
-    for (const auto& row : parameter.gestureActive) {
-        for (const bool active : row) {
-            if (active) {
-                return true;
-            }
+    for (const synth::GestureMask mask : parameter.gestureActiveMasks) {
+        if (mask != 0) {
+            return true;
         }
     }
     for (const auto& row : parameter.currentDepth) {
         for (const float depth : row) {
             if (std::fabs(depth) > tolerance) {
                 return true;
             }
         }
     }
     for (const auto& row : parameter.targetDepth) {
@@ -6506,49 +6602,76 @@ std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam
         if (route >= 0 && SimHasNonNeutralDepthState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
             mask |= (std::uint32_t{1} << modIx);
         }
     }
     return mask;
 }
 
 synth::GestureMask SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
     synth::GestureMask mask = 0;
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
-    for (std::size_t gestureIx = 0; gestureIx < std::min<std::size_t>(kSimGestures, 32); ++gestureIx) {
+    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
         bool active = false;
         if (blend <= 0.0f) {
-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx);
         } else if (blend >= 1.0f) {
-            active = parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
         } else {
-            active = parameter.gestureActive[oracle.scene.leftScene][gestureIx] ||
-                     parameter.gestureActive[oracle.scene.rightScene][gestureIx];
+            active = SimGestureActive(parameter, oracle.scene.leftScene, gestureIx) ||
+                     SimGestureActive(parameter, oracle.scene.rightScene, gestureIx);
         }
         if (active) {
             mask |= (synth::GestureMask{1} << gestureIx);
         }
     }
     return mask;
 }
 
 void SimSeedDisplayState(SimOracle& oracle, std::size_t paramIx);
 
 void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
     SimParam& parameter = oracle.params[paramIx];
     parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);
 
     for (const int route : parameter.route) {
         if (route >= 0) {
             SimComputeAtDepth(oracle, static_cast<std::size_t>(route), recursionDepth + 1);
         }
     }
 
+    constexpr float neutralTolerance = 0.000001f;
+    for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+        const int route = parameter.route[sourceIx];
+        bool targetNonNeutral = false;
+        if (route >= 0) {
+            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                if (std::fabs(synth::ModulationDepthTargetFromKnob(
+                                  SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx))) > neutralTolerance) {
+                    targetNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        bool currentNonNeutral = false;
+        if (parameter.sourceRoutePositions[sourceIx] < parameter.activeRouteCount) {
+            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
+                if (std::fabs(parameter.currentDepth[voiceIx][sourceIx]) > neutralTolerance) {
+                    currentNonNeutral = true;
+                    break;
+                }
+            }
+        }
+        if (targetNonNeutral || currentNonNeutral) {
+            SimEnsureRouteActive(parameter, sourceIx);
+        }
+    }
+
     for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
         float weightSum = 0.0f;
         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
             const int route = parameter.route[modIx];
             const float depth =
                 route < 0 ? 0.0f
                           : synth::ModulationDepthTargetFromKnob(
                                 SimGetRaw(oracle, static_cast<std::size_t>(route), voiceIx));
             parameter.targetDepth[voiceIx][modIx] = depth;
             weightSum += std::fabs(depth);
@@ -6588,20 +6711,21 @@ void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recur
 
     if (recursionDepth > 0) {
         parameter.currentCenter = parameter.targetCenter;
         parameter.currentCenterScale = parameter.targetCenterScale;
         parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
         parameter.currentMinValue = parameter.targetMinValue;
         parameter.currentMaxValue = parameter.targetMaxValue;
         parameter.currentDepth = parameter.targetDepth;
         SimSeedDisplayState(oracle, paramIx);
     }
+    SimPruneNeutralActiveRoutes(parameter);
 }
 
 void SimComputeAll(SimOracle& oracle) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimComputeAtDepth(oracle, paramIx, 0);
     }
 }
 
 std::size_t SimParamIndex(const SimOracle& oracle, const SimParam& parameter) {
     const SimParam* begin = oracle.params.data();
@@ -6625,20 +6749,21 @@ void SimSeedDisplayState(SimOracle& oracle, SimParam& parameter) {
     SimSeedDisplayState(oracle, SimParamIndex(oracle, parameter));
 }
 
 void SimSnapParameterToTarget(SimOracle& oracle, SimParam& parameter) {
     parameter.currentCenter = parameter.targetCenter;
     parameter.currentCenterScale = parameter.targetCenterScale;
     parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
     parameter.currentMinValue = parameter.targetMinValue;
     parameter.currentMaxValue = parameter.targetMaxValue;
     parameter.currentDepth = parameter.targetDepth;
+    SimPruneNeutralActiveRoutes(parameter);
     SimSeedDisplayState(oracle, parameter);
     for (const int route : parameter.route) {
         if (route >= 0) {
             SimSnapParameterToTarget(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }
 }
 
 void SimProcessLiteAll(SimOracle& oracle) {
     constexpr float alpha = 0.25f;
@@ -6693,31 +6818,31 @@ void SimOpenModulationView(SimOracle& oracle, SimBank& bank, int paramIx) {
     }
     bank.visible.push_back({
         .encoder = kSimSlotEncoders.back(),
         .parameter = paramIx,
     });
 }
 
 void SimHandleIncDec(SimOracle& oracle, SimParam& parameter, float delta) {
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto armSelectedGesture = [&](std::size_t sceneIx, std::size_t gestureIx) {
-        if (parameter.gestureActive[sceneIx][gestureIx]) {
+        if (SimGestureActive(parameter, sceneIx, gestureIx)) {
             return false;
         }
         parameter.gestureValue[sceneIx][gestureIx] = parameter.sceneCenter[sceneIx];
-        parameter.gestureActive[sceneIx][gestureIx] = true;
+        SimSetGestureActive(parameter, sceneIx, gestureIx, true);
         return true;
     };
 
     bool armedGesture = false;
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (!oracle.gestureSelected[gestureIx]) {
+        if (!SimGestureSelected(oracle, gestureIx)) {
             continue;
         }
         if (blend <= 0.0f) {
             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
         } else if (blend >= 1.0f) {
             armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
         } else {
             armedGesture = armSelectedGesture(oracle.scene.leftScene, gestureIx) || armedGesture;
             if (oracle.scene.rightScene != oracle.scene.leftScene) {
                 armedGesture = armSelectedGesture(oracle.scene.rightScene, gestureIx) || armedGesture;
@@ -6809,25 +6934,26 @@ void SimResetDepthToNeutral(SimOracle& oracle, SimParam& parameter) {
             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }
 
     for (auto& row : parameter.currentDepth) {
         row.fill(0.0f);
     }
     for (auto& row : parameter.targetDepth) {
         row.fill(0.0f);
     }
+    parameter.activeRouteCount = 0;
 
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto resetScene = [&](std::size_t sceneIx) {
         parameter.sceneCenter[sceneIx] = 0.5f;
-        parameter.gestureActive[sceneIx].fill(false);
+        parameter.gestureActiveMasks[sceneIx] = 0;
     };
 
     if (blend <= 0.0f) {
         resetScene(oracle.scene.leftScene);
     } else if (blend >= 1.0f) {
         resetScene(oracle.scene.rightScene);
     } else {
         resetScene(oracle.scene.leftScene);
         if (oracle.scene.rightScene != oracle.scene.leftScene) {
             resetScene(oracle.scene.rightScene);
@@ -6853,26 +6979,27 @@ void SimRevertToDefault(SimOracle& oracle, SimParam& parameter) {
             SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
         }
     }
 
     for (auto& row : parameter.currentDepth) {
         row.fill(0.0f);
     }
     for (auto& row : parameter.targetDepth) {
         row.fill(0.0f);
     }
+    parameter.activeRouteCount = 0;
 
     const float defaultValue = SimClamp(parameter.defaultValue, parameter.range);
     const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
     auto resetScene = [&](std::size_t sceneIx) {
         parameter.sceneCenter[sceneIx] = defaultValue;
-        parameter.gestureActive[sceneIx].fill(false);
+        parameter.gestureActiveMasks[sceneIx] = 0;
     };
 
     if (blend <= 0.0f) {
         resetScene(oracle.scene.leftScene);
     } else if (blend >= 1.0f) {
         resetScene(oracle.scene.rightScene);
     } else {
         resetScene(oracle.scene.leftScene);
         if (oracle.scene.rightScene != oracle.scene.leftScene) {
             resetScene(oracle.scene.rightScene);
@@ -7066,24 +7193,24 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
     if (manager.RandomHeld() != oracle.randomHeld) {
         SimFailBool(seed, step, action, "manager random held");
     }
     if (manager.RandomModHeld() != oracle.randomModHeld) {
         SimFailBool(seed, step, action, "manager random-mod held");
     }
     if (manager.GetCurrentModifier() != SimCurrentModifier(oracle)) {
         SimFailBool(seed, step, action, "manager current modifier");
     }
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (group.GestureSelected(gestureIx) != oracle.gestureSelected[gestureIx]) {
+        if (group.GestureSelected(gestureIx) != SimGestureSelected(oracle, gestureIx)) {
             std::ostringstream oss;
             oss << "seed " << seed << " step " << step << " action " << action << " group gestureIx=" << gestureIx
-                << " selected expected " << oracle.gestureSelected[gestureIx] << " got "
+                << " selected expected " << SimGestureSelected(oracle, gestureIx) << " got "
                 << group.GestureSelected(gestureIx);
             throw std::runtime_error(oss.str());
         }
         SimCheckNear(seed, step, action, "group gestureIx=" + std::to_string(gestureIx) + " weight",
                      oracle.gestureWeight[gestureIx], manager.GestureValue(gestureIx));
     }
     if (slot.SelectedBank() != banks[static_cast<std::size_t>(oracle.selectedBank)]) {
         SimFailBool(seed, step, action, "slot selectedBank=" + std::to_string(oracle.selectedBank));
     }
 
@@ -7093,60 +7220,60 @@ void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimP
         for (std::size_t sceneIx = 0; sceneIx < kSimScenes; ++sceneIx) {
             SimCheckNear(seed, step, action,
                          SimParamField(actual, paramIx, "sceneIx=" + std::to_string(sceneIx) + " center"),
                          expected.sceneCenter[sceneIx], actual.SceneCenter(sceneIx));
             for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
                 const std::string gestureField = "sceneIx=" + std::to_string(sceneIx) +
                                                  " gestureIx=" + std::to_string(gestureIx);
                 SimCheckNear(seed, step, action, SimParamField(actual, paramIx, gestureField + " value"),
                              expected.gestureValue[sceneIx][gestureIx],
                              actual.GestureValue(sceneIx, gestureIx));
-                if (expected.gestureActive[sceneIx][gestureIx] != actual.GestureActive(sceneIx, gestureIx)) {
+                if (SimGestureActive(expected, sceneIx, gestureIx) != actual.GestureActive(sceneIx, gestureIx)) {
                     SimFailBool(seed, step, action, SimParamField(actual, paramIx, gestureField + " active"));
                 }
             }
         }
         for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
             const int route = expected.route[modIx];
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
         RequireRouteBijection(actual, kSimMods);
-        std::array<bool, kSimMods> expectedActiveRoutes{};
-        std::size_t expectedActiveRouteCount = 0;
-        for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
-            for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
-                if (std::fabs(expected.targetDepth[voiceIx][modIx]) > 0.000001f ||
-                    std::fabs(expected.currentDepth[voiceIx][modIx]) > 0.000001f) {
-                    expectedActiveRoutes[modIx] = true;
-                    break;
-                }
-            }
-            expectedActiveRouteCount += expectedActiveRoutes[modIx] ? 1 : 0;
-        }
-        if (actual.ActiveRouteCount() != expectedActiveRouteCount) {
+        if (actual.ActiveRouteCount() != expected.activeRouteCount) {
             SimFail(seed, step, action, SimParamField(actual, paramIx, "active route count"),
-                    static_cast<float>(expectedActiveRouteCount), static_cast<float>(actual.ActiveRouteCount()));
+                    static_cast<float>(expected.activeRouteCount), static_cast<float>(actual.ActiveRouteCount()));
         }
-        for (std::size_t routeSlot = 0; routeSlot < actual.ActiveRouteCount(); ++routeSlot) {
-            const std::size_t sourceIx = actual.RouteSourceIndex(routeSlot);
-            if (!expectedActiveRoutes[sourceIx]) {
+        for (std::size_t routeSlot = 0; routeSlot < kSimMods; ++routeSlot) {
+            const std::size_t expectedSourceIx = expected.routeSourceIndices[routeSlot];
+            const std::size_t actualSourceIx = actual.RouteSourceIndex(routeSlot);
+            if (actualSourceIx != expectedSourceIx) {
+                SimFailBool(seed, step, action,
+                            SimParamField(actual, paramIx,
+                                          "routeSlot=" + std::to_string(routeSlot) +
+                                              " expected stable source=" + std::to_string(expectedSourceIx) +
+                                              " actual stable source=" + std::to_string(actualSourceIx)));
+            }
+            const std::size_t actualRouteSlot = actual.RoutePositionForSource(expectedSourceIx);
+            if (actualRouteSlot != expected.sourceRoutePositions[expectedSourceIx]) {
                 SimFailBool(seed, step, action,
                             SimParamField(actual, paramIx,
-                                          "active route prefix sourceIx=" + std::to_string(sourceIx)));
+                                          "stable source=" + std::to_string(expectedSourceIx) +
+                                              " expected route slot=" +
+                                              std::to_string(expected.sourceRoutePositions[expectedSourceIx]) +
+                                              " actual route slot=" + std::to_string(actualRouteSlot)));
             }
         }
         for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
             const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
                          expected.targetCenterScale[voiceIx],
                          actual.TargetCenterScale(voiceIx));
             SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
                          expected.currentCenterScale[voiceIx],
                          actual.CurrentCenterScale(voiceIx));
@@ -7211,20 +7338,30 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
         SimFailBool(seed, step, action, "ui reset held");
     }
     if (ui.randomHeld.load(std::memory_order_relaxed) != oracle.randomHeld) {
         SimFailBool(seed, step, action, "ui random held");
     }
     if (ui.randomModHeld.load(std::memory_order_relaxed) != oracle.randomModHeld) {
         SimFailBool(seed, step, action, "ui random-mod held");
     }
 
     const SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
+    if (!ui.slots[0].connected.load() ||
+        ui.slots[0].showingModulationView.load() != (bank.selectedParameter >= 0)) {
+        SimFailBool(seed, step, action, "ui selected bank/view state");
+    }
+    for (std::size_t bankIx = 0; bankIx < ui.bankCapacity; ++bankIx) {
+        if (!ui.banks[bankIx].connected.load() ||
+            ui.banks[bankIx].selected.load() != (bankIx == static_cast<std::size_t>(oracle.selectedBank))) {
+            SimFailBool(seed, step, action, "ui bankIx=" + std::to_string(bankIx) + " selected state");
+        }
+    }
     const std::array<synth::Color, 4> defaultIndicators{
         synth::Color::Grey, synth::Color::Grey, synth::Color::Grey, synth::Color::Grey};
     for (std::size_t position = 0; position < kSimSlotEncoders.size(); ++position) {
         const SimCell* cell = SimFindCell(bank, kSimSlotEncoders[position]);
         const synth::Parameter::UIState& actual = ui.slots[0].cells[position];
         const bool expectedConnected = cell != nullptr && cell->parameter >= 0;
         if (actual.connected.load() != expectedConnected) {
             SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " connected");
         }
         if (!expectedConnected) {
@@ -7247,20 +7384,37 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
             const synth::GestureMask expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
             if (actual.switchValues.load() != expectedSwitchValues) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " switch values");
             }
             if (actual.modulatorsAffectingMask.load() != expectedModulatorMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " modulator mask");
             }
             if (actual.gesturesAffectingMask.load() != expectedGestureMask) {
                 SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " gesture mask");
             }
+            if (actual.modulatorColorCount.load() != kSimMods || actual.gestureColorCount.load() != kSimGestures) {
+                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color counts");
+            }
+            for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+                if (actual.modulatorSourceColors[sourceIx].Load() != synth::Color::Off) {
+                    SimFailBool(seed, step, action,
+                                "ui position=" + std::to_string(position) +
+                                    " source color=" + std::to_string(sourceIx));
+                }
+            }
+            for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
+                if (actual.gestureColors[gestureIx].Load() != synth::Color::Off) {
+                    SimFailBool(seed, step, action,
+                                "ui position=" + std::to_string(position) +
+                                    " gesture color=" + std::to_string(gestureIx));
+                }
+            }
             for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
                 SimCheckNear(seed, step, action,
                              "ui position=" + std::to_string(position) + " voice=" + std::to_string(voiceIx),
                              SimToUIPresentation(expected.uiDisplayCenter[voiceIx], expected.range),
                              actual.values[voiceIx].load());
                 const float expectedSpread = expected.switchValues > 1
                                                  ? 0.0f
                                                  : SimToUISpreadPresentation(
                                                        std::sqrt(std::max(0.0f, expected.uiDisplaySpreadEnergy[voiceIx])),
                                                        expected.range);
@@ -7285,21 +7439,21 @@ void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIS
                     SimFailBool(seed, step, action,
                                 "ui position=" + std::to_string(position) + " indicator=" + std::to_string(voiceIx));
                 }
             }
         }
     }
     if (ui.gestures.gestureCapacity != kSimGestures) {
         SimFailBool(seed, step, action, "ui gesture capacity");
     }
     for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
-        if (ui.gestures.selected[gestureIx].load() != oracle.gestureSelected[gestureIx]) {
+        if (ui.gestures.selected[gestureIx].load() != SimGestureSelected(oracle, gestureIx)) {
             SimFailBool(seed, step, action, "ui gesture selected");
         }
         SimCheckNear(seed, step, action, "ui gesture value", oracle.gestureWeight[gestureIx],
                      ui.gestures.values[gestureIx].load());
     }
 }
 
 void SimInitializeOracle(SimOracle& oracle) {
     oracle.selectedBank = 0;
     oracle.resetHeld = false;
@@ -7316,24 +7470,27 @@ void SimInitializeOracle(SimOracle& oracle) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimParam& parameter = oracle.params[paramIx];
         parameter.defaultValue = defaults[paramIx];
         parameter.range = ranges[paramIx];
         parameter.switchValues = switchValues[paramIx];
         const float defaultValue = SimClamp(defaults[paramIx], ranges[paramIx]);
         parameter.sceneCenter.fill(defaultValue);
         for (auto& row : parameter.gestureValue) {
             row.fill(defaultValue);
         }
-        for (auto& row : parameter.gestureActive) {
-            row.fill(false);
-        }
+        parameter.gestureActiveMasks.fill(0);
         parameter.route.fill(-1);
+        for (std::size_t sourceIx = 0; sourceIx < kSimMods; ++sourceIx) {
+            parameter.routeSourceIndices[sourceIx] = sourceIx;
+            parameter.sourceRoutePositions[sourceIx] = sourceIx;
+        }
+        parameter.activeRouteCount = 0;
         parameter.currentCenter = defaultValue;
         parameter.targetCenter = defaultValue;
         parameter.currentCenterScale.fill(1.0f);
         parameter.targetCenterScale.fill(1.0f);
         parameter.currentNormalizationOffset.fill(0.0f);
         parameter.targetNormalizationOffset.fill(0.0f);
         parameter.currentMinValue.fill(defaultValue);
         parameter.targetMinValue.fill(defaultValue);
         parameter.currentMaxValue.fill(defaultValue);
         parameter.targetMaxValue.fill(defaultValue);
@@ -7394,37 +7551,37 @@ struct SimPatchSnapshot {
 SimPatchSnapshot SimCapturePatchSnapshot(const SimOracle& oracle) {
     return {.params = oracle.params};
 }
 
 void SimApplyPatchSnapshot(SimOracle& oracle, const SimPatchSnapshot& snapshot) {
     for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
         SimParam& target = oracle.params[paramIx];
         const SimParam& saved = snapshot.params[paramIx];
         target.sceneCenter = saved.sceneCenter;
         target.gestureValue = saved.gestureValue;
-        target.gestureActive = saved.gestureActive;
+        target.gestureActiveMasks = saved.gestureActiveMasks;
     }
     SimComputeAllAndSnap(oracle);
 }
 
 void SimApplyNewPatch(SimOracle& oracle) {
     const auto banks = oracle.banks;
     const int selectedBank = oracle.selectedBank;
     const auto modulatorValue = oracle.modulatorValue;
     SimInitializeOracle(oracle);
     oracle.banks = banks;
     oracle.selectedBank = selectedBank;
     oracle.modulatorValue = modulatorValue;
     oracle.scene = {.leftScene = 0, .rightScene = 1, .blend = 0.25f};
     oracle.activePage = 0;
     oracle.gestureWeight.fill(0.0f);
-    oracle.gestureSelected.fill(false);
+    oracle.gestureSelectedMask = 0;
     SimComputeAllAndSnap(oracle);
 }
 
 std::size_t SimFindLatestPatchInDirectory(
     const std::vector<std::pair<std::filesystem::path, SimPatchSnapshot>>& versions,
     const std::filesystem::path& patchDir) {
     for (std::size_t reverseIx = versions.size(); reverseIx > 0; --reverseIx) {
         const std::size_t ix = reverseIx - 1;
         if (versions[ix].first.parent_path() == patchDir) {
             return ix;
@@ -7434,21 +7591,21 @@ std::size_t SimFindLatestPatchInDirectory(
 }
 
 } // namespace
 
 TEST_CASE(randomized_parameter_modulation_simulation) {
     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
     const int steps = SimStepsFromEnvironment();
 
     for (const unsigned seed : seeds) {
         synth::ParameterManager manager;
-        manager.SetGestureCount(2);
+        manager.SetGestureCount(kSimGestures);
         auto& group = manager.CreateGroup({
             .numVoices = kSimVoices,
             .numModulators = kSimMods,
             .numScenes = kSimScenes,
             .maxParameters = kSimParams,
             .processLiteAlpha = 0.25f,
             .targetCenterAlpha = 1.0f,
         });
         auto& carrier = manager.CreateParameter(group, {
             .name = "Carrier",
@@ -7620,28 +7777,28 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
                 const bool held = (rng() % 2) == 0;
                 action = std::string("set random-mod held ") + (held ? "true" : "false");
                 manager.SetRandomModHeld(held);
                 oracle.randomModHeld = held;
                 break;
             }
             case 8: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "select gesture " + std::to_string(gestureIx);
                 manager.SelectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = true;
+                SimSetGestureSelected(oracle, gestureIx, true);
                 break;
             }
             case 9: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "deselect gesture " + std::to_string(gestureIx);
                 manager.DeselectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = false;
+                SimSetGestureSelected(oracle, gestureIx, false);
                 break;
             }
             case 10: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "set gesture value " + std::to_string(gestureIx);
                 manager.SetGestureValue(gestureIx, value);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
             }
@@ -7707,27 +7864,27 @@ TEST_CASE(randomized_parameter_modulation_simulation) {
                 }
                 SimProcessLiteAll(oracle);
                 break;
             default: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "clear active gesture " + std::to_string(gestureIx);
                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
                 for (auto& parameter : oracle.params) {
                     if (blend <= 0.0f) {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                     } else if (blend >= 1.0f) {
-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                     } else {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                         }
                     }
                 }
                 break;
             }
             }
 
             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
         }
     }
@@ -7810,22 +7967,42 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
         std::mt19937 randomRng(seed ^ 0xBADC0DEu);
         manager.SetRandomSource(
             [&randomSamples]() { return randomSamples.PopValue(); },
             [&randomSamples]() { return randomSamples.PopCoin(); },
             [&randomSamples](std::size_t max) { return randomSamples.PopIndex(max); });
 
         SimCheck(oracle, params, banks, group, slot, manager, seed, -1, "initial bus");
         manager.PopulateUIState(*ui);
         SimCheckUIState(oracle, *ui, seed, -1, "initial bus ui");
 
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 32, true)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 32, 0.4f)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(timestamp, 63, true)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, 63, 0.8f)));
+        REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.05f)));
+        bus.Process(timestamp++);
+        SimSetGestureSelected(oracle, 32, true);
+        oracle.gestureWeight[32] = 0.4f;
+        SimSetGestureSelected(oracle, 63, true);
+        oracle.gestureWeight[63] = 0.8f;
+        SimHandleTick(oracle, encoders[0], 0.05f);
+        SimCheck(oracle, params, banks, group, slot, manager, seed, -1,
+                 "deterministic gestures=32,63 random-consumption(values=0/0,coins=0/0,indices=0/0)");
+        manager.PopulateUIState(*ui);
+        SimCheckUIState(oracle, *ui, seed, -1,
+                        "deterministic gestures=32,63 ui random-consumption(values=0/0,coins=0/0,indices=0/0)");
+        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 32)) != 0);
+        REQUIRE_TRUE((ui->slots[0].cells[0].gesturesAffectingMask.load() & (synth::GestureMask{1} << 63)) != 0);
+
         for (int step = 0; step < steps; ++step) {
             std::string action;
+            randomSamples.Clear();
             auto modifierName = [](synth::Modifier modifier) {
                 switch (modifier) {
                 case synth::Modifier::None:
                     return "none";
                 case synth::Modifier::Reset:
                     return "reset";
                 case synth::Modifier::Random:
                     return "random";
                 case synth::Modifier::RandomMod:
                     return "random-mod";
@@ -7973,21 +8150,21 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetRandomMod(timestamp, held)));
                 bus.Process(timestamp);
                 oracle.randomModHeld = held;
                 break;
             }
             case 11: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "bus toggle gesture " + std::to_string(gestureIx);
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(timestamp, gestureIx)));
                 bus.Process(timestamp);
-                oracle.gestureSelected[gestureIx] = !oracle.gestureSelected[gestureIx];
+                SimSetGestureSelected(oracle, gestureIx, !SimGestureSelected(oracle, gestureIx));
                 break;
             }
             case 12: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "bus set gesture value " + std::to_string(gestureIx);
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, gestureIx, value)));
                 bus.Process(timestamp);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
@@ -8061,29 +8238,180 @@ TEST_CASE(randomized_message_bus_ui_state_simulation) {
                 const std::size_t previousLeft = manager.Scene().leftScene;
                 const std::size_t previousRight = manager.Scene().rightScene;
                 REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(timestamp, kSimScenes + 1)));
                 bus.Process(timestamp);
                 REQUIRE_TRUE(manager.Scene().leftScene == previousLeft);
                 REQUIRE_TRUE(manager.Scene().rightScene == previousRight);
                 break;
             }
             }
             ++timestamp;
+            action += " random-consumption(" + randomSamples.ConsumptionSummary() + ")";
             SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
             if (step % 11 == 0) {
                 manager.PopulateUIState(*ui);
                 SimCheckUIState(oracle, *ui, seed, step, action);
             }
         }
     }
 }
 
+TEST_CASE(message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load) {
+    constexpr unsigned seed = 0x5A17C0DEu;
+    synth::ParameterManager manager;
+    REQUIRE_TRUE(manager.SetGestureCount(64));
+    auto& group = manager.CreateGroup({.numVoices = 1,
+                                       .numModulators = 2,
+                                       .numScenes = 2,
+                                       .maxParameters = 2,
+                                       .targetCenterAlpha = 1.0f});
+    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.25f});
+    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.75f});
+    group.AddParameterStorageBatch(synth::MakeParameterStorageBatch(group.Config(), group.GestureCount(), 2));
+    REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
+    manager.SetSceneBlend(0.25f);
+
+    auto& bank = manager.CreateBank();
+    bank.AddMapping(10, first);
+    bank.AddMapping(20, second);
+    auto& slot = manager.CreateBankSlot();
+    for (const synth::PhysicalEncoderId encoder : {10u, 11u, 12u, 20u}) {
+        slot.AddPhysicalEncoder(encoder);
+    }
+    slot.SelectBank(&bank);
+    synth::MessageInBus bus(&manager, 64);
+
+    SimOracle oracle;
+    auto fail = [&](int step, const std::string& action, const std::string& field,
+                    std::size_t expected, std::size_t actual) {
+        std::ostringstream oss;
+        oss << "seed " << seed << " step " << step << " action " << action
+            << " random-consumption(values=0/0,coins=0/0,indices=0/0) " << field
+            << " expected " << expected << " got " << actual;
+        throw std::runtime_error(oss.str());
+    };
+    auto checkCounts = [&](int step, const std::string& action) {
+        if (group.LiveLocalParameterCount() != oracle.liveLocalCount) {
+            fail(step, action, "live local count", oracle.liveLocalCount, group.LiveLocalParameterCount());
+        }
+        if (group.FreeLocalParameterSlotCount() != oracle.freeLocalCount) {
+            fail(step, action, "free local count", oracle.freeLocalCount, group.FreeLocalParameterSlotCount());
+        }
+    };
+    std::uint64_t timestamp = 1;
+    auto push = [&](const synth::MessageIn& message) {
+        REQUIRE_TRUE(bus.Push(message));
+        bus.Process(timestamp);
+        ++timestamp;
+    };
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // open First
+    oracle.liveLocalCount = 2;
+    for (std::size_t sourceIx = 0; sourceIx < 2; ++sourceIx) {
+        oracle.localSlots[sourceIx] = {
+            .storageIdentity = 2 + sourceIx,
+            .parentParameter = 0,
+            .sourceIx = sourceIx,
+            .live = true,
+            .free = false,
+            .pinned = true,
+        };
+    }
+    checkCounts(0, "open first modulation view");
+    REQUIRE_TRUE(bank.ShowingModulation());
+    synth::Parameter* firstSource0 = bank.VisibleParameter(10);
+    synth::Parameter* firstSource1 = bank.VisibleParameter(11);
+    REQUIRE_TRUE(firstSource0 == &group.ParameterByLocalIndex(oracle.localSlots[0].storageIdentity));
+    REQUIRE_TRUE(firstSource1 == &group.ParameterByLocalIndex(oracle.localSlots[1].storageIdentity));
+
+    push(synth::MessageIn::SetReset(timestamp, true));
+    push(synth::MessageIn::ParamPush(timestamp, 0, 0)); // reset visible local through the bus
+    push(synth::MessageIn::SetReset(timestamp, false));
+    REQUIRE_TRUE(group.CollectNeutralLocalParameters() == 0); // the model's pinned guard is observable
+    checkCounts(1, "reset pinned local and collect");
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close First view
+    oracle.liveLocalCount = 0;
+    oracle.freeLocalCount = 2;
+    for (SimLocalSlot& local : oracle.localSlots) {
+        local.live = false;
+        local.free = true;
+        local.pinned = false;
+        local.parentParameter = -1;
+    }
+    checkCounts(2, "close first view and collect neutral locals");
+    REQUIRE_TRUE(!bank.ShowingModulation());
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // open Second using recycled slots
+    oracle.liveLocalCount = 2;
+    oracle.freeLocalCount = 0;
+    oracle.localSlots[1].parentParameter = 1;
+    oracle.localSlots[1].sourceIx = 0;
+    oracle.localSlots[1].live = true;
+    oracle.localSlots[1].free = false;
+    oracle.localSlots[1].pinned = true;
+    oracle.localSlots[0].parentParameter = 1;
+    oracle.localSlots[0].sourceIx = 1;
+    oracle.localSlots[0].live = true;
+    oracle.localSlots[0].free = false;
+    oracle.localSlots[0].pinned = true;
+    checkCounts(3, "open second view with distinct-parent reuse");
+    REQUIRE_TRUE(bank.VisibleParameter(10) == firstSource1);
+    REQUIRE_TRUE(bank.VisibleParameter(11) == firstSource0);
+
+    push(synth::MessageIn::SetGestureSelect(timestamp, 63, true));
+    push(synth::MessageIn::SetGestureValue(timestamp, 63, 1.0f));
+    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // arm gesture 63
+    push(synth::MessageIn::ParamIncDec(timestamp, 0, 0, 0.1f)); // edit the armed gesture
+    synth::Parameter* retained = bank.VisibleParameter(10);
+    REQUIRE_TRUE(retained != nullptr);
+    REQUIRE_TRUE(retained->GestureActive(0, 63));
+    REQUIRE_TRUE(retained->GestureActive(1, 63));
+    REQUIRE_TRUE(retained->GestureValue(0, 63) != 0.5f || retained->GestureValue(1, 63) != 0.5f);
+    const float savedGesture0 = retained->GestureValue(0, 63);
+    const float savedGesture1 = retained->GestureValue(1, 63);
+
+    push(synth::MessageIn::ParamPush(timestamp, 0, 3)); // close Second view
+    oracle.liveLocalCount = 1;
+    oracle.freeLocalCount = 1;
+    oracle.localSlots[1].pinned = false;
+    oracle.localSlots[0].live = false;
+    oracle.localSlots[0].free = true;
+    oracle.localSlots[0].pinned = false;
+    oracle.localSlots[0].parentParameter = -1;
+    checkCounts(4, "close second view and retain non-default gesture route");
+    REQUIRE_TRUE(second.ModulationDepthParameter(0) == retained);
+    REQUIRE_TRUE(second.ModulationDepthParameter(1) == nullptr);
+
+    synth::JsonArena patchArena(262144);
+    synth::MidiInstrumentConfig instrument;
+    synth::AudioDeviceState audio;
+    const synth::JSON patch = synth::BuildPatchJSON(patchArena, "Lifecycle", manager, instrument, audio);
+    REQUIRE_TRUE(!patchArena.Failed());
+    manager.RevertAllToDefaults();
+    oracle.liveLocalCount = 0;
+    oracle.freeLocalCount = 2;
+    checkCounts(5, "revert all and collect");
+    REQUIRE_TRUE(second.ModulationDepthParameter(0) == nullptr);
+
+    REQUIRE_TRUE(synth::LoadPatchJSON(patch, manager, instrument, &audio));
+    oracle.liveLocalCount = 1;
+    oracle.freeLocalCount = 1;
+    checkCounts(6, "patch load rematerializes retained route and collects omissions");
+    synth::Parameter* loaded = second.ModulationDepthParameter(0);
+    REQUIRE_TRUE(loaded != nullptr);
+    REQUIRE_TRUE(loaded->GestureActive(0, 63));
+    REQUIRE_TRUE(loaded->GestureActive(1, 63));
+    REQUIRE_NEAR(loaded->GestureValue(0, 63), savedGesture0, 0.000001f);
+    REQUIRE_NEAR(loaded->GestureValue(1, 63), savedGesture1, 0.000001f);
+}
+
 TEST_CASE(randomized_patch_lifecycle_simulation) {
     const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
     const int steps = SimStepsFromEnvironmentOrDefault(260);
 
     for (const unsigned seed : seeds) {
         const std::filesystem::path tempRoot =
             std::filesystem::temp_directory_path() / ("sheaf-synth-patch-random-" + std::to_string(seed));
         std::filesystem::remove_all(tempRoot);
         std::filesystem::create_directories(tempRoot);
 
@@ -8252,28 +8580,28 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
                 manager.HandlePress(encoder);
                 resetSamples.RequireDrained(seed, step, action);
                 manager.SetResetHeld(false);
                 oracle.resetHeld = false;
                 break;
             }
             case 5: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch select gesture " + std::to_string(gestureIx);
                 manager.SelectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = true;
+                SimSetGestureSelected(oracle, gestureIx, true);
                 break;
             }
             case 6: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch deselect gesture " + std::to_string(gestureIx);
                 manager.DeselectGesture(gestureIx);
-                oracle.gestureSelected[gestureIx] = false;
+                SimSetGestureSelected(oracle, gestureIx, false);
                 break;
             }
             case 7: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 const float value = unipolarDist(rng);
                 action = "patch set gesture value " + std::to_string(gestureIx);
                 manager.SetGestureValue(gestureIx, value);
                 oracle.gestureWeight[gestureIx] = value;
                 break;
             }
@@ -8321,27 +8649,27 @@ TEST_CASE(randomized_patch_lifecycle_simulation) {
                 }
                 SimProcessLiteAll(oracle);
                 break;
             case 14: {
                 const std::size_t gestureIx = rng() % kSimGestures;
                 action = "patch clear active gesture " + std::to_string(gestureIx);
                 manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
                 const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
                 for (auto& parameter : oracle.params) {
                     if (blend <= 0.0f) {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                     } else if (blend >= 1.0f) {
-                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                     } else {
-                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
+                        SimSetGestureActive(parameter, oracle.scene.leftScene, gestureIx, false);
                         if (oracle.scene.rightScene != oracle.scene.leftScene) {
-                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
+                            SimSetGestureActive(parameter, oracle.scene.rightScene, gestureIx, false);
                         }
                     }
                 }
                 break;
             }
             case 15:
             case 16:
                 action = "patch save";
                 saveCurrentOracle();
                 break;
diff --git a/projects/synth/tests/portable_ui_tests.cpp b/projects/synth/tests/portable_ui_tests.cpp
index 485fbd4f..179226f5 100644
--- a/projects/synth/tests/portable_ui_tests.cpp
+++ b/projects/synth/tests/portable_ui_tests.cpp
@@ -432,24 +432,32 @@ int main()
     Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
             "encoder uses snapshot voice-zero indicator color");
     Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
             "encoder uses snapshot source badge colors");
     Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
             "encoder uses snapshot gesture badge colors");
 
     Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
     Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
     Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
-    synth::ui::EncoderDrawState highGestureEncoder;
-    highGestureEncoder.connected = true;
-    highGestureEncoder.gesturesAffectingMask = std::uint64_t{1} << 63;
-    highGestureEncoder.gestureColors.resize(64, synth::Color::Orange);
+    synth::Parameter::UIState highGestureState(1, 0, 64);
+    highGestureState.connected.store(true);
+    highGestureState.voiceCount.store(1);
+    highGestureState.gesturesAffectingMask.store(std::uint64_t{1} << 63);
+    highGestureState.gestureColorCount.store(64);
+    for (std::size_t gestureIx = 0; gestureIx < 64; ++gestureIx) {
+        highGestureState.gestureColors[gestureIx].Store(synth::Color::Orange);
+    }
+    const synth::ui::EncoderDrawState highGestureEncoder =
+        synth::ui::EncoderDrawStateFromParameter(highGestureState);
+    Require(highGestureEncoder.gesturesAffectingMask == (std::uint64_t{1} << 63),
+            "encoder snapshot preserves gesture bit 63");
     const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
         highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
     Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
                 return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
             }),
             "encoder renders gesture 63 as badge 64");
 
     static_assert(synth::SynthApplication<TestApp>);
     static_assert(!synth::ui::kPortableUiUsesJuce);
     static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
