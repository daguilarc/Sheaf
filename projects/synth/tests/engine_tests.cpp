#include "synth/Engine.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth engine tests must not see JUCE headers"
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
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

struct EngineTestApp {
    static inline bool sawNullUiStateDuringInit = false;
    static inline int initCalls = 0;
    static inline double preparedSampleRate = 0.0;
    static inline int preparedBlockSize = 0;
    static inline std::filesystem::path testPatchesRoot;
    // processLiteAlpha is configurable per-test via this static, read by
    // Init() when building the parameter group (must be set before
    // constructing the Engine, since Init() runs during Engine::Initialize).
    static inline float processLiteAlpha = 1.0f;
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;
    synth::BankSlot* probeSlot = nullptr;
    int processBlockCalls = 0;
    float lastProbeDuringBlock = -1.0f;

    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "EngineTest";
        config.numAudioOutputs = 2;
        config.patchesRoot = testPatchesRoot;
        return config;
    }
    void Init(synth::AppContext* ctx) {
        ++initCalls;
        context = ctx;
        sawNullUiStateDuringInit = (ctx->uiState == nullptr);
        auto& group = ctx->parameterManager->CreateGroup({.numVoices = 1,
                                                           .numModulators = 0,
                                                           .numScenes = 1,
                                                           .maxParameters = 4,
                                                           .processLiteAlpha = processLiteAlpha});
        auto& probe = ctx->parameterManager->CreateParameter(group, {.name = "Probe", .defaultValue = 0.25f});
        probeId = probe.Id();

        // Bank/slot routing so MessageIn::ParamIncDec(slotIx=0, position=0, delta)
        // reaches the probe parameter, matching the miniapp's CreateBank /
        // CreateBankSlot / AddPhysicalEncoder / AddMapping / SelectBank shape.
        auto& bank = ctx->parameterManager->CreateBank();
        bank.AddMapping(/*encoderId=*/0, probe);
        probeSlot = &ctx->parameterManager->CreateBankSlot();
        probeSlot->AddPhysicalEncoder(/*encoderId=*/0);
        probeSlot->SelectBank(&bank);
    }
    void PrepareToPlay(double sampleRate, int blockSize) {
        preparedSampleRate = sampleRate;
        preparedBlockSize = blockSize;
    }
    void ProcessBlock(synth::AudioBlock& block) {
        ++processBlockCalls;
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            context->parameterManager->ParameterById(probeId).ProcessLite();
        }
        // Read after the per-frame slewing above so lastProbeDuringBlock
        // reflects this block's post-message, post-slew value (the engine
        // pump applies patch/UI/MIDI messages and recomputes targets before
        // calling into the app, so the app's per-frame work is what makes
        // the new target audible/observable within this same block).
        lastProbeDuringBlock = context->parameterManager->ParameterById(probeId).Get(0);
        for (int channel = 0; channel < block.numOutputChannels; ++channel) {
            float* out = block.outputs[channel];
            if (out == nullptr) {
                continue;
            }
            for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
                out[frame] = 0.5f;
            }
        }
    }
};

// Builds a patch JSON document (matching EngineTestApp's Init topology, i.e.
// a single group with the "Probe" parameter) with Probe set to probeValue,
// and writes it as a version file in patchDir via SavePatchVersionInDirectory
// at the given time point.
void WriteProbePatchVersion(const std::filesystem::path& patchDir, float probeValue,
                            std::chrono::system_clock::time_point when) {
    synth::ParameterManager scratchManager;
    auto& group = scratchManager.CreateGroup(
        {.numVoices = 1, .numModulators = 0, .numScenes = 1, .maxParameters = 4, .processLiteAlpha = 1.0f});
    const synth::ParameterId probeId = scratchManager.RegisterParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    scratchManager.ParameterById(probeId).SceneCenter(0) = probeValue;
    scratchManager.CaptureDefaultControlState();
    scratchManager.ComputeAllParameters();

    synth::MidiControllerProfileConfig midiProfile;
    synth::JsonArena arena(64 * 1024);
    synth::JSON root = synth::BuildPatchJSON(arena, "Probe Patch", scratchManager, midiProfile);
    REQUIRE_TRUE(!root.IsNull());
    char* dumped = root.Dumps(JSON_ENCODE_ANY);
    REQUIRE_TRUE(dumped != nullptr);
    const std::string jsonText(dumped);
    std::free(dumped);

    synth::SavePatchVersionInDirectory(patchDir, jsonText, when);
}

}  // namespace

TEST_CASE(engine_initialize_orders_init_before_ui_state) {
    EngineTestApp::testPatchesRoot.clear();
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_TRUE(EngineTestApp::sawNullUiStateDuringInit);
    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    REQUIRE_TRUE(EngineTestApp::initCalls >= 1);
}

TEST_CASE(engine_prepare_forwards_negotiated_values) {
    EngineTestApp::testPatchesRoot.clear();
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(44100.0, 128);
    REQUIRE_NEAR(static_cast<float>(EngineTestApp::preparedSampleRate), 44100.0f, 1e-3f);
    REQUIRE_TRUE(EngineTestApp::preparedBlockSize == 128);
}

TEST_CASE(engine_full_concept_rejects_ui_less_core) {
    REQUIRE_TRUE(synth::SynthApplicationCore<EngineTestApp>);
    REQUIRE_TRUE(!synth::SynthApplication<EngineTestApp>);
}

TEST_CASE(engine_missing_patches_root_keeps_defaults_silently) {
    EngineTestApp::testPatchesRoot = std::filesystem::temp_directory_path() / "engine-no-such-root";
    std::filesystem::remove_all(EngineTestApp::testPatchesRoot);
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();  // must not throw or report failure
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.25f, 1e-5f);
}

TEST_CASE(engine_startup_loads_lexicographically_latest_patch) {
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "engine-startup-patch-root";
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root);

    const std::filesystem::path dirAAA = root / "AAA";
    const std::filesystem::path dirZZZ = root / "ZZZ";

    // "AAA" gets the numerically later time point (greater version filename);
    // "ZZZ" gets the earlier one. The rule is greatest VERSION FILENAME wins,
    // not directory name, so "AAA" (0.75) must win over "ZZZ" (0.5) despite
    // "ZZZ" sorting later alphabetically as a directory name.
    const auto earlier = std::chrono::system_clock::from_time_t(1700000000);
    const auto later = earlier + std::chrono::seconds(1);

    WriteProbePatchVersion(dirZZZ, 0.5f, earlier);
    WriteProbePatchVersion(dirAAA, 0.75f, later);

    const auto latestDir = synth::Engine<EngineTestApp>::LatestPatchDirectory(root);
    REQUIRE_TRUE(latestDir.has_value());
    REQUIRE_TRUE(latestDir->filename() == "AAA");

    EngineTestApp::testPatchesRoot = root;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    REQUIRE_NEAR(engine.Manager().ParameterById(engine.Application().probeId).Get(0), 0.75f, 1e-5f);

    std::filesystem::remove_all(root);
}

namespace {

// Builds a numFrames-frame, numOutputChannels-channel AudioBlock backed by
// caller-owned storage (the vector-of-vectors below), matching AudioBlock's
// non-owning-pointer contract.
struct TestBlockBuffers {
    std::vector<std::vector<float>> channels;
    std::vector<float*> outputPointers;

    explicit TestBlockBuffers(int numOutputChannels, std::size_t numFrames) {
        channels.resize(static_cast<std::size_t>(numOutputChannels));
        outputPointers.resize(static_cast<std::size_t>(numOutputChannels));
        for (int ch = 0; ch < numOutputChannels; ++ch) {
            channels[static_cast<std::size_t>(ch)].assign(numFrames, 0.0f);
            outputPointers[static_cast<std::size_t>(ch)] = channels[static_cast<std::size_t>(ch)].data();
        }
    }

    synth::AudioBlock Block(std::size_t numFrames) {
        synth::AudioBlock block;
        block.inputs = nullptr;
        block.outputs = outputPointers.data();
        block.numInputChannels = 0;
        block.numOutputChannels = static_cast<int>(outputPointers.size());
        block.numFrames = numFrames;
        return block;
    }
};

}  // namespace

TEST_CASE(engine_pump_applies_messages_before_app_block) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;  // snap immediately so the applied message is visible this block
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{2}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float before = engine.Manager().ParameterById(engine.Application().probeId).Get(0);

    // Push a ParamIncDec against the slot/position registered in Init (slot
    // 0, position 0 maps to the probe parameter via the bank/slot wiring).
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/2, /*slotIx=*/0, /*position=*/0, /*delta=*/0.3f));

    TestBlockBuffers buffers(2, 4);
    synth::AudioBlock block = buffers.Block(4);
    engine.ProcessBlock(block, /*timestamp=*/2);

    REQUIRE_TRUE(engine.Application().processBlockCalls == 1);
    REQUIRE_TRUE(engine.Application().lastProbeDuringBlock != before);
    REQUIRE_NEAR(engine.Application().lastProbeDuringBlock, before + 0.3f, 1e-4f);
}

TEST_CASE(engine_pump_preserves_slew_across_blocks) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 0.1f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{1}; });
    engine.Initialize();
    engine.Prepare(48000.0, 256);

    const float start = engine.Manager().ParameterById(engine.Application().probeId).Get(0);
    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/1, /*slotIx=*/0, /*position=*/0, /*delta=*/0.5f));
    const float target = std::clamp(start + 0.5f, 0.0f, 1.0f);

    TestBlockBuffers buffers(2, 4);

    synth::AudioBlock firstBlock = buffers.Block(4);
    engine.ProcessBlock(firstBlock, /*timestamp=*/1);
    const float afterFirst = engine.Application().lastProbeDuringBlock;
    REQUIRE_TRUE(afterFirst != target);  // no snap: slewed value must not equal target yet

    float previous = afterFirst;
    for (int i = 0; i < 20; ++i) {
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/1);
        const float current = engine.Application().lastProbeDuringBlock;
        REQUIRE_TRUE(current >= previous - 1e-6f);  // approaches monotonically
        previous = current;
    }
    REQUIRE_NEAR(previous, target, 1e-3f);
}

TEST_CASE(engine_pump_calls_app_exactly_once_per_block_and_advances_samples) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{0}; });
    engine.Initialize();
    engine.Prepare(48000.0, 64);

    TestBlockBuffers buffers(2, 64);

    synth::AudioBlock firstBlock = buffers.Block(64);
    engine.ProcessBlock(firstBlock, /*timestamp=*/10);
    synth::AudioBlock secondBlock = buffers.Block(64);
    engine.ProcessBlock(secondBlock, /*timestamp=*/11);

    REQUIRE_TRUE(engine.Application().processBlockCalls == 2);
    REQUIRE_TRUE(engine.SampleCount() == 128);
    REQUIRE_NEAR(buffers.channels[0][0], 0.5f, 1e-6f);
}

TEST_CASE(engine_pump_populates_ui_state_at_throttle_cadence) {
    EngineTestApp::testPatchesRoot.clear();
    EngineTestApp::processLiteAlpha = 1.0f;
    synth::Engine<EngineTestApp> engine([] { return std::uint64_t{5}; });
    engine.Initialize();

    // config_.uiFrameHz defaults to 30 (EngineTestApp::Config() doesn't
    // override it), matching the brief's worked example:
    // interval = round(48000 / (30 * 256)) = 6.
    engine.Prepare(48000.0, 256);

    REQUIRE_TRUE(engine.Context().uiState != nullptr);
    auto& cell = engine.Context().uiState->slots[0].cells[0];

    engine.UiBus().Push(synth::MessageIn::ParamIncDec(/*timestamp=*/5, /*slotIx=*/0, /*position=*/0, /*delta=*/0.4f));

    TestBlockBuffers buffers(2, 4);

    // First block: message applied, but UI state must not be republished yet
    // (interval is 6, and PopulateUIState happens after Initialize() as well,
    // so we capture the initial published value first to compare against).
    const float publishedBeforeAnyBlock = cell.values[0].load();

    synth::AudioBlock block1 = buffers.Block(4);
    engine.ProcessBlock(block1, /*timestamp=*/5);
    REQUIRE_NEAR(cell.values[0].load(), publishedBeforeAnyBlock, 1e-6f);  // unchanged: cadence not hit

    for (int i = 0; i < 5; ++i) {  // blocks 2..6: the 6th block hits the cadence
        synth::AudioBlock block = buffers.Block(4);
        engine.ProcessBlock(block, /*timestamp=*/5);
    }

    const float target = std::clamp(0.25f + 0.4f, 0.0f, 1.0f);
    REQUIRE_NEAR(cell.values[0].load(), target, 1e-4f);
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
