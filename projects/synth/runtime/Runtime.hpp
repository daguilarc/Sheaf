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
//
// Audio device selection (Task 3 of Plan 4): audioPanel_ (an AudioPanel,
// MidiPanel.hpp) is a read-only view + combo box over the same
// deviceManager_ this class drives as AudioIODeviceCallback target; the
// actual switch (AudioDeviceSetup mutation, setAudioDeviceSetup, logging) is
// implemented once, in ApplyAudioDeviceSelection(), and reached from two
// paths: (a) the user changing audioPanel_'s combo (wired to
// audioPanel_->onOutputSelected in the constructor) and (b) a startup or
// runtime patch changing the engine's audio device state (observed via
// engine.AudioDeviceSnapshot()), via
// engine_.SetAudioDeviceChangedCallback (wired in Start(), BEFORE
// Initialize() — see Start()'s doc comment for why the callback must
// tolerate firing before deviceManager_ is initialised).

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
        , midiPanel_(std::make_unique<MidiPanel<App>>(engine_))
        , audioPanel_(std::make_unique<AudioPanel<App>>(engine_, deviceManager_)) {
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

        // User-driven device switch: audioPanel_ is constructed above, in
        // this same initializer list, before this lambda can run, so
        // capturing `this` and calling straight into
        // ApplyAudioDeviceSelection is safe (same pattern as the
        // will-rebuild callback above).
        audioPanel_->onOutputSelected = [this](const juce::String& name) { ApplyAudioDeviceSelection(name); };

        // Input-device combo counterpart (Task 3 review, Minor): wired
        // identically to onOutputSelected above, just for the input device
        // name field. Only ever fires when audioPanel_ actually built an
        // input combo (App::Config().numAudioInputs > 0).
        audioPanel_->onInputSelected = [this](const juce::String& name) { ApplyAudioDeviceInputSelection(name); };
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
        audioPanel_.reset();
        INFO("Runtime shutting down: %s", engine_.Config().appName.c_str());
        synth::AsyncLogQueue::s_instance.DoLog();
    }

    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;
    Runtime(Runtime&&) = delete;
    Runtime& operator=(Runtime&&) = delete;

    // Startup ordering (binding, per Task 2/3/4 briefs):
    //   1. configure log directory (create it first) when non-empty
    //   2. wire onMidiProcessorsRebuilt_ to midiPanel_->ReopenPersistedEndpoints()
    //      (must precede Initialize(), since a startup-patch profile rebuild
    //      inside Initialize() invokes the rebuilt callback synchronously)
    //   2a. wire engine_.SetAudioDeviceChangedCallback to
    //       OnEngineAudioDeviceChanged (must also precede Initialize(), for
    //       the identical reason: a startup patch's drain inside
    //       Initialize() can change audioDeviceState_ and fire the callback
    //       synchronously, before deviceManager_ has been touched at all)
    //   3. engine_.Initialize()
    //   4. open the audio device, applying preferred rate/block where
    //      allowed, PREFERRING engine.AudioDeviceSnapshot().outputDeviceName
    //      over the platform default when it names a currently-enumerated device
    //      (Task 4 brief: this is what makes a startup-patch-carried device
    //      actually take effect, since step 2a's callback necessarily fires
    //      too early to open anything itself — see the callback's own doc
    //      comment for the full ordering rationale)
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

        // Wired before Initialize() for the identical reason (see Start()'s
        // doc comment, step 2a): a startup patch's drain inside Initialize()
        // can change audioDeviceState_ and fire this synchronously, before
        // deviceManager_.initialiseWithDefaultDevices() below has even run.
        // OnEngineAudioDeviceChanged tolerates that (see its own doc
        // comment) — it never assumes a current device exists.
        engine_.SetAudioDeviceChangedCallback([this] { OnEngineAudioDeviceChanged(); });

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

        const juce::String initialiseError =
            deviceManager_.initialiseWithDefaultDevices(config.numAudioInputs, config.numAudioOutputs);
        if (initialiseError.isNotEmpty()) {
            INFO("Audio device initialise FAILED: %s", initialiseError.toRawUTF8());
        }

        // Prefer a startup-patch-carried output device over the platform
        // default (Task 4 brief), but only when it's actually present among
        // the currently enumerated output devices — an absent device leaves
        // the just-initialised default device alone, no failure, matching
        // OnEngineAudioDeviceChanged's "absent -> keep current" contract.
        // engine_.AudioDeviceSnapshot() already holds the startup patch's
        // value here (Initialize() applied it above; OnEngineAudioDeviceChanged
        // fired too early, before deviceManager_ existed, to act on it itself —
        // see that method's doc comment).
        const juce::String wantedOutputName = juce::String(engine_.AudioDeviceSnapshot().outputDeviceName);
        if (wantedOutputName.isNotEmpty() && IsEnumeratedOutputDevice(wantedOutputName)) {
            SwitchOutputDevice(wantedOutputName, "startup");
        } else {
            ApplyPreferredRateAndBlockSize();
            if (wantedOutputName.isNotEmpty()) {
                const juce::String message = "audio device not found: " + wantedOutputName;
                INFO("%s", message.toRawUTF8());
                audioPanel_->SetStatus(message);
            }
        }

        // Apply startup-patch-carried input device (same contract as output,
        // above). config.numAudioInputs > 0 gates input selection availability.
        if (config.numAudioInputs > 0) {
            const juce::String wantedInputName = juce::String(engine_.AudioDeviceSnapshot().inputDeviceName);
            if (wantedInputName.isNotEmpty() && IsEnumeratedInputDevice(wantedInputName)) {
                juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
                setup.inputDeviceName = wantedInputName;
                const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
                if (setupError.isNotEmpty()) {
                    INFO("Audio input device startup switch FAILED: %s", setupError.toRawUTF8());
                }
                ApplyPreferredRateAndBlockSize();
            } else {
                if (wantedInputName.isNotEmpty()) {
                    const juce::String message = "audio input device not found: " + wantedInputName;
                    INFO("%s", message.toRawUTF8());
                    audioPanel_->SetStatus(message);
                }
            }
        }

        // Refresh() re-enumerates output devices and re-syncs the combo's
        // selection to engine.AudioDeviceSnapshot() as it now stands (post
        // startup-preference handling above). INFO-logged explicitly (not
        // just implied by the "Audio device switch"/"Audio device state"
        // lines above) so a session log has one unambiguous line confirming
        // the selector reflects startup state even on the "no startup
        // device, nothing to switch" path.
        audioPanel_->Refresh();
        const synth::AudioDeviceState startupAudioDeviceState = engine_.AudioDeviceSnapshot();
        INFO("Audio device selector startup sync: selected=%s",
             startupAudioDeviceState.outputDeviceName.empty() ? "System Default"
                                                                : startupAudioDeviceState.outputDeviceName.c_str());

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

    // The audio output-device selector panel (Task 3 of Plan 4): a
    // System-Default + enumerated-output-device combo and a status label.
    // The shell hosts this alongside MidiPanelComponent()/AppComponent().
    juce::Component& AudioPanelComponent() { return *audioPanel_; }

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

    // True when `name` is one of deviceManager_.getCurrentDeviceTypeObject()'s
    // enumerated output device names. Guards both the startup-preference path
    // in Start() and the runtime paths (ApplyAudioDeviceSelection,
    // OnEngineAudioDeviceChanged) against naming a device that isn't
    // currently present.
    bool IsEnumeratedOutputDevice(const juce::String& name) const {
        juce::AudioIODeviceType* deviceType = deviceManager_.getCurrentDeviceTypeObject();
        return deviceType != nullptr && deviceType->getDeviceNames(false).contains(name);
    }

    // Input-side counterpart of IsEnumeratedOutputDevice, used by
    // ApplyAudioDeviceInputSelection's absent-device handling.
    bool IsEnumeratedInputDevice(const juce::String& name) const {
        juce::AudioIODeviceType* deviceType = deviceManager_.getCurrentDeviceTypeObject();
        return deviceType != nullptr && deviceType->getDeviceNames(true).contains(name);
    }

    // Mutates the current AudioDeviceSetup's sampleRate/bufferSize to
    // config.preferredSampleRate/preferredBlockSize when the CURRENT device
    // supports them, and applies it via setAudioDeviceSetup — the same
    // preference logic Start() has always applied to the platform-default
    // device, factored out so SwitchOutputDevice() can re-apply it against
    // whatever device is current after a switch. Logs the setup error
    // string (if any) and the resulting open/playing state, matching the
    // existing instrumentation pattern (precedent commit adf0181).
    void ApplyPreferredRateAndBlockSize() {
        const synth::RuntimeConfig& config = engine_.Config();
        juce::AudioIODevice* device = deviceManager_.getCurrentAudioDevice();
        if (device == nullptr) {
            INFO("Audio device state: no current device");
            return;
        }
        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
        const juce::Array<double> availableRates = device->getAvailableSampleRates();
        if (availableRates.contains(config.preferredSampleRate)) {
            setup.sampleRate = config.preferredSampleRate;
        }
        const juce::Array<int> availableBufferSizes = device->getAvailableBufferSizes();
        if (availableBufferSizes.contains(config.preferredBlockSize)) {
            setup.bufferSize = config.preferredBlockSize;
        }
        const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
        if (setupError.isNotEmpty()) {
            INFO("Audio device setup FAILED: %s", setupError.toRawUTF8());
        }
        device = deviceManager_.getCurrentAudioDevice();
        if (device != nullptr) {
            INFO("Audio device state: open=%d playing=%d name=%s", device->isOpen() ? 1 : 0,
                 device->isPlaying() ? 1 : 0, device->getName().toRawUTF8());
        } else {
            INFO("Audio device state: no current device after setup");
        }
    }

    // Switches deviceManager_'s output device to `outputName` ("" for
    // System Default; a non-empty name must already be confirmed present
    // via IsEnumeratedOutputDevice) via AudioDeviceSetup.outputDeviceName +
    // setAudioDeviceSetup(..., true), logging the setup error string if
    // non-empty and the resulting open/playing state (precedent commit
    // adf0181). `reason` is a short tag ("startup"/"selection"/"patch")
    // folded into the log line so a session log distinguishes why a switch
    // happened. A successful switch re-fires audioDeviceAboutToStart (JUCE
    // calls it synchronously from setAudioDeviceSetup when the device
    // changes), which re-Prepares the engine automatically — no separate
    // Prepare() call needed here. Also re-applies the preferred rate/block
    // size against the newly current device, the same way Start() does for
    // the platform-default device.
    //
    // "System Default" resolution note: outputName=="" is NOT passed
    // through to AudioDeviceSetup.outputDeviceName verbatim.
    // AudioDeviceManager::setAudioDeviceSetup treats an AudioDeviceSetup
    // whose inputDeviceName AND outputDeviceName are BOTH empty as "no
    // device wanted" and deletes the current device outright (see its
    // implementation) rather than falling back to the platform default —
    // and inputDeviceName is legitimately empty whenever the app requests 0
    // input channels (the miniapp's case), so passing through an empty
    // outputDeviceName here would silently kill audio instead of selecting
    // the default output. Resolve "" to the concrete default output device
    // name (getCurrentDeviceTypeObject()->getDeviceNames(false)[
    // getDefaultDeviceIndex(false)]) first, so the setup we actually apply
    // always names a real device.
    void SwitchOutputDevice(const juce::String& outputName, const char* reason) {
        juce::String resolvedName = outputName;
        if (resolvedName.isEmpty()) {
            if (juce::AudioIODeviceType* deviceType = deviceManager_.getCurrentDeviceTypeObject();
                deviceType != nullptr) {
                const juce::StringArray names = deviceType->getDeviceNames(false);
                const int defaultIx = deviceType->getDefaultDeviceIndex(false);
                if (defaultIx >= 0 && defaultIx < names.size()) {
                    resolvedName = names[defaultIx];
                }
            }
        }
        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
        setup.outputDeviceName = resolvedName;
        const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
        if (setupError.isNotEmpty()) {
            INFO("Audio device switch (%s) FAILED: %s", reason, setupError.toRawUTF8());
        }
        juce::AudioIODevice* device = deviceManager_.getCurrentAudioDevice();
        if (device != nullptr) {
            INFO("Audio device switch (%s): open=%d playing=%d name=%s", reason, device->isOpen() ? 1 : 0,
                 device->isPlaying() ? 1 : 0, device->getName().toRawUTF8());
        } else {
            INFO("Audio device switch (%s): no current device after setup", reason);
        }
        ApplyPreferredRateAndBlockSize();
    }

    // audioPanel_->onOutputSelected's target: the user picked an output
    // device in the combo, on the message thread (JUCE combo box callbacks
    // run there). Records the selection via engine_.SetAudioDeviceFromHost
    // (so it persists into the next saved patch, mirroring how MidiPanel
    // writes engine_.Endpoints() on selection, AND advances the engine's
    // audio-device-state shadow so a later patch revert back to this exact
    // selection is correctly treated as "no change" -- see
    // SetAudioDeviceFromHost's doc comment; this replaces the old direct
    // `engine_.AudioDevice().outputDeviceName = ...` write, which left the
    // shadow stale and raced with the audio-thread patch drain -- Task 3
    // review findings 1/2) THEN applies the switch. "System Default" (empty
    // name) clears deviceManager_'s outputDeviceName preference the same
    // way, via the same AudioDeviceSetup path (an empty outputDeviceName +
    // useDefaultOutputDevice==false is what JUCE treats as "we picked no
    // explicit device" -- see AudioDeviceSetup's own doc comment); we
    // deliberately still route it through SwitchOutputDevice() rather than a
    // separate branch, so both cases get identical logging/rate/block
    // handling.
    void ApplyAudioDeviceSelection(const juce::String& outputName) {
        synth::AudioDeviceState newState = engine_.AudioDeviceSnapshot();
        newState.outputDeviceName = outputName.toStdString();
        engine_.SetAudioDeviceFromHost(newState);
        SwitchOutputDevice(outputName, "selection");
        audioPanel_->SetStatus(outputName.isEmpty() ? "Audio: System Default" : "Audio: " + outputName);
        audioPanel_->SyncSelection();
    }

    // audioPanel_->onInputSelected's target (Task 3 review, Minor): the user
    // picked an input device in the combo, on the message thread. Wired
    // identically to ApplyAudioDeviceSelection above, just for the input
    // device name field: records the selection via
    // engine_.SetAudioDeviceFromHost (same shadow-advancing rationale) then
    // applies it via AudioDeviceSetup.inputDeviceName + setAudioDeviceSetup,
    // with the same absent-device handling (an inputName not currently
    // enumerated is not applied; the status label reports it, matching
    // SwitchOutputDevice/OnEngineAudioDeviceChanged's "absent -> keep
    // current, no failure" contract). Unlike SwitchOutputDevice's "" ->
    // System Default resolution, an empty inputDeviceName does not need
    // special-casing here: setAudioDeviceSetup only deletes the current
    // device when BOTH inputDeviceName AND outputDeviceName are empty (see
    // its own implementation), and outputDeviceName here always carries
    // forward whatever the current setup already has (read via
    // getAudioDeviceSetup() below), so it's never simultaneously empty
    // except in the same already-handled "no device wanted" case
    // SwitchOutputDevice's own doc comment describes.
    void ApplyAudioDeviceInputSelection(const juce::String& inputName) {
        synth::AudioDeviceState newState = engine_.AudioDeviceSnapshot();
        newState.inputDeviceName = inputName.toStdString();
        engine_.SetAudioDeviceFromHost(newState);

        if (inputName.isNotEmpty() && !IsEnumeratedInputDevice(inputName)) {
            const juce::String message = "audio input device not found: " + inputName;
            INFO("%s", message.toRawUTF8());
            audioPanel_->SetStatus(message);
            audioPanel_->SyncSelection();
            return;
        }

        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
        setup.inputDeviceName = inputName;
        const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
        if (setupError.isNotEmpty()) {
            INFO("Audio input device switch (selection) FAILED: %s", setupError.toRawUTF8());
        }
        ApplyPreferredRateAndBlockSize();
        audioPanel_->SetStatus(inputName.isEmpty() ? "Audio In: System Default" : "Audio In: " + inputName);
        audioPanel_->SyncSelection();
    }

    // engine_.SetAudioDeviceChangedCallback's target (wired in Start(),
    // BEFORE engine_.Initialize() — see Start()'s doc comment). Invoked on
    // the message thread whenever a consumed patch message changed the
    // engine's audio device state, AFTER the state is fully applied
    // engine-side.
    //
    // Ordering hazard (binding, Task 4 brief): this callback can fire
    // DURING engine_.Initialize() itself (a startup patch's synchronous
    // drain), which runs BEFORE Start() has called
    // deviceManager_.initialiseWithDefaultDevices() — i.e. deviceManager_ has
    // no current device, possibly no current device TYPE, at all yet.
    // IsEnumeratedOutputDevice()/getCurrentAudioDevice() below tolerate that
    // (nullptr device type -> "not enumerated"; nullptr device -> logged and
    // skipped), so this callback never crashes or misbehaves when invoked
    // pre-device-open; it just can't actually switch anything yet in that
    // case. That's fine: Start()'s own device-open step (later in Start(),
    // after Initialize() returns) is what applies the startup-carried
    // device for real, by reading engine_.AudioDeviceSnapshot().outputDeviceName
    // itself once deviceManager_ exists (see the "Prefer a
    // startup-patch-carried output device" comment there) — this callback
    // firing early is a no-op in that case, not a missed update, because the
    // desired name is already recorded in the engine's audio device state
    // for Start() to read afterwards.
    //
    // For a RUNTIME patch load/revert (the callback firing after Start()
    // has completed and deviceManager_ is fully up), this callback is the
    // only path that applies the change — it behaves exactly like
    // ApplyAudioDeviceSelection's switch, just sourced from
    // engine.AudioDeviceSnapshot() instead of a combo pick, and does NOT
    // re-write the engine's audio device state (it's already the source of
    // truth here).
    void OnEngineAudioDeviceChanged() {
        const synth::AudioDeviceState state = engine_.AudioDeviceSnapshot();
        const juce::String outputName = juce::String(state.outputDeviceName);
        if (outputName.isEmpty()) {
            if (deviceManager_.getCurrentAudioDevice() != nullptr) {
                SwitchOutputDevice(outputName, "patch");
            }
            audioPanel_->SetStatus("Audio: System Default");
        } else if (!IsEnumeratedOutputDevice(outputName)) {
            // Pre-device-open case (see this method's doc comment) also
            // lands here (no device type yet -> "not enumerated"), which is
            // correct: nothing to log as missing yet, Start()'s device-open
            // step will find it. Distinguish the two by whether a device
            // manager is already up.
            if (deviceManager_.getCurrentAudioDevice() != nullptr) {
                const juce::String message = "audio device not found: " + outputName;
                INFO("%s", message.toRawUTF8());
                audioPanel_->SetStatus(message);
            }
        } else {
            SwitchOutputDevice(outputName, "patch");
            audioPanel_->SetStatus("Audio: " + outputName);
        }

        // Input-side counterpart (Task 3 review round 2, Minor): the old
        // implementation only ever applied outputDeviceName here, so a patch
        // that changed just the input device would sync the combo's display
        // (SyncSelection() below reads engine_.AudioDeviceSnapshot()
        // directly) without ever actually switching the input device on
        // deviceManager_. Apply it the same way ApplyAudioDeviceInputSelection
        // does, via the AudioDeviceSetup.inputDeviceName path, still tolerant
        // of the pre-device-open case (see this method's doc comment): an
        // empty deviceManager_ device type makes IsEnumeratedInputDevice
        // return false unconditionally, so this is a no-op until Start()'s
        // own device-open step runs.
        const juce::String inputName = juce::String(state.inputDeviceName);
        if (inputName.isEmpty() || IsEnumeratedInputDevice(inputName)) {
            if (deviceManager_.getCurrentAudioDevice() != nullptr) {
                juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
                if (setup.inputDeviceName != inputName) {
                    setup.inputDeviceName = inputName;
                    const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
                    if (setupError.isNotEmpty()) {
                        INFO("Audio input device switch (patch) FAILED: %s", setupError.toRawUTF8());
                    }
                    ApplyPreferredRateAndBlockSize();
                }
            }
        } else if (deviceManager_.getCurrentAudioDevice() != nullptr) {
            const juce::String message = "audio input device not found: " + inputName;
            INFO("%s", message.toRawUTF8());
            audioPanel_->SetStatus(message);
        }

        audioPanel_->SyncSelection();
    }

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

    // The audio output-device selector panel (Task 3 of Plan 4). Same
    // unique_ptr rationale as midiPanel_: constructed after engine_ AND
    // deviceManager_ (it holds references to both), destroyed before either
    // is torn down.
    std::unique_ptr<AudioPanel<App>> audioPanel_;

    // Forwards to midiPanel_->ReopenPersistedEndpoints() (wired in Start(),
    // before Initialize()) so the panel reopens MIDI endpoints whenever the
    // engine rebuilds MIDI processors.
    std::function<void()> onMidiProcessorsRebuilt_;

    // Shell hook: set later by whatever owns the UI, invoked at the end of
    // every timer tick so the app's component(s) can repaint.
    std::function<void()> repaintHook_;
};

}  // namespace synth_runtime
