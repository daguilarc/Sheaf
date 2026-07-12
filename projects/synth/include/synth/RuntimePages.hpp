#pragma once

// JUCE-free runtime page models: sidebar, Audio page, and File page semantic
// trees plus action names and layout helpers (OpenSpec tasks 4.1–4.3).

#include "synth/PatchBrowser.hpp"
#include "synth/PortableUI.hpp"

#include <algorithm>
#include <cstdio>
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
inline constexpr const char* kSidebarFile = "runtime.sidebar.file";
inline constexpr const char* kSidebarDeadline = "runtime.sidebar.deadline";

inline constexpr const char* kAudioRoot = "runtime.audio.root";
inline constexpr const char* kAudioBack = "runtime.audio.back";
inline constexpr const char* kAudioOutput = "runtime.audio.output";
inline constexpr const char* kAudioInput = "runtime.audio.input";
inline constexpr const char* kAudioDeviceLine = "runtime.audio.device_line";
inline constexpr const char* kAudioStatusLine = "runtime.audio.status_line";

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
inline constexpr const char* kSidebarFile = "runtime.sidebar.file";

inline constexpr const char* kAudioBack = "runtime.audio.back";
inline constexpr const char* kAudioOutputSelect = "runtime.audio.output.select";
inline constexpr const char* kAudioInputSelect = "runtime.audio.input.select";

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
    return {0.0f, 0.0f, kSidebarWidth, kSidebarButtonHeight * 4.0f};
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

    ui::Node fileButton;
    fileButton.id = NodeIds::kSidebarFile;
    fileButton.kind = ui::NodeKind::Button;
    fileButton.label = "File";
    fileButton.bounds = {0.0f,
                         Layout::kSidebarButtonHeight * 2.0f,
                         Layout::kSidebarWidth,
                         Layout::kSidebarButtonHeight};
    fileButton.action = ui::Action::Named(Actions::kSidebarFile);
    appendChild(std::move(fileButton));

    ui::Node deadlineLabel;
    deadlineLabel.id = NodeIds::kSidebarDeadline;
    deadlineLabel.kind = ui::NodeKind::StatusText;
    deadlineLabel.text = Layout::FormatDeadlineText(snapshot.deadlinePercent);
    deadlineLabel.bounds = {0.0f,
                            Layout::kSidebarButtonHeight * 3.0f,
                            Layout::kSidebarWidth,
                            Layout::kSidebarButtonHeight};
    appendChild(std::move(deadlineLabel));

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

    float y = area.y + Layout::kPageMargin;
    const float contentX = area.x + Layout::kPageMargin;
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
    const float contentX = area.x + margin;
    const float contentWidth = std::max(0.0f, area.width - margin * 2.0f);
    const float contentRight = contentX + contentWidth;
    const float pageBottom = area.y + std::max(0.0f, area.height) - margin;

    ui::Node background;
    background.id = NodeIds::kFileBackground;
    background.kind = ui::NodeKind::Draw;
    background.bounds = area;
    background.drawCommands = {
        ui::DrawCommand::Fill(area, Color::Rgb(18, 20, 22)),
    };
    appendRootChild(std::move(background));

    float y = area.y + margin;

    ui::Node header;
    header.id = NodeIds::kFileHeader;
    header.kind = ui::NodeKind::Section;
    header.bounds = {contentX, y, contentWidth, 70.0f};
    header.variant = "panel";
    const std::size_t headerIndex = appendRootChild(std::move(header));

    ui::Node headerDraw;
    headerDraw.id = ui::NodeId(std::string(NodeIds::kFileHeader) + ".background");
    headerDraw.kind = ui::NodeKind::Draw;
    headerDraw.bounds = tree.nodes[headerIndex].bounds;
    headerDraw.drawCommands = {
        ui::DrawCommand::FillRoundedRect(tree.nodes[headerIndex].bounds, 6.0f, Color::Rgb(29, 33, 37)),
        ui::DrawCommand::StrokeRoundedRect(tree.nodes[headerIndex].bounds, 6.0f, Color::Rgb(54, 61, 68), 1.0f),
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
    backButton.bounds = {contentRight - headerPad - backWidth,
                         y + headerPad,
                         backWidth,
                         Layout::kBackRowHeight};
    backButton.action = ui::Action::Named(Actions::kFileBack);
    appendChildTo(headerIndex, std::move(backButton));

    ui::Node patchName;
    patchName.id = NodeIds::kFilePatchName;
    patchName.kind = ui::NodeKind::Label;
    patchName.text = snapshot.patchNameText;
    patchName.variant = snapshot.hasCurrentPatch ? "title" : "muted-title";
    patchName.bounds = {contentX + headerPad, y + headerPad, headerTextWidth, Layout::kPatchNameRowHeight};
    appendChildTo(headerIndex, std::move(patchName));

    ui::Node patchRoot;
    patchRoot.id = NodeIds::kFilePatchRoot;
    patchRoot.kind = ui::NodeKind::StatusText;
    patchRoot.text = snapshot.patchesRoot.empty() ? "Patch root not configured" : "Patch root: " + snapshot.patchesRoot;
    patchRoot.variant = "quiet";
    patchRoot.bounds = {contentX + headerPad,
                        y + headerPad + Layout::kPatchNameRowHeight,
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
    float buttonX = contentX;
    const auto appendPatchButton = [&](const char* id, const char* label, const char* actionName) {
        ui::Node button;
        button.id = ui::NodeId(id);
        button.kind = ui::NodeKind::Button;
        button.label = label;
        button.variant = std::string(actionName) == Actions::kFileSave ? "primary" : "secondary";
        button.bounds = {buttonX, y, commandButtonWidth, Layout::kPatchRowHeight};
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
        browserDraw.bounds = tree.nodes[browserIndex].bounds;
        browserDraw.drawCommands = {
            ui::DrawCommand::FillRoundedRect(tree.nodes[browserIndex].bounds, 6.0f, Color::Rgb(24, 28, 32)),
            ui::DrawCommand::StrokeRoundedRect(tree.nodes[browserIndex].bounds, 6.0f, Color::Rgb(63, 73, 82), 1.0f),
        };
        appendChildTo(browserIndex, std::move(browserDraw));

        const ui::Bounds browserBounds = tree.nodes[browserIndex].bounds;
        const float browserPad = contentWidth < 420.0f ? 8.0f : 12.0f;
        const float innerX = browserBounds.x + browserPad;
        const float innerWidth = std::max(0.0f, browserBounds.width - browserPad * 2.0f);
        const float innerRight = innerX + innerWidth;
        const float browserBottom = browserBounds.y + browserBounds.height - browserPad;
        float browserY = browserBounds.y + browserPad;

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
        idleDraw.bounds = tree.nodes[idleIndex].bounds;
        idleDraw.drawCommands = {
            ui::DrawCommand::FillRoundedRect(tree.nodes[idleIndex].bounds, 6.0f, Color::Rgb(23, 26, 29)),
            ui::DrawCommand::StrokeRoundedRect(tree.nodes[idleIndex].bounds, 6.0f, Color::Rgb(48, 55, 62), 1.0f),
        };
        appendChildTo(idleIndex, std::move(idleDraw));

        const float idlePad = contentWidth < 420.0f ? 8.0f : 12.0f;
        ui::Node status;
        status.id = NodeIds::kFileStatus;
        status.kind = ui::NodeKind::StatusText;
        status.text = snapshot.statusText;
        status.variant = FileStatusVariant(snapshot.statusText);
        status.bounds = {contentX + idlePad,
                         y + idlePad,
                         std::max(0.0f, contentWidth - idlePad * 2.0f),
                         Layout::kPatchNameRowHeight};
        appendChildTo(idleIndex, std::move(status));

        float idleY = y + idlePad + Layout::kPatchNameRowHeight + Layout::kRowGap;
        const float idleInnerX = contentX + idlePad;
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
                               std::max(0.0f, tree.nodes[idleIndex].bounds.y + tree.nodes[idleIndex].bounds.height -
                                                  idlePad - idleY)};
            versions.variant = "quiet";
            const std::size_t versionsIndex = appendChildTo(idleIndex, std::move(versions));

            ui::Node versionsTitle;
            versionsTitle.id = NodeIds::kFileVersionsTitle;
            versionsTitle.kind = ui::NodeKind::Label;
            versionsTitle.text = "Versions";
            versionsTitle.variant = "title";
            versionsTitle.bounds = {idleInnerX, idleY, idleInnerWidth, Layout::kPatchNameRowHeight};
            appendChildTo(versionsIndex, std::move(versionsTitle));

            idleY += Layout::kPatchNameRowHeight + Layout::kRowGap;
            const float versionBottom = tree.nodes[versionsIndex].bounds.y + tree.nodes[versionsIndex].bounds.height;
            if (snapshot.versionEntries.empty())
            {
                ui::Node emptyVersions;
                emptyVersions.id = ui::NodeId(NodeIds::FileVersionEntry(0));
                emptyVersions.kind = ui::NodeKind::StatusText;
                emptyVersions.text = "No saved versions";
                emptyVersions.variant = "quiet";
                emptyVersions.bounds = {idleInnerX,
                                        idleY,
                                        idleInnerWidth,
                                        std::min(Layout::kBrowserRowHeight, std::max(0.0f, versionBottom - idleY))};
                appendChildTo(versionsIndex, std::move(emptyVersions));
            }
            else
            {
                for (std::size_t ix = 0; ix < snapshot.versionEntries.size(); ++ix)
                {
                    if (idleY + Layout::kBrowserRowHeight > versionBottom + 0.5f)
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
                    versionButton.bounds = {idleInnerX, idleY, idleInnerWidth, Layout::kBrowserRowHeight};
                    versionButton.doubleClickAction =
                        ui::Action::WithValue(Actions::kFileConfirmedLoad, entry.path);
                    appendChildTo(versionsIndex, std::move(versionButton));
                    idleY += Layout::kBrowserRowHeight;
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

private:
    SidebarSnapshot snapshot_;
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
