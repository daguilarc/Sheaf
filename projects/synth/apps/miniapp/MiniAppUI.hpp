#pragma once

// JUCE-free miniapp UI surface: encoder-grid layout, semantic control tree,
// and MessageIn routing for the portable UI contract (Task 2).

#include "MiniAppCore.hpp"

#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>

namespace synth_miniapp {

struct EncoderGridLayout
{
    static constexpr std::size_t kEncoderCount = 7;
    static constexpr std::size_t kFirstRowCount = 4;
    static constexpr float kColumnWidth = 132.0f;
    static constexpr float kRowHeight = 150.0f;
    static constexpr float kTotalHeight = kRowHeight * 2.0f;
    static constexpr float kInset = 10.0f;

    static synth::ui::Bounds BoundsForIndex(synth::ui::Bounds area, std::size_t index)
    {
        const std::size_t row = index < kFirstRowCount ? 0 : 1;
        const std::size_t column = row == 0 ? index : index - kFirstRowCount;
        synth::ui::Bounds bounds{
            area.x + static_cast<float>(column) * kColumnWidth,
            area.y + static_cast<float>(row) * kRowHeight,
            kColumnWidth,
            kRowHeight
        };
        bounds.x += kInset;
        bounds.y += kInset;
        bounds.width -= kInset * 2.0f;
        bounds.height -= kInset * 2.0f;
        return bounds;
    }
};

class MiniAppUiSurface final : public synth::ui::Surface
{
public:
    void Attach(synth::AppContext* context, MiniAppCore* core)
    {
        context_ = context;
        core_ = core;
    }

    synth::ui::NodeTree BuildTree() override
    {
        const float width = context_ != nullptr && context_->config != nullptr
                                ? static_cast<float>(context_->config->uiWidth)
                                : 900.0f;
        const float height = context_ != nullptr && context_->config != nullptr
                                 ? static_cast<float>(context_->config->uiHeight)
                                 : 560.0f;

        synth::ui::Builder builder;
        builder.Root("miniapp.root", synth::ui::Bounds{0.0f, 0.0f, width, height});

        synth::ui::Bounds content{16.0f, 16.0f, width - 32.0f, height - 32.0f};
        builder.Label("miniapp.title", "Synth Params");

        synth::ui::Bounds encoderArea = content;
        encoderArea.y += 32.0f;
        encoderArea.height = EncoderGridLayout::kTotalHeight;
        for (std::size_t ix = 0; ix < EncoderGridLayout::kEncoderCount; ++ix)
        {
            const synth::ui::Bounds encoderBounds = EncoderGridLayout::BoundsForIndex(encoderArea, ix);
            builder.Draw("miniapp.encoder." + std::to_string(ix), encoderBounds, {});
        }

        synth::ui::Bounds belowEncoders = content;
        belowEncoders.y = encoderArea.y + encoderArea.height;
        belowEncoders.height = content.height - (belowEncoders.y - content.y);

        synth::ui::Bounds waveformRow = belowEncoders;
        waveformRow.height = 130.0f;
        const float halfWaveformWidth = waveformRow.width * 0.5f;
        synth::ui::Bounds vcoScopeBounds{
            waveformRow.x + 8.0f,
            waveformRow.y + 8.0f,
            halfWaveformWidth - 16.0f,
            waveformRow.height - 16.0f
        };
        synth::ui::Bounds lfoScopeBounds{
            waveformRow.x + halfWaveformWidth + 8.0f,
            waveformRow.y + 8.0f,
            halfWaveformWidth - 16.0f,
            waveformRow.height - 16.0f
        };
        builder.Draw("miniapp.vco.scope", vcoScopeBounds, {});
        builder.Draw("miniapp.lfo.scope", lfoScopeBounds, {});

        builder.Button("miniapp.bank.vco", "VCO", synth::ui::Action::WithValue("miniapp.bank.select", "0"));
        builder.Button("miniapp.bank.lfo", "LFO", synth::ui::Action::WithValue("miniapp.bank.select", "1"));
        builder.Toggle("miniapp.gesture.toggle", "Gesture", false,
                       synth::ui::Action::Named("miniapp.gesture.toggle"));
        builder.Button("miniapp.reset", "Reset", synth::ui::Action::Named("miniapp.reset"));
        builder.Button("miniapp.random", "Random", synth::ui::Action::Named("miniapp.random"));
        builder.Button("miniapp.random_mod", "Random Mod", synth::ui::Action::Named("miniapp.random_mod"));

        builder.Button("miniapp.scene.0", "S1", synth::ui::Action::WithValue("miniapp.scene.select", "0"));
        builder.Button("miniapp.scene.1", "S2", synth::ui::Action::WithValue("miniapp.scene.select", "1"));
        builder.Button("miniapp.scene.2", "S3", synth::ui::Action::WithValue("miniapp.scene.select", "2"));
        builder.Button("miniapp.start", "Start", synth::ui::Action::Named("miniapp.start"));
        builder.Button("miniapp.stop", "Stop", synth::ui::Action::Named("miniapp.stop"));

        builder.Slider("miniapp.gesture.value", "Gesture", 0.0f, 0.0f, 1.0f, 0.001f,
                       synth::ui::Action::Named("miniapp.gesture.value"));
        builder.Slider("miniapp.scene.blend", "Blend", 0.0f, 0.0f, 1.0f, 0.001f,
                       synth::ui::Action::Named("miniapp.scene.blend"));

        return builder.Build();
    }

    void SetActionHandler(ActionHandler handler) override
    {
        outerHandler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        HandleAction(action);
        if (outerHandler_)
        {
            outerHandler_(action);
        }
    }

private:
    void HandleAction(const synth::ui::Action& action)
    {
        if (context_ == nullptr || context_->uiBus == nullptr)
        {
            return;
        }

        const std::uint64_t timestamp = NowMicros();

        if (action.name == "miniapp.start")
        {
            PushMessage(synth::MessageIn::Start(timestamp));
            return;
        }
        if (action.name == "miniapp.stop")
        {
            PushMessage(synth::MessageIn::Stop(timestamp));
            return;
        }
        if (action.name == "miniapp.bank.select")
        {
            const std::size_t bankIx = ParseSize(action.value, 0);
            PushMessage(synth::MessageIn::SelectParamBank(timestamp, 0, bankIx));
            return;
        }
        if (action.name == "miniapp.gesture.toggle")
        {
            PushMessage(synth::MessageIn::ToggleGestureSelect(timestamp, 0));
            return;
        }
        if (action.name == "miniapp.gesture.value")
        {
            const float value = ParseFloat(action.value, 0.0f);
            PushMessage(synth::MessageIn::SetGestureValue(timestamp, 0, value));
            return;
        }
        if (action.name == "miniapp.scene.select")
        {
            const std::size_t sceneIx = ParseSize(action.value, 0);
            PushMessage(synth::MessageIn::SceneSelect(timestamp, sceneIx));
            return;
        }
        if (action.name == "miniapp.scene.blend")
        {
            const float blend = ParseFloat(action.value, 0.0f);
            PushMessage(synth::MessageIn::SetSceneBlend(timestamp, blend));
            return;
        }
        if (action.name == "miniapp.reset")
        {
            PushMessage(synth::MessageIn::ToggleReset(timestamp));
            return;
        }
        if (action.name == "miniapp.random")
        {
            PushMessage(synth::MessageIn::ToggleRandom(timestamp));
            return;
        }
        if (action.name == "miniapp.random_mod")
        {
            PushMessage(synth::MessageIn::ToggleRandomMod(timestamp));
            return;
        }
    }

    void PushMessage(const synth::MessageIn& message)
    {
        if (context_ != nullptr && context_->uiBus != nullptr)
        {
            context_->uiBus->Push(message);
        }
    }

    std::uint64_t NowMicros() const
    {
        if (context_ != nullptr && context_->now)
        {
            return context_->now();
        }
        return fallbackTimestamp_++;
    }

    static std::size_t ParseSize(const std::string& value, std::size_t fallback)
    {
        if (value.empty())
        {
            return fallback;
        }
        try
        {
            std::size_t consumed = 0;
            const unsigned long parsed = std::stoul(value, &consumed, 10);
            return consumed == value.size() ? static_cast<std::size_t>(parsed) : fallback;
        }
        catch (...)
        {
            return fallback;
        }
    }

    static float ParseFloat(const std::string& value, float fallback)
    {
        if (value.empty())
        {
            return fallback;
        }
        try
        {
            std::size_t consumed = 0;
            const float parsed = std::stof(value, &consumed);
            return consumed == value.size() ? parsed : fallback;
        }
        catch (...)
        {
            return fallback;
        }
    }

    synth::AppContext* context_ = nullptr;
    // Stored for Task 4 draw/UI-state extraction; Task 2 only needs context_
    // for action routing and dimensions.
    MiniAppCore* core_ = nullptr;
    ActionHandler outerHandler_;
    mutable std::uint64_t fallbackTimestamp_ = 1;
};

}  // namespace synth_miniapp
