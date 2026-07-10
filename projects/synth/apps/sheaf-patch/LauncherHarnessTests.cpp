#include "Launcher.hpp"

#include "MiniAppRegistration.hpp"
#include "Shell.hpp"
#include "synth/AppRegistry.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <filesystem>
#include <functional>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

void Require(bool condition, const char* label) {
    if (!condition) {
        throw std::runtime_error(label);
    }
}

synth::SynthAppRegistration TestRegistration(std::string appId,
                                             std::string displayName,
                                             std::string category) {
    // The harness constructs plain registrations to test launcher sorting
    // independently of the typed app concept gate.
    synth::SynthAppRegistration registration;
    registration.manifest.appId = std::move(appId);
    registration.manifest.displayName = std::move(displayName);
    registration.manifest.author = "Harness";
    registration.manifest.category = std::move(category);
    registration.manifest.hardware.minEncoders = 2;
    registration.launch = [](synth::RuntimeDataPaths) {};
    return registration;
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;

    {
        using MiniAppOwnerFactoryResult =
            decltype(synth_runtime::MakeRuntimeSessionOwner<synth_miniapp::MiniApp>(
                std::declval<synth::RuntimeDataPaths>()));
        static_assert(std::is_same_v<MiniAppOwnerFactoryResult,
                                     std::unique_ptr<synth_runtime::RuntimeSessionOwner>>);

        std::function<std::unique_ptr<synth_runtime::RuntimeSessionOwner>(synth::RuntimeDataPaths)>
            miniappOwnerFactory = [](synth::RuntimeDataPaths paths) {
                return synth_runtime::MakeRuntimeSessionOwner<synth_miniapp::MiniApp>(std::move(paths));
            };

        auto owner = miniappOwnerFactory(synth::RuntimeDataPaths::FromDataRoot(
            std::filesystem::temp_directory_path() / "sheaf-patch-launcher-owner-test"));
        Require(owner != nullptr,
                "miniapp registration can construct through the generic runtime session owner factory");
        Require(dynamic_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>*>(&owner->Component()) != nullptr,
                "miniapp registration owner exposes a component through the generic interface");
    }

    {
        std::vector<synth::SynthAppRegistration> apps;
        apps.push_back(TestRegistration("zeta", "Zeta", "test"));
        apps.push_back(TestRegistration("alpha", "Alpha", "tools"));

        synth_sheaf_patch::LauncherComponent launcher(std::move(apps), "data");

        Require(launcher.AppCountForTesting() == 2, "launcher exposes both apps");
        Require(launcher.AppIdForTesting(0) == "alpha", "launcher sorts rows by stable app id");
        Require(launcher.AppIdForTesting(1) == "zeta", "launcher keeps later sorted app id");
        Require(launcher.RowTextForTesting("alpha") ==
                    "Alpha | Author: Harness | Category: tools | Minimum encoders: 2",
                "row shows formatted metadata");
    }

    {
        bool launched = false;
        synth::RuntimeDataPaths launchedPaths;
        auto miniapp = synth_miniapp::MakeMiniAppRegistration([&](synth::RuntimeDataPaths paths) {
            launched = true;
            launchedPaths = std::move(paths);
        });

        synth_sheaf_patch::LauncherComponent launcher({std::move(miniapp)}, "data");
        auto* row = launcher.RowButtonForTesting("miniapp");

        Require(row != nullptr, "miniapp row button exists");
        Require(launcher.RowTextForTesting("miniapp") ==
                    "Mini App | Author: Sheaf | Category: test | Minimum encoders: 16",
                "miniapp row shows formatted metadata");

        row->onClick();

        Require(launched, "row activation invokes selected launch binding");
        Require(launchedPaths.configFile == std::filesystem::path("data/synth/sheaf-patch/config"),
                "launcher passes shared Sheaf Patch config path");
        Require(launchedPaths.patchesRoot == std::filesystem::path("data/synth/sheaf-patch/patches/miniapp"),
                "launcher passes selected app patch root");
    }

    std::cout << "LauncherHarnessTests passed\n";
    return 0;
}
