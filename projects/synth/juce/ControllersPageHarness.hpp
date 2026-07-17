#pragma once

#include "PortableJuceBackend.hpp"

#include "synth/ControllersPageUI.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <string>
#include <utility>

namespace synth_runtime::test {

struct ControllersHarnessState
{
    synth::MidiInstrumentConfig instrument;
    synth::MidiConnectionState connection;
    synth::MidiDeviceList devices;
    std::string status;
    int commits = 0;
};

inline synth::MidiControllerSlot MakeHarnessWrldBldrSlot(const char* name)
{
    synth::MidiControllerSlot slot;
    slot.name = name;
    slot.kind = synth::MidiProfileKind::WrldBldr;
    slot.config = synth::WrldBldrDefaultProfileConfig();
    slot.input.identifier = "wrldbldr-in-id";
    slot.input.name = "WRLD.Bldr In";
    slot.output.identifier = "wrldbldr-out-id";
    slot.output.name = "WRLD.Bldr Out";
    return slot;
}

inline synth::MidiControllerSlot MakeHarnessLaunchpadSlot(const char* name)
{
    synth::MidiControllerSlot slot;
    slot.name = name;
    slot.kind = synth::MidiProfileKind::Launchpad;
    slot.config = synth::LaunchpadDefaultProfileConfig();
    slot.input.identifier = "launchpad-in-id";
    slot.input.name = "Launchpad X In";
    slot.output.identifier = "launchpad-out-id";
    slot.output.name = "Launchpad X Out";
    return slot;
}

inline synth::MidiControllerSlot MakeHarnessGenericSlot(const char* name)
{
    synth::MidiControllerSlot slot;
    slot.name = name;
    slot.kind = synth::MidiProfileKind::Generic;
    return slot;
}

class ControllersHarnessFixture
{
public:
    ControllersHarnessFixture()
    {
        state.instrument.AddController(MakeHarnessWrldBldrSlot("wrld"));
        state.instrument.AddController(MakeHarnessLaunchpadSlot("pads"));
        state.instrument.AddController(MakeHarnessGenericSlot("blank"));
        SyncConnectionSize();
        state.connection.controllers[0].input.status = synth::MidiEndpointStatus::Online;
        state.connection.controllers[0].output.status = synth::MidiEndpointStatus::Online;
        state.connection.controllers[1].input.status = synth::MidiEndpointStatus::Offline;
        state.connection.controllers[1].output.status = synth::MidiEndpointStatus::Unconfigured;
        AddDefaultDevices();
    }

    synth::runtime_ui::ControllersPageSurface MakeSurface()
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] { return state.instrument; };
        callbacks.connectionState = [this] { return state.connection; };
        callbacks.enumerateDevices = [this] { return state.devices; };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig out) {
            state.instrument = std::move(out);
            SyncConnectionSize();
            ++state.commits;
        };
        callbacks.setStatus = [this](std::string text) { state.status = std::move(text); };
        return synth::runtime_ui::ControllersPageSurface(std::move(callbacks));
    }

    void AddDefaultDevices()
    {
        state.devices.inputs.push_back({"wrldbldr-in-id", "WRLD.Bldr In"});
        state.devices.inputs.push_back({"launchpad-in-id", "Launchpad X In"});
        state.devices.inputs.push_back({"twister-in-id", "Twister In"});
        state.devices.outputs.push_back({"wrldbldr-out-id", "WRLD.Bldr Out"});
        state.devices.outputs.push_back({"launchpad-out-id", "Launchpad X Out"});
    }

    void SyncConnectionSize()
    {
        state.connection.controllers.resize(state.instrument.controllers.size());
    }

    ControllersHarnessState state;
};

inline void PumpJuceMessages(int milliseconds = 25)
{
    juce::Thread::sleep(milliseconds);
}

}  // namespace synth_runtime::test
