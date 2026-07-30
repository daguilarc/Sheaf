#pragma once

// JUCE-free miniapp UI surface: encoder-grid layout, semantic control tree,
// and MessageIn routing for the portable UI contract (Task 3).

#include "MiniAppCore.hpp"
#include "MiniAppDraw.hpp"
#include "MiniAppUiModel.hpp"

#include "synth/EncoderDraw.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/PortableUIStandardLayout.hpp"

#include <atomic>
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
        const MiniAppUiSnapshot snapshot = SnapshotUiState(context_);

        synth::ui::StandardAppLayout layout;
        layout.idPrefix = "miniapp";
        layout.title = "Synth Params";
        layout.upperVisualizer = [this](synth::ui::Builder& builder) {
            EmitWaveform(builder, MiniAppNodeIds::kVcoScope, [this](synth::ui::Bounds extent) {
                return BuildVcoWaveformCommands(VcoWaveformDrawStateFromCore(*core_), extent);
            });
        };
        layout.lowerVisualizer = [this](synth::ui::Builder& builder) {
            EmitWaveform(builder, MiniAppNodeIds::kLfoScope, [this](synth::ui::Bounds extent) {
                return BuildLfoWaveformCommands(LfoWaveformDrawStateFromCore(*core_), extent);
            });
        };
        layout.encoders = [this](synth::ui::Builder& builder) {
            EncoderGridLayout::Emit(builder, "miniapp.encoders.grid",
                                    [this](synth::ui::Builder& builder, std::size_t ix) {
                                        EmitEncoderCell(builder, ix);
                                    });
        };
        layout.widgetBay = [&snapshot](synth::ui::Builder& builder) {
            AppendMiniAppControls(builder, snapshot);
        };

        synth::ui::Builder builder;
        builder.Root(MiniAppNodeIds::kRoot, rootBounds);
        layout.Emit(builder);
        return builder.Build(rootBounds);
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
    // A visualizer slot takes one waveform component filling whatever extent
    // the standard layout resolved for it.
    void EmitWaveform(synth::ui::Builder& builder,
                      const std::string& id,
                      const std::function<std::vector<synth::ui::DrawCommand>(synth::ui::Bounds)>& commands)
    {
        synth::ui::LayoutOptions fill;
        fill.main = synth::ui::Extent::Weight(1.0f);
        builder.Draw(id, fill, [this, commands](synth::ui::Bounds extent) {
            return core_ != nullptr ? commands(extent) : std::vector<synth::ui::DrawCommand>{};
        });
    }

    void EmitEncoderCell(synth::ui::Builder& builder, std::size_t ix)
    {
        synth::ui::EncoderDrawState encoderState;
        synth::ui::Visualizer* visualizer = nullptr;
        if (context_ != nullptr && context_->uiState != nullptr && context_->uiState->slotCapacity > 0)
        {
            const synth::BankSlot::UIState& slotState = context_->uiState->slots[0];
            if (ix < slotState.cellCapacity)
            {
                const synth::Parameter::UIState& cell = slotState.cells[ix];
                encoderState = synth::ui::EncoderDrawStateFromParameter(cell);
                visualizer = cell.visualizer.load(std::memory_order_relaxed);
                encoderState.hasVisualizerUnderlay = visualizer != nullptr && visualizer->Visible();
                if (encoderState.hasVisualizerUnderlay)
                {
                    encoderState.wantsFrame = visualizer->WantsEncoderFrame();
                }
            }
        }

        const std::string encoderId = MiniAppNodeIds::Encoder(ix);
        if (visualizer != nullptr && visualizer->Visible())
        {
            // The underlay covers exactly the encoder it sits beneath, whatever
            // extent the grid resolves that cell to (sru-25).
            synth::ui::ControlStyle underlay;
            underlay.layout.overlayOf = encoderId;
            builder.Draw(
                encoderId + ".visualizer",
                [visualizer](synth::ui::Bounds extent) {
                    visualizer->SetBounds(extent);
                    return visualizer->Draw();
                },
                underlay);
        }

        synth::ui::ControlStyle cell;
        cell.layout = EncoderGridLayout::CellLayout();
        cell.pointerDragAction = synth::ui::Action::WithValue(
            MiniAppActions::kEncoderDrag, FormatEncoderGestureValue(0, ix, 0.0f));
        cell.doubleClickAction = synth::ui::Action::WithValue(
            MiniAppActions::kEncoderPush, FormatEncoderGestureValue(0, ix, 0.0f));
        builder.Draw(
            encoderId,
            [encoderState](synth::ui::Bounds extent) {
                return synth::ui::BuildEncoderDrawCommands(encoderState, extent);
            },
            cell);
    }

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
