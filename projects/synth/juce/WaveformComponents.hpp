#pragma once

#include "PathDrawer.hpp"
#include "synth/DspOscillators.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <span>
#include <vector>

namespace synth_juce {

inline juce::Colour ToJuceColour(synth::Color color) {
    return juce::Colour(color.r, color.g, color.b, color.a);
}

inline void DrawWaveformFromScope(juce::Graphics& g,
                                  const synth::ScopeReader& scopeReader,
                                  synth::Color color,
                                  float minY,
                                  float maxY,
                                  bool drawIndicator,
                                  juce::Rectangle<float> bounds) {
    if (scopeReader.Empty()) {
        return;
    }
    PathDrawer drawer(bounds.getHeight(), bounds.getWidth(), bounds.getX(), bounds.getY());
    const juce::Colour juceColor = ToJuceColour(color);
    drawer.DrawScopePath(g, juceColor, scopeReader, minY, maxY);
    if (drawIndicator) {
        drawer.DrawScopeMarker(g, juceColor.brighter(0.45f), scopeReader, minY, maxY);
    }
}

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
        const auto bounds = getLocalBounds().toFloat().reduced(4.0f);
        g.fillAll(juce::Colour(12, 14, 16));
        g.setColour(juce::Colour(42, 46, 48));
        g.drawLine(bounds.getX(), bounds.getCentreY(), bounds.getRight(), bounds.getCentreY(), 1.0f);

        for (const auto* state : uiStates_) {
            if (state == nullptr || !state->connected.load()) {
                continue;
            }
            const auto* scope = state->scope.load();
            if (scope == nullptr) {
                continue;
            }
            synth::ScopeReader reader(scope, state->scopeChannel.load(), kNumSamples, 1);
            DrawWaveformFromScope(g, reader, state->color.Load(), -1.1f, 1.1f, true, bounds);
        }
    }

private:
    static constexpr std::size_t kNumSamples = 1024;
    std::vector<VcoUIState*> uiStates_;
};

} // namespace synth_juce
