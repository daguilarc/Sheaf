#pragma once

// JUCE-free runtime page models: sidebar, Audio page, and File page semantic
// trees plus action names and layout helpers (OpenSpec tasks 4.1–4.3).

#include "synth/PatchBrowser.hpp"
#include "synth/PortableUI.hpp"
#include "synth/MasterClock.hpp"
#include "synth/MidiController.hpp"

#include <algorithm>
#include <charconv>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace synth::runtime_ui {

inline constexpr const char* kSystemDefaultOptionId = "system_default";
inline constexpr const char* kSystemDefaultOptionLabel = "System Default";

namespace NodeIds {

inline constexpr const char* kSidebarRoot = "runtime.sidebar.root";
inline constexpr const char* kSidebarAudio = "runtime.sidebar.audio";
inline constexpr const char* kSidebarControllers = "runtime.sidebar.controllers";
inline constexpr const char* kSidebarControllersWarning = "runtime.sidebar.controllers.warning";
inline constexpr const char* kSidebarSync = "runtime.sidebar.sync";
inline constexpr const char* kSidebarFile = "runtime.sidebar.file";
inline constexpr const char* kSidebarDeadline = "runtime.sidebar.deadline";

inline constexpr const char* kAudioRoot = "runtime.audio.root";
inline constexpr const char* kAudioBack = "runtime.audio.back";
inline constexpr const char* kAudioOutput = "runtime.audio.output";
inline constexpr const char* kAudioInput = "runtime.audio.input";
inline constexpr const char* kAudioDeviceLine = "runtime.audio.device_line";
inline constexpr const char* kAudioStatusLine = "runtime.audio.status_line";

inline constexpr const char* kSyncRoot = "runtime.sync.root";
inline constexpr const char* kSyncBack = "runtime.sync.back";
inline constexpr const char* kSyncSendClock = "runtime.sync.send_clock";
inline constexpr const char* kSyncReceiveClock = "runtime.sync.receive_clock";
inline constexpr const char* kSyncSendTransport = "runtime.sync.send_transport";
inline constexpr const char* kSyncReceiveTransport = "runtime.sync.receive_transport";
inline constexpr const char* kSyncPpqn = "runtime.sync.ppqn";
inline constexpr const char* kSyncValidation = "runtime.sync.validation";
inline constexpr const char* kSyncWarning = "runtime.sync.warning";
inline constexpr const char* kSyncBpm = "runtime.sync.bpm";
inline constexpr const char* kSyncLock = "runtime.sync.lock";
inline constexpr const char* kSyncSource = "runtime.sync.source";
inline constexpr const char* kSyncOutputLatency = "runtime.sync.output_latency";
inline constexpr const char* kSyncIgnoredInput = "runtime.sync.ignored_input";
inline constexpr const char* kSyncLateEvents = "runtime.sync.late_events";
inline constexpr const char* kSyncDroppedOutput = "runtime.sync.dropped_output";

inline constexpr const char* kFileRoot = "runtime.file.root";
inline constexpr const char* kFileBack = "runtime.file.back";
inline constexpr const char* kFileNew = "runtime.file.new";
inline constexpr const char* kFileSave = "runtime.file.save";
inline constexpr const char* kFileSaveAs = "runtime.file.save_as";
inline constexpr const char* kFileLoad = "runtime.file.load";
inline constexpr const char* kFileRevert = "runtime.file.revert";
inline constexpr const char* kFileBackground = "runtime.file.background";
inline constexpr const char* kFileHeader = "runtime.file.header";
inline constexpr const char* kFilePatchRoot = "runtime.file.patch_root";
inline constexpr const char* kFileCommandStrip = "runtime.file.command_strip";
inline constexpr const char* kFileIdleRegion = "runtime.file.idle";
inline constexpr const char* kFilePatchName = "runtime.file.patch_name";
inline constexpr const char* kFileStatus = "runtime.file.status";
inline constexpr const char* kFileBrowser = "runtime.file.browser";
inline constexpr const char* kFileBrowserTitle = "runtime.file.browser.title";
inline constexpr const char* kFileBrowserCurrentPath = "runtime.file.browser.current_path";
inline constexpr const char* kFileBrowserSaveName = "runtime.file.browser.save_name";
inline constexpr const char* kFileBrowserParent = "runtime.file.browser.parent";
inline constexpr const char* kFileBrowserConfirm = "runtime.file.browser.confirm";
inline constexpr const char* kFileBrowserCancel = "runtime.file.browser.cancel";
inline constexpr const char* kFileVersions = "runtime.file.versions";
inline constexpr const char* kFileVersionsTitle = "runtime.file.versions.title";

inline std::string FileBrowserEntry(std::size_t entryIx)
{
    return "runtime.file.browser.entry." + std::to_string(entryIx);
}

inline std::string FileBrowserEntryOpen(std::size_t entryIx)
{
    return FileBrowserEntry(entryIx) + ".open";
}

inline std::string FileVersionEntry(std::size_t entryIx)
{
    return "runtime.file.versions.entry." + std::to_string(entryIx);
}

}  // namespace NodeIds

namespace Actions {

inline constexpr const char* kSidebarAudio = "runtime.sidebar.audio";
inline constexpr const char* kSidebarControllers = "runtime.sidebar.controllers";
inline constexpr const char* kSidebarSync = "runtime.sidebar.sync";
inline constexpr const char* kSidebarFile = "runtime.sidebar.file";

inline constexpr const char* kAudioBack = "runtime.audio.back";
inline constexpr const char* kAudioOutputSelect = "runtime.audio.output.select";
inline constexpr const char* kAudioInputSelect = "runtime.audio.input.select";

inline constexpr const char* kSyncBack = "runtime.sync.back";
inline constexpr const char* kSyncSendClock = "runtime.sync.send_clock";
inline constexpr const char* kSyncReceiveClock = "runtime.sync.receive_clock";
inline constexpr const char* kSyncSendTransport = "runtime.sync.send_transport";
inline constexpr const char* kSyncReceiveTransport = "runtime.sync.receive_transport";
inline constexpr const char* kSyncPpqn = "runtime.sync.ppqn";

inline constexpr const char* kFileBack = "runtime.file.back";
inline constexpr const char* kFileNew = "runtime.file.new";
inline constexpr const char* kFileSave = "runtime.file.save";
inline constexpr const char* kFileSaveAs = "runtime.file.save_as";
inline constexpr const char* kFileLoad = "runtime.file.load";
inline constexpr const char* kFileRevert = "runtime.file.revert";
inline constexpr const char* kFileBrowserSaveName = "runtime.file.browser.save_name";
inline constexpr const char* kFileBrowserSelect = "runtime.file.browser.select";
inline constexpr const char* kFileBrowserAccept = "runtime.file.browser.accept";
inline constexpr const char* kFileBrowserOpen = "runtime.file.browser.open";
inline constexpr const char* kFileBrowserParent = "runtime.file.browser.parent";
inline constexpr const char* kFileBrowserOverwriteSaveAs = "runtime.file.browser.overwrite_save_as";
inline constexpr const char* kFileBrowserConfirm = "runtime.file.browser.confirm";
inline constexpr const char* kFileBrowserCancel = "runtime.file.browser.cancel";
inline constexpr const char* kFileConfirmedSaveAs = "runtime.file.confirmed.save_as";
inline constexpr const char* kFileConfirmedOverwriteSaveAs = "runtime.file.confirmed.overwrite_save_as";
inline constexpr const char* kFileConfirmedLoad = "runtime.file.confirmed.load";

}  // namespace Actions

struct SidebarSnapshot
{
    float deadlinePercent = 0.0f;
    bool controllersWarning = false;
};

struct AudioDeviceOption
{
    std::string id;
    std::string label;
};

struct AudioPageSnapshot
{
    std::vector<AudioDeviceOption> outputOptions;
    std::vector<AudioDeviceOption> inputOptions;
    std::string selectedOutputId = kSystemDefaultOptionId;
    std::string selectedInputId = kSystemDefaultOptionId;
    bool showInputCombo = false;
    std::string deviceLineText;
    std::string statusLineText;
};

struct SyncPageStatus
{
    double currentBpm = 120.0;
    std::string lockState = "Internal";
    std::string sourceName = "Internal (no external source)";
    std::uint64_t outputLatencyMicros = 0;
    std::uint64_t ignoredInputCount = 0;
    std::uint64_t lateEventCount = 0;
    std::uint64_t droppedOutputCount = 0;
};

inline const char* ClockAcquisitionStatusName(ClockAcquisitionState state) noexcept
{
    switch (state)
    {
        case ClockAcquisitionState::Internal:
            return "Internal";
        case ClockAcquisitionState::Acquiring:
            return "Acquiring";
        case ClockAcquisitionState::Locked:
            return "Locked";
        case ClockAcquisitionState::FreeRun:
            return "FreeRun";
    }
    return "Internal";
}

inline SyncPageStatus BuildSyncPageStatus(const ClockDiagnostics& diagnostics,
                                          const MidiInstrumentConfig& instrument)
{
    SyncPageStatus status;
    status.currentBpm = diagnostics.currentBpm;
    status.lockState = ClockAcquisitionStatusName(diagnostics.acquisition);
    status.outputLatencyMicros = diagnostics.outputLatencyMicros;
    status.ignoredInputCount = diagnostics.ignoredInputCount;
    status.lateEventCount = diagnostics.lateEventCount;
    status.droppedOutputCount = diagnostics.droppedOutputCount;
    if (!diagnostics.hasActiveExternalSource)
    {
        status.sourceName = "Internal (no external source)";
        return status;
    }
    if (diagnostics.activeExternalSourceSlot < instrument.controllers.size() &&
        !instrument.controllers[diagnostics.activeExternalSourceSlot].name.empty())
    {
        status.sourceName = instrument.controllers[diagnostics.activeExternalSourceSlot].name;
        return status;
    }
    status.sourceName =
        "External source slot " + std::to_string(diagnostics.activeExternalSourceSlot);
    return status;
}

enum class FileBrowserKind
{
    SaveAs,
    Load
};

struct FilePageSnapshot
{
    std::string patchNameText = "(no patch)";
    std::string statusText = "Ready";
    bool hasCurrentPatch = false;
    std::string patchesRoot;
    bool browserOpen = false;
    FileBrowserKind browserKind = FileBrowserKind::SaveAs;
    std::string browserCurrentPathText = "/";
    std::string browserSaveName;
    struct BrowserEntry
    {
        std::string name;
        std::string relativePath;
        bool selected = false;
    };
    std::vector<BrowserEntry> browserEntries;
    struct VersionEntry
    {
        std::string label;
        std::string path;
    };
    std::vector<VersionEntry> versionEntries;
};

namespace Layout {

inline constexpr float kSidebarWidth = 96.0f;
inline constexpr float kSidebarButtonHeight = 40.0f;
inline constexpr float kPageMargin = 4.0f;
inline constexpr float kBackRowHeight = 32.0f;
inline constexpr float kBackButtonWidth = 80.0f;
inline constexpr float kRowGap = 4.0f;
inline constexpr float kComboRowHeight = 32.0f;
inline constexpr float kStatusRowHeight = 32.0f;
inline constexpr float kPatchButtonWidth = 82.0f;
inline constexpr float kPatchRowHeight = 34.0f;
inline constexpr float kPatchNameRowHeight = 28.0f;
inline constexpr float kBrowserHeaderHeight = 28.0f;
inline constexpr float kBrowserCommandHeight = 32.0f;
inline constexpr float kBrowserRowHeight = 30.0f;
inline constexpr float kBrowserButtonWidth = 78.0f;
inline constexpr float kBrowserOpenButtonWidth = 58.0f;
inline constexpr float kFilePanelPadding = 10.0f;

inline ui::Bounds SidebarRootBounds()
{
    return {0.0f, 0.0f, kSidebarWidth, kSidebarButtonHeight * 5.0f};
}

inline std::string FormatDeadlineText(float percent)
{
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.1f%%", static_cast<double>(percent));
    return buffer;
}

inline std::vector<AudioDeviceOption> BuildDeviceOptions(const std::vector<std::string>& deviceNames)
{
    std::vector<AudioDeviceOption> options;
    options.push_back({kSystemDefaultOptionId, kSystemDefaultOptionLabel});
    for (const std::string& name : deviceNames)
    {
        options.push_back({name, name});
    }
    return options;
}

inline std::string SelectedDeviceOptionId(const std::string& deviceName,
                                          const std::vector<AudioDeviceOption>& options)
{
    if (deviceName.empty())
    {
        return kSystemDefaultOptionId;
    }
    for (const AudioDeviceOption& option : options)
    {
        if (option.id == deviceName)
        {
            return deviceName;
        }
    }
    return kSystemDefaultOptionId;
}

inline std::string DeviceNameFromOptionId(const std::string& optionId)
{
    if (optionId == kSystemDefaultOptionId)
    {
        return {};
    }
    return optionId;
}

inline std::string BuildNegotiatedDeviceLine(const std::string& deviceName,
                                             double sampleRate,
                                             int bufferSizeSamples)
{
    if (deviceName.empty())
    {
        return "No audio device";
    }
    return deviceName + ": " + std::to_string(static_cast<int>(sampleRate)) + " Hz, " +
           std::to_string(bufferSizeSamples) + " frames";
}

}  // namespace Layout

inline ui::NodeTree BuildSidebarTree(const SidebarSnapshot& snapshot)
{
    const ui::Bounds rootBounds = Layout::SidebarRootBounds();
    ui::NodeTree tree;
    ui::Node root;
    root.id = NodeIds::kSidebarRoot;
    root.kind = ui::NodeKind::Root;
    root.bounds = rootBounds;
    tree.nodes.push_back(root);

    auto appendChild = [&](ui::Node node) {
        tree.nodes.front().children.push_back(node.id);
        tree.nodes.push_back(std::move(node));
    };

    ui::Node audioButton;
    audioButton.id = NodeIds::kSidebarAudio;
    audioButton.kind = ui::NodeKind::Button;
    audioButton.label = "Audio";
    audioButton.bounds = {0.0f, 0.0f, Layout::kSidebarWidth, Layout::kSidebarButtonHeight};
    audioButton.action = ui::Action::Named(Actions::kSidebarAudio);
    appendChild(std::move(audioButton));

    ui::Node controllersButton;
    controllersButton.id = NodeIds::kSidebarControllers;
    controllersButton.kind = ui::NodeKind::Button;
    controllersButton.label = "Controllers";
    controllersButton.bounds = {0.0f,
                                Layout::kSidebarButtonHeight,
                                Layout::kSidebarWidth,
                                Layout::kSidebarButtonHeight};
    controllersButton.action = ui::Action::Named(Actions::kSidebarControllers);
    appendChild(std::move(controllersButton));

    if (snapshot.controllersWarning)
    {
        ui::Node controllersWarning;
        controllersWarning.id = NodeIds::kSidebarControllersWarning;
        controllersWarning.kind = ui::NodeKind::StatusText;
        controllersWarning.text = "!";
        controllersWarning.bounds = {Layout::kSidebarWidth - 22.0f,
                                     Layout::kSidebarButtonHeight,
                                     18.0f,
                                     Layout::kSidebarButtonHeight};
        appendChild(std::move(controllersWarning));
    }

    ui::Node syncButton;
    syncButton.id = NodeIds::kSidebarSync;
    syncButton.kind = ui::NodeKind::Button;
    syncButton.label = "Sync";
    syncButton.bounds = {0.0f,
                         Layout::kSidebarButtonHeight * 2.0f,
                         Layout::kSidebarWidth,
                         Layout::kSidebarButtonHeight};
    syncButton.action = ui::Action::Named(Actions::kSidebarSync);
    appendChild(std::move(syncButton));

    ui::Node fileButton;
    fileButton.id = NodeIds::kSidebarFile;
    fileButton.kind = ui::NodeKind::Button;
    fileButton.label = "File";
    fileButton.bounds = {0.0f,
                         Layout::kSidebarButtonHeight * 3.0f,
                         Layout::kSidebarWidth,
                         Layout::kSidebarButtonHeight};
    fileButton.action = ui::Action::Named(Actions::kSidebarFile);
    appendChild(std::move(fileButton));

    ui::Node deadlineLabel;
    deadlineLabel.id = NodeIds::kSidebarDeadline;
    deadlineLabel.kind = ui::NodeKind::StatusText;
    deadlineLabel.text = Layout::FormatDeadlineText(snapshot.deadlinePercent);
    deadlineLabel.bounds = {0.0f,
                            Layout::kSidebarButtonHeight * 4.0f,
                            Layout::kSidebarWidth,
                            Layout::kSidebarButtonHeight};
    appendChild(std::move(deadlineLabel));

    return tree;
}

struct SyncPageSnapshot
{
    SyncConfig staged{};
    SyncPageStatus status{};
    std::string validationText;
    std::string warningText;
};

inline std::string FormatSyncBpm(double bpm)
{
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "Current BPM: %.2f", bpm);
    return buffer;
}

inline std::string FormatSyncOutputLatency(std::uint64_t latencyMicros)
{
    char buffer[64];
    std::snprintf(buffer,
                  sizeof(buffer),
                  "Output latency: %.3f ms",
                  static_cast<double>(latencyMicros) / 1000.0);
    return buffer;
}

inline ui::NodeTree BuildSyncPageTree(const SyncPageSnapshot& snapshot, ui::Bounds area)
{
    ui::NodeTree tree;
    ui::Node root;
    root.id = NodeIds::kSyncRoot;
    root.kind = ui::NodeKind::Root;
    root.bounds = area;
    tree.nodes.push_back(root);

    auto appendChild = [&](ui::Node node) {
        tree.nodes.front().children.push_back(node.id);
        tree.nodes.push_back(std::move(node));
    };

    const float contentX = Layout::kPageMargin;
    const float contentWidth = std::max(0.0f, area.width - Layout::kPageMargin * 2.0f);
    float y = Layout::kPageMargin;

    ui::Node back;
    back.id = NodeIds::kSyncBack;
    back.kind = ui::NodeKind::Button;
    back.label = "Back";
    back.bounds = {contentX,
                   y,
                   std::min(Layout::kBackButtonWidth, contentWidth),
                   Layout::kBackRowHeight};
    back.action = ui::Action::Named(Actions::kSyncBack);
    appendChild(std::move(back));
    y += Layout::kBackRowHeight + Layout::kRowGap;

    constexpr std::size_t kRemainingRows = 14;
    const float remainingHeight =
        std::max(0.0f, area.height - Layout::kPageMargin - y);
    const float gap = remainingHeight >= 280.0f ? 3.0f : 1.0f;
    const float rowHeight = std::max(
        1.0f,
        std::min(28.0f,
                 (remainingHeight - gap * static_cast<float>(kRemainingRows - 1)) /
                     static_cast<float>(kRemainingRows)));

    auto appendRow = [&](ui::Node node) {
        node.bounds = {contentX, y, contentWidth, rowHeight};
        appendChild(std::move(node));
        y += rowHeight + gap;
    };
    auto appendToggle = [&](const char* id,
                            const char* label,
                            bool checked,
                            const char* action) {
        ui::Node node;
        node.id = id;
        node.kind = ui::NodeKind::Toggle;
        node.label = label;
        node.checked = checked;
        node.action = ui::Action::Named(action);
        appendRow(std::move(node));
    };
    appendToggle(NodeIds::kSyncSendClock,
                 "Send clock",
                 snapshot.staged.sendClock,
                 Actions::kSyncSendClock);
    appendToggle(NodeIds::kSyncReceiveClock,
                 "Receive clock",
                 snapshot.staged.receiveClock,
                 Actions::kSyncReceiveClock);
    appendToggle(NodeIds::kSyncSendTransport,
                 "Send transport",
                 snapshot.staged.sendTransport,
                 Actions::kSyncSendTransport);
    appendToggle(NodeIds::kSyncReceiveTransport,
                 "Receive transport",
                 snapshot.staged.receiveTransport,
                 Actions::kSyncReceiveTransport);

    ui::Node ppqn;
    ppqn.id = NodeIds::kSyncPpqn;
    ppqn.kind = ui::NodeKind::TextField;
    ppqn.label = "PPQN (1-960)";
    ppqn.text = std::to_string(snapshot.staged.ppqn);
    ppqn.action = ui::Action::Named(Actions::kSyncPpqn);
    appendRow(std::move(ppqn));

    auto appendStatus = [&](const char* id, std::string text) {
        ui::Node node;
        node.id = id;
        node.kind = ui::NodeKind::StatusText;
        node.text = std::move(text);
        appendRow(std::move(node));
    };
    appendStatus(NodeIds::kSyncValidation, snapshot.validationText);
    appendStatus(NodeIds::kSyncWarning, snapshot.warningText);
    appendStatus(NodeIds::kSyncBpm, FormatSyncBpm(snapshot.status.currentBpm));
    appendStatus(NodeIds::kSyncLock, "Lock: " + snapshot.status.lockState);
    appendStatus(NodeIds::kSyncSource, "Source: " + snapshot.status.sourceName);
    appendStatus(NodeIds::kSyncOutputLatency,
                 FormatSyncOutputLatency(snapshot.status.outputLatencyMicros));
    appendStatus(NodeIds::kSyncIgnoredInput,
                 "Ignored input: " + std::to_string(snapshot.status.ignoredInputCount));
    appendStatus(NodeIds::kSyncLateEvents,
                 "Late events: " + std::to_string(snapshot.status.lateEventCount));
    appendStatus(NodeIds::kSyncDroppedOutput,
                 "Dropped output: " + std::to_string(snapshot.status.droppedOutputCount));
    return tree;
}

inline ui::NodeTree BuildAudioPageTree(const AudioPageSnapshot& snapshot, ui::Bounds area)
{
    ui::NodeTree tree;
    ui::Node root;
    root.id = NodeIds::kAudioRoot;
    root.kind = ui::NodeKind::Root;
    root.bounds = area;
    tree.nodes.push_back(root);

    auto appendChild = [&](ui::Node node) {
        tree.nodes.front().children.push_back(node.id);
        tree.nodes.push_back(std::move(node));
    };

    float y = Layout::kPageMargin;
    const float contentX = Layout::kPageMargin;
    const float contentWidth = area.width - Layout::kPageMargin * 2.0f;

    ui::Node backButton;
    backButton.id = NodeIds::kAudioBack;
    backButton.kind = ui::NodeKind::Button;
    backButton.label = "Back";
    backButton.bounds = {contentX, y, Layout::kBackButtonWidth, Layout::kBackRowHeight};
    backButton.action = ui::Action::Named(Actions::kAudioBack);
    appendChild(std::move(backButton));

    y += Layout::kBackRowHeight + Layout::kRowGap;

    const float comboWidth = contentWidth / 4.0f > 120.0f ? contentWidth / 4.0f : 120.0f;
    float comboX = contentX;

    ui::Node outputCombo;
    outputCombo.id = NodeIds::kAudioOutput;
    outputCombo.kind = ui::NodeKind::ComboBox;
    outputCombo.label = "Audio output";
    for (const AudioDeviceOption& option : snapshot.outputOptions)
    {
        outputCombo.options.push_back(ui::ControlOption{option.id, option.label});
    }
    outputCombo.selectedOption = snapshot.selectedOutputId;
    outputCombo.bounds = {comboX, y, comboWidth, Layout::kComboRowHeight};
    outputCombo.action = ui::Action::Named(Actions::kAudioOutputSelect);
    appendChild(std::move(outputCombo));

    comboX += comboWidth;

    if (snapshot.showInputCombo)
    {
        ui::Node inputCombo;
        inputCombo.id = NodeIds::kAudioInput;
        inputCombo.kind = ui::NodeKind::ComboBox;
        inputCombo.label = "Audio input";
        for (const AudioDeviceOption& option : snapshot.inputOptions)
        {
            inputCombo.options.push_back(ui::ControlOption{option.id, option.label});
        }
        inputCombo.selectedOption = snapshot.selectedInputId;
        inputCombo.bounds = {comboX, y, comboWidth, Layout::kComboRowHeight};
        inputCombo.action = ui::Action::Named(Actions::kAudioInputSelect);
        appendChild(std::move(inputCombo));
    }

    y += Layout::kComboRowHeight;

    ui::Node deviceLine;
    deviceLine.id = NodeIds::kAudioDeviceLine;
    deviceLine.kind = ui::NodeKind::Label;
    deviceLine.text = snapshot.deviceLineText;
    deviceLine.bounds = {contentX, y, contentWidth, Layout::kStatusRowHeight};
    appendChild(std::move(deviceLine));

    y += Layout::kStatusRowHeight;

    ui::Node statusLine;
    statusLine.id = NodeIds::kAudioStatusLine;
    statusLine.kind = ui::NodeKind::StatusText;
    statusLine.text = snapshot.statusLineText;
    statusLine.bounds = {contentX, y, contentWidth, Layout::kStatusRowHeight};
    appendChild(std::move(statusLine));

    return tree;
}

inline const char* FileStatusVariant(const std::string& statusText)
{
    if (statusText == "Patch root is not configured" ||
        statusText == "Could not read patch root" ||
        statusText == "Could not open patch directory" ||
        statusText == "Patch already exists" ||
        statusText == "Enter a valid patch name" ||
        statusText == "Select a patch directory")
    {
        return "danger";
    }
    return "quiet";
}

inline ui::NodeTree BuildFilePageTree(const FilePageSnapshot& snapshot, ui::Bounds area)
{
    ui::NodeTree tree;
    ui::Node root;
    root.id = NodeIds::kFileRoot;
    root.kind = ui::NodeKind::Root;
    root.bounds = area;
    tree.nodes.push_back(root);

    auto appendChildTo = [&](std::size_t parentIndex, ui::Node node) -> std::size_t {
        tree.nodes[parentIndex].children.push_back(node.id);
        tree.nodes.push_back(std::move(node));
        return tree.nodes.size() - 1;
    };

    auto appendRootChild = [&](ui::Node node) -> std::size_t {
        return appendChildTo(0, std::move(node));
    };

    const float margin = Layout::kFilePanelPadding;
    const float gap = Layout::kRowGap + 2.0f;
    const float contentX = margin;
    const float contentWidth = std::max(0.0f, area.width - margin * 2.0f);
    const float pageBottom = std::max(0.0f, area.height) - margin;

    ui::Node background;
    background.id = NodeIds::kFileBackground;
    background.kind = ui::NodeKind::Draw;
    background.bounds = {0.0f, 0.0f, area.width, area.height};
    background.drawCommands = {
        ui::DrawCommand::Fill(background.bounds, Color::Rgb(18, 20, 22)),
    };
    appendRootChild(std::move(background));

    float y = margin;

    ui::Node header;
    header.id = NodeIds::kFileHeader;
    header.kind = ui::NodeKind::Section;
    header.bounds = {contentX, y, contentWidth, 70.0f};
    header.variant = "panel";
    const std::size_t headerIndex = appendRootChild(std::move(header));

    ui::Node headerDraw;
    headerDraw.id = ui::NodeId(std::string(NodeIds::kFileHeader) + ".background");
    headerDraw.kind = ui::NodeKind::Draw;
    headerDraw.bounds = {0.0f, 0.0f, tree.nodes[headerIndex].bounds.width, tree.nodes[headerIndex].bounds.height};
    headerDraw.drawCommands = {
        ui::DrawCommand::FillRoundedRect(headerDraw.bounds, 6.0f, Color::Rgb(29, 33, 37)),
        ui::DrawCommand::StrokeRoundedRect(headerDraw.bounds, 6.0f, Color::Rgb(54, 61, 68), 1.0f),
    };
    appendChildTo(headerIndex, std::move(headerDraw));

    const float headerPad = contentWidth < 420.0f ? 8.0f : 12.0f;
    const float backWidth = std::min(Layout::kBackButtonWidth, std::max(58.0f, contentWidth * 0.24f));
    const float headerTextWidth = std::max(80.0f, contentWidth - backWidth - headerPad * 3.0f);

    ui::Node backButton;
    backButton.id = NodeIds::kFileBack;
    backButton.kind = ui::NodeKind::Button;
    backButton.label = "Back";
    backButton.variant = "secondary";
    backButton.bounds = {contentWidth - headerPad - backWidth,
                         headerPad,
                         backWidth,
                         Layout::kBackRowHeight};
    backButton.action = ui::Action::Named(Actions::kFileBack);
    appendChildTo(headerIndex, std::move(backButton));

    ui::Node patchName;
    patchName.id = NodeIds::kFilePatchName;
    patchName.kind = ui::NodeKind::Label;
    patchName.text = snapshot.patchNameText;
    patchName.variant = snapshot.hasCurrentPatch ? "title" : "muted-title";
    patchName.bounds = {headerPad, headerPad, headerTextWidth, Layout::kPatchNameRowHeight};
    appendChildTo(headerIndex, std::move(patchName));

    ui::Node patchRoot;
    patchRoot.id = NodeIds::kFilePatchRoot;
    patchRoot.kind = ui::NodeKind::StatusText;
    patchRoot.text = snapshot.patchesRoot.empty() ? "Patch root not configured" : "Patch root: " + snapshot.patchesRoot;
    patchRoot.variant = "quiet";
    patchRoot.bounds = {headerPad,
                        headerPad + Layout::kPatchNameRowHeight,
                        std::max(80.0f, contentWidth - headerPad * 2.0f),
                        Layout::kPatchNameRowHeight};
    appendChildTo(headerIndex, std::move(patchRoot));

    y += tree.nodes[headerIndex].bounds.height + gap;

    ui::Node commandStrip;
    commandStrip.id = NodeIds::kFileCommandStrip;
    commandStrip.kind = ui::NodeKind::Row;
    commandStrip.bounds = {contentX, y, contentWidth, Layout::kPatchRowHeight};
    commandStrip.variant = "quiet";
    const std::size_t commandIndex = appendRootChild(std::move(commandStrip));

    const float buttonGap = contentWidth < 420.0f ? 4.0f : 6.0f;
    const float commandButtonWidth =
        std::max(52.0f, std::min(Layout::kPatchButtonWidth, (contentWidth - buttonGap * 4.0f) / 5.0f));
    float buttonX = 0.0f;
    const auto appendPatchButton = [&](const char* id, const char* label, const char* actionName) {
        ui::Node button;
        button.id = ui::NodeId(id);
        button.kind = ui::NodeKind::Button;
        button.label = label;
        button.variant = std::string(actionName) == Actions::kFileSave ? "primary" : "secondary";
        button.bounds = {buttonX, 0.0f, commandButtonWidth, Layout::kPatchRowHeight};
        button.action = ui::Action::Named(actionName);
        appendChildTo(commandIndex, std::move(button));
        buttonX += commandButtonWidth + buttonGap;
    };

    appendPatchButton(NodeIds::kFileNew, "New", Actions::kFileNew);
    appendPatchButton(NodeIds::kFileSave, "Save", Actions::kFileSave);
    appendPatchButton(NodeIds::kFileSaveAs, "Save As", Actions::kFileSaveAs);
    appendPatchButton(NodeIds::kFileLoad, "Load", Actions::kFileLoad);
    appendPatchButton(NodeIds::kFileRevert, "Revert", Actions::kFileRevert);

    y += Layout::kPatchRowHeight + gap;

    if (snapshot.browserOpen)
    {
        ui::Node browser;
        browser.id = NodeIds::kFileBrowser;
        browser.kind = ui::NodeKind::Section;
        browser.bounds = {contentX, y, contentWidth, std::max(0.0f, pageBottom - y)};
        browser.variant = "panel";
        const std::size_t browserIndex = appendRootChild(std::move(browser));

        ui::Node browserDraw;
        browserDraw.id = ui::NodeId(std::string(NodeIds::kFileBrowser) + ".background");
        browserDraw.kind = ui::NodeKind::Draw;
        browserDraw.bounds = {0.0f, 0.0f, tree.nodes[browserIndex].bounds.width, tree.nodes[browserIndex].bounds.height};
        browserDraw.drawCommands = {
            ui::DrawCommand::FillRoundedRect(browserDraw.bounds, 6.0f, Color::Rgb(24, 28, 32)),
            ui::DrawCommand::StrokeRoundedRect(browserDraw.bounds, 6.0f, Color::Rgb(63, 73, 82), 1.0f),
        };
        appendChildTo(browserIndex, std::move(browserDraw));

        const ui::Bounds browserBounds = tree.nodes[browserIndex].bounds;
        const float browserPad = contentWidth < 420.0f ? 8.0f : 12.0f;
        const float innerX = browserPad;
        const float innerWidth = std::max(0.0f, browserBounds.width - browserPad * 2.0f);
        const float innerRight = innerX + innerWidth;
        const float browserBottom = browserBounds.height - browserPad;
        float browserY = browserPad;

        ui::Node title;
        title.id = NodeIds::kFileBrowserTitle;
        title.kind = ui::NodeKind::Label;
        title.text = snapshot.browserKind == FileBrowserKind::SaveAs ? "Save Patch" : "Load Patch";
        title.variant = "title";
        title.bounds = {innerX, browserY, innerWidth, Layout::kBrowserHeaderHeight};
        appendChildTo(browserIndex, std::move(title));

        browserY += Layout::kBrowserHeaderHeight + Layout::kRowGap;
        if (snapshot.browserKind == FileBrowserKind::SaveAs)
        {
            ui::Node saveName;
            saveName.id = NodeIds::kFileBrowserSaveName;
            saveName.kind = ui::NodeKind::TextField;
            saveName.label = "Patch name";
            saveName.text = snapshot.browserSaveName;
            saveName.variant = "field";
            saveName.bounds = {innerX, browserY, innerWidth, Layout::kBrowserCommandHeight};
            saveName.action = ui::Action::Named(Actions::kFileBrowserSaveName);
            appendChildTo(browserIndex, std::move(saveName));
            browserY += Layout::kBrowserCommandHeight + Layout::kRowGap;
        }

        ui::Node status;
        status.id = NodeIds::kFileStatus;
        status.kind = ui::NodeKind::StatusText;
        status.text = snapshot.statusText;
        status.variant = FileStatusVariant(snapshot.statusText);
        status.bounds = {innerX, browserY, innerWidth, 24.0f};
        appendChildTo(browserIndex, std::move(status));

        browserY += 24.0f + Layout::kRowGap;
        const float actionY = std::max(browserY,
                                       browserBottom - Layout::kBrowserCommandHeight);
        const float narrowButtonWidth =
            std::min(Layout::kBrowserButtonWidth, std::max(62.0f, (innerWidth - Layout::kRowGap) / 2.0f));
        const float cancelX = innerRight - narrowButtonWidth;
        const float confirmX = cancelX - Layout::kRowGap - narrowButtonWidth;

        const float listBottom = std::max(browserY, actionY - Layout::kRowGap);
        if (snapshot.browserEntries.empty())
        {
            ui::Node empty;
            empty.id = ui::NodeId(NodeIds::FileBrowserEntry(0));
            empty.kind = ui::NodeKind::StatusText;
            empty.text = "(no patch directories)";
            empty.variant = "quiet";
            empty.bounds = {innerX, browserY, innerWidth, std::min(Layout::kBrowserRowHeight, listBottom - browserY)};
            appendChildTo(browserIndex, std::move(empty));
        }
        else
        {
            for (std::size_t ix = 0; ix < snapshot.browserEntries.size(); ++ix)
            {
                if (browserY + Layout::kBrowserRowHeight > listBottom + 0.5f)
                {
                    break;
                }
                const FilePageSnapshot::BrowserEntry& entry = snapshot.browserEntries[ix];
                ui::Node entryButton;
                entryButton.id = ui::NodeId(NodeIds::FileBrowserEntry(ix));
                entryButton.kind = ui::NodeKind::Button;
                entryButton.label = entry.name;
                entryButton.selected = entry.selected;
                entryButton.variant = "list-row";
                entryButton.bounds = {innerX,
                                      browserY,
                                      innerWidth,
                                      Layout::kBrowserRowHeight};
                entryButton.action = ui::Action::WithValue(Actions::kFileBrowserSelect, std::to_string(ix));
                entryButton.doubleClickAction = ui::Action::WithValue(
                    snapshot.browserKind == FileBrowserKind::SaveAs
                        ? Actions::kFileBrowserOverwriteSaveAs
                        : Actions::kFileBrowserAccept,
                    std::to_string(ix));
                appendChildTo(browserIndex, std::move(entryButton));

                browserY += Layout::kBrowserRowHeight;
            }
        }

        ui::Node confirmButton;
        confirmButton.id = NodeIds::kFileBrowserConfirm;
        confirmButton.kind = ui::NodeKind::Button;
        confirmButton.label = snapshot.browserKind == FileBrowserKind::SaveAs ? "Save" : "Load";
        confirmButton.variant = "primary";
        confirmButton.bounds = {confirmX, actionY, narrowButtonWidth, Layout::kBrowserCommandHeight};
        confirmButton.action = ui::Action::Named(Actions::kFileBrowserConfirm);
        appendChildTo(browserIndex, std::move(confirmButton));

        ui::Node cancelButton;
        cancelButton.id = NodeIds::kFileBrowserCancel;
        cancelButton.kind = ui::NodeKind::Button;
        cancelButton.label = "Cancel";
        cancelButton.variant = "secondary";
        cancelButton.bounds = {cancelX, actionY, narrowButtonWidth, Layout::kBrowserCommandHeight};
        cancelButton.action = ui::Action::Named(Actions::kFileBrowserCancel);
        appendChildTo(browserIndex, std::move(cancelButton));
    }
    else
    {
        ui::Node idle;
        idle.id = NodeIds::kFileIdleRegion;
        idle.kind = ui::NodeKind::Section;
        idle.bounds = {contentX, y, contentWidth, std::max(0.0f, pageBottom - y)};
        idle.variant = "panel";
        const std::size_t idleIndex = appendRootChild(std::move(idle));

        ui::Node idleDraw;
        idleDraw.id = ui::NodeId(std::string(NodeIds::kFileIdleRegion) + ".background");
        idleDraw.kind = ui::NodeKind::Draw;
        idleDraw.bounds = {0.0f, 0.0f, tree.nodes[idleIndex].bounds.width, tree.nodes[idleIndex].bounds.height};
        idleDraw.drawCommands = {
            ui::DrawCommand::FillRoundedRect(idleDraw.bounds, 6.0f, Color::Rgb(23, 26, 29)),
            ui::DrawCommand::StrokeRoundedRect(idleDraw.bounds, 6.0f, Color::Rgb(48, 55, 62), 1.0f),
        };
        appendChildTo(idleIndex, std::move(idleDraw));

        const float idlePad = contentWidth < 420.0f ? 8.0f : 12.0f;
        ui::Node status;
        status.id = NodeIds::kFileStatus;
        status.kind = ui::NodeKind::StatusText;
        status.text = snapshot.statusText;
        status.variant = FileStatusVariant(snapshot.statusText);
        status.bounds = {idlePad,
                         idlePad,
                         std::max(0.0f, contentWidth - idlePad * 2.0f),
                         Layout::kPatchNameRowHeight};
        appendChildTo(idleIndex, std::move(status));

        float idleY = idlePad + Layout::kPatchNameRowHeight + Layout::kRowGap;
        const float idleInnerX = idlePad;
        const float idleInnerWidth = std::max(0.0f, contentWidth - idlePad * 2.0f);
        if (!snapshot.hasCurrentPatch)
        {
            ui::Node emptyState;
            emptyState.id = ui::NodeId(std::string(NodeIds::kFileIdleRegion) + ".message");
            emptyState.kind = ui::NodeKind::Label;
            emptyState.text = "Save or load a patch to begin";
            emptyState.variant = "muted";
            emptyState.bounds = {idleInnerX, idleY, idleInnerWidth, Layout::kPatchNameRowHeight};
            appendChildTo(idleIndex, std::move(emptyState));
        }
        else
        {
            ui::Node versions;
            versions.id = NodeIds::kFileVersions;
            versions.kind = ui::NodeKind::Section;
            versions.bounds = {idleInnerX,
                               idleY,
                               idleInnerWidth,
                               std::max(0.0f, tree.nodes[idleIndex].bounds.height - idlePad - idleY)};
            versions.variant = "quiet";
            const std::size_t versionsIndex = appendChildTo(idleIndex, std::move(versions));

            ui::Node versionsTitle;
            versionsTitle.id = NodeIds::kFileVersionsTitle;
            versionsTitle.kind = ui::NodeKind::Label;
            versionsTitle.text = "Versions";
            versionsTitle.variant = "title";
            versionsTitle.bounds = {0.0f, 0.0f, idleInnerWidth, Layout::kPatchNameRowHeight};
            appendChildTo(versionsIndex, std::move(versionsTitle));

            float versionY = Layout::kPatchNameRowHeight + Layout::kRowGap;
            const float versionBottom = tree.nodes[versionsIndex].bounds.height;
            if (snapshot.versionEntries.empty())
            {
                ui::Node emptyVersions;
                emptyVersions.id = ui::NodeId(NodeIds::FileVersionEntry(0));
                emptyVersions.kind = ui::NodeKind::StatusText;
                emptyVersions.text = "No saved versions";
                emptyVersions.variant = "quiet";
                emptyVersions.bounds = {0.0f,
                                        versionY,
                                        idleInnerWidth,
                                        std::min(Layout::kBrowserRowHeight, std::max(0.0f, versionBottom - versionY))};
                appendChildTo(versionsIndex, std::move(emptyVersions));
            }
            else
            {
                for (std::size_t ix = 0; ix < snapshot.versionEntries.size(); ++ix)
                {
                    if (versionY + Layout::kBrowserRowHeight > versionBottom + 0.5f)
                    {
                        break;
                    }
                    const FilePageSnapshot::VersionEntry& entry = snapshot.versionEntries[ix];
                    ui::Node versionButton;
                    versionButton.id = ui::NodeId(NodeIds::FileVersionEntry(ix));
                    versionButton.kind = ui::NodeKind::Button;
                    versionButton.label = entry.label;
                    versionButton.text = entry.label;
                    versionButton.variant = "list-row";
                    versionButton.bounds = {0.0f, versionY, idleInnerWidth, Layout::kBrowserRowHeight};
                    versionButton.doubleClickAction =
                        ui::Action::WithValue(Actions::kFileConfirmedLoad, entry.path);
                    appendChildTo(versionsIndex, std::move(versionButton));
                    versionY += Layout::kBrowserRowHeight;
                }
            }
        }
    }

    return tree;
}

class PatchBrowserViewModel final
{
public:
    using ActionHandler = ui::Surface::ActionHandler;

    bool IsOpen() const
    {
        return open_;
    }

    void Open(FileBrowserKind kind, const std::filesystem::path& root, std::string initialSaveName)
    {
        browser_.SetRoot(root);
        kind_ = kind;
        open_ = true;
        if (kind == FileBrowserKind::SaveAs)
        {
            saveName_ = std::move(initialSaveName);
        }
        else
        {
            saveName_.clear();
        }

        if (!browser_.Refresh())
        {
            statusText_ = "Could not read patch root";
        }
        else
        {
            statusText_ = kind == FileBrowserKind::SaveAs ? "Choose a patch name" : "Choose a patch";
        }
    }

    void Close(std::string status)
    {
        open_ = false;
        statusText_ = std::move(status);
    }

    bool DispatchBrowserAction(const ui::Action& action, const ActionHandler& dispatchOut)
    {
        if (action.name == Actions::kFileBrowserCancel)
        {
            Close("Ready");
            return true;
        }
        if (action.name == Actions::kFileBrowserSaveName)
        {
            saveName_ = action.value;
            return true;
        }
        if (action.name == Actions::kFileBrowserSelect)
        {
            browser_.Select(ParseIndex(action.value));
            if (kind_ == FileBrowserKind::SaveAs)
            {
                const std::optional<std::string> selectedName = SelectedEntryName();
                if (selectedName.has_value())
                {
                    saveName_ = *selectedName;
                }
            }
            return true;
        }
        if (action.name == Actions::kFileBrowserAccept)
        {
            browser_.Select(ParseIndex(action.value));
            Confirm(dispatchOut);
            return true;
        }
        if (action.name == Actions::kFileBrowserOverwriteSaveAs)
        {
            browser_.Select(ParseIndex(action.value));
            ConfirmOverwriteSaveAs(dispatchOut);
            return true;
        }
        if (action.name == Actions::kFileBrowserConfirm)
        {
            Confirm(dispatchOut);
            return true;
        }
        return false;
    }

    void SyncSnapshot(FilePageSnapshot& snapshot) const
    {
        snapshot.browserOpen = open_;
        snapshot.browserKind = kind_;
        snapshot.browserSaveName = saveName_;
        snapshot.statusText = statusText_;
        snapshot.browserCurrentPathText = browser_.CurrentRelativePath().empty()
                                               ? "/"
                                               : browser_.CurrentRelativePath().generic_string();
        snapshot.browserEntries.clear();
        if (!open_)
        {
            snapshot.browserCurrentPathText = "/";
            return;
        }

        const std::vector<PatchBrowser::Entry>& entries = browser_.Entries();
        snapshot.browserEntries.reserve(entries.size());
        for (std::size_t ix = 0; ix < entries.size(); ++ix)
        {
            snapshot.browserEntries.push_back(FilePageSnapshot::BrowserEntry{
                .name = entries[ix].name,
                .relativePath = entries[ix].relativePath.generic_string(),
                .selected = ix == browser_.SelectedIndex(),
            });
        }
    }

private:
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

    void Confirm(const ActionHandler& dispatchOut)
    {
        if (!open_)
        {
            return;
        }
        if (kind_ == FileBrowserKind::SaveAs)
        {
            const std::optional<std::filesystem::path> newPath = browser_.ResolveNewSaveAsPath(saveName_);
            if (!newPath.has_value())
            {
                statusText_ = SaveAsTargetAlreadyExists() ? "Patch already exists" : "Enter a valid patch name";
                return;
            }
            Close("Save As requested: " + newPath->string());
            if (dispatchOut)
            {
                dispatchOut(ui::Action::WithValue(Actions::kFileConfirmedSaveAs, newPath->string()));
            }
            return;
        }

        const std::optional<std::filesystem::path> path = browser_.SelectedLoadPath();
        if (!path.has_value())
        {
            statusText_ = "Select a patch directory";
            return;
        }
        Close("Load requested: " + path->string());
        if (dispatchOut)
        {
            dispatchOut(ui::Action::WithValue(Actions::kFileConfirmedLoad, path->string()));
        }
    }

    void ConfirmOverwriteSaveAs(const ActionHandler& dispatchOut)
    {
        if (!open_ || kind_ != FileBrowserKind::SaveAs)
        {
            return;
        }

        const std::optional<std::filesystem::path> path = SelectedEntryPath();
        if (!path.has_value())
        {
            statusText_ = "Select a patch directory";
            return;
        }

        Close("Save As requested: " + path->string());
        if (dispatchOut)
        {
            dispatchOut(ui::Action::WithValue(Actions::kFileConfirmedOverwriteSaveAs, path->string()));
        }
    }

    std::optional<std::filesystem::path> SelectedEntryPath() const
    {
        const std::vector<PatchBrowser::Entry>& entries = browser_.Entries();
        if (entries.empty() || browser_.SelectedIndex() >= entries.size())
        {
            return std::nullopt;
        }
        return entries[browser_.SelectedIndex()].absolutePath;
    }

    std::optional<std::string> SelectedEntryName() const
    {
        const std::vector<PatchBrowser::Entry>& entries = browser_.Entries();
        if (entries.empty() || browser_.SelectedIndex() >= entries.size())
        {
            return std::nullopt;
        }
        return entries[browser_.SelectedIndex()].name;
    }

    bool SaveAsTargetAlreadyExists() const
    {
        const std::optional<std::filesystem::path> candidate = browser_.ResolveSaveAsCandidate(saveName_);
        if (!candidate.has_value())
        {
            return false;
        }

        std::error_code ec;
        return std::filesystem::exists(*candidate, ec) || ec;
    }

    PatchBrowser browser_;
    bool open_ = false;
    FileBrowserKind kind_ = FileBrowserKind::SaveAs;
    std::string statusText_ = "Ready";
    std::string saveName_;
};

class SidebarSurface final : public ui::Surface
{
public:
    ui::NodeTree BuildTree() override
    {
        return BuildSidebarTree(snapshot_);
    }

    void SetActionHandler(ActionHandler handler) override
    {
        outerHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        if (outerHandler_)
        {
            outerHandler_(action);
        }
    }

    void SetDeadlinePercent(float percent)
    {
        snapshot_.deadlinePercent = percent;
    }

    void SetControllersWarning(bool warning)
    {
        snapshot_.controllersWarning = warning;
    }

private:
    SidebarSnapshot snapshot_;
    ActionHandler outerHandler_;
};

class SyncPageSurface final : public ui::Surface
{
public:
    ui::NodeTree BuildTree() override
    {
        return BuildSyncPageTree(snapshot_, contentBounds_);
    }

    void SetActionHandler(ActionHandler handler) override { outerHandler_ = std::move(handler); }
    void DispatchAction(const ui::Action& action) override
    {
        if (action.name == Actions::kSyncBack)
        {
            if (outerHandler_)
            {
                outerHandler_(action);
            }
            return;
        }
        if (action.name == Actions::kSyncPpqn)
        {
            int value = 0;
            const char* const begin = action.value.data();
            const char* const end = begin + action.value.size();
            const auto [parsedEnd, error] = std::from_chars(begin, end, value, 10);
            if (action.value.empty() || error != std::errc{} || parsedEnd != end ||
                value < 1 || value > 960)
            {
                snapshot_.validationText = "PPQN must be a whole number from 1 to 960";
                return;
            }
            snapshot_.staged.ppqn = value;
            snapshot_.validationText.clear();
            UpdateWarning();
            return;
        }

        bool* target = nullptr;
        if (action.name == Actions::kSyncSendClock)
        {
            target = &snapshot_.staged.sendClock;
        }
        else if (action.name == Actions::kSyncReceiveClock)
        {
            target = &snapshot_.staged.receiveClock;
        }
        else if (action.name == Actions::kSyncSendTransport)
        {
            target = &snapshot_.staged.sendTransport;
        }
        else if (action.name == Actions::kSyncReceiveTransport)
        {
            target = &snapshot_.staged.receiveTransport;
        }
        if (target != nullptr && (action.value == "1" || action.value == "0"))
        {
            *target = action.value == "1";
        }
    }
    void SetContentBounds(ui::Bounds bounds) { contentBounds_ = bounds; }
    void BeginEdit(const SyncConfig& config)
    {
        snapshot_.staged = config;
        snapshot_.validationText.clear();
        UpdateWarning();
    }
    void RefreshStatus(const SyncPageStatus& status) { snapshot_.status = status; }
    const SyncConfig& StagedConfiguration() const { return snapshot_.staged; }
    const std::string& ValidationText() const { return snapshot_.validationText; }
    const std::string& WarningText() const { return snapshot_.warningText; }
    void SetApplyError() { snapshot_.validationText = "Unable to apply sync configuration"; }

private:
    void UpdateWarning()
    {
        snapshot_.warningText = snapshot_.staged.ppqn == 24
                                    ? std::string{}
                                    : "Warning: MIDI peers must use the same nonstandard pulse density";
    }

    SyncPageSnapshot snapshot_{};
    ui::Bounds contentBounds_{0.0f, 0.0f, 640.0f, 480.0f};
    ActionHandler outerHandler_;
};

class AudioPageSurface final : public ui::Surface
{
public:
    ui::NodeTree BuildTree() override
    {
        return BuildAudioPageTree(snapshot_, contentBounds_);
    }

    void SetActionHandler(ActionHandler handler) override
    {
        outerHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        if (outerHandler_)
        {
            outerHandler_(action);
        }
    }

    void SetContentBounds(ui::Bounds bounds)
    {
        contentBounds_ = bounds;
    }

    AudioPageSnapshot& Snapshot()
    {
        return snapshot_;
    }

    const AudioPageSnapshot& Snapshot() const
    {
        return snapshot_;
    }

    void SetStatusLine(std::string text)
    {
        snapshot_.statusLineText = std::move(text);
    }

private:
    AudioPageSnapshot snapshot_;
    ui::Bounds contentBounds_{0.0f, 0.0f, 640.0f, 480.0f};
    ActionHandler outerHandler_;
};

class FilePageSurface final : public ui::Surface
{
public:
    ui::NodeTree BuildTree() override
    {
        SyncVersionSnapshot();
        return BuildFilePageTree(snapshot_, contentBounds_);
    }

    void SetActionHandler(ActionHandler handler) override
    {
        outerHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        if (browserModel_.DispatchBrowserAction(action, outerHandler_))
        {
            browserModel_.SyncSnapshot(snapshot_);
            return;
        }
        if (action.name == Actions::kFileSaveAs)
        {
            OpenBrowser(FileBrowserKind::SaveAs);
            return;
        }
        if (action.name == Actions::kFileLoad)
        {
            OpenBrowser(FileBrowserKind::Load);
            return;
        }
        if (action.name == Actions::kFileSave && !snapshot_.hasCurrentPatch)
        {
            OpenBrowser(FileBrowserKind::SaveAs);
            return;
        }
        DispatchOut(action);
    }

    void SetContentBounds(ui::Bounds bounds)
    {
        contentBounds_ = bounds;
    }

    FilePageSnapshot& Snapshot()
    {
        return snapshot_;
    }

    const FilePageSnapshot& Snapshot() const
    {
        return snapshot_;
    }

    void SetStatus(std::string text)
    {
        snapshot_.statusText = std::move(text);
    }

private:
    void SyncVersionSnapshot()
    {
        snapshot_.versionEntries.clear();
        if (!snapshot_.hasCurrentPatch || snapshot_.patchNameText.empty() ||
            snapshot_.patchNameText == "(no patch)" || snapshot_.patchesRoot.empty())
        {
            return;
        }

        const std::filesystem::path patchDir =
            (std::filesystem::path(snapshot_.patchesRoot) / snapshot_.patchNameText).lexically_normal();
        std::error_code ec;
        if (!std::filesystem::is_directory(patchDir, ec) || ec)
        {
            return;
        }

        std::filesystem::directory_iterator it(patchDir, ec);
        const std::filesystem::directory_iterator end;
        for (; !ec && it != end; it.increment(ec))
        {
            const std::filesystem::directory_entry& entry = *it;
            std::error_code entryEc;
            if (!entry.is_regular_file(entryEc) || entryEc || entry.path().extension() != ".json")
            {
                continue;
            }
            snapshot_.versionEntries.push_back(FilePageSnapshot::VersionEntry{
                .label = entry.path().filename().string(),
                .path = entry.path().lexically_normal().string(),
            });
        }

        std::sort(snapshot_.versionEntries.begin(),
                  snapshot_.versionEntries.end(),
                  [](const FilePageSnapshot::VersionEntry& a, const FilePageSnapshot::VersionEntry& b) {
                      return a.label > b.label;
                  });
    }

    void DispatchOut(const ui::Action& action)
    {
        if (outerHandler_)
        {
            outerHandler_(action);
        }
    }

    void OpenBrowser(FileBrowserKind kind)
    {
        if (snapshot_.patchesRoot.empty())
        {
            snapshot_.statusText = "Patch root is not configured";
            return;
        }
        std::string initialSaveName = snapshot_.browserSaveName;
        if (kind == FileBrowserKind::SaveAs && initialSaveName.empty() && snapshot_.patchNameText != "(no patch)")
        {
            initialSaveName = snapshot_.patchNameText;
        }
        browserModel_.Open(kind, std::filesystem::path(snapshot_.patchesRoot), std::move(initialSaveName));
        browserModel_.SyncSnapshot(snapshot_);
    }

    FilePageSnapshot snapshot_;
    ui::Bounds contentBounds_{0.0f, 0.0f, 640.0f, 480.0f};
    ActionHandler outerHandler_;
    PatchBrowserViewModel browserModel_;
};

}  // namespace synth::runtime_ui
