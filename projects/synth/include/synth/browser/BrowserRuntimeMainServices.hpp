#pragma once

#include "synth/ControllersPageUI.hpp"
#include "synth/Engine.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/browser/BrowserAudioDevices.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"

#include <cstddef>
#include <filesystem>
#include <functional>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

namespace synth_browser {

template <synth::SynthApplication App>
class BrowserRuntimeMainServices final
{
public:
    using EngineType = synth::Engine<App>;
    using MidiBridge = BrowserMidiBridge<EngineType>;

    BrowserRuntimeMainServices(EngineType& engine, MidiBridge& midiBridge)
        : engine_(engine)
        , midiBridge_(midiBridge)
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
        if (blockSize > static_cast<std::size_t>(std::numeric_limits<int>::max()))
        {
            throw std::out_of_range("browser block size exceeds audio page range");
        }
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
        const auto& currentPatchDirectory = engine_.Patches().CurrentPatchDirectory();
        snapshot.hasCurrentPatch = currentPatchDirectory.has_value();
        snapshot.patchNameText = currentPatchDirectory.has_value()
                                     ? currentPatchDirectory->filename().string()
                                     : "(no patch)";
        snapshot.patchesRoot = engine_.DataPaths().patchesRoot.string();
        if (fileStatus_.has_value())
        {
            snapshot.statusText = *fileStatus_;
        }
    }

    void DispatchFile(const synth::ui::Action& action)
    {
        if (action.name == synth::runtime_ui::Actions::kFileNew)
        {
            engine_.Patches().NewPatch();
            fileStatus_ = "New patch created";
        }
        else if (action.name == synth::runtime_ui::Actions::kFileSave)
        {
            engine_.Patches().SavePatch();
            fileStatus_ = "Save requested";
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedSaveAs)
        {
            engine_.Patches().SavePatchAs(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedOverwriteSaveAs)
        {
            engine_.Patches().SavePatchAsOverwrite(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedLoad)
        {
            engine_.Patches().LoadPatch(std::filesystem::path(action.value));
            fileStatus_ = "Load requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileRevert)
        {
            engine_.Patches().RevertPatch();
            fileStatus_ = "Revert requested";
        }
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

    float DeadlineSamplePercent() const
    {
        return 0.0f;
    }

    void SaveRuntimeConfiguration()
    {
        engine_.SaveRuntimeConfiguration();
    }

private:
    EngineType& engine_;
    MidiBridge& midiBridge_;
    std::optional<double> negotiatedSampleRate_;
    std::optional<int> negotiatedBlockSize_;
    std::optional<std::string> audioStatus_;
    std::optional<std::string> fileStatus_;
    bool controllersDirty_ = true;
};

}  // namespace synth_browser
