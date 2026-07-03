#include "synth/MidiConfigViewModel.hpp"

#include <sstream>

namespace synth {

namespace {

using Field = MidiMappingRowVM::Field;

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
        case MessageIn::Type::ToggleShift:
            oss << "toggle shift";
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
    if (!address.has_value()) {
        return "scene blend: (unassigned)";
    }
    std::ostringstream oss;
    oss << "scene blend ch" << static_cast<int>(address->channel) << " cc" << static_cast<int>(address->cc);
    return oss.str();
}

std::string SystemMessageAddressLabel(const MidiControllerSystemMessageAssociation& association,
                                      MidiProfileKind kind) {
    std::ostringstream oss;
    if (kind == MidiProfileKind::Launchpad && association.launchpadPosition.has_value()) {
        oss << "pad (" << association.launchpadPosition->x << "," << association.launchpadPosition->y << ")";
    } else if (kind == MidiProfileKind::WrldBldr && association.wrldBldrPosition.has_value()) {
        oss << "pos ch" << static_cast<int>(association.wrldBldrPosition->channel) << " ("
            << static_cast<int>(association.wrldBldrPosition->x) << "," << static_cast<int>(association.wrldBldrPosition->y)
            << ")";
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
                } else if (ref.isRelativeMode) {
                    row.editableFields = {Field::RelativeMode};
                } else if (ref.isTurnStep) {
                    row.editableFields = {Field::TurnStep};
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
                } else if (ref.isSceneBlend) {
                    row.editableFields = {Field::SceneBlend};
                }
                rows.push_back(std::move(row));
            });
            break;
        }
        case MidiConfigSection::SystemMessages: {
            for (const MidiControllerSystemMessageAssociation& association : slot.config.systemMessages) {
                MidiMappingRowVM row;
                row.label = SystemMessageLabel(association, slot.kind);
                if (slot.kind == MidiProfileKind::Launchpad) {
                    row.editableFields = {Field::LaunchpadX, Field::LaunchpadY, Field::PressMessage,
                                          Field::ReleaseMessage};
                } else if (slot.kind == MidiProfileKind::WrldBldr) {
                    row.editableFields = {Field::WrldBldrX, Field::WrldBldrY, Field::PressMessage,
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

bool MidiConfigViewModel::ApplyMappingEdit(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                           MidiMappingRowVM::Field field, double value, MidiInstrumentConfig& out,
                                           std::string* reason) const {
    if (controllerIx >= instrument_.controllers.size()) {
        if (reason != nullptr) {
            *reason = "controller index out of range";
        }
        return false;
    }

    MidiInstrumentConfig scratch = instrument_;
    MidiControllerSlot& slot = scratch.controllers[controllerIx];

    bool found = false;
    bool fieldValid = false;

    auto applyEncoderMapping = [&](EncoderMidiMapping& mapping) {
        switch (field) {
            case Field::Channel:
                mapping.control.channel = static_cast<std::uint8_t>(value);
                fieldValid = true;
                break;
            case Field::Cc:
                mapping.control.cc = static_cast<std::uint8_t>(value);
                fieldValid = true;
                break;
            case Field::SlotIx:
                mapping.slotIx = static_cast<std::size_t>(value);
                fieldValid = true;
                break;
            case Field::Position:
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
                        slot.config.encoderInput->relativeMode =
                            value != 0.0 ? EncoderRelativeMode::DirectionOnly : EncoderRelativeMode::Signed7Bit;
                        fieldValid = true;
                    } else if (ref.isTurnStep && field == Field::TurnStep) {
                        slot.config.encoderInput->turnStep = static_cast<float>(value);
                        fieldValid = true;
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
                                ref.mapping->control.channel = static_cast<std::uint8_t>(value);
                                fieldValid = true;
                                break;
                            case Field::Cc:
                                ref.mapping->control.cc = static_cast<std::uint8_t>(value);
                                fieldValid = true;
                                break;
                            case Field::GestureIx:
                                ref.mapping->gestureIx = static_cast<std::size_t>(value);
                                fieldValid = true;
                                break;
                            default:
                                break;
                        }
                    } else if (ref.isSceneBlend && field == Field::SceneBlend) {
                        MidiControlAddress address = slot.config.analogInput->sceneBlend.value_or(MidiControlAddress{});
                        address.cc = static_cast<std::uint8_t>(value);
                        slot.config.analogInput->sceneBlend = address;
                        fieldValid = true;
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
                        if (association.control.has_value()) {
                            association.control->channel = static_cast<std::uint8_t>(value);
                            fieldValid = true;
                        }
                        break;
                    case Field::Cc:
                        if (association.control.has_value()) {
                            association.control->cc = static_cast<std::uint8_t>(value);
                            fieldValid = true;
                        }
                        break;
                    case Field::LaunchpadX:
                        if (association.launchpadPosition.has_value()) {
                            association.launchpadPosition->x = static_cast<int>(value);
                            fieldValid = true;
                        }
                        break;
                    case Field::LaunchpadY:
                        if (association.launchpadPosition.has_value()) {
                            association.launchpadPosition->y = static_cast<int>(value);
                            fieldValid = true;
                        }
                        break;
                    case Field::WrldBldrX:
                        if (association.wrldBldrPosition.has_value()) {
                            association.wrldBldrPosition->x = static_cast<std::uint8_t>(value);
                            fieldValid = true;
                        }
                        break;
                    case Field::WrldBldrY:
                        if (association.wrldBldrPosition.has_value()) {
                            association.wrldBldrPosition->y = static_cast<std::uint8_t>(value);
                            fieldValid = true;
                        }
                        break;
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
            *reason = "field is not editable on this row";
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
