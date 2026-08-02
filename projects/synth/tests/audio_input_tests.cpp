#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth audio input tests must not see JUCE headers"
#endif

#include <cstddef>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace {

int g_failures = 0;

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        ++g_failures;
        std::cerr << "[FAIL] " << label << "\n";
        return;
    }
    std::cout << "[PASS] " << label << "\n";
}

template <typename Fn>
void RequireThrowsInvalidArgument(Fn&& fn, const char* label)
{
    bool threw = false;
    try
    {
        fn();
    }
    catch (const std::invalid_argument&)
    {
        threw = true;
    }
    Require(threw, label);
}

void TestNegativeInputCountThrows()
{
    synth::RuntimeConfig invalid;
    invalid.numAudioInputs = -1;
    RequireThrowsInvalidArgument([&] { synth::ValidateRuntimeConfig(invalid); },
                                 "negative numAudioInputs throws invalid_argument");
}

void TestSeventeenChannelConfigValidates()
{
    synth::RuntimeConfig config;
    config.numAudioInputs = 17;
    bool threw = false;
    try
    {
        synth::ValidateRuntimeConfig(config);
    }
    catch (const std::exception&)
    {
        threw = true;
    }
    Require(!threw, "17-channel config validates successfully");
}

void TestZeroInputViewIsEmpty()
{
    synth::AudioBlock zero;
    const auto view = zero.InputView();
    Require(zero.inputs == nullptr && view.Empty(), "zero-input block has null inputs and empty view");
    Require(view.ActiveChannelCount() == 0 && view.RequestedChannelCount() == 0,
            "zero-input view reports zero active and requested channels");
    Require(view.SampleOrSilence(0, 0) == 0.0f, "zero-input SampleOrSilence returns silence");
}

void TestViewsAreTriviallyCopyableAndBounded()
{
    Require(std::is_trivially_copyable_v<synth::AudioInputView>, "AudioInputView is trivially copyable");
    Require(std::is_trivially_copyable_v<synth::AudioInputFrameView>,
            "AudioInputFrameView is trivially copyable");
    Require(sizeof(synth::AudioInputView) <= 6 * sizeof(void*),
            "AudioInputView is bounded by six pointer-sized words");
    Require(sizeof(synth::AudioInputFrameView) <= 6 * sizeof(void*),
            "AudioInputFrameView is bounded by six pointer-sized words");
}

void TestPlanarChannelAndFrameEquivalence()
{
    float channel0[4] = {0.10f, 0.11f, 0.12f, 0.13f};
    float channel1[4] = {0.20f, 0.21f, 0.22f, 0.23f};
    float channel2[4] = {0.30f, 0.31f, 0.32f, 0.33f};
    const float* inputs[3] = {channel0, channel1, channel2};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = 3;
    block.numRequestedInputChannels = 3;
    block.numFrames = 4;

    const auto view = block.InputView();
    Require(view.Channel(1)[2] == view.Frame(2).Sample(1),
            "Channel(1)[2] equals Frame(2).Sample(1)");
    Require(view.Channel(1).data() == channel1 && view.Channel(1).size() == 4,
            "strict Channel access returns underlying pointer span without copying");
    Require(view.ActiveChannelCount() == 3 && view.RequestedChannelCount() == 3,
            "planar block reports matching active and requested counts");
}

void TestMissingRequestedChannelIsSilence()
{
    float channel0[2] = {1.0f, 2.0f};
    float channel1[2] = {3.0f, 4.0f};
    const float* inputs[2] = {channel0, channel1};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = 2;
    block.numRequestedInputChannels = 4;
    block.numFrames = 2;

    const auto view = block.InputView();
    Require(view.ActiveChannelCount() == 2 && view.RequestedChannelCount() == 4,
            "shortfall keeps active below requested");
    Require(!view.HasActiveChannel(3), "missing requested channel is inactive");
    Require(view.SampleOrSilence(3, 0) == 0.0f, "missing requested channel reads as silence");
    Require(view.SampleOrSilence(3, 1) == 0.0f, "missing requested channel silence is stable across frames");
}

void TestInvalidFrameIsSilence()
{
    float channel0[2] = {1.0f, 2.0f};
    const float* inputs[1] = {channel0};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = 1;
    block.numRequestedInputChannels = 1;
    block.numFrames = 2;

    const auto view = block.InputView();
    Require(view.SampleOrSilence(0, 2) == 0.0f, "out-of-range frame reads as silence");
    Require(view.SampleOrSilence(0, 99) == 0.0f, "far out-of-range frame reads as silence");
}

void TestCountedNullPointerIsSafeSilence()
{
    float channel0[3] = {0.5f, 0.6f, 0.7f};
    float channel2[3] = {1.5f, 1.6f, 1.7f};
    const float* inputs[3] = {channel0, nullptr, channel2};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = 3;
    block.numRequestedInputChannels = 3;
    block.numFrames = 3;

    const auto view = block.InputView();
    Require(view.HasActiveChannel(0), "non-null counted channel remains active");
    Require(!view.HasActiveChannel(1), "counted null pointer is inactive");
    Require(view.HasActiveChannel(2), "later non-null counted channel remains active");
    Require(view.SampleOrSilence(1, 0) == 0.0f, "counted null pointer SampleOrSilence returns zero");
    Require(view.SampleOrSilence(1, 2) == 0.0f, "counted null pointer silence holds for later frames");
    Require(view.Frame(1).SampleOrSilence(1) == 0.0f, "frame-safe access also returns silence for null channel");
}

void TestExcessActualChannelsAreClamped()
{
    float channel0[2] = {0.1f, 0.2f};
    float channel1[2] = {0.3f, 0.4f};
    float channel2[2] = {0.5f, 0.6f};
    float channel3[2] = {0.7f, 0.8f};
    const float* inputs[4] = {channel0, channel1, channel2, channel3};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = 4;
    block.numRequestedInputChannels = 2;
    block.numFrames = 2;

    const auto view = block.InputView();
    Require(view.RequestedChannelCount() == 2, "requested count is preserved");
    Require(view.ActiveChannelCount() == 2, "overlarge actual count clamps to requested");
    Require(view.HasActiveChannel(0) && view.HasActiveChannel(1), "clamped active channels remain addressable");
    Require(!view.HasActiveChannel(2) && !view.HasActiveChannel(3),
            "channels beyond requested are inactive after clamp");
    Require(view.SampleOrSilence(2, 0) == 0.0f, "excess channel reads as silence after clamp");
    Require(view.Channel(1).data() == channel1, "clamped strict access still returns underlying pointer");
}

void TestNegativeActualCountClampsToZero()
{
    float channel0[1] = {1.0f};
    const float* inputs[1] = {channel0};

    synth::AudioBlock block;
    block.inputs = inputs;
    block.numInputChannels = -3;
    block.numRequestedInputChannels = 2;
    block.numFrames = 1;

    const auto view = block.InputView();
    Require(view.ActiveChannelCount() == 0, "negative actual count clamps to zero active channels");
    Require(view.RequestedChannelCount() == 2, "requested count remains visible after negative actual clamp");
    Require(view.SampleOrSilence(0, 0) == 0.0f, "negative actual clamp yields silence");
}

struct NegativeInputApp
{
    static synth::RuntimeConfig Config()
    {
        synth::RuntimeConfig config;
        config.appName = "NegativeInputApp";
        config.numAudioInputs = -1;
        return config;
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};

void TestEngineInitializeRejectsNegativeInputs()
{
    synth::Engine<NegativeInputApp> engine([]() { return static_cast<std::uint64_t>(0); });
    RequireThrowsInvalidArgument([&] { engine.Initialize(); },
                                 "Engine::Initialize rejects negative input count before mutating state");
}

}  // namespace

int main()
{
    TestNegativeInputCountThrows();
    TestSeventeenChannelConfigValidates();
    TestZeroInputViewIsEmpty();
    TestViewsAreTriviallyCopyableAndBounded();
    TestPlanarChannelAndFrameEquivalence();
    TestMissingRequestedChannelIsSilence();
    TestInvalidFrameIsSilence();
    TestCountedNullPointerIsSafeSilence();
    TestExcessActualChannelsAreClamped();
    TestNegativeActualCountClampsToZero();
    TestEngineInitializeRejectsNegativeInputs();
    return g_failures == 0 ? 0 : 1;
}
