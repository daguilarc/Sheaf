#pragma once

#include "synth/AppContext.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace synth_one_second_delay {

class OneSecondDelaySurface final : public synth::ui::Surface {
public:
    synth::ui::NodeTree BuildTree() override {
        constexpr synth::ui::Bounds bounds{0.0f, 0.0f, 480.0f, 220.0f};
        synth::ui::Builder builder;
        builder.Root("one-second-delay.root", bounds)
            .StatusText("one-second-delay.title", "1 Second Delay", {});
        return builder.Build(bounds);
    }

    void SetActionHandler(ActionHandler) override {}
    void DispatchAction(const synth::ui::Action&) override {}
};

class OneSecondDelay final {
public:
    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "1 Second Delay";
        config.numAudioInputs = 2;
        config.numAudioOutputs = 2;
        config.preferredSampleRate = 48000.0;
        config.preferredBlockSize = 256;
        config.uiWidth = 480;
        config.uiHeight = 220;
        return config;
    }

    void Init(synth::AppContext*) {}

    void PrepareToPlay(double sampleRate, int) {
        const std::size_t delayFrames = sampleRate > 0.0
            ? static_cast<std::size_t>(std::llround(sampleRate))
            : 0;
        for (auto& channel : delayLines_) {
            channel.assign(delayFrames, 0.0f);
        }
        writeFrame_ = 0;
    }

    void ProcessBlock(synth::AudioBlock& block) {
        const auto input = block.InputView();
        const std::size_t delayFrames = delayLines_[0].size();

        for (std::size_t frame = 0; frame < block.numFrames; ++frame) {
            for (std::size_t channel = 0; channel < delayLines_.size(); ++channel) {
                float delayed = 0.0f;
                if (delayFrames != 0) {
                    delayed = delayLines_[channel][writeFrame_];
                    delayLines_[channel][writeFrame_] = input.SampleOrSilence(channel, frame);
                }

                if (block.outputs != nullptr &&
                    block.numOutputChannels > 0 &&
                    channel < static_cast<std::size_t>(block.numOutputChannels) &&
                    block.outputs[channel] != nullptr) {
                    block.outputs[channel][frame] = delayed;
                }
            }

            if (delayFrames != 0 && ++writeFrame_ == delayFrames) {
                writeFrame_ = 0;
            }
        }
    }

    synth::ui::Surface& PortableSurface() { return surface_; }

private:
    std::array<std::vector<float>, 2> delayLines_;
    std::size_t writeFrame_ = 0;
    OneSecondDelaySurface surface_;
};

}  // namespace synth_one_second_delay
