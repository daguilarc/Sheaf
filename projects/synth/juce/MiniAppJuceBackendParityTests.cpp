#include "PortableJuceBackend.hpp"

#include "../apps/miniapp/MiniApp.hpp"
#include "../apps/miniapp/MiniAppUiModel.hpp"

#include "synth/PortableUI.hpp"

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

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    synth::ParameterManager manager;
    synth::MessageInBus uiBus(&manager);
    synth::RuntimeConfig config = synth_miniapp::MiniAppCore::Config();
    synth::MidiInstrumentConfig instrument;
    synth::AppContext context;
    context.parameterManager = &manager;
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

    const synth::ui::NodeTree tree = surface.BuildTree();
    Require(FindNodeById(tree, synth_miniapp::MiniAppNodeIds::kRoot) != nullptr, "miniapp root node exists");
    Require(FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(0).c_str()) != nullptr,
            "encoder draw node exists");
    Require(component.FindByNodeId(synth_miniapp::MiniAppNodeIds::kStart) != nullptr, "start control is hosted");

    const synth::ui::Bounds rootBounds = synth_miniapp::MiniAppPageLayout::RootBounds(&context);
    const synth::ui::Bounds encoderArea =
        synth_miniapp::MiniAppPageLayout::EncoderArea(synth_miniapp::MiniAppPageLayout::ContentArea(rootBounds));
    const synth::ui::Node* encoderNode = FindNodeById(tree, synth_miniapp::MiniAppNodeIds::Encoder(0).c_str());
    Require(encoderNode != nullptr, "encoder node for layout parity");
    RequireNear(encoderNode->bounds.x,
                synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 0).x,
                0.0001f,
                "encoder zero x through backend tree");
    RequireNear(encoderNode->bounds.y,
                synth_miniapp::EncoderGridLayout::BoundsForIndex(encoderArea, 0).y,
                0.0001f,
                "encoder zero y through backend tree");

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

    std::cout << "MiniApp JUCE backend parity tests passed\n";
    return 0;
}
