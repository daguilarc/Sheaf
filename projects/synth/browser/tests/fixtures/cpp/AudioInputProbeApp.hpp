#pragma once

#include "synth/AppContext.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>

namespace synth_browser::test {

class AudioInputProbeSurface final : public synth::ui::Surface {
public:
    synth::ui::NodeTree BuildTree() override
    {
        synth::ui::Builder builder;
        builder.Root("fake-browser-root", {0.0f, 0.0f, 640.0f, 480.0f})
            .StatusText("audio-input-probe-status", "Audio Input Probe", {});
        return builder.Build({0.0f, 0.0f, 640.0f, 480.0f});
    }

    void SetActionHandler(ActionHandler) override {}
    void DispatchAction(const synth::ui::Action&) override {}
};

class AudioInputProbeApp final {
public:
    static synth::RuntimeConfig Config()
    {
        synth::RuntimeConfig config;
        config.appName = "AudioInputProbeApp";
        config.numAudioInputs = 4;
        config.numAudioOutputs = 2;
        config.uiWidth = 640;
        config.uiHeight = 480;
        return config;
    }

    void Init(synth::AppContext*) {}
    synth::ui::Surface& PortableSurface() { return surface_; }

    void ProcessBlock(synth::AudioBlock& block)
    {
        const auto input = block.InputView();
        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            const auto sample = input.Frame(frame);
            const float out0 = input.SampleOrSilence(0, frame) +
                               0.5f * input.SampleOrSilence(2, frame);
            const float out1 = sample.SampleOrSilence(1) -
                               sample.SampleOrSilence(3);
            if (block.outputs != nullptr && block.numOutputChannels > 0 &&
                block.outputs[0] != nullptr) {
                block.outputs[0][frame] = out0;
            }
            if (block.outputs != nullptr && block.numOutputChannels > 1 &&
                block.outputs[1] != nullptr) {
                block.outputs[1][frame] = out1;
            }
        }
    }

private:
    AudioInputProbeSurface surface_;
};

}  // namespace synth_browser::test
