#pragma once

#include "synth/ParameterModulation.hpp"

#include <span>

namespace synth_miniapp {

inline void ProcessLiteParameters(std::span<synth::Parameter*> parameters) {
    for (synth::Parameter* parameter : parameters) {
        if (parameter != nullptr) {
            parameter->ProcessLite();
        }
    }
}

} // namespace synth_miniapp
