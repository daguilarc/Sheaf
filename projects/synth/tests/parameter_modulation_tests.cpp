#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <optional>
#include <random>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

} // namespace

TEST_CASE(smoke_clamps_ranges) {
    REQUIRE_NEAR(synth::ClampToRange(2.0f, synth::RangeKind::Unipolar), 1.0f, 0.0001f);
    REQUIRE_NEAR(synth::ClampToRange(-2.0f, synth::RangeKind::Bipolar), -1.0f, 0.0001f);
}

TEST_CASE(group_config_validation) {
    synth::ParameterGroupConfig valid{
        .numVoices = 4,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 8,
        .processLiteAlpha = 0.5f,
    };
    REQUIRE_TRUE(valid.IsValid());
    const synth::ParameterGroupConfig zeroVoices{.numVoices = 0, .numScenes = 1, .maxParameters = 1};
    const synth::ParameterGroupConfig zeroScenes{.numVoices = 1, .numScenes = 0, .maxParameters = 1};
    const synth::ParameterGroupConfig zeroMaxParameters{.numVoices = 1, .numScenes = 1, .maxParameters = 0};
    const synth::ParameterGroupConfig lowAlpha{
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = -0.01f,
    };
    const synth::ParameterGroupConfig highAlpha{
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.01f,
    };
    REQUIRE_TRUE(!zeroVoices.IsValid());
    REQUIRE_TRUE(!zeroScenes.IsValid());
    REQUIRE_TRUE(!zeroMaxParameters.IsValid());
    REQUIRE_TRUE(!lowAlpha.IsValid());
    REQUIRE_TRUE(!highAlpha.IsValid());
}

TEST_CASE(manager_assigns_unique_ids) {
    synth::ParameterManager manager;
    auto& groupA = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& groupB = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });

    REQUIRE_TRUE(groupA.CanAllocate());
    REQUIRE_TRUE(groupB.CanAllocate());
    auto& first = manager.CreateParameter(groupA, {.name = "A1", .defaultValue = 0.1f});
    auto& second = manager.CreateParameter(groupB, {.name = "B1", .defaultValue = 0.2f});
    auto& third = manager.CreateParameter(groupA, {.name = "A2", .defaultValue = 0.3f});
    REQUIRE_TRUE(first.Id() != second.Id());
    REQUIRE_TRUE(second.Id() != third.Id());
    REQUIRE_TRUE(first.Id() == 1);
    REQUIRE_TRUE(second.Id() == 2);
    REQUIRE_TRUE(third.Id() == 3);
}

TEST_CASE(modulators_use_voice_major_dot_product) {
    synth::Modulators modulators(3, 3);
    modulators.Value(2, 0) = 0.25f;
    modulators.Value(2, 1) = -0.5f;
    modulators.Value(2, 2) = 1.0f;

    const float depths[] = {0.4f, 0.2f, -0.1f};
    REQUIRE_NEAR(modulators.Apply(2, std::span<const float>(depths)), -0.1f, 0.0001f);
}

TEST_CASE(modulator_metadata_is_not_per_voice) {
    synth::Modulators modulators(3, 2);
    modulators.Metadata(1).name = "LFO";
    modulators.Metadata(1).color = {.r = 12, .g = 34, .b = 56};
    modulators.Metadata(1).connected = true;

    modulators.Value(0, 1) = 0.25f;
    modulators.Value(2, 1) = -0.75f;

    REQUIRE_TRUE(modulators.Metadata(1).name == "LFO");
    REQUIRE_TRUE(modulators.Metadata(1).color.g == 34);
    REQUIRE_TRUE(modulators.Metadata(1).connected);
    REQUIRE_NEAR(modulators.Value(0, 1), 0.25f, 0.0001f);
    REQUIRE_NEAR(modulators.Value(2, 1), -0.75f, 0.0001f);
}

TEST_CASE(gestures_store_values_and_selection) {
    synth::Gestures gestures(2);
    gestures.Metadata(1).name = "Pressure";
    gestures.Metadata(1).color = {.r = 200, .g = 20, .b = 30};

    gestures.Value(1) = 0.75f;
    gestures.Select(1, true);

    REQUIRE_NEAR(gestures.Value(1), 0.75f, 0.0001f);
    REQUIRE_TRUE(gestures.Selected(1));
    REQUIRE_TRUE(gestures.Metadata(1).name == "Pressure");

    gestures.ClearSelection();
    REQUIRE_TRUE(!gestures.Selected(1));
    REQUIRE_NEAR(gestures.Value(1), 0.75f, 0.0001f);
}

TEST_CASE(parameter_default_state) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 2,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 1,
    });

    auto& parameter = manager.CreateParameter(group, {
        .name = "Cutoff",
        .shortName = "Cut",
        .defaultValue = 0.3f,
        .range = synth::RangeKind::Unipolar,
    });

    REQUIRE_TRUE(parameter.Id() == 1);
    REQUIRE_TRUE(parameter.Name() == "Cutoff");
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
    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(1)[1], 0.0f, 0.0001f);
}

TEST_CASE(allocator_exhaustion_does_not_register_partial_parameter) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });

    auto& first = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.1f});
    REQUIRE_TRUE(first.Id() == 1);
    REQUIRE_TRUE(group.ParameterCount() == 1);
    REQUIRE_TRUE(!group.CanAllocate());

    bool threw = false;
    try {
        (void)manager.CreateParameter(group, {.name = "B", .defaultValue = 0.2f});
    } catch (const std::length_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(group.ParameterCount() == 1);
    REQUIRE_TRUE(first.Id() == 1);
    REQUIRE_TRUE(manager.NextParameterId() == 2);
}

TEST_CASE(stable_parameter_pointers_survive_later_allocations) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 3,
    });

    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.1f});
    synth::Parameter* firstPtr = &first;
    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.2f});
    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.3f});

    REQUIRE_TRUE(&first == firstPtr);
    REQUIRE_TRUE(firstPtr->Id() == 1);
    REQUIRE_TRUE(second.Id() == 2);
    REQUIRE_TRUE(third.Id() == 3);
    REQUIRE_TRUE(group.ParameterCount() == 3);
}

TEST_CASE(scene_and_gesture_interpolation) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });

    auto& sceneOnly = manager.CreateParameter(group, {.name = "Scene", .defaultValue = 0.0f});
    sceneOnly.SceneCenter(0) = 0.2f;
    sceneOnly.SceneCenter(1) = 0.8f;
    sceneOnly.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.25f});
    REQUIRE_NEAR(sceneOnly.TargetCenter(), 0.35f, 0.0001f);

    auto& gesture = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.4f});
    gesture.SceneCenter(0) = 0.4f;
    gesture.SceneCenter(1) = 0.4f;
    gesture.GestureValue(0, 0) = 0.9f;
    gesture.GestureValue(1, 0) = 0.9f;
    gesture.SetGestureActive(0, 0, true);
    gesture.SetGestureActive(1, 0, true);
    group.GetGestures().Value(0) = 0.5f;
    gesture.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.25f});
    REQUIRE_NEAR(gesture.TargetCenter(), 0.65f, 0.0001f);
}

TEST_CASE(multiple_gestures_use_effective_weighted_average) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 2,
        .numScenes = 1,
        .maxParameters = 1,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "GestureMix", .defaultValue = 0.0f});
    parameter.SceneCenter(0) = 0.0f;
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.GestureValue(0, 1) = 1.0f;
    parameter.SetGestureActive(0, 0, true);
    parameter.SetGestureActive(0, 1, true);
    group.GetGestures().Value(0) = 0.2f;
    group.GetGestures().Value(1) = 0.8f;

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenter(), 0.68f, 0.0001f);
}

TEST_CASE(modulation_normalization_under_one) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 2,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.25f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.75f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
}

TEST_CASE(modulation_normalization_over_one_preserves_sign) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 3,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& positive = manager.CreateParameter(group, {
        .name = "Positive",
        .defaultValue = 1.0f,
        .range = synth::RangeKind::Bipolar,
    });
    auto& negative = manager.CreateParameter(group, {
        .name = "Negative",
        .defaultValue = -1.0f,
        .range = synth::RangeKind::Bipolar,
    });
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
    REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);
}

TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 2,
        .maxParameters = 2,
        .processLiteAlpha = 0.1f,
    });

    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.0f});
    depth.SceneCenter(0) = 0.8f;
    depth.SceneCenter(1) = 0.8f;
    REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));

    carrier.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});

    REQUIRE_TRUE(depth.RecursionDepth() == 1);
    REQUIRE_NEAR(depth.CurrentCenter(), 0.8f, 0.0001f);
    REQUIRE_NEAR(depth.Get(0), 0.8f, 0.0001f);
    REQUIRE_NEAR(carrier.TargetDepths(0)[0], 0.8f, 0.0001f);
    REQUIRE_NEAR(carrier.TargetCenterScale(0), 0.2f, 0.0001f);
}

TEST_CASE(process_lite_slews_center_scale_and_depths) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 2,
        .maxParameters = 2,
        .processLiteAlpha = 0.25f,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 1.0f;
    parameter.SceneCenter(1) = 1.0f;
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

    parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
    parameter.ProcessLite();

    REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenterScale(0), 0.875f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.125f, 0.0001f);
}

TEST_CASE(cycle_rejection_direct_and_indirect) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 3,
    });

    auto& a = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.1f});
    auto& b = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.2f});
    auto& c = manager.CreateParameter(group, {.name = "C", .defaultValue = 0.3f});

    REQUIRE_TRUE(!a.AssignModulationDepth(0, &a));
    REQUIRE_TRUE(a.ModulationDepthParameter(0) == nullptr);
    REQUIRE_TRUE(a.AssignModulationDepth(0, &b));
    REQUIRE_TRUE(b.AssignModulationDepth(0, &c));
    REQUIRE_TRUE(!c.AssignModulationDepth(0, &a));
    REQUIRE_TRUE(c.ModulationDepthParameter(0) == nullptr);
    REQUIRE_TRUE(a.ModulationDepthParameter(0) == &b);
}

TEST_CASE(get_clamps_and_rejects_out_of_range_voice) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Clamp", .defaultValue = 1.0f});
    group.GetModulators().Value(0, 0) = 1.0f;
    parameter.TargetDepths(0)[0] = 1.0f;
    parameter.ProcessLite();

    REQUIRE_NEAR(parameter.Get(0), 1.0f, 0.0001f);

    bool threw = false;
    try {
        (void)parameter.Get(1);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(handle_inc_dec_endpoint_scene) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Edit", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.4f;
    parameter.SceneCenter(1) = 0.8f;

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.7f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(1), 0.8f, 0.0001f);
}

TEST_CASE(handle_inc_dec_mid_blend_matches_smart_grid_attenuation) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Edit", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.5f;
    parameter.SceneCenter(1) = 0.5f;

    const synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.5f};
    parameter.HandleIncDec(scene, 0.2f);
    parameter.Compute(scene);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.6f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(1), 0.6f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.6f, 0.0001f);
}

TEST_CASE(handle_inc_dec_saturation_solve_matches_smart_grid) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Edit", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.9f;
    parameter.SceneCenter(1) = 0.2f;

    const synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.25f};
    parameter.HandleIncDec(scene, 0.2f);
    parameter.Compute(scene);

    REQUIRE_NEAR(parameter.SceneCenter(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(1), 0.7f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.925f, 0.0001f);
}

TEST_CASE(selected_gesture_activation_snapshots_parent_value) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.1f});
    parameter.SceneCenter(0) = 0.25f;
    parameter.SceneCenter(1) = 0.75f;
    parameter.GestureValue(0, 0) = 0.9f;
    parameter.GestureValue(1, 0) = 0.9f;
    group.GetGestures().Select(0, true);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.0f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.9f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_one_edits_gesture_without_moving_base) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.5f;
    parameter.GestureValue(0, 0) = 0.5f;
    group.GetGestures().Select(0, true);
    group.GetGestures().Value(0) = 1.0f;

    const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
    parameter.HandleIncDec(scene, 0.2f);
    parameter.Compute(scene);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.7f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.7f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_biases_gesture_edit_over_base_edit) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.5f;
    parameter.GestureValue(0, 0) = 0.5f;
    group.GetGestures().Select(0, true);
    group.GetGestures().Value(0) = 0.75f;

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.2f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.55f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.65f, 0.0001f);
}

TEST_CASE(selected_gesture_mid_blend_activates_both_scenes) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.2f;
    parameter.SceneCenter(1) = 0.8f;
    group.GetGestures().Select(0, true);
    group.GetGestures().Value(0) = 0.5f;

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.5f}, 0.0f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.2f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.8f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_sum_over_one_leaves_base_unmoved) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 2,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    group.GetGestures().Select(0, true);
    group.GetGestures().Select(1, true);
    group.GetGestures().Value(0) = 0.8f;
    group.GetGestures().Value(1) = 0.7f;

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.3f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.66f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 1), 0.64f, 0.0001f);
}

TEST_CASE(handle_inc_dec_negative_saturates_lower_bound) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numGestures = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Edit", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.1f;

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, -0.4f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.0f, 0.0001f);
}

TEST_CASE(revert_to_default_clears_modulation_and_gestures) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 2,
        .processLiteAlpha = 1.0f,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 1.0f});
    parameter.SceneCenter(0) = 0.9f;
    parameter.SceneCenter(1) = 0.8f;
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.GestureValue(1, 0) = 0.0f;
    parameter.SetGestureActive(0, 0, true);
    parameter.SetGestureActive(1, 0, true);
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.5f});
    parameter.ProcessLite();
    REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);

    const synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.5f};
    parameter.RevertToDefault(scene);
    parameter.Compute(scene);
    parameter.ProcessLite();

    REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == nullptr);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.4f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(1), 0.4f, 0.0001f);
    REQUIRE_TRUE(!parameter.GestureActive(0, 0));
    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.0f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(1)[0], 0.0f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenter(), 0.4f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.4f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenterScale(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenterScale(1), 1.0f, 0.0001f);
    REQUIRE_NEAR(parameter.Get(0), 0.4f, 0.0001f);
    REQUIRE_NEAR(parameter.Get(1), 0.4f, 0.0001f);
}

TEST_CASE(revert_to_default_rejects_invalid_scene_without_mutation) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 1,
        .numScenes = 1,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.9f;
    parameter.SetGestureActive(0, 0, true);
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    parameter.TargetDepths(0)[0] = 0.75f;
    parameter.CurrentDepths(0)[0] = 0.5f;

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
    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.75f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], 0.5f, 0.0001f);
}

TEST_CASE(page_routing_changes_without_mutating_parameter_state) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numGestures = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .defaultValue = 0.4f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.25f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    parameter.SceneCenter(0) = 0.7f;
    parameter.GestureValue(0, 0) = 0.9f;
    parameter.SetGestureActive(0, 0, true);
    group.GetGestures().Value(0) = 0.5f;
    group.GetModulators().Value(0, 0) = 0.25f;

    auto& pageA = manager.CreatePage("A");
    auto& pageB = manager.CreatePage("B");
    manager.AssignParameterToPage(pageA.ordinal, parameter);
    manager.AssignParameterToPage(pageB.ordinal, depth);
    REQUIRE_TRUE(manager.ActivePage() == &pageA);

    const float sceneCenter = parameter.SceneCenter(0);
    const float gestureValue = parameter.GestureValue(0, 0);
    const bool gestureActive = parameter.GestureActive(0, 0);
    const float modulatorValue = group.GetModulators().Value(0, 0);
    synth::Parameter* route = parameter.ModulationDepthParameter(0);

    REQUIRE_TRUE(manager.SelectActivePage(pageB.ordinal));

    REQUIRE_TRUE(manager.ActivePage() == &pageB);
    REQUIRE_NEAR(parameter.SceneCenter(0), sceneCenter, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), gestureValue, 0.0001f);
    REQUIRE_TRUE(parameter.GestureActive(0, 0) == gestureActive);
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), modulatorValue, 0.0001f);
    REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == route);
}

TEST_CASE(mixed_group_bank_routes_each_parameter_to_its_group) {
    synth::ParameterManager manager;
    auto& groupA = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& groupB = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& a = manager.CreateParameter(groupA, {.name = "A", .defaultValue = 0.1f});
    auto& b = manager.CreateParameter(groupB, {.name = "B", .defaultValue = 0.2f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, a);
    bank.AddMapping(11, b);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);

    manager.HandleTick(10, 0.2f);
    manager.HandleTick(11, 0.3f);

    REQUIRE_NEAR(a.SceneCenter(0), 0.3f, 0.0001f);
    REQUIRE_NEAR(b.SceneCenter(0), 0.5f, 0.0001f);
}

TEST_CASE(press_opens_modulation_view_and_return_cell_closes_it) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depthA = manager.CreateParameter(group, {.name = "DepthA", .defaultValue = 0.1f});
    auto& depthB = manager.CreateParameter(group, {.name = "DepthB", .defaultValue = 0.2f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depthA));
    REQUIRE_TRUE(parameter.AssignModulationDepth(1, &depthB));
    auto& bank = manager.CreateBank();
    bank.AddMapping(1, parameter);
    bank.AddMapping(2, depthA);
    bank.AddMapping(3, depthB);

    bank.HandlePress(1);

    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_TRUE(bank.SelectedParameter() == &parameter);
    REQUIRE_TRUE(bank.ReturnParameter() == &parameter);
    REQUIRE_TRUE(bank.VisibleMappingCount() == 3);
    REQUIRE_TRUE(bank.VisibleParameter(1) == &depthA);
    REQUIRE_TRUE(bank.VisibleParameter(2) == &depthB);
    REQUIRE_TRUE(bank.VisibleParameter(3) == &parameter);

    bank.HandlePress(3);

    REQUIRE_TRUE(!bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleParameter(1) == &parameter);
}

TEST_CASE(modulation_view_reserves_return_cell_when_bank_is_undersized) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& depthA = manager.CreateParameter(group, {.name = "DepthA", .defaultValue = 0.1f});
    auto& depthB = manager.CreateParameter(group, {.name = "DepthB", .defaultValue = 0.2f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depthA));
    REQUIRE_TRUE(parameter.AssignModulationDepth(1, &depthB));
    parameter.SceneCenter(0) = 0.8f;
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    bank.AddMapping(11, depthA);

    bank.HandlePress(10);

    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleMappingCount() == 2);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &depthA);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &parameter);
    REQUIRE_TRUE(bank.ReturnParameter() == &parameter);

    bank.HandleTick(11, {.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.1f);
    bank.HandleShiftPress(11, {.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.8f, 0.0001f);

    bank.HandlePress(11);

    REQUIRE_TRUE(!bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleParameter(10) == &parameter);
}

TEST_CASE(modulation_view_materializes_missing_depth_parameter_when_capacity_allows) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& filler = manager.CreateParameter(group, {.name = "Filler", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(1, carrier);
    bank.AddMapping(2, filler);

    bank.HandlePress(1);

    synth::Parameter* depth = carrier.ModulationDepthParameter(0);
    REQUIRE_TRUE(depth != nullptr);
    REQUIRE_TRUE(group.ParameterCount() == 3);
    REQUIRE_TRUE(depth->Range() == synth::RangeKind::Bipolar);
    REQUIRE_NEAR(depth->SceneCenter(0), 0.0f, 0.0001f);
    REQUIRE_TRUE(bank.VisibleParameter(1) == depth);
    REQUIRE_TRUE(bank.VisibleParameter(2) == &carrier);
    REQUIRE_TRUE(bank.ReturnParameter() == &carrier);

    bank.HandleTick(1, {.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.2f);

    REQUIRE_NEAR(depth->SceneCenter(0), 0.2f, 0.0001f);
}

TEST_CASE(pressing_modulation_cell_opens_nested_modulation_view) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.2f});
    auto& nested = manager.CreateParameter(group, {.name = "Nested", .defaultValue = 0.1f});
    REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));
    REQUIRE_TRUE(depth.AssignModulationDepth(0, &nested));
    auto& bank = manager.CreateBank();
    bank.AddMapping(1, carrier);
    bank.AddMapping(2, depth);

    bank.HandlePress(1);
    bank.HandlePress(1);

    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_TRUE(bank.SelectedParameter() == &depth);
    REQUIRE_TRUE(bank.ReturnParameter() == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(1) == &nested);
    REQUIRE_TRUE(bank.VisibleParameter(2) == &depth);
}

TEST_CASE(slot_bank_switch_deselects_prior_modulation_view) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.1f});
    auto& other = manager.CreateParameter(group, {.name = "Other", .defaultValue = 0.2f});
    REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));
    auto& first = manager.CreateBank();
    first.AddMapping(1, carrier);
    first.AddMapping(2, depth);
    auto& second = manager.CreateBank();
    second.AddMapping(1, other);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(1);
    slot.AddPhysicalEncoder(2);
    slot.SelectBank(&first);
    slot.HandlePress(1);
    REQUIRE_TRUE(first.ShowingModulation());

    slot.SelectBank(&second);

    REQUIRE_TRUE(!first.ShowingModulation());
    REQUIRE_TRUE(slot.SelectedBank() == &second);
}

TEST_CASE(routed_tick_dispatches_to_selected_bank) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& selected = manager.CreateParameter(group, {.name = "Selected", .defaultValue = 0.25f});
    auto& unselected = manager.CreateParameter(group, {.name = "Unselected", .defaultValue = 0.5f});
    auto& first = manager.CreateBank();
    first.AddMapping(1, selected);
    auto& second = manager.CreateBank();
    second.AddMapping(1, unselected);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(1);
    slot.SelectBank(&first);

    manager.HandleTick(1, 0.15f);

    REQUIRE_NEAR(selected.SceneCenter(0), 0.4f, 0.0001f);
    REQUIRE_NEAR(unselected.SceneCenter(0), 0.5f, 0.0001f);
}

TEST_CASE(shift_press_resets_visible_parameter_to_default) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "Reset", .defaultValue = 0.35f});
    parameter.SceneCenter(0) = 0.9f;
    auto& bank = manager.CreateBank();
    bank.AddMapping(4, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(4);
    slot.SelectBank(&bank);

    manager.HandleShiftPress(4);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.35f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenter(), 0.35f, 0.0001f);
}

TEST_CASE(unmapped_encoder_ignored) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "Stable", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(1, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(1);
    slot.SelectBank(&bank);

    manager.HandleTick(99, 0.5f);
    manager.HandlePress(99);
    manager.HandleShiftPress(99);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
    REQUIRE_TRUE(!bank.ShowingModulation());
}

TEST_CASE(external_gesture_selection_and_value_api) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numGestures = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.2f});
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.SetGestureActive(0, 0, true);

    manager.SelectGesture(group, 0);
    manager.SetGestureValue(group, 0, 0.75f);
    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_TRUE(manager.GestureSelected(group, 0));
    REQUIRE_NEAR(manager.GestureValue(group, 0), 0.75f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.8f, 0.0001f);

    manager.DeselectGesture(group, 0);
    REQUIRE_TRUE(!manager.GestureSelected(group, 0));
}

TEST_CASE(clear_gesture_active_flags_for_active_scene_selection) {
    synth::ParameterManager manager;
    manager.Scene() = {.leftScene = 0, .rightScene = 1, .blend = 0.5f};
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numGestures = 1,
        .numScenes = 3,
        .maxParameters = 2,
    });
    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.2f});
    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.3f});
    first.SetGestureActive(0, 0, true);
    first.SetGestureActive(1, 0, true);
    first.SetGestureActive(2, 0, true);
    second.SetGestureActive(0, 0, true);
    second.SetGestureActive(1, 0, true);

    manager.ClearGestureActiveFlagsForActiveSceneSelection(group, 0);

    REQUIRE_TRUE(!first.GestureActive(0, 0));
    REQUIRE_TRUE(!first.GestureActive(1, 0));
    REQUIRE_TRUE(first.GestureActive(2, 0));
    REQUIRE_TRUE(!second.GestureActive(0, 0));
    REQUIRE_TRUE(!second.GestureActive(1, 0));
}

namespace {

constexpr std::size_t kSimParams = 3;
constexpr std::size_t kSimVoices = 4;
constexpr std::size_t kSimMods = 3;
constexpr std::size_t kSimGestures = 2;
constexpr std::size_t kSimScenes = 3;

struct SimCell {
    synth::PhysicalEncoderId encoder = 0;
    int parameter = -1;
    bool returnCell = false;
};

struct SimBank {
    std::vector<SimCell> top;
    std::vector<SimCell> visible;
    int selectedParameter = -1;
};

struct SimParam {
    synth::RangeKind range = synth::RangeKind::Unipolar;
    float defaultValue = 0.0f;
    std::array<float, kSimScenes> sceneCenter{};
    std::array<std::array<float, kSimGestures>, kSimScenes> gestureValue{};
    std::array<std::array<bool, kSimGestures>, kSimScenes> gestureActive{};
    std::array<int, kSimMods> route{};
    float currentCenter = 0.0f;
    float targetCenter = 0.0f;
    std::array<float, kSimVoices> currentCenterScale{};
    std::array<float, kSimVoices> targetCenterScale{};
    std::array<std::array<float, kSimMods>, kSimVoices> currentDepth{};
    std::array<std::array<float, kSimMods>, kSimVoices> targetDepth{};
};

struct SimOracle {
    synth::SceneState scene{.leftScene = 0, .rightScene = 1, .blend = 0.25f};
    std::optional<synth::PageOrdinal> activePage = 0;
    int selectedBank = 0;
    std::array<SimBank, 2> banks;
    std::array<float, kSimGestures> gestureWeight{};
    std::array<bool, kSimGestures> gestureSelected{};
    std::array<std::array<float, kSimMods>, kSimVoices> modulatorValue{};
    std::array<SimParam, kSimParams> params;
};

float SimClamp(float value, synth::RangeKind range) {
    return synth::ClampToRange(value, range);
}

float SimBlend(float left, float right, float blend) {
    return left * (1.0f - blend) + right * blend;
}

void SimApplySceneDistribution(float& left, float& right, float blend, float delta, synth::RangeKind range) {
    blend = std::clamp(blend, 0.0f, 1.0f);
    if (&left == &right) {
        left = SimClamp(left + delta, range);
        return;
    }
    if (blend <= 0.0f) {
        left = SimClamp(left + delta, range);
        return;
    }
    if (blend >= 1.0f) {
        right = SimClamp(right + delta, range);
        return;
    }

    const float inverseBlend = 1.0f - blend;
    const float targetBlended = SimClamp(SimBlend(left, right, blend) + delta, range);
    const float proposedLeft = left + delta * inverseBlend;
    const float proposedRight = right + delta * blend;

    if (SimClamp(proposedLeft, range) != proposedLeft) {
        left = SimClamp(proposedLeft, range);
        right = (targetBlended - left * inverseBlend) / blend;
    } else if (SimClamp(proposedRight, range) != proposedRight) {
        right = SimClamp(proposedRight, range);
        left = (targetBlended - right * blend) / inverseBlend;
    } else {
        left = proposedLeft;
        right = proposedRight;
    }
}

void SimDeselect(SimBank& bank) {
    bank.selectedParameter = -1;
    bank.visible = bank.top;
}

SimCell* SimFindCell(SimBank& bank, synth::PhysicalEncoderId encoder) {
    for (auto& cell : bank.visible) {
        if (cell.encoder == encoder) {
            return &cell;
        }
    }
    return nullptr;
}

const SimCell* SimFindCell(const SimBank& bank, synth::PhysicalEncoderId encoder) {
    for (const auto& cell : bank.visible) {
        if (cell.encoder == encoder) {
            return &cell;
        }
    }
    return nullptr;
}

float SimEffectiveGestureWeight(const SimOracle& oracle, const SimParam& parameter, std::size_t gestureIx) {
    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    const float leftWeight =
        parameter.gestureActive[oracle.scene.leftScene][gestureIx] ? oracle.gestureWeight[gestureIx] * (1.0f - blend)
                                                                   : 0.0f;
    const float rightWeight =
        parameter.gestureActive[oracle.scene.rightScene][gestureIx] ? oracle.gestureWeight[gestureIx] * blend : 0.0f;
    return leftWeight + rightWeight;
}

float SimRawCenter(const SimOracle& oracle, const SimParam& parameter) {
    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    const float inverseBlend = 1.0f - blend;
    const float base =
        parameter.sceneCenter[oracle.scene.leftScene] * inverseBlend + parameter.sceneCenter[oracle.scene.rightScene] * blend;

    float weightedMixSum = 0.0f;
    float activeWeightSum = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
        const float effectiveWeight = SimEffectiveGestureWeight(oracle, parameter, gestureIx);
        if (effectiveWeight == 0.0f) {
            continue;
        }
        const float gestureValue = parameter.gestureValue[oracle.scene.leftScene][gestureIx] * inverseBlend +
                                   parameter.gestureValue[oracle.scene.rightScene][gestureIx] * blend;
        const float mix = base * (1.0f - effectiveWeight) + gestureValue * effectiveWeight;
        weightedMixSum += effectiveWeight * mix;
        activeWeightSum += effectiveWeight;
    }

    return activeWeightSum == 0.0f ? base : weightedMixSum / activeWeightSum;
}

float SimGet(const SimOracle& oracle, std::size_t paramIx, std::size_t voiceIx) {
    const SimParam& parameter = oracle.params[paramIx];
    float value = parameter.currentCenter * parameter.currentCenterScale[voiceIx];
    for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
        value += oracle.modulatorValue[voiceIx][modIx] * parameter.currentDepth[voiceIx][modIx];
    }
    return SimClamp(value, parameter.range);
}

void SimComputeAtDepth(SimOracle& oracle, std::size_t paramIx, std::size_t recursionDepth) {
    SimParam& parameter = oracle.params[paramIx];
    parameter.targetCenter = SimClamp(SimRawCenter(oracle, parameter), parameter.range);

    for (const int route : parameter.route) {
        if (route >= 0) {
            SimComputeAtDepth(oracle, static_cast<std::size_t>(route), recursionDepth + 1);
        }
    }

    for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
        float weightSum = 0.0f;
        for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
            const int route = parameter.route[modIx];
            const float depth = route < 0 ? 0.0f : SimGet(oracle, static_cast<std::size_t>(route), voiceIx);
            parameter.targetDepth[voiceIx][modIx] = depth;
            weightSum += std::fabs(depth);
        }

        if (weightSum < 1.0f) {
            parameter.targetCenterScale[voiceIx] = 1.0f - weightSum;
        } else {
            parameter.targetCenterScale[voiceIx] = 0.0f;
            for (float& depth : parameter.targetDepth[voiceIx]) {
                depth /= weightSum;
            }
        }
    }

    if (recursionDepth > 0) {
        parameter.currentCenter = parameter.targetCenter;
        parameter.currentCenterScale = parameter.targetCenterScale;
        parameter.currentDepth = parameter.targetDepth;
    }
}

void SimComputeAll(SimOracle& oracle) {
    for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
        SimComputeAtDepth(oracle, paramIx, 0);
    }
}

void SimProcessLiteAll(SimOracle& oracle) {
    constexpr float alpha = 0.25f;
    for (auto& parameter : oracle.params) {
        parameter.currentCenter += alpha * (parameter.targetCenter - parameter.currentCenter);
        for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
            parameter.currentCenterScale[voiceIx] +=
                alpha * (parameter.targetCenterScale[voiceIx] - parameter.currentCenterScale[voiceIx]);
            for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
                parameter.currentDepth[voiceIx][modIx] +=
                    alpha * (parameter.targetDepth[voiceIx][modIx] - parameter.currentDepth[voiceIx][modIx]);
            }
        }
    }
}

void SimOpenModulationView(SimOracle& oracle, SimBank& bank, int paramIx) {
    bank.selectedParameter = paramIx;
    bank.visible.clear();
    if (bank.top.empty()) {
        return;
    }

    const std::size_t depthCellCount = std::min<std::size_t>(kSimMods, bank.top.size() - 1);
    for (std::size_t cellIx = 0; cellIx < depthCellCount; ++cellIx) {
        bank.visible.push_back({
            .encoder = bank.top[cellIx].encoder,
            .parameter = oracle.params[static_cast<std::size_t>(paramIx)].route[cellIx],
            .returnCell = false,
        });
    }
    bank.visible.push_back({
        .encoder = bank.top[depthCellCount].encoder,
        .parameter = paramIx,
        .returnCell = true,
    });
}

void SimActivateGestureForScene(SimParam& parameter, std::size_t sceneIx, std::size_t gestureIx) {
    if (!parameter.gestureActive[sceneIx][gestureIx]) {
        parameter.gestureValue[sceneIx][gestureIx] = parameter.sceneCenter[sceneIx];
        parameter.gestureActive[sceneIx][gestureIx] = true;
    }
}

void SimHandleIncDec(SimOracle& oracle, SimParam& parameter, float delta) {
    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    bool hasSelectedGesture = false;
    float selectedEffectiveWeightSum = 0.0f;
    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
        if (!oracle.gestureSelected[gestureIx]) {
            continue;
        }
        hasSelectedGesture = true;
        if (blend <= 0.0f) {
            SimActivateGestureForScene(parameter, oracle.scene.leftScene, gestureIx);
        } else if (blend >= 1.0f) {
            SimActivateGestureForScene(parameter, oracle.scene.rightScene, gestureIx);
        } else {
            SimActivateGestureForScene(parameter, oracle.scene.leftScene, gestureIx);
            if (oracle.scene.rightScene != oracle.scene.leftScene) {
                SimActivateGestureForScene(parameter, oracle.scene.rightScene, gestureIx);
            }
        }
        selectedEffectiveWeightSum += SimEffectiveGestureWeight(oracle, parameter, gestureIx);
    }

    if (!hasSelectedGesture) {
        SimApplySceneDistribution(parameter.sceneCenter[oracle.scene.leftScene],
                                  parameter.sceneCenter[oracle.scene.rightScene], blend, delta, parameter.range);
        return;
    }

    const float gestureEditWeight = std::clamp(selectedEffectiveWeightSum, 0.0f, 1.0f);
    SimApplySceneDistribution(parameter.sceneCenter[oracle.scene.leftScene], parameter.sceneCenter[oracle.scene.rightScene],
                              blend, delta * (1.0f - gestureEditWeight), parameter.range);
    if (selectedEffectiveWeightSum == 0.0f) {
        return;
    }

    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
        if (!oracle.gestureSelected[gestureIx]) {
            continue;
        }
        const float effectiveWeight = SimEffectiveGestureWeight(oracle, parameter, gestureIx);
        if (effectiveWeight == 0.0f) {
            continue;
        }
        const float gestureDelta = delta * gestureEditWeight * (effectiveWeight / selectedEffectiveWeightSum);
        SimApplySceneDistribution(parameter.gestureValue[oracle.scene.leftScene][gestureIx],
                                  parameter.gestureValue[oracle.scene.rightScene][gestureIx], blend, gestureDelta,
                                  parameter.range);
    }
}

void SimRevertToDefault(SimOracle& oracle, SimParam& parameter) {
    parameter.route.fill(-1);
    for (auto& row : parameter.currentDepth) {
        row.fill(0.0f);
    }
    for (auto& row : parameter.targetDepth) {
        row.fill(0.0f);
    }

    const float defaultValue = SimClamp(parameter.defaultValue, parameter.range);
    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    auto resetScene = [&](std::size_t sceneIx) {
        parameter.sceneCenter[sceneIx] = defaultValue;
        parameter.gestureActive[sceneIx].fill(false);
    };

    if (blend <= 0.0f) {
        resetScene(oracle.scene.leftScene);
    } else if (blend >= 1.0f) {
        resetScene(oracle.scene.rightScene);
    } else {
        resetScene(oracle.scene.leftScene);
        if (oracle.scene.rightScene != oracle.scene.leftScene) {
            resetScene(oracle.scene.rightScene);
        }
    }

    parameter.currentCenter = defaultValue;
    parameter.targetCenter = defaultValue;
    parameter.currentCenterScale.fill(1.0f);
    parameter.targetCenterScale.fill(1.0f);
}

bool SimEncoderIsPhysical(synth::PhysicalEncoderId encoder) {
    return encoder == 10 || encoder == 11 || encoder == 12 || encoder == 20 || encoder == 21;
}

void SimHandlePress(SimOracle& oracle, synth::PhysicalEncoderId encoder) {
    if (!SimEncoderIsPhysical(encoder)) {
        return;
    }
    SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
    SimCell* cell = SimFindCell(bank, encoder);
    if (cell == nullptr) {
        return;
    }
    if (cell->returnCell) {
        SimDeselect(bank);
        return;
    }
    if (cell->parameter >= 0) {
        SimOpenModulationView(oracle, bank, cell->parameter);
    }
}

void SimHandleTick(SimOracle& oracle, synth::PhysicalEncoderId encoder, float delta) {
    if (!SimEncoderIsPhysical(encoder)) {
        return;
    }
    SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
    SimCell* cell = SimFindCell(bank, encoder);
    if (cell == nullptr || cell->returnCell || cell->parameter < 0) {
        return;
    }
    SimHandleIncDec(oracle, oracle.params[static_cast<std::size_t>(cell->parameter)], delta);
}

void SimHandleShiftPress(SimOracle& oracle, synth::PhysicalEncoderId encoder) {
    if (!SimEncoderIsPhysical(encoder)) {
        return;
    }
    SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
    SimCell* cell = SimFindCell(bank, encoder);
    if (cell == nullptr || cell->returnCell || cell->parameter < 0) {
        return;
    }
    SimRevertToDefault(oracle, oracle.params[static_cast<std::size_t>(cell->parameter)]);
}

void SimSelectBank(SimOracle& oracle, int bankIx) {
    if (oracle.selectedBank != bankIx) {
        SimDeselect(oracle.banks[static_cast<std::size_t>(oracle.selectedBank)]);
    }
    oracle.selectedBank = bankIx;
}

std::vector<unsigned> SimSeedsFromEnvironment() {
    const char* env = std::getenv("SYNTH_RANDOM_SEEDS");
    if (env == nullptr || *env == '\0') {
        return {0x51A7u, 0xC0FFEEu, 0xA11CEu};
    }

    std::vector<unsigned> seeds;
    std::stringstream input(env);
    std::string token;
    while (std::getline(input, token, ',')) {
        if (!token.empty()) {
            seeds.push_back(static_cast<unsigned>(std::stoul(token, nullptr, 0)));
        }
    }
    return seeds.empty() ? std::vector<unsigned>{0x51A7u} : seeds;
}

int SimStepsFromEnvironment() {
    const char* env = std::getenv("SYNTH_RANDOM_STEPS");
    return env == nullptr || *env == '\0' ? 160 : std::max(1, std::atoi(env));
}

void SimFail(unsigned seed, int step, const std::string& action, const std::string& field, float expected, float actual) {
    std::ostringstream oss;
    oss << "seed " << seed << " step " << step << " action " << action << " " << field << " expected " << expected
        << " got " << actual;
    throw std::runtime_error(oss.str());
}

void SimFailBool(unsigned seed, int step, const std::string& action, const std::string& field) {
    std::ostringstream oss;
    oss << "seed " << seed << " step " << step << " action " << action << " mismatch in " << field;
    throw std::runtime_error(oss.str());
}

void SimCheckNear(unsigned seed, int step, const std::string& action, const std::string& field, float expected,
                  float actual, float tolerance = 0.0002f) {
    if (std::fabs(expected - actual) > tolerance) {
        SimFail(seed, step, action, field, expected, actual);
    }
}

std::string SimParamField(const synth::Parameter& parameter, std::size_t paramIx, const std::string& field) {
    std::ostringstream oss;
    oss << "paramIx=" << paramIx << " paramId=" << parameter.Id() << " " << field;
    return oss.str();
}

void SimCheck(const SimOracle& oracle, const std::array<synth::Parameter*, kSimParams>& params,
              const std::array<synth::Bank*, 2>& banks, const synth::ParameterGroup& group,
              const synth::BankSlot& slot, const synth::ParameterManager& manager, unsigned seed, int step,
              const std::string& action) {
    if (manager.ActivePageOrdinal() != oracle.activePage) {
        SimFailBool(seed, step, action, "active page ordinal");
    }
    for (std::size_t gestureIx = 0; gestureIx < kSimGestures; ++gestureIx) {
        if (group.GestureSelected(gestureIx) != oracle.gestureSelected[gestureIx]) {
            SimFailBool(seed, step, action, "group gestureIx=" + std::to_string(gestureIx) + " selected");
        }
        SimCheckNear(seed, step, action, "group gestureIx=" + std::to_string(gestureIx) + " weight",
                     oracle.gestureWeight[gestureIx], group.GestureValue(gestureIx));
    }
    if (slot.SelectedBank() != banks[static_cast<std::size_t>(oracle.selectedBank)]) {
        SimFailBool(seed, step, action, "slot selectedBank=" + std::to_string(oracle.selectedBank));
    }

    for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
        const SimParam& expected = oracle.params[paramIx];
        const synth::Parameter& actual = *params[paramIx];
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
                if (expected.gestureActive[sceneIx][gestureIx] != actual.GestureActive(sceneIx, gestureIx)) {
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
        for (std::size_t voiceIx = 0; voiceIx < kSimVoices; ++voiceIx) {
            const std::string voiceField = "voiceIx=" + std::to_string(voiceIx);
            SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " target center scale"),
                         expected.targetCenterScale[voiceIx],
                         actual.TargetCenterScale(voiceIx));
            SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " current center scale"),
                         expected.currentCenterScale[voiceIx],
                         actual.CurrentCenterScale(voiceIx));
            for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
                const std::string modField = voiceField + " modIx=" + std::to_string(modIx);
                SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " target depth"),
                             expected.targetDepth[voiceIx][modIx],
                             actual.TargetDepths(voiceIx)[modIx]);
                SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " current depth"),
                             expected.currentDepth[voiceIx][modIx],
                             actual.CurrentDepths(voiceIx)[modIx]);
            }
            SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " get"),
                         SimGet(oracle, paramIx, voiceIx), actual.Get(voiceIx));
        }
    }

    const std::array<synth::PhysicalEncoderId, 5> encoders{10, 11, 12, 20, 21};
    for (std::size_t bankIx = 0; bankIx < banks.size(); ++bankIx) {
        const SimBank& expected = oracle.banks[bankIx];
        const synth::Bank& actual = *banks[bankIx];
        if (actual.ShowingModulation() != (expected.selectedParameter >= 0)) {
            SimFailBool(seed, step, action, "bankIx=" + std::to_string(bankIx) + " mode");
        }
        const synth::Parameter* expectedSelected =
            expected.selectedParameter < 0 ? nullptr : params[static_cast<std::size_t>(expected.selectedParameter)];
        if (actual.SelectedParameter() != expectedSelected) {
            SimFailBool(seed, step, action, "bankIx=" + std::to_string(bankIx) + " selected parameter");
        }
        for (const synth::PhysicalEncoderId encoder : encoders) {
            const SimCell* cell = SimFindCell(expected, encoder);
            const synth::Parameter* expectedVisible =
                cell == nullptr || cell->parameter < 0 ? nullptr : params[static_cast<std::size_t>(cell->parameter)];
            if (actual.VisibleParameter(encoder) != expectedVisible) {
                SimFailBool(seed, step, action,
                            "bankIx=" + std::to_string(bankIx) + " encoder=" + std::to_string(encoder) +
                                " visible parameter");
            }
        }
    }
}

void SimInitializeOracle(SimOracle& oracle) {
    const std::array<float, kSimParams> defaults{0.35f, 0.1f, -0.2f};
    const std::array<synth::RangeKind, kSimParams> ranges{
        synth::RangeKind::Unipolar,
        synth::RangeKind::Bipolar,
        synth::RangeKind::Bipolar,
    };

    for (std::size_t paramIx = 0; paramIx < kSimParams; ++paramIx) {
        SimParam& parameter = oracle.params[paramIx];
        parameter.defaultValue = defaults[paramIx];
        parameter.range = ranges[paramIx];
        const float defaultValue = SimClamp(defaults[paramIx], ranges[paramIx]);
        parameter.sceneCenter.fill(defaultValue);
        for (auto& row : parameter.gestureValue) {
            row.fill(defaultValue);
        }
        for (auto& row : parameter.gestureActive) {
            row.fill(false);
        }
        parameter.route.fill(-1);
        parameter.currentCenter = defaultValue;
        parameter.targetCenter = defaultValue;
        parameter.currentCenterScale.fill(1.0f);
        parameter.targetCenterScale.fill(1.0f);
        for (auto& row : parameter.currentDepth) {
            row.fill(0.0f);
        }
        for (auto& row : parameter.targetDepth) {
            row.fill(0.0f);
        }
    }

    oracle.params[0].route[0] = 1;
    oracle.params[0].route[1] = 2;
    oracle.params[1].route[0] = 2;
    oracle.banks[0].top = {
        {.encoder = 10, .parameter = 0, .returnCell = false},
        {.encoder = 11, .parameter = 1, .returnCell = false},
        {.encoder = 12, .parameter = 2, .returnCell = false},
    };
    oracle.banks[1].top = {
        {.encoder = 20, .parameter = 2, .returnCell = false},
        {.encoder = 21, .parameter = 0, .returnCell = false},
    };
    SimDeselect(oracle.banks[0]);
    SimDeselect(oracle.banks[1]);
}

} // namespace

TEST_CASE(randomized_parameter_modulation_simulation) {
    const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
    const int steps = SimStepsFromEnvironment();

    for (const unsigned seed : seeds) {
        synth::ParameterManager manager;
        manager.Scene() = {.leftScene = 0, .rightScene = 1, .blend = 0.25f};
        auto& group = manager.CreateGroup({
            .numVoices = kSimVoices,
            .numModulators = kSimMods,
            .numGestures = kSimGestures,
            .numScenes = kSimScenes,
            .maxParameters = kSimParams,
            .processLiteAlpha = 0.25f,
        });
        auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.35f});
        auto& depthA = manager.CreateParameter(
            group, {.name = "DepthA", .defaultValue = 0.1f, .range = synth::RangeKind::Bipolar});
        auto& depthB = manager.CreateParameter(
            group, {.name = "DepthB", .defaultValue = -0.2f, .range = synth::RangeKind::Bipolar});
        REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depthA));
        REQUIRE_TRUE(carrier.AssignModulationDepth(1, &depthB));
        REQUIRE_TRUE(depthA.AssignModulationDepth(0, &depthB));

        auto& auxGroup = manager.CreateGroup({
            .numVoices = 1,
            .numScenes = 1,
            .maxParameters = 1,
        });
        auto& aux = manager.CreateParameter(auxGroup, {.name = "Aux", .defaultValue = 0.25f});
        REQUIRE_TRUE(manager.NumGroups() == 2);

        auto& pageA = manager.CreatePage("A");
        auto& pageB = manager.CreatePage("B");
        auto& pageAux = manager.CreatePage("Aux");
        manager.AssignParameterToPage(pageA.ordinal, carrier);
        manager.AssignParameterToPage(pageB.ordinal, depthA);
        manager.AssignParameterToPage(pageAux.ordinal, aux);
        manager.SelectActivePage(pageA.ordinal);

        auto& bankA = manager.CreateBank();
        bankA.AddMapping(10, carrier);
        bankA.AddMapping(11, depthA);
        bankA.AddMapping(12, depthB);
        auto& bankB = manager.CreateBank();
        bankB.AddMapping(20, depthB);
        bankB.AddMapping(21, carrier);
        auto& slot = manager.CreateBankSlot();
        for (const synth::PhysicalEncoderId encoder : {10u, 11u, 12u, 20u, 21u}) {
            slot.AddPhysicalEncoder(encoder);
        }
        slot.SelectBank(&bankA);

        SimOracle oracle;
        SimInitializeOracle(oracle);
        const std::array<synth::Parameter*, kSimParams> params{&carrier, &depthA, &depthB};
        const std::array<synth::Bank*, 2> banks{&bankA, &bankB};
        std::mt19937 rng(seed);
        std::uniform_real_distribution<float> deltaDist(-0.18f, 0.18f);
        std::uniform_real_distribution<float> bipolarDist(-1.0f, 1.0f);
        std::uniform_real_distribution<float> unipolarDist(0.0f, 1.0f);
        const std::array<synth::PhysicalEncoderId, 6> encoders{10, 11, 12, 20, 21, 99};

        SimCheck(oracle, params, banks, group, slot, manager, seed, -1, "initial");

        for (int step = 0; step < steps; ++step) {
            std::string action;
            switch (rng() % 14) {
            case 0: {
                const auto encoder = encoders[rng() % encoders.size()];
                const float delta = deltaDist(rng);
                action = "turn encoder " + std::to_string(encoder);
                manager.HandleTick(encoder, delta);
                SimHandleTick(oracle, encoder, delta);
                break;
            }
            case 1: {
                const auto encoder = encoders[rng() % encoders.size()];
                action = "press encoder " + std::to_string(encoder);
                manager.HandlePress(encoder);
                SimHandlePress(oracle, encoder);
                break;
            }
            case 2: {
                const auto encoder = encoders[rng() % encoders.size()];
                action = "shift press " + std::to_string(encoder);
                manager.HandleShiftPress(encoder);
                SimHandleShiftPress(oracle, encoder);
                break;
            }
            case 3: {
                const std::size_t gestureIx = rng() % kSimGestures;
                action = "select gesture " + std::to_string(gestureIx);
                manager.SelectGesture(group, gestureIx);
                oracle.gestureSelected[gestureIx] = true;
                break;
            }
            case 4: {
                const std::size_t gestureIx = rng() % kSimGestures;
                action = "deselect gesture " + std::to_string(gestureIx);
                manager.DeselectGesture(group, gestureIx);
                oracle.gestureSelected[gestureIx] = false;
                break;
            }
            case 5: {
                const std::size_t gestureIx = rng() % kSimGestures;
                const float value = unipolarDist(rng);
                action = "set gesture value " + std::to_string(gestureIx);
                manager.SetGestureValue(group, gestureIx, value);
                oracle.gestureWeight[gestureIx] = value;
                break;
            }
            case 6: {
                const synth::PageOrdinal ordinal = rng() % 2 == 0 ? pageA.ordinal : pageB.ordinal;
                action = "select page " + std::to_string(ordinal);
                manager.SelectActivePage(ordinal);
                oracle.activePage = ordinal;
                break;
            }
            case 7: {
                const int bankIx = static_cast<int>(rng() % 2);
                action = "select bank " + std::to_string(bankIx);
                slot.SelectBank(banks[static_cast<std::size_t>(bankIx)]);
                SimSelectBank(oracle, bankIx);
                break;
            }
            case 8: {
                const std::size_t left = rng() % kSimScenes;
                const std::size_t right = rng() % kSimScenes;
                action = "change scene";
                manager.Scene().leftScene = left;
                manager.Scene().rightScene = right;
                oracle.scene.leftScene = left;
                oracle.scene.rightScene = right;
                break;
            }
            case 9: {
                const float blend = unipolarDist(rng);
                action = "change blend";
                manager.Scene().blend = blend;
                oracle.scene.blend = blend;
                break;
            }
            case 10: {
                const std::size_t voiceIx = rng() % kSimVoices;
                const std::size_t modIx = rng() % kSimMods;
                const float value = bipolarDist(rng);
                action = "change modulator";
                group.GetModulators().Value(voiceIx, modIx) = value;
                oracle.modulatorValue[voiceIx][modIx] = value;
                break;
            }
            case 11:
                action = "compute";
                for (synth::Parameter* parameter : params) {
                    parameter->Compute(manager.Scene());
                }
                SimComputeAll(oracle);
                break;
            case 12:
                action = "process lite";
                for (synth::Parameter* parameter : params) {
                    parameter->ProcessLite();
                }
                SimProcessLiteAll(oracle);
                break;
            default: {
                const std::size_t gestureIx = rng() % kSimGestures;
                action = "clear active gesture " + std::to_string(gestureIx);
                manager.ClearGestureActiveFlagsForActiveSceneSelection(group, gestureIx);
                const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
                for (auto& parameter : oracle.params) {
                    if (blend <= 0.0f) {
                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
                    } else if (blend >= 1.0f) {
                        parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
                    } else {
                        parameter.gestureActive[oracle.scene.leftScene][gestureIx] = false;
                        if (oracle.scene.rightScene != oracle.scene.leftScene) {
                            parameter.gestureActive[oracle.scene.rightScene][gestureIx] = false;
                        }
                    }
                }
                break;
            }
            }

            SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
        }
    }
}

TEST_CASE(invalid_indices_throw) {
    synth::Modulators modulators(1, 2);
    const float shortDepths[] = {1.0f};

    bool threw = false;
    try {
        (void)modulators.Value(1, 0);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        (void)modulators.Value(0, 2);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        (void)modulators.Apply(0, std::span<const float>(shortDepths));
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    synth::Gestures gestures(1);
    threw = false;
    try {
        gestures.Select(1, true);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        synth::ParameterManager manager;
        manager.CreateGroup({.numVoices = 0, .numScenes = 1, .maxParameters = 1});
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
