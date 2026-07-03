#include "synth/MidiConfigViewModel.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <sstream>

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
            return true;
        case Field::TurnStep:
        case Field::RelativeMode:
        case Field::PressMessage:
        case Field::ReleaseMessage:
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

// Row bookkeeping shared between SectionRows() and ApplyMappingEdit() --
// both must agree on row ordering/count/editable fields for a given
// (controllerIx, section), so this is the single source of truth for that
// mapping. `MappingPtr` is `EncoderMidiMapping*` for ApplyMappingEdit's
// mutable pass over a scratch copy, and `const EncoderMidiMapping*` for
// SectionRows()'s read-only pass -- ForEachEncoderRow/ForEachAnalogRow below
// deduce it from the constness of the `config` argument.
template <typename MappingPtr>
struct EncoderRowRef {
    MappingPtr mapping = nullptr;  // non-null for turn/push rows
    bool isPush = false;
    bool isRelativeMode = false;  // config-level row
    bool isTurnStep = false;      // config-level row
};

// Builds the row list for the Encoders section against a (possibly const)
// config, invoking `visit` once per row in display order. `EncoderMidiInConfig`
// is expected to be present (callers only reach this when the section is
// listed for the controller's kind, which only happens once encoderInput
// has a value in every kind default -- generic/empty configs simply produce
// zero turn/push rows plus the two config-level rows only if encoderInput
// has a value at all).
template <typename Config, typename Visit>
void ForEachEncoderRow(Config& config, Visit&& visit) {
    if (!config.encoderInput.has_value()) {
        return;
    }
    using MappingPtr = decltype(&config.encoderInput->turns.front());
    auto& encoderInput = *config.encoderInput;
    for (auto& mapping : encoderInput.turns) {
        visit(EncoderRowRef<MappingPtr>{.mapping = &mapping, .isPush = false}, EncoderTurnLabel(mapping));
    }
    for (auto& mapping : encoderInput.pushes) {
        visit(EncoderRowRef<MappingPtr>{.mapping = &mapping, .isPush = true}, EncoderPushLabel(mapping));
    }
    visit(EncoderRowRef<MappingPtr>{.isRelativeMode = true}, RelativeModeLabel(encoderInput.relativeMode));
    visit(EncoderRowRef<MappingPtr>{.isTurnStep = true}, TurnStepLabel(encoderInput.turnStep));
}

template <typename MappingPtr>
struct AnalogRowRef {
    MappingPtr mapping = nullptr;  // non-null for gesture rows
    bool isSceneBlend = false;
};

template <typename Config, typename Visit>
void ForEachAnalogRow(Config& config, Visit&& visit) {
    if (!config.analogInput.has_value()) {
        return;
    }
    using MappingPtr = decltype(&config.analogInput->gestures.front());
    auto& analogInput = *config.analogInput;
    for (auto& mapping : analogInput.gestures) {
        visit(AnalogRowRef<MappingPtr>{.mapping = &mapping}, GestureLabel(mapping));
    }
    visit(AnalogRowRef<MappingPtr>{.isSceneBlend = true}, SceneBlendLabel(analogInput.sceneBlend));
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
    ExpandState& state = StateFor(controllers_[controllerIx].name);
    bool& expanded = state.sections[section];
    expanded = !expanded;
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

std::vector<MidiMappingRowVM> MidiConfigViewModel::SectionRows(std::size_t controllerIx,
                                                                MidiConfigSection section) const {
    std::vector<MidiMappingRowVM> rows;
    if (controllerIx >= instrument_.controllers.size()) {
        return rows;
    }
    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];

    switch (section) {
        case MidiConfigSection::Encoders: {
            ForEachEncoderRow(slot.config, [&](const auto& ref, std::string label) {
                MidiMappingRowVM row;
                row.label = std::move(label);
                if (ref.mapping != nullptr) {
                    row.editableFields = {Field::Channel, Field::Cc, Field::SlotIx, Field::Position};
                    row.group = ref.isPush ? MidiMappingRowVM::RowGroup::EncoderPush
                                           : MidiMappingRowVM::RowGroup::EncoderTurn;
                } else if (ref.isRelativeMode) {
                    row.editableFields = {Field::RelativeMode};
                    row.group = MidiMappingRowVM::RowGroup::EncoderMode;
                } else if (ref.isTurnStep) {
                    row.editableFields = {Field::TurnStep};
                    row.group = MidiMappingRowVM::RowGroup::EncoderStep;
                }
                rows.push_back(std::move(row));
            });
            break;
        }
        case MidiConfigSection::Analogs: {
            ForEachAnalogRow(slot.config, [&](const auto& ref, std::string label) {
                MidiMappingRowVM row;
                row.label = std::move(label);
                if (ref.mapping != nullptr) {
                    row.editableFields = {Field::Channel, Field::Cc, Field::GestureIx};
                    row.group = MidiMappingRowVM::RowGroup::AnalogGesture;
                } else if (ref.isSceneBlend) {
                    row.editableFields = {Field::SceneBlend};
                    row.group = MidiMappingRowVM::RowGroup::AnalogSceneBlend;
                }
                rows.push_back(std::move(row));
            });
            break;
        }
        case MidiConfigSection::SystemMessages: {
            for (const MidiControllerSystemMessageAssociation& association : slot.config.systemMessages) {
                MidiMappingRowVM row;
                row.label = SystemMessageLabel(association, slot.kind);
                row.group = MidiMappingRowVM::RowGroup::System;
                if (slot.kind == MidiProfileKind::Launchpad) {
                    row.editableFields = {Field::LaunchpadX, Field::LaunchpadY, Field::PressMessage,
                                          Field::ReleaseMessage};
                } else if (slot.kind == MidiProfileKind::WrldBldr) {
                    // Issue #10: chan/x/y, so the slot's MIDI channel is
                    // editable alongside its grid position. Channel writes
                    // only association.control->channel (ApplyMappingEdit);
                    // WrldBldrX/Y keep wrldBldrPosition and control->cc in
                    // sync via WrldBldrPositionToCC, untouched by a Channel
                    // edit.
                    row.editableFields = {Field::Channel, Field::WrldBldrX, Field::WrldBldrY, Field::PressMessage,
                                          Field::ReleaseMessage};
                } else {
                    row.editableFields = {Field::Channel, Field::Cc, Field::PressMessage, Field::ReleaseMessage};
                }
                rows.push_back(std::move(row));
            }
            break;
        }
    }
    return rows;
}

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
    if (field == Field::PressMessage || field == Field::ReleaseMessage) {
        return false;
    }

    const MidiControllerSlot& slot = instrument_.controllers[controllerIx];
    bool found = false;

    switch (section) {
        case MidiConfigSection::Encoders: {
            std::size_t ix = 0;
            ForEachEncoderRow(slot.config, [&](const auto& ref, const std::string&) {
                if (found) {
                    return;
                }
                if (ix == rowIx) {
                    found = true;
                    if (ref.mapping != nullptr) {
                        switch (field) {
                            case Field::Channel:
                                out = static_cast<double>(ref.mapping->control.channel);
                                break;
                            case Field::Cc:
                                out = static_cast<double>(ref.mapping->control.cc);
                                break;
                            case Field::SlotIx:
                                out = static_cast<double>(ref.mapping->slotIx);
                                break;
                            case Field::Position:
                                out = static_cast<double>(ref.mapping->position);
                                break;
                            default:
                                found = false;
                                break;
                        }
                    } else if (ref.isRelativeMode && field == Field::RelativeMode) {
                        // Index into RelativeModeCatalog(), matching
                        // ApplyMappingEdit's index-based Field::RelativeMode
                        // contract (0 = Signed7Bit, 1 = DirectionOnly).
                        out = slot.config.encoderInput->relativeMode == EncoderRelativeMode::DirectionOnly ? 1.0
                                                                                                            : 0.0;
                    } else if (ref.isTurnStep && field == Field::TurnStep) {
                        out = static_cast<double>(slot.config.encoderInput->turnStep);
                    } else {
                        found = false;
                    }
                }
                ++ix;
            });
            break;
        }
        case MidiConfigSection::Analogs: {
            std::size_t ix = 0;
            ForEachAnalogRow(slot.config, [&](const auto& ref, const std::string&) {
                if (found) {
                    return;
                }
                if (ix == rowIx) {
                    found = true;
                    if (ref.mapping != nullptr) {
                        switch (field) {
                            case Field::Channel:
                                out = static_cast<double>(ref.mapping->control.channel);
                                break;
                            case Field::Cc:
                                out = static_cast<double>(ref.mapping->control.cc);
                                break;
                            case Field::GestureIx:
                                out = static_cast<double>(ref.mapping->gestureIx);
                                break;
                            default:
                                found = false;
                                break;
                        }
                    } else if (ref.isSceneBlend && field == Field::SceneBlend &&
                              slot.config.analogInput->sceneBlend.has_value()) {
                        out = static_cast<double>(slot.config.analogInput->sceneBlend->cc);
                    } else {
                        found = false;
                    }
                }
                ++ix;
            });
            break;
        }
        case MidiConfigSection::SystemMessages: {
            if (rowIx < slot.config.systemMessages.size()) {
                found = true;
                const MidiControllerSystemMessageAssociation& association = slot.config.systemMessages[rowIx];
                switch (field) {
                    case Field::Channel:
                        if (!association.control.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.control->channel);
                        break;
                    case Field::Cc:
                        if (!association.control.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.control->cc);
                        break;
                    case Field::LaunchpadX:
                        if (!association.launchpadPosition.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.launchpadPosition->x);
                        break;
                    case Field::LaunchpadY:
                        if (!association.launchpadPosition.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.launchpadPosition->y);
                        break;
                    case Field::WrldBldrX:
                        if (!association.wrldBldrPosition.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.wrldBldrPosition->x);
                        break;
                    case Field::WrldBldrY:
                        if (!association.wrldBldrPosition.has_value()) {
                            found = false;
                            break;
                        }
                        out = static_cast<double>(association.wrldBldrPosition->y);
                        break;
                    default:
                        found = false;
                        break;
                }
            }
            break;
        }
    }

    return found;
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
    if (rowIx >= slot.config.systemMessages.size()) {
        return -1;
    }
    const MidiControllerSystemMessageAssociation& association = slot.config.systemMessages[rowIx];

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

bool MidiConfigViewModel::ApplyMappingEdit(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                           MidiMappingRowVM::Field field, double value, MidiInstrumentConfig& out,
                                           std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }

    // General gate: refuse any Field not advertised in this row's
    // editableFields before touching the scratch config at all. This is what
    // closes the WRLD.Bldr desync -- system rows advertise only
    // WrldBldrX/WrldBldrY/PressMessage/ReleaseMessage (see SectionRows), so a
    // direct Channel/Cc edit on one is refused here rather than silently
    // no-op'ing deeper in the switch below (the paired `control` address
    // stays consistent because it is only ever written via the WrldBldrX/Y
    // path). SectionRows() is also the single source of truth row-ordering
    // used below, so this reuses it rather than re-deriving row identity.
    {
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
    }

    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];

    bool found = false;
    bool fieldValid = false;
    // Set alongside fieldValid=false when the field IS editable on this row
    // but `value` fails domain validation, so the caller gets a precise
    // reason instead of the generic "field is not editable" one.
    std::string validationError;

    auto applyEncoderMapping = [&](EncoderMidiMapping& mapping) {
        switch (field) {
            case Field::Channel:
                if (!IsIntegerInRange(value, 0.0, 15.0)) {
                    validationError = "channel must be an integer 0-15";
                    return;
                }
                mapping.control.channel = static_cast<std::uint8_t>(value);
                fieldValid = true;
                break;
            case Field::Cc:
                if (!IsIntegerInRange(value, 0.0, 127.0)) {
                    validationError = "cc must be an integer 0-127";
                    return;
                }
                mapping.control.cc = static_cast<std::uint8_t>(value);
                fieldValid = true;
                break;
            case Field::SlotIx:
                if (!IsNonNegativeInteger(value)) {
                    validationError = "slot index must be a non-negative integer";
                    return;
                }
                mapping.slotIx = static_cast<std::size_t>(value);
                fieldValid = true;
                break;
            case Field::Position:
                if (!IsNonNegativeInteger(value)) {
                    validationError = "position must be a non-negative integer";
                    return;
                }
                mapping.position = static_cast<std::size_t>(value);
                fieldValid = true;
                break;
            default:
                break;
        }
    };

    switch (section) {
        case MidiConfigSection::Encoders: {
            std::size_t ix = 0;
            ForEachEncoderRow(slot.config, [&](const auto& ref, const std::string&) {
                if (found) {
                    return;
                }
                if (ix == rowIx) {
                    found = true;
                    if (ref.mapping != nullptr) {
                        applyEncoderMapping(*ref.mapping);
                    } else if (ref.isRelativeMode && field == Field::RelativeMode) {
                        // Index-based: `value` selects RelativeModeCatalog()
                        // by position (0 = Signed7Bit, 1 = DirectionOnly --
                        // EncoderRelativeMode's declaration order), not a raw
                        // enum value, so a JUCE combo box can drive this
                        // directly off its selected index.
                        const std::vector<std::string>& catalog = RelativeModeCatalog();
                        if (!IsIntegerInRange(value, 0.0, static_cast<double>(catalog.size() - 1))) {
                            validationError = "relative mode index out of range";
                        } else {
                            const auto index = static_cast<std::size_t>(value);
                            slot.config.encoderInput->relativeMode =
                                index == 1 ? EncoderRelativeMode::DirectionOnly : EncoderRelativeMode::Signed7Bit;
                            fieldValid = true;
                        }
                    } else if (ref.isTurnStep && field == Field::TurnStep) {
                        if (!std::isfinite(value) || value <= 0.0 || value > double(std::numeric_limits<float>::max())) {
                            validationError = "turn step out of range";
                        } else {
                            slot.config.encoderInput->turnStep = static_cast<float>(value);
                            fieldValid = true;
                        }
                    }
                }
                ++ix;
            });
            break;
        }
        case MidiConfigSection::Analogs: {
            std::size_t ix = 0;
            ForEachAnalogRow(slot.config, [&](const auto& ref, const std::string&) {
                if (found) {
                    return;
                }
                if (ix == rowIx) {
                    found = true;
                    if (ref.mapping != nullptr) {
                        switch (field) {
                            case Field::Channel:
                                if (!IsIntegerInRange(value, 0.0, 15.0)) {
                                    validationError = "channel must be an integer 0-15";
                                    break;
                                }
                                ref.mapping->control.channel = static_cast<std::uint8_t>(value);
                                fieldValid = true;
                                break;
                            case Field::Cc:
                                if (!IsIntegerInRange(value, 0.0, 127.0)) {
                                    validationError = "cc must be an integer 0-127";
                                    break;
                                }
                                ref.mapping->control.cc = static_cast<std::uint8_t>(value);
                                fieldValid = true;
                                break;
                            case Field::GestureIx:
                                if (!IsNonNegativeInteger(value)) {
                                    validationError = "gesture index must be a non-negative integer";
                                    break;
                                }
                                ref.mapping->gestureIx = static_cast<std::size_t>(value);
                                fieldValid = true;
                                break;
                            default:
                                break;
                        }
                    } else if (ref.isSceneBlend && field == Field::SceneBlend) {
                        if (!IsIntegerInRange(value, 0.0, 127.0)) {
                            validationError = "cc must be an integer 0-127";
                        } else {
                            MidiControlAddress address =
                                slot.config.analogInput->sceneBlend.value_or(MidiControlAddress{});
                            address.cc = static_cast<std::uint8_t>(value);
                            slot.config.analogInput->sceneBlend = address;
                            fieldValid = true;
                        }
                    }
                }
                ++ix;
            });
            break;
        }
        case MidiConfigSection::SystemMessages: {
            if (rowIx < slot.config.systemMessages.size()) {
                found = true;
                MidiControllerSystemMessageAssociation& association = slot.config.systemMessages[rowIx];
                switch (field) {
                    case Field::Channel:
                        // Shared by generic/MfTwister rows (plain
                        // control-address addressing) and WRLD.Bldr rows
                        // (issue #10: chan/x/y) -- both carry a `control`
                        // with a channel. Writes ONLY control->channel; for
                        // a WRLD.Bldr row, control->cc and wrldBldrPosition
                        // stay untouched here (only the WrldBldrX/Y cases
                        // below touch those, keeping position+cc paired).
                        if (!association.control.has_value()) {
                            break;
                        }
                        if (!IsIntegerInRange(value, 0.0, 15.0)) {
                            validationError = "channel must be an integer 0-15";
                            break;
                        }
                        association.control->channel = static_cast<std::uint8_t>(value);
                        // control->channel is authoritative, but WrldBldr rows
                        // also carry the channel on wrldBldrPosition (used by
                        // the address label and the X/Y repack). Keep the two
                        // coherent so a channel edit survives a later X/Y edit
                        // and the label never shows a stale channel.
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
                        // WrldBldrPositionToCC packs x/y into a 7-bit CC as
                        // y*8+x, so both coordinates must stay within 0-7 for
                        // the packed value to round-trip (finding 3).
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
                        // control->channel is authoritative for the channel (a
                        // prior Channel edit may have changed it without touching
                        // the position). Preserve it here rather than pulling a
                        // possibly-stale channel off the position.
                        const std::uint8_t channel =
                            association.control.has_value() ? association.control->channel : candidate.channel;
                        candidate.channel = channel;
                        association.wrldBldrPosition = candidate;
                        // Finding 2: keep the paired control address (what
                        // the input processor actually matches on) coherent
                        // with the position the UI displays.
                        association.control =
                            MidiControlAddress{.channel = channel,
                                               .cc = WrldBldrPositionToCC(candidate.x, candidate.y)};
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
            }
            break;
        }
    }

    if (!found) {
        if (reason != nullptr) {
            *reason = "row index out of range";
        }
        return false;
    }
    if (!fieldValid) {
        if (reason != nullptr) {
            *reason = !validationError.empty() ? validationError : "field is not editable on this row";
        }
        return false;
    }

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

} // namespace synth
