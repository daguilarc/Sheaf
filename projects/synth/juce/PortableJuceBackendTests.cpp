#include "PortableJuceBackend.hpp"

#include "synth/PortableUIBuilders.hpp"

#include <cmath>
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

struct RecordingSurface final : synth::ui::Surface
{
    synth::ui::NodeTree BuildTree() override
    {
        return tree;
    }

    void SetActionHandler(ActionHandler handler) override
    {
        handler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        lastAction = action;
        dispatchCount += 1;
    }

    synth::ui::NodeTree tree;
    synth::ui::Action lastAction;
    int dispatchCount = 0;
    ActionHandler handler_;
};

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    Require(synth_juce::UiToJuceRect(synth::ui::Bounds{1.0f, 2.0f, 3.0f, 4.0f}) == juce::Rectangle<int>(1, 2, 3, 4),
            "UiToJuceRect rounds bounds");
    Require(synth_juce::UiToJuceColour(synth::Color::Rgb(10, 20, 30)) == juce::Colour(10, 20, 30),
            "UiToJuceColour maps RGB");
    Require(!synth_juce::HasExplicitBounds(synth::ui::Bounds{}), "zero bounds are not explicit");
    Require(synth_juce::HasExplicitBounds(synth::ui::Bounds{0.0f, 0.0f, 10.0f, 10.0f}),
            "positive bounds are explicit");

    RecordingSurface surface;
    synth::ui::Builder builder;
    builder.Root("root", synth::ui::Bounds{0.0f, 0.0f, 320.0f, 240.0f})
        .Button("start", "Start", synth::ui::Action::Named("start"))
        .ComboBox("device",
                  "Device",
                  {{"a", "Built In"}, {"b", "External"}},
                  "a",
                  synth::ui::Action::Named("device.select"))
        .Draw("scope",
              synth::ui::Bounds{8.0f, 8.0f, 64.0f, 48.0f},
              {synth::ui::DrawCommand::Fill(synth::Color::Rgb(1, 2, 3)),
               synth::ui::DrawCommand::Line({0.0f, 0.0f}, {64.0f, 48.0f}, synth::Color::Rgb(4, 5, 6), 1.0f)});
    surface.tree = builder.Build();

    synth_juce::PortableComponent component(surface);
    component.setSize(320, 240);
    component.RefreshFromSurface();
    Require(surface.dispatchCount == 0, "refresh does not dispatch actions");
    Require(component.FindByNodeId("start") != nullptr, "button control is registered by node id");
    Require(component.FindByNodeId("device") != nullptr, "combo control is registered by node id");
    Require(component.FindByNodeId("missing") == nullptr, "missing node id returns null");

    auto* button = dynamic_cast<juce::TextButton*>(component.FindByNodeId("start"));
    Require(button != nullptr, "start node is a TextButton");
    juce::Component* retainedButtonComponent = button;
    button->onClick();
    Require(surface.dispatchCount == 1, "button click dispatches through surface");
    Require(surface.lastAction.name == "start", "dispatched action name");

    {
        synth::ui::Builder changedBuilder;
        changedBuilder.Root("root", synth::ui::Bounds{0.0f, 0.0f, 320.0f, 240.0f})
            .Button("start", "Launch", synth::ui::Action::Named("start.changed"))
            .ComboBox("device",
                      "Device",
                      {{"a2", "Built In 2"}, {"b2", "External 2"}},
                      "a2",
                      synth::ui::Action::Named("device.select.changed"))
            .Draw("scope",
                  synth::ui::Bounds{8.0f, 8.0f, 64.0f, 48.0f},
                  {synth::ui::DrawCommand::Fill(synth::Color::Rgb(7, 8, 9))});
        surface.tree = changedBuilder.Build();
    }
    component.RefreshFromSurface();
    Require(surface.dispatchCount == 1, "refresh after mutation does not dispatch actions");
    Require(component.FindByNodeId("start") == retainedButtonComponent, "button component is retained by stable id");
    button = dynamic_cast<juce::TextButton*>(component.FindByNodeId("start"));
    Require(button != nullptr, "retained start node is still a TextButton");
    button->onClick();
    Require(surface.dispatchCount == 2, "retained button dispatches after refresh");
    Require(surface.lastAction.name == "start.changed", "retained button dispatches current action");

    auto* combo = dynamic_cast<juce::ComboBox*>(component.FindByNodeId("device"));
    Require(combo != nullptr, "device node is a ComboBox");
    Require(combo->getItemText(1) == juce::String("External 2"), "combo same-count label refreshes");
    combo->setSelectedId(2, juce::dontSendNotification);
    combo->onChange();
    Require(surface.dispatchCount == 3, "combo dispatches current action");
    Require(surface.lastAction.name == "device.select.changed", "combo dispatches refreshed action name");
    Require(surface.lastAction.value == "b2", "combo dispatches refreshed option id");

    {
        RecordingSurface compositeSurface;
        synth::ui::Builder compositeBuilder;
        compositeBuilder.Root("runtime.main.root", synth::ui::Bounds{0.0f, 0.0f, 996.0f, 240.0f})
            .Root("app.root", synth::ui::Bounds{0.0f, 0.0f, 900.0f, 240.0f})
            .Draw("app.draw",
                  synth::ui::Bounds{0.0f, 0.0f, 900.0f, 40.0f},
                  {synth::ui::DrawCommand::Fill(synth::Color::Rgb(1, 2, 3))});
        for (int index = 0; index < 12; ++index)
        {
            compositeBuilder.Button("app.control." + std::to_string(index),
                                    "App",
                                    synth::ui::Action::Named("app.control"));
        }
        compositeBuilder.Root("runtime.sidebar.root", synth::ui::Bounds{900.0f, 0.0f, 96.0f, 240.0f})
            .Draw("runtime.sidebar.draw",
                  synth::ui::Bounds{900.0f, 0.0f, 96.0f, 120.0f},
                  {synth::ui::DrawCommand::Fill(synth::Color::Rgb(4, 5, 6))})
            .Button("runtime.sidebar.control", "Side", synth::ui::Action::Named("runtime.sidebar"));
        compositeSurface.tree = compositeBuilder.Build();
        compositeSurface.tree.nodes.front().children = {
            synth::ui::NodeId("app.root"), synth::ui::NodeId("runtime.sidebar.root")};

        synth_juce::PortableComponent compositeComponent(compositeSurface);
        compositeComponent.setSize(996, 240);
        compositeComponent.RefreshFromSurface();

        const juce::Component* firstAppControl = compositeComponent.FindByNodeId("app.control.0");
        const juce::Component* wrappedAppControl = compositeComponent.FindByNodeId("app.control.11");
        const juce::Component* sidebarControl = compositeComponent.FindByNodeId("runtime.sidebar.control");
        Require(firstAppControl != nullptr && wrappedAppControl != nullptr && sidebarControl != nullptr,
                "composite controls are hosted");
        Require(firstAppControl->getY() == 48,
                "app draw offsets only the trailing controls in its nearest root");
        Require(wrappedAppControl->getX() == firstAppControl->getX() &&
                    wrappedAppControl->getY() > firstAppControl->getY(),
                "unbounded app controls wrap within the nested 900-pixel app root");
        Require(sidebarControl->getX() == 900 + firstAppControl->getX(),
                "unbounded sidebar control flows from the nested sidebar root at x 900");
        Require(sidebarControl->getY() == 128,
                "sibling-root draw filtering uses only the sidebar root's draw bounds");
    }

    {
        RecordingSurface dragSurface;
        synth::ui::Builder dragBuilder;
        dragBuilder.Root("root", synth::ui::Bounds{0.0f, 0.0f, 320.0f, 240.0f})
            .DrawInteractive("encoder",
                             synth::ui::Bounds{16.0f, 24.0f, 80.0f, 80.0f},
                             {},
                             synth::ui::Action::WithValue("encoder.drag", "stale"));
        dragSurface.tree = dragBuilder.Build();

        synth_juce::PortableComponent dragComponent(dragSurface);
        dragComponent.setSize(320, 240);
        dragComponent.RefreshFromSurface();

        auto* overlay = dragComponent.FindByNodeId("encoder");
        Require(overlay != nullptr, "interactive draw overlay is hosted");
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
                                   overlay,
                                   overlay,
                                   juce::Time::getCurrentTime(),
                                   downPoint,
                                   juce::Time::getCurrentTime(),
                                   1,
                                   false);
        overlay->mouseDown(downEvent);
        juce::MouseEvent dragEvent(mouseSource,
                                   dragPoint,
                                   juce::ModifierKeys::leftButtonModifier,
                                   1.0f,
                                   1.0f,
                                   1.0f,
                                   1.0f,
                                   1.0f,
                                   overlay,
                                   overlay,
                                   juce::Time::getCurrentTime(),
                                   downPoint,
                                   juce::Time::getCurrentTime(),
                                   1,
                                   false);
        overlay->mouseDrag(dragEvent);

        Require(dragSurface.dispatchCount == 1, "interactive draw drag dispatches action");
        Require(dragSurface.lastAction.name == "encoder.drag", "interactive draw drag action name");
        Require(dragSurface.lastAction.value == std::to_string(0.05f),
                "interactive draw drag replaces colon-free action value with delta");
    }

    std::cout << "PortableJuceBackendTests passed\n";
    return 0;
}
