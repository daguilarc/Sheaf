#pragma once

// JUCE-free miniapp UI surface: encoder-grid layout, semantic control tree,
// and MessageIn routing for the portable UI contract (Task 3).

#include "MiniAppCore.hpp"
#include "MiniAppDraw.hpp"
#include "MiniAppUiModel.hpp"

#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace synth_miniapp {

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
        const synth::ui::Bounds rootBounds = MiniAppPageLayout::RootBounds(context_);
        synth::ui::Builder builder;
        builder.Root(MiniAppNodeIds::kRoot, rootBounds);

        const synth::ui::Bounds content = MiniAppPageLayout::ContentArea(rootBounds);
        builder.Label(MiniAppNodeIds::kTitle, "Synth Params");

        const synth::ui::Bounds encoderArea = MiniAppPageLayout::EncoderArea(content);

        std::vector<synth::Color> modulatorColors;
        std::vector<synth::Color> gestureColors;
        if (core_ != nullptr && core_->Group() != nullptr)
        {
            for (const synth::ModulatorMetadata& metadata : core_->Group()->GetModulators().Metadata())
            {
                modulatorColors.push_back(metadata.color);
            }
        }
        if (context_ != nullptr && context_->parameterManager != nullptr)
        {
            for (std::size_t gestureIx = 0; gestureIx < context_->parameterManager->GestureCount(); ++gestureIx)
            {
                gestureColors.push_back(context_->parameterManager->GestureMetadataAt(gestureIx).color);
            }
        }

        for (std::size_t ix = 0; ix < EncoderGridLayout::kEncoderCount; ++ix)
        {
            const synth::ui::Bounds encoderBounds = EncoderGridLayout::BoundsForIndex(encoderArea, ix);
            std::vector<synth::ui::DrawCommand> drawCommands;
            if (context_ != nullptr && context_->uiState != nullptr && context_->uiState->slotCapacity > 0)
            {
                const synth::BankSlot::UIState& slotState = context_->uiState->slots[0];
                if (ix < slotState.cellCapacity)
                {
                    const EncoderDrawState encoderState = EncoderDrawStateFromParameter(
                        slotState.cells[ix], modulatorColors, gestureColors);
                    drawCommands = BuildEncoderDrawCommands(encoderState, encoderBounds);
                }
            }
            builder.Draw(MiniAppNodeIds::Encoder(ix), encoderBounds, std::move(drawCommands));
        }

        synth::ui::Bounds belowEncoders = content;
        belowEncoders.y = encoderArea.y + encoderArea.height;
        belowEncoders.height = content.height - (belowEncoders.y - content.y);

        synth::ui::Bounds waveformRow = belowEncoders;
        waveformRow.height = MiniAppPageLayout::kWaveformRowHeight;
        synth::ui::Bounds vcoScopeBounds;
        synth::ui::Bounds lfoScopeBounds;
        MiniAppPageLayout::WaveformScopeBounds(waveformRow, vcoScopeBounds, lfoScopeBounds);

        if (core_ != nullptr)
        {
            builder.Draw(MiniAppNodeIds::kVcoScope,
                         vcoScopeBounds,
                         BuildVcoWaveformCommands(VcoWaveformDrawStateFromCore(*core_), vcoScopeBounds));
            builder.Draw(MiniAppNodeIds::kLfoScope,
                         lfoScopeBounds,
                         BuildLfoWaveformCommands(LfoWaveformDrawStateFromCore(*core_), lfoScopeBounds));
        }
        else
        {
            builder.Draw(MiniAppNodeIds::kVcoScope, vcoScopeBounds, {});
            builder.Draw(MiniAppNodeIds::kLfoScope, lfoScopeBounds, {});
        }

        const MiniAppUiSnapshot snapshot = SnapshotUiState(context_);
        AppendMiniAppControls(builder, snapshot);

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
        DispatchMiniAppAction(
            context_,
            NowMicros(),
            action,
            [this](const synth::MessageIn& message) { PushMessage(message); });
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

    synth::AppContext* context_ = nullptr;
    MiniAppCore* core_ = nullptr;
    ActionHandler outerHandler_;
    mutable std::uint64_t fallbackTimestamp_ = 1;
};

}  // namespace synth_miniapp
