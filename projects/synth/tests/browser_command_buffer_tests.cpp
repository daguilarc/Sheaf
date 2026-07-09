#include "synth/PortableUI.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"

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
                 DrawCommand::Fill({1, 2, 30, 40}, Color::Rgb(1, 2, 3)),
                 DrawCommand::StrokeRect({4, 5, 6, 7}, Color::Rgb(4, 5, 6), 2),
                 DrawCommand::Line({8, 9}, {10, 11}, Color::Rgb(7, 8, 9), 3),
                 DrawCommand::Arc({12, 13, 14, 15}, 0.1f, 2.1f, Color::Rgb(10, 11, 12), 4),
                 DrawCommand::Text({16, 17, 18, 19}, "Scope", TextStyle{15, Color::Rgb(13, 14, 15), TextAlign::Center}),
                 DrawCommand::FillEllipse({20, 21, 22, 23}, Color::Rgb(16, 17, 18)),
                 DrawCommand::StrokeEllipse({24, 25, 26, 27}, Color::Rgb(19, 20, 21), 5),
                 DrawCommand::FillRoundedRect({28, 29, 30, 31}, 6, Color::Rgb(22, 23, 24)),
                 DrawCommand::StrokeRoundedRect({32, 33, 34, 35}, 7, Color::Rgb(25, 26, 27), 8),
                 DrawCommand::Polyline({{36, 37}, {38, 39}, {40, 41}}, Color::Rgb(28, 29, 30), 9),
                 DrawCommand::FillPolygon({{42, 43}, {44, 45}, {46, 47}}, Color::Rgb(31, 32, 33)),
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
    second.nodes[7].drawCommands[0] = synth::ui::DrawCommand::Fill(synth::ui::Color::Rgb(90, 91, 92));

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

}  // namespace

int main()
{
    TestCompleteTreeRoundTrips();
    TestNodeIdsAreStableAcrossFrames();
    TestUnsupportedPortableFeatureIsGeneric();
    TestUnsupportedDrawFeatureIsGeneric();
    return 0;
}
