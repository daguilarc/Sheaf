#include "RuntimePagesJuce.hpp"

#include "synth/RuntimePages.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <system_error>
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
    return node.kind != synth::ui::NodeKind::Root && node.kind != synth::ui::NodeKind::Draw &&
           node.bounds.width > 0.0f && node.bounds.height > 0.0f;
}

bool BoundsContain(const synth::ui::Bounds& outer, const synth::ui::Bounds& inner)
{
    constexpr float kEpsilon = 0.75f;
    return inner.x + kEpsilon >= outer.x && inner.y + kEpsilon >= outer.y &&
           inner.x + inner.width <= outer.x + outer.width + kEpsilon &&
           inner.y + inner.height <= outer.y + outer.height + kEpsilon;
}

bool PathIsSameOrChild(const std::filesystem::path& root, const std::filesystem::path& target)
{
    std::error_code ec;
    std::filesystem::path normalizedRoot = std::filesystem::weakly_canonical(root, ec);
    if (ec)
    {
        ec.clear();
        normalizedRoot = std::filesystem::absolute(root, ec);
    }
    if (ec)
    {
        normalizedRoot = root;
    }

    ec.clear();
    std::filesystem::path normalizedTarget = std::filesystem::weakly_canonical(target, ec);
    if (ec)
    {
        ec.clear();
        normalizedTarget = std::filesystem::absolute(target, ec);
    }
    if (ec)
    {
        normalizedTarget = target;
    }

    normalizedRoot = normalizedRoot.lexically_normal();
    normalizedTarget = normalizedTarget.lexically_normal();
    auto rootIt = normalizedRoot.begin();
    auto targetIt = normalizedTarget.begin();
    for (; rootIt != normalizedRoot.end(); ++rootIt, ++targetIt)
    {
        if (targetIt == normalizedTarget.end() || *rootIt != *targetIt)
        {
            return false;
        }
    }
    return true;
}

bool ComponentIsExpectedBroadKind(const synth::ui::Node& node, const juce::Component& component)
{
    switch (node.kind)
    {
        case synth::ui::NodeKind::Row:
        case synth::ui::NodeKind::Section:
        case synth::ui::NodeKind::ScrollArea:
            return dynamic_cast<const juce::TextButton*>(&component) == nullptr &&
                   dynamic_cast<const juce::Label*>(&component) == nullptr &&
                   dynamic_cast<const juce::TextEditor*>(&component) == nullptr;
        case synth::ui::NodeKind::Label:
        case synth::ui::NodeKind::StatusText:
            return dynamic_cast<const juce::Label*>(&component) != nullptr;
        case synth::ui::NodeKind::Button:
            return dynamic_cast<const juce::TextButton*>(&component) != nullptr;
        case synth::ui::NodeKind::Toggle:
            return dynamic_cast<const juce::ToggleButton*>(&component) != nullptr;
        case synth::ui::NodeKind::Slider:
            return dynamic_cast<const juce::Slider*>(&component) != nullptr;
        case synth::ui::NodeKind::ComboBox:
            return dynamic_cast<const juce::ComboBox*>(&component) != nullptr;
        case synth::ui::NodeKind::TextField:
            return dynamic_cast<const juce::TextEditor*>(&component) != nullptr;
        default:
            return false;
    }
}

std::string Describe(const synth::ui::Action& action)
{
    return action.name + "(" + action.value + ")";
}

void VerifyDispatchedPathsStayUnderRoot(const std::vector<synth::ui::Action>& dispatched,
                                        std::size_t begin,
                                        const std::filesystem::path& root,
                                        int step,
                                        const std::string& actionDescription)
{
    for (std::size_t ix = begin; ix < dispatched.size(); ++ix)
    {
        const synth::ui::Action& action = dispatched[ix];
        if (action.name != synth::runtime_ui::Actions::kFileConfirmedSaveAs &&
            action.name != synth::runtime_ui::Actions::kFileConfirmedOverwriteSaveAs &&
            action.name != synth::runtime_ui::Actions::kFileConfirmedLoad)
        {
            continue;
        }

        Require(!action.value.empty(),
                "step " + std::to_string(step) + " confirmed file action has empty path after " +
                    actionDescription);
        Require(PathIsSameOrChild(root, std::filesystem::path(action.value)),
                "step " + std::to_string(step) + " dispatched path escapes root after " + actionDescription);
    }
}

void VerifyTreeAndRenderer(synth::runtime_ui::FilePageSurface& surface,
                           synth_juce::PortableComponent& renderer,
                           int step,
                           const std::string& actionDescription)
{
    const synth::ui::NodeTree tree = surface.BuildTree();
    int rootCount = 0;
    for (const synth::ui::Node& node : tree.nodes)
    {
        if (node.kind == synth::ui::NodeKind::Root)
        {
            ++rootCount;
        }
    }
    Require(rootCount == 1, "step " + std::to_string(step) + " file page tree has exactly one root after " +
                                actionDescription);

    const synth::ui::Node* root = FindNode(tree, synth::runtime_ui::NodeIds::kFileRoot);
    Require(root != nullptr, "step " + std::to_string(step) + " missing file root after " + actionDescription);
    if (surface.Snapshot().browserOpen)
    {
        Require(FindNode(tree, synth::runtime_ui::NodeIds::kFileBrowser) != nullptr,
                "step " + std::to_string(step) + " browser missing while open after " + actionDescription);
        for (const auto& entry : surface.Snapshot().browserEntries)
        {
            Require(entry.relativePath.find("..") == std::string::npos,
                    "step " + std::to_string(step) + " browser entry escapes root after " + actionDescription);
        }
    }

    renderer.RefreshFromSurface();
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
        Require(ComponentIsExpectedBroadKind(node, *component),
                "step " + std::to_string(step) + " component broad kind mismatch for " + node.id.value);
        Require(renderer.getLocalBounds().contains(component->getBounds()),
                "step " + std::to_string(step) + " component escapes root " + node.id.value + " after " +
                    actionDescription);
        Require(BoundsContain(root->bounds, node.bounds),
                "step " + std::to_string(step) + " semantic node escapes root " + node.id.value + " after " +
                    actionDescription);

        const auto parentIt = parents.find(node.id.value);
        if (parentIt == parents.end())
        {
            continue;
        }
        const synth::ui::Node* parentNode = FindNode(tree, synth::ui::NodeId(parentIt->second));
        if (parentNode == nullptr || parentNode->kind == synth::ui::NodeKind::Root ||
            parentNode->kind == synth::ui::NodeKind::Draw || !IsRenderedNode(*parentNode))
        {
            continue;
        }
        juce::Component* parentComponent = renderer.FindByNodeId(parentNode->id.value);
        Require(parentComponent != nullptr,
                "step " + std::to_string(step) + " missing parent component " + parentNode->id.value);
        Require(parentComponent->getBounds().contains(component->getBounds()),
                "step " + std::to_string(step) + " component escapes semantic parent " + node.id.value +
                    " after " + actionDescription);
        Require(BoundsContain(parentNode->bounds, node.bounds),
                "step " + std::to_string(step) + " semantic child escapes parent " + node.id.value + " after " +
                    actionDescription);
    }
}

void SetSize(synth::runtime_ui::FilePageSurface& surface,
             synth_juce::PortableComponent& renderer,
             int width,
             int height)
{
    surface.SetContentBounds({0.0f, 0.0f, static_cast<float>(width), static_cast<float>(height)});
    renderer.setSize(width, height);
}

void PreparePatchRoot(const std::filesystem::path& root)
{
    std::filesystem::remove_all(root);
    std::filesystem::create_directories(root / "Alpha");
    std::filesystem::create_directories(root / "Beta" / "Nested");
    std::filesystem::create_directories(root / "ExistingPatch");
    std::ofstream(root / "ExistingFile").put('x');
}

bool EntriesMatch(const synth::runtime_ui::FilePageSnapshot& lhs,
                  const synth::runtime_ui::FilePageSnapshot& rhs)
{
    if (lhs.browserEntries.size() != rhs.browserEntries.size())
    {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.browserEntries.size(); ++ix)
    {
        if (lhs.browserEntries[ix].name != rhs.browserEntries[ix].name ||
            lhs.browserEntries[ix].relativePath != rhs.browserEntries[ix].relativePath)
        {
            return false;
        }
    }
    return true;
}

void VerifySpecificBrowserRules(const std::filesystem::path& root)
{
    std::vector<synth::ui::Action> dispatched;
    auto attachHandler = [&dispatched](synth::runtime_ui::FilePageSurface& surface) {
        surface.SetActionHandler([&dispatched](const synth::ui::Action& action) {
            dispatched.push_back(action);
        });
    };

    {
        synth::runtime_ui::FilePageSurface firstSaveSurface;
        firstSaveSurface.Snapshot().patchesRoot = root.string();
        firstSaveSurface.Snapshot().hasCurrentPatch = false;
        firstSaveSurface.Snapshot().patchNameText = "(no patch)";
        attachHandler(firstSaveSurface);
        firstSaveSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSave));
        const synth::runtime_ui::FilePageSnapshot firstSave = firstSaveSurface.Snapshot();
        Require(dispatched.empty(), "first Save without current patch does not dispatch");
        Require(firstSave.browserOpen && firstSave.browserKind == synth::runtime_ui::FileBrowserKind::SaveAs,
                "first Save without current patch opens Save As");

        synth::runtime_ui::FilePageSurface saveAsSurface;
        saveAsSurface.Snapshot().patchesRoot = root.string();
        attachHandler(saveAsSurface);
        saveAsSurface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
        const synth::runtime_ui::FilePageSnapshot explicitSaveAs = saveAsSurface.Snapshot();
        Require(explicitSaveAs.browserOpen && explicitSaveAs.browserKind == synth::runtime_ui::FileBrowserKind::SaveAs,
                "explicit Save As opens Save As");
        Require(firstSave.browserCurrentPathText == explicitSaveAs.browserCurrentPathText &&
                    firstSave.statusText == explicitSaveAs.statusText && EntriesMatch(firstSave, explicitSaveAs),
                "first Save opens the same Save As state machine as explicit Save As");
    }

    auto requireNoCallbackAfterConfirm = [&](const std::string& name, const std::string& expectedStatus) {
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = root.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
        surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, name));
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
        Require(dispatched.empty(), "Save As target '" + name + "' does not dispatch");
        Require(surface.Snapshot().browserOpen, "Save As target '" + name + "' remains open");
        Require(surface.Snapshot().statusText.find(expectedStatus) != std::string::npos,
                "Save As target '" + name + "' reports " + expectedStatus);
    };
    requireNoCallbackAfterConfirm("", "valid");
    requireNoCallbackAfterConfirm("/tmp/Escape", "valid");
    requireNoCallbackAfterConfirm("../Escape", "valid");
    requireNoCallbackAfterConfirm("Alpha", "exists");
    requireNoCallbackAfterConfirm("ExistingFile", "exists");

    {
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = root.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
        surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName,
                                                            "FreshDeterministic"));
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
        Require(dispatched.size() == 1 &&
                    dispatched.back().name == synth::runtime_ui::Actions::kFileConfirmedSaveAs,
                "fresh Save As dispatches exactly one confirmed callback");
        Require(PathIsSameOrChild(root, std::filesystem::path(dispatched.back().value)),
                "fresh Save As callback path remains under root");
        Require(!surface.Snapshot().browserOpen, "fresh Save As closes browser");
    }

    {
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = root.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
        surface.DispatchAction(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSelect, "0"));
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
        Require(dispatched.size() == 1 && dispatched.back().name == synth::runtime_ui::Actions::kFileConfirmedLoad,
                "selected Load dispatches exactly one confirmed callback");
        Require(PathIsSameOrChild(root, std::filesystem::path(dispatched.back().value)),
                "selected Load callback path remains under root");
        Require(!surface.Snapshot().browserOpen, "selected Load closes browser");
    }

    {
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = root.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserCancel));
        Require(dispatched.empty(), "cancel does not dispatch callbacks");
        Require(!surface.Snapshot().browserOpen, "cancel closes browser");
    }

    {
        const std::filesystem::path emptyRoot = root / "EmptyRoot";
        std::filesystem::remove_all(emptyRoot);
        std::filesystem::create_directories(emptyRoot);
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = emptyRoot.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
        Require(dispatched.empty(), "missing load selection does not dispatch callbacks");
        Require(surface.Snapshot().browserOpen, "missing load selection keeps browser open");
        Require(surface.Snapshot().statusText.find("Select") != std::string::npos,
                "missing load selection shows selection error");
    }

    {
        const std::filesystem::path missingRoot = root / "MissingRoot";
        std::filesystem::remove_all(missingRoot);
        synth::runtime_ui::FilePageSurface surface;
        surface.Snapshot().patchesRoot = missingRoot.string();
        dispatched.clear();
        attachHandler(surface);
        surface.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));
        Require(dispatched.empty(), "missing patch root does not dispatch callbacks");
        Require(surface.Snapshot().browserOpen, "missing patch root leaves browser open with error");
        Require(surface.Snapshot().statusText.find("Could not read patch root") != std::string::npos,
                "missing patch root shows read error");
    }
}

std::vector<synth::ui::Action> CollectActions(const synth::runtime_ui::FilePageSurface& surface, int step)
{
    std::vector<synth::ui::Action> actions;
    actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSave));
    actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileSaveAs));
    actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileLoad));

    if (surface.Snapshot().browserOpen)
    {
        actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserCancel));
        actions.push_back(synth::ui::Action::Named(synth::runtime_ui::Actions::kFileBrowserConfirm));
        actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName,
                                                       "Fresh" + std::to_string(step)));
        actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName, "Alpha"));
        actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSaveName,
                                                       "../Outside"));
        for (std::size_t ix = 0; ix < surface.Snapshot().browserEntries.size(); ++ix)
        {
            actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserSelect,
                                                           std::to_string(ix)));
            actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserAccept,
                                                           std::to_string(ix)));
            actions.push_back(synth::ui::Action::WithValue(synth::runtime_ui::Actions::kFileBrowserOverwriteSaveAs,
                                                           std::to_string(ix)));
        }
    }
    return actions;
}

}  // namespace

int main()
{
    juce::ScopedJuceInitialiser_GUI juce;

    constexpr std::uint32_t kSeed = 0xF11E2026;
    std::mt19937 rng(kSeed);

    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf_file_page_simulation_test";
    PreparePatchRoot(root);

    VerifySpecificBrowserRules(root);

    synth::runtime_ui::FilePageSurface surface;
    surface.Snapshot().patchesRoot = root.string();
    surface.Snapshot().hasCurrentPatch = false;
    surface.Snapshot().patchNameText = "(no patch)";
    surface.SetContentBounds({0.0f, 0.0f, 760.0f, 420.0f});

    std::vector<synth::ui::Action> dispatched;
    surface.SetActionHandler([&dispatched](const synth::ui::Action& action) {
        dispatched.push_back(action);
    });

    synth_juce::PortableComponent renderer(surface);
    SetSize(surface, renderer, 760, 420);
    VerifyTreeAndRenderer(surface, renderer, -1, "initial");

    std::string lastAction = "initial";
    for (int step = 0; step < 220; ++step)
    {
        std::vector<synth::ui::Action> actions = CollectActions(surface, step);
        Require(!actions.empty(), "simulation action set empty");

        std::uniform_int_distribution<std::size_t> pick(0, actions.size() - 1);
        const synth::ui::Action action = actions[pick(rng)];
        const std::size_t beforeDispatch = dispatched.size();
        lastAction = Describe(action);
        surface.DispatchAction(action);
        VerifyDispatchedPathsStayUnderRoot(dispatched, beforeDispatch, root, step, lastAction);

        if (step % 7 == 0)
        {
            SetSize(surface, renderer, 360, 360);
        }
        else
        {
            SetSize(surface, renderer, 760, 420);
        }
        VerifyTreeAndRenderer(surface, renderer, step, lastAction);
    }

    std::filesystem::remove_all(root);
    std::cout << "FilePageSimulationTests passed seed=0x" << std::hex << kSeed << "\n";
    return 0;
}
