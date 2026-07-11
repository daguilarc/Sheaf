#pragma once

#include "synth/AppConcepts.hpp"
#include "synth/ControllersPageUI.hpp"
#include "synth/MidiConfigViewModel.hpp"
#include "synth/RuntimePagePolicy.hpp"
#include "synth/RuntimePages.hpp"

#include <concepts>
#include <functional>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace synth::runtime_ui {

enum class RuntimeMainPage
{
    Application,
    Audio,
    Controllers,
    File,
};

template <typename Services>
concept RuntimeMainServices = requires(Services& services,
                                       AudioPageSnapshot& audio,
                                       FilePageSnapshot& file,
                                       ControllersPageSurface& controllers,
                                       const ui::Action& action,
                                       std::function<void()> onBack) {
    { services.MakeControllersCallbacks(std::move(onBack)) } ->
        std::same_as<ControllersPageCallbacks>;
    { services.RefreshAudio(audio) } -> std::same_as<void>;
    { services.DispatchAudio(action) } -> std::same_as<void>;
    { services.RefreshFile(file) } -> std::same_as<void>;
    { services.DispatchFile(action) } -> std::same_as<void>;
    { services.RefreshControllers(controllers) } -> std::same_as<void>;
    { services.DeadlineSamplePercent() } -> std::convertible_to<float>;
    { services.SaveRuntimeConfiguration() } -> std::same_as<void>;
};

template <SynthApplication App, RuntimeMainServices Services>
class RuntimeMainComponent final : public ui::Surface
{
public:
    RuntimeMainComponent(App& app, Services& services)
        : app_(app),
          services_(services),
          controllersSurface_(services_.MakeControllersCallbacks([this] {
              ReturnToApplication(RuntimePageKind::Controllers);
          }))
    {
        const RuntimeConfig config = App::Config();
        const ui::Bounds contentBounds{
            0.0f, 0.0f, static_cast<float>(config.uiWidth), static_cast<float>(config.uiHeight)};
        audioSurface_.SetContentBounds(contentBounds);
        fileSurface_.SetContentBounds(contentBounds);
        controllersSurface_.SetContentBounds(contentBounds);

        sidebarSurface_.SetActionHandler([this](const ui::Action& action) {
            HandleSidebarAction(action);
        });
        audioSurface_.SetActionHandler([this](const ui::Action& action) {
            if (action.name == Actions::kAudioBack)
            {
                ReturnToApplication(RuntimePageKind::Audio);
                return;
            }
            services_.DispatchAudio(action);
        });
        fileSurface_.SetActionHandler([this](const ui::Action& action) {
            if (action.name == Actions::kFileBack)
            {
                ReturnToApplication(RuntimePageKind::File);
                return;
            }
            services_.DispatchFile(action);
        });
    }

    RuntimeMainComponent(const RuntimeMainComponent&) = delete;
    RuntimeMainComponent& operator=(const RuntimeMainComponent&) = delete;
    RuntimeMainComponent(RuntimeMainComponent&&) = delete;
    RuntimeMainComponent& operator=(RuntimeMainComponent&&) = delete;

    ui::NodeTree BuildTree() override
    {
        ui::NodeTree appTree = app_.PortableSurface().BuildTree();
        const std::size_t appRootIndex = ValidateApplicationTree(appTree);
        ui::NodeTree contentTree = currentPage_ == RuntimeMainPage::Application
                                       ? MoveRootFirst(std::move(appTree), appRootIndex)
                                       : BuildRuntimePageTree();
        ui::NodeTree sidebarTree = sidebarSurface_.BuildTree();
        const float sidebarOffset = static_cast<float>(App::Config().uiWidth);
        for (ui::Node& node : sidebarTree.nodes)
        {
            node.bounds.x += sidebarOffset;
        }

        ui::Node root;
        root.id = "runtime.main.root";
        root.kind = ui::NodeKind::Root;
        root.bounds = IntrinsicBounds();
        root.children = {contentTree.nodes.front().id, sidebarTree.nodes.front().id};

        ui::NodeTree result;
        result.nodes.reserve(1 + contentTree.nodes.size() + sidebarTree.nodes.size());
        result.nodes.push_back(std::move(root));
        for (ui::Node& node : contentTree.nodes)
        {
            result.nodes.push_back(std::move(node));
        }
        for (ui::Node& node : sidebarTree.nodes)
        {
            result.nodes.push_back(std::move(node));
        }
        return result;
    }

    void SetActionHandler(ActionHandler handler) override
    {
        actionHandler_ = std::move(handler);
    }

    void DispatchAction(const ui::Action& action) override
    {
        if (IsSidebarAction(action.name))
        {
            sidebarSurface_.DispatchAction(action);
        }
        else if (IsAudioAction(action.name))
        {
            audioSurface_.DispatchAction(action);
        }
        else if (IsFileAction(action.name))
        {
            fileSurface_.DispatchAction(action);
        }
        else if (IsControllersAction(action.name))
        {
            controllersSurface_.DispatchAction(action);
        }
        else if (!std::string_view(action.name).starts_with("runtime."))
        {
            app_.PortableSurface().DispatchAction(action);
        }

        if (actionHandler_)
        {
            actionHandler_(action);
        }
    }

    void Refresh()
    {
        deadlineMaximum_.Write(static_cast<float>(services_.DeadlineSamplePercent()));
        sidebarSurface_.SetDeadlinePercent(deadlineMaximum_.Max());
        services_.RefreshAudio(audioSurface_.Snapshot());
        services_.RefreshFile(fileSurface_.Snapshot());
        services_.RefreshControllers(controllersSurface_);
    }

    void ShowPage(RuntimeMainPage page)
    {
        currentPage_ = page;
    }

    RuntimeMainPage CurrentPage() const
    {
        return currentPage_;
    }

    ui::Bounds IntrinsicBounds() const
    {
        const RuntimeConfig config = App::Config();
        return {0.0f,
                0.0f,
                static_cast<float>(config.uiWidth) + Layout::kSidebarWidth,
                static_cast<float>(config.uiHeight)};
    }

private:
    static bool IsOneOf(std::string_view action,
                        std::initializer_list<std::string_view> candidates)
    {
        for (const std::string_view candidate : candidates)
        {
            if (action == candidate)
            {
                return true;
            }
        }
        return false;
    }

    static bool IsSidebarAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kSidebarAudio,
                        Actions::kSidebarControllers,
                        Actions::kSidebarFile});
    }

    static bool IsAudioAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kAudioBack,
                        Actions::kAudioOutputSelect,
                        Actions::kAudioInputSelect});
    }

    static bool IsFileAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kFileBack,
                        Actions::kFileNew,
                        Actions::kFileSave,
                        Actions::kFileSaveAs,
                        Actions::kFileLoad,
                        Actions::kFileRevert,
                        Actions::kFileBrowserSaveName,
                        Actions::kFileBrowserSelect,
                        Actions::kFileBrowserAccept,
                        Actions::kFileBrowserOpen,
                        Actions::kFileBrowserParent,
                        Actions::kFileBrowserOverwriteSaveAs,
                        Actions::kFileBrowserConfirm,
                        Actions::kFileBrowserCancel,
                        Actions::kFileConfirmedSaveAs,
                        Actions::kFileConfirmedOverwriteSaveAs,
                        Actions::kFileConfirmedLoad});
    }

    static bool IsControllersAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kBack,
                        Actions::kToggleConfig,
                        Actions::kToggleSection,
                        Actions::kEndpointSelect,
                        Actions::kVariantSelect,
                        Actions::kMappingFieldCommit,
                        Actions::kDeleteRow,
                        Actions::kAddSingle,
                        Actions::kAddBlock,
                        Actions::kAddNameDraft,
                        Actions::kAddKindDraft,
                        Actions::kAddController});
    }

    static ui::NodeTree MoveRootFirst(ui::NodeTree tree, std::size_t rootIndex)
    {
        if (rootIndex == 0)
        {
            return tree;
        }

        ui::NodeTree reordered;
        reordered.nodes.reserve(tree.nodes.size());
        reordered.nodes.push_back(std::move(tree.nodes[rootIndex]));
        for (std::size_t index = 0; index < tree.nodes.size(); ++index)
        {
            if (index != rootIndex)
            {
                reordered.nodes.push_back(std::move(tree.nodes[index]));
            }
        }
        return reordered;
    }

    static std::size_t ValidateApplicationTree(const ui::NodeTree& tree)
    {
        const RuntimeConfig config = App::Config();
        if (config.uiWidth <= 0 || config.uiHeight <= 0 || tree.nodes.empty())
        {
            throw std::invalid_argument(
                "application root must match positive configured bounds");
        }

        std::unordered_map<std::string, std::size_t> nodeIndex;
        nodeIndex.reserve(tree.nodes.size());
        for (std::size_t index = 0; index < tree.nodes.size(); ++index)
        {
            const ui::Node& node = tree.nodes[index];
            if (!nodeIndex.emplace(node.id.value, index).second)
            {
                throw std::invalid_argument("application tree has duplicate node id: " +
                                            node.id.value);
            }
            if (std::string_view(node.id.value).starts_with("runtime."))
            {
                throw std::invalid_argument(
                    "application tree uses reserved runtime namespace: " + node.id.value);
            }
        }

        std::vector<std::size_t> parentCounts(tree.nodes.size(), 0);
        for (const ui::Node& node : tree.nodes)
        {
            for (const ui::NodeId& child : node.children)
            {
                const auto childIt = nodeIndex.find(child.value);
                if (childIt == nodeIndex.end())
                {
                    throw std::invalid_argument("application tree references unknown child: " +
                                                child.value);
                }
                ++parentCounts[childIt->second];
            }
        }

        enum class VisitState
        {
            Unvisited,
            Visiting,
            Visited,
        };
        std::vector<VisitState> states(tree.nodes.size(), VisitState::Unvisited);
        std::function<void(std::size_t)> visit = [&](std::size_t index) {
            if (states[index] == VisitState::Visiting)
            {
                throw std::invalid_argument("application tree contains a cycle");
            }
            if (states[index] == VisitState::Visited)
            {
                return;
            }

            states[index] = VisitState::Visiting;
            for (const ui::NodeId& child : tree.nodes[index].children)
            {
                visit(nodeIndex.at(child.value));
            }
            states[index] = VisitState::Visited;
        };
        for (std::size_t index = 0; index < tree.nodes.size(); ++index)
        {
            if (states[index] == VisitState::Unvisited)
            {
                visit(index);
            }
        }

        std::size_t rootIndex = tree.nodes.size();
        // In an acyclic graph, one root and one parent per other node imply full reachability.
        for (std::size_t index = 0; index < parentCounts.size(); ++index)
        {
            if (parentCounts[index] != 0)
            {
                continue;
            }
            if (rootIndex != tree.nodes.size())
            {
                throw std::invalid_argument(
                    "application tree must have exactly one parentless root");
            }
            rootIndex = index;
        }
        if (rootIndex == tree.nodes.size() || tree.nodes[rootIndex].kind != ui::NodeKind::Root)
        {
            throw std::invalid_argument("application tree must have exactly one parentless root");
        }

        for (std::size_t index = 0; index < parentCounts.size(); ++index)
        {
            if (index != rootIndex && parentCounts[index] != 1)
            {
                throw std::invalid_argument(
                    "application tree nodes must be reachable exactly once");
            }
        }

        const ui::Bounds& bounds = tree.nodes[rootIndex].bounds;
        if (bounds.x != 0.0f || bounds.y != 0.0f ||
            bounds.width != static_cast<float>(config.uiWidth) ||
            bounds.height != static_cast<float>(config.uiHeight))
        {
            throw std::invalid_argument("application root does not match configured bounds");
        }
        return rootIndex;
    }

    ui::NodeTree BuildRuntimePageTree()
    {
        switch (currentPage_)
        {
            case RuntimeMainPage::Audio:
                return audioSurface_.BuildTree();
            case RuntimeMainPage::Controllers:
                return controllersSurface_.BuildTree();
            case RuntimeMainPage::File:
                return fileSurface_.BuildTree();
            case RuntimeMainPage::Application:
                break;
        }
        throw std::invalid_argument("application page has no runtime page tree");
    }

    void HandleSidebarAction(const ui::Action& action)
    {
        if (action.name == Actions::kSidebarAudio)
        {
            ShowPage(RuntimeMainPage::Audio);
        }
        else if (action.name == Actions::kSidebarControllers)
        {
            ShowPage(RuntimeMainPage::Controllers);
        }
        else if (action.name == Actions::kSidebarFile)
        {
            ShowPage(RuntimeMainPage::File);
        }
    }

    void ReturnToApplication(RuntimePageKind page)
    {
        if (RuntimePageBackSavesConfiguration(page))
        {
            services_.SaveRuntimeConfiguration();
        }
        ShowPage(RuntimeMainPage::Application);
    }

    App& app_;
    Services& services_;
    RuntimeMainPage currentPage_ = RuntimeMainPage::Application;
    RollingMax256 deadlineMaximum_;
    SidebarSurface sidebarSurface_;
    AudioPageSurface audioSurface_;
    FilePageSurface fileSurface_;
    ControllersPageSurface controllersSurface_;
    ActionHandler actionHandler_;
};

}  // namespace synth::runtime_ui
