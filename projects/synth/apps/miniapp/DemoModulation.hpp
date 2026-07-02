#pragma once

#include "synth/ParameterModulation.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <span>

namespace synth_miniapp {

inline float UnipolarSineModulator(float phase, float phaseOffset = 0.0f) {
    return std::clamp(0.5f + 0.5f * std::sin(phase + phaseOffset), 0.0f, 1.0f);
}

inline float LfoPhaseStep(float normalizedSpeed) {
    return 0.01f + std::clamp(normalizedSpeed, 0.0f, 1.0f) * 0.16f;
}

inline float BipolarAudioToModulator(float sample) {
    return std::clamp((sample + 1.0f) * 0.5f, 0.0f, 1.0f);
}

inline void PublishVcoModulators(synth::Modulators& modulators, float voice0Output, float voice1Output) {
    modulators.Value(0, 0) = BipolarAudioToModulator(voice0Output);
    modulators.Value(1, 0) = BipolarAudioToModulator(voice1Output);
    modulators.Value(0, 1) = BipolarAudioToModulator(voice1Output);
    modulators.Value(1, 1) = BipolarAudioToModulator(voice0Output);
}

inline void PublishLfoModulator(synth::Modulators& modulators, float phase, float phaseOffset) {
    modulators.Value(0, 2) = UnipolarSineModulator(phase);
    modulators.Value(1, 2) = UnipolarSineModulator(phase, phaseOffset);
}

inline void ProcessLiteParameters(std::span<synth::Parameter*> parameters) {
    for (synth::Parameter* parameter : parameters) {
        if (parameter != nullptr) {
            parameter->ProcessLite();
        }
    }
}

inline float ThreePhaseVoiceOffset(std::size_t voiceIx) {
    constexpr float pi = 3.14159265358979323846f;
    return static_cast<float>(voiceIx % 3) * (2.0f * pi / 3.0f);
}

} // namespace synth_miniapp
