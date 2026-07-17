#pragma once

// synth_runtime::Runtime — the JUCE-side host shell over synth::Engine<App>
// (sar-7 and later). Owns the audio device, drives the engine's audio-thread
// block pump from AudioIODeviceCallback, drives the engine's message-thread
// tick from a juce::Timer, and forwards patch commands from chrome (menu
// items, buttons) to the engine's PatchManager, INFO-logging each result.
//
// Startup/shutdown ordering here is binding; see the Task 2 brief
// (.superpowers/sdd/p3-task-2-brief.md) for the full rationale. MIDI
// connection lifecycle (device open/close/offline/resync, per controller
// slot including slot 0) is owned by midiConnections_ (a
// MidiConnectionManager<App>, Task 2 of Plan 3):
// engine.SetMidiProcessorsWillRebuildCallback forwards to
// midiConnections_->OnMidiProcessorsWillRebuild() (detaching every
// controller's forwarding processor before the engine destroys the current
// MIDI processor chain), and the rebuilt callback forwards to
// midiConnections_->OnInstrumentRebuilt() (resizing to the current
// controller count, reinstalling forwarding, and running one reconcile pass)
// -- see MidiConnectionManager.hpp's class doc comment for why the manager
// owns every controller's handlers/sink registration. Runtime's
// message-thread timer also drives midiConnections_->OnTimerTick() (the
// self-healing poll-driven reconcile path) every tick, and Start() calls
// midiConnections_->StartupReconcile() once after Initialize() (which starts
// the background device-list poller). As of Task 4 of Plan 4, Runtime owns
// no MIDI UI component at all -- MidiConnections() exposes midiConnections_
// directly so the shared ControllersPageSurface can read
// EnumerateNow()/State() to populate its combos/status dots, the same way
// AudioConfigPage reads DeviceManager() directly. ControllersPageSurface never
// calls into midiConnections_ to open/close a device itself, though (Task 4
// review, Important finding 3): every device combo change writes through
// synth::MidiConfigViewModel::SetEndpointRef and commits via
// engine.EditInstrument, exactly like every other edit on that page; the
// rebuilt callback below (SetMidiProcessorsRebuiltHook) is what lets the
// page notice ANY runtime-config/instrument change -- including a
// reconcile-driven ref rewrite -- and re-derive its view model.
//
// Audio device selection (Task 3 of Plan 4): the actual switch
// (AudioDeviceSetup mutation, setAudioDeviceSetup, logging) is implemented
// once, in ApplyAudioDeviceSelection()/ApplyAudioDeviceInputSelection(), and
// reached from the user changing AudioConfigPage's combo
// (AudioConfigPage.hpp calls these methods straight from its combo's
// onChange). Runtime configuration loading will seed the engine's audio
// device state separately from patch data.
//
// Runtime no longer owns a UI component for this (Task 3 of Plan 4 deleted
// AudioPanel): it exposes DeviceManager() so AudioConfigPage can read
// device names directly, and two host hooks --
// SetAudioStatusHook()/SetAudioSyncHook() -- that AudioConfigPage installs
// on construction so Runtime can push status text and "re-sync your combo
// selection" notifications to whichever page instance is currently alive,
// without Runtime holding a reference to it (MainPane/pages are constructed
// after Runtime, and can be torn down/rebuilt independently of it).
//
// Runtime owns persistent data paths. Production apps resolve an
// OS-appropriate user application data root under Sheaf/<appName>, then use
// RuntimeDataPaths children for patches/, logs/, and config.json. Patch
// documents stay parameter-only; runtime configuration stores MIDI and audio
// selection separately in config.json and is saved from the configuration-page
// Back flows.
//
// MidiPanel retirement (Task 4 of Plan 4): the single-slot MidiPanel
// component is deleted -- ControllersPage.hpp (a thin JUCE renderer over the
// JUCE-free synth::MidiConfigViewModel) replaces its device-selection role
// with a genuinely per-controller UI, and its old preset combo is gone
// entirely (kind defaults are now seeded via ControllersPage's "+" row, per
// spm-37). Runtime no longer owns a MidiPanel instance; it exposes
// MidiConnections() so ControllersPage can read EnumerateNow()/State() for
// display, the same way AudioConfigPage reads DeviceManager() directly
// instead of Runtime owning AudioPanel -- all WRITES (device selection,
// mapping edits, adding a controller) go through
// synth::MidiConfigViewModel + engine.EditInstrument instead (see the
// paragraph above and SetMidiProcessorsRebuiltHook's doc comment below).

#include "synth/AppConcepts.hpp"
#include "synth/AsyncLogger.hpp"
#include "synth/Engine.hpp"
#include "synth/PatchPersistence.hpp"
#include "synth/PortableUI.hpp"
#include "synth/ThreadId.hpp"

#include "HostDataPaths.hpp"
#include "MidiConnectionManager.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime : private juce::AudioIODeviceCallback, private juce::Timer {
public:
    Runtime()
        : startTime_(std::chrono::steady_clock::now())
        , engine_([this]() -> std::uint64_t { return NowMicros(); })
        , midiConnections_(std::make_unique<MidiConnectionManager<App>>(engine_)) {
        // The engine invokes this synchronously, on whichever thread is
        // performing a rebuild, immediately BEFORE midiProcessors_ is
        // destroyed/replaced (Initialize()'s rebuilds and
        // MessageThreadTick()'s rebuild all funnel through
        // Engine::RebuildMidiProcessors()). Forwarding straight to
        // midiConnections_ (rather than through a std::function indirection
        // like onMidiProcessorsRebuilt_) is safe here because midiConnections_
        // is constructed above, in this same initializer list, before this
        // lambda can ever run.
        engine_.SetMidiProcessorsWillRebuildCallback([this] { midiConnections_->OnMidiProcessorsWillRebuild(); });

        // The engine invokes this (on the message thread, from
        // EditInstrument whenever midiProcessors_ has just been rebuilt.
        // midiConnections_->OnInstrumentRebuilt() resizes to the current
        // controller count, reinstalls forwarding, and runs one reconcile
        // pass (sar-8) -- the same executor path the timer-driven poll uses.
        // onMidiProcessorsRebuilt_ (wired by MainPane via
        // SetMidiProcessorsRebuiltHook(), see that method's doc comment) is
        // ControllersPage's subscription to EVERY rebuild -- not just its
        // own edits -- so runtime-config or other engine-driven instrument
        // changes also mark the page dirty (Task 4 review, Critical finding 1:
        // a page that only dirtied on its own commits or a connection-status
        // fingerprint missed exactly this class of change, letting a later edit
        // commit from a stale snapshot).
        engine_.SetMidiProcessorsRebuiltCallback([this] {
            midiConnections_->OnInstrumentRebuilt();
            if (onMidiProcessorsRebuilt_) {
                onMidiProcessorsRebuilt_();
            }
        });
    }

    ~Runtime() override {
        deviceManager_.removeAudioCallback(this);
        stopTimer();
        // Shutdown ordering (binding, per Task 2/3 briefs): stop the MIDI
        // sender before closing devices, so no in-flight enqueued MIDI is
        // delivered to a sink that's about to be torn down, THEN
        // midiConnections_'s own destructor stops/joins its poller BEFORE
        // closing any device handler (binding, per p3-globals.md: "Shutdown
        // stops/joins the poller before closing devices").
        if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
            sender->Stop();
        }
        midiConnections_.reset();
        INFO("Runtime shutting down: %s", engine_.Config().appName.c_str());
        synth::AsyncLogQueue::s_instance.DoLog();
    }

    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;
    Runtime(Runtime&&) = delete;
    Runtime& operator=(Runtime&&) = delete;

    static synth::RuntimeDataPaths DefaultDataPathsForApp(const synth::RuntimeConfig& config) {
        return synth_runtime::DefaultDataPathsForApp(config);
    }

    void SetRuntimeDataPathsOverride(synth::RuntimeDataPaths paths) { dataPathsOverride_ = std::move(paths); }
    const synth::RuntimeDataPaths& DataPaths() const { return dataPaths_; }

    // Startup ordering (binding, per Task 2/3/4 briefs):
    //   1. resolve/create runtime data paths and configure log directory
    //   2a. wire engine_.SetAudioDeviceChangedCallback to
    //       OnEngineAudioDeviceChanged for future runtime-config-initiated
    //       audio changes
    //   3. engine_.Initialize()
    //   4. open the audio device, applying preferred rate/block where
    //      allowed, PREFERRING engine.AudioDeviceSnapshot().outputDeviceName
    //      over the platform default when it names a currently-enumerated device
    //      (runtime configuration seeds this value before device open)
    //   5. start the MidiSender worker (before the audio callback is
    //      registered, so the sink is draining before ProcessBlock/MIDI
    //      output processors can enqueue into it)
    //   6. Prepare the engine via audioDeviceAboutToStart
    //   7. register this as the audio callback
    //   8. start the UI timer
    void Start() {
        const synth::RuntimeConfig appConfig = App::Config();
        dataPaths_ = dataPathsOverride_.has_value() ? *dataPathsOverride_ : DefaultDataPathsForApp(appConfig);
        synth::AsyncLogQueue::s_instance.ConfigureLogDirectory(dataPaths_.logsRoot.string().c_str());
        std::error_code ec;
        std::filesystem::create_directories(dataPaths_.dataRoot, ec);
        if (ec) {
            INFO("Runtime data root create FAILED: path=%s error=%s", dataPaths_.dataRoot.string().c_str(),
                 ec.message().c_str());
        }
        ec.clear();
        std::filesystem::create_directories(dataPaths_.patchesRoot, ec);
        if (ec) {
            INFO("Runtime patches root create FAILED: path=%s error=%s", dataPaths_.patchesRoot.string().c_str(),
                 ec.message().c_str());
        }
        ec.clear();
        std::filesystem::create_directories(dataPaths_.logsRoot, ec);
        if (ec) {
            INFO("Runtime logs root create FAILED: path=%s error=%s", dataPaths_.logsRoot.string().c_str(),
                 ec.message().c_str());
        }
        engine_.SetRuntimeDataPaths(dataPaths_);

        // Wired before Initialize() so future runtime-config-initiated audio
        // changes can be applied through the same host path. Patch load/revert
        // is parameter-only and never fires this callback.
        engine_.SetAudioDeviceChangedCallback([this] { OnEngineAudioDeviceChanged(); });

        engine_.Initialize();
        INFO("Runtime started: %s", appConfig.appName.c_str());
        const synth::RuntimeConfig& config = engine_.Config();

        // Startup order (sar-5, binding, per p3-globals.md): engine init ->
        // startup/runtime config applied -> ONE synchronous reconcile ->
        // start poller -> audio device -> ... StartupReconcile() is that
        // synchronous reconcile: it resizes midiConnections_ to the current
        // controller count, reconciles every configured ref against
        // currently-present devices (absent -> offline, never a startup
        // failure), and starts the background poller. Called unconditionally
        // here (idempotent, same as the old always-reopen-at-startup behavior)
        // because Initialize()'s first RebuildMidiProcessors() call is silent
        // by design — it never invokes midiProcessorsRebuiltCallback_ (see
        // Engine::Initialize's doc comment) — so midiConnections_ is never
        // notified during startup and its handler vectors would otherwise stay
        // unsized.
        midiConnections_->StartupReconcile();

        const juce::String initialiseError =
            deviceManager_.initialiseWithDefaultDevices(config.numAudioInputs, config.numAudioOutputs);
        if (initialiseError.isNotEmpty()) {
            INFO("Audio device initialise FAILED: %s", initialiseError.toRawUTF8());
        }

        // Prefer the persisted output device over the platform default, but
        // only when it's actually present among
        // the currently enumerated output devices — an absent device leaves
        // the just-initialised default device alone, no failure, matching
        // OnEngineAudioDeviceChanged's "absent -> keep current" contract.
        const juce::String wantedOutputName = juce::String(engine_.AudioDeviceSnapshot().outputDeviceName);
        if (wantedOutputName.isNotEmpty() && IsEnumeratedOutputDevice(wantedOutputName)) {
            SwitchOutputDevice(wantedOutputName, "startup");
        } else {
            ApplyPreferredRateAndBlockSize();
            if (wantedOutputName.isNotEmpty()) {
                const juce::String message = "audio device not found: " + wantedOutputName;
                INFO("%s", message.toRawUTF8());
                SetAudioStatus(message);
            }
        }

        // Apply persisted input device (same contract as output, above).
        // config.numAudioInputs > 0 gates input selection availability.
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
                    SetAudioStatus(message);
                }
            }
        }

        // SyncAudioSelection() notifies AudioConfigPage (if one is alive) to
        // re-enumerate devices and re-sync its combo's selection to
        // engine.AudioDeviceSnapshot() as it now stands (post
        // startup-preference handling above). INFO-logged explicitly (not
        // just implied by the "Audio device switch"/"Audio device state"
        // lines above) so a session log has one unambiguous line confirming
        // the selector reflects startup state even on the "no startup
        // device, nothing to switch" path.
        SyncAudioSelection();
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

    synth::ui::Surface& AppSurface() { return engine_.Application().PortableSurface(); }

    // The per-controller MIDI connection owner (Task 4 of Plan 4):
    // ControllersPage's device combo onChange → view-model SetEndpointRef()
    // → engine.EditInstrument() commit → MIDI processors rebuilt callback →
    // MidiConnectionManager reconciles opens/closes the device as needed,
    // mirroring how engine.SetAudioDeviceFromHost works for the audio path
    // (see ApplyAudioDeviceSelection's doc comment).
    MidiConnectionManager<App>& MidiConnections() { return *midiConnections_; }

    // The JUCE audio device manager this Runtime drives as
    // AudioIODeviceCallback target (Task 3 of Plan 4): AudioConfigPage reads
    // it directly (getCurrentDeviceTypeObject()->getDeviceNames(...)) to
    // populate its combo boxes, the same enumeration AudioPanel used to do
    // internally before this task deleted it.
    juce::AudioDeviceManager& DeviceManager() { return deviceManager_; }

    // Installs AudioConfigPage's status sink (Task 3 of Plan 4): invoked by
    // Runtime's own device-switch paths (Start()'s startup preference
    // handling, ApplyAudioDeviceSelection, ApplyAudioDeviceInputSelection,
    // OnEngineAudioDeviceChanged) with human-readable status text whenever
    // one of those paths has something to report. AudioConfigPage installs
    // this on construction and clears it (via an empty std::function) from
    // its destructor, so Runtime never calls into a destroyed page -- see
    // AudioConfigPage.hpp.
    void SetAudioStatusHook(std::function<void(const juce::String&)> hook) { audioStatusHook_ = std::move(hook); }

    // Installs AudioConfigPage's re-sync hook (Task 3 of Plan 4): invoked
    // whenever Runtime has changed the audio device state out from under a
    // live page (startup preference handling or OnEngineAudioDeviceChanged)
    // so the page can re-enumerate devices
    // and re-select the combo entry matching engine.AudioDeviceSnapshot()
    // without applying anything itself (no device switch, no notification --
    // mirrors AudioPanel::SyncSelection's old contract). Cleared the same
    // way as the status hook.
    void SetAudioSyncHook(std::function<void()> hook) { audioSyncHook_ = std::move(hook); }

    // Installs ControllersPage's rebuild-notification hook (Task 4 review,
    // Critical finding 1): invoked at the end of
    // engine_.SetMidiProcessorsRebuiltCallback's lambda (constructor, above),
    // i.e. on EVERY MIDI-processor rebuild -- not just ones ControllersPage's
    // own edits triggered. This is what closes the "missed instrument
    // changes" gap: runtime-config or any other engine-driven edit path that
    // changes controller mappings/names/kinds also rebuilds MIDI processors and
    // fires this hook, so ControllersPage can mark itself dirty regardless of
    // who caused the rebuild. Re-entrancy: when
    // ControllersPage's OWN Commit() is what triggered this rebuild, the hook
    // still fires and sets dirty_ again -- harmless, since dirty_ is a plain
    // idempotent bool the page already sets itself in Commit() (see
    // ControllersPage.hpp's Commit() doc comment). Cleared the same way as
    // the audio hooks (an empty std::function on page teardown), via
    // ControllersPage's destructor.
    void SetMidiProcessorsRebuiltHook(std::function<void()> hook) { onMidiProcessorsRebuilt_ = std::move(hook); }

    // AudioConfigPage's output combo onChange target (sar-15 semantics
    // unchanged from the deleted AudioPanel::onOutputSelected path): the
    // user picked an output device in the combo, on the message thread
    // (JUCE combo box callbacks run there). Records the selection via
    // engine_.SetAudioDeviceFromHost (so it persists into the next saved
    // runtime configuration, mirroring how ControllersPage records endpoint selection into
    // the engine's instrument via synth::MidiConfigViewModel::SetEndpointRef
    // + EditInstrument), AND advances the engine's
    // audio-device-state shadow so a later engine-side sync to this exact
    // selection is correctly treated as "already known" -- see
    // SetAudioDeviceFromHost's doc comment; this replaces the old direct
    // `engine_.AudioDevice().outputDeviceName = ...` write, which left the
    // shadow stale -- Task 3 review findings 1/2) THEN applies the switch.
    // "System Default" (empty
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
        SetAudioStatus(outputName.isEmpty() ? "Audio: System Default" : "Audio: " + outputName);
        SyncAudioSelection();
    }

    // AudioConfigPage's input combo onChange target (Task 3 review, Minor,
    // preserved from the deleted AudioPanel::onInputSelected path): the user
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
            SetAudioStatus(message);
            SyncAudioSelection();
            return;
        }

        juce::AudioDeviceManager::AudioDeviceSetup setup = deviceManager_.getAudioDeviceSetup();
        setup.inputDeviceName = inputName;
        const juce::String setupError = deviceManager_.setAudioDeviceSetup(setup, true);
        if (setupError.isNotEmpty()) {
            INFO("Audio input device switch (selection) FAILED: %s", setupError.toRawUTF8());
        }
        ApplyPreferredRateAndBlockSize();
        SetAudioStatus(inputName.isEmpty() ? "Audio In: System Default" : "Audio In: " + inputName);
        SyncAudioSelection();
    }

    // The current audio callback load, as a percentage (Plan 4 Task 2,
    // sru-2 binding: "RollingMax256 of deviceManager_.getCpuUsage() * 100.0,
    // written once per UI timer tick"). The shell's MainPane<App> writes
    // this into its RollingMax256 from the timer-driven repaint hook (see
    // ShellComponent::RepaintAll in Shell.hpp) -- Runtime itself has no
    // MainPane reference (MainPane owns a Runtime reference, not the other
    // way around), so it exposes the raw sample here rather than writing
    // into the pane directly.
    float DeadlineSamplePct() const { return static_cast<float>(deviceManager_.getCpuUsage() * 100.0); }

    // Installs the shell's repaint hook (Task 4): invoked at the end of
    // every timer tick, after the message-thread tick and before DoLog(),
    // so the shell can repaint itself and the app component in lockstep
    // with the engine's UI-state refresh.
    void SetRepaintHook(std::function<void()> hook) { repaintHook_ = std::move(hook); }

    synth::RuntimeConfigFileStatus SaveRuntimeConfiguration() {
        return engine_.SaveRuntimeConfiguration();
    }

    void NewPatch() {
        const synth::PatchCommandResult result = engine_.Patches().NewPatch();
        LogPatchCommand("NewPatch", result);
    }

    void SavePatch() {
        const synth::PatchCommandResult result = engine_.Patches().SavePatch();
        LogPatchCommand("SavePatch", result);
    }

    void SavePatchAs(const std::filesystem::path& path) {
        const synth::PatchCommandResult result = engine_.Patches().SavePatchAs(path);
        LogPatchCommand("SavePatchAs", result);
    }

    void SavePatchAsOverwrite(const std::filesystem::path& path) {
        const synth::PatchCommandResult result = engine_.Patches().SavePatchAsOverwrite(path);
        LogPatchCommand("SavePatchAsOverwrite", result);
    }

    void SavePatchAs(const juce::File& file) {
        SavePatchAs(std::filesystem::path(file.getFullPathName().toStdString()));
    }

    void LoadPatch(const std::filesystem::path& path) {
        const synth::PatchCommandResult result = engine_.Patches().LoadPatch(path);
        LogPatchCommand("LoadPatch", result);
    }

    void LoadPatch(const juce::File& file) { LoadPatch(std::filesystem::path(file.getFullPathName().toStdString())); }

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

    // Forwards to audioStatusHook_ (AudioConfigPage's status sink) when a
    // page is currently alive and has installed one; a no-op otherwise (e.g.
    // before any page has been shown, or while none is constructed). See
    // SetAudioStatusHook's doc comment.
    void SetAudioStatus(const juce::String& text) {
        if (audioStatusHook_) {
            audioStatusHook_(text);
        }
    }

    // Forwards to audioSyncHook_ (AudioConfigPage's re-sync hook), same
    // no-op-when-absent contract as SetAudioStatus above. See
    // SetAudioSyncHook's doc comment.
    void SyncAudioSelection() {
        if (audioSyncHook_) {
            audioSyncHook_();
        }
    }

    // engine_.SetAudioDeviceChangedCallback's target. Patch load/revert is
    // parameter-only and never reaches this path; it is reserved for
    // runtime-config-initiated audio changes that are sourced from
    // engine.AudioDeviceSnapshot() instead of a combo pick. The callback
    // tolerates running before a current device exists, which keeps startup
    // ordering flexible for persisted configuration loading.
    void OnEngineAudioDeviceChanged() {
        const synth::AudioDeviceState state = engine_.AudioDeviceSnapshot();
        const juce::String outputName = juce::String(state.outputDeviceName);
        if (outputName.isEmpty()) {
            if (deviceManager_.getCurrentAudioDevice() != nullptr) {
                SwitchOutputDevice(outputName, "engine");
            }
            SetAudioStatus("Audio: System Default");
        } else if (!IsEnumeratedOutputDevice(outputName)) {
            // Pre-device-open case (see this method's doc comment) also
            // lands here (no device type yet -> "not enumerated"), which is
            // correct: nothing to log as missing yet, Start()'s device-open
            // step will find it. Distinguish the two by whether a device
            // manager is already up.
            if (deviceManager_.getCurrentAudioDevice() != nullptr) {
                const juce::String message = "audio device not found: " + outputName;
                INFO("%s", message.toRawUTF8());
                SetAudioStatus(message);
            }
        } else {
            SwitchOutputDevice(outputName, "engine");
            SetAudioStatus("Audio: " + outputName);
        }

        // Input-side counterpart (Task 3 review round 2, Minor): the old
        // implementation only ever applied outputDeviceName here, so a patch
        // that changed just the input device would sync the combo's display
        // (SyncAudioSelection() below reads engine_.AudioDeviceSnapshot()
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
            SetAudioStatus(message);
        }

        SyncAudioSelection();
    }

    // Timer tick order (binding): engine message-thread tick -> MIDI
    // connection poll-driven reconcile -> repaint hook -> DoLog() last.
    // midiConnections_->OnTimerTick() consumes the background poller's dirty
    // flag (if any) and, on a change, re-enumerates authoritatively on this
    // (the message) thread and runs one reconcile pass (the self-healing
    // path, binding per p3-globals.md's message-thread-executor paragraph).
    // Panel repaint after a poll-driven reconcile is intentionally NOT
    // wired here beyond the repaint hook -- Refresh() re-reads
    // engine.InstrumentSnapshot()/midiConnections_ state cheaply enough that
    // the repaint hook's own periodic UI refresh (if the host wires one) is
    // sufficient; explicit reconcile-triggered repaint can be added if a
    // host needs tighter status-label latency.
    void timerCallback() override {
        engine_.MessageThreadTick();
        midiConnections_->OnTimerTick();
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
    synth::RuntimeDataPaths dataPaths_;
    std::optional<synth::RuntimeDataPaths> dataPathsOverride_;

    // Owns every controller slot's MIDI device handlers, connection state,
    // and background poller (Task 2 of Plan 3) -- see MidiConnectionManager
    // .hpp's class doc comment. A unique_ptr because it must be constructed
    // after engine_ (it holds a reference to it) and destroyed before
    // engine_ is torn down.
    std::unique_ptr<MidiConnectionManager<App>> midiConnections_;

    // ControllersPage's rebuild-notification hook (Task 4 review, Critical
    // finding 1), installed via SetMidiProcessorsRebuiltHook() -- see that
    // method's doc comment. Invoked at the end of every MIDI-processor
    // rebuild, AFTER midiConnections_->OnInstrumentRebuilt() has already
    // reopened/reconciled every slot's connections; empty (a no-op) until
    // MainPane wires it, and cleared the same way the audio hooks are when
    // the owning page is torn down.
    std::function<void()> onMidiProcessorsRebuilt_;

    // Shell hook: set later by whatever owns the UI, invoked at the end of
    // every timer tick so the app's component(s) can repaint.
    std::function<void()> repaintHook_;

    // AudioConfigPage's status/re-sync hooks (Task 3 of Plan 4) -- see
    // SetAudioStatusHook()/SetAudioSyncHook()'s doc comments. Empty
    // (default-constructed std::function) whenever no page has installed
    // one, which SetAudioStatus()/SyncAudioSelection() tolerate as a no-op.
    std::function<void(const juce::String&)> audioStatusHook_;
    std::function<void()> audioSyncHook_;
};

}  // namespace synth_runtime
