#pragma once

// JUCE-free Controllers page presentation and action layer (OpenSpec tasks
// 5.1–5.3). Derives a semantic tree from MidiConfigViewModel and MIDI
// connection state; routes every user action through existing view-model APIs
// and commits accepted edits through a host-provided callback (typically
// engine.EditInstrument).

#include "synth/MidiConfigViewModel.hpp"
#include "synth/ControllerWizard.hpp"
#include "synth/MidiReconcile.hpp"
#include "synth/PortableUI.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <variant>

namespace synth::runtime_ui {

inline constexpr const char* kEndpointNoneOptionId = "none";
inline constexpr const char* kEndpointOfflineOptionId = "keep_offline";

namespace NodeIds {

inline constexpr const char* kRoot = "runtime.controllers.root";
inline constexpr const char* kBack = "runtime.controllers.back";
inline constexpr const char* kStatus = "runtime.controllers.status";
inline constexpr const char* kScroll = "runtime.controllers.scroll";
inline constexpr const char* kAddRow = "runtime.controllers.add_row";
inline constexpr const char* kAddName = "runtime.controllers.add_name";
inline constexpr const char* kAddKind = "runtime.controllers.add_kind";
inline constexpr const char* kAddButton = "runtime.controllers.add_button";
inline constexpr const char* kAvailable = "runtime.controllers.available";
inline constexpr const char* kAvailableEmpty = "runtime.controllers.available.empty";
inline constexpr const char* kAvailableUnmatchedInputs = "runtime.controllers.available.unmatched_inputs";
inline constexpr const char* kAvailableUnmatchedOutputs = "runtime.controllers.available.unmatched_outputs";
inline constexpr const char* kWizardLaunch = "runtime.controllers.wizard.launch";
inline constexpr const char* kWizardChooser = "runtime.controllers.wizard.chooser";
inline constexpr const char* kWizardChooserEmpty = "runtime.controllers.wizard.chooser.empty";
inline constexpr const char* kWizardForm = "runtime.controllers.wizard.form";
inline constexpr const char* kWizardBack = "runtime.controllers.wizard.back";
inline constexpr const char* kWizardCancel = "runtime.controllers.wizard.cancel";
inline constexpr const char* kWizardSubmit = "runtime.controllers.wizard.submit";
inline constexpr const char* kWizardIgnore = "runtime.controllers.wizard.ignore";
inline constexpr const char* kWizardWarning = "runtime.controllers.wizard.warning";
inline constexpr const char* kWizardStatus = "runtime.controllers.wizard.status";

inline std::string WizardCandidateToken(const WizardCandidate& candidate)
{
    const auto hex = [](std::string_view value) {
        static constexpr char kHex[] = "0123456789abcdef";
        std::string encoded;
        encoded.reserve(value.size() * 2);
        for (unsigned char byte : value)
        {
            encoded += kHex[byte >> 4U];
            encoded += kHex[byte & 0x0fU];
        }
        return encoded;
    };
    return hex(candidate.wizardId) + "_" + hex(candidate.displayName) + "_" +
           std::to_string(static_cast<int>(candidate.kind)) + "_" +
           hex(candidate.input.identifier) + "_" + hex(candidate.input.name) +
           "_" + hex(candidate.output.identifier) + "_" +
           hex(candidate.output.name);
}

inline std::optional<WizardCandidate> WizardCandidateFromToken(
    std::string_view token)
{
    std::vector<std::string_view> parts;
    while (true)
    {
        const std::size_t delimiter = token.find('_');
        parts.push_back(token.substr(0, delimiter));
        if (delimiter == std::string_view::npos)
        {
            break;
        }
        token.remove_prefix(delimiter + 1);
    }
    if (parts.size() != 7)
    {
        return std::nullopt;
    }

    const auto unhex = [](std::string_view value)
        -> std::optional<std::string> {
        if (value.size() % 2 != 0)
        {
            return std::nullopt;
        }
        const auto nibble = [](char character) -> std::optional<unsigned char> {
            if (character >= '0' && character <= '9')
            {
                return static_cast<unsigned char>(character - '0');
            }
            if (character >= 'a' && character <= 'f')
            {
                return static_cast<unsigned char>(character - 'a' + 10);
            }
            return std::nullopt;
        };
        std::string decoded;
        decoded.reserve(value.size() / 2);
        for (std::size_t ix = 0; ix < value.size(); ix += 2)
        {
            const std::optional<unsigned char> high = nibble(value[ix]);
            const std::optional<unsigned char> low = nibble(value[ix + 1]);
            if (!high.has_value() || !low.has_value())
            {
                return std::nullopt;
            }
            decoded.push_back(static_cast<char>((*high << 4U) | *low));
        }
        return decoded;
    };

    MidiProfileKind kind;
    if (parts[2] == "0")
    {
        kind = MidiProfileKind::WrldBldr;
    }
    else if (parts[2] == "1")
    {
        kind = MidiProfileKind::MfTwister;
    }
    else if (parts[2] == "2")
    {
        kind = MidiProfileKind::Launchpad;
    }
    else if (parts[2] == "3")
    {
        kind = MidiProfileKind::Generic;
    }
    else
    {
        return std::nullopt;
    }

    const std::optional<std::string> wizardId = unhex(parts[0]);
    const std::optional<std::string> displayName = unhex(parts[1]);
    const std::optional<std::string> inputIdentifier = unhex(parts[3]);
    const std::optional<std::string> inputName = unhex(parts[4]);
    const std::optional<std::string> outputIdentifier = unhex(parts[5]);
    const std::optional<std::string> outputName = unhex(parts[6]);
    if (!wizardId.has_value() || !displayName.has_value() ||
        !inputIdentifier.has_value() || !inputName.has_value() ||
        !outputIdentifier.has_value() || !outputName.has_value())
    {
        return std::nullopt;
    }
    return WizardCandidate{.wizardId = *wizardId,
                           .displayName = *displayName,
                           .kind = kind,
                           .input = {.identifier = *inputIdentifier,
                                     .name = *inputName},
                           .output = {.identifier = *outputIdentifier,
                                      .name = *outputName}};
}

inline std::string WizardChooserCandidate(const WizardCandidate& candidate)
{
    return std::string(kWizardChooser) + ".candidate." + WizardCandidateToken(candidate);
}

inline std::string AvailableRow(std::size_t candidateIx)
{
    return "runtime.controllers.available." + std::to_string(candidateIx);
}

inline std::string AvailableConfigure(std::size_t candidateIx)
{
    return AvailableRow(candidateIx) + ".configure";
}

inline std::string AvailableIgnore(std::size_t candidateIx)
{
    return AvailableRow(candidateIx) + ".ignore";
}

inline std::string ControllerRow(std::size_t controllerIx)
{
    return "runtime.controllers.row." + std::to_string(controllerIx);
}

inline std::string ControllerActionToken(std::size_t controllerIx,
                                         std::string_view name)
{
    static constexpr char kHex[] = "0123456789abcdef";
    std::string encoded;
    encoded.reserve(name.size() * 2 + 24);
    encoded = std::to_string(controllerIx);
    encoded += ':';
    for (unsigned char byte : name)
    {
        encoded += kHex[byte >> 4U];
        encoded += kHex[byte & 0x0fU];
    }
    return encoded;
}

inline std::optional<std::pair<std::size_t, std::string>>
ControllerActionIdentityFromToken(std::string_view token)
{
    const std::size_t delimiter = token.find(':');
    if (delimiter == std::string_view::npos)
    {
        return std::nullopt;
    }
    std::size_t controllerIx = 0;
    const char* const begin = token.data();
    const char* const end = begin + delimiter;
    const auto [parsedEnd, error] = std::from_chars(begin, end, controllerIx);
    if (error != std::errc{} || parsedEnd != end)
    {
        return std::nullopt;
    }
    const std::string_view encodedName = token.substr(delimiter + 1);
    if (encodedName.size() % 2 != 0)
    {
        return std::nullopt;
    }
    const auto nibble = [](char character) -> std::optional<unsigned char> {
        if (character >= '0' && character <= '9')
        {
            return static_cast<unsigned char>(character - '0');
        }
        if (character >= 'a' && character <= 'f')
        {
            return static_cast<unsigned char>(character - 'a' + 10);
        }
        return std::nullopt;
    };
    std::string name;
    name.reserve(encodedName.size() / 2);
    for (std::size_t ix = 0; ix < encodedName.size(); ix += 2)
    {
        const std::optional<unsigned char> high = nibble(encodedName[ix]);
        const std::optional<unsigned char> low = nibble(encodedName[ix + 1]);
        if (!high.has_value() || !low.has_value())
        {
            return std::nullopt;
        }
        name.push_back(static_cast<char>((*high << 4U) | *low));
    }
    return std::pair{controllerIx, std::move(name)};
}

inline std::string ControllerDisclosure(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".disclosure";
}

inline std::string ControllerName(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".name";
}

inline std::string ControllerKind(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".kind";
}

inline std::string ControllerBadge(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".badge";
}

inline std::string ControllerRename(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".rename";
}

inline std::string ControllerRenameDraft(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".rename_draft";
}

inline std::string ControllerDelete(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".delete";
}

inline std::string ControllerBlacklist(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".blacklist";
}

inline std::string ControllerReconfigure(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".reconfigure";
}

inline std::string ControllerConfigure(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".configure";
}

inline std::string ControllerRemoveBlacklist(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".remove_blacklist";
}

inline std::string ControllerInputLabel(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".input_label";
}

inline std::string ControllerOutputLabel(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".output_label";
}

inline std::string ControllerVariant(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".variant";
}

inline std::string ControllerInput(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".input";
}

inline std::string ControllerOutput(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".output";
}

inline std::string ControllerStatusDots(std::size_t controllerIx)
{
    return ControllerRow(controllerIx) + ".status_dots";
}

inline std::string SectionToggle(std::size_t controllerIx, MidiConfigSection section)
{
    return ControllerRow(controllerIx) + ".section." + std::to_string(static_cast<int>(section)) + ".toggle";
}

inline std::string SectionBody(std::size_t controllerIx, MidiConfigSection section)
{
    return ControllerRow(controllerIx) + ".section." + std::to_string(static_cast<int>(section)) + ".body";
}

inline std::string GroupHeader(std::size_t controllerIx, MidiConfigSection section, std::size_t headerIx)
{
    return SectionBody(controllerIx, section) + ".header." + std::to_string(headerIx);
}

inline std::string GroupColumnLabel(std::size_t controllerIx, MidiConfigSection section, std::size_t headerIx,
                                    std::size_t fieldIx)
{
    return GroupHeader(controllerIx, section, headerIx) + ".column." + std::to_string(fieldIx);
}

inline std::string MappingRow(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx)
{
    return SectionBody(controllerIx, section) + ".mapping." + std::to_string(rowIx);
}

inline std::string MappingField(std::size_t controllerIx,
                              MidiConfigSection section,
                              std::size_t rowIx,
                              MidiMappingRowVM::Field field)
{
    return MappingRow(controllerIx, section, rowIx) + ".field." +
           std::to_string(static_cast<int>(field));
}

inline std::string MappingDelete(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx)
{
    return MappingRow(controllerIx, section, rowIx) + ".delete";
}

inline std::string GroupAddSingle(std::size_t controllerIx, MidiConfigSection section, std::size_t headerIx)
{
    return GroupHeader(controllerIx, section, headerIx) + ".add_single";
}

inline std::string GroupAddBlock(std::size_t controllerIx, MidiConfigSection section, std::size_t headerIx)
{
    return GroupHeader(controllerIx, section, headerIx) + ".add_block";
}

}  // namespace NodeIds

namespace Actions {

inline constexpr const char* kBack = "runtime.controllers.back";
inline constexpr const char* kToggleConfig = "runtime.controllers.toggle_config";
inline constexpr const char* kToggleSection = "runtime.controllers.toggle_section";
inline constexpr const char* kEndpointSelect = "runtime.controllers.endpoint_select";
inline constexpr const char* kVariantSelect = "runtime.controllers.variant_select";
inline constexpr const char* kMappingFieldCommit = "runtime.controllers.mapping_field_commit";
inline constexpr const char* kDeleteRow = "runtime.controllers.delete_row";
inline constexpr const char* kAddSingle = "runtime.controllers.add_single";
inline constexpr const char* kAddBlock = "runtime.controllers.add_block";
inline constexpr const char* kAddNameDraft = "runtime.controllers.add_name_draft";
inline constexpr const char* kAddKindDraft = "runtime.controllers.add_kind_draft";
inline constexpr const char* kAddController = "runtime.controllers.add_controller";
inline constexpr const char* kAvailableConfigure = "runtime.controllers.available.configure";
inline constexpr const char* kAvailableIgnore = "runtime.controllers.available.ignore";
inline constexpr const char* kWizardOpen = "runtime.controllers.wizard.open";
inline constexpr const char* kWizardChoose = "runtime.controllers.wizard.choose";
inline constexpr const char* kWizardBack = "runtime.controllers.wizard.back";
inline constexpr const char* kWizardCancel = "runtime.controllers.wizard.cancel";
inline constexpr const char* kWizardSubmit = "runtime.controllers.wizard.submit";
inline constexpr const char* kWizardIgnore = "runtime.controllers.wizard.ignore";
inline constexpr const char* kControllerRename = "runtime.controllers.controller.rename";
inline constexpr const char* kControllerRenameDraft = "runtime.controllers.controller.rename_draft";
inline constexpr const char* kControllerDelete = "runtime.controllers.controller.delete";
inline constexpr const char* kControllerBlacklist = "runtime.controllers.controller.blacklist";
inline constexpr const char* kControllerRemoveBlacklist = "runtime.controllers.controller.remove_blacklist";
inline constexpr const char* kControllerConfigure = "runtime.controllers.controller.configure";
inline constexpr const char* kControllerReconfigure = "runtime.controllers.controller.reconfigure";

}  // namespace Actions

namespace ControllersLayout {

inline constexpr float kPageMargin = 4.0f;
inline constexpr float kBackRowHeight = 32.0f;
inline constexpr float kBackButtonWidth = 80.0f;
inline constexpr float kWizardIgnoreWidth = 160.0f;
inline constexpr float kRowGap = 6.0f;
inline constexpr float kStatusRowHeight = 24.0f;
inline constexpr float kControllerHeaderHeight = 36.0f;
inline constexpr float kSectionHeaderHeight = 28.0f;
inline constexpr float kMappingRowHeight = 30.0f;
inline constexpr float kGroupHeaderHeight = 42.0f;
inline constexpr float kAddRowHeight = 40.0f;
inline constexpr float kBaseEditorWidth = 90.0f;
inline constexpr float kDeleteButtonWidth = 22.0f;
inline constexpr float kAddButtonWidth = 62.0f;
inline constexpr float kVariantBoxWidth = 140.0f;
inline constexpr float kStatusDotsWidth = 32.0f;
inline constexpr float kHeaderControlsX = 256.0f;
inline constexpr float kEndpointBoxWidth = 160.0f;
inline constexpr float kEndpointBoxGap = 8.0f;
inline constexpr float kControllerNameWidth = 120.0f;
inline constexpr float kControllerKindWidth = 100.0f;
inline constexpr float kControllerIdentityGap = 4.0f;
inline constexpr float kControllerDisclosureWidth = 24.0f;
inline constexpr float kLifecycleDraftWidth = 120.0f;
inline constexpr float kLifecycleRenameWidth = 72.0f;
inline constexpr float kLifecycleDeleteWidth = 66.0f;
inline constexpr float kLifecycleReconfigureWidth = 94.0f;
inline constexpr float kLifecycleBlacklistWidth = 78.0f;
inline constexpr float kLifecycleConfigureWidth = 86.0f;
inline constexpr float kLifecycleRemoveWidth = 72.0f;
inline constexpr float kLifecycleControlGap = 4.0f;
inline constexpr float kActiveLifecycleWidth =
    kLifecycleDraftWidth + kLifecycleControlGap + kLifecycleRenameWidth +
    kLifecycleControlGap + kLifecycleDeleteWidth + kLifecycleControlGap +
    kLifecycleReconfigureWidth + kLifecycleControlGap + kLifecycleBlacklistWidth;
inline constexpr float kBlacklistedEndpointLabelWidth = 240.0f;
inline constexpr float kBlacklistedBadgeWidth = 84.0f;
inline constexpr float kBlacklistedLifecycleWidth =
    kLifecycleDraftWidth + kLifecycleControlGap + kLifecycleRenameWidth +
    kLifecycleControlGap + kLifecycleConfigureWidth + kLifecycleControlGap +
    kLifecycleRemoveWidth;
inline constexpr float kActiveControllerHeaderWidth =
    kHeaderControlsX + kStatusDotsWidth + kLifecycleControlGap + kEndpointBoxWidth +
    kEndpointBoxGap + kEndpointBoxWidth + kEndpointBoxGap + kVariantBoxWidth +
    kEndpointBoxGap + kActiveLifecycleWidth;
inline constexpr float kBlacklistedControllerHeaderWidth =
    kControllerNameWidth + kLifecycleControlGap + kControllerKindWidth +
    kLifecycleControlGap + kBlacklistedBadgeWidth + kLifecycleControlGap +
    kBlacklistedEndpointLabelWidth + kLifecycleControlGap +
    kBlacklistedEndpointLabelWidth + kLifecycleControlGap +
    kBlacklistedLifecycleWidth;
inline constexpr float kControllerHeaderMinWidth =
    std::max(kActiveControllerHeaderWidth, kBlacklistedControllerHeaderWidth);
inline constexpr float kSectionMaxHeight = 220.0f;
inline constexpr float kSectionPadding = 8.0f;

inline int FieldEditorWidth(MidiMappingRowVM::Field field)
{
    using Field = MidiMappingRowVM::Field;
    switch (field)
    {
        case Field::MessageKind:
            return 150;
        case Field::MessageArg:
            return 74;
        case Field::EncoderMode:
        case Field::BlockMessageType:
            return 132;
        case Field::AddressType:
            return 90;
        case Field::TurnStep:
            return 74;
        case Field::Channel:
        case Field::Cc:
        case Field::SlotIx:
        case Field::Position:
        case Field::LaunchpadX:
        case Field::LaunchpadY:
        case Field::WrldBldrX:
        case Field::WrldBldrY:
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
        case Field::GridSlotIx:
        case Field::GridXMin:
        case Field::GridXMax:
        case Field::GridYMin:
        case Field::GridYMax:
            return 58;
        case Field::GestureIx:
            return 72;
        case Field::SceneBlend:
            return 84;
        case Field::BlockRowMajor:
        case Field::BlockOutputFeedback:
            return 82;
        default:
            return static_cast<int>(kBaseEditorWidth);
    }
}

inline std::string FormatFieldValue(MidiMappingRowVM::Field field, double value)
{
    if (FieldIsInteger(field))
    {
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(std::llround(value)));
        return buffer;
    }
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.4f", value);
    return buffer;
}

inline const char* SectionName(MidiConfigSection section)
{
    switch (section)
    {
        case MidiConfigSection::Encoders:
            return "Encoders";
        case MidiConfigSection::SystemMessages:
            return "System Messages";
        case MidiConfigSection::Analogs:
            return "Analogs";
    }
    return "";
}

inline const char* RowGroupCaption(MidiMappingRowVM::RowGroup group,
                                   MidiMappingRowVM::Kind kind = MidiMappingRowVM::Kind::Individual)
{
    switch (group)
    {
        case MidiMappingRowVM::RowGroup::EncoderTurn:
            return "Turn";
        case MidiMappingRowVM::RowGroup::EncoderPush:
            return "Push";
        case MidiMappingRowVM::RowGroup::EncoderMode:
            return "Mode";
        case MidiMappingRowVM::RowGroup::EncoderStep:
            return "Step (relative modes only)";
        case MidiMappingRowVM::RowGroup::AnalogGesture:
            return "Gestures";
        case MidiMappingRowVM::RowGroup::AnalogSceneBlend:
            return "Scene blend";
        case MidiMappingRowVM::RowGroup::System:
            return "System";
        case MidiMappingRowVM::RowGroup::Grid:
            return kind == MidiMappingRowVM::Kind::Block ? "Grid Block" : "Grid Button";
    }
    return "";
}

inline std::string RowGroupToken(MidiMappingRowVM::RowGroup group)
{
    switch (group)
    {
        case MidiMappingRowVM::RowGroup::EncoderTurn:
            return "encoder_turn";
        case MidiMappingRowVM::RowGroup::EncoderPush:
            return "encoder_push";
        case MidiMappingRowVM::RowGroup::EncoderMode:
            return "encoder_mode";
        case MidiMappingRowVM::RowGroup::EncoderStep:
            return "encoder_step";
        case MidiMappingRowVM::RowGroup::AnalogGesture:
            return "analog_gesture";
        case MidiMappingRowVM::RowGroup::AnalogSceneBlend:
            return "analog_scene_blend";
        case MidiMappingRowVM::RowGroup::System:
            return "system";
        case MidiMappingRowVM::RowGroup::Grid:
            return "grid";
    }
    return "unknown";
}

inline std::optional<MidiMappingRowVM::RowGroup> ParseRowGroupToken(const std::string& token)
{
    if (token == "encoder_turn")
    {
        return MidiMappingRowVM::RowGroup::EncoderTurn;
    }
    if (token == "encoder_push")
    {
        return MidiMappingRowVM::RowGroup::EncoderPush;
    }
    if (token == "encoder_mode")
    {
        return MidiMappingRowVM::RowGroup::EncoderMode;
    }
    if (token == "encoder_step")
    {
        return MidiMappingRowVM::RowGroup::EncoderStep;
    }
    if (token == "analog_gesture")
    {
        return MidiMappingRowVM::RowGroup::AnalogGesture;
    }
    if (token == "analog_scene_blend")
    {
        return MidiMappingRowVM::RowGroup::AnalogSceneBlend;
    }
    if (token == "system")
    {
        return MidiMappingRowVM::RowGroup::System;
    }
    if (token == "grid")
    {
        return MidiMappingRowVM::RowGroup::Grid;
    }
    return std::nullopt;
}

inline std::string SectionToken(MidiConfigSection section)
{
    switch (section)
    {
        case MidiConfigSection::Encoders:
            return "encoders";
        case MidiConfigSection::SystemMessages:
            return "system_messages";
        case MidiConfigSection::Analogs:
            return "analogs";
    }
    return "unknown";
}

inline std::optional<MidiConfigSection> ParseSectionToken(const std::string& token)
{
    if (token == "encoders")
    {
        return MidiConfigSection::Encoders;
    }
    if (token == "system_messages")
    {
        return MidiConfigSection::SystemMessages;
    }
    if (token == "analogs")
    {
        return MidiConfigSection::Analogs;
    }
    return std::nullopt;
}

inline std::string FieldToken(MidiMappingRowVM::Field field)
{
    return std::to_string(static_cast<int>(field));
}

inline std::optional<MidiMappingRowVM::Field> ParseFieldToken(const std::string& token)
{
    try
    {
        const int value = std::stoi(token);
        return static_cast<MidiMappingRowVM::Field>(value);
    }
    catch (...)
    {
        return std::nullopt;
    }
}

inline Color EndpointStatusColor(MidiEndpointStatus status)
{
    switch (status)
    {
        case MidiEndpointStatus::Online:
            return Color::Rgb(50, 205, 50);
        case MidiEndpointStatus::Offline:
            return Color::Rgb(220, 20, 60);
        case MidiEndpointStatus::Unconfigured:
            break;
    }
    return Color::Rgb(128, 128, 128);
}

// Stored endpoint identity, independent of connection status, so a
// deliberately inert Blacklisted record still shows which endpoints it holds.
inline std::string StoredEndpointLabel(const MidiEndpointRef& ref)
{
    if (!ref.IsConfigured())
    {
        return "(none)";
    }
    if (ref.name.empty())
    {
        return ref.identifier;
    }
    if (ref.identifier.empty())
    {
        return ref.name;
    }
    return ref.name + " (" + ref.identifier + ")";
}

inline std::vector<ui::ControlOption> BuildEndpointOptions(const std::vector<MidiDeviceInfoRef>& devices,
                                                           MidiEndpointStatus status,
                                                           const MidiEndpointRef& stored,
                                                           const std::string& storedLabel,
                                                           std::string& selectedOptionId)
{
    std::vector<ui::ControlOption> options;
    options.push_back({kEndpointNoneOptionId, "(none)"});
    selectedOptionId = kEndpointNoneOptionId;

    // Follow reconciliation identity semantics: the exact stored identifier
    // wins, and the stored name is only a fallback. Duplicate same-name units
    // are otherwise indistinguishable in this picker.
    bool selectedByIdentifier = false;
    for (const MidiDeviceInfoRef& device : devices)
    {
        options.push_back({device.identifier, device.name});
        if (status != MidiEndpointStatus::Online)
        {
            continue;
        }
        if (!stored.identifier.empty() && device.identifier == stored.identifier)
        {
            selectedOptionId = device.identifier;
            selectedByIdentifier = true;
        }
        else if (!selectedByIdentifier && device.name == storedLabel)
        {
            selectedOptionId = device.identifier;
        }
    }

    if (status == MidiEndpointStatus::Offline)
    {
        options.push_back({kEndpointOfflineOptionId, storedLabel});
        selectedOptionId = kEndpointOfflineOptionId;
    }

    return options;
}

inline std::vector<ui::ControlOption> BuildLaunchpadVariantOptions(int selectedIndex, std::string& selectedOptionId)
{
    std::vector<ui::ControlOption> options;
    const auto& catalog = LaunchpadVariantCatalog();
    for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix)
    {
        const std::string id = std::to_string(ix);
        options.push_back({id, catalog[static_cast<std::size_t>(ix)]});
    }
    if (selectedIndex >= 0 && selectedIndex < static_cast<int>(catalog.size()))
    {
        selectedOptionId = std::to_string(selectedIndex);
    }
    else if (!options.empty())
    {
        selectedOptionId = options.front().id;
    }
    return options;
}

inline std::vector<ui::ControlOption> BuildAddControllerKindOptions()
{
    return {{"wrldbldr", "WRLD.Bldr"},
            {"mftwister", "MF Twister"},
            {"launchpad", "Launchpad"},
            {"generic", "Generic"}};
}

inline MidiProfileKind KindFromAddOptionId(const std::string& optionId)
{
    if (optionId == "mftwister")
    {
        return MidiProfileKind::MfTwister;
    }
    if (optionId == "launchpad")
    {
        return MidiProfileKind::Launchpad;
    }
    if (optionId == "generic")
    {
        return MidiProfileKind::Generic;
    }
    return MidiProfileKind::WrldBldr;
}

}  // namespace ControllersLayout

struct ControllersPageCallbacks
{
    std::function<MidiInstrumentConfig()> instrumentSnapshot;
    std::function<MidiConnectionState()> connectionState;
    std::function<MidiDeviceList()> enumerateDevices;
    std::function<bool(MidiInstrumentConfig)> commitInstrument;
    std::function<bool()> saveRuntimeConfiguration;
    std::function<void(std::string)> setStatus;
    std::function<void()> onBack;
};

struct ExistingWizardTarget {
    std::size_t index = 0;
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiEndpointRef input;
    MidiEndpointRef output;
    std::optional<std::string> wizardId;
    MidiControllerDisposition disposition = MidiControllerDisposition::Active;
};

struct WizardSession {
    std::variant<WizardCandidate, ExistingWizardTarget> target;
    std::unique_ptr<ControllerWizard> wizard;
    std::unique_ptr<ControllerConfigForm> form;
    std::string warning;
    std::string status;
};

inline bool WizardDiscoveryEqual(const WizardDiscovery& lhs, const WizardDiscovery& rhs)
{
    if (lhs.unmatchedInputs != rhs.unmatchedInputs || lhs.unmatchedOutputs != rhs.unmatchedOutputs ||
        lhs.available.size() != rhs.available.size())
    {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.available.size(); ++ix)
    {
        const WizardCandidate& left = lhs.available[ix];
        const WizardCandidate& right = rhs.available[ix];
        if (left.wizardId != right.wizardId || left.displayName != right.displayName ||
            left.kind != right.kind || left.input != right.input || left.output != right.output)
        {
            return false;
        }
    }
    return true;
}

class ControllersPageSurface final : public ui::Surface
{
public:
    explicit ControllersPageSurface(ControllersPageCallbacks callbacks)
        : m_callbacks(std::move(callbacks))
    {
        m_dirty = true;
    }

    ui::NodeTree BuildTree() override
    {
        if (m_wizardSession.has_value())
        {
            return BuildWizardFormTree();
        }
        if (m_wizardChooserOpen)
        {
            return BuildWizardChooserTree();
        }
        return BuildControllersPageTree(m_vm,
                                        m_devices,
                                        m_discovery,
                                        m_contentBounds,
                                        m_statusText,
                                        m_addControllerName,
                                        m_addControllerKindId,
                                        m_renameDrafts);
    }

    void SetActionHandler(ActionHandler handler) override
    {
        m_outerHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        HandleAction(action);
        RefreshOnTick(/*respectFocusGuard=*/false);
        ++m_treeRevision;
        if (m_outerHandler_)
        {
            m_outerHandler_(action);
        }
    }

    void SetContentBounds(ui::Bounds bounds)
    {
        if (m_contentBounds.x == bounds.x && m_contentBounds.y == bounds.y &&
            m_contentBounds.width == bounds.width && m_contentBounds.height == bounds.height)
        {
            return;
        }
        m_contentBounds = bounds;
        ++m_treeRevision;
    }

    void SetEnumerateDevices(MidiDeviceList devices)
    {
        if (m_devices == devices)
        {
            return;
        }
        m_devices = std::move(devices);
        ++m_treeRevision;
    }

    void SetDiscovery(WizardDiscovery discovery)
    {
        if (WizardDiscoveryEqual(m_discovery, discovery))
        {
            return;
        }
        m_discovery = std::move(discovery);
        ++m_treeRevision;
    }

    const WizardDiscovery& Discovery() const
    {
        return m_discovery;
    }

    const WizardSession* ActiveWizardSession() const
    {
        return m_wizardSession ? &*m_wizardSession : nullptr;
    }

    bool OpenCandidate(std::size_t candidateIx)
    {
        if (m_wizardSession || candidateIx >= m_discovery.available.size())
        {
            return false;
        }

        const WizardCandidate candidate = m_discovery.available[candidateIx];
        std::unique_ptr<ControllerWizard> wizard = MakeControllerWizard(candidate.wizardId);
        if (!wizard)
        {
            SetStatus("Refused: controller wizard is unavailable");
            return false;
        }
        std::unique_ptr<ControllerConfigForm> form = wizard->ConfigForm(std::nullopt);
        if (!form)
        {
            SetStatus("Refused: controller wizard could not open a form");
            return false;
        }

        m_wizardSession.emplace(WizardSession{.target = candidate,
                                              .wizard = std::move(wizard),
                                              .form = std::move(form)});
        m_wizardChooserOpen = false;
        ++m_treeRevision;
        return true;
    }

    bool OpenExisting(std::size_t controllerIx)
    {
        if (m_wizardSession || !m_callbacks.instrumentSnapshot)
        {
            return false;
        }
        const MidiInstrumentConfig instrument = m_callbacks.instrumentSnapshot();
        if (controllerIx >= instrument.controllers.size())
        {
            return false;
        }
        return OpenExistingFromSnapshot(instrument, controllerIx);
    }

    void MarkDirty()
    {
        m_dirty = true;
    }

    void SetFocusGuard(std::function<bool()> guard)
    {
        m_focusGuard = std::move(guard);
    }

    void RefreshOnTick()
    {
        RefreshOnTick(/*respectFocusGuard=*/true);
    }

    void RefreshOnTick(bool respectFocusGuard)
    {
        if (!m_callbacks.connectionState || !m_callbacks.instrumentSnapshot)
        {
            return;
        }

        const std::string fingerprint = ConnectionFingerprint(m_callbacks.connectionState());
        if (fingerprint != m_lastFingerprint)
        {
            m_dirty = true;
            m_lastFingerprint = fingerprint;
        }

        if (!m_dirty)
        {
            return;
        }

        if (respectFocusGuard && m_focusGuard && m_focusGuard())
        {
            return;
        }

        m_vm.Rebuild(m_callbacks.instrumentSnapshot(), m_callbacks.connectionState());
        m_dirty = false;
        ++m_treeRevision;
    }

    MidiConfigViewModel& ViewModel()
    {
        return m_vm;
    }

    const MidiConfigViewModel& ViewModel() const
    {
        return m_vm;
    }

    const std::string& StatusText() const
    {
        return m_statusText;
    }

    std::uint64_t TreeRevision() const
    {
        return m_treeRevision;
    }

    void SetAddControllerDraft(std::string name, std::string kindOptionId)
    {
        if (m_addControllerName == name && m_addControllerKindId == kindOptionId)
        {
            return;
        }
        m_addControllerName = std::move(name);
        m_addControllerKindId = std::move(kindOptionId);
        ++m_treeRevision;
    }

    bool NeedsDeferredDispatch(const ui::Action& action) const
    {
        return action.name == Actions::kBack || action.name == Actions::kToggleConfig ||
               action.name == Actions::kToggleSection ||
               action.name == Actions::kDeleteRow || action.name == Actions::kAddSingle ||
               action.name == Actions::kAddBlock || action.name == Actions::kEndpointSelect ||
               action.name == Actions::kVariantSelect || action.name == Actions::kMappingFieldCommit ||
               action.name == Actions::kAddController || action.name == Actions::kWizardOpen ||
               action.name == Actions::kAvailableConfigure ||
               action.name == Actions::kAvailableIgnore ||
               action.name == Actions::kWizardChoose ||
               action.name == Actions::kWizardBack ||
               action.name == Actions::kWizardCancel ||
               action.name == Actions::kWizardSubmit ||
               action.name == Actions::kWizardIgnore ||
               action.name == Actions::kControllerRenameDraft ||
               action.name == Actions::kControllerRename ||
               action.name == Actions::kControllerDelete ||
               action.name == Actions::kControllerBlacklist ||
               action.name == Actions::kControllerRemoveBlacklist ||
               action.name == Actions::kControllerConfigure ||
               action.name == Actions::kControllerReconfigure;
    }

private:
    bool OpenExistingFromSnapshot(const MidiInstrumentConfig& instrument,
                                  std::size_t controllerIx)
    {
        if (m_wizardSession || controllerIx >= instrument.controllers.size())
        {
            return false;
        }
        const MidiControllerSlot& controller = instrument.controllers[controllerIx];
        if (!controller.wizardId.has_value())
        {
            return false;
        }
        std::unique_ptr<ControllerWizard> wizard = MakeControllerWizard(*controller.wizardId);
        if (!wizard)
        {
            return false;
        }
        std::unique_ptr<ControllerConfigForm> form = wizard->ConfigForm(controller);
        if (!form)
        {
            return false;
        }

        const std::string warning(form->ReconfigureWarning());
        ExistingWizardTarget target{.index = controllerIx,
                                    .name = controller.name,
                                    .kind = controller.kind,
                                    .input = controller.input,
                                    .output = controller.output,
                                    .wizardId = controller.wizardId,
                                    .disposition = controller.disposition};
        m_wizardSession.emplace(WizardSession{.target = std::move(target),
                                              .wizard = std::move(wizard),
                                              .form = std::move(form),
                                              .warning = warning});
        m_wizardChooserOpen = false;
        ++m_treeRevision;
        return true;
    }

    static std::string ConnectionFingerprint(const MidiConnectionState& state)
    {
        std::string fp;
        fp.reserve(state.controllers.size() * 2 + 8);
        fp += std::to_string(state.controllers.size());
        for (const auto& controller : state.controllers)
        {
            fp += ':';
            fp += std::to_string(static_cast<int>(controller.input.status));
            fp += ',';
            fp += std::to_string(static_cast<int>(controller.output.status));
        }
        return fp;
    }

    bool Commit(MidiInstrumentConfig out)
    {
        if (!m_callbacks.commitInstrument ||
            !m_callbacks.commitInstrument(std::move(out)))
        {
            return false;
        }
        m_dirty = true;
        return true;
    }

    void SetStatus(std::string text)
    {
        if (m_statusText == text)
        {
            return;
        }
        m_statusText = std::move(text);
        ++m_treeRevision;
        if (m_callbacks.setStatus)
        {
            m_callbacks.setStatus(m_statusText);
        }
    }

    void HandleAction(const ui::Action& action)
    {
        if (m_wizardSession.has_value())
        {
            if (action.name == Actions::kWizardBack || action.name == Actions::kWizardCancel)
            {
                CloseWizardSession();
                return;
            }

            if (action.name == Actions::kWizardSubmit)
            {
                HandleWizardSubmit();
                return;
            }
            if (action.name == Actions::kWizardIgnore)
            {
                HandleWizardIgnore();
                return;
            }

            m_wizardSession->form->DispatchAction(action);
            return;
        }

        if (m_wizardChooserOpen)
        {
            if (action.name == Actions::kWizardBack || action.name == Actions::kWizardCancel)
            {
                m_wizardChooserOpen = false;
                ++m_treeRevision;
            }
            else if (action.name == Actions::kWizardChoose)
            {
                OpenChooserCandidate(action.value);
            }
            return;
        }

        if (action.name == Actions::kBack)
        {
            if (m_callbacks.onBack)
            {
                m_callbacks.onBack();
            }
            return;
        }

        if (action.name == Actions::kToggleConfig)
        {
            const std::size_t controllerIx = ParseIndex(action.value);
            m_vm.ToggleConfig(controllerIx);
            return;
        }

        if (action.name == Actions::kToggleSection)
        {
            const auto parts = Split(action.value, ':');
            if (parts.size() != 2)
            {
                return;
            }
            const std::size_t controllerIx = ParseIndex(parts[0]);
            const std::optional<MidiConfigSection> section = ControllersLayout::ParseSectionToken(parts[1]);
            if (!section.has_value())
            {
                return;
            }
            m_vm.ToggleSection(controllerIx, *section);
            return;
        }

        if (action.name == Actions::kEndpointSelect)
        {
            HandleEndpointSelect(action.value);
            return;
        }

        if (action.name == Actions::kVariantSelect)
        {
            HandleVariantSelect(action.value);
            return;
        }

        if (action.name == Actions::kMappingFieldCommit)
        {
            HandleMappingFieldCommit(action.value);
            return;
        }

        if (action.name == Actions::kDeleteRow)
        {
            HandleDeleteRow(action.value);
            return;
        }

        if (action.name == Actions::kAddSingle)
        {
            HandleAdd(action.value, /*asBlock=*/false);
            return;
        }

        if (action.name == Actions::kAddBlock)
        {
            HandleAdd(action.value, /*asBlock=*/true);
            return;
        }

        if (action.name == Actions::kAddNameDraft)
        {
            SetAddControllerDraft(action.value, m_addControllerKindId);
            return;
        }

        if (action.name == Actions::kAddKindDraft)
        {
            SetAddControllerDraft(m_addControllerName, action.value);
            return;
        }

        if (action.name == Actions::kAddController)
        {
            HandleAddController(action.value);
            return;
        }

        if (action.name == Actions::kWizardOpen)
        {
            if (m_discovery.available.size() == 1)
            {
                OpenCandidate(0);
            }
            else if (m_discovery.available.size() > 1)
            {
                m_wizardChooserOpen = true;
                ++m_treeRevision;
            }
            return;
        }

        if (action.name == Actions::kAvailableConfigure)
        {
            OpenCandidate(ParseIndex(action.value));
            return;
        }

        if (action.name == Actions::kAvailableIgnore)
        {
            const std::optional<WizardCandidate> candidate =
                NodeIds::WizardCandidateFromToken(action.value);
            if (!candidate.has_value())
            {
                SetStatus("Refused: invalid controller identity");
                return;
            }
            HandleIgnoreCandidate(*candidate, /*sessionStatus=*/false);
            return;
        }

        if (action.name == Actions::kControllerRenameDraft)
        {
            const std::size_t firstSeparator = action.value.find(':');
            const std::size_t separator = firstSeparator == std::string::npos
                ? std::string::npos
                : action.value.find(':', firstSeparator + 1);
            if (separator == std::string::npos)
            {
                SetStatus("Refused: invalid rename request");
                return;
            }
            const std::optional<std::pair<std::size_t, std::string>> identity =
                NodeIds::ControllerActionIdentityFromToken(action.value.substr(0, separator));
            if (!identity.has_value())
            {
                SetStatus("Refused: invalid controller identity");
                return;
            }
            m_renameDrafts[identity->second] = action.value.substr(separator + 1);
            ++m_treeRevision;
            return;
        }

        if (action.name == Actions::kControllerRename)
        {
            HandleRenameController(action.value);
            return;
        }

        if (action.name == Actions::kControllerDelete)
        {
            HandleDeleteController(action.value);
            return;
        }

        if (action.name == Actions::kControllerBlacklist)
        {
            HandleBlacklistController(action.value);
            return;
        }

        if (action.name == Actions::kControllerRemoveBlacklist)
        {
            HandleRemoveFromBlacklist(action.value);
            return;
        }

        if (action.name == Actions::kControllerConfigure ||
            action.name == Actions::kControllerReconfigure)
        {
            const std::optional<std::pair<std::size_t, std::string>> identity =
                NodeIds::ControllerActionIdentityFromToken(action.value);
            MidiInstrumentConfig instrument;
            if (!SnapshotForLifecycleIdentity(identity, instrument))
            {
                return;
            }
            OpenExistingFromSnapshot(instrument, identity->first);
        }
    }

    static bool CandidateIdentityEqual(const WizardCandidate& lhs,
                                       const WizardCandidate& rhs)
    {
        return lhs.wizardId == rhs.wizardId &&
               lhs.displayName == rhs.displayName &&
               lhs.kind == rhs.kind &&
               lhs.input == rhs.input &&
               lhs.output == rhs.output;
    }

    static bool ExactEndpointPresent(const std::vector<MidiDeviceInfoRef>& devices,
                                     const MidiDeviceInfoRef& endpoint)
    {
        return std::find(devices.begin(), devices.end(), endpoint) != devices.end();
    }

    static std::string AvailableControllerName(const MidiInstrumentConfig& instrument,
                                               const std::string& displayName)
    {
        if (instrument.FindController(displayName) == nullptr)
        {
            return displayName;
        }
        for (std::size_t suffix = 2;; ++suffix)
        {
            const std::string candidate =
                displayName + " " + std::to_string(suffix);
            if (instrument.FindController(candidate) == nullptr)
            {
                return candidate;
            }
        }
    }

    void SetWizardStatus(std::string text)
    {
        if (!m_wizardSession.has_value() ||
            m_wizardSession->status == text)
        {
            return;
        }
        m_wizardSession->status = std::move(text);
        ++m_treeRevision;
        if (m_callbacks.setStatus)
        {
            m_callbacks.setStatus(m_wizardSession->status);
        }
    }

    bool RevalidateCandidate(const WizardCandidate& expected,
                             MidiInstrumentConfig& instrument,
                             MidiDeviceList& devices,
                             bool sessionStatus)
    {
        const auto report = [&](std::string text) {
            if (sessionStatus)
            {
                SetWizardStatus(std::move(text));
            }
            else
            {
                SetStatus(std::move(text));
            }
        };
        if (!m_callbacks.instrumentSnapshot || !m_callbacks.enumerateDevices)
        {
            report("Refused: current controller state is unavailable");
            return false;
        }

        devices = m_callbacks.enumerateDevices();
        instrument = m_callbacks.instrumentSnapshot();
        const WizardDiscovery current = DiscoverControllerWizards(
            devices, instrument, ControllerWizardRegistry());
        const auto match = std::find_if(
            current.available.begin(), current.available.end(),
            [&](const WizardCandidate& candidate) {
                return CandidateIdentityEqual(candidate, expected);
            });
        if (match != current.available.end())
        {
            return true;
        }

        const bool endpointsPresent =
            ExactEndpointPresent(devices.inputs, expected.input) &&
            ExactEndpointPresent(devices.outputs, expected.output);
        report(
            endpointsPresent
                ? "Refused: this controller is no longer available or its endpoints are claimed"
                : "Refused: reconnect both controller endpoints and try again");
        return false;
    }

    void RefreshDiscoveryFromCallbacks()
    {
        if (!m_callbacks.instrumentSnapshot || !m_callbacks.enumerateDevices)
        {
            return;
        }
        MidiDeviceList devices = m_callbacks.enumerateDevices();
        MidiInstrumentConfig instrument = m_callbacks.instrumentSnapshot();
        SetEnumerateDevices(devices);
        SetDiscovery(DiscoverControllerWizards(
            devices, instrument, ControllerWizardRegistry()));
    }

    bool SaveCommittedWizardAction(bool sessionStatus)
    {
        if (!m_callbacks.saveRuntimeConfiguration ||
            !m_callbacks.saveRuntimeConfiguration())
        {
            if (sessionStatus)
            {
                SetWizardStatus(
                    "The controller was committed, but runtime configuration save failed");
            }
            else
            {
                SetStatus(
                    "The controller was committed, but runtime configuration save failed");
            }
            return false;
        }
        return true;
    }

    bool CommitNewCandidate(MidiInstrumentConfig instrument,
                            MidiControllerSlot controller,
                            bool sessionStatus)
    {
        if (!instrument.AddController(std::move(controller)))
        {
            if (sessionStatus)
            {
                SetWizardStatus("Refused: generated controller record is invalid");
            }
            else
            {
                SetStatus("Refused: generated controller record is invalid");
            }
            return false;
        }
        if (!Commit(std::move(instrument)))
        {
            if (sessionStatus)
            {
                SetWizardStatus("Refused: host rejected the instrument commit");
            }
            else
            {
                SetStatus("Refused: host rejected the instrument commit");
            }
            return false;
        }

        RefreshDiscoveryFromCallbacks();
        return SaveCommittedWizardAction(sessionStatus);
    }

    bool SnapshotForLifecycleIdentity(
        const std::optional<std::pair<std::size_t, std::string>>& identity,
        MidiInstrumentConfig& instrument)
    {
        if (!identity.has_value() || !m_callbacks.instrumentSnapshot)
        {
            SetStatus("Refused: invalid controller identity");
            return false;
        }
        instrument = m_callbacks.instrumentSnapshot();
        if (identity->first >= instrument.controllers.size() ||
            instrument.controllers[identity->first].name != identity->second)
        {
            SetStatus("Refused: controller record changed; refresh and try again");
            return false;
        }
        return true;
    }

    bool CommitLifecycleAction(const std::string& token,
                               const std::function<bool(MidiConfigViewModel&, std::size_t,
                                                        MidiInstrumentConfig&, std::string*)>& mutate,
                               std::string success)
    {
        const std::optional<std::pair<std::size_t, std::string>> identity =
            NodeIds::ControllerActionIdentityFromToken(token);
        MidiInstrumentConfig instrument;
        if (!SnapshotForLifecycleIdentity(identity, instrument))
        {
            return false;
        }
        MidiConfigViewModel mutationViewModel;
        mutationViewModel.Rebuild(instrument, MidiConnectionState{});
        MidiInstrumentConfig out;
        std::string reason;
        if (!mutate(mutationViewModel, identity->first, out, &reason))
        {
            SetStatus("Refused: " + reason);
            return false;
        }
        if (!Commit(std::move(out)))
        {
            SetStatus("Refused: host rejected the instrument commit");
            return false;
        }
        RefreshDiscoveryFromCallbacks();
        if (!SaveCommittedWizardAction(/*sessionStatus=*/false))
        {
            return false;
        }
        SetStatus(std::move(success));
        return true;
    }

    void HandleRenameController(const std::string& token)
    {
        const std::optional<std::pair<std::size_t, std::string>> identity =
            NodeIds::ControllerActionIdentityFromToken(token);
        if (!identity.has_value())
        {
            SetStatus("Refused: invalid controller identity");
            return;
        }
        const auto draft = m_renameDrafts.find(identity->second);
        const std::string name = draft != m_renameDrafts.end() ? draft->second : identity->second;
        if (CommitLifecycleAction(
            token, [&](MidiConfigViewModel& viewModel, std::size_t controllerIx,
                       MidiInstrumentConfig& out, std::string* reason) {
                return viewModel.RenameController(controllerIx, name, out, reason);
            },
            "Renamed " + name))
        {
            m_renameDrafts.erase(identity->second);
        }
    }

    void HandleDeleteController(const std::string& token)
    {
        CommitLifecycleAction(
            token, [&](MidiConfigViewModel& viewModel, std::size_t controllerIx,
                       MidiInstrumentConfig& out, std::string* reason) {
                return viewModel.DeleteController(controllerIx, out, reason);
            },
            "Deleted controller");
    }

    void HandleBlacklistController(const std::string& token)
    {
        CommitLifecycleAction(
            token, [&](MidiConfigViewModel& viewModel, std::size_t controllerIx,
                       MidiInstrumentConfig& out, std::string* reason) {
                return viewModel.BlacklistController(controllerIx, out, reason);
            },
            "Blacklisted controller");
    }

    void HandleRemoveFromBlacklist(const std::string& token)
    {
        CommitLifecycleAction(
            token, [&](MidiConfigViewModel& viewModel, std::size_t controllerIx,
                       MidiInstrumentConfig& out, std::string* reason) {
                return viewModel.RemoveFromBlacklist(controllerIx, out, reason);
            },
            "Removed controller from blacklist");
    }

    void HandleWizardSubmit()
    {
        if (!m_wizardSession.has_value())
        {
            return;
        }
        if (!std::holds_alternative<WizardCandidate>(m_wizardSession->target))
        {
            HandleExistingWizardSubmit();
            return;
        }

        const WizardCandidate candidate =
            std::get<WizardCandidate>(m_wizardSession->target);
        MidiInstrumentConfig instrument;
        MidiDeviceList devices;
        if (!RevalidateCandidate(candidate, instrument, devices,
                                 /*sessionStatus=*/true))
        {
            return;
        }

        const std::string name =
            AvailableControllerName(instrument, candidate.displayName);
        WizardGenerationResult generated =
            m_wizardSession->wizard->GenerateProfile(
                *m_wizardSession->form,
                {.name = name,
                 .input = {.identifier = candidate.input.identifier,
                           .name = candidate.input.name},
                 .output = {.identifier = candidate.output.identifier,
                            .name = candidate.output.name}});
        if (!generated)
        {
            SetWizardStatus(
                "Refused: " +
                (generated.error.empty()
                     ? std::string("controller profile generation failed")
                     : generated.error));
            return;
        }

        MidiControllerSlot controller = std::move(*generated.controller);
        controller.name = name;
        controller.kind = candidate.kind;
        controller.disposition = MidiControllerDisposition::Active;
        controller.wizardId = candidate.wizardId;
        controller.input = {.identifier = candidate.input.identifier,
                            .name = candidate.input.name};
        controller.output = {.identifier = candidate.output.identifier,
                             .name = candidate.output.name};
        controller.dormantConfig.reset();

        if (!CommitNewCandidate(std::move(instrument),
                                std::move(controller),
                                /*sessionStatus=*/true))
        {
            return;
        }
        CloseWizardSession();
        SetStatus("Configured " + name);
    }

    bool RevalidateExistingWizardTarget(const ExistingWizardTarget& expected,
                                        MidiInstrumentConfig& instrument)
    {
        if (!m_callbacks.instrumentSnapshot)
        {
            SetWizardStatus("Refused: current controller state is unavailable");
            return false;
        }
        instrument = m_callbacks.instrumentSnapshot();
        if (expected.index >= instrument.controllers.size())
        {
            SetWizardStatus("Refused: controller record changed; refresh and try again");
            return false;
        }
        const MidiControllerSlot& current = instrument.controllers[expected.index];
        if (current.name != expected.name || current.kind != expected.kind ||
            current.input.identifier != expected.input.identifier ||
            current.input.name != expected.input.name ||
            current.output.identifier != expected.output.identifier ||
            current.output.name != expected.output.name ||
            current.wizardId != expected.wizardId || current.disposition != expected.disposition)
        {
            SetWizardStatus("Refused: controller record changed; refresh and try again");
            return false;
        }
        return true;
    }

    void HandleExistingWizardSubmit()
    {
        if (!m_wizardSession.has_value() ||
            !std::holds_alternative<ExistingWizardTarget>(m_wizardSession->target))
        {
            return;
        }
        const ExistingWizardTarget expected =
            std::get<ExistingWizardTarget>(m_wizardSession->target);
        MidiInstrumentConfig instrument;
        if (!RevalidateExistingWizardTarget(expected, instrument))
        {
            return;
        }

        const MidiControllerSlot& current = instrument.controllers[expected.index];
        WizardGenerationResult generated = m_wizardSession->wizard->GenerateProfile(
            *m_wizardSession->form,
            {.name = current.name, .input = current.input, .output = current.output});
        if (!generated)
        {
            SetWizardStatus(
                "Refused: " +
                (generated.error.empty()
                     ? std::string("controller profile generation failed")
                     : generated.error));
            return;
        }

        MidiControllerSlot replacement = current;
        replacement.kind = generated.controller->kind;
        replacement.config = std::move(generated.controller->config);
        replacement.dormantConfig.reset();
        replacement.disposition = MidiControllerDisposition::Active;
        if (!instrument.ReplaceController(expected.index, std::move(replacement)))
        {
            SetWizardStatus("Refused: generated controller record is invalid");
            return;
        }
        if (!Commit(std::move(instrument)))
        {
            SetWizardStatus("Refused: host rejected the instrument commit");
            return;
        }
        RefreshDiscoveryFromCallbacks();
        if (!SaveCommittedWizardAction(/*sessionStatus=*/true))
        {
            return;
        }
        const std::string name = expected.name;
        CloseWizardSession();
        SetStatus("Reconfigured " + name);
    }

    void HandleWizardIgnore()
    {
        if (!m_wizardSession.has_value() ||
            !std::holds_alternative<WizardCandidate>(
                m_wizardSession->target))
        {
            return;
        }
        HandleIgnoreCandidate(
            std::get<WizardCandidate>(m_wizardSession->target),
            /*sessionStatus=*/true);
    }

    void HandleIgnoreCandidate(const WizardCandidate& candidate,
                               bool sessionStatus)
    {
        MidiInstrumentConfig instrument;
        MidiDeviceList devices;
        if (!RevalidateCandidate(candidate, instrument, devices,
                                 sessionStatus))
        {
            return;
        }

        const std::string name =
            AvailableControllerName(instrument, candidate.displayName);
        MidiControllerSlot controller;
        controller.name = name;
        controller.kind = candidate.kind;
        controller.disposition = MidiControllerDisposition::Blacklisted;
        controller.wizardId = candidate.wizardId;
        controller.input = {.identifier = candidate.input.identifier,
                            .name = candidate.input.name};
        controller.output = {.identifier = candidate.output.identifier,
                             .name = candidate.output.name};

        if (!CommitNewCandidate(std::move(instrument),
                                std::move(controller),
                                sessionStatus))
        {
            return;
        }
        if (sessionStatus)
        {
            CloseWizardSession();
        }
        SetStatus("Ignored " + name);
    }

    static std::size_t ParseIndex(const std::string& text)
    {
        try
        {
            return static_cast<std::size_t>(std::stoull(text));
        }
        catch (...)
        {
            return 0;
        }
    }

    static std::vector<std::string> Split(const std::string& text, char delimiter)
    {
        std::vector<std::string> parts;
        std::stringstream stream(text);
        std::string part;
        while (std::getline(stream, part, delimiter))
        {
            parts.push_back(part);
        }
        return parts;
    }

    void HandleEndpointSelect(const std::string& value)
    {
        const std::size_t firstSeparator = value.find(':');
        if (firstSeparator == std::string::npos)
        {
            return;
        }
        const std::size_t secondSeparator = value.find(':', firstSeparator + 1);
        if (secondSeparator == std::string::npos)
        {
            return;
        }
        const std::size_t controllerIx = ParseIndex(value.substr(0, firstSeparator));
        const bool output = value.substr(firstSeparator + 1, secondSeparator - firstSeparator - 1) == "output";
        const std::string optionId = value.substr(secondSeparator + 1);

        if (optionId == kEndpointOfflineOptionId)
        {
            return;
        }

        if (optionId == kEndpointNoneOptionId)
        {
            MidiInstrumentConfig out;
            if (m_vm.SetEndpointRef(controllerIx, output, MidiEndpointRef{}, out))
            {
                Commit(std::move(out));
                SetStatus("Cleared device");
            }
            return;
        }

        if (!m_callbacks.enumerateDevices)
        {
            return;
        }

        const MidiDeviceList devices = m_callbacks.enumerateDevices();
        const std::vector<MidiDeviceInfoRef>& list = output ? devices.outputs : devices.inputs;
        for (const MidiDeviceInfoRef& device : list)
        {
            if (device.identifier != optionId)
            {
                continue;
            }
            MidiEndpointRef ref;
            ref.identifier = device.identifier;
            ref.name = device.name;
            MidiInstrumentConfig out;
            if (m_vm.SetEndpointRef(controllerIx, output, ref, out))
            {
                Commit(std::move(out));
                SetStatus("Selected " + device.name);
            }
            return;
        }
    }

    void HandleVariantSelect(const std::string& value)
    {
        const auto parts = Split(value, ':');
        if (parts.size() != 2)
        {
            return;
        }
        const std::size_t controllerIx = ParseIndex(parts[0]);
        int variantIndex = 0;
        try
        {
            variantIndex = std::stoi(parts[1]);
        }
        catch (...)
        {
            return;
        }
        MidiInstrumentConfig out;
        std::string reason;
        if (m_vm.SetLaunchpadVariant(controllerIx, variantIndex, out, &reason))
        {
            Commit(std::move(out));
            if (variantIndex >= 0 && variantIndex < static_cast<int>(LaunchpadVariantCatalog().size()))
            {
                SetStatus("Selected " + LaunchpadVariantCatalog()[static_cast<std::size_t>(variantIndex)]);
            }
        }
        else
        {
            SetStatus("Refused: " + reason);
        }
    }

    void HandleMappingFieldCommit(const std::string& value)
    {
        const auto parts = Split(value, ':');
        if (parts.size() < 4)
        {
            return;
        }
        const std::size_t controllerIx = ParseIndex(parts[0]);
        const std::optional<MidiConfigSection> section = ControllersLayout::ParseSectionToken(parts[1]);
        const std::size_t rowIx = ParseIndex(parts[2]);
        const std::optional<MidiMappingRowVM::Field> field = ControllersLayout::ParseFieldToken(parts[3]);
        if (!section.has_value() || !field.has_value())
        {
            return;
        }

        std::string rawValue;
        for (std::size_t ix = 4; ix < parts.size(); ++ix)
        {
            if (ix > 4)
            {
                rawValue += ':';
            }
            rawValue += parts[ix];
        }

        double numericValue = 0.0;
        try
        {
            std::size_t consumed = 0;
            numericValue = std::stod(rawValue, &consumed);
            if (consumed != rawValue.size() || !std::isfinite(numericValue))
            {
                SetStatus("Refused: value must be a finite number");
                return;
            }
        }
        catch (...)
        {
            SetStatus("Refused: value must be a finite number");
            return;
        }
        MidiInstrumentConfig out;
        std::string reason;
        bool presentationChanged = false;
        if (m_vm.ApplyMappingEdit(controllerIx, *section, rowIx, *field, numericValue, out, &reason,
                                  &presentationChanged))
        {
            Commit(std::move(out));
            SetStatus("OK");
        }
        else if (presentationChanged)
        {
            SetStatus("Warning: " + reason);
        }
        else
        {
            SetStatus("Refused: " + reason);
        }
    }

    void HandleDeleteRow(const std::string& value)
    {
        const auto parts = Split(value, ':');
        if (parts.size() != 3)
        {
            return;
        }
        const std::size_t controllerIx = ParseIndex(parts[0]);
        const std::optional<MidiConfigSection> section = ControllersLayout::ParseSectionToken(parts[1]);
        const std::size_t rowIx = ParseIndex(parts[2]);
        if (!section.has_value())
        {
            return;
        }
        MidiInstrumentConfig out;
        std::string reason;
        if (m_vm.DeleteRow(controllerIx, *section, rowIx, out, &reason))
        {
            Commit(std::move(out));
            SetStatus("Deleted");
        }
        else
        {
            SetStatus("Refused: " + reason);
        }
    }

    void HandleAdd(const std::string& value, bool asBlock)
    {
        const auto parts = Split(value, ':');
        if (parts.size() != 3)
        {
            return;
        }
        const std::size_t controllerIx = ParseIndex(parts[0]);
        const std::optional<MidiConfigSection> section = ControllersLayout::ParseSectionToken(parts[1]);
        const std::optional<MidiMappingRowVM::RowGroup> group = ControllersLayout::ParseRowGroupToken(parts[2]);
        if (!section.has_value() || !group.has_value())
        {
            return;
        }
        MidiInstrumentConfig out;
        std::string reason;
        const bool ok = asBlock ? m_vm.AddBlock(controllerIx, *section, *group, out, &reason)
                                : m_vm.AddSingle(controllerIx, *section, *group, out, &reason);
        if (ok)
        {
            Commit(std::move(out));
            SetStatus(asBlock ? "Added block" : "Added");
        }
        else
        {
            SetStatus("Refused: " + reason);
        }
    }

    void HandleAddController(const std::string& value)
    {
        const auto parts = Split(value, ':');
        std::string name = m_addControllerName;
        std::string kindId = m_addControllerKindId;
        if (parts.size() >= 2)
        {
            name = parts[0];
            kindId = parts[1];
        }
        if (name.empty())
        {
            SetStatus("Refused: name must not be empty");
            return;
        }
        MidiInstrumentConfig out;
        std::string reason;
        if (m_vm.AddController(name, ControllersLayout::KindFromAddOptionId(kindId), out, &reason))
        {
            Commit(std::move(out));
            SetStatus("Added " + name);
            m_addControllerName.clear();
        }
        else
        {
            SetStatus("Refused: " + reason);
        }
    }

    void CloseWizardSession()
    {
        m_wizardSession.reset();
        ++m_treeRevision;
    }

    void OpenChooserCandidate(const std::string& token)
    {
        for (std::size_t candidateIx = 0; candidateIx < m_discovery.available.size(); ++candidateIx)
        {
            if (NodeIds::WizardCandidateToken(m_discovery.available[candidateIx]) == token)
            {
                m_wizardChooserStatus.clear();
                OpenCandidate(candidateIx);
                return;
            }
        }
        m_wizardChooserStatus = "That controller is no longer available. Refresh and choose another controller.";
        ++m_treeRevision;
    }

    ui::NodeTree BuildWizardChooserTree() const
    {
        ui::NodeTree tree;
        ui::Node root;
        root.id = NodeIds::kWizardChooser;
        root.kind = ui::NodeKind::Root;
        root.bounds = m_contentBounds;
        tree.nodes.push_back(std::move(root));
        auto append = [&](ui::Node node) {
            tree.nodes.front().children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        ui::Node back;
        back.id = NodeIds::kWizardBack;
        back.kind = ui::NodeKind::Button;
        back.label = "Back";
        back.action = ui::Action::Named(Actions::kWizardBack);
        append(std::move(back));

        ui::Node heading;
        heading.id = ui::NodeId(std::string(NodeIds::kWizardChooser) + ".heading");
        heading.kind = ui::NodeKind::Label;
        heading.text = "Choose a controller to configure";
        append(std::move(heading));

        if (m_discovery.available.empty())
        {
            ui::Node empty;
            empty.id = NodeIds::kWizardChooserEmpty;
            empty.kind = ui::NodeKind::StatusText;
            empty.text = "No recognized unconfigured controller pair is present";
            append(std::move(empty));
            return tree;
        }

        if (!m_wizardChooserStatus.empty())
        {
            ui::Node status;
            status.id = ui::NodeId(std::string(NodeIds::kWizardChooser) + ".status");
            status.kind = ui::NodeKind::StatusText;
            status.text = m_wizardChooserStatus;
            append(std::move(status));
        }

        for (std::size_t candidateIx = 0; candidateIx < m_discovery.available.size(); ++candidateIx)
        {
            const WizardCandidate& candidate = m_discovery.available[candidateIx];
            ui::Node choice;
            choice.id = ui::NodeId(NodeIds::WizardChooserCandidate(candidate));
            choice.kind = ui::NodeKind::Button;
            choice.label = candidate.displayName + " — " + candidate.input.name + " (" +
                           candidate.input.identifier + ") / " + candidate.output.name + " (" +
                           candidate.output.identifier + ")";
            choice.action = ui::Action::WithValue(Actions::kWizardChoose,
                                                   NodeIds::WizardCandidateToken(candidate));
            append(std::move(choice));
        }
        return tree;
    }

    ui::NodeTree BuildWizardFormTree()
    {
        ui::NodeTree tree = m_wizardSession->form->BuildTree();
        if (tree.nodes.empty())
        {
            return tree;
        }
        // The form lays itself out and reports its intrinsic height, so the
        // page places its own session chrome underneath instead of flowing it
        // over the form's controls. The page learns nothing about the form's
        // contents beyond that height.
        const float formHeight = tree.nodes.front().bounds.height;
        tree.nodes.front().id = NodeIds::kWizardForm;
        tree.nodes.front().bounds = m_contentBounds;
        float chromeX = ControllersLayout::kPageMargin;
        const float chromeY = formHeight + ControllersLayout::kRowGap;
        auto append = [&](ui::Node node, float width) {
            node.bounds = {chromeX, chromeY, width, ControllersLayout::kBackRowHeight};
            chromeX += width + ControllersLayout::kRowGap;
            tree.nodes.front().children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        ui::Node back;
        back.id = NodeIds::kWizardBack;
        back.kind = ui::NodeKind::Button;
        back.label = "Back";
        back.action = ui::Action::Named(Actions::kWizardBack);
        append(std::move(back), ControllersLayout::kBackButtonWidth);

        ui::Node cancel;
        cancel.id = NodeIds::kWizardCancel;
        cancel.kind = ui::NodeKind::Button;
        cancel.label = "Cancel";
        cancel.action = ui::Action::Named(Actions::kWizardCancel);
        append(std::move(cancel), ControllersLayout::kBackButtonWidth);

        ui::Node submit;
        submit.id = NodeIds::kWizardSubmit;
        submit.kind = ui::NodeKind::Button;
        submit.label = "Submit";
        submit.action = ui::Action::Named(Actions::kWizardSubmit);
        append(std::move(submit), ControllersLayout::kBackButtonWidth);

        if (std::holds_alternative<WizardCandidate>(m_wizardSession->target))
        {
            ui::Node ignore;
            ignore.id = NodeIds::kWizardIgnore;
            ignore.kind = ui::NodeKind::Button;
            ignore.label = "Ignore this controller";
            ignore.action = ui::Action::Named(Actions::kWizardIgnore);
            append(std::move(ignore), ControllersLayout::kWizardIgnoreWidth);
        }
        float messageY = chromeY + ControllersLayout::kBackRowHeight + ControllersLayout::kRowGap;
        const float messageWidth =
            std::max(0.0f, m_contentBounds.width - ControllersLayout::kPageMargin * 2.0f);
        auto appendMessage = [&](ui::Node node) {
            node.bounds = {ControllersLayout::kPageMargin, messageY, messageWidth,
                           ControllersLayout::kStatusRowHeight};
            messageY += ControllersLayout::kStatusRowHeight + ControllersLayout::kRowGap;
            tree.nodes.front().children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };
        if (!m_wizardSession->warning.empty())
        {
            ui::Node warning;
            warning.id = NodeIds::kWizardWarning;
            warning.kind = ui::NodeKind::StatusText;
            warning.text = m_wizardSession->warning;
            appendMessage(std::move(warning));
        }
        if (!m_wizardSession->status.empty())
        {
            ui::Node status;
            status.id = NodeIds::kWizardStatus;
            status.kind = ui::NodeKind::StatusText;
            status.text = m_wizardSession->status;
            appendMessage(std::move(status));
        }
        return tree;
    }

    static ui::NodeTree BuildControllersPageTree(const MidiConfigViewModel& vm,
                                                   const MidiDeviceList& devices,
                                                   const WizardDiscovery& discovery,
                                                   ui::Bounds area,
                                                  const std::string& statusText,
                                                  const std::string& addControllerName,
                                                  const std::string& addControllerKindId,
                                                  const std::map<std::string, std::string>& renameDrafts)
    {
        const auto renameDraftFor = [&](const std::string& name) {
            const auto it = renameDrafts.find(name);
            return it != renameDrafts.end() ? it->second : name;
        };
        ui::NodeTree tree;
        ui::Node root;
        root.id = NodeIds::kRoot;
        root.kind = ui::NodeKind::Root;
        root.bounds = area;
        tree.nodes.push_back(root);

        auto appendChild = [&](ui::Node node) {
            tree.nodes.front().children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        float y = area.y + ControllersLayout::kPageMargin;
        const float contentX = area.x + ControllersLayout::kPageMargin;
        const float contentWidth = area.width - ControllersLayout::kPageMargin * 2.0f;

        ui::Node backButton;
        backButton.id = NodeIds::kBack;
        backButton.kind = ui::NodeKind::Button;
        backButton.label = "Back";
        backButton.bounds = {contentX, y, ControllersLayout::kBackButtonWidth, ControllersLayout::kBackRowHeight};
        backButton.action = ui::Action::Named(Actions::kBack);
        appendChild(std::move(backButton));

        ui::Node wizardLaunch;
        wizardLaunch.id = NodeIds::kWizardLaunch;
        wizardLaunch.kind = ui::NodeKind::Button;
        wizardLaunch.label = "Configuration Wizard";
        wizardLaunch.enabled = !discovery.available.empty();
        wizardLaunch.bounds = {contentX + ControllersLayout::kBackButtonWidth + ControllersLayout::kRowGap,
                               y, 180.0f, ControllersLayout::kBackRowHeight};
        wizardLaunch.action = ui::Action::Named(Actions::kWizardOpen);
        appendChild(std::move(wizardLaunch));

        y += ControllersLayout::kBackRowHeight + ControllersLayout::kRowGap;

        ui::Node scrollArea;
        scrollArea.id = NodeIds::kScroll;
        scrollArea.kind = ui::NodeKind::ScrollArea;
        const float scrollBottom = area.y + area.height - ControllersLayout::kStatusRowHeight - ControllersLayout::kRowGap - ControllersLayout::kPageMargin;
        scrollArea.bounds = {contentX, y, contentWidth, scrollBottom - y};
        scrollArea.scrollContentWidth = std::max(contentWidth, ControllersLayout::kControllerHeaderMinWidth);
        scrollArea.scrollContentHeight = scrollArea.bounds.height;
        tree.nodes.front().children.push_back(scrollArea.id);
        const std::size_t scrollAreaIndex = tree.nodes.size();
        tree.nodes.push_back(scrollArea);

        float scrollY = 0.0f;
        const float scrollWidth = tree.nodes[scrollAreaIndex].scrollContentWidth;
        auto appendScrollChild = [&](ui::Node node) {
            tree.nodes[scrollAreaIndex].children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        ui::Node available;
        available.id = NodeIds::kAvailable;
        available.kind = ui::NodeKind::Section;
        available.label = "Available controllers";
        available.bounds = {0.0f, scrollY, scrollWidth, 0.0f};
        tree.nodes[scrollAreaIndex].children.push_back(available.id);
        const std::size_t availableNodeIndex = tree.nodes.size();
        tree.nodes.push_back(std::move(available));
        auto appendAvailableChild = [&](ui::Node node) {
            tree.nodes[availableNodeIndex].children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        if (discovery.available.empty())
        {
            ui::Node empty;
            empty.id = NodeIds::kAvailableEmpty;
            empty.kind = ui::NodeKind::StatusText;
            empty.text = "No recognized unconfigured controller pair is present";
            empty.bounds = {0.0f, 0.0f, scrollWidth, ControllersLayout::kStatusRowHeight};
            appendAvailableChild(std::move(empty));
            scrollY += ControllersLayout::kStatusRowHeight;
        }
        else
        {
            for (std::size_t candidateIx = 0; candidateIx < discovery.available.size(); ++candidateIx)
            {
                const WizardCandidate& candidate = discovery.available[candidateIx];
                ui::Node row;
                row.id = ui::NodeId(NodeIds::AvailableRow(candidateIx));
                row.kind = ui::NodeKind::Row;
                row.label = candidate.displayName;
                row.bounds = {0.0f, scrollY, scrollWidth, ControllersLayout::kControllerHeaderHeight};
                const std::size_t rowNodeIndex = tree.nodes.size();
                tree.nodes.push_back(std::move(row));
                tree.nodes[availableNodeIndex].children.push_back(tree.nodes[rowNodeIndex].id);
                auto appendRowChild = [&](ui::Node node) {
                    tree.nodes[rowNodeIndex].children.push_back(node.id);
                    tree.nodes.push_back(std::move(node));
                };

                ui::Node endpoints;
                endpoints.id = ui::NodeId(NodeIds::AvailableRow(candidateIx) + ".endpoints");
                endpoints.kind = ui::NodeKind::Label;
                endpoints.text = candidate.input.name + " / " + candidate.output.name;
                endpoints.bounds = {0.0f, 0.0f, 260.0f, ControllersLayout::kControllerHeaderHeight};
                appendRowChild(std::move(endpoints));

                ui::Node configure;
                configure.id = ui::NodeId(NodeIds::AvailableConfigure(candidateIx));
                configure.kind = ui::NodeKind::Button;
                configure.label = "Configure";
                configure.bounds = {268.0f, 0.0f, 92.0f, ControllersLayout::kControllerHeaderHeight};
                configure.action = ui::Action::WithValue(Actions::kAvailableConfigure,
                                                         std::to_string(candidateIx));
                appendRowChild(std::move(configure));

                ui::Node ignore;
                ignore.id = ui::NodeId(NodeIds::AvailableIgnore(candidateIx));
                ignore.kind = ui::NodeKind::Button;
                ignore.label = "Ignore";
                ignore.bounds = {368.0f, 0.0f, 72.0f, ControllersLayout::kControllerHeaderHeight};
                ignore.action = ui::Action::WithValue(Actions::kAvailableIgnore,
                                                      NodeIds::WizardCandidateToken(candidate));
                appendRowChild(std::move(ignore));
                scrollY += ControllersLayout::kControllerHeaderHeight;
            }
        }

        const auto diagnosticText = [](const char* label, const std::vector<MidiDeviceInfoRef>& devices) {
            std::string text = label;
            for (const MidiDeviceInfoRef& device : devices)
            {
                if (text.size() > std::string_view(label).size())
                {
                    text += ", ";
                }
                text += device.name;
            }
            return text;
        };
        if (!discovery.unmatchedInputs.empty())
        {
            ui::Node diagnostics;
            diagnostics.id = NodeIds::kAvailableUnmatchedInputs;
            diagnostics.kind = ui::NodeKind::StatusText;
            diagnostics.text = diagnosticText("Unmatched input: ", discovery.unmatchedInputs);
            diagnostics.bounds = {0.0f, scrollY, scrollWidth, ControllersLayout::kStatusRowHeight};
            appendAvailableChild(std::move(diagnostics));
            scrollY += ControllersLayout::kStatusRowHeight;
        }
        if (!discovery.unmatchedOutputs.empty())
        {
            ui::Node diagnostics;
            diagnostics.id = NodeIds::kAvailableUnmatchedOutputs;
            diagnostics.kind = ui::NodeKind::StatusText;
            diagnostics.text = diagnosticText("Unmatched output: ", discovery.unmatchedOutputs);
            diagnostics.bounds = {0.0f, scrollY, scrollWidth, ControllersLayout::kStatusRowHeight};
            appendAvailableChild(std::move(diagnostics));
            scrollY += ControllersLayout::kStatusRowHeight;
        }
        tree.nodes[availableNodeIndex].bounds.height = scrollY - tree.nodes[availableNodeIndex].bounds.y;
        scrollY += ControllersLayout::kRowGap;

        const auto& controllers = vm.Controllers();
        for (std::size_t controllerIx = 0; controllerIx < controllers.size(); ++controllerIx)
        {
            const MidiControllerRowVM& rowVm = controllers[controllerIx];

            ui::Node controllerRow;
            controllerRow.id = ui::NodeId(NodeIds::ControllerRow(controllerIx));
            controllerRow.kind = ui::NodeKind::Row;
            controllerRow.bounds = {0.0f, scrollY, scrollWidth, ControllersLayout::kControllerHeaderHeight};
            tree.nodes[scrollAreaIndex].children.push_back(controllerRow.id);
            const std::size_t controllerNodeIndex = tree.nodes.size();
            tree.nodes.push_back(std::move(controllerRow));
            auto appendControllerChild = [&](ui::Node node) {
                tree.nodes[controllerNodeIndex].children.push_back(node.id);
                tree.nodes.push_back(std::move(node));
            };

            if (rowVm.disposition == MidiControllerDisposition::Blacklisted)
            {
                float lifecycleX = 0.0f;
                ui::Node nameLabel;
                nameLabel.id = ui::NodeId(NodeIds::ControllerName(controllerIx));
                nameLabel.kind = ui::NodeKind::Label;
                nameLabel.text = rowVm.name;
                nameLabel.bounds = {lifecycleX, 0.0f, ControllersLayout::kControllerNameWidth,
                                    ControllersLayout::kControllerHeaderHeight};
                appendControllerChild(std::move(nameLabel));
                lifecycleX += ControllersLayout::kControllerNameWidth +
                              ControllersLayout::kControllerIdentityGap;

                ui::Node kindLabel;
                kindLabel.id = ui::NodeId(NodeIds::ControllerKind(controllerIx));
                kindLabel.kind = ui::NodeKind::Label;
                kindLabel.text = MidiProfileKindName(rowVm.kind);
                kindLabel.bounds = {lifecycleX, 0.0f, ControllersLayout::kControllerKindWidth,
                                    ControllersLayout::kControllerHeaderHeight};
                appendControllerChild(std::move(kindLabel));
                lifecycleX += ControllersLayout::kControllerKindWidth +
                              ControllersLayout::kControllerIdentityGap;

                ui::Node badge;
                badge.id = ui::NodeId(NodeIds::ControllerBadge(controllerIx));
                badge.kind = ui::NodeKind::Label;
                badge.text = "Blacklisted";
                badge.bounds = {lifecycleX, 0.0f, ControllersLayout::kBlacklistedBadgeWidth,
                                ControllersLayout::kControllerHeaderHeight};
                appendControllerChild(std::move(badge));
                lifecycleX += ControllersLayout::kBlacklistedBadgeWidth +
                              ControllersLayout::kControllerIdentityGap;

                ui::Node inputLabel;
                inputLabel.id = ui::NodeId(NodeIds::ControllerInputLabel(controllerIx));
                inputLabel.kind = ui::NodeKind::Label;
                inputLabel.text = "Input: " + ControllersLayout::StoredEndpointLabel(rowVm.storedInput);
                inputLabel.bounds = {lifecycleX, 0.0f, ControllersLayout::kBlacklistedEndpointLabelWidth,
                                     ControllersLayout::kControllerHeaderHeight};
                appendControllerChild(std::move(inputLabel));
                lifecycleX += ControllersLayout::kBlacklistedEndpointLabelWidth +
                              ControllersLayout::kControllerIdentityGap;

                ui::Node outputLabel;
                outputLabel.id = ui::NodeId(NodeIds::ControllerOutputLabel(controllerIx));
                outputLabel.kind = ui::NodeKind::Label;
                outputLabel.text = "Output: " + ControllersLayout::StoredEndpointLabel(rowVm.storedOutput);
                outputLabel.bounds = {lifecycleX, 0.0f, ControllersLayout::kBlacklistedEndpointLabelWidth,
                                      ControllersLayout::kControllerHeaderHeight};
                appendControllerChild(std::move(outputLabel));
                lifecycleX += ControllersLayout::kBlacklistedEndpointLabelWidth +
                              ControllersLayout::kLifecycleControlGap;

                ui::Node rename;
                rename.id = ui::NodeId(NodeIds::ControllerRenameDraft(controllerIx));
                rename.kind = ui::NodeKind::TextField;
                rename.label = "Rename";
                rename.text = renameDraftFor(rowVm.name);
                rename.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleDraftWidth,
                                 ControllersLayout::kControllerHeaderHeight};
                rename.action = ui::Action::WithValue(Actions::kControllerRenameDraft,
                                                      NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                appendControllerChild(std::move(rename));

                lifecycleX += ControllersLayout::kLifecycleDraftWidth +
                              ControllersLayout::kLifecycleControlGap;
                ui::Node renameButton;
                renameButton.id = ui::NodeId(NodeIds::ControllerRename(controllerIx));
                renameButton.kind = ui::NodeKind::Button;
                renameButton.label = "Rename";
                renameButton.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleRenameWidth,
                                       ControllersLayout::kControllerHeaderHeight};
                renameButton.action = ui::Action::WithValue(Actions::kControllerRename,
                                                            NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                appendControllerChild(std::move(renameButton));
                lifecycleX += ControllersLayout::kLifecycleRenameWidth +
                              ControllersLayout::kLifecycleControlGap;
                if (rowVm.hasResolvedWizard)
                {
                    ui::Node configure;
                    configure.id = ui::NodeId(NodeIds::ControllerConfigure(controllerIx));
                    configure.kind = ui::NodeKind::Button;
                    configure.label = "Configure";
                    configure.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleConfigureWidth,
                                        ControllersLayout::kControllerHeaderHeight};
                    configure.action = ui::Action::WithValue(Actions::kControllerConfigure,
                                                             NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                    appendControllerChild(std::move(configure));
                    lifecycleX += ControllersLayout::kLifecycleConfigureWidth +
                                  ControllersLayout::kLifecycleControlGap;
                }
                ui::Node remove;
                remove.id = ui::NodeId(NodeIds::ControllerRemoveBlacklist(controllerIx));
                remove.kind = ui::NodeKind::Button;
                remove.label = "Remove";
                remove.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleRemoveWidth,
                                 ControllersLayout::kControllerHeaderHeight};
                remove.action = ui::Action::WithValue(Actions::kControllerRemoveBlacklist,
                                                       NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                appendControllerChild(std::move(remove));

                scrollY += ControllersLayout::kControllerHeaderHeight + ControllersLayout::kRowGap;
                continue;
            }

            ui::Node disclosure;
            disclosure.id = ui::NodeId(NodeIds::ControllerDisclosure(controllerIx));
            disclosure.kind = ui::NodeKind::Button;
            disclosure.label = rowVm.configExpanded ? "v" : ">";
            disclosure.bounds = {0.0f, 0.0f, ControllersLayout::kControllerDisclosureWidth,
                                 ControllersLayout::kControllerHeaderHeight};
            disclosure.action = ui::Action::WithValue(Actions::kToggleConfig, std::to_string(controllerIx));
            appendControllerChild(std::move(disclosure));

            ui::Node nameLabel;
            nameLabel.id = ui::NodeId(NodeIds::ControllerName(controllerIx));
            nameLabel.kind = ui::NodeKind::Label;
            nameLabel.text = rowVm.name;
            nameLabel.bounds = {ControllersLayout::kControllerDisclosureWidth +
                                    ControllersLayout::kControllerIdentityGap,
                                0.0f,
                                ControllersLayout::kControllerNameWidth,
                                ControllersLayout::kControllerHeaderHeight};
            appendControllerChild(std::move(nameLabel));

            ui::Node kindLabel;
            kindLabel.id = ui::NodeId(NodeIds::ControllerKind(controllerIx));
            kindLabel.kind = ui::NodeKind::Label;
            kindLabel.text = MidiProfileKindName(rowVm.kind);
            kindLabel.bounds = {ControllersLayout::kControllerDisclosureWidth +
                                    ControllersLayout::kControllerIdentityGap +
                                    ControllersLayout::kControllerNameWidth +
                                    ControllersLayout::kControllerIdentityGap,
                                0.0f,
                                ControllersLayout::kControllerKindWidth,
                                ControllersLayout::kControllerHeaderHeight};
            appendControllerChild(std::move(kindLabel));

            float headerX = ControllersLayout::kHeaderControlsX;

            ui::Node statusDots;
            statusDots.id = ui::NodeId(NodeIds::ControllerStatusDots(controllerIx));
            statusDots.kind = ui::NodeKind::Draw;
            statusDots.bounds = {headerX, ControllersLayout::kControllerHeaderHeight * 0.5f - 4.0f,
                                 ControllersLayout::kStatusDotsWidth, 8.0f};
            statusDots.drawCommands.push_back(ui::DrawCommand::FillEllipse(
                {0.0f, 0.0f, 8.0f, 8.0f}, ControllersLayout::EndpointStatusColor(rowVm.inputStatus)));
            statusDots.drawCommands.push_back(ui::DrawCommand::FillEllipse(
                {14.0f, 0.0f, 8.0f, 8.0f}, ControllersLayout::EndpointStatusColor(rowVm.outputStatus)));
            appendControllerChild(std::move(statusDots));

            headerX += ControllersLayout::kStatusDotsWidth + ControllersLayout::kLifecycleControlGap;

            std::string selectedInput;
            ui::Node inputCombo;
            inputCombo.id = ui::NodeId(NodeIds::ControllerInput(controllerIx));
            inputCombo.kind = ui::NodeKind::ComboBox;
            inputCombo.label = "Input";
            inputCombo.options =
                ControllersLayout::BuildEndpointOptions(devices.inputs, rowVm.inputStatus, rowVm.storedInput,
                                                       rowVm.inputDeviceLabel, selectedInput);
            inputCombo.selectedOption = selectedInput;
            inputCombo.bounds = {headerX, 0.0f, ControllersLayout::kEndpointBoxWidth,
                                 ControllersLayout::kControllerHeaderHeight};
            inputCombo.action = ui::Action::WithValue(Actions::kEndpointSelect, std::to_string(controllerIx) + ":input");
            appendControllerChild(std::move(inputCombo));

            ui::Node outputCombo;
            outputCombo.id = ui::NodeId(NodeIds::ControllerOutput(controllerIx));
            outputCombo.kind = ui::NodeKind::ComboBox;
            outputCombo.label = "Output";
            std::string selectedOutput;
            outputCombo.options = ControllersLayout::BuildEndpointOptions(devices.outputs,
                                                             rowVm.outputStatus,
                                                             rowVm.storedOutput,
                                                             rowVm.outputDeviceLabel,
                                                             selectedOutput);
            outputCombo.selectedOption = selectedOutput;
            outputCombo.bounds = {headerX + ControllersLayout::kEndpointBoxWidth + ControllersLayout::kEndpointBoxGap,
                                  0.0f, ControllersLayout::kEndpointBoxWidth,
                                  ControllersLayout::kControllerHeaderHeight};
            outputCombo.action = ui::Action::WithValue(Actions::kEndpointSelect, std::to_string(controllerIx) + ":output");
            appendControllerChild(std::move(outputCombo));

            if (rowVm.kind == MidiProfileKind::Launchpad)
            {
                std::string selectedVariant;
                const std::vector<ui::ControlOption> variantOptions =
                    ControllersLayout::BuildLaunchpadVariantOptions(vm.LaunchpadVariantIndex(controllerIx), selectedVariant);
                ui::Node variantCombo;
                variantCombo.id = ui::NodeId(NodeIds::ControllerVariant(controllerIx));
                variantCombo.kind = ui::NodeKind::ComboBox;
                variantCombo.label = "Variant";
                variantCombo.options = variantOptions;
                variantCombo.selectedOption = selectedVariant;
                variantCombo.bounds = {headerX + (ControllersLayout::kEndpointBoxWidth +
                                                  ControllersLayout::kEndpointBoxGap) *
                                                     2.0f,
                                       0.0f, ControllersLayout::kVariantBoxWidth,
                                       ControllersLayout::kControllerHeaderHeight};
                variantCombo.action = ui::Action::WithValue(Actions::kVariantSelect, std::to_string(controllerIx));
                appendControllerChild(std::move(variantCombo));
            }

            float lifecycleX = headerX + (ControllersLayout::kEndpointBoxWidth +
                                          ControllersLayout::kEndpointBoxGap) * 2.0f;
            if (rowVm.kind == MidiProfileKind::Launchpad)
            {
                lifecycleX += ControllersLayout::kVariantBoxWidth + ControllersLayout::kEndpointBoxGap;
            }

            ui::Node rename;
            rename.id = ui::NodeId(NodeIds::ControllerRenameDraft(controllerIx));
            rename.kind = ui::NodeKind::TextField;
            rename.label = "Rename";
            rename.text = renameDraftFor(rowVm.name);
            rename.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleDraftWidth,
                             ControllersLayout::kControllerHeaderHeight};
            rename.action = ui::Action::WithValue(Actions::kControllerRenameDraft,
                                                  NodeIds::ControllerActionToken(controllerIx, rowVm.name));
            appendControllerChild(std::move(rename));

            lifecycleX += ControllersLayout::kLifecycleDraftWidth +
                          ControllersLayout::kLifecycleControlGap;
            ui::Node renameButton;
            renameButton.id = ui::NodeId(NodeIds::ControllerRename(controllerIx));
            renameButton.kind = ui::NodeKind::Button;
            renameButton.label = "Rename";
            renameButton.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleRenameWidth,
                                   ControllersLayout::kControllerHeaderHeight};
            renameButton.action = ui::Action::WithValue(Actions::kControllerRename,
                                                        NodeIds::ControllerActionToken(controllerIx, rowVm.name));
            appendControllerChild(std::move(renameButton));
            lifecycleX += ControllersLayout::kLifecycleRenameWidth +
                          ControllersLayout::kLifecycleControlGap;
            ui::Node remove;
            remove.id = ui::NodeId(NodeIds::ControllerDelete(controllerIx));
            remove.kind = ui::NodeKind::Button;
            remove.label = "Delete";
            remove.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleDeleteWidth,
                             ControllersLayout::kControllerHeaderHeight};
            remove.action = ui::Action::WithValue(Actions::kControllerDelete,
                                                   NodeIds::ControllerActionToken(controllerIx, rowVm.name));
            appendControllerChild(std::move(remove));
            lifecycleX += ControllersLayout::kLifecycleDeleteWidth +
                          ControllersLayout::kLifecycleControlGap;
            if (rowVm.hasResolvedWizard)
            {
                ui::Node reconfigure;
                reconfigure.id = ui::NodeId(NodeIds::ControllerReconfigure(controllerIx));
                reconfigure.kind = ui::NodeKind::Button;
                reconfigure.label = "Reconfigure";
                reconfigure.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleReconfigureWidth,
                                      ControllersLayout::kControllerHeaderHeight};
                reconfigure.action = ui::Action::WithValue(Actions::kControllerReconfigure,
                                                            NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                appendControllerChild(std::move(reconfigure));
                lifecycleX += ControllersLayout::kLifecycleReconfigureWidth +
                              ControllersLayout::kLifecycleControlGap;

                ui::Node blacklist;
                blacklist.id = ui::NodeId(NodeIds::ControllerBlacklist(controllerIx));
                blacklist.kind = ui::NodeKind::Button;
                blacklist.label = "Blacklist";
                blacklist.enabled = rowVm.hasCompleteEndpointPair;
                blacklist.bounds = {lifecycleX, 0.0f, ControllersLayout::kLifecycleBlacklistWidth,
                                    ControllersLayout::kControllerHeaderHeight};
                blacklist.action = ui::Action::WithValue(Actions::kControllerBlacklist,
                                                          NodeIds::ControllerActionToken(controllerIx, rowVm.name));
                appendControllerChild(std::move(blacklist));
            }

            scrollY += ControllersLayout::kControllerHeaderHeight + ControllersLayout::kRowGap;

            if (!rowVm.configExpanded)
            {
                continue;
            }

            for (MidiConfigSection section : rowVm.sections)
            {
                ui::Node sectionToggle;
                sectionToggle.id = ui::NodeId(NodeIds::SectionToggle(controllerIx, section));
                sectionToggle.kind = ui::NodeKind::Button;
                const bool expanded = vm.SectionExpanded(controllerIx, section);
                sectionToggle.label = std::string(ControllersLayout::SectionName(section)) + (expanded ? " v" : " >");
                sectionToggle.bounds = {ControllersLayout::kSectionPadding, scrollY, 220.0f, ControllersLayout::kSectionHeaderHeight};
                sectionToggle.action =
                    ui::Action::WithValue(Actions::kToggleSection,
                                          std::to_string(controllerIx) + ":" + ControllersLayout::SectionToken(section));
                appendScrollChild(std::move(sectionToggle));
                scrollY += ControllersLayout::kSectionHeaderHeight;

                if (!expanded)
                {
                    continue;
                }

                ui::Node sectionBody;
                sectionBody.id = ui::NodeId(NodeIds::SectionBody(controllerIx, section));
                sectionBody.kind = ui::NodeKind::Section;
                const std::vector<MidiMappingRowVM> rows = vm.SectionRows(controllerIx, section);
                auto fieldsWidth = [](const std::vector<MidiMappingRowVM::Field>& fields) {
                    float width = 0.0f;
                    for (MidiMappingRowVM::Field field : fields)
                    {
                        width += static_cast<float>(ControllersLayout::FieldEditorWidth(field));
                    }
                    return width;
                };
                float desiredSectionWidth = 420.0f;
                for (const MidiMappingRowVM& row : rows)
                {
                    desiredSectionWidth = std::max(desiredSectionWidth,
                                                   fieldsWidth(row.editableFields) +
                                                       (row.deletable ? ControllersLayout::kDeleteButtonWidth : 0.0f));
                }
                for (MidiMappingRowVM::RowGroup group : vm.AddableGroups(controllerIx, section))
                {
                    desiredSectionWidth = std::max(desiredSectionWidth,
                                                   fieldsWidth(vm.GroupColumnFields(controllerIx, section, group)) +
                                                       ControllersLayout::kAddButtonWidth * 2.0f + 16.0f);
                }
                const float sectionWidth = std::min(scrollWidth - ControllersLayout::kSectionPadding * 2.0f,
                                                    desiredSectionWidth + 16.0f);
                float sectionHeight = 0.0f;
                std::size_t headerIx = 0;
                std::size_t mappingRowIx = 0;
                std::optional<MidiMappingRowVM::RowGroup> previousGroup;
                std::optional<std::vector<MidiMappingRowVM::Field>> previousFields;
                std::set<MidiMappingRowVM::RowGroup> seenGroups;

                auto appendSectionChild = [&](ui::Node node) {
                    sectionBody.children.push_back(node.id);
                    tree.nodes.push_back(std::move(node));
                };

                auto appendGroupHeader = [&](MidiMappingRowVM::RowGroup group,
                                             const std::vector<MidiMappingRowVM::Field>& fields,
                                             bool isFirstHeaderForGroup,
                                             MidiMappingRowVM::Kind kind) {
                    ui::Node header;
                    header.id = ui::NodeId(NodeIds::GroupHeader(controllerIx, section, headerIx));
                    header.kind = ui::NodeKind::Row;
                    header.label = ControllersLayout::RowGroupCaption(group, kind);
                    header.bounds = {0.0f, sectionHeight, sectionWidth, ControllersLayout::kGroupHeaderHeight};
                    float labelX = 0.0f;
                    const bool showColumnLabels = fields.size() > 1;
                    for (std::size_t fieldIx = 0; showColumnLabels && fieldIx < fields.size(); ++fieldIx)
                    {
                        const MidiMappingRowVM::Field field = fields[fieldIx];
                        const float fieldWidth = static_cast<float>(ControllersLayout::FieldEditorWidth(field));
                        ui::Node label;
                        label.id = ui::NodeId(NodeIds::GroupColumnLabel(controllerIx, section, headerIx, fieldIx));
                        label.kind = ui::NodeKind::Label;
                        label.text = FieldShortLabel(field);
                        label.bounds = {labelX + 4.0f, 21.0f, std::max(1.0f, fieldWidth - 8.0f), 16.0f};
                        header.children.push_back(label.id);
                        tree.nodes.push_back(std::move(label));
                        labelX += fieldWidth;
                    }
                    if (isFirstHeaderForGroup && vm.GroupSupportsAdd(controllerIx, section, group))
                    {
                        ui::Node addSingle;
                        addSingle.id = ui::NodeId(NodeIds::GroupAddSingle(controllerIx, section, headerIx));
                        addSingle.kind = ui::NodeKind::Button;
                        addSingle.label = "Add";
                        addSingle.bounds = {header.bounds.width - ControllersLayout::kAddButtonWidth * 2.0f - 8.0f, 5.0f,
                                            ControllersLayout::kAddButtonWidth, 28.0f};
                        addSingle.action = ui::Action::WithValue(
                            Actions::kAddSingle,
                            std::to_string(controllerIx) + ":" + ControllersLayout::SectionToken(section) + ":" +
                                ControllersLayout::RowGroupToken(group));
                        header.children.push_back(addSingle.id);
                        tree.nodes.push_back(std::move(addSingle));

                        if (vm.GroupSupportsBlocks(controllerIx, section, group))
                        {
                            ui::Node addBlock;
                            addBlock.id = ui::NodeId(NodeIds::GroupAddBlock(controllerIx, section, headerIx));
                            addBlock.kind = ui::NodeKind::Button;
                            addBlock.label = "Block";
                            addBlock.bounds = {header.bounds.width - ControllersLayout::kAddButtonWidth - 4.0f, 5.0f,
                                               ControllersLayout::kAddButtonWidth, 28.0f};
                            addBlock.action = ui::Action::WithValue(
                                Actions::kAddBlock,
                                std::to_string(controllerIx) + ":" + ControllersLayout::SectionToken(section) + ":" +
                                    ControllersLayout::RowGroupToken(group));
                            header.children.push_back(addBlock.id);
                            tree.nodes.push_back(std::move(addBlock));
                        }
                    }
                    appendSectionChild(std::move(header));
                    sectionHeight += ControllersLayout::kGroupHeaderHeight;
                    ++headerIx;
                };

                auto appendMappingRow = [&](const MidiMappingRowVM& rowVmRow) {
                    ui::Node mappingRow;
                    mappingRow.id = ui::NodeId(NodeIds::MappingRow(controllerIx, section, mappingRowIx));
                    mappingRow.kind = ui::NodeKind::Row;
                    mappingRow.bounds = {0.0f, sectionHeight, sectionWidth, ControllersLayout::kMappingRowHeight};
                    float fieldX = 0.0f;
                    for (MidiMappingRowVM::Field field : rowVmRow.editableFields)
                    {
                        ui::Node fieldNode;
                        fieldNode.id = ui::NodeId(NodeIds::MappingField(controllerIx, section, mappingRowIx, field));
                        const float fieldWidth = static_cast<float>(ControllersLayout::FieldEditorWidth(field));
                        fieldNode.bounds = {fieldX, 0.0f, fieldWidth, ControllersLayout::kMappingRowHeight};
                        fieldX += fieldWidth;

                        if (field == MidiMappingRowVM::Field::MessageKind)
                        {
                            fieldNode.kind = ui::NodeKind::ComboBox;
                            const auto& catalog = UISystemMessageCatalog();
                            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix)
                            {
                                fieldNode.options.push_back({std::to_string(ix), catalog[static_cast<std::size_t>(ix)].label});
                            }
                            const int current = vm.UISystemMessageIndex(controllerIx, section, mappingRowIx);
                            fieldNode.selectedOption = current >= 0 ? std::to_string(current) : "0";
                        }
                        else if (field == MidiMappingRowVM::Field::EncoderMode)
                        {
                            fieldNode.kind = ui::NodeKind::ComboBox;
                            const auto& catalog = EncoderModeCatalog();
                            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix)
                            {
                                fieldNode.options.push_back({std::to_string(ix), catalog[static_cast<std::size_t>(ix)]});
                            }
                            double current = 0.0;
                            if (vm.RowFieldValue(controllerIx, section, mappingRowIx, field, current))
                            {
                                fieldNode.selectedOption = std::to_string(static_cast<int>(current));
                            }
                        }
                        else if (field == MidiMappingRowVM::Field::AddressType)
                        {
                            fieldNode.kind = ui::NodeKind::ComboBox;
                            const auto& catalog = ControlAddressTypeCatalog();
                            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix)
                            {
                                fieldNode.options.push_back(
                                    {std::to_string(ix), catalog[static_cast<std::size_t>(ix)]});
                            }
                            double current = 0.0;
                            if (vm.RowFieldValue(controllerIx, section, mappingRowIx, field, current))
                            {
                                const int currentIx = static_cast<int>(current);
                                if (current == static_cast<double>(currentIx) && currentIx >= 0 &&
                                    currentIx < static_cast<int>(catalog.size()))
                                {
                                    fieldNode.selectedOption = std::to_string(currentIx);
                                }
                            }
                        }
                        else if (field == MidiMappingRowVM::Field::BlockMessageType)
                        {
                            fieldNode.kind = ui::NodeKind::ComboBox;
                            const auto& catalog = BlockableMessageCatalog();
                            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix)
                            {
                                fieldNode.options.push_back({std::to_string(ix), catalog[static_cast<std::size_t>(ix)]});
                            }
                            const int current = vm.BlockMessageTypeIndex(controllerIx, section, mappingRowIx);
                            fieldNode.selectedOption = current >= 0 ? std::to_string(current) : "0";
                        }
                        else if (field == MidiMappingRowVM::Field::BlockRowMajor ||
                                 field == MidiMappingRowVM::Field::BlockOutputFeedback)
                        {
                            fieldNode.kind = ui::NodeKind::Toggle;
                            fieldNode.label = FieldShortLabel(field);
                            double current = 0.0;
                            if (vm.RowFieldValue(controllerIx, section, mappingRowIx, field, current))
                            {
                                fieldNode.checked = current != 0.0;
                            }
                        }
                        else
                        {
                            double initial = 0.0;
                            if (!vm.RowFieldValue(controllerIx, section, mappingRowIx, field, initial))
                            {
                                continue;
                            }
                            fieldNode.kind = ui::NodeKind::TextField;
                            fieldNode.text = ControllersLayout::FormatFieldValue(field, initial);
                        }

                        fieldNode.action = ui::Action::WithValue(
                            Actions::kMappingFieldCommit,
                            std::to_string(controllerIx) + ":" + ControllersLayout::SectionToken(section) + ":" +
                                std::to_string(mappingRowIx) + ":" + ControllersLayout::FieldToken(field));
                        mappingRow.children.push_back(fieldNode.id);
                        tree.nodes.push_back(std::move(fieldNode));
                    }

                    if (rowVmRow.deletable)
                    {
                        ui::Node deleteButton;
                        deleteButton.id = ui::NodeId(NodeIds::MappingDelete(controllerIx, section, mappingRowIx));
                        deleteButton.kind = ui::NodeKind::Button;
                        deleteButton.label = "x";
                        deleteButton.bounds = {fieldX, 0.0f, ControllersLayout::kDeleteButtonWidth, ControllersLayout::kMappingRowHeight};
                        deleteButton.action = ui::Action::WithValue(
                            Actions::kDeleteRow,
                            std::to_string(controllerIx) + ":" + ControllersLayout::SectionToken(section) + ":" +
                                std::to_string(mappingRowIx));
                        mappingRow.children.push_back(deleteButton.id);
                        tree.nodes.push_back(std::move(deleteButton));
                    }

                    appendSectionChild(std::move(mappingRow));
                    sectionHeight += ControllersLayout::kMappingRowHeight;
                    ++mappingRowIx;
                };

                for (std::size_t rowIx = 0; rowIx < rows.size(); ++rowIx)
                {
                    const MidiMappingRowVM::RowGroup group = rows[rowIx].group;
                    if (!previousGroup.has_value() || *previousGroup != group ||
                        *previousFields != rows[rowIx].editableFields)
                    {
                        const bool isFirstHeaderForGroup = seenGroups.insert(group).second;
                        appendGroupHeader(group, rows[rowIx].editableFields, isFirstHeaderForGroup,
                                          rows[rowIx].kind);
                        previousGroup = group;
                        previousFields = rows[rowIx].editableFields;
                    }
                    appendMappingRow(rows[rowIx]);
                }

                for (MidiMappingRowVM::RowGroup group : vm.AddableGroups(controllerIx, section))
                {
                    if (seenGroups.count(group) != 0)
                    {
                        continue;
                    }
                    appendGroupHeader(group, vm.GroupColumnFields(controllerIx, section, group), true,
                                      MidiMappingRowVM::Kind::Individual);
                }

                sectionBody.bounds = {ControllersLayout::kSectionPadding, scrollY, sectionWidth, sectionHeight};
                appendScrollChild(std::move(sectionBody));
                scrollY += sectionHeight + ControllersLayout::kRowGap;
            }
        }

        ui::Node addRow;
        addRow.id = NodeIds::kAddRow;
        addRow.kind = ui::NodeKind::Row;
        addRow.bounds = {0.0f, scrollY, scrollWidth, ControllersLayout::kAddRowHeight};
        tree.nodes[scrollAreaIndex].children.push_back(addRow.id);
        const std::size_t addRowNodeIndex = tree.nodes.size();
        tree.nodes.push_back(std::move(addRow));
        auto appendAddRowChild = [&](ui::Node node) {
            tree.nodes[addRowNodeIndex].children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        ui::Node addName;
        addName.id = NodeIds::kAddName;
        addName.kind = ui::NodeKind::TextField;
        addName.label = "New controller name";
        addName.text = addControllerName;
        addName.bounds = {0.0f, 0.0f, 180.0f, ControllersLayout::kAddRowHeight};
        addName.action = ui::Action::Named(Actions::kAddNameDraft);
        appendAddRowChild(std::move(addName));

        ui::Node addKind;
        addKind.id = NodeIds::kAddKind;
        addKind.kind = ui::NodeKind::ComboBox;
        addKind.label = "Kind";
        addKind.options = ControllersLayout::BuildAddControllerKindOptions();
        addKind.selectedOption = addControllerKindId.empty() ? "wrldbldr" : addControllerKindId;
        addKind.bounds = {188.0f, 0.0f, 140.0f, ControllersLayout::kAddRowHeight};
        addKind.action = ui::Action::Named(Actions::kAddKindDraft);
        appendAddRowChild(std::move(addKind));

        ui::Node addButton;
        addButton.id = NodeIds::kAddButton;
        addButton.kind = ui::NodeKind::Button;
        addButton.label = "Add";
        addButton.bounds = {336.0f, 0.0f, 72.0f, ControllersLayout::kAddRowHeight};
        addButton.action = ui::Action::Named(Actions::kAddController);
        appendAddRowChild(std::move(addButton));

        scrollY += ControllersLayout::kAddRowHeight;
        tree.nodes[scrollAreaIndex].scrollContentWidth = scrollWidth;
        tree.nodes[scrollAreaIndex].scrollContentHeight = std::max(tree.nodes[scrollAreaIndex].bounds.height, scrollY);

        ui::Node statusLine;
        statusLine.id = NodeIds::kStatus;
        statusLine.kind = ui::NodeKind::StatusText;
        statusLine.text = statusText.empty() ? "Ready" : statusText;
        statusLine.bounds = {contentX, scrollBottom + ControllersLayout::kRowGap, contentWidth, ControllersLayout::kStatusRowHeight};
        appendChild(std::move(statusLine));

        return tree;
    }

    ControllersPageCallbacks m_callbacks;
    MidiConfigViewModel m_vm;
    MidiDeviceList m_devices;
    WizardDiscovery m_discovery;
    std::optional<WizardSession> m_wizardSession;
    bool m_wizardChooserOpen = false;
    std::string m_wizardChooserStatus;
    ui::Bounds m_contentBounds{0.0f, 0.0f, 640.0f, 480.0f};
    std::string m_statusText = "Ready";
    std::string m_addControllerName;
    std::map<std::string, std::string> m_renameDrafts;
    std::string m_addControllerKindId = "wrldbldr";
    bool m_dirty = true;
    std::string m_lastFingerprint;
    std::uint64_t m_treeRevision = 1;
    ActionHandler m_outerHandler_;
    std::function<bool()> m_focusGuard;
};

}  // namespace synth::runtime_ui
