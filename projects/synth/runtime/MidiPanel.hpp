#pragma once

// synth_runtime::MidiPanel — the JUCE-side MIDI device management panel for
// the runtime shell (Plan 3 Task 3, UI ownership updated Plan 3 Task 2). Ports
// the old miniapp's device combo boxes / open-close buttons / status label
// (Main.cpp's configureMidiControls/refreshMidiDevices/toggleMidiInput/
// toggleMidiOutput/updateMidiStatus/selectDeviceByIdentifier/
// openSavedMidiDevices) onto synth::Engine<App>.
//
// Ownership (binding, changed by MidiConnectionManager.hpp, Task 2 of Plan
// 3): this panel used to own a single MidiInHandler/MidiOutputHandler pair
// and register itself as MidiSender sink 0 directly. That ownership has
// moved into synth_runtime::MidiConnectionManager<App> (see that header's
// class doc comment: "the runtime replaces MidiPanel's single handler pair
// with a per-controller vector"), which is now the sole owner of every
// controller slot's device handlers, including slot 0. This panel is
// constructed with a reference to the host's MidiConnectionManager<App> and
// is a thin UI shell over it: the combo boxes / open-close buttons / status
// label all read and write through the manager's slot-0-scoped accessors
// (ManualOpenInput/ManualOpenOutput/ManualCloseInput/ManualCloseOutput/
// IsInputOpen/IsOutputOpen/InputDeviceName/OutputDeviceName/InputLastError/
// OutputLastError/State()) instead of owning a handler pair itself. This
// panel still only ever reads/writes controller slot 0 -- see the manager's
// own doc comment for why slot 0 is (for now) the only slot with UI, and
// note for a future plan: replacing this panel with a genuinely
// per-controller UI (multiple slot rows) is the natural next step, at which
// point this panel's slot-0-only methods are what get generalized/deleted.
//
// Endpoint identifiers persist into slot 0 of the engine's live instrument
// (controllers[0].input/output) the same way they always have -- via
// Engine::EditInstrument, now invoked from inside
// MidiConnectionManager::ManualOpenInput/ManualOpenOutput rather than this
// panel's own SetSlot0Endpoints -- so endpoint selection still round-trips
// through save/load like every other instrument field. Engine::
// InstrumentSnapshot() remains this panel's message-thread-safe read path
// for slot 0's stored refs (see Slot0Endpoints()), concurrent with running
// audio.
//
// Rebuild-callback wiring (Task 2 update): the manager, not this panel, is
// now wired to engine.SetMidiProcessorsWillRebuildCallback/
// SetMidiProcessorsRebuiltCallback (Runtime forwards both straight to the
// manager's OnMidiProcessorsWillRebuild()/OnInstrumentRebuilt()). This panel
// no longer implements its own will-rebuild detach or rebuilt-reopen logic;
// Refresh() (called after every rebuild, via the same onMidiProcessorsRebuilt_
// forwarding Runtime already had, now pointed at this panel's Refresh()) just
// re-reads the manager's already-reopened state to repaint the combo
// boxes/status label. An absent device still leaves the panel showing
// "closed" with no failure (spp-5) -- that's the manager's reconcile
// producing an Offline status, which Refresh() reflects unchanged.
//
// Note (Task 3 review, Minor, intentionally left as-is): Runtime::Start()
// unconditionally triggers a reopen after Initialize() (now via the
// manager's StartupReconcile()), which redundantly closes/reopens devices a
// startup patch's own rebuild callback may have just opened; harmless
// (idempotent) and matches the old miniapp's always-reopen-at-startup
// behavior, so not changed here.
//
// Controller preset selection (spm-37, final-review Finding 1): presetBox_
// offers "Twister" and "WRLD.Bldr", ported from the pre-runtime miniapp's
// controllerPresetBox_ (git history around 4240fce^). On selection it
// replaces slot 0's profile config (preserving its name/endpoint refs where
// possible) via engine.EditInstrument(...), which itself calls the engine's
// RebuildMidiProcessors() and fires the rebuilt callback -- routed to the
// manager, which resizes/reinstalls forwarding and runs one reconcile pass
// (see OnPresetChanged()).

#include "synth/Engine.hpp"
#include "synth/MidiController.hpp"
#include "synth/PatchPersistence.hpp"

#include "MidiConnectionManager.hpp"
#include "MidiHandlers.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <memory>
#include <string_view>

namespace synth_runtime {

template <synth::SynthApplication App>
class MidiPanel : public juce::Component {
public:
    static constexpr int kTwisterItemId = 1;
    static constexpr int kWrldBldrItemId = 2;
    // The only controller slot this panel currently manages -- see the class
    // doc comment.
    static constexpr std::size_t kSlot = 0;

    // `connections` must outlive this panel (Runtime owns both, constructing
    // the manager first -- see Runtime.hpp).
    MidiPanel(synth::Engine<App>& engine, MidiConnectionManager<App>& connections)
        : engine_(engine), connections_(connections) {
        // Controller preset combo (spm-37): "Twister" and "WRLD.Bldr",
        // matching the pre-runtime miniapp's controllerPresetBox_ item text
        // exactly (see rebuildMidiProcessors/configureMidiControls in the
        // deleted miniapp's Main.cpp, git history around 4240fce^). Default
        // selection is WRLD.Bldr (id 2), matching the app's Init-configured
        // default profile (WrldBldrDefaultProfileConfig) so the combo starts
        // in sync with what's actually live without needing to infer the
        // preset from the live instrument's controller config shape
        // (MidiControllerProfileConfig carries no controller-kind
        // discriminator).
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

        Refresh();
    }

    ~MidiPanel() override = default;

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
    // re-selects whatever identifier is currently recorded on the engine's
    // instrument slot 0 (ported from the old miniapp's refreshMidiDevices,
    // adapted to read through Slot0Endpoints() instead of a panel-local
    // pair).
    void Refresh() {
        inputDevices_ = synth_juce::MidiInHandler::AvailableDevices();
        outputDevices_ = synth_juce::MidiOutputHandler::AvailableDevices();

        const Slot0EndpointsResult endpoints = Slot0Endpoints();

        inputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < inputDevices_.size(); ++ix) {
            inputBox_.addItem(inputDevices_[ix].name, ix + 1);
        }
        SelectDeviceByIdentifier(inputBox_, inputDevices_, endpoints.input.identifier);

        outputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < outputDevices_.size(); ++ix) {
            outputBox_.addItem(outputDevices_[ix].name, ix + 1);
        }
        SelectDeviceByIdentifier(outputBox_, outputDevices_, endpoints.output.identifier);

        UpdateStatus();
    }

    // presetBox_.onChange target (spm-37): builds the MidiControllerProfileConfig
    // for the newly selected preset and installs it into slot 0 of the
    // engine's live instrument via Engine::EditInstrument (creating slot 0
    // if the instrument is currently empty, preserving its name/endpoint
    // refs otherwise), which itself calls the engine's public
    // RebuildMidiProcessors() and fires the rebuilt callback -- routed to
    // connections_ (Runtime wires engine.SetMidiProcessorsRebuiltCallback to
    // connections_.OnInstrumentRebuilt(), which resizes/reinstalls forwarding
    // and reconciles), then to this panel's own Refresh() (Runtime also wires
    // a second rebuilt observer -- see Runtime.hpp) so the combo boxes repaint
    // against the manager's already-reopened state.
    void OnPresetChanged() {
        const synth::MidiProfileKind kind =
            presetBox_.getSelectedId() == kTwisterItemId ? synth::MidiProfileKind::MfTwister
                                                          : synth::MidiProfileKind::WrldBldr;
        const synth::MidiControllerProfileConfig config = SelectedPresetConfig();
        engine_.EditInstrument([&](synth::MidiInstrumentConfig& instrument) {
            if (instrument.controllers.empty()) {
                synth::MidiControllerSlot slot;
                slot.name = "controller";
                slot.kind = kind;
                slot.config = config;
                instrument.controllers.push_back(std::move(slot));
            } else {
                instrument.controllers[0].kind = kind;
                instrument.controllers[0].config = config;
            }
        });
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

    struct Slot0EndpointsResult {
        synth::MidiEndpointRef input;
        synth::MidiEndpointRef output;
    };

    // Message-thread read of controller slot 0's endpoint refs on the
    // engine's live instrument. Returns a default-constructed (unconfigured)
    // pair when the instrument has no controllers yet (e.g. before the
    // app's Init() has run, or for an app that never adds one). Endpoint
    // refs live on slot 0 only for now — see the class doc comment. Reads
    // through Engine::InstrumentSnapshot() (a locked copy), not
    // Engine::LiveInstrument(): this is called from Refresh(), a
    // message-thread path that can run while the audio thread is live and
    // mutating instrumentConfig_ under audioDeviceStateMutex_ via
    // ApplyPatchMessage -- reading the unlocked reference here would race
    // that drain (Task 4 review, Critical: the same race class
    // RebuildMidiProcessors() was fixed for, see Engine::LiveInstrument()'s
    // doc comment).
    Slot0EndpointsResult Slot0Endpoints() const {
        const synth::MidiInstrumentConfig instrument = engine_.InstrumentSnapshot();
        if (instrument.controllers.empty()) {
            return {};
        }
        return {instrument.controllers.front().input, instrument.controllers.front().output};
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

    juce::String SelectedInputIdentifier() const {
        const int ix = inputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < inputDevices_.size() ? inputDevices_[ix].identifier : juce::String();
    }

    // Name counterpart of SelectedInputIdentifier (Task 2 review, Important):
    // reads the display name of the same combo-box selection from
    // inputDevices_, the enumerated juce::MidiDeviceInfo list Refresh() built
    // the combo from -- so identifier and name always come from the same
    // enumeration snapshot, never out of sync with each other. See
    // ManualOpenInput's doc comment for why this must be threaded through
    // rather than left empty.
    juce::String SelectedInputName() const {
        const int ix = inputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < inputDevices_.size() ? inputDevices_[ix].name : juce::String();
    }

    juce::String SelectedOutputIdentifier() const {
        const int ix = outputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < outputDevices_.size() ? outputDevices_[ix].identifier : juce::String();
    }

    // Name counterpart of SelectedOutputIdentifier -- see SelectedInputName's
    // doc comment.
    juce::String SelectedOutputName() const {
        const int ix = outputBox_.getSelectedId() - 1;
        return ix >= 0 && ix < outputDevices_.size() ? outputDevices_[ix].name : juce::String();
    }

    // Delegates the actual open/close to connections_ (which owns slot 0's
    // handler, records the identifier+name into the engine's live
    // instrument, and updates its own MidiConnectionState) -- see the class
    // doc comment. The device name is threaded through alongside the
    // identifier (Task 2 review, Important) so the stored ref can survive OS
    // identifier churn via PlanMidiReconciliation's name-fallback matching --
    // see ManualOpenInput/ManualOpenOutput's doc comments
    // (MidiConnectionManager.hpp).
    void ToggleInput() {
        if (connections_.IsInputOpen(kSlot)) {
            connections_.ManualCloseInput(kSlot);
            UpdateStatus();
            return;
        }
        const juce::String identifier = SelectedInputIdentifier();
        if (identifier.isNotEmpty()) {
            connections_.ManualOpenInput(kSlot, identifier.toStdString(), SelectedInputName().toStdString());
        }
        UpdateStatus();
    }

    void ToggleOutput() {
        if (connections_.IsOutputOpen(kSlot)) {
            connections_.ManualCloseOutput(kSlot);
            UpdateStatus();
            return;
        }
        const juce::String identifier = SelectedOutputIdentifier();
        if (identifier.isNotEmpty()) {
            connections_.ManualOpenOutput(kSlot, identifier.toStdString(), SelectedOutputName().toStdString());
        }
        UpdateStatus();
    }

    void UpdateStatus() {
        const bool inputOpen = connections_.IsInputOpen(kSlot);
        const bool outputOpen = connections_.IsOutputOpen(kSlot);
        openInputButton_.setButtonText(inputOpen ? "Close In" : "Open In");
        openOutputButton_.setButtonText(outputOpen ? "Close Out" : "Open Out");
        juce::String status = inputOpen ? "In " + connections_.InputDeviceName(kSlot) : "In closed";
        status += " / ";
        status += outputOpen ? "Out " + connections_.OutputDeviceName(kSlot) : "Out closed";
        if (connections_.InputLastError(kSlot).isNotEmpty()) {
            status += " / " + connections_.InputLastError(kSlot);
        }
        if (connections_.OutputLastError(kSlot).isNotEmpty()) {
            status += " / " + connections_.OutputLastError(kSlot);
        }
        statusLabel_.setText(status, juce::dontSendNotification);
    }

    synth::Engine<App>& engine_;
    MidiConnectionManager<App>& connections_;

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

}  // namespace synth_runtime
