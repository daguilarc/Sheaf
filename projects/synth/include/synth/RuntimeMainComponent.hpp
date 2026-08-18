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
    Sync,
    File,
};

template <typename Services>
concept RuntimeMainServices = requires(Services& services,
                                       AudioPageSnapshot& audio,
                                       FilePageSnapshot& file,
                                       SyncPageStatus& syncStatus,
                                       ControllersPageSurface& controllers,
                                       const SyncConfig& syncConfig,
                                       const ui::Action& action,
                                       std::function<void()> onBack) {
    { services.MakeControllersCallbacks(std::move(onBack)) } ->
        std::same_as<ControllersPageCallbacks>;
    { services.RefreshAudio(audio) } -> std::same_as<void>;
    { services.DispatchAudio(action) } -> std::same_as<void>;
    { services.RefreshFile(file) } -> std::same_as<void>;
    { services.DispatchFile(action) } -> std::same_as<void>;
    { services.RefreshControllers(controllers) } -> std::same_as<void>;
    { services.SnapshotSyncConfiguration() } -> std::same_as<SyncConfig>;
    { services.RefreshSyncStatus(syncStatus) } -> std::same_as<void>;
    { services.CommitSyncConfiguration(syncConfig) } -> std::same_as<bool>;
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
        // Defaults to the compiled-in size, matching what an extent-aware
        // app would resolve to if it were never offered anything else (task
        // 8.1/8.2, sprs-13): identical to the legacy, hook-free value.
        liveContentExtent_ = contentBounds;
        syncSurface_.SetContentBounds(contentBounds);

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
        syncSurface_.SetActionHandler([this](const ui::Action& action) {
            if (action.name != Actions::kSyncBack)
            {
                return;
            }
            if (!services_.CommitSyncConfiguration(syncSurface_.StagedConfiguration()))
            {
                syncSurface_.SetApplyError();
                return;
            }
            ReturnToApplication(RuntimePageKind::Sync);
        });
    }

    RuntimeMainComponent(const RuntimeMainComponent&) = delete;
    RuntimeMainComponent& operator=(const RuntimeMainComponent&) = delete;
    RuntimeMainComponent(RuntimeMainComponent&&) = delete;
    RuntimeMainComponent& operator=(RuntimeMainComponent&&) = delete;

    ui::NodeTree BuildTree() override
    {
        // Task 8.1 (sprs-13): offer the app surface the live content extent
        // immediately before BuildTree(), generalizing the SetContentBounds
        // convention. app_.PortableSurface() is constrained by
        // SynthApplication to return exactly `ui::Surface&`
        // (AppConcepts.hpp), erasing the concrete surface type, so the hook
        // is detected with a dynamic_cast against the separate
        // ui::ExtentAwareSurface interface rather than a compile-time trait.
        // A surface that doesn't implement it is left alone and resolves at
        // its own compiled-in size.
        ui::Surface& appSurface = app_.PortableSurface();
        auto* extentAwareApp = dynamic_cast<ui::ExtentAwareSurface*>(&appSurface);
        const ui::Bounds expectedAppBounds =
            extentAwareApp != nullptr
                ? liveContentExtent_
                : ui::Bounds{0.0f,
                            0.0f,
                            static_cast<float>(App::Config().uiWidth),
                            static_cast<float>(App::Config().uiHeight)};
        if (extentAwareApp != nullptr)
        {
            extentAwareApp->SetContentExtent(liveContentExtent_);
        }

        ui::NodeTree appTree = appSurface.BuildTree();
        const std::size_t appRootIndex = ValidateApplicationTree(appTree, expectedAppBounds);
        // Task 8.2: the sidebar is placed at the resolved app tree's root
        // width rather than a compiled-in one (this used to read
        // `static_cast<float>(App::Config().uiWidth)` unconditionally). For
        // a legacy app the hook is never accepted, so expectedAppBounds --
        // and therefore this resolved width -- is exactly config.uiWidth,
        // making this bit-identical to the prior expression.
        const float appRootWidth = appTree.nodes[appRootIndex].bounds.width;
        ui::NodeTree contentTree = currentPage_ == RuntimeMainPage::Application
                                       ? MoveRootFirst(std::move(appTree), appRootIndex)
                                       : BuildRuntimePageTree();
        ui::NodeTree sidebarTree = sidebarSurface_.BuildTree();
        if (sidebarTree.nodes.empty())
        {
            throw std::invalid_argument("sidebar tree must have a root");
        }
        sidebarTree.nodes.front().bounds.x = appRootWidth;

        ui::Node root;
        root.id = "runtime.main.root";
        root.kind = ui::NodeKind::Root;
        // Composite root width follows the resolved app width plus the
        // sidebar, rather than IntrinsicBounds()'s compiled-in width, so a
        // wider-than-config resolved app still fits the composition-holds
        // check below. IntrinsicBounds() itself is unchanged (it remains
        // the compiled-in preferred/startup size other callers rely on);
        // for a legacy app appRootWidth == config.uiWidth, so this is
        // numerically identical to `IntrinsicBounds()` as before.
        root.bounds = {0.0f,
                       0.0f,
                       appRootWidth + Layout::kSidebarWidth,
                       static_cast<float>(App::Config().uiHeight)};
        RequireCompositionHolds(root.bounds, contentTree.nodes.front(), sidebarTree.nodes.front());
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

    bool NeedsDeferredDispatch(const ui::Action& action) const
    {
        return IsControllersAction(action.name) && controllersSurface_.NeedsDeferredDispatch(action);
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
        else if (IsSyncAction(action.name))
        {
            syncSurface_.DispatchAction(action);
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
        sidebarSurface_.SetControllersWarning(!controllersSurface_.Discovery().available.empty());
        SyncPageStatus syncStatus;
        services_.RefreshSyncStatus(syncStatus);
        syncSurface_.RefreshStatus(syncStatus);
    }

    void ShowPage(RuntimeMainPage page)
    {
        currentPage_ = page;
    }

    // Task 8.1 (sprs-13): the live content extent the shell will offer the
    // app surface immediately before its next BuildTree(), generalizing the
    // SetContentBounds convention (RuntimePages.hpp:1379/:1426/:1491,
    // ControllersPageUI.hpp:932) from individual runtime pages to the whole
    // app-surface seam. Callers (the JUCE renderer via its live bounds, the
    // browser host, or a test) call this whenever the live extent changes;
    // BuildTree() always offers whatever is currently stored here. A surface
    // that doesn't implement ui::ExtentAwareSurface never sees this value.
    void SetContentExtent(ui::Bounds extent)
    {
        liveContentExtent_ = extent;
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
    // The composition contract (task 7.1). The shell PLACES two already-resolved
    // subtree roots rather than resolving them, which is legitimate under
    // design.md D6 -- but it also means sru-54's overflow gate never sees this
    // composition, because the resolver is never invoked on it. The residual
    // that leaves is concrete: the composite root's height follows the app's
    // declared `uiHeight` while the sidebar is a fixed five-row 200px column, so
    // an app declaring `uiHeight < 200` overruns the window with nothing to
    // catch it. This is that catch, stated as a precondition on the app's
    // declaration rather than as a silent clip.
    static void RequireCompositionHolds(ui::Bounds rootBounds,
                                        const ui::Node& content,
                                        const ui::Node& sidebar)
    {
        const auto fits = [](const ui::Bounds& child, const ui::Bounds& parent) {
            return child.x >= -0.01f && child.y >= -0.01f &&
                   child.x + child.width <= parent.width + 0.01f &&
                   child.y + child.height <= parent.height + 0.01f;
        };
        for (const ui::Node* placed : {&content, &sidebar})
        {
            if (fits(placed->bounds, rootBounds))
            {
                continue;
            }
            throw std::invalid_argument(
                std::string("runtime shell composition does not fit its surface: '") +
                placed->id.value + "' is " + std::to_string(static_cast<int>(placed->bounds.width)) +
                "x" + std::to_string(static_cast<int>(placed->bounds.height)) + " at (" +
                std::to_string(static_cast<int>(placed->bounds.x)) + ", " +
                std::to_string(static_cast<int>(placed->bounds.y)) + ") inside a " +
                std::to_string(static_cast<int>(rootBounds.width)) + "x" +
                std::to_string(static_cast<int>(rootBounds.height)) +
                " surface. The application's declared uiWidth/uiHeight is the surface, and it must "
                "be at least as tall as the runtime sidebar.");
        }
    }

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
                        Actions::kSidebarSync,
                        Actions::kSidebarFile});
    }

    static bool IsAudioAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kAudioBack,
                        Actions::kAudioOutputSelect,
                        Actions::kAudioInputSelect,
                        Actions::kAudioInputRetry});
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

    static bool IsSyncAction(std::string_view action)
    {
        return IsOneOf(action,
                       {Actions::kSyncBack,
                        Actions::kSyncSendClock,
                        Actions::kSyncReceiveClock,
                        Actions::kSyncSendTransport,
                        Actions::kSyncReceiveTransport,
                        Actions::kSyncPpqn});
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
                        Actions::kAddController,
                        Actions::kAvailableConfigure,
                        Actions::kAvailableIgnore,
                        Actions::kWizardOpen,
                        Actions::kWizardChoose,
                        Actions::kWizardBack,
                        Actions::kWizardCancel,
                        Actions::kWizardSubmit,
                        Actions::kWizardIgnore}) ||
               action.starts_with("controller-wizard.") ||
               action.starts_with("runtime.controllers.controller.");
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

    // Task 8.2 (sprs-13): `expectedBounds` is the extent the surface actually
    // resolved against -- the offered live extent when the extent-aware hook
    // was accepted, `config.uiWidth/uiHeight` otherwise (BuildTree() decides
    // which). The positive-config guard below stays config-based regardless:
    // it is a sanity check on the app's own declaration, independent of
    // which bounds this call is validating the resolved root against.
    static std::size_t ValidateApplicationTree(const ui::NodeTree& tree,
                                               const ui::Bounds& expectedBounds)
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
        if (bounds.x != expectedBounds.x || bounds.y != expectedBounds.y ||
            bounds.width != expectedBounds.width || bounds.height != expectedBounds.height)
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
            case RuntimeMainPage::Sync:
                return syncSurface_.BuildTree();
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
        else if (action.name == Actions::kSidebarSync)
        {
            if (currentPage_ != RuntimeMainPage::Sync)
            {
                syncSurface_.BeginEdit(services_.SnapshotSyncConfiguration());
            }
            ShowPage(RuntimeMainPage::Sync);
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
    SyncPageSurface syncSurface_;
    ActionHandler actionHandler_;
    ui::Bounds liveContentExtent_;
};

}  // namespace synth::runtime_ui
