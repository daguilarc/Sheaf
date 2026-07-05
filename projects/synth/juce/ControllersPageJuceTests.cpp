#include "ControllersPageJuce.hpp"
#include "ControllersPageHarness.hpp"

#include "synth/ControllersPageUI.hpp"

#include <iostream>
#include <stdexcept>

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

    std::cout << "ControllersPageJuceTests passed\n";
    return 0;
}
