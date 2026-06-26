#include "EncoderComponent.hpp"

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

    std::cout << "Encoder geometry tests passed\n";
    return 0;
}
