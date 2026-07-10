#pragma once

#include "synth/AppContext.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cmath>
#include <functional>
#include <utility>

namespace synth_browser::test {

class FakeBrowserSurface final : public synth::ui::Surface {
public:
    synth::ui::NodeTree BuildTree() override
    {
        synth::ui::Builder builder;
        builder.Root("fake-browser-root", {0.0f, 0.0f, 640.0f, 480.0f})
            .Button("fake-browser-button", "Trigger", synth::ui::Action::Named("fake.trigger"))
            .Slider("fake-browser-slider", "Level", 0.5f, 0.0f, 1.0f, 0.001f,
                    synth::ui::Action::Named("fake.level"))
            .DrawInteractive(
                "fake-browser-draw", {24.0f, 120.0f, 320.0f, 120.0f},
                {synth::ui::DrawCommand::Fill(synth::ui::Color::Rgb(20, 24, 32)),
                 synth::ui::DrawCommand::Line({0.0f, 60.0f}, {320.0f, 60.0f},
                                              synth::ui::Color::Rgb(96, 220, 180), 2.0f)},
                synth::ui::Action::WithValue("fake.drag", "axis:0"),
                synth::ui::Action::Named("fake.double_click"))
            .StatusText("fake-browser-action-status",
                        "Actions: " + std::to_string(actionCount_) + " " + lastActionName_);
        return builder.Build();
    }

    void SetActionHandler(ActionHandler handler) override
    {
        handler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        ++actionCount_;
        lastActionName_ = action.name;
        if (handler_)
        {
            handler_(action);
        }
    }

private:
    std::size_t actionCount_ = 0;
    std::string lastActionName_;
    ActionHandler handler_;
};

class FakeBrowserApp {
public:
    static synth::RuntimeConfig Config()
    {
        return synth::RuntimeConfig{
            .appName = "FakeBrowserApp",
            .uiWidth = 640,
            .uiHeight = 480,
        };
    }

    void Init(synth::AppContext*) {}

    void ProcessBlock(synth::AudioBlock& block)
    {
        constexpr float kSampleRate = 48000.0f;
        constexpr float kFrequencyHz = 440.0f;
        constexpr float kTwoPi = 6.28318530717958647692f;
        const float phaseIncrement = kTwoPi * kFrequencyHz / kSampleRate;

        for (std::size_t frame = 0; frame < block.numFrames; ++frame)
        {
            const float sample = 0.2f * std::sin(phase_);
            for (int channel = 0; channel < block.numOutputChannels; ++channel)
            {
                if (block.outputs != nullptr && block.outputs[channel] != nullptr)
                {
                    block.outputs[channel][frame] = sample;
                }
            }
            phase_ += phaseIncrement;
            if (phase_ >= kTwoPi)
            {
                phase_ -= kTwoPi;
            }
        }
    }

    synth::ui::Surface& PortableSurface()
    {
        return surface_;
    }

private:
    float phase_ = 0.0f;
    FakeBrowserSurface surface_;
};

}  // namespace synth_browser::test
