#pragma once

// Thin runtime host alias for the portable Controllers page JUCE backend.

#include "ControllersPageJuce.hpp"

namespace synth_runtime {

template <synth::SynthApplication App>
using ControllersPage = ControllersPageHost<App>;

}  // namespace synth_runtime
