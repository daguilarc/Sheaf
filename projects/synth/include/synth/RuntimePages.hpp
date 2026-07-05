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
inline constexpr const char* kFilePatchName = "runtime.file.patch_name";
inline constexpr const char* kFileStatus = "runtime.file.status";
inline constexpr const char* kFileBrowser = "runtime.file.browser";
inline constexpr const char* kFileBrowserTitle = "runtime.file.browser.title";
inline constexpr const char* kFileBrowserCurrentPath = "runtime.file.browser.current_path";
inline constexpr const char* kFileBrowserSaveName = "runtime.file.browser.save_name";
inline constexpr const char* kFileBrowserParent = "runtime.file.browser.parent";
inline constexpr const char* kFileBrowserConfirm = "runtime.file.browser.confirm";
inline constexpr const char* kFileBrowserCancel = "runtime.file.browser.cancel";

inline std::string FileBrowserEntry(std::size_t entryIx)
{
    return "runtime.file.browser.entry." + std::to_string(entryIx);
}

inline std::string FileBrowserEntryOpen(std::size_t entryIx)
{
    return FileBrowserEntry(entryIx) + ".open";
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
inline constexpr const char* kFileBrowserOpen = "runtime.file.browser.open";
inline constexpr const char* kFileBrowserParent = "runtime.file.browser.parent";
inline constexpr const char* kFileBrowserConfirm = "runtime.file.browser.confirm";
inline constexpr const char* kFileBrowserCancel = "runtime.file.browser.cancel";
inline constexpr const char* kFileConfirmedSaveAs = "runtime.file.confirmed.save_as";
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
inline constexpr float kPatchButtonWidth = 84.0f;
inline constexpr float kPatchRowHeight = 36.0f;
inline constexpr float kPatchNameRowHeight = 28.0f;
inline constexpr float kBrowserHeaderHeight = 30.0f;
inline constexpr float kBrowserCommandHeight = 32.0f;
inline constexpr float kBrowserRowHeight = 30.0f;
inline constexpr float kBrowserButtonWidth = 78.0f;
inline constexpr float kBrowserOpenButtonWidth = 58.0f;

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

inline ui::NodeTree BuildFilePageTree(const FilePageSnapshot& snapshot, ui::Bounds area)
{
    ui::NodeTree tree;
    ui::Node root;
    root.id = NodeIds::kFileRoot;
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
    backButton.id = NodeIds::kFileBack;
    backButton.kind = ui::NodeKind::Button;
    backButton.label = "Back";
    backButton.bounds = {contentX, y, Layout::kBackButtonWidth, Layout::kBackRowHeight};
    backButton.action = ui::Action::Named(Actions::kFileBack);
    appendChild(std::move(backButton));

    y += Layout::kBackRowHeight + Layout::kRowGap;

    float buttonX = contentX;
    const auto appendPatchButton = [&](const char* id, const char* label, const char* actionName) {
        ui::Node button;
        button.id = ui::NodeId(id);
        button.kind = ui::NodeKind::Button;
        button.label = label;
        button.bounds = {buttonX, y, Layout::kPatchButtonWidth, Layout::kPatchRowHeight};
        button.action = ui::Action::Named(actionName);
        appendChild(std::move(button));
        buttonX += Layout::kPatchButtonWidth;
    };

    appendPatchButton(NodeIds::kFileNew, "New", Actions::kFileNew);
    appendPatchButton(NodeIds::kFileSave, "Save", Actions::kFileSave);
    appendPatchButton(NodeIds::kFileSaveAs, "Save As", Actions::kFileSaveAs);
    appendPatchButton(NodeIds::kFileLoad, "Load", Actions::kFileLoad);
    appendPatchButton(NodeIds::kFileRevert, "Revert", Actions::kFileRevert);

    y += Layout::kPatchRowHeight;

    ui::Node patchName;
    patchName.id = NodeIds::kFilePatchName;
    patchName.kind = ui::NodeKind::Label;
    patchName.text = snapshot.patchNameText;
    patchName.bounds = {contentX, y, contentWidth, Layout::kPatchNameRowHeight};
    appendChild(std::move(patchName));

    y += Layout::kPatchNameRowHeight;

    ui::Node status;
    status.id = NodeIds::kFileStatus;
    status.kind = ui::NodeKind::StatusText;
    status.text = snapshot.statusText;
    status.bounds = {contentX, y, contentWidth, Layout::kPatchNameRowHeight};
    appendChild(std::move(status));

    y += Layout::kPatchNameRowHeight + Layout::kRowGap;

    if (snapshot.browserOpen)
    {
        ui::Node browser;
        browser.id = NodeIds::kFileBrowser;
        browser.kind = ui::NodeKind::Section;
        browser.bounds = {contentX, y, contentWidth,
                          Layout::kBrowserHeaderHeight + Layout::kBrowserCommandHeight +
                              Layout::kBrowserRowHeight *
                                  static_cast<float>(std::max<std::size_t>(snapshot.browserEntries.size(), 1)) +
                              Layout::kRowGap * 3.0f};
        tree.nodes.front().children.push_back(browser.id);
        const std::size_t browserIndex = tree.nodes.size();
        tree.nodes.push_back(browser);

        auto appendBrowserChild = [&](ui::Node node) {
            node.bounds.x += contentX;
            node.bounds.y += y;
            tree.nodes[browserIndex].children.push_back(node.id);
            tree.nodes.front().children.push_back(node.id);
            tree.nodes.push_back(std::move(node));
        };

        float browserY = 0.0f;
        ui::Node title;
        title.id = NodeIds::kFileBrowserTitle;
        title.kind = ui::NodeKind::Label;
        title.text = snapshot.browserKind == FileBrowserKind::SaveAs ? "Save As" : "Load Patch";
        title.bounds = {0.0f, browserY, contentWidth, Layout::kBrowserHeaderHeight};
        appendBrowserChild(std::move(title));

        browserY += Layout::kBrowserHeaderHeight;
        ui::Node currentPath;
        currentPath.id = NodeIds::kFileBrowserCurrentPath;
        currentPath.kind = ui::NodeKind::StatusText;
        currentPath.text = snapshot.browserCurrentPathText.empty() ? "/" : snapshot.browserCurrentPathText;
        currentPath.bounds = {0.0f, browserY, contentWidth, Layout::kBrowserHeaderHeight};
        appendBrowserChild(std::move(currentPath));

        browserY += Layout::kBrowserHeaderHeight;
        if (snapshot.browserKind == FileBrowserKind::SaveAs)
        {
            ui::Node saveName;
            saveName.id = NodeIds::kFileBrowserSaveName;
            saveName.kind = ui::NodeKind::TextField;
            saveName.label = "Patch name";
            saveName.text = snapshot.browserSaveName;
            saveName.bounds = {0.0f, browserY, std::min(contentWidth, 260.0f), Layout::kBrowserCommandHeight};
            saveName.action = ui::Action::Named(Actions::kFileBrowserSaveName);
            appendBrowserChild(std::move(saveName));
            browserY += Layout::kBrowserCommandHeight + Layout::kRowGap;
        }

        ui::Node parentButton;
        parentButton.id = NodeIds::kFileBrowserParent;
        parentButton.kind = ui::NodeKind::Button;
        parentButton.label = "Parent";
        parentButton.bounds = {0.0f, browserY, Layout::kBrowserButtonWidth, Layout::kBrowserCommandHeight};
        parentButton.action = ui::Action::Named(Actions::kFileBrowserParent);
        appendBrowserChild(std::move(parentButton));

        ui::Node confirmButton;
        confirmButton.id = NodeIds::kFileBrowserConfirm;
        confirmButton.kind = ui::NodeKind::Button;
        confirmButton.label = snapshot.browserKind == FileBrowserKind::SaveAs ? "Save" : "Load";
        confirmButton.bounds = {Layout::kBrowserButtonWidth + Layout::kRowGap, browserY,
                                Layout::kBrowserButtonWidth, Layout::kBrowserCommandHeight};
        confirmButton.action = ui::Action::Named(Actions::kFileBrowserConfirm);
        appendBrowserChild(std::move(confirmButton));

        ui::Node cancelButton;
        cancelButton.id = NodeIds::kFileBrowserCancel;
        cancelButton.kind = ui::NodeKind::Button;
        cancelButton.label = "Cancel";
        cancelButton.bounds = {(Layout::kBrowserButtonWidth + Layout::kRowGap) * 2.0f, browserY,
                               Layout::kBrowserButtonWidth, Layout::kBrowserCommandHeight};
        cancelButton.action = ui::Action::Named(Actions::kFileBrowserCancel);
        appendBrowserChild(std::move(cancelButton));

        browserY += Layout::kBrowserCommandHeight + Layout::kRowGap;
        if (snapshot.browserEntries.empty())
        {
            ui::Node empty;
            empty.id = ui::NodeId(NodeIds::FileBrowserEntry(0));
            empty.kind = ui::NodeKind::StatusText;
            empty.text = "(no patch directories)";
            empty.bounds = {0.0f, browserY, contentWidth, Layout::kBrowserRowHeight};
            appendBrowserChild(std::move(empty));
        }
        else
        {
            for (std::size_t ix = 0; ix < snapshot.browserEntries.size(); ++ix)
            {
                const FilePageSnapshot::BrowserEntry& entry = snapshot.browserEntries[ix];
                ui::Node entryButton;
                entryButton.id = ui::NodeId(NodeIds::FileBrowserEntry(ix));
                entryButton.kind = ui::NodeKind::Button;
                entryButton.label = (entry.selected ? "* " : "") + entry.name;
                entryButton.bounds = {0.0f, browserY, contentWidth - Layout::kBrowserOpenButtonWidth - Layout::kRowGap,
                                      Layout::kBrowserRowHeight};
                entryButton.action = ui::Action::WithValue(Actions::kFileBrowserSelect, std::to_string(ix));
                appendBrowserChild(std::move(entryButton));

                ui::Node openButton;
                openButton.id = ui::NodeId(NodeIds::FileBrowserEntryOpen(ix));
                openButton.kind = ui::NodeKind::Button;
                openButton.label = "Open";
                openButton.bounds = {contentWidth - Layout::kBrowserOpenButtonWidth, browserY,
                                     Layout::kBrowserOpenButtonWidth, Layout::kBrowserRowHeight};
                openButton.action = ui::Action::WithValue(Actions::kFileBrowserOpen, std::to_string(ix));
                appendBrowserChild(std::move(openButton));
                browserY += Layout::kBrowserRowHeight;
            }
        }
    }

    return tree;
}

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
        return BuildFilePageTree(snapshot_, contentBounds_);
    }

    void SetActionHandler(ActionHandler handler) override
    {
        outerHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        if (HandleBrowserAction(action))
        {
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
    void DispatchOut(const ui::Action& action)
    {
        if (outerHandler_)
        {
            outerHandler_(action);
        }
    }

    bool HandleBrowserAction(const ui::Action& action)
    {
        if (action.name == Actions::kFileBrowserCancel)
        {
            CloseBrowser("Ready");
            return true;
        }
        if (action.name == Actions::kFileBrowserSaveName)
        {
            snapshot_.browserSaveName = action.value;
            return true;
        }
        if (action.name == Actions::kFileBrowserParent)
        {
            if (!browser_.EnterParent())
            {
                snapshot_.statusText = "Already at patch root";
            }
            SyncBrowserSnapshot();
            return true;
        }
        if (action.name == Actions::kFileBrowserSelect)
        {
            browser_.Select(ParseIndex(action.value));
            SyncBrowserSnapshot();
            return true;
        }
        if (action.name == Actions::kFileBrowserOpen)
        {
            browser_.Select(ParseIndex(action.value));
            if (!browser_.EnterSelected())
            {
                snapshot_.statusText = "Could not open patch directory";
            }
            SyncBrowserSnapshot();
            return true;
        }
        if (action.name == Actions::kFileBrowserConfirm)
        {
            ConfirmBrowserSelection();
            return true;
        }
        return false;
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

    void OpenBrowser(FileBrowserKind kind)
    {
        if (snapshot_.patchesRoot.empty())
        {
            snapshot_.statusText = "Patch root is not configured";
            return;
        }
        browser_.SetRoot(std::filesystem::path(snapshot_.patchesRoot));
        snapshot_.browserOpen = true;
        snapshot_.browserKind = kind;
        if (kind == FileBrowserKind::SaveAs && snapshot_.browserSaveName.empty() &&
            snapshot_.patchNameText != "(no patch)")
        {
            snapshot_.browserSaveName = snapshot_.patchNameText;
        }
        if (!browser_.Refresh())
        {
            snapshot_.statusText = "Could not read patch root";
        }
        else
        {
            snapshot_.statusText = kind == FileBrowserKind::SaveAs ? "Choose a patch name" : "Choose a patch";
        }
        SyncBrowserSnapshot();
    }

    void CloseBrowser(std::string status)
    {
        snapshot_.browserOpen = false;
        snapshot_.browserEntries.clear();
        snapshot_.browserCurrentPathText = "/";
        snapshot_.statusText = std::move(status);
    }

    void SyncBrowserSnapshot()
    {
        snapshot_.browserCurrentPathText = browser_.CurrentRelativePath().empty()
                                               ? "/"
                                               : browser_.CurrentRelativePath().generic_string();
        snapshot_.browserEntries.clear();
        const std::vector<PatchBrowser::Entry>& entries = browser_.Entries();
        snapshot_.browserEntries.reserve(entries.size());
        for (std::size_t ix = 0; ix < entries.size(); ++ix)
        {
            snapshot_.browserEntries.push_back(FilePageSnapshot::BrowserEntry{
                .name = entries[ix].name,
                .relativePath = entries[ix].relativePath.generic_string(),
                .selected = ix == browser_.SelectedIndex(),
            });
        }
    }

    void ConfirmBrowserSelection()
    {
        if (!snapshot_.browserOpen)
        {
            return;
        }
        if (snapshot_.browserKind == FileBrowserKind::SaveAs)
        {
            const std::optional<std::filesystem::path> path = browser_.ResolveSaveAsPath(snapshot_.browserSaveName);
            if (!path.has_value())
            {
                snapshot_.statusText = "Enter a valid patch name";
                return;
            }
            CloseBrowser("Save As requested: " + path->string());
            DispatchOut(ui::Action::WithValue(Actions::kFileConfirmedSaveAs, path->string()));
            return;
        }

        const std::optional<std::filesystem::path> path = browser_.SelectedLoadPath();
        if (!path.has_value())
        {
            snapshot_.statusText = "Select a patch directory";
            return;
        }
        CloseBrowser("Load requested: " + path->string());
        DispatchOut(ui::Action::WithValue(Actions::kFileConfirmedLoad, path->string()));
    }

    FilePageSnapshot snapshot_;
    ui::Bounds contentBounds_{0.0f, 0.0f, 640.0f, 480.0f};
    ActionHandler outerHandler_;
    PatchBrowser browser_;
};

}  // namespace synth::runtime_ui
