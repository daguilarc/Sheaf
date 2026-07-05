#include "synth/AppConcepts.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/ControllersPageUI.hpp"
#include "synth/MidiController.hpp"

#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>

#ifdef JUCE_MAJOR_VERSION
#error "portable UI tests must not see JUCE"
#endif

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

struct TestSurface final : synth::ui::Surface
{
    synth::ui::NodeTree BuildTree() override
    {
        return {};
    }
    void SetActionHandler(ActionHandler) override {}
    void DispatchAction(const synth::ui::Action&) override {}
};

struct TestApp
{
    static synth::RuntimeConfig Config()
    {
        return {};
    }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface()
    {
        return surface;
    }
    TestSurface surface;
};

}  // namespace

int main()
{
    static_assert(synth::SynthApplication<TestApp>);
    static_assert(!synth::ui::kPortableUiUsesJuce);

    synth::ui::Builder builder;
    builder.Root("root", synth::ui::Bounds{0.0f, 0.0f, 640.0f, 480.0f})
        .Label("title", "Synth Params")
        .Button("start", "Start", synth::ui::Action::Named("start"))
        .Toggle("gesture", "Gesture", true, synth::ui::Action::Named("gesture.toggle"))
        .Slider("blend", "Blend", 0.25f, 0.0f, 1.0f, 0.001f, synth::ui::Action::Named("blend.set"))
        .ComboBox("device", "Device", {{"a", "Built In"}, {"b", "External"}}, "a",
                  synth::ui::Action::Named("device.select"))
        .TextField("value", "Value", "64", synth::ui::Action::Named("value.commit"))
        .Draw("scope", synth::ui::Bounds{10.0f, 10.0f, 100.0f, 80.0f},
              {synth::ui::DrawCommand::Fill(synth::ui::Color::Rgb(24, 26, 28)),
               synth::ui::DrawCommand::Line({0.0f, 0.0f}, {100.0f, 80.0f}, synth::ui::Color::Rgb(255, 255, 255), 1.0f)});

    const synth::ui::NodeTree tree = builder.Build();
    Require(tree.nodes.size() == 8, "tree should contain root plus seven children");
    Require(tree.nodes[0].id == synth::ui::NodeId("root"), "root id");
    Require(tree.nodes[7].drawCommands.size() == 2, "draw commands");

    synth::runtime_ui::SidebarSnapshot sidebarSnapshot;
    sidebarSnapshot.deadlinePercent = 12.5f;
    const synth::ui::NodeTree sidebarTree = synth::runtime_ui::BuildSidebarTree(sidebarSnapshot);
    Require(FindNodeById(sidebarTree, synth::runtime_ui::NodeIds::kSidebarAudio) != nullptr, "sidebar audio node");
    Require(FindNodeById(sidebarTree, synth::runtime_ui::NodeIds::kSidebarControllers) != nullptr,
            "sidebar controllers node");
    Require(FindNodeById(sidebarTree, synth::runtime_ui::NodeIds::kSidebarFile) != nullptr, "sidebar file node");
    Require(FindNodeById(sidebarTree, synth::runtime_ui::NodeIds::kSidebarDeadline) != nullptr,
            "sidebar deadline node");
    const synth::ui::Node* deadlineNode = FindNodeById(sidebarTree, synth::runtime_ui::NodeIds::kSidebarDeadline);
    Require(deadlineNode->text == "12.5%", "deadline readout text");

    synth::runtime_ui::AudioPageSnapshot audioSnapshot;
    audioSnapshot.outputOptions = synth::runtime_ui::Layout::BuildDeviceOptions({"Speakers", "Headphones"});
    audioSnapshot.inputOptions = synth::runtime_ui::Layout::BuildDeviceOptions({"Mic"});
    Require(synth::runtime_ui::Layout::SelectedDeviceOptionId("Headphones", audioSnapshot.outputOptions) ==
                "Headphones",
            "known audio device option stays selected");
    Require(synth::runtime_ui::Layout::SelectedDeviceOptionId("Vanished Device", audioSnapshot.outputOptions) ==
                synth::runtime_ui::kSystemDefaultOptionId,
            "unknown audio device option falls back to system default");
    audioSnapshot.selectedOutputId = "Speakers";
    audioSnapshot.selectedInputId = synth::runtime_ui::kSystemDefaultOptionId;
    audioSnapshot.showInputCombo = true;
    audioSnapshot.deviceLineText = "Speakers: 48000 Hz, 512 frames";
    audioSnapshot.statusLineText = "Audio: Speakers";
    const synth::ui::NodeTree audioTree =
        synth::runtime_ui::BuildAudioPageTree(audioSnapshot, synth::ui::Bounds{0.0f, 0.0f, 640.0f, 480.0f});
    Require(FindNodeById(audioTree, synth::runtime_ui::NodeIds::kAudioBack) != nullptr, "audio back node");
    Require(FindNodeById(audioTree, synth::runtime_ui::NodeIds::kAudioOutput) != nullptr, "audio output node");
    Require(FindNodeById(audioTree, synth::runtime_ui::NodeIds::kAudioInput) != nullptr, "audio input node");
    Require(FindNodeById(audioTree, synth::runtime_ui::NodeIds::kAudioDeviceLine) != nullptr, "audio device line");
    Require(FindNodeById(audioTree, synth::runtime_ui::NodeIds::kAudioStatusLine) != nullptr, "audio status line");

    synth::runtime_ui::FilePageSnapshot fileSnapshot;
    fileSnapshot.patchNameText = "my_patch";
    fileSnapshot.statusText = "Save requested";
    fileSnapshot.hasCurrentPatch = true;
    const synth::ui::NodeTree fileTree =
        synth::runtime_ui::BuildFilePageTree(fileSnapshot, synth::ui::Bounds{0.0f, 0.0f, 640.0f, 480.0f});
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileBack) != nullptr, "file back node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileNew) != nullptr, "file new node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileSave) != nullptr, "file save node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileSaveAs) != nullptr, "file save as node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileLoad) != nullptr, "file load node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileRevert) != nullptr, "file revert node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFilePatchName) != nullptr, "file patch name node");
    Require(FindNodeById(fileTree, synth::runtime_ui::NodeIds::kFileStatus) != nullptr, "file status node");

    synth::runtime_ui::SidebarSurface sidebarSurface;
    sidebarSurface.SetDeadlinePercent(3.0f);
    const synth::ui::NodeTree sidebarBuilt = sidebarSurface.BuildTree();
    Require(FindNodeById(sidebarBuilt, synth::runtime_ui::NodeIds::kSidebarDeadline)->text == "3.0%",
            "sidebar surface deadline refresh");

    synth::runtime_ui::AudioPageSurface audioSurface;
    audioSurface.Snapshot() = audioSnapshot;
    audioSurface.SetContentBounds({0.0f, 0.0f, 640.0f, 480.0f});
    Require(audioSurface.BuildTree().nodes.size() >= 5, "audio surface builds semantic tree");

    synth::runtime_ui::FilePageSurface fileSurface;
    fileSurface.Snapshot() = fileSnapshot;
    const std::filesystem::path patchRoot =
        std::filesystem::temp_directory_path() / "sheaf_portable_file_page_test";
    std::filesystem::remove_all(patchRoot);
    std::filesystem::create_directories(patchRoot / "PatchA");
    const std::filesystem::path canonicalPatchRoot = std::filesystem::weakly_canonical(patchRoot);
    fileSurface.Snapshot().patchesRoot = patchRoot.string();
    fileSurface.SetContentBounds({0.0f, 0.0f, 640.0f, 480.0f});
    fileSurface.SetStatus("Ready");
    Require(FindNodeById(fileSurface.BuildTree(), synth::runtime_ui::NodeIds::kFileStatus)->text == "Ready",
            "file surface status refresh");

    synth::ui::Action lastFileAction;
    fileSurface.SetActionHandler([&lastFileAction](const synth::ui::Action& action) {
        lastFileAction = action;
    });
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
    synth::ui::NodeTree saveAsTree = fileSurface.BuildTree();
    Require(FindNodeById(saveAsTree, synth::runtime_ui::NodeIds::kFileBrowser) != nullptr,
            "save-as browser opens in file page tree");
    Require(FindNodeById(saveAsTree, synth::runtime_ui::NodeIds::kFileBrowserSaveName) != nullptr,
            "save-as browser exposes patch-name field");
    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "New Patch"));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name == synth::runtime_ui::Actions::kFileConfirmedSaveAs,
            "save-as browser confirms with resolved path action");
    Require(lastFileAction.value == (canonicalPatchRoot / "New Patch").string(),
            "save-as path resolves under patch root");

    lastFileAction = {};
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
    synth::ui::NodeTree loadTree = fileSurface.BuildTree();
    Require(FindNodeById(loadTree, synth::runtime_ui::NodeIds::FileBrowserEntry(0).c_str()) != nullptr,
            "load browser lists patch directory");
    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSelect, "0"));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name == synth::runtime_ui::Actions::kFileConfirmedLoad,
            "load browser confirms with resolved path action");
    Require(lastFileAction.value == (canonicalPatchRoot / "PatchA").string(),
            "load path resolves selected patch directory");
    std::filesystem::remove_all(patchRoot);

    synth::MidiInstrumentConfig controllerInstrument;
    synth::MidiControllerSlot wrldSlot;
    wrldSlot.name = "wrld";
    wrldSlot.kind = synth::MidiProfileKind::WrldBldr;
    wrldSlot.config = synth::WrldBldrDefaultProfileConfig();
    Require(controllerInstrument.AddController(std::move(wrldSlot)), "add wrld controller");
    synth::MidiConnectionState controllerConnection;
    controllerConnection.controllers.push_back({});

    synth::runtime_ui::ControllersPageCallbacks controllerCallbacks;
    controllerCallbacks.instrumentSnapshot = [&controllerInstrument] { return controllerInstrument; };
    controllerCallbacks.connectionState = [&controllerConnection] { return controllerConnection; };
    synth::runtime_ui::ControllersPageSurface controllersSurface(std::move(controllerCallbacks));
    controllersSurface.SetContentBounds({0.0f, 0.0f, 800.0f, 600.0f});
    controllersSurface.MarkDirty();
    controllersSurface.RefreshOnTick();
    Require(controllersSurface.BuildTree().nodes.size() >= 4, "controllers surface builds semantic tree");

    return 0;
}
