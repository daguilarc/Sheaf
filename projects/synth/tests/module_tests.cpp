#include "synth/Modules.hpp"

// DemoModulation.hpp lives under apps/miniapp/ (JUCE-free); built with
// -Iapps/miniapp (see the root Makefile's rule for this binary) so this
// resolves without duplicating the header. Coverage for its pure-math
// helpers (UnipolarSineModulator/LfoPhaseStep/BipolarAudioToModulator/
// ThreePhaseVoiceOffset/PublishVcoModulators/ProcessLiteParameters) moved
// here from the old top-level miniapp/'s DemoModulationTests.cpp when that
// directory was removed (Plan 3 Task 6) -- this binary was already the
// JUCE-free home for synth::Modules-adjacent coverage, so the demo helpers
// (used exclusively by apps/miniapp/MiniAppCore.hpp) join it rather than
// getting a ninth standalone test binary.
#include "DemoModulation.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <algorithm>
#include <cmath>
#include <exception>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <type_traits>
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

void SetAndSettle(synth::ParameterManager& manager, synth::ParameterId id, float value) {
    auto& parameter = manager.ParameterById(id);
    parameter.SceneCenter(0) = value;
    parameter.Compute(manager.Scene());
    parameter.ProcessLite();
}

} // namespace

static_assert(!std::is_copy_constructible_v<synth::DualWavetableVcoModule>);
static_assert(!std::is_copy_assignable_v<synth::DualWavetableVcoModule>);
static_assert(!std::is_move_constructible_v<synth::DualWavetableVcoModule>);
static_assert(!std::is_move_assignable_v<synth::DualWavetableVcoModule>);

TEST_CASE(dual_vco_registers_prefixed_parameters_and_rejects_repeat_registration) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 8,
        .processLiteAlpha = 1.0f,
    });
    synth::DualWavetableVcoModule module;

    module.RegisterParameters(manager, group, "Osc");

    const auto ids = module.Parameters();
    REQUIRE_TRUE(ids.tune == 0);
    REQUIRE_TRUE(ids.phase == 1);
    REQUIRE_TRUE(ids.shape == 2);
    REQUIRE_TRUE(ids.volume == 3);
    REQUIRE_TRUE(manager.ParameterById(ids.tune).Name() == "Osc Tune");
    REQUIRE_TRUE(manager.ParameterById(ids.phase).Name() == "Osc Phase");
    REQUIRE_TRUE(manager.ParameterById(ids.shape).Name() == "Osc Shape");
    REQUIRE_TRUE(manager.ParameterById(ids.volume).Name() == "Osc Volume");

    bool threw = false;
    try {
        module.RegisterParameters(manager, group, "Osc");
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    synth::DualWavetableVcoModule second;
    second.RegisterParameters(manager, group, "Alt");
    REQUIRE_TRUE(manager.ParameterById(second.Parameters().tune).Name() == "Alt Tune");
    REQUIRE_TRUE(manager.ParameterCount() == 8);
}

TEST_CASE(dual_vco_registration_rejects_insufficient_capacity_without_partial_parameters) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    synth::DualWavetableVcoModule module;

    bool threw = false;
    try {
        module.RegisterParameters(manager, group, "Osc");
    } catch (const std::length_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(!module.Registered());
    REQUIRE_TRUE(manager.ParameterCount() == 0);
    REQUIRE_TRUE(group.ParameterCount() == 0);
}

TEST_CASE(dual_vco_registration_rejects_existing_name_without_partial_parameters) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 5,
    });
    (void)manager.RegisterParameter(group, {.name = "Osc Volume", .defaultValue = 1.0f});
    synth::DualWavetableVcoModule module;

    bool threw = false;
    try {
        module.RegisterParameters(manager, group, "Osc");
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
    REQUIRE_TRUE(!module.Registered());
    REQUIRE_TRUE(manager.ParameterCount() == 1);
    REQUIRE_TRUE(group.ParameterCount() == 1);
    REQUIRE_TRUE(manager.ParameterById(0).Name() == "Osc Volume");
}

TEST_CASE(dual_vco_registers_visible_parameters_to_bank_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
    synth::DualWavetableVcoModule module;
    module.RegisterParameters(manager, group, "Osc");

    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    for (const synth::PhysicalEncoderId encoder : {10u, 11u, 12u, 13u, 14u, 15u}) {
        slot.AddPhysicalEncoder(encoder);
    }
    slot.SelectBank(&bank);

    module.RegisterToBank(bank, 2);

    REQUIRE_TRUE(bank.VisibleParameter(12) == &manager.ParameterById(module.Parameters().tune));
    REQUIRE_TRUE(bank.VisibleParameter(13) == &manager.ParameterById(module.Parameters().phase));
    REQUIRE_TRUE(bank.VisibleParameter(14) == &manager.ParameterById(module.Parameters().shape));
    REQUIRE_TRUE(bank.VisibleParameter(15) == &manager.ParameterById(module.Parameters().volume));
}

TEST_CASE(dual_vco_rejects_bank_registration_before_parameter_registration) {
    synth::ParameterManager manager;
    auto& bank = manager.CreateBank();
    synth::DualWavetableVcoModule module;

    bool threw = false;
    try {
        module.RegisterToBank(bank, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(dual_vco_set_input_maps_parameters_to_natural_units) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
    });
    synth::DualWavetableVcoModule module(48000.0f);
    module.RegisterParameters(manager, group, "Osc");
    const auto ids = module.Parameters();

    SetAndSettle(manager, ids.tune, 0.0f);
    SetAndSettle(manager, ids.shape, 0.25f);
    SetAndSettle(manager, ids.phase, 1.0f);
    SetAndSettle(manager, ids.volume, 0.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(static_cast<float>(module.CurrentInput().voices[0].vco.freq), 32.0f / 48000.0f, 0.000001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].vco.wavetablePosition, 0.25f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].vco.phaseOffset, 1.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].volume, 0.0f, 0.0001f);

    SetAndSettle(manager, ids.tune, 1.0f);
    SetAndSettle(manager, ids.volume, 1.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(static_cast<float>(module.CurrentInput().voices[1].vco.freq), 3000.0f / 48000.0f, 0.00001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].volume, 1.0f, 0.0001f);

    module.SetSampleRate(96000.0f);
    module.SetInput(manager);
    REQUIRE_NEAR(static_cast<float>(module.CurrentInput().voices[1].vco.freq), 3000.0f / 96000.0f, 0.00001f);
}

TEST_CASE(dual_vco_rejects_set_input_with_different_manager) {
    synth::ParameterManager firstManager;
    auto& firstGroup = firstManager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
    });
    synth::ParameterManager secondManager;
    (void)secondManager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
    });
    synth::DualWavetableVcoModule module;
    module.RegisterParameters(firstManager, firstGroup, "Osc");

    bool threw = false;
    try {
        module.SetInput(secondManager);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(dual_vco_rejects_invalid_sample_rate_and_voice_indices) {
    synth::DualWavetableVcoModule module;

    bool threw = false;
    try {
        module.SetSampleRate(0.0f);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        module.SetScopeWriterHolder(2, nullptr);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        module.SetColor(2, synth::Color::Cyan);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(dual_vco_process_publishes_scaled_outputs_and_normalized_sources) {
    synth::DualWavetableVcoModule module(48000.0f);
    module.CurrentInput().voices[0].vco = {
        .freq = 0.125,
        .phaseOffset = 0.0f,
        .wavetablePosition = 0.0f,
        .maxFreq = 0.5f,
    };
    module.CurrentInput().voices[0].volume = 0.0f;
    module.CurrentInput().voices[1].vco = {
        .freq = 0.125,
        .phaseOffset = 0.25f,
        .wavetablePosition = 1.0f,
        .maxFreq = 0.5f,
    };
    module.CurrentInput().voices[1].volume = 1.0f;

    module.Process();

    REQUIRE_NEAR(module.Output(0), 0.0f, 0.0001f);
    REQUIRE_NEAR(module.Output(1), module.RawOutput(1), 0.0001f);
    REQUIRE_NEAR(module.DirectModulationSources()[0], std::clamp((module.RawOutput(0) + 1.0f) * 0.5f, 0.0f, 1.0f),
                 0.0001f);
    REQUIRE_NEAR(module.DirectModulationSources()[1], std::clamp((module.RawOutput(1) + 1.0f) * 0.5f, 0.0f, 1.0f),
                 0.0001f);
    REQUIRE_NEAR(module.SwappedModulationSources()[0], module.DirectModulationSources()[1], 0.0001f);
    REQUIRE_NEAR(module.SwappedModulationSources()[1], module.DirectModulationSources()[0], 0.0001f);
}

TEST_CASE(dual_vco_registers_modulation_source_pointers) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 4,
    });
    synth::DualWavetableVcoModule module;
    module.RegisterParameters(manager, group, "Osc");
    module.RegisterModulationSources(group, 0, 1);

    module.CurrentInput().voices[0].vco.freq = 0.125;
    module.CurrentInput().voices[0].vco.maxFreq = 0.5f;
    module.CurrentInput().voices[1].vco.freq = 0.125;
    module.CurrentInput().voices[1].vco.phaseOffset = 0.25f;
    module.CurrentInput().voices[1].vco.maxFreq = 0.5f;
    module.Process();
    manager.UpdateModValues(group);

    REQUIRE_NEAR(group.GetModulators().Value(0, 0), module.DirectModulationSources()[0], 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), module.DirectModulationSources()[1], 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(0, 1), module.SwappedModulationSources()[0], 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 1), module.SwappedModulationSources()[1], 0.0001f);
    REQUIRE_TRUE(group.GetModulators().Metadata(0).name == "VCO Direct");
    REQUIRE_TRUE(group.GetModulators().Metadata(1).name == "VCO Swapped");
}

TEST_CASE(dual_vco_ui_state_exposes_both_vco_traces) {
    synth::ScopeWriter writer(2, 32);
    auto first = writer.ReserveChans(1);
    auto second = writer.ReserveChans(1);
    synth::DualWavetableVcoModule module;
    module.SetScopeWriterHolder(0, &first);
    module.SetScopeWriterHolder(1, &second);
    module.SetColor(0, synth::Color::Cyan);
    module.SetColor(1, synth::Color::Orange);

    module.CurrentInput().voices[0].vco.freq = 0.125;
    module.CurrentInput().voices[0].vco.maxFreq = 0.5f;
    module.CurrentInput().voices[1].vco.freq = 0.25;
    module.CurrentInput().voices[1].vco.maxFreq = 0.5f;
    module.Process();

    synth::DualWavetableVcoModule::UIState ui;
    module.PopulateUIState(ui);

    REQUIRE_TRUE(ui.vcos[0].connected.load());
    REQUIRE_TRUE(ui.vcos[1].connected.load());
    REQUIRE_TRUE(ui.vcos[0].scope.load() == &writer);
    REQUIRE_TRUE(ui.vcos[1].scope.load() == &writer);
    REQUIRE_TRUE(ui.vcos[0].scopeChannel.load() == first.FlatChan());
    REQUIRE_TRUE(ui.vcos[1].scopeChannel.load() == second.FlatChan());
    REQUIRE_TRUE(ui.vcos[0].color.Load() == synth::Color::Cyan);
    REQUIRE_TRUE(ui.vcos[1].color.Load() == synth::Color::Orange);
}

TEST_CASE(demo_modulation_unipolar_sine_modulator_matches_known_phase_points) {
    constexpr float pi = 3.14159265358979323846f;
    constexpr float tolerance = 0.0001f;

    REQUIRE_NEAR(synth_miniapp::UnipolarSineModulator(0.0f), 0.5f, tolerance);
    REQUIRE_NEAR(synth_miniapp::UnipolarSineModulator(pi * 0.5f), 1.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::UnipolarSineModulator(pi), 0.5f, tolerance);
    REQUIRE_NEAR(synth_miniapp::UnipolarSineModulator(pi * 1.5f), 0.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::UnipolarSineModulator(0.0f, pi * 0.5f), 1.0f, tolerance);
}

TEST_CASE(demo_modulation_lfo_phase_step_scales_with_speed) {
    constexpr float tolerance = 0.0001f;

    REQUIRE_NEAR(synth_miniapp::LfoPhaseStep(0.0f), 0.01f, tolerance);
    REQUIRE_NEAR(synth_miniapp::LfoPhaseStep(1.0f), 0.17f, tolerance);
}

TEST_CASE(demo_modulation_bipolar_audio_to_modulator_clamps_and_maps) {
    constexpr float tolerance = 0.0001f;

    REQUIRE_NEAR(synth_miniapp::BipolarAudioToModulator(-2.0f), 0.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::BipolarAudioToModulator(-1.0f), 0.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::BipolarAudioToModulator(0.0f), 0.5f, tolerance);
    REQUIRE_NEAR(synth_miniapp::BipolarAudioToModulator(1.0f), 1.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::BipolarAudioToModulator(2.0f), 1.0f, tolerance);
}

TEST_CASE(demo_modulation_three_phase_voice_offset_wraps_every_three_voices) {
    constexpr float pi = 3.14159265358979323846f;
    constexpr float tolerance = 0.0001f;

    REQUIRE_NEAR(synth_miniapp::ThreePhaseVoiceOffset(0), 0.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::ThreePhaseVoiceOffset(1), 2.0f * pi / 3.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::ThreePhaseVoiceOffset(2), 4.0f * pi / 3.0f, tolerance);
    REQUIRE_NEAR(synth_miniapp::ThreePhaseVoiceOffset(3), 0.0f, tolerance);
}

TEST_CASE(demo_modulation_process_lite_parameters_applies_direct_vco_modulation) {
    constexpr float tolerance = 0.0001f;

    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 3,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
    });
    auto& phase = manager.CreateParameter(group, {.name = "Phase", .defaultValue = 0.0f});
    auto& directDepth = manager.CreateParameter(group, {
        .name = "Phase Direct Depth",
        .defaultValue = 1.0f,
    });
    REQUIRE_TRUE(phase.AssignModulationDepth(0, &directDepth));
    phase.Compute(manager.Scene());
    directDepth.Compute(manager.Scene());

    std::vector<synth::Parameter*> parameters{&phase, &directDepth};
    synth_miniapp::PublishVcoModulators(group.GetModulators(), -1.0f, 1.0f);
    synth_miniapp::ProcessLiteParameters(parameters);
    REQUIRE_NEAR(phase.Get(0), 0.0f, tolerance);
    REQUIRE_NEAR(phase.Get(1), 1.0f, tolerance);

    synth_miniapp::PublishVcoModulators(group.GetModulators(), 1.0f, -1.0f);
    synth_miniapp::ProcessLiteParameters(parameters);
    REQUIRE_NEAR(phase.Get(0), 1.0f, tolerance);
    REQUIRE_NEAR(phase.Get(1), 0.0f, tolerance);
}

TEST_CASE(demo_modulation_publish_vco_modulators_matches_dual_vco_module_sources) {
    constexpr float tolerance = 0.0001f;

    synth::ParameterManager moduleManager;
    auto& moduleGroup = moduleManager.CreateGroup({
        .numVoices = 2,
        .numModulators = 3,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
    });
    synth::DualWavetableVcoModule module;
    module.RegisterParameters(moduleManager, moduleGroup, "Osc");
    module.RegisterModulationSources(moduleGroup, 0, 1);
    float lfo0 = 0.25f;
    float lfo1 = 0.75f;
    std::array<float*, 2> lfoSources{&lfo0, &lfo1};
    moduleGroup.SetModulationSource(2, lfoSources, {
                                                     .name = "Sine LFO",
                                                     .shortName = "LFO",
                                                     .color = synth::Color::Green,
                                                     .connected = true,
                                                 });
    module.CurrentInput().voices[0].vco.freq = 0.125;
    module.CurrentInput().voices[0].vco.maxFreq = 0.5f;
    module.CurrentInput().voices[1].vco.freq = 0.125;
    module.CurrentInput().voices[1].vco.phaseOffset = 0.25f;
    module.CurrentInput().voices[1].vco.maxFreq = 0.5f;
    module.Process();
    moduleManager.UpdateModValues(moduleGroup);

    REQUIRE_NEAR(moduleGroup.GetModulators().Value(0, 0), module.DirectModulationSources()[0], tolerance);
    REQUIRE_NEAR(moduleGroup.GetModulators().Value(1, 0), module.DirectModulationSources()[1], tolerance);
    REQUIRE_NEAR(moduleGroup.GetModulators().Value(0, 1), module.SwappedModulationSources()[0], tolerance);
    REQUIRE_NEAR(moduleGroup.GetModulators().Value(1, 1), module.SwappedModulationSources()[1], tolerance);
    REQUIRE_NEAR(moduleGroup.GetModulators().Value(0, 2), 0.25f, tolerance);
    REQUIRE_NEAR(moduleGroup.GetModulators().Value(1, 2), 0.75f, tolerance);
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
