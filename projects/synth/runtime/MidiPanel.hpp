#pragma once

// synth_runtime::MidiPanel — the JUCE-side MIDI device management panel for
// the runtime shell (Plan 3 Task 3). Ports the old miniapp's device combo
// boxes / open-close buttons / status label (Main.cpp's
// configureMidiControls/refreshMidiDevices/toggleMidiInput/toggleMidiOutput/
// updateMidiStatus/selectDeviceByIdentifier/openSavedMidiDevices) onto
// synth::Engine<App>: unlike the old app, the engine owns MIDI processor
// construction/rebuilding itself (Engine::RebuildMidiProcessors, driven by
// midiRebuildPending_/the startup-patch path), so this panel only forwards
// incoming device MIDI into engine.MidiInputProcessor() and points the
// engine's MidiSender at the open output device — it never builds a
// MidiControllerProfileResult itself.
//
// Device open/close records identifiers into engine.Endpoints() so patches
// persist them (spm-53). Runtime wires
// engine.SetMidiProcessorsWillRebuildCallback([this]{ panel.OnMidiProcessorsWillRebuild(); })
// and
// engine.SetMidiProcessorsRebuiltCallback([this]{ panel.ReopenPersistedEndpoints(); })
// so a startup-patch or runtime-load profile rebuild detaches the panel's
// forwarding processor before the old MIDI processor chain is destroyed,
// then reopens the endpoints recorded in engine.Endpoints() against the
// fresh profile once the rebuild completes; an absent device leaves the
// panel closed with no failure (spp-5).
//
// Note (Task 3 review, Minor, intentionally left as-is): Runtime::Start()
// unconditionally calls ReopenPersistedEndpoints() after Initialize(),
// which redundantly closes/reopens devices a startup patch's own rebuild
// callback may have just opened; harmless (idempotent) and matches the old
// miniapp's always-reopen-at-startup behavior, so not changed here.
//
// Controller preset selection (spm-37, final-review Finding 1): presetBox_
// offers "Twister" and "WRLD.Bldr", ported from the pre-runtime miniapp's
// controllerPresetBox_ (git history around 4240fce^). Unlike that miniapp
// (which built processors directly), this panel is one of the "unlike the
// old app" cases above: on selection it writes the chosen preset's
// MidiControllerProfileConfig into *engine.Context().midiProfileConfig and
// calls the engine's public Engine::RebuildMidiProcessors() (promoted from
// the former test-only RebuildMidiProcessorsForTest() so a production UI
// action has a documented, will-rebuild-safe way to trigger a rebuild) —
// see OnPresetChanged().

#include "synth/Engine.hpp"
#include "synth/MidiController.hpp"
#include "synth/PatchPersistence.hpp"
#include "synth/ThreadId.hpp"

#include "MidiHandlers.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <memory>
#include <string_view>

namespace synth_runtime {

namespace detail {

// Bridges synth_juce::MidiInHandler (which owns a single
// std::unique_ptr<synth::MidiInProcessor>) to a single, fixed
// synth::MidiInProcessor* captured at construction time (a snapshot of
// engine.MidiInputProcessor() taken immediately after a rebuild). The
// handler's callback thread (JUCE's MIDI input thread) is untagged by
// MidiHandlers.hpp, so this forwarding Process() applies the
// synth::ScopedThreadId(MidiInput) tag itself, per the Task 3 brief, without
// modifying the library header.
//
// Deliberately NOT re-read from a panel-owned raw pointer on every call: the
// engine may destroy/replace midiProcessors_ (and thus the pointee) between
// MIDI messages, and reading a panel-owned raw pointer from the MIDI
// callback thread without synchronization is a use-after-free race (Task 3
// review finding). Instead ALL forwarding goes through
// synth_juce::MidiInHandler's own mutex-guarded processor_ slot: the panel
// detaches it (SetProcessor(nullptr)) before the engine destroys
// midiProcessors_ (via engine.SetMidiProcessorsWillRebuildCallback) and
// installs a fresh instance of this class — wrapping the freshly rebuilt
// target — only after the rebuild has completed. The panel never keeps its
// own raw target pointer.
class EngineForwardingMidiInProcessor final : public synth::MidiInProcessor {
public:
    explicit EngineForwardingMidiInProcessor(synth::MidiInProcessor* target) : target_(target) {}

    void Process(const synth::BasicMidi& midi) override {
        synth::ScopedThreadId tag(synth::ThreadId::MidiInput);
        if (target_ != nullptr) {
            target_->Process(midi);
        }
    }

private:
    // Non-owning; fixed for the lifetime of this instance (one instance per
    // rebuild generation — see the class comment).
    synth::MidiInProcessor* target_ = nullptr;
};

}  // namespace detail

template <synth::SynthApplication App>
class MidiPanel : public juce::Component {
public:
    static constexpr int kTwisterItemId = 1;
    static constexpr int kWrldBldrItemId = 2;

    explicit MidiPanel(synth::Engine<App>& engine) : engine_(engine) {
        // Controller preset combo (spm-37): "Twister" and "WRLD.Bldr",
        // matching the pre-runtime miniapp's controllerPresetBox_ item text
        // exactly (see rebuildMidiProcessors/configureMidiControls in the
        // deleted miniapp's Main.cpp, git history around 4240fce^). Default
        // selection is WRLD.Bldr (id 2), matching the app's Init-configured
        // default profile (WrldBldrDefaultProfileConfig) so the combo starts
        // in sync with what's actually live without needing to infer the
        // preset from midiProfileConfig's shape (MidiControllerProfileConfig
        // carries no controller-kind discriminator).
        presetBox_.addItem("Twister", kTwisterItemId);
        presetBox_.addItem("WRLD.Bldr", kWrldBldrItemId);
        presetBox_.setSelectedId(kWrldBldrItemId, juce::dontSendNotification);
        presetBox_.onChange = [this] { OnPresetChanged(); };
        addAndMakeVisible(presetBox_);

        refreshButton_.setButtonText("Refresh");
        refreshButton_.onClick = [this] { Refresh(); };
        addAndMakeVisible(refreshButton_);

        inputBox_.setTextWhenNoChoicesAvailable("No inputs");
        inputBox_.setTextWhenNothingSelected("MIDI input");
        addAndMakeVisible(inputBox_);

        outputBox_.setTextWhenNoChoicesAvailable("No outputs");
        outputBox_.setTextWhenNothingSelected("MIDI output");
        addAndMakeVisible(outputBox_);

        openInputButton_.onClick = [this] { ToggleInput(); };
        addAndMakeVisible(openInputButton_);
        openOutputButton_.onClick = [this] { ToggleOutput(); };
        addAndMakeVisible(openOutputButton_);

        statusLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        statusLabel_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(statusLabel_);

        // Installs a fresh forwarding processor wrapping the engine's
        // just-constructed MidiInputProcessor(), through inHandler_'s own
        // mutex-guarded SetProcessor (see the detail namespace comment on
        // why the panel never keeps its own raw target pointer).
        InstallForwardingProcessor();

        if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
            sender->SetSink(&outHandler_);
        }

        Refresh();
        UpdateStatus();
    }

    ~MidiPanel() override {
        inHandler_.Close();
        inHandler_.SetProcessor(nullptr);
        outHandler_.Close();
    }

    MidiPanel(const MidiPanel&) = delete;
    MidiPanel& operator=(const MidiPanel&) = delete;

    void resized() override {
        auto area = getLocalBounds().reduced(4);
        const int comboWidth = juce::jmax(120, area.getWidth() / 5);
        presetBox_.setBounds(area.removeFromLeft(comboWidth).reduced(4));
        refreshButton_.setBounds(area.removeFromLeft(74).reduced(4));
        inputBox_.setBounds(area.removeFromLeft(comboWidth).reduced(4));
        openInputButton_.setBounds(area.removeFromLeft(82).reduced(4));
        outputBox_.setBounds(area.removeFromLeft(comboWidth).reduced(4));
        openOutputButton_.setBounds(area.removeFromLeft(82).reduced(4));
        statusLabel_.setBounds(area.reduced(4));
    }

    // Re-enumerates available devices, repopulates the combo boxes, and
    // re-selects whatever identifier is currently recorded in
    // engine.Endpoints() (ported verbatim from the old miniapp's
    // refreshMidiDevices).
    void Refresh() {
        inputDevices_ = synth_juce::MidiInHandler::AvailableDevices();
        outputDevices_ = synth_juce::MidiOutputHandler::AvailableDevices();

        inputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < inputDevices_.size(); ++ix) {
            inputBox_.addItem(inputDevices_[ix].name, ix + 1);
        }
        SelectDeviceByIdentifier(inputBox_, inputDevices_, engine_.Endpoints().inputIdentifier);

        outputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < outputDevices_.size(); ++ix) {
            outputBox_.addItem(outputDevices_[ix].name, ix + 1);
        }
        SelectDeviceByIdentifier(outputBox_, outputDevices_, engine_.Endpoints().outputIdentifier);

        UpdateStatus();
    }

    // presetBox_.onChange target (spm-37): builds the MidiControllerProfileConfig
    // for the newly selected preset, installs it as the engine's live
    // profile, and rebuilds the MIDI processor chain against it through the
    // engine's public, will-rebuild-safe RebuildMidiProcessors() (the same
    // call production code uses from Initialize()/MessageThreadTick() —
    // Engine::RebuildMidiProcessorsForTest() is test-only and not
    // appropriate for a production UI action). RebuildMidiProcessors()
    // itself already invokes SetMidiProcessorsWillRebuildCallback's target
    // (OnMidiProcessorsWillRebuild(), detaching the forwarding processor)
    // before destroying the old chain; runs on the message thread (JUCE
    // combo box callbacks run on the message thread), matching
    // MidiControllerProfileConfig's documented message-thread-only contract.
    // Called directly rather than via the engine's rebuilt callback (which
    // isn't fired by a direct RebuildMidiProcessors() call — see its doc
    // comment): ReopenPersistedEndpoints() performs the identical
    // reopen-against-fresh-chain sequence the tick's rebuild path triggers
    // through that callback.
    void OnPresetChanged() {
        *engine_.Context().midiProfileConfig = SelectedPresetConfig();
        engine_.RebuildMidiProcessors();
        ReopenPersistedEndpoints();
    }

    // Wired by Runtime as engine.SetMidiProcessorsWillRebuildCallback's
    // target: called synchronously, on whichever thread is performing the
    // rebuild (always the message thread in practice — see Engine.hpp),
    // immediately BEFORE the engine destroys/replaces midiProcessors_.
    // Detaches the forwarding processor from inHandler_ (mutex-guarded, so
    // this is safe with respect to a concurrent MIDI callback) so no
    // in-flight or subsequent MIDI callback can dereference a processor
    // pointer into the chain that is about to be destroyed (Task 3 review
    // finding: processor-swap race / use-after-free).
    void OnMidiProcessorsWillRebuild() { inHandler_.SetProcessor(nullptr); }

    // Wired by Runtime as engine.SetMidiProcessorsRebuiltCallback's target
    // (via onMidiProcessorsRebuilt_): opens the endpoint identifiers
    // recorded in engine.Endpoints() when the corresponding device is
    // currently present; an absent device leaves the panel closed with no
    // failure (spp-5), mirroring the old miniapp's openSavedMidiDevices.
    void ReopenPersistedEndpoints() {
        // Re-point the forwarding processor at the freshly rebuilt
        // MidiInputProcessor(). OnMidiProcessorsWillRebuild() already
        // detached the previous (now-dangling) one before the engine
        // destroyed the old chain.
        InstallForwardingProcessor();

        inHandler_.Close();
        outHandler_.Close();

        Refresh();

        const synth::MidiEndpointState& endpoints = engine_.Endpoints();
        if (HasDeviceIdentifier(inputDevices_, endpoints.inputIdentifier)) {
            inHandler_.Open(ToJuceString(endpoints.inputIdentifier));
        }
        if (HasDeviceIdentifier(outputDevices_, endpoints.outputIdentifier) &&
            outHandler_.Open(ToJuceString(endpoints.outputIdentifier))) {
            // Parity with the old miniapp's openSavedMidiDevices (Main.cpp):
            // force a full LED/value resync on the just-reopened output
            // device (Task 3 review finding: output reset parity).
            engine_.ResetMidiOutputProcessors();
        }

        UpdateStatus();
    }

private:
    // Builds the MidiControllerProfileConfig for whatever preset is
    // currently selected in presetBox_. WRLD.Bldr goes through
    // WrldBldrDefaultProfileConfig; the Twister preset uses the MIDI Fighter
    // Twister whole-profile factory MfTwisterDefaultProfileConfig (encoder
    // in/out plus the Twister-native output protocol and side buttons) —
    // both are the same whole-profile factories the app's Init() default and
    // patch profiles use. visibleEncoderCount is left at its default (16):
    // the runtime shell renders a fixed encoder grid, unlike the old
    // miniapp's encoders_.size().
    synth::MidiControllerProfileConfig SelectedPresetConfig() const {
        if (presetBox_.getSelectedId() == kTwisterItemId) {
            return synth::MfTwisterDefaultProfileConfig();
        }
        return synth::WrldBldrDefaultProfileConfig();
    }

    // Installs a fresh EngineForwardingMidiInProcessor wrapping the
    // engine's current MidiInputProcessor() into inHandler_, through its
    // mutex-guarded SetProcessor. Must only be called when midiProcessors_
    // is not mid-rebuild (i.e. either at construction time or after
    // ReopenPersistedEndpoints() observes the rebuilt callback) — never
    // between OnMidiProcessorsWillRebuild() and the matching rebuilt
    // callback.
    void InstallForwardingProcessor() {
        inHandler_.SetProcessor(
            std::make_unique<detail::EngineForwardingMidiInProcessor>(engine_.MidiInputProcessor()));
    }

    static juce::String ToJuceString(std::string_view text) { return juce::String(std::string(text).c_str()); }

    static bool SelectDeviceByIdentifier(juce::ComboBox& box, const juce::Array<juce::MidiDeviceInfo>& devices,
                                         std::string_view identifier) {
        if (identifier.empty()) {
            if (devices.size() > 0 && box.getSelectedId() == 0) {
                box.setSelectedId(1, juce::dontSendNotification);
            }
            return false;
        }
        const juce::String juceIdentifier = ToJuceString(identifier);
        for (int ix = 0; ix < devices.size(); ++ix) {
            if (devices[ix].identifier == juceIdentifier) {
                box.setSelectedId(ix + 1, juce::dontSendNotification);
                return true;
            }
        }
        box.setSelectedId(0, juce::dontSendNotification);
        return false;
    }

    static bool HasDeviceIdentifier(const juce::Array<juce::MidiDeviceInfo>& devices, std::string_view identifier) {
        if (identifier.empty()) {
            return false;
        }
        const juce::String juceIdentifier = ToJuceString(identifier);
        for (const auto& device : devices) {
            if (device.identifier == juceIdentifier) {
                return true;
            }
        }
        return false;
    }

    juce::String SelectedInputIdentifier() const {
        const int ix = inputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < inputDevices_.size() ? inputDevices_[ix].identifier : juce::String();
    }

    juce::String SelectedOutputIdentifier() const {
        const int ix = outputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < outputDevices_.size() ? outputDevices_[ix].identifier : juce::String();
    }

    void ToggleInput() {
        if (inHandler_.IsOpen()) {
            inHandler_.Close();
            UpdateStatus();
            return;
        }
        SyncEndpointStateFromSelection();
        const juce::String identifier = SelectedInputIdentifier();
        if (identifier.isNotEmpty() && inHandler_.Open(identifier)) {
            engine_.Endpoints().inputIdentifier = identifier.toStdString();
        }
        UpdateStatus();
    }

    void ToggleOutput() {
        if (outHandler_.IsOpen()) {
            outHandler_.Close();
            UpdateStatus();
            return;
        }
        SyncEndpointStateFromSelection();
        const juce::String identifier = SelectedOutputIdentifier();
        if (identifier.isNotEmpty() && outHandler_.Open(identifier)) {
            engine_.Endpoints().outputIdentifier = identifier.toStdString();
            // Parity with the old miniapp's toggleMidiOutput (Main.cpp):
            // force a full LED/value resync on the just-opened output
            // device (Task 3 review finding: output reset parity).
            engine_.ResetMidiOutputProcessors();
        }
        UpdateStatus();
    }

    void SyncEndpointStateFromSelection() {
        const juce::String input = SelectedInputIdentifier();
        const juce::String output = SelectedOutputIdentifier();
        if (input.isNotEmpty()) {
            engine_.Endpoints().inputIdentifier = input.toStdString();
        }
        if (output.isNotEmpty()) {
            engine_.Endpoints().outputIdentifier = output.toStdString();
        }
    }

    void UpdateStatus() {
        openInputButton_.setButtonText(inHandler_.IsOpen() ? "Close In" : "Open In");
        openOutputButton_.setButtonText(outHandler_.IsOpen() ? "Close Out" : "Open Out");
        juce::String status = inHandler_.IsOpen() ? "In " + inHandler_.DeviceName() : "In closed";
        status += " / ";
        status += outHandler_.IsOpen() ? "Out " + outHandler_.DeviceName() : "Out closed";
        if (inHandler_.LastError().isNotEmpty()) {
            status += " / " + inHandler_.LastError();
        }
        if (outHandler_.LastError().isNotEmpty()) {
            status += " / " + outHandler_.LastError();
        }
        statusLabel_.setText(status, juce::dontSendNotification);
    }

    synth::Engine<App>& engine_;

    // No panel-owned raw pointer into the MIDI processor chain: all
    // forwarding goes through inHandler_'s own mutex-guarded processor_
    // slot (see the detail namespace comment and OnMidiProcessorsWillRebuild
    // / InstallForwardingProcessor).
    synth_juce::MidiInHandler inHandler_;
    synth_juce::MidiOutputHandler outHandler_;

    juce::ComboBox presetBox_;
    juce::TextButton refreshButton_;
    juce::ComboBox inputBox_;
    juce::ComboBox outputBox_;
    juce::TextButton openInputButton_;
    juce::TextButton openOutputButton_;
    juce::Label statusLabel_;
    juce::Array<juce::MidiDeviceInfo> inputDevices_;
    juce::Array<juce::MidiDeviceInfo> outputDevices_;
};

// synth_runtime::AudioPanel — the runtime audio output-device selector (Plan
// 4 Task 3). A small sibling to MidiPanel living in the same chrome row: a
// "System Default" + enumerated-output-device combo (input combo added only
// when App::Config().numAudioInputs > 0 — the miniapp requests 0 inputs, so
// it's typically absent) plus a status label. Unlike MidiPanel, AudioPanel
// does not own the JUCE device manager or the engine's device-switch logic
// itself; Runtime owns deviceManager_ (it's also the AudioIODeviceCallback
// target) and the actual switch implementation (Runtime::SwitchOutputDevice:
// AudioDeviceSetup mutation + setAudioDeviceSetup + logging), so AudioPanel
// is constructed with a reference to it and to synth::Engine<App> for
// read-only queries (AudioDeviceSnapshot(), getDeviceNames) and forwards user
// selections through onOutputSelected, a callback Runtime wires to its own
// ApplyAudioDeviceSelection (which itself calls SwitchOutputDevice) so both
// the user-driven path and the apply-on-load callback path (Runtime::Start,
// wired before engine_.Initialize()) funnel through the one switch
// implementation. The input combo (present only when
// App::Config().numAudioInputs > 0) is wired identically: onInputSelected
// forwards the chosen input device name (or "" for System Default) so a
// host can apply it the same way (Task 3 review, Minor: the input combo used
// to be populated but never wired to anything, i.e. dead UI).
//
// Ordering note (binding, see Runtime::Start's doc comment): the engine's
// audioDeviceChangedCallback_ can fire from Initialize(), i.e. BEFORE
// deviceManager_ has been initialised at all (a startup patch may carry a
// device name). AudioPanel::SyncSelection tolerates this: it only touches
// deviceManager_.getCurrentDeviceTypeObject() when a device type is already
// current, and otherwise just leaves the combo showing "System Default"/no
// selection — Runtime's own device-open step (later in Start()) is what
// actually prefers engine.AudioDeviceSnapshot().outputDeviceName once the
// device manager exists, and calls SyncSelection() again afterwards.
template <synth::SynthApplication App>
class AudioPanel : public juce::Component {
public:
    static constexpr int kSystemDefaultItemId = 1;

    AudioPanel(synth::Engine<App>& engine, juce::AudioDeviceManager& deviceManager)
        : engine_(engine), deviceManager_(deviceManager) {
        outputBox_.setTextWhenNoChoicesAvailable("No outputs");
        outputBox_.setTextWhenNothingSelected("Audio output");
        addAndMakeVisible(outputBox_);
        outputBox_.onChange = [this] {
            if (applyingSelection_) {
                return;
            }
            if (onOutputSelected) {
                onOutputSelected(SelectedOutputDeviceName());
            }
        };

        // Input combo only when the app actually requests audio input
        // channels (Task 3 brief: miniapp requests 0, so this stays absent
        // there). Built once at construction since RuntimeConfig is fixed
        // per-app. Wired identically to outputBox_ (Task 3 review, Minor):
        // same applyingSelection_ guard, same onInputSelected forwarding
        // pattern.
        if (App::Config().numAudioInputs > 0) {
            inputBox_ = std::make_unique<juce::ComboBox>();
            inputBox_->setTextWhenNoChoicesAvailable("No inputs");
            inputBox_->setTextWhenNothingSelected("Audio input");
            inputBox_->onChange = [this] {
                if (applyingSelection_) {
                    return;
                }
                if (onInputSelected) {
                    onInputSelected(SelectedInputDeviceName());
                }
            };
            addAndMakeVisible(*inputBox_);
        }

        statusLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        statusLabel_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(statusLabel_);

        Refresh();
    }

    AudioPanel(const AudioPanel&) = delete;
    AudioPanel& operator=(const AudioPanel&) = delete;

    void resized() override {
        auto area = getLocalBounds().reduced(4);
        const int comboWidth = juce::jmax(120, area.getWidth() / 4);
        outputBox_.setBounds(area.removeFromLeft(comboWidth).reduced(4));
        if (inputBox_) {
            inputBox_->setBounds(area.removeFromLeft(comboWidth).reduced(4));
        }
        statusLabel_.setBounds(area.reduced(4));
    }

    // Re-enumerates output (and, when present, input) device names from
    // deviceManager_.getCurrentDeviceTypeObject() and repopulates the combo
    // ("System Default" first, empty name, then each enumerated device),
    // then re-syncs the selection to whatever engine.AudioDeviceSnapshot()
    // currently holds. Safe to call at any point in Runtime::Start's
    // ordering, including before the device manager itself has been
    // initialised (see the class doc comment) — getCurrentDeviceTypeObject()
    // returning nullptr just yields an output-only/input-only "System
    // Default" entry.
    void Refresh() {
        outputBox_.clear(juce::dontSendNotification);
        outputBox_.addItem("System Default", kSystemDefaultItemId);
        outputNames_.clear();
        if (juce::AudioIODeviceType* deviceType = deviceManager_.getCurrentDeviceTypeObject();
            deviceType != nullptr) {
            outputNames_ = deviceType->getDeviceNames(false);
            for (int ix = 0; ix < outputNames_.size(); ++ix) {
                outputBox_.addItem(outputNames_[ix], kSystemDefaultItemId + ix + 1);
            }
        }

        if (inputBox_) {
            inputBox_->clear(juce::dontSendNotification);
            inputBox_->addItem("System Default", kSystemDefaultItemId);
            inputNames_.clear();
            if (juce::AudioIODeviceType* deviceType = deviceManager_.getCurrentDeviceTypeObject();
                deviceType != nullptr) {
                inputNames_ = deviceType->getDeviceNames(true);
                for (int ix = 0; ix < inputNames_.size(); ++ix) {
                    inputBox_->addItem(inputNames_[ix], kSystemDefaultItemId + ix + 1);
                }
            }
        }

        SyncSelection();
    }

    // Re-syncs the combo's selection(s) to
    // engine.AudioDeviceSnapshot().outputDeviceName/inputDeviceName without
    // applying anything (no device switch, no notification) — used both
    // after Refresh() and by Runtime after it applies a device. Empty name
    // selects "System Default"; a name not currently enumerated leaves the
    // combo on "System Default" too (the status label is the source of
    // truth for "device not found", set by Runtime).
    void SyncSelection() {
        const juce::ScopedValueSetter<bool> guard(applyingSelection_, true);
        const synth::AudioDeviceState state = engine_.AudioDeviceSnapshot();

        const juce::String wantedOutput = juce::String(state.outputDeviceName);
        if (wantedOutput.isEmpty()) {
            outputBox_.setSelectedId(kSystemDefaultItemId, juce::dontSendNotification);
        } else {
            const int ix = outputNames_.indexOf(wantedOutput);
            outputBox_.setSelectedId(ix >= 0 ? kSystemDefaultItemId + ix + 1 : kSystemDefaultItemId,
                                     juce::dontSendNotification);
        }

        if (inputBox_) {
            const juce::String wantedInput = juce::String(state.inputDeviceName);
            if (wantedInput.isEmpty()) {
                inputBox_->setSelectedId(kSystemDefaultItemId, juce::dontSendNotification);
            } else {
                const int ix = inputNames_.indexOf(wantedInput);
                inputBox_->setSelectedId(ix >= 0 ? kSystemDefaultItemId + ix + 1 : kSystemDefaultItemId,
                                         juce::dontSendNotification);
            }
        }
    }

    void SetStatus(const juce::String& text) { statusLabel_.setText(text, juce::dontSendNotification); }

    // The output device name currently selected in the combo ("" for System
    // Default). Used by Runtime's onChange handler.
    juce::String SelectedOutputDeviceName() const {
        const int ix = outputBox_.getSelectedId() - kSystemDefaultItemId - 1;
        return ix >= 0 && ix < outputNames_.size() ? outputNames_[ix] : juce::String();
    }

    // The input device name currently selected in the combo ("" for System
    // Default, or if the combo is absent). Used by Runtime's onChange
    // handler.
    juce::String SelectedInputDeviceName() const {
        if (!inputBox_) {
            return {};
        }
        const int ix = inputBox_->getSelectedId() - kSystemDefaultItemId - 1;
        return ix >= 0 && ix < inputNames_.size() ? inputNames_[ix] : juce::String();
    }

    // Wired by Runtime (constructor) to Runtime::ApplyAudioDeviceSelection.
    // Invoked on the message thread (JUCE combo box callbacks run there)
    // with the newly selected output device name ("" for System Default)
    // whenever the user changes the combo directly — never invoked by
    // SyncSelection()/Refresh()'s own dontSendNotification updates.
    std::function<void(const juce::String&)> onOutputSelected;

    // Wired by Runtime (constructor), symmetric to onOutputSelected: invoked
    // on the message thread with the newly selected input device name (""
    // for System Default) whenever the user changes inputBox_ directly. Only
    // ever fires when inputBox_ exists (App::Config().numAudioInputs > 0).
    std::function<void(const juce::String&)> onInputSelected;

private:
    synth::Engine<App>& engine_;
    juce::AudioDeviceManager& deviceManager_;

    juce::ComboBox outputBox_;
    // Present only when App::Config().numAudioInputs > 0; unlike MidiPanel's
    // always-present combos, most apps (e.g. the miniapp) never show an
    // audio input combo at all.
    std::unique_ptr<juce::ComboBox> inputBox_;
    juce::Label statusLabel_;
    juce::StringArray outputNames_;
    // Parallel to outputNames_, populated only when inputBox_ exists.
    juce::StringArray inputNames_;

    // Guards SyncSelection()'s setSelectedId(..., dontSendNotification) —
    // belt-and-suspenders against onChange firing re-entrantly; JUCE's
    // dontSendNotification already suppresses onChange, but this also
    // protects a future switch to sendNotificationSync.
    bool applyingSelection_ = false;
};

}  // namespace synth_runtime
