#include "EncoderComponent.hpp"
#include "MidiHandlers.hpp"
#include "PathDrawer.hpp"

#include "../apps/miniapp/MiniApp.hpp"

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void RequireNear(float actual, float expected, float tolerance, const char* label) {
    if (std::fabs(actual - expected) > tolerance) {
        throw std::runtime_error(std::string(label) + " expected " + std::to_string(expected) + " got " +
                                 std::to_string(actual));
    }
}

void RequireNear(double actual, double expected, double tolerance, const char* label) {
    if (std::fabs(actual - expected) > tolerance) {
        throw std::runtime_error(std::string(label) + " expected " + std::to_string(expected) + " got " +
                                 std::to_string(actual));
    }
}

void RequireTrue(bool condition, const char* label) {
    if (!condition) {
        throw std::runtime_error(std::string(label) + " expected true");
    }
}

void RequireRectangle(juce::Rectangle<int> actual, juce::Rectangle<int> expected, const char* label) {
    if (actual != expected) {
        throw std::runtime_error(std::string(label) + " expected x=" + std::to_string(expected.getX()) +
                                 " y=" + std::to_string(expected.getY()) +
                                 " w=" + std::to_string(expected.getWidth()) +
                                 " h=" + std::to_string(expected.getHeight()) + " got x=" +
                                 std::to_string(actual.getX()) + " y=" + std::to_string(actual.getY()) +
                                 " w=" + std::to_string(actual.getWidth()) +
                                 " h=" + std::to_string(actual.getHeight()));
    }
}

} // namespace

int main() {
    constexpr float pi = juce::MathConstants<float>::pi;
    constexpr float tolerance = 0.0001f;

    RequireNear(synth_juce::EncoderComponent::ValueToIndicatorAngle(0.0f), pi * 0.75f, tolerance,
                "indicator angle at zero");
    RequireNear(synth_juce::EncoderComponent::ValueToIndicatorAngle(0.5f), pi * 1.5f, tolerance,
                "indicator angle at half");
    RequireNear(synth_juce::EncoderComponent::ValueToIndicatorAngle(1.0f), pi * 2.25f, tolerance,
                "indicator angle at one");
    RequireNear(synth_juce::EncoderComponent::ValueToArcAngle(0.0f) -
                    synth_juce::EncoderComponent::ValueToIndicatorAngle(0.0f),
                pi * 0.5f, tolerance, "arc/indicator phase offset");
    RequireNear(synth_juce::EncoderComponent::MotionBlurAmount(0.0f), 0.0f, tolerance,
                "zero spread has no motion blur");
    RequireNear(synth_juce::EncoderComponent::MotionBlurAmount(1.0f), 1.0f, tolerance,
                "large spread clamps motion blur");
    RequireTrue(synth_juce::EncoderComponent::MotionBlurArcHalfValue(20.0f, 0.0f) < 0.01f,
                "resting blur arc half value stays dot-like");
    RequireTrue(synth_juce::EncoderComponent::MotionBlurArcHalfValue(40.0f, 0.5f) >
                    synth_juce::EncoderComponent::MotionBlurArcHalfValue(40.0f, 0.0f),
                "motion blur arc widens with motion");
    RequireTrue(synth_juce::EncoderComponent::MotionBlurArcHalfValue(40.0f, 0.75f) >
                    synth_juce::EncoderComponent::MotionBlurArcHalfValue(40.0f, 0.25f),
                "motion blur arc stays monotonic inside range");
    RequireNear(synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.0f), 0.55f, tolerance,
                "resting outline alpha matches existing dot");
    RequireTrue(synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.5f) <
                    synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.0f),
                "motion blur outline fades with motion");
    RequireTrue(synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.75f) <
                    synth_juce::EncoderComponent::MotionBlurOutlineAlpha(0.25f),
                "motion blur outline fade stays monotonic inside range");
    const auto restingBlur = synth_juce::EncoderComponent::MotionIndicatorGeometryFor(40.0f, 0.25f, 0.0f);
    const auto tinyBlur = synth_juce::EncoderComponent::MotionIndicatorGeometryFor(40.0f, 0.25f, 0.0001f);
    const auto widerBlur = synth_juce::EncoderComponent::MotionIndicatorGeometryFor(40.0f, 0.25f, 0.10f);
    RequireNear(restingBlur.centerAngle, synth_juce::EncoderComponent::ValueToArcAngle(0.25f), tolerance,
                "motion blur centers on the range arc coordinate system");
    RequireNear(tinyBlur.centerAngle, restingBlur.centerAngle, tolerance,
                "tiny motion does not switch to a different angular coordinate system");
    RequireTrue(tinyBlur.arcHalfValue > restingBlur.arcHalfValue,
                "tiny motion expands the same geometry continuously");
    RequireTrue(tinyBlur.outerStrokeWidth > restingBlur.outerStrokeWidth,
                "tiny motion thickens the same geometry continuously");
    RequireNear(widerBlur.arcHalfValue - restingBlur.arcHalfValue, 0.20f, tolerance,
                "motion blur arc width tracks probable spread");
    RequireNear(widerBlur.startValue, 0.25f - widerBlur.arcHalfValue, tolerance,
                "motion blur probable band starts around center minus spread");
    RequireNear(widerBlur.endValue, 0.25f + widerBlur.arcHalfValue, tolerance,
                "motion blur probable band ends around center plus spread");
    RequireTrue(widerBlur.outlineAlpha < tinyBlur.outlineAlpha, "wider motion has fainter outline than tiny motion");

    const juce::Point<float> zeroPoint = synth_juce::EncoderComponent::IndicatorPoint(100.0f, 100.0f, 20.0f, 0.0f);
    RequireNear(zeroPoint.x, 100.0f + 20.0f * std::cos(pi * 0.75f), tolerance, "indicator x at zero");
    RequireNear(zeroPoint.y, 100.0f + 20.0f * std::sin(pi * 0.75f), tolerance, "indicator y at zero");

    RequireNear(synth_juce::PathDrawer::ScopeSampleForPoint(1, 10), 10.0 / 1023.0, 0.000001,
                "scope sample remains fractional");
    const std::size_t transferPoint = 410;
    RequireTrue(!synth_juce::PathDrawer::ScopePointCrossesTransfer(transferPoint - 1, 10, 4.0),
                "scope transfer does not break early");
    RequireTrue(synth_juce::PathDrawer::ScopePointCrossesTransfer(transferPoint, 10, 4.0),
                "scope transfer breaks when crossed");
    RequireTrue(!synth_juce::PathDrawer::ScopePointCrossesTransfer(transferPoint + 1, 10, 4.0),
                "scope transfer breaks once");
    RequireTrue(!synth_juce::PathDrawer::ScopePointCrossesTransfer(synth_juce::PathDrawer::kNumPoints - 1, 10, 10.0),
                "full-span transfer does not split path");

    const juce::Rectangle<int> encoderArea(16, 48, 968, synth_miniapp::EncoderGridLayout::kTotalHeight);
    RequireRectangle(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 0),
                     juce::Rectangle<int>(26, 58, 112, 130), "encoder zero bounds");
    RequireRectangle(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 3),
                     juce::Rectangle<int>(422, 58, 112, 130), "encoder three bounds");
    RequireRectangle(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 4),
                     juce::Rectangle<int>(26, 208, 112, 130), "encoder four bounds");
    RequireRectangle(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 6),
                     juce::Rectangle<int>(290, 208, 112, 130), "encoder six bounds");

    synth_juce::MidiInHandler midiIn;
    if (midiIn.Open("__sheaf_missing_midi_input__") || midiIn.IsOpen()) {
        throw std::runtime_error("missing MIDI input identifier should leave handler closed");
    }

    synth_juce::MidiOutputHandler midiOut;
    if (midiOut.Open("__sheaf_missing_midi_output__") || midiOut.IsOpen()) {
        throw std::runtime_error("missing MIDI output identifier should leave handler closed");
    }

    std::cout << "Encoder geometry tests passed\n";
    return 0;
}
