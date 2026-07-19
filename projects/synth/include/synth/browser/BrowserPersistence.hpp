#pragma once

#include "synth/AppContext.hpp"

#include <filesystem>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>

namespace synth_browser {

inline constexpr std::string_view kBrowserDataRoot = "/data";
inline constexpr std::uint32_t kBrowserRuntimeConfigVersion = 1;

inline bool IsBrowserPersistenceIdentifier(std::string_view value)
{
    if (value.empty()) {
        return false;
    }
    bool previousWasHyphen = true;
    for (const char character : value) {
        const bool isLowercase = character >= 'a' && character <= 'z';
        const bool isDigit = character >= '0' && character <= '9';
        if (character == '-') {
            if (previousWasHyphen) {
                return false;
            }
            previousWasHyphen = true;
        } else if (isLowercase || isDigit) {
            previousWasHyphen = false;
        } else {
            return false;
        }
    }
    return !previousWasHyphen;
}

inline synth::RuntimeDataPaths BrowserPersistentDataPaths(
    std::string_view publisherId,
    std::string_view appId,
    std::uint32_t runtimeConfigVersion)
{
    if (runtimeConfigVersion != kBrowserRuntimeConfigVersion) {
        throw std::invalid_argument("unsupported browser runtime-config version");
    }
    if (!IsBrowserPersistenceIdentifier(publisherId) ||
        !IsBrowserPersistenceIdentifier(appId)) {
        throw std::invalid_argument("invalid browser persistence identity");
    }
    const std::filesystem::path dataRoot{kBrowserDataRoot};
    return synth::RuntimeDataPaths::FromRoots(
        dataRoot,
        dataRoot / "patches" / std::string(publisherId) / std::string(appId),
        dataRoot / "logs",
        dataRoot / "config.json");
}

}  // namespace synth_browser
