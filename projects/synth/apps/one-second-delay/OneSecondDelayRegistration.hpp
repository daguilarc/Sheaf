#pragma once

#include "OneSecondDelay.hpp"
#include "synth/AppRegistry.hpp"

#include <utility>

namespace synth_one_second_delay {

inline synth::SynthAppManifest OneSecondDelayManifest() {
    return synth::SynthAppManifest{
        .appId = "one-second-delay",
        .displayName = "1 Second Delay",
        .author = "Sheaf",
        .category = "effect",
    };
}

template <typename LaunchFn>
synth::SynthAppRegistration MakeOneSecondDelayRegistration(LaunchFn&& launchFn) {
    return synth::MakeSynthAppRegistration<OneSecondDelay>(
        OneSecondDelayManifest(), std::forward<LaunchFn>(launchFn));
}

}  // namespace synth_one_second_delay
