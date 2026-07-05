#pragma once

// JUCE-free runtime page models: sidebar, Audio page, and File page semantic
// trees plus action names and layout helpers (OpenSpec tasks 4.1–4.3).

#include "synth/PortableUI.hpp"

#include <cstdio>
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
inline constexpr const char* kFileChooserSaveAs = "runtime.file.chooser.save_as";
inline constexpr const char* kFileChooserLoad = "runtime.file.chooser.load";

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

struct FilePageSnapshot
{
    std::string patchNameText = "(no patch)";
    std::string statusText = "Ready";
    bool hasCurrentPatch = false;
};

enum class FileChooserKind
{
    SaveAs,
    Load
};

struct FileChooserRequest
{
    FileChooserKind kind = FileChooserKind::SaveAs;
    std::string patchesRoot;
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

    return tree;
}

inline std::optional<FileChooserRequest> ParseFileChooserRequest(const ui::Action& action)
{
    if (action.name == Actions::kFileChooserSaveAs)
    {
        FileChooserRequest request;
        request.kind = FileChooserKind::SaveAs;
        request.patchesRoot = action.value;
        return request;
    }
    if (action.name == Actions::kFileChooserLoad)
    {
        FileChooserRequest request;
        request.kind = FileChooserKind::Load;
        request.patchesRoot = action.value;
        return request;
    }
    return std::nullopt;
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
        if (outerHandler_)
        {
            outerHandler_(action);
        }
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
    FilePageSnapshot snapshot_;
    ui::Bounds contentBounds_{0.0f, 0.0f, 640.0f, 480.0f};
    ActionHandler outerHandler_;
};

}  // namespace synth::runtime_ui
