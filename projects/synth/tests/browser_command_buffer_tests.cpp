#include "synth/PortableUI.hpp"
#include "synth/GangedRandomLfoVisualizer.hpp"
#include "synth/StandardModulators.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"

#include "../apps/miniapp/MiniAppDraw.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <string>

#ifdef JUCE_MAJOR_VERSION
#error "browser command buffer tests must not see JUCE"
#endif

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth_browser::DecodedNode& FindNode(const synth_browser::DecodedCommandBuffer& buffer, const char* id)
{
    const auto found = std::find_if(buffer.nodes.begin(), buffer.nodes.end(), [id](const auto& node) {
        return node.id == id;
    });
    if (found == buffer.nodes.end())
    {
        throw std::runtime_error("decoded node missing");
    }
    return *found;
}

synth::ui::NodeTree MakeCompleteTree()
{
    using namespace synth::ui;
    NodeTree tree;
    tree.nodes = {
        Node{.id = NodeId("root"), .kind = NodeKind::Root, .bounds = {0, 0, 800, 600},
             .children = {NodeId("scroll"), NodeId("button"), NodeId("slider"), NodeId("combo"),
                          NodeId("field"), NodeId("status"), NodeId("draw")}},
        Node{.id = NodeId("scroll"), .kind = NodeKind::ScrollArea, .bounds = {2, 3, 240, 180},
             .scrollContentWidth = 720, .scrollContentHeight = 900, .children = {NodeId("button")}},
        Node{.id = NodeId("button"), .kind = NodeKind::Button, .bounds = {4, 5, 100, 24}, .label = "Save",
             .action = Action::WithValue("file.save", "current")},
        Node{.id = NodeId("slider"), .kind = NodeKind::Slider, .bounds = {4, 36, 180, 20}, .label = "Gain",
             .value = 0.25f, .minValue = -1.0f, .maxValue = 1.0f, .step = 0.05f,
             .action = Action::Named("gain.set")},
        Node{.id = NodeId("combo"), .kind = NodeKind::ComboBox, .bounds = {4, 62, 180, 24}, .label = "Mode",
             .options = {{"saw", "Saw"}, {"square", "Square"}}, .selectedOption = "square",
             .action = Action::Named("mode.select")},
        Node{.id = NodeId("field"), .kind = NodeKind::TextField, .bounds = {4, 92, 180, 24}, .label = "Name",
             .text = "Bright", .action = Action::Named("name.commit")},
        Node{.id = NodeId("status"), .kind = NodeKind::StatusText, .bounds = {4, 122, 180, 20}, .text = "Ready"},
        Node{.id = NodeId("draw"), .kind = NodeKind::Draw, .bounds = {260, 8, 300, 200},
             .drawCommands = {
                 DrawCommand::Fill({1, 2, 30, 40}, synth::Color::Rgb(1, 2, 3)),
                 DrawCommand::StrokeRect({4, 5, 6, 7}, synth::Color::Rgb(4, 5, 6), 2),
                 DrawCommand::Line({8, 9}, {10, 11}, synth::Color::Rgb(7, 8, 9), 3),
                 DrawCommand::Arc({12, 13, 14, 15}, 0.1f, 2.1f, synth::Color::Rgb(10, 11, 12), 4),
                 DrawCommand::Text({16, 17, 18, 19}, "Scope", TextStyle{15, synth::Color::Rgb(13, 14, 15), TextAlign::Center}),
                 DrawCommand::FillEllipse({20, 21, 22, 23}, synth::Color::Rgb(16, 17, 18)),
                 DrawCommand::StrokeEllipse({24, 25, 26, 27}, synth::Color::Rgb(19, 20, 21), 5),
                 DrawCommand::FillRoundedRect({28, 29, 30, 31}, 6, synth::Color::Rgb(22, 23, 24)),
                 DrawCommand::StrokeRoundedRect({32, 33, 34, 35}, 7, synth::Color::Rgb(25, 26, 27), 8),
                 DrawCommand::Polyline({{36, 37}, {38, 39}, {40, 41}}, synth::Color::Rgb(28, 29, 30), 9),
                 DrawCommand::FillPolygon({{42, 43}, {44, 45}, {46, 47}}, synth::Color::Rgb(31, 32, 33)),
             }},
    };
    return tree;
}

void TestCompleteTreeRoundTrips()
{
    const synth_browser::CommandBuffer encoded = synth_browser::SerializeNodeTree(MakeCompleteTree());
    Require(encoded.bytes.size() > 32, "buffer has payload");
    Require(encoded.bytes[0] == std::byte{'S'} && encoded.bytes[1] == std::byte{'B'} &&
                encoded.bytes[2] == std::byte{'C'} && encoded.bytes[3] == std::byte{'B'},
            "buffer magic");

    const synth_browser::DecodedCommandBuffer decoded = synth_browser::DecodeCommandBuffer(encoded.bytes);
    Require(decoded.version == 1, "buffer version");
    Require(decoded.diagnostics.empty(), "complete tree diagnostics");
    Require(decoded.nodes.size() == 8, "node count");
    Require(decoded.actions.size() == 4, "action count");
    Require(decoded.drawCommands.size() == 11, "draw command count");
    Require(std::find(decoded.strings.begin(), decoded.strings.end(), "Scope") != decoded.strings.end(), "draw text string");
    const std::array expectedDrawKinds = {
        synth_browser::CommandDrawKind::Fill,
        synth_browser::CommandDrawKind::StrokeRect,
        synth_browser::CommandDrawKind::Line,
        synth_browser::CommandDrawKind::Arc,
        synth_browser::CommandDrawKind::Text,
        synth_browser::CommandDrawKind::FillEllipse,
        synth_browser::CommandDrawKind::StrokeEllipse,
        synth_browser::CommandDrawKind::FillRoundedRect,
        synth_browser::CommandDrawKind::StrokeRoundedRect,
        synth_browser::CommandDrawKind::Polyline,
        synth_browser::CommandDrawKind::FillPolygon,
    };
    for (std::size_t index = 0; index < expectedDrawKinds.size(); ++index)
    {
        Require(decoded.drawCommands[index].kind == expectedDrawKinds[index], "draw kind mapping");
    }

    const auto& root = FindNode(decoded, "root");
    Require(root.kind == synth_browser::CommandNodeKind::Root, "root kind");
    Require(root.bounds.width == 800.0f && root.bounds.height == 600.0f, "root bounds");
    Require(root.children == std::vector<std::string>{"scroll", "button", "slider", "combo", "field", "status", "draw"},
            "root child ids preserve order");
    const auto& scroll = FindNode(decoded, "scroll");
    Require(scroll.kind == synth_browser::CommandNodeKind::ScrollArea && scroll.scrollContentHeight == 900.0f,
            "scroll extents");
    const auto& slider = FindNode(decoded, "slider");
    Require(slider.kind == synth_browser::CommandNodeKind::Slider && std::abs(slider.value - 0.25f) < 0.0001f,
            "slider value");
    const auto& combo = FindNode(decoded, "combo");
    Require(combo.options.size() == 2 && combo.options[1].id == "square" && combo.selectedOption == "square",
            "combo options");
    const auto& button = FindNode(decoded, "button");
    Require(button.action.has_value() && button.action->name == "file.save" && button.action->value == "current",
            "button action");
    const auto& draw = FindNode(decoded, "draw");
    Require(draw.drawCount == 11 && decoded.drawCommands[draw.drawStart + 4].kind == synth_browser::CommandDrawKind::Text,
            "draw range and text kind");
    Require(decoded.drawCommands[draw.drawStart + 9].points.size() == 3 &&
                decoded.drawCommands[draw.drawStart + 10].kind == synth_browser::CommandDrawKind::FillPolygon,
            "polyline and polygon");
}

void TestNodeIdsAreStableAcrossFrames()
{
    synth::ui::NodeTree first = MakeCompleteTree();
    synth::ui::NodeTree second = first;
    second.nodes[3].value = 0.75f;
    second.nodes[7].drawCommands[0] = synth::ui::DrawCommand::Fill(synth::Color::Rgb(90, 91, 92));

    const auto firstDecoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(first).bytes);
    const auto secondDecoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(second).bytes);
    Require(firstDecoded.nodes.size() == secondDecoded.nodes.size(), "stable frame node counts");
    for (std::size_t index = 0; index < firstDecoded.nodes.size(); ++index)
    {
        Require(firstDecoded.nodes[index].id == secondDecoded.nodes[index].id, "stable node id");
    }
    Require(FindNode(secondDecoded, "slider").value == 0.75f, "second frame value changes");
}

void TestUnsupportedPortableFeatureIsGeneric()
{
    synth::ui::NodeTree tree = MakeCompleteTree();
    tree.nodes[1].kind = synth_browser::testing::UnsupportedNodeKind();
    const auto decoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(tree).bytes);
    Require(decoded.diagnostics.size() == 2, "unsupported node diagnostic count");
    const auto hasNodeKind = std::any_of(decoded.diagnostics.begin(), decoded.diagnostics.end(), [](const auto& diagnostic) {
        return diagnostic.code == synth_browser::DiagnosticCode::UnsupportedPortableFeature && diagnostic.feature == "node kind";
    });
    const auto hasChildNode = std::any_of(decoded.diagnostics.begin(), decoded.diagnostics.end(), [](const auto& diagnostic) {
        return diagnostic.code == synth_browser::DiagnosticCode::UnsupportedPortableFeature && diagnostic.feature == "child node";
    });
    Require(hasNodeKind, "generic unsupported feature name");
    Require(hasChildNode, "generic child prune feature name");
    for (const auto& diagnostic : decoded.diagnostics)
        Require(diagnostic.feature.find("miniapp") == std::string::npos, "no app fallback diagnostic");
    const auto& root = FindNode(decoded, "root");
    Require(std::find(root.children.begin(), root.children.end(), "scroll") == root.children.end(),
            "unsupported child id is pruned");
    Require(std::find(root.children.begin(), root.children.end(), "button") != root.children.end(),
            "supported child ids remain");
}

void TestUnsupportedDrawFeatureIsGeneric()
{
    synth::ui::NodeTree tree = MakeCompleteTree();
    tree.nodes[7].drawCommands[0].kind = synth_browser::testing::UnsupportedDrawKind();
    const auto decoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(tree).bytes);
    Require(decoded.diagnostics.size() == 1, "unsupported draw diagnostic count");
    Require(decoded.diagnostics[0].code == synth_browser::DiagnosticCode::UnsupportedPortableFeature,
            "unsupported draw diagnostic code");
    Require(decoded.diagnostics[0].feature == "draw command kind", "generic unsupported draw feature name");
}

void TestPredictiveGangedLfoUsesExistingDrawSchema()
{
    synth::GangedRandomLfoSnapshot<2> snapshot;
    snapshot.sampleRate = 48000.0;
    snapshot.roundElapsedSamples = 2.0;
    snapshot.voices[0] = {.source = 0.0f, .target = 1.0f, .output = 0.8f, .shape = 0.0f,
                          .waitingIncrement = 0.25, .movingIncrement = 0.5,
                          .color = synth::Color::Cyan};
    snapshot.voices[1] = {.source = 1.0f, .target = 0.0f, .output = 0.2f, .shape = 1.0f,
                          .waitingIncrement = 0.125, .movingIncrement = 0.25,
                          .color = synth::Color::Orange};
    std::vector<synth::ui::DrawCommand> commands;
    synth::ui::BuildGangedRandomLfoCommands(snapshot, {0, 0, 160, 80}, commands);

    synth::ui::NodeTree tree;
    tree.nodes = {
        synth::ui::Node{.id = synth::ui::NodeId("root"), .kind = synth::ui::NodeKind::Root,
                        .bounds = {0, 0, 160, 80}, .children = {synth::ui::NodeId("predictive")}},
        synth::ui::Node{.id = synth::ui::NodeId("predictive"), .kind = synth::ui::NodeKind::Draw,
                        .bounds = {0, 0, 160, 80}, .drawCommands = std::move(commands)},
    };
    const auto decoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(tree).bytes);
    Require(decoded.version == synth_browser::kCommandBufferVersion,
            "predictive geometry preserves browser schema version");
    Require(decoded.diagnostics.empty(), "predictive geometry needs no browser protocol extension");
    const auto& node = FindNode(decoded, "predictive");
    std::size_t polylines = 0;
    std::size_t ellipses = 0;
    for (std::size_t index = 0; index < node.drawCount; ++index)
    {
        const auto kind = decoded.drawCommands[node.drawStart + index].kind;
        polylines += kind == synth_browser::CommandDrawKind::Polyline ? 1u : 0u;
        ellipses += kind == synth_browser::CommandDrawKind::FillEllipse ? 1u : 0u;
    }
    Require(polylines > 2, "browser consumes predictive polyline commands");
    Require(ellipses == 2, "browser consumes predictive ellipse commands");
}

void TestMiniAppTwoScopeCommandsUseExistingBrowserSchema()
{
    synth::ScopeWriter scope(2, 16);
    for (std::size_t sample = 0; sample < 16; ++sample)
    {
        scope.Write(0, static_cast<float>(sample) / 15.0f);
        scope.Write(1, 1.0f - static_cast<float>(sample) / 15.0f);
    }
    synth_miniapp::VcoWaveformDrawState vcoState;
    vcoState.layers = {{.connected = true, .scopeColor = synth::Color::Cyan,
                        .scope = &scope, .scopeChannel = 0}};
    synth_miniapp::LfoWaveformDrawState lfoState;
    lfoState.layers = {{.connected = true, .scopeColor = synth::Color::Green,
                        .scope = &scope, .scopeChannel = 1}};
    const std::array<synth::ui::Bounds, 2> bounds{{
        {8.0f, 8.0f, 144.0f, 64.0f},
        {168.0f, 8.0f, 144.0f, 64.0f},
    }};
    synth::ui::NodeTree tree;
    tree.nodes = {
        synth::ui::Node{.id = synth::ui::NodeId("root"), .kind = synth::ui::NodeKind::Root,
                        .bounds = {0, 0, 320, 80},
                        .children = {synth::ui::NodeId("vco"), synth::ui::NodeId("lfo")}},
        synth::ui::Node{.id = synth::ui::NodeId("vco"), .kind = synth::ui::NodeKind::Draw,
                        .bounds = bounds[0],
                        .drawCommands = synth_miniapp::BuildVcoWaveformCommands(vcoState, bounds[0])},
        synth::ui::Node{.id = synth::ui::NodeId("lfo"), .kind = synth::ui::NodeKind::Draw,
                        .bounds = bounds[1],
                        .drawCommands = synth_miniapp::BuildLfoWaveformCommands(lfoState, bounds[1])},
    };
    const auto decoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(tree).bytes);
    Require(decoded.nodes.size() == 3, "MiniApp browser tree contains root plus two scopes");
    Require(decoded.version == synth_browser::kCommandBufferVersion,
            "two-scope MiniApp tree keeps browser command version");
    Require(decoded.diagnostics.empty(), "two-scope MiniApp tree needs no browser fallback");
    Require(FindNode(decoded, "vco").drawCount > 0, "browser consumes VCO panel commands");
    Require(FindNode(decoded, "lfo").drawCount > 0, "browser consumes LFO panel commands");
}

void TestStandardModulatorUnderlaysUseExistingBrowserSchema()
{
    synth::ParameterManager manager;
    auto& group = manager.CreateGroup({.numVoices = 2, .numModulators = 15, .numScenes = 1, .maxParameters = 16});
    synth::StandardModulators<2> standard(group);
    standard.Register();
    standard.Prepare(48000.0);
    standard.Process();
    standard.PublishUiState();

    const synth::ui::Bounds bounds{0.0f, 0.0f, 96.0f, 96.0f};
    synth::ui::NodeTree tree;
    tree.nodes.push_back(synth::ui::Node{
        .id = synth::ui::NodeId("root"), .kind = synth::ui::NodeKind::Root,
        .bounds = bounds,
        .children = {synth::ui::NodeId("random"), synth::ui::NodeId("constant"), synth::ui::NodeId("noise")}});
    for (synth::ui::Visualizer* visualizer : {
             static_cast<synth::ui::Visualizer*>(&standard.RandomVisualizer(0)),
             static_cast<synth::ui::Visualizer*>(&standard.ConstantVisualizer()),
             static_cast<synth::ui::Visualizer*>(&standard.NoiseVisualizer())})
    {
        visualizer->SetBounds(bounds);
    }
    tree.nodes.push_back(synth::ui::Node{.id = synth::ui::NodeId("random"), .kind = synth::ui::NodeKind::Draw,
                                         .bounds = bounds, .drawCommands = standard.RandomVisualizer(0).Draw()});
    tree.nodes.push_back(synth::ui::Node{.id = synth::ui::NodeId("constant"), .kind = synth::ui::NodeKind::Draw,
                                         .bounds = bounds, .drawCommands = standard.ConstantVisualizer().Draw()});
    tree.nodes.push_back(synth::ui::Node{.id = synth::ui::NodeId("noise"), .kind = synth::ui::NodeKind::Draw,
                                         .bounds = bounds, .drawCommands = standard.NoiseVisualizer().Draw()});
    const auto decoded = synth_browser::DecodeCommandBuffer(synth_browser::SerializeNodeTree(tree).bytes);
    Require(decoded.version == synth_browser::kCommandBufferVersion,
            "standard underlays preserve browser command version");
    Require(decoded.diagnostics.empty(), "standard underlays need no browser fallback");
    Require(FindNode(decoded, "random").drawCount > 0, "browser consumes standard random underlay");
    Require(FindNode(decoded, "constant").drawCount == 2, "browser consumes standard constant underlay");
    Require(FindNode(decoded, "noise").drawCount == 1, "browser consumes standard noise underlay");
}

}  // namespace

int main()
{
    TestCompleteTreeRoundTrips();
    TestNodeIdsAreStableAcrossFrames();
    TestUnsupportedPortableFeatureIsGeneric();
    TestUnsupportedDrawFeatureIsGeneric();
    TestPredictiveGangedLfoUsesExistingDrawSchema();
    TestMiniAppTwoScopeCommandsUseExistingBrowserSchema();
    TestStandardModulatorUnderlaysUseExistingBrowserSchema();
    return 0;
}
