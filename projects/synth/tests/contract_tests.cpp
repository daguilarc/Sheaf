#include "synth/AppContext.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth contract tests must not see JUCE headers"
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

} // namespace

TEST_CASE(runtime_config_defaults_are_sensible) {
    const synth::RuntimeConfig config;
    REQUIRE_TRUE(config.appName.empty());
    REQUIRE_TRUE(config.numAudioInputs == 0);
    REQUIRE_TRUE(config.numAudioOutputs == 2);
    REQUIRE_NEAR(static_cast<float>(config.preferredSampleRate), 48000.0f, 1e-3f);
    REQUIRE_TRUE(config.preferredBlockSize == 256);
    REQUIRE_TRUE(config.patchesRoot.empty());
    REQUIRE_TRUE(config.logsRoot.empty());
    REQUIRE_TRUE(config.uiWidth == 900);
    REQUIRE_TRUE(config.uiHeight == 560);
    REQUIRE_TRUE(config.uiFrameHz == 30);
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
    REQUIRE_TRUE(context.midiProfileConfig == nullptr);
    REQUIRE_TRUE(context.defaultMidiProfileConfig == nullptr);
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
