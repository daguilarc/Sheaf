#pragma once

// Thin runtime host alias for the portable File page JUCE backend.

#include "RuntimePagesJuce.hpp"

namespace synth_runtime {

template <synth::SynthApplication App>
using FilePage = FilePageHost<App>;

}  // namespace synth_runtime
