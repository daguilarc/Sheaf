#include "synth/ControllersPageUI.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "controllers page UI tests must not see JUCE"
#endif

#include <iostream>
#include <algorithm>
#include <cctype>
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

void SeedGridPresentation(TestHarness& harness)
{
    for (std::size_t controllerIx : {std::size_t{0}, std::size_t{1}})
    {
        auto& slot = harness.instrument.controllers[controllerIx];
        slot.config.systemMessages.clear();
        slot.config.pressureInput = synth::PolyphonicPressureMidiInConfig{};
    }

    synth::GridMappingExpansion wrld;
    synth::GridBlock wrldBlock;
    wrldBlock.kind = synth::MidiProfileKind::WrldBldr;
    wrldBlock.channel = 5;
    wrldBlock.startX = 0;
    wrldBlock.startY = 0;
    wrldBlock.endX = 2;
    wrldBlock.endY = 1;
    wrldBlock.gridSlotIx = 3;
    Require(synth::ExpandGridBlock(wrldBlock, wrld), "expand wrld grid block");
    synth::GridButton wrldButton;
    wrldButton.kind = synth::MidiProfileKind::WrldBldr;
    wrldButton.channel = 5;
    wrldButton.x = 3;
    wrldButton.y = 3;
    wrldButton.gridSlotIx = 4;
    Require(synth::ExpandGridButton(wrldButton, wrld), "expand wrld grid button");
    harness.instrument.controllers[0].config.systemMessages = wrld.systemMessages;
    harness.instrument.controllers[0].config.pressureInput->mappings = wrld.pressureMappings;

    synth::GridMappingExpansion launchpad;
    synth::GridBlock launchpadBlock;
    launchpadBlock.kind = synth::MidiProfileKind::Launchpad;
    launchpadBlock.startX = 0;
    launchpadBlock.startY = -1;
    launchpadBlock.endX = 2;
    launchpadBlock.endY = 0;
    launchpadBlock.gridSlotIx = 7;
    Require(synth::ExpandGridBlock(launchpadBlock, launchpad), "expand launchpad grid block");
    harness.instrument.controllers[1].config.systemMessages = launchpad.systemMessages;
    harness.instrument.controllers[1].config.pressureInput->mappings = launchpad.pressureMappings;
    synth::PolyphonicPressureMapping orphan;
    orphan.address = synth::MidiNoteAddress{.channel = 15, .note = 127};
    orphan.pressure = synth::MessageIn::GridPressureChange(17, 88, -9, 12, 33);
    harness.instrument.controllers[1].config.pressureInput->mappings.push_back(orphan);
}

std::string VisibleTextLower(const synth::ui::NodeTree& tree)
{
    std::string text;
    for (const synth::ui::Node& node : tree.nodes)
    {
        text += node.label;
        text += ' ';
        text += node.text;
        text += ' ';
        for (const synth::ui::ControlOption& option : node.options)
        {
            text += option.label;
            text += ' ';
        }
    }
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

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
    const synth::ui::Node* addName =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::kAddName);
    const synth::ui::Node* addKind =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::kAddKind);
    Require(addName != nullptr && addName->action.has_value() &&
                addName->action->name == "runtime.controllers.add_name_draft",
            "add controller name edits dispatch a portable draft action");
    Require(addKind != nullptr && addKind->action.has_value() &&
                addKind->action->name == "runtime.controllers.add_kind_draft",
            "add controller kind edits dispatch a portable draft action");
    const synth::ui::Node* wrldInput =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::ControllerInput(0));
    const synth::ui::Node* padsInput =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::ControllerInput(1));
    const synth::ui::Node* wrldOutput =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::ControllerOutput(0));
    const synth::ui::Node* padsOutput =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::ControllerOutput(1));
    const synth::ui::Node* padsVariant =
        FindNodeById(initialTree, synth::runtime_ui::NodeIds::ControllerVariant(1));
    const synth::ui::Node* scrollNode = FindNodeById(initialTree, synth::runtime_ui::NodeIds::kScroll);
    Require(wrldInput != nullptr && padsInput != nullptr && wrldOutput != nullptr && padsOutput != nullptr,
            "controller device controls render");
    Require(padsVariant != nullptr, "launchpad variant selector renders");
    Require(scrollNode != nullptr, "scroll area node still present");
    Require(wrldInput->bounds.x == padsInput->bounds.x, "launchpad input aligns with other controller inputs");
    Require(wrldOutput->bounds.x == padsOutput->bounds.x, "launchpad output aligns with other controller outputs");
    Require(padsVariant->bounds.x > padsOutput->bounds.x + padsOutput->bounds.width,
            "launchpad variant sits to the right of output");
    Require(scrollNode->scrollContentWidth >= padsVariant->bounds.x + padsVariant->bounds.width,
            "scroll content reserves launchpad variant width");

    surface.DispatchAction(
        synth::ui::Action::WithValue("runtime.controllers.add_name_draft", "newctl"));
    surface.DispatchAction(
        synth::ui::Action::WithValue("runtime.controllers.add_kind_draft", "generic"));
    surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kAddController));
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

    surface.SetContentBounds({0.0f, 0.0f, 900.0f, 260.0f});
    if (!surface.ViewModel().Controllers()[0].configExpanded)
    {
        surface.ViewModel().ToggleConfig(0);
    }
    if (!surface.ViewModel().SectionExpanded(0, synth::MidiConfigSection::SystemMessages))
    {
        surface.ViewModel().ToggleSection(0, synth::MidiConfigSection::SystemMessages);
    }
    surface.MarkDirty();
    surface.RefreshOnTick();
    const synth::ui::NodeTree scrolledTree = surface.BuildTree();
    const synth::ui::Node* scroll = FindNodeById(scrolledTree, synth::runtime_ui::NodeIds::kScroll);
    Require(scroll != nullptr, "scroll node exists for small viewport");
    Require(scroll->scrollContentHeight > scroll->bounds.height, "scroll content extent exceeds viewport height");

    bool sawSystemMessageKindCombo = false;
    for (const synth::ui::Node& node : scrolledTree.nodes)
    {
        if (node.kind != synth::ui::NodeKind::ComboBox)
        {
            continue;
        }
        bool hasSceneSelect = false;
        for (const synth::ui::ControlOption& option : node.options)
        {
            Require(option.label.find("Scene Select ") == std::string::npos,
                    "scene select combo label does not bake argument");
            Require(option.label.find("Bank Select ") == std::string::npos,
                    "bank select combo label does not bake argument");
            Require(option.label.find("Gesture Select ") == std::string::npos,
                    "gesture select combo label does not bake argument");
            if (option.label == "Scene Select")
            {
                hasSceneSelect = true;
            }
        }
        sawSystemMessageKindCombo = sawSystemMessageKindCombo || hasSceneSelect;
    }
    Require(sawSystemMessageKindCombo, "system message kind combo uses argument-free labels");

    if (!surface.ViewModel().SectionExpanded(0, synth::MidiConfigSection::Encoders))
    {
        surface.ViewModel().ToggleSection(0, synth::MidiConfigSection::Encoders);
    }
    surface.MarkDirty();
    surface.RefreshOnTick();
    const std::vector<synth::MidiMappingRowVM> rowsBeforeAbsolute =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders);
    std::optional<std::size_t> modeRowIx;
    std::optional<std::size_t> retainedStepRowIx;
    for (std::size_t ix = 0; ix < rowsBeforeAbsolute.size(); ++ix)
    {
        if (rowsBeforeAbsolute[ix].group == synth::MidiMappingRowVM::RowGroup::EncoderMode)
        {
            modeRowIx = ix;
        }
        if (rowsBeforeAbsolute[ix].group == synth::MidiMappingRowVM::RowGroup::EncoderStep)
        {
            retainedStepRowIx = ix;
        }
    }
    Require(modeRowIx.has_value() && retainedStepRowIx.has_value(), "mode and step rows remain present");
    Require(!rowsBeforeAbsolute[*modeRowIx].deletable && !rowsBeforeAbsolute[*retainedStepRowIx].deletable,
            "mode and step rows remain non-deletable");

    const synth::ui::NodeTree beforeAbsoluteTree = surface.BuildTree();
    const synth::ui::Node* modeFieldBefore = FindNodeById(
        beforeAbsoluteTree,
        synth::runtime_ui::NodeIds::MappingField(
            0, synth::MidiConfigSection::Encoders, *modeRowIx, synth::MidiMappingRowVM::Field::EncoderMode));
    Require(modeFieldBefore != nullptr && modeFieldBefore->options.size() == 3,
            "portable mode combo exposes three declaration-order choices");
    Require(modeFieldBefore->options[0].label == "Signed 7-bit" &&
                modeFieldBefore->options[1].label == "Direction only" &&
                modeFieldBefore->options[2].label == "Absolute",
            "portable mode combo labels all modes in declaration order");
    Require(modeFieldBefore->selectedOption == "0", "portable mode combo starts signed 7-bit");
    bool sawRelativeOnlyCue = false;
    for (const synth::ui::Node& node : beforeAbsoluteTree.nodes)
    {
        sawRelativeOnlyCue = sawRelativeOnlyCue || node.label.find("relative modes only") != std::string::npos;
    }
    Require(sawRelativeOnlyCue, "portable turn-step row identifies relative-only behavior");

    const std::string absoluteValue =
        "0:encoders:" + std::to_string(*modeRowIx) + ":" +
        std::to_string(static_cast<int>(synth::MidiMappingRowVM::Field::EncoderMode)) + ":2";
    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kMappingFieldCommit, absoluteValue));
    Require(harness.commits == 10, "absolute mode edit commits through Controllers surface");
    Require(harness.instrument.controllers[0].config.encoderInput->mode == synth::EncoderMode::Absolute,
            "Controllers commit persists absolute mode");
    Require(harness.instrument.controllers[0].config.encoderInput->turnStep == 0.25f,
            "absolute mode commit retains stored relative turn step");

    surface.MarkDirty();
    surface.RefreshOnTick();
    const std::vector<synth::MidiMappingRowVM> rowsAfterAbsolute =
        surface.ViewModel().SectionRows(0, synth::MidiConfigSection::Encoders);
    Require(rowsAfterAbsolute.size() == rowsBeforeAbsolute.size(), "absolute rebuild keeps open row count");
    for (std::size_t ix = 0; ix < rowsBeforeAbsolute.size(); ++ix)
    {
        Require(rowsAfterAbsolute[ix].kind == rowsBeforeAbsolute[ix].kind &&
                    rowsAfterAbsolute[ix].group == rowsBeforeAbsolute[ix].group,
                "absolute rebuild keeps open row identity and order");
    }
    const synth::ui::NodeTree afterAbsoluteTree = surface.BuildTree();
    const synth::ui::Node* modeFieldAfter = FindNodeById(
        afterAbsoluteTree,
        synth::runtime_ui::NodeIds::MappingField(
            0, synth::MidiConfigSection::Encoders, *modeRowIx, synth::MidiMappingRowVM::Field::EncoderMode));
    Require(modeFieldAfter != nullptr && modeFieldAfter->selectedOption == "2",
            "open portable mode row survives rebuild with absolute selected");

    synth::MessageInBus absoluteBus(nullptr, 16);
    auto absoluteProfile = synth::CreateMidiControllerProfile(
        harness.instrument.controllers[0].config, &absoluteBus, nullptr, nullptr, [] { return 701; });
    Require(absoluteProfile.input != nullptr, "committed config rebuilds live input processor");
    const auto turn = harness.instrument.controllers[0].config.encoderInput->turns.front();
    absoluteProfile.input->Process(synth::BasicMidi::CC(1, turn.control.channel, turn.control.cc, 127));
    synth::MessageIn message;
    Require(absoluteBus.Pop(message, 701) && message.type == synth::MessageIn::Type::ParamSetAbsolute &&
                message.value == 1.0f,
            "rebuilt processor applies committed absolute mode");

    const std::string relativeValue =
        "0:encoders:" + std::to_string(*modeRowIx) + ":" +
        std::to_string(static_cast<int>(synth::MidiMappingRowVM::Field::EncoderMode)) + ":0";
    surface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kMappingFieldCommit, relativeValue));
    Require(harness.commits == 11, "switching back to signed mode commits");
    Require(harness.instrument.controllers[0].config.encoderInput->turnStep == 0.25f,
            "switching back restores stored relative step");
    synth::MessageInBus relativeBus(nullptr, 16);
    auto relativeProfile = synth::CreateMidiControllerProfile(
        harness.instrument.controllers[0].config, &relativeBus, nullptr, nullptr, [] { return 702; });
    relativeProfile.input->Process(synth::BasicMidi::CC(1, turn.control.channel, turn.control.cc, 65));
    Require(relativeBus.Pop(message, 702) && message.type == synth::MessageIn::Type::ParamIncDec &&
                message.delta == 0.25f,
            "rebuilt relative processor uses the retained step");

    TestHarness typedHarness;
    synth::MidiControllerSlot& generic = typedHarness.instrument.controllers[2];
    synth::EncoderMidiInConfig typedEncoders;
    typedEncoders.turns.push_back({.control = {.channel = 1, .cc = 10}, .slotIx = 0, .position = 0});
    typedEncoders.pushes.push_back(
        {.control = {.channel = 1, .cc = 60, .type = synth::MidiControlType::Note}, .slotIx = 0, .position = 0});
    typedEncoders.pushes.push_back(
        {.control = {.channel = 1, .cc = 61, .type = synth::MidiControlType::Note}, .slotIx = 0, .position = 1});
    typedEncoders.pushes.push_back({.control = {.channel = 1, .cc = 90}, .slotIx = 0, .position = 9});
    generic.config.encoderInput = std::move(typedEncoders);

    auto makeGenericScene = [](std::uint8_t cc, std::size_t sceneIx, synth::MidiControlType type) {
        synth::MidiControllerSystemMessageAssociation association;
        association.control = synth::MidiControlAddress{.channel = 2, .cc = cc, .type = type};
        association.press = synth::MessageIn::SceneSelect(0, sceneIx);
        association.feedback = association.press;
        return association;
    };
    generic.config.systemMessages = {
        makeGenericScene(40, 0, synth::MidiControlType::Note),
        makeGenericScene(41, 1, synth::MidiControlType::Note),
        makeGenericScene(90, 9, synth::MidiControlType::Cc),
    };

    synth::runtime_ui::ControllersPageSurface typedSurface = typedHarness.MakeSurface();
    typedSurface.SetEnumerateDevices(typedHarness.devices);
    typedSurface.SetContentBounds({0.0f, 0.0f, 1000.0f, 800.0f});
    typedSurface.MarkDirty();
    typedSurface.RefreshOnTick();
    typedSurface.ViewModel().ToggleConfig(2);
    typedSurface.ViewModel().ToggleSection(2, synth::MidiConfigSection::Encoders);
    typedSurface.ViewModel().ToggleSection(2, synth::MidiConfigSection::SystemMessages);
    typedSurface.ViewModel().ToggleConfig(0);
    typedSurface.ViewModel().ToggleSection(0, synth::MidiConfigSection::SystemMessages);
    typedSurface.MarkDirty();
    typedSurface.RefreshOnTick();

    const std::vector<synth::MidiMappingRowVM> typedEncoderRows =
        typedSurface.ViewModel().SectionRows(2, synth::MidiConfigSection::Encoders);
    std::optional<std::size_t> pushBlockIx;
    std::optional<std::size_t> pushIndividualIx;
    std::optional<std::size_t> turnIx;
    for (std::size_t ix = 0; ix < typedEncoderRows.size(); ++ix)
    {
        if (typedEncoderRows[ix].group == synth::MidiMappingRowVM::RowGroup::EncoderTurn)
        {
            turnIx = ix;
        }
        else if (typedEncoderRows[ix].group == synth::MidiMappingRowVM::RowGroup::EncoderPush &&
                 typedEncoderRows[ix].kind == synth::MidiMappingRowVM::Kind::Block)
        {
            pushBlockIx = ix;
        }
        else if (typedEncoderRows[ix].group == synth::MidiMappingRowVM::RowGroup::EncoderPush &&
                 typedEncoderRows[ix].kind == synth::MidiMappingRowVM::Kind::Individual)
        {
            pushIndividualIx = ix;
        }
    }
    Require(pushBlockIx.has_value() && pushIndividualIx.has_value() && turnIx.has_value(),
            "typed encoder fixture has turn, push block, and push individual rows");

    const std::vector<synth::MidiMappingRowVM> typedSystemRows =
        typedSurface.ViewModel().SectionRows(2, synth::MidiConfigSection::SystemMessages);
    std::optional<std::size_t> systemBlockIx;
    std::optional<std::size_t> systemIndividualIx;
    for (std::size_t ix = 0; ix < typedSystemRows.size(); ++ix)
    {
        if (typedSystemRows[ix].kind == synth::MidiMappingRowVM::Kind::Block)
        {
            systemBlockIx = ix;
        }
        else if (typedSystemRows[ix].kind == synth::MidiMappingRowVM::Kind::Individual)
        {
            systemIndividualIx = ix;
        }
    }
    Require(systemBlockIx.has_value() && systemIndividualIx.has_value(),
            "typed system fixture has block and individual rows");

    const synth::ui::NodeTree typedTree = typedSurface.BuildTree();
    const synth::ui::Node* blockMessageTypeHeader = FindNodeById(
        typedTree,
        synth::runtime_ui::NodeIds::GroupColumnLabel(
            2, synth::MidiConfigSection::SystemMessages, 0, 0));
    const synth::ui::Node* blockAddressTypeHeader = FindNodeById(
        typedTree,
        synth::runtime_ui::NodeIds::GroupColumnLabel(
            2, synth::MidiConfigSection::SystemMessages, 0, 1));
    Require(blockMessageTypeHeader != nullptr && blockMessageTypeHeader->text == "Type",
            "Generic system block message-type header remains Type");
    Require(blockAddressTypeHeader != nullptr && blockAddressTypeHeader->text == "Addr",
            "Generic system block address-type header is distinct");

    auto requireTypeCombo = [&](synth::MidiConfigSection section, std::size_t rowIx,
                                const std::string& selected) -> const synth::ui::Node* {
        const synth::ui::Node* node = FindNodeById(
            typedTree,
            synth::runtime_ui::NodeIds::MappingField(
                2, section, rowIx, synth::MidiMappingRowVM::Field::AddressType));
        Require(node != nullptr && node->kind == synth::ui::NodeKind::ComboBox,
                "address type renders as combo box");
        Require(node->options.size() == 2 && node->options[0].id == "0" && node->options[0].label == "CC" &&
                    node->options[1].id == "1" && node->options[1].label == "Note",
                "address type combo exposes CC and Note in enum order");
        Require(node->selectedOption == selected, "address type combo selection follows model");
        return node;
    };
    requireTypeCombo(synth::MidiConfigSection::Encoders, *pushBlockIx, "1");
    const synth::ui::Node* pushIndividualType =
        requireTypeCombo(synth::MidiConfigSection::Encoders, *pushIndividualIx, "0");
    requireTypeCombo(synth::MidiConfigSection::SystemMessages, *systemBlockIx, "1");
    requireTypeCombo(synth::MidiConfigSection::SystemMessages, *systemIndividualIx, "0");

    const synth::ui::Node* numericAddress = FindNodeById(
        typedTree,
        synth::runtime_ui::NodeIds::MappingField(
            2, synth::MidiConfigSection::Encoders, *pushIndividualIx, synth::MidiMappingRowVM::Field::Cc));
    const synth::ui::Node* numericChannel = FindNodeById(
        typedTree,
        synth::runtime_ui::NodeIds::MappingField(
            2, synth::MidiConfigSection::Encoders, *pushIndividualIx, synth::MidiMappingRowVM::Field::Channel));
    Require(numericAddress != nullptr && numericAddress->kind == synth::ui::NodeKind::TextField &&
                numericAddress->text == "90",
            "note-capable row keeps numeric message number as decimal text field");
    Require(numericChannel != nullptr && numericChannel->kind == synth::ui::NodeKind::TextField &&
                numericChannel->text == "1",
            "note-capable row keeps channel as decimal text field");
    Require(FindNodeById(
                typedTree,
                synth::runtime_ui::NodeIds::MappingField(
                    2, synth::MidiConfigSection::Encoders, *turnIx,
                    synth::MidiMappingRowVM::Field::AddressType)) == nullptr,
            "encoder turn has no address type node");
    const std::vector<synth::MidiMappingRowVM> wrldSystemRows =
        typedSurface.ViewModel().SectionRows(0, synth::MidiConfigSection::SystemMessages);
    for (std::size_t ix = 0; ix < wrldSystemRows.size(); ++ix)
    {
        Require(FindNodeById(
                    typedTree,
                    synth::runtime_ui::NodeIds::MappingField(
                        0, synth::MidiConfigSection::SystemMessages, ix,
                        synth::MidiMappingRowVM::Field::AddressType)) == nullptr,
                "controller-specific system row has no address type node");
    }

    Require(pushIndividualType->action.has_value() &&
                pushIndividualType->action->name == synth::runtime_ui::Actions::kMappingFieldCommit,
            "address type combo uses existing mapping commit action");
    typedSurface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kMappingFieldCommit, pushIndividualType->action->value + ":1"));
    Require(typedHarness.commits == 1, "address type combo commits through Controllers surface");
    bool committedNote90 = false;
    for (const synth::EncoderMidiMapping& mapping : typedHarness.instrument.controllers[2].config.encoderInput->pushes)
    {
        committedNote90 = committedNote90 ||
                          (mapping.control.cc == 90 && mapping.control.type == synth::MidiControlType::Note);
    }
    Require(committedNote90, "address type combo commit persists Note without changing number");

    typedSurface.MarkDirty();
    typedSurface.RefreshOnTick();
    const synth::ui::NodeTree committedTypedTree = typedSurface.BuildTree();
    const synth::ui::Node* committedType = FindNodeById(
        committedTypedTree,
        synth::runtime_ui::NodeIds::MappingField(
            2, synth::MidiConfigSection::Encoders, *pushIndividualIx,
            synth::MidiMappingRowVM::Field::AddressType));
    Require(committedType != nullptr && committedType->selectedOption == "1",
            "committed Note selection survives open-session rebuild");

    const synth::ui::Node* systemIndividualType = FindNodeById(
        committedTypedTree,
        synth::runtime_ui::NodeIds::MappingField(
            2, synth::MidiConfigSection::SystemMessages, *systemIndividualIx,
            synth::MidiMappingRowVM::Field::AddressType));
    Require(systemIndividualType != nullptr && systemIndividualType->action.has_value(),
            "Generic system address type combo remains dispatchable");
    typedSurface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kMappingFieldCommit, systemIndividualType->action->value + ":1"));
    Require(typedHarness.commits == 2, "Generic system address type combo commits");
    bool committedSystemNote90 = false;
    for (const synth::MidiControllerSystemMessageAssociation& association :
         typedHarness.instrument.controllers[2].config.systemMessages)
    {
        committedSystemNote90 = committedSystemNote90 ||
                                (association.control.has_value() && association.control->cc == 90 &&
                                 association.control->type == synth::MidiControlType::Note);
    }
    Require(committedSystemNote90, "Generic system combo persists Note without changing number");
    TestHarness gridHarness;
    SeedGridPresentation(gridHarness);
    synth::runtime_ui::ControllersPageSurface gridSurface = gridHarness.MakeSurface();
    gridSurface.SetContentBounds({0.0f, 0.0f, 900.0f, 260.0f});
    gridSurface.MarkDirty();
    gridSurface.RefreshOnTick();
    gridSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleConfig, "0"));
    gridSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleSection, "0:system_messages"));
    gridSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleConfig, "1"));
    gridSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleSection, "1:system_messages"));

    const synth::ui::NodeTree gridTree = gridSurface.BuildTree();
    const std::string visible = VisibleTextLower(gridTree);
    Require(visible.find("grid button") != std::string::npos, "portable tree shows Grid Button");
    Require(visible.find("grid block") != std::string::npos, "portable tree shows Grid Block");
    for (const char* label : {"grid slot", "x min", "x max", "y min", "y max"})
    {
        Require(visible.find(label) != std::string::npos, "portable tree shows exact grid field label");
    }
    Require(visible.find("aftertouch") == std::string::npos, "portable tree hides aftertouch");
    Require(visible.find("polyphonic pressure") == std::string::npos,
            "portable tree hides polyphonic pressure");
    Require(visible.find("midi status") == std::string::npos, "portable tree hides MIDI status");
    Require(visible.find("note number") == std::string::npos, "portable tree hides standalone note field");

    bool sawNegativeSignedEditor = false;
    bool sawGridAdd = false;
    std::string stableGridFieldId;
    for (const synth::ui::Node& node : gridTree.nodes)
    {
        sawNegativeSignedEditor = sawNegativeSignedEditor ||
                                  (node.kind == synth::ui::NodeKind::TextField && node.text == "-1");
        if (node.action.has_value() && node.action->name == synth::runtime_ui::Actions::kAddSingle &&
            node.action->value == "0:system_messages:grid")
        {
            sawGridAdd = true;
        }
        if (stableGridFieldId.empty() && node.id.value.find(".mapping.") != std::string::npos &&
            node.kind == synth::ui::NodeKind::TextField && node.text == "3")
        {
            stableGridFieldId = node.id.value;
        }
    }
    Require(sawNegativeSignedEditor, "portable tree renders negative signed grid coordinate");
    Require(sawGridAdd, "portable tree routes Grid add action token");
    Require(!stableGridFieldId.empty(), "portable tree exposes stable grid field id");

    gridSurface.MarkDirty();
    gridSurface.RefreshOnTick();
    Require(FindNodeById(gridSurface.BuildTree(), stableGridFieldId) != nullptr,
            "grid field node id survives rebuild");
    const int commitsBeforeGridAdd = gridHarness.commits;
    gridSurface.DispatchAction(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kAddSingle, "0:system_messages:grid"));
    Require(gridHarness.commits == commitsBeforeGridAdd + 1, "portable Grid add action commits pair");
    Require(gridHarness.instrument.controllers[0].config.pressureInput.has_value(),
            "portable Grid add preserves pressure container");
    Require(gridHarness.instrument.controllers[0].config.pressureInput->mappings.size() ==
                gridHarness.instrument.controllers[0].config.systemMessages.size(),
            "portable Grid add commits one pressure mapping per visible cell");

    std::cout << "controllers_page_ui_tests passed\n";
    return 0;
}
