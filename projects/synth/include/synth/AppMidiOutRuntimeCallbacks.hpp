#pragma once

#include "synth/ControllersPageUI.hpp"
#include "synth/Engine.hpp"
#include "synth/MidiReconcile.hpp"

#include <functional>
#include <utility>

namespace synth {

// Fills the four ControllersPageCallbacks fields that read and write the
// app's one MIDI-out setting. Every runtime that hosts an Engine<App> --
// the standalone JUCE runtime and the browser runtime -- wires these the
// same way against the engine; only the port status differs, so the caller
// supplies that one accessor (JuceRuntimeMainServices reads it from its
// MidiConnectionManager, BrowserRuntimeMainServices from its
// BrowserMidiBridge).
template <SynthApplicationCore App>
void FillAppMidiOutCallbacks(runtime_ui::ControllersPageCallbacks& callbacks,
                              Engine<App>& engine,
                              std::function<MidiEndpointStatus()> portStatus)
{
    callbacks.appMidiOutSnapshot = [&engine] {
        return engine.AppMidiOutConfig();
    };
    callbacks.commitAppMidiOut = [&engine](AppMidiOutConfig config) {
        engine.SetAppMidiOutConfig(std::move(config));
    };
    callbacks.appMidiOutContents = engine.MidiCatalog().midiOutContents;
    callbacks.appMidiOutPortStatus = std::move(portStatus);
}

}  // namespace synth
