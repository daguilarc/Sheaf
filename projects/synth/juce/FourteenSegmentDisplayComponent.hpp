#pragma once

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
        if (c < 32 || c > 127) {
            return 0x0000;
        }
        return asciiTable_[static_cast<std::size_t>(c - 32)];
    }

    void paint(juce::Graphics& g) override {
        auto bounds = getLocalBounds().toFloat();
        int numChars = numChars_ > 0 ? numChars_ : static_cast<int>(text_.length());
        if (numChars == 0) {
            numChars = 1;
        }

        const float charWidth = bounds.getWidth() / static_cast<float>(numChars);
        for (int i = 0; i < numChars; ++i) {
            const char c = i < text_.length() ? static_cast<char>(text_[i]) : ' ';
            const std::uint16_t mask = GetSegmentMask(c);
            DrawCharacter(g, juce::Rectangle<float>(bounds.getX() + i * charWidth,
                                                    bounds.getY(),
                                                    charWidth,
                                                    bounds.getHeight()),
                          mask);
        }
    }

private:
    static bool IsSegmentOn(std::uint16_t mask, Segment segment) {
        return (mask & (1u << static_cast<int>(segment))) != 0;
    }

    void DrawCharacter(juce::Graphics& g, juce::Rectangle<float> bounds, std::uint16_t mask) {
        const float padding = bounds.getWidth() * 0.05f;
        bounds = bounds.reduced(padding);

        const float w = bounds.getWidth();
        const float h = bounds.getHeight();
        const float x = bounds.getX();
        const float y = bounds.getY();
        const float thickness = w * segmentThickness_;
        const float gap = w * segmentGap_;
        const float halfH = h / 2.0f;

        const float horzLeft = x + thickness + gap;
        const float horzRight = x + w - thickness - gap;
        const float horzMid = x + w / 2.0f;
        const float horzLen = (horzRight - horzLeft - gap) / 2.0f;

        const float vertTop = y + thickness + gap;
        const float vertMid = y + halfH;
        const float vertBottom = y + h - thickness - gap;

        DrawHorizontalSegment(g, horzLeft, y, horzRight - horzLeft, thickness, IsSegmentOn(mask, Segment::A));
        DrawHorizontalSegment(g, horzLeft, y + h - thickness, horzRight - horzLeft, thickness,
                              IsSegmentOn(mask, Segment::D));
        DrawHorizontalSegment(g, horzLeft, vertMid - thickness / 2.0f, horzLen, thickness,
                              IsSegmentOn(mask, Segment::G1));
        DrawHorizontalSegment(g, horzMid + gap / 2.0f, vertMid - thickness / 2.0f, horzLen, thickness,
                              IsSegmentOn(mask, Segment::G2));

        DrawVerticalSegment(g, x, vertTop, thickness, vertMid - vertTop - gap, IsSegmentOn(mask, Segment::F));
        DrawVerticalSegment(g, x, vertMid + gap, thickness, vertBottom - vertMid - gap, IsSegmentOn(mask, Segment::E));
        DrawVerticalSegment(g, x + w - thickness, vertTop, thickness, vertMid - vertTop - gap,
                            IsSegmentOn(mask, Segment::B));
        DrawVerticalSegment(g, x + w - thickness, vertMid + gap, thickness, vertBottom - vertMid - gap,
                            IsSegmentOn(mask, Segment::C));
        DrawVerticalSegment(g, horzMid - thickness / 2.0f, vertTop, thickness, vertMid - vertTop - gap,
                            IsSegmentOn(mask, Segment::J));
        DrawVerticalSegment(g, horzMid - thickness / 2.0f, vertMid + gap, thickness, vertBottom - vertMid - gap,
                            IsSegmentOn(mask, Segment::M));

        const float diagInnerX = horzMid - thickness / 2.0f;
        const float diagOuterLeft = x + thickness + gap;
        const float diagOuterRight = x + w - thickness - gap;

        DrawDiagonalSegment(g, diagOuterLeft, vertTop, diagInnerX - gap, vertMid - gap, thickness,
                            IsSegmentOn(mask, Segment::H));
        DrawDiagonalSegment(g, diagOuterRight, vertTop, diagInnerX + thickness + gap, vertMid - gap, thickness,
                            IsSegmentOn(mask, Segment::K));
        DrawDiagonalSegment(g, diagInnerX - gap, vertMid + gap, diagOuterLeft, vertBottom, thickness,
                            IsSegmentOn(mask, Segment::L));
        DrawDiagonalSegment(g, diagInnerX + thickness + gap, vertMid + gap, diagOuterRight, vertBottom, thickness,
                            IsSegmentOn(mask, Segment::N));

        const float dpSize = thickness * 1.2f;
        g.setColour(IsSegmentOn(mask, Segment::DP) ? onColor_ : offColor_);
        g.fillEllipse(x + w + gap, y + h - dpSize, dpSize, dpSize);
    }

    void DrawHorizontalSegment(juce::Graphics& g, float x, float y, float width, float height, bool on) const {
        juce::Path path;
        const float halfH = height / 2.0f;
        path.startNewSubPath(x + halfH, y);
        path.lineTo(x + width - halfH, y);
        path.lineTo(x + width, y + halfH);
        path.lineTo(x + width - halfH, y + height);
        path.lineTo(x + halfH, y + height);
        path.lineTo(x, y + halfH);
        path.closeSubPath();
        g.setColour(on ? onColor_ : offColor_);
        g.fillPath(path);
    }

    void DrawVerticalSegment(juce::Graphics& g, float x, float y, float width, float height, bool on) const {
        juce::Path path;
        const float halfW = width / 2.0f;
        path.startNewSubPath(x + halfW, y);
        path.lineTo(x + width, y + halfW);
        path.lineTo(x + width, y + height - halfW);
        path.lineTo(x + halfW, y + height);
        path.lineTo(x, y + height - halfW);
        path.lineTo(x, y + halfW);
        path.closeSubPath();
        g.setColour(on ? onColor_ : offColor_);
        g.fillPath(path);
    }

    void DrawDiagonalSegment(juce::Graphics& g, float x1, float y1, float x2, float y2, float thickness, bool on) const {
        const float dx = x2 - x1;
        const float dy = y2 - y1;
        const float len = std::sqrt(dx * dx + dy * dy);
        if (len < 0.001f) {
            return;
        }

        const float nx = -dy / len * thickness / 2.0f;
        const float ny = dx / len * thickness / 2.0f;

        juce::Path path;
        path.startNewSubPath(x1 + nx, y1 + ny);
        path.lineTo(x2 + nx, y2 + ny);
        path.lineTo(x2 - nx, y2 - ny);
        path.lineTo(x1 - nx, y1 - ny);
        path.closeSubPath();
        g.setColour(on ? onColor_ : offColor_);
        g.fillPath(path);
    }

    static constexpr std::uint16_t asciiTable_[96] = {
        0x0000, 0x4006, 0x0202, 0x12CE, 0x12ED, 0x3FE4, 0x2359, 0x0200, 0x2400, 0x0900, 0x3FC0, 0x12C0,
        0x0800, 0x00C0, 0x4000, 0x0C00, 0x0C3F, 0x0406, 0x00DB, 0x008F, 0x00E6, 0x2069, 0x00FD, 0x0007,
        0x00FF, 0x00EF, 0x1200, 0x0A00, 0x2440, 0x00C8, 0x0980, 0x5083, 0x02BB, 0x00F7, 0x128F, 0x0039,
        0x120F, 0x0079, 0x0071, 0x00BD, 0x00F6, 0x1209, 0x001E, 0x2470, 0x0038, 0x0536, 0x2136, 0x003F,
        0x00F3, 0x203F, 0x20F3, 0x00ED, 0x1201, 0x003E, 0x0C30, 0x2836, 0x2D00, 0x00EE, 0x0C09, 0x0039,
        0x2100, 0x000F, 0x2800, 0x0008, 0x0100, 0x1058, 0x2078, 0x00D8, 0x088E, 0x0858, 0x14C0, 0x048E,
        0x1070, 0x1000, 0x0A10, 0x3600, 0x0030, 0x10D4, 0x1050, 0x00DC, 0x0170, 0x0486, 0x0050, 0x2088,
        0x0078, 0x001C, 0x0810, 0x2814, 0x2D00, 0x028E, 0x0848, 0x0949, 0x1200, 0x2489, 0x0CC0, 0x0000,
    };

    juce::String text_;
    juce::Colour onColor_ = juce::Colours::red;
    juce::Colour offColor_ = juce::Colour(40, 10, 10);
    float segmentThickness_ = 0.08f;
    float segmentGap_ = 0.02f;
    int numChars_ = 0;
};

} // namespace synth_juce
