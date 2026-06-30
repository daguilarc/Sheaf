#include "synth/MidiController.hpp"
#include "synth/ParameterModulation.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth core tests must not see JUCE headers"
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <mutex>
#include <optional>
#include <random>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
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

TEST_CASE(color_hsv_and_atomic_storage) {
    const synth::Color color{.r = 64, .g = 128, .b = 255};
    const synth::HSV hsv = synth::ToHSV(color);
    const synth::Color roundTrip = synth::Color::FromHSV(hsv.h, hsv.s, hsv.v);
    REQUIRE_TRUE(std::abs(static_cast<int>(roundTrip.r) - static_cast<int>(color.r)) <= 1);
    REQUIRE_TRUE(std::abs(static_cast<int>(roundTrip.g) - static_cast<int>(color.g)) <= 1);
    REQUIRE_TRUE(std::abs(static_cast<int>(roundTrip.b) - static_cast<int>(color.b)) <= 1);
    REQUIRE_TRUE(color.AdjustBrightness(0.5f).r == 32);

    synth::AtomicColor atomicColor;
    atomicColor.Store(synth::Color::Orange);
    REQUIRE_TRUE(atomicColor.Load() == synth::Color::Orange);
    REQUIRE_TRUE(atomicColor.IsLockFree());
}

TEST_CASE(manager_gesture_count_is_fixed_before_groups) {
    synth::ParameterManager manager;
    REQUIRE_TRUE(manager.GestureCount() == 0);
    REQUIRE_TRUE(manager.SetGestureCount(2));
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    REQUIRE_TRUE(group.GestureCount() == 2);
    REQUIRE_TRUE(!manager.SetGestureCount(3));
}

TEST_CASE(validated_scene_endpoint_setter_preserves_state_on_reject) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    (void)manager.CreateGroup({.numVoices = 1, .numScenes = 2, .maxParameters = 1});
    (void)manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});

    REQUIRE_TRUE(manager.SetSceneEndpoints(0, 0));
    manager.SetSceneBlend(0.25f);
    REQUIRE_TRUE(!manager.SetSceneEndpoints(1, 0));
    REQUIRE_TRUE(manager.Scene().leftScene == 0);
    REQUIRE_TRUE(manager.Scene().rightScene == 0);
    REQUIRE_NEAR(manager.Scene().blend, 0.25f, 0.0001f);
}

TEST_CASE(default_voice_indicator_colors_are_deterministic) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 7,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Voices", .defaultValue = 0.5f});
    synth::Parameter::UIState ui(7);
    parameter.PopulateUIState(ui);

    REQUIRE_TRUE(ui.indicatorColors[0].Load() == synth::Color::Cyan);
    REQUIRE_TRUE(ui.indicatorColors[1].Load() == synth::Color::Orange);
    REQUIRE_TRUE(ui.indicatorColors[2].Load() == synth::Color::Green);
    REQUIRE_TRUE(ui.indicatorColors[3].Load() == synth::Color::Indigo);
    REQUIRE_TRUE(ui.indicatorColors[4].Load() == synth::Color::Yellow);
    REQUIRE_TRUE(ui.indicatorColors[5].Load() == synth::Color::Blue);
    REQUIRE_TRUE(ui.indicatorColors[6].Load() != synth::Color::Off);
    REQUIRE_TRUE(ui.indicatorColors[6].Load() != ui.indicatorColors[0].Load());
}

TEST_CASE(manager_assigns_unique_ids) {
    synth::ParameterManager manager;
    manager.SetGestureCount(4);
    auto& groupA = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& groupB = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 0,
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
    REQUIRE_TRUE(first.Id() == 0);
    REQUIRE_TRUE(second.Id() == 1);
    REQUIRE_TRUE(third.Id() == 2);
}

TEST_CASE(manager_register_parameter_returns_zero_based_list_index) {
    synth::ParameterManager manager;
    auto& groupA = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& groupB = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});

    const synth::ParameterId firstId = manager.RegisterParameter(groupA, {.name = "A", .defaultValue = 0.1f});
    const synth::ParameterId secondId = manager.RegisterParameter(groupB, {.name = "B", .defaultValue = 0.2f});
    const synth::ParameterId thirdId = manager.RegisterParameter(groupA, {.name = "C", .defaultValue = 0.3f});

    REQUIRE_TRUE(firstId == 0);
    REQUIRE_TRUE(secondId == 1);
    REQUIRE_TRUE(thirdId == 2);
    REQUIRE_TRUE(manager.ParameterCount() == 3);
    REQUIRE_TRUE(&manager.ParameterById(firstId) == &groupA.ParameterByLocalIndex(0));
    REQUIRE_TRUE(&manager.ParameterById(secondId) == &groupB.ParameterByLocalIndex(0));
    REQUIRE_TRUE(&manager.ParameterById(thirdId) == &groupA.ParameterByLocalIndex(1));
}

TEST_CASE(register_parameter_rejects_duplicate_effective_names) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    (void)manager.RegisterParameter(group, {.name = "Cutoff", .defaultValue = 0.1f});

    bool threw = false;
    try {
        (void)manager.RegisterParameter(group, {.name = "Cutoff", .defaultValue = 0.2f});
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(manager.ParameterCount() == 1);
    REQUIRE_TRUE(group.ParameterCount() == 1);
}

TEST_CASE(parameter_lookup_rejects_invalid_id) {
    synth::ParameterManager manager;

    bool threw = false;
    try {
        (void)manager.ParameterById(0);
    } catch (const std::out_of_range&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(create_parameter_uses_zero_based_list_index_ids) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});

    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.1f});
    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.2f});

    REQUIRE_TRUE(first.Id() == 0);
    REQUIRE_TRUE(second.Id() == 1);
    REQUIRE_TRUE(manager.ParameterCount() == 2);
    REQUIRE_TRUE(&manager.ParameterById(first.Id()) == &first);
    REQUIRE_TRUE(&manager.ParameterById(second.Id()) == &second);
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
    modulators.Metadata(1).shortName = "LF";
    modulators.Metadata(1).color = {.r = 12, .g = 34, .b = 56};
    modulators.Metadata(1).connected = true;

    modulators.Value(0, 1) = 0.25f;
    modulators.Value(2, 1) = -0.75f;

    REQUIRE_TRUE(modulators.Metadata(1).name == "LFO");
    REQUIRE_TRUE(modulators.Metadata(1).shortName == "LF");
    REQUIRE_TRUE(modulators.Metadata(1).color.g == 34);
    REQUIRE_TRUE(modulators.Metadata(1).connected);
    REQUIRE_NEAR(modulators.Value(0, 1), 0.25f, 0.0001f);
    REQUIRE_NEAR(modulators.Value(2, 1), -0.75f, 0.0001f);
}

TEST_CASE(group_modulation_source_registration_stores_metadata) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    float voice0 = 0.25f;
    float voice1 = 0.75f;
    std::array<float*, 2> sources{&voice0, &voice1};

    group.SetModulationSource(0, sources, {
                                             .name = "VCO",
                                             .shortName = "VCO",
                                             .color = synth::Color::Cyan,
                                             .connected = true,
                                         });

    const synth::ModulatorMetadata& metadata = group.GetModulators().Metadata(0);
    REQUIRE_TRUE(metadata.name == "VCO");
    REQUIRE_TRUE(metadata.shortName == "VCO");
    REQUIRE_TRUE(metadata.color == synth::Color::Cyan);
    REQUIRE_TRUE(metadata.connected);
}

TEST_CASE(group_update_mod_values_refreshes_registered_source_each_sample) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    float voice0 = 0.25f;
    float voice1 = 0.75f;
    std::array<float*, 2> sources{&voice0, &voice1};
    group.SetModulationSource(0, sources, {.name = "VCO", .connected = true});

    group.UpdateModValues();
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), 0.25f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 0.75f, 0.0001f);

    voice0 = 0.4f;
    voice1 = 0.6f;
    group.UpdateModValues();
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), 0.4f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 0.6f, 0.0001f);
}

TEST_CASE(group_modulation_source_registration_rejects_invalid_inputs_without_mutation) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    float voice0 = 0.2f;
    float voice1 = 0.8f;
    std::array<float*, 2> validSources{&voice0, &voice1};
    group.SetModulationSource(0, validSources, {
                                                .name = "Original",
                                                .shortName = "Orig",
                                                .color = synth::Color::Green,
                                                .connected = true,
                                            });
    group.UpdateModValues();

    bool threw = false;
    try {
        std::array<float*, 1> wrongCount{&voice0};
        group.SetModulationSource(0, wrongCount, {.name = "Wrong", .connected = true});
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        std::array<float*, 2> nullConnected{&voice0, nullptr};
        group.SetModulationSource(0, nullConnected, {.name = "Null", .connected = true});
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        group.SetModulationSource(1, validSources, {.name = "Invalid", .connected = true});
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    const synth::ModulatorMetadata& metadata = group.GetModulators().Metadata(0);
    REQUIRE_TRUE(metadata.name == "Original");
    REQUIRE_TRUE(metadata.shortName == "Orig");
    REQUIRE_TRUE(metadata.color == synth::Color::Green);
    REQUIRE_TRUE(metadata.connected);

    voice0 = 0.3f;
    voice1 = 0.7f;
    group.UpdateModValues();
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), 0.3f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 0.7f, 0.0001f);
}

TEST_CASE(manager_update_mod_values_delegates_to_one_group_or_all_groups) {
    synth::ParameterManager manager;
    auto& groupA = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& groupB = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    float sourceA = 0.1f;
    float sourceB = 0.9f;
    std::array<float*, 1> sourcesA{&sourceA};
    std::array<float*, 1> sourcesB{&sourceB};
    groupA.SetModulationSource(0, sourcesA, {.name = "A", .connected = true});
    groupB.SetModulationSource(0, sourcesB, {.name = "B", .connected = true});

    manager.UpdateModValues(groupA);
    REQUIRE_NEAR(groupA.GetModulators().Value(0, 0), 0.1f, 0.0001f);
    REQUIRE_NEAR(groupB.GetModulators().Value(0, 0), 0.0f, 0.0001f);

    sourceA = 0.2f;
    sourceB = 0.8f;
    manager.UpdateModValues();
    REQUIRE_NEAR(groupA.GetModulators().Value(0, 0), 0.2f, 0.0001f);
    REQUIRE_NEAR(groupB.GetModulators().Value(0, 0), 0.8f, 0.0001f);
}

TEST_CASE(update_mod_values_copies_source_values_unchanged) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    float voice0 = -0.25f;
    float voice1 = 1.25f;
    std::array<float*, 2> sources{&voice0, &voice1};
    group.SetModulationSource(0, sources, {.name = "Raw", .connected = true});

    group.UpdateModValues();
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), -0.25f, 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), 1.25f, 0.0001f);
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
    manager.SetGestureCount(4);
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 2,
        .numScenes = 2,
        .maxParameters = 1,
    });

    auto& parameter = manager.CreateParameter(group, {
        .name = "Cutoff",
        .shortName = "Cut",
        .defaultValue = 0.3f,
        .range = synth::RangeKind::Unipolar,
    });

    REQUIRE_TRUE(parameter.Id() == 0);
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });

    auto& first = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.1f});
    REQUIRE_TRUE(first.Id() == 0);
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
    REQUIRE_TRUE(first.Id() == 0);
    REQUIRE_TRUE(manager.ParameterCount() == 1);
}

TEST_CASE(stable_parameter_pointers_survive_later_allocations) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 3,
    });

    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.1f});
    synth::Parameter* firstPtr = &first;
    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.2f});
    auto& third = manager.CreateParameter(group, {.name = "Third", .defaultValue = 0.3f});

    REQUIRE_TRUE(&first == firstPtr);
    REQUIRE_TRUE(firstPtr->Id() == 0);
    REQUIRE_TRUE(second.Id() == 1);
    REQUIRE_TRUE(third.Id() == 2);
    REQUIRE_TRUE(group.ParameterCount() == 3);
}

TEST_CASE(scene_and_gesture_interpolation) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
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
    manager.SetGestureValue(0, 0.5f);
    gesture.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.25f});
    REQUIRE_NEAR(gesture.TargetCenter(), 0.65f, 0.0001f);
}

TEST_CASE(multiple_gestures_use_effective_weighted_average) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "GestureMix", .defaultValue = 0.0f});
    parameter.SceneCenter(0) = 0.0f;
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.GestureValue(0, 1) = 1.0f;
    parameter.SetGestureActive(0, 0, true);
    parameter.SetGestureActive(0, 1, true);
    manager.SetGestureValue(0, 0.2f);
    manager.SetGestureValue(1, 0.8f);

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_NEAR(parameter.TargetCenter(), 0.68f, 0.0001f);
}

TEST_CASE(modulation_normalization_under_one) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
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

TEST_CASE(negative_modulation_depths_add_normalization_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
        .processLiteAlpha = 1.0f,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& positive = manager.CreateParameter(group, {
        .name = "Positive",
        .defaultValue = 0.25f,
        .range = synth::RangeKind::Bipolar,
    });
    auto& negative = manager.CreateParameter(group, {
        .name = "Negative",
        .defaultValue = -0.5f,
        .range = synth::RangeKind::Bipolar,
    });
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
    REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    parameter.ProcessLite();

    REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);

    group.GetModulators().Value(0, 0) = 0.0f;
    group.GetModulators().Value(0, 1) = 0.0f;
    REQUIRE_NEAR(parameter.Get(0), 0.625f, 0.0001f);

    group.GetModulators().Value(0, 0) = 1.0f;
    group.GetModulators().Value(0, 1) = 0.0f;
    REQUIRE_NEAR(parameter.Get(0), 0.875f, 0.0001f);

    group.GetModulators().Value(0, 0) = 0.0f;
    group.GetModulators().Value(0, 1) = 1.0f;
    REQUIRE_NEAR(parameter.Get(0), 0.125f, 0.0001f);
}

TEST_CASE(overfull_negative_modulation_offset_uses_normalized_depths) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
        .processLiteAlpha = 1.0f,
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
    parameter.ProcessLite();

    REQUIRE_NEAR(parameter.TargetCenterScale(0), 0.0f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetNormalizationOffset(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[0], 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetDepths(0)[1], -0.5f, 0.0001f);

    group.GetModulators().Value(0, 0) = 0.0f;
    group.GetModulators().Value(0, 1) = 0.0f;
    REQUIRE_NEAR(parameter.Get(0), 0.5f, 0.0001f);

    group.GetModulators().Value(0, 0) = 1.0f;
    group.GetModulators().Value(0, 1) = 0.0f;
    REQUIRE_NEAR(parameter.Get(0), 1.0f, 0.0001f);

    group.GetModulators().Value(0, 0) = 0.0f;
    group.GetModulators().Value(0, 1) = 1.0f;
    REQUIRE_NEAR(parameter.Get(0), 0.0f, 0.0001f);
}

TEST_CASE(ui_state_min_max_reports_underfull_modulation_reachable_range) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
        .processLiteAlpha = 1.0f,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& positive = manager.CreateParameter(group, {
        .name = "Positive",
        .defaultValue = 0.25f,
        .range = synth::RangeKind::Bipolar,
    });
    auto& negative = manager.CreateParameter(group, {
        .name = "Negative",
        .defaultValue = -0.5f,
        .range = synth::RangeKind::Bipolar,
    });
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &positive));
    REQUIRE_TRUE(parameter.AssignModulationDepth(1, &negative));

    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    parameter.ProcessLite();

    synth::Parameter::UIState ui(1);
    parameter.PopulateUIState(ui);
    REQUIRE_NEAR(ui.minValues[0].load(), 0.125f, 0.0001f);
    REQUIRE_NEAR(ui.maxValues[0].load(), 0.875f, 0.0001f);
}

TEST_CASE(ui_state_min_max_reports_full_range_when_modulation_is_overfull) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
        .processLiteAlpha = 1.0f,
    });

    auto& parameter = manager.CreateParameter(group, {
        .name = "Carrier",
        .defaultValue = 0.0f,
        .range = synth::RangeKind::Bipolar,
    });
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
    parameter.ProcessLite();

    synth::Parameter::UIState ui(1);
    parameter.PopulateUIState(ui);
    REQUIRE_NEAR(ui.minValues[0].load(), -1.0f, 0.0001f);
    REQUIRE_NEAR(ui.maxValues[0].load(), 1.0f, 0.0001f);
}

TEST_CASE(nested_depth_route_reads_get_and_bypasses_slew) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
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

TEST_CASE(process_lite_slews_center_scale_offset_and_depths) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 2,
        .maxParameters = 2,
        .processLiteAlpha = 0.25f,
    });

    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.0f});
    auto& depth = manager.CreateParameter(group, {
        .name = "Depth",
        .defaultValue = -0.5f,
        .range = synth::RangeKind::Bipolar,
    });
    parameter.SceneCenter(0) = 1.0f;
    parameter.SceneCenter(1) = 1.0f;
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));

    parameter.Compute({.leftScene = 0, .rightScene = 1, .blend = 0.0f});
    parameter.ProcessLite();

    REQUIRE_NEAR(parameter.CurrentCenter(), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentCenterScale(0), 0.875f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentNormalizationOffset(0), 0.125f, 0.0001f);
    REQUIRE_NEAR(parameter.CurrentDepths(0)[0], -0.125f, 0.0001f);

    synth::Parameter::UIState ui(1);
    parameter.PopulateUIState(ui);
    REQUIRE_NEAR(ui.minValues[0].load(), 0.125f, 0.0001f);
    REQUIRE_NEAR(ui.maxValues[0].load(), 0.25f, 0.0001f);
}

TEST_CASE(switch_metadata_and_buckets_use_unslewed_display_target) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 2,
        .maxParameters = 2,
        .processLiteAlpha = 0.25f,
    });

    auto& stepped = manager.CreateParameter(group, {
        .name = "Mode",
        .defaultValue = 0.0f,
        .switchValues = 4,
    });
    stepped.SceneCenter(1) = 1.0f;
    stepped.Compute({.leftScene = 0, .rightScene = 1, .blend = 1.0f});

    REQUIRE_TRUE(stepped.SwitchValues() == 4);
    REQUIRE_TRUE(stepped.IsSwitch());
    REQUIRE_NEAR(stepped.Get(0), 0.0f, 0.0001f);
    REQUIRE_TRUE(stepped.GetSwitchVal(0) == 3);

    auto& bipolar = manager.CreateParameter(group, {
        .name = "Bipolar",
        .defaultValue = -1.0f,
        .range = synth::RangeKind::Bipolar,
        .switchValues = 4,
    });
    bipolar.SceneCenter(1) = 0.0f;
    bipolar.Compute({.leftScene = 0, .rightScene = 1, .blend = 1.0f});
    REQUIRE_TRUE(bipolar.GetSwitchVal(0) == 2);

    synth::Parameter::UIState ui(1);
    stepped.PopulateUIState(ui);
    REQUIRE_TRUE(ui.switchValues.load() == 4);
    REQUIRE_TRUE(ui.switchValue[0].load() == 3);

    ui.SetDisconnected();
    REQUIRE_TRUE(ui.switchValues.load() == 0);
    REQUIRE_TRUE(ui.switchValue[0].load() == 0);
    REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == 0);
    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == 0);
}

TEST_CASE(ui_state_reports_affecting_masks_for_first_32_indices) {
    synth::ParameterManager manager;
    manager.SetGestureCount(33);
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
    parameter.SetGestureActive(0, 0, true);
    parameter.SetGestureActive(0, 31, true);
    parameter.SetGestureActive(0, 32, true);
    parameter.SetGestureActive(1, 1, true);
    parameter.SetGestureActive(1, 31, true);

    synth::Parameter::UIState ui(1);
    REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));

    manager.SetSceneBlend(0.0f);
    parameter.PopulateUIState(ui);
    REQUIRE_TRUE(ui.modulatorsAffectingMask.load() == (1u << 31));
    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 31)));

    manager.SetSceneBlend(1.0f);
    parameter.PopulateUIState(ui);
    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 1) | (1u << 31)));

    manager.SetSceneBlend(0.5f);
    parameter.PopulateUIState(ui);
    REQUIRE_TRUE(ui.gesturesAffectingMask.load() == ((1u << 0) | (1u << 1) | (1u << 31)));
}

TEST_CASE(cycle_rejection_direct_and_indirect) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
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

TEST_CASE(modulation_depth_assignment_rejects_cross_group_routes) {
    synth::ParameterManager manager;
    auto& carrierGroup = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& smallerDepthGroup = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });

    auto& carrier = manager.CreateParameter(carrierGroup, {.name = "Carrier", .defaultValue = 0.5f});
    auto& depth = manager.CreateParameter(smallerDepthGroup, {.name = "Other Group Depth", .defaultValue = 0.25f});

    REQUIRE_TRUE(!carrier.AssignModulationDepth(0, &depth));
    REQUIRE_TRUE(carrier.ModulationDepthParameter(0) == nullptr);
}

TEST_CASE(get_clamps_and_rejects_out_of_range_voice) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
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

TEST_CASE(manager_linear_mapping_reaches_endpoints) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
    });
    const synth::ParameterId paramId = manager.RegisterParameter(group, {.name = "Level", .defaultValue = 0.0f});
    auto& parameter = manager.ParameterById(paramId);

    parameter.SceneCenter(0) = 0.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, paramId), 10.0f, 0.0001f);

    parameter.SceneCenter(0) = 0.5f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, paramId), 15.0f, 0.0001f);

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, paramId), 20.0f, 0.0001f);
}

TEST_CASE(manager_exponential_mapping_reaches_endpoints_and_midpoint) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
    });
    const synth::ParameterId paramId = manager.RegisterParameter(group, {.name = "Frequency", .defaultValue = 0.0f});
    auto& parameter = manager.ParameterById(paramId);

    parameter.SceneCenter(0) = 0.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetExponential(32.0f, 3000.0f, 0, paramId), 32.0f, 0.0001f);

    parameter.SceneCenter(0) = 0.5f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetExponential(32.0f, 3000.0f, 0, paramId), std::sqrt(32.0f * 3000.0f), 0.001f);

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetExponential(32.0f, 3000.0f, 0, paramId), 3000.0f, 0.001f);
}

TEST_CASE(manager_zero_based_exponential_mapping_honors_midpoint) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
    });
    const synth::ParameterId paramId = manager.RegisterParameter(group, {.name = "Depth", .defaultValue = 0.0f});
    auto& parameter = manager.ParameterById(paramId);

    parameter.SceneCenter(0) = 0.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetZeroBasedExponential(1.0f, 0.1f, 0, paramId), 0.0f, 0.0001f);

    parameter.SceneCenter(0) = 0.5f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetZeroBasedExponential(1.0f, 0.1f, 0, paramId), 0.1f, 0.0001f);

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetZeroBasedExponential(1.0f, 0.1f, 0, paramId), 1.0f, 0.0001f);
}

TEST_CASE(manager_bipolar_mapping_helpers_return_signed_values) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
    });
    const synth::ParameterId paramId = manager.RegisterParameter(group, {.name = "Amount", .defaultValue = 0.0f});
    auto& parameter = manager.ParameterById(paramId);

    parameter.SceneCenter(0) = 0.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetBipolarLinear(2.0f, 0, paramId), -2.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarExponential(0.25f, 4.0f, 0, paramId), -4.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarZeroBasedExponential(1.0f, 0.1f, 0, paramId), -1.0f, 0.0001f);

    parameter.SceneCenter(0) = 0.5f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetBipolarLinear(2.0f, 0, paramId), 0.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarExponential(0.25f, 4.0f, 0, paramId), 0.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarZeroBasedExponential(1.0f, 0.1f, 0, paramId), 0.0f, 0.0001f);
    bool threw = false;
    try {
        (void)manager.GetBipolarZeroBasedExponential(1.0f, 2.0f, 0, paramId);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    parameter.SceneCenter(0) = 1.0f;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    REQUIRE_NEAR(manager.GetBipolarLinear(2.0f, 0, paramId), 2.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarExponential(0.25f, 4.0f, 0, paramId), 4.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarZeroBasedExponential(1.0f, 0.1f, 0, paramId), 1.0f, 0.0001f);
}

TEST_CASE(manager_mapping_helpers_use_parameter_get_for_voice_value) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 2,
        .processLiteAlpha = 1.0f,
    });
    const synth::ParameterId carrierId =
        manager.RegisterParameter(group, {.name = "Carrier", .defaultValue = 0.2f});
    const synth::ParameterId depthId = manager.RegisterParameter(group, {.name = "Depth", .defaultValue = 0.5f});
    auto& carrier = manager.ParameterById(carrierId);
    auto& depth = manager.ParameterById(depthId);
    REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depth));

    group.GetModulators().Value(0, 0) = 1.0f;
    carrier.Compute(manager.Scene());
    carrier.ProcessLite();

    REQUIRE_NEAR(carrier.Get(0), 0.6f, 0.0001f);
    REQUIRE_NEAR(manager.GetLinear(10.0f, 20.0f, 0, carrierId), 16.0f, 0.0001f);
    REQUIRE_NEAR(manager.GetBipolarLinear(2.0f, 0, carrierId), 0.4f, 0.0001f);
}

TEST_CASE(handle_inc_dec_endpoint_scene) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.1f});
    parameter.SceneCenter(0) = 0.25f;
    parameter.SceneCenter(1) = 0.75f;
    parameter.GestureValue(0, 0) = 0.9f;
    parameter.GestureValue(1, 0) = 0.9f;
    manager.SelectGesture(0);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.0f}, 0.0f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(!parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.9f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_one_edits_gesture_without_moving_base) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.5f;
    parameter.GestureValue(0, 0) = 0.5f;
    manager.SelectGesture(0);
    manager.SetGestureValue(0, 1.0f);

    const synth::SceneState scene{.leftScene = 0, .rightScene = 0, .blend = 0.0f};
    parameter.HandleIncDec(scene, 0.2f);
    parameter.Compute(scene);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.7f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.7f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_biases_gesture_edit_over_base_edit) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.5f;
    parameter.GestureValue(0, 0) = 0.5f;
    manager.SelectGesture(0);
    manager.SetGestureValue(0, 0.75f);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.2f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.55f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.65f, 0.0001f);
}

TEST_CASE(selected_gesture_mid_blend_activates_both_scenes) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 2,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    parameter.SceneCenter(0) = 0.2f;
    parameter.SceneCenter(1) = 0.8f;
    manager.SelectGesture(0);
    manager.SetGestureValue(0, 0.5f);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 1, .blend = 0.5f}, 0.0f);

    REQUIRE_TRUE(parameter.GestureActive(0, 0));
    REQUIRE_TRUE(parameter.GestureActive(1, 0));
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.2f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(1, 0), 0.8f, 0.0001f);
}

TEST_CASE(selected_gesture_weight_sum_over_one_leaves_base_unmoved) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.5f});
    manager.SelectGesture(0);
    manager.SelectGesture(1);
    manager.SetGestureValue(0, 0.8f);
    manager.SetGestureValue(1, 0.7f);

    parameter.HandleIncDec({.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.3f);

    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 0), 0.66f, 0.0001f);
    REQUIRE_NEAR(parameter.GestureValue(0, 1), 0.64f, 0.0001f);
}

TEST_CASE(handle_inc_dec_negative_saturates_lower_bound) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 0,
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
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

    REQUIRE_TRUE(parameter.ModulationDepthParameter(0) == &depth);
    REQUIRE_NEAR(depth.SceneCenter(0), 0.0f, 0.0001f);
    REQUIRE_NEAR(depth.SceneCenter(1), 0.0f, 0.0001f);
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .defaultValue = 0.4f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.25f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    parameter.SceneCenter(0) = 0.7f;
    parameter.GestureValue(0, 0) = 0.9f;
    parameter.SetGestureActive(0, 0, true);
    manager.SetGestureValue(0, 0.5f);
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
    manager.SetGestureCount(2);
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

TEST_CASE(bank_module_registration_uses_associated_slot_layout_and_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& tune = manager.CreateParameter(group, {.name = "Tune", .defaultValue = 0.5f});
    auto& shape = manager.CreateParameter(group, {.name = "Shape", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.AddPhysicalEncoder(12);
    slot.AddPhysicalEncoder(13);
    slot.SelectBank(&bank);

    std::array<synth::Parameter*, 2> parameters{&tune, &shape};
    bank.RegisterParameters(parameters, 1);

    REQUIRE_TRUE(bank.AssociatedSlot() == &slot);
    REQUIRE_TRUE(bank.SlotCapacity() == 4);
    REQUIRE_TRUE(bank.VisibleParameter(10) == nullptr);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &tune);
    REQUIRE_TRUE(bank.VisibleParameter(12) == &shape);
    REQUIRE_TRUE(bank.VisibleParameter(13) == nullptr);
}

TEST_CASE(multiple_banks_share_one_slot_layout_for_module_registration) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& firstParam = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.1f});
    auto& secondParam = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.2f});
    auto& firstBank = manager.CreateBank();
    auto& secondBank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(20);
    slot.AddPhysicalEncoder(21);

    slot.SelectBank(&firstBank);
    std::array<synth::Parameter*, 1> firstParams{&firstParam};
    firstBank.RegisterParameters(firstParams, 0);

    slot.SelectBank(&secondBank);
    std::array<synth::Parameter*, 1> secondParams{&secondParam};
    secondBank.RegisterParameters(secondParams, 1);

    REQUIRE_TRUE(firstBank.AssociatedSlot() == &slot);
    REQUIRE_TRUE(secondBank.AssociatedSlot() == &slot);
    REQUIRE_TRUE(firstBank.SlotCapacity() == 2);
    REQUIRE_TRUE(secondBank.SlotCapacity() == 2);
    REQUIRE_TRUE(slot.SelectedBank() == &secondBank);
    REQUIRE_TRUE(firstBank.VisibleParameter(20) == &firstParam);
    REQUIRE_TRUE(secondBank.VisibleParameter(21) == &secondParam);
}

TEST_CASE(bank_module_registration_rejects_missing_slot_and_capacity_overrun_without_mutation) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 3});
    auto& existing = manager.CreateParameter(group, {.name = "Existing", .defaultValue = 0.1f});
    auto& first = manager.CreateParameter(group, {.name = "First", .defaultValue = 0.2f});
    auto& second = manager.CreateParameter(group, {.name = "Second", .defaultValue = 0.3f});
    auto& bank = manager.CreateBank();
    std::array<synth::Parameter*, 2> parameters{&first, &second};

    bool threw = false;
    try {
        (void)bank.SlotCapacity();
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        bank.RegisterParameters(parameters, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);
    bank.AddMapping(10, existing);

    threw = false;
    try {
        bank.RegisterParameters(parameters, 1);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &existing);
    REQUIRE_TRUE(bank.VisibleParameter(11) == nullptr);
}

TEST_CASE(bank_module_registration_rejects_duplicate_names_nulls_and_duplicate_slots) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 2});
    auto& parameter = manager.CreateParameter(group, {.name = "Repeated", .defaultValue = 0.1f});
    auto& other = manager.CreateParameter(group, {.name = "Other", .defaultValue = 0.2f});
    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);

    bool threw = false;
    try {
        std::array<synth::Parameter*, 2> duplicateNames{&parameter, &parameter};
        bank.RegisterParameters(duplicateNames, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(bank.VisibleParameter(10) == nullptr);
    REQUIRE_TRUE(bank.VisibleParameter(11) == nullptr);

    threw = false;
    try {
        std::array<synth::Parameter*, 2> nullParameter{&parameter, nullptr};
        bank.RegisterParameters(nullParameter, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(bank.VisibleParameter(10) == nullptr);
    REQUIRE_TRUE(bank.VisibleParameter(11) == nullptr);

    threw = false;
    try {
        slot.AddPhysicalEncoder(10);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    std::array<synth::Parameter*, 2> valid{&parameter, &other};
    bank.RegisterParameters(valid, 0);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &parameter);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &other);
}

TEST_CASE(bank_cannot_be_associated_with_two_slots) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "Only", .defaultValue = 0.5f});
    auto& bank = manager.CreateBank();
    auto& firstSlot = manager.CreateBankSlot();
    auto& secondSlot = manager.CreateBankSlot();
    firstSlot.AddPhysicalEncoder(1);
    secondSlot.AddPhysicalEncoder(2);
    firstSlot.SelectBank(&bank);
    std::array<synth::Parameter*, 1> parameters{&parameter};
    bank.RegisterParameters(parameters, 0);

    bool threw = false;
    try {
        secondSlot.SelectBank(&bank);
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(bank.AssociatedSlot() == &firstSlot);
    REQUIRE_TRUE(firstSlot.SelectedBank() == &bank);
    REQUIRE_TRUE(secondSlot.SelectedBank() == nullptr);
}

TEST_CASE(press_opens_modulation_view_and_target_cell_closes_it) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
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
    REQUIRE_TRUE(bank.TargetParameter() == &parameter);
    REQUIRE_TRUE(bank.VisibleMappingCount() == 3);
    REQUIRE_TRUE(bank.VisibleParameter(1) == &depthA);
    REQUIRE_TRUE(bank.VisibleParameter(2) == &depthB);
    REQUIRE_TRUE(bank.VisibleParameter(3) == &parameter);

    bank.HandlePress(3);

    REQUIRE_TRUE(!bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleParameter(1) == &parameter);
}

TEST_CASE(modulation_view_return_cell_uses_final_compact_fallback_position) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
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
    bank.AddMapping(12, depthB);

    bank.HandlePress(10);

    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleMappingCount() == 3);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &depthA);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &depthB);
    REQUIRE_TRUE(bank.VisibleParameter(12) == &parameter);
    REQUIRE_TRUE(bank.TargetParameter() == &parameter);

    bank.HandleTick(12, {.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.1f);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.9f, 0.0001f);

    bank.HandleShiftPress(12, {.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.4f, 0.0001f);

    bank.HandlePress(12);

    REQUIRE_TRUE(!bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleParameter(10) == &parameter);
}

TEST_CASE(modulation_view_places_return_at_final_slot_position) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& depth = manager.CreateParameter(group, {.name = "Depth", .defaultValue = 0.0f});
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    bank.AddMapping(11, depth);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.AddPhysicalEncoder(12);
    slot.SelectBank(&bank);

    slot.HandlePress(10);
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    REQUIRE_TRUE(ui->slots[0].showingModulationView.load());
    REQUIRE_TRUE(ui->slots[0].cells[0].connected.load());
    REQUIRE_TRUE(!ui->slots[0].cells[1].connected.load());
    REQUIRE_TRUE(ui->slots[0].cells[2].connected.load());
    REQUIRE_TRUE(bank.VisibleParameter(10) == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(11) == nullptr);
    REQUIRE_TRUE(bank.VisibleParameter(12) == &parameter);
    REQUIRE_TRUE(ui->slots[0].cells[1].switchValues.load() == 0);
    REQUIRE_TRUE(ui->slots[0].cells[1].modulatorsAffectingMask.load() == 0);
    REQUIRE_TRUE(ui->slots[0].cells[1].gesturesAffectingMask.load() == 0);
}

TEST_CASE(modulation_view_rejects_more_modulators_than_slot_depth_positions) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 3,
        .numScenes = 1,
        .maxParameters = 4,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.AddPhysicalEncoder(12);
    slot.SelectBank(&bank);

    bool threw = false;
    try {
        slot.HandlePress(10);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(!bank.ShowingModulation());
}

TEST_CASE(modulation_view_materializes_missing_depth_parameter_when_capacity_allows) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.5f});
    auto& filler = manager.CreateParameter(group, {.name = "Filler", .defaultValue = 0.25f});
    group.GetModulators().Metadata(0).name = "Filter Env";
    group.GetModulators().Metadata(0).shortName = "Env";
    group.GetModulators().Metadata(0).color = synth::Color::Cyan;
    auto& bank = manager.CreateBank();
    bank.AddMapping(1, carrier);
    bank.AddMapping(2, filler);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(1);
    slot.AddPhysicalEncoder(2);
    slot.AddPhysicalEncoder(3);
    slot.SelectBank(&bank);

    slot.HandlePress(1);

    synth::Parameter* depth = carrier.ModulationDepthParameter(0);
    REQUIRE_TRUE(depth != nullptr);
    REQUIRE_TRUE(group.ParameterCount() == 3);
    REQUIRE_TRUE(manager.ParameterCount() == 2);
    REQUIRE_TRUE(depth->Name() == "Carrier Filter Env");
    REQUIRE_TRUE(depth->ShortName() == "Env");
    REQUIRE_TRUE(depth->ParamColor() == synth::Color::Cyan);
    REQUIRE_TRUE(depth->Range() == synth::RangeKind::Bipolar);
    REQUIRE_NEAR(depth->SceneCenter(0), 0.0f, 0.0001f);
    REQUIRE_TRUE(bank.VisibleParameter(1) == depth);
    REQUIRE_TRUE(bank.VisibleParameter(2) == nullptr);
    REQUIRE_TRUE(bank.VisibleParameter(3) == &carrier);
    REQUIRE_TRUE(bank.TargetParameter() == &carrier);

    bank.HandleTick(1, {.leftScene = 0, .rightScene = 0, .blend = 0.0f}, 0.2f);

    REQUIRE_NEAR(depth->SceneCenter(0), 0.2f, 0.0001f);
}

TEST_CASE(modulation_view_keeps_owned_depth_parameter_after_reset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 3,
    });
    group.GetModulators().Metadata(0).name = "VCO Direct";
    group.GetModulators().Metadata(0).shortName = "VCO";
    group.GetModulators().Metadata(0).color = synth::Color::Cyan;
    auto& tune = manager.CreateParameter(group, {.name = "Tune", .defaultValue = 0.5f});
    auto& depth = tune.EnsureModulationDepth(0, {
        .name = "Tune VCO Direct",
        .shortName = "VCO",
        .defaultValue = 0.0f,
        .range = synth::RangeKind::Bipolar,
        .color = synth::Color::Cyan,
    });

    auto& bank = manager.CreateBank();
    bank.AddMapping(10, tune);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);

    slot.HandlePress(10);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &tune);

    slot.HandleShiftPress(11, {.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    REQUIRE_TRUE(tune.ModulationDepthParameter(0) == &depth);
    slot.HandlePress(11);
    REQUIRE_TRUE(!bank.ShowingModulation());

    slot.HandlePress(10);

    REQUIRE_TRUE(tune.ModulationDepthParameter(0) == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(10) == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(11) == &tune);
    REQUIRE_TRUE(manager.ParameterCount() == 1);
    REQUIRE_TRUE(group.ParameterCount() == 2);
}

TEST_CASE(modulation_view_lazy_depth_names_include_target_parameter_for_duplicate_modulators) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 4,
    });
    auto& first = manager.CreateParameter(group, {.name = "Carrier A", .defaultValue = 0.25f});
    auto& second = manager.CreateParameter(group, {.name = "Carrier B", .defaultValue = 0.75f});
    group.GetModulators().Metadata(0).name = "Filter Env";
    group.GetModulators().Metadata(0).shortName = "Env";
    group.GetModulators().Metadata(0).color = synth::Color::Cyan;

    auto& bank = manager.CreateBank();
    bank.AddMapping(1, first);
    bank.AddMapping(2, second);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(1);
    slot.AddPhysicalEncoder(2);
    slot.SelectBank(&bank);

    slot.HandlePress(1);
    slot.HandlePress(2);
    slot.HandlePress(2);

    synth::Parameter* firstDepth = first.ModulationDepthParameter(0);
    synth::Parameter* secondDepth = second.ModulationDepthParameter(0);
    REQUIRE_TRUE(firstDepth != nullptr);
    REQUIRE_TRUE(secondDepth != nullptr);
    REQUIRE_TRUE(firstDepth->Name() == "Carrier A Filter Env");
    REQUIRE_TRUE(secondDepth->Name() == "Carrier B Filter Env");
    REQUIRE_TRUE(firstDepth->ShortName() == "Env");
    REQUIRE_TRUE(secondDepth->ShortName() == "Env");
    REQUIRE_TRUE(group.ParameterCount() == 4);
    REQUIRE_TRUE(manager.ParameterCount() == 2);
}

TEST_CASE(pressing_modulation_cell_opens_nested_modulation_view) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
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
    REQUIRE_TRUE(bank.TargetParameter() == &depth);
    REQUIRE_TRUE(bank.VisibleParameter(1) == &nested);
    REQUIRE_TRUE(bank.VisibleParameter(2) == &depth);
}

TEST_CASE(slot_bank_switch_deselects_prior_modulation_view) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
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
    manager.SetGestureCount(2);
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
    manager.SetGestureCount(2);
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
    manager.SetGestureCount(2);
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
    manager.SetGestureCount(2);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Gesture", .defaultValue = 0.2f});
    parameter.GestureValue(0, 0) = 1.0f;
    parameter.SetGestureActive(0, 0, true);

    manager.SelectGesture(0);
    manager.SetGestureValue(0, 0.75f);
    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});

    REQUIRE_TRUE(manager.GestureSelected(0));
    REQUIRE_NEAR(manager.GestureValue(0), 0.75f, 0.0001f);
    REQUIRE_NEAR(parameter.TargetCenter(), 0.8f, 0.0001f);

    manager.DeselectGesture(0);
    REQUIRE_TRUE(!manager.GestureSelected(0));
}

TEST_CASE(parameter_and_slot_ui_state_reports_values_colors_and_target_cell_metadata) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .voiceIndicatorColors = {synth::Color::Cyan, synth::Color::Orange},
    });
    auto& parameter = manager.CreateParameter(group, {
        .name = "Pan",
        .shortName = "Pan",
        .defaultValue = 0.0f,
        .range = synth::RangeKind::Bipolar,
        .color = synth::Color::Green,
        .switchValues = 5,
    });
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    bank.AddMapping(11, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);

    auto& depth = manager.CreateParameter(group, {
        .name = "Pan Depth",
        .defaultValue = 1.0f,
        .range = synth::RangeKind::Bipolar,
    });
    REQUIRE_TRUE(parameter.AssignModulationDepth(0, &depth));
    group.GetModulators().Value(0, 0) = 0.25f;
    group.GetModulators().Value(1, 0) = 0.75f;
    parameter.Compute({.leftScene = 0, .rightScene = 0, .blend = 0.0f});
    parameter.ProcessLite();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    const synth::Parameter::UIState& cell = ui->slots[0].cells[0];
    REQUIRE_TRUE(cell.connected.load());
    REQUIRE_TRUE(cell.bipolar.load());
    REQUIRE_TRUE(cell.color.Load() == synth::Color::Green);
    REQUIRE_TRUE(cell.indicatorColors[0].Load() == synth::Color::Cyan);
    REQUIRE_TRUE(cell.indicatorColors[1].Load() == synth::Color::Orange);
    REQUIRE_NEAR(cell.minValues[0].load(), 0.0f, 0.0001f);
    REQUIRE_NEAR(cell.maxValues[1].load(), 1.0f, 0.0001f);

    manager.HandlePress(0, 0);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->slots[0].showingModulationView.load());
    const synth::Parameter::UIState& targetCell = ui->slots[0].cells[1];
    REQUIRE_TRUE(targetCell.connected.load());
    REQUIRE_TRUE(targetCell.switchValues.load() == 5);
    REQUIRE_TRUE(targetCell.switchValue[0].load() == 3);
    REQUIRE_TRUE(targetCell.switchValue[1].load() == 4);
    REQUIRE_TRUE(targetCell.modulatorsAffectingMask.load() == 1u);
    REQUIRE_TRUE(targetCell.gesturesAffectingMask.load() == 0u);
    REQUIRE_TRUE(targetCell.color.Load() == synth::Color::Green);
    REQUIRE_TRUE(targetCell.shortName.load() == parameter.ShortName().c_str());
}

TEST_CASE(message_bus_routes_external_messages_and_timestamps) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 3,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .defaultValue = 0.25f});
    auto& bankA = manager.CreateBank();
    bankA.AddMapping(10, parameter);
    auto& bankB = manager.CreateBank();
    bankB.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bankA);

    synth::MessageInBus bus(&manager, 3);
    auto ui = manager.CreateUIState();
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(10, 0, 0, 0.25f)));
    bus.Process(9);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
    bus.Process(10);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.5f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(11, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(11, 0, 0)));
    bus.Process(11);
    REQUIRE_TRUE(manager.ShiftHeld());
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->shiftHeld.load());

    REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(12, 0)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(12, 0, 0.75f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SelectParamBank(12, 0, 1)));
    REQUIRE_TRUE(!bus.Push(synth::MessageIn::Clock(12)));
    bus.Process(12);
    REQUIRE_TRUE(manager.GestureSelected(0));
    REQUIRE_NEAR(manager.GestureValue(0), 0.75f, 0.0001f);
    REQUIRE_TRUE(slot.SelectedBank() == &bankB);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->gestures.selected[0].load());

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetSceneBlend(13, 0.25f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(13, 2)));
    bus.Process(13);
    REQUIRE_TRUE(manager.Scene().leftScene == 0);
    REQUIRE_TRUE(manager.Scene().rightScene == 2);
    REQUIRE_NEAR(manager.Scene().blend, 0.25f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetSceneBlend(14, 0.75f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(14, 1)));
    bus.Process(14);
    REQUIRE_TRUE(manager.Scene().leftScene == 1);
    REQUIRE_TRUE(manager.Scene().rightScene == 2);
    REQUIRE_NEAR(manager.Scene().blend, 0.75f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetSceneBlend(15, 0.5f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(15, 0)));
    bus.Process(15);
    REQUIRE_TRUE(manager.Scene().leftScene == 1);
    REQUIRE_TRUE(manager.Scene().rightScene == 0);
    REQUIRE_NEAR(manager.Scene().blend, 0.5f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(16, 3)));
    bus.Process(16);
    REQUIRE_TRUE(manager.Scene().leftScene == 1);
    REQUIRE_TRUE(manager.Scene().rightScene == 0);
    manager.PopulateUIState(*ui);
    REQUIRE_TRUE(ui->leftScene.load() == 1);
    REQUIRE_TRUE(ui->rightScene.load() == 0);
}

TEST_CASE(message_bus_ignores_out_of_bounds_targets) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    manager.SetSceneEndpoints(0, 1);
    manager.SetSceneBlend(0.25f);
    manager.SetGestureValue(0, 0.5f);

    synth::MessageInBus bus(&manager, 16);
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SelectParamBank(0, 0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(0, 99, 1.0f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(0, 99)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(0, 99, 0, 0.5f)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(0, 0, 99, 0.5f)));
    bus.Process(0);

    REQUIRE_TRUE(slot.SelectedBank() == &bank);
    REQUIRE_TRUE(!manager.GestureSelected(0));
    REQUIRE_NEAR(manager.GestureValue(0), 0.5f, 0.0001f);
    REQUIRE_TRUE(manager.Scene().leftScene == 0);
    REQUIRE_TRUE(manager.Scene().rightScene == 1);
    REQUIRE_NEAR(manager.Scene().blend, 0.25f, 0.0001f);
    REQUIRE_NEAR(parameter.SceneCenter(0), 0.25f, 0.0001f);
}

TEST_CASE(message_bus_set_shift_and_set_gesture_select_are_idempotent) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    (void)manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
    });
    synth::MessageInBus bus(&manager, 8);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(0, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(0, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureSelect(0, 1, false)));
    bus.Process(0);

    REQUIRE_TRUE(manager.ShiftHeld());
    REQUIRE_TRUE(!manager.GestureSelected(1));
}

TEST_CASE(manager_ui_state_reports_bank_colors_selection_and_gesture_affecting) {
    synth::ParameterManager manager;
    manager.SetGestureCount(4);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 2,
        .maxParameters = 4,
    });
    auto& affected = manager.CreateParameter(group, {.name = "A", .defaultValue = 0.25f});
    auto& unaffected = manager.CreateParameter(group, {.name = "B", .defaultValue = 0.5f});
    auto& drillHidden = manager.CreateParameter(group, {.name = "C", .defaultValue = 0.75f});
    affected.SetGestureActive(0, 0, true);
    unaffected.SetGestureActive(0, 1, true);
    drillHidden.SetGestureActive(0, 2, true);

    auto& bankA = manager.CreateBank();
    bankA.SetColor(synth::Color::Green);
    bankA.AddMapping(10, affected);
    bankA.AddMapping(13, drillHidden);
    auto& bankB = manager.CreateBank();
    bankB.SetColor(synth::Color::Blue);
    bankB.AddMapping(11, unaffected);
    auto& bankC = manager.CreateBank();
    bankC.SetColor(synth::Color::Red);
    bankC.AddMapping(12, affected);

    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(13);
    slot.SelectBank(&bankA);
    manager.HandlePress(0, 0);
    REQUIRE_TRUE(bankA.ShowingModulation());

    synth::ParameterManager::UIState ui;
    ui.Configure(1, 2, 1, 4, 4);
    manager.PopulateUIState(ui);

    REQUIRE_TRUE(ui.bankCapacity == 4);
    REQUIRE_TRUE(ui.banks[0].connected.load());
    REQUIRE_TRUE(ui.banks[0].selected.load());
    REQUIRE_TRUE(ui.banks[0].color.Load() == synth::Color::Green);
    REQUIRE_TRUE(ui.banks[1].connected.load());
    REQUIRE_TRUE(!ui.banks[1].selected.load());
    REQUIRE_TRUE(ui.banks[1].color.Load() == synth::Color::Blue);
    REQUIRE_TRUE(ui.banks[2].connected.load());
    REQUIRE_TRUE(!ui.banks[2].selected.load());
    REQUIRE_TRUE(ui.banks[2].color.Load() == synth::Color::Red);
    REQUIRE_TRUE(!ui.banks[3].connected.load());
    REQUIRE_TRUE(!ui.banks[3].selected.load());
    REQUIRE_TRUE(ui.banks[3].color.Load() == synth::Color::Off);
    REQUIRE_TRUE(ui.gestures.bankAffectingCount[0].load() == 2);
    REQUIRE_TRUE(ui.gestures.bankAffectingMask[0].load() == ((1u << 0u) | (1u << 2u)));
    REQUIRE_TRUE(ui.gestures.bankAffectingCount[1].load() == 1);
    REQUIRE_TRUE(ui.gestures.bankAffectingMask[1].load() == (1u << 1u));
    REQUIRE_TRUE(ui.gestures.bankAffectingCount[2].load() == 1);
    REQUIRE_TRUE(ui.gestures.bankAffectingMask[2].load() == (1u << 0u));
    REQUIRE_TRUE(ui.gestures.bankAffectingCount[3].load() == 0);
    REQUIRE_TRUE(ui.gestures.bankAffectingMask[3].load() == 0);
}

TEST_CASE(message_bus_routes_modulation_target_position_to_visible_parameter) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 2,
    });
    auto& carrier = manager.CreateParameter(group, {.name = "Carrier", .defaultValue = 0.4f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, carrier);
    bank.AddMapping(11, carrier);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bank);

    synth::MessageInBus bus(&manager, 8);
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(1, 0, 0)));
    bus.Process(1);
    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_TRUE(bank.VisibleParameter(11) == &carrier);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(2, 0, 1, 0.2f)));
    bus.Process(2);
    REQUIRE_NEAR(carrier.SceneCenter(0), 0.6f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(3, true)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(4, 0, 1)));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(5, false)));
    bus.Process(5);
    REQUIRE_TRUE(bank.ShowingModulation());
    REQUIRE_NEAR(carrier.SceneCenter(0), 0.4f, 0.0001f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(6, 0, 1)));
    bus.Process(6);
    REQUIRE_TRUE(!bank.ShowingModulation());
}

TEST_CASE(message_bus_bank_select_deselects_prior_modulation_view) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .defaultValue = 0.25f});
    auto& bankA = manager.CreateBank();
    bankA.AddMapping(10, parameter);
    bankA.AddMapping(11, parameter);
    auto& bankB = manager.CreateBank();
    bankB.AddMapping(10, parameter);
    bankB.AddMapping(11, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.AddPhysicalEncoder(11);
    slot.SelectBank(&bankA);

    synth::MessageInBus bus(&manager, 8);
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(1, 0, 0)));
    bus.Process(1);
    REQUIRE_TRUE(bankA.ShowingModulation());

    REQUIRE_TRUE(bus.Push(synth::MessageIn::SelectParamBank(2, 0, 1)));
    bus.Process(2);
    REQUIRE_TRUE(slot.SelectedBank() == &bankB);
    REQUIRE_TRUE(!bankA.ShowingModulation());
}

struct CountingMidiInProcessor : synth::MidiInProcessor {
    int count = 0;
    synth::BasicMidi last;

    void Process(const synth::BasicMidi& midi) override {
        ++count;
        last = midi;
    }
};

struct FakeMidiSink : synth::IMidiOutputSink {
    std::vector<synth::BasicMidi> sent;

    void Send(const synth::BasicMidi& midi) override {
        sent.push_back(midi);
    }
};

TEST_CASE(midi_basic_helpers_expose_raw_bytes_and_sizes) {
    const synth::BasicMidi cc = synth::BasicMidi::CC(10, 2, 7, 99);
    REQUIRE_TRUE(cc.timestamp == 10);
    REQUIRE_TRUE(cc.Size() == 3);
    REQUIRE_TRUE(cc.Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(cc.Channel() == 2);
    REQUIRE_TRUE(cc.GetCC() == 7);
    REQUIRE_TRUE(cc.GetValue() == 99);
    REQUIRE_TRUE(cc.raw[0] == 0xB2);

    const synth::BasicMidi note = synth::BasicMidi::Note(11, 3, 60, 100);
    REQUIRE_TRUE(note.Status() == synth::BasicMidi::kStatusNote);
    REQUIRE_TRUE(note.Channel() == 3);
    REQUIRE_TRUE(note.GetNote() == 60);
    REQUIRE_TRUE(note.GetValue() == 100);

    const synth::BasicMidi noteOff = synth::BasicMidi::Note(12, 4, 61, 0);
    REQUIRE_TRUE(noteOff.Status() == synth::BasicMidi::kStatusNoteOff);
    REQUIRE_TRUE(noteOff.Channel() == 4);
    REQUIRE_TRUE(noteOff.GetNote() == 61);

    const synth::BasicMidi bend = synth::BasicMidi::PitchBend(13, 5, 0x1234);
    REQUIRE_TRUE(bend.Status() == synth::BasicMidi::kStatusPitchBend);
    REQUIRE_TRUE(bend.Channel() == 5);
    REQUIRE_TRUE(bend.GetPitchBend() == 0x1234);

    const synth::BasicMidi clock = synth::BasicMidi::Clock(44);
    REQUIRE_TRUE(clock.timestamp == 44);
    REQUIRE_TRUE(clock.Size() == 1);
    REQUIRE_TRUE(clock.raw[0] == synth::BasicMidi::kStatusClock);
    REQUIRE_TRUE(synth::BasicMidi::IsSupportedRealtimeStatus(clock.raw[0]));
    REQUIRE_TRUE(synth::BasicMidi::TransportStart(45).Size() == 1);
    REQUIRE_TRUE(synth::BasicMidi::TransportContinue(46).Size() == 1);
    REQUIRE_TRUE(synth::BasicMidi::TransportStop(47).Size() == 1);
}

TEST_CASE(midi_encoder_input_maps_scaled_turns_pushes_and_timestamps) {
    synth::ParameterManager manager;
    synth::MessageInBus bus(&manager, 16);
    synth::EncoderMidiInConfig config = synth::EncoderMidiInConfig::TwisterDefault(1);
    config.turnStep = 0.01f;
    config.KeepFirstPositions(6);
    synth::EncoderMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 0; });

    processor.Process(synth::BasicMidi::CC(9999, 0, 5, 63));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.timestamp == 0);
    REQUIRE_TRUE(message.slotIx == 1);
    REQUIRE_TRUE(message.position == 5);
    REQUIRE_NEAR(message.delta, -0.01f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(9999, 0, 5, 66));
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.timestamp == 0);
    REQUIRE_TRUE(message.slotIx == 1);
    REQUIRE_TRUE(message.position == 5);
    REQUIRE_NEAR(message.delta, 0.02f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(9999, 1, 5, 127));
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamPush);
    REQUIRE_TRUE(message.timestamp == 0);
    REQUIRE_TRUE(message.slotIx == 1);
    REQUIRE_TRUE(message.position == 5);
}

TEST_CASE(midi_encoder_input_direction_only_zero_and_thru_behavior) {
    synth::MessageInBus bus(nullptr, 16);
    synth::EncoderMidiInConfig config;
    config.relativeMode = synth::EncoderRelativeMode::DirectionOnly;
    config.turnStep = 0.01f;
    config.turns.push_back({.control = {.channel = 0, .cc = 1}, .slotIx = 0, .position = 0});
    config.pushes.push_back({.control = {.channel = 1, .cc = 1}, .slotIx = 0, .position = 0});
    synth::EncoderMidiInProcessor processor(config, &bus);
    CountingMidiInProcessor thru;
    processor.SetThru(&thru);

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 1));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_NEAR(message.delta, -0.01f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 64));
    REQUIRE_TRUE(!bus.Pop(message, 0));

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 127));
    REQUIRE_TRUE(bus.Pop(message, 0));
    REQUIRE_NEAR(message.delta, 0.01f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(1, 1, 1, 0));
    REQUIRE_TRUE(!bus.Pop(message, 0));
    REQUIRE_TRUE(thru.count == 0);

    processor.Process(synth::BasicMidi::CC(1, 9, 9, 99));
    REQUIRE_TRUE(thru.count == 1);
    REQUIRE_TRUE(thru.last.Channel() == 9);
    REQUIRE_TRUE(thru.last.GetCC() == 9);
}

TEST_CASE(midi_analog_input_maps_gestures_scene_blend_timestamps_and_thru) {
    synth::MessageInBus bus(nullptr, 16);
    synth::AnalogMidiInConfig config;
    config.gestures.push_back({.control = {.channel = 2, .cc = 3}, .gestureIx = 3});
    config.gestures.push_back({.control = {.channel = 2, .cc = 4}, .gestureIx = 4});
    config.sceneBlend = synth::MidiControlAddress{.channel = 2, .cc = 16};
    synth::AnalogMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 42; });
    CountingMidiInProcessor thru;
    processor.SetThru(&thru);

    processor.Process(synth::BasicMidi::CC(999, 2, 3, 64));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 42));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.timestamp == 42);
    REQUIRE_TRUE(message.gestureIx == 3);
    REQUIRE_NEAR(message.value, 64.0f / 127.0f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(999, 2, 4, 0));
    REQUIRE_TRUE(bus.Pop(message, 42));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.gestureIx == 4);
    REQUIRE_NEAR(message.value, 0.0f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(999, 2, 16, 127));
    REQUIRE_TRUE(bus.Pop(message, 42));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetSceneBlend);
    REQUIRE_TRUE(message.timestamp == 42);
    REQUIRE_NEAR(message.value, 1.0f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(999, 2, 99, 1));
    REQUIRE_TRUE(!bus.Pop(message, 42));
    REQUIRE_TRUE(thru.count == 1);
    REQUIRE_TRUE(thru.last.Channel() == 2);
    REQUIRE_TRUE(thru.last.GetCC() == 99);

    processor.Process(synth::BasicMidi::Clock(999));
    REQUIRE_TRUE(thru.count == 2);
    REQUIRE_TRUE(thru.last.Status() == synth::BasicMidi::kStatusClock);
}

TEST_CASE(midi_system_button_input_maps_press_release_timestamps_and_thru) {
    synth::MessageInBus bus(nullptr, 16);
    synth::SystemButtonMidiInConfig config;
    config.associations.push_back({
        .control = {.channel = 5, .cc = 32},
        .press = synth::MessageIn::SetShift(1, true),
        .release = synth::MessageIn::SetShift(1, false),
    });
    config.associations.push_back({
        .control = {.channel = 5, .cc = 0},
        .press = synth::MessageIn::SetGestureSelect(1, 0, true),
        .release = synth::MessageIn::SetGestureSelect(1, 0, false),
    });
    config.associations.push_back({
        .control = {.channel = 5, .cc = 33},
        .press = synth::MessageIn::ToggleShift(1),
    });
    synth::SystemButtonMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 77; });
    CountingMidiInProcessor thru;
    processor.SetThru(&thru);

    processor.Process(synth::BasicMidi::CC(999, 5, 32, 127));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 77));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.timestamp == 77);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(message.boolValue);

    processor.Process(synth::BasicMidi::CC(999, 5, 32, 0));
    REQUIRE_TRUE(bus.Pop(message, 77));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.timestamp == 77);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(!message.boolValue);

    processor.Process(synth::BasicMidi::CC(999, 5, 0, 0));
    REQUIRE_TRUE(bus.Pop(message, 77));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.timestamp == 77);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(!message.boolValue);

    processor.Process(synth::BasicMidi::CC(999, 5, 33, 0));
    REQUIRE_TRUE(!bus.Pop(message, 77));
    REQUIRE_TRUE(thru.count == 0);

    processor.Process(synth::BasicMidi::CC(999, 5, 99, 1));
    REQUIRE_TRUE(!bus.Pop(message, 77));
    REQUIRE_TRUE(thru.count == 1);
    REQUIRE_TRUE(thru.last.Channel() == 5);
    REQUIRE_TRUE(thru.last.GetCC() == 99);

    processor.Process(synth::BasicMidi::Clock(999));
    REQUIRE_TRUE(thru.count == 2);
    REQUIRE_TRUE(thru.last.Status() == synth::BasicMidi::kStatusClock);
}

TEST_CASE(midi_encoder_default_presets_map_row_major_and_trim) {
    synth::EncoderMidiInConfig twister = synth::EncoderMidiInConfig::TwisterDefault(2);
    REQUIRE_TRUE(twister.relativeMode == synth::EncoderRelativeMode::Signed7Bit);
    REQUIRE_NEAR(twister.turnStep, 1.0f / 128.0f, 0.000001f);
    REQUIRE_TRUE(twister.turns.size() == 16);
    REQUIRE_TRUE(twister.pushes.size() == 16);
    REQUIRE_TRUE(twister.turns.front().control.channel == 0);
    REQUIRE_TRUE(twister.turns.front().control.cc == 0);
    REQUIRE_TRUE(twister.turns.front().slotIx == 2);
    REQUIRE_TRUE(twister.turns.front().position == 0);
    REQUIRE_TRUE(twister.turns.back().control.channel == 0);
    REQUIRE_TRUE(twister.turns.back().control.cc == 15);
    REQUIRE_TRUE(twister.turns.back().position == 15);
    REQUIRE_TRUE(twister.pushes.front().control.channel == 1);
    REQUIRE_TRUE(twister.pushes.back().control.cc == 15);

    synth::EncoderMidiInConfig wrld = synth::EncoderMidiInConfig::WrldBldrDefault(3);
    REQUIRE_TRUE(wrld.turns.front().control.channel == 0);
    REQUIRE_TRUE(wrld.pushes.front().control.channel == 1);
    REQUIRE_TRUE(wrld.turns.back().slotIx == 3);
    REQUIRE_TRUE(wrld.turns.back().position == 15);

    wrld.KeepFirstPositions(3);
    REQUIRE_TRUE(wrld.turns.size() == 3);
    REQUIRE_TRUE(wrld.pushes.size() == 3);
    REQUIRE_TRUE(wrld.turns.back().control.cc == 2);
}

TEST_CASE(midi_encoder_input_supports_incomplete_and_multi_slot_maps) {
    synth::MessageInBus bus(nullptr, 16);
    synth::EncoderMidiInConfig config;
    config.turnStep = 0.5f;
    config.turns.push_back({.control = {.channel = 0, .cc = 1}, .slotIx = 0, .position = 2});
    config.turns.push_back({.control = {.channel = 0, .cc = 7}, .slotIx = 4, .position = 3});
    synth::EncoderMidiInProcessor processor(config, &bus);
    processor.SetTimestampProvider([] { return 123; });

    processor.Process(synth::BasicMidi::CC(1, 0, 1, 65));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 123));
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 2);
    REQUIRE_NEAR(message.delta, 0.5f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(1, 0, 7, 62));
    REQUIRE_TRUE(bus.Pop(message, 123));
    REQUIRE_TRUE(message.slotIx == 4);
    REQUIRE_TRUE(message.position == 3);
    REQUIRE_NEAR(message.delta, -1.0f, 0.000001f);

    processor.Process(synth::BasicMidi::CC(1, 0, 2, 65));
    REQUIRE_TRUE(!bus.Pop(message, 123));
}

TEST_CASE(system_message_output_info_reports_colors_and_on_state) {
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 4, 3);
    ui.sceneCapacity = 2;
    ui.leftScene.store(0);
    ui.rightScene.store(1);
    ui.sceneBlend.store(0.25f);
    ui.shiftHeld.store(true);
    ui.banks[0].connected.store(true);
    ui.banks[0].selected.store(true);
    ui.banks[0].color.Store(synth::Color::Green);
    ui.banks[1].connected.store(true);
    ui.banks[1].selected.store(false);
    ui.banks[1].color.Store(synth::Color::Blue);
    for (std::size_t gestureIx = 0; gestureIx < 4; ++gestureIx) {
        ui.gestures.connected[gestureIx].store(true);
        ui.gestures.selected[gestureIx].store(false);
    }
    ui.gestures.selected[0].store(true);
    ui.gestures.bankAffectingCount[1].store(1);
    ui.gestures.bankAffectingMask[1].store(1u << 0u);
    ui.gestures.bankAffectingCount[2].store(2);
    ui.gestures.bankAffectingMask[2].store((1u << 0u) | (1u << 1u));

    synth::SystemMessageOutputInfo info(&ui);
    synth::SystemMessageOutputState state = info.Evaluate(synth::MessageIn::SelectParamBank(0, 0, 0));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Green);

    state = info.Evaluate(synth::MessageIn::SelectParamBank(0, 0, 1));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Blue.AdjustBrightness(0.35f));

    state = info.Evaluate(synth::MessageIn::SelectParamBank(0, 0, 99));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Off);

    state = info.Evaluate(synth::MessageIn::ToggleShift(0));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::White);
    ui.shiftHeld.store(false);
    state = info.Evaluate(synth::MessageIn::ToggleShift(0));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Grey);

    state = info.Evaluate(synth::MessageIn::SceneSelect(0, 0));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Orange.AdjustBrightness(0.5f + 0.5f * (1.0f - 0.25f)));
    state = info.Evaluate(synth::MessageIn::SceneSelect(0, 1));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Green.AdjustBrightness(0.5f + 0.5f * 0.25f));
    ui.leftScene.store(1);
    ui.rightScene.store(1);
    state = info.Evaluate(synth::MessageIn::SceneSelect(0, 1));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Orange.AdjustBrightness(0.5f + 0.5f * (1.0f - 0.25f)));
    state = info.Evaluate(synth::MessageIn::SceneSelect(0, 99));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Off);

    state = info.Evaluate(synth::MessageIn::ToggleGestureSelect(0, 0));
    REQUIRE_TRUE(state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::White);
    state = info.Evaluate(synth::MessageIn::ToggleGestureSelect(0, 1));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Green);
    state = info.Evaluate(synth::MessageIn::ToggleGestureSelect(0, 2));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::White);
    state = info.Evaluate(synth::MessageIn::ToggleGestureSelect(0, 3));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Grey.AdjustBrightness(0.5f));
    state = info.Evaluate(synth::MessageIn::ToggleGestureSelect(0, 99));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Off);

    state = info.Evaluate(synth::MessageIn::ParamPush(0, 0, 0));
    REQUIRE_TRUE(!state.isOn);
    REQUIRE_TRUE(state.color == synth::Color::Off);
}

TEST_CASE(system_output_processors_debounce_reset_and_render_cc_and_wrld_bldr) {
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 0, 0);
    ui.shiftHeld.store(true);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();

    synth::SystemCcMidiOutConfig ccConfig;
    ccConfig.associations.push_back({
        .control = {.channel = 5, .cc = 32},
        .message = synth::MessageIn::ToggleShift(0),
    });
    synth::SystemCcMidiOutProcessor ccProcessor(ccConfig, &sender, &ui);
    ccProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 1);
    REQUIRE_TRUE(sink.sent[0].Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(sink.sent[0].Channel() == 5);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 32);
    REQUIRE_TRUE(sink.sent[0].GetValue() == 127);

    ccProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 1);

    ui.shiftHeld.store(false);
    ccProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 2);
    REQUIRE_TRUE(sink.sent[1].GetValue() == 0);

    ccProcessor.Reset();
    ccProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[2].GetValue() == 0);

    synth::WrldBldrSystemMidiOutConfig wrldConfig;
    wrldConfig.associations.push_back({
        .position = {.channel = 5, .x = 0, .y = 4},
        .message = synth::MessageIn::ToggleShift(0),
    });
    synth::WrldBldrSystemMidiOutProcessor wrldProcessor(wrldConfig, &sender, &ui);
    ui.shiftHeld.store(true);
    wrldProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 4);
    REQUIRE_TRUE(sink.sent[3].IsSysEx());
    REQUIRE_TRUE(sink.sent[3].raw[8] == 5);
    REQUIRE_TRUE(sink.sent[3].raw[9] == synth::WrldBldrPositionToCC(0, 4));
    REQUIRE_TRUE(sink.sent[3].raw[10] == synth::Color::White.r / 2);
    REQUIRE_TRUE(sink.sent[3].raw[11] == synth::Color::White.g / 2);
    REQUIRE_TRUE(sink.sent[3].raw[12] == synth::Color::White.b / 2);

    wrldProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 4);

    wrldProcessor.Reset();
    wrldProcessor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 5);
    REQUIRE_TRUE(sink.sent[4].IsSysEx());
}

TEST_CASE(midi_controller_profile_builds_chained_input_processors) {
    synth::MessageInBus bus(nullptr, 16);
    synth::MidiControllerProfileConfig config;
    synth::EncoderMidiInConfig encoder;
    encoder.turnStep = 0.25f;
    encoder.turns.push_back({.control = {.channel = 0, .cc = 1}, .slotIx = 2, .position = 3});
    config.encoderInput = encoder;
    synth::AnalogMidiInConfig analog;
    analog.gestures.push_back({.control = {.channel = 2, .cc = 4}, .gestureIx = 5});
    config.analogInput = analog;
    config.systemMessages.push_back({
        .control = {.channel = 5, .cc = 32},
        .wrldBldrPosition = synth::WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 4},
        .press = synth::MessageIn::ToggleShift(0),
        .feedback = synth::MessageIn::ToggleShift(0),
    });

    synth::MidiControllerProfileResult profile =
        synth::CreateMidiControllerProfile(config, &bus, nullptr, nullptr, [] { return 88; });
    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(profile.inputThru.size() == 2);

    profile.input->Process(synth::BasicMidi::CC(1, 0, 1, 65));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.timestamp == 88);
    REQUIRE_TRUE(message.slotIx == 2);
    REQUIRE_TRUE(message.position == 3);
    REQUIRE_NEAR(message.delta, 0.25f, 0.000001f);

    profile.input->Process(synth::BasicMidi::CC(1, 2, 4, 127));
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.timestamp == 88);
    REQUIRE_TRUE(message.gestureIx == 5);
    REQUIRE_NEAR(message.value, 1.0f, 0.000001f);

    profile.input->Process(synth::BasicMidi::CC(1, 5, 32, 1));
    REQUIRE_TRUE(bus.Pop(message, 88));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.timestamp == 88);
}

TEST_CASE(midi_controller_profile_builds_independent_outputs_from_shared_system_associations) {
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 0, 0);
    ui.shiftHeld.store(true);

    synth::MidiControllerProfileConfig config;
    config.systemMessages.push_back({
        .control = {.channel = 5, .cc = 32},
        .wrldBldrPosition = synth::WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 4},
        .press = synth::MessageIn::ToggleShift(0),
        .feedback = synth::MessageIn::ToggleShift(0),
    });

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    synth::MidiControllerProfileResult profile =
        synth::CreateMidiControllerProfile(config, nullptr, &sender, &ui);

    REQUIRE_TRUE(profile.outputs.size() == 2);
    profile.outputs[0]->Process();
    profile.outputs[1]->Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();

    REQUIRE_TRUE(sink.sent.size() == 2);
    REQUIRE_TRUE(sink.sent[0].Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(sink.sent[0].Channel() == 5);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 32);
    REQUIRE_TRUE(sink.sent[0].GetValue() == 127);
    REQUIRE_TRUE(sink.sent[1].IsSysEx());
    REQUIRE_TRUE(sink.sent[1].raw[8] == 5);
    REQUIRE_TRUE(sink.sent[1].raw[9] == synth::WrldBldrPositionToCC(0, 4));
}

TEST_CASE(wrld_bldr_default_profile_maps_encoders_analogs_and_system_buttons) {
    synth::ParameterManager manager;
    manager.SetGestureCount(1);
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 2,
        .maxParameters = 2,
    });
    auto& parameter = manager.CreateParameter(group, {.name = "Cutoff", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    manager.SetSceneEndpoints(0, 0);

    synth::MessageInBus bus(&manager, 64);
    synth::WrldBldrDefaultProfileOptions options;
    options.visibleEncoderCount = 1;
    options.sceneCount = 8;
    options.bankButtonCount = 16;
    options.gestureSelectorCount = 1;
    synth::MidiControllerProfileResult profile =
        synth::CreateWrldBldrDefaultProfile(options, &bus, nullptr, nullptr, [] { return 99; });
    REQUIRE_TRUE(profile.input != nullptr);
    REQUIRE_TRUE(profile.inputThru.size() == 2);

    profile.input->Process(synth::BasicMidi::CC(0, 0, 0, 65));
    synth::MessageIn message;
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 0);

    profile.input->Process(synth::BasicMidi::CC(0, 2, 0, 127));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetSceneBlend);
    REQUIRE_NEAR(message.value, 1.0f, 0.000001f);

    profile.input->Process(synth::BasicMidi::CC(0, 2, 1, 64));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_NEAR(message.value, 64.0f / 127.0f, 0.000001f);

    profile.input->Process(synth::BasicMidi::CC(0, 14, 0, 32));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.gestureIx == 1);
    REQUIRE_NEAR(message.value, 32.0f / 127.0f, 0.000001f);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(0, 4), 127));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(0, 4), 0));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleShift);
    REQUIRE_TRUE(message.hasBoolValue);
    REQUIRE_TRUE(!message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(0, 0), 127));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_TRUE(message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(0, 0), 0));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_TRUE(!message.boolValue);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(1, 6), 127));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(message.sceneIx == 1);

    profile.input->Process(synth::BasicMidi::CC(0, 5, synth::WrldBldrPositionToCC(7, 2), 127));
    REQUIRE_TRUE(bus.Pop(message, 99));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SelectParamBank);
    REQUIRE_TRUE(message.bankIx == 15);
    bus.Push(message);
    bus.Process(99);
    REQUIRE_TRUE(slot.SelectedBank() == &bank);
    REQUIRE_TRUE(manager.Scene().leftScene == 0);
    REQUIRE_TRUE(manager.Scene().rightScene == 0);
}

TEST_CASE(wrld_bldr_default_profile_creates_encoder_and_system_outputs) {
    synth::ParameterManager::UIState ui;
    ui.Configure(0, 0, 0, 0, 0);
    ui.shiftHeld.store(true);

    synth::WrldBldrDefaultProfileOptions options;
    options.visibleEncoderCount = 1;
    options.sceneCount = 1;
    options.bankButtonCount = 1;
    options.gestureSelectorCount = 1;
    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    synth::MidiControllerProfileResult profile =
        synth::CreateWrldBldrDefaultProfile(options, nullptr, &sender, &ui);

    REQUIRE_TRUE(profile.outputs.size() == 3);
    profile.outputs[1]->Process();
    profile.outputs[2]->Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() >= 2);
    bool sawCc = false;
    bool sawSysex = false;
    for (const synth::BasicMidi& midi : sink.sent) {
        sawCc = sawCc || midi.Status() == synth::BasicMidi::kStatusCC;
        sawSysex = sawSysex || midi.IsSysEx();
    }
    REQUIRE_TRUE(sawCc);
    REQUIRE_TRUE(sawSysex);
}

TEST_CASE(midi_sender_delivers_fifo_and_stops_cleanly) {
    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    REQUIRE_TRUE(sender.Enqueue(synth::BasicMidi::CC(0, 0, 1, 2)));
    REQUIRE_TRUE(sender.Enqueue(synth::BasicMidi::CC(0, 0, 3, 4)));
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 2);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 1);
    REQUIRE_TRUE(sink.sent[1].GetCC() == 3);
}

TEST_CASE(twister_output_debounces_reset_and_uses_channels) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numModulators = 1,
        .numScenes = 2,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
    });
    auto& parameter = manager.CreateParameter(group, {
        .name = "Cutoff",
        .shortName = "Cut",
        .defaultValue = 0.5f,
        .color = synth::Color::Green,
    });
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::TwisterDefault(0);
    config.KeepFirstPositions(1);
    synth::TwisterMidiOutProcessor processor(config, &sender, ui.get());
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[0].Channel() == 1);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 0);
    REQUIRE_TRUE(sink.sent[0].GetValue() != 0);
    REQUIRE_TRUE(sink.sent[1].Channel() == 2);
    REQUIRE_TRUE(sink.sent[1].GetValue() == synth::FullBrightnessAnimationValue());
    REQUIRE_TRUE(sink.sent[2].Channel() == 0);
    REQUIRE_TRUE(sink.sent[2].GetValue() == 64);
    const std::size_t afterFirst = sink.sent.size();

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == afterFirst);

    processor.Reset();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == afterFirst + 3);
    sender.Stop();
}

TEST_CASE(twister_output_skips_unstable_snapshot_without_cache_update) {
    synth::ParameterManager::UIState ui;
    ui.Configure(1, 1, 1, 0);
    ui.slots[0].connected.store(true);
    ui.slots[0].cells[0].revision.store(1);
    ui.slots[0].cells[0].connected.store(true);
    ui.slots[0].cells[0].voiceCount.store(1);
    ui.slots[0].cells[0].values[0].store(0.25f);
    ui.slots[0].cells[0].color.Store(synth::Color::Red);
    ui.slots[0].cells[0].indicatorColors[0].Store(synth::Color::Cyan);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::TwisterDefault(0);
    config.KeepFirstPositions(1);
    synth::TwisterMidiOutProcessor processor(config, &sender, &ui);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(200));
    REQUIRE_TRUE(sink.sent.empty());

    auto& stableCell = ui.slots[0].cells[0];
    stableCell.revision.store(2);
    stableCell.connected.store(true);
    stableCell.voiceCount.store(1);
    stableCell.values[0].store(0.25f);
    stableCell.color.Store(synth::Color::Red);
    stableCell.indicatorColors[0].Store(synth::Color::Cyan);
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 3);
}

TEST_CASE(twister_output_blanks_disconnected_mapped_cells_once) {
    synth::ParameterManager::UIState ui;
    ui.Configure(1, 1, 1, 0);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::TwisterDefault(0);
    config.KeepFirstPositions(1);
    synth::TwisterMidiOutProcessor processor(config, &sender, &ui);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[0].Channel() == 1);
    REQUIRE_TRUE(sink.sent[0].GetValue() == 0);
    REQUIRE_TRUE(sink.sent[1].Channel() == 2);
    REQUIRE_TRUE(sink.sent[1].GetValue() == 0);
    REQUIRE_TRUE(sink.sent[2].Channel() == 0);
    REQUIRE_TRUE(sink.sent[2].GetValue() == 0);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 3);
}

TEST_CASE(wrld_bldr_output_sends_value_and_source_derived_sysex) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 1,
        .numScenes = 1,
        .maxParameters = 1,
        .processLiteAlpha = 1.0f,
        .voiceIndicatorColors = {synth::Color::Cyan},
    });
    auto& parameter = manager.CreateParameter(group, {
        .name = "Gain",
        .defaultValue = 0.25f,
        .color = synth::Color::Orange,
    });
    auto& bank = manager.CreateBank();
    bank.AddMapping(10, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(10);
    slot.SelectBank(&bank);
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::WrldBldrDefault(0);
    config.KeepFirstPositions(1);
    synth::WrldBldrMidiOutProcessor processor(config, &sender, ui.get());
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[0].Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(sink.sent[0].Channel() == 0);
    REQUIRE_TRUE(sink.sent[0].GetCC() == 0);
    REQUIRE_TRUE(sink.sent[0].GetValue() == 32);

    const synth::BasicMidi& button = sink.sent[1];
    REQUIRE_TRUE(button.raw.size() == 14);
    REQUIRE_TRUE(button.raw[0] == 0xF0);
    REQUIRE_TRUE(button.raw[1] == 0x79);
    REQUIRE_TRUE(button.raw[2] == 0x74);
    REQUIRE_TRUE(button.raw[3] == 0x78);
    REQUIRE_TRUE(button.raw[4] == 0x00);
    REQUIRE_TRUE(button.raw[5] == 0x01);
    REQUIRE_TRUE(button.raw[6] == 0x00);
    REQUIRE_TRUE(button.raw[7] == 0x20);
    REQUIRE_TRUE(button.raw[8] == 1);
    REQUIRE_TRUE(button.raw[9] == 0);
    REQUIRE_TRUE(button.raw[10] == synth::Color::Orange.r / 2);
    REQUIRE_TRUE(button.raw[11] == synth::Color::Orange.g / 2);
    REQUIRE_TRUE(button.raw[12] == synth::Color::Orange.b / 2);
    REQUIRE_TRUE(button.raw[13] == 0xF7);

    const synth::BasicMidi& indicator = sink.sent[2];
    REQUIRE_TRUE(indicator.raw.size() == 14);
    REQUIRE_TRUE(indicator.raw[8] == 0);
    REQUIRE_TRUE(indicator.raw[9] == 0);
    REQUIRE_TRUE(indicator.raw[10] == synth::Color::Cyan.r / 2);
    REQUIRE_TRUE(indicator.raw[11] == synth::Color::Cyan.g / 2);
    REQUIRE_TRUE(indicator.raw[12] == synth::Color::Cyan.b / 2);
    REQUIRE_TRUE(indicator.raw[13] == 0xF7);

    const std::size_t afterFirst = sink.sent.size();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == afterFirst);

    processor.Reset();
    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == afterFirst + 3);
    sender.Stop();
}

TEST_CASE(wrld_bldr_output_blanks_disconnected_mapped_cells_once) {
    synth::ParameterManager::UIState ui;
    ui.Configure(1, 1, 1, 0);

    FakeMidiSink sink;
    synth::MidiSender sender;
    sender.SetSink(&sink);
    sender.Start();
    auto config = synth::EncoderMidiOutConfig::WrldBldrDefault(0);
    config.KeepFirstPositions(1);
    synth::WrldBldrMidiOutProcessor processor(config, &sender, &ui);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    REQUIRE_TRUE(sink.sent.size() == 3);
    REQUIRE_TRUE(sink.sent[0].Status() == synth::BasicMidi::kStatusCC);
    REQUIRE_TRUE(sink.sent[0].Channel() == 0);
    REQUIRE_TRUE(sink.sent[0].GetValue() == 0);
    REQUIRE_TRUE(sink.sent[1].raw[8] == 1);
    REQUIRE_TRUE(sink.sent[1].raw[10] == 0);
    REQUIRE_TRUE(sink.sent[1].raw[11] == 0);
    REQUIRE_TRUE(sink.sent[1].raw[12] == 0);
    REQUIRE_TRUE(sink.sent[2].raw[8] == 0);
    REQUIRE_TRUE(sink.sent[2].raw[10] == 0);
    REQUIRE_TRUE(sink.sent[2].raw[11] == 0);
    REQUIRE_TRUE(sink.sent[2].raw[12] == 0);

    processor.Process();
    sender.FlushForTests(std::chrono::milliseconds(500));
    sender.Stop();
    REQUIRE_TRUE(sink.sent.size() == 3);
}

TEST_CASE(message_bus_single_producer_single_consumer_threaded_order) {
    constexpr std::size_t kMessages = 1000;
    synth::MessageInBus bus(nullptr, 64);
    std::atomic<bool> producerDone{false};
    std::atomic<bool> failed{false};

    std::thread producer([&] {
        for (std::size_t ix = 0; ix < kMessages; ++ix) {
            const auto message = synth::MessageIn::SetSceneBlend(static_cast<std::uint64_t>(ix), static_cast<float>(ix));
            while (!bus.Push(message)) {
                std::this_thread::yield();
            }
        }
        producerDone.store(true, std::memory_order_release);
    });

    std::thread consumer([&] {
        std::size_t expected = 0;
        while (expected < kMessages) {
            synth::MessageIn message;
            if (!bus.Pop(message, kMessages)) {
                if (producerDone.load(std::memory_order_acquire) && bus.Size() == 0) {
                    failed.store(true, std::memory_order_release);
                    return;
                }
                std::this_thread::yield();
                continue;
            }
            if (message.timestamp != expected || message.type != synth::MessageIn::Type::SetSceneBlend) {
                failed.store(true, std::memory_order_release);
                return;
            }
            ++expected;
        }
    });

    producer.join();
    consumer.join();
    REQUIRE_TRUE(!failed.load());
    REQUIRE_TRUE(bus.Size() == 0);
}

TEST_CASE(clear_gesture_active_flags_for_active_scene_selection) {
    synth::ParameterManager manager;
    manager.SetGestureCount(2);
    manager.Scene() = {.leftScene = 0, .rightScene = 1, .blend = 0.5f};
    auto& group = manager.CreateGroup({
        .numVoices = 1,
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

    manager.ClearGestureActiveFlagsForActiveSceneSelection(0);

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
    std::array<std::array<bool, kSimGestures>, kSimScenes> gestureActive{};
    std::array<int, kSimMods> route{};
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

float SimRangeMin(synth::RangeKind range) {
    return range == synth::RangeKind::Bipolar ? -1.0f : 0.0f;
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
    float value = parameter.currentCenter * parameter.currentCenterScale[voiceIx] +
                  parameter.currentNormalizationOffset[voiceIx];
    for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
        value += oracle.modulatorValue[voiceIx][modIx] * parameter.currentDepth[voiceIx][modIx];
    }
    return SimClamp(value, parameter.range);
}

float SimTargetGet(const SimOracle& oracle, std::size_t paramIx, std::size_t voiceIx) {
    const SimParam& parameter = oracle.params[paramIx];
    float value = parameter.targetCenter * parameter.targetCenterScale[voiceIx] +
                  parameter.targetNormalizationOffset[voiceIx];
    for (std::size_t modIx = 0; modIx < kSimMods; ++modIx) {
        value += oracle.modulatorValue[voiceIx][modIx] * parameter.targetDepth[voiceIx][modIx];
    }
    return SimClamp(value, parameter.range);
}

std::size_t SimSwitchVal(const SimOracle& oracle, std::size_t paramIx, std::size_t voiceIx) {
    const SimParam& parameter = oracle.params[paramIx];
    if (parameter.switchValues <= 1) {
        return 0;
    }
    float normalized = SimTargetGet(oracle, paramIx, voiceIx);
    if (parameter.range == synth::RangeKind::Bipolar) {
        normalized = (normalized + 1.0f) * 0.5f;
    }
    normalized = std::clamp(normalized, 0.0f, 1.0f);
    const double maxBucket = static_cast<double>(parameter.switchValues - 1);
    return static_cast<std::size_t>(std::clamp(std::round(static_cast<double>(normalized) * maxBucket), 0.0, maxBucket));
}

bool SimHasNonZeroState(const SimOracle& oracle, const SimParam& parameter) {
    constexpr float tolerance = 0.000001f;
    if (std::fabs(parameter.currentCenter) > tolerance || std::fabs(parameter.targetCenter) > tolerance) {
        return true;
    }
    for (const float center : parameter.sceneCenter) {
        if (std::fabs(center) > tolerance) {
            return true;
        }
    }
    for (const auto& row : parameter.gestureActive) {
        for (const bool active : row) {
            if (active) {
                return true;
            }
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
        for (const float depth : row) {
            if (std::fabs(depth) > tolerance) {
                return true;
            }
        }
    }
    for (const int route : parameter.route) {
        if (route >= 0 && SimHasNonZeroState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
            return true;
        }
    }
    return false;
}

std::uint32_t SimModulatorsAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
    std::uint32_t mask = 0;
    for (std::size_t modIx = 0; modIx < std::min<std::size_t>(kSimMods, 32); ++modIx) {
        const int route = parameter.route[modIx];
        if (route >= 0 && SimHasNonZeroState(oracle, oracle.params[static_cast<std::size_t>(route)])) {
            mask |= (std::uint32_t{1} << modIx);
        }
    }
    return mask;
}

std::uint32_t SimGesturesAffectingMask(const SimOracle& oracle, const SimParam& parameter) {
    std::uint32_t mask = 0;
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
            mask |= (std::uint32_t{1} << gestureIx);
        }
    }
    return mask;
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

        float normalizationOffset = 0.0f;
        for (const float depth : parameter.targetDepth[voiceIx]) {
            normalizationOffset -= std::min(0.0f, depth);
        }
        parameter.targetNormalizationOffset[voiceIx] = normalizationOffset;

        if (weightSum > 1.0f) {
            parameter.targetMinValue[voiceIx] = SimRangeMin(parameter.range);
            parameter.targetMaxValue[voiceIx] = 1.0f;
        } else {
            float minContribution = 0.0f;
            float maxContribution = 0.0f;
            for (const float depth : parameter.targetDepth[voiceIx]) {
                minContribution += std::min(0.0f, depth);
                maxContribution += std::max(0.0f, depth);
            }
            const float base = parameter.targetCenter * parameter.targetCenterScale[voiceIx] +
                               parameter.targetNormalizationOffset[voiceIx];
            parameter.targetMinValue[voiceIx] = SimClamp(base + minContribution, parameter.range);
            parameter.targetMaxValue[voiceIx] = SimClamp(base + maxContribution, parameter.range);
        }
    }

    if (recursionDepth > 0) {
        parameter.currentCenter = parameter.targetCenter;
        parameter.currentCenterScale = parameter.targetCenterScale;
        parameter.currentNormalizationOffset = parameter.targetNormalizationOffset;
        parameter.currentMinValue = parameter.targetMinValue;
        parameter.currentMaxValue = parameter.targetMaxValue;
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
        parameter.currentNormalizationOffset[voiceIx] +=
            alpha * (parameter.targetNormalizationOffset[voiceIx] - parameter.currentNormalizationOffset[voiceIx]);
        parameter.currentMinValue[voiceIx] +=
            alpha * (parameter.targetMinValue[voiceIx] - parameter.currentMinValue[voiceIx]);
        parameter.currentMaxValue[voiceIx] +=
            alpha * (parameter.targetMaxValue[voiceIx] - parameter.currentMaxValue[voiceIx]);
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

    if (kSimMods > kSimSlotEncoders.size() - 1) {
        throw std::logic_error("simulation slot has too many modulators");
    }

    for (std::size_t cellIx = 0; cellIx < kSimMods; ++cellIx) {
        bank.visible.push_back({
            .encoder = kSimSlotEncoders[cellIx],
            .parameter = oracle.params[static_cast<std::size_t>(paramIx)].route[cellIx],
        });
    }
    bank.visible.push_back({
        .encoder = kSimSlotEncoders.back(),
        .parameter = paramIx,
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

void SimResetDepthToNeutral(SimOracle& oracle, SimParam& parameter) {
    for (const int route : parameter.route) {
        if (route >= 0) {
            SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
        }
    }

    for (auto& row : parameter.currentDepth) {
        row.fill(0.0f);
    }
    for (auto& row : parameter.targetDepth) {
        row.fill(0.0f);
    }

    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    auto resetScene = [&](std::size_t sceneIx) {
        parameter.sceneCenter[sceneIx] = 0.0f;
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

    parameter.currentCenter = 0.0f;
    parameter.targetCenter = 0.0f;
    parameter.currentCenterScale.fill(1.0f);
    parameter.targetCenterScale.fill(1.0f);
    parameter.currentNormalizationOffset.fill(0.0f);
    parameter.targetNormalizationOffset.fill(0.0f);
    parameter.currentMinValue.fill(0.0f);
    parameter.targetMinValue.fill(0.0f);
    parameter.currentMaxValue.fill(0.0f);
    parameter.targetMaxValue.fill(0.0f);
}

void SimRevertToDefault(SimOracle& oracle, SimParam& parameter) {
    for (const int route : parameter.route) {
        if (route >= 0) {
            SimResetDepthToNeutral(oracle, oracle.params[static_cast<std::size_t>(route)]);
        }
    }

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
    parameter.currentNormalizationOffset.fill(0.0f);
    parameter.targetNormalizationOffset.fill(0.0f);
    parameter.currentMinValue.fill(defaultValue);
    parameter.targetMinValue.fill(defaultValue);
    parameter.currentMaxValue.fill(defaultValue);
    parameter.targetMaxValue.fill(defaultValue);
}

bool SimEncoderIsPhysical(synth::PhysicalEncoderId encoder) {
    return std::find(kSimSlotEncoders.begin(), kSimSlotEncoders.end(), encoder) != kSimSlotEncoders.end();
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
    if (bank.selectedParameter >= 0 && cell->parameter == bank.selectedParameter) {
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
    if (cell == nullptr || cell->parameter < 0) {
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
    if (cell == nullptr || cell->parameter < 0) {
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
                     oracle.gestureWeight[gestureIx], manager.GestureValue(gestureIx));
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
                             actual.TargetDepths(voiceIx)[modIx]);
                SimCheckNear(seed, step, action, SimParamField(actual, paramIx, modField + " current depth"),
                             expected.currentDepth[voiceIx][modIx],
                             actual.CurrentDepths(voiceIx)[modIx]);
            }
            SimCheckNear(seed, step, action, SimParamField(actual, paramIx, voiceField + " get"),
                         SimGet(oracle, paramIx, voiceIx), actual.Get(voiceIx));
        }
    }

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
        for (const synth::PhysicalEncoderId encoder : kSimSlotEncoders) {
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

void SimCheckUIState(const SimOracle& oracle, const synth::ParameterManager::UIState& ui, unsigned seed, int step,
                     const std::string& action) {
    if (ui.leftScene.load() != oracle.scene.leftScene || ui.rightScene.load() != oracle.scene.rightScene) {
        SimFailBool(seed, step, action, "ui scene endpoints");
    }
    SimCheckNear(seed, step, action, "ui scene blend", oracle.scene.blend, ui.sceneBlend.load());
    if (ui.shiftHeld.load()) {
        SimFailBool(seed, step, action, "ui shift held");
    }

    const SimBank& bank = oracle.banks[static_cast<std::size_t>(oracle.selectedBank)];
    const std::array<synth::Color, 4> defaultIndicators{
        synth::Color::Cyan,
        synth::Color::Orange,
        synth::Color::Green,
        synth::Color::Indigo,
    };
    for (std::size_t position = 0; position < kSimSlotEncoders.size(); ++position) {
        const SimCell* cell = SimFindCell(bank, kSimSlotEncoders[position]);
        const synth::Parameter::UIState& actual = ui.slots[0].cells[position];
        const bool expectedConnected = cell != nullptr && cell->parameter >= 0;
        if (actual.connected.load() != expectedConnected) {
            SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " connected");
        }
        if (!expectedConnected) {
            if (actual.switchValues.load() != 0 || actual.modulatorsAffectingMask.load() != 0 ||
                actual.gesturesAffectingMask.load() != 0) {
                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " disconnected switches/masks");
            }
        }
        if (expectedConnected) {
            const std::size_t paramIx = static_cast<std::size_t>(cell->parameter);
            const SimParam& expected = oracle.params[paramIx];
            if (actual.bipolar.load() != (expected.range == synth::RangeKind::Bipolar)) {
                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " bipolar");
            }
            if (actual.color.Load() != synth::Color::Grey) {
                SimFailBool(seed, step, action, "ui position=" + std::to_string(position) + " color");
            }
            const std::size_t expectedSwitchValues = expected.switchValues;
            const std::uint32_t expectedModulatorMask = SimModulatorsAffectingMask(oracle, expected);
            const std::uint32_t expectedGestureMask = SimGesturesAffectingMask(oracle, expected);
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
                SimCheckNear(seed, step, action,
                             "ui position=" + std::to_string(position) + " voice=" + std::to_string(voiceIx),
                             SimGet(oracle, paramIx, voiceIx),
                             actual.values[voiceIx].load());
                SimCheckNear(seed, step, action,
                             "ui position=" + std::to_string(position) + " min=" + std::to_string(voiceIx),
                             expected.currentMinValue[voiceIx], actual.minValues[voiceIx].load());
                SimCheckNear(seed, step, action,
                             "ui position=" + std::to_string(position) + " max=" + std::to_string(voiceIx),
                             expected.currentMaxValue[voiceIx], actual.maxValues[voiceIx].load());
                const std::size_t expectedSwitchValue = SimSwitchVal(oracle, paramIx, voiceIx);
                if (actual.switchValue[voiceIx].load() != expectedSwitchValue) {
                    SimFailBool(seed, step, action,
                                "ui position=" + std::to_string(position) + " switch=" + std::to_string(voiceIx));
                }
                if (actual.indicatorColors[voiceIx].Load() != defaultIndicators[voiceIx]) {
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
        if (ui.gestures.selected[gestureIx].load() != oracle.gestureSelected[gestureIx]) {
            SimFailBool(seed, step, action, "ui gesture selected");
        }
        SimCheckNear(seed, step, action, "ui gesture value", oracle.gestureWeight[gestureIx],
                     ui.gestures.values[gestureIx].load());
    }
}

void SimInitializeOracle(SimOracle& oracle) {
    const std::array<float, kSimParams> defaults{0.35f, 0.1f, -0.2f};
    const std::array<synth::RangeKind, kSimParams> ranges{
        synth::RangeKind::Unipolar,
        synth::RangeKind::Bipolar,
        synth::RangeKind::Bipolar,
    };
    const std::array<std::size_t, kSimParams> switchValues{5, 0, 3};

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
        for (auto& row : parameter.gestureActive) {
            row.fill(false);
        }
        parameter.route.fill(-1);
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
        {.encoder = 10, .parameter = 0},
        {.encoder = 11, .parameter = 1},
        {.encoder = 12, .parameter = 2},
    };
    oracle.banks[1].top = {
        {.encoder = 20, .parameter = 2},
        {.encoder = 21, .parameter = 0},
    };
    SimDeselect(oracle.banks[0]);
    SimDeselect(oracle.banks[1]);
}

void SimSetLessSelectedScene(SimOracle& oracle, std::size_t sceneIx) {
    if (sceneIx >= kSimScenes) {
        return;
    }
    const float blend = std::clamp(oracle.scene.blend, 0.0f, 1.0f);
    if (blend <= 0.5f) {
        oracle.scene.rightScene = sceneIx;
    } else {
        oracle.scene.leftScene = sceneIx;
    }
}

} // namespace

TEST_CASE(randomized_parameter_modulation_simulation) {
    const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
    const int steps = SimStepsFromEnvironment();

    for (const unsigned seed : seeds) {
        synth::ParameterManager manager;
        manager.SetGestureCount(2);
        auto& group = manager.CreateGroup({
            .numVoices = kSimVoices,
            .numModulators = kSimMods,
            .numScenes = kSimScenes,
            .maxParameters = kSimParams,
            .processLiteAlpha = 0.25f,
        });
        auto& carrier = manager.CreateParameter(group, {
            .name = "Carrier",
            .defaultValue = 0.35f,
            .switchValues = 5,
        });
        auto& depthA = manager.CreateParameter(
            group, {.name = "DepthA", .defaultValue = 0.1f, .range = synth::RangeKind::Bipolar});
        auto& depthB = manager.CreateParameter(
            group, {
                .name = "DepthB",
                .defaultValue = -0.2f,
                .range = synth::RangeKind::Bipolar,
                .switchValues = 3,
            });
        REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depthA));
        REQUIRE_TRUE(carrier.AssignModulationDepth(1, &depthB));
        REQUIRE_TRUE(depthA.AssignModulationDepth(0, &depthB));

        auto& auxGroup = manager.CreateGroup({
            .numVoices = 1,
            .numScenes = kSimScenes,
            .maxParameters = 1,
        });
        auto& aux = manager.CreateParameter(auxGroup, {.name = "Aux", .defaultValue = 0.25f});
        REQUIRE_TRUE(manager.NumGroups() == 2);
        REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
        manager.SetSceneBlend(0.25f);

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
                manager.SelectGesture(gestureIx);
                oracle.gestureSelected[gestureIx] = true;
                break;
            }
            case 4: {
                const std::size_t gestureIx = rng() % kSimGestures;
                action = "deselect gesture " + std::to_string(gestureIx);
                manager.DeselectGesture(gestureIx);
                oracle.gestureSelected[gestureIx] = false;
                break;
            }
            case 5: {
                const std::size_t gestureIx = rng() % kSimGestures;
                const float value = unipolarDist(rng);
                action = "set gesture value " + std::to_string(gestureIx);
                manager.SetGestureValue(gestureIx, value);
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
                REQUIRE_TRUE(manager.SetSceneEndpoints(left, right));
                oracle.scene.leftScene = left;
                oracle.scene.rightScene = right;
                break;
            }
            case 9: {
                const float blend = unipolarDist(rng);
                action = "change blend";
                manager.SetSceneBlend(blend);
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
                manager.ClearGestureActiveFlagsForActiveSceneSelection(gestureIx);
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

TEST_CASE(randomized_message_bus_ui_state_simulation) {
    const std::vector<unsigned> seeds = SimSeedsFromEnvironment();
    const int steps = std::min(SimStepsFromEnvironment(), 250);

    for (const unsigned seed : seeds) {
        synth::ParameterManager manager;
        manager.SetGestureCount(kSimGestures);
        auto& group = manager.CreateGroup({
            .numVoices = kSimVoices,
            .numModulators = kSimMods,
            .numScenes = kSimScenes,
            .maxParameters = kSimParams,
            .processLiteAlpha = 0.25f,
        });
        auto& carrier = manager.CreateParameter(group, {
            .name = "Carrier",
            .defaultValue = 0.35f,
            .switchValues = 5,
        });
        auto& depthA = manager.CreateParameter(
            group, {.name = "DepthA", .defaultValue = 0.1f, .range = synth::RangeKind::Bipolar});
        auto& depthB = manager.CreateParameter(
            group, {
                .name = "DepthB",
                .defaultValue = -0.2f,
                .range = synth::RangeKind::Bipolar,
                .switchValues = 3,
            });
        REQUIRE_TRUE(carrier.AssignModulationDepth(0, &depthA));
        REQUIRE_TRUE(carrier.AssignModulationDepth(1, &depthB));
        REQUIRE_TRUE(depthA.AssignModulationDepth(0, &depthB));

        auto& auxGroup = manager.CreateGroup({
            .numVoices = 1,
            .numScenes = kSimScenes,
            .maxParameters = 1,
        });
        auto& aux = manager.CreateParameter(auxGroup, {.name = "Aux", .defaultValue = 0.25f});
        (void)aux;
        REQUIRE_TRUE(manager.SetSceneEndpoints(0, 1));
        manager.SetSceneBlend(0.25f);

        auto& pageA = manager.CreatePage("A");
        auto& pageB = manager.CreatePage("B");
        manager.AssignParameterToPage(pageA.ordinal, carrier);
        manager.AssignParameterToPage(pageB.ordinal, depthA);
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

        synth::MessageInBus bus(&manager, 256);
        auto ui = manager.CreateUIState();
        SimOracle oracle;
        SimInitializeOracle(oracle);
        const std::array<synth::Parameter*, kSimParams> params{&carrier, &depthA, &depthB};
        const std::array<synth::Bank*, 2> banks{&bankA, &bankB};
        const std::array<synth::PhysicalEncoderId, 6> encoders{10, 11, 12, 20, 21, 99};
        std::mt19937 rng(seed ^ 0xB05u);
        std::uniform_real_distribution<float> deltaDist(-0.18f, 0.18f);
        std::uniform_real_distribution<float> bipolarDist(-1.0f, 1.0f);
        std::uniform_real_distribution<float> unipolarDist(0.0f, 1.0f);
        std::uint64_t timestamp = 1;

        SimCheck(oracle, params, banks, group, slot, manager, seed, -1, "initial bus");
        manager.PopulateUIState(*ui);
        SimCheckUIState(oracle, *ui, seed, -1, "initial bus ui");

        for (int step = 0; step < steps; ++step) {
            std::string action;
            switch (rng() % 13) {
            case 0: {
                const std::size_t position = rng() % encoders.size();
                const float delta = deltaDist(rng);
                action = "bus turn position " + std::to_string(position);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(timestamp, 0, position, delta)));
                bus.Process(timestamp);
                SimHandleTick(oracle, encoders[position], delta);
                break;
            }
            case 1: {
                const std::size_t position = rng() % encoders.size();
                action = "bus press position " + std::to_string(position);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(timestamp, 0, position)));
                bus.Process(timestamp);
                SimHandlePress(oracle, encoders[position]);
                break;
            }
            case 2: {
                const std::size_t position = rng() % encoders.size();
                action = "bus shift press position " + std::to_string(position);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(timestamp, true)));
                REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamPush(timestamp, 0, position)));
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SetShift(timestamp, false)));
                bus.Process(timestamp);
                SimHandleShiftPress(oracle, encoders[position]);
                break;
            }
            case 3: {
                const std::size_t gestureIx = rng() % kSimGestures;
                action = "bus toggle gesture " + std::to_string(gestureIx);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::ToggleGestureSelect(timestamp, gestureIx)));
                bus.Process(timestamp);
                oracle.gestureSelected[gestureIx] = !oracle.gestureSelected[gestureIx];
                break;
            }
            case 4: {
                const std::size_t gestureIx = rng() % kSimGestures;
                const float value = unipolarDist(rng);
                action = "bus set gesture value " + std::to_string(gestureIx);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SetGestureValue(timestamp, gestureIx, value)));
                bus.Process(timestamp);
                oracle.gestureWeight[gestureIx] = value;
                break;
            }
            case 5: {
                const int bankIx = static_cast<int>(rng() % 2);
                action = "bus select bank " + std::to_string(bankIx);
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SelectParamBank(timestamp, 0, static_cast<std::size_t>(bankIx))));
                bus.Process(timestamp);
                SimSelectBank(oracle, bankIx);
                break;
            }
            case 6: {
                const std::size_t sceneIx = rng() % kSimScenes;
                action = "bus scene";
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SceneSelect(timestamp, sceneIx)));
                bus.Process(timestamp);
                SimSetLessSelectedScene(oracle, sceneIx);
                break;
            }
            case 7: {
                const float blend = unipolarDist(rng);
                action = "bus blend";
                REQUIRE_TRUE(bus.Push(synth::MessageIn::SetSceneBlend(timestamp, blend)));
                bus.Process(timestamp);
                oracle.scene.blend = blend;
                break;
            }
            case 8: {
                const std::size_t voiceIx = rng() % kSimVoices;
                const std::size_t modIx = rng() % kSimMods;
                const float value = bipolarDist(rng);
                action = "change modulator";
                group.GetModulators().Value(voiceIx, modIx) = value;
                oracle.modulatorValue[voiceIx][modIx] = value;
                break;
            }
            case 9:
                action = "compute";
                for (synth::Parameter* parameter : params) {
                    parameter->Compute(manager.Scene());
                }
                SimComputeAll(oracle);
                break;
            case 10:
                action = "process lite";
                for (synth::Parameter* parameter : params) {
                    parameter->ProcessLite();
                }
                SimProcessLiteAll(oracle);
                break;
            case 11: {
                action = "bus inert transport";
                REQUIRE_TRUE(bus.Push(synth::MessageIn::Clock(timestamp)));
                REQUIRE_TRUE(bus.Push(synth::MessageIn::Start(timestamp)));
                REQUIRE_TRUE(bus.Push(synth::MessageIn::Stop(timestamp)));
                bus.Process(timestamp);
                break;
            }
            case 12: {
                action = "bus invalid scene";
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
            SimCheck(oracle, params, banks, group, slot, manager, seed, step, action);
            if (step % 11 == 0) {
                manager.PopulateUIState(*ui);
                SimCheckUIState(oracle, *ui, seed, step, action);
            }
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
    manager.SetGestureCount(2);
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
