#pragma once

#include "synth/AppContext.hpp"

#include <filesystem>
#include <string_view>

namespace synth_runtime {

std::filesystem::path SheafUserApplicationDataRoot();
synth::RuntimeDataPaths DefaultDataPathsForApp(const synth::RuntimeConfig& config);
synth::RuntimeDataPaths SheafPatchDataPathsForApp(std::string_view stableAppId);

}  // namespace synth_runtime
