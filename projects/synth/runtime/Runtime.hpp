#pragma once

// synth_runtime::Runtime — the JUCE-side host shell over synth::Engine<App>
// (sar-7 and later). Owns the audio device, drives the engine's audio-thread
// block pump from AudioIODeviceCallback, drives the engine's message-thread
// tick from a juce::Timer, and forwards patch commands from chrome (menu
// items, buttons) to the engine's PatchManager, INFO-logging each result.
//
// Startup/shutdown ordering here is binding; see the Task 2 brief
// (.superpowers/sdd/p3-task-2-brief.md) for the full rationale. MIDI
// endpoint (re)opening is owned by the MidiPanel member (midiPanel_, Task 3):
// engine.SetMidiProcessorsWillRebuildCallback forwards directly to
// midiPanel_->OnMidiProcessorsWillRebuild() (detaching the panel's
// forwarding processor before the engine destroys the current MIDI
// processor chain), and onMidiProcessorsRebuilt_ forwards to
// midiPanel_->ReopenPersistedEndpoints() (re-attaching against the fresh
// chain and reopening the endpoints recorded in engine.Endpoints()) so a
// startup-patch or runtime-load profile rebuild never leaves a MIDI
// callback pointing into a destroyed processor chain.

#include "synth/AppConcepts.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/Engine.hpp"
#include "synth/PatchPersistence.hpp"
#include "synth/ThreadId.hpp"

#include "MidiPanel.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime : private juce::AudioIODeviceCallback, private juce::Timer {
public:
    Runtime()
        : startTime_(std::chrono::steady_clock::now())
        , engine_([this]() -> std::uint64_t { return NowMicros(); })
        , midiPanel_(std::make_unique<MidiPanel<App>>(engine_)) {
        // The engine invokes this synchronously, on whichever thread is
        // performing a rebuild, immediately BEFORE midiProcessors_ is
        // destroyed/replaced (Initialize()'s rebuilds and
        // MessageThreadTick()'s rebuild all funnel through
        // Engine::RebuildMidiProcessors()). Forwarding straight to
        // midiPanel_ (rather than through a std::function indirection like
        // onMidiProcessorsRebuilt_) is safe here because midiPanel_ is
        // constructed above, in this same initializer list, before this
        // lambda can ever run.
        engine_.SetMidiProcessorsWillRebuildCallback([this] { midiPanel_->OnMidiProcessorsWillRebuild(); });

        // The engine invokes this (on the message thread, from
        // MessageThreadTick or the startup-patch path in Initialize())
        // whenever midiProcessors_ has just been rebuilt.
        // onMidiProcessorsRebuilt_ (wired in Start(), before Initialize())
        // forwards this to midiPanel_->ReopenPersistedEndpoints().
        engine_.SetMidiProcessorsRebuiltCallback([this] {
            if (onMidiProcessorsRebuilt_) {
                onMidiProcessorsRebuilt_();
            }
        });
    }

    ~Runtime() override {
        deviceManager_.removeAudioCallback(this);
        stopTimer();
        // Shutdown ordering (binding, per Task 3 brief): stop the MIDI
        // sender before closing devices, so no in-flight enqueued MIDI is
        // delivered to a sink that's about to be torn down; midiPanel_'s own
        // destructor then closes the input/output devices.
        if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
            sender->Stop();
        }
        midiPanel_.reset();
        INFO("Runtime shutting down: %s", engine_.Config().appName.c_str());
        synth::AsyncLogQueue::s_instance.DoLog();
    }

    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;
    Runtime(Runtime&&) = delete;
    Runtime& operator=(Runtime&&) = delete;

    // Startup ordering (binding, per Task 2/3 briefs):
    //   1. configure log directory (create it first) when non-empty
    //   2. wire onMidiProcessorsRebuilt_ to midiPanel_->ReopenPersistedEndpoints()
    //      (must precede Initialize(), since a startup-patch profile rebuild
    //      inside Initialize() invokes the rebuilt callback synchronously)
    //   3. engine_.Initialize()
    //   4. open the audio device, applying preferred rate/block where allowed
    //   5. start the MidiSender worker (before the audio callback is
    //      registered, so the sink is draining before ProcessBlock/MIDI
    //      output processors can enqueue into it)
    //   6. Prepare the engine via audioDeviceAboutToStart
    //   7. register this as the audio callback
    //   8. start the UI timer
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

        // Wired before Initialize(): Initialize()'s startup-patch path may
        // rebuild MIDI processors and invoke midiProcessorsRebuiltCallback_
        // synchronously, and the panel must be ready to reopen endpoints
        // against the freshly loaded profile when that happens.
        onMidiProcessorsRebuilt_ = [this] { midiPanel_->ReopenPersistedEndpoints(); };

        engine_.Initialize();
        INFO("Runtime started: %s", appConfig.appName.c_str());
        const synth::RuntimeConfig& config = engine_.Config();

        // Initialize()'s FIRST RebuildMidiProcessors() call (before any
        // startup patch) is silent by design — it never invokes
        // midiProcessorsRebuiltCallback_ (see Engine::Initialize's doc
        // comment) — so when no startup patch applies, the panel is never
        // notified and midiPanel_'s cached MidiInputProcessor() pointer
        // would otherwise stay null forever. Reopening unconditionally here
        // (idempotent: it re-reads MidiInputProcessor() and re-syncs against
        // whatever engine_.Endpoints() currently holds even if a startup
        // patch already triggered a reopen) matches the old miniapp's
        // always-reopen-at-startup behavior.
        midiPanel_->ReopenPersistedEndpoints();

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

        if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
            sender->Start();
        }

        // addAudioCallback() invokes audioDeviceAboutToStart(currentDevice)
        // synchronously here (the device is already open), which is what
        // actually calls engine_.Prepare() with the negotiated rate/block.
        deviceManager_.addAudioCallback(this);

        startTimerHz(config.uiFrameHz > 0 ? config.uiFrameHz : 30);
    }

    synth::Engine<App>& GetEngine() { return engine_; }

    juce::Component& AppComponent() { return engine_.Application().UIComponent(); }

    // The MIDI device panel (Task 3): device combo boxes, open/close
    // buttons, and a status label. The shell (next task) hosts this
    // component alongside AppComponent().
    juce::Component& MidiPanelComponent() { return *midiPanel_; }

    // Installs the shell's repaint hook (Task 4): invoked at the end of
    // every timer tick, after the message-thread tick and before DoLog(),
    // so the shell can repaint itself and the app component in lockstep
    // with the engine's UI-state refresh.
    void SetRepaintHook(std::function<void()> hook) { repaintHook_ = std::move(hook); }

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
            double sampleRate = device->getCurrentSampleRate();
            int blockSize = device->getCurrentBufferSizeSamples();
            engine_.Prepare(sampleRate, blockSize);
            int numInputChannels = device->getActiveInputChannels().countNumberOfSetBits();
            int numOutputChannels = device->getActiveOutputChannels().countNumberOfSetBits();
            INFO("Audio prepared: %.0f Hz, %d frames, %d in / %d out", sampleRate, blockSize, numInputChannels, numOutputChannels);
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
        INFO("%s status=%s requestId=%llu", action, synth::PatchCommandStatusName(result.status),
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

    // The MIDI device panel (Task 3). A unique_ptr because it must be
    // constructed after engine_ (it holds a reference to it) and destroyed
    // before engine_ is torn down; declaring it after engine_ gives it the
    // correct construction/destruction order automatically.
    std::unique_ptr<MidiPanel<App>> midiPanel_;

    // Forwards to midiPanel_->ReopenPersistedEndpoints() (wired in Start(),
    // before Initialize()) so the panel reopens MIDI endpoints whenever the
    // engine rebuilds MIDI processors.
    std::function<void()> onMidiProcessorsRebuilt_;

    // Shell hook: set later by whatever owns the UI, invoked at the end of
    // every timer tick so the app's component(s) can repaint.
    std::function<void()> repaintHook_;
};

}  // namespace synth_runtime
