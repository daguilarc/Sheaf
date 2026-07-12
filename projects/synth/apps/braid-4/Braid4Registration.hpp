#pragma once

#include "Braid4.hpp"
#include "synth/AppRegistry.hpp"

#include <utility>

namespace synth_braid4 {

inline synth::SynthAppManifest Braid4Manifest() {
    return synth::SynthAppManifest{
        .appId = "braid-4",
        .displayName = "Braid 4",
        .author = "Sheaf",
        .category = "synth",
        .hardware = synth::SynthHardwareRequirements{.minEncoders = 16},
    };
}

template <typename LaunchFn>
synth::SynthAppRegistration MakeBraid4Registration(LaunchFn&& launchFn) {
    return synth::MakeSynthAppRegistration<Braid4>(Braid4Manifest(), std::forward<LaunchFn>(launchFn));
}

}  // namespace synth_braid4
