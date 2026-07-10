#pragma once

// JUCE-free portable UI surface for Dresden 4.

#include "Dresden4Core.hpp"
#include "Dresden4Draw.hpp"
#include "Dresden4UiModel.hpp"

#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>

namespace synth_dresden4 {

class Dresden4UiSurface final : public synth::ui::Surface
{
public:
    void Attach(synth::AppContext* context, Dresden4Core* core)
    {
        context_ = context;
        core_ = core;
    }

    synth::ui::NodeTree BuildTree() override
    {
        const synth::ui::Bounds rootBounds = Dresden4PageLayout::RootBounds(context_);
        const synth::ui::Bounds content = Dresden4PageLayout::ContentArea(rootBounds);

        synth::ui::Builder builder;
        builder.Root(Dresden4NodeIds::kRoot, rootBounds);
        builder.Draw(Dresden4NodeIds::kBackground, rootBounds, BuildDresden4BackgroundCommands(rootBounds));
        builder.Label(Dresden4NodeIds::kTitle, "Dresden 4");

        for (std::size_t scopeIx = 0; scopeIx < Dresden4PageLayout::kScopeCount; ++scopeIx)
        {
            const synth::ui::Bounds scopeBounds = Dresden4PageLayout::ScopeBounds(content, scopeIx);
            builder.Draw(Dresden4NodeIds::Scope(scopeIx),
                         scopeBounds,
                         core_ != nullptr ? BuildDresden4ScopeCommands(ScopeDrawStateFromCore(*core_, scopeIx), scopeBounds)
                                          : BuildDresden4ScopeCommands({}, scopeBounds));
        }

        const Dresden4UiSnapshot snapshot = SnapshotUiState(context_);
        const synth::ui::Bounds encoderArea = Dresden4PageLayout::EncoderArea(content);
        for (std::size_t ix = 0; ix < Dresden4EncoderGridLayout::kEncoderCount; ++ix)
        {
            const Dresden4EncoderDrawState state =
                ix < snapshot.encoders.size() ? snapshot.encoders[ix] : Dresden4EncoderDrawState{};
            const synth::ui::Bounds encoderBounds = Dresden4EncoderGridLayout::BoundsForIndex(encoderArea, ix);
            builder.DrawInteractive(
                Dresden4NodeIds::Encoder(ix),
                encoderBounds,
                BuildDresden4EncoderCommands(state, encoderBounds),
                synth::ui::Action::WithValue(Dresden4Actions::kEncoderDrag, FormatEncoderGestureValue(0, ix, 0.0f)),
                synth::ui::Action::WithValue(Dresden4Actions::kEncoderPush, FormatEncoderGestureValue(0, ix, 0.0f)));
        }

        AppendDresden4Controls(builder, snapshot);

        synth::ui::NodeTree tree = builder.Build();
        for (synth::ui::Node& node : tree.nodes)
        {
            if (node.id.value.rfind("dresden4.encoder.", 0) == 0)
            {
                const std::size_t index = ParseSize(node.id.value.substr(std::string("dresden4.encoder.").size()), 0);
                if (index < snapshot.encoders.size() && !snapshot.encoders[index].connected)
                {
                    node.text = "Disconnected";
                }
            }
        }
        return tree;
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
        DispatchDresden4Action(context_,
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
    Dresden4Core* core_ = nullptr;
    ActionHandler outerHandler_;
    mutable std::uint64_t fallbackTimestamp_ = 1;
};

}  // namespace synth_dresden4
