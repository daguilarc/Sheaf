#pragma once

// JUCE-free Controllers page presentation and action layer (OpenSpec tasks
// 5.1–5.3). Derives a semantic tree from MidiConfigViewModel and MIDI
// connection state; routes every user action through existing view-model APIs
// and commits accepted edits through a host-provided callback (typically
// engine.EditInstrument).

#include "synth/MidiConfigViewModel.hpp"
#include "synth/MidiReconcile.hpp"
#include "synth/PortableUI.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <functional>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

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

inline std::string ControllerRow(std::size_t controllerIx)
{
    return "runtime.controllers.row." + std::to_string(controllerIx);
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

}  // namespace Actions

namespace ControllersLayout {

inline constexpr float kPageMargin = 4.0f;
inline constexpr float kBackRowHeight = 32.0f;
inline constexpr float kBackButtonWidth = 80.0f;
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
inline constexpr float kControllerHeaderMinWidth =
    kHeaderControlsX + kStatusDotsWidth + 4.0f + kEndpointBoxWidth + kEndpointBoxGap + kEndpointBoxWidth +
    kEndpointBoxGap + kVariantBoxWidth;
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

inline std::vector<ui::ControlOption> BuildEndpointOptions(const std::vector<MidiDeviceInfoRef>& devices,
                                                           MidiEndpointStatus status,
                                                           const std::string& storedLabel,
                                                           std::string& selectedOptionId)
{
    std::vector<ui::ControlOption> options;
    options.push_back({kEndpointNoneOptionId, "(none)"});
    selectedOptionId = kEndpointNoneOptionId;

    for (const MidiDeviceInfoRef& device : devices)
    {
        options.push_back({device.identifier, device.name});
        if (status == MidiEndpointStatus::Online && device.name == storedLabel)
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
    std::function<void(MidiInstrumentConfig)> commitInstrument;
    std::function<void(std::string)> setStatus;
    std::function<void()> onBack;
};

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
        return BuildControllersPageTree(m_vm,
                                        m_devices,
                                        m_contentBounds,
                                        m_statusText,
                                        m_addControllerName,
                                        m_addControllerKindId);
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
        return action.name == Actions::kToggleConfig || action.name == Actions::kToggleSection ||
               action.name == Actions::kDeleteRow || action.name == Actions::kAddSingle ||
               action.name == Actions::kAddBlock || action.name == Actions::kEndpointSelect ||
               action.name == Actions::kVariantSelect || action.name == Actions::kMappingFieldCommit ||
               action.name == Actions::kAddController;
    }

private:
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

    void Commit(MidiInstrumentConfig out)
    {
        if (m_callbacks.commitInstrument)
        {
            m_callbacks.commitInstrument(std::move(out));
        }
        m_dirty = true;
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
        }
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

    static ui::NodeTree BuildControllersPageTree(const MidiConfigViewModel& vm,
                                                   const MidiDeviceList& devices,
                                                   ui::Bounds area,
                                                   const std::string& statusText,
                                                   const std::string& addControllerName,
                                                   const std::string& addControllerKindId)
    {
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

            ui::Node disclosure;
            disclosure.id = ui::NodeId(NodeIds::ControllerDisclosure(controllerIx));
            disclosure.kind = ui::NodeKind::Button;
            disclosure.label = rowVm.configExpanded ? "v" : ">";
            disclosure.bounds = {0.0f, 0.0f, 24.0f, ControllersLayout::kControllerHeaderHeight};
            disclosure.action = ui::Action::WithValue(Actions::kToggleConfig, std::to_string(controllerIx));
            appendControllerChild(std::move(disclosure));

            ui::Node nameLabel;
            nameLabel.id = ui::NodeId(NodeIds::ControllerName(controllerIx));
            nameLabel.kind = ui::NodeKind::Label;
            nameLabel.text = rowVm.name;
            nameLabel.bounds = {28.0f, 0.0f, 120.0f, ControllersLayout::kControllerHeaderHeight};
            appendControllerChild(std::move(nameLabel));

            ui::Node kindLabel;
            kindLabel.id = ui::NodeId(NodeIds::ControllerKind(controllerIx));
            kindLabel.kind = ui::NodeKind::Label;
            kindLabel.text = MidiProfileKindName(rowVm.kind);
            kindLabel.bounds = {152.0f, 0.0f, 100.0f, ControllersLayout::kControllerHeaderHeight};
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

            headerX += ControllersLayout::kStatusDotsWidth + 4.0f;

            std::string selectedInput;
            ui::Node inputCombo;
            inputCombo.id = ui::NodeId(NodeIds::ControllerInput(controllerIx));
            inputCombo.kind = ui::NodeKind::ComboBox;
            inputCombo.label = "Input";
            inputCombo.options =
                ControllersLayout::BuildEndpointOptions(devices.inputs, rowVm.inputStatus, rowVm.inputDeviceLabel, selectedInput);
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
    ui::Bounds m_contentBounds{0.0f, 0.0f, 640.0f, 480.0f};
    std::string m_statusText = "Ready";
    std::string m_addControllerName;
    std::string m_addControllerKindId = "wrldbldr";
    bool m_dirty = true;
    std::string m_lastFingerprint;
    std::uint64_t m_treeRevision = 1;
    ActionHandler m_outerHandler_;
    std::function<bool()> m_focusGuard;
};

}  // namespace synth::runtime_ui
