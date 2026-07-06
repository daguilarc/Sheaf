#include "RuntimePagesJuce.hpp"

#include "synth/RuntimePages.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const char* id)
{
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.id == synth::ui::NodeId(id))
        {
            return &node;
        }
    }
    return nullptr;
}

void RequireInsideRoot(const synth_juce::PortableComponent& root,
                       const juce::Component* component,
                       const char* label)
{
    Require(component != nullptr, label);
    const juce::Rectangle<int> boundsInRoot =
        root.getLocalArea(component->getParentComponent(), component->getBounds());
    Require(root.getLocalBounds().contains(boundsInRoot), label);
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    synth_runtime::SidebarHost sidebar;
    sidebar.setSize(static_cast<int>(synth::runtime_ui::Layout::kSidebarWidth), 160);
    sidebar.RefreshFromSurface();

    std::string lastAction;
    sidebar.onAction = [&lastAction](const synth::ui::Action& action) {
        lastAction = action.name;
    };

    synth::runtime_ui::SidebarSurface sidebarSurface;
    sidebarSurface.SetDeadlinePercent(7.5f);
    synth_juce::PortableComponent sidebarRenderer(sidebarSurface);
    sidebarRenderer.setSize(static_cast<int>(synth::runtime_ui::Layout::kSidebarWidth), 160);
    sidebarRenderer.RefreshFromSurface();
    Require(sidebarRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarAudio) != nullptr,
            "sidebar audio control renders");
    Require(sidebarRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarDeadline) != nullptr,
            "sidebar deadline control renders");

    auto* audioButton = dynamic_cast<juce::TextButton*>(
        sidebarRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarAudio));
    Require(audioButton != nullptr, "sidebar audio is a TextButton");
    sidebarSurface.SetActionHandler([&lastAction](const synth::ui::Action& action) {
        lastAction = action.name;
    });
    audioButton->onClick();
    Require(lastAction == synth::runtime_ui::Actions::kSidebarAudio, "sidebar audio dispatches navigation action");

    sidebarSurface.SetDeadlinePercent(9.0f);
    sidebarRenderer.RefreshFromSurface();
    const synth::ui::NodeTree refreshedSidebar = sidebarSurface.BuildTree();
    Require(FindNodeById(refreshedSidebar, synth::runtime_ui::NodeIds::kSidebarDeadline)->text == "9.0%",
            "sidebar deadline refresh updates semantic node");

    synth::runtime_ui::AudioPageSurface audioSurface;
    synth::runtime_ui::AudioPageSnapshot& audioSnapshot = audioSurface.Snapshot();
    audioSnapshot.outputOptions = synth::runtime_ui::Layout::BuildDeviceOptions({"Speakers"});
    audioSnapshot.deviceLineText = "Speakers: 48000 Hz, 512 frames";
    audioSnapshot.statusLineText = "Audio: Speakers";
    audioSnapshot.selectedOutputId = "Speakers";
    audioSurface.SetContentBounds({0.0f, 0.0f, 640.0f, 200.0f});

    synth_juce::PortableComponent audioRenderer(audioSurface);
    audioRenderer.setSize(640, 200);
    audioRenderer.RefreshFromSurface();
    Require(audioRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kAudioOutput) != nullptr,
            "audio output combo renders");
    Require(audioRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kAudioDeviceLine) != nullptr,
            "audio device line renders");

    audioSnapshot.deviceLineText = "Speakers: 44100 Hz, 256 frames";
    audioRenderer.RefreshFromSurface();
    const synth::ui::NodeTree refreshedAudioTree = audioSurface.BuildTree();
    const synth::ui::Node* deviceLine =
        FindNodeById(refreshedAudioTree, synth::runtime_ui::NodeIds::kAudioDeviceLine);
    Require(deviceLine != nullptr && deviceLine->text == "Speakers: 44100 Hz, 256 frames",
            "audio page state refresh updates device line");

    synth::runtime_ui::FilePageSurface fileSurface;
    synth::runtime_ui::FilePageSnapshot& fileSnapshot = fileSurface.Snapshot();
    fileSnapshot.patchNameText = "(no patch)";
    fileSnapshot.statusText = "Ready";
    const std::filesystem::path patchRoot =
        std::filesystem::temp_directory_path() / "sheaf_runtime_pages_juce_test";
    std::filesystem::remove_all(patchRoot);
    std::filesystem::create_directories(patchRoot / "DemoPatch");
    fileSnapshot.patchesRoot = patchRoot.string();
    fileSurface.SetContentBounds({0.0f, 0.0f, 640.0f, 200.0f});

    synth_juce::PortableComponent fileRenderer(fileSurface);
    fileRenderer.setSize(640, 200);
    fileRenderer.RefreshFromSurface();
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileSave) != nullptr, "file save renders");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFilePatchName) != nullptr,
            "file patch name renders");

    fileSnapshot.patchNameText = "demo_patch";
    fileRenderer.RefreshFromSurface();
    const synth::ui::NodeTree refreshedFileTree = fileSurface.BuildTree();
    const synth::ui::Node* patchName =
        FindNodeById(refreshedFileTree, synth::runtime_ui::NodeIds::kFilePatchName);
    Require(patchName != nullptr && patchName->text == "demo_patch", "file page state refresh updates patch name");

    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
    fileSurface.SetContentBounds({0.0f, 0.0f, 760.0f, 420.0f});
    fileRenderer.setSize(760, 420);
    fileRenderer.RefreshFromSurface();
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowser) != nullptr,
            "browser viewer component renders");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserTitle) != nullptr,
            "browser title renders");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserCurrentPath) == nullptr,
            "flat browser omits path control");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserParent) == nullptr,
            "flat browser omits parent control");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::FileBrowserEntryOpen(0)) == nullptr,
            "flat browser omits per-row open control");
    Require(fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::FileBrowserEntry(0)) != nullptr,
            "browser row renders");
    const synth::ui::NodeTree openBrowserTree = fileSurface.BuildTree();
    const std::string firstBrowserEntryId = synth::runtime_ui::NodeIds::FileBrowserEntry(0);
    const synth::ui::Node* browserEntry =
        FindNodeById(openBrowserTree, firstBrowserEntryId.c_str());
    Require(browserEntry != nullptr &&
                browserEntry->doubleClickAction.has_value() &&
                browserEntry->doubleClickAction->name == synth::runtime_ui::Actions::kFileBrowserAccept,
            "flat browser row double-click loads");
    juce::Component* browser = fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowser);
    juce::Component* row = fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::FileBrowserEntry(0));
    Require(browser != nullptr && row != nullptr && browser->getBounds().contains(row->getBounds()),
            "browser row is inside browser viewer bounds");

    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
    fileSurface.SetContentBounds({0.0f, 0.0f, 360.0f, 360.0f});
    fileRenderer.setSize(360, 360);
    fileRenderer.RefreshFromSurface();
    RequireInsideRoot(fileRenderer,
                      fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserSaveName),
                      "narrow save-name field remains inside root bounds");
    RequireInsideRoot(fileRenderer,
                      fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileStatus),
                      "narrow status remains inside root bounds");
    RequireInsideRoot(fileRenderer,
                      fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserConfirm),
                      "narrow confirm remains inside root bounds");
    RequireInsideRoot(fileRenderer,
                      fileRenderer.FindByNodeId(synth::runtime_ui::NodeIds::kFileBrowserCancel),
                      "narrow cancel remains inside root bounds");
    std::filesystem::remove_all(patchRoot);

    std::cout << "RuntimePagesJuceTests passed\n";
    return 0;
}
