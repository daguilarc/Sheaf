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

// Twister form layout. scw-3 requires the six buttons to be presented as two
// columns of three in physical CC order, so the form owns this geometry rather
// than leaving it to each host's default flow. Every child's bounds are local
// to its parent, so hosts can nest the form anywhere.
namespace TwisterFormLayout {

inline constexpr float kMargin = 8.0f;
inline constexpr float kControlHeight = 28.0f;
inline constexpr float kErrorHeight = 20.0f;
inline constexpr float kErrorGap = 2.0f;
inline constexpr float kFieldGap = 8.0f;
inline constexpr float kRowGap = 6.0f;
inline constexpr float kSlotWidth = 160.0f;
inline constexpr float kSlotErrorWidth = 320.0f;
inline constexpr float kButtonLabelWidth = 70.0f;
inline constexpr float kMessageWidth = 150.0f;
inline constexpr float kArgumentWidth = 80.0f;
inline constexpr float kColumnHeaderHeight = 22.0f;
inline constexpr float kColumnGap = 16.0f;
inline constexpr std::size_t kColumnCount = 2;
inline constexpr std::size_t kRowsPerColumn = 3;

// Each button row is: side-button name, message dropdown, argument field. No
// backend paints a container node's own label, so the row and column names are
// rendered nodes rather than Row/Section labels.
inline constexpr float kMessageX = kButtonLabelWidth + kFieldGap;
inline constexpr float kArgumentX = kMessageX + kMessageWidth + kFieldGap;
inline constexpr float kColumnWidth = kArgumentX + kArgumentWidth;
inline constexpr float kButtonRowHeight = kControlHeight + kErrorGap + kErrorHeight;
inline constexpr float kColumnsTop = kMargin + kControlHeight + kErrorGap + kErrorHeight + kRowGap;
inline constexpr float kColumnHeight =
    kColumnHeaderHeight + kRowsPerColumn * kButtonRowHeight + (kRowsPerColumn - 1) * kRowGap;
inline constexpr float kFormWidth =
    kMargin * 2.0f + kColumnCount * kColumnWidth + (kColumnCount - 1) * kColumnGap;
inline constexpr float kFormHeight = kColumnsTop + kColumnHeight + kMargin;

inline constexpr float ColumnX(std::size_t column) {
    return kMargin + static_cast<float>(column) * (kColumnWidth + kColumnGap);
}

inline constexpr float ButtonRowY(std::size_t row) {
    return kColumnHeaderHeight + static_cast<float>(row) * (kButtonRowHeight + kRowGap);
}

}  // namespace TwisterFormLayout

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

std::size_t ParseSizeTOrAssert(std::string_view text) {
    std::size_t result = 0;
    [[maybe_unused]] const bool parsed = ParseSizeT(text, result);
    assert(parsed);
    return result;
}

std::size_t AppendNode(ui::NodeTree& tree, std::size_t parentIx, ui::Node node) {
    tree.nodes[parentIx].children.push_back(node.id);
    tree.nodes.push_back(std::move(node));
    return tree.nodes.size() - 1;
}

ui::Node TextFieldNode(std::string id, std::string label, std::string text, ui::Bounds bounds,
                       bool enabled = true) {
    ui::Node node;
    node.id = ui::NodeId(id);
    node.kind = ui::NodeKind::TextField;
    node.label = std::move(label);
    node.text = std::move(text);
    node.enabled = enabled;
    node.bounds = bounds;
    node.action = ui::Action::Named(std::move(id));
    return node;
}

ui::Node LabelNode(std::string id, std::string text, ui::Bounds bounds) {
    ui::Node node;
    node.id = ui::NodeId(std::move(id));
    node.kind = ui::NodeKind::Label;
    node.text = std::move(text);
    node.bounds = bounds;
    return node;
}

ui::Node StatusNode(std::string id, std::string text, ui::Bounds bounds) {
    ui::Node node;
    node.id = ui::NodeId(std::move(id));
    node.kind = ui::NodeKind::StatusText;
    node.text = std::move(text);
    node.bounds = bounds;
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

bool SameEncoderMapping(const EncoderMidiMapping& lhs, const EncoderMidiMapping& rhs) {
    return lhs.control == rhs.control && lhs.slotIx == rhs.slotIx && lhs.position == rhs.position;
}

bool SameEncoderInput(const EncoderMidiInConfig& lhs, const EncoderMidiInConfig& rhs) {
    if (lhs.mode != rhs.mode || lhs.turnStep != rhs.turnStep ||
        lhs.turns.size() != rhs.turns.size() || lhs.pushes.size() != rhs.pushes.size()) {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.turns.size(); ++ix) {
        if (!SameEncoderMapping(lhs.turns[ix], rhs.turns[ix])) {
            return false;
        }
    }
    for (std::size_t ix = 0; ix < lhs.pushes.size(); ++ix) {
        if (!SameEncoderMapping(lhs.pushes[ix], rhs.pushes[ix])) {
            return false;
        }
    }
    return true;
}

bool SameEncoderOutput(const EncoderMidiOutConfig& lhs, const EncoderMidiOutConfig& rhs) {
    if (lhs.protocol != rhs.protocol ||
        lhs.wrldBldrColorBudgetPerProcess != rhs.wrldBldrColorBudgetPerProcess ||
        lhs.mappings.size() != rhs.mappings.size()) {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.mappings.size(); ++ix) {
        if (lhs.mappings[ix].slotIx != rhs.mappings[ix].slotIx ||
            lhs.mappings[ix].position != rhs.mappings[ix].position ||
            lhs.mappings[ix].cc != rhs.mappings[ix].cc) {
            return false;
        }
    }
    return true;
}

std::size_t TwisterArgument(const MidiControllerSystemMessageAssociation& association,
                            UISystemMessage message) {
    switch (message) {
        case UISystemMessage::ToggleGestureSelect:
        case UISystemMessage::HoldGestureSelect:
            return association.press.gestureIx;
        case UISystemMessage::SelectParamBank:
            return association.press.bankIx;
        case UISystemMessage::SceneSelect:
            return association.press.sceneIx;
        default:
            return 0;
    }
}

bool SameAssociation(const MidiControllerSystemMessageAssociation& lhs,
                     const MidiControllerSystemMessageAssociation& rhs) {
    return lhs.control == rhs.control && lhs.press == rhs.press &&
           lhs.release == rhs.release && lhs.feedback == rhs.feedback &&
           lhs.outputFeedback == rhs.outputFeedback;
}

UISystemMessage TwisterMessageForAssociation(const MidiControllerSystemMessageAssociation& association) {
    const MessageIn& press = association.press;
    switch (press.type) {
        case MessageIn::Type::ToggleReset:
            return press.hasBoolValue ? UISystemMessage::HoldReset : UISystemMessage::ToggleReset;
        case MessageIn::Type::ToggleRandom:
            return press.hasBoolValue ? UISystemMessage::HoldRandom : UISystemMessage::ToggleRandom;
        case MessageIn::Type::ToggleRandomMod:
            return press.hasBoolValue ? UISystemMessage::HoldRandomMod : UISystemMessage::ToggleRandomMod;
        case MessageIn::Type::ToggleGestureSelect: return UISystemMessage::ToggleGestureSelect;
        case MessageIn::Type::SetGestureSelect: return UISystemMessage::HoldGestureSelect;
        case MessageIn::Type::SelectParamBank: return UISystemMessage::SelectParamBank;
        case MessageIn::Type::NextParamBank: return UISystemMessage::NextParamBank;
        case MessageIn::Type::PrevParamBank: return UISystemMessage::PrevParamBank;
        case MessageIn::Type::Start: return UISystemMessage::Start;
        case MessageIn::Type::Continue: return UISystemMessage::Continue;
        case MessageIn::Type::Stop: return UISystemMessage::Stop;
        case MessageIn::Type::Clock: return UISystemMessage::Clock;
        case MessageIn::Type::SceneSelect: return UISystemMessage::SceneSelect;
        case MessageIn::Type::ParamIncDec:
        case MessageIn::Type::ParamSetAbsolute:
        case MessageIn::Type::ParamPush:
        case MessageIn::Type::SetGestureValue:
        case MessageIn::Type::SetSceneBlend:
        case MessageIn::Type::GridPress:
        case MessageIn::Type::GridRelease:
        case MessageIn::Type::GridPressureChange:
        case MessageIn::Type::SelectGrid:
            return UISystemMessage::ParamIncDec;
    }
    return UISystemMessage::ParamIncDec;
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
    namespace Layout = TwisterFormLayout;

    ui::NodeTree tree;
    ui::Node root;
    root.id = ui::NodeId(std::string(kMfTwisterFormRootId));
    root.kind = ui::NodeKind::Root;
    root.bounds = {0.0f, 0.0f, Layout::kFormWidth, Layout::kFormHeight};
    tree.nodes.push_back(std::move(root));

    const std::string slotId = std::string(kMfTwisterFormRootId) + ".encoder-slot";
    AppendNode(tree, 0,
               TextFieldNode(slotId, "Encoder Slot", encoderSlotText,
                             {Layout::kMargin, Layout::kMargin, Layout::kSlotWidth,
                              Layout::kControlHeight}));
    if (FieldHasError(encoderSlotText)) {
        AppendNode(tree, 0,
                   StatusNode(slotId + ".error",
                              "Encoder Slot must be a non-negative base-10 integer",
                              {Layout::kMargin,
                               Layout::kMargin + Layout::kControlHeight + Layout::kErrorGap,
                               Layout::kSlotErrorWidth, Layout::kErrorHeight}));
    }

    for (std::size_t column = 0; column < Layout::kColumnCount; ++column) {
        ui::Node columnNode;
        columnNode.id = ui::NodeId(std::string(kMfTwisterFormRootId) + ".column." +
                                   std::to_string(column));
        columnNode.kind = ui::NodeKind::Section;
        columnNode.bounds = {Layout::ColumnX(column), Layout::kColumnsTop, Layout::kColumnWidth,
                             Layout::kColumnHeight};
        const std::size_t columnIx = AppendNode(tree, 0, std::move(columnNode));

        // The column heading occupies the header band kColumnHeight already
        // reserves above the first button row.
        AppendNode(tree, columnIx,
                   LabelNode(std::string(kMfTwisterFormRootId) + ".column." +
                                 std::to_string(column) + ".heading",
                             column == 0 ? "Left (CC 8-10)" : "Right (CC 11-13)",
                             {0.0f, 0.0f, Layout::kColumnWidth, Layout::kColumnHeaderHeight}));

        for (std::size_t row = 0; row < Layout::kRowsPerColumn; ++row) {
            const std::size_t buttonIx = column * Layout::kRowsPerColumn + row;
            const MfTwisterButtonConfig& button = buttons[buttonIx];
            ui::Node buttonNode;
            buttonNode.id = ui::NodeId(std::string(kMfTwisterFormRootId) + ".button." +
                                       std::to_string(buttonIx));
            buttonNode.kind = ui::NodeKind::Row;
            buttonNode.bounds = {0.0f, Layout::ButtonRowY(row), Layout::kColumnWidth,
                                 Layout::kButtonRowHeight};
            const std::size_t buttonNodeIx = AppendNode(tree, columnIx, std::move(buttonNode));

            // One-based, matching the "Button N" wording Validate() uses when it
            // refuses a field, so the refusal names a row the user can see.
            AppendNode(tree, buttonNodeIx,
                       LabelNode(ButtonFieldId(buttonIx, "label"),
                                 "Button " + std::to_string(buttonIx + 1),
                                 {0.0f, 0.0f, Layout::kButtonLabelWidth, Layout::kControlHeight}));

            const std::string messageId = ButtonFieldId(buttonIx, "message");
            ui::Node messageNode;
            messageNode.id = ui::NodeId(messageId);
            messageNode.kind = ui::NodeKind::ComboBox;
            messageNode.label = "Message";
            messageNode.selectedOption = MessageOptionId(button.message);
            messageNode.bounds = {Layout::kMessageX, 0.0f, Layout::kMessageWidth,
                                  Layout::kControlHeight};
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
                       TextFieldNode(argumentId, "Argument", button.argumentText,
                                     {Layout::kArgumentX, 0.0f, Layout::kArgumentWidth,
                                      Layout::kControlHeight},
                                     argumentEnabled));
            if (argumentEnabled && FieldHasError(button.argumentText)) {
                AppendNode(tree, buttonNodeIx,
                           StatusNode(argumentId + ".error",
                                      "Argument must be a non-negative base-10 integer",
                                      {0.0f, Layout::kControlHeight + Layout::kErrorGap,
                                       Layout::kColumnWidth, Layout::kErrorHeight}));
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

std::string_view MfTwisterConfigForm::ReconfigureWarning() const {
    return reconfigureWarning;
}

std::string_view MfTwisterControllerWizard::Id() const {
    return kMfTwisterWizardId;
}

std::unique_ptr<ControllerConfigForm>
MfTwisterControllerWizard::ConfigForm(const std::optional<MidiControllerSlot>& seed) const {
    if (!seed.has_value()) {
        return std::make_unique<MfTwisterConfigForm>();
    }

    const MidiControllerProfileConfig* profile =
        seed->disposition == MidiControllerDisposition::Active
            ? &seed->config
            : (seed->dormantConfig ? &*seed->dormantConfig : nullptr);
    if (profile != nullptr) {
        if (std::optional<MfTwisterConfigForm> extracted = ExtractMfTwisterWizardSeed(*profile)) {
            return std::make_unique<MfTwisterConfigForm>(std::move(*extracted));
        }
    }

    auto form = std::make_unique<MfTwisterConfigForm>();
    form->reconfigureWarning =
        "This stored profile cannot be represented by the wizard. Submit replaces the whole profile.";
    return form;
}

std::optional<MfTwisterConfigForm>
ExtractMfTwisterWizardSeed(const MidiControllerProfileConfig& profile) {
    if (profile.analogInput.has_value() || profile.pressureInput.has_value() ||
        !profile.encoderInput.has_value() || !profile.encoderOutput.has_value() ||
        profile.encoderInput->turns.empty()) {
        return std::nullopt;
    }

    const std::size_t slotIx = profile.encoderInput->turns.front().slotIx;
    const MidiControllerProfileConfig expected = MfTwisterDefaultProfileConfig(
        MfTwisterDefaultProfileOptions{.slotIx = slotIx});
    if (!SameEncoderInput(*profile.encoderInput, *expected.encoderInput) ||
        !SameEncoderOutput(*profile.encoderOutput, *expected.encoderOutput) ||
        profile.systemMessages.size() != MfTwisterConfigForm::kButtonCount) {
        return std::nullopt;
    }

    MfTwisterConfigForm form;
    form.encoderSlotText = std::to_string(slotIx);
    std::array<bool, MfTwisterConfigForm::kButtonCount> found{};
    for (const MidiControllerSystemMessageAssociation& association : profile.systemMessages) {
        if (!association.control.has_value() || association.control->type != MidiControlType::Cc ||
            association.control->channel != 3 || association.control->cc < 8 ||
            association.control->cc >= 8 + MfTwisterConfigForm::kButtonCount ||
            association.wrldBldrPosition.has_value() || association.launchpadPosition.has_value() ||
            association.outputFeedback) {
            return std::nullopt;
        }
        const std::size_t buttonIx = association.control->cc - 8;
        if (found[buttonIx]) {
            return std::nullopt;
        }

        const UISystemMessage message = TwisterMessageForAssociation(association);
        if (!TwisterMessageAllowed(message)) {
            return std::nullopt;
        }
        const std::size_t argument = TwisterArgument(association, message);
        MidiControllerSystemMessageAssociation expectedAssociation =
            MakeUISystemMessageAssociation(message, argument);
        if (message == UISystemMessage::SelectParamBank ||
            message == UISystemMessage::NextParamBank ||
            message == UISystemMessage::PrevParamBank) {
            expectedAssociation.press.slotIx = slotIx;
            expectedAssociation.feedback.slotIx = slotIx;
            if (expectedAssociation.release.has_value()) {
                expectedAssociation.release->slotIx = slotIx;
            }
        }
        expectedAssociation.control = MidiControlAddress{
            .channel = 3, .cc = static_cast<std::uint8_t>(8 + buttonIx)};
        expectedAssociation.outputFeedback = false;
        if (!SameAssociation(association, expectedAssociation)) {
            return std::nullopt;
        }
        form.buttons[buttonIx] = {.message = message, .argumentText = std::to_string(argument)};
        found[buttonIx] = true;
    }
    if (!std::all_of(found.begin(), found.end(), [](bool value) { return value; })) {
        return std::nullopt;
    }
    return form;
}

WizardGenerationResult MfTwisterControllerWizard::GenerateTypedProfile(
    const MfTwisterConfigForm& form, const WizardGenerationContext& context) const {
    const std::size_t encoderSlot = ParseSizeTOrAssert(form.encoderSlotText);
    MfTwisterDefaultProfileOptions options;
    options.slotIx = encoderSlot;

    for (std::size_t buttonIx = 0; buttonIx < form.buttons.size(); ++buttonIx) {
        const MfTwisterButtonConfig& button = form.buttons[buttonIx];
        const std::size_t argument =
            TwisterArgumentEnabled(button.message) ? ParseSizeTOrAssert(button.argumentText) : 0;
        MidiControllerSystemMessageAssociation association =
            MakeUISystemMessageAssociation(button.message, argument);

        if (button.message == UISystemMessage::SelectParamBank ||
            button.message == UISystemMessage::NextParamBank ||
            button.message == UISystemMessage::PrevParamBank) {
            association.press.slotIx = encoderSlot;
            association.feedback.slotIx = encoderSlot;
            if (association.release.has_value()) {
                association.release->slotIx = encoderSlot;
            }
        }
        options.sideButtons[buttonIx] = std::move(association);
    }

    MidiControllerSlot controller;
    controller.name = context.name;
    controller.kind = MidiProfileKind::MfTwister;
    controller.disposition = MidiControllerDisposition::Active;
    controller.wizardId = std::string(Id());
    controller.config = MfTwisterDefaultProfileConfig(std::move(options));
    controller.input = context.input;
    controller.output = context.output;
    return {.controller = std::move(controller)};
}

const std::vector<ControllerWizardDescriptor>& ControllerWizardRegistry() {
    static const std::vector<ControllerWizardDescriptor> registry = {
        ControllerWizardDescriptor{
            .id = std::string(kMfTwisterWizardId),
            .displayName = std::string(kMfTwisterDisplayName),
            .kind = MidiProfileKind::MfTwister,
            .inputAliases = {std::string(kMfTwisterAlias)},
            .outputAliases = {std::string(kMfTwisterAlias)},
            .factory = [] { return std::make_unique<MfTwisterControllerWizard>(); }}};
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
