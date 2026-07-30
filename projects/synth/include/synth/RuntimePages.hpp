#pragma once

// JUCE-free runtime page models: sidebar, Audio page, and File page semantic
// trees plus action names and layout helpers (OpenSpec tasks 4.1–4.3).

#include "synth/PatchBrowser.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePageStyle.hpp"
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
inline constexpr const char* kAudioForm = "runtime.audio.form";
inline constexpr const char* kAudioDeviceLine = "runtime.audio.device_line";
inline constexpr const char* kAudioStatusLine = "runtime.audio.status_line";

inline constexpr const char* kSyncRoot = "runtime.sync.root";
inline constexpr const char* kSyncBack = "runtime.sync.back";
inline constexpr const char* kSyncForm = "runtime.sync.form";
inline constexpr const char* kSyncStatus = "runtime.sync.status";
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
inline constexpr const char* kFilePage = "runtime.file.page";
inline constexpr const char* kFileHeader = "runtime.file.header";
inline constexpr const char* kFileHeaderText = "runtime.file.header.text";
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
inline constexpr const char* kFileBrowserList = "runtime.file.browser.list";
inline constexpr const char* kFileBrowserActions = "runtime.file.browser.actions";
inline constexpr const char* kFileBrowserConfirm = "runtime.file.browser.confirm";
inline constexpr const char* kFileBrowserCancel = "runtime.file.browser.cancel";
inline constexpr const char* kFileVersions = "runtime.file.versions";
inline constexpr const char* kFileVersionsTitle = "runtime.file.versions.title";
inline constexpr const char* kFileVersionsList = "runtime.file.versions.list";

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
inline constexpr float kBrowserStatusHeight = 24.0f;
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

namespace PageControls {

inline ui::LayoutOptions CompactFormRowLayout()
{
    ui::LayoutOptions layout;
    layout.padding = 0.0f;
    layout.gap = ui::kSpacing.labelGap;
    return layout;
}

inline ui::ControlStyle Button()
{
    ui::ControlStyle style;
    style.color = pagestyle::kDefaultButton;
    style.textStyle = pagestyle::kDefaultTextStyle;
    style.layout.cross = ui::Extent::Px(Layout::kBackButtonWidth);
    return style;
}

inline ui::ControlStyle Toggle(std::string caption)
{
    ui::ControlStyle style = Button();
    style.caption = std::move(caption);
    style.layout = CompactFormRowLayout();
    return style;
}

inline ui::ControlStyle Field(std::string caption)
{
    ui::ControlStyle style;
    style.color = pagestyle::kDefaultPanel;
    style.textStyle = pagestyle::kDefaultTextStyle;
    style.caption = std::move(caption);
    style.layout = CompactFormRowLayout();
    return style;
}

inline ui::ControlStyle MutedText()
{
    ui::ControlStyle style;
    style.textStyle = pagestyle::kMutedTextStyle;
    return style;
}

inline ui::ControlStyle DangerText()
{
    ui::ControlStyle style;
    style.textStyle = pagestyle::kDangerTextStyle;
    return style;
}

inline ui::LayoutOptions FormGridLayout()
{
    ui::LayoutOptions layout;
    layout.formGrid = true;
    layout.padding = 0.0f;
    return layout;
}

inline ui::LayoutOptions StatusStackLayout()
{
    ui::LayoutOptions layout;
    layout.padding = 0.0f;
    layout.gap = Layout::kRowGap;
    return layout;
}

// A button stacked along a Row's main axis: there `main` is its width and
// `cross` its height, the transpose of the column-stacked pages' Button().
inline ui::ControlStyle RowButton(ui::Extent width, ui::Extent height)
{
    ui::ControlStyle style;
    style.color = pagestyle::kDefaultButton;
    style.textStyle = pagestyle::kDefaultTextStyle;
    style.layout.main = width;
    style.layout.cross = height;
    return style;
}

inline ui::ControlStyle PrimaryRowButton(ui::Extent width, ui::Extent height)
{
    ui::ControlStyle style = RowButton(width, height);
    style.color = pagestyle::kPrimaryButton;
    return style;
}

// One entry in a scrollable list. Its height is the recovered row height, full
// stop: a row that shares out the panel's free space instead shrinks as the
// list grows, and a directory of any real size then renders as unreadable
// slivers. Rows past the viewport are reached by scrolling, which is what the
// enclosing ScrollArea is for.
inline ui::ControlStyle ListRow(bool selected)
{
    ui::ControlStyle style;
    style.color = pagestyle::kListRowButton;
    style.textStyle = pagestyle::kDefaultTextStyle;
    style.selected = selected;
    style.layout.main = ui::Extent::Px(Layout::kBrowserRowHeight);
    return style;
}

// Text sized by its own metrics, for a region that should be as tall as the
// text it holds.
inline ui::ControlStyle PanelText(ui::TextStyle textStyle)
{
    ui::ControlStyle style;
    style.textStyle = textStyle;
    style.layout.main = ui::Extent::Intrinsic();
    return style;
}

// A list panel's furniture: a fixed row height, so the scrolling region beside
// it absorbs every change in the panel's extent and the furniture never
// competes with the rows for space.
inline ui::ControlStyle PanelTextRow(ui::TextStyle textStyle, float height)
{
    ui::ControlStyle style;
    style.textStyle = textStyle;
    style.layout.main = ui::Extent::Px(height);
    return style;
}

// The scrolling region of a list panel: it takes whatever the furniture leaves,
// its rows abut as the recovered layout's rows did, and the resolver publishes
// the content extent both backends scroll over.
inline ui::LayoutOptions ListLayout()
{
    ui::LayoutOptions layout;
    layout.main = ui::Extent::Weight(1.0f);
    layout.padding = 0.0f;
    layout.gap = 0.0f;
    return layout;
}

struct ListRowSpec
{
    std::string id;
    std::string label;
    bool selected = false;
    std::optional<ui::Action> action{};
    std::optional<ui::Action> doubleClickAction{};
};

// The rows of a list panel, as a component (design.md D2: a component is any
// callable taking the builder). The patch browser and the versions list differ
// only in their action wiring and their empty text, so the row shape itself
// lives here once rather than once per list.
inline ui::Builder::Children ListRows(std::vector<ListRowSpec> rows,
                                      std::string emptyRowId,
                                      std::string emptyText)
{
    return [rows = std::move(rows), emptyRowId = std::move(emptyRowId),
            emptyText = std::move(emptyText)](ui::Builder& list) {
        if (rows.empty())
        {
            list.StatusText(emptyRowId,
                            emptyText,
                            PanelTextRow(pagestyle::kMutedTextStyle, Layout::kBrowserRowHeight));
            return;
        }
        for (const ListRowSpec& row : rows)
        {
            ui::ControlStyle style = ListRow(row.selected);
            style.action = row.action;
            style.doubleClickAction = row.doubleClickAction;
            list.Button(row.id, row.label, std::move(style));
        }
    };
}

// The File page's outer column: one margin, one gap, and every region sized by
// its own content or by what the page has left over.
inline ui::LayoutOptions PageLayout()
{
    ui::LayoutOptions layout;
    layout.main = ui::Extent::Weight(1.0f);
    layout.padding = Layout::kFilePanelPadding;
    layout.gap = Layout::kRowGap;
    return layout;
}

inline ui::LayoutOptions PanelLayout(ui::Extent main)
{
    ui::LayoutOptions layout;
    layout.main = main;
    layout.padding = ui::kSpacing.padding;
    layout.gap = Layout::kRowGap;
    return layout;
}

// A group nested inside a panel: it adds no padding of its own, so its children
// keep the enclosing panel's inset and separate on the shared row gap.
inline ui::LayoutOptions PanelGroupLayout(ui::Extent main)
{
    ui::LayoutOptions layout;
    layout.main = main;
    layout.padding = 0.0f;
    layout.gap = Layout::kRowGap;
    return layout;
}

// A panel's background, declared as the sru-44 underlay of the panel it names.
// The panel's extent is the resolver's to decide, so the producer anchors to it
// by id instead of restating it, and the fill is painted from the extent the
// resolver hands the factory.
inline ui::LayoutOptions PanelUnderlayLayout(std::string panelId)
{
    ui::LayoutOptions layout;
    layout.overlayOf = std::move(panelId);
    return layout;
}

inline ui::Builder::DrawFactory PanelUnderlayFill(Color fill, Color border)
{
    return [fill, border](ui::Bounds extent) {
        return std::vector<ui::DrawCommand>{
            ui::DrawCommand::FillRoundedRect(extent, pagestyle::kPanelCornerRadius, fill),
            ui::DrawCommand::StrokeRoundedRect(
                extent, pagestyle::kPanelCornerRadius, border, pagestyle::kPanelBorderWidth),
        };
    };
}

inline std::vector<ui::ControlOption> ControlOptionsFor(const std::vector<AudioDeviceOption>& options)
{
    std::vector<ui::ControlOption> controls;
    controls.reserve(options.size());
    for (const AudioDeviceOption& option : options)
    {
        controls.push_back(ui::ControlOption{option.id, option.label});
    }
    return controls;
}

}  // namespace PageControls

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
    ui::Builder builder;
    builder.Root(NodeIds::kSyncRoot, area);
    builder.Button(NodeIds::kSyncBack, "Back", ui::Action::Named(Actions::kSyncBack), PageControls::Button());
    builder.Column(NodeIds::kSyncForm, PageControls::FormGridLayout(), [&](ui::Builder& form) {
        form.Toggle(NodeIds::kSyncSendClock,
                    "",
                    snapshot.staged.sendClock,
                    ui::Action::Named(Actions::kSyncSendClock),
                    PageControls::Toggle("Send clock"));
        form.Toggle(NodeIds::kSyncReceiveClock,
                    "",
                    snapshot.staged.receiveClock,
                    ui::Action::Named(Actions::kSyncReceiveClock),
                    PageControls::Toggle("Receive clock"));
        form.Toggle(NodeIds::kSyncSendTransport,
                    "",
                    snapshot.staged.sendTransport,
                    ui::Action::Named(Actions::kSyncSendTransport),
                    PageControls::Toggle("Send transport"));
        form.Toggle(NodeIds::kSyncReceiveTransport,
                    "",
                    snapshot.staged.receiveTransport,
                    ui::Action::Named(Actions::kSyncReceiveTransport),
                    PageControls::Toggle("Receive transport"));
        form.TextField(NodeIds::kSyncPpqn,
                       "",
                       std::to_string(snapshot.staged.ppqn),
                       ui::Action::Named(Actions::kSyncPpqn),
                       PageControls::Field("PPQN (1-960)"));
    });
    builder.Column(NodeIds::kSyncStatus, PageControls::StatusStackLayout(), [&](ui::Builder& status) {
        status.StatusText(NodeIds::kSyncValidation,
                          snapshot.validationText,
                          snapshot.validationText.empty() ? PageControls::MutedText()
                                                          : PageControls::DangerText());
        status.StatusText(NodeIds::kSyncWarning,
                          snapshot.warningText,
                          snapshot.warningText.empty() ? PageControls::MutedText()
                                                       : PageControls::DangerText());
        status.StatusText(NodeIds::kSyncBpm,
                          FormatSyncBpm(snapshot.status.currentBpm),
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncLock,
                          "Lock: " + snapshot.status.lockState,
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncSource,
                          "Source: " + snapshot.status.sourceName,
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncOutputLatency,
                          FormatSyncOutputLatency(snapshot.status.outputLatencyMicros),
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncIgnoredInput,
                          "Ignored input: " + std::to_string(snapshot.status.ignoredInputCount),
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncLateEvents,
                          "Late events: " + std::to_string(snapshot.status.lateEventCount),
                          PageControls::MutedText());
        status.StatusText(NodeIds::kSyncDroppedOutput,
                          "Dropped output: " + std::to_string(snapshot.status.droppedOutputCount),
                          PageControls::MutedText());
    });
    return builder.Build(area);
}

inline ui::NodeTree BuildAudioPageTree(const AudioPageSnapshot& snapshot, ui::Bounds area)
{
    ui::Builder builder;
    builder.Root(NodeIds::kAudioRoot, area);
    builder.Button(NodeIds::kAudioBack, "Back", ui::Action::Named(Actions::kAudioBack), PageControls::Button());
    builder.Column(NodeIds::kAudioForm, PageControls::FormGridLayout(), [&](ui::Builder& form) {
        form.ComboBox(NodeIds::kAudioOutput,
                      "",
                      PageControls::ControlOptionsFor(snapshot.outputOptions),
                      snapshot.selectedOutputId,
                      ui::Action::Named(Actions::kAudioOutputSelect),
                      PageControls::Field("Output device"));
        if (snapshot.showInputCombo)
        {
            form.ComboBox(NodeIds::kAudioInput,
                          "",
                          PageControls::ControlOptionsFor(snapshot.inputOptions),
                          snapshot.selectedInputId,
                          ui::Action::Named(Actions::kAudioInputSelect),
                          PageControls::Field("Input device"));
        }
    });
    builder.Label(NodeIds::kAudioDeviceLine,
                  snapshot.deviceLineText,
                  PageControls::MutedText());
    builder.StatusText(NodeIds::kAudioStatusLine,
                       snapshot.statusLineText,
                       PageControls::MutedText());
    return builder.Build(area);
}

inline bool FileStatusIsError(const std::string& statusText)
{
    return statusText == "Patch root is not configured" ||
           statusText == "Could not read patch root" ||
           statusText == "Could not open patch directory" ||
           statusText == "Patch already exists" ||
           statusText == "Enter a valid patch name" ||
           statusText == "Select a patch directory";
}

inline ui::ControlStyle FileStatusStyle(const std::string& statusText, float height)
{
    return PageControls::PanelTextRow(
        FileStatusIsError(statusText) ? pagestyle::kDangerTextStyle : pagestyle::kMutedTextStyle,
        height);
}

inline std::string FilePatchRootText(const FilePageSnapshot& snapshot)
{
    return snapshot.patchesRoot.empty() ? "Patch root not configured"
                                        : "Patch root: " + snapshot.patchesRoot;
}

inline std::vector<PageControls::ListRowSpec> PatchBrowserRows(const FilePageSnapshot& snapshot)
{
    std::vector<PageControls::ListRowSpec> rows;
    rows.reserve(snapshot.browserEntries.size());
    for (std::size_t ix = 0; ix < snapshot.browserEntries.size(); ++ix)
    {
        const FilePageSnapshot::BrowserEntry& entry = snapshot.browserEntries[ix];
        rows.push_back(PageControls::ListRowSpec{
            .id = NodeIds::FileBrowserEntry(ix),
            .label = entry.name,
            .selected = entry.selected,
            .action = ui::Action::WithValue(Actions::kFileBrowserSelect, std::to_string(ix)),
            .doubleClickAction = ui::Action::WithValue(
                snapshot.browserKind == FileBrowserKind::SaveAs ? Actions::kFileBrowserOverwriteSaveAs
                                                                : Actions::kFileBrowserAccept,
                std::to_string(ix)),
        });
    }
    return rows;
}

inline std::vector<PageControls::ListRowSpec> PatchVersionRows(const FilePageSnapshot& snapshot)
{
    std::vector<PageControls::ListRowSpec> rows;
    rows.reserve(snapshot.versionEntries.size());
    for (std::size_t ix = 0; ix < snapshot.versionEntries.size(); ++ix)
    {
        const FilePageSnapshot::VersionEntry& entry = snapshot.versionEntries[ix];
        // No plain click action: selecting a version means nothing, so the row
        // says so rather than carrying an empty-named one.
        rows.push_back(PageControls::ListRowSpec{
            .id = NodeIds::FileVersionEntry(ix),
            .label = entry.label,
            .doubleClickAction = ui::Action::WithValue(Actions::kFileConfirmedLoad, entry.path),
        });
    }
    return rows;
}

// The whole patch-browser viewer, which is what sru-16 asks for: the flat
// directory rows with their stable identities, selection and double-click
// accept actions, the Save As name entry, the status text, the empty state, and
// the confirm/cancel actions. The host page contributes the panel these land in
// and the splice, and nothing else.
//
// Rootless by construction: these regions are the subtree's forest roots, so
// they attach to whatever scope splices them, and the producer names no extent,
// no position, and no row count that fits. How much of a long list is on screen
// is the ScrollArea's business, not this function's.
inline ui::Subtree BuildPatchBrowserSubtree(const FilePageSnapshot& snapshot)
{
    const bool saving = snapshot.browserKind == FileBrowserKind::SaveAs;
    ui::Builder viewer;
    viewer.Rootless();
    viewer.Label(NodeIds::kFileBrowserTitle,
                 saving ? "Save Patch" : "Load Patch",
                 PageControls::PanelTextRow(pagestyle::kTitleTextStyle, Layout::kBrowserHeaderHeight));
    if (saving)
    {
        ui::ControlStyle name = PageControls::Field("Patch name");
        name.layout.main = ui::Extent::Px(Layout::kBrowserCommandHeight);
        viewer.TextField(NodeIds::kFileBrowserSaveName,
                         "",
                         snapshot.browserSaveName,
                         ui::Action::Named(Actions::kFileBrowserSaveName),
                         std::move(name));
    }
    viewer.StatusText(NodeIds::kFileStatus,
                      snapshot.statusText,
                      FileStatusStyle(snapshot.statusText, Layout::kBrowserStatusHeight));
    viewer.ScrollArea(NodeIds::kFileBrowserList,
                      PageControls::ListLayout(),
                      PageControls::ListRows(PatchBrowserRows(snapshot),
                                             NodeIds::FileBrowserEntry(0),
                                             "(no patch directories)"));
    // Confirm and cancel pack from the left of an in-flow row at the foot of
    // the viewer, where the recovered construction right-aligned them against a
    // hand-computed bottom edge. The in-flow placement is deliberate, not a
    // side effect: the scrolling region above absorbs the panel's slack, so
    // this row lands on the panel's bottom padding with no producer arithmetic.
    viewer.Row(NodeIds::kFileBrowserActions,
               PageControls::PanelGroupLayout(ui::Extent::Px(Layout::kBrowserCommandHeight)),
               [saving](ui::Builder& actions) {
                   const ui::Extent width =
                       ui::Extent::Weight(1.0f).Max(Layout::kBrowserButtonWidth);
                   const ui::Extent height = ui::Extent::Weight(1.0f);
                   actions.Button(NodeIds::kFileBrowserConfirm,
                                  saving ? "Save" : "Load",
                                  ui::Action::Named(Actions::kFileBrowserConfirm),
                                  PageControls::PrimaryRowButton(width, height));
                   actions.Button(NodeIds::kFileBrowserCancel,
                                  "Cancel",
                                  ui::Action::Named(Actions::kFileBrowserCancel),
                                  PageControls::RowButton(width, height));
               });
    return viewer.BuildSubtree();
}

// The saved-version viewer, produced the same way and for the same reason: it
// is the page's second unbounded row list, its rows carry a double-click load
// and nothing else, and it must stay readable at every length too.
inline ui::Subtree BuildPatchVersionsSubtree(const FilePageSnapshot& snapshot)
{
    ui::Builder versions;
    versions.Rootless();
    versions.Label(NodeIds::kFileVersionsTitle,
                   "Versions",
                   PageControls::PanelTextRow(pagestyle::kTitleTextStyle, Layout::kPatchNameRowHeight));
    versions.ScrollArea(NodeIds::kFileVersionsList,
                        PageControls::ListLayout(),
                        PageControls::ListRows(PatchVersionRows(snapshot),
                                               NodeIds::FileVersionEntry(0),
                                               "No saved versions"));
    return versions.BuildSubtree();
}

inline ui::NodeTree BuildFilePageTree(const FilePageSnapshot& snapshot, ui::Bounds area)
{
    ui::Builder builder;
    builder.Root(NodeIds::kFileRoot, area);
    builder.Column(NodeIds::kFilePage, PageControls::PageLayout(), [&](ui::Builder& page) {
        page.Draw(std::string(NodeIds::kFileHeader) + ".background",
                  PageControls::PanelUnderlayLayout(NodeIds::kFileHeader),
                  PageControls::PanelUnderlayFill(pagestyle::kHeaderPanelFill,
                                                  pagestyle::kHeaderPanelBorder));
        page.Row(NodeIds::kFileHeader,
                 PageControls::PanelLayout(ui::Extent::Intrinsic()),
                 [&](ui::Builder& header) {
                     header.Column(NodeIds::kFileHeaderText,
                                   PageControls::PanelGroupLayout(ui::Extent::Weight(1.0f)),
                                   [&](ui::Builder& text) {
                                       text.Label(NodeIds::kFilePatchName,
                                                  snapshot.patchNameText,
                                                  PageControls::PanelText(
                                                      snapshot.hasCurrentPatch
                                                          ? pagestyle::kTitleTextStyle
                                                          : pagestyle::kMutedTitleTextStyle));
                                       text.StatusText(NodeIds::kFilePatchRoot,
                                                       FilePatchRootText(snapshot),
                                                       PageControls::PanelText(
                                                           pagestyle::kMutedTextStyle));
                                   });
                     header.Button(NodeIds::kFileBack,
                                   "Back",
                                   ui::Action::Named(Actions::kFileBack),
                                   PageControls::RowButton(ui::Extent::Px(Layout::kBackButtonWidth),
                                                           ui::Extent::Px(Layout::kBackRowHeight)));
                 });

        page.Row(NodeIds::kFileCommandStrip,
                 PageControls::PanelGroupLayout(ui::Extent::Intrinsic()),
                 [&](ui::Builder& strip) {
                     const ui::Extent width =
                         ui::Extent::Weight(1.0f).Max(Layout::kPatchButtonWidth);
                     const ui::Extent height = ui::Extent::Px(Layout::kPatchRowHeight);
                     strip.Button(NodeIds::kFileNew, "New",
                                  ui::Action::Named(Actions::kFileNew),
                                  PageControls::RowButton(width, height));
                     strip.Button(NodeIds::kFileSave, "Save",
                                  ui::Action::Named(Actions::kFileSave),
                                  PageControls::PrimaryRowButton(width, height));
                     strip.Button(NodeIds::kFileSaveAs, "Save As",
                                  ui::Action::Named(Actions::kFileSaveAs),
                                  PageControls::RowButton(width, height));
                     strip.Button(NodeIds::kFileLoad, "Load",
                                  ui::Action::Named(Actions::kFileLoad),
                                  PageControls::RowButton(width, height));
                     strip.Button(NodeIds::kFileRevert, "Revert",
                                  ui::Action::Named(Actions::kFileRevert),
                                  PageControls::RowButton(width, height));
                 });

        if (snapshot.browserOpen)
        {
            page.Draw(std::string(NodeIds::kFileBrowser) + ".background",
                      PageControls::PanelUnderlayLayout(NodeIds::kFileBrowser),
                      PageControls::PanelUnderlayFill(pagestyle::kBrowserPanelFill,
                                                      pagestyle::kBrowserPanelBorder));
            page.Section(NodeIds::kFileBrowser,
                         PageControls::PanelLayout(ui::Extent::Weight(1.0f)),
                         [&](ui::Builder& browser) {
                             browser.Splice(BuildPatchBrowserSubtree(snapshot));
                         });
            return;
        }

        page.Draw(std::string(NodeIds::kFileIdleRegion) + ".background",
                  PageControls::PanelUnderlayLayout(NodeIds::kFileIdleRegion),
                  PageControls::PanelUnderlayFill(pagestyle::kIdlePanelFill,
                                                  pagestyle::kIdlePanelBorder));
        page.Section(NodeIds::kFileIdleRegion,
                     PageControls::PanelLayout(ui::Extent::Weight(1.0f)),
                     [&](ui::Builder& idle) {
                         idle.StatusText(NodeIds::kFileStatus,
                                         snapshot.statusText,
                                         FileStatusStyle(snapshot.statusText,
                                                         Layout::kPatchNameRowHeight));
                         if (!snapshot.hasCurrentPatch)
                         {
                             idle.Label(std::string(NodeIds::kFileIdleRegion) + ".message",
                                        "Save or load a patch to begin",
                                        PageControls::PanelTextRow(pagestyle::kMutedTextStyle,
                                                                   Layout::kPatchNameRowHeight));
                             return;
                         }
                         idle.Section(NodeIds::kFileVersions,
                                      PageControls::PanelGroupLayout(ui::Extent::Weight(1.0f)),
                                      [&](ui::Builder& versions) {
                                          versions.Splice(BuildPatchVersionsSubtree(snapshot));
                                      });
                     });
    });
    return builder.Build(area);
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
