#pragma once

// JUCE-free portable UI surface for Braid 4.

#include "Braid4Core.hpp"
#include "Braid4Draw.hpp"
#include "Braid4UiModel.hpp"

#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace synth_braid4 {

class Braid4UiSurface final : public synth::ui::Surface
{
public:
    void Attach(synth::AppContext* context, Braid4Core* core)
    {
        context_ = context;
        core_ = core;
    }

    synth::ui::NodeTree BuildTree() override
    {
        const synth::ui::Bounds rootBounds = Braid4PageLayout::RootBounds(context_);
        const synth::ui::Bounds content = Braid4PageLayout::ContentArea(rootBounds);

        synth::ui::Builder builder;
        builder.Root(Braid4NodeIds::kRoot, rootBounds);
        builder.Draw(Braid4NodeIds::kBackground, rootBounds, BuildBraid4BackgroundCommands(rootBounds));
        builder.Label(Braid4NodeIds::kTitle, "Braid 4");

        for (std::size_t scopeIx = 0; scopeIx < Braid4PageLayout::kScopeCount; ++scopeIx)
        {
            const synth::ui::Bounds vcoBounds = Braid4PageLayout::ScopeBounds(content, scopeIx);
            builder.Draw(Braid4NodeIds::VcoScope(scopeIx),
                         vcoBounds,
                         core_ != nullptr ? BuildBraid4ScopeCommands(ScopeDrawStateFromCore(*core_, scopeIx), vcoBounds)
                                          : BuildBraid4ScopeCommands({}, vcoBounds));

            const synth::ui::Bounds lfoBounds = Braid4PageLayout::LfoScopeBounds(content, scopeIx);
            builder.Draw(Braid4NodeIds::LfoScope(scopeIx),
                         lfoBounds,
                         core_ != nullptr ? BuildBraid4ScopeCommands(LfoScopeDrawStateFromCore(*core_, scopeIx), lfoBounds)
                                          : BuildBraid4ScopeCommands({}, lfoBounds));
        }

        const Braid4UiSnapshot snapshot = SnapshotUiState(context_);
        const synth::ui::Bounds encoderArea = Braid4PageLayout::EncoderArea(content);
        const bool showingModulationView =
            context_ != nullptr && context_->uiState != nullptr && context_->uiState->slotCapacity > 0 &&
            context_->uiState->slots[0].showingModulationView.load(std::memory_order_relaxed);
        for (std::size_t ix = 0; ix < Braid4EncoderGridLayout::kEncoderCount; ++ix)
        {
            synth::ui::EncoderDrawState state =
                ix < snapshot.encoders.size() ? snapshot.encoders[ix] : synth::ui::EncoderDrawState{};
            if (showingModulationView && !state.connected)
            {
                continue;
            }
            const synth::ui::Bounds encoderBounds = Braid4EncoderGridLayout::BoundsForIndex(encoderArea, ix);
            synth::ui::Visualizer* visualizer = nullptr;
            if (context_ != nullptr && context_->uiState != nullptr && context_->uiState->slotCapacity > 0)
            {
                const synth::BankSlot::UIState& slotState = context_->uiState->slots[0];
                if (ix < slotState.cellCapacity)
                {
                    visualizer = slotState.cells[ix].visualizer.load(std::memory_order_relaxed);
                }
            }
            state.hasVisualizerUnderlay = visualizer != nullptr && visualizer->Visible();
            const std::string encoderId = Braid4NodeIds::Encoder(ix);
            if (visualizer != nullptr && visualizer->Visible())
            {
                visualizer->SetBounds(encoderBounds);
                builder.Visualizer(encoderId + ".visualizer", visualizer);
            }
            builder.DrawInteractive(
                encoderId,
                encoderBounds,
                synth::ui::BuildEncoderDrawCommands(state, encoderBounds),
                synth::ui::Action::WithValue(Braid4Actions::kEncoderDrag, FormatEncoderGestureValue(0, ix, 0.0f)),
                synth::ui::Action::WithValue(Braid4Actions::kEncoderPush, FormatEncoderGestureValue(0, ix, 0.0f)));
        }

        AppendBraid4Controls(builder, snapshot);
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
        DispatchBraid4Action(context_,
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
    Braid4Core* core_ = nullptr;
    ActionHandler outerHandler_;
    mutable std::uint64_t fallbackTimestamp_ = 1;
};

}  // namespace synth_braid4
