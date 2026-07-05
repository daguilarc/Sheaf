#pragma once

#include "FourteenSegmentDisplayComponent.hpp"
#include "PortableJuceBackend.hpp"
#include "../apps/miniapp/MiniAppDraw.hpp"
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

class EncoderComponent final : public juce::Component {
public:
    EncoderComponent() {
        setSize(defaultPadSize_, defaultPadSize_);
        addAndMakeVisible(segmentDisplay_);
        segmentDisplay_.SetNumChars(4);
        segmentDisplay_.SetOffColor(juce::Colour(36, 40, 42));
        segmentDisplay_.SetSegmentThickness(0.085f);
        segmentDisplay_.setVisible(false);
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
        return synth_miniapp::EncoderGeometry::ValueToArcAngle(value);
    }

    static float ValueToIndicatorAngle(float value) {
        return synth_miniapp::EncoderGeometry::ValueToIndicatorAngle(value);
    }

    static juce::Point<float> IndicatorPoint(float centerX, float centerY, float radius, float value) {
        const synth::ui::Point point = synth_miniapp::EncoderGeometry::IndicatorPoint(centerX, centerY, radius, value);
        return {point.x, point.y};
    }

    static float NormalizeForDisplay(float value, bool bipolar) {
        return synth_miniapp::EncoderGeometry::NormalizeForDisplay(value, bipolar);
    }

    static float IndicatorDotRadius(float radius) {
        return synth_miniapp::EncoderGeometry::IndicatorDotRadius(radius);
    }

    static float MotionBlurAmount(float displaySpread) {
        return synth_miniapp::EncoderGeometry::MotionBlurAmount(displaySpread);
    }

    static float MotionBlurArcHalfValue(float radius, float displaySpread) {
        return synth_miniapp::EncoderGeometry::MotionBlurArcHalfValue(radius, displaySpread);
    }

    static float MotionBlurOutlineAlpha(float motionAmount) {
        return synth_miniapp::EncoderGeometry::MotionBlurOutlineAlpha(motionAmount);
    }

    using MotionIndicatorGeometry = synth_miniapp::EncoderGeometry::MotionIndicatorGeometry;

    static MotionIndicatorGeometry MotionIndicatorGeometryFor(float radius, float value, float displaySpread) {
        return synth_miniapp::EncoderGeometry::MotionIndicatorGeometryFor(radius, value, displaySpread);
    }

    static void GetSwitchValueRange(std::size_t switchVal, std::size_t switchValues, float& startValue, float& endValue) {
        synth_miniapp::EncoderGeometry::GetSwitchValueRange(switchVal, switchValues, startValue, endValue);
    }

    void paint(juce::Graphics& g) override {
        const Snapshot snapshot = LoadSnapshot();
        if (!snapshot.connected) {
            return;
        }

        synth_miniapp::EncoderDrawState drawState = SnapshotToDrawState(snapshot);
        const juce::Rectangle<float> nodeBounds = getLocalBounds().toFloat();
        const std::vector<synth::ui::DrawCommand> commands =
            synth_miniapp::BuildEncoderDrawCommands(drawState, JuceToUiBounds(nodeBounds));
        for (const synth::ui::DrawCommand& command : commands) {
            PaintDrawCommand(g, command, nodeBounds);
        }
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

    synth_miniapp::EncoderDrawState SnapshotToDrawState(const Snapshot& snapshot) const {
        synth_miniapp::EncoderDrawState drawState;
        drawState.connected = snapshot.connected;
        drawState.bipolar = snapshot.bipolar;
        drawState.switchValues = snapshot.switchValues;
        drawState.modulatorsAffectingMask = snapshot.modulatorsAffectingMask;
        drawState.gesturesAffectingMask = snapshot.gesturesAffectingMask;
        drawState.color = snapshot.color;
        if (snapshot.shortName != nullptr) {
            drawState.shortLabel = snapshot.shortName;
        }
        drawState.voiceCount = snapshot.voiceCount;
        drawState.modulatorColors = modulatorColors_;
        drawState.gestureColors = gestureColors_;
        drawState.voices.resize(snapshot.voiceCount);
        for (std::size_t voiceIx = 0; voiceIx < snapshot.voiceCount; ++voiceIx) {
            synth_miniapp::EncoderVoiceDrawState& voice = drawState.voices[voiceIx];
            voice.value = snapshot.values[voiceIx];
            voice.spreadValue = snapshot.spreadValues[voiceIx];
            voice.minValue = snapshot.minValues[voiceIx];
            voice.maxValue = snapshot.maxValues[voiceIx];
            voice.switchValue = snapshot.switchValuesByVoice[voiceIx];
            voice.indicatorColor = snapshot.indicatorColors[voiceIx];
        }
        return drawState;
    }

    void UpdateDisplayFromState() {
        repaint();
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
