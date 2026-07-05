#pragma once

#include "PortableJuceBackend.hpp"
#include "../apps/miniapp/MiniAppDraw.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace synth_juce {

class FourteenSegmentDisplayComponent final : public juce::Component {
public:
    enum class Segment {
        A = 0,
        B = 1,
        C = 2,
        D = 3,
        E = 4,
        F = 5,
        G1 = 6,
        G2 = 7,
        H = 8,
        J = 9,
        K = 10,
        L = 11,
        M = 12,
        N = 13,
        DP = 14,
    };

    void SetNumChars(int numChars) {
        numChars_ = numChars;
        repaint();
    }

    void SetText(const juce::String& text) {
        text_ = text;
        repaint();
    }

    void SetOnColor(juce::Colour color) {
        onColor_ = color;
        repaint();
    }

    void SetOffColor(juce::Colour color) {
        offColor_ = color;
        repaint();
    }

    void SetSegmentThickness(float thickness) {
        segmentThickness_ = thickness;
        repaint();
    }

    void SetSegmentGap(float gap) {
        segmentGap_ = gap;
        repaint();
    }

    static std::uint16_t GetSegmentMask(char c) {
        return synth_miniapp::FourteenSegment::GetSegmentMask(c);
    }

    void paint(juce::Graphics& g) override {
        const juce::Rectangle<float> nodeBounds = getLocalBounds().toFloat();
        const std::vector<synth::ui::DrawCommand> commands = synth_miniapp::BuildFourteenSegmentCommands(
            text_.toStdString(),
            JuceToUiBounds(nodeBounds),
            synth::ui::Color::Rgba(onColor_.getRed(), onColor_.getGreen(), onColor_.getBlue(), onColor_.getAlpha()),
            synth::ui::Color::Rgba(offColor_.getRed(), offColor_.getGreen(), offColor_.getBlue(), offColor_.getAlpha()),
            numChars_ > 0 ? numChars_ : static_cast<int>(text_.length()),
            segmentThickness_,
            segmentGap_);
        for (const synth::ui::DrawCommand& command : commands) {
            PaintDrawCommand(g, command, nodeBounds);
        }
    }

private:
    juce::String text_;
    juce::Colour onColor_ = juce::Colours::red;
    juce::Colour offColor_ = juce::Colour(40, 10, 10);
    float segmentThickness_ = 0.08f;
    float segmentGap_ = 0.02f;
    int numChars_ = 0;
};

} // namespace synth_juce
