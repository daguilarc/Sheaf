#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/PortableUI.hpp"
#include "support/SynthRig.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth audio input tests must not see JUCE headers"
#endif

#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <new>
#include <span>
#include <stdexcept>
#include <type_traits>
#include <utility>
#include <vector>

namespace audio_input_allocation_probe {

std::atomic<bool> enabled{false};
std::atomic<std::size_t> count{0};

}  // namespace audio_input_allocation_probe

void* operator new(std::size_t size)
{
    if (audio_input_allocation_probe::enabled.load(std::memory_order_relaxed))
    {
        audio_input_allocation_probe::count.fetch_add(1, std::memory_order_relaxed);
    }
    if (void* memory = std::malloc(size))
    {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](std::size_t size)
{
    return ::operator new(size);
}

void operator delete(void* memory) noexcept
{
    std::free(memory);
}

void operator delete[](void* memory) noexcept
{
    std::free(memory);
}

void operator delete(void* memory, std::size_t) noexcept
{
    std::free(memory);
}

void operator delete[](void* memory, std::size_t) noexcept
{
    std::free(memory);
}

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

void TestRigConstructorRejectsNegativeInputs()
{
    // The rig sizes its planar input storage from the config before it calls
    // engine.Initialize(), so the engine's own rejection is too late: a
    // negative count would reach the allocator as a huge std::size_t first.
    RequireThrowsInvalidArgument([] { synth_rig::SynthRig<NegativeInputApp> rig; },
                                 "SynthRig rejects negative input count before sizing input storage");
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
    static constexpr int kNumAudioInputs = 4;
    static constexpr int kNumAudioOutputs = 2;
    static constexpr int kPreferredBlockSize = 4;

    InputProbeSurface surface;

    static synth::RuntimeConfig Config()
    {
        synth::RuntimeConfig config;
        config.appName = "InputProbeApp";
        config.numAudioInputs = kNumAudioInputs;
        config.numAudioOutputs = kNumAudioOutputs;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = kPreferredBlockSize;
        return config;
    }

    void Init(synth::AppContext*) {}

    synth::ui::Surface& PortableSurface()
    {
        return surface;
    }

    void ProcessBlock(synth::AudioBlock& block)
    {
        if (block.numRequestedInputChannels != kNumAudioInputs ||
            block.numInputChannels != kNumAudioInputs ||
            block.inputs == nullptr)
        {
            Require(false, "InputProbeApp expected rig-declared four-channel input storage");
            return;
        }

        const auto view = block.InputView();
        if (view.RequestedChannelCount() != static_cast<std::size_t>(kNumAudioInputs) ||
            view.ActiveChannelCount() != static_cast<std::size_t>(kNumAudioInputs))
        {
            Require(false, "InputProbeApp expected matching requested/active input counts");
            return;
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

using ProbeRig = synth_rig::SynthRig<InputProbeApp>;

void RequireProbeMatchesSnapshot(ProbeRig& rig,
                                 const std::vector<ProbeRig::OutputFrame>& snapshot,
                                 const char* label)
{
    rig.ClearOutput();
    rig.RunBlocks(1);
    Require(rig.Output().size() == snapshot.size(), "post-rejection run still captures one block");
    bool unchanged = rig.Output().size() == snapshot.size();
    for (std::size_t frame = 0; unchanged && frame < snapshot.size(); ++frame)
    {
        unchanged = rig.Output()[frame].channels == snapshot[frame].channels;
    }
    Require(unchanged, label);
}

void TestRigSilentUntilInjection()
{
    ProbeRig rig;
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
    ProbeRig rig;
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
}

void TestSampleChannelAndFrameInjectionOrdering()
{
    ProbeRig rig;
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
    ProbeRig rig;
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
    ProbeRig rig;
    const float channel0[4] = {0.2f, 0.4f, 0.6f, 0.8f};
    const float channel1[4] = {0.05f, 0.05f, 0.05f, 0.05f};
    const float channel2[4] = {3.0f, 3.0f, 3.0f, 3.0f};
    const float channel3[4] = {0.01f, 0.02f, 0.03f, 0.04f};
    const std::span<const float> valid[4] = {channel0, channel1, channel2, channel3};
    Require(rig.SetInputBlock(valid), "seed valid block before rejection cases");

    rig.ClearOutput();
    rig.RunBlocks(1);
    const std::vector<ProbeRig::OutputFrame> snapshot = rig.Output();
    Require(snapshot.size() == 4, "snapshot captures one full configured block");

    // Poison values differ from seeded storage on probe-observed channels 0/1/3.
    // Invalid short/long spans sit after valid poison prefixes so a validate-as-copy
    // implementation would visibly corrupt observed probe output.
    //
    const float poison0[4] = {0.91f, 0.92f, 0.93f, 0.94f};
    const float poison1[4] = {0.81f, 0.82f, 0.83f, 0.84f};
    const float poison3[4] = {0.61f, 0.62f, 0.63f, 0.64f};
    const float shortChannel[2] = {1.0f, 2.0f};
    const float longChannel[5] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f};
    const float threeFrameChannels[3] = {1.0f, 2.0f, 3.0f};
    const float fiveChannels[5] = {1.0f, 2.0f, 3.0f, 4.0f, 5.0f};
    const std::span<const float> shortBlock[4] = {poison0, poison1, shortChannel, poison3};
    const std::span<const float> longBlock[4] = {poison0, poison1, longChannel, poison3};
    const std::span<const float> wrongCount[3] = {poison0, poison1, poison3};

    Require(!rig.SetInputSample(4, 0, 1.0f), "out-of-range channel sample injection is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "out-of-range sample leaves prior storage unchanged");

    Require(!rig.SetInputSample(0, 4, 1.0f), "out-of-range frame sample injection is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "out-of-range frame sample leaves prior storage unchanged");

    Require(!rig.SetInputChannel(4, channel0), "out-of-range channel write is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "out-of-range channel write leaves prior storage unchanged");

    Require(!rig.SetInputChannel(0, shortChannel), "short channel write is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "short channel write leaves prior storage unchanged");

    Require(!rig.SetInputChannel(0, longChannel), "long channel write is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "long channel write leaves prior storage unchanged");

    Require(!rig.SetInputFrame(4, channel0), "out-of-range frame write is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "out-of-range frame write leaves prior storage unchanged");

    Require(!rig.SetInputFrame(0, threeFrameChannels), "short frame write is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "short frame write leaves prior storage unchanged");

    Require(!rig.SetInputFrame(0, fiveChannels), "long/malformed frame shape is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot, "malformed frame shape leaves prior storage unchanged");

    Require(!rig.SetInputBlock(shortBlock), "short-channel block shape is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot,
                                "short block with leading poison leaves prior storage unchanged");

    Require(!rig.SetInputBlock(longBlock), "long-channel block shape is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot,
                                "long block with leading poison leaves prior storage unchanged");

    Require(!rig.SetInputBlock(wrongCount), "wrong channel-count block shape is rejected");
    RequireProbeMatchesSnapshot(rig, snapshot,
                                "wrong-count poison block leaves prior storage unchanged");
}

void TestRunSamplesRoundsUpToWholeBlock()
{
    ProbeRig rig;
    rig.ClearAudioInputs();
    Require(rig.SetInputSample(0, 0, 0.5f), "seed one sample before RunSamples");
    rig.ClearOutput();
    rig.RunSamples(1);
    Require(rig.Output().size() == rig.InputBlockSize(),
            "RunSamples(1) still captures one full configured block");
}

void TestInjectionAddsNoAllocationBeyondCapture()
{
    ProbeRig silentRig;
    ProbeRig injectedRig;
    const float channel0[4] = {0.10f, 0.20f, 0.30f, 0.40f};
    const float channel1[4] = {0.01f, 0.02f, 0.03f, 0.04f};
    const float channel2[4] = {9.0f, 9.0f, 9.0f, 9.0f};
    const float channel3[4] = {0.001f, 0.002f, 0.003f, 0.004f};
    const std::span<const float> channels[4] = {channel0, channel1, channel2, channel3};
    Require(injectedRig.SetInputBlock(channels), "seed injected rig before allocation probe");

    constexpr std::size_t kBlocks = 3;

    silentRig.ClearOutput();
    audio_input_allocation_probe::count.store(0, std::memory_order_relaxed);
    audio_input_allocation_probe::enabled.store(true, std::memory_order_release);
    silentRig.RunBlocks(kBlocks);
    audio_input_allocation_probe::enabled.store(false, std::memory_order_release);
    const std::size_t silentAllocs =
        audio_input_allocation_probe::count.load(std::memory_order_relaxed);

    injectedRig.ClearOutput();
    audio_input_allocation_probe::count.store(0, std::memory_order_relaxed);
    audio_input_allocation_probe::enabled.store(true, std::memory_order_release);
    injectedRig.RunBlocks(kBlocks);
    audio_input_allocation_probe::enabled.store(false, std::memory_order_release);
    const std::size_t injectedAllocs =
        audio_input_allocation_probe::count.load(std::memory_order_relaxed);

    Require(silentAllocs == injectedAllocs,
            "injected input adds no allocations beyond the shared capture path");
    Require(silentAllocs > 0, "allocation probe observes the pre-existing capture path");
}

void TestClearAudioInputsRestoresSilence()
{
    ProbeRig rig;
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
    try
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
        TestRigConstructorRejectsNegativeInputs();
        TestRigSilentUntilInjection();
        TestInjectedChannelsReachProbeDsp();
        TestSampleChannelAndFrameInjectionOrdering();
        TestUnusedInputIsNotMonitored();
        TestTransactionalRejectionLeavesStorageUnchanged();
        TestRunSamplesRoundsUpToWholeBlock();
        TestInjectionAddsNoAllocationBeyondCapture();
        TestClearAudioInputsRestoresSilence();
        return g_failures == 0 ? 0 : 1;
    }
    catch (const std::exception& ex)
    {
        std::cerr << "[FAIL] uncaught exception: " << ex.what() << "\n";
        return 1;
    }
}
