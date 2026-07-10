#include "Dresden4.hpp"
#include "Dresden4Core.hpp"
#include "support/SynthRig.hpp"

#include "synth/AppConcepts.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "Dresden 4 system tests must not see JUCE headers -- Dresden4Core must stay JUCE-free"
#endif

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <exception>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
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

void RequireNear(double actual, double expected, double tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

synth::RuntimeDataPaths UseScratchRuntimeDataPaths(const char* testName) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "sheaf-dresden4-system-tests" / testName;
    std::filesystem::remove_all(dataRoot);
    synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    return paths;
}

std::size_t SlotPositionToEncoderId(synth::BankSlot& slot, std::size_t position) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    return encoderId;
}

bool OutputHasNonSilentFiniteStereo(const std::vector<synth_rig::SynthRig<synth_dresden4::Dresden4Core>::OutputFrame>& output) {
    bool heardSignal = false;
    for (const auto& frame : output) {
        REQUIRE_TRUE(frame.channels.size() == 2);
        for (const float sample : frame.channels) {
            REQUIRE_TRUE(std::isfinite(sample));
            heardSignal = heardSignal || std::fabs(sample) > 0.000001f;
        }
    }
    return heardSignal;
}

struct EngineRunResult {
    std::vector<std::vector<float>> channels;
    synth_dresden4::Dresden4Core::DebugCounterState counters;
};

EngineRunResult RunFreshEngineSegments(int outputChannels, const std::vector<std::size_t>& segmentFrames) {
    std::uint64_t timestamp = 0;
    synth::Engine<synth_dresden4::Dresden4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    engine.Prepare(synth_dresden4::Dresden4Core::Config().preferredSampleRate,
                   synth_dresden4::Dresden4Core::Config().preferredBlockSize);

    std::vector<std::vector<float>> captured(static_cast<std::size_t>(std::max(outputChannels, 0)));
    for (const std::size_t frames : segmentFrames) {
        std::vector<std::vector<float>> blockStorage(static_cast<std::size_t>(std::max(outputChannels, 0)),
                                                     std::vector<float>(frames, 12345.0f));
        std::vector<float*> outputs(blockStorage.size(), nullptr);
        for (std::size_t channel = 0; channel < blockStorage.size(); ++channel) {
            outputs[channel] = blockStorage[channel].data();
        }

        synth::AudioBlock block{
            .outputs = outputs.empty() ? nullptr : outputs.data(),
            .numOutputChannels = outputChannels,
            .numFrames = frames,
        };
        engine.ProcessBlock(block, timestamp++);

        for (std::size_t channel = 0; channel < blockStorage.size(); ++channel) {
            captured[channel].insert(captured[channel].end(), blockStorage[channel].begin(), blockStorage[channel].end());
        }
    }

    return {
        .channels = std::move(captured),
        .counters = engine.Application().DebugCounters(),
    };
}

void SetScenePair(synth::ParameterManager& manager, synth::ParameterId id, float value) {
    manager.ParameterById(id).SceneCenter(0) = value;
    manager.ParameterById(id).SceneCenter(1) = value;
}

float Scene0(const synth::ParameterManager& manager, synth::ParameterId id) {
    return manager.ParameterById(id).SceneCenter(0);
}

} // namespace

static_assert(synth::SynthApplicationCore<synth_dresden4::Dresden4Core>);
static_assert(synth::SynthApplicationCore<synth_dresden4::Dresden4>);

TEST_CASE(config_declares_patch_launchable_stereo_app) {
    const synth::RuntimeConfig config = synth_dresden4::Dresden4Core::Config();

    REQUIRE_TRUE(config.appName == "Dresden 4");
    REQUIRE_TRUE(config.numAudioInputs == 0);
    REQUIRE_TRUE(config.numAudioOutputs == 2);
    REQUIRE_NEAR(config.preferredSampleRate, 48000.0, 0.000001);
    REQUIRE_TRUE(config.preferredBlockSize == 256);
}

TEST_CASE(initializes_parameter_groups_banks_slot_and_scene_endpoints) {
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(
        64,
        UseScratchRuntimeDataPaths("initializes_parameter_groups_banks_slot_and_scene_endpoints"));
    auto& core = rig.Engine().Application();

    REQUIRE_TRUE(rig.Engine().Manager().NumGroups() == 3);
    REQUIRE_TRUE(core.StereoGroup() != nullptr);
    REQUIRE_TRUE(core.QuadGroup() != nullptr);
    REQUIRE_TRUE(core.MonoGroup() != nullptr);
    REQUIRE_TRUE(core.StereoGroup()->Config().numVoices == 2);
    REQUIRE_TRUE(core.QuadGroup()->Config().numVoices == 4);
    REQUIRE_TRUE(core.MonoGroup()->Config().numVoices == 1);
    REQUIRE_TRUE(core.StereoGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(core.QuadGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(core.MonoGroup()->Config().numScenes == 2);
    REQUIRE_TRUE(rig.Engine().Manager().Scene().leftScene == 0);
    REQUIRE_TRUE(rig.Engine().Manager().Scene().rightScene == 1);

    REQUIRE_TRUE(core.DresdenBank() == rig.Engine().Manager().BankAt(0));
    REQUIRE_TRUE(core.MatrixBank() == rig.Engine().Manager().BankAt(1));
    REQUIRE_TRUE(rig.Engine().Manager().BankAt(2) == nullptr);
    REQUIRE_TRUE(core.BankSlot() == rig.Engine().Manager().BankSlotAt(0));
    REQUIRE_TRUE(rig.Engine().Manager().BankSlotAt(1) == nullptr);
    REQUIRE_TRUE(core.BankSlot()->PhysicalEncoders().size() == 16);
}

TEST_CASE(dresden_and_matrix_banks_expose_required_encoder_cells) {
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(
        64,
        UseScratchRuntimeDataPaths("dresden_and_matrix_banks_expose_required_encoder_cells"));
    auto& core = rig.Engine().Application();
    auto& slot = *core.BankSlot();

    REQUIRE_TRUE(core.MonoGroup()->ParameterCount() == 24);
    REQUIRE_TRUE(core.QuadGroup()->Config().numModulators == 1);

    for (std::size_t position = 0; position < 16; ++position) {
        const auto encoderId = SlotPositionToEncoderId(slot, position);
        const synth::Parameter* dresdenParam = core.DresdenBank()->VisibleParameter(encoderId);
        if (position == 2 || position == 3) {
            REQUIRE_TRUE(dresdenParam == nullptr);
        } else {
            REQUIRE_TRUE(dresdenParam != nullptr);
            REQUIRE_TRUE(dresdenParam->ParamColor() == synth::Color::Red);
        }

        const synth::Parameter* matrixParam = core.MatrixBank()->VisibleParameter(encoderId);
        REQUIRE_TRUE(matrixParam != nullptr);
        REQUIRE_TRUE(matrixParam->ParamColor() == synth::Color::Red);
    }

    REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
    REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
}

TEST_CASE(matrix_sources_materialize_quad_modulator_values_for_four_voices) {
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(
        64,
        UseScratchRuntimeDataPaths("matrix_sources_materialize_quad_modulator_values_for_four_voices"));
    auto& core = rig.Engine().Application();

    core.SetRawMatrixOutputForTest(0, -2.0f);
    core.SetRawMatrixOutputForTest(1, -1.0f);
    core.SetRawMatrixOutputForTest(2, 0.0f);
    core.SetRawMatrixOutputForTest(3, 2.0f);
    core.PublishMatrixModulatorsForTest();

    REQUIRE_NEAR(core.NormalizedMatrixSource(0), 0.0, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(1), 0.0, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(2), 0.5, 0.000001);
    REQUIRE_NEAR(core.NormalizedMatrixSource(3), 1.0, 0.000001);

    core.QuadGroup()->UpdateModValues();
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(0, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(1, 0), 0.0, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(2, 0), 0.5, 0.000001);
    REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(3, 0), 1.0, 0.000001);
}

TEST_CASE(prepares_four_x_internal_rate_and_sequences_internal_subframes) {
    synth::RuntimeConfig config = synth_dresden4::Dresden4Core::Config();
    std::uint64_t timestamp = 0;
    synth::Engine<synth_dresden4::Dresden4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();

    for (const double hostRate : {44100.0, 48000.0, 96000.0}) {
        engine.Prepare(hostRate, config.preferredBlockSize);
        auto& core = engine.Application();
        REQUIRE_NEAR(core.HostSampleRate(), hostRate, 0.000001);
        REQUIRE_NEAR(core.InternalSampleRate(), hostRate * 4.0, 0.000001);
        REQUIRE_TRUE(core.DresdenModule().SampleRate() == static_cast<float>(hostRate * 4.0));
    }

    std::array<float, 8> left{};
    std::array<float, 8> right{};
    std::array<float*, 2> outputs{left.data(), right.data()};
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = left.size(),
    };

    engine.ProcessBlock(block, timestamp++);
    const auto& counters = engine.Application().DebugCounters();
    REQUIRE_TRUE(counters.hostFramesProcessed == left.size());
    REQUIRE_TRUE(counters.internalSubframesProcessed == left.size() * 4);
    REQUIRE_TRUE(counters.firstInternalSampleIndex == 0);
    REQUIRE_TRUE(counters.lastInternalSampleIndex == 31);
}

TEST_CASE(matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample) {
    std::uint64_t timestamp = 0;
    synth::Engine<synth_dresden4::Dresden4Core> engine([&timestamp] { return timestamp++; });
    engine.Initialize();
    engine.Prepare(48000.0, 8);

    std::array<float, 2> left{};
    std::array<float, 2> right{};
    std::array<float*, 2> outputs{left.data(), right.data()};
    synth::AudioBlock block{
        .outputs = outputs.data(),
        .numOutputChannels = 2,
        .numFrames = left.size(),
    };

    engine.ProcessBlock(block, timestamp++);
    auto& core = engine.Application();
    const auto& counters = core.DebugCounters();

    REQUIRE_TRUE(counters.lastInternalSampleIndex == 7);
    REQUIRE_TRUE(counters.lastMatrixInputInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastMatrixOutputPublicationInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastMatrixModulatorConsumptionInternalIndex == counters.lastInternalSampleIndex);
    REQUIRE_TRUE(counters.lastConsumedMatrixOutputPublicationInternalIndex == counters.lastInternalSampleIndex - 1);
    for (std::size_t oscIx = 0; oscIx < synth_dresden4::Dresden4Core::kOscillatorCount; ++oscIx) {
        REQUIRE_NEAR(counters.lastMatrixInputs[oscIx], core.DresdenModule().OscillatorOutput(oscIx), 0.000001);
        REQUIRE_NEAR(core.QuadGroup()->GetModulators().Value(oscIx, 0),
                     counters.lastConsumedMatrixSources[oscIx],
                     0.000001);
    }
}

TEST_CASE(output_policy_handles_zero_mono_stereo_and_extra_channels) {
    const auto zero = RunFreshEngineSegments(0, {8});
    REQUIRE_TRUE(zero.channels.empty());
    REQUIRE_TRUE(zero.counters.hostFramesProcessed == 8);

    const auto stereo = RunFreshEngineSegments(2, {8});
    const auto mono = RunFreshEngineSegments(1, {8});
    REQUIRE_TRUE(stereo.channels.size() == 2);
    REQUIRE_TRUE(mono.channels.size() == 1);
    for (std::size_t frame = 0; frame < mono.channels[0].size(); ++frame) {
        REQUIRE_NEAR(mono.channels[0][frame], 0.5f * (stereo.channels[0][frame] + stereo.channels[1][frame]), 0.000001);
    }

    const auto extra = RunFreshEngineSegments(3, {8});
    REQUIRE_TRUE(extra.channels.size() == 3);
    for (std::size_t frame = 0; frame < extra.channels[0].size(); ++frame) {
        REQUIRE_NEAR(extra.channels[0][frame], stereo.channels[0][frame], 0.000001);
        REQUIRE_NEAR(extra.channels[1][frame], stereo.channels[1][frame], 0.000001);
        REQUIRE_NEAR(extra.channels[2][frame], 0.0f, 0.000001);
    }
}

TEST_CASE(decimator_state_is_continuous_across_split_app_blocks) {
    const auto contiguous = RunFreshEngineSegments(2, {16});
    const auto split = RunFreshEngineSegments(2, {5, 7, 4});

    REQUIRE_TRUE(contiguous.channels.size() == 2);
    REQUIRE_TRUE(split.channels.size() == 2);
    REQUIRE_TRUE(contiguous.channels[0].size() == split.channels[0].size());
    for (std::size_t channel = 0; channel < contiguous.channels.size(); ++channel) {
        for (std::size_t frame = 0; frame < contiguous.channels[channel].size(); ++frame) {
            REQUIRE_NEAR(split.channels[channel][frame], contiguous.channels[channel][frame], 0.000001);
        }
    }
}

TEST_CASE(patch_save_perturb_load_round_trips_representative_dresden_and_matrix_values) {
    const synth::RuntimeDataPaths paths =
        UseScratchRuntimeDataPaths("patch_save_perturb_load_round_trips_representative_dresden_and_matrix_values");
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(128, paths);
    auto& manager = rig.Engine().Manager();
    const auto dresdenIds = rig.Application().DresdenModule().Parameters();
    const auto matrixIds = rig.Application().MatrixModule().Parameters();

    SetScenePair(manager, dresdenIds.x, 0.20f);
    SetScenePair(manager, dresdenIds.y, 0.80f);
    SetScenePair(manager, dresdenIds.quad.phase, -0.30f);
    SetScenePair(manager, dresdenIds.pmIndex[2], 0.70f);
    SetScenePair(manager, dresdenIds.frequency[3], 0.40f);
    SetScenePair(manager, matrixIds[0], 0.55f);
    SetScenePair(manager, matrixIds[7], -0.45f);

    const std::array<std::pair<synth::ParameterId, float>, 7> saved{{
        {dresdenIds.x, Scene0(manager, dresdenIds.x)},
        {dresdenIds.y, Scene0(manager, dresdenIds.y)},
        {dresdenIds.quad.phase, Scene0(manager, dresdenIds.quad.phase)},
        {dresdenIds.pmIndex[2], Scene0(manager, dresdenIds.pmIndex[2])},
        {dresdenIds.frequency[3], Scene0(manager, dresdenIds.frequency[3])},
        {matrixIds[0], Scene0(manager, matrixIds[0])},
        {matrixIds[7], Scene0(manager, matrixIds[7])},
    }};

    const std::filesystem::path patchDir = paths.patchesRoot / "Take1";
    REQUIRE_TRUE(rig.SavePatchAs(patchDir) == synth_rig::RigPatchStatus::Written);

    SetScenePair(manager, dresdenIds.x, 0.90f);
    SetScenePair(manager, dresdenIds.y, 0.10f);
    SetScenePair(manager, dresdenIds.quad.phase, 0.30f);
    SetScenePair(manager, dresdenIds.pmIndex[2], 0.10f);
    SetScenePair(manager, dresdenIds.frequency[3], 0.90f);
    SetScenePair(manager, matrixIds[0], -0.20f);
    SetScenePair(manager, matrixIds[7], 0.35f);

    REQUIRE_TRUE(std::fabs(Scene0(manager, dresdenIds.x) - saved[0].second) > 0.001f);
    REQUIRE_TRUE(std::fabs(Scene0(manager, matrixIds[7]) - saved[6].second) > 0.001f);

    REQUIRE_TRUE(rig.LoadPatch(patchDir) == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(4);

    for (const auto& [id, expected] : saved) {
        REQUIRE_NEAR(Scene0(manager, id), expected, 0.000001);
    }
}

TEST_CASE(runs_finite_non_silent_stereo_audio_after_decimation) {
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(
        64,
        UseScratchRuntimeDataPaths("runs_finite_non_silent_stereo_audio_after_decimation"));

    rig.RunBlocks(4);
    REQUIRE_TRUE(OutputHasNonSilentFiniteStereo(rig.Output()));
}

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
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": unknown exception\n";
        }
    }

    if (failures != 0) {
        std::cerr << failures << " Dresden 4 system test(s) failed\n";
        return 1;
    }

    std::cout << "Dresden 4 system tests passed\n";
    return 0;
}
