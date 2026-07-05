#include "ControllersPageJuce.hpp"
#include "ControllersPageHarness.hpp"

#include "synth/ControllersPageUI.hpp"

#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    synth_runtime::test::ControllersHarnessFixture fixture;
    synth::runtime_ui::ControllersPageSurface surface = fixture.MakeSurface();
    surface.SetEnumerateDevices(fixture.state.devices);
    surface.SetContentBounds({0.0f, 0.0f, 900.0f, 700.0f});
    surface.MarkDirty();
    surface.RefreshOnTick();

    synth_runtime::ControllersTreeRenderer renderer(surface);
    renderer.setSize(900, 700);
    renderer.RefreshFromSurface();

    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kBack) != nullptr, "controllers back renders");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddButton) != nullptr, "controllers add renders");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerInput(0)) != nullptr,
            "controllers endpoint combo renders");

    auto* secondRow = renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(1));
    auto* secondName = renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerName(1));
    auto* addRow = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddRow);
    auto* addButton = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddButton);
    Require(secondRow != nullptr, "controllers second row renders");
    Require(secondName != nullptr, "controllers second name renders");
    Require(secondName->getParentComponent() == secondRow, "controllers second name belongs to second row");
    Require(synth_runtime::test::ComponentInsideParent(*secondName, *secondRow),
            "controllers second row children are visible inside row");
    Require(addRow != nullptr, "controllers add row renders");
    Require(addButton != nullptr, "controllers add button renders");
    Require(addButton->getParentComponent() == addRow, "controllers add button belongs to add row");
    Require(synth_runtime::test::ComponentInsideParent(*addButton, *addRow),
            "controllers add row children are visible inside row");

    auto* addName = dynamic_cast<juce::TextEditor*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddName));
    Require(addName != nullptr, "controllers add-name editor renders");
    addName->setText("draft controller", juce::dontSendNotification);
    renderer.RefreshFromSurface();
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddName) == addName,
            "controllers no-op refresh preserves editor component");
    Require(addName->getText().toStdString() == "draft controller",
            "controllers no-op refresh preserves editor draft");

    surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleConfig, "0"));
    renderer.RefreshFromSurface();
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::SectionToggle(0, synth::MidiConfigSection::Encoders)) !=
                nullptr,
            "controllers disclosure action expands sections immediately");

    addName = dynamic_cast<juce::TextEditor*>(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddName));
    Require(addName != nullptr, "controllers add-name editor still renders after disclosure");
    addName->setText("extra", juce::dontSendNotification);
    const std::size_t controllerCountBefore = fixture.state.instrument.controllers.size();
    surface.SetFocusGuard([] { return true; });
    surface.SetAddControllerDraft(addName->getText().toStdString(), "generic");
    surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kAddController));
    renderer.RefreshFromSurface();
    Require(fixture.state.instrument.controllers.size() == controllerCountBefore + 1,
            "controllers add action commits immediately");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(controllerCountBefore)) != nullptr,
            "controllers add action renders new controller immediately");

    surface.SetContentBounds({0.0f, 0.0f, 900.0f, 260.0f});
    surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleSection,
                                                        "0:system_messages"));
    renderer.setSize(900, 260);
    renderer.RefreshFromSurface();

    const synth::ui::NodeTree smallTree = surface.BuildTree();
    const synth::ui::Node* scrollNode = nullptr;
    for (const synth::ui::Node& node : smallTree.nodes)
    {
        if (node.id.value == synth::runtime_ui::NodeIds::kScroll)
        {
            scrollNode = &node;
            break;
        }
    }
    Require(scrollNode != nullptr, "controllers scroll node still exists in small viewport");
    Require(scrollNode->scrollContentHeight > scrollNode->bounds.height,
            "controllers scroll node reports separate content extent");

    const auto rows = surface.ViewModel().SectionRows(0, synth::MidiConfigSection::SystemMessages);
    std::vector<juce::Component*> renderedRows;
    for (std::size_t ix = 0; ix < rows.size(); ++ix)
    {
        if (juce::Component* row =
                renderer.FindByNodeId(synth::runtime_ui::NodeIds::MappingRow(0, synth::MidiConfigSection::SystemMessages, ix)))
        {
            renderedRows.push_back(row);
        }
    }
    Require(!renderedRows.empty(), "controllers system message rows render in JUCE");
    int maxBottom = 0;
    for (juce::Component* row : renderedRows)
    {
        maxBottom = std::max(maxBottom, row->getBottom());
    }
    Require(maxBottom <= static_cast<int>(scrollNode->scrollContentHeight),
            "controllers final rendered row is inside scroll content extent");

    std::cout << "ControllersPageJuceTests passed\n";
    return 0;
}
