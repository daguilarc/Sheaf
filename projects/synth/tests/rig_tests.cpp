#include "support/SynthRig.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth rig tests must not see JUCE headers"
#endif

#include <cmath>
#include <cstdint>
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

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

// Minimal SynthApplicationCore used by the rig smoke tests: one group with
// two parameters ("Level" default 0.25, "Tone" default 0.5) mapped to
// physical encoders 0/1 through a single bank+slot. ProcessBlock calls
// ProcessLite() on both parameters once per frame (so per-frame slewing is
// exercised, matching the engine's own audio-thread contract), then writes
// Level's post-slew value to every channel of every output frame.
struct RigTestApp {
    // When set, ProcessBlock writes a NaN into the very first output frame
    // of the very next ProcessBlock call instead of the normal value, then
    // clears itself. Exercises the rig's sticky-NaN detection.
    static inline bool injectNanNextBlock = false;

    synth::AppContext* context = nullptr;
    synth::ParameterId levelId = 0;
    synth::ParameterId toneId = 0;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "RigTest";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 32;
        return config;
    }

    void Init(synth::AppContext* ctx) {
        context = ctx;
        auto& group = ctx->parameterManager->CreateGroup({.numVoices = 1,
                                                           .numModulators = 0,
                                                           .numScenes = 2,
                                                           .maxParameters = 8,
                                                           .processLiteAlpha = 0.5f});
        auto& level = ctx->parameterManager->CreateParameter(group, {.name = "Level", .defaultValue = 0.25f});
        auto& tone = ctx->parameterManager->CreateParameter(group, {.name = "Tone", .defaultValue = 0.5f});
        levelId = level.Id();
        toneId = tone.Id();

        auto& bank = ctx->parameterManager->CreateBank();
        bank.AddMapping(/*encoderId=*/0, level);
        bank.AddMapping(/*encoderId=*/1, tone);
        auto& slot = ctx->parameterManager->CreateBankSlot();
        slot.AddPhysicalEncoder(/*encoderId=*/0);
        slot.AddPhysicalEncoder(/*encoderId=*/1);
        slot.SelectBank(&bank);
    }

    void ProcessBlock(synth::AudioBlock& block) {
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            context->parameterManager->ParameterById(levelId).ProcessLite();
            context->parameterManager->ParameterById(toneId).ProcessLite();
        }
        const float levelValue = context->parameterManager->ParameterById(levelId).Get(0);
        for (int channel = 0; channel < block.numOutputChannels; ++channel) {
            float* out = block.outputs[channel];
            if (out == nullptr) {
                continue;
            }
            for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
                out[frame] = levelValue;
            }
        }
        if (injectNanNextBlock) {
            injectNanNextBlock = false;
            if (block.numOutputChannels > 0 && block.outputs[0] != nullptr && block.numFrames > 0) {
                block.outputs[0][0] = std::nanf("");
            }
        }
    }
};

}  // namespace

TEST_CASE(rig_runs_blocks_and_captures_output) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.RunBlocks(4);
    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(rig.Output().size() == 4 * static_cast<std::size_t>(RigTestApp::Config().preferredBlockSize));
    REQUIRE_NEAR(rig.LastOutput().channels.at(0), 0.25f, 1e-4f);
    REQUIRE_NEAR(rig.OutputPeak(), 0.25f, 1e-4f);
}

TEST_CASE(rig_turn_reaches_parameter_through_production_bus) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.Turn(0, 0, 0.5f);  // Level encoder
    rig.RunBlocks(8);      // settle slew
    REQUIRE_TRUE(rig.LastOutput().channels.at(0) > 0.25f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(rig_run_samples_and_seconds_convert_to_blocks) {
    synth_rig::SynthRig<RigTestApp> rig;
    rig.RunSamples(1);  // rounds up to one block
    const auto oneBlock = rig.Output().size();
    REQUIRE_TRUE(oneBlock == static_cast<std::size_t>(RigTestApp::Config().preferredBlockSize));
}

TEST_CASE(rig_nan_flag_is_sticky) {
    synth_rig::SynthRig<RigTestApp> rig;
    RigTestApp::injectNanNextBlock = true;
    rig.RunBlocks(1);
    REQUIRE_TRUE(rig.SawNaN());
    RigTestApp::injectNanNextBlock = false;
    rig.RunBlocks(4);
    REQUIRE_TRUE(rig.SawNaN());  // still true: sticky across subsequent clean blocks
    rig.ClearNaN();
    REQUIRE_TRUE(!rig.SawNaN());
}

// Regression test for the save-pump result race fixed via
// Engine::ConsumeLastTickPatchResult(): RunBlocks(1) already drains the
// pending save's response through MessageThreadTick()'s internal
// ProcessResponses() call, so a rig that called ProcessResponses() again
// afterward would only ever observe NoCompletion and report TimedOut even
// though the save actually succeeded. This edits a parameter, saves via
// SavePatchAs, and asserts the rig correctly reports Written with the
// version file present on disk.
TEST_CASE(rig_save_patch_as_reports_written_and_creates_version_file) {
    const std::filesystem::path saveDir =
        std::filesystem::temp_directory_path() / "rig-tests-save-patch-as-dir";
    std::error_code ec;
    std::filesystem::remove_all(saveDir, ec);

    synth_rig::SynthRig<RigTestApp> rig;
    rig.Turn(0, 0, 0.5f);  // Level encoder
    rig.RunBlocks(4);      // let the edit land before saving

    const synth_rig::RigPatchStatus status = rig.SavePatchAs(saveDir);
    REQUIRE_TRUE(status == synth_rig::RigPatchStatus::Written);

    bool foundVersionFile = false;
    if (std::filesystem::is_directory(saveDir, ec)) {
        for (const auto& entry : std::filesystem::directory_iterator(saveDir, ec)) {
            if (entry.is_regular_file() && entry.path().extension() == ".json") {
                foundVersionFile = true;
                break;
            }
        }
    }
    REQUIRE_TRUE(foundVersionFile);

    std::filesystem::remove_all(saveDir, ec);
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
