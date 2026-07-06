#pragma once

#include "synth/ParameterModulation.hpp"

#include <cstdint>

namespace synth_miniapp {

inline void ProcessParameters(synth::ParameterGroup& group, std::uint64_t sampleIndex) {
    group.ProcessSample(sampleIndex);
}

} // namespace synth_miniapp
