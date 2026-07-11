#include "synth/Modules.hpp"

// DemoModulation.hpp lives under apps/miniapp/ (JUCE-free); built with
// -Iapps/miniapp (see the root Makefile's rule for this binary) so this
// resolves without duplicating the header. The remaining helper is used by
// MiniAppCore to process module-owned parameters per sample.
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

static_assert(!std::is_copy_constructible_v<synth::WavetableVcoModule<2>>);
static_assert(!std::is_copy_assignable_v<synth::WavetableVcoModule<2>>);
static_assert(!std::is_move_constructible_v<synth::WavetableVcoModule<2>>);
static_assert(!std::is_move_assignable_v<synth::WavetableVcoModule<2>>);
static_assert(!std::is_copy_constructible_v<synth::BasicLfoModule<2>>);
static_assert(!std::is_copy_assignable_v<synth::BasicLfoModule<2>>);
static_assert(!std::is_move_constructible_v<synth::BasicLfoModule<2>>);
static_assert(!std::is_move_assignable_v<synth::BasicLfoModule<2>>);
static_assert(!std::is_copy_constructible_v<synth::ClassicSvfModule<2>>);
static_assert(!std::is_copy_assignable_v<synth::ClassicSvfModule<2>>);
static_assert(!std::is_move_constructible_v<synth::ClassicSvfModule<2>>);
static_assert(!std::is_move_assignable_v<synth::ClassicSvfModule<2>>);

TEST_CASE(wavetable_vco_registers_prefixed_parameters_and_rejects_repeat_registration) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 8,
        .processLiteAlpha = 1.0f,
    });
    synth::WavetableVcoModule<2> module;

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

    synth::WavetableVcoModule<2> second;
    second.RegisterParameters(manager, group, "Alt");
    REQUIRE_TRUE(manager.ParameterById(second.Parameters().tune).Name() == "Alt Tune");
    REQUIRE_TRUE(manager.ParameterCount() == 8);
}

TEST_CASE(wavetable_vco_registration_rejects_insufficient_capacity_without_partial_parameters) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    synth::WavetableVcoModule<2> module;

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

TEST_CASE(wavetable_vco_registration_rejects_existing_name_without_partial_parameters) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 5,
    });
    (void)manager.RegisterParameter(group, {.name = "Osc Volume", .defaultValue = 1.0f});
    synth::WavetableVcoModule<2> module;

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

TEST_CASE(wavetable_vco_registers_visible_parameters_to_bank_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
    synth::WavetableVcoModule<2> module;
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

TEST_CASE(wavetable_vco_rejects_bank_registration_before_parameter_registration) {
    synth::ParameterManager manager;
    auto& bank = manager.CreateBank();
    synth::WavetableVcoModule<2> module;

    bool threw = false;
    try {
        module.RegisterToBank(bank, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(basic_lfo_rejects_bank_registration_before_parameter_registration) {
    synth::ParameterManager manager;
    auto& bank = manager.CreateBank();
    synth::BasicLfoModule<2> module;

    bool threw = false;
    try {
        module.RegisterToBank(bank, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(wavetable_vco_set_input_maps_parameters_to_natural_units) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 4,
        .processLiteAlpha = 1.0f,
        .targetCenterAlpha = 1.0f,
    });
    synth::WavetableVcoModule<2> module(48000.0f);
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

TEST_CASE(wavetable_vco_rejects_set_input_with_different_manager) {
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
    synth::WavetableVcoModule<2> module;
    module.RegisterParameters(firstManager, firstGroup, "Osc");

    bool threw = false;
    try {
        module.SetInput(secondManager);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(wavetable_vco_rejects_invalid_sample_rate_and_voice_indices) {
    synth::WavetableVcoModule<2> module;

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

TEST_CASE(wavetable_vco_process_publishes_scaled_outputs_and_normalized_sources) {
    synth::WavetableVcoModule<2> module(48000.0f);
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

TEST_CASE(wavetable_vco_registers_modulation_source_pointers) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 2,
        .numScenes = 1,
        .maxParameters = 4,
    });
    synth::WavetableVcoModule<2> module;
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

TEST_CASE(wavetable_vco_ui_state_exposes_both_vco_traces) {
    synth::ScopeWriter writer(2, 32);
    auto first = writer.ReserveChans(1);
    auto second = writer.ReserveChans(1);
    synth::WavetableVcoModule<2> module;
    module.SetScopeWriterHolder(0, &first);
    module.SetScopeWriterHolder(1, &second);
    module.SetColor(0, synth::Color::Cyan);
    module.SetColor(1, synth::Color::Orange);

    module.CurrentInput().voices[0].vco.freq = 0.125;
    module.CurrentInput().voices[0].vco.maxFreq = 0.5f;
    module.CurrentInput().voices[1].vco.freq = 0.25;
    module.CurrentInput().voices[1].vco.maxFreq = 0.5f;
    module.Process();

    synth::WavetableVcoModule<2>::UIState ui;
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

TEST_CASE(wavetable_vco_template_supports_single_voice_outputs_and_sources) {
    synth::WavetableVcoModule<1> module;
    static_assert(synth::WavetableVcoModule<1>::kVoiceCount == 1);

    module.CurrentInput().voices[0].vco = {
        .freq = 0.125,
        .phaseOffset = 0.0f,
        .wavetablePosition = 0.0f,
        .maxFreq = 0.5f,
    };
    module.CurrentInput().voices[0].volume = 0.5f;
    module.Process();

    REQUIRE_NEAR(module.Output(0), module.RawOutput(0) * 0.5f, 0.0001f);
    REQUIRE_NEAR(module.DirectModulationSources()[0], std::clamp((module.RawOutput(0) + 1.0f) * 0.5f, 0.0f, 1.0f),
                 0.0001f);
    REQUIRE_NEAR(module.SwappedModulationSources()[0], module.DirectModulationSources()[0], 0.0001f);
}

TEST_CASE(basic_lfo_registers_parameters_in_visible_order_and_rejects_repeat_registration) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 10,
        .processLiteAlpha = 1.0f,
    });
    synth::BasicLfoModule<2> module;

    module.RegisterParameters(manager, group, "LFO");

    const auto ids = module.Parameters();
    REQUIRE_TRUE(ids.frequency == 0);
    REQUIRE_TRUE(ids.shape == 1);
    REQUIRE_TRUE(ids.phaseOffset == 2);
    REQUIRE_TRUE(ids.skew == 3);
    REQUIRE_TRUE(ids.exponent == 4);
    REQUIRE_TRUE(manager.ParameterById(ids.frequency).Name() == "LFO Frequency");
    REQUIRE_TRUE(manager.ParameterById(ids.shape).Name() == "LFO Shape");
    REQUIRE_TRUE(manager.ParameterById(ids.phaseOffset).Name() == "LFO Phase Offset");
    REQUIRE_TRUE(manager.ParameterById(ids.skew).Name() == "LFO Skew");
    REQUIRE_TRUE(manager.ParameterById(ids.exponent).Name() == "LFO Exponent");
    REQUIRE_TRUE(manager.ParameterById(ids.exponent).Range() == synth::RangeKind::Bipolar);
    REQUIRE_NEAR(manager.ParameterById(ids.exponent).SceneCenter(0), 0.0f, 0.0001f);

    bool threw = false;
    try {
        module.RegisterParameters(manager, group, "LFO");
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(basic_lfo_registration_rejects_capacity_and_duplicate_names_without_partial_parameters) {
    {
        synth::ParameterManager manager;
        auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
        synth::BasicLfoModule<2> module;

        bool threw = false;
        try {
            module.RegisterParameters(manager, group, "LFO");
        } catch (const std::length_error&) {
            threw = true;
        }
        REQUIRE_TRUE(threw);
        REQUIRE_TRUE(!module.Registered());
        REQUIRE_TRUE(manager.ParameterCount() == 0);
        REQUIRE_TRUE(group.ParameterCount() == 0);
    }

    {
        synth::ParameterManager manager;
        auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 6});
        (void)manager.RegisterParameter(group, {.name = "LFO Skew", .defaultValue = 0.5f});
        synth::BasicLfoModule<2> module;

        bool threw = false;
        try {
            module.RegisterParameters(manager, group, "LFO");
        } catch (const std::logic_error&) {
            threw = true;
        }
        REQUIRE_TRUE(threw);
        REQUIRE_TRUE(!module.Registered());
        REQUIRE_TRUE(manager.ParameterCount() == 1);
        REQUIRE_TRUE(group.ParameterCount() == 1);
    }
}

TEST_CASE(basic_lfo_registers_visible_parameters_to_bank_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 5});
    synth::BasicLfoModule<2> module;
    module.RegisterParameters(manager, group, "LFO");

    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    for (const synth::PhysicalEncoderId encoder : {20u, 21u, 22u, 23u, 24u, 25u}) {
        slot.AddPhysicalEncoder(encoder);
    }
    slot.SelectBank(&bank);

    module.RegisterToBank(bank, 1);

    REQUIRE_TRUE(bank.VisibleParameter(21) == &manager.ParameterById(module.Parameters().frequency));
    REQUIRE_TRUE(bank.VisibleParameter(22) == &manager.ParameterById(module.Parameters().shape));
    REQUIRE_TRUE(bank.VisibleParameter(23) == &manager.ParameterById(module.Parameters().phaseOffset));
    REQUIRE_TRUE(bank.VisibleParameter(24) == &manager.ParameterById(module.Parameters().skew));
    REQUIRE_TRUE(bank.VisibleParameter(25) == &manager.ParameterById(module.Parameters().exponent));
}

TEST_CASE(basic_lfo_set_input_maps_parameters_and_phase_stagger_to_natural_units) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 5,
        .processLiteAlpha = 1.0f,
        .targetCenterAlpha = 1.0f,
    });
    synth::BasicLfoModule<2> module(1000.0f);
    module.RegisterParameters(manager, group, "LFO");
    const auto ids = module.Parameters();

    SetAndSettle(manager, ids.frequency, 0.0f);
    SetAndSettle(manager, ids.shape, 0.25f);
    SetAndSettle(manager, ids.phaseOffset, 0.0f);
    SetAndSettle(manager, ids.skew, 0.75f);
    SetAndSettle(manager, ids.exponent, 0.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(static_cast<float>(module.CurrentInput().voices[0].lfo.frequency), 0.1f / 1000.0f, 0.000001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.shape, 0.25f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.phaseOffset, 0.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].lfo.shape.phaseOffset, 0.25f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.skew, 0.75f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.exponent, 1.0f, 0.0001f);

    SetAndSettle(manager, ids.exponent, -1.0f);
    module.SetInput(manager);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.exponent, 0.2f, 0.0001f);

    SetAndSettle(manager, ids.frequency, 1.0f);
    SetAndSettle(manager, ids.phaseOffset, 1.0f);
    SetAndSettle(manager, ids.exponent, 1.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(static_cast<float>(module.CurrentInput().voices[1].lfo.frequency), 1000.0f / 1000.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.phaseOffset, 1.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].lfo.shape.phaseOffset, 1.25f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].lfo.shape.exponent, 5.0f, 0.0001f);
}

TEST_CASE(basic_lfo_rejects_invalid_sample_rate_and_voice_indices) {
    synth::BasicLfoModule<2> module;

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
        module.SetColor(2, synth::Color::Green);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(basic_lfo_processes_polyphonic_outputs_and_updates_modulation_source_pointers) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 1,
        .numScenes = 1,
        .maxParameters = 5,
    });
    synth::BasicLfoModule<2> module;
    module.RegisterParameters(manager, group, "LFO");
    module.RegisterModulationSource(group, 0);

    module.CurrentInput().voices[0].lfo = {
        .frequency = 0.25,
        .shape = {.shape = 0.5f, .phaseOffset = 0.0f, .skew = 0.5f, .exponent = 1.0f},
    };
    module.CurrentInput().voices[1].lfo = {
        .frequency = 0.25,
        .shape = {.shape = 0.5f, .phaseOffset = 0.25f, .skew = 0.5f, .exponent = 1.0f},
    };
    module.Process();
    manager.UpdateModValues(group);

    REQUIRE_TRUE(module.Output(0) >= 0.0f && module.Output(0) <= 1.0f);
    REQUIRE_TRUE(module.Output(1) >= 0.0f && module.Output(1) <= 1.0f);
    REQUIRE_NEAR(group.GetModulators().Value(0, 0), module.ModulationSources()[0], 0.0001f);
    REQUIRE_NEAR(group.GetModulators().Value(1, 0), module.ModulationSources()[1], 0.0001f);
    REQUIRE_TRUE(group.GetModulators().Metadata(0).name == "LFO");
}

TEST_CASE(basic_lfo_template_supports_three_voice_phase_stagger_and_ui_state) {
    synth::ScopeWriter writer(3, 32);
    auto first = writer.ReserveChans(1);
    auto second = writer.ReserveChans(1);
    auto third = writer.ReserveChans(1);

    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 3,
        .numScenes = 1,
        .maxParameters = 5,
        .processLiteAlpha = 1.0f,
    });
    synth::BasicLfoModule<3> module(12000.0f);
    module.SetScopeWriterHolder(0, &first);
    module.SetScopeWriterHolder(1, &second);
    module.SetScopeWriterHolder(2, &third);
    module.SetColor(2, synth::Color::Yellow);
    module.RegisterParameters(manager, group, "LFO");
    SetAndSettle(manager, module.Parameters().phaseOffset, 0.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(module.CurrentInput().voices[0].lfo.shape.phaseOffset, 0.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].lfo.shape.phaseOffset, 1.0f / 6.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[2].lfo.shape.phaseOffset, 2.0f / 6.0f, 0.0001f);

    module.Process();
    synth::BasicLfoModule<3>::UIState ui;
    module.PopulateUIState(ui);

    REQUIRE_TRUE(ui.lfos[0].connected.load());
    REQUIRE_TRUE(ui.lfos[1].connected.load());
    REQUIRE_TRUE(ui.lfos[2].connected.load());
    REQUIRE_TRUE(ui.lfos[2].scope.load() == &writer);
    REQUIRE_TRUE(ui.lfos[2].scopeChannel.load() == third.FlatChan());
    REQUIRE_TRUE(ui.lfos[2].color.Load() == synth::Color::Yellow);
}

TEST_CASE(classic_svf_registers_parameters_in_visible_order_and_rejects_repeat_registration) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 6,
        .processLiteAlpha = 1.0f,
    });
    synth::ClassicSvfModule<2> module;

    module.RegisterParameters(manager, group, "Filter");

    const auto ids = module.Parameters();
    REQUIRE_TRUE(ids.cutoff == 0);
    REQUIRE_TRUE(ids.resonance == 1);
    REQUIRE_TRUE(ids.blend == 2);
    REQUIRE_TRUE(manager.ParameterById(ids.cutoff).Name() == "Filter Cutoff");
    REQUIRE_TRUE(manager.ParameterById(ids.resonance).Name() == "Filter Resonance");
    REQUIRE_TRUE(manager.ParameterById(ids.blend).Name() == "Filter Blend");
    REQUIRE_TRUE(manager.ParameterById(ids.blend).Range() == synth::RangeKind::Bipolar);
    REQUIRE_NEAR(manager.ParameterById(ids.cutoff).SceneCenter(0), 1.0f, 0.0001f);
    REQUIRE_NEAR(manager.ParameterById(ids.resonance).SceneCenter(0), 0.0f, 0.0001f);
    REQUIRE_NEAR(manager.ParameterById(ids.blend).SceneCenter(0), -1.0f, 0.0001f);

    bool threw = false;
    try {
        module.RegisterParameters(manager, group, "Filter");
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(classic_svf_registration_rejects_capacity_and_duplicate_names_without_partial_parameters) {
    {
        synth::ParameterManager manager;
        auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 2});
        synth::ClassicSvfModule<2> module;

        bool threw = false;
        try {
            module.RegisterParameters(manager, group, "Filter");
        } catch (const std::length_error&) {
            threw = true;
        }
        REQUIRE_TRUE(threw);
        REQUIRE_TRUE(!module.Registered());
        REQUIRE_TRUE(manager.ParameterCount() == 0);
        REQUIRE_TRUE(group.ParameterCount() == 0);
    }

    {
        synth::ParameterManager manager;
        auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 4});
        (void)manager.RegisterParameter(group, {.name = "Filter Resonance", .defaultValue = 0.0f});
        synth::ClassicSvfModule<2> module;

        bool threw = false;
        try {
            module.RegisterParameters(manager, group, "Filter");
        } catch (const std::logic_error&) {
            threw = true;
        }
        REQUIRE_TRUE(threw);
        REQUIRE_TRUE(!module.Registered());
        REQUIRE_TRUE(manager.ParameterCount() == 1);
        REQUIRE_TRUE(group.ParameterCount() == 1);
        REQUIRE_TRUE(manager.ParameterById(0).Name() == "Filter Resonance");
    }
}

TEST_CASE(classic_svf_registers_visible_parameters_to_bank_offset) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numScenes = 1, .maxParameters = 3});
    synth::ClassicSvfModule<2> module;
    module.RegisterParameters(manager, group, "Filter");

    auto& bank = manager.CreateBank();
    auto& slot = manager.CreateBankSlot();
    for (const synth::PhysicalEncoderId encoder : {30u, 31u, 32u, 33u, 34u}) {
        slot.AddPhysicalEncoder(encoder);
    }
    slot.SelectBank(&bank);

    module.RegisterToBank(bank, 2);

    REQUIRE_TRUE(bank.VisibleParameter(32) == &manager.ParameterById(module.Parameters().cutoff));
    REQUIRE_TRUE(bank.VisibleParameter(33) == &manager.ParameterById(module.Parameters().resonance));
    REQUIRE_TRUE(bank.VisibleParameter(34) == &manager.ParameterById(module.Parameters().blend));
}

TEST_CASE(classic_svf_rejects_bank_registration_before_parameter_registration) {
    synth::ParameterManager manager;
    auto& bank = manager.CreateBank();
    synth::ClassicSvfModule<2> module;

    bool threw = false;
    try {
        module.RegisterToBank(bank, 0);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(classic_svf_set_input_maps_parameters_to_filter_natural_units) {
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 3,
        .processLiteAlpha = 1.0f,
        .targetCenterAlpha = 1.0f,
    });
    synth::ClassicSvfModule<2> module(48000.0f);
    module.RegisterParameters(manager, group, "Filter");
    const auto ids = module.Parameters();

    SetAndSettle(manager, ids.cutoff, 0.0f);
    SetAndSettle(manager, ids.resonance, 0.0f);
    SetAndSettle(manager, ids.blend, -1.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(module.CurrentInput().voices[0].filter.cutoff, 20.0f / 48000.0f, 0.000001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].filter.resonance, 0.5f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[0].filter.blend, -1.0f, 0.0001f);

    SetAndSettle(manager, ids.blend, 0.0f);
    module.SetInput(manager);
    REQUIRE_NEAR(module.CurrentInput().voices[0].filter.blend, 0.0f, 0.0001f);

    SetAndSettle(manager, ids.cutoff, 1.0f);
    SetAndSettle(manager, ids.resonance, 1.0f);
    SetAndSettle(manager, ids.blend, 1.0f);
    module.SetInput(manager);

    REQUIRE_NEAR(module.CurrentInput().voices[1].filter.cutoff, 20000.0f / 48000.0f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].filter.resonance, 5.5f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].filter.blend, 1.0f, 0.0001f);

    module.SetSampleRate(96000.0f);
    module.SetInput(manager);
    REQUIRE_NEAR(module.CurrentInput().voices[1].filter.cutoff, 20000.0f / 96000.0f, 0.0001f);
}

TEST_CASE(classic_svf_rejects_set_input_with_different_manager) {
    synth::ParameterManager firstManager;
    auto& firstGroup = firstManager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    synth::ParameterManager secondManager;
    (void)secondManager.CreateGroup({
        .numVoices = 2,
        .numScenes = 1,
        .maxParameters = 3,
    });
    synth::ClassicSvfModule<2> module;
    module.RegisterParameters(firstManager, firstGroup, "Filter");

    bool threw = false;
    try {
        module.SetInput(secondManager);
    } catch (const std::logic_error&) {
        threw = true;
    }

    REQUIRE_TRUE(threw);
}

TEST_CASE(classic_svf_set_voice_input_writes_live_samples_and_rejects_invalid_indices) {
    synth::ClassicSvfModule<2> module;

    module.SetVoiceInput(0, 0.25f);
    module.SetVoiceInput(1, -0.75f);

    REQUIRE_NEAR(module.CurrentInput().voices[0].filter.value, 0.25f, 0.0001f);
    REQUIRE_NEAR(module.CurrentInput().voices[1].filter.value, -0.75f, 0.0001f);

    bool threw = false;
    try {
        module.SetVoiceInput(2, 0.0f);
    } catch (const std::out_of_range&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);

    threw = false;
    try {
        module.SetSampleRate(0.0f);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    REQUIRE_TRUE(threw);
}

TEST_CASE(classic_svf_processes_independent_voice_outputs_and_publishes_filter_ui_state) {
    synth::ClassicSvfModule<2> module(48000.0f);
    module.CurrentInput().voices[0].filter = {
        .value = 1.0f,
        .cutoff = 2000.0f / 48000.0f,
        .resonance = 0.5f,
        .blend = -1.0f,
    };
    module.CurrentInput().voices[1].filter = {
        .value = -1.0f,
        .cutoff = 2000.0f / 48000.0f,
        .resonance = 0.5f,
        .blend = -1.0f,
    };

    module.Process();

    REQUIRE_TRUE(std::isfinite(module.Output(0)));
    REQUIRE_TRUE(std::isfinite(module.Output(1)));
    REQUIRE_TRUE(module.Output(0) != module.Output(1));

    synth::ClassicSvfModule<2>::UIState ui;
    module.PopulateUIState(ui);

    static_assert(std::is_base_of_v<synth::TransferFunction, synth::ClassicStateVariableFilter::UIState>);
    REQUIRE_NEAR(ui.filters[0].cutoff.load(), 2000.0f / 48000.0f, 0.0001f);
    REQUIRE_NEAR(ui.filters[1].cutoff.load(), 2000.0f / 48000.0f, 0.0001f);
    REQUIRE_TRUE(std::isfinite(ui.filters[0].FrequencyResponse(1000.0f / 48000.0f)));
    REQUIRE_TRUE(std::isfinite(ui.filters[1].FrequencyResponse(1000.0f / 48000.0f)));
}

TEST_CASE(demo_modulation_process_parameters_applies_direct_vco_modulation) {
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

    group.GetModulators().Value(0, 0) = 0.0f;
    group.GetModulators().Value(1, 0) = 1.0f;
    synth_miniapp::ProcessParameters(group, /*sampleIndex=*/0);
    REQUIRE_NEAR(phase.GetRaw(0), 0.0f, tolerance);
    REQUIRE_NEAR(phase.GetRaw(1), 1.0f, tolerance);

    group.GetModulators().Value(0, 0) = 1.0f;
    group.GetModulators().Value(1, 0) = 0.0f;
    synth_miniapp::ProcessParameters(group, /*sampleIndex=*/1);
    REQUIRE_NEAR(phase.GetRaw(0), 1.0f, tolerance);
    REQUIRE_NEAR(phase.GetRaw(1), 0.0f, tolerance);
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
