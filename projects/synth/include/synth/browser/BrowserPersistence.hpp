#pragma once

#include "synth/AppContext.hpp"

#include <filesystem>
#include <string_view>

namespace synth_browser {

inline constexpr std::string_view kBrowserDataRoot = "/data";

inline synth::RuntimeDataPaths BrowserPersistentDataPaths()
{
    return synth::RuntimeDataPaths::FromDataRoot(std::filesystem::path(kBrowserDataRoot));
}

}  // namespace synth_browser
