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
// engine.SetMidiProcessorsRebuiltCallback([this]{ panel.ReopenPersistedEndpoints(); })
// so a startup-patch or runtime-load profile rebuild reopens the endpoints
// recorded in engine.Endpoints() against the fresh profile; an absent device
// leaves the panel closed with no failure (spp-5).

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
// std::unique_ptr<synth::MidiInProcessor>) to the engine's own
// MidiInputProcessor(), which the engine rebuilds out from under the panel
// whenever midiRebuildPending_ fires. The handler's callback thread (JUCE's
// MIDI input thread) is untagged by MidiHandlers.hpp, so this forwarding
// Process() applies the synth::ScopedThreadId(MidiInput) tag itself, per the
// Task 3 brief, without modifying the library header.
class EngineForwardingMidiInProcessor final : public synth::MidiInProcessor {
public:
    explicit EngineForwardingMidiInProcessor(synth::MidiInProcessor** target) : target_(target) {}

    void Process(const synth::BasicMidi& midi) override {
        synth::ScopedThreadId tag(synth::ThreadId::MidiInput);
        if (target_ != nullptr && *target_ != nullptr) {
            (*target_)->Process(midi);
        }
    }

private:
    // Non-owning; points at whatever engine.MidiInputProcessor() currently
    // returns. Re-read on every call since the engine may rebuild
    // midiProcessors_ (and thus swap the pointee) between MIDI messages.
    synth::MidiInProcessor** target_ = nullptr;
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

        // The forwarding processor's target is re-read on every incoming
        // MIDI message (see EngineForwardingMidiInProcessor::Process), so it
        // is safe to install once here rather than reinstalling on every
        // engine rebuild.
        inHandler_.SetProcessor(std::make_unique<detail::EngineForwardingMidiInProcessor>(&inputTarget_));
        inputTarget_ = engine_.MidiInputProcessor();

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

    // Wired by Runtime as engine.SetMidiProcessorsRebuiltCallback's target
    // (via onMidiProcessorsRebuilt_): opens the endpoint identifiers
    // recorded in engine.Endpoints() when the corresponding device is
    // currently present; an absent device leaves the panel closed with no
    // failure (spp-5), mirroring the old miniapp's openSavedMidiDevices.
    void ReopenPersistedEndpoints() {
        inputTarget_ = engine_.MidiInputProcessor();

        inHandler_.Close();
        outHandler_.Close();

        Refresh();

        const synth::MidiEndpointState& endpoints = engine_.Endpoints();
        if (HasDeviceIdentifier(inputDevices_, endpoints.inputIdentifier)) {
            inHandler_.Open(ToJuceString(endpoints.inputIdentifier));
        }
        if (HasDeviceIdentifier(outputDevices_, endpoints.outputIdentifier)) {
            outHandler_.Open(ToJuceString(endpoints.outputIdentifier));
        }

        UpdateStatus();
    }

private:
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

    synth_juce::MidiInHandler inHandler_;
    synth_juce::MidiOutputHandler outHandler_;

    // Re-read by EngineForwardingMidiInProcessor::Process on every incoming
    // MIDI message; refreshed whenever the engine may have rebuilt
    // midiProcessors_ (ReopenPersistedEndpoints, i.e. the
    // onMidiProcessorsRebuilt_ hook).
    synth::MidiInProcessor* inputTarget_ = nullptr;

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
