#pragma once

#include "MiniApp.hpp"
#include "synth/AppRegistry.hpp"

#include <utility>

namespace synth_miniapp {

inline synth::SynthAppManifest MiniAppManifest() {
    return synth::SynthAppManifest{
        .appId = "miniapp",
        .displayName = "Mini App",
        .author = "Sheaf",
        .category = "test",
        .hardware = synth::SynthHardwareRequirements{.minEncoders = 16},
    };
}

template <typename LaunchFn>
synth::SynthAppRegistration MakeMiniAppRegistration(LaunchFn&& launchFn) {
    return synth::MakeSynthAppRegistration<MiniApp>(MiniAppManifest(), std::forward<LaunchFn>(launchFn));
}

}  // namespace synth_miniapp
