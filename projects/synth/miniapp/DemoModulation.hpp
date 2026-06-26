#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace synth_miniapp {

inline float UnipolarSineModulator(float phase, float phaseOffset = 0.0f) {
    return std::clamp(0.5f + 0.5f * std::sin(phase + phaseOffset), 0.0f, 1.0f);
}

inline float ThreePhaseVoiceOffset(std::size_t voiceIx) {
    constexpr float pi = 3.14159265358979323846f;
    return static_cast<float>(voiceIx % 3) * (2.0f * pi / 3.0f);
}

} // namespace synth_miniapp
