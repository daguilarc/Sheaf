# Review package: 5a1e9408..baf2c608

## Commits
baf2c608 test(synth): guard sparse modulation scaling

## Files changed
 projects/synth/docs/coverage.md                | 103 +++++++++++++++++++-
 projects/synth/tests/braid4_deadline_tests.cpp |  52 ++++++++--
 projects/synth/tests/braid4_system_tests.cpp   | 126 +++++++++++++++++++++++++
 3 files changed, 273 insertions(+), 8 deletions(-)

## Diff
diff --git a/projects/synth/docs/coverage.md b/projects/synth/docs/coverage.md
index a6d0d1b7..87545b8f 100644
--- a/projects/synth/docs/coverage.md
+++ b/projects/synth/docs/coverage.md
@@ -1,13 +1,13 @@
 # Spec Coverage

-Last audit: ganged random LFO, 2026-07-15
+Last audit: sparse modulation processing, 2026-07-15

 | Requirement | Status | Primary exact coverage |
 |---|---|---|
 | `sprs-1` | covered | `runtime_main_component_tests`, `browser_runtime_contract_tests`, `runtime_shell_session_tests`, fake-app/miniapp Playwright, generic-runtime scan |
 | `sprs-2` | covered | component validation/geometry tests, JUCE nested-root tests, browser layout tests, desktop/narrow Playwright |
 | `sprs-3` | covered | browser service/audio/MIDI contract tests, retained JUCE runtime-page executables, browser page Playwright |
 | `sprs-4` | covered | browser pointer backend tests, fake-app and miniapp real-mouse Playwright, JUCE parity executable |
 | `sprs-5` | covered | browser isolated rounded-arc test, encoder geometry executable, real-miniapp Canvas/screenshots |
 | `sprs-6` | covered | browser resolved-layout tests plus fake-app and miniapp desktop/narrow Playwright |
 | `sprs-7` | covered | C++, JUCE, TypeScript/Chromium, real-WASM audio/MIDI/gesture/static-site acceptance |
@@ -21,20 +21,25 @@ Last audit: ganged random LFO, 2026-07-15
 | `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
 | `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; top-level/bank-transition no-visualizer regressions; null/hidden paths in portable/Braid tests |
 | `sru-25` | covered | `projects/synth/tests/portable_ui_tests.cpp` shared encoder underlay body alpha and preserved non-body commands; `projects/synth/tests/miniapp_system_tests.cpp` visible and hidden visualizer underlay wiring |
 | `sdsp-33` | covered | `projects/synth/tests/miniapp_system_tests.cpp` MiniApp constructs visible distinct VCO visualizers and one LFO visualizer |
 | `sdsp-34` | covered | `dsp_tests` shaped interpolation, reciprocal-time correlated increments, Hz-domain voice spread, validation, precision, and one-hour increment floor cases |
 | `sdsp-35` | covered | `dsp_tests` deterministic voice wait/move/done transitions, exact and overshot boundaries, reset semantics, and double progress cases |
 | `sdsp-36` | covered | `dsp_tests` canonical random draw order, correlated gang turnover, fixed storage/seed, bounded coherent snapshots, complete live fields, and assigned voice colors |
 | `spv-6` | covered | `portable_ui_tests` predictive round geometry and invalid-snapshot fallback; `miniapp_juce_backend_parity_tests` and `browser_command_buffer_tests` existing-backend command parity |
 | `spm-71` | covered | `miniapp_system_tests` source registration/configuration, audio-block processing/publishing, retained address-stable visualizer, and three-panel/underlay UI topology; JUCE/browser parity tests cover the same portable draw commands |
 | `d4-9` | covered | `projects/synth/tests/braid4_system_tests.cpp` all Braid 4 modulator visualizers are null and modulation view is encoder-only |
+| `spm-20` (modified) | covered | `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`, `ui_state_reports_affecting_masks_through_gesture_index_63`, `randomized_message_bus_ui_state_simulation`, and portable encoder snapshot/render assertions through bit 63 |
+| `spm-25` (modified) | covered | `randomized_message_bus_ui_state_simulation` plus `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load` validate 64-bit UI masks and sparse lifecycle state against deterministic manager-owned oracles |
+| `spm-72` | covered | `group_process_sample_visits_only_registered_roots`, `recursive_local_compute_seeds_display_without_audio_rate_processing`, active-route full-scan cases, and `braid4_sparse_work_counters_bound_inactive_capacity` |
+| `spm-73` | covered | 0--64 gesture boundary/sparse-mask tests, `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`, portable bit-63 badge rendering, and randomized UI-state coverage |
+| `spm-74` | covered | neutral-leaf guard, bottom-up collapse, pin, settling/detach, bounded-reuse, patch-load, semantic-JSON, and randomized lifecycle cases in `parameter_modulation_tests` |

 ## Requirement Mappings

 ### `sprs-1` - Shared Portable Composition

 - [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
   `TestSidebarOpensEachPageAndBackRestoresApp`,
   `TestAppActionsRouteOnlyToAppSurface`, and
   `TestRuntimeActionsRouteOnlyToOwningPageOrServices`.
 - [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
@@ -262,20 +267,116 @@ Last audit: ganged random LFO, 2026-07-15
   `miniapp_modulation_view_draws_visualizer_beneath_encoder`, and the top-level,
   hidden, and bank-transition visualizer cases in that executable cover three
   distinct waveform panels, a separate retained address-stable modulator
   underlay, and unchanged performer controls, parameters, banks, and persistence.
 - [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
   `miniapp_juce_backend_parity_tests` and
   `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` in
   [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
   cover the three-panel commands in both production backends.

+### `spm-20` (modified) - 64-Bit Parameter UI Snapshots
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`,
+  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
+  `randomized_message_bus_ui_state_simulation` cover atomic parameter snapshots,
+  source/gesture colors, visible cells, signed and unipolar ranges, and 64-bit
+  gesture-affecting masks through index 63.
+- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): the exact
+  `encoder snapshot preserves gesture bit 63` and
+  `encoder renders gesture 63 as badge 64` assertions pass a real
+  `Parameter::UIState` through `EncoderDrawStateFromParameter` and the portable
+  renderer.
+
+### `spm-25` (modified) - Message-Driven Randomized UI State
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `randomized_message_bus_ui_state_simulation` is the deterministic
+  manager-owned gesture/UI oracle, including 64-bit masks, stable route source
+  identities, inverse positions, current/target values, selected bank/view
+  state, and reproducible seed/step/action/sample diagnostics.
+- `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
+  covers message-driven bank open/close, reset, collection, compatible slot
+  reuse under a distinct parent, and patch-load boundaries.
+
+### `spm-72` - Sparse Top-Level And Active-Route Traversal
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `group_process_sample_visits_only_registered_roots` and
+  `recursive_local_compute_seeds_display_without_audio_rate_processing` cover
+  the top-level `ProcessLite` boundary and recursive local-state refresh.
+  `modulators_apply_active_uses_explicit_stable_source_indices`,
+  `active_modulation_routes_preserve_identity_and_settling_tail`,
+  `active_modulation_route_union_keeps_source_with_only_voice_one_nonzero`, and
+  `active_modulation_routes_randomized_full_scan_oracle_and_work_bound` cover
+  compact application, stable source identity, swap/removal, across-voice
+  route union, settling tails, and sample-by-sample full-scan equivalence.
+- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
+  `braid4_parameter_processing_ignores_materialized_local_depths` and
+  `braid4_sparse_work_counters_bound_inactive_capacity` compare equal internal
+  subframe counts across baseline, all materializable neutral locals, sparse
+  active routes, and 64 configured inactive gestures. Observer visit counts are
+  the authoritative complexity contract.
+
+### `spm-73` - Sparse 64-Bit Gestures
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation`,
+  `gesture_masks_visit_only_active_bits_through_index_63`,
+  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
+  `message_bus_and_patch_round_trip_gesture_indices_32_and_63` cover counts 0,
+  1, 32, 33, and 64, rejected 65, sparse set-bit evaluation, UI masks,
+  messaging, and persistence.
+- [`instrument_tests.cpp`](../tests/instrument_tests.cpp):
+  `MessageInJsonRoundTripsHighGestureIndex` and
+  `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`
+  cover controller index 63 while preserving the separate 32-bit bank selector.
+- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): exact badge assertions
+  retain legacy labels through gesture 15 and distinguish gestures 16--63 with
+  one-based labels 17--64.
+
+### `spm-74` - Neutral Local-Node Reclamation
+
+- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
+  `neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting`,
+  `neutral_local_collection_retains_non_default_scene_state`,
+  `neutral_local_collection_retains_inactive_latent_gesture_value`,
+  `neutral_local_collection_retains_active_gesture_at_default_value`,
+  `neutral_local_collection_retains_unsnapped_runtime_state`, and
+  `neutral_local_collection_retains_nonzero_normalization_state` cover the
+  complete neutral/default eligibility guards and high-water accounting.
+- `neutral_local_collection_retains_parent_with_non_collectible_child`,
+  `neutral_local_collection_collapses_recursive_subtree_bottom_up`,
+  `neutral_local_collection_detaches_child_while_parent_route_finishes_settling`,
+  and `modulation_view_pins_visible_locals_until_deselect_boundary` cover
+  bottom-up ownership, detach ordering, settling, and live-view pinning.
+- `neutral_local_reuse_stays_bounded_beyond_configured_capacity`,
+  `randomized_neutral_local_collection_reuses_slots_without_stale_topology`,
+  `patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions`,
+  `eligible_collection_preserves_semantic_parameter_json`, and
+  `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
+  cover bounded reuse, complete reset, persistence, semantic JSON, and
+  lifecycle integration.
+
+### Sparse-Modulation Timing Evidence
+
+- [`braid4_deadline_tests.cpp`](../tests/braid4_deadline_tests.cpp):
+  `braid4_meets_48000hz_256_frame_deadline_and_continuity`,
+  `braid4_meets_96000hz_256_frame_deadline_and_continuity`,
+  `braid4_sparse_modulation_meets_48000hz_256_frame_deadline`, and
+  `braid4_sparse_modulation_meets_96000hz_256_frame_deadline` print baseline and
+  sparse-active average/p99 measurements at 48 kHz host/192 kHz internal and
+  96 kHz host/384 kHz internal. These generous deadline ceilings are
+  platform-sensitive smoke evidence; they do not assert a speedup ratio and do
+  not replace the deterministic work-count contract above.
+
 ## Known Gaps

 - Browser realtime audio underrun safety is intentionally not claimed by these
   mappings. The current deterministic scheduler deficit and the deferred
   render-ahead design are recorded in
   [`browser-audio-underrun-diagnosis.md`](browser-audio-underrun-diagnosis.md).
 - Audio input remains outside the browser runtime scope.
 - Browser MIDI is bidirectional and covers SysEx, multiple selected devices,
   polling, disconnect, reconnect, and a low-latency output drain cadence.
   Overflow signaling for bursts beyond the bridge's bounded output queue should
diff --git a/projects/synth/tests/braid4_deadline_tests.cpp b/projects/synth/tests/braid4_deadline_tests.cpp
index 3e4de797..b8a29e6b 100644
--- a/projects/synth/tests/braid4_deadline_tests.cpp
+++ b/projects/synth/tests/braid4_deadline_tests.cpp
@@ -55,21 +55,44 @@ struct Register {
 void RequireNear(double actual, double expected, double tolerance, const char* expr) {
     if (std::fabs(actual - expected) > tolerance) {
         std::ostringstream oss;
         oss << expr << " expected " << expected << " got " << actual;
         throw std::runtime_error(oss.str());
     }
 }

 #define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

+enum class DeadlineScenario {
+    Baseline,
+    SparseActive,
+};
+
+const char* DeadlineScenarioName(DeadlineScenario scenario) {
+    return scenario == DeadlineScenario::Baseline ? "baseline" : "sparse-active";
+}
+
+void ConfigureDeadlineScenario(synth::Engine<synth_braid4::Braid4Core>& engine,
+                               DeadlineScenario scenario) {
+    if (scenario != DeadlineScenario::SparseActive) {
+        return;
+    }
+    synth::Parameter& parameter = engine.Manager().ParameterById(0);
+    synth::Parameter* depth = parameter.EnsureModulationDepth(0);
+    REQUIRE_TRUE(depth != nullptr);
+    depth->SceneCenter(0) = 0.75f;
+    depth->SceneCenter(1) = 0.75f;
+    engine.Manager().ComputeAllParameters();
+}
+
 struct DeadlineStats {
+    DeadlineScenario scenario = DeadlineScenario::Baseline;
     double sampleRate = 0.0;
     double averageSeconds = 0.0;
     double p99Seconds = 0.0;
     double blockSeconds = 0.0;
     synth_braid4::Braid4Core::DebugCounterState counters;
     std::vector<float> contiguousLeft;
     std::vector<float> contiguousRight;
     std::vector<float> splitLeft;
     std::vector<float> splitRight;
 };
@@ -82,25 +105,28 @@ void AssertFiniteStereo(const std::array<std::vector<float>, 2>& channels) {
     bool heardSignal = false;
     for (const auto& channel : channels) {
         for (const float sample : channel) {
             REQUIRE_TRUE(std::isfinite(sample));
             heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
         }
     }
     REQUIRE_TRUE(heardSignal);
 }

-std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vector<std::size_t>& segmentFrames) {
+std::array<std::vector<float>, 2> RunSegments(double sampleRate,
+                                              const std::vector<std::size_t>& segmentFrames,
+                                              DeadlineScenario scenario) {
     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(sampleRate, 256);
+    ConfigureDeadlineScenario(engine, scenario);

     std::array<std::vector<float>, 2> captured;
     for (const std::size_t frames : segmentFrames) {
         std::array<std::vector<float>, 2> blockStorage{{
             std::vector<float>(frames, 12345.0f),
             std::vector<float>(frames, 12345.0f),
         }};
         std::vector<float*> outputs = PointersFor(blockStorage);
         synth::AudioBlock block{
             .outputs = outputs.data(),
@@ -108,29 +134,30 @@ std::array<std::vector<float>, 2> RunSegments(double sampleRate, const std::vect
             .numFrames = frames,
         };
         engine.ProcessBlock(block, timestamp++);

         captured[0].insert(captured[0].end(), blockStorage[0].begin(), blockStorage[0].end());
         captured[1].insert(captured[1].end(), blockStorage[1].begin(), blockStorage[1].end());
     }
     return captured;
 }

-DeadlineStats MeasureDeadline(double sampleRate) {
+DeadlineStats MeasureDeadline(double sampleRate, DeadlineScenario scenario) {
     constexpr std::size_t kBlockFrames = 256;
     constexpr std::size_t kWarmupBlocks = 64;
     constexpr std::size_t kMeasuredBlocks = 512;

     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(sampleRate, static_cast<int>(kBlockFrames));
+    ConfigureDeadlineScenario(engine, scenario);

     std::array<std::vector<float>, 2> blockStorage{{
         std::vector<float>(kBlockFrames, 0.0f),
         std::vector<float>(kBlockFrames, 0.0f),
     }};
     std::vector<float*> outputs = PointersFor(blockStorage);
     synth::AudioBlock block{
         .outputs = outputs.data(),
         .numOutputChannels = 2,
         .numFrames = kBlockFrames,
@@ -147,41 +174,43 @@ DeadlineStats MeasureDeadline(double sampleRate) {
         engine.ProcessBlock(block, timestamp++);
         const auto end = std::chrono::steady_clock::now();
         durations.push_back(std::chrono::duration<double>(end - start).count());
     }

     std::vector<double> sorted = durations;
     std::sort(sorted.begin(), sorted.end());
     const std::size_t p99Index = static_cast<std::size_t>(
         std::ceil(static_cast<double>(sorted.size()) * 0.99)) - 1;

-    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2});
-    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames});
+    const auto contiguous = RunSegments(sampleRate, {kBlockFrames * 2}, scenario);
+    const auto split = RunSegments(sampleRate, {kBlockFrames, kBlockFrames}, scenario);
     AssertFiniteStereo(contiguous);
     AssertFiniteStereo(split);

     return {
+        .scenario = scenario,
         .sampleRate = sampleRate,
         .averageSeconds = std::accumulate(durations.begin(), durations.end(), 0.0) /
                           static_cast<double>(durations.size()),
         .p99Seconds = sorted.at(std::min(p99Index, sorted.size() - 1)),
         .blockSeconds = static_cast<double>(kBlockFrames) / sampleRate,
         .counters = engine.Application().DebugCounters(),
         .contiguousLeft = contiguous[0],
         .contiguousRight = contiguous[1],
         .splitLeft = split[0],
         .splitRight = split[1],
     };
 }

-void AssertDeadlineAndContinuity(double sampleRate) {
-    const DeadlineStats stats = MeasureDeadline(sampleRate);
+void AssertDeadlineAndContinuity(double sampleRate,
+                                 DeadlineScenario scenario = DeadlineScenario::Baseline) {
+    const DeadlineStats stats = MeasureDeadline(sampleRate, scenario);

     constexpr std::size_t kBlockFrames = 256;
     constexpr std::size_t kMeasuredBlocks = 512;
     constexpr std::size_t kWarmupBlocks = 64;
     const std::size_t expectedProcessedHostFrames = (kWarmupBlocks + kMeasuredBlocks) * kBlockFrames;

     REQUIRE_TRUE(stats.counters.hostFramesProcessed == expectedProcessedHostFrames);
     REQUIRE_TRUE(stats.counters.internalSubframesProcessed == expectedProcessedHostFrames * 4);
     REQUIRE_TRUE(stats.counters.lastInternalSampleIndex == expectedProcessedHostFrames * 4 - 1);
     REQUIRE_TRUE(stats.contiguousLeft.size() == kBlockFrames * 2);
@@ -189,40 +218,49 @@ void AssertDeadlineAndContinuity(double sampleRate) {
     REQUIRE_TRUE(stats.splitRight.size() == stats.contiguousRight.size());

     for (std::size_t frame = 0; frame < stats.contiguousLeft.size(); ++frame) {
         REQUIRE_NEAR(stats.splitLeft[frame], stats.contiguousLeft[frame], 0.000001);
         REQUIRE_NEAR(stats.splitRight[frame], stats.contiguousRight[frame], 0.000001);
     }

     REQUIRE_TRUE(stats.averageSeconds <= stats.blockSeconds * 0.60);
     REQUIRE_TRUE(stats.p99Seconds <= stats.blockSeconds * 0.80);

-    std::cout << "[deadline] " << stats.sampleRate << "Hz avg="
+    std::cout << "[deadline] " << DeadlineScenarioName(stats.scenario) << " "
+              << stats.sampleRate << "Hz/" << (stats.sampleRate * 4.0) << "Hz-internal avg="
               << (stats.averageSeconds * 1000.0) << "ms p99="
               << (stats.p99Seconds * 1000.0) << "ms block="
               << (stats.blockSeconds * 1000.0) << "ms\n";
 }

 } // namespace

 TEST_CASE(braid4_meets_44100hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(44100.0);
 }

 TEST_CASE(braid4_meets_48000hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(48000.0);
 }

 TEST_CASE(braid4_meets_96000hz_256_frame_deadline_and_continuity) {
     AssertDeadlineAndContinuity(96000.0);
 }

+TEST_CASE(braid4_sparse_modulation_meets_48000hz_256_frame_deadline) {
+    AssertDeadlineAndContinuity(48000.0, DeadlineScenario::SparseActive);
+}
+
+TEST_CASE(braid4_sparse_modulation_meets_96000hz_256_frame_deadline) {
+    AssertDeadlineAndContinuity(96000.0, DeadlineScenario::SparseActive);
+}
+
 int main() {
     int failures = 0;
     for (const auto& test : Registry()) {
         try {
             test.fn();
             std::cout << "[PASS] " << test.name << "\n";
         } catch (const std::exception& e) {
             ++failures;
             std::cerr << "[FAIL] " << test.name << ": " << e.what() << "\n";
         } catch (...) {
diff --git a/projects/synth/tests/braid4_system_tests.cpp b/projects/synth/tests/braid4_system_tests.cpp
index 3d62aa38..c7bb1dc6 100644
--- a/projects/synth/tests/braid4_system_tests.cpp
+++ b/projects/synth/tests/braid4_system_tests.cpp
@@ -99,20 +99,126 @@ bool HasPolyline(const std::vector<synth::ui::DrawCommand>& commands) {
     return std::any_of(commands.begin(), commands.end(), [](const synth::ui::DrawCommand& command) {
         return command.kind == synth::ui::DrawCommand::Kind::Polyline;
     });
 }

 struct EngineRunResult {
     std::vector<std::vector<float>> channels;
     synth_braid4::Braid4Core::DebugCounterState counters;
 };

+enum class Braid4WorkScenario {
+    Baseline,
+    MaterializedNeutral,
+    SparseActive,
+    Inactive64Gestures,
+};
+
+struct Braid4WorkResult {
+    std::size_t topLevelProcessLiteCalls = 0;
+    std::size_t activeRouteVisits = 0;
+    std::size_t activeGestureVisits = 0;
+    std::size_t internalSubframesProcessed = 0;
+    std::size_t materializedLocalCount = 0;
+    std::size_t remainingMaterializableSlots = 0;
+    std::size_t denseConfiguredRouteVisits = 0;
+};
+
+Braid4WorkResult MeasureBraid4Work(Braid4WorkScenario scenario) {
+    constexpr std::size_t kHostFrames = 32;
+    std::uint64_t timestamp = 0;
+    synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
+    if (scenario == Braid4WorkScenario::Inactive64Gestures) {
+        REQUIRE_TRUE(engine.Manager().SetGestureCount(64));
+    }
+    engine.SetRuntimeDataPaths(UseScratchRuntimeDataPaths("braid4_sparse_work_counters"));
+    engine.Initialize();
+    engine.Prepare(48000.0, static_cast<int>(kHostFrames));
+
+    auto& core = engine.Application();
+    synth::ParameterManager& manager = engine.Manager();
+    const std::array<synth::ParameterGroup*, 3> groups{
+        core.StereoGroup(),
+        core.QuadGroup(),
+        core.MonoGroup(),
+    };
+
+    Braid4WorkResult result;
+    if (scenario == Braid4WorkScenario::MaterializedNeutral) {
+        for (synth::ParameterGroup* group : groups) {
+            const std::size_t availableBefore = group->AvailableParameterSlots();
+            std::size_t materialized = 0;
+            std::vector<synth::Parameter*> frontier;
+            for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
+                synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
+                if (&parameter.Group() == group) {
+                    frontier.push_back(&parameter);
+                }
+            }
+            for (std::size_t parameterIx = 0;
+                 parameterIx < frontier.size() && group->AvailableParameterSlots() != 0;
+                 ++parameterIx) {
+                for (std::size_t sourceIx = 0;
+                     sourceIx < group->Config().numModulators && group->AvailableParameterSlots() != 0;
+                     ++sourceIx) {
+                    synth::Parameter* depth = frontier[parameterIx]->EnsureModulationDepth(sourceIx);
+                    REQUIRE_TRUE(depth != nullptr);
+                    frontier.push_back(depth);
+                    ++materialized;
+                }
+            }
+            REQUIRE_TRUE(materialized == availableBefore);
+            result.materializedLocalCount += materialized;
+            result.remainingMaterializableSlots += group->AvailableParameterSlots();
+        }
+    } else if (scenario == Braid4WorkScenario::SparseActive) {
+        synth::Parameter& parameter = manager.ParameterById(0);
+        synth::Parameter* depth = parameter.EnsureModulationDepth(0);
+        REQUIRE_TRUE(depth != nullptr);
+        depth->SceneCenter(0) = 0.75f;
+        depth->SceneCenter(1) = 0.75f;
+        manager.ComputeAllParameters();
+    }
+
+    std::array<synth::ParameterProcessingObserver, 3> work{};
+    for (std::size_t groupIx = 0; groupIx < groups.size(); ++groupIx) {
+        groups[groupIx]->SetProcessingObserverForTests(&work[groupIx]);
+    }
+
+    std::array<std::vector<float>, 2> blockStorage{{
+        std::vector<float>(kHostFrames, 0.0f),
+        std::vector<float>(kHostFrames, 0.0f),
+    }};
+    std::vector<float*> outputs{blockStorage[0].data(), blockStorage[1].data()};
+    synth::AudioBlock block{
+        .outputs = outputs.data(),
+        .numOutputChannels = 2,
+        .numFrames = kHostFrames,
+    };
+    engine.ProcessBlock(block, timestamp++);
+
+    result.internalSubframesProcessed = core.DebugCounters().internalSubframesProcessed;
+    for (const synth::ParameterProcessingObserver& observer : work) {
+        result.topLevelProcessLiteCalls += observer.topLevelProcessLiteCalls;
+        result.activeRouteVisits += observer.activeRouteVisits;
+        result.activeGestureVisits += observer.activeGestureVisits;
+    }
+    std::size_t denseVisitsPerSubframe = 0;
+    for (std::size_t parameterIx = 0; parameterIx < manager.ParameterCount(); ++parameterIx) {
+        const synth::Parameter& parameter = manager.ParameterById(static_cast<synth::ParameterId>(parameterIx));
+        denseVisitsPerSubframe += parameter.Group().Config().numVoices *
+                                  parameter.Group().Config().numModulators;
+    }
+    result.denseConfiguredRouteVisits = result.internalSubframesProcessed * denseVisitsPerSubframe;
+    return result;
+}
+
 EngineRunResult RunFreshEngineSegments(int outputChannels, const std::vector<std::size_t>& segmentFrames) {
     std::uint64_t timestamp = 0;
     synth::Engine<synth_braid4::Braid4Core> engine([&timestamp] { return timestamp++; });
     engine.Initialize();
     engine.Prepare(synth_braid4::Braid4Core::Config().preferredSampleRate,
                    synth_braid4::Braid4Core::Config().preferredBlockSize);

     std::vector<std::vector<float>> captured(static_cast<std::size_t>(std::max(outputChannels, 0)));
     for (const std::size_t frames : segmentFrames) {
         std::vector<std::vector<float>> blockStorage(static_cast<std::size_t>(std::max(outputChannels, 0)),
@@ -464,20 +570,40 @@ TEST_CASE(braid4_parameter_processing_ignores_materialized_local_depths) {
     for (synth::ParameterGroup* group : groups) {
         group->ProcessSample(1);
     }

     const std::size_t visited = work[0].topLevelProcessLiteCalls +
                                 work[1].topLevelProcessLiteCalls +
                                 work[2].topLevelProcessLiteCalls;
     REQUIRE_TRUE(visited == rootCount);
 }

+TEST_CASE(braid4_sparse_work_counters_bound_inactive_capacity) {
+    const Braid4WorkResult baseline = MeasureBraid4Work(Braid4WorkScenario::Baseline);
+    const Braid4WorkResult neutral = MeasureBraid4Work(Braid4WorkScenario::MaterializedNeutral);
+    const Braid4WorkResult sparse = MeasureBraid4Work(Braid4WorkScenario::SparseActive);
+    const Braid4WorkResult inactive64 = MeasureBraid4Work(Braid4WorkScenario::Inactive64Gestures);
+
+    REQUIRE_TRUE(neutral.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(sparse.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(inactive64.topLevelProcessLiteCalls == baseline.topLevelProcessLiteCalls);
+    REQUIRE_TRUE(neutral.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(sparse.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(inactive64.internalSubframesProcessed == baseline.internalSubframesProcessed);
+    REQUIRE_TRUE(neutral.materializedLocalCount > 0);
+    REQUIRE_TRUE(neutral.remainingMaterializableSlots == 0);
+    REQUIRE_TRUE(neutral.activeRouteVisits == 0);
+    REQUIRE_TRUE(inactive64.activeGestureVisits == 0);
+    REQUIRE_TRUE(sparse.activeRouteVisits > 0);
+    REQUIRE_TRUE(sparse.activeRouteVisits < sparse.denseConfiguredRouteVisits);
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
