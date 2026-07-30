#include "PortableJuceBackend.hpp"

#include "../apps/miniapp/MiniApp.hpp"
#include "../apps/miniapp/MiniAppUiModel.hpp"

#include "synth/PortableUI.hpp"
#include "synth/GangedRandomLfoVisualizer.hpp"

#include <cmath>
#include <iostream>
#include <limits>
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

void RequireNear(float actual, float expected, float tolerance, const char* label)
{
    if (std::fabs(actual - expected) > tolerance)
    {
        throw std::runtime_error(std::string(label) + " expected " + std::to_string(expected) + " got " +
                                 std::to_string(actual));
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

// Node bounds are parent-relative, so a claim about where two nodes sit
// relative to each other is a claim about their bounds folded over their
// ancestor origins.
synth::ui::Bounds SurfaceBoundsOf(const synth::ui::NodeTree& tree, const std::string& id)
{
    const auto parentOf = [&tree](const std::string& wanted) -> std::string {
        for (const synth::ui::Node& node : tree.nodes)
        {
            for (const synth::ui::NodeId& child : node.children)
            {
                if (child.value == wanted)
                {
                    return node.id.value;
                }
            }
        }
        return {};
    };
    const synth::ui::Node* node = FindNodeById(tree, id.c_str());
    Require(node != nullptr, "surface bounds for a node that exists");
    synth::ui::Bounds bounds = node->bounds;
    for (std::string parent = parentOf(id); !parent.empty(); parent = parentOf(parent))
    {
        const synth::ui::Node* parentNode = FindNodeById(tree, parent.c_str());
        Require(parentNode != nullptr, "surface bounds walks a complete ancestor chain");
        bounds.x += parentNode->bounds.x;
        bounds.y += parentNode->bounds.y;
    }
    return bounds;
}

struct StaticSurface final : synth::ui::Surface
{
    synth::ui::NodeTree BuildTree() override
    {
        return tree;
    }

    void SetActionHandler(ActionHandler handler) override
    {
        handler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action&) override {}

    synth::ui::NodeTree tree;
    ActionHandler handler_;
};

juce::Image RenderComponent(juce::Component& component)
{
    juce::Image image(juce::Image::ARGB,
                      std::max(1, component.getWidth()),
                      std::max(1, component.getHeight()),
                      true);
    juce::Graphics graphics(image);
    component.paintEntireComponent(graphics, true);
    return image;
}

void RequireDrawStartsInsideResolvedBounds(const juce::Image& image,
                                           juce::Rectangle<int> bounds,
                                           const char* label)
{
    const juce::Colour rootBackground(18, 20, 22);
    const int x = bounds.getX() + 2;
    const int y = bounds.getY() + 2;
    Require(image.getBounds().contains(x, y), label);
    Require(image.getPixelAt(x, y) != rootBackground, label);
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    synth::GangedRandomLfoSnapshot<2> predictiveSnapshot;
    predictiveSnapshot.sampleRate = 48000.0;
    predictiveSnapshot.roundElapsedSamples = 3.0;
    predictiveSnapshot.voices[0] = {.source = 0.1f, .target = 0.9f, .output = 0.2f, .shape = 0.0f,
                                    .waitingIncrement = 0.25, .movingIncrement = 0.5,
                                    .color = synth::Color::Cyan};
    predictiveSnapshot.voices[1] = {.source = 0.8f, .target = 0.2f, .output = 0.7f, .shape = 1.0f,
                                    .waitingIncrement = 0.125, .movingIncrement = 0.25,
                                    .color = synth::Color::Orange};
    std::vector<synth::ui::DrawCommand> predictiveCommands;
    synth::ui::BuildGangedRandomLfoCommands(
        predictiveSnapshot, {0.0f, 0.0f, 160.0f, 80.0f}, predictiveCommands);
    juce::Image predictiveImage(juce::Image::ARGB, 160, 80, true);
    juce::Graphics predictiveGraphics(predictiveImage);
    std::size_t predictivePolylines = 0;
    std::size_t predictiveDots = 0;
    const juce::Rectangle<float> predictiveBounds{0.0f, 0.0f, 160.0f, 80.0f};
    const bool predictiveCommandsAreLocal =
        synth_juce::DrawCommandsLookLocal(predictiveCommands, predictiveBounds);
    for (const auto& command : predictiveCommands)
    {
        synth_juce::PaintDrawCommand(
            predictiveGraphics, command, predictiveBounds, predictiveCommandsAreLocal);
        predictivePolylines += command.kind == synth::ui::DrawCommand::Kind::Polyline ? 1u : 0u;
        predictiveDots += command.kind == synth::ui::DrawCommand::Kind::FillEllipse ? 1u : 0u;
    }
    Require(predictivePolylines > 2, "JUCE consumes predictive polyline commands");
    Require(predictiveDots == 2, "JUCE consumes predictive ellipse commands");

    synth::ParameterManager manager;
    synth::GridManager gridManager;
    synth::MessageInBus uiBus(&manager);
    synth::RuntimeConfig config = synth_miniapp::MiniAppCore::Config();
    synth::MidiInstrumentConfig instrument;
    synth::AppContext context;
    context.parameterManager = &manager;
    context.gridManager = &gridManager;
    context.uiBus = &uiBus;
    context.config = &config;
    context.instrument = &instrument;

    std::uint64_t timestamp = 500;
    context.now = [&timestamp]() { return timestamp++; };

    synth_miniapp::MiniApp app;
    app.Init(&context);
    synth::ui::Surface& surface = app.PortableSurface();

    synth_juce::PortableComponent component(surface);
    component.setSize(config.uiWidth, config.uiHeight);
    component.RefreshFromSurface();

    // The JUCE host must mirror the complete portable MiniApp node tree.
    const synth::ui::NodeTree tree = surface.BuildTree();
    Require(FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kRoot) != nullptr, "miniapp root node exists");
    Require(FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(0).c_str()) != nullptr,
            "encoder zero draw node exists");
    Require(FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(15).c_str()) != nullptr,
            "encoder fifteen draw node exists");
    Require(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) != nullptr,
            "encoder zero is hosted");
    Require(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(15)) != nullptr,
            "encoder fifteen is hosted");
    Require(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::kStart) != nullptr, "start control is hosted");
    const synth::ui::Node* vcoPanel = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kVcoScope);
    const synth::ui::Node* lfoPanel = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kLfoScope);
    Require(vcoPanel != nullptr && lfoPanel != nullptr,
            "JUCE receives both MiniApp waveform panels");
    Require(FindNodeById(tree, "miniapp.ganged_random_lfo.round") == nullptr,
            "removed MiniApp main panel is absent");
    Require(SurfaceBoundsOf(tree, vcoPanel->id.value).y + vcoPanel->bounds.height <=
                SurfaceBoundsOf(tree, lfoPanel->id.value).y,
            "JUCE tree preserves vertical scope ordering");
    juce::Image panelImage(juce::Image::ARGB, config.uiWidth, config.uiHeight, true);
    juce::Graphics panelGraphics(panelImage);
    for (const synth::ui::Node* panel : {vcoPanel, lfoPanel})
    {
        Require(!panel->drawCommands.empty(), "each MiniApp scope supplies portable draw commands");
        const juce::Rectangle<float> panelBounds =
            synth_juce::UiToJuceRectF(SurfaceBoundsOf(tree, panel->id.value));
        const bool panelCommandsAreLocal =
            synth_juce::DrawCommandsLookLocal(panel->drawCommands, panelBounds);
        for (const auto& command : panel->drawCommands)
        {
            synth_juce::PaintDrawCommand(
                panelGraphics,
                command,
                panelBounds,
                panelCommandsAreLocal);
        }
    }

    const synth::ui::Node* encoderNode = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(0).c_str());
    const synth::ui::Node* encoderFifteenNode =
        FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(15).c_str());
    Require(encoderNode != nullptr, "encoder node for layout parity");
    Require(encoderFifteenNode != nullptr, "encoder fifteen node for layout parity");
    Require(SurfaceBoundsOf(tree, vcoPanel->id.value).x + vcoPanel->bounds.width <=
                    SurfaceBoundsOf(tree, encoderNode->id.value).x &&
                SurfaceBoundsOf(tree, lfoPanel->id.value).x + lfoPanel->bounds.width <=
                    SurfaceBoundsOf(tree, encoderFifteenNode->id.value).x,
            "scope stack remains left of encoder grid");

    // The encoder grid's geometry is resolved, not hand-computed. At the
    // default 900x560 surface the standard layout gives the encoder region
    // 462 wide, which the grid divides into four columns over three 8 gaps.
    const synth::ui::Node* encoderRegion = FindNodeById(tree, "miniapp.encoders");
    Require(encoderRegion != nullptr, "the encoder region resolves");
    RequireNear(encoderRegion->bounds.width, 462.0f, 0.01f, "encoder region width");
    const float expectedCellWidth = (462.0f - 8.0f * 3.0f) * 0.25f;
    RequireNear(encoderNode->bounds.width, expectedCellWidth, 0.01f, "encoder zero width");
    RequireNear(encoderFifteenNode->bounds.width, expectedCellWidth, 0.01f, "encoder fifteen width");
    RequireNear(encoderFifteenNode->bounds.height, encoderNode->bounds.height, 0.0001f,
                "every encoder cell shares one height");
    const synth::ui::Bounds encoderZeroSurface = SurfaceBoundsOf(tree, encoderNode->id.value);
    const synth::ui::Bounds encoderFifteenSurface = SurfaceBoundsOf(tree, encoderFifteenNode->id.value);
    RequireNear(encoderFifteenSurface.x,
                encoderZeroSurface.x + 3.0f * (expectedCellWidth + 8.0f),
                0.01f,
                "encoder fifteen sits three columns right of encoder zero");
    RequireNear(encoderFifteenSurface.y,
                encoderZeroSurface.y + 3.0f * (encoderNode->bounds.height + 8.0f),
                0.01f,
                "encoder fifteen sits three rows below encoder zero");

    StaticSurface paintedGridSurface;
    paintedGridSurface.tree = tree;
    for (std::size_t encoderIx = 0; encoderIx < synth_miniapp::EncoderGridLayout::kEncoderCount; ++encoderIx)
    {
        const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(encoderIx);
        for (synth::ui::Node& node : paintedGridSurface.tree.nodes)
        {
            if (node.id == synth::ui::NodeId(encoderId))
            {
                node.drawCommands.push_back(
                    synth::ui::DrawCommand::Fill(
                        {0.0f, 0.0f, node.bounds.width, node.bounds.height},
                        synth::Color::Rgb(90, 120, 160)));
                break;
            }
        }
    }
    synth_juce::PortableComponent paintedGridComponent(paintedGridSurface);
    paintedGridComponent.setSize(config.uiWidth, config.uiHeight);
    paintedGridComponent.RefreshFromSurface();
    const juce::Image paintedGridImage = RenderComponent(paintedGridComponent);

    for (std::size_t encoderIx = 0; encoderIx < synth_miniapp::EncoderGridLayout::kEncoderCount; ++encoderIx)
    {
        const std::string encoderId = synth_miniapp::MiniAppNodeIds::Encoder(encoderIx);
        const synth::ui::Node* node = FindNodeById(tree, encoderId.c_str());
        Require(node != nullptr, "each MiniApp encoder remains in the portable tree");
        const juce::Rectangle<int> expectedBounds =
            synth_juce::UiToJuceRect(SurfaceBoundsOf(tree, encoderId));
        Require(paintedGridComponent.SurfaceBoundsForNode(encoderId) == expectedBounds,
                "each hosted MiniApp encoder retains its pre-change surface bounds");
        RequireDrawStartsInsideResolvedBounds(paintedGridImage,
                                               expectedBounds,
                                               "each MiniApp encoder paints at its resolved origin");
    }
    const juce::Image renderedComponent = RenderComponent(component);
    RequireDrawStartsInsideResolvedBounds(renderedComponent,
                                           synth_juce::UiToJuceRect(SurfaceBoundsOf(tree, vcoPanel->id.value)),
                                           "VCO scope paints at its resolved origin");
    RequireDrawStartsInsideResolvedBounds(renderedComponent,
                                           synth_juce::UiToJuceRect(SurfaceBoundsOf(tree, lfoPanel->id.value)),
                                           "LFO scope paints at its resolved origin");

    auto* startButton = dynamic_cast<juce::TextButton*>(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::kStart));
    Require(startButton != nullptr, "start node is a TextButton");
    const std::size_t queueBefore = uiBus.Size();
    startButton->onClick();
    Require(uiBus.Size() == queueBefore + 1, "start click routes through portable backend");
    synth::MessageIn message;
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "start message is queued");
    Require(message.type == synth::MessageIn::Type::Start, "start message type");
    Require(message.timestamp == 500, "start uses runtime timestamp provider");

    auto* resetToggle = dynamic_cast<juce::ToggleButton*>(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::kReset));
    Require(resetToggle != nullptr, "reset modifier is a ToggleButton");
    resetToggle->onClick();
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "reset message is queued");
    Require(message.type == synth::MessageIn::Type::ToggleReset, "reset routes modifier action");
    Require(message.timestamp == 501, "reset uses runtime timestamp provider");

    auto* blendSlider = dynamic_cast<juce::Slider*>(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::kSceneBlend));
    Require(blendSlider != nullptr, "scene blend slider is hosted");
    blendSlider->setValue(0.25, juce::dontSendNotification);
    blendSlider->onValueChange();
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "blend message is queued");
    Require(message.type == synth::MessageIn::Type::SetSceneBlend, "blend routes slider action");
    RequireNear(message.value, 0.25f, 0.001f, "blend slider value");

    auto* encoder = component.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0));
    Require(encoder != nullptr, "encoder interactive overlay is hosted");
    const juce::MouseInputSource mouseSource = juce::Desktop::getInstance().getMainMouseSource();
    const juce::Point<float> downPoint(20.0f, 20.0f);
    const juce::Point<float> dragPoint(30.0f, 10.0f);
    juce::MouseEvent downEvent(mouseSource,
                               downPoint,
                               juce::ModifierKeys::leftButtonModifier,
                               1.0f,
                               1.0f,
                               1.0f,
                               1.0f,
                               1.0f,
                               encoder,
                               encoder,
                               juce::Time::getCurrentTime(),
                               downPoint,
                               juce::Time::getCurrentTime(),
                               1,
                               false);
    encoder->mouseDown(downEvent);
    juce::MouseEvent dragEvent(mouseSource,
                               dragPoint,
                               juce::ModifierKeys::leftButtonModifier,
                               1.0f,
                               1.0f,
                               1.0f,
                               1.0f,
                               1.0f,
                               encoder,
                               encoder,
                               juce::Time::getCurrentTime(),
                               downPoint,
                               juce::Time::getCurrentTime(),
                               1,
                               false);
    encoder->mouseDrag(dragEvent);
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "encoder drag message is queued");
    Require(message.type == synth::MessageIn::Type::ParamIncDec, "encoder drag routes inc/dec");
    Require(message.slotIx == 0, "encoder drag slot");
    Require(message.position == 0, "encoder drag position");
    RequireNear(message.delta, 0.05f, 0.0001f, "encoder drag delta");
    Require(message.timestamp == 503, "encoder drag uses timestamp provider");

    encoder->mouseDoubleClick(downEvent);
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()), "encoder push message is queued");
    Require(message.type == synth::MessageIn::Type::ParamPush, "encoder double-click routes push");
    Require(message.slotIx == 0, "encoder push slot");
    Require(message.position == 0, "encoder push position");
    Require(message.timestamp == 504, "encoder push uses timestamp provider");

    auto* encoderFifteen = component.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(15));
    Require(encoderFifteen != nullptr, "encoder fifteen interactive overlay is hosted");
    juce::MouseEvent encoderFifteenDownEvent(mouseSource,
                                             downPoint,
                                             juce::ModifierKeys::leftButtonModifier,
                                             1.0f,
                                             1.0f,
                                             1.0f,
                                             1.0f,
                                             1.0f,
                                             encoderFifteen,
                                             encoderFifteen,
                                             juce::Time::getCurrentTime(),
                                             downPoint,
                                             juce::Time::getCurrentTime(),
                                             1,
                                             false);
    encoderFifteen->mouseDoubleClick(encoderFifteenDownEvent);
    Require(uiBus.Pop(message, std::numeric_limits<std::uint64_t>::max()),
            "encoder fifteen push message is queued");
    Require(message.type == synth::MessageIn::Type::ParamPush,
            "encoder fifteen double-click routes push");
    Require(message.slotIx == 0, "encoder fifteen push slot");
    Require(message.position == 15, "encoder fifteen push position");
    Require(message.timestamp == 505, "encoder fifteen push uses timestamp provider");

    std::cout << "MiniApp JUCE backend parity tests passed\n";
    return 0;
}
