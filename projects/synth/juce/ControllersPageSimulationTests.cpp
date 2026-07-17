#include "ControllersPageHarness.hpp"
#include "PortableJuceBackend.hpp"

#include "synth/ControllersPageUI.hpp"

#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

void Require(bool condition, const std::string& label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth::ui::Node* FindNode(const synth::ui::NodeTree& tree, const synth::ui::NodeId& id)
{
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.id == id)
        {
            return &node;
        }
    }
    return nullptr;
}

std::unordered_map<std::string, std::string> BuildParentMap(const synth::ui::NodeTree& tree)
{
    std::unordered_map<std::string, std::string> parents;
    for (const synth::ui::Node& node : tree.nodes)
    {
        for (const synth::ui::NodeId& child : node.children)
        {
            parents[child.value] = node.id.value;
        }
    }
    return parents;
}

bool IsRenderedNode(const synth::ui::Node& node)
{
    return node.kind != synth::ui::NodeKind::Root && node.kind != synth::ui::NodeKind::ScrollArea;
}

bool IsDeferredCommitAction(const synth::ui::Action& action)
{
    return action.name == synth::runtime_ui::Actions::kAddSingle ||
           action.name == synth::runtime_ui::Actions::kAddBlock ||
           action.name == synth::runtime_ui::Actions::kDeleteRow ||
           action.name == synth::runtime_ui::Actions::kEndpointSelect ||
           action.name == synth::runtime_ui::Actions::kVariantSelect ||
           action.name == synth::runtime_ui::Actions::kMappingFieldCommit ||
           action.name == synth::runtime_ui::Actions::kAddController;
}

std::string Describe(const synth::ui::Action& action)
{
    return action.name + "(" + action.value + ")";
}

void VerifyTreeAndRenderer(const synth::ui::NodeTree& tree,
                           synth_juce::PortableComponent& renderer,
                           const synth_runtime::test::ControllersHarnessFixture& fixture,
                           int step,
                           const std::string& actionDescription)
{
    for (std::size_t ix = 0; ix < fixture.state.instrument.controllers.size(); ++ix)
    {
        Require(FindNode(tree, synth::ui::NodeId(synth::runtime_ui::NodeIds::ControllerRow(ix))) != nullptr,
                "step " + std::to_string(step) + " missing controller row " + std::to_string(ix) + " after " +
                    actionDescription);
        Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(ix)) != nullptr,
                "step " + std::to_string(step) + " missing rendered controller row " + std::to_string(ix) +
                    " after " + actionDescription);
    }

    Require(FindNode(tree, synth::runtime_ui::NodeIds::kAddRow) != nullptr,
            "step " + std::to_string(step) + " missing add row after " + actionDescription);
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddButton) != nullptr,
            "step " + std::to_string(step) + " missing add button after " + actionDescription);

    const auto parents = BuildParentMap(tree);
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (!IsRenderedNode(node))
        {
            continue;
        }

        juce::Component* component = renderer.FindByNodeId(node.id.value);
        Require(component != nullptr,
                "step " + std::to_string(step) + " missing component " + node.id.value + " after " +
                    actionDescription);

        if (node.kind == synth::ui::NodeKind::ComboBox)
        {
            auto* combo = dynamic_cast<juce::ComboBox*>(component);
            Require(combo != nullptr,
                    "step " + std::to_string(step) + " combo node not rendered as ComboBox " + node.id.value);
            Require(combo->getNumItems() == static_cast<int>(node.options.size()),
                    "step " + std::to_string(step) + " combo item count mismatch " + node.id.value);
        }

        const auto parentIt = parents.find(node.id.value);
        if (parentIt == parents.end())
        {
            continue;
        }
        const synth::ui::Node* parentNode = FindNode(tree, synth::ui::NodeId(parentIt->second));
        if (parentNode == nullptr ||
            (parentNode->kind != synth::ui::NodeKind::Row && parentNode->kind != synth::ui::NodeKind::Section))
        {
            continue;
        }
        juce::Component* parentComponent = renderer.FindByNodeId(parentNode->id.value);
        Require(parentComponent != nullptr,
                "step " + std::to_string(step) + " missing parent component " + parentNode->id.value);
        Require(component->getParentComponent() == parentComponent,
                "step " + std::to_string(step) + " wrong parent for " + node.id.value);
        const juce::Rectangle<int> bounds =
            renderer.getLocalArea(component, component->getLocalBounds());
        const juce::Rectangle<int> parentBounds =
            renderer.getLocalArea(parentComponent, parentComponent->getLocalBounds());
        Require(parentBounds.contains(bounds),
                "step " + std::to_string(step) + " clipped child " + node.id.value + " after " +
                    actionDescription);
    }
}

std::vector<synth::ui::Action> CollectActions(const synth::ui::NodeTree& tree, int controllerNameSuffix)
{
    std::vector<synth::ui::Action> actions;
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (!node.action.has_value())
        {
            continue;
        }

        const synth::ui::Action& action = *node.action;
        if (node.kind == synth::ui::NodeKind::Button || node.kind == synth::ui::NodeKind::Toggle)
        {
            actions.push_back(action);
            continue;
        }

        if (node.kind != synth::ui::NodeKind::ComboBox || node.options.empty())
        {
            continue;
        }

        for (const synth::ui::ControlOption& option : node.options)
        {
            if (option.id == node.selectedOption)
            {
                continue;
            }
            synth::ui::Action dispatched = action;
            if (action.name == synth::runtime_ui::Actions::kEndpointSelect ||
                action.name == synth::runtime_ui::Actions::kVariantSelect ||
                action.name == synth::runtime_ui::Actions::kMappingFieldCommit)
            {
                dispatched.value = action.value + ":" + option.id;
            }
            else
            {
                dispatched.value = option.id;
            }
            actions.push_back(std::move(dispatched));
            break;
        }
    }

    actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kAddController,
                                                   "sim" + std::to_string(controllerNameSuffix) + ":generic"));
    return actions;
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    constexpr std::uint32_t kSeed = 0x5EAF2026;
    std::mt19937 rng(kSeed);

    synth_runtime::test::ControllersHarnessFixture fixture;
    synth::runtime_ui::ControllersPageSurface surface = fixture.MakeSurface();
    surface.SetEnumerateDevices(fixture.state.devices);
    surface.SetContentBounds({0.0f, 0.0f, 980.0f, 720.0f});
    surface.MarkDirty();
    surface.RefreshOnTick();

    synth_juce::PortableComponent renderer(surface);
    renderer.setSize(980, 720);
    renderer.RefreshFromSurface();

    int controllerNameSuffix = 0;
    std::string lastAction = "initial";
    for (int step = 0; step < 250; ++step)
    {
        synth::ui::NodeTree tree = surface.BuildTree();
        std::vector<synth::ui::Action> actions = CollectActions(tree, controllerNameSuffix);
        Require(!actions.empty(), "simulation action set empty");

        std::uniform_int_distribution<std::size_t> pick(0, actions.size() - 1);
        synth::ui::Action action = actions[pick(rng)];
        if (action.name == synth::runtime_ui::Actions::kAddController)
        {
            ++controllerNameSuffix;
        }

        lastAction = Describe(action);
        surface.DispatchAction(action);
        if (IsDeferredCommitAction(action))
        {
            surface.RefreshOnTick();
        }
        renderer.RefreshFromSurface();
        renderer.setSize(980, 720);
        VerifyTreeAndRenderer(surface.BuildTree(), renderer, fixture, step, lastAction);
    }

    std::cout << "ControllersPageSimulationTests passed seed=0x" << std::hex << kSeed << "\n";
    return 0;
}
