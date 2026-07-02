#include "synth/Engine.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth engine tests must not see JUCE headers"
#endif

#include <chrono>
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
    synth::AppContext* context = nullptr;
    synth::ParameterId probeId = 0;

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
                                                           .processLiteAlpha = 1.0f});
        probeId = ctx->parameterManager->RegisterParameter(group, {.name = "Probe", .defaultValue = 0.25f});
    }
    void PrepareToPlay(double sampleRate, int blockSize) {
        preparedSampleRate = sampleRate;
        preparedBlockSize = blockSize;
    }
    void ProcessBlock(synth::AudioBlock&) {}
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
