#include "synth/MidiConfigViewModel.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <sstream>
#include <tuple>

namespace synth {

namespace {

using Field = MidiMappingRowVM::Field;

// Number of SceneSelect/SelectParamBank/gesture-select catalog entries.
// Sized to cover every default profile factory's default options
// (WrldBldrDefaultProfileOptions/LaunchpadDefaultProfileOptions in
// MidiController.hpp): sceneCount defaults to 8 for both WrldBldr and
// Launchpad; bankButtonCount defaults to 16 for WrldBldr (the wider of the
// two); gestureSelectorCount defaults to 0 for both but the option exists up
// to a small controller-driven count, so 8 slots of headroom are offered.
// SelectParamBank entries all target slotIx 0, matching every default
// profile factory's default WrldBldrDefaultProfileOptions::slotIx /
// LaunchpadDefaultProfileOptions::slotIx (0).
constexpr std::size_t kCatalogSceneCount = 8;
constexpr std::size_t kCatalogBankCount = 16;
constexpr std::size_t kCatalogGestureCount = 8;
constexpr std::size_t kCatalogSelectParamBankSlotIx = 0;

// Compares the fields relevant to system-message dispatch (ignores
// `timestamp`, which carries no meaning until dispatch time -- every
// default-profile factory constructs its MessageIns with timestamp 0, same
// as the catalog's Build() functions).
bool MessageInEquivalent(const MessageIn& a, const MessageIn& b) {
    if (a.type != b.type) {
        return false;
    }
    switch (a.type) {
        case MessageIn::Type::ParamIncDec:
            return a.slotIx == b.slotIx && a.position == b.position && a.delta == b.delta;
        case MessageIn::Type::ParamPush:
            return a.slotIx == b.slotIx && a.position == b.position;
        case MessageIn::Type::ToggleReset:
        case MessageIn::Type::ToggleRandom:
        case MessageIn::Type::ToggleRandomMod:
            // SetReset/SetRandom/SetRandomMod share their toggle type but carry
            // a held bool; plain toggles carry none. Equivalent only when both
            // the held-ness and (when held) the bool match.
            return a.hasBoolValue == b.hasBoolValue && (!a.hasBoolValue || a.boolValue == b.boolValue);
        case MessageIn::Type::Start:
        case MessageIn::Type::Stop:
        case MessageIn::Type::Clock:
            return true;
        case MessageIn::Type::ToggleGestureSelect:
            return a.gestureIx == b.gestureIx;
        case MessageIn::Type::SetGestureSelect:
            return a.gestureIx == b.gestureIx && a.boolValue == b.boolValue;
        case MessageIn::Type::SelectParamBank:
            return a.slotIx == b.slotIx && a.bankIx == b.bankIx;
        case MessageIn::Type::SetGestureValue:
            return a.gestureIx == b.gestureIx && a.value == b.value;
        case MessageIn::Type::SceneSelect:
            return a.sceneIx == b.sceneIx;
        case MessageIn::Type::SetSceneBlend:
            return a.value == b.value;
    }
    return false;
}

}  // namespace

using Field = MidiMappingRowVM::Field;

bool FieldIsInteger(MidiMappingRowVM::Field field) {
    switch (field) {
        case Field::Channel:
        case Field::Cc:
        case Field::SlotIx:
        case Field::Position:
        case Field::GestureIx:
        case Field::LaunchpadX:
        case Field::LaunchpadY:
        case Field::WrldBldrX:
        case Field::WrldBldrY:
        case Field::SceneBlend:
        case Field::Button:
        case Field::BlockStartCc:
        case Field::BlockEndCc:
        case Field::BlockStartPos:
        case Field::BlockStartArg:
        case Field::BlockBankSlotIx:
        case Field::BlockStartX:
        case Field::BlockStartY:
        case Field::BlockEndX:
        case Field::BlockEndY:
        case Field::BlockRowMajor:
        case Field::BlockOutputFeedback:
            return true;
        case Field::TurnStep:
        case Field::RelativeMode:
        case Field::PressMessage:
        case Field::ReleaseMessage:
        case Field::BlockMessageType:
            return false;
    }
    return false;
}

const std::vector<std::string>& RelativeModeCatalog() {
    // Indexed by EncoderRelativeMode's declaration order (MidiController.hpp):
    // 0 = Signed7Bit, 1 = DirectionOnly. ApplyMappingEdit's Field::RelativeMode
    // case and RowFieldValue's Field::RelativeMode case both treat their
    // double as/return an index into this vector, so a JUCE combo box's
    // selection and this catalog can never drift apart -- see this
    // function's header doc comment.
    static const std::vector<std::string> catalog = {"Signed 7-bit", "Direction only"};
    return catalog;
}

const std::vector<std::string>& BlockableMessageCatalog() {
    // Indexed by BlockableMessage's declaration order (MidiConfigBlocks.hpp):
    // 0 = SceneSelect, 1 = BankSelect, 2 = GestureSelect.
    static const std::vector<std::string> catalog = {"Scene select", "Bank select", "Gesture select"};
    return catalog;
}

const char* FieldShortLabel(MidiMappingRowVM::Field field) {
    switch (field) {
        case Field::Channel:
            return "Ch";
        case Field::Cc:
            return "CC";
        case Field::SlotIx:
            return "Slot";
        case Field::Position:
            return "Pos";
        case Field::RelativeMode:
            return "Mode";
        case Field::TurnStep:
            return "Step";
        case Field::PressMessage:
            return "Press";
        case Field::ReleaseMessage:
            return "Release";
        case Field::LaunchpadX:
        case Field::WrldBldrX:
            return "X";
        case Field::LaunchpadY:
        case Field::WrldBldrY:
            return "Y";
        case Field::GestureIx:
            return "Gesture";
        case Field::SceneBlend:
            return "CC";
        case Field::Button:
            return "Btn";
        case Field::BlockStartCc:
            return "Start CC";
        case Field::BlockEndCc:
            return "End CC";
        case Field::BlockStartPos:
            return "Start Pos";
        case Field::BlockStartArg:
            return "Start Arg";
        case Field::BlockBankSlotIx:
            return "Bank Slot";
        case Field::BlockStartX:
            return "Start X";
        case Field::BlockStartY:
            return "Start Y";
        case Field::BlockEndX:
            return "End X";
        case Field::BlockEndY:
            return "End Y";
        case Field::BlockRowMajor:
            return "Row-major";
        case Field::BlockOutputFeedback:
            return "Feedback";
        case Field::BlockMessageType:
            return "Type";
    }
    return "";
}

const std::vector<SystemMessageChoice>& SystemMessageCatalog() {
    static const std::vector<SystemMessageChoice> catalog = [] {
        std::vector<SystemMessageChoice> entries;
        // Index 0: "None" -- only legal for ReleaseMessage, where it clears
        // the association's optional release. Its build() is never actually
        // committed anywhere (ApplyMappingEdit special-cases index 0 for
        // ReleaseMessage before calling build()), but every entry carries one
        // for a uniform table -- Clock is an arbitrary, harmless default.
        entries.push_back({"None", [] { return MessageIn::Clock(0); }});

        entries.push_back({"Reset press", [] { return MessageIn::SetReset(0, true); }});
        entries.push_back({"Reset release", [] { return MessageIn::SetReset(0, false); }});
        entries.push_back({"Random press", [] { return MessageIn::SetRandom(0, true); }});
        entries.push_back({"Random release", [] { return MessageIn::SetRandom(0, false); }});
        entries.push_back({"Random-mod press", [] { return MessageIn::SetRandomMod(0, true); }});
        entries.push_back({"Random-mod release", [] { return MessageIn::SetRandomMod(0, false); }});

        for (std::size_t sceneIx = 0; sceneIx < kCatalogSceneCount; ++sceneIx) {
            std::ostringstream label;
            label << "Scene select " << sceneIx;
            entries.push_back({label.str(), [sceneIx] { return MessageIn::SceneSelect(0, sceneIx); }});
        }

        for (std::size_t bankIx = 0; bankIx < kCatalogBankCount; ++bankIx) {
            std::ostringstream label;
            label << "Select param bank " << bankIx;
            entries.push_back({label.str(), [bankIx] {
                                   return MessageIn::SelectParamBank(0, kCatalogSelectParamBankSlotIx, bankIx);
                               }});
        }

        for (std::size_t gestureIx = 0; gestureIx < kCatalogGestureCount; ++gestureIx) {
            std::ostringstream label;
            label << "Gesture select " << gestureIx << " press";
            entries.push_back(
                {label.str(), [gestureIx] { return MessageIn::SetGestureSelect(0, gestureIx, true); }});
        }
        for (std::size_t gestureIx = 0; gestureIx < kCatalogGestureCount; ++gestureIx) {
            std::ostringstream label;
            label << "Gesture select " << gestureIx << " release";
            entries.push_back(
                {label.str(), [gestureIx] { return MessageIn::SetGestureSelect(0, gestureIx, false); }});
        }

        return entries;
    }();
    return catalog;
}

namespace {

std::string DeviceLabel(const MidiEndpointRef& ref, MidiEndpointStatus status) {
    // Present device name when online; stored ref name (falling back to
    // identifier) + " (offline)" when configured-but-absent; "(none)" when
    // unconfigured. Online labels come from the stored ref's own `name`
    // field: MidiConnectionManager's reconcile pass keeps it fresh via
    // UpdateInputRef/UpdateOutputRef whenever a live device is matched (see
    // MidiReconcile.hpp), so `ref.name` already IS the present device name
    // once status is Online.
    if (status == MidiEndpointStatus::Unconfigured) {
        return "(none)";
    }
    std::string stored = !ref.name.empty() ? ref.name : ref.identifier;
    if (stored.empty()) {
        stored = "(unknown device)";
    }
    if (status == MidiEndpointStatus::Offline) {
        return stored + " (offline)";
    }
    return stored;
}

std::vector<MidiConfigSection> SectionsForKind(MidiProfileKind kind) {
    const MidiKindSupport support = KindSupport(kind);
    std::vector<MidiConfigSection> sections;
    if (support.encoders) {
        sections.push_back(MidiConfigSection::Encoders);
    }
    if (support.systemMessages) {
        sections.push_back(MidiConfigSection::SystemMessages);
    }
    if (support.analogs) {
        sections.push_back(MidiConfigSection::Analogs);
    }
    return sections;
}

std::string DescribeMessage(const MessageIn& message) {
    std::ostringstream oss;
    switch (message.type) {
        case MessageIn::Type::ParamIncDec:
            oss << "param inc/dec slot " << message.slotIx << " pos " << message.position << " delta "
                << message.delta;
            break;
        case MessageIn::Type::ParamPush:
            oss << "param push slot " << message.slotIx << " pos " << message.position;
            break;
        case MessageIn::Type::ToggleReset:
            oss << (message.hasBoolValue ? (message.boolValue ? "reset on" : "reset off") : "toggle reset");
            break;
        case MessageIn::Type::ToggleRandom:
            oss << (message.hasBoolValue ? (message.boolValue ? "random on" : "random off") : "toggle random");
            break;
        case MessageIn::Type::ToggleRandomMod:
            oss << (message.hasBoolValue ? (message.boolValue ? "random-mod on" : "random-mod off")
                                         : "toggle random-mod");
            break;
        case MessageIn::Type::ToggleGestureSelect:
            oss << "toggle gesture " << message.gestureIx;
            break;
        case MessageIn::Type::SetGestureSelect:
            oss << "set gesture " << message.gestureIx << " " << (message.boolValue ? "on" : "off");
            break;
        case MessageIn::Type::SelectParamBank:
            oss << "select bank " << message.bankIx << " (slot " << message.slotIx << ")";
            break;
        case MessageIn::Type::Start:
            oss << "start";
            break;
        case MessageIn::Type::Stop:
            oss << "stop";
            break;
        case MessageIn::Type::Clock:
            oss << "clock";
            break;
        case MessageIn::Type::SetGestureValue:
            oss << "set gesture " << message.gestureIx << " value " << message.value;
            break;
        case MessageIn::Type::SceneSelect:
            oss << "scene select " << message.sceneIx;
            break;
        case MessageIn::Type::SetSceneBlend:
            oss << "scene blend " << message.value;
            break;
    }
    return oss.str();
}

std::string EncoderTurnLabel(const EncoderMidiMapping& mapping) {
    std::ostringstream oss;
    oss << "turn ch" << static_cast<int>(mapping.control.channel) << " cc" << static_cast<int>(mapping.control.cc)
        << " -> slot " << mapping.slotIx << " pos " << mapping.position;
    return oss.str();
}

std::string EncoderPushLabel(const EncoderMidiMapping& mapping) {
    std::ostringstream oss;
    oss << "push ch" << static_cast<int>(mapping.control.channel) << " cc" << static_cast<int>(mapping.control.cc)
        << " -> slot " << mapping.slotIx << " pos " << mapping.position;
    return oss.str();
}

std::string RelativeModeLabel(EncoderRelativeMode mode) {
    return mode == EncoderRelativeMode::Signed7Bit ? "relative mode: signed 7-bit" : "relative mode: direction only";
}

std::string TurnStepLabel(float step) {
    std::ostringstream oss;
    oss << "turn step: " << step;
    return oss.str();
}

std::string GestureLabel(const AnalogMidiMapping& mapping) {
    std::ostringstream oss;
    oss << "gesture ch" << static_cast<int>(mapping.control.channel) << " cc" << static_cast<int>(mapping.control.cc)
        << " -> gesture " << mapping.gestureIx;
    return oss.str();
}

std::string SceneBlendLabel(const std::optional<MidiControlAddress>& address) {
    // Issue #11: this row must read as clearly and distinctly "Scene blend"
    // -- not just another gesture -- since the renderer visually separates
    // it (RowGroup::AnalogSceneBlend, a divider + caption) from the
    // AnalogGesture rows above it.
    if (!address.has_value()) {
        return "Scene blend (unassigned)";
    }
    std::ostringstream oss;
    oss << "Scene blend  ch" << static_cast<int>(address->channel) << " cc" << static_cast<int>(address->cc);
    return oss.str();
}

std::string SystemMessageAddressLabel(const MidiControllerSystemMessageAssociation& association,
                                      MidiProfileKind kind) {
    std::ostringstream oss;
    if (kind == MidiProfileKind::Launchpad && association.launchpadPosition.has_value()) {
        oss << "pad (" << association.launchpadPosition->x << "," << association.launchpadPosition->y << ")";
    } else if (kind == MidiProfileKind::WrldBldr && association.wrldBldrPosition.has_value()) {
        // control->channel is authoritative for the channel (see the Channel /
        // X/Y edit cases in ApplyMappingEdit); fall back to the position's own
        // channel only when there is no control address.
        const int channel = association.control.has_value() ? static_cast<int>(association.control->channel)
                                                            : static_cast<int>(association.wrldBldrPosition->channel);
        oss << "pos ch" << channel << " (" << static_cast<int>(association.wrldBldrPosition->x) << ","
            << static_cast<int>(association.wrldBldrPosition->y) << ")";
    } else if (kind == MidiProfileKind::MfTwister && association.control.has_value()) {
        // sru-8/D1: twister's sole address is the logical side button (cc -
        // 8); the fixed channel 3 is shown read-only alongside it.
        const int button = static_cast<int>(association.control->cc) - 8;
        oss << "ch" << static_cast<int>(association.control->channel) << " btn" << button;
    } else if (association.control.has_value()) {
        oss << "ch" << static_cast<int>(association.control->channel) << " cc"
            << static_cast<int>(association.control->cc);
    } else {
        oss << "(no address)";
    }
    return oss.str();
}

std::string SystemMessageLabel(const MidiControllerSystemMessageAssociation& association, MidiProfileKind kind) {
    std::ostringstream oss;
    oss << SystemMessageAddressLabel(association, kind) << " -> press: " << DescribeMessage(association.press);
    if (association.release.has_value()) {
        oss << ", release: " << DescribeMessage(*association.release);
    }
    return oss.str();
}

// --- Presentation identity (task group 2 / design.md D5) -------------------

using EncoderIdentity = detail::EncoderIdentity;
using AnalogIdentity = detail::AnalogIdentity;
using SystemIdentity = detail::SystemIdentity;
using RowIdentity = detail::RowIdentity;
using PresentationRow = detail::PresentationRow;
using SectionPresentation = detail::SectionPresentation;
using RowKind = MidiMappingRowVM::Kind;
using RowGroup = MidiMappingRowVM::RowGroup;

EncoderIdentity IdentityOf(const EncoderMidiMapping& mapping, bool isPush) {
    return EncoderIdentity{.isPush = isPush, .slotIx = mapping.slotIx, .position = mapping.position};
}

AnalogIdentity IdentityOf(const AnalogMidiMapping& mapping) {
    return AnalogIdentity{.isSceneBlend = false, .gestureIx = mapping.gestureIx};
}

// Computes the SystemIdentity for `sorted[ix]` -- `sorted` MUST already be in
// SystemMessageSortKey order (NormalizeMidiProfileConfig or equivalent),
// matching ReconstructSystemBlocks' own defensive-sort contract. The
// occurrence ordinal counts how many EARLIER elements in `sorted` share this
// exact key (sru-11: "an occurrence ordinal so associations sharing both
// message and address still resolve to distinct rows").
SystemIdentity SystemIdentityAt(const std::vector<MidiControllerSystemMessageAssociation>& sorted, std::size_t ix,
                                MidiProfileKind kind) {
    const SystemMessageSortKey key = ComputeSystemMessageSortKey(sorted[ix], kind);
    std::size_t ordinal = 0;
    for (std::size_t j = 0; j < ix; ++j) {
        if (ComputeSystemMessageSortKey(sorted[j], kind) == key) {
            ++ordinal;
        }
    }
    return SystemIdentity{.key = key, .occurrenceOrdinal = ordinal};
}

// Resolves a SystemIdentity back to an index in `sorted` (same sorted view
// SystemIdentityAt was computed against), or npos if it no longer resolves
// (sru-11: "dropping rows whose identity no longer resolves").
constexpr std::size_t kNotFound = static_cast<std::size_t>(-1);

std::size_t ResolveSystemIdentity(const std::vector<MidiControllerSystemMessageAssociation>& sorted,
                                  MidiProfileKind kind, const SystemIdentity& identity) {
    std::size_t ordinal = 0;
    for (std::size_t ix = 0; ix < sorted.size(); ++ix) {
        if (ComputeSystemMessageSortKey(sorted[ix], kind) == identity.key) {
            if (ordinal == identity.occurrenceOrdinal) {
                return ix;
            }
            ++ordinal;
        }
    }
    return kNotFound;
}

std::size_t ResolveEncoderIdentity(const std::vector<EncoderMidiMapping>& mappings, const EncoderIdentity& identity) {
    for (std::size_t ix = 0; ix < mappings.size(); ++ix) {
        if (mappings[ix].slotIx == identity.slotIx && mappings[ix].position == identity.position) {
            return ix;
        }
    }
    return kNotFound;
}

std::size_t ResolveAnalogIdentity(const std::vector<AnalogMidiMapping>& mappings, const AnalogIdentity& identity) {
    for (std::size_t ix = 0; ix < mappings.size(); ++ix) {
        if (mappings[ix].gestureIx == identity.gestureIx) {
            return ix;
        }
    }
    return kNotFound;
}

} // namespace

void MidiConfigViewModel::Rebuild(const MidiInstrumentConfig& instrument, const MidiConnectionState& connection) {
    instrument_ = instrument;
    connection_ = connection;

    controllers_.clear();
    controllers_.reserve(instrument_.controllers.size());

    for (std::size_t ix = 0; ix < instrument_.controllers.size(); ++ix) {
        const MidiControllerSlot& slot = instrument_.controllers[ix];
        MidiEndpointConnection inputConnection;
        MidiEndpointConnection outputConnection;
        if (ix < connection_.controllers.size()) {
            inputConnection = connection_.controllers[ix].input;
            outputConnection = connection_.controllers[ix].output;
        }

        MidiControllerRowVM row;
        row.name = slot.name;
        row.kind = slot.kind;
        row.inputStatus = inputConnection.status;
        row.outputStatus = outputConnection.status;
        row.inputDeviceLabel = DeviceLabel(slot.input, inputConnection.status);
        row.outputDeviceLabel = DeviceLabel(slot.output, outputConnection.status);
        row.sections = SectionsForKind(slot.kind);

        // Ensure expand state exists for this controller (first appearance
        // starts fully collapsed); already-known names keep whatever the UI
        // last set, surviving this Rebuild().
        ExpandState& state = StateFor(slot.name);
        for (MidiConfigSection section : row.sections) {
            state.sections.try_emplace(section, false);
        }
        row.configExpanded = state.configExpanded;

        controllers_.push_back(std::move(row));
    }

    // Re-resolve every EXISTING presentation entry (D5: "view-model rebuilds
    // re-resolve rows by identity ... without re-grouping") -- entries for
    // controllers no longer present are left as harmless orphans (keyed by
    // name; DiscardPresentation/ToggleSection clean them up on collapse, and
    // a name that never reappears simply never gets read again).
    for (auto& [presentationKey, presentation] : presentations_) {
        const auto& [name, section] = presentationKey;
        const MidiControllerSlot* slot = instrument_.FindController(name);
        if (slot == nullptr) {
            presentation.rows.clear();  // controller removed: nothing left to resolve
            continue;
        }
        RebuildPresentationFor(presentation, slot->config, slot->kind, section);
    }
}

MidiConfigViewModel::ExpandState& MidiConfigViewModel::StateFor(const std::string& name) {
    return expandState_[name];
}

const MidiConfigViewModel::ExpandState* MidiConfigViewModel::StateForConst(const std::string& name) const {
    auto it = expandState_.find(name);
    return it != expandState_.end() ? &it->second : nullptr;
}

void MidiConfigViewModel::ToggleConfig(std::size_t controllerIx) {
    if (controllerIx >= controllers_.size()) {
        return;
    }
    ExpandState& state = StateFor(controllers_[controllerIx].name);
    state.configExpanded = !state.configExpanded;
    controllers_[controllerIx].configExpanded = state.configExpanded;
}

void MidiConfigViewModel::ToggleSection(std::size_t controllerIx, MidiConfigSection section) {
    if (controllerIx >= controllers_.size()) {
        return;
    }
    const std::string& name = controllers_[controllerIx].name;
    ExpandState& state = StateFor(name);
    bool& expanded = state.sections[section];
    expanded = !expanded;
    if (!expanded) {
        // D5: "discarded on expanded->collapsed" -- the next expand rebuilds
        // a fresh minimal reconstruction (sru-11's "collapsing and
        // re-expanding present the fresh minimal reconstruction").
        DiscardPresentation(name, section);
    }
}

bool MidiConfigViewModel::SectionExpanded(std::size_t controllerIx, MidiConfigSection section) const {
    if (controllerIx >= controllers_.size()) {
        return false;
    }
    const ExpandState* state = StateForConst(controllers_[controllerIx].name);
    if (state == nullptr) {
        return false;
    }
    auto it = state->sections.find(section);
    return it != state->sections.end() && it->second;
}

namespace {

// editableFields for an Individual SystemMessages row, per kind (D1/sru-8) --
// factored out of the old SectionRows() SystemMessages case so
// BuildFreshPresentation/BuildSectionRows share the exact same table.
std::vector<Field> SystemRowEditableFields(MidiProfileKind kind) {
    switch (kind) {
        case MidiProfileKind::Launchpad:
            return {Field::LaunchpadX, Field::LaunchpadY, Field::PressMessage, Field::ReleaseMessage};
        case MidiProfileKind::WrldBldr:
            // Issue #10: chan/x/y, so the slot's MIDI channel is editable
            // alongside its grid position. Channel writes only
            // association.control->channel (ApplyMappingEdit); WrldBldrX/Y
            // keep wrldBldrPosition and control->cc in sync via
            // WrldBldrPositionToCC, untouched by a Channel edit.
            return {Field::Channel, Field::WrldBldrX, Field::WrldBldrY, Field::PressMessage, Field::ReleaseMessage};
        case MidiProfileKind::MfTwister:
            // sru-8/D1: twister system rows advertise exactly one address
            // field -- the logical side button 0..5 (stored as
            // control->cc = 8 + button on the fixed channel 3,
            // display-only). No Channel or Cc field is shown.
            return {Field::Button, Field::PressMessage, Field::ReleaseMessage};
        case MidiProfileKind::Generic:
            return {Field::Channel, Field::Cc, Field::PressMessage, Field::ReleaseMessage};
    }
    return {};
}

// editableFields for a Block row, per its form (D1/D3/D6 -- see
// MidiMappingRowVM::Field's Block* doc comment).
std::vector<Field> EncoderBlockEditableFields() {
    return {Field::Channel, Field::BlockStartCc, Field::BlockEndCc, Field::SlotIx, Field::BlockStartPos};
}
std::vector<Field> AnalogBlockEditableFields() {
    return {Field::Channel, Field::BlockStartCc, Field::BlockEndCc, Field::BlockStartArg};
}
std::vector<Field> SystemBlockEditableFields(const SystemBlock& block) {
    std::vector<Field> fields = {Field::BlockMessageType};
    if (block.kind == MidiProfileKind::WrldBldr) {
        fields.push_back(Field::Channel);
    }
    if (block.kind == MidiProfileKind::WrldBldr || block.kind == MidiProfileKind::Launchpad) {
        fields.insert(fields.end(), {Field::BlockStartX, Field::BlockStartY, Field::BlockEndX, Field::BlockEndY,
                                     Field::BlockRowMajor});
    } else {
        fields.insert(fields.end(), {Field::Channel, Field::BlockStartCc, Field::BlockEndCc});
    }
    fields.push_back(Field::BlockStartArg);
    if (block.message == BlockableMessage::BankSelect) {
        fields.push_back(Field::BlockBankSlotIx);
    }
    fields.push_back(Field::BlockOutputFeedback);
    return fields;
}

std::string EncoderBlockLabel(const EncoderBlock& block) {
    std::ostringstream oss;
    oss << (block.isPush ? "push block ch" : "turn block ch") << static_cast<int>(block.channel) << " cc"
        << static_cast<int>(block.startCc) << ".." << static_cast<int>(block.endCc) << " -> slot " << block.slotIx
        << " pos " << block.startPosition << "..";
    return oss.str();
}

std::string AnalogBlockLabel(const AnalogBlock& block) {
    std::ostringstream oss;
    oss << "gesture block ch" << static_cast<int>(block.channel) << " cc" << static_cast<int>(block.startCc) << ".."
        << static_cast<int>(block.endCc) << " -> gesture " << block.startGestureIx << "..";
    return oss.str();
}

const char* BlockableMessageName(BlockableMessage message) {
    switch (message) {
        case BlockableMessage::SceneSelect:
            return "scene select";
        case BlockableMessage::BankSelect:
            return "bank select";
        case BlockableMessage::GestureSelect:
            return "gesture select";
    }
    return "";
}

std::string SystemBlockLabel(const SystemBlock& block) {
    std::ostringstream oss;
    oss << BlockableMessageName(block.message) << " block ";
    if (block.kind == MidiProfileKind::WrldBldr || block.kind == MidiProfileKind::Launchpad) {
        oss << "(" << block.startX << "," << block.startY << ")..(" << block.endX << "," << block.endY << ")";
    } else {
        oss << "ch" << static_cast<int>(block.channel) << " cc" << static_cast<int>(block.startCc) << ".."
            << static_cast<int>(block.endCc);
    }
    oss << " -> arg " << block.startArg << "..";
    return oss.str();
}

}  // namespace

namespace {

// Builds a FRESH presentation for one section from scratch: the config-level
// rows (Encoders' RelativeMode/TurnStep, Analogs' SceneBlend) as individual
// ConfigLevel PresentationRows, and the blockable groups (encoder turns/
// pushes, analog gestures, system messages) reconstructed via
// MidiConfigBlocks.hpp's Reconstruct* (D5: "built ... at the collapsed ->
// expanded transition"). This is also what a collapse+re-expand cycle
// produces (DiscardPresentation followed by the next PresentationFor()
// call), matching sru-11's "re-expanding presents the fresh minimal
// reconstruction."
SectionPresentation BuildFreshPresentation(const MidiControllerProfileConfig& config, MidiProfileKind kind,
                                           MidiConfigSection section) {
    SectionPresentation presentation;

    switch (section) {
        case MidiConfigSection::Encoders: {
            if (!config.encoderInput.has_value()) {
                return presentation;
            }
            const auto& encoderInput = *config.encoderInput;
            for (bool isPush : {false, true}) {
                const std::vector<EncoderMidiMapping>& mappings = isPush ? encoderInput.pushes : encoderInput.turns;
                const RowGroup group = isPush ? RowGroup::EncoderPush : RowGroup::EncoderTurn;
                for (const ReconstructedEncoderRow& reconstructed : ReconstructEncoderBlocks(mappings, isPush)) {
                    PresentationRow row;
                    row.group = group;
                    if (reconstructed.isBlock) {
                        row.kind = RowKind::Block;
                        row.block = reconstructed.block;
                        for (std::size_t ix : reconstructed.indices) {
                            row.identities.push_back(IdentityOf(mappings[ix], isPush));
                        }
                    } else {
                        row.kind = RowKind::Individual;
                        row.identities.push_back(IdentityOf(mappings[reconstructed.indices.front()], isPush));
                    }
                    presentation.rows.push_back(std::move(row));
                }
            }
            {
                PresentationRow row;
                row.kind = RowKind::ConfigLevel;
                row.group = RowGroup::EncoderMode;
                row.identities.push_back(EncoderIdentity{});  // unused placeholder identity; resolved specially
                presentation.rows.push_back(std::move(row));
            }
            {
                PresentationRow row;
                row.kind = RowKind::ConfigLevel;
                row.group = RowGroup::EncoderStep;
                row.identities.push_back(EncoderIdentity{});
                presentation.rows.push_back(std::move(row));
            }
            break;
        }
        case MidiConfigSection::Analogs: {
            if (!config.analogInput.has_value()) {
                return presentation;
            }
            const auto& analogInput = *config.analogInput;
            for (const ReconstructedAnalogRow& reconstructed : ReconstructAnalogBlocks(analogInput.gestures)) {
                PresentationRow row;
                row.group = RowGroup::AnalogGesture;
                if (reconstructed.isBlock) {
                    row.kind = RowKind::Block;
                    row.block = reconstructed.block;
                    for (std::size_t ix : reconstructed.indices) {
                        row.identities.push_back(IdentityOf(analogInput.gestures[ix]));
                    }
                } else {
                    row.kind = RowKind::Individual;
                    row.identities.push_back(IdentityOf(analogInput.gestures[reconstructed.indices.front()]));
                }
                presentation.rows.push_back(std::move(row));
            }
            {
                PresentationRow row;
                row.kind = RowKind::ConfigLevel;
                row.group = RowGroup::AnalogSceneBlend;
                row.identities.push_back(AnalogIdentity{.isSceneBlend = true});
                presentation.rows.push_back(std::move(row));
            }
            break;
        }
        case MidiConfigSection::SystemMessages: {
            MidiControllerProfileConfig scratch;
            scratch.systemMessages = config.systemMessages;
            NormalizeMidiProfileConfig(scratch, kind);
            const std::vector<MidiControllerSystemMessageAssociation>& sorted = scratch.systemMessages;
            for (const ReconstructedSystemRow& reconstructed : ReconstructSystemBlocks(config.systemMessages, kind)) {
                PresentationRow row;
                row.group = RowGroup::System;
                if (reconstructed.isBlock) {
                    row.kind = RowKind::Block;
                    row.block = reconstructed.block;
                    for (std::size_t ix : reconstructed.indices) {
                        row.identities.push_back(SystemIdentityAt(sorted, ix, kind));
                    }
                } else {
                    row.kind = RowKind::Individual;
                    row.identities.push_back(SystemIdentityAt(sorted, reconstructed.indices.front(), kind));
                }
                presentation.rows.push_back(std::move(row));
            }
            break;
        }
    }
    return presentation;
}

}  // namespace

detail::SectionPresentation& MidiConfigViewModel::PresentationFor(std::size_t controllerIx,
                                                                   MidiConfigSection section) const {
    const std::string& name = instrument_.controllers[controllerIx].name;
    const PresentationKey key{name, section};
    auto it = presentations_.find(key);
    if (it != presentations_.end()) {
        return it->second;
    }
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    auto [inserted, ok] = presentations_.emplace(key, BuildFreshPresentation(slot.config, slot.kind, section));
    (void)ok;
    return inserted->second;
}

void MidiConfigViewModel::DiscardPresentation(const std::string& name, MidiConfigSection section) {
    presentations_.erase(PresentationKey{name, section});
}

namespace {

// Re-resolves one PresentationRow's identities against the live (sorted, for
// system messages) config. Returns false if the row should be dropped (any
// covered identity failed to resolve -- D5/sru-11: a block is one
// resolve/drop unit).
bool ReResolveRow(PresentationRow& row, const MidiControllerProfileConfig& config,
                  const std::vector<MidiControllerSystemMessageAssociation>& sortedSystem, MidiProfileKind kind) {
    for (const RowIdentity& identity : row.identities) {
        bool resolved = false;
        if (const auto* encoderIdentity = std::get_if<EncoderIdentity>(&identity)) {
            if (row.kind == RowKind::ConfigLevel) {
                resolved = config.encoderInput.has_value();  // RelativeMode/TurnStep rows: exist iff encoderInput does
            } else if (config.encoderInput.has_value()) {
                const std::vector<EncoderMidiMapping>& mappings =
                    encoderIdentity->isPush ? config.encoderInput->pushes : config.encoderInput->turns;
                resolved = ResolveEncoderIdentity(mappings, *encoderIdentity) != kNotFound;
            }
            // else: encoderInput vanished entirely (e.g. a patch load
            // switched this controller to a kind/config with no encoders)
            // -- resolved stays false, dropping the row (D5/sru-11).
        } else if (const auto* analogIdentity = std::get_if<AnalogIdentity>(&identity)) {
            if (analogIdentity->isSceneBlend) {
                resolved = config.analogInput.has_value();  // scene-blend row always resolves while analogInput exists
            } else if (config.analogInput.has_value()) {
                resolved = ResolveAnalogIdentity(config.analogInput->gestures, *analogIdentity) != kNotFound;
            }
        } else if (const auto* systemIdentity = std::get_if<SystemIdentity>(&identity)) {
            resolved = ResolveSystemIdentity(sortedSystem, kind, *systemIdentity) != kNotFound;
        }
        if (!resolved) {
            return false;
        }
    }
    return true;
}

// Where a new row of `group` should land: immediately after the last
// EXISTING row of that group, if any; otherwise immediately before the
// first row of the nearest LATER group in RowGroup's declaration order
// (EncoderTurn < EncoderPush < EncoderMode < EncoderStep < AnalogGesture <
// AnalogSceneBlend < System, which is exactly section display order); if
// neither exists (no rows of this group AND no later-group rows either),
// the very end of the presentation. Shared by AppendUnresolved*Identities
// (sru-11 "appending unknown identities ... at their group's end") and
// AddSingle/AddBlock (sru-11 "+"/"+B" append presentation rows at the end
// of their group) so both paths agree on where "end of group" means -- a
// group with zero existing rows still has a well-defined "end" (immediately
// before mode/step/scene-blend), not the tail of the whole section.
std::size_t InsertionIndexForGroup(const SectionPresentation& presentation, RowGroup group) {
    std::size_t lastOfGroup = presentation.rows.size();
    std::size_t firstOfLaterGroup = presentation.rows.size();
    for (std::size_t ix = 0; ix < presentation.rows.size(); ++ix) {
        if (presentation.rows[ix].group == group) {
            lastOfGroup = ix + 1;
        } else if (presentation.rows[ix].group > group && firstOfLaterGroup == presentation.rows.size()) {
            firstOfLaterGroup = ix;
        }
    }
    if (lastOfGroup != presentation.rows.size()) {
        return lastOfGroup;
    }
    return firstOfLaterGroup;
}

// Appends Individual rows, at the end of their group, for every raw config
// identity NOT already covered by some row in `presentation` (sru-11:
// "appending unknown identities as individual rows") -- see
// InsertionIndexForGroup for exactly where "end of group" lands.
void AppendUnresolvedEncoderIdentities(SectionPresentation& presentation, const std::vector<EncoderMidiMapping>& mappings,
                                       bool isPush) {
    const RowGroup group = isPush ? RowGroup::EncoderPush : RowGroup::EncoderTurn;
    for (const EncoderMidiMapping& mapping : mappings) {
        const EncoderIdentity identity = IdentityOf(mapping, isPush);
        bool covered = false;
        for (const PresentationRow& row : presentation.rows) {
            if (row.group != group) {
                continue;
            }
            for (const RowIdentity& existing : row.identities) {
                if (const auto* enc = std::get_if<EncoderIdentity>(&existing); enc != nullptr && *enc == identity) {
                    covered = true;
                    break;
                }
            }
            if (covered) {
                break;
            }
        }
        if (covered) {
            continue;
        }
        const std::size_t insertAt = InsertionIndexForGroup(presentation, group);
        PresentationRow row;
        row.kind = RowKind::Individual;
        row.group = group;
        row.identities.push_back(identity);
        presentation.rows.insert(presentation.rows.begin() + static_cast<std::ptrdiff_t>(insertAt), std::move(row));
    }
}

void AppendUnresolvedAnalogIdentities(SectionPresentation& presentation, const std::vector<AnalogMidiMapping>& mappings) {
    constexpr RowGroup group = RowGroup::AnalogGesture;
    for (const AnalogMidiMapping& mapping : mappings) {
        const AnalogIdentity identity = IdentityOf(mapping);
        bool covered = false;
        for (const PresentationRow& row : presentation.rows) {
            if (row.group != group) {
                continue;
            }
            for (const RowIdentity& existing : row.identities) {
                if (const auto* an = std::get_if<AnalogIdentity>(&existing); an != nullptr && *an == identity) {
                    covered = true;
                    break;
                }
            }
            if (covered) {
                break;
            }
        }
        if (covered) {
            continue;
        }
        const std::size_t insertAt = InsertionIndexForGroup(presentation, group);
        PresentationRow row;
        row.kind = RowKind::Individual;
        row.group = group;
        row.identities.push_back(identity);
        presentation.rows.insert(presentation.rows.begin() + static_cast<std::ptrdiff_t>(insertAt), std::move(row));
    }
}

void AppendUnresolvedSystemIdentities(SectionPresentation& presentation,
                                      const std::vector<MidiControllerSystemMessageAssociation>& sorted,
                                      MidiProfileKind kind) {
    constexpr RowGroup group = RowGroup::System;
    for (std::size_t ix = 0; ix < sorted.size(); ++ix) {
        const SystemIdentity identity = SystemIdentityAt(sorted, ix, kind);
        bool covered = false;
        for (const PresentationRow& row : presentation.rows) {
            for (const RowIdentity& existing : row.identities) {
                if (const auto* sys = std::get_if<SystemIdentity>(&existing); sys != nullptr && *sys == identity) {
                    covered = true;
                    break;
                }
            }
            if (covered) {
                break;
            }
        }
        if (covered) {
            continue;
        }
        const std::size_t insertAt = InsertionIndexForGroup(presentation, group);
        PresentationRow row;
        row.kind = RowKind::Individual;
        row.group = group;
        row.identities.push_back(identity);
        presentation.rows.insert(presentation.rows.begin() + static_cast<std::ptrdiff_t>(insertAt), std::move(row));
    }
}

}  // namespace

void MidiConfigViewModel::RebuildPresentationFor(SectionPresentation& presentation,
                                                 const MidiControllerProfileConfig& config, MidiProfileKind kind,
                                                 MidiConfigSection section) const {
    MidiControllerProfileConfig scratch;
    scratch.systemMessages = config.systemMessages;
    NormalizeMidiProfileConfig(scratch, kind);
    const std::vector<MidiControllerSystemMessageAssociation>& sortedSystem = scratch.systemMessages;

    // Drop rows whose identity no longer resolves (D5/sru-11).
    std::erase_if(presentation.rows,
                  [&](PresentationRow& row) { return !ReResolveRow(row, config, sortedSystem, kind); });

    // Append unknown identities as individual rows at their group's end
    // (D5/sru-11) -- config-level rows never need this (they either exist or
    // the whole presentation was dropped above when encoderInput/analogInput
    // vanished, which ReResolveRow already handles for the ConfigLevel rows
    // themselves).
    switch (section) {
        case MidiConfigSection::Encoders:
            if (config.encoderInput.has_value()) {
                AppendUnresolvedEncoderIdentities(presentation, config.encoderInput->turns, false);
                AppendUnresolvedEncoderIdentities(presentation, config.encoderInput->pushes, true);
            }
            break;
        case MidiConfigSection::Analogs:
            if (config.analogInput.has_value()) {
                AppendUnresolvedAnalogIdentities(presentation, config.analogInput->gestures);
            }
            break;
        case MidiConfigSection::SystemMessages:
            AppendUnresolvedSystemIdentities(presentation, sortedSystem, kind);
            break;
    }
}

std::vector<MidiMappingRowVM> MidiConfigViewModel::BuildSectionRows(std::size_t controllerIx,
                                                                     MidiConfigSection section) const {
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    const SectionPresentation& presentation = PresentationFor(controllerIx, section);

    MidiControllerProfileConfig sortedScratch;
    sortedScratch.systemMessages = slot.config.systemMessages;
    if (section == MidiConfigSection::SystemMessages) {
        NormalizeMidiProfileConfig(sortedScratch, slot.kind);
    }
    const std::vector<MidiControllerSystemMessageAssociation>& sortedSystem = sortedScratch.systemMessages;

    std::vector<MidiMappingRowVM> rows;
    rows.reserve(presentation.rows.size());
    for (const PresentationRow& presentationRow : presentation.rows) {
        MidiMappingRowVM row;
        row.kind = presentationRow.kind;
        row.group = presentationRow.group;
        row.deletable = presentationRow.kind != RowKind::ConfigLevel;

        if (presentationRow.kind == RowKind::ConfigLevel) {
            if (presentationRow.group == RowGroup::EncoderMode) {
                row.editableFields = {Field::RelativeMode};
                row.label = RelativeModeLabel(slot.config.encoderInput->relativeMode);
            } else if (presentationRow.group == RowGroup::EncoderStep) {
                row.editableFields = {Field::TurnStep};
                row.label = TurnStepLabel(slot.config.encoderInput->turnStep);
            } else if (presentationRow.group == RowGroup::AnalogSceneBlend) {
                row.editableFields = {Field::SceneBlend};
                row.label = SceneBlendLabel(slot.config.analogInput->sceneBlend);
            }
        } else if (presentationRow.kind == RowKind::Block) {
            if (const auto* encoderBlock = std::get_if<EncoderBlock>(&presentationRow.block)) {
                row.editableFields = EncoderBlockEditableFields();
                row.label = EncoderBlockLabel(*encoderBlock);
            } else if (const auto* analogBlock = std::get_if<AnalogBlock>(&presentationRow.block)) {
                row.editableFields = AnalogBlockEditableFields();
                row.label = AnalogBlockLabel(*analogBlock);
            } else if (const auto* systemBlock = std::get_if<SystemBlock>(&presentationRow.block)) {
                row.editableFields = SystemBlockEditableFields(*systemBlock);
                row.label = SystemBlockLabel(*systemBlock);
            }
        } else {
            // Individual row: resolve its single identity to the underlying
            // config element for the label/editableFields.
            const RowIdentity& identity = presentationRow.identities.front();
            if (const auto* encoderIdentity = std::get_if<EncoderIdentity>(&identity)) {
                const std::vector<EncoderMidiMapping>& mappings =
                    encoderIdentity->isPush ? slot.config.encoderInput->pushes : slot.config.encoderInput->turns;
                const std::size_t rawIx = ResolveEncoderIdentity(mappings, *encoderIdentity);
                const EncoderMidiMapping& mapping = mappings[rawIx];
                row.editableFields = {Field::Channel, Field::Cc, Field::SlotIx, Field::Position};
                row.label = encoderIdentity->isPush ? EncoderPushLabel(mapping) : EncoderTurnLabel(mapping);
            } else if (const auto* analogIdentity = std::get_if<AnalogIdentity>(&identity)) {
                const std::size_t rawIx = ResolveAnalogIdentity(slot.config.analogInput->gestures, *analogIdentity);
                row.editableFields = {Field::Channel, Field::Cc, Field::GestureIx};
                row.label = GestureLabel(slot.config.analogInput->gestures[rawIx]);
            } else if (const auto* systemIdentity = std::get_if<SystemIdentity>(&identity)) {
                const std::size_t rawIx = ResolveSystemIdentity(sortedSystem, slot.kind, *systemIdentity);
                const MidiControllerSystemMessageAssociation& association = sortedSystem[rawIx];
                row.editableFields = SystemRowEditableFields(slot.kind);
                row.label = SystemMessageLabel(association, slot.kind);
            }
        }
        rows.push_back(std::move(row));
    }
    return rows;
}

std::vector<MidiMappingRowVM> MidiConfigViewModel::SectionRows(std::size_t controllerIx,
                                                                MidiConfigSection section) const {
    if (controllerIx >= instrument_.controllers.size()) {
        return {};
    }
    return BuildSectionRows(controllerIx, section);
}

namespace {

// Reads `field`'s current value off a block struct (shared by
// RowFieldValue's Block case and, indirectly, the label builders above via
// their own direct field access). Returns false for a field not applicable
// to this block's variant/form (caller has already gated against
// editableFields, so this is a belt-and-suspenders internal consistency
// check, not a user-facing refusal path).
bool BlockFieldValue(const std::variant<std::monostate, EncoderBlock, AnalogBlock, SystemBlock>& block, Field field,
                    double& out) {
    if (const auto* encoderBlock = std::get_if<EncoderBlock>(&block)) {
        switch (field) {
            case Field::Channel:
                out = static_cast<double>(encoderBlock->channel);
                return true;
            case Field::BlockStartCc:
                out = static_cast<double>(encoderBlock->startCc);
                return true;
            case Field::BlockEndCc:
                out = static_cast<double>(encoderBlock->endCc);
                return true;
            case Field::SlotIx:
                out = static_cast<double>(encoderBlock->slotIx);
                return true;
            case Field::BlockStartPos:
                out = static_cast<double>(encoderBlock->startPosition);
                return true;
            default:
                return false;
        }
    }
    if (const auto* analogBlock = std::get_if<AnalogBlock>(&block)) {
        switch (field) {
            case Field::Channel:
                out = static_cast<double>(analogBlock->channel);
                return true;
            case Field::BlockStartCc:
                out = static_cast<double>(analogBlock->startCc);
                return true;
            case Field::BlockEndCc:
                out = static_cast<double>(analogBlock->endCc);
                return true;
            case Field::BlockStartArg:
                out = static_cast<double>(analogBlock->startGestureIx);
                return true;
            default:
                return false;
        }
    }
    if (const auto* systemBlock = std::get_if<SystemBlock>(&block)) {
        switch (field) {
            case Field::BlockMessageType:
                out = static_cast<double>(systemBlock->message);
                return true;
            case Field::Channel:
                out = static_cast<double>(systemBlock->channel);
                return true;
            case Field::BlockStartCc:
                out = static_cast<double>(systemBlock->startCc);
                return true;
            case Field::BlockEndCc:
                out = static_cast<double>(systemBlock->endCc);
                return true;
            case Field::BlockStartX:
                out = static_cast<double>(systemBlock->startX);
                return true;
            case Field::BlockStartY:
                out = static_cast<double>(systemBlock->startY);
                return true;
            case Field::BlockEndX:
                out = static_cast<double>(systemBlock->endX);
                return true;
            case Field::BlockEndY:
                out = static_cast<double>(systemBlock->endY);
                return true;
            case Field::BlockStartArg:
                out = static_cast<double>(systemBlock->startArg);
                return true;
            case Field::BlockBankSlotIx:
                out = static_cast<double>(systemBlock->bankSlotIx);
                return true;
            case Field::BlockRowMajor:
                out = systemBlock->rowMajor ? 1.0 : 0.0;
                return true;
            case Field::BlockOutputFeedback:
                out = systemBlock->outputFeedback ? 1.0 : 0.0;
                return true;
            default:
                return false;
        }
    }
    return false;
}

}  // namespace

bool MidiConfigViewModel::RowFieldValue(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                        MidiMappingRowVM::Field field, double& out) const {
    if (controllerIx >= instrument_.controllers.size()) {
        return false;
    }

    // Same gate ApplyMappingEdit applies before touching anything: refuse a
    // field this row doesn't advertise (SectionRows() is the single source
    // of truth for row identity/editable fields, reused here so the two can
    // never drift -- see this method's header doc comment). This also
    // naturally refuses PressMessage/ReleaseMessage (never in a numeric
    // field's sense -- callers use SystemMessageChoiceIndex() for those) once
    // a caller passes them for a row that only advertises them alongside
    // position fields; for rows where Press/ReleaseMessage IS advertised,
    // this function still refuses it below the row-lookup, since neither
    // section branch ever assigns `out` for those fields.
    const std::vector<MidiMappingRowVM> rows = SectionRows(controllerIx, section);
    if (rowIx >= rows.size()) {
        return false;
    }
    const std::vector<MidiMappingRowVM::Field>& editable = rows[rowIx].editableFields;
    if (std::find(editable.begin(), editable.end(), field) == editable.end()) {
        return false;
    }
    if (field == Field::PressMessage || field == Field::ReleaseMessage || field == Field::BlockMessageType) {
        return false;
    }

    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    const SectionPresentation& presentation = PresentationFor(controllerIx, section);
    const PresentationRow& presentationRow = presentation.rows[rowIx];

    if (presentationRow.kind == RowKind::Block) {
        return BlockFieldValue(presentationRow.block, field, out);
    }
    if (presentationRow.kind == RowKind::ConfigLevel) {
        if (presentationRow.group == RowGroup::EncoderMode && field == Field::RelativeMode) {
            out = slot.config.encoderInput->relativeMode == EncoderRelativeMode::DirectionOnly ? 1.0 : 0.0;
            return true;
        }
        if (presentationRow.group == RowGroup::EncoderStep && field == Field::TurnStep) {
            out = static_cast<double>(slot.config.encoderInput->turnStep);
            return true;
        }
        if (presentationRow.group == RowGroup::AnalogSceneBlend && field == Field::SceneBlend &&
            slot.config.analogInput->sceneBlend.has_value()) {
            out = static_cast<double>(slot.config.analogInput->sceneBlend->cc);
            return true;
        }
        return false;
    }

    // Individual row: resolve identity -> raw config element.
    const RowIdentity& identity = presentationRow.identities.front();
    if (const auto* encoderIdentity = std::get_if<EncoderIdentity>(&identity)) {
        const std::vector<EncoderMidiMapping>& mappings =
            encoderIdentity->isPush ? slot.config.encoderInput->pushes : slot.config.encoderInput->turns;
        const std::size_t rawIx = ResolveEncoderIdentity(mappings, *encoderIdentity);
        if (rawIx == kNotFound) {
            return false;
        }
        const EncoderMidiMapping& mapping = mappings[rawIx];
        switch (field) {
            case Field::Channel:
                out = static_cast<double>(mapping.control.channel);
                return true;
            case Field::Cc:
                out = static_cast<double>(mapping.control.cc);
                return true;
            case Field::SlotIx:
                out = static_cast<double>(mapping.slotIx);
                return true;
            case Field::Position:
                out = static_cast<double>(mapping.position);
                return true;
            default:
                return false;
        }
    }
    if (const auto* analogIdentity = std::get_if<AnalogIdentity>(&identity)) {
        const std::size_t rawIx = ResolveAnalogIdentity(slot.config.analogInput->gestures, *analogIdentity);
        if (rawIx == kNotFound) {
            return false;
        }
        const AnalogMidiMapping& mapping = slot.config.analogInput->gestures[rawIx];
        switch (field) {
            case Field::Channel:
                out = static_cast<double>(mapping.control.channel);
                return true;
            case Field::Cc:
                out = static_cast<double>(mapping.control.cc);
                return true;
            case Field::GestureIx:
                out = static_cast<double>(mapping.gestureIx);
                return true;
            default:
                return false;
        }
    }
    if (const auto* systemIdentity = std::get_if<SystemIdentity>(&identity)) {
        MidiControllerProfileConfig sortedScratch;
        sortedScratch.systemMessages = slot.config.systemMessages;
        NormalizeMidiProfileConfig(sortedScratch, slot.kind);
        const std::size_t rawIx = ResolveSystemIdentity(sortedScratch.systemMessages, slot.kind, *systemIdentity);
        if (rawIx == kNotFound) {
            return false;
        }
        const MidiControllerSystemMessageAssociation& association = sortedScratch.systemMessages[rawIx];
        switch (field) {
            case Field::Channel:
                if (!association.control.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.control->channel);
                return true;
            case Field::Cc:
                if (!association.control.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.control->cc);
                return true;
            case Field::LaunchpadX:
                if (!association.launchpadPosition.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.launchpadPosition->x);
                return true;
            case Field::LaunchpadY:
                if (!association.launchpadPosition.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.launchpadPosition->y);
                return true;
            case Field::WrldBldrX:
                if (!association.wrldBldrPosition.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.wrldBldrPosition->x);
                return true;
            case Field::WrldBldrY:
                if (!association.wrldBldrPosition.has_value()) {
                    return false;
                }
                out = static_cast<double>(association.wrldBldrPosition->y);
                return true;
            case Field::Button:
                if (!association.control.has_value() || association.control->cc < 8 ||
                    association.control->cc > 13) {
                    return false;
                }
                out = static_cast<double>(association.control->cc - 8);
                return true;
            default:
                return false;
        }
    }
    return false;
}

namespace {

// True when `value` is representable as a non-negative integer -- the
// baseline domain check for SlotIx/Position/GestureIx/bank & scene indices
// and catalog indices (brief finding 3: "integral (value == floor(value)),
// within the field's domain ... at minimum non-negative").
//
// Also bounds `value` from above so every caller's later
// `static_cast<std::size_t>(value)` is well-defined: without this, a value
// like 1e300 passes isfinite/>=0/==floor but casting it to std::size_t is
// undefined behavior (the double is far outside std::size_t's range). Two
// bounds apply: 2^53 (kMaxSafeInteger), the largest integer every double
// value up to it represents exactly (beyond it, doubles start skipping
// integers, so "value == floor(value)" no longer guarantees `value` names a
// specific integer); and std::numeric_limits<std::size_t>::max() converted
// to double, in case size_t is narrower than 53 bits (e.g. a 32-bit
// size_t). Domain-specific caps (e.g. Cc's 0-127, WrldBldrX/Y's 0-7) still
// apply on top of this via IsIntegerInRange/other callers.
bool IsNonNegativeInteger(double value) {
    constexpr double kMaxSafeInteger = 9007199254740992.0;  // 2^53
    const double maxSizeT = static_cast<double>(std::numeric_limits<std::size_t>::max());
    const double upperBound = std::min(kMaxSafeInteger, maxSizeT);
    return std::isfinite(value) && value >= 0.0 && value == std::floor(value) && value <= upperBound;
}

bool IsIntegerInRange(double value, double lo, double hi) {
    return std::isfinite(value) && value == std::floor(value) && value >= lo && value <= hi;
}

}  // namespace

int MidiConfigViewModel::SystemMessageChoiceIndex(std::size_t controllerIx, MidiConfigSection section,
                                                   std::size_t rowIx, MidiMappingRowVM::Field field) const {
    if (section != MidiConfigSection::SystemMessages ||
        (field != Field::PressMessage && field != Field::ReleaseMessage)) {
        return -1;
    }
    if (controllerIx >= instrument_.controllers.size()) {
        return -1;
    }
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    const SectionPresentation& presentation = PresentationFor(controllerIx, section);
    if (rowIx >= presentation.rows.size() || presentation.rows[rowIx].kind != RowKind::Individual) {
        return -1;  // Block/ConfigLevel rows never advertise Press/ReleaseMessage.
    }
    const auto* systemIdentity = std::get_if<SystemIdentity>(&presentation.rows[rowIx].identities.front());
    if (systemIdentity == nullptr) {
        return -1;
    }
    MidiControllerProfileConfig sortedScratch;
    sortedScratch.systemMessages = slot.config.systemMessages;
    NormalizeMidiProfileConfig(sortedScratch, slot.kind);
    const std::size_t rawIx = ResolveSystemIdentity(sortedScratch.systemMessages, slot.kind, *systemIdentity);
    if (rawIx == kNotFound) {
        return -1;
    }
    const MidiControllerSystemMessageAssociation& association = sortedScratch.systemMessages[rawIx];

    if (field == Field::ReleaseMessage && !association.release.has_value()) {
        return 0;  // "None"
    }
    const MessageIn& message = field == Field::PressMessage ? association.press : *association.release;

    const std::vector<SystemMessageChoice>& catalog = SystemMessageCatalog();
    for (std::size_t ix = 1; ix < catalog.size(); ++ix) {
        if (MessageInEquivalent(message, catalog[ix].build())) {
            return static_cast<int>(ix);
        }
    }
    return -1;
}

namespace {

// Applies a system Block row's field edit to a scratch copy of `block`,
// validating domain per-field the same way the individual-row cases below
// do (Channel 0-15, coordinates integral, message-type/bool toggle indices
// in range). Does NOT re-validate the whole expansion (ApplyMappingEdit's
// Block case does that separately via ExpandSystemBlock, sru-10's
// "all-or-nothing").
bool ApplyEncoderBlockField(EncoderBlock& block, Field field, double value, std::string& validationError) {
    switch (field) {
        case Field::Channel:
            if (!IsIntegerInRange(value, 0.0, 15.0)) {
                validationError = "channel must be an integer 0-15";
                return false;
            }
            block.channel = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockStartCc:
            if (!IsIntegerInRange(value, 0.0, 127.0)) {
                validationError = "start cc must be an integer 0-127";
                return false;
            }
            block.startCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockEndCc:
            if (!IsIntegerInRange(value, 0.0, 128.0)) {
                validationError = "end cc must be an integer 0-128";
                return false;
            }
            block.endCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::SlotIx:
            if (!IsNonNegativeInteger(value)) {
                validationError = "slot index must be a non-negative integer";
                return false;
            }
            block.slotIx = static_cast<std::size_t>(value);
            return true;
        case Field::BlockStartPos:
            if (!IsNonNegativeInteger(value)) {
                validationError = "start position must be a non-negative integer";
                return false;
            }
            block.startPosition = static_cast<std::size_t>(value);
            return true;
        default:
            return false;
    }
}

bool ApplyAnalogBlockField(AnalogBlock& block, Field field, double value, std::string& validationError) {
    switch (field) {
        case Field::Channel:
            if (!IsIntegerInRange(value, 0.0, 15.0)) {
                validationError = "channel must be an integer 0-15";
                return false;
            }
            block.channel = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockStartCc:
            if (!IsIntegerInRange(value, 0.0, 127.0)) {
                validationError = "start cc must be an integer 0-127";
                return false;
            }
            block.startCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockEndCc:
            if (!IsIntegerInRange(value, 0.0, 128.0)) {
                validationError = "end cc must be an integer 0-128";
                return false;
            }
            block.endCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockStartArg:
            if (!IsNonNegativeInteger(value)) {
                validationError = "start gesture index must be a non-negative integer";
                return false;
            }
            block.startGestureIx = static_cast<std::size_t>(value);
            return true;
        default:
            return false;
    }
}

bool ApplySystemBlockField(SystemBlock& block, Field field, double value, std::string& validationError) {
    switch (field) {
        case Field::BlockMessageType:
            if (!IsIntegerInRange(value, 0.0, static_cast<double>(BlockableMessageCatalog().size() - 1))) {
                validationError = "message type index out of range";
                return false;
            }
            block.message = static_cast<BlockableMessage>(static_cast<int>(value));
            return true;
        case Field::Channel:
            if (!IsIntegerInRange(value, 0.0, 15.0)) {
                validationError = "channel must be an integer 0-15";
                return false;
            }
            block.channel = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockStartCc:
            if (!IsIntegerInRange(value, 0.0, 127.0)) {
                validationError = "start cc must be an integer 0-127";
                return false;
            }
            block.startCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockEndCc:
            if (!IsIntegerInRange(value, 0.0, 128.0)) {
                validationError = "end cc must be an integer 0-128";
                return false;
            }
            block.endCc = static_cast<std::uint8_t>(value);
            return true;
        case Field::BlockStartX:
            if (!IsIntegerInRange(value, static_cast<double>(std::numeric_limits<int>::min()),
                                  static_cast<double>(std::numeric_limits<int>::max()))) {
                validationError = "start x must be an integer";
                return false;
            }
            block.startX = static_cast<int>(value);
            return true;
        case Field::BlockStartY:
            if (!IsIntegerInRange(value, static_cast<double>(std::numeric_limits<int>::min()),
                                  static_cast<double>(std::numeric_limits<int>::max()))) {
                validationError = "start y must be an integer";
                return false;
            }
            block.startY = static_cast<int>(value);
            return true;
        case Field::BlockEndX:
            if (!IsIntegerInRange(value, static_cast<double>(std::numeric_limits<int>::min()),
                                  static_cast<double>(std::numeric_limits<int>::max()))) {
                validationError = "end x must be an integer";
                return false;
            }
            block.endX = static_cast<int>(value);
            return true;
        case Field::BlockEndY:
            if (!IsIntegerInRange(value, static_cast<double>(std::numeric_limits<int>::min()),
                                  static_cast<double>(std::numeric_limits<int>::max()))) {
                validationError = "end y must be an integer";
                return false;
            }
            block.endY = static_cast<int>(value);
            return true;
        case Field::BlockStartArg:
            if (!IsNonNegativeInteger(value)) {
                validationError = "start argument must be a non-negative integer";
                return false;
            }
            block.startArg = static_cast<std::size_t>(value);
            return true;
        case Field::BlockBankSlotIx:
            if (!IsNonNegativeInteger(value)) {
                validationError = "bank slot index must be a non-negative integer";
                return false;
            }
            block.bankSlotIx = static_cast<std::size_t>(value);
            return true;
        case Field::BlockRowMajor:
            if (!IsIntegerInRange(value, 0.0, 1.0)) {
                validationError = "row-major must be 0 or 1";
                return false;
            }
            block.rowMajor = value != 0.0;
            return true;
        case Field::BlockOutputFeedback:
            if (!IsIntegerInRange(value, 0.0, 1.0)) {
                validationError = "output feedback must be 0 or 1";
                return false;
            }
            block.outputFeedback = value != 0.0;
            return true;
        default:
            return false;
    }
}

// Removes every encoder mapping whose identity is in `identities` from
// `mappings` (block-edit/delete "replace cells"/"delete all its cells" --
// sru-10/sru-11).
// `isPush` identifies which vector `mappings` IS (turns or pushes) -- an
// identity only matches a cell in the same vector (turn identities must
// never remove push cells and vice versa, even when they happen to share
// (slotIx, position): the default WrldBldr profile's turn and push at
// position 0 are exactly such a case).
void RemoveEncoderIdentities(std::vector<EncoderMidiMapping>& mappings, const std::vector<RowIdentity>& identities,
                             bool isPush) {
    std::erase_if(mappings, [&](const EncoderMidiMapping& mapping) {
        for (const RowIdentity& identity : identities) {
            const auto* enc = std::get_if<EncoderIdentity>(&identity);
            if (enc != nullptr && enc->isPush == isPush && mapping.slotIx == enc->slotIx &&
                mapping.position == enc->position) {
                return true;
            }
        }
        return false;
    });
}

void RemoveAnalogIdentities(std::vector<AnalogMidiMapping>& mappings, const std::vector<RowIdentity>& identities) {
    std::erase_if(mappings, [&](const AnalogMidiMapping& mapping) {
        for (const RowIdentity& identity : identities) {
            const auto* an = std::get_if<AnalogIdentity>(&identity);
            if (an != nullptr && !an->isSceneBlend && mapping.gestureIx == an->gestureIx) {
                return true;
            }
        }
        return false;
    });
}

// Removes every system association whose identity is in `identities` from
// `associations` (arbitrary order -- normalized right after by every caller).
void RemoveSystemIdentities(std::vector<MidiControllerSystemMessageAssociation>& associations,
                            const std::vector<RowIdentity>& identities, MidiProfileKind kind) {
    MidiControllerProfileConfig sortedScratch;
    sortedScratch.systemMessages = associations;
    NormalizeMidiProfileConfig(sortedScratch, kind);
    const std::vector<MidiControllerSystemMessageAssociation>& sorted = sortedScratch.systemMessages;

    std::vector<bool> remove(sorted.size(), false);
    for (const RowIdentity& identity : identities) {
        const auto* sys = std::get_if<SystemIdentity>(&identity);
        if (sys == nullptr) {
            continue;
        }
        const std::size_t rawIx = ResolveSystemIdentity(sorted, kind, *sys);
        if (rawIx != kNotFound) {
            remove[rawIx] = true;
        }
    }
    std::vector<MidiControllerSystemMessageAssociation> kept;
    kept.reserve(sorted.size());
    for (std::size_t ix = 0; ix < sorted.size(); ++ix) {
        if (!remove[ix]) {
            kept.push_back(sorted[ix]);
        }
    }
    associations = std::move(kept);
}

}  // namespace

bool MidiConfigViewModel::ApplyMappingEdit(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                           MidiMappingRowVM::Field field, double value, MidiInstrumentConfig& out,
                                           std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }

    const SectionPresentation* presentationConst = nullptr;
    {
        // General gate: refuse any Field not advertised in this row's
        // editableFields before touching the scratch config at all.
        const std::vector<MidiMappingRowVM> rows = SectionRows(controllerIx, section);
        if (rowIx >= rows.size()) {
            if (reason != nullptr) {
                *reason = "row index out of range";
            }
            return false;
        }
        const std::vector<MidiMappingRowVM::Field>& editable = rows[rowIx].editableFields;
        if (std::find(editable.begin(), editable.end(), field) == editable.end()) {
            if (reason != nullptr) {
                *reason = "field not editable for this row";
            }
            return false;
        }
        presentationConst = &PresentationFor(controllerIx, section);
    }
    const PresentationRow& presentationRow = presentationConst->rows[rowIx];

    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];

    // --- Block row: whole-block validate -> replace-cells commit (sru-10's
    // "block commit is all-or-nothing", D5's "block edit = replace-cells
    // commit"). ---
    if (presentationRow.kind == RowKind::Block) {
        std::string validationError;
        if (const auto* encoderBlockConst = std::get_if<EncoderBlock>(&presentationRow.block)) {
            EncoderBlock block = *encoderBlockConst;
            if (!ApplyEncoderBlockField(block, field, value, validationError)) {
                if (reason != nullptr) {
                    *reason = !validationError.empty() ? validationError : "field is not editable on this row";
                }
                return false;
            }
            std::vector<EncoderMidiMapping> expansion;
            if (!ExpandEncoderBlock(block, expansion, reason)) {
                return false;
            }
            const bool isPush = block.isPush;
            std::vector<EncoderMidiMapping>& mappings = isPush ? slot.config.encoderInput->pushes
                                                                : slot.config.encoderInput->turns;
            RemoveEncoderIdentities(mappings, presentationRow.identities, isPush);
            mappings.insert(mappings.end(), expansion.begin(), expansion.end());
        } else if (const auto* analogBlockConst = std::get_if<AnalogBlock>(&presentationRow.block)) {
            AnalogBlock block = *analogBlockConst;
            if (!ApplyAnalogBlockField(block, field, value, validationError)) {
                if (reason != nullptr) {
                    *reason = !validationError.empty() ? validationError : "field is not editable on this row";
                }
                return false;
            }
            std::vector<AnalogMidiMapping> expansion;
            if (!ExpandAnalogBlock(block, expansion, reason)) {
                return false;
            }
            RemoveAnalogIdentities(slot.config.analogInput->gestures, presentationRow.identities);
            slot.config.analogInput->gestures.insert(slot.config.analogInput->gestures.end(), expansion.begin(),
                                                      expansion.end());
        } else if (const auto* systemBlockConst = std::get_if<SystemBlock>(&presentationRow.block)) {
            SystemBlock block = *systemBlockConst;
            if (!ApplySystemBlockField(block, field, value, validationError)) {
                if (reason != nullptr) {
                    *reason = !validationError.empty() ? validationError : "field is not editable on this row";
                }
                return false;
            }
            std::vector<MidiControllerSystemMessageAssociation> expansion;
            if (!ExpandSystemBlock(block, expansion, reason)) {
                return false;
            }
            RemoveSystemIdentities(slot.config.systemMessages, presentationRow.identities, slot.kind);
            slot.config.systemMessages.insert(slot.config.systemMessages.end(), expansion.begin(), expansion.end());
        } else {
            if (reason != nullptr) {
                *reason = "row has no block data";
            }
            return false;
        }

        NormalizeMidiProfileConfig(slot.config, slot.kind);
        if (!SlotValidForKind(slot, reason)) {
            return false;
        }
        out = std::move(scratch);
        return true;
    }

    bool fieldValid = false;
    // Set alongside fieldValid=false when the field IS editable on this row
    // but `value` fails domain validation, so the caller gets a precise
    // reason instead of the generic "field is not editable" one.
    std::string validationError;

    if (presentationRow.kind == RowKind::ConfigLevel) {
        if (presentationRow.group == RowGroup::EncoderMode && field == Field::RelativeMode) {
            // Index-based: `value` selects RelativeModeCatalog() by position
            // (0 = Signed7Bit, 1 = DirectionOnly -- EncoderRelativeMode's
            // declaration order), not a raw enum value, so a JUCE combo box
            // can drive this directly off its selected index.
            const std::vector<std::string>& catalog = RelativeModeCatalog();
            if (!IsIntegerInRange(value, 0.0, static_cast<double>(catalog.size() - 1))) {
                validationError = "relative mode index out of range";
            } else {
                const auto index = static_cast<std::size_t>(value);
                slot.config.encoderInput->relativeMode =
                    index == 1 ? EncoderRelativeMode::DirectionOnly : EncoderRelativeMode::Signed7Bit;
                fieldValid = true;
            }
        } else if (presentationRow.group == RowGroup::EncoderStep && field == Field::TurnStep) {
            if (!std::isfinite(value) || value <= 0.0 || value > double(std::numeric_limits<float>::max())) {
                validationError = "turn step out of range";
            } else {
                slot.config.encoderInput->turnStep = static_cast<float>(value);
                fieldValid = true;
            }
        } else if (presentationRow.group == RowGroup::AnalogSceneBlend && field == Field::SceneBlend) {
            if (!IsIntegerInRange(value, 0.0, 127.0)) {
                validationError = "cc must be an integer 0-127";
            } else {
                MidiControlAddress address = slot.config.analogInput->sceneBlend.value_or(MidiControlAddress{});
                address.cc = static_cast<std::uint8_t>(value);
                slot.config.analogInput->sceneBlend = address;
                fieldValid = true;
            }
        }
    } else {
        // Individual row: resolve identity -> raw config element, then apply
        // exactly the same per-field logic the pre-blocks implementation had.
        const RowIdentity& identity = presentationRow.identities.front();
        if (const auto* encoderIdentity = std::get_if<EncoderIdentity>(&identity)) {
            std::vector<EncoderMidiMapping>& mappings =
                encoderIdentity->isPush ? slot.config.encoderInput->pushes : slot.config.encoderInput->turns;
            const std::size_t rawIx = ResolveEncoderIdentity(mappings, *encoderIdentity);
            if (rawIx == kNotFound) {
                if (reason != nullptr) {
                    *reason = "row no longer resolves";
                }
                return false;
            }
            EncoderMidiMapping& mapping = mappings[rawIx];
            switch (field) {
                case Field::Channel:
                    if (!IsIntegerInRange(value, 0.0, 15.0)) {
                        validationError = "channel must be an integer 0-15";
                        break;
                    }
                    mapping.control.channel = static_cast<std::uint8_t>(value);
                    fieldValid = true;
                    break;
                case Field::Cc:
                    if (!IsIntegerInRange(value, 0.0, 127.0)) {
                        validationError = "cc must be an integer 0-127";
                        break;
                    }
                    mapping.control.cc = static_cast<std::uint8_t>(value);
                    fieldValid = true;
                    break;
                case Field::SlotIx:
                    if (!IsNonNegativeInteger(value)) {
                        validationError = "slot index must be a non-negative integer";
                        break;
                    }
                    mapping.slotIx = static_cast<std::size_t>(value);
                    fieldValid = true;
                    break;
                case Field::Position:
                    if (!IsNonNegativeInteger(value)) {
                        validationError = "position must be a non-negative integer";
                        break;
                    }
                    mapping.position = static_cast<std::size_t>(value);
                    fieldValid = true;
                    break;
                default:
                    break;
            }
        } else if (const auto* analogIdentity = std::get_if<AnalogIdentity>(&identity)) {
            const std::size_t rawIx = ResolveAnalogIdentity(slot.config.analogInput->gestures, *analogIdentity);
            if (rawIx == kNotFound) {
                if (reason != nullptr) {
                    *reason = "row no longer resolves";
                }
                return false;
            }
            AnalogMidiMapping& mapping = slot.config.analogInput->gestures[rawIx];
            switch (field) {
                case Field::Channel:
                    if (!IsIntegerInRange(value, 0.0, 15.0)) {
                        validationError = "channel must be an integer 0-15";
                        break;
                    }
                    mapping.control.channel = static_cast<std::uint8_t>(value);
                    fieldValid = true;
                    break;
                case Field::Cc:
                    if (!IsIntegerInRange(value, 0.0, 127.0)) {
                        validationError = "cc must be an integer 0-127";
                        break;
                    }
                    mapping.control.cc = static_cast<std::uint8_t>(value);
                    fieldValid = true;
                    break;
                case Field::GestureIx:
                    if (!IsNonNegativeInteger(value)) {
                        validationError = "gesture index must be a non-negative integer";
                        break;
                    }
                    mapping.gestureIx = static_cast<std::size_t>(value);
                    fieldValid = true;
                    break;
                default:
                    break;
            }
        } else if (const auto* systemIdentity = std::get_if<SystemIdentity>(&identity)) {
            MidiControllerProfileConfig sortedScratch;
            sortedScratch.systemMessages = slot.config.systemMessages;
            NormalizeMidiProfileConfig(sortedScratch, slot.kind);
            const std::size_t rawIx = ResolveSystemIdentity(sortedScratch.systemMessages, slot.kind, *systemIdentity);
            if (rawIx == kNotFound) {
                if (reason != nullptr) {
                    *reason = "row no longer resolves";
                }
                return false;
            }
            // Edit against the ORIGINAL (unsorted) storage so we don't
            // silently reorder unrelated elements -- find the same element
            // by identity (control/position pointer equality isn't
            // available across the copy, so match by value: the sorted
            // scratch element IS a copy of some element in
            // slot.config.systemMessages; find its index there by scanning
            // for the first not-yet-claimed structurally-identical element.
            // Simpler and robust: apply the edit to the sorted copy, then
            // write the WHOLE systemMessages vector back from the sorted
            // copy (normalizing is required on every commit anyway, sru-9,
            // so this does not change the committed shape's canonicality).
            MidiControllerSystemMessageAssociation& association = sortedScratch.systemMessages[rawIx];
            switch (field) {
                case Field::Channel:
                    if (!association.control.has_value()) {
                        break;
                    }
                    if (!IsIntegerInRange(value, 0.0, 15.0)) {
                        validationError = "channel must be an integer 0-15";
                        break;
                    }
                    association.control->channel = static_cast<std::uint8_t>(value);
                    if (association.wrldBldrPosition.has_value()) {
                        association.wrldBldrPosition->channel = association.control->channel;
                    }
                    fieldValid = true;
                    break;
                case Field::Cc:
                    if (!association.control.has_value()) {
                        break;
                    }
                    if (!IsIntegerInRange(value, 0.0, 127.0)) {
                        validationError = "cc must be an integer 0-127";
                        break;
                    }
                    association.control->cc = static_cast<std::uint8_t>(value);
                    fieldValid = true;
                    break;
                case Field::LaunchpadX:
                case Field::LaunchpadY: {
                    if (!association.launchpadPosition.has_value()) {
                        break;
                    }
                    if (!IsIntegerInRange(value, static_cast<double>(std::numeric_limits<int>::min()),
                                          static_cast<double>(std::numeric_limits<int>::max()))) {
                        validationError = "launchpad coordinate must be an integer";
                        break;
                    }
                    LaunchpadGridPosition candidate = *association.launchpadPosition;
                    const int coordinate = static_cast<int>(value);
                    if (field == Field::LaunchpadX) {
                        candidate.x = coordinate;
                    } else {
                        candidate.y = coordinate;
                    }
                    if (!LaunchpadShapeSupports(candidate.controller, candidate.x, candidate.y)) {
                        validationError = "launchpad coordinate is outside this controller's grid";
                        break;
                    }
                    association.launchpadPosition = candidate;
                    fieldValid = true;
                    break;
                }
                case Field::WrldBldrX:
                case Field::WrldBldrY: {
                    if (!association.wrldBldrPosition.has_value()) {
                        break;
                    }
                    if (!IsIntegerInRange(value, 0.0, 7.0)) {
                        validationError = "WRLD.Bldr coordinate must be an integer 0-7";
                        break;
                    }
                    WrldBldrSystemPosition candidate = *association.wrldBldrPosition;
                    const std::uint8_t coordinate = static_cast<std::uint8_t>(value);
                    if (field == Field::WrldBldrX) {
                        candidate.x = coordinate;
                    } else {
                        candidate.y = coordinate;
                    }
                    const std::uint8_t channel =
                        association.control.has_value() ? association.control->channel : candidate.channel;
                    candidate.channel = channel;
                    association.wrldBldrPosition = candidate;
                    association.control =
                        MidiControlAddress{.channel = channel, .cc = WrldBldrPositionToCC(candidate.x, candidate.y)};
                    fieldValid = true;
                    break;
                }
                case Field::Button: {
                    if (!IsIntegerInRange(value, 0.0, 5.0)) {
                        validationError = "side button must be an integer 0-5";
                        break;
                    }
                    const std::uint8_t channel = association.control.has_value() ? association.control->channel
                                                                                 : static_cast<std::uint8_t>(3);
                    association.control = MidiControlAddress{.channel = channel,
                                                              .cc = static_cast<std::uint8_t>(8 + static_cast<int>(value))};
                    fieldValid = true;
                    break;
                }
                case Field::PressMessage:
                case Field::ReleaseMessage: {
                    if (!IsNonNegativeInteger(value)) {
                        validationError = "message choice must be a non-negative integer catalog index";
                        break;
                    }
                    const std::vector<SystemMessageChoice>& catalog = SystemMessageCatalog();
                    const auto choiceIx = static_cast<std::size_t>(value);
                    if (choiceIx >= catalog.size()) {
                        validationError = "message choice index out of range";
                        break;
                    }
                    if (field == Field::PressMessage) {
                        if (choiceIx == 0) {
                            validationError = "press message cannot be \"None\"";
                            break;
                        }
                        association.press = catalog[choiceIx].build();
                    } else {
                        if (choiceIx == 0) {
                            association.release = std::nullopt;
                        } else {
                            association.release = catalog[choiceIx].build();
                        }
                    }
                    fieldValid = true;
                    break;
                }
                default:
                    break;
            }
            if (fieldValid) {
                slot.config.systemMessages = std::move(sortedScratch.systemMessages);
            }
        }
    }

    if (!fieldValid) {
        if (reason != nullptr) {
            *reason = !validationError.empty() ? validationError : "field is not editable on this row";
        }
        return false;
    }

    NormalizeMidiProfileConfig(slot.config, slot.kind);
    if (!SlotValidForKind(slot, reason)) {
        return false;
    }

    out = std::move(scratch);
    return true;
}

bool MidiConfigViewModel::AddController(std::string name, MidiProfileKind kind, MidiInstrumentConfig& out,
                                        std::string* reason) const {
    if (instrument_.FindController(name) != nullptr) {
        if (reason != nullptr) {
            *reason = "a controller with this name already exists";
        }
        return false;
    }

    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = kind;
    switch (kind) {
        case MidiProfileKind::WrldBldr:
            slot.config = WrldBldrDefaultProfileConfig();
            break;
        case MidiProfileKind::MfTwister:
            slot.config = MfTwisterDefaultProfileConfig();
            break;
        case MidiProfileKind::Launchpad:
            slot.config = LaunchpadDefaultProfileConfig();
            break;
        case MidiProfileKind::Generic:
            slot.config = MidiControllerProfileConfig{};
            break;
    }
    // sru-9: every commit path normalizes, including a freshly-seeded default
    // profile (already canonical in practice for every factory today, but
    // this keeps the guarantee independent of that incidental fact).
    NormalizeMidiProfileConfig(slot.config, kind);

    MidiInstrumentConfig scratch = instrument_;
    if (!scratch.AddController(std::move(slot))) {
        if (reason != nullptr) {
            *reason = "controller could not be added (duplicate name or invalid slot)";
        }
        return false;
    }

    out = std::move(scratch);
    return true;
}

bool MidiConfigViewModel::SetEndpointRef(std::size_t controllerIx, bool output, MidiEndpointRef ref,
                                         MidiInstrumentConfig& out) const {
    if (controllerIx >= instrument_.controllers.size()) {
        return false;
    }
    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];
    if (output) {
        slot.output = std::move(ref);
    } else {
        slot.input = std::move(ref);
    }
    out = std::move(scratch);
    return true;
}

bool MidiConfigViewModel::CanDeleteRow(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx) const {
    if (controllerIx >= instrument_.controllers.size()) {
        return false;
    }
    const SectionPresentation& presentation = PresentationFor(controllerIx, section);
    return rowIx < presentation.rows.size() && presentation.rows[rowIx].kind != RowKind::ConfigLevel;
}

bool MidiConfigViewModel::DeleteRow(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                    MidiInstrumentConfig& out, std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }
    const SectionPresentation& presentation = PresentationFor(controllerIx, section);
    if (rowIx >= presentation.rows.size()) {
        if (reason != nullptr) {
            *reason = "row index out of range";
        }
        return false;
    }
    const PresentationRow& presentationRow = presentation.rows[rowIx];
    if (presentationRow.kind == RowKind::ConfigLevel) {
        if (reason != nullptr) {
            *reason = "config-level rows cannot be deleted";
        }
        return false;
    }

    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];

    switch (section) {
        case MidiConfigSection::Encoders:
            RemoveEncoderIdentities(slot.config.encoderInput->turns, presentationRow.identities, /*isPush=*/false);
            RemoveEncoderIdentities(slot.config.encoderInput->pushes, presentationRow.identities, /*isPush=*/true);
            break;
        case MidiConfigSection::Analogs:
            RemoveAnalogIdentities(slot.config.analogInput->gestures, presentationRow.identities);
            break;
        case MidiConfigSection::SystemMessages:
            RemoveSystemIdentities(slot.config.systemMessages, presentationRow.identities, slot.kind);
            break;
    }

    NormalizeMidiProfileConfig(slot.config, slot.kind);
    if (!SlotValidForKind(slot, reason)) {
        return false;
    }
    out = std::move(scratch);
    return true;
}

namespace {

// Lowest non-negative integer not present in `used` (sru-11's "+": "append
// one config with next-free defaults").
std::size_t LowestFree(const std::vector<bool>& used) {
    for (std::size_t ix = 0; ix < used.size(); ++ix) {
        if (!used[ix]) {
            return ix;
        }
    }
    return used.size();
}

std::size_t NextFreeEncoderPosition(const std::vector<EncoderMidiMapping>& mappings) {
    std::vector<bool> used;
    for (const EncoderMidiMapping& mapping : mappings) {
        if (mapping.position >= used.size()) {
            used.resize(mapping.position + 1, false);
        }
        used[mapping.position] = true;
    }
    return LowestFree(used);
}

std::size_t NextFreeGestureIx(const std::vector<AnalogMidiMapping>& mappings) {
    std::vector<bool> used;
    for (const AnalogMidiMapping& mapping : mappings) {
        if (mapping.gestureIx >= used.size()) {
            used.resize(mapping.gestureIx + 1, false);
        }
        used[mapping.gestureIx] = true;
    }
    return LowestFree(used);
}

std::uint8_t NextFreeCc(const std::vector<EncoderMidiMapping>& mappings, std::uint8_t channel) {
    std::vector<bool> used(128, false);
    for (const EncoderMidiMapping& mapping : mappings) {
        if (mapping.control.channel == channel && mapping.control.cc < 128) {
            used[mapping.control.cc] = true;
        }
    }
    return static_cast<std::uint8_t>(std::min<std::size_t>(LowestFree(used), 127));
}

std::uint8_t NextFreeCc(const std::vector<AnalogMidiMapping>& mappings, std::uint8_t channel) {
    std::vector<bool> used(128, false);
    for (const AnalogMidiMapping& mapping : mappings) {
        if (mapping.control.channel == channel && mapping.control.cc < 128) {
            used[mapping.control.cc] = true;
        }
    }
    return static_cast<std::uint8_t>(std::min<std::size_t>(LowestFree(used), 127));
}

// Lowest-unused sceneIx/bankIx(slot 0)/gestureIx among existing system
// messages of the given BlockableMessage type -- the "next free argument"
// half of a system row's default.
std::size_t NextFreeSystemArg(const std::vector<MidiControllerSystemMessageAssociation>& associations,
                              BlockableMessage message) {
    std::vector<bool> used;
    for (const MidiControllerSystemMessageAssociation& association : associations) {
        std::optional<std::size_t> arg;
        switch (message) {
            case BlockableMessage::SceneSelect:
                if (association.press.type == MessageIn::Type::SceneSelect) {
                    arg = association.press.sceneIx;
                }
                break;
            case BlockableMessage::BankSelect:
                if (association.press.type == MessageIn::Type::SelectParamBank && association.press.slotIx == 0) {
                    arg = association.press.bankIx;
                }
                break;
            case BlockableMessage::GestureSelect:
                if (association.press.type == MessageIn::Type::SetGestureSelect && association.press.boolValue) {
                    arg = association.press.gestureIx;
                }
                break;
        }
        if (arg.has_value()) {
            if (*arg >= used.size()) {
                used.resize(*arg + 1, false);
            }
            used[*arg] = true;
        }
    }
    return LowestFree(used);
}

// Lowest-unused (channel, cc) pair for a generic/MfTwister system row,
// scanning cc within channel 0 first (MfTwister's caller further restricts
// this to the 0..5 button domain -- see AddSingle's SystemMessages case).
std::pair<std::uint8_t, std::uint8_t> NextFreeGenericAddress(
    const std::vector<MidiControllerSystemMessageAssociation>& associations) {
    std::vector<bool> used(128, false);
    for (const MidiControllerSystemMessageAssociation& association : associations) {
        if (association.control.has_value() && association.control->channel == 0 && association.control->cc < 128) {
            used[association.control->cc] = true;
        }
    }
    return {0, static_cast<std::uint8_t>(std::min<std::size_t>(LowestFree(used), 127))};
}

// Lowest-unused MfTwister side button 0..5 (the only shape twister
// associations can occupy, D1) -- returns 6 (invalid, refused by the caller)
// if all 6 are taken.
std::size_t NextFreeTwisterButton(const std::vector<MidiControllerSystemMessageAssociation>& associations) {
    std::vector<bool> used(6, false);
    for (const MidiControllerSystemMessageAssociation& association : associations) {
        if (association.control.has_value() && association.control->cc >= 8 && association.control->cc <= 13) {
            used[association.control->cc - 8] = true;
        }
    }
    return LowestFree(used);
}

// Lowest-unused (x,y) WrldBldr 0-7 grid cell, row-major (y then x).
std::optional<std::pair<std::uint8_t, std::uint8_t>> NextFreeWrldBldrPosition(
    const std::vector<MidiControllerSystemMessageAssociation>& associations) {
    bool used[8][8] = {};
    for (const MidiControllerSystemMessageAssociation& association : associations) {
        if (association.wrldBldrPosition.has_value()) {
            const auto& pos = *association.wrldBldrPosition;
            if (pos.x < 8 && pos.y < 8) {
                used[pos.y][pos.x] = true;
            }
        }
    }
    for (std::uint8_t y = 0; y < 8; ++y) {
        for (std::uint8_t x = 0; x < 8; ++x) {
            if (!used[y][x]) {
                return std::make_pair(x, y);
            }
        }
    }
    return std::nullopt;
}

// Lowest-unused Launchpad (x,y) within the given controller's shape,
// row-major scan of a generous bounding box (Launchpad coordinates can be
// -1..9 per LaunchpadShapeSupports).
std::optional<LaunchpadGridPosition> NextFreeLaunchpadPosition(
    const std::vector<MidiControllerSystemMessageAssociation>& associations, LaunchpadController controller) {
    std::vector<LaunchpadGridPosition> used;
    for (const MidiControllerSystemMessageAssociation& association : associations) {
        if (association.launchpadPosition.has_value()) {
            used.push_back(*association.launchpadPosition);
        }
    }
    for (int y = -1; y <= 9; ++y) {
        for (int x = -1; x <= 9; ++x) {
            if (!LaunchpadShapeSupports(controller, x, y)) {
                continue;
            }
            const LaunchpadGridPosition candidate{.controller = controller, .x = x, .y = y};
            if (std::find(used.begin(), used.end(), candidate) == used.end()) {
                return candidate;
            }
        }
    }
    return std::nullopt;
}

}  // namespace

bool MidiConfigViewModel::AddSingle(std::size_t controllerIx, MidiConfigSection section,
                                    MidiMappingRowVM::RowGroup group, MidiInstrumentConfig& out,
                                    std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }
    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];

    if (section == MidiConfigSection::Encoders && (group == RowGroup::EncoderTurn || group == RowGroup::EncoderPush)) {
        if (!slot.config.encoderInput.has_value()) {
            if (reason != nullptr) {
                *reason = "controller has no encoder input";
            }
            return false;
        }
        const bool isPush = group == RowGroup::EncoderPush;
        std::vector<EncoderMidiMapping>& mappings = isPush ? slot.config.encoderInput->pushes
                                                            : slot.config.encoderInput->turns;
        const std::uint8_t channel = mappings.empty() ? (isPush ? std::uint8_t{1} : std::uint8_t{0})
                                                       : mappings.front().control.channel;
        EncoderMidiMapping mapping;
        mapping.control.channel = channel;
        mapping.control.cc = NextFreeCc(mappings, channel);
        mapping.slotIx = mappings.empty() ? 0 : mappings.front().slotIx;
        mapping.position = NextFreeEncoderPosition(mappings);
        mappings.push_back(mapping);
    } else if (section == MidiConfigSection::Analogs && group == RowGroup::AnalogGesture) {
        if (!slot.config.analogInput.has_value()) {
            if (reason != nullptr) {
                *reason = "controller has no analog input";
            }
            return false;
        }
        std::vector<AnalogMidiMapping>& mappings = slot.config.analogInput->gestures;
        const std::uint8_t channel = mappings.empty() ? std::uint8_t{0} : mappings.front().control.channel;
        AnalogMidiMapping mapping;
        mapping.control.channel = channel;
        mapping.control.cc = NextFreeCc(mappings, channel);
        mapping.gestureIx = NextFreeGestureIx(mappings);
        mappings.push_back(mapping);
    } else if (section == MidiConfigSection::SystemMessages && group == RowGroup::System) {
        // Default a new individual system row to a SceneSelect association
        // at the next-free scene index and the next-free address for this
        // kind's schema (D1) -- a deliberately simple, deterministic choice
        // among the three blockable types (see this method's header doc
        // comment); the renderer lets the user re-target press/release via
        // the existing PressMessage/ReleaseMessage combos afterward.
        const std::size_t sceneIx = NextFreeSystemArg(slot.config.systemMessages, BlockableMessage::SceneSelect);
        MidiControllerSystemMessageAssociation association;
        association.press = MessageIn::SceneSelect(0, sceneIx);
        association.feedback = association.press;
        association.outputFeedback = true;

        switch (slot.kind) {
            case MidiProfileKind::WrldBldr: {
                const auto position = NextFreeWrldBldrPosition(slot.config.systemMessages);
                if (!position.has_value()) {
                    if (reason != nullptr) {
                        *reason = "no free WRLD.Bldr grid position for a new system row";
                    }
                    return false;
                }
                const std::uint8_t channel = slot.config.systemMessages.empty()
                                                 ? std::uint8_t{5}
                                                 : (slot.config.systemMessages.front().control.has_value()
                                                       ? slot.config.systemMessages.front().control->channel
                                                       : std::uint8_t{5});
                association.wrldBldrPosition =
                    WrldBldrSystemPosition{.channel = channel, .x = position->first, .y = position->second};
                association.control = MidiControlAddress{.channel = channel,
                                                          .cc = WrldBldrPositionToCC(position->first, position->second)};
                break;
            }
            case MidiProfileKind::Launchpad: {
                const auto position = NextFreeLaunchpadPosition(slot.config.systemMessages,
                                                                 LaunchpadController::LaunchpadX);
                if (!position.has_value()) {
                    if (reason != nullptr) {
                        *reason = "no free launchpad grid position for a new system row";
                    }
                    return false;
                }
                association.launchpadPosition = *position;
                break;
            }
            case MidiProfileKind::MfTwister: {
                const std::size_t button = NextFreeTwisterButton(slot.config.systemMessages);
                if (button >= 6) {
                    if (reason != nullptr) {
                        *reason = "no free twister side button for a new system row";
                    }
                    return false;
                }
                association.control =
                    MidiControlAddress{.channel = 3, .cc = static_cast<std::uint8_t>(8 + button)};
                break;
            }
            case MidiProfileKind::Generic: {
                const auto [channel, cc] = NextFreeGenericAddress(slot.config.systemMessages);
                association.control = MidiControlAddress{.channel = channel, .cc = cc};
                break;
            }
        }
        slot.config.systemMessages.push_back(std::move(association));
    } else {
        if (reason != nullptr) {
            *reason = "this group does not support adding individual rows";
        }
        return false;
    }

    NormalizeMidiProfileConfig(slot.config, slot.kind);
    if (!SlotValidForKind(slot, reason)) {
        return false;
    }
    out = std::move(scratch);
    return true;
}

bool MidiConfigViewModel::AddBlock(std::size_t controllerIx, MidiConfigSection section,
                                   MidiMappingRowVM::RowGroup group, MidiInstrumentConfig& out,
                                   std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }
    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];
    // Default block width (sru-11: "a small default run" -- see this
    // method's header doc comment); large enough to demonstrate a block (>=2
    // per D3/D4) without presuming a huge free range exists.
    constexpr std::size_t kDefaultBlockWidth = 2;

    if (section == MidiConfigSection::Encoders && (group == RowGroup::EncoderTurn || group == RowGroup::EncoderPush)) {
        if (!slot.config.encoderInput.has_value()) {
            if (reason != nullptr) {
                *reason = "controller has no encoder input";
            }
            return false;
        }
        const bool isPush = group == RowGroup::EncoderPush;
        std::vector<EncoderMidiMapping>& mappings = isPush ? slot.config.encoderInput->pushes
                                                            : slot.config.encoderInput->turns;
        const std::uint8_t channel = mappings.empty() ? (isPush ? std::uint8_t{1} : std::uint8_t{0})
                                                       : mappings.front().control.channel;
        EncoderBlock block;
        block.isPush = isPush;
        block.channel = channel;
        block.startCc = NextFreeCc(mappings, channel);
        block.endCc = static_cast<std::uint8_t>(std::min<std::size_t>(
            static_cast<std::size_t>(block.startCc) + kDefaultBlockWidth, 128));
        block.slotIx = mappings.empty() ? 0 : mappings.front().slotIx;
        block.startPosition = NextFreeEncoderPosition(mappings);
        std::vector<EncoderMidiMapping> expansion;
        if (!ExpandEncoderBlock(block, expansion, reason)) {
            return false;
        }
        mappings.insert(mappings.end(), expansion.begin(), expansion.end());
    } else if (section == MidiConfigSection::Analogs && group == RowGroup::AnalogGesture) {
        if (!slot.config.analogInput.has_value()) {
            if (reason != nullptr) {
                *reason = "controller has no analog input";
            }
            return false;
        }
        std::vector<AnalogMidiMapping>& mappings = slot.config.analogInput->gestures;
        const std::uint8_t channel = mappings.empty() ? std::uint8_t{0} : mappings.front().control.channel;
        AnalogBlock block;
        block.channel = channel;
        block.startCc = NextFreeCc(mappings, channel);
        block.endCc = static_cast<std::uint8_t>(std::min<std::size_t>(
            static_cast<std::size_t>(block.startCc) + kDefaultBlockWidth, 128));
        block.startGestureIx = NextFreeGestureIx(mappings);
        std::vector<AnalogMidiMapping> expansion;
        if (!ExpandAnalogBlock(block, expansion, reason)) {
            return false;
        }
        mappings.insert(mappings.end(), expansion.begin(), expansion.end());
    } else if (section == MidiConfigSection::SystemMessages && group == RowGroup::System) {
        if (slot.kind == MidiProfileKind::MfTwister) {
            if (reason != nullptr) {
                *reason = "twister system messages never block";
            }
            return false;
        }
        SystemBlock block;
        block.kind = slot.kind;
        block.message = BlockableMessage::SceneSelect;
        block.startArg = NextFreeSystemArg(slot.config.systemMessages, BlockableMessage::SceneSelect);
        block.outputFeedback = true;
        block.rowMajor = true;

        if (slot.kind == MidiProfileKind::WrldBldr) {
            const auto position = NextFreeWrldBldrPosition(slot.config.systemMessages);
            if (!position.has_value()) {
                if (reason != nullptr) {
                    *reason = "no free WRLD.Bldr grid position for a new block";
                }
                return false;
            }
            block.channel = 5;
            block.startX = position->first;
            block.startY = position->second;
            block.endX = std::min(7, position->first + static_cast<int>(kDefaultBlockWidth) - 1);
            block.endY = position->second;
        } else if (slot.kind == MidiProfileKind::Launchpad) {
            const auto position = NextFreeLaunchpadPosition(slot.config.systemMessages, LaunchpadController::LaunchpadX);
            if (!position.has_value()) {
                if (reason != nullptr) {
                    *reason = "no free launchpad grid position for a new block";
                }
                return false;
            }
            block.launchpadController = position->controller;
            block.startX = position->x;
            block.startY = position->y;
            block.endX = position->x + static_cast<int>(kDefaultBlockWidth) - 1;
            block.endY = position->y;
        } else {
            const auto [channel, cc] = NextFreeGenericAddress(slot.config.systemMessages);
            block.channel = channel;
            block.startCc = cc;
            block.endCc = static_cast<std::uint8_t>(
                std::min<std::size_t>(static_cast<std::size_t>(cc) + kDefaultBlockWidth, 128));
        }

        std::vector<MidiControllerSystemMessageAssociation> expansion;
        if (!ExpandSystemBlock(block, expansion, reason)) {
            return false;
        }
        slot.config.systemMessages.insert(slot.config.systemMessages.end(), expansion.begin(), expansion.end());
    } else {
        if (reason != nullptr) {
            *reason = "this group does not support adding a block";
        }
        return false;
    }

    NormalizeMidiProfileConfig(slot.config, slot.kind);
    if (!SlotValidForKind(slot, reason)) {
        return false;
    }
    out = std::move(scratch);
    return true;
}

} // namespace synth
