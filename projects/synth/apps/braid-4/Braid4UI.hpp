#pragma once

// JUCE-free portable UI surface for Braid 4.

#include "Braid4Core.hpp"
#include "Braid4Draw.hpp"
#include "Braid4UiModel.hpp"

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
        const Braid4UiSnapshot snapshot = SnapshotUiState(context_);
        const bool showingModulationView =
            context_ != nullptr && context_->uiState != nullptr && context_->uiState->slotCapacity > 0 &&
            context_->uiState->slots[0].showingModulationView.load(std::memory_order_relaxed);

        synth::ui::StandardAppLayout layout;
        layout.idPrefix = "braid4";
        layout.title = "Braid 4";
        layout.upperVisualizer = [this](synth::ui::Builder& builder) {
            Braid4ScopeGridLayout::Emit(
                builder, "braid4.scope.vco.grid", [this](synth::ui::Builder& builder, std::size_t ix) {
                    EmitScopeCell(builder, Braid4NodeIds::VcoScope(ix), [this, ix] {
                        return core_ != nullptr ? ScopeDrawStateFromCore(*core_, ix) : Braid4ScopeDrawState{};
                    });
                });
        };
        layout.lowerVisualizer = [this](synth::ui::Builder& builder) {
            Braid4ScopeGridLayout::Emit(
                builder, "braid4.scope.lfo.grid", [this](synth::ui::Builder& builder, std::size_t ix) {
                    EmitScopeCell(builder, Braid4NodeIds::LfoScope(ix), [this, ix] {
                        return core_ != nullptr ? LfoScopeDrawStateFromCore(*core_, ix) : Braid4ScopeDrawState{};
                    });
                });
        };
        layout.encoders = [this, &snapshot, showingModulationView](synth::ui::Builder& builder) {
            Braid4EncoderGridLayout::Emit(
                builder, "braid4.encoders.grid",
                [this, &snapshot, showingModulationView](synth::ui::Builder& builder, std::size_t ix) {
                    EmitEncoderCell(builder, snapshot, showingModulationView, ix);
                });
        };
        layout.widgetBay = [&snapshot](synth::ui::Builder& builder) {
            AppendBraid4Controls(builder, snapshot);
        };

        synth::ui::Builder builder;
        builder.Root(Braid4NodeIds::kRoot, rootBounds);
        synth::ui::LayoutOptions background;
        background.explicitBounds = synth::ui::Bounds{0.0f, 0.0f, rootBounds.width, rootBounds.height};
        builder.Draw(Braid4NodeIds::kBackground, background, [](synth::ui::Bounds extent) {
            return BuildBraid4BackgroundCommands(extent);
        });
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
    static void EmitScopeCell(synth::ui::Builder& builder,
                              const std::string& id,
                              const std::function<Braid4ScopeDrawState()>& state)
    {
        builder.Draw(id, Braid4CellLayout(), [state](synth::ui::Bounds extent) {
            return BuildBraid4ScopeCommands(state(), extent);
        });
    }

    void EmitEncoderCell(synth::ui::Builder& builder,
                         const Braid4UiSnapshot& snapshot,
                         bool showingModulationView,
                         std::size_t ix)
    {
        synth::ui::EncoderDrawState state =
            ix < snapshot.encoders.size() ? snapshot.encoders[ix] : synth::ui::EncoderDrawState{};
        // A disconnected cell in the modulation view still holds its place in
        // the grid, so its neighbours never move; it paints nothing and
        // dispatches nothing, exactly as it did when it was left out entirely.
        const bool hidden = showingModulationView && !state.connected;

        synth::ui::Visualizer* visualizer = nullptr;
        if (!hidden && context_ != nullptr && context_->uiState != nullptr &&
            context_->uiState->slotCapacity > 0)
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
        cell.layout = Braid4CellLayout();
        if (!hidden)
        {
            cell.pointerDragAction = synth::ui::Action::WithValue(
                Braid4Actions::kEncoderDrag, FormatEncoderGestureValue(0, ix, 0.0f));
            cell.doubleClickAction = synth::ui::Action::WithValue(
                Braid4Actions::kEncoderPush, FormatEncoderGestureValue(0, ix, 0.0f));
        }
        builder.Draw(
            encoderId,
            [state, hidden](synth::ui::Bounds extent) {
                return hidden ? std::vector<synth::ui::DrawCommand>{}
                              : synth::ui::BuildEncoderDrawCommands(state, extent);
            },
            cell);
    }

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
