#include "EncoderComponent.hpp"
#include "MidiHandlers.hpp"
#include "PathDrawer.hpp"

#include "../apps/miniapp/MiniAppDraw.hpp"
#include "../apps/miniapp/MiniAppUI.hpp"

#include "synth/PortableUI.hpp"

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

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

void RequireColor(synth::ui::Color actual, synth::ui::Color expected, const char* label) {
    if (actual.r != expected.r || actual.g != expected.g || actual.b != expected.b || actual.a != expected.a) {
        throw std::runtime_error(std::string(label) + " expected rgba(" +
                                 std::to_string(expected.r) + "," + std::to_string(expected.g) + "," +
                                 std::to_string(expected.b) + "," + std::to_string(expected.a) + ") got rgba(" +
                                 std::to_string(actual.r) + "," + std::to_string(actual.g) + "," +
                                 std::to_string(actual.b) + "," + std::to_string(actual.a) + ")");
    }
}

bool SameColor(synth::ui::Color lhs, synth::ui::Color rhs) {
    return lhs.r == rhs.r && lhs.g == rhs.g && lhs.b == rhs.b && lhs.a == rhs.a;
}

bool HasDrawKind(const std::vector<synth::ui::DrawCommand>& commands, synth::ui::DrawCommand::Kind kind) {
    for (const synth::ui::DrawCommand& command : commands) {
        if (command.kind == kind) {
            return true;
        }
    }
    return false;
}

const synth::ui::DrawCommand* FindFirstDrawKind(const std::vector<synth::ui::DrawCommand>& commands,
                                                synth::ui::DrawCommand::Kind kind) {
    for (const synth::ui::DrawCommand& command : commands) {
        if (command.kind == kind) {
            return &command;
        }
    }
    return nullptr;
}


void RequireBounds(synth::ui::Bounds actual, synth::ui::Bounds expected, const char* label) {
    RequireNear(actual.x, expected.x, 0.0001f, label);
    RequireNear(actual.y, expected.y, 0.0001f, label);
    RequireNear(actual.width, expected.width, 0.0001f, label);
    RequireNear(actual.height, expected.height, 0.0001f, label);
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

    const synth::ui::Bounds encoderArea{16.0f, 48.0f, 968.0f, synth_miniapp::EncoderGridLayout::kTotalHeight};
    RequireBounds(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 0),
                  synth::ui::Bounds{26.0f, 58.0f, 112.0f, 130.0f}, "encoder zero bounds");
    RequireBounds(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 3),
                  synth::ui::Bounds{422.0f, 58.0f, 112.0f, 130.0f}, "encoder three bounds");
    RequireBounds(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 4),
                  synth::ui::Bounds{26.0f, 208.0f, 112.0f, 130.0f}, "encoder four bounds");
    RequireBounds(synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 6),
                  synth::ui::Bounds{290.0f, 208.0f, 112.0f, 130.0f}, "encoder six bounds");

    synth_miniapp::EncoderDrawState encoderState;
    encoderState.connected = true;
    encoderState.color = synth::Color::Cyan;
    encoderState.shortLabel = "tune";
    encoderState.modulatorsAffectingMask = 1u;
    encoderState.voiceCount = 1;
    encoderState.voices.push_back({.value = 0.25f,
                                   .spreadValue = 0.10f,
                                   .minValue = 0.1f,
                                   .maxValue = 0.9f,
                                   .indicatorColor = synth::Color::Orange});
    const synth::ui::Bounds encoderNode{0.0f, 0.0f, 128.0f, 128.0f};
    const std::vector<synth::ui::DrawCommand> encoderCommands =
        synth_miniapp::BuildEncoderDrawCommands(encoderState, encoderNode);
    RequireTrue(!encoderCommands.empty(), "encoder draw commands should not be empty");
    RequireTrue(HasDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::FillEllipse),
                "encoder draw commands include fill ellipse background");
    RequireTrue(HasDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::Arc),
                "encoder draw commands include arc geometry");
    RequireTrue(HasDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::StrokeRoundedRect),
                "encoder draw commands include rounded frame and badge outlines");
    RequireTrue(HasDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::FillPolygon),
                "encoder draw commands include fourteen-segment polygons");
    RequireTrue(HasDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::Text),
                "encoder draw commands include badge text");

    const auto* motionArc = FindFirstDrawKind(encoderCommands, synth::ui::DrawCommand::Kind::Arc);
    RequireTrue(motionArc != nullptr, "encoder includes at least one arc");
    constexpr float x_Inset = 4.0f;
    const float innerWidth = encoderNode.width - x_Inset * 2.0f;
    const float innerHeight = encoderNode.height - x_Inset * 2.0f;
    const float baseRadius = std::min(innerWidth, innerHeight) * 0.43f;
    const auto motionGeometry = synth_miniapp::EncoderGeometry::MotionIndicatorGeometryFor(baseRadius, 0.25f, 0.10f);
    const float expectedStart = synth_miniapp::EncoderGeometry::ValueToArcAngle(motionGeometry.startValue);
    const float expectedEnd = synth_miniapp::EncoderGeometry::ValueToArcAngle(motionGeometry.endValue);
    bool foundMotionArc = false;
    for (const synth::ui::DrawCommand& command : encoderCommands)
    {
        if (command.kind == synth::ui::DrawCommand::Kind::Arc &&
            std::fabs(command.startRadians - expectedStart) <= tolerance &&
            std::fabs(command.endRadians - expectedEnd) <= tolerance)
        {
            foundMotionArc = true;
            break;
        }
    }
    RequireTrue(foundMotionArc, "portable motion arc matches encoder geometry band");

    RequireColor(synth_miniapp::BrighterUiColor(synth::ui::Color::Rgba(100, 128, 200, 180), 0.45f),
                 synth::ui::Color::Rgba(148, 167, 217, 180),
                 "portable brighter color matches JUCE brighter interpolation");

    const synth::ui::Color expectedOnColor = synth_miniapp::BrighterUiColor(synth::ui::Color::Rgb(0, 255, 255), 0.45f);
    bool foundLabelTopSegment = false;
    float labelTopY = 0.0f;
    bool foundBadgeOutline = false;
    for (const synth::ui::DrawCommand& command : encoderCommands) {
        if (!foundLabelTopSegment && command.kind == synth::ui::DrawCommand::Kind::FillPolygon &&
            SameColor(command.color, expectedOnColor) && !command.points.empty()) {
            labelTopY = command.points.front().y;
            foundLabelTopSegment = true;
        }
        if (command.kind == synth::ui::DrawCommand::Kind::StrokeRoundedRect &&
            command.color.a == 140 && command.color.r == 0 && command.color.g == 0 && command.color.b == 0) {
            foundBadgeOutline = true;
        }
    }
    const float displayHeight = synth_miniapp::Clamp(baseRadius * 0.34f, 14.0f, 24.0f);
    const float displayWidth = displayHeight * 3.3f;
    const float charWidth = displayWidth / 4.0f;
    const float expectedLabelTopY = encoderNode.y + encoderNode.height * 0.5f + baseRadius * 0.54f + charWidth * 0.05f;
    RequireTrue(foundLabelTopSegment, "encoder label includes an on-color top segment");
    RequireNear(labelTopY, expectedLabelTopY, tolerance, "encoder label vertical position matches legacy layout");
    RequireTrue(foundBadgeOutline, "badge outline alpha matches legacy black alpha");

    const std::vector<synth::ui::DrawCommand> segmentCommands = synth_miniapp::BuildFourteenSegmentCommands(
        "A1",
        synth::ui::Bounds{0.0f, 0.0f, 80.0f, 24.0f},
        synth::ui::Color::Rgb(255, 128, 64),
        synth::ui::Color::Rgb(36, 40, 42));
    RequireTrue(HasDrawKind(segmentCommands, synth::ui::DrawCommand::Kind::FillPolygon),
                "fourteen-segment commands include fill polygons");

    synth_miniapp::VcoWaveformDrawState vcoState;
    vcoState.layers.push_back({.connected = false});
    const std::vector<synth::ui::DrawCommand> vcoCommands =
        synth_miniapp::BuildVcoWaveformCommands(vcoState, synth::ui::Bounds{0.0f, 0.0f, 200.0f, 100.0f});
    RequireTrue(HasDrawKind(vcoCommands, synth::ui::DrawCommand::Kind::Fill), "vco waveform includes background fill");
    RequireTrue(HasDrawKind(vcoCommands, synth::ui::DrawCommand::Kind::Line),
                "vco waveform includes center axis line");

    RequireNear(synth_miniapp::EncoderGeometry::ValueToIndicatorAngle(0.0f), pi * 0.75f, tolerance,
                "portable indicator angle at zero");
    RequireNear(synth_miniapp::ScopePathMath::ScopeSampleForPoint(1, 10), 10.0 / 1023.0, 0.000001,
                "portable scope sample remains fractional");

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
