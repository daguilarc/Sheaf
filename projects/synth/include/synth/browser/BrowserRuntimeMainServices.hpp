#pragma once

#include "synth/ControllersPageUI.hpp"
#include "synth/ControllerWizardDiscoveryCache.hpp"
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
                               std::function<float()> deadlineSampleProvider = {},
                               std::function<BrowserAudioInputState()> audioInputStateProvider = {})
        : engine_(engine)
        , midiBridge_(midiBridge)
        , fileService_(MakeFileCallbacks())
        , deadlineSampleProvider_(std::move(deadlineSampleProvider))
        , audioInputStateProvider_(std::move(audioInputStateProvider))
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
            return wizardDiscoveryCache_.DeviceList();
        };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig instrument) {
            engine_.EditInstrument([&instrument](synth::MidiInstrumentConfig& current) {
                current = std::move(instrument);
            });
            wizardDiscoveryCache_.UpdateInstrumentSnapshot(engine_.InstrumentSnapshot());
            controllersDirty_ = true;
            instrumentSnapshotDirty_ = false;
            return true;
        };
        callbacks.saveRuntimeConfiguration = [this] {
            if (engine_.SaveRuntimeConfiguration() !=
                synth::RuntimeConfigFileStatus::Ok)
            {
                return false;
            }
            persistenceDirty_ = true;
            return true;
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
        const BrowserAudioInputState input = AudioInputState();
        snapshot = BuildBrowserAudioSnapshot(engine_.AudioDeviceSnapshot(), input);
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
        // A live capture diagnostic outranks the last selection acknowledgement:
        // the acknowledgement is what the user just did, the diagnostic is what
        // the host can currently deliver. Neither displaces the requested/active
        // counts (sru-3) -- both compose after them.
        std::string detail = BrowserAudioInputDetail(input);
        if (detail.empty() && audioStatus_.has_value())
        {
            detail = *audioStatus_;
        }
        snapshot.statusLineText = ComposeBrowserAudioStatusLine(input, detail);
    }

    void DispatchAudio(const synth::ui::Action& action)
    {
        // Arming a retry is all this does: reacquisition is the launcher realm's
        // work, it needs DOM/media APIs this side never touches, and it must not
        // be initiated by anything but the user (sbw-4).
        if (action.name == synth::runtime_ui::Actions::kAudioInputRetry)
        {
            audioInputRetryRequested_ = true;
            return;
        }

        const bool selectsOutput = action.name == synth::runtime_ui::Actions::kAudioOutputSelect;
        if (!selectsOutput && action.name != synth::runtime_ui::Actions::kAudioInputSelect)
        {
            return;
        }
        synth::AudioDeviceState state = engine_.AudioDeviceSnapshot();
        // Both selections commit an empty persisted name: System Default is the
        // only browser choice, and a named id is rejected rather than stored.
        if (selectsOutput)
        {
            state.outputDeviceName = BrowserOutputDeviceName(action.value);
        }
        else
        {
            state.inputDeviceName = BrowserInputDeviceName(action.value);
        }
        engine_.SetAudioDeviceFromHost(state);
        audioStatus_ = "Using System Default";
    }

    bool ConsumeAudioInputRetry()
    {
        const bool requested = audioInputRetryRequested_;
        audioInputRetryRequested_ = false;
        return requested;
    }

    void RefreshFile(synth::runtime_ui::FilePageSnapshot& snapshot)
    {
        fileService_.Refresh(snapshot);
    }

    void DispatchFile(const synth::ui::Action& action)
    {
        fileService_.Dispatch(action);
    }

    // Recompute the cached classification as soon as the host learns the device
    // list changed, instead of waiting for the next frame build. Submit
    // rechecks its candidate through the enumerateDevices callback, so a
    // controller unplugged between two frames must already be gone from the
    // cache by the time that recheck runs. An unchanged list is a no-op, and
    // this neither enumerates devices nor reconciles endpoints.
    void NoteMidiDeviceListChanged()
    {
        const std::uint64_t deviceListRevision = midiBridge_.DeviceListRevision();
        if (wizardDiscoveryCache_.HasDeviceList() && deviceListRevision == cachedDeviceListRevision_)
        {
            return;
        }
        wizardDiscoveryCache_.UpdateDeviceList(midiBridge_.LatestDeviceList());
        cachedDeviceListRevision_ = deviceListRevision;
    }

    void RefreshControllers(synth::runtime_ui::ControllersPageSurface& surface)
    {
        NoteMidiDeviceListChanged();
        surface.SetEnumerateDevices(wizardDiscoveryCache_.DeviceList());
        if (instrumentSnapshotDirty_)
        {
            wizardDiscoveryCache_.UpdateInstrumentSnapshot(engine_.InstrumentSnapshot());
            instrumentSnapshotDirty_ = false;
        }
        if (controllersDirty_)
        {
            surface.MarkDirty();
            controllersDirty_ = false;
        }
        surface.SetDiscovery(wizardDiscoveryCache_.Discovery());
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
    BrowserAudioInputState AudioInputState() const
    {
        return audioInputStateProvider_ ? audioInputStateProvider_() : BrowserAudioInputState{};
    }

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
    std::function<BrowserAudioInputState()> audioInputStateProvider_;
    std::optional<double> negotiatedSampleRate_;
    std::optional<int> negotiatedBlockSize_;
    std::optional<std::string> audioStatus_;
    bool audioInputRetryRequested_ = false;
    synth::ControllerWizardDiscoveryCache wizardDiscoveryCache_;
    std::uint64_t cachedDeviceListRevision_ = 0;
    bool controllersDirty_ = true;
    bool instrumentSnapshotDirty_ = true;
    bool persistenceDirty_ = false;
};

}  // namespace synth_browser
