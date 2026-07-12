#include "MiniApp.hpp"
#include "MiniAppCore.hpp"
#include "MiniAppRegistration.hpp"
#include "MiniAppUI.hpp"
#include "MiniAppUiModel.hpp"
#include "support/SynthRig.hpp"

#include "synth/AppConcepts.hpp"
#include "synth/PatchBrowser.hpp"
#include "synth/PortableUI.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth miniapp system tests must not see JUCE headers -- MiniAppCore must stay JUCE-free"
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <sstream>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

// Volume is the fourth parameter WavetableVcoModule<2>::RegisterParameters
// registers (Tune, Phase, Shape, Volume, in that order -- see
// synth/Modules.hpp), and RegisterToBank(vcoBank, /*offset=*/0) maps them onto
// bank positions offset+0..offset+3 in the same order, so Volume lands on
// bank position 3.
constexpr std::size_t kSlotIx = 0;
constexpr std::size_t kLfoBankIx = 1;
constexpr std::size_t kTunePosition = 0;
constexpr std::size_t kPhasePosition = 1;
constexpr std::size_t kShapePosition = 2;
constexpr std::size_t kVolumePosition = 3;
constexpr std::size_t kFilterCutoffPosition = 4;
constexpr std::size_t kFilterResonancePosition = 5;
constexpr std::size_t kFilterBlendPosition = 6;
constexpr std::size_t kLfoFrequencyPosition = 0;
constexpr std::size_t kLfoShapePosition = 1;
constexpr std::size_t kLfoPhaseOffsetPosition = 2;
constexpr std::size_t kLfoSkewPosition = 3;
constexpr std::size_t kLfoExponentPosition = 4;

// Builds fresh runtime-owned scratch data paths unique to the calling test.
// Every test below injects these paths through SynthRig so startup patch
// loading cannot observe a shared production location or another test's data.
synth::RuntimeDataPaths UseScratchRuntimeDataPaths(const char* testName) {
    const std::filesystem::path dataRoot =
        std::filesystem::temp_directory_path() / "sheaf-patch-miniapp-system-tests" / testName;
    std::filesystem::remove_all(dataRoot);
    synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromDataRoot(dataRoot);
    std::filesystem::create_directories(paths.patchesRoot);
    return paths;
}

// Snapshot of a settled output window, used to prove a Turn actually changes
// the AUDIBLE output (not just a tracked parameter value). Captured via
// rig.ClearOutput() + rig.RunBlocks(count) + rig.Output(), copying every
// frame/channel sample out before the rig's capture ring can evict them.
using OutputWindow = std::vector<synth_rig::SynthRig<synth_miniapp::MiniAppCore>::OutputFrame>;

OutputWindow CaptureSettledOutputWindow(synth_rig::SynthRig<synth_miniapp::MiniAppCore>& rig, std::size_t numBlocks) {
    rig.ClearOutput();
    rig.RunBlocks(numBlocks);
    return rig.Output();
}

// Assert that two windows have exactly equal shape: same frame count and equal
// per-frame channel counts. Used to guard value comparisons and fail clearly
// on shape mismatches.
void RequireEqualWindowShapes(const OutputWindow& a, const OutputWindow& b, const char* context) {
    if (a.size() != b.size()) {
        std::ostringstream oss;
        oss << context << " frame count mismatch: " << a.size() << " vs " << b.size();
        throw std::runtime_error(oss.str());
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].channels.size() != b[i].channels.size()) {
            std::ostringstream oss;
            oss << context << " frame " << i << " channel count mismatch: "
                << a[i].channels.size() << " vs " << b[i].channels.size();
            throw std::runtime_error(oss.str());
        }
    }
}

// True if any frame/channel sample differs by more than tolerance between the
// two windows. Requires equal shapes first (fails clearly on shape mismatch).
// Used to assert a Turn produces a materially different output signal, not
// just a changed parameter value that never reaches the audio path.
bool OutputWindowsDifferMaterially(const OutputWindow& before, const OutputWindow& after, float tolerance) {
    RequireEqualWindowShapes(before, after, "OutputWindowsDifferMaterially");
    for (std::size_t frame = 0; frame < before.size(); ++frame) {
        const auto& beforeChannels = before[frame].channels;
        const auto& afterChannels = after[frame].channels;
        for (std::size_t ch = 0; ch < beforeChannels.size(); ++ch) {
            if (std::fabs(afterChannels[ch] - beforeChannels[ch]) > tolerance) {
                return true;
            }
        }
    }
    return false;
}

bool AllSamplesFinite(const OutputWindow& window) {
    for (const auto& frame : window) {
        for (const float sample : frame.channels) {
            if (!std::isfinite(sample)) {
                return false;
            }
        }
    }
    return true;
}

bool ValuesDifferMaterially(const std::vector<float>& values, float tolerance) {
    if (values.empty()) {
        return false;
    }
    const float first = values.front();
    for (const float value : values) {
        if (std::fabs(value - first) > tolerance) {
            return true;
        }
    }
    return false;
}

float OutputWindowPeak(const OutputWindow& window) {
    float peak = 0.0f;
    for (const auto& frame : window) {
        for (const float sample : frame.channels) {
            peak = std::max(peak, std::fabs(sample));
        }
    }
    return peak;
}

void RequireBankPosition(synth::BankSlot& slot, const synth::Bank& bank, std::size_t position,
                         synth::ParameterId expectedId, const char* expectedName) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    const synth::Parameter* parameter = bank.VisibleParameter(encoderId);
    REQUIRE_TRUE(parameter != nullptr);
    REQUIRE_TRUE(parameter->Id() == expectedId);
    REQUIRE_TRUE(parameter->Name() == expectedName);
}

void RequirePagePosition(const synth::Page& page, std::size_t position,
                         synth::ParameterId expectedId, const char* expectedName) {
    REQUIRE_TRUE(position < page.parameters.size());
    const synth::Parameter* parameter = page.parameters[position];
    REQUIRE_TRUE(parameter != nullptr);
    REQUIRE_TRUE(parameter->Id() == expectedId);
    REQUIRE_TRUE(parameter->Name() == expectedName);
}

void RequireUnboundBankPosition(synth::BankSlot& slot, const synth::Bank& bank, std::size_t position) {
    synth::PhysicalEncoderId encoderId = 0;
    REQUIRE_TRUE(slot.ResolvePosition(position, encoderId));
    REQUIRE_TRUE(bank.VisibleParameter(encoderId) == nullptr);
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const char* id) {
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.id == synth::ui::NodeId(id)) {
            return &node;
        }
    }
    return nullptr;
}

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, const std::string& id) {
    return FindNodeById(tree, id.c_str());
}

std::size_t NodeIndexById(const synth::ui::NodeTree& tree, const std::string& id) {
    for (std::size_t ix = 0; ix < tree.nodes.size(); ++ix) {
        if (tree.nodes[ix].id == synth::ui::NodeId(id)) {
            return ix;
        }
    }
    throw std::runtime_error("missing node " + id);
}

void RequireNodeId(const synth::ui::NodeTree& tree, const char* id) {
    REQUIRE_TRUE(FindNodeById(tree, id) != nullptr);
}

void RequireNodeKind(const synth::ui::NodeTree& tree, const char* id, synth::ui::NodeKind kind) {
    const synth::ui::Node* node = FindNodeById(tree, id);
    REQUIRE_TRUE(node != nullptr);
    REQUIRE_TRUE(node->kind == kind);
}

void RequireAction(const std::optional<synth::ui::Action>& action, const char* expectedName)
{
    REQUIRE_TRUE(action.has_value());
    REQUIRE_TRUE(action->name == expectedName);
}

bool PopNextMessage(synth::MessageInBus& uiBus, synth::MessageIn& message) {
    return uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max());
}

struct TestVisualizer final : synth::ui::Visualizer
{
    std::vector<synth::ui::DrawCommand> DrawVisible() const override
    {
        return {synth::ui::DrawCommand::Fill(GetBounds(), synth::Color::Cyan)};
    }
};

synth::ui::NodeTree BuildMiniAppTree(synth_rig::SynthRig<synth_miniapp::MiniAppCore>& rig) {
    rig.UIState();
    synth::AppContext context = rig.Engine().Context();
    synth_miniapp::MiniAppUiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    return surface.BuildTree();
}

}  // namespace

TEST_CASE(miniapp_registration_declares_launcher_metadata_and_launch_callable) {
    bool launched = false;
    synth::RuntimeDataPaths launchedPaths;
    const auto registration = synth_miniapp::MakeMiniAppRegistration(
        [&](synth::RuntimeDataPaths paths) {
            launched = true;
            launchedPaths = std::move(paths);
        });

    REQUIRE_TRUE(registration.manifest.appId == "miniapp");
    REQUIRE_TRUE(registration.manifest.displayName == "Mini App");
    REQUIRE_TRUE(registration.manifest.author == "Sheaf");
    REQUIRE_TRUE(registration.manifest.category == "test");
    REQUIRE_TRUE(registration.manifest.hardware.minEncoders == 16);
    REQUIRE_TRUE(static_cast<bool>(registration.launch));

    registration.launch(synth::RuntimeDataPaths::FromDataRoot("/tmp/sheaf-miniapp-registration-test"));
    REQUIRE_TRUE(launched);
    REQUIRE_TRUE(launchedPaths.dataRoot == std::filesystem::path("/tmp/sheaf-miniapp-registration-test"));
}

TEST_CASE(miniapp_portable_surface_exposes_stable_ids_and_routes_actions) {
    (void)UseScratchRuntimeDataPaths("portable_surface_exposes_stable_ids_and_routes_actions");

    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::RuntimeConfig config = synth_miniapp::MiniAppCore::Config();
    synth::MidiInstrumentConfig instrument;
    synth::AppContext context;
    context.parameterManager = &manager;
    context.uiBus = &uiBus;
    context.config = &config;
    context.instrument = &instrument;

    std::uint64_t timestamp = 1000;
    context.now = [&timestamp]() { return timestamp++; };

    synth_miniapp::MiniApp app;
    app.Init(&context);
    synth::ui::Surface& surface = app.PortableSurface();

    const synth::ui::NodeTree tree = surface.BuildTree();
    RequireNodeId(tree, "miniapp.root");
    RequireNodeId(tree, "miniapp.title");
    RequireNodeId(tree, "miniapp.encoder.0");
    RequireNodeId(tree, "miniapp.encoder.6");
    RequireNodeId(tree, "miniapp.vco.scope");
    RequireNodeId(tree, "miniapp.lfo.scope");
    RequireNodeId(tree, "miniapp.bank.vco");
    RequireNodeId(tree, "miniapp.bank.lfo");
    RequireNodeId(tree, "miniapp.gesture.toggle");
    RequireNodeId(tree, "miniapp.scene.0");
    RequireNodeId(tree, "miniapp.scene.1");
    RequireNodeId(tree, "miniapp.scene.2");
    RequireNodeId(tree, "miniapp.reset");
    RequireNodeId(tree, "miniapp.random");
    RequireNodeId(tree, "miniapp.random_mod");
    RequireNodeId(tree, "miniapp.start");
    RequireNodeId(tree, "miniapp.stop");
    RequireNodeId(tree, "miniapp.gesture.value");
    RequireNodeId(tree, "miniapp.scene.blend");

    const synth::ui::Node* encoder0 = FindNodeById(tree, "miniapp.encoder.0");
    REQUIRE_TRUE(encoder0 != nullptr);
    REQUIRE_TRUE(encoder0->kind == synth::ui::NodeKind::Draw);
    RequireAction(encoder0->pointerDragAction, synth_miniapp::MiniAppActions::kEncoderDrag);
    RequireAction(encoder0->doubleClickAction, synth_miniapp::MiniAppActions::kEncoderPush);
    std::size_t encodedSlot = 999;
    std::size_t encodedPosition = 999;
    float encodedDelta = 999.0f;
    REQUIRE_TRUE(synth_miniapp::ParseEncoderGestureValue(
        synth_miniapp::FormatEncoderGestureValue(0, 0, 0.25f),
        encodedSlot,
        encodedPosition,
        encodedDelta));
    REQUIRE_TRUE(encodedSlot == 0);
    REQUIRE_TRUE(encodedPosition == 0);
    REQUIRE_NEAR(encodedDelta, 0.25f, 1e-6f);

    const std::size_t queueBefore = uiBus.Size();
    surface.DispatchAction(synth::ui::Action::Named("miniapp.start"));
    REQUIRE_TRUE(uiBus.Size() == queueBefore + 1);
    synth::MessageIn message;
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::Start);
    REQUIRE_TRUE(message.timestamp == 1000);

    surface.DispatchAction(synth::ui::Action::Named("miniapp.stop"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::Stop);
    REQUIRE_TRUE(message.timestamp == 1001);

    surface.DispatchAction(synth::ui::Action::WithValue("miniapp.bank.select", "1"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SelectParamBank);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.bankIx == 1);
    REQUIRE_TRUE(message.timestamp == 1002);

    surface.DispatchAction(synth::ui::Action::WithValue("miniapp.gesture.value", "0.42"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetGestureValue);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_NEAR(message.value, 0.42f, 1e-4f);
    REQUIRE_TRUE(message.timestamp == 1003);

    surface.DispatchAction(synth::ui::Action::Named("miniapp.gesture.toggle"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleGestureSelect);
    REQUIRE_TRUE(message.gestureIx == 0);
    REQUIRE_TRUE(message.timestamp == 1004);

    surface.DispatchAction(synth::ui::Action::WithValue("miniapp.scene.select", "2"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(message.sceneIx == 2);
    REQUIRE_TRUE(message.timestamp == 1005);

    surface.DispatchAction(synth::ui::Action::WithValue("miniapp.scene.blend", "0.75"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::SetSceneBlend);
    REQUIRE_NEAR(message.value, 0.75f, 1e-4f);
    REQUIRE_TRUE(message.timestamp == 1006);

    surface.DispatchAction(synth::ui::Action::Named("miniapp.reset"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleReset);
    REQUIRE_TRUE(message.timestamp == 1007);

    surface.DispatchAction(synth::ui::Action::Named("miniapp.random"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleRandom);
    REQUIRE_TRUE(message.timestamp == 1008);

    surface.DispatchAction(synth::ui::Action::Named("miniapp.random_mod"));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ToggleRandomMod);
    REQUIRE_TRUE(message.timestamp == 1009);

    surface.DispatchAction(synth::ui::Action::WithValue(
        synth_miniapp::MiniAppActions::kEncoderDrag,
        synth_miniapp::FormatEncoderGestureValue(0, 3, 0.125f)));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamIncDec);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 3);
    REQUIRE_NEAR(message.delta, 0.125f, 1e-6f);
    REQUIRE_TRUE(message.timestamp == 1010);

    surface.DispatchAction(synth::ui::Action::WithValue(
        synth_miniapp::MiniAppActions::kEncoderPush,
        synth_miniapp::FormatEncoderGestureValue(0, 3, 0.0f)));
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::ParamPush);
    REQUIRE_TRUE(message.slotIx == 0);
    REQUIRE_TRUE(message.position == 3);
    REQUIRE_TRUE(message.timestamp == 1011);

    static_assert(synth::SynthApplication<synth_miniapp::MiniApp>);
}

TEST_CASE(miniapp_ui_model_exposes_layout_scene_labels_and_dispatch) {
    (void)UseScratchRuntimeDataPaths("ui_model_exposes_layout_scene_labels_and_dispatch");

    REQUIRE_TRUE(synth_miniapp::SceneLabel(0) == std::string("S1"));
    REQUIRE_TRUE(synth_miniapp::SceneLabel(1) == std::string("S2"));
    REQUIRE_TRUE(synth_miniapp::SceneLabel(2) == std::string("S3"));
    REQUIRE_TRUE(synth_miniapp::SceneButtonLabel(0, 0, 1) == std::string("S1 L"));
    REQUIRE_TRUE(synth_miniapp::SceneButtonLabel(1, 0, 1) == std::string("S2 R"));
    REQUIRE_TRUE(synth_miniapp::SceneButtonLabel(2, 2, 2) == std::string("S3 L R"));

    const synth::ui::Bounds encoderArea{16.0f, 48.0f, 968.0f, synth_miniapp::EncoderGridLayout::kTotalHeight};
    const synth::ui::Bounds encoderZero = synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 0);
    RequireNear(encoderZero.x, 26.0f, 0.0001f, "encoder zero x");
    RequireNear(encoderZero.y, 58.0f, 0.0001f, "encoder zero y");
    RequireNear(encoderZero.width, 112.0f, 0.0001f, "encoder zero width");
    RequireNear(encoderZero.height, 130.0f, 0.0001f, "encoder zero height");

    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    std::uint64_t timestamp = 42;
    bool dispatched = synth_miniapp::DispatchMiniAppAction(
        nullptr,
        timestamp,
        synth::ui::Action::Named(synth_miniapp::MiniAppActions::kStart),
        [](const synth::MessageIn&) {});
    REQUIRE_TRUE(!dispatched);

    synth::AppContext context;
    context.uiBus = &uiBus;
    dispatched = synth_miniapp::DispatchMiniAppAction(
        &context,
        timestamp,
        synth::ui::Action::Named(synth_miniapp::MiniAppActions::kStart),
        [&uiBus](const synth::MessageIn& message) { uiBus.Push(message); });
    REQUIRE_TRUE(dispatched);
    synth::MessageIn message;
    REQUIRE_TRUE(PopNextMessage(uiBus, message));
    REQUIRE_TRUE(message.type == synth::MessageIn::Type::Start);
    REQUIRE_TRUE(message.timestamp == 42);
}

TEST_CASE(miniapp_ui_snapshot_reflects_runtime_state_in_tree) {
    (void)UseScratchRuntimeDataPaths("ui_snapshot_reflects_runtime_state_in_tree");

    synth_rig::SynthRig<synth_miniapp::MiniApp> rig;
    rig.SetReset(true);
    rig.SetRandom(true);
    rig.SetRandomMod(true);
    rig.SelectGesture(0, true);
    rig.SetGestureValue(0, 0.33f);
    rig.SetSceneBlend(0.66f);
    rig.SelectScene(2);
    rig.RunBlocks(1);
    rig.UIState();

    synth::ui::Surface& surface = rig.Application().PortableSurface();
    const synth::ui::NodeTree tree = surface.BuildTree();

    const synth::ui::Node* gestureToggle = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kGestureToggle);
    REQUIRE_TRUE(gestureToggle != nullptr);
    REQUIRE_TRUE(gestureToggle->kind == synth::ui::NodeKind::Toggle);
    REQUIRE_TRUE(gestureToggle->checked);

    const synth::ui::Node* resetToggle = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kReset);
    REQUIRE_TRUE(resetToggle != nullptr);
    REQUIRE_TRUE(resetToggle->kind == synth::ui::NodeKind::Toggle);
    REQUIRE_TRUE(resetToggle->checked);

    const synth::ui::Node* randomToggle = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kRandom);
    REQUIRE_TRUE(randomToggle != nullptr);
    REQUIRE_TRUE(randomToggle->checked);

    const synth::ui::Node* randomModToggle = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kRandomMod);
    REQUIRE_TRUE(randomModToggle != nullptr);
    REQUIRE_TRUE(randomModToggle->checked);

    const synth::ui::Node* gestureSlider = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kGestureValue);
    REQUIRE_TRUE(gestureSlider != nullptr);
    REQUIRE_NEAR(gestureSlider->value, 0.33f, 1e-4f);

    const synth::ui::Node* blendSlider = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kSceneBlend);
    REQUIRE_TRUE(blendSlider != nullptr);
    REQUIRE_NEAR(blendSlider->value, 0.66f, 1e-4f);

    RequireNodeKind(tree, synth_miniapp::MiniAppNodeIds::SceneButton(0).c_str(), synth::ui::NodeKind::Button);
    const synth::ui::Node* sceneOne = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::SceneButton(0).c_str());
    REQUIRE_TRUE(sceneOne != nullptr);
    REQUIRE_TRUE(sceneOne->label == "S1");
    const synth::ui::Node* sceneTwo = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::SceneButton(1).c_str());
    REQUIRE_TRUE(sceneTwo != nullptr);
    REQUIRE_TRUE(sceneTwo->label == "S2 R");
    const synth::ui::Node* sceneThree = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::SceneButton(2).c_str());
    REQUIRE_TRUE(sceneThree != nullptr);
    REQUIRE_TRUE(sceneThree->label == "S3 L");
}

TEST_CASE(miniapp_modulation_view_draws_visualizer_beneath_encoder) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_modulation_view_draws_visualizer_beneath_encoder"));
    rig.RunBlocks(4);
    rig.Press(kSlotIx, kTunePosition);
    rig.RunBlocks(1);

    auto& manager = rig.Engine().Manager();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);
    TestVisualizer injectedVisualizer;
    ui->slots[0].cells[kTunePosition].visualizer.store(&injectedVisualizer, std::memory_order_relaxed);

    synth::AppContext context = rig.Engine().Context();
    context.uiState = ui.get();
    synth_miniapp::MiniAppUiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    const synth::ui::NodeTree tree = surface.BuildTree();

    const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(kTunePosition);
    const std::string visualizerId = encoderId + ".visualizer";
    const synth::ui::Node* encoder = FindNodeById(tree, encoderId);
    const synth::ui::Node* visualizer = FindNodeById(tree, visualizerId);
    REQUIRE_TRUE(encoder != nullptr);
    REQUIRE_TRUE(visualizer != nullptr);
    REQUIRE_TRUE(visualizer->kind == synth::ui::NodeKind::Draw);
    REQUIRE_TRUE(visualizer->pointerDragAction == std::nullopt);
    REQUIRE_TRUE(visualizer->doubleClickAction == std::nullopt);
    REQUIRE_TRUE(encoder->pointerDragAction.has_value());
    REQUIRE_TRUE(encoder->doubleClickAction.has_value());
    REQUIRE_TRUE(!encoder->drawCommands.empty());
    REQUIRE_TRUE(encoder->drawCommands.front().kind == synth::ui::DrawCommand::Kind::FillEllipse);
    REQUIRE_TRUE(encoder->drawCommands.front().color.a > 0);
    REQUIRE_TRUE(encoder->drawCommands.front().color.a < 255);
    REQUIRE_TRUE(visualizer->bounds.x == encoder->bounds.x);
    REQUIRE_TRUE(visualizer->bounds.y == encoder->bounds.y);
    REQUIRE_TRUE(visualizer->bounds.width == encoder->bounds.width);
    REQUIRE_TRUE(visualizer->bounds.height == encoder->bounds.height);
    REQUIRE_TRUE(NodeIndexById(tree, visualizerId) < NodeIndexById(tree, encoderId));
}

TEST_CASE(miniapp_top_level_parameter_rendering_remains_encoder_only_without_visualizer) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_top_level_parameter_rendering_remains_encoder_only_without_visualizer"));
    rig.RunBlocks(1);

    const synth::ui::NodeTree tree = BuildMiniAppTree(rig);
    const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(kTunePosition);

    REQUIRE_TRUE(FindNodeById(tree, encoderId) != nullptr);
    REQUIRE_TRUE(FindNodeById(tree, encoderId + ".visualizer") == nullptr);
    const synth::ui::Node* encoder = FindNodeById(tree, encoderId);
    REQUIRE_TRUE(encoder != nullptr);
    REQUIRE_TRUE(!encoder->drawCommands.empty());
    REQUIRE_TRUE(encoder->drawCommands.front().kind == synth::ui::DrawCommand::Kind::FillEllipse);
    REQUIRE_TRUE(encoder->drawCommands.front().color.a == 255);
}

TEST_CASE(miniapp_hidden_visualizer_keeps_encoder_opaque_and_encoder_only) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_hidden_visualizer_keeps_encoder_opaque_and_encoder_only"));
    rig.RunBlocks(4);
    rig.Press(kSlotIx, kTunePosition);
    rig.RunBlocks(1);

    auto& manager = rig.Engine().Manager();
    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);
    TestVisualizer hiddenVisualizer;
    hiddenVisualizer.SetVisible(false);
    ui->slots[0].cells[kTunePosition].visualizer.store(&hiddenVisualizer, std::memory_order_relaxed);

    synth::AppContext context = rig.Engine().Context();
    context.uiState = ui.get();
    synth_miniapp::MiniAppUiSurface surface;
    surface.Attach(&context, &rig.Engine().Application());
    const synth::ui::NodeTree tree = surface.BuildTree();

    const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(kTunePosition);
    const synth::ui::Node* encoder = FindNodeById(tree, encoderId);
    REQUIRE_TRUE(encoder != nullptr);
    REQUIRE_TRUE(FindNodeById(tree, encoderId + ".visualizer") == nullptr);
    REQUIRE_TRUE(!encoder->drawCommands.empty());
    REQUIRE_TRUE(encoder->drawCommands.front().kind == synth::ui::DrawCommand::Kind::FillEllipse);
    REQUIRE_TRUE(encoder->drawCommands.front().color.a == 255);
}

TEST_CASE(miniapp_bank_transition_clears_modulation_visualizer_underlay) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_bank_transition_clears_modulation_visualizer_underlay"));
    rig.RunBlocks(1);
    rig.Press(kSlotIx, kTunePosition);
    rig.RunBlocks(1);

    const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(0);
    const synth::ui::NodeTree modulationTree = BuildMiniAppTree(rig);
    REQUIRE_TRUE(FindNodeById(modulationTree, encoderId) != nullptr);
    REQUIRE_TRUE(FindNodeById(modulationTree, encoderId + ".visualizer") != nullptr);

    rig.SelectBank(kSlotIx, kLfoBankIx);
    rig.RunBlocks(1);

    const synth::ui::NodeTree lfoTree = BuildMiniAppTree(rig);
    REQUIRE_TRUE(FindNodeById(lfoTree, encoderId) != nullptr);
    REQUIRE_TRUE(FindNodeById(lfoTree, encoderId + ".visualizer") == nullptr);
}

TEST_CASE(miniapp_registers_distinct_scope_visualizers_for_modulators) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64,
        UseScratchRuntimeDataPaths("miniapp_registers_distinct_scope_visualizers_for_modulators"));
    auto* group = rig.Engine().Application().Group();
    REQUIRE_TRUE(group != nullptr);

    const auto& modulators = group->GetModulators();
    synth::ui::Visualizer* mod0 = modulators.Metadata(0).visualizer;
    synth::ui::Visualizer* mod1 = modulators.Metadata(1).visualizer;
    synth::ui::Visualizer* mod2 = modulators.Metadata(2).visualizer;

    REQUIRE_TRUE(mod0 != nullptr);
    REQUIRE_TRUE(mod1 != nullptr);
    REQUIRE_TRUE(mod2 != nullptr);
    REQUIRE_TRUE(mod0 != mod1);
    REQUIRE_TRUE(mod0->Visible());
    REQUIRE_TRUE(mod1->Visible());
    REQUIRE_TRUE(mod2->Visible());
}

TEST_CASE(miniapp_color_flow_keeps_semantic_roles_independent) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(
        64, UseScratchRuntimeDataPaths("color_flow_keeps_semantic_roles_independent"));
    rig.RunBlocks(1);

    const std::array<synth::Color, 12> expectedBaseColors{
        synth::Color::Cyan,
        synth::Color::Indigo,
        synth::Color::Orange,
        synth::Color::Green,
        synth::Color::Cyan,
        synth::Color::Yellow,
        synth::Color::Orange,
        synth::Color::Green,
        synth::Color::Cyan,
        synth::Color::Indigo,
        synth::Color::Orange,
        synth::Color::Yellow,
    };
    const auto& parameters = rig.Application().Parameters();
    REQUIRE_TRUE(parameters.size() == expectedBaseColors.size());
    for (std::size_t parameterIx = 0; parameterIx < parameters.size(); ++parameterIx) {
        REQUIRE_TRUE(parameters[parameterIx]->BaseColor() == expectedBaseColors[parameterIx]);
        REQUIRE_TRUE(parameters[parameterIx]->IndicatorColor(0) == synth::Color::Cyan);
        REQUIRE_TRUE(parameters[parameterIx]->IndicatorColor(1) == synth::Color::Orange);
    }

    REQUIRE_TRUE(rig.Application().VcoBank()->BankColor() == synth::Color::Cyan);
    REQUIRE_TRUE(rig.Application().LfoBank()->BankColor() == synth::Color::Green);
    const auto modulatorMetadata = rig.Application().Group()->GetModulators().Metadata();
    REQUIRE_TRUE(modulatorMetadata.size() == 3);
    REQUIRE_TRUE(modulatorMetadata[0].sourceColor == synth::Color::Cyan);
    REQUIRE_TRUE(modulatorMetadata[1].sourceColor == synth::Color::Orange);
    REQUIRE_TRUE(modulatorMetadata[2].sourceColor == synth::Color::Green);
    REQUIRE_TRUE(rig.Application().Context()->parameterManager->GestureMetadataAt(0).gestureColor ==
                 synth::Color::Orange);

    const auto vcoScope = synth_miniapp::VcoWaveformDrawStateFromCore(rig.Application());
    REQUIRE_TRUE(vcoScope.layers.size() == 2);
    REQUIRE_TRUE(vcoScope.layers[0].scopeColor == synth::Color::Cyan);
    REQUIRE_TRUE(vcoScope.layers[1].scopeColor == synth::Color::Orange);
    const auto lfoScope = synth_miniapp::LfoWaveformDrawStateFromCore(rig.Application());
    REQUIRE_TRUE(lfoScope.layers.size() == 2);
    REQUIRE_TRUE(lfoScope.layers[0].scopeColor == synth::Color::Green);
    REQUIRE_TRUE(lfoScope.layers[1].scopeColor == synth::Color::Yellow);

    const std::vector<synth::Color> expectedModulatorColors{
        synth::Color::Cyan, synth::Color::Orange, synth::Color::Green};
    const auto requireVisibleCellColors = [&](std::size_t visibleCellCount,
                                              std::span<const synth::Color> expectedCellBaseColors) {
        const synth::ParameterManager::UIState& uiState = rig.UIState();
        for (std::size_t cellIx = 0; cellIx < visibleCellCount; ++cellIx) {
            const synth::Parameter::UIState& visibleCell = uiState.slots[0].cells[cellIx];
            const synth::ui::EncoderDrawState encoder =
                synth::ui::EncoderDrawStateFromParameter(visibleCell);
            REQUIRE_TRUE(encoder.baseColor == expectedCellBaseColors[cellIx]);
            REQUIRE_TRUE(encoder.voices.size() == 2);
            REQUIRE_TRUE(encoder.voices[0].indicatorColor == synth::Color::Cyan);
            REQUIRE_TRUE(encoder.voices[1].indicatorColor == synth::Color::Orange);
            REQUIRE_TRUE(encoder.modulatorColors == expectedModulatorColors);
            REQUIRE_TRUE(encoder.gestureColors == std::vector<synth::Color>{synth::Color::Orange});
        }
    };
    requireVisibleCellColors(7, std::span<const synth::Color>(expectedBaseColors).first(7));

    rig.SelectBank(kSlotIx, kLfoBankIx);
    rig.RunBlocks(1);
    requireVisibleCellColors(5, std::span<const synth::Color>(expectedBaseColors).subspan(7));
}

TEST_CASE(miniapp_rig_initializes_headlessly_and_runs) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("initializes_headlessly_and_runs"));
    const float expectedDefaultAlpha = 0.1226942309f;  // one-pole 1 kHz cutoff at 48 kHz
    REQUIRE_NEAR(rig.Application().Group()->Config().processLiteAlpha, expectedDefaultAlpha, 0.000001f);
    REQUIRE_TRUE(rig.Application().Group()->Config().targetComputeIntervalSamples == 16);
    rig.RunBlocks(1);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_run_seconds_produces_finite_output) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("run_seconds_produces_finite_output"));
    rig.RunSeconds(0.1);
    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(!rig.Output().empty());
}

TEST_CASE(miniapp_rig_raising_volume_yields_nonzero_output_peak) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("raising_volume_yields_nonzero_output_peak"));

    // Volume defaults to 1.0 (see Modules.cpp), so peak should already be
    // nonzero after a short run; still exercise Turn on the production bus
    // to prove the volume encoder position actually reaches the parameter.
    rig.Turn(kSlotIx, kVolumePosition, 0.3f);
    rig.RunSeconds(0.1);

    REQUIRE_TRUE(!rig.SawNaN());
    REQUIRE_TRUE(rig.OutputPeak() > 0.0f);
}

TEST_CASE(miniapp_rig_lfo_bank_exposes_five_module_parameters) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("lfo_bank_exposes_five_module_parameters"));
    rig.RunBlocks(1);

    REQUIRE_TRUE(rig.Application().Parameters().size() == 12);
    const auto lfoIds = rig.Application().LfoParameterIds();
    const float beforeFrequency = rig.ParameterValue(lfoIds.frequency);
    const float beforeShape = rig.ParameterValue(lfoIds.shape);
    const float beforePhaseOffset = rig.ParameterValue(lfoIds.phaseOffset);
    const float beforeSkew = rig.ParameterValue(lfoIds.skew);
    const float beforeExponent = rig.ParameterValue(lfoIds.exponent);

    rig.SelectBank(kSlotIx, kLfoBankIx);
    rig.RunBlocks(1);

    const synth::Page* activePage = rig.Application().Context()->parameterManager->ActivePage();
    REQUIRE_TRUE(activePage != nullptr);
    REQUIRE_TRUE(activePage->name == "LFO");
    REQUIRE_TRUE(activePage->parameters.size() == 5);
    RequirePagePosition(*activePage, kLfoFrequencyPosition, lfoIds.frequency, "LFO Frequency");
    RequirePagePosition(*activePage, kLfoShapePosition, lfoIds.shape, "LFO Shape");
    RequirePagePosition(*activePage, kLfoPhaseOffsetPosition, lfoIds.phaseOffset, "LFO Phase Offset");
    RequirePagePosition(*activePage, kLfoSkewPosition, lfoIds.skew, "LFO Skew");
    RequirePagePosition(*activePage, kLfoExponentPosition, lfoIds.exponent, "LFO Exponent");

    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoFrequencyPosition,
                        lfoIds.frequency, "LFO Frequency");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoShapePosition,
                        lfoIds.shape, "LFO Shape");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoPhaseOffsetPosition,
                        lfoIds.phaseOffset, "LFO Phase Offset");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoSkewPosition,
                        lfoIds.skew, "LFO Skew");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kLfoExponentPosition,
                        lfoIds.exponent, "LFO Exponent");
    RequireUnboundBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kFilterResonancePosition);
    RequireUnboundBankPosition(*rig.Application().Slot(), *rig.Application().LfoBank(), kFilterBlendPosition);

    rig.Turn(kSlotIx, kLfoFrequencyPosition, 0.10f);
    rig.Turn(kSlotIx, kLfoShapePosition, -0.10f);
    rig.Turn(kSlotIx, kLfoPhaseOffsetPosition, 0.20f);
    rig.Turn(kSlotIx, kLfoSkewPosition, -0.20f);
    rig.Turn(kSlotIx, kLfoExponentPosition, 0.15f);
    rig.RunBlocks(16);

    REQUIRE_NEAR(rig.ParameterValue(lfoIds.frequency), beforeFrequency + 0.10f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.shape), beforeShape - 0.10f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.phaseOffset), beforePhaseOffset + 0.20f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.skew), beforeSkew - 0.20f, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(lfoIds.exponent), beforeExponent + 0.15f, 1e-3f);
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_vco_bank_exposes_vco_and_filter_parameters) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("vco_bank_exposes_vco_and_filter_parameters"));
    rig.RunBlocks(1);

    REQUIRE_TRUE(rig.Application().Parameters().size() == 12);
    const auto vcoIds = rig.Application().VcoParameterIds();
    const auto filterIds = rig.Application().FilterParameterIds();

    const synth::Page* activePage = rig.Application().Context()->parameterManager->ActivePage();
    REQUIRE_TRUE(activePage != nullptr);
    REQUIRE_TRUE(activePage->name == "VCO");
    REQUIRE_TRUE(activePage->parameters.size() == 7);
    RequirePagePosition(*activePage, kTunePosition, vcoIds.tune, "Tune");
    RequirePagePosition(*activePage, kPhasePosition, vcoIds.phase, "Phase");
    RequirePagePosition(*activePage, kShapePosition, vcoIds.shape, "Shape");
    RequirePagePosition(*activePage, kVolumePosition, vcoIds.volume, "Volume");
    RequirePagePosition(*activePage, kFilterCutoffPosition, filterIds.cutoff, "Filter Cutoff");
    RequirePagePosition(*activePage, kFilterResonancePosition, filterIds.resonance, "Filter Resonance");
    RequirePagePosition(*activePage, kFilterBlendPosition, filterIds.blend, "Filter Blend");

    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kTunePosition,
                        vcoIds.tune, "Tune");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kPhasePosition,
                        vcoIds.phase, "Phase");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kShapePosition,
                        vcoIds.shape, "Shape");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kVolumePosition,
                        vcoIds.volume, "Volume");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterCutoffPosition,
                        filterIds.cutoff, "Filter Cutoff");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterResonancePosition,
                        filterIds.resonance, "Filter Resonance");
    RequireBankPosition(*rig.Application().Slot(), *rig.Application().VcoBank(), kFilterBlendPosition,
                        filterIds.blend, "Filter Blend");
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_lfo_modulation_source_changes_from_module_processing) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("lfo_modulation_source_changes_from_module_processing"));
    std::vector<float> voice0Values;
    std::vector<float> voice1Values;

    for (int i = 0; i < 8; ++i) {
        rig.RunBlocks(8);
        voice0Values.push_back(rig.Application().Group()->GetModulators().Value(0, 2));
        voice1Values.push_back(rig.Application().Group()->GetModulators().Value(1, 2));
    }

    REQUIRE_TRUE(ValuesDifferMaterially(voice0Values, 1e-4f));
    REQUIRE_TRUE(ValuesDifferMaterially(voice1Values, 1e-4f));
    REQUIRE_TRUE(!rig.SawNaN());
}

TEST_CASE(miniapp_rig_zero_volume_yields_silence_and_turning_up_restores_signal) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("zero_volume_yields_silence_and_turning_up_restores_signal"));

    // Drive Volume down to (near) zero via repeated turns on its bank
    // position, then confirm the output peak collapses -- proving the
    // production Turn(slot, position) path for kVolumePosition actually
    // reaches WavetableVcoModule<2>'s Volume parameter and audibly changes
    // the mixed output, not just that output happens to be nonzero already.
    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, -0.1f);
    }
    rig.RunBlocks(8);
    const OutputWindow quietWindow = CaptureSettledOutputWindow(rig, 10);
    const float quietPeak = OutputWindowPeak(quietWindow);
    REQUIRE_TRUE(quietPeak < 0.02f);

    for (int i = 0; i < 40; ++i) {
        rig.Turn(kSlotIx, kVolumePosition, 0.1f);
    }
    rig.RunBlocks(8);
    rig.RunSeconds(0.1);

    REQUIRE_TRUE(rig.OutputPeak() > quietPeak + 0.05f);
    REQUIRE_TRUE(!rig.SawNaN());
}

// These "Turn changes output" tests must not compare two free-running output
// windows captured at different times against the SAME rig: the VCOs are
// free-running oscillators, so phase alone drifts the waveform from one
// window to the next even when a Turn has zero effect on the audio path.
// That would let a broken parameter->audio wire pass the test for the wrong
// reason.
//
// Instead this leans on the engine's proven determinism (see
// rig_two_identical_runs_are_deterministic in rig_tests.cpp): build TWO
// rigs, script them through an IDENTICAL sequence of blocks/turns for N
// blocks, then apply the Turn under test to ONLY rig B, run BOTH rigs for
// the SAME further M blocks, and compare their captured output over that
// same final-M-block range. With no turn applied, two identically-scripted
// rigs produce bit-identical output (determinism), so this test's baseline
// sanity check asserts the pre-turn windows from A and B match; any material
// post-turn difference between A and B is then attributable ONLY to the
// turn -- phase drift cannot explain it, because both rigs drift identically
// from the same identical history.
TEST_CASE(miniapp_rig_tune_turn_changes_output) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA(64, UseScratchRuntimeDataPaths("tune_turn_changes_output"));
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB(64, UseScratchRuntimeDataPaths("tune_turn_changes_output_b"));

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId tuneIdA = rigA.Application().VcoParameterIds().tune;
    const synth::ParameterId tuneIdB = rigB.Application().VcoParameterIds().tune;
    const float beforeA = rigA.ParameterValue(tuneIdA);
    const float beforeB = rigB.ParameterValue(tuneIdB);

    // Baseline sanity: with both rigs scripted identically so far and no
    // turn applied yet, their settled output windows must be bit-identical
    // (determinism). This proves the twin-rig setup itself is apples-to-
    // apples before the turn is introduced.
    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    // Rigs are deterministic, so baseline windows must be EXACTLY equal.
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_tune_turn_changes_output baseline");
    REQUIRE_TRUE(baselineA.size() == baselineB.size());
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);  // bit-identical
    }

    // Apply the Turn under test to rig B only.
    rigB.Turn(kSlotIx, kTunePosition, 0.3f);

    rigA.RunBlocks(16);  // let the parameter slew settle before capturing
    rigB.RunBlocks(16);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    // Primary assertion (the brief's actual requirement): Tune's Turn must
    // audibly change the OUTPUT signal, not just the tracked parameter.
    // Because rigA and rigB were scripted identically up to this point,
    // determinism guarantees any material difference here comes from the
    // turn, not from oscillator phase drift.
    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float afterValueA = rigA.ParameterValue(tuneIdA);
    const float afterValueB = rigB.ParameterValue(tuneIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_NEAR(afterValueB, beforeB + 0.3f, 1e-3f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
}

TEST_CASE(miniapp_rig_shape_turn_changes_output) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA(64, UseScratchRuntimeDataPaths("shape_turn_changes_output"));
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB(64, UseScratchRuntimeDataPaths("shape_turn_changes_output_b"));

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId shapeIdA = rigA.Application().VcoParameterIds().shape;
    const synth::ParameterId shapeIdB = rigB.Application().VcoParameterIds().shape;
    const float beforeA = rigA.ParameterValue(shapeIdA);
    const float beforeB = rigB.ParameterValue(shapeIdB);

    // Baseline sanity: with both rigs scripted identically so far and no
    // turn applied yet, their settled output windows must be bit-identical
    // (determinism). This proves the twin-rig setup itself is apples-to-
    // apples before the turn is introduced.
    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    // Rigs are deterministic, so baseline windows must be EXACTLY equal.
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_shape_turn_changes_output baseline");
    REQUIRE_TRUE(baselineA.size() == baselineB.size());
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);  // bit-identical
    }

    // Apply the Turn under test to rig B only.
    rigB.Turn(kSlotIx, kShapePosition, 0.4f);

    rigA.RunBlocks(16);  // let the parameter slew settle before capturing
    rigB.RunBlocks(16);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    // Primary assertion (the brief's actual requirement): Shape's Turn must
    // audibly change the OUTPUT signal (waveshape), not just the tracked
    // parameter. Because rigA and rigB were scripted identically up to this
    // point, determinism guarantees any material difference here comes from
    // the turn, not from oscillator phase drift.
    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    // Secondary (parameter-value) checks, kept for regression coverage of
    // the production Turn(slot, position) -> parameter routing path.
    const float afterValueA = rigA.ParameterValue(shapeIdA);
    const float afterValueB = rigB.ParameterValue(shapeIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_NEAR(afterValueB, beforeB + 0.4f, 1e-3f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
}

TEST_CASE(miniapp_rig_filter_blend_turn_changes_output) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigA(64, UseScratchRuntimeDataPaths("filter_blend_turn_changes_output"));
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rigB(64, UseScratchRuntimeDataPaths("filter_blend_turn_changes_output_b"));

    rigA.RunBlocks(4);
    rigB.RunBlocks(4);

    const synth::ParameterId blendIdA = rigA.Application().FilterParameterIds().blend;
    const synth::ParameterId blendIdB = rigB.Application().FilterParameterIds().blend;
    const float beforeA = rigA.ParameterValue(blendIdA);
    const float beforeB = rigB.ParameterValue(blendIdB);

    const OutputWindow baselineA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow baselineB = CaptureSettledOutputWindow(rigB, 8);
    REQUIRE_TRUE(AllSamplesFinite(baselineA));
    REQUIRE_TRUE(AllSamplesFinite(baselineB));
    RequireEqualWindowShapes(baselineA, baselineB, "miniapp_rig_filter_blend_turn_changes_output baseline");
    for (std::size_t i = 0; i < baselineA.size(); ++i) {
        REQUIRE_TRUE(baselineA[i].channels == baselineB[i].channels);
    }

    rigB.Turn(kSlotIx, kFilterBlendPosition, 1.0f);

    rigA.RunBlocks(32);
    rigB.RunBlocks(32);

    const OutputWindow afterA = CaptureSettledOutputWindow(rigA, 8);
    const OutputWindow afterB = CaptureSettledOutputWindow(rigB, 8);

    REQUIRE_TRUE(AllSamplesFinite(afterA));
    REQUIRE_TRUE(AllSamplesFinite(afterB));
    REQUIRE_TRUE(OutputWindowsDifferMaterially(afterA, afterB, 1e-4f));

    const float afterValueA = rigA.ParameterValue(blendIdA);
    const float afterValueB = rigB.ParameterValue(blendIdB);
    REQUIRE_NEAR(afterValueA, beforeA, 1e-3f);
    REQUIRE_TRUE(afterValueB != beforeB);
    REQUIRE_TRUE(afterValueB > beforeB + 0.5f);
    REQUIRE_TRUE(!rigA.SawNaN());
    REQUIRE_TRUE(!rigB.SawNaN());
}

TEST_CASE(miniapp_rig_patch_save_perturb_load_round_trip) {
    const synth::RuntimeDataPaths paths = UseScratchRuntimeDataPaths("patch_save_perturb_load_round_trip");

    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, paths);
    rig.RunBlocks(4);

    const synth::ParameterId tuneId = rig.Application().VcoParameterIds().tune;
    const synth::ParameterId shapeId = rig.Application().VcoParameterIds().shape;

    rig.Turn(kSlotIx, kTunePosition, 0.25f);
    rig.Turn(kSlotIx, kShapePosition, -0.15f);
    rig.RunBlocks(16);

    const float savedTune = rig.ParameterValue(tuneId);
    const float savedShape = rig.ParameterValue(shapeId);

    const std::filesystem::path patchDir = paths.patchesRoot / "Take1";
    REQUIRE_TRUE(rig.SavePatchAs(patchDir) == synth_rig::RigPatchStatus::Written);
    rig.Engine().EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        REQUIRE_TRUE(instrument.RenameController(0, "runtime-edited"));
    });
    rig.Engine().SetAudioDeviceFromHost(synth::AudioDeviceState{
        .outputDeviceName = "Runtime Out",
        .inputDeviceName = "Runtime In",
    });

    // Perturb: move both parameters away from the saved values.
    rig.Turn(kSlotIx, kTunePosition, -0.4f);
    rig.Turn(kSlotIx, kShapePosition, 0.4f);
    rig.RunBlocks(16);

    REQUIRE_TRUE(std::fabs(rig.ParameterValue(tuneId) - savedTune) > 1e-3f);
    REQUIRE_TRUE(std::fabs(rig.ParameterValue(shapeId) - savedShape) > 1e-3f);

    REQUIRE_TRUE(rig.LoadPatch(patchDir) == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(16);

    REQUIRE_NEAR(rig.ParameterValue(tuneId), savedTune, 1e-3f);
    REQUIRE_NEAR(rig.ParameterValue(shapeId), savedShape, 1e-3f);
    REQUIRE_TRUE(rig.Engine().InstrumentSnapshot().controllers.size() == 1);
    REQUIRE_TRUE(rig.Engine().InstrumentSnapshot().controllers[0].name == "runtime-edited");
    REQUIRE_TRUE(rig.Engine().AudioDeviceSnapshot().outputDeviceName == "Runtime Out");
    REQUIRE_TRUE(rig.Engine().AudioDeviceSnapshot().inputDeviceName == "Runtime In");
    REQUIRE_TRUE(!rig.SawNaN());

    std::filesystem::remove_all(paths.dataRoot);
}

TEST_CASE(miniapp_patch_browser_save_as_path_writes_patch_and_load_selection_reads_it) {
    const synth::RuntimeDataPaths paths = UseScratchRuntimeDataPaths("patch_browser_save_load");
    synth::PatchBrowser browser(paths.patchesRoot);

    const auto savePath = browser.ResolveSaveAsPath("Browser Patch");
    REQUIRE_TRUE(savePath.has_value());

    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, paths);
    rig.RunBlocks(4);

    const synth::ParameterId volumeId = rig.Application().VcoParameterIds().volume;
    rig.Turn(kSlotIx, kVolumePosition, -0.35f);
    rig.RunBlocks(16);
    const float savedVolume = rig.ParameterValue(volumeId);

    REQUIRE_TRUE(rig.SavePatchAs(*savePath) == synth_rig::RigPatchStatus::Written);
    REQUIRE_TRUE(std::filesystem::is_directory(*savePath));

    REQUIRE_TRUE(browser.Refresh());
    REQUIRE_TRUE(browser.Entries().size() == 1);
    REQUIRE_TRUE(browser.Entries()[0].name == "Browser Patch");
    browser.Select(0);

    rig.Turn(kSlotIx, kVolumePosition, 0.35f);
    rig.RunBlocks(16);
    REQUIRE_TRUE(std::fabs(rig.ParameterValue(volumeId) - savedVolume) > 1e-3f);

    const auto loadPath = browser.SelectedLoadPath();
    REQUIRE_TRUE(loadPath.has_value());
    REQUIRE_TRUE(rig.LoadPatch(*loadPath) == synth_rig::RigPatchStatus::Ok);
    rig.RunBlocks(16);
    REQUIRE_NEAR(rig.ParameterValue(volumeId), savedVolume, 1e-3f);

    std::filesystem::remove_all(paths.dataRoot);
}

// spm-45: post-Init the default instrument (Engine::LiveInstrument(), which
// Engine::Initialize() snapshots into DefaultInstrument() right after
// MiniAppCore::Init() returns -- see MiniAppCore.hpp's comment on the
// controller-seeding block) must contain EXACTLY ONE controller slot, named
// "wrldbldr", kind WrldBldr, built from the shared DefaultMidiInstrumentConfig().
// The profile deliberately carries all 16 encoder positions and 8 scene
// selector messages even when a specific app exposes fewer scenes or backing
// cells. Spot-check the encoder input mapping rather than comparing the whole
// config: turns live on channel 0, pushes on channel 1, and CCs map onto
// positions 1:1 (EncoderPositionToCC(position) == position for position < 16).
TEST_CASE(miniapp_rig_default_instrument_has_single_wrldbldr_controller) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("default_instrument_has_single_wrldbldr_controller"));

    // Pin the post-Init DEFAULT instrument (revert/new-patch restore value).
    const synth::MidiInstrumentConfig& defaultInstrument = rig.Engine().DefaultInstrument();
    REQUIRE_TRUE(defaultInstrument.controllers.size() == 1);

    // Assert the live instrument equals the default at startup.
    const synth::MidiInstrumentConfig& liveInstrument = rig.Engine().LiveInstrument();
    REQUIRE_TRUE(liveInstrument.controllers.size() == defaultInstrument.controllers.size());

    const synth::MidiControllerSlot& slot = defaultInstrument.controllers.front();
    REQUIRE_TRUE(slot.name == "wrldbldr");
    REQUIRE_TRUE(slot.kind == synth::MidiProfileKind::WrldBldr);

    // The default WRLD.Bldr profile maps all 16 physical encoders even though
    // the app only realizes 4 on-screen (positions 4..15 are input-ignored and
    // output-blanked).
    constexpr std::size_t kVisibleEncoderCount = 16;
    synth::WrldBldrDefaultProfileOptions expectedOptions;
    const synth::MidiControllerProfileConfig expectedConfig = synth::WrldBldrDefaultProfileConfig(expectedOptions);

    REQUIRE_TRUE(slot.config.encoderInput.has_value());
    REQUIRE_TRUE(expectedConfig.encoderInput.has_value());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == expectedConfig.encoderInput->turns.size());
    REQUIRE_TRUE(slot.config.encoderInput->pushes.size() == expectedConfig.encoderInput->pushes.size());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == kVisibleEncoderCount);

    // Assert system association count. WrldBldrDefaultProfileConfig produces:
    // 3 (reset/random/random-mod modifiers) + sceneCount (8) + bankButtonCount (16)
    // + gestureSelectorCount (1) = 28
    REQUIRE_TRUE(slot.config.systemMessages.size() == expectedConfig.systemMessages.size());
    REQUIRE_TRUE(slot.config.systemMessages.size() == 28);

    // Encoder-mapping spot-checks (brief Step 1): turn channel 0, push
    // channel 1, CCs 0..(visibleEncoderCount-1) -> positions
    // 0..(visibleEncoderCount-1).
    for (std::size_t position = 0; position < kVisibleEncoderCount; ++position) {
        const auto turnIt = std::find_if(
            slot.config.encoderInput->turns.begin(), slot.config.encoderInput->turns.end(),
            [position](const synth::EncoderMidiMapping& mapping) { return mapping.position == position; });
        REQUIRE_TRUE(turnIt != slot.config.encoderInput->turns.end());
        REQUIRE_TRUE(turnIt->control.channel == 0);
        REQUIRE_TRUE(turnIt->control.cc == static_cast<std::uint8_t>(position));

        const auto pushIt = std::find_if(
            slot.config.encoderInput->pushes.begin(), slot.config.encoderInput->pushes.end(),
            [position](const synth::EncoderMidiMapping& mapping) { return mapping.position == position; });
        REQUIRE_TRUE(pushIt != slot.config.encoderInput->pushes.end());
        REQUIRE_TRUE(pushIt->control.channel == 1);
        REQUIRE_TRUE(pushIt->control.cc == static_cast<std::uint8_t>(position));
    }
}

TEST_CASE(miniapp_rig_no_nan_across_extended_run) {
    synth_rig::SynthRig<synth_miniapp::MiniAppCore> rig(64, UseScratchRuntimeDataPaths("no_nan_across_extended_run"));

    rig.Turn(kSlotIx, kTunePosition, 0.2f);
    rig.Turn(kSlotIx, kShapePosition, 0.3f);
    rig.Turn(kSlotIx, kPhasePosition, 0.5f);
    rig.Turn(kSlotIx, kVolumePosition, -0.2f);
    rig.RunSeconds(0.5);

    REQUIRE_TRUE(!rig.SawNaN());
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
