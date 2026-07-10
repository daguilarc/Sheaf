#pragma once

#include "Runtime.hpp"

#include "synth/ControllersPageUI.hpp"
#include "synth/RuntimePages.hpp"

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace synth_runtime {

template <synth::SynthApplication App>
class JuceRuntimeMainServices final
{
public:
    explicit JuceRuntimeMainServices(Runtime<App>& runtime)
        : runtime_(runtime)
    {
        runtime_.SetAudioStatusHook([this](const juce::String& text) {
            audioStatus_ = text.toStdString();
        });
        runtime_.SetAudioSyncHook([this] { audioSyncPending_ = true; });
        runtime_.SetMidiProcessorsRebuiltHook([this] {
            controllersDirty_ = true;
        });
    }

    ~JuceRuntimeMainServices()
    {
        runtime_.SetAudioStatusHook({});
        runtime_.SetAudioSyncHook({});
        runtime_.SetMidiProcessorsRebuiltHook({});
    }

    JuceRuntimeMainServices(const JuceRuntimeMainServices&) = delete;
    JuceRuntimeMainServices& operator=(const JuceRuntimeMainServices&) = delete;

    synth::runtime_ui::ControllersPageCallbacks MakeControllersCallbacks(
        std::function<void()> onBack)
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] {
            return runtime_.GetEngine().InstrumentSnapshot();
        };
        callbacks.connectionState = [this] {
            return runtime_.MidiConnections().State();
        };
        callbacks.enumerateDevices = [this] {
            return runtime_.MidiConnections().EnumerateNow();
        };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig instrument) {
            runtime_.GetEngine().EditInstrument(
                [&](synth::MidiInstrumentConfig& current) {
                    current = std::move(instrument);
                });
            controllersDirty_ = true;
        };
        callbacks.setStatus = [](std::string) {};
        callbacks.onBack = std::move(onBack);
        return callbacks;
    }

    void RefreshAudio(synth::runtime_ui::AudioPageSnapshot& snapshot)
    {
        juce::AudioDeviceManager& deviceManager = runtime_.DeviceManager();
        snapshot.showInputCombo = App::Config().numAudioInputs > 0;
        if (audioSyncPending_)
        {
            std::vector<std::string> outputNames;
            if (juce::AudioIODeviceType* deviceType = deviceManager.getCurrentDeviceTypeObject();
                deviceType != nullptr)
            {
                for (const juce::String& name : deviceType->getDeviceNames(false))
                {
                    outputNames.push_back(name.toStdString());
                }
            }

            std::vector<std::string> inputNames;
            if (snapshot.showInputCombo)
            {
                if (juce::AudioIODeviceType* deviceType = deviceManager.getCurrentDeviceTypeObject();
                    deviceType != nullptr)
                {
                    for (const juce::String& name : deviceType->getDeviceNames(true))
                    {
                        inputNames.push_back(name.toStdString());
                    }
                }
            }

            snapshot.outputOptions = synth::runtime_ui::Layout::BuildDeviceOptions(outputNames);
            snapshot.inputOptions = synth::runtime_ui::Layout::BuildDeviceOptions(inputNames);
            audioSyncPending_ = false;
        }

        const synth::AudioDeviceState state = runtime_.GetEngine().AudioDeviceSnapshot();
        snapshot.selectedOutputId = synth::runtime_ui::Layout::SelectedDeviceOptionId(
            state.outputDeviceName, snapshot.outputOptions);
        snapshot.selectedInputId = synth::runtime_ui::Layout::SelectedDeviceOptionId(
            state.inputDeviceName, snapshot.inputOptions);

        if (juce::AudioIODevice* device = deviceManager.getCurrentAudioDevice(); device != nullptr)
        {
            snapshot.deviceLineText = synth::runtime_ui::Layout::BuildNegotiatedDeviceLine(
                device->getName().toStdString(),
                device->getCurrentSampleRate(),
                device->getCurrentBufferSizeSamples());
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
        if (action.name == synth::runtime_ui::Actions::kAudioOutputSelect)
        {
            runtime_.ApplyAudioDeviceSelection(juce::String(
                synth::runtime_ui::Layout::DeviceNameFromOptionId(action.value)));
        }
        else if (action.name == synth::runtime_ui::Actions::kAudioInputSelect)
        {
            runtime_.ApplyAudioDeviceInputSelection(juce::String(
                synth::runtime_ui::Layout::DeviceNameFromOptionId(action.value)));
        }
    }

    void RefreshFile(synth::runtime_ui::FilePageSnapshot& snapshot)
    {
        const auto& currentPatchDirectory =
            runtime_.GetEngine().Patches().CurrentPatchDirectory();
        snapshot.hasCurrentPatch = currentPatchDirectory.has_value();
        snapshot.patchNameText = currentPatchDirectory.has_value()
                                     ? currentPatchDirectory->filename().string()
                                     : "(no patch)";
        snapshot.patchesRoot = runtime_.DataPaths().patchesRoot.string();
        if (fileStatus_.has_value())
        {
            snapshot.statusText = *fileStatus_;
        }
    }

    void DispatchFile(const synth::ui::Action& action)
    {
        if (action.name == synth::runtime_ui::Actions::kFileNew)
        {
            runtime_.NewPatch();
            fileStatus_ = "New patch created";
        }
        else if (action.name == synth::runtime_ui::Actions::kFileSave)
        {
            runtime_.SavePatch();
            fileStatus_ = "Save requested";
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedSaveAs)
        {
            runtime_.SavePatchAs(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedOverwriteSaveAs)
        {
            runtime_.SavePatchAsOverwrite(std::filesystem::path(action.value));
            fileStatus_ = "Save As requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileConfirmedLoad)
        {
            runtime_.LoadPatch(std::filesystem::path(action.value));
            fileStatus_ = "Load requested: " + action.value;
        }
        else if (action.name == synth::runtime_ui::Actions::kFileRevert)
        {
            runtime_.RevertPatch();
            fileStatus_ = "Revert requested";
        }
    }

    void RefreshControllers(synth::runtime_ui::ControllersPageSurface& surface)
    {
        surface.SetFocusGuard(focusGuard_);
        surface.SetEnumerateDevices(runtime_.MidiConnections().EnumerateNow());
        if (controllersDirty_)
        {
            surface.MarkDirty();
            controllersDirty_ = false;
        }
        surface.RefreshOnTick();
    }

    float DeadlineSamplePercent() const
    {
        return runtime_.DeadlineSamplePct();
    }

    void SaveRuntimeConfiguration()
    {
        runtime_.SaveRuntimeConfiguration();
    }

    void SetFocusGuard(std::function<bool()> guard)
    {
        focusGuard_ = std::move(guard);
    }

private:
    Runtime<App>& runtime_;
    std::function<bool()> focusGuard_;
    std::optional<std::string> audioStatus_;
    std::optional<std::string> fileStatus_;
    bool audioSyncPending_ = true;
    bool controllersDirty_ = true;
};

}  // namespace synth_runtime
