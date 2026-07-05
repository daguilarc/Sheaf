#include "synth/AppContext.hpp"
#include "synth/AppConcepts.hpp"
#include "synth/PatchBrowser.hpp"
#include "synth/RuntimePagePolicy.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth contract tests must not see JUCE headers"
#endif

#include <algorithm>
#include <cmath>
#include <exception>
#include <filesystem>
#include <fstream>
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

} // namespace

TEST_CASE(runtime_config_defaults_are_sensible) {
    const synth::RuntimeConfig config;
    REQUIRE_TRUE(config.appName.empty());
    REQUIRE_TRUE(config.numAudioInputs == 0);
    REQUIRE_TRUE(config.numAudioOutputs == 2);
    REQUIRE_NEAR(static_cast<float>(config.preferredSampleRate), 48000.0f, 1e-3f);
    REQUIRE_TRUE(config.preferredBlockSize == 256);
    REQUIRE_TRUE(config.uiWidth == 900);
    REQUIRE_TRUE(config.uiHeight == 560);
    REQUIRE_TRUE(config.uiFrameHz == 30);
}

TEST_CASE(runtime_data_paths_default_empty_and_derive_children) {
    const synth::RuntimeDataPaths paths;
    REQUIRE_TRUE(paths.dataRoot.empty());
    REQUIRE_TRUE(paths.patchesRoot.empty());
    REQUIRE_TRUE(paths.logsRoot.empty());
    REQUIRE_TRUE(paths.configFile.empty());

    const auto derived = synth::RuntimeDataPaths::FromDataRoot("/tmp/sheaf-test-root");
    REQUIRE_TRUE(derived.dataRoot == std::filesystem::path("/tmp/sheaf-test-root"));
    REQUIRE_TRUE(derived.patchesRoot == std::filesystem::path("/tmp/sheaf-test-root") / "patches");
    REQUIRE_TRUE(derived.logsRoot == std::filesystem::path("/tmp/sheaf-test-root") / "logs");
    REQUIRE_TRUE(derived.configFile == std::filesystem::path("/tmp/sheaf-test-root") / "config.json");
}

TEST_CASE(patch_browser_lists_patch_directories_deterministically) {
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf-patch-browser-contract-list";
    std::error_code ec;
    std::filesystem::remove_all(root, ec);
    std::filesystem::create_directories(root / "zeta", ec);
    std::filesystem::create_directories(root / "alpha", ec);
    std::filesystem::create_directories(root / "middle", ec);
    std::ofstream(root / "not-a-patch.txt").put('x');

    synth::PatchBrowser browser(root);
    REQUIRE_TRUE(browser.Refresh());
    REQUIRE_TRUE(browser.Entries().size() == 3);
    REQUIRE_TRUE(browser.Entries()[0].name == "alpha");
    REQUIRE_TRUE(browser.Entries()[1].name == "middle");
    REQUIRE_TRUE(browser.Entries()[2].name == "zeta");

    browser.Select(2);
    REQUIRE_TRUE(browser.SelectedRelativePath() == std::filesystem::path("zeta"));

    std::filesystem::remove_all(root, ec);
}

TEST_CASE(patch_browser_rejects_root_escape_paths) {
    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf-patch-browser-contract-escape";
    const std::filesystem::path outside =
        std::filesystem::temp_directory_path() / "sheaf-patch-browser-contract-outside";
    std::error_code ec;
    std::filesystem::remove_all(root, ec);
    std::filesystem::remove_all(outside, ec);
    std::filesystem::create_directories(root, ec);
    std::filesystem::create_directories(outside, ec);

    synth::PatchBrowser browser(root);
    REQUIRE_TRUE(!browser.ResolveLoadPath(std::filesystem::path("/tmp/not-a-patch")).has_value());
    REQUIRE_TRUE(!browser.ResolveLoadPath(std::filesystem::path("../outside")).has_value());
    REQUIRE_TRUE(!browser.ResolveSaveAsPath(".").has_value());
    REQUIRE_TRUE(!browser.ResolveSaveAsPath("../outside").has_value());
    REQUIRE_TRUE(!browser.ResolveSaveAsPath("nested/../../outside").has_value());
    REQUIRE_TRUE(!browser.ResolveLoadPath(std::filesystem::relative(outside, root)).has_value());

    std::filesystem::create_directory_symlink(outside, root / "outside-link", ec);
    if (!ec) {
        REQUIRE_TRUE(!browser.ResolveLoadPath("outside-link").has_value());
        REQUIRE_TRUE(browser.Refresh());
        REQUIRE_TRUE(browser.Entries().empty());
    }

    const auto savePath = browser.ResolveSaveAsPath("New Patch");
    REQUIRE_TRUE(savePath.has_value());
    REQUIRE_TRUE(*savePath == browser.RootPath() / "New Patch");

    std::filesystem::remove_all(root, ec);
    std::filesystem::remove_all(outside, ec);
}

TEST_CASE(runtime_page_back_save_policy_matches_configuration_pages) {
    REQUIRE_TRUE(!synth::RuntimePageBackSavesConfiguration(synth::RuntimePageKind::None));
    REQUIRE_TRUE(synth::RuntimePageBackSavesConfiguration(synth::RuntimePageKind::Audio));
    REQUIRE_TRUE(synth::RuntimePageBackSavesConfiguration(synth::RuntimePageKind::Controllers));
    REQUIRE_TRUE(!synth::RuntimePageBackSavesConfiguration(synth::RuntimePageKind::File));
}

TEST_CASE(audio_block_is_a_plain_view) {
    float left[4] = {0.0f, 0.1f, 0.2f, 0.3f};
    float right[4] = {0.0f, -0.1f, -0.2f, -0.3f};
    float* outputs[2] = {left, right};
    const synth::AudioBlock block{nullptr, outputs, 0, 2, 4};
    REQUIRE_TRUE(block.inputs == nullptr);
    REQUIRE_TRUE(block.numInputChannels == 0);
    REQUIRE_TRUE(block.numOutputChannels == 2);
    REQUIRE_TRUE(block.numFrames == 4);
    REQUIRE_NEAR(block.outputs[0][3], 0.3f, 1e-6f);
}

TEST_CASE(app_context_default_constructs_null) {
    const synth::AppContext context;
    REQUIRE_TRUE(context.parameterManager == nullptr);
    REQUIRE_TRUE(context.patchManager == nullptr);
    REQUIRE_TRUE(context.uiBus == nullptr);
    REQUIRE_TRUE(context.midiBus == nullptr);
    REQUIRE_TRUE(context.parameterMessageOutBus == nullptr);
    REQUIRE_TRUE(context.patchInputBus == nullptr);
    REQUIRE_TRUE(context.patchOutputBus == nullptr);
    REQUIRE_TRUE(context.midiSender == nullptr);
    REQUIRE_TRUE(context.instrument == nullptr);
    REQUIRE_TRUE(context.defaultInstrument == nullptr);
    REQUIRE_TRUE(context.config == nullptr);
    REQUIRE_TRUE(context.uiState == nullptr);
}

TEST_CASE(app_context_holds_live_pointers) {
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    REQUIRE_TRUE(context.parameterManager == &manager);
    REQUIRE_TRUE(context.uiBus == &uiBus);
}

namespace {
struct ConceptCoreOnlyApp {
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};
struct ConceptFullApp : ConceptCoreOnlyApp {
    int UIComponent() { return 0; }  // stand-in; runtime consumes the real type
    void PrepareToPlay(double, int) {}
};
struct ConceptNotAnApp {
    void ProcessBlock(synth::AudioBlock&) {}
};
}  // namespace

TEST_CASE(application_concepts_gate_correctly) {
    REQUIRE_TRUE(synth::SynthApplicationCore<ConceptCoreOnlyApp>);
    REQUIRE_TRUE(synth::SynthApplicationCore<ConceptFullApp>);
    REQUIRE_TRUE(!synth::SynthApplicationCore<ConceptNotAnApp>);
    REQUIRE_TRUE(!synth::SynthApplication<ConceptCoreOnlyApp>);   // UI-less core rejected by full concept
    REQUIRE_TRUE(synth::SynthApplication<ConceptFullApp>);
    REQUIRE_TRUE(!synth::HasPrepareToPlay<ConceptCoreOnlyApp>);
    REQUIRE_TRUE(synth::HasPrepareToPlay<ConceptFullApp>);
    REQUIRE_TRUE(!synth::HasProcessFrame<ConceptFullApp>);
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
