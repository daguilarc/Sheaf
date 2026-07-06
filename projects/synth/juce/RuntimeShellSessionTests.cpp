#include "MiniApp.hpp"
#include "HostDataPaths.hpp"
#include "Shell.hpp"

#include "synth/AppContext.hpp"
#include "synth/ThreadId.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <filesystem>
#include <stdexcept>

namespace {

void Require(bool condition, const char* label) {
    if (!condition) {
        throw std::runtime_error(label);
    }
}

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    synth::SetCurrentThreadId(synth::ThreadId::Message);

    const std::filesystem::path sheafRoot = synth_runtime::SheafUserApplicationDataRoot();
    Require(sheafRoot.filename() == "Sheaf", "host data root is the shared Sheaf app-support root");

    const synth::RuntimeDataPaths standalonePaths =
        synth_runtime::DefaultDataPathsForApp(synth_miniapp::MiniApp::Config());
    Require(standalonePaths.dataRoot == sheafRoot / "SynthMiniapp",
            "standalone miniapp data root stays under the shared Sheaf app-support root");

    const synth::RuntimeDataPaths sheafPatchPaths = synth_runtime::SheafPatchDataPathsForApp("miniapp");
    Require(sheafPatchPaths.dataRoot == sheafRoot / "synth" / "sheaf-patch",
            "SheafPatch data root uses stable app-support storage");
    Require(sheafPatchPaths.configFile == sheafRoot / "synth" / "sheaf-patch" / "config",
            "SheafPatch config path is stable under app support");
    Require(sheafPatchPaths.patchesRoot == sheafRoot / "synth" / "sheaf-patch" / "patches" / "miniapp",
            "SheafPatch patches path is stable under app support");

    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf-runtime-shell-session-test";
    std::filesystem::remove_all(root);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromRoots(
        root,
        root / "patches" / "miniapp",
        root / "logs",
        root / "config");

    synth_runtime::RuntimeShellSession<synth_miniapp::MiniApp> session(paths);
    const synth::RuntimeDataPaths& runtimePaths = session.GetRuntime().DataPaths();

    Require(runtimePaths.dataRoot == paths.dataRoot, "runtime session receives supplied data root");
    Require(runtimePaths.patchesRoot == paths.patchesRoot, "runtime session receives supplied patches root");
    Require(runtimePaths.logsRoot == paths.logsRoot, "runtime session receives supplied logs root");
    Require(runtimePaths.configFile == paths.configFile, "runtime session receives supplied config path");
    Require(std::filesystem::exists(paths.patchesRoot), "runtime session creates supplied patches root");
    Require(std::filesystem::exists(paths.logsRoot), "runtime session creates supplied logs root");

    return 0;
}
