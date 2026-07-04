#pragma once

#include "FourteenSegmentDisplayComponent.hpp"
#include "synth/ParameterModulation.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <span>
#include <vector>

namespace synth_juce {

inline juce::Colour ToJuce(synth::Color color) {
    return juce::Colour(color.r, color.g, color.b, color.a);
}

class EncoderComponent final : public juce::Component {
public:
    EncoderComponent() {
        setSize(defaultPadSize_, defaultPadSize_);
        addAndMakeVisible(segmentDisplay_);
        segmentDisplay_.SetNumChars(4);
        segmentDisplay_.SetOffColor(juce::Colour(36, 40, 42));
        segmentDisplay_.SetSegmentThickness(0.085f);
    }

    void Bind(const synth::Parameter::UIState* state) {
        state_ = state;
        UpdateDisplayFromState();
        repaint();
    }

    void BindMessages(synth::MessageInBus* bus, std::size_t slotIx, std::size_t position) {
        bus_ = bus;
        slotIx_ = slotIx;
        position_ = position;
    }

    void SetPosition(std::size_t slotIx, std::size_t position) {
        slotIx_ = slotIx;
        position_ = position;
    }

    void SetMessageBus(synth::MessageInBus* bus) {
        bus_ = bus;
    }

    void SetTimestampBase(std::uint64_t timestampBase) {
        nextTimestamp_ = timestampBase;
    }

    void SetTimestampProvider(std::function<std::uint64_t()> provider) {
        timestampProvider_ = std::move(provider);
    }

    void SetInteractionSensitivity(float sensitivity) {
        dragSensitivity_ = sensitivity;
    }

    void SetModulatorColors(std::span<const synth::Color> colors) {
        modulatorColors_.assign(colors.begin(), colors.end());
        repaint();
    }

    void SetModulatorColors(std::initializer_list<synth::Color> colors) {
        modulatorColors_.assign(colors.begin(), colors.end());
        repaint();
    }

    void SetGestureColors(std::span<const synth::Color> colors) {
        gestureColors_.assign(colors.begin(), colors.end());
        repaint();
    }

    void SetGestureColors(std::initializer_list<synth::Color> colors) {
        gestureColors_.assign(colors.begin(), colors.end());
        repaint();
    }

    static float ValueToArcAngle(float value) {
        return juce::MathConstants<float>::pi * 1.25f + value * juce::MathConstants<float>::pi * 1.5f;
    }

    static float ValueToIndicatorAngle(float value) {
        return juce::MathConstants<float>::pi * 0.75f + value * juce::MathConstants<float>::pi * 1.5f;
    }

    static juce::Point<float> IndicatorPoint(float centerX, float centerY, float radius, float value) {
        const float angle = ValueToIndicatorAngle(value);
        return {
            centerX + radius * std::cos(angle),
            centerY + radius * std::sin(angle),
        };
    }

    static float NormalizeForDisplay(float value, bool bipolar) {
        const float normalized = bipolar ? (value + 1.0f) * 0.5f : value;
        return juce::jlimit(0.0f, 1.0f, normalized);
    }

    static float IndicatorDotRadius(float radius) {
        return juce::jlimit(3.0f, 8.0f, radius * 0.11f);
    }

    static float MotionBlurAmount(float displaySpread) {
        constexpr float fullBlurSpread = 0.20f;
        return juce::jlimit(0.0f, 1.0f, std::max(0.0f, displaySpread) / fullBlurSpread);
    }

    static float MotionBlurArcHalfValue(float radius, float displaySpread) {
        constexpr float fullArcRadians = juce::MathConstants<float>::pi * 1.5f;
        constexpr float probableSigma = 2.0f;
        constexpr float collapsedHalfWidth = 0.35f;
        const float collapsedHalfValue = collapsedHalfWidth / (radius * fullArcRadians);
        return collapsedHalfValue + std::max(0.0f, displaySpread) * probableSigma;
    }

    static float MotionBlurOutlineAlpha(float motionAmount) {
        const float motion = juce::jlimit(0.0f, 1.0f, motionAmount);
        return 0.55f * (1.0f - 0.95f * motion * motion);
    }

    struct MotionIndicatorGeometry {
        float centerAngle = 0.0f;
        float arcHalfValue = 0.0f;
        float startValue = 0.0f;
        float endValue = 0.0f;
        float outlineAlpha = 0.0f;
        float outlineStrokeWidth = 0.0f;
        float outerStrokeWidth = 0.0f;
        float outerAlpha = 0.0f;
        float midStrokeWidth = 0.0f;
        float midAlpha = 0.0f;
        float coreStrokeWidth = 0.0f;
        float coreAlpha = 0.0f;
    };

    static MotionIndicatorGeometry MotionIndicatorGeometryFor(float radius, float value, float displaySpread) {
        const float normalizedValue = juce::jlimit(0.0f, 1.0f, value);
        const float dotRadius = IndicatorDotRadius(radius);
        const float clampedDisplaySpread = std::max(0.0f, displaySpread);
        const float motion = MotionBlurAmount(clampedDisplaySpread);
        const float radialMotion = motion * motion;
        const float halfValue = MotionBlurArcHalfValue(radius, clampedDisplaySpread);

        MotionIndicatorGeometry geometry;
        geometry.centerAngle = ValueToArcAngle(normalizedValue);
        geometry.arcHalfValue = halfValue;
        geometry.startValue = juce::jlimit(0.0f, 1.0f, normalizedValue - halfValue);
        geometry.endValue = juce::jlimit(0.0f, 1.0f, normalizedValue + halfValue);
        geometry.outlineAlpha = MotionBlurOutlineAlpha(motion);
        geometry.outerStrokeWidth = dotRadius * 2.0f + radialMotion * radius * 0.30f;
        geometry.midStrokeWidth = dotRadius * 1.35f + radialMotion * radius * 0.18f;
        geometry.coreStrokeWidth =
            std::max(dotRadius * 0.95f, dotRadius * (2.0f - motion * 0.85f) + radialMotion * radius * 0.05f);
        geometry.outlineStrokeWidth =
            geometry.coreStrokeWidth + 1.0f + motion * std::max(0.0f, geometry.outerStrokeWidth - geometry.coreStrokeWidth);
        geometry.outerAlpha = motion * (0.10f + motion * 0.08f);
        geometry.midAlpha = motion * (0.24f + motion * 0.16f);
        geometry.coreAlpha = 0.96f - motion * 0.08f;
        return geometry;
    }

    static void GetSwitchValueRange(std::size_t switchVal, std::size_t switchValues, float& startValue, float& endValue) {
        if (switchValues <= 1) {
            startValue = 0.0f;
            endValue = 1.0f;
            return;
        }

        const float denominator = static_cast<float>(switchValues - 1);
        startValue = switchVal == 0 ? 0.0f : (static_cast<float>(switchVal) - 0.5f) / denominator;
        endValue = switchVal == switchValues - 1 ? 1.0f : (static_cast<float>(switchVal) + 0.5f) / denominator;
    }

    static void DrawArc(juce::Graphics& g,
                        float centerX,
                        float centerY,
                        float radius,
                        float startValue,
                        float endValue,
                        float strokeWidth) {
        juce::Path arcPath;
        arcPath.addCentredArc(centerX, centerY, radius, radius, 0.0f, ValueToArcAngle(startValue), ValueToArcAngle(endValue),
                              true);
        g.strokePath(arcPath, juce::PathStrokeType(strokeWidth, juce::PathStrokeType::curved,
                                                   juce::PathStrokeType::rounded));
    }

    static void DrawArcWithSwitchGaps(juce::Graphics& g,
                                      float centerX,
                                      float centerY,
                                      float radius,
                                      float startValue,
                                      float endValue,
                                      std::size_t switchValues,
                                      float strokeWidth) {
        startValue = juce::jlimit(0.0f, 1.0f, startValue);
        endValue = juce::jlimit(0.0f, 1.0f, endValue);
        if (endValue < startValue) {
            std::swap(startValue, endValue);
        }

        if (switchValues <= 1) {
            DrawArc(g, centerX, centerY, radius, startValue, endValue, strokeWidth);
            return;
        }

        constexpr float switchGapRadians = juce::MathConstants<float>::pi / 90.0f;
        for (std::size_t switchVal = 0; switchVal < switchValues; ++switchVal) {
            float switchStart = 0.0f;
            float switchEnd = 1.0f;
            GetSwitchValueRange(switchVal, switchValues, switchStart, switchEnd);

            const float segmentStart = std::max(startValue, switchStart);
            const float segmentEnd = std::min(endValue, switchEnd);
            if (segmentEnd <= segmentStart) {
                continue;
            }

            float startAngle = ValueToArcAngle(segmentStart);
            float endAngle = ValueToArcAngle(segmentEnd);
            if (switchVal > 0 && segmentStart <= switchStart) {
                startAngle += switchGapRadians;
            }
            if (switchVal + 1 < switchValues && segmentEnd >= switchEnd) {
                endAngle -= switchGapRadians;
            }
            if (endAngle <= startAngle) {
                continue;
            }

            juce::Path arcPath;
            arcPath.addCentredArc(centerX, centerY, radius, radius, 0.0f, startAngle, endAngle, true);
            g.strokePath(arcPath, juce::PathStrokeType(strokeWidth, juce::PathStrokeType::curved,
                                                       juce::PathStrokeType::rounded));
        }
    }

    void paint(juce::Graphics& g) override {
        const auto rawBounds = getLocalBounds().toFloat();
        const auto bounds = rawBounds.reduced(4.0f);
        const float centerX = bounds.getCentreX();
        const float centerY = bounds.getCentreY() - bounds.getHeight() * 0.03f;
        const float baseRadius = juce::jmin(bounds.getWidth(), bounds.getHeight()) * 0.43f;

        const auto snapshot = LoadSnapshot();
        if (!snapshot.connected) {
            return;
        }
        const auto cellColor = snapshot.connected ? ToJuce(snapshot.color) : juce::Colour(56, 60, 62);

        DrawBackground(g, bounds, centerX, centerY, baseRadius, cellColor, snapshot.connected);

        if (snapshot.connected) {
            DrawBadges(g, centerX, centerY, baseRadius * 0.72f, snapshot.modulatorsAffectingMask,
                       snapshot.gesturesAffectingMask);
            DrawVoiceRings(g, centerX, centerY, baseRadius, snapshot);
            DrawVoiceRanges(g, centerX, centerY, baseRadius, snapshot);
            DrawVoiceIndicators(g, centerX, centerY, baseRadius, snapshot);
        }

        (void)rawBounds;
    }

    void resized() override {
        const auto bounds = getLocalBounds().toFloat().reduced(4.0f);
        const float baseRadius = juce::jmin(bounds.getWidth(), bounds.getHeight()) * 0.43f;
        const float displayHeight = juce::jlimit(14.0f, 24.0f, baseRadius * 0.34f);
        const float displayWidth = displayHeight * 3.3f;
        segmentDisplay_.setBounds(juce::Rectangle<float>(bounds.getCentreX() - displayWidth / 2.0f,
                                                         bounds.getCentreY() + baseRadius * 0.54f,
                                                         displayWidth,
                                                         displayHeight)
                                      .toNearestInt());
    }

    void mouseDown(const juce::MouseEvent& event) override {
        lastMousePosition_ = event.position;
    }

    void mouseDrag(const juce::MouseEvent& event) override {
        if (bus_ == nullptr) {
            return;
        }

        const auto deltaPoint = event.position - lastMousePosition_;
        const float delta = (deltaPoint.x - deltaPoint.y) * dragSensitivity_;
        if (std::abs(delta) < dragThreshold_) {
            return;
        }

        bus_->Push(synth::MessageIn::ParamIncDec(NextTimestamp(event), slotIx_, position_, delta));
        lastMousePosition_ = event.position;
    }

    void mouseDoubleClick(const juce::MouseEvent& event) override {
        if (bus_ != nullptr) {
            bus_->Push(synth::MessageIn::ParamPush(NextTimestamp(event), slotIx_, position_));
        }
    }

private:
    struct Snapshot {
        bool connected = false;
        bool bipolar = false;
        std::size_t switchValues = 0;
        std::uint32_t modulatorsAffectingMask = 0;
        std::uint32_t gesturesAffectingMask = 0;
        synth::Color color = synth::Color::Off;
        const char* shortName = nullptr;
        std::size_t voiceCount = 0;
        std::vector<float> values;
        std::vector<float> spreadValues;
        std::vector<float> minValues;
        std::vector<float> maxValues;
        std::vector<std::size_t> switchValuesByVoice;
        std::vector<synth::Color> indicatorColors;
    };

    Snapshot LoadSnapshot() const {
        Snapshot snapshot;
        if (state_ == nullptr) {
            return snapshot;
        }

        for (int attempt = 0; attempt < 4; ++attempt) {
            const std::uint32_t startRevision = state_->revision.load(std::memory_order_acquire);
            if ((startRevision & 1u) != 0) {
                continue;
            }

            snapshot = LoadSnapshotPayload();
            const std::uint32_t endRevision = state_->revision.load(std::memory_order_acquire);
            if (startRevision == endRevision && (endRevision & 1u) == 0) {
                return snapshot;
            }
        }

        return {};
    }

    Snapshot LoadSnapshotPayload() const {
        Snapshot snapshot;
        snapshot.connected = state_->connected.load(std::memory_order_relaxed);
        snapshot.bipolar = state_->bipolar.load(std::memory_order_relaxed);
        snapshot.switchValues = state_->switchValues.load(std::memory_order_relaxed);
        snapshot.modulatorsAffectingMask = state_->modulatorsAffectingMask.load(std::memory_order_relaxed);
        snapshot.gesturesAffectingMask = state_->gesturesAffectingMask.load(std::memory_order_relaxed);
        snapshot.color = state_->color.Load(std::memory_order_relaxed);
        snapshot.shortName = state_->shortName.load(std::memory_order_relaxed);
        snapshot.voiceCount = std::min(state_->voiceCount.load(std::memory_order_relaxed), state_->voiceCapacity);

        snapshot.values.resize(snapshot.voiceCount, 0.0f);
        snapshot.spreadValues.resize(snapshot.voiceCount, 0.0f);
        snapshot.minValues.resize(snapshot.voiceCount, 0.0f);
        snapshot.maxValues.resize(snapshot.voiceCount, snapshot.bipolar ? 1.0f : 0.0f);
        snapshot.switchValuesByVoice.resize(snapshot.voiceCount, 0);
        snapshot.indicatorColors.resize(snapshot.voiceCount, synth::Color::Grey);

        for (std::size_t voiceIx = 0; voiceIx < snapshot.voiceCount; ++voiceIx) {
            snapshot.values[voiceIx] = state_->values[voiceIx].load(std::memory_order_relaxed);
            snapshot.spreadValues[voiceIx] = state_->spreadValues[voiceIx].load(std::memory_order_relaxed);
            snapshot.minValues[voiceIx] = state_->minValues[voiceIx].load(std::memory_order_relaxed);
            snapshot.maxValues[voiceIx] = state_->maxValues[voiceIx].load(std::memory_order_relaxed);
            snapshot.switchValuesByVoice[voiceIx] = state_->switchValue[voiceIx].load(std::memory_order_relaxed);
            snapshot.indicatorColors[voiceIx] = state_->indicatorColors[voiceIx].Load(std::memory_order_relaxed);
        }

        return snapshot;
    }

    static std::size_t CountMaskBits(std::uint32_t mask) {
        std::size_t count = 0;
        while (mask != 0) {
            count += mask & 1u;
            mask >>= 1u;
        }
        return count;
    }

    static juce::String BadgeText(bool modulator, std::size_t index) {
        if (modulator) {
            return "M" + juce::String(static_cast<int>(index + 1));
        }
        if (index < 8) {
            return juce::String(static_cast<int>(index + 1));
        }
        static constexpr const char* symbols[] = {"U", "R", "D", "L", "UU", "RR", "DD", "LL"};
        return symbols[std::min<std::size_t>(index - 8, 7)];
    }

    static void GetBadgePosition(float centerX,
                                 float centerY,
                                 float radius,
                                 std::size_t ix,
                                 std::size_t total,
                                 bool upper,
                                 float& badgeX,
                                 float& badgeY,
                                 float& badgeLength) {
        if (total <= 8) {
            badgeLength = 1.0f / std::sqrt(1.0f + static_cast<float>(total * total) / 4.0f);
            badgeX = -badgeLength * static_cast<float>(total) / 2.0f + static_cast<float>(ix) * badgeLength;
            badgeY = badgeLength;
        } else {
            badgeLength = 1.0f / (2.0f * std::sqrt(5.0f));
            badgeX = -4.0f / (2.0f * std::sqrt(5.0f)) + static_cast<float>(ix % 8) * badgeLength;
            badgeY = 2.0f / (2.0f * std::sqrt(5.0f)) - static_cast<float>(ix / 8) * badgeLength;
        }

        badgeX = centerX + radius * badgeX;
        badgeLength = radius * badgeLength;
        badgeY = upper ? centerY - radius * badgeY : centerY + radius * badgeY - badgeLength;
    }

    void DrawBackground(juce::Graphics& g,
                        juce::Rectangle<float> bounds,
                        float centerX,
                        float centerY,
                        float baseRadius,
                        juce::Colour color,
                        bool connected) const {
        juce::Rectangle<float> body(centerX - baseRadius * 1.08f, centerY - baseRadius * 1.08f, baseRadius * 2.16f,
                                    baseRadius * 2.16f);
        g.setColour(juce::Colour(18, 20, 22));
        g.fillEllipse(body);
        g.setColour(connected ? color.withAlpha(0.28f) : juce::Colour(42, 44, 46));
        g.fillEllipse(body.reduced(baseRadius * 0.07f));

        g.setColour(connected ? color.withAlpha(0.9f) : juce::Colour(84, 88, 90));
        g.drawEllipse(body, connected ? 1.5f : 1.0f);
        g.setColour(juce::Colour(8, 9, 10));
        g.drawRoundedRectangle(bounds.reduced(1.0f), 6.0f, 1.0f);
    }

    void DrawBadges(juce::Graphics& g,
                    float centerX,
                    float centerY,
                    float radius,
                    std::uint32_t modMask,
                    std::uint32_t gestureMask) const {
        const auto drawOneSet = [&](std::uint32_t mask, bool upper, bool modulator) {
            const std::size_t total = CountMaskBits(mask);
            std::size_t badgeIndex = 0;
            for (std::size_t bit = 0; bit < 32 && badgeIndex < total; ++bit) {
                if ((mask & (1u << bit)) == 0) {
                    continue;
                }

                float x = 0.0f;
                float y = 0.0f;
                float length = 0.0f;
                GetBadgePosition(centerX, centerY, radius, badgeIndex, total, upper, x, y, length);
                const auto color = modulator ? ColorForIndex(modulatorColors_, bit, synth::Color::Cyan)
                                             : ColorForIndex(gestureColors_, bit, synth::Color::Orange);
                DrawBadge(g, x, y, length, ToJuce(color), BadgeText(modulator, bit));
                ++badgeIndex;
            }
        };

        drawOneSet(modMask, true, true);
        drawOneSet(gestureMask, false, false);
    }

    static synth::Color ColorForIndex(const std::vector<synth::Color>& colors, std::size_t index, synth::Color fallback) {
        if (index < colors.size()) {
            return colors[index];
        }
        return fallback.AdjustBrightness(0.75f + static_cast<float>((index % 3)) * 0.18f);
    }

    static void DrawBadge(juce::Graphics& g, float x, float y, float length, juce::Colour color, const juce::String& text) {
        juce::Rectangle<float> rect(x, y, length, length);
        const float corner = length * 0.1f;
        g.setColour(juce::Colour(32, 34, 36));
        g.fillRoundedRectangle(rect, corner);
        g.setColour(color.withAlpha(0.9f));
        g.fillRoundedRectangle(rect.reduced(length * 0.07f), corner);
        g.setColour(juce::Colours::black.withAlpha(0.55f));
        g.drawRoundedRectangle(rect, corner, 1.0f);
        g.setColour(juce::Colours::white);
        g.setFont(length * 0.36f);
        g.drawFittedText(text, rect.toNearestInt().reduced(1), juce::Justification::centred, 1);
    }

    void DrawVoiceRings(juce::Graphics& g, float centerX, float centerY, float baseRadius, const Snapshot& snapshot) const {
        for (std::size_t voiceIx = 0; voiceIx < snapshot.voiceCount; ++voiceIx) {
            const float radius = baseRadius - static_cast<float>(voiceIx) * baseRadius * 0.12f;
            g.setColour(juce::Colours::white.withAlpha(0.24f));
            DrawArcWithSwitchGaps(g, centerX, centerY, radius, 0.0f, 1.0f, snapshot.switchValues, 2.0f);
        }
    }

    void DrawVoiceRanges(juce::Graphics& g, float centerX, float centerY, float baseRadius, const Snapshot& snapshot) const {
        for (std::size_t voiceIx = 0; voiceIx < snapshot.voiceCount; ++voiceIx) {
            const float radius = baseRadius - static_cast<float>(voiceIx) * baseRadius * 0.12f;
            const float minValue = NormalizeForDisplay(snapshot.minValues[voiceIx], snapshot.bipolar);
            const float maxValue = NormalizeForDisplay(snapshot.maxValues[voiceIx], snapshot.bipolar);
            const auto indicatorColor = ToJuce(snapshot.indicatorColors[voiceIx]);
            g.setColour(indicatorColor.withAlpha(0.74f));
            DrawArcWithSwitchGaps(g, centerX, centerY, radius, minValue, maxValue, snapshot.switchValues, 3.2f);
        }
    }

    void DrawVoiceIndicators(juce::Graphics& g, float centerX, float centerY, float baseRadius, const Snapshot& snapshot) const {
        for (std::size_t voiceIx = 0; voiceIx < snapshot.voiceCount; ++voiceIx) {
            const float radius = baseRadius - static_cast<float>(voiceIx) * baseRadius * 0.12f;
            const float value = NormalizeForDisplay(snapshot.values[voiceIx], snapshot.bipolar);
            const auto indicatorColor = ToJuce(snapshot.indicatorColors[voiceIx]);

            if (snapshot.switchValues > 1) {
                float startValue = 0.0f;
                float endValue = 1.0f;
                GetSwitchValueRange(std::min(snapshot.switchValuesByVoice[voiceIx], snapshot.switchValues - 1),
                                    snapshot.switchValues, startValue, endValue);
                g.setColour(indicatorColor.brighter(0.35f));
                DrawArcWithSwitchGaps(g, centerX, centerY, radius, startValue, endValue, snapshot.switchValues, 4.4f);
            } else {
                const float displaySpread = snapshot.bipolar ? snapshot.spreadValues[voiceIx] * 0.5f
                                                             : snapshot.spreadValues[voiceIx];
                DrawMotionIndicator(g, centerX, centerY, radius, value, displaySpread, indicatorColor);
            }
        }
    }

    void DrawMotionIndicator(juce::Graphics& g,
                             float centerX,
                             float centerY,
                             float radius,
                             float value,
                             float displaySpread,
                             juce::Colour indicatorColor) const {
        const MotionIndicatorGeometry geometry = MotionIndicatorGeometryFor(radius, value, displaySpread);
        g.setColour(juce::Colours::black.withAlpha(geometry.outlineAlpha));
        DrawArc(g, centerX, centerY, radius, geometry.startValue, geometry.endValue, geometry.outlineStrokeWidth);
        g.setColour(indicatorColor.withAlpha(geometry.outerAlpha));
        DrawArc(g, centerX, centerY, radius, geometry.startValue, geometry.endValue, geometry.outerStrokeWidth);
        g.setColour(indicatorColor.withAlpha(geometry.midAlpha));
        DrawArc(g, centerX, centerY, radius, geometry.startValue, geometry.endValue, geometry.midStrokeWidth);
        g.setColour(indicatorColor.withAlpha(geometry.coreAlpha));
        DrawArc(g, centerX, centerY, radius, geometry.startValue, geometry.endValue, geometry.coreStrokeWidth);
    }

    void UpdateDisplayFromState() {
        const Snapshot snapshot = LoadSnapshot();
        const auto color = snapshot.connected ? ToJuce(snapshot.color) : juce::Colour(56, 60, 62);
        juce::String text;
        if (snapshot.connected && snapshot.shortName != nullptr) {
            text = juce::String(snapshot.shortName).substring(0, 4).toUpperCase();
        } else {
            text = "";
        }

        segmentDisplay_.SetText(text);
        segmentDisplay_.SetOnColor(snapshot.connected ? color.brighter(0.45f) : juce::Colour(92, 96, 98));
        segmentDisplay_.setVisible(snapshot.connected);
    }

    std::uint64_t NextTimestamp(const juce::MouseEvent& event) {
        (void)event;
        if (timestampProvider_ != nullptr) {
            return timestampProvider_();
        }
        return nextTimestamp_++;
    }

    static constexpr int defaultPadSize_ = 128;
    static constexpr float dragThreshold_ = 0.001f;

    const synth::Parameter::UIState* state_ = nullptr;
    synth::MessageInBus* bus_ = nullptr;
    std::size_t slotIx_ = 0;
    std::size_t position_ = 0;
    std::uint64_t nextTimestamp_ = 1;
    std::function<std::uint64_t()> timestampProvider_;
    float dragSensitivity_ = 0.0025f;
    juce::Point<float> lastMousePosition_;
    FourteenSegmentDisplayComponent segmentDisplay_;
    std::vector<synth::Color> modulatorColors_;
    std::vector<synth::Color> gestureColors_;
};

} // namespace synth_juce
