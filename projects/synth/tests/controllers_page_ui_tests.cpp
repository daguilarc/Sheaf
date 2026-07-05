#include "synth/ControllersPageUI.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "controllers page UI tests must not see JUCE"
#endif

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const std::string& id)
{
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.id == synth::ui::NodeId(id))
        {
            return &node;
        }
    }
    return nullptr;
}

synth::MidiControllerSlot MakeWrldBldrSlot(const char* name)
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

synth::MidiControllerSlot MakeLaunchpadSlot(const char* name)
{
    synth::MidiControllerSlot slot;
    slot.name = name;
    slot.kind = synth::MidiProfileKind::Launchpad;
    slot.config = synth::LaunchpadDefaultProfileConfig();
    slot.input.name = "Launchpad X";
    return slot;
}

synth::MidiControllerSlot MakeGenericSlot(const char* name)
{
    synth::MidiControllerSlot slot;
    slot.name = name;
    slot.kind = synth::MidiProfileKind::Generic;
    return slot;
}

synth::MidiInstrumentConfig MakeInstrument()
{
    synth::MidiInstrumentConfig instrument;
    Require(instrument.AddController(MakeWrldBldrSlot("wrld")), "add wrld");
    Require(instrument.AddController(MakeLaunchpadSlot("pads")), "add pads");
    Require(instrument.AddController(MakeGenericSlot("blank")), "add blank");
    return instrument;
}

synth::MidiConnectionState MakeConnectionState()
{
    synth::MidiConnectionState state;
    state.controllers.push_back({});
    state.controllers.push_back({});
    state.controllers.push_back({});
    state.controllers[0].input.status = synth::MidiEndpointStatus::Online;
    state.controllers[0].output.status = synth::MidiEndpointStatus::Online;
    state.controllers[1].input.status = synth::MidiEndpointStatus::Offline;
    state.controllers[1].output.status = synth::MidiEndpointStatus::Unconfigured;
    state.controllers[2].input.status = synth::MidiEndpointStatus::Unconfigured;
    state.controllers[2].output.status = synth::MidiEndpointStatus::Unconfigured;
    return state;
}

struct TestHarness
{
    synth::MidiInstrumentConfig instrument = MakeInstrument();
    synth::MidiConnectionState connection = MakeConnectionState();
    synth::MidiDeviceList devices;
    std::string status;
    int commits = 0;

    TestHarness()
    {
        devices.inputs.push_back({"wrldbldr-in-id", "WRLD.Bldr In"});
        devices.outputs.push_back({"wrldbldr-out-id", "WRLD.Bldr Out"});
    }

    synth::runtime_ui::ControllersPageSurface MakeSurface()
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] { return instrument; };
        callbacks.connectionState = [this] { return connection; };
        callbacks.enumerateDevices = [this] { return devices; };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig out) {
            instrument = std::move(out);
            connection.controllers.resize(instrument.controllers.size());
            ++commits;
        };
        callbacks.setStatus = [this](std::string text) { status = std::move(text); };
        return synth::runtime_ui::ControllersPageSurface(std::move(callbacks));
    }
};

}  // namespace

int main()
{
    TestHarness harness;
    synth::runtime_ui::ControllersPageSurface surface = harness.MakeSurface();
    surface.SetEnumerateDevices(harness.devices);
    surface.SetContentBounds({0.0f, 0.0f, 900.0f, 700.0f});
    surface.MarkDirty();
    surface.RefreshOnTick();
    Require(surface.ViewModel().Controllers().size() == 3, "initial controller rows rebuild");

    const synth::ui::NodeTree initialTree = surface.BuildTree();
    Require(FindNodeById(initialTree, synth::runtime_ui::NodeIds::kBack) != nullptr, "back button node");
    Require(FindNodeById(initialTree, synth::runtime_ui::NodeIds::kScroll) != nullptr, "scroll area node");
    Require(FindNodeById(initialTree, synth::runtime_ui::NodeIds::kAddButton) != nullptr, "add controller button");

    surface.SetAddControllerDraft("newctl", "generic");
    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kAddController, "newctl:generic"));
    Require(harness.commits == 1, "add controller commits");
    Require(harness.instrument.controllers.size() == 4, "add controller increases count");
    Require(harness.status.find("Added") != std::string::npos, "add controller status");

    surface.MarkDirty();
    surface.RefreshOnTick();
    Require(surface.ViewModel().Controllers().size() == 4, "controller rows rebuild after add");
    const synth::ui::NodeTree afterAddTree = surface.BuildTree();
    const synth::ui::Node* inputCombo =
        FindNodeById(afterAddTree, synth::runtime_ui::NodeIds::ControllerInput(0));
    Require(inputCombo != nullptr && !inputCombo->options.empty(), "endpoint selector renders");

    surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kEndpointSelect, "0:output:none"));
    Require(harness.commits == 2, "endpoint clear commits");
    Require(harness.instrument.controllers[0].output.identifier.empty(), "endpoint cleared");
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kEndpointSelect, "0:output:wrldbldr-out-id"));
    Require(harness.commits == 3, "endpoint device selection commits");
    Require(harness.instrument.controllers[0].output.identifier == "wrldbldr-out-id", "endpoint device selected");
    Require(harness.status == "Selected WRLD.Bldr Out", "endpoint device selection status");
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kEndpointSelect, "1:input:keep_offline"));
    Require(harness.commits == 3, "offline endpoint keep is a no-op");

    surface.MarkDirty();
    surface.RefreshOnTick();
    surface.ViewModel().ToggleConfig(0);
    surface.ViewModel().ToggleSection(0, synth::MidiConfigSection::Encoders);
    surface.MarkDirty();
    surface.RefreshOnTick();
    const synth::ui::NodeTree expandedTree = surface.BuildTree();
    const synth::ui::Node* encoderSection =
        FindNodeById(expandedTree,
                     synth::runtime_ui::NodeIds::SectionBody(0, synth::MidiConfigSection::Encoders));
    Require(encoderSection != nullptr &&
                encoderSection->bounds.height > synth::runtime_ui::ControllersLayout::kSectionMaxHeight,
            "expanded encoder section is not capped");

    const std::vector<synth::MidiMappingRowVM> editableEncoderRows =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders);
    std::optional<std::size_t> turnStepRowIx;
    for (std::size_t ix = 0; ix < editableEncoderRows.size(); ++ix)
    {
        for (synth::MidiMappingRowVM::Field field : editableEncoderRows[ix].editableFields)
        {
            if (field == synth::MidiMappingRowVM::Field::TurnStep)
            {
                turnStepRowIx = ix;
                break;
            }
        }
        if (turnStepRowIx.has_value())
        {
            break;
        }
    }
    Require(turnStepRowIx.has_value(), "find editable turn-step row");

    const std::string acceptValue = "0:encoders:" + std::to_string(*turnStepRowIx) + ":" +
                                    std::to_string(static_cast<int>(synth::MidiMappingRowVM::Field::TurnStep)) +
                                    ":0.25";
    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kMappingFieldCommit, acceptValue));
    Require(harness.commits == 4, "mapping edit acceptance commits");
    Require(harness.status == "OK", "mapping edit accepted status");

    const std::string refuseValue = "0:encoders:" + std::to_string(*turnStepRowIx) + ":" +
                                    std::to_string(static_cast<int>(synth::MidiMappingRowVM::Field::TurnStep)) +
                                    ":-1";
    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kMappingFieldCommit, refuseValue));
    Require(harness.commits == 4, "mapping edit refusal does not commit");
    Require(harness.status.find("Refused") != std::string::npos, "mapping edit refusal status");

    const std::size_t rowCountBeforeAdd =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders).size();
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kAddSingle, "0:encoders:encoder_turn"));
    Require(harness.commits == 5, "add row commits");
    surface.MarkDirty();
    surface.RefreshOnTick();
    Require(surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders).size() == rowCountBeforeAdd + 1,
            "add row increases section rows");

    const std::vector<synth::MidiMappingRowVM> rowsBeforeDelete =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders);
    std::optional<std::size_t> deleteRowIx;
    for (std::size_t ix = 0; ix < rowsBeforeDelete.size(); ++ix)
    {
        if (rowsBeforeDelete[ix].deletable && rowsBeforeDelete[ix].kind == synth::MidiMappingRowVM::Kind::Individual)
        {
            deleteRowIx = ix;
            break;
        }
    }
    Require(deleteRowIx.has_value(), "find deletable individual row");
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kDeleteRow, "0:encoders:" + std::to_string(*deleteRowIx)));
    Require(harness.commits == 6, "delete row commits");

    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kAddBlock, "0:encoders:encoder_turn"));
    Require(harness.commits == 7, "add block commits");

    surface.MarkDirty();
    surface.RefreshOnTick();
    const std::vector<synth::MidiMappingRowVM> encoderRows =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders);
    std::optional<std::size_t> blockRowIx;
    for (std::size_t ix = 0; ix < encoderRows.size(); ++ix)
    {
        if (encoderRows[ix].kind == synth::MidiMappingRowVM::Kind::Block)
        {
            blockRowIx = ix;
            break;
        }
    }
    Require(blockRowIx.has_value(), "add block creates block row");
    surface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kDeleteRow, "0:encoders:" + std::to_string(*blockRowIx)));
    Require(harness.commits == 8, "delete block commits");

    surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kVariantSelect, "1:1"));
    Require(harness.commits == 9, "launchpad variant selection commits");

    surface.ViewModel().ToggleConfig(2);
    surface.ViewModel().ToggleSection(2, synth::MidiConfigSection::Encoders);
    surface.MarkDirty();
    surface.RefreshOnTick();
    bool foundEmptyGroupAdd = false;
    for (const synth::ui::Node& node : surface.BuildTree().nodes)
    {
        if (node.action.has_value() && node.action->name == synth::runtime_ui::Actions::kAddSingle &&
            node.action->value.find("2:encoders:") == 0)
        {
            foundEmptyGroupAdd = true;
        }
    }
    Require(foundEmptyGroupAdd, "empty-group add affordance");

    harness.instrument.controllers[0].name = "renamed_out_of_band";
    surface.MarkDirty();
    surface.RefreshOnTick();
    const synth::ui::NodeTree renamedTree = surface.BuildTree();
    const synth::ui::Node* renamed =
        FindNodeById(renamedTree, synth::runtime_ui::NodeIds::ControllerName(0));
    Require(renamed != nullptr && renamed->text == "renamed_out_of_band", "out-of-band refresh updates tree");

    surface.SetFocusGuard([] { return true; });
    harness.connection.controllers[0].input.status = synth::MidiEndpointStatus::Offline;
    surface.MarkDirty();
    surface.RefreshOnTick();
    Require(surface.ViewModel().Controllers()[0].inputStatus == synth::MidiEndpointStatus::Online,
            "focus guard blocks refresh while editing");
    surface.SetFocusGuard({});
    surface.RefreshOnTick();
    Require(surface.ViewModel().Controllers()[0].inputStatus == synth::MidiEndpointStatus::Offline,
            "deferred refresh after focus released");

    std::cout << "controllers_page_ui_tests passed\n";
    return 0;
}
