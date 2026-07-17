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

juce::Rectangle<int> SurfaceBoundsOf(const juce::Component& surface,
                                     const juce::Component& child)
{
    return surface.getLocalArea(&child, child.getLocalBounds());
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
        RecordingSurface hierarchySurface;
        hierarchySurface.tree.nodes = {
            {.id = synth::ui::NodeId("root"),
             .kind = synth::ui::NodeKind::Root,
             .bounds = {0.0f, 0.0f, 996.0f, 300.0f},
             .children = {synth::ui::NodeId("section"), synth::ui::NodeId("sidebar.root")}},
            {.id = synth::ui::NodeId("section"),
             .kind = synth::ui::NodeKind::Section,
             .bounds = {20.0f, 20.0f, 840.0f, 220.0f},
             .children = {synth::ui::NodeId("row.a"), synth::ui::NodeId("row.b")}},
            {.id = synth::ui::NodeId("row.a"),
             .kind = synth::ui::NodeKind::Row,
             .bounds = {10.0f, 10.0f, 800.0f, 60.0f},
             .children = {synth::ui::NodeId("field.a"),
                          synth::ui::NodeId("flow"),
                          synth::ui::NodeId("draw"),
                          synth::ui::NodeId("paint")}},
            {.id = synth::ui::NodeId("row.b"),
             .kind = synth::ui::NodeKind::Row,
             .bounds = {10.0f, 90.0f, 800.0f, 60.0f},
             .children = {synth::ui::NodeId("field.b")}},
            {.id = synth::ui::NodeId("field.a"),
             .kind = synth::ui::NodeKind::TextField,
             .bounds = {8.0f, 8.0f, 120.0f, 28.0f},
             .label = "A",
             .text = "saved",
             .action = synth::ui::Action::Named("field.a")},
            {.id = synth::ui::NodeId("field.b"),
             .kind = synth::ui::NodeKind::TextField,
             .bounds = {8.0f, 8.0f, 120.0f, 28.0f},
             .label = "B",
             .text = "other",
             .action = synth::ui::Action::Named("field.b")},
            {.id = synth::ui::NodeId("flow"),
             .kind = synth::ui::NodeKind::Button,
             .label = "Flow",
             .action = synth::ui::Action::Named("flow")},
            {.id = synth::ui::NodeId("draw"),
             .kind = synth::ui::NodeKind::Draw,
             .bounds = {300.0f, 8.0f, 80.0f, 40.0f},
             .pointerDragAction = synth::ui::Action::Named("draw.drag"),
             .drawCommands = {synth::ui::DrawCommand::Fill(synth::Color::Rgb(10, 20, 30))}},
            {.id = synth::ui::NodeId("paint"),
             .kind = synth::ui::NodeKind::Draw,
             .bounds = {400.0f, 8.0f, 80.0f, 40.0f},
             .drawCommands = {synth::ui::DrawCommand::Fill(synth::Color::Rgb(30, 20, 10))}},
            {.id = synth::ui::NodeId("sidebar.root"),
             .kind = synth::ui::NodeKind::Root,
             .bounds = {900.0f, 0.0f, 96.0f, 240.0f},
             .children = {synth::ui::NodeId("sidebar.button")}},
            {.id = synth::ui::NodeId("sidebar.button"),
             .kind = synth::ui::NodeKind::Button,
             .bounds = {12.0f, 128.0f, 72.0f, 28.0f},
             .label = "Side",
             .action = synth::ui::Action::Named("sidebar")},
        };

        synth_juce::PortableComponent hierarchyComponent(hierarchySurface);
        hierarchyComponent.setSize(996, 300);
        hierarchyComponent.addToDesktop(0);
        hierarchyComponent.setVisible(true);
        hierarchyComponent.RefreshFromSurface();

        auto* section = hierarchyComponent.FindByNodeId("section");
        auto* rowA = hierarchyComponent.FindByNodeId("row.a");
        auto* rowB = hierarchyComponent.FindByNodeId("row.b");
        auto* fieldA = dynamic_cast<juce::TextEditor*>(hierarchyComponent.FindByNodeId("field.a"));
        auto* fieldB = dynamic_cast<juce::TextEditor*>(hierarchyComponent.FindByNodeId("field.b"));
        auto* flowButton = hierarchyComponent.FindByNodeId("flow");
        auto* draw = hierarchyComponent.FindByNodeId("draw");
        auto* paint = hierarchyComponent.FindByNodeId("paint");
        auto* sidebarButton = hierarchyComponent.FindByNodeId("sidebar.button");
        Require(section != nullptr && rowA != nullptr && rowB != nullptr && fieldA != nullptr
                    && fieldB != nullptr && flowButton != nullptr && draw != nullptr && paint != nullptr
                    && sidebarButton != nullptr,
                "hierarchy fixture nodes are all retained");
        Require(rowA->getParentComponent() == section, "row A is hosted by its semantic section");
        Require(fieldA->getParentComponent() == rowA, "field A is hosted by its semantic row");
        Require(SurfaceBoundsOf(hierarchyComponent, *fieldA).getY()
                    != SurfaceBoundsOf(hierarchyComponent, *fieldB).getY(),
                "parent-local row fields occupy distinct surface rows");
        Require(SurfaceBoundsOf(hierarchyComponent, *sidebarButton).getX() == 912,
                "absolute sidebar offset is applied exactly once");
        Require(SurfaceBoundsOf(hierarchyComponent, *flowButton)
                    == hierarchyComponent.SurfaceBoundsForNode("flow"),
                "root-flow bounds survive translation into the semantic host");
        Require(draw->getParentComponent() == rowA, "draw node is hosted by its semantic row");
        Require(paint->getParentComponent() == rowA, "non-interactive draw node is hosted by its semantic row");

        juce::Component* retainedFieldA = fieldA;
        fieldA->grabKeyboardFocus();
        fieldA->setText("draft", false);
        hierarchyComponent.RefreshFromSurface();
        fieldA = dynamic_cast<juce::TextEditor*>(hierarchyComponent.FindByNodeId("field.a"));
        Require(fieldA == retainedFieldA, "focused text field is retained with the same parent");
        Require(fieldA->hasKeyboardFocus(true), "focused text field keeps focus with the same parent");
        Require(fieldA->getText() == juce::String("draft"), "focused text field keeps its draft with the same parent");

        hierarchySurface.tree.nodes[2].children.erase(hierarchySurface.tree.nodes[2].children.begin());
        hierarchySurface.tree.nodes[3].children.push_back(synth::ui::NodeId("field.a"));
        hierarchyComponent.RefreshFromSurface();
        fieldA = dynamic_cast<juce::TextEditor*>(hierarchyComponent.FindByNodeId("field.a"));
        rowB = hierarchyComponent.FindByNodeId("row.b");
        Require(fieldA == retainedFieldA, "focused text field is retained after moving semantic parents");
        Require(fieldA->getParentComponent() == rowB, "moved text field is hosted by its new semantic row");
        Require(fieldA->hasKeyboardFocus(true), "focused text field keeps focus after moving semantic parents");
        Require(fieldA->getText() == juce::String("draft"), "focused text field keeps its draft after moving semantic parents");
    }

    {
        RecordingSurface scrollSurface;
        scrollSurface.tree.nodes = {
            {.id = synth::ui::NodeId("root"),
             .kind = synth::ui::NodeKind::Root,
             .bounds = {0.0f, 0.0f, 640.0f, 480.0f},
             .children = {synth::ui::NodeId("scroll")}},
            {.id = synth::ui::NodeId("scroll"),
             .kind = synth::ui::NodeKind::ScrollArea,
             .bounds = {20.0f, 30.0f, 180.0f, 90.0f},
             .scrollContentWidth = 420.0f,
             .scrollContentHeight = 360.0f,
             .children = {synth::ui::NodeId("row.a"),
                          synth::ui::NodeId("row.b"),
                          synth::ui::NodeId("final")}},
            {.id = synth::ui::NodeId("row.a"),
             .kind = synth::ui::NodeKind::Row,
             .bounds = {0.0f, 0.0f, 420.0f, 60.0f}},
            {.id = synth::ui::NodeId("row.b"),
             .kind = synth::ui::NodeKind::Row,
             .bounds = {0.0f, 80.0f, 420.0f, 60.0f}},
            {.id = synth::ui::NodeId("final"),
             .kind = synth::ui::NodeKind::Button,
             .bounds = {330.0f, 300.0f, 72.0f, 28.0f},
             .label = "Final",
             .action = synth::ui::Action::Named("final")},
        };

        synth_juce::PortableComponent component(scrollSurface);
        component.setSize(640, 480);
        component.RefreshFromSurface();

        auto* scroll = component.FindByNodeId("scroll");
        auto* rowA = component.FindByNodeId("row.a");
        auto* rowB = component.FindByNodeId("row.b");
        auto* finalButton = component.FindByNodeId("final");
        Require(scroll != nullptr && rowA != nullptr && rowB != nullptr && finalButton != nullptr,
                "scroll fixture nodes are all retained");
        auto* viewport = dynamic_cast<juce::Viewport*>(scroll->getChildComponent(0));
        Require(viewport != nullptr, "scroll area owns a JUCE viewport");
        Require(rowA->getParentComponent() == viewport->getViewedComponent()
                    && rowB->getParentComponent() == viewport->getViewedComponent(),
                "scroll rows are hosted by the viewed content component");
        Require(SurfaceBoundsOf(component, *scroll) == juce::Rectangle<int>(20, 30, 180, 90),
                "viewport keeps declared visible bounds");
        Require(viewport->getViewedComponent()->getWidth() == 420
                    && viewport->getViewedComponent()->getHeight() == 360,
                "scroll content uses declared two-axis extent");
        Require(!SurfaceBoundsOf(component, *viewport).intersects(
                    SurfaceBoundsOf(component, *finalButton)),
                "final button begins outside the visible viewport");
        viewport->setViewPosition(240, 270);
        Require(viewport->getViewPositionX() > 0 && viewport->getViewPositionY() > 0,
                "viewport scrolls on both axes");
        Require(SurfaceBoundsOf(component, *viewport).intersects(
                    SurfaceBoundsOf(component, *finalButton)),
                "final button is reachable after scrolling");

        const int retainedViewX = viewport->getViewPositionX();
        const int retainedViewY = viewport->getViewPositionY();
        component.RefreshFromSurface();
        Require(viewport->getViewPositionX() == retainedViewX
                    && viewport->getViewPositionY() == retainedViewY,
                "viewport position survives refresh for a stable scroll node");
        Require(SurfaceBoundsOf(component, *viewport).intersects(
                    SurfaceBoundsOf(component, *finalButton)),
                "scrolled descendant remains reachable after refresh");

        scrollSurface.tree.nodes[1].scrollContentWidth = 180.0f;
        scrollSurface.tree.nodes[1].scrollContentHeight = 90.0f;
        component.RefreshFromSurface();
        Require(viewport->getViewPositionX() == 0 && viewport->getViewPositionY() == 0,
                "viewport position is clamped when content shrinks");
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
