#include "Dresden4.hpp"
#include "Dresden4Core.hpp"
#include "support/SynthRig.hpp"

#include "synth/AppConcepts.hpp"
#include "synth/Modules.hpp"
#include "synth/ParameterModulation.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "Dresden 4 system tests must not see JUCE headers -- Dresden4Core must stay JUCE-free"
#endif

#include <array>
#include <cmath>
#include <cstddef>
#include <exception>
#include <filesystem>
#include <iostream>
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
    auto& core = rig.Engine().App();

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
    auto& core = rig.Engine().App();
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
            REQUIRE_TRUE(dresdenParam->GetColor() == synth::Color::Red);
        }

        const synth::Parameter* matrixParam = core.MatrixBank()->VisibleParameter(encoderId);
        REQUIRE_TRUE(matrixParam != nullptr);
        REQUIRE_TRUE(matrixParam->GetColor() == synth::Color::Red);
    }

    REQUIRE_TRUE(core.MatrixModule().Parameters()[0] == core.MonoGroup()->ParameterByLocalIndex(8).Id());
    REQUIRE_TRUE(core.MatrixModule().Parameters()[15] == core.MonoGroup()->ParameterByLocalIndex(23).Id());
}

TEST_CASE(matrix_sources_materialize_quad_modulator_values_for_four_voices) {
    synth_rig::SynthRig<synth_dresden4::Dresden4Core> rig(
        64,
        UseScratchRuntimeDataPaths("matrix_sources_materialize_quad_modulator_values_for_four_voices"));
    auto& core = rig.Engine().App();

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
    synth::Engine<synth_dresden4::Dresden4Core> engine;
    engine.Initialize();

    for (const double hostRate : {44100.0, 48000.0, 96000.0}) {
        engine.Prepare(hostRate, config.preferredBlockSize);
        auto& core = engine.App();
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
        .startSample = 100,
    };

    engine.Process(block);
    const auto& counters = engine.App().DebugCounters();
    REQUIRE_TRUE(counters.hostFramesProcessed == left.size());
    REQUIRE_TRUE(counters.internalSubframesProcessed == left.size() * 4);
    REQUIRE_TRUE(counters.firstInternalSampleIndex == 400);
    REQUIRE_TRUE(counters.lastInternalSampleIndex == 431);
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
