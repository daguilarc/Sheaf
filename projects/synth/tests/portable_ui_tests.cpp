#include "synth/AppConcepts.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/ControllersPageUI.hpp"
#include "synth/ConstantBarVisualizer.hpp"
#include "synth/DspScope.hpp"
#include "synth/GangedRandomLfoVisualizer.hpp"
#include "synth/MidiController.hpp"
#include "synth/NoiseWaveformVisualizer.hpp"
#include "synth/StandardModulators.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>

#include "../apps/braid-4/Braid4Draw.hpp"
#include "../apps/braid-4/Braid4UI.hpp"
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

struct TestVisualizer final : synth::ui::Visualizer
{
    std::vector<synth::ui::DrawCommand> DrawVisible() const override
    {
        return {synth::ui::DrawCommand::Fill(GetBounds(), synth::Color::Cyan)};
    }
};

struct TestScopeLayerState
{
    std::atomic<bool> connected{false};
    std::atomic<const synth::ScopeWriter*> scope{nullptr};
    std::atomic<std::size_t> scopeChannel{0};
    synth::AtomicColor scopeColor;
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

void TestGangedRandomLfoVisualizer()
{
    using synth::GangedRandomLfoSnapshot;
    using synth::ui::Bounds;
    using synth::ui::DrawCommand;

    GangedRandomLfoSnapshot<2> snapshot;
    snapshot.sampleRate = 8.0;
    snapshot.roundElapsedSamples = 3.0;
    snapshot.voices[0] = {
        .source = 0.0f,
        .target = 1.0f,
        .output = 0.91f,
        .shape = 0.0f,
        .waitingIncrement = 0.25,
        .movingIncrement = 0.5,
        .color = synth::Color::Cyan,
    };
    snapshot.voices[1] = {
        .source = 1.0f,
        .target = 0.25f,
        .output = 0.02f,
        .shape = 1.0f,
        .waitingIncrement = 0.125,
        .movingIncrement = 0.25,
        .color = synth::Color::Orange,
    };

    const Bounds bounds{10.0f, 20.0f, 180.0f, 90.0f};
    std::vector<DrawCommand> commands;
    synth::ui::BuildGangedRandomLfoCommands(snapshot, bounds, commands);
    Require(commands.size() > 6, "ganged visualizer emits both paths");
    Require(commands.size() <= synth::ui::GangedRandomLfoGeometry::MaximumCommandCount<2>(),
            "ganged visualizer command count is fixed and bounded");
    Require(commands[0].kind == DrawCommand::Kind::Fill && commands[1].kind == DrawCommand::Kind::Line,
            "ganged visualizer starts with background and axis");

    const float expectedPresentX = bounds.x + 4.0f + (bounds.width - 8.0f) * 3.0f / 12.0f;
    std::array<std::size_t, 2> dots{};
    bool sawCyanPast = false;
    bool sawOrangePast = false;
    bool sawDashedGap = false;
    synth::ui::Point cyanPastEnd{};
    synth::ui::Point cyanDotCenter{};
    float previousFutureStart = -1.0f;
    for (const DrawCommand& command : commands)
    {
        if (command.kind == DrawCommand::Kind::Polyline)
        {
            Require(command.points.size() >= 2, "ganged path polylines have drawable geometry");
            for (const auto point : command.points)
            {
                Require(PointInside(point, bounds), "ganged path points are caller-clipped");
            }
            if (command.points.back().x <= expectedPresentX + 0.001f)
            {
                sawCyanPast = sawCyanPast || command.color == synth::Color::Cyan;
                sawOrangePast = sawOrangePast || command.color == synth::Color::Orange;
                if (command.color == synth::Color::Cyan)
                {
                    cyanPastEnd = command.points.back();
                }
            }
            if (command.points.front().x >= expectedPresentX - 0.001f)
            {
                if (previousFutureStart >= 0.0f && command.points.front().x > previousFutureStart + 0.5f)
                {
                    sawDashedGap = true;
                }
                previousFutureStart = command.points.back().x;
            }
        }
        else if (command.kind == DrawCommand::Kind::FillEllipse)
        {
            Require(BoundsInside(command.bounds, bounds), "ganged dot is caller-clipped");
            const float centerX = command.bounds.x + command.bounds.width * 0.5f;
            RequireNear(centerX, expectedPresentX, 0.001f, "all ganged dots share present x");
            if (command.color == synth::Color::Cyan)
            {
                ++dots[0];
                const float centerY = command.bounds.y + command.bounds.height * 0.5f;
                cyanDotCenter = {centerX, centerY};
                RequireNear(centerY, bounds.y + 4.0f + (bounds.height - 8.0f), 0.001f,
                            "dot reconstructs source hold instead of snapshot output");
            }
            if (command.color == synth::Color::Orange)
            {
                ++dots[1];
            }
        }
    }
    Require(dots == std::array<std::size_t, 2>{1, 1}, "one independently colored dot per voice");
    Require(sawCyanPast && sawOrangePast, "solid past uses each voice color");
    RequireNear(cyanPastEnd.x, cyanDotCenter.x, 0.001f, "solid past ends at the present dot x");
    RequireNear(cyanPastEnd.y, cyanDotCenter.y, 0.001f, "solid past ends at the reconstructed dot y");
    Require(sawDashedGap, "future path uses alternating bounded segments");

    // Voice zero lasts ceil(4) + ceil(2) = 6 samples, so its path must hold
    // target to voice one's shared ceil(8) + ceil(4) = 12-sample endpoint.
    bool cyanEndsAtTarget = false;
    const float targetY = bounds.y + 4.0f;
    for (const DrawCommand& command : commands)
    {
        if (command.kind == DrawCommand::Kind::Polyline && command.color == synth::Color::Cyan &&
            !command.points.empty() && command.points.back().x > bounds.x + bounds.width - 8.0f)
        {
            cyanEndsAtTarget = std::fabs(command.points.back().y - targetY) < 0.01f;
        }
    }
    Require(cyanEndsAtTarget, "early voice holds target through shared maximum duration");

    auto movingSnapshot = snapshot;
    movingSnapshot.roundElapsedSamples = 5.0;
    movingSnapshot.voices[0].movingIncrement = 0.25;
    movingSnapshot.voices[0].shape = 1.0f;
    std::vector<DrawCommand> movingCommands;
    synth::ui::BuildGangedRandomLfoCommands(movingSnapshot, bounds, movingCommands);
    const auto movingDot = std::find_if(movingCommands.begin(), movingCommands.end(), [](const auto& command) {
        return command.kind == DrawCommand::Kind::FillEllipse && command.color == synth::Color::Cyan;
    });
    Require(movingDot != movingCommands.end(), "moving interval has a present dot");
    const float shapedQuarter = synth::ShapedInterpolate(0.0f, 1.0f, 1.0f, 0.25);
    RequireNear(movingDot->bounds.y + movingDot->bounds.height * 0.5f,
                bounds.y + 4.0f + (bounds.height - 8.0f) * (1.0f - shapedQuarter),
                0.01f,
                "moving path and dot use shared shaped interpolation");

    auto boundarySnapshot = snapshot;
    boundarySnapshot.roundElapsedSamples = 4.0;
    boundarySnapshot.voices[0].waitingIncrement = 0.3;
    boundarySnapshot.voices[0].movingIncrement = 0.6;
    std::vector<DrawCommand> boundaryCommands;
    synth::ui::BuildGangedRandomLfoCommands(boundarySnapshot, bounds, boundaryCommands);
    const auto boundaryDot = std::find_if(boundaryCommands.begin(), boundaryCommands.end(), [](const auto& command) {
        return command.kind == DrawCommand::Kind::FillEllipse && command.color == synth::Color::Cyan;
    });
    Require(boundaryDot != boundaryCommands.end(), "discarded-remainder boundary has a dot");
    RequireNear(boundaryDot->bounds.y + boundaryDot->bounds.height * 0.5f,
                bounds.y + 4.0f + (bounds.height - 8.0f),
                0.01f,
                "waiting boundary remains aligned after discarded remainder");
    boundarySnapshot.roundElapsedSamples = 5.0;
    boundaryCommands.clear();
    synth::ui::BuildGangedRandomLfoCommands(boundarySnapshot, bounds, boundaryCommands);
    const auto postBoundaryDot = std::find_if(
        boundaryCommands.begin(), boundaryCommands.end(), [](const auto& command) {
            return command.kind == DrawCommand::Kind::FillEllipse && command.color == synth::Color::Cyan;
        });
    Require(postBoundaryDot != boundaryCommands.end(), "post-boundary movement has a dot");
    RequireNear(postBoundaryDot->bounds.y + postBoundaryDot->bounds.height * 0.5f,
                bounds.y + 4.0f + (bounds.height - 8.0f) * 0.4f,
                0.01f,
                "discarded wait remainder does not shift moving interpolation");

    const Bounds resized{1.0f, 2.0f, 37.0f, 23.0f};
    std::vector<DrawCommand> resizedCommands;
    auto veryLong = snapshot;
    veryLong.voices[1].waitingIncrement = 1.0 / 1000000000.0;
    synth::ui::BuildGangedRandomLfoCommands(veryLong, resized, resizedCommands);
    Require(resizedCommands.size() <= synth::ui::GangedRandomLfoGeometry::MaximumCommandCount<2>(),
            "geometry ceiling is independent of round duration");
    for (const DrawCommand& command : resizedCommands)
    {
        if (command.kind == DrawCommand::Kind::Polyline)
        {
            Require(command.points.size() <= synth::ui::GangedRandomLfoGeometry::kPathSegments + 1,
                    "ganged polyline point ceiling is fixed");
            for (const auto point : command.points)
            {
                Require(PointInside(point, resized), "resized ganged geometry remains clipped");
            }
        }
    }

    const Bounds tiny{2.0f, 3.0f, 7.0f, 7.0f};
    std::vector<DrawCommand> tinyCommands;
    synth::ui::BuildGangedRandomLfoCommands(snapshot, tiny, tinyCommands);
    Require(std::none_of(tinyCommands.begin(), tinyCommands.end(), [](const DrawCommand& command) {
                return command.kind == DrawCommand::Kind::FillEllipse;
            }),
            "sub-eight-pixel bounds do not emit zero-area present dots");

    auto invalid = snapshot;
    invalid.voices[0].movingIncrement = 0.0;
    std::vector<DrawCommand> invalidCommands;
    synth::ui::BuildGangedRandomLfoCommands(invalid, bounds, invalidCommands);
    Require(invalidCommands.size() == 2, "invalid increment fails closed to background and axis");
    invalid = snapshot;
    invalid.voices[0].source = std::numeric_limits<float>::quiet_NaN();
    invalidCommands.clear();
    synth::ui::BuildGangedRandomLfoCommands(invalid, bounds, invalidCommands);
    Require(invalidCommands.size() == 2, "nonfinite value fails closed to background and axis");
    invalid = snapshot;
    invalid.sampleRate = 0.0;
    invalidCommands.clear();
    synth::ui::BuildGangedRandomLfoCommands(invalid, bounds, invalidCommands);
    Require(invalidCommands.size() == 2, "nonpositive sample rate fails closed to background and axis");
    invalid = snapshot;
    invalid.voices[0].waitingIncrement = std::numeric_limits<double>::denorm_min();
    invalidCommands.clear();
    synth::ui::BuildGangedRandomLfoCommands(invalid, bounds, invalidCommands);
    Require(invalidCommands.size() == 2, "nonfinite derived duration fails closed to background and axis");

    synth::GangedRandomLfoUiState<2> retainedState;
    retainedState.revision.store(1, std::memory_order_release);
    synth::ui::GangedRandomLfoVisualizer<2> visualizer(retainedState);
    visualizer.SetBounds(bounds);
    Require(visualizer.Draw().size() == 2, "unstable retained state fails closed");
}

void TestStandardModulatorVisualizersRemainPortable()
{
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({
        .numVoices = 2,
        .numModulators = 15,
        .numScenes = 1,
        .maxParameters = 16,
    });
    synth::StandardModulators<2> standard(group);
    standard.Register();
    standard.Prepare(48000.0);
    standard.Process();
    standard.PublishUiState();
    const synth::ui::Bounds bounds{0.0f, 0.0f, 96.0f, 96.0f};
    for (std::size_t random = 0; random < 4; ++random)
    {
        auto& visualizer = standard.RandomVisualizer(random);
        visualizer.SetBounds(bounds);
        Require(!visualizer.Draw().empty(), "standard random depth underlay is portable");
        Require(group.GetModulators().Metadata(random).visualizer == &visualizer,
                "standard random metadata retains portable underlay");
    }
    standard.ConstantVisualizer().SetBounds(bounds);
    standard.NoiseVisualizer().SetBounds(bounds);
    Require(!standard.ConstantVisualizer().Draw().empty(), "standard constant depth underlay is portable");
    Require(!standard.NoiseVisualizer().Draw().empty(), "standard noise depth underlay is portable");
    Require(group.GetModulators().Metadata(11).visualizer == &standard.ConstantVisualizer(),
            "standard constant metadata retains portable underlay");
    Require(group.GetModulators().Metadata(14).visualizer == &standard.NoiseVisualizer(),
            "standard noise metadata retains portable underlay");
}

void TestBraid4StandardModulationViewsRemainPortable()
{
    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::MidiInstrumentConfig instrument;
    synth::RuntimeConfig config = synth_braid4::Braid4Core::Config();
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    context.instrument = &instrument;
    context.config = &config;

    synth_braid4::Braid4Core core;
    core.Init(&context);
    core.PrepareToPlay(48000.0, 64);
    auto uiState = manager.CreateUIState();
    context.uiState = uiState.get();
    synth_braid4::Braid4UiSurface surface;
    surface.Attach(&context, &core);

    core.BankSlot()->HandlePress(4);
    manager.PopulateUIState(*uiState);
    const synth::ui::NodeTree quadTree = surface.BuildTree();
    Require(FindNodeById(quadTree, "braid4.encoder.0.visualizer") != nullptr,
            "Braid4 quad standard source has a portable underlay");
    Require(FindNodeById(quadTree, "braid4.encoder.4") != nullptr,
            "Braid4 quad application source 4 keeps its encoder");
    Require(FindNodeById(quadTree, "braid4.encoder.4.visualizer") == nullptr,
            "Braid4 quad application source 4 remains encoder-only");
    Require(FindNodeById(quadTree, "braid4.encoder.5.visualizer") == nullptr,
            "Braid4 quad application source 5 remains encoder-only");

    core.BankSlot()->SelectBank(core.MatrixBank());
    core.BankSlot()->HandlePress(0);
    manager.PopulateUIState(*uiState);
    const synth::ui::NodeTree monoTree = surface.BuildTree();
    Require(FindNodeById(monoTree, "braid4.encoder.0.visualizer") != nullptr,
            "Braid4 mono standard random source has a portable underlay");
    Require(FindNodeById(monoTree, "braid4.encoder.11") == nullptr,
            "Braid4 mono disconnected constant position has no encoder cell");
    Require(FindNodeById(monoTree, "braid4.encoder.11.visualizer") == nullptr,
            "Braid4 mono disconnected constant position has no visualizer");
    Require(!core.MonoGroup()->GetModulators().Metadata(11).connected,
            "Braid4 mono constant source stays disconnected");
    Require(core.MonoGroup()->GetModulators().Metadata(11).visualizer == nullptr,
            "Braid4 mono constant source has no alias visualizer");
}

}  // namespace

int main()
{
    TestGangedRandomLfoVisualizer();
    TestStandardModulatorVisualizersRemainPortable();
    TestBraid4StandardModulationViewsRemainPortable();
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

    Require(synth::ui::EncoderGeometry::BadgeText(false, 16) == "17", "gesture 16 badge is one-based");
    Require(synth::ui::EncoderGeometry::BadgeText(false, 62) == "63", "gesture 62 badge is one-based");
    Require(synth::ui::EncoderGeometry::BadgeText(false, 63) == "64", "gesture 63 badge is one-based");
    synth::Parameter::UIState highGestureState(1, 0, 64);
    highGestureState.connected.store(true);
    highGestureState.voiceCount.store(1);
    highGestureState.gesturesAffectingMask.store(std::uint64_t{1} << 63);
    highGestureState.gestureColorCount.store(64);
    for (std::size_t gestureIx = 0; gestureIx < 64; ++gestureIx) {
        highGestureState.gestureColors[gestureIx].Store(synth::Color::Orange);
    }
    const synth::ui::EncoderDrawState highGestureEncoder =
        synth::ui::EncoderDrawStateFromParameter(highGestureState);
    Require(highGestureEncoder.gesturesAffectingMask == (std::uint64_t{1} << 63),
            "encoder snapshot preserves gesture bit 63");
    const auto highGestureCommands = synth::ui::BuildEncoderDrawCommands(
        highGestureEncoder, {0.0f, 0.0f, 128.0f, 128.0f});
    Require(std::any_of(highGestureCommands.begin(), highGestureCommands.end(), [](const auto& command) {
                return command.kind == synth::ui::DrawCommand::Kind::Text && command.text == "64";
            }),
            "encoder renders gesture 63 as badge 64");

    static_assert(synth::SynthApplication<TestApp>);
    static_assert(!synth::ui::kPortableUiUsesJuce);
    static_assert(std::is_same_v<decltype(synth::ui::WaveformLayerDrawState::scope), const synth::ScopeWriter*>);
    static_assert(!std::is_copy_constructible_v<synth::ui::Visualizer>);
    static_assert(!std::is_copy_assignable_v<synth::ui::Visualizer>);
    static_assert(!std::is_move_constructible_v<synth::ui::Visualizer>);
    static_assert(!std::is_move_assignable_v<synth::ui::Visualizer>);
    TestVisualizer visualizer;
    Require(visualizer.Visible(), "visualizer is visible by default");
    visualizer.SetBounds({11.0f, 12.0f, 44.0f, 45.0f});
    RequireNear(visualizer.GetBounds().x, 11.0f, 0.0001f, "visualizer stores bounds x");
    RequireNear(visualizer.GetBounds().height, 45.0f, 0.0001f, "visualizer stores bounds height");
    Require(visualizer.Draw().size() == 1, "visible visualizer emits commands");
    visualizer.SetVisible(false);
    Require(visualizer.Draw().empty(), "hidden visualizer emits no commands");
    visualizer.SetVisible(true);
    synth::ui::Builder visualizerBuilder;
    visualizerBuilder.Root("viz.root", {0.0f, 0.0f, 100.0f, 100.0f})
        .Visualizer("viz.node", &visualizer);
    const synth::ui::NodeTree visualizerTree = visualizerBuilder.Build();
    const synth::ui::Node* visualizerNode = FindNodeById(visualizerTree, "viz.node");
    Require(visualizerNode != nullptr, "visible visualizer node exists");
    Require(visualizerNode->kind == synth::ui::NodeKind::Draw, "visualizer node is a draw node");
    RequireNear(visualizerNode->bounds.width, 44.0f, 0.0001f, "visualizer node uses stored bounds");
    Require(visualizerNode->drawCommands.size() == 1, "visualizer node uses draw commands");
    visualizer.SetVisible(false);
    synth::ui::Builder hiddenBuilder;
    hiddenBuilder.Root("viz.hidden.root", {0.0f, 0.0f, 100.0f, 100.0f})
        .Visualizer("viz.hidden.node", &visualizer);
    Require(FindNodeById(hiddenBuilder.Build(), "viz.hidden.node") == nullptr, "hidden visualizer node absent");

    {
        const std::array<float, 4> values{0.0f, 2.0f / 3.0f, 1.0f / 3.0f, 1.0f};
        synth::ui::ConstantBarVisualizer visualizer(values, synth::Color::Yellow);
        const synth::ui::Bounds bounds{10.0f, 20.0f, 80.0f, 120.0f};
        visualizer.SetBounds(bounds);
        const auto commands = visualizer.Draw();
        Require(!visualizer.WantsEncoderFrame(),
                "constant visualizer suppresses the shared encoder frame");
        Require(commands.size() == values.size(), "constant visualizer emits one command per voice");
        const float slotWidth = bounds.width / static_cast<float>(values.size());
        const float gap = std::min(2.0f, slotWidth * 0.2f);
        const float expectedBarWidth = (slotWidth - gap) * 0.5f;
        for (std::size_t voice = 0; voice < values.size(); ++voice) {
            Require(commands[voice].kind == synth::ui::DrawCommand::Kind::Fill,
                    "constant visualizer emits only filled rectangles");
            Require(commands[voice].color == synth::Color::Yellow,
                    "constant visualizer retains source color");
            Require(commands[voice].bounds.width > 0.0f,
                    "constant visualizer keeps positive bar width");
            RequireNear(commands[voice].bounds.width, expectedBarWidth, 0.0001f,
                        "constant visualizer halves the post-gap bar width");
            RequireNear(commands[voice].bounds.x + commands[voice].bounds.width * 0.5f,
                        bounds.x + (static_cast<float>(voice) + 0.5f) * slotWidth,
                        0.0001f,
                        "constant visualizer centers each narrow bar in its voice slot");
            Require(commands[voice].bounds.x >= bounds.x &&
                    commands[voice].bounds.x + commands[voice].bounds.width <= bounds.x + bounds.width,
                    "constant visualizer bar stays horizontally bounded");
            RequireNear(commands[voice].bounds.y + commands[voice].bounds.height,
                        bounds.y + bounds.height, 0.0001f,
                        "constant visualizer bars share the bottom edge");
        }
        RequireNear(commands[0].bounds.height, bounds.height / 12.0f, 0.0001f,
                    "zero voice remains visible");
        RequireNear(commands[3].bounds.y, bounds.y + bounds.height / 12.0f, 0.0001f,
                    "one voice keeps a top margin");
        Require(commands[1].bounds.height > commands[2].bounds.height,
                "bar heights retain voice-order values without sorting");
        const auto repeated = visualizer.Draw();
        for (std::size_t voice = 0; voice < values.size(); ++voice) {
            RequireNear(repeated[voice].bounds.y, commands[voice].bounds.y, 0.0001f,
                        "immutable repeated draw keeps bar geometry");
        }
    }

    {
        const std::array<float, 2> values{0.0f, 1.0f};
        synth::ui::ConstantBarVisualizer narrow(values, synth::Color::Cyan);
        narrow.SetBounds({1.0f, 2.0f, 0.5f, 3.0f});
        const auto commands = narrow.Draw();
        Require(commands.size() == 2, "narrow constant visualizer retains both bars");
        Require(commands[0].bounds.width > 0.0f && commands[1].bounds.width > 0.0f,
                "slot-relative gaps preserve positive width");

        const std::span<const float> empty;
        synth::ui::ConstantBarVisualizer emptyVisualizer(empty, synth::Color::White);
        emptyVisualizer.SetBounds({0.0f, 0.0f, 10.0f, 10.0f});
        Require(emptyVisualizer.Draw().empty(), "empty constant values draw nothing");
        for (const synth::ui::Bounds invalid : {
                 synth::ui::Bounds{0.0f, 0.0f, 0.0f, 1.0f},
                 synth::ui::Bounds{0.0f, 0.0f, 1.0f, 0.0f},
                 synth::ui::Bounds{0.0f, 0.0f, -1.0f, 1.0f},
                 synth::ui::Bounds{0.0f, 0.0f, std::numeric_limits<float>::infinity(), 1.0f},
                 synth::ui::Bounds{std::numeric_limits<float>::quiet_NaN(), 0.0f, 1.0f, 1.0f}}) {
            narrow.SetBounds(invalid);
            Require(narrow.Draw().empty(), "invalid constant visualizer bounds are safe");
        }
    }

    {
        static_assert(!std::is_copy_constructible_v<synth::ui::ConstantBarVisualizer>);
        static_assert(!std::is_copy_assignable_v<synth::ui::ConstantBarVisualizer>);
        static_assert(!std::is_move_constructible_v<synth::ui::ConstantBarVisualizer>);
        static_assert(!std::is_move_assignable_v<synth::ui::ConstantBarVisualizer>);

        const std::array<float, 2> stackValues{0.0f, 1.0f};
        synth::ui::ConstantBarVisualizer stackingVisualizer(stackValues, synth::Color::Yellow);
        const synth::ui::Bounds stackBounds{20.0f, 20.0f, 64.0f, 64.0f};
        stackingVisualizer.SetBounds(stackBounds);
        synth::ui::Visualizer* const stableAddress = &stackingVisualizer;
        synth::ui::Builder builder;
        builder.Root("constant.stack.root", {0.0f, 0.0f, 100.0f, 100.0f})
            .Visualizer("constant.stack.visualizer", &stackingVisualizer)
            .DrawInteractive("constant.stack.encoder", stackBounds,
                             {synth::ui::DrawCommand::StrokeEllipse(
                                 stackBounds, synth::Color::White, 1.0f)},
                             synth::ui::Action::Named("drag"));
        const synth::ui::NodeTree tree = builder.Build();
        const synth::ui::Node* root = FindNodeById(tree, "constant.stack.root");
        const synth::ui::Node* node = FindNodeById(tree, "constant.stack.visualizer");
        Require(stableAddress == static_cast<synth::ui::Visualizer*>(&stackingVisualizer),
                "constant visualizer remains address-stable");
        Require(node != nullptr && node->drawCommands.size() == stackValues.size(),
                "constant builder carries one bar per voice");
        RequireNear(node->bounds.width, stackBounds.width, 0.0001f,
                    "constant builder preserves bounds");
        Require(root != nullptr && root->children.size() == 2,
                "constant visualizer and encoder are both appended");
        Require(root->children[0] == synth::ui::NodeId("constant.stack.visualizer"),
                "constant visualizer precedes encoder");
        Require(root->children[1] == synth::ui::NodeId("constant.stack.encoder"),
                "constant encoder follows visualizer");
        stackingVisualizer.SetVisible(false);
        synth::ui::Builder hiddenBuilder;
        hiddenBuilder.Root("constant.hidden.root", {0.0f, 0.0f, 100.0f, 100.0f})
            .Visualizer("constant.hidden.visualizer", &stackingVisualizer);
        Require(FindNodeById(hiddenBuilder.Build(), "constant.hidden.visualizer") == nullptr,
                "hidden constant visualizer emits no builder node");
    }

    {
        synth::ui::NoiseWaveformVisualizer left(synth::Color::Yellow, 1234);
        synth::ui::NoiseWaveformVisualizer right(synth::Color::Yellow, 1234);
        const synth::ui::Bounds bounds{10.0f, 20.0f, 64.0f, 30.0f};
        left.SetBounds(bounds);
        right.SetBounds(bounds);
        const auto leftCommands = left.Draw();
        const auto rightCommands = right.Draw();
        Require(leftCommands.size() == 1, "noise visualizer emits one polyline");
        Require(rightCommands.size() == 1, "same seed emits one noise polyline");
        Require(leftCommands[0].kind == synth::ui::DrawCommand::Kind::Polyline,
                "noise visualizer command is a polyline");
        Require(leftCommands[0].color == synth::Color::Yellow,
                "noise visualizer retains its color");
        Require(leftCommands[0].points.size() == 65,
                "noise visualizer covers integer columns including both edges");
        Require(leftCommands[0].points.size() == rightCommands[0].points.size(),
                "same seed produces same point count");
        for (std::size_t point = 0; point < leftCommands[0].points.size(); ++point)
        {
            RequireNear(leftCommands[0].points[point].x,
                        bounds.x + static_cast<float>(point), 0.0001f,
                        "noise visualizer x matches integer column");
            RequireNear(leftCommands[0].points[point].x, rightCommands[0].points[point].x,
                        0.0001f, "same seed reproduces x");
            RequireNear(leftCommands[0].points[point].y, rightCommands[0].points[point].y,
                        0.0001f, "same seed reproduces y");
            Require(leftCommands[0].points[point].y > bounds.y,
                    "noise visualizer y is above the open lower edge");
            Require(leftCommands[0].points[point].y < bounds.y + bounds.height,
                    "noise visualizer y is below the open upper edge");
        }
    }

    {
        synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::White, 99);
        visualizer.SetBounds({0.0f, 0.0f, 16.0f, 10.0f});
        const auto first = visualizer.Draw();
        const auto second = visualizer.Draw();
        Require(first.size() == 1 && second.size() == 1,
                "consecutive visible noise draws emit one polyline each");
        bool differs = false;
        for (std::size_t point = 0; point < first[0].points.size(); ++point)
        {
            differs = differs || first[0].points[point].y != second[0].points[point].y;
        }
        Require(differs, "noise visualizer regenerates geometry on every visible draw");
    }

    {
        synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::White, 7);
        visualizer.SetBounds({3.0f, 4.0f, 8.0f, 9.0f});
        Require(visualizer.Visible(), "noise visualizer is intrinsically visible");
        Require(!visualizer.Draw().empty(), "visible noise visualizer draws");
        visualizer.SetVisible(false);
        Require(visualizer.Draw().empty(), "hidden noise visualizer does not draw");
        visualizer.SetVisible(true);
        for (const synth::ui::Bounds invalid : {
                 synth::ui::Bounds{0.0f, 0.0f, 0.0f, 1.0f},
                 synth::ui::Bounds{0.0f, 0.0f, 1.0f, 0.0f},
                 synth::ui::Bounds{0.0f, 0.0f, -1.0f, 1.0f},
                 synth::ui::Bounds{0.0f, 0.0f, std::numeric_limits<float>::infinity(), 1.0f},
                 synth::ui::Bounds{0.0f, 0.0f, 1.0f, std::numeric_limits<float>::infinity()},
                 synth::ui::Bounds{std::numeric_limits<float>::quiet_NaN(), 0.0f, 1.0f, 1.0f},
                 synth::ui::Bounds{0.0f, std::numeric_limits<float>::quiet_NaN(), 1.0f, 1.0f}})
        {
            visualizer.SetBounds(invalid);
            Require(visualizer.Draw().empty(), "invalid noise visualizer bounds are safe");
        }
    }

    {
        synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::Cyan, 123);
        const synth::ui::Bounds bounds{5.5f, 8.0f, 2.25f, 12.0f};
        visualizer.SetBounds(bounds);
        const auto commands = visualizer.Draw();
        Require(commands.size() == 1, "fractional-width noise visualizer emits one polyline");
        Require(commands[0].points.size() == 4,
                "fractional-width noise visualizer covers columns and right edge");
        const std::array<float, 4> expectedX{bounds.x, bounds.x + 1.0f,
                                             bounds.x + 2.0f, bounds.x + bounds.width};
        for (std::size_t point = 0; point < expectedX.size(); ++point)
        {
            RequireNear(commands[0].points[point].x, expectedX[point], 0.0001f,
                        "fractional-width noise visualizer x matches expected coverage");
            Require(PointInside(commands[0].points[point], bounds),
                    "fractional-width noise visualizer point stays in bounds");
            if (point > 0)
            {
                Require(commands[0].points[point - 1].x < commands[0].points[point].x,
                        "fractional-width noise visualizer x coordinates are distinct");
            }
        }
    }

    {
        static_assert(!std::is_copy_constructible_v<synth::ui::NoiseWaveformVisualizer>);
        static_assert(!std::is_copy_assignable_v<synth::ui::NoiseWaveformVisualizer>);
        static_assert(!std::is_move_constructible_v<synth::ui::NoiseWaveformVisualizer>);
        static_assert(!std::is_move_assignable_v<synth::ui::NoiseWaveformVisualizer>);

        synth::ui::NoiseWaveformVisualizer visualizer(synth::Color::Orange, 456);
        const synth::ui::Bounds bounds{14.0f, 15.0f, 24.0f, 25.0f};
        visualizer.SetBounds(bounds);
        synth::ui::Visualizer* const stableAddress = &visualizer;
        synth::ui::Builder builder;
        builder.Root("noise.stack.root", {0.0f, 0.0f, 100.0f, 100.0f})
            .Visualizer("noise.stack.visualizer", &visualizer)
            .DrawInteractive("noise.stack.encoder", bounds,
                             {synth::ui::DrawCommand::StrokeEllipse(bounds, synth::Color::White, 1.0f)},
                             synth::ui::Action::Named("drag"));
        const synth::ui::NodeTree tree = builder.Build();
        Require(stableAddress == static_cast<synth::ui::Visualizer*>(&visualizer),
                "noise visualizer remains address-stable through builder composition");
        const synth::ui::Node* root = FindNodeById(tree, "noise.stack.root");
        const synth::ui::Node* node = FindNodeById(tree, "noise.stack.visualizer");
        Require(node != nullptr, "noise visualizer builder emits a draw node");
        RequireNear(node->bounds.x, bounds.x, 0.0001f, "noise builder preserves bounds x");
        RequireNear(node->bounds.y, bounds.y, 0.0001f, "noise builder preserves bounds y");
        RequireNear(node->bounds.width, bounds.width, 0.0001f, "noise builder preserves bounds width");
        RequireNear(node->bounds.height, bounds.height, 0.0001f, "noise builder preserves bounds height");
        Require(root != nullptr && root->children.size() == 2,
                "noise visualizer and encoder are both appended");
        Require(root->children[0] == synth::ui::NodeId("noise.stack.visualizer"),
                "noise visualizer draw node precedes encoder node");
        Require(root->children[1] == synth::ui::NodeId("noise.stack.encoder"),
                "noise encoder node follows visualizer draw node");

        visualizer.SetVisible(false);
        synth::ui::Builder hiddenBuilder;
        hiddenBuilder.Root("noise.hidden.root", {0.0f, 0.0f, 100.0f, 100.0f})
            .Visualizer("noise.hidden.visualizer", &visualizer);
        Require(FindNodeById(hiddenBuilder.Build(), "noise.hidden.visualizer") == nullptr,
                "hidden noise visualizer emits no builder node");
    }

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

    synth::ScopeWriter inFlightScope(1, 128);
    auto inFlightHolder = inFlightScope.ReserveChans(1);
    inFlightHolder.RecordStart();
    for (std::size_t frame = 0; frame < 32; ++frame)
    {
        inFlightHolder.Write(std::sin(static_cast<float>(frame) * 0.2f));
        inFlightScope.AdvanceIndex();
    }
    inFlightHolder.RecordStart();
    for (std::size_t frame = 0; frame < 16; ++frame)
    {
        inFlightHolder.Write(std::sin(static_cast<float>(frame) * 0.2f));
        inFlightScope.AdvanceIndex();
    }
    inFlightScope.Publish();

    const std::vector<synth::ui::WaveformLayerDrawState> inFlightLayer{
        {.connected = true, .scopeColor = synth::Color::Red, .scope = &inFlightScope, .scopeChannel = 0},
    };
    const auto publishedCommands = synth::ui::BuildScopeWaveformCommands(
        inFlightLayer, {10.0f, 120.0f, 180.0f, 90.0f}, -1.1f, 1.1f, 64, true);
    const bool publishedHasPolyline = std::any_of(
        publishedCommands.begin(), publishedCommands.end(), [](const synth::ui::DrawCommand& command) {
            return command.kind == synth::ui::DrawCommand::Kind::Polyline;
        });
    inFlightHolder.RecordStart();
    inFlightHolder.Write(0.25f);
    inFlightScope.AdvanceIndex();
    const auto inFlightCommands = synth::ui::BuildScopeWaveformCommands(
        inFlightLayer, {10.0f, 120.0f, 180.0f, 90.0f}, -1.1f, 1.1f, 64, true);
    const bool inFlightHasPolyline = std::any_of(
        inFlightCommands.begin(), inFlightCommands.end(), [](const synth::ui::DrawCommand& command) {
            return command.kind == synth::ui::DrawCommand::Kind::Polyline;
        });
    Require(publishedHasPolyline, "published scope waveform is visible before the next marker");
    Require(inFlightHasPolyline, "scope waveform remains visible while a new marker is unpublished");

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

    synth::GangedRandomLfoSnapshot<2> miniGangState;
    miniGangState.sampleRate = 48000.0;
    miniGangState.roundElapsedSamples = 3.0;
    miniGangState.voices[0] = {
        .source = 0.0f,
        .target = 1.0f,
        .output = 0.5f,
        .shape = 0.0f,
        .waitingIncrement = 0.25,
        .movingIncrement = 0.5,
        .color = synth::Color::Cyan,
    };
    miniGangState.voices[1] = {
        .source = 1.0f,
        .target = 0.0f,
        .output = 0.5f,
        .shape = 1.0f,
        .waitingIncrement = 0.125,
        .movingIncrement = 0.25,
        .color = synth::Color::Orange,
    };
    const auto miniGang = synth_miniapp::BuildGangedRandomLfoPanelCommands(miniGangState, wrapperBounds);
    RequireWaveformGeometryInside(miniGang, wrapperBounds,
                                  "miniapp ganged random LFO panel remains bounded");
    for (const synth::Color color : {synth::Color::Cyan, synth::Color::Orange})
    {
        const bool sawPath = std::any_of(miniGang.begin(), miniGang.end(), [color](const auto& command) {
            return command.kind == synth::ui::DrawCommand::Kind::Polyline && command.color == color;
        });
        const bool sawDot = std::any_of(miniGang.begin(), miniGang.end(), [color](const auto& command) {
            return command.kind == synth::ui::DrawCommand::Kind::FillEllipse && command.color == color;
        });
        Require(sawPath, "miniapp ganged panel preserves each voice path color");
        Require(sawDot, "miniapp ganged panel preserves each voice dot color");
    }

    TestScopeLayerState layerA;
    TestScopeLayerState layerB;
    layerA.connected.store(true);
    layerA.scope.store(&scope);
    layerA.scopeChannel.store(0);
    layerA.scopeColor.Store(synth::Color::Red);
    layerB.connected.store(false);
    layerB.scope.store(&scope);
    layerB.scopeChannel.store(1);
    layerB.scopeColor.Store(synth::Color::Green);
    std::array<TestScopeLayerState*, 2> scopeLayers{&layerA, &layerB};
    synth::ui::ScopeVisualizer<TestScopeLayerState> scopeVisualizer(scopeLayers, -1.1f, 1.1f, 64, true);
    scopeVisualizer.SetBounds({50.0f, 60.0f, 140.0f, 90.0f});
    const auto scopeVisualizerCommands = scopeVisualizer.Draw();
    RequireWaveformGeometryInside(scopeVisualizerCommands, scopeVisualizer.GetBounds(),
                                  "scope visualizer geometry stays inside bounds");
    const bool sawRed = std::any_of(scopeVisualizerCommands.begin(), scopeVisualizerCommands.end(),
                                    [](const synth::ui::DrawCommand& command) {
                                        return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                               command.color == synth::Color::Red;
                                    });
    Require(sawRed, "scope visualizer reads connected layer color");
    const bool sawGreen = std::any_of(scopeVisualizerCommands.begin(), scopeVisualizerCommands.end(),
                                      [](const synth::ui::DrawCommand& command) {
                                          return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                                 command.color == synth::Color::Green;
                                      });
    Require(!sawGreen, "scope visualizer skips disconnected layer");
    layerA.scopeChannel.store(1);
    layerA.scopeColor.Store(synth::Color::Yellow);
    const auto updatedScopeCommands = scopeVisualizer.Draw();
    const bool sawYellow = std::any_of(updatedScopeCommands.begin(), updatedScopeCommands.end(),
                                       [](const synth::ui::DrawCommand& command) {
                                           return command.kind == synth::ui::DrawCommand::Kind::Polyline &&
                                                  command.color == synth::Color::Yellow;
                                       });
    Require(sawYellow, "scope visualizer reads updated atomic color without reconstruction");

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

    synth::ui::EncoderDrawState ordinaryEncoder;
    ordinaryEncoder.connected = true;
    ordinaryEncoder.baseColor = synth::Color::Cyan;
    ordinaryEncoder.voiceCount = 1;
    ordinaryEncoder.voices.push_back({.value = 0.5f, .indicatorColor = synth::Color::Orange});
    const auto ordinaryEncoderCommands = synth::ui::BuildEncoderDrawCommands(
        ordinaryEncoder,
        {10.0f, 10.0f, 92.0f, 92.0f});
    Require(ordinaryEncoderCommands.size() > 4, "ordinary connected encoder emits body and value commands");
    Require(ordinaryEncoderCommands[0].kind == synth::ui::DrawCommand::Kind::FillEllipse,
            "ordinary encoder first command is body fill");
    Require(ordinaryEncoderCommands[0].color.a == 255,
            "ordinary encoder body fill remains opaque");

    synth::ui::EncoderDrawState underlayEncoder = ordinaryEncoder;
    underlayEncoder.hasVisualizerUnderlay = true;
    const auto underlayEncoderCommands = synth::ui::BuildEncoderDrawCommands(
        underlayEncoder,
        {10.0f, 10.0f, 92.0f, 92.0f});
    Require(underlayEncoderCommands.size() == ordinaryEncoderCommands.size(),
            "underlay encoder preserves command count");
    Require(underlayEncoderCommands[0].kind == synth::ui::DrawCommand::Kind::FillEllipse,
            "underlay encoder first command is body fill");
    Require(underlayEncoderCommands[0].color.a > 0 && underlayEncoderCommands[0].color.a < 255,
            "underlay encoder body fill is translucent");
    Require(underlayEncoderCommands[1].color.a < ordinaryEncoderCommands[1].color.a,
            "underlay encoder inner color fill is also softened");
    Require(std::any_of(underlayEncoderCommands.begin(), underlayEncoderCommands.end(),
                        [](const synth::ui::DrawCommand& command) {
                            return command.kind == synth::ui::DrawCommand::Kind::StrokeRoundedRect;
                        }),
            "default visualizer underlay retains the rounded encoder frame");
    for (std::size_t commandIx = 2; commandIx < ordinaryEncoderCommands.size(); ++commandIx)
    {
        Require(underlayEncoderCommands[commandIx].kind == ordinaryEncoderCommands[commandIx].kind,
                "underlay encoder preserves non-body command kinds");
        Require(underlayEncoderCommands[commandIx].color == ordinaryEncoderCommands[commandIx].color,
                "underlay encoder preserves non-body command colors");
        RequireNear(underlayEncoderCommands[commandIx].strokeWidth,
                    ordinaryEncoderCommands[commandIx].strokeWidth,
                    0.0001f,
                    "underlay encoder preserves non-body stroke widths");
    }

    synth::ui::EncoderDrawState framelessUnderlayEncoder = underlayEncoder;
    framelessUnderlayEncoder.wantsFrame = false;
    const auto framelessUnderlayCommands = synth::ui::BuildEncoderDrawCommands(
        framelessUnderlayEncoder,
        {10.0f, 10.0f, 92.0f, 92.0f});
    Require(framelessUnderlayCommands.size() + 1 == underlayEncoderCommands.size(),
            "frameless visualizer removes exactly one encoder command");
    Require(std::none_of(framelessUnderlayCommands.begin(), framelessUnderlayCommands.end(),
                         [](const synth::ui::DrawCommand& command) {
                             return command.kind == synth::ui::DrawCommand::Kind::StrokeRoundedRect;
                         }),
            "frameless visualizer removes the rounded encoder frame");

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

    TestVisualizer stackingVisualizer;
    stackingVisualizer.SetBounds({20.0f, 20.0f, 64.0f, 64.0f});
    synth::ui::Builder stackingBuilder;
    stackingBuilder.Root("stack.root", {0.0f, 0.0f, 120.0f, 120.0f})
        .Visualizer("stack.encoder.0.visualizer", &stackingVisualizer)
        .DrawInteractive("stack.encoder.0",
                         stackingVisualizer.GetBounds(),
                         {synth::ui::DrawCommand::StrokeEllipse(stackingVisualizer.GetBounds(), synth::Color::White, 1.0f)},
                         synth::ui::Action::Named("drag"),
                         synth::ui::Action::Named("push"));
    const synth::ui::NodeTree stackingTree = stackingBuilder.Build();
    const synth::ui::Node* stackingRoot = FindNodeById(stackingTree, "stack.root");
    Require(stackingRoot != nullptr, "stacking root exists");
    Require(stackingRoot->children.size() == 2, "visualizer and encoder both appended");
    Require(stackingRoot->children[0] == synth::ui::NodeId("stack.encoder.0.visualizer"),
            "visualizer precedes encoder");
    Require(stackingRoot->children[1] == synth::ui::NodeId("stack.encoder.0"),
            "encoder follows visualizer");
    const synth::ui::Node* stackingEncoder = FindNodeById(stackingTree, "stack.encoder.0");
    Require(stackingEncoder != nullptr && stackingEncoder->pointerDragAction.has_value(),
            "encoder retains drag action");
    Require(stackingEncoder != nullptr && stackingEncoder->doubleClickAction.has_value(),
            "encoder retains double-click action");

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
