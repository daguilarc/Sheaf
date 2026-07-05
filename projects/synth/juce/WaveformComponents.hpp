#pragma once

#include "PortableJuceBackend.hpp"
#include "../apps/miniapp/MiniAppDraw.hpp"
#include "synth/DspOscillators.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <span>
#include <vector>

namespace synth_juce {

class VcoWaveformComponent final : public juce::Component {
public:
    using VcoUIState = synth::DefaultWavetableVco::UIState;

    VcoWaveformComponent() = default;

    explicit VcoWaveformComponent(std::span<VcoUIState* const> states) {
        uiStates_.assign(states.begin(), states.end());
    }

    explicit VcoWaveformComponent(std::vector<VcoUIState*> states)
        : uiStates_(std::move(states)) {}

    void SetUIStates(std::span<VcoUIState* const> states) {
        uiStates_.assign(states.begin(), states.end());
        repaint();
    }

    void paint(juce::Graphics& g) override {
        const juce::Rectangle<float> nodeBounds = getLocalBounds().toFloat();
        synth_miniapp::VcoWaveformDrawState state;
        for (const auto* uiState : uiStates_) {
            synth_miniapp::WaveformLayerDrawState layer;
            if (uiState != nullptr) {
                layer.connected = uiState->connected.load();
                layer.color = uiState->color.Load();
                layer.scope = uiState->scope.load();
                layer.scopeChannel = uiState->scopeChannel.load();
            }
            state.layers.push_back(layer);
        }

        const std::vector<synth::ui::DrawCommand> commands =
            synth_miniapp::BuildVcoWaveformCommands(state, JuceToUiBounds(nodeBounds));
        for (const synth::ui::DrawCommand& command : commands) {
            PaintDrawCommand(g, command, nodeBounds);
        }
    }

private:
    static constexpr std::size_t kNumSamples = 1024;
    std::vector<VcoUIState*> uiStates_;
};

class LfoWaveformComponent final : public juce::Component {
public:
    using LfoUIState = synth::BasicLFOProcessor::UIState;

    LfoWaveformComponent() = default;

    explicit LfoWaveformComponent(std::span<LfoUIState* const> states) {
        uiStates_.assign(states.begin(), states.end());
    }

    explicit LfoWaveformComponent(std::vector<LfoUIState*> states)
        : uiStates_(std::move(states)) {}

    void SetUIStates(std::span<LfoUIState* const> states) {
        uiStates_.assign(states.begin(), states.end());
        repaint();
    }

    void paint(juce::Graphics& g) override {
        const juce::Rectangle<float> nodeBounds = getLocalBounds().toFloat();
        synth_miniapp::LfoWaveformDrawState state;
        for (const auto* uiState : uiStates_) {
            synth_miniapp::WaveformLayerDrawState layer;
            if (uiState != nullptr) {
                layer.connected = uiState->connected.load();
                layer.color = uiState->color.Load();
                layer.scope = uiState->scope.load();
                layer.scopeChannel = uiState->scopeChannel.load();
            }
            state.layers.push_back(layer);
        }

        const std::vector<synth::ui::DrawCommand> commands =
            synth_miniapp::BuildLfoWaveformCommands(state, JuceToUiBounds(nodeBounds));
        for (const synth::ui::DrawCommand& command : commands) {
            PaintDrawCommand(g, command, nodeBounds);
        }
    }

private:
    static constexpr std::size_t kNumSamples = 1024;
    std::vector<LfoUIState*> uiStates_;
};

} // namespace synth_juce
