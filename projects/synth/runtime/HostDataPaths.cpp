#include "HostDataPaths.hpp"

#include "synth/AppRegistry.hpp"

#include <juce_core/juce_core.h>

#include <string>

namespace synth_runtime {

std::filesystem::path SheafUserApplicationDataRoot() {
    const juce::File root =
        juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Sheaf");
    return std::filesystem::path(root.getFullPathName().toStdString());
}

synth::RuntimeDataPaths DefaultDataPathsForApp(const synth::RuntimeConfig& config) {
    const std::string appName = config.appName.empty() ? "SynthApp" : config.appName;
    return synth::RuntimeDataPaths::FromDataRoot(SheafUserApplicationDataRoot() / appName);
}

synth::RuntimeDataPaths SheafPatchDataPathsForApp(std::string_view stableAppId) {
    return synth::SheafPatchDataPathsForApp(SheafUserApplicationDataRoot(), stableAppId);
}

}  // namespace synth_runtime
