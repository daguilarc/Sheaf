#include "synth/AppConcepts.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/ControllersPageUI.hpp"
#include "synth/DspScope.hpp"
#include "synth/MidiController.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>

#include "../apps/braid-4/Braid4Draw.hpp"
#include "../apps/braid-4/Braid4UiModel.hpp"
#include "../apps/miniapp/MiniAppDraw.hpp"

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

void RequireNear(float actual, float expected, float tolerance, const char* label)
{
    if (std::fabs(actual - expected) > tolerance)
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

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const std::string& id)
{
    return FindNodeById(tree, id.c_str());
}

int CountRootNodes(const synth::ui::NodeTree& tree)
{
    int rootCount = 0;
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.kind == synth::ui::NodeKind::Root)
        {
            ++rootCount;
        }
    }
    return rootCount;
}

bool NodeHasChild(const synth::ui::Node* parent, const synth::ui::NodeId& child)
{
    return parent != nullptr &&
           std::find(parent->children.begin(), parent->children.end(), child) != parent->children.end();
}

bool PointInside(synth::ui::Point point, synth::ui::Bounds bounds)
{
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
           point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

bool BoundsInside(synth::ui::Bounds inner, synth::ui::Bounds outer)
{
    return inner.x >= outer.x && inner.y >= outer.y &&
           inner.x + inner.width <= outer.x + outer.width &&
           inner.y + inner.height <= outer.y + outer.height;
}

void RequireWaveformGeometryInside(const std::vector<synth::ui::DrawCommand>& commands,
                                   synth::ui::Bounds bounds,
                                   const char* label)
{
    std::size_t polylines = 0;
    std::size_t markers = 0;
    for (const synth::ui::DrawCommand& command : commands)
    {
        if (command.kind == synth::ui::DrawCommand::Kind::Polyline)
        {
            ++polylines;
            for (synth::ui::Point point : command.points)
            {
                Require(PointInside(point, bounds), label);
            }
        }
        if (command.kind == synth::ui::DrawCommand::Kind::FillEllipse)
        {
            ++markers;
            Require(BoundsInside(command.bounds, bounds), label);
        }
    }
    Require(polylines > 0, label);
    Require(markers > 0, label);
}

void FillScopeWriter(synth::ScopeWriter& writer, std::size_t channels)
{
    auto holder = writer.ReserveChans(channels);
    for (std::size_t channel = 0; channel < channels; ++channel)
    {
        holder.RecordStart(channel);
    }
    for (std::size_t frame = 0; frame < 64; ++frame)
    {
        for (std::size_t channel = 0; channel < channels; ++channel)
        {
            const float normalized = static_cast<float>((frame + channel * 7) % 32) / 31.0f;
            holder.Write(channel, normalized * 2.0f - 1.0f);
        }
        writer.AdvanceIndex();
    }
    for (std::size_t channel = 0; channel < channels; ++channel)
    {
        holder.RecordEnd(channel);
    }
    writer.Publish();
}

void RequireBrowserIsRootlessDescendant(const synth::ui::NodeTree& tree)
{
    const synth::ui::Node* root = FindNodeById(tree, synth::runtime_ui::NodeIds::kFileRoot);
    const synth::ui::Node* browser = FindNodeById(tree, synth::runtime_ui::NodeIds::kFileBrowser);
    const synth::ui::Node* firstRow = FindNodeById(tree, synth::runtime_ui::NodeIds::FileBrowserEntry(0));
    Require(CountRootNodes(tree) == 1, "file page tree has exactly one root");
    Require(root != nullptr, "file page root exists");
    Require(browser != nullptr, "browser section exists");
    if (firstRow != nullptr)
    {
        Require(NodeHasChild(browser, firstRow->id), "browser row is a browser child");
        Require(!NodeHasChild(root, firstRow->id), "browser row is not a direct file root child");
    }
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
    synth::Parameter::UIState parameterState(1, 1, 1);
    parameterState.connected.store(true);
    parameterState.voiceCount.store(1);
    parameterState.baseColor.Store(synth::Color::Red);
    parameterState.indicatorColors[0].Store(synth::Color::Blue);
    parameterState.modulatorsAffectingMask.store(1u);
    parameterState.gesturesAffectingMask.store(1u);
    parameterState.modulatorColorCount.store(1);
    parameterState.modulatorSourceColors[0].Store(synth::Color::Cyan);
    parameterState.gestureColorCount.store(1);
    parameterState.gestureColors[0].Store(synth::Color::Orange);
    const synth::ui::EncoderDrawState snapshotEncoder =
        synth::ui::EncoderDrawStateFromParameter(parameterState);
    Require(snapshotEncoder.baseColor == synth::Color::Red, "encoder uses snapshot base color");
    Require(snapshotEncoder.voices[0].indicatorColor == synth::Color::Blue,
            "encoder uses snapshot voice-zero indicator color");
    Require(snapshotEncoder.modulatorColors == std::vector<synth::Color>{synth::Color::Cyan},
            "encoder uses snapshot source badge colors");
    Require(snapshotEncoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange},
            "encoder uses snapshot gesture badge colors");

    static_assert(synth::SynthApplication<TestApp>);
    static_assert(!synth::ui::kPortableUiUsesJuce);
    static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);

    synth::ScopeWriter scope(4, 128);
    FillScopeWriter(scope, 4);
    std::vector<synth::ui::WaveformLayerDrawState> waveformLayers{
        {.connected = true, .scopeColor = synth::Color::Red, .scope = &scope, .scopeChannel = 0},
        {.connected = true, .scopeColor = synth::Color::Cyan, .scope = &scope, .scopeChannel = 1},
        {.connected = false, .scopeColor = synth::Color::Green, .scope = &scope, .scopeChannel = 2},
    };
    const auto leftWaveform = synth::ui::BuildScopeWaveformCommands(
        waveformLayers, {10.0f, 20.0f, 180.0f, 90.0f}, -1.1f, 1.1f, 64, true);
    const auto rightWaveform = synth::ui::BuildScopeWaveformCommands(
        waveformLayers, {240.0f, 20.0f, 180.0f, 90.0f}, -1.1f, 1.1f, 64, true);
    RequireWaveformGeometryInside(leftWaveform, {10.0f, 20.0f, 180.0f, 90.0f},
                                  "left waveform geometry stays inside bounds");
    RequireWaveformGeometryInside(rightWaveform, {240.0f, 20.0f, 180.0f, 90.0f},
                                  "right waveform geometry stays inside bounds");

    for (int cell = 0; cell < 4; ++cell)
    {
        std::vector<synth::ui::WaveformLayerDrawState> singleLayer{
            {.connected = true,
             .scopeColor = cell % 2 == 0 ? synth::Color::Yellow : synth::Color::Blue,
             .scope = &scope,
             .scopeChannel = static_cast<std::size_t>(cell)},
        };
        const synth::ui::Bounds cellBounds{
            12.0f + static_cast<float>(cell % 2) * 160.0f,
            160.0f + static_cast<float>(cell / 2) * 120.0f,
            140.0f,
            100.0f,
        };
        const auto commands = synth::ui::BuildScopeWaveformCommands(singleLayer, cellBounds, -1.1f, 1.1f, 64, true);
        RequireWaveformGeometryInside(commands, cellBounds, "quad waveform geometry stays inside its cell");
    }

    synth_miniapp::VcoWaveformDrawState miniVcoState;
    miniVcoState.layers = waveformLayers;
    const synth::ui::Bounds wrapperBounds{30.0f, 300.0f, 240.0f, 120.0f};
    const auto sharedVco = synth::ui::BuildScopeWaveformCommands(
        waveformLayers,
        wrapperBounds,
        synth_miniapp::VcoWaveformDrawState::x_MinY,
        synth_miniapp::VcoWaveformDrawState::x_MaxY,
        synth_miniapp::VcoWaveformDrawState::x_NumSamples,
        true);
    const auto miniVco = synth_miniapp::BuildVcoWaveformCommands(miniVcoState, wrapperBounds);
    Require(sharedVco.size() == miniVco.size(), "miniapp vco wrapper command count matches shared helper");
    for (std::size_t i = 0; i < sharedVco.size(); ++i)
    {
        Require(sharedVco[i].kind == miniVco[i].kind, "miniapp vco wrapper command kind matches shared helper");
        Require(sharedVco[i].color.r == miniVco[i].color.r && sharedVco[i].color.g == miniVco[i].color.g &&
                    sharedVco[i].color.b == miniVco[i].color.b && sharedVco[i].color.a == miniVco[i].color.a,
                "miniapp vco wrapper colors match shared helper");
    }

    synth_miniapp::LfoWaveformDrawState miniLfoState;
    miniLfoState.layers = {{.connected = true, .scopeColor = synth::Color::Orange, .scope = &scope, .scopeChannel = 0}};
    const auto sharedLfo = synth::ui::BuildScopeWaveformCommands(
        miniLfoState.layers,
        wrapperBounds,
        synth_miniapp::LfoWaveformDrawState::x_MinY,
        synth_miniapp::LfoWaveformDrawState::x_MaxY,
        synth_miniapp::LfoWaveformDrawState::x_NumSamples,
        true);
    const auto miniLfo = synth_miniapp::BuildLfoWaveformCommands(miniLfoState, wrapperBounds);
    Require(sharedLfo.size() == miniLfo.size(), "miniapp lfo wrapper command count matches shared helper");
    Require(sharedLfo.front().bounds.width == miniLfo.front().bounds.width &&
                sharedLfo.front().bounds.height == miniLfo.front().bounds.height,
            "miniapp lfo wrapper fill bounds match shared helper");

    Require(synth_braid4::Braid4NodeIds::kRoot == std::string("braid4.root"),
            "braid4 root stable id");
    Require(synth_braid4::Braid4NodeIds::VcoScope(0) == "braid4.scope.vco.0",
            "braid4 vco scope zero stable id");
    Require(synth_braid4::Braid4NodeIds::VcoScope(3) == "braid4.scope.vco.3",
            "braid4 vco scope three stable id");
    Require(synth_braid4::Braid4NodeIds::LfoScope(0) == "braid4.scope.lfo.0",
            "braid4 lfo scope zero stable id");
    Require(synth_braid4::Braid4NodeIds::LfoScope(3) == "braid4.scope.lfo.3",
            "braid4 lfo scope three stable id");
    Require(synth_braid4::Braid4NodeIds::Encoder(0) == "braid4.encoder.0",
            "braid4 encoder zero stable id");
    Require(synth_braid4::Braid4NodeIds::Encoder(15) == "braid4.encoder.15",
            "braid4 encoder fifteen stable id");
    Require(synth_braid4::Braid4NodeIds::SceneButton(0) == "braid4.scene.0",
            "braid4 scene zero stable id");
    Require(synth_braid4::Braid4NodeIds::SceneButton(1) == "braid4.scene.1",
            "braid4 scene one stable id");
    Require(synth_braid4::Braid4NodeIds::kSceneBlend == std::string("braid4.scene.blend"),
            "braid4 scene blend stable id");

    const synth::ui::Bounds braidRoot = synth_braid4::Braid4PageLayout::RootBounds(nullptr);
    RequireNear(braidRoot.width, 900.0f, 0.0001f, "braid4 default width");
    RequireNear(braidRoot.height, 560.0f, 0.0001f, "braid4 default height");

    const synth::ui::Bounds braidContent = synth_braid4::Braid4PageLayout::ContentArea(braidRoot);
    for (std::size_t scopeIx = 0; scopeIx < synth_braid4::Braid4PageLayout::kScopeCount; ++scopeIx)
    {
        Require(BoundsInside(synth_braid4::Braid4PageLayout::ScopeBounds(braidContent, scopeIx), braidRoot),
                "braid4 2x2 scope bounds stay inside default root");
    }
    for (std::size_t encoderIx = 0; encoderIx < synth_braid4::Braid4EncoderGridLayout::kEncoderCount; ++encoderIx)
    {
        Require(BoundsInside(synth_braid4::Braid4EncoderGridLayout::BoundsForIndex(
                                 synth_braid4::Braid4PageLayout::EncoderArea(braidContent), encoderIx),
                             braidRoot),
                "braid4 4x4 encoder bounds stay inside default root");
    }
    Require(BoundsInside(synth_braid4::Braid4PageLayout::SceneStripArea(braidContent), braidRoot),
            "braid4 scene strip stays inside default root");
    Require(!synth_braid4::Braid4PageLayout::NeedsScrolling(braidRoot),
            "braid4 default layout does not need scrolling");

    const auto disconnectedEncoderCommands = synth::ui::BuildEncoderDrawCommands(
        synth::ui::EncoderDrawState{.connected = false},
        {10.0f, 10.0f, 92.0f, 92.0f});
    Require(disconnectedEncoderCommands.empty(), "braid4 disconnected encoder uses shared empty encoder state");

    const std::vector<synth::ui::WaveformLayerDrawState> braidScopeLayer{
        {.connected = true, .scopeColor = synth::Color::Red, .scope = &scope, .scopeChannel = 0},
    };
    const synth::ui::Bounds braidScopeBounds{80.0f, 80.0f, 180.0f, 96.0f};
    const auto sharedBraidScope = synth::ui::BuildScopeWaveformCommands(
        braidScopeLayer,
        braidScopeBounds,
        synth_braid4::Braid4ScopeDrawState::x_MinY,
        synth_braid4::Braid4ScopeDrawState::x_MaxY,
        synth_braid4::Braid4ScopeDrawState::x_NumSamples,
        true);
    const auto wrappedBraidScope = synth_braid4::BuildBraid4ScopeCommands(
        synth_braid4::Braid4ScopeDrawState{.layers = braidScopeLayer},
        braidScopeBounds);
    Require(sharedBraidScope.size() == wrappedBraidScope.size(),
            "braid4 waveform wrapper uses shared scope helper");

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
              {synth::ui::DrawCommand::Fill(synth::Color::Rgb(24, 26, 28)),
               synth::ui::DrawCommand::Line({0.0f, 0.0f}, {100.0f, 80.0f}, synth::Color::Rgb(255, 255, 255), 1.0f)});

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
    RequireBrowserIsRootlessDescendant(saveAsTree);
    Require(fileSurface.Snapshot().browserEntries.size() == 1, "save-as browser lists one patch directory");
    Require(fileSurface.Snapshot().browserEntries[0].name == "PatchA", "save-as browser lists deterministic patch name");

    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "../Outside"));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name.empty(), "invalid save-as target does not dispatch");
    Require(fileSurface.Snapshot().browserOpen, "invalid save-as target keeps browser open");

    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "PatchA"));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name.empty(), "existing save-as target does not dispatch");
    Require(fileSurface.Snapshot().browserOpen, "existing save-as target keeps browser open");
    Require(fileSurface.Snapshot().statusText.find("exists") != std::string::npos,
            "existing save-as target reports exists status");

    std::ofstream(patchRoot / "PatchFile").put('x');
    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "PatchFile"));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name.empty(), "existing save-as file target does not dispatch");
    Require(fileSurface.Snapshot().browserOpen, "existing save-as file target keeps browser open");
    Require(fileSurface.Snapshot().statusText.find("exists") != std::string::npos,
            "existing save-as file target reports exists status");

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
    RequireBrowserIsRootlessDescendant(loadTree);
    fileSurface.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSelect, "0"));
    Require(!fileSurface.Snapshot().browserEntries.empty() && fileSurface.Snapshot().browserEntries[0].selected,
            "load browser exposes selected row state");
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(lastFileAction.name == synth::runtime_ui::Actions::kFileConfirmedLoad,
            "load browser confirms with resolved path action");
    Require(lastFileAction.value == (canonicalPatchRoot / "PatchA").string(),
            "load path resolves selected patch directory");

    lastFileAction = {};
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserCancel));
    Require(lastFileAction.name.empty(), "browser cancel closes without dispatch");
    Require(!fileSurface.Snapshot().browserOpen, "browser cancel closes browser");

    std::filesystem::create_directories(patchRoot / "Beta" / "Nested");
    lastFileAction = {};
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
    Require(fileSurface.Snapshot().browserEntries.size() == 2, "load browser lists deterministic entries");
    Require(fileSurface.Snapshot().browserEntries[0].name == "Beta", "load browser orders beta first");
    Require(fileSurface.Snapshot().browserEntries[1].name == "PatchA", "load browser orders patch second");
    const synth::ui::NodeTree flatLoadTree = fileSurface.BuildTree();
    Require(FindNodeById(flatLoadTree, synth::runtime_ui::NodeIds::kFileBrowserParent) == nullptr,
            "flat browser has no parent button");
    Require(FindNodeById(flatLoadTree, synth::runtime_ui::NodeIds::FileBrowserEntryOpen(0)) == nullptr,
            "flat browser has no open button");
    const synth::ui::Node* firstLoadRow =
        FindNodeById(flatLoadTree, synth::runtime_ui::NodeIds::FileBrowserEntry(0));
    Require(firstLoadRow != nullptr && firstLoadRow->doubleClickAction.has_value(),
            "load row exposes double-click action");
    fileSurface.DispatchAction(*firstLoadRow->doubleClickAction);
    Require(lastFileAction.name == synth::runtime_ui::Actions::kFileConfirmedLoad,
            "load row double-click confirms selected patch");
    Require(lastFileAction.value == (canonicalPatchRoot / "Beta").string(),
            "load row double-click dispatches row patch directory");

    lastFileAction = {};
    fileSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
    const synth::ui::NodeTree saveOverwriteTree = fileSurface.BuildTree();
    const synth::ui::Node* firstSaveRow =
        FindNodeById(saveOverwriteTree, synth::runtime_ui::NodeIds::FileBrowserEntry(0));
    Require(firstSaveRow != nullptr && firstSaveRow->doubleClickAction.has_value(),
            "save-as row exposes double-click overwrite action");
    fileSurface.DispatchAction(*firstSaveRow->doubleClickAction);
    Require(lastFileAction.name == synth::runtime_ui::Actions::kFileConfirmedOverwriteSaveAs,
            "save-as row double-click confirms overwrite save-as");
    Require(lastFileAction.value == (canonicalPatchRoot / "Beta").string(),
            "save-as row double-click dispatches existing patch directory");

    synth::runtime_ui::FilePageSurface versionsSurface;
    versionsSurface.Snapshot().patchesRoot = patchRoot.string();
    versionsSurface.Snapshot().hasCurrentPatch = true;
    versionsSurface.Snapshot().patchNameText = "PatchA";
    {
        std::ofstream(patchRoot / "PatchA" / "20240101T010101Z-000.json").put('1');
        std::ofstream(patchRoot / "PatchA" / "20240202T020202Z-000.json").put('2');
    }
    const synth::ui::NodeTree versionsTree = versionsSurface.BuildTree();
    Require(FindNodeById(versionsTree, synth::runtime_ui::NodeIds::kFileVersions) != nullptr,
            "current patch shows versions section");
    const synth::ui::Node* newestVersion =
        FindNodeById(versionsTree, synth::runtime_ui::NodeIds::FileVersionEntry(0));
    Require(newestVersion != nullptr && newestVersion->text.find("20240202") != std::string::npos,
            "versions list is newest first");
    Require(newestVersion->doubleClickAction.has_value(), "version row exposes double-click load action");
    synth::ui::Action versionAction;
    versionsSurface.SetActionHandler([&versionAction](const synth::ui::Action& action) {
        versionAction = action;
    });
    versionsSurface.DispatchAction(*newestVersion->doubleClickAction);
    Require(versionAction.name == synth::runtime_ui::Actions::kFileConfirmedLoad,
            "version double-click dispatches load");
    Require(versionAction.value == (patchRoot / "PatchA" / "20240202T020202Z-000.json").string(),
            "version double-click dispatches exact version file");

    std::filesystem::remove_all(patchRoot);

    synth::runtime_ui::FilePageSurface emptyLoadSurface;
    const std::filesystem::path emptyRoot =
        std::filesystem::temp_directory_path() / "sheaf_portable_file_page_empty_load_test";
    std::filesystem::remove_all(emptyRoot);
    std::filesystem::create_directories(emptyRoot);
    emptyLoadSurface.Snapshot().patchesRoot = emptyRoot.string();
    synth::ui::Action emptyLoadAction;
    emptyLoadSurface.SetActionHandler([&emptyLoadAction](const synth::ui::Action& action) {
        emptyLoadAction = action;
    });
    emptyLoadSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
    emptyLoadSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
    Require(emptyLoadAction.name.empty(), "missing load selection does not dispatch");
    Require(emptyLoadSurface.Snapshot().browserOpen, "missing load selection keeps browser open");
    std::filesystem::remove_all(emptyRoot);

    synth::runtime_ui::FilePageSurface firstSaveSurface;
    const std::filesystem::path firstSaveRoot =
        std::filesystem::temp_directory_path() / "sheaf_portable_file_page_first_save_test";
    std::filesystem::remove_all(firstSaveRoot);
    std::filesystem::create_directories(firstSaveRoot);
    firstSaveSurface.Snapshot().patchesRoot = firstSaveRoot.string();
    synth::ui::Action firstSaveAction;
    firstSaveSurface.SetActionHandler([&firstSaveAction](const synth::ui::Action& action) {
        firstSaveAction = action;
    });
    firstSaveSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSave));
    Require(firstSaveAction.name.empty(), "first save opens browser without dispatch");
    Require(firstSaveSurface.Snapshot().browserOpen, "first save opens save-as browser");
    Require(firstSaveSurface.Snapshot().browserKind == synth::runtime_ui::FileBrowserKind::SaveAs,
            "first save uses save-as browser kind");
    Require(FindNodeById(firstSaveSurface.BuildTree(), synth::runtime_ui::NodeIds::kFileBrowserSaveName) != nullptr,
            "first save exposes save name field");
    std::filesystem::remove_all(firstSaveRoot);

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
