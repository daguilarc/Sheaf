#pragma once

#include "synth/ControllersPageUI.hpp"
#include "synth/Engine.hpp"
#include "synth/RuntimeFileService.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/browser/BrowserAudioDevices.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"

#include <cstddef>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace synth_browser {

template <synth::SynthApplication App>
class BrowserRuntimeMainServices final
{
public:
    using EngineType = synth::Engine<App>;
    using MidiBridge = BrowserMidiBridge<EngineType>;

    BrowserRuntimeMainServices(EngineType& engine,
                               MidiBridge& midiBridge,
                               std::function<float()> deadlineSampleProvider = {})
        : engine_(engine)
        , midiBridge_(midiBridge)
        , fileService_(MakeFileCallbacks())
        , deadlineSampleProvider_(std::move(deadlineSampleProvider))
    {
    }

    BrowserRuntimeMainServices(const BrowserRuntimeMainServices&) = delete;
    BrowserRuntimeMainServices& operator=(const BrowserRuntimeMainServices&) = delete;
    BrowserRuntimeMainServices(BrowserRuntimeMainServices&&) = delete;
    BrowserRuntimeMainServices& operator=(BrowserRuntimeMainServices&&) = delete;

    synth::runtime_ui::ControllersPageCallbacks MakeControllersCallbacks(
        std::function<void()> onBack)
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] {
            return engine_.InstrumentSnapshot();
        };
        callbacks.connectionState = [this] {
            return midiBridge_.ConnectionState();
        };
        callbacks.enumerateDevices = [this] {
            return midiBridge_.LatestDeviceList();
        };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig instrument) {
            engine_.EditInstrument([&instrument](synth::MidiInstrumentConfig& current) {
                current = std::move(instrument);
            });
            controllersDirty_ = true;
        };
        callbacks.setStatus = [](std::string) {};
        callbacks.onBack = std::move(onBack);
        return callbacks;
    }

    void RecordAudioNegotiation(double sampleRate, std::size_t blockSize)
    {
        negotiatedSampleRate_ = sampleRate;
        negotiatedBlockSize_ = static_cast<int>(blockSize);
    }

    void RefreshAudio(synth::runtime_ui::AudioPageSnapshot& snapshot)
    {
        snapshot = BuildBrowserAudioSnapshot(engine_.AudioDeviceSnapshot());
        if (negotiatedSampleRate_.has_value() && negotiatedBlockSize_.has_value())
        {
            snapshot.deviceLineText = synth::runtime_ui::Layout::BuildNegotiatedDeviceLine(
                synth::runtime_ui::kSystemDefaultOptionLabel,
                *negotiatedSampleRate_,
                *negotiatedBlockSize_);
        }
        else
        {
            snapshot.deviceLineText = "No audio device";
        }
        if (audioStatus_.has_value())
        {
            snapshot.statusLineText = *audioStatus_;
        }
    }

    void DispatchAudio(const synth::ui::Action& action)
    {
        if (action.name != synth::runtime_ui::Actions::kAudioOutputSelect)
        {
            return;
        }

        synth::AudioDeviceState state = engine_.AudioDeviceSnapshot();
        state.outputDeviceName = BrowserOutputDeviceName(action.value);
        engine_.SetAudioDeviceFromHost(state);
        audioStatus_ = "Using System Default";
    }

    void RefreshFile(synth::runtime_ui::FilePageSnapshot& snapshot)
    {
        fileService_.Refresh(snapshot);
    }

    void DispatchFile(const synth::ui::Action& action)
    {
        fileService_.Dispatch(action);
    }

    void RefreshControllers(synth::runtime_ui::ControllersPageSurface& surface)
    {
        surface.SetEnumerateDevices(midiBridge_.LatestDeviceList());
        if (controllersDirty_)
        {
            surface.MarkDirty();
            controllersDirty_ = false;
        }
        surface.RefreshOnTick();
    }

    synth::SyncConfig SnapshotSyncConfiguration()
    {
        return engine_.SyncConfigurationSnapshot();
    }

    void RefreshSyncStatus(synth::runtime_ui::SyncPageStatus& status)
    {
        status = synth::runtime_ui::BuildSyncPageStatus(
            engine_.ClockDiagnosticsSnapshot(), engine_.InstrumentSnapshot());
    }

    bool CommitSyncConfiguration(const synth::SyncConfig& config)
    {
        return engine_.RequestSyncConfiguration(config);
    }

    float DeadlineSamplePercent() const
    {
        return deadlineSampleProvider_ ? deadlineSampleProvider_() : 0.0f;
    }

    void SaveRuntimeConfiguration()
    {
        if (engine_.SaveRuntimeConfiguration() == synth::RuntimeConfigFileStatus::Ok)
        {
            persistenceDirty_ = true;
        }
    }

    bool ConsumePersistenceDirty()
    {
        const bool dirty = persistenceDirty_;
        persistenceDirty_ = false;
        return dirty;
    }

private:
    synth::runtime_ui::RuntimeFileCallbacks MakeFileCallbacks()
    {
        synth::runtime_ui::RuntimeFileCallbacks callbacks;
        callbacks.currentPatchDirectory = [this] {
            return engine_.Patches().CurrentPatchDirectory();
        };
        callbacks.patchesRoot = [this] {
            return engine_.DataPaths().patchesRoot;
        };
        callbacks.newPatch = [this] { engine_.Patches().NewPatch(); };
        callbacks.savePatch = [this] { engine_.Patches().SavePatch(); };
        callbacks.savePatchAs = [this](const std::filesystem::path& path) {
            engine_.Patches().SavePatchAs(path);
        };
        callbacks.savePatchAsOverwrite = [this](const std::filesystem::path& path) {
            engine_.Patches().SavePatchAsOverwrite(path);
        };
        callbacks.loadPatch = [this](const std::filesystem::path& path) {
            engine_.Patches().LoadPatch(path);
        };
        callbacks.revertPatch = [this] { engine_.Patches().RevertPatch(); };
        return callbacks;
    }

    EngineType& engine_;
    MidiBridge& midiBridge_;
    synth::runtime_ui::RuntimeFileService fileService_;
    std::function<float()> deadlineSampleProvider_;
    std::optional<double> negotiatedSampleRate_;
    std::optional<int> negotiatedBlockSize_;
    std::optional<std::string> audioStatus_;
    bool controllersDirty_ = true;
    bool persistenceDirty_ = false;
};

}  // namespace synth_browser
