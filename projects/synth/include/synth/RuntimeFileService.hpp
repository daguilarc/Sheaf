#pragma once

#include "synth/PatchPersistence.hpp"
#include "synth/RuntimePages.hpp"

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace synth::runtime_ui {

struct RuntimeFileCallbacks
{
    std::function<std::optional<std::filesystem::path>()> currentPatchDirectory;
    std::function<std::filesystem::path()> patchesRoot;
    std::function<void()> newPatch;
    std::function<void()> savePatch;
    std::function<void(const std::filesystem::path&)> savePatchAs;
    std::function<void(const std::filesystem::path&)> savePatchAsOverwrite;
    std::function<void(const std::filesystem::path&)> loadPatch;
};

class RuntimeFileService final
{
public:
    explicit RuntimeFileService(RuntimeFileCallbacks callbacks)
        : callbacks_(std::move(callbacks))
    {
    }

    void Refresh(FilePageSnapshot& snapshot) const
    {
        const std::optional<std::filesystem::path> currentPatchDirectory =
            callbacks_.currentPatchDirectory();
        snapshot.hasCurrentPatch = currentPatchDirectory.has_value();
        snapshot.patchNameText = currentPatchDirectory.has_value()
                                     ? currentPatchDirectory->filename().string()
                                     : "(no patch)";
        snapshot.patchesRoot = callbacks_.patchesRoot().string();
        if (fileStatus_.has_value())
        {
            snapshot.statusText = *fileStatus_;
        }
    }

    void Dispatch(const ui::Action& action)
    {
        if (action.name == Actions::kFileNew)
        {
            callbacks_.newPatch();
            fileStatus_ = "New patch created";
        }
        else if (action.name == Actions::kFileSave)
        {
            callbacks_.savePatch();
            fileStatus_ = "Save requested";
        }
        else if (action.name == Actions::kFileConfirmedSaveAs)
        {
            callbacks_.savePatchAs(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == Actions::kFileConfirmedOverwriteSaveAs)
        {
            callbacks_.savePatchAsOverwrite(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == Actions::kFileConfirmedLoad)
        {
            callbacks_.loadPatch(std::filesystem::path(action.value));
            fileStatus_ = "Load requested: " + action.value;
        }
    }

private:
    RuntimeFileCallbacks callbacks_;
    std::optional<std::string> fileStatus_;
};

// Binds RuntimeFileCallbacks straight to an engine: JuceRuntimeMainServices
// and BrowserRuntimeMainServices each built this exact set of five bindings
// by hand, and a plugin host is the third. New and Load go through
// Engine::NewPatch/Engine::LoadPatch so a host that records a reopen version
// keeps recording one; Save, Save As and its overwrite go straight to
// Engine::Patches() since neither changes what the host reopens. onCommand,
// when given, is handed each command's name and its PatchCommandResult right
// after the call that produced it, for a host that logs; the JUCE hosts pass
// one that logs exactly as Runtime<App>::LogPatchCommand does.
template <typename EngineType>
RuntimeFileCallbacks MakeEngineFileCallbacks(
    EngineType& engine, std::function<void(const char*, const PatchCommandResult&)> onCommand = {})
{
    RuntimeFileCallbacks callbacks;
    callbacks.currentPatchDirectory = [&engine] {
        return engine.Patches().CurrentPatchDirectory();
    };
    callbacks.patchesRoot = [&engine] {
        return engine.DataPaths().patchesRoot;
    };
    callbacks.newPatch = [&engine, onCommand] {
        const PatchCommandResult result = engine.NewPatch();
        if (onCommand)
        {
            onCommand("NewPatch", result);
        }
    };
    callbacks.savePatch = [&engine, onCommand] {
        const PatchCommandResult result = engine.Patches().SavePatch();
        if (onCommand)
        {
            onCommand("SavePatch", result);
        }
    };
    callbacks.savePatchAs = [&engine, onCommand](const std::filesystem::path& path) {
        const PatchCommandResult result = engine.Patches().SavePatchAs(path);
        if (onCommand)
        {
            onCommand("SavePatchAs", result);
        }
    };
    callbacks.savePatchAsOverwrite = [&engine, onCommand](const std::filesystem::path& path) {
        const PatchCommandResult result = engine.Patches().SavePatchAsOverwrite(path);
        if (onCommand)
        {
            onCommand("SavePatchAsOverwrite", result);
        }
    };
    callbacks.loadPatch = [&engine, onCommand](const std::filesystem::path& path) {
        const PatchCommandResult result = engine.LoadPatch(path);
        if (onCommand)
        {
            onCommand("LoadPatch", result);
        }
    };
    return callbacks;
}

}  // namespace synth::runtime_ui
