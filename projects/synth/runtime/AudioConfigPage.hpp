#pragma once

// Thin runtime host alias for the portable Audio page JUCE backend.

#include "RuntimePagesJuce.hpp"

namespace synth_runtime {

template <synth::SynthApplication App>
using AudioConfigPage = AudioPageHost<App>;

}  // namespace synth_runtime
