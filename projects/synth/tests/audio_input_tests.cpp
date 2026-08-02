#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/PortableUI.hpp"
#include "support/SynthRig.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth audio input tests must not see JUCE headers"
#endif

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <span>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

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

// Full SynthApplication probe: four inputs, two outputs. Reads channel 0 via
// Channel(), channel 1 via Frame(), channel 3 via SampleOrSilence(); leaves
// channel 2 unread to prove hosts never auto-monitor unused input. Writes
// explicit sum/difference of the three read channels to the two outputs.
//
struct InputProbeSurface final : synth::ui::Surface
{
    synth::ui::NodeTree BuildTree() override
    {
        return {};
    }

    void SetActionHandler(ActionHandler) override {}

    void DispatchAction(const synth::ui::Action&) override {}
};

struct InputProbeApp
{
    InputProbeSurface surface;

    static synth::RuntimeConfig Config()
    {
        synth::RuntimeConfig config;
        config.appName = "InputProbeApp";
        config.numAudioInputs = 4;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 4;
        return config;
    }

    void Init(synth::AppContext*) {}

    synth::ui::Surface& PortableSurface()
    {
        return surface;
    }

    void ProcessBlock(synth::AudioBlock& block)
    {
        if (block.numRequestedInputChannels != Config().numAudioInputs ||
            block.numInputChannels != Config().numAudioInputs ||
            block.inputs == nullptr)
        {
            throw std::runtime_error("InputProbeApp expected rig-declared four-channel input storage");
        }

        const auto view = block.InputView();
        if (view.RequestedChannelCount() != 4 || view.ActiveChannelCount() != 4)
        {
            throw std::runtime_error("InputProbeApp expected matching requested/active input counts");
        }
        const std::span<const float> channel0 = view.Channel(0);

        for (std::size_t frame = 0; frame < block.numFrames; ++frame)
        {
            const float a = channel0[frame];
            const float b = view.Frame(frame).Sample(1);
            const float c = view.SampleOrSilence(3, frame);
            if (block.numOutputChannels > 0 && block.outputs != nullptr && block.outputs[0] != nullptr)
            {
                block.outputs[0][frame] = a + b + c;
            }
            if (block.numOutputChannels > 1 && block.outputs != nullptr && block.outputs[1] != nullptr)
            {
                block.outputs[1][frame] = a - b - c;
            }
        }
    }
};

static_assert(synth::SynthApplicationCore<InputProbeApp>);
static_assert(synth::SynthApplication<InputProbeApp>);

void RequireNear(float actual, float expected, float tolerance, const char* label)
{
    Require(std::fabs(actual - expected) <= tolerance, label);
}

void TestRigSilentUntilInjection()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    Require(rig.NumInputChannels() == 4, "input probe rig reports four input channels");
    Require(rig.InputBlockSize() == 4, "input probe rig uses configured four-frame blocks");

    rig.RunBlocks(1);
    Require(rig.Output().size() == 4, "silent probe run captures one full block");
    for (const auto& frame : rig.Output())
    {
        Require(frame.channels.size() == 2, "silent probe captures stereo frames");
        RequireNear(frame.channels[0], 0.0f, 1e-6f, "silent probe out0 is zero before injection");
        RequireNear(frame.channels[1], 0.0f, 1e-6f, "silent probe out1 is zero before injection");
    }
}

void TestInjectedChannelsReachProbeDsp()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    const float channel0[4] = {0.10f, 0.20f, 0.30f, 0.40f};
    const float channel1[4] = {0.01f, 0.02f, 0.03f, 0.04f};
    const float channel2[4] = {9.0f, 9.0f, 9.0f, 9.0f};
    const float channel3[4] = {0.001f, 0.002f, 0.003f, 0.004f};
    const std::span<const float> channels[4] = {channel0, channel1, channel2, channel3};

    Require(rig.SetInputBlock(channels), "SetInputBlock accepts a complete four-channel block");
    rig.ClearOutput();
    rig.RunBlocks(1);

    Require(rig.Output().size() == 4, "injected probe run captures one full block");
    for (std::size_t frame = 0; frame < 4; ++frame)
    {
        const float sum = channel0[frame] + channel1[frame] + channel3[frame];
        const float difference = channel0[frame] - channel1[frame] - channel3[frame];
        RequireNear(rig.Output()[frame].channels[0], sum, 1e-6f,
                    "probe out0 is explicit sum of Channel/Frame/SampleOrSilence reads");
        RequireNear(rig.Output()[frame].channels[1], difference, 1e-6f,
                    "probe out1 is explicit difference of Channel/Frame/SampleOrSilence reads");
    }

    // Unused channel 2 stayed nonzero in storage; output never incorporated it.
    //
    Require(channel2[0] == 9.0f, "unused injected channel remains caller-owned data");
}

void TestSampleChannelAndFrameInjectionOrdering()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    rig.ClearAudioInputs();

    Require(rig.SetInputSample(0, 2, 0.5f), "SetInputSample accepts in-range channel/frame");
    Require(rig.SetInputChannel(1, std::array<float, 4>{0.0f, 0.0f, 0.25f, 0.0f}),
            "SetInputChannel accepts a full block-sized channel");
    Require(rig.SetInputFrame(2, std::array<float, 4>{0.5f, 0.25f, 7.0f, 0.125f}),
            "SetInputFrame accepts a full four-channel frame");

    rig.ClearOutput();
    rig.RunBlocks(1);

    // Frame 2: ch0=0.5, ch1=0.25, ch3=0.125; ch2 unread.
    //
    RequireNear(rig.Output()[2].channels[0], 0.5f + 0.25f + 0.125f, 1e-6f,
                "sample/channel/frame injection preserves channel and frame ordering");
    RequireNear(rig.Output()[2].channels[1], 0.5f - 0.25f - 0.125f, 1e-6f,
                "sample/channel/frame injection preserves difference transform");
    RequireNear(rig.Output()[0].channels[0], 0.0f, 1e-6f,
                "frames not written by SetInputSample remain silent until otherwise set");
}

void TestUnusedInputIsNotMonitored()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    const float silent[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    const float loudUnused[4] = {1.0f, -1.0f, 0.5f, -0.5f};
    Require(rig.SetInputChannel(0, silent), "silence on read channel 0");
    Require(rig.SetInputChannel(1, silent), "silence on read channel 1");
    Require(rig.SetInputChannel(2, loudUnused), "nonzero unused channel 2");
    Require(rig.SetInputChannel(3, silent), "silence on read channel 3");

    rig.ClearOutput();
    rig.RunBlocks(1);
    for (const auto& frame : rig.Output())
    {
        RequireNear(frame.channels[0], 0.0f, 1e-6f, "unused loud input does not appear in out0");
        RequireNear(frame.channels[1], 0.0f, 1e-6f, "unused loud input does not appear in out1");
    }
}

void TestTransactionalRejectionLeavesStorageUnchanged()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    const float channel0[4] = {0.2f, 0.4f, 0.6f, 0.8f};
    const float channel1[4] = {0.05f, 0.05f, 0.05f, 0.05f};
    const float channel2[4] = {3.0f, 3.0f, 3.0f, 3.0f};
    const float channel3[4] = {0.01f, 0.02f, 0.03f, 0.04f};
    const std::span<const float> valid[4] = {channel0, channel1, channel2, channel3};
    Require(rig.SetInputBlock(valid), "seed valid block before rejection cases");

    rig.ClearOutput();
    rig.RunBlocks(1);
    const std::vector<synth_rig::SynthRig<InputProbeApp>::OutputFrame> snapshot = rig.Output();
    Require(snapshot.size() == 4, "snapshot captures one full configured block");

    const float shortChannel[2] = {1.0f, 2.0f};
    const float longChannel[5] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f};
    const float threeFrameChannels[3] = {1.0f, 2.0f, 3.0f};
    const float fiveChannels[5] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f};
    const std::span<const float> shortBlock[4] = {shortChannel, channel1, channel2, channel3};
    const std::span<const float> longBlock[4] = {longChannel, channel1, channel2, channel3};
    const std::span<const float> wrongCount[3] = {channel0, channel1, channel2};

    Require(!rig.SetInputSample(4, 0, 1.0f), "out-of-range channel sample injection is rejected");
    Require(!rig.SetInputSample(0, 4, 1.0f), "out-of-range frame sample injection is rejected");
    Require(!rig.SetInputChannel(4, channel0), "out-of-range channel write is rejected");
    Require(!rig.SetInputChannel(0, shortChannel), "short channel write is rejected");
    Require(!rig.SetInputChannel(0, longChannel), "long channel write is rejected");
    Require(!rig.SetInputFrame(4, channel0), "out-of-range frame write is rejected");
    Require(!rig.SetInputFrame(0, threeFrameChannels), "short frame write is rejected");
    Require(!rig.SetInputFrame(0, fiveChannels), "long/malformed frame shape is rejected");
    Require(!rig.SetInputBlock(shortBlock), "short-channel block shape is rejected");
    Require(!rig.SetInputBlock(longBlock), "long-channel block shape is rejected");
    Require(!rig.SetInputBlock(wrongCount), "wrong channel-count block shape is rejected");

    rig.ClearOutput();
    rig.RunBlocks(1);
    Require(rig.Output().size() == snapshot.size(), "post-rejection run still captures one block");
    for (std::size_t frame = 0; frame < snapshot.size(); ++frame)
    {
        Require(rig.Output()[frame].channels == snapshot[frame].channels,
                "rejected injections leave prior input storage unchanged");
    }
}

void TestRunSamplesRoundsUpToWholeBlock()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    rig.ClearAudioInputs();
    Require(rig.SetInputSample(0, 0, 0.5f), "seed one sample before RunSamples");
    rig.ClearOutput();
    rig.RunSamples(1);
    Require(rig.Output().size() == rig.InputBlockSize(),
            "RunSamples(1) still captures one full configured block");
}

std::string LoadSynthRigSource()
{
    const std::filesystem::path candidates[] = {
        "tests/support/SynthRig.hpp",
        "projects/synth/tests/support/SynthRig.hpp",
    };
    for (const auto& candidate : candidates)
    {
        std::ifstream input(candidate);
        if (input)
        {
            return std::string(std::istreambuf_iterator<char>(input),
                               std::istreambuf_iterator<char>());
        }
    }
    return {};
}

std::string MethodBody(const std::string& source, const std::string& signature)
{
    const auto start = source.find(signature);
    if (start == std::string::npos)
    {
        return {};
    }
    const auto brace = source.find('{', start);
    if (brace == std::string::npos)
    {
        return {};
    }
    int depth = 0;
    for (std::size_t i = brace; i < source.size(); ++i)
    {
        if (source[i] == '{')
        {
            ++depth;
        }
        else if (source[i] == '}')
        {
            --depth;
            if (depth == 0)
            {
                return source.substr(brace, i - brace + 1);
            }
        }
    }
    return {};
}

void TestPumpMethodsDoNotGrowInputStorage()
{
    const std::string source = LoadSynthRigSource();
    Require(!source.empty(), "SynthRig.hpp source is available for pump assertions");

    const char* signatures[] = {
        "void RunOneBlockAt(std::uint64_t timestamp)",
        "void RunBlocks(std::size_t count)",
        "void RunSamples(std::size_t count)",
        "void RunSeconds(double seconds)",
    };
    for (const char* signature : signatures)
    {
        const std::string body = MethodBody(source, signature);
        Require(!body.empty(), "pump method body is locatable in SynthRig.hpp");
        Require(body.find("inputBuffers_.resize") == std::string::npos,
                "pump methods do not resize inputBuffers_");
        Require(body.find("inputBuffers_.assign") == std::string::npos,
                "pump methods do not assign inputBuffers_");
        Require(body.find("inputPointers_.resize") == std::string::npos,
                "pump methods do not resize inputPointers_");
        Require(body.find("inputPointers_.assign") == std::string::npos,
                "pump methods do not assign inputPointers_");
        Require(body.find("std::vector<") == std::string::npos,
                "pump methods do not construct new vector storage");
        Require(body.find(".resize(") == std::string::npos,
                "pump methods do not call resize");
        Require(body.find(".assign(") == std::string::npos,
                "pump methods do not call assign");
    }
}

void TestClearAudioInputsRestoresSilence()
{
    synth_rig::SynthRig<InputProbeApp> rig;
    const float channel0[4] = {0.3f, 0.3f, 0.3f, 0.3f};
    Require(rig.SetInputChannel(0, channel0), "seed channel before clear");
    rig.ClearAudioInputs();
    rig.ClearOutput();
    rig.RunBlocks(1);
    for (const auto& frame : rig.Output())
    {
        RequireNear(frame.channels[0], 0.0f, 1e-6f, "ClearAudioInputs restores silent out0");
        RequireNear(frame.channels[1], 0.0f, 1e-6f, "ClearAudioInputs restores silent out1");
    }
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
    TestRigSilentUntilInjection();
    TestInjectedChannelsReachProbeDsp();
    TestSampleChannelAndFrameInjectionOrdering();
    TestUnusedInputIsNotMonitored();
    TestTransactionalRejectionLeavesStorageUnchanged();
    TestRunSamplesRoundsUpToWholeBlock();
    TestPumpMethodsDoNotGrowInputStorage();
    TestClearAudioInputsRestoresSilence();
    return g_failures == 0 ? 0 : 1;
}
