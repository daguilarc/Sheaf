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

#include "synth/Engine.hpp"
#include "synth/MidiController.hpp"
#include "synth/PatchPersistence.hpp"
#include "synth/ThreadId.hpp"

#include "MidiHandlers.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_basics/juce_gui_basics.h>

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
    explicit MidiPanel(synth::Engine<App>& engine) : engine_(engine) {
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
        const int comboWidth = juce::jmax(120, area.getWidth() / 4);
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

    juce::TextButton refreshButton_;
    juce::ComboBox inputBox_;
    juce::ComboBox outputBox_;
    juce::TextButton openInputButton_;
    juce::TextButton openOutputButton_;
    juce::Label statusLabel_;
    juce::Array<juce::MidiDeviceInfo> inputDevices_;
    juce::Array<juce::MidiDeviceInfo> outputDevices_;
};

}  // namespace synth_runtime
