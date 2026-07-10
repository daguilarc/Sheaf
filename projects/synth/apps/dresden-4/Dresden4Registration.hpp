#pragma once

#include "Dresden4.hpp"
#include "synth/AppRegistry.hpp"

#include <utility>

namespace synth_dresden4 {

inline synth::SynthAppManifest Dresden4Manifest() {
    return synth::SynthAppManifest{
        .appId = "dresden-4",
        .displayName = "Dresden 4",
        .author = "Sheaf",
        .category = "synth",
        .hardware = synth::SynthHardwareRequirements{.minEncoders = 16},
    };
}

template <typename LaunchFn>
synth::SynthAppRegistration MakeDresden4Registration(LaunchFn&& launchFn) {
    return synth::MakeSynthAppRegistration<Dresden4>(Dresden4Manifest(), std::forward<LaunchFn>(launchFn));
}

}  // namespace synth_dresden4
