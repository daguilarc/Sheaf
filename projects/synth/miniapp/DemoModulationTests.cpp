#include "DemoModulation.hpp"

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
    constexpr float pi = 3.14159265358979323846f;
    constexpr float tolerance = 0.0001f;

    RequireNear(synth_miniapp::UnipolarSineModulator(0.0f), 0.5f, tolerance, "zero phase");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi * 0.5f), 1.0f, tolerance, "positive peak");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi), 0.5f, tolerance, "half cycle");
    RequireNear(synth_miniapp::UnipolarSineModulator(pi * 1.5f), 0.0f, tolerance, "negative peak");
    RequireNear(synth_miniapp::UnipolarSineModulator(0.0f, pi * 0.5f), 1.0f, tolerance, "90 degree voice offset");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(0), 0.0f, tolerance, "three phase voice 0");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(1), 2.0f * pi / 3.0f, tolerance, "three phase voice 1");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(2), 4.0f * pi / 3.0f, tolerance, "three phase voice 2");
    RequireNear(synth_miniapp::ThreePhaseVoiceOffset(3), 0.0f, tolerance, "three phase wraps");

    std::cout << "Demo modulation tests passed\n";
    return 0;
}
