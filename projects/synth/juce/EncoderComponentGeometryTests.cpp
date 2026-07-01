#include "EncoderComponent.hpp"
#include "MidiHandlers.hpp"
#include "PathDrawer.hpp"

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
