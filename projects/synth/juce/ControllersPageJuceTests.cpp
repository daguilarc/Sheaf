#include "ControllersPageJuce.hpp"

#include "synth/ControllersPageUI.hpp"

#include <iostream>
#include <stdexcept>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    synth::MidiInstrumentConfig instrument;
    instrument.AddController(synth::MidiControllerSlot{});
    instrument.controllers[0].name = "wrld";
    instrument.controllers[0].kind = synth::MidiProfileKind::WrldBldr;
    instrument.controllers[0].config = synth::WrldBldrDefaultProfileConfig();
    instrument.AddController(synth::MidiControllerSlot{});
    instrument.controllers[1].name = "launch";
    instrument.controllers[1].kind = synth::MidiProfileKind::Launchpad;
    instrument.controllers[1].config = synth::LaunchpadDefaultProfileConfig();

    synth::MidiConnectionState connection;
    connection.controllers.push_back({});
    connection.controllers.push_back({});

    synth::MidiDeviceList devices;
    devices.inputs.push_back({"in-1", "Input One"});
    devices.outputs.push_back({"out-1", "Output One"});

    synth::runtime_ui::ControllersPageCallbacks callbacks;
    synth::MidiInstrumentConfig liveInstrument = instrument;
    callbacks.instrumentSnapshot = [&liveInstrument] { return liveInstrument; };
    callbacks.connectionState = [&connection] { return connection; };
    callbacks.enumerateDevices = [&devices] { return devices; };
    callbacks.commitInstrument = [&liveInstrument](synth::MidiInstrumentConfig out) {
        liveInstrument = std::move(out);
    };

    synth::runtime_ui::ControllersPageSurface surface(std::move(callbacks));
    surface.SetEnumerateDevices(devices);
    surface.SetContentBounds({0.0f, 0.0f, 900.0f, 700.0f});
    surface.MarkDirty();
    surface.RefreshOnTick();

    synth_runtime::ControllersTreeRenderer renderer(surface);
    renderer.setSize(900, 700);
    renderer.RefreshFromSurface();

    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kBack) != nullptr, "controllers back renders");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddButton) != nullptr, "controllers add renders");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerInput(0)) != nullptr,
            "controllers endpoint combo renders");

    auto* secondRow = renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(1));
    auto* secondName = renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerName(1));
    auto* addRow = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddRow);
    auto* addButton = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddButton);
    Require(secondRow != nullptr, "controllers second row renders");
    Require(secondName != nullptr, "controllers second name renders");
    Require(secondName->getParentComponent() == secondRow, "controllers second name belongs to second row");
    Require(secondName->getY() >= 0 && secondName->getBottom() <= secondRow->getHeight(),
            "controllers second row children are visible inside row");
    Require(addRow != nullptr, "controllers add row renders");
    Require(addButton != nullptr, "controllers add button renders");
    Require(addButton->getParentComponent() == addRow, "controllers add button belongs to add row");
    Require(addButton->getY() >= 0 && addButton->getBottom() <= addRow->getHeight(),
            "controllers add row children are visible inside row");

    auto* addName = dynamic_cast<juce::TextEditor*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddName));
    Require(addName != nullptr, "controllers add-name editor renders");
    addName->setText("draft controller", juce::dontSendNotification);
    renderer.RefreshFromSurface();
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddName) == addName,
            "controllers no-op refresh preserves editor component");
    Require(addName->getText().toStdString() == "draft controller",
            "controllers no-op refresh preserves editor draft");

    surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleConfig, "0"));
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kToggleSection,
        "0:" + synth::runtime_ui::ControllersLayout::SectionToken(synth::MidiConfigSection::Encoders)));
    renderer.RefreshFromSurface();
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::SectionBody(0, synth::MidiConfigSection::Encoders)) !=
                nullptr,
            "controllers section body renders");

    std::cout << "ControllersPageJuceTests passed\n";
    return 0;
}
