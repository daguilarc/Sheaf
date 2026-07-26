#include "synth/ControllerWizard.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cctype>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace synth {

// The contract is intentionally header-defined: TypedControllerWizard must be
// instantiated by each concrete portable form type.

namespace {

constexpr std::string_view kMfTwisterWizardId = "com.sheaf.midi-fighter-twister";
constexpr std::string_view kMfTwisterDisplayName = "MIDI Fighter Twister";
constexpr std::string_view kMfTwisterAlias = "Midi Fighter Twister";
constexpr std::string_view kMfTwisterFormRootId = "controller-wizard.twister";

struct TwisterMessageChoice {
    std::string_view id;
    UISystemMessage message;
};

constexpr std::array<TwisterMessageChoice, 16> kTwisterMessageChoices = {{
    {"toggle-reset", UISystemMessage::ToggleReset},
    {"hold-reset", UISystemMessage::HoldReset},
    {"toggle-random", UISystemMessage::ToggleRandom},
    {"hold-random", UISystemMessage::HoldRandom},
    {"toggle-random-mod", UISystemMessage::ToggleRandomMod},
    {"hold-random-mod", UISystemMessage::HoldRandomMod},
    {"toggle-gesture-select", UISystemMessage::ToggleGestureSelect},
    {"hold-gesture-select", UISystemMessage::HoldGestureSelect},
    {"bank-select", UISystemMessage::SelectParamBank},
    {"next-bank", UISystemMessage::NextParamBank},
    {"previous-bank", UISystemMessage::PrevParamBank},
    {"start", UISystemMessage::Start},
    {"continue", UISystemMessage::Continue},
    {"stop", UISystemMessage::Stop},
    {"clock", UISystemMessage::Clock},
    {"scene-select", UISystemMessage::SceneSelect},
}};

std::string ButtonFieldId(std::size_t buttonIx, std::string_view field) {
    return std::string(kMfTwisterFormRootId) + ".button." + std::to_string(buttonIx) + "." +
           std::string(field);
}

std::string MessageOptionId(UISystemMessage message) {
    for (const TwisterMessageChoice& choice : kTwisterMessageChoices) {
        if (choice.message == message) {
            return std::string(choice.id);
        }
    }
    return {};
}

bool TwisterMessageAllowed(UISystemMessage message) {
    return !MessageOptionId(message).empty();
}

std::optional<UISystemMessage> MessageForOptionId(std::string_view id) {
    for (const TwisterMessageChoice& choice : kTwisterMessageChoices) {
        if (choice.id == id) {
            return choice.message;
        }
    }
    return std::nullopt;
}

// This is form policy, deliberately narrower than UISystemMessageHasArg().
// In particular, Next/Previous Bank take their slot from Encoder Slot rather
// than from a per-button argument field.
bool TwisterArgumentEnabled(UISystemMessage message) {
    switch (message) {
        case UISystemMessage::ToggleGestureSelect:
        case UISystemMessage::HoldGestureSelect:
        case UISystemMessage::SelectParamBank:
        case UISystemMessage::SceneSelect:
            return true;
        case UISystemMessage::ParamIncDec:
        case UISystemMessage::ParamSetAbsolute:
        case UISystemMessage::ParamPush:
        case UISystemMessage::ToggleReset:
        case UISystemMessage::HoldReset:
        case UISystemMessage::ToggleRandom:
        case UISystemMessage::HoldRandom:
        case UISystemMessage::ToggleRandomMod:
        case UISystemMessage::HoldRandomMod:
        case UISystemMessage::Start:
        case UISystemMessage::Continue:
        case UISystemMessage::Stop:
        case UISystemMessage::Clock:
        case UISystemMessage::SetGestureValue:
        case UISystemMessage::SetSceneBlend:
        case UISystemMessage::NextParamBank:
        case UISystemMessage::PrevParamBank:
            return false;
    }
    return false;
}

bool ParseSizeT(std::string_view text, std::size_t& result) {
    if (text.empty()) {
        return false;
    }
    const char* const first = text.data();
    const char* const last = first + text.size();
    const auto parsed = std::from_chars(first, last, result, 10);
    return parsed.ec == std::errc{} && parsed.ptr == last;
}

bool FieldHasError(std::string_view text) {
    std::size_t ignored = 0;
    return !ParseSizeT(text, ignored);
}

std::size_t AppendNode(ui::NodeTree& tree, std::size_t parentIx, ui::Node node) {
    tree.nodes[parentIx].children.push_back(node.id);
    tree.nodes.push_back(std::move(node));
    return tree.nodes.size() - 1;
}

ui::Node TextFieldNode(std::string id, std::string label, std::string text, bool enabled = true) {
    ui::Node node;
    node.id = ui::NodeId(id);
    node.kind = ui::NodeKind::TextField;
    node.label = std::move(label);
    node.text = std::move(text);
    node.enabled = enabled;
    node.action = ui::Action::Named(std::move(id));
    return node;
}

ui::Node StatusNode(std::string id, std::string text) {
    ui::Node node;
    node.id = ui::NodeId(std::move(id));
    node.kind = ui::NodeKind::StatusText;
    node.text = std::move(text);
    return node;
}

bool CaseInsensitiveEquals(std::string_view lhs, std::string_view rhs) {
    if (lhs.size() != rhs.size()) {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.size(); ++ix) {
        const auto left = static_cast<unsigned char>(lhs[ix]);
        const auto right = static_cast<unsigned char>(rhs[ix]);
        if (std::tolower(left) != std::tolower(right)) {
            return false;
        }
    }
    return true;
}

bool MatchesAnyAlias(std::string_view name, const std::vector<std::string>& aliases) {
    return std::any_of(aliases.begin(), aliases.end(), [name](const std::string& alias) {
        return CaseInsensitiveEquals(name, alias);
    });
}

void ClaimEndpoint(const MidiEndpointRef& ref,
                   const std::vector<MidiDeviceInfoRef>& devices,
                   std::vector<bool>& claimed) {
    if (!ref.IsConfigured()) {
        return;
    }

    if (!ref.identifier.empty()) {
        for (std::size_t ix = 0; ix < devices.size(); ++ix) {
            if (devices[ix].identifier == ref.identifier) {
                if (!claimed[ix]) {
                    claimed[ix] = true;
                }
                return;
            }
        }
    }

    if (!ref.name.empty()) {
        for (std::size_t ix = 0; ix < devices.size(); ++ix) {
            if (!claimed[ix] && devices[ix].name == ref.name) {
                claimed[ix] = true;
                return;
            }
        }
    }
}

std::vector<bool> ClaimedInputs(const MidiDeviceList& devices,
                                const MidiInstrumentConfig& instrument) {
    std::vector<bool> claimed(devices.inputs.size(), false);
    for (const MidiControllerSlot& slot : instrument.controllers) {
        ClaimEndpoint(slot.input, devices.inputs, claimed);
    }
    return claimed;
}

std::vector<bool> ClaimedOutputs(const MidiDeviceList& devices,
                                 const MidiInstrumentConfig& instrument) {
    std::vector<bool> claimed(devices.outputs.size(), false);
    for (const MidiControllerSlot& slot : instrument.controllers) {
        ClaimEndpoint(slot.output, devices.outputs, claimed);
    }
    return claimed;
}

std::vector<std::size_t> MatchingUnclaimedEndpoints(
    const std::vector<MidiDeviceInfoRef>& devices,
    const std::vector<bool>& claimed,
    const std::vector<bool>& assigned,
    const std::vector<std::string>& aliases) {
    std::vector<std::size_t> matches;
    for (std::size_t ix = 0; ix < devices.size(); ++ix) {
        if (!claimed[ix] && !assigned[ix] && MatchesAnyAlias(devices[ix].name, aliases)) {
            matches.push_back(ix);
        }
    }
    return matches;
}

std::vector<MidiDeviceInfoRef> UnmatchedEndpoints(
    const std::vector<MidiDeviceInfoRef>& devices,
    const std::vector<bool>& claimed,
    const std::vector<bool>& assigned) {
    std::vector<MidiDeviceInfoRef> unmatched;
    for (std::size_t ix = 0; ix < devices.size(); ++ix) {
        if (!claimed[ix] && !assigned[ix]) {
            unmatched.push_back(devices[ix]);
        }
    }
    return unmatched;
}

}  // namespace

MfTwisterConfigForm::MfTwisterConfigForm() {
    buttons[0].message = UISystemMessage::HoldReset;
    buttons[1].message = UISystemMessage::HoldRandom;
    buttons[2].message = UISystemMessage::HoldRandomMod;
    buttons[3].message = UISystemMessage::NextParamBank;
    buttons[4].message = UISystemMessage::Start;
    buttons[5].message = UISystemMessage::PrevParamBank;
}

std::string_view MfTwisterConfigForm::WizardId() const {
    return kMfTwisterWizardId;
}

ui::NodeTree MfTwisterConfigForm::BuildTree() {
    ui::NodeTree tree;
    ui::Node root;
    root.id = ui::NodeId(std::string(kMfTwisterFormRootId));
    root.kind = ui::NodeKind::Root;
    tree.nodes.push_back(std::move(root));

    const std::string slotId = std::string(kMfTwisterFormRootId) + ".encoder-slot";
    AppendNode(tree, 0, TextFieldNode(slotId, "Encoder Slot", encoderSlotText));
    if (FieldHasError(encoderSlotText)) {
        AppendNode(tree, 0, StatusNode(slotId + ".error",
                                       "Encoder Slot must be a non-negative base-10 integer"));
    }

    for (std::size_t column = 0; column < 2; ++column) {
        ui::Node columnNode;
        columnNode.id = ui::NodeId(std::string(kMfTwisterFormRootId) + ".column." +
                                   std::to_string(column));
        columnNode.kind = ui::NodeKind::Section;
        columnNode.label = column == 0 ? "Left (CC 8-10)" : "Right (CC 11-13)";
        const std::size_t columnIx = AppendNode(tree, 0, std::move(columnNode));

        for (std::size_t row = 0; row < 3; ++row) {
            const std::size_t buttonIx = column * 3 + row;
            const MfTwisterButtonConfig& button = buttons[buttonIx];
            ui::Node buttonNode;
            buttonNode.id = ui::NodeId(std::string(kMfTwisterFormRootId) + ".button." +
                                       std::to_string(buttonIx));
            buttonNode.kind = ui::NodeKind::Row;
            buttonNode.label = "Button " + std::to_string(buttonIx + 1);
            const std::size_t buttonNodeIx = AppendNode(tree, columnIx, std::move(buttonNode));

            const std::string messageId = ButtonFieldId(buttonIx, "message");
            ui::Node messageNode;
            messageNode.id = ui::NodeId(messageId);
            messageNode.kind = ui::NodeKind::ComboBox;
            messageNode.label = "Message";
            messageNode.selectedOption = MessageOptionId(button.message);
            messageNode.action = ui::Action::Named(messageId);
            for (const TwisterMessageChoice& choice : kTwisterMessageChoices) {
                const UISystemMessageChoice* catalogChoice = FindUISystemMessageChoice(choice.message);
                if (catalogChoice != nullptr) {
                    messageNode.options.push_back(
                        {std::string(choice.id), catalogChoice->label});
                }
            }
            AppendNode(tree, buttonNodeIx, std::move(messageNode));

            const std::string argumentId = ButtonFieldId(buttonIx, "argument");
            const bool argumentEnabled = TwisterArgumentEnabled(button.message);
            AppendNode(tree, buttonNodeIx,
                       TextFieldNode(argumentId, "Argument", button.argumentText, argumentEnabled));
            if (argumentEnabled && FieldHasError(button.argumentText)) {
                AppendNode(tree, buttonNodeIx,
                           StatusNode(argumentId + ".error",
                                      "Argument must be a non-negative base-10 integer"));
            }
        }
    }
    return tree;
}

void MfTwisterConfigForm::SetActionHandler(ActionHandler handler) {
    actionHandler_ = std::move(handler);
}

void MfTwisterConfigForm::DispatchAction(const ui::Action& action) {
    if (action.name == std::string(kMfTwisterFormRootId) + ".encoder-slot") {
        encoderSlotText = action.value;
    } else {
        for (std::size_t buttonIx = 0; buttonIx < buttons.size(); ++buttonIx) {
            if (action.name == ButtonFieldId(buttonIx, "message")) {
                if (const auto message = MessageForOptionId(action.value)) {
                    buttons[buttonIx].message = *message;
                }
                break;
            }
            if (action.name == ButtonFieldId(buttonIx, "argument")) {
                buttons[buttonIx].argumentText = action.value;
                break;
            }
        }
    }
    if (actionHandler_) {
        actionHandler_(action);
    }
}

bool MfTwisterConfigForm::Validate(std::string& error) const {
    std::size_t parsed = 0;
    if (!ParseSizeT(encoderSlotText, parsed)) {
        error = "Encoder Slot must be a non-negative base-10 integer";
        return false;
    }
    for (std::size_t buttonIx = 0; buttonIx < buttons.size(); ++buttonIx) {
        const MfTwisterButtonConfig& button = buttons[buttonIx];
        if (!TwisterMessageAllowed(button.message)) {
            error = "Button " + std::to_string(buttonIx + 1) + " has an unsupported Twister message";
            return false;
        }
        if (TwisterArgumentEnabled(button.message) && !ParseSizeT(button.argumentText, parsed)) {
            error = "Button " + std::to_string(buttonIx + 1) +
                    " argument must be a non-negative base-10 integer";
            return false;
        }
    }
    error.clear();
    return true;
}

const std::vector<ControllerWizardDescriptor>& ControllerWizardRegistry() {
    static const std::vector<ControllerWizardDescriptor> registry = {
        ControllerWizardDescriptor{
            .id = std::string(kMfTwisterWizardId),
            .displayName = std::string(kMfTwisterDisplayName),
            .kind = MidiProfileKind::MfTwister,
            .inputAliases = {std::string(kMfTwisterAlias)},
            .outputAliases = {std::string(kMfTwisterAlias)},
            .factory = {}}};
    return registry;
}

WizardDiscovery DiscoverControllerWizards(
    const MidiDeviceList& devices, const MidiInstrumentConfig& instrument,
    const std::vector<ControllerWizardDescriptor>& registry) {
    WizardDiscovery discovery;
    std::vector<bool> claimedInputs = ClaimedInputs(devices, instrument);
    std::vector<bool> claimedOutputs = ClaimedOutputs(devices, instrument);
    std::vector<bool> assignedInputs(devices.inputs.size(), false);
    std::vector<bool> assignedOutputs(devices.outputs.size(), false);

    for (const ControllerWizardDescriptor& descriptor : registry) {
        std::vector<std::size_t> inputMatches = MatchingUnclaimedEndpoints(
            devices.inputs, claimedInputs, assignedInputs, descriptor.inputAliases);
        std::vector<std::size_t> outputMatches = MatchingUnclaimedEndpoints(
            devices.outputs, claimedOutputs, assignedOutputs, descriptor.outputAliases);
        const std::size_t pairCount = std::min(inputMatches.size(), outputMatches.size());

        for (std::size_t pairIx = 0; pairIx < pairCount; ++pairIx) {
            const std::size_t inputIx = inputMatches[pairIx];
            const std::size_t outputIx = outputMatches[pairIx];
            assignedInputs[inputIx] = true;
            assignedOutputs[outputIx] = true;
            discovery.available.push_back({
                .wizardId = descriptor.id,
                .displayName = descriptor.displayName,
                .kind = descriptor.kind,
                .input = devices.inputs[inputIx],
                .output = devices.outputs[outputIx],
            });
        }
    }

    discovery.unmatchedInputs =
        UnmatchedEndpoints(devices.inputs, claimedInputs, assignedInputs);
    discovery.unmatchedOutputs =
        UnmatchedEndpoints(devices.outputs, claimedOutputs, assignedOutputs);
    return discovery;
}

std::unique_ptr<ControllerWizard> MakeControllerWizard(std::string_view id) {
    const std::vector<ControllerWizardDescriptor>& registry = ControllerWizardRegistry();
    for (const ControllerWizardDescriptor& descriptor : registry) {
        if (descriptor.id == id) {
            if (!descriptor.factory) {
                return nullptr;
            }
            return descriptor.factory();
        }
    }
    return nullptr;
}

}  // namespace synth
