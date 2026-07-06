#pragma once

#include "synth/AppConcepts.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <functional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace synth {

struct SynthHardwareRequirements {
    int minEncoders = 0;
};

struct SynthAppManifest {
    std::string appId;
    std::string displayName;
    std::string author;
    std::string category;
    SynthHardwareRequirements hardware;
};

struct SynthAppRegistration {
    SynthAppManifest manifest;
    std::function<void(RuntimeDataPaths)> launch;
};

inline bool IsValidSynthAppId(std::string_view id) {
    if (id.empty()) {
        return false;
    }

    for (const unsigned char ch : id) {
        const bool valid = std::islower(ch) || std::isdigit(ch) || ch == '-';
        if (!valid) {
            return false;
        }
    }

    return id.find("..") == std::string_view::npos;
}

inline void SortSynthAppRegistrationsById(std::vector<SynthAppRegistration>& apps) {
    std::sort(apps.begin(), apps.end(), [](const auto& lhs, const auto& rhs) {
        return lhs.manifest.appId < rhs.manifest.appId;
    });
}

inline RuntimeDataPaths SheafPatchDataPathsForApp(std::filesystem::path dataRoot,
                                                  std::string_view stableAppId) {
    const std::string appId(stableAppId);
    if (!IsValidSynthAppId(appId)) {
        throw std::invalid_argument("invalid synth appId '" + appId + "'");
    }

    const std::filesystem::path root = std::move(dataRoot) / "synth" / "sheaf-patch";
    return RuntimeDataPaths::FromRoots(root,
                                       root / "patches" / appId,
                                       root / "logs",
                                       // Literal extensionless filename requested by the Sheaf Patch launcher spec.
                                       root / "config");
}

template <SynthApplication App, typename LaunchFn>
SynthAppRegistration MakeSynthAppRegistration(SynthAppManifest manifest, LaunchFn&& launchFn) {
    if (!IsValidSynthAppId(manifest.appId)) {
        throw std::invalid_argument("invalid synth appId");
    }

    return SynthAppRegistration{
        std::move(manifest),
        std::function<void(RuntimeDataPaths)>(std::forward<LaunchFn>(launchFn)),
    };
}

}  // namespace synth
