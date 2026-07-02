#pragma once

// synth_runtime::Runtime — the JUCE-side host shell over synth::Engine<App>
// (sar-7 and later). Owns the audio device, drives the engine's audio-thread
// block pump from AudioIODeviceCallback, drives the engine's message-thread
// tick from a juce::Timer, and forwards patch commands from chrome (menu
// items, buttons) to the engine's PatchManager, INFO-logging each result.
//
// Startup/shutdown ordering here is binding; see the Task 2 brief
// (.superpowers/sdd/p3-task-2-brief.md) for the full rationale. MIDI
// endpoint (re)opening is Task 3's responsibility: this class only exposes
// the named hook (onMidiProcessorsRebuilt_) that Task 3's panel wires up to
// reopen endpoints whenever the engine rebuilds MIDI processors.

#include "synth/AppConcepts.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/Engine.hpp"
#include "synth/PatchPersistence.hpp"
#include "synth/ThreadId.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>

namespace synth_runtime {

namespace detail {

inline const char* PatchCommandStatusName(synth::PatchCommandStatus status) {
    switch (status) {
    case synth::PatchCommandStatus::Ok:
        return "Ok";
    case synth::PatchCommandStatus::Pending:
        return "Pending";
    case synth::PatchCommandStatus::NoCompletion:
        return "NoCompletion";
    case synth::PatchCommandStatus::Written:
        return "Written";
    case synth::PatchCommandStatus::NeedsSaveAsPath:
        return "NeedsSaveAsPath";
    case synth::PatchCommandStatus::Busy:
        return "Busy";
    case synth::PatchCommandStatus::AlreadyExists:
        return "AlreadyExists";
    case synth::PatchCommandStatus::NotFound:
        return "NotFound";
    case synth::PatchCommandStatus::InvalidPatch:
        return "InvalidPatch";
    case synth::PatchCommandStatus::QueueFull:
        return "QueueFull";
    case synth::PatchCommandStatus::IOError:
        return "IOError";
    }
    return "Unknown";
}

}  // namespace detail

template <synth::SynthApplication App>
class Runtime : private juce::AudioIODeviceCallback, private juce::Timer {
public:
    Runtime()
        : startTime_(std::chrono::steady_clock::now())
        , engine_([this]() -> std::uint64_t { return NowMicros(); }) {
        // Named hook Task 3 forwards to the MIDI panel: the engine invokes
        // this (on the message thread, from MessageThreadTick or the
        // startup-patch path in Initialize()) whenever midiProcessors_ has
        // just been rebuilt, so the panel knows to reopen endpoints against
        // the fresh profile.
        engine_.SetMidiProcessorsRebuiltCallback([this] {
            if (onMidiProcessorsRebuilt_) {
                onMidiProcessorsRebuilt_();
            }
        });
    }

    ~Runtime() override {
        deviceManager_.removeAudioCallback(this);
        stopTimer();
        // engine_ teardown (its own destructor) handles the MIDI sender via
        // its members; closing MIDI devices is Task 3's panel concern.
        synth::AsyncLogQueue::s_instance.DoLog();
    }

    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;
    Runtime(Runtime&&) = delete;
    Runtime& operator=(Runtime&&) = delete;

    // Startup ordering (binding, per Task 2 brief):
    //   1. configure log directory (create it first) when non-empty
    //   2. engine_.Initialize()
    //   3. MIDI endpoint reopen — Task 3 wires this via onMidiProcessorsRebuilt_
    //   4. open the audio device, applying preferred rate/block where allowed
    //   5. Prepare the engine via audioDeviceAboutToStart
    //   6. register this as the audio callback
    //   7. start the UI timer
    void Start() {
        // engine_.Config() only becomes valid once Initialize() has stored
        // it, so read the log directory from App::Config() directly first —
        // it must be created before Initialize() runs, since Initialize()
        // is what first touches AsyncLogQueue::s_instance (via
        // SetSampleCounterSource/INFO).
        const synth::RuntimeConfig appConfig = App::Config();
        if (!appConfig.logsRoot.empty()) {
            std::error_code ec;
            std::filesystem::create_directories(appConfig.logsRoot, ec);
            synth::AsyncLogQueue::s_instance.ConfigureLogDirectory(appConfig.logsRoot.string().c_str());
        }

        engine_.Initialize();
        const synth::RuntimeConfig& config = engine_.Config();

        // MIDI endpoint reopen is Task 3's responsibility: the panel sets
        // onMidiProcessorsRebuilt_ (forwarded to the engine's rebuilt
        // callback in the constructor above) and reopens endpoints from it.

        deviceManager_.initialiseWithDefaultDevices(config.numAudioInputs, config.numAudioOutputs);

        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
        if (juce::AudioIODevice* device = deviceManager_.getCurrentAudioDevice(); device != nullptr) {
            const juce::Array<double> availableRates = device->getAvailableSampleRates();
            if (availableRates.contains(config.preferredSampleRate)) {
                setup.sampleRate = config.preferredSampleRate;
            }
            const juce::Array<int> availableBufferSizes = device->getAvailableBufferSizes();
            if (availableBufferSizes.contains(config.preferredBlockSize)) {
                setup.bufferSize = config.preferredBlockSize;
            }
            deviceManager_.setAudioDeviceSetup(setup, true);
        }

        // addAudioCallback() invokes audioDeviceAboutToStart(currentDevice)
        // synchronously here (the device is already open), which is what
        // actually calls engine_.Prepare() with the negotiated rate/block.
        deviceManager_.addAudioCallback(this);

        startTimerHz(config.uiFrameHz > 0 ? config.uiFrameHz : 30);
    }

    synth::Engine<App>& GetEngine() { return engine_; }

    juce::Component& AppComponent() { return engine_.Application().UIComponent(); }

    void NewPatch() {
        const synth::PatchCommandResult result = engine_.Patches().NewPatch();
        LogPatchCommand("NewPatch", result);
    }

    void SavePatch() {
        const synth::PatchCommandResult result = engine_.Patches().SavePatch();
        LogPatchCommand("SavePatch", result);
    }

    void SavePatchAs(const juce::File& file) {
        const synth::PatchCommandResult result =
            engine_.Patches().SavePatchAs(std::filesystem::path(file.getFullPathName().toStdString()));
        LogPatchCommand("SavePatchAs", result);
    }

    void LoadPatch(const juce::File& file) {
        const synth::PatchCommandResult result =
            engine_.Patches().LoadPatch(std::filesystem::path(file.getFullPathName().toStdString()));
        LogPatchCommand("LoadPatch", result);
    }

    void RevertPatch() {
        const synth::PatchCommandResult result = engine_.Patches().RevertPatch();
        LogPatchCommand("RevertPatch", result);
    }

private:
    void audioDeviceIOCallbackWithContext(const float* const* inputChannelData, int numInputChannels,
                                          float* const* outputChannelData, int numOutputChannels, int numSamples,
                                          const juce::AudioIODeviceCallbackContext&) override {
        synth::ScopedThreadId tag(synth::ThreadId::Audio);
        synth::AudioBlock block{
            .inputs = inputChannelData,
            .outputs = outputChannelData,
            .numInputChannels = numInputChannels,
            .numOutputChannels = numOutputChannels,
            .numFrames = static_cast<std::size_t>(numSamples),
        };
        engine_.ProcessBlock(block, NowMicros());
    }

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override {
        if (device != nullptr) {
            engine_.Prepare(device->getCurrentSampleRate(), device->getCurrentBufferSizeSamples());
        }
    }

    void audioDeviceStopped() override {}

    // Timer tick order (binding): engine message-thread tick -> repaint hook
    // -> DoLog() last. MIDI endpoint management is delegated to the panel
    // (Task 3), driven off onMidiProcessorsRebuilt_.
    void timerCallback() override {
        engine_.MessageThreadTick();
        if (repaintHook_) {
            repaintHook_();
        }
        synth::AsyncLogQueue::s_instance.DoLog();
    }

    std::uint64_t NowMicros() const {
        return static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - startTime_)
                .count());
    }

    void LogPatchCommand(const char* action, const synth::PatchCommandResult& result) {
        INFO("%s status=%s requestId=%llu", action, detail::PatchCommandStatusName(result.status),
             static_cast<unsigned long long>(result.requestId));
    }

    // Declared before engine_ so it is initialized first: engine_'s
    // TimestampProvider lambda captures `this` and reads startTime_ on
    // every call, so startTime_ must already hold a valid value by the time
    // the engine can possibly invoke it (audio never starts before
    // Start() completes, well after construction).
    std::chrono::steady_clock::time_point startTime_;
    juce::AudioDeviceManager deviceManager_;
    synth::Engine<App> engine_;

    // Task 3 hook: forwards to the panel so it can reopen MIDI endpoints
    // whenever the engine rebuilds MIDI processors.
    std::function<void()> onMidiProcessorsRebuilt_;

    // Shell hook: set later by whatever owns the UI, invoked at the end of
    // every timer tick so the app's component(s) can repaint.
    std::function<void()> repaintHook_;
};

}  // namespace synth_runtime
