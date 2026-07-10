#include "synth/RuntimeMainComponent.hpp"

#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>

#ifdef JUCE_MAJOR_VERSION
#error "runtime main component tests must not see JUCE"
#endif

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
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

void RequireBounds(const synth::ui::Bounds& actual,
                   float x,
                   float y,
                   float width,
                   float height,
                   const char* label)
{
    Require(actual.x == x && actual.y == y && actual.width == width && actual.height == height,
            label);
}

synth::ui::NodeTree MakeValidAppTree()
{
    synth::ui::Node root;
    root.id = "app.root";
    root.kind = synth::ui::NodeKind::Root;
    root.bounds = {0.0f, 0.0f, 900.0f, 560.0f};
    return synth::ui::NodeTree{{std::move(root)}};
}

class FakeAppSurface final : public synth::ui::Surface
{
public:
    synth::ui::NodeTree tree = MakeValidAppTree();
    int dispatchCount = 0;
    std::string lastAction;

    synth::ui::NodeTree BuildTree() override
    {
        return tree;
    }

    void SetActionHandler(ActionHandler handler) override
    {
        observer_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        ++dispatchCount;
        lastAction = action.name;
        if (observer_)
        {
            observer_(action);
        }
    }

private:
    ActionHandler observer_;
};

struct FakeApp
{
    static synth::RuntimeConfig Config()
    {
        return synth::RuntimeConfig{.appName = "RuntimeMainTest", .uiWidth = 900, .uiHeight = 560};
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}

    synth::ui::Surface& PortableSurface()
    {
        return surface;
    }

    FakeAppSurface surface;
};

struct FakeServices
{
    int audioRefreshCount = 0;
    int audioDispatchCount = 0;
    int fileRefreshCount = 0;
    int fileDispatchCount = 0;
    int controllersRefreshCount = 0;
    int saveCount = 0;
    std::string lastAudioAction;
    std::string lastFileAction;
    float deadlinePercent = 12.5f;

    synth::runtime_ui::ControllersPageCallbacks MakeControllersCallbacks(std::function<void()> onBack)
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [] { return synth::MidiInstrumentConfig{}; };
        callbacks.connectionState = [] { return synth::MidiConnectionState{}; };
        callbacks.enumerateDevices = [] { return synth::MidiDeviceList{}; };
        callbacks.commitInstrument = [](synth::MidiInstrumentConfig) {};
        callbacks.setStatus = [](std::string) {};
        callbacks.onBack = std::move(onBack);
        return callbacks;
    }

    void RefreshAudio(synth::runtime_ui::AudioPageSnapshot&)
    {
        ++audioRefreshCount;
    }

    void DispatchAudio(const synth::ui::Action& action)
    {
        ++audioDispatchCount;
        lastAudioAction = action.name;
    }

    void RefreshFile(synth::runtime_ui::FilePageSnapshot&)
    {
        ++fileRefreshCount;
    }

    void DispatchFile(const synth::ui::Action& action)
    {
        ++fileDispatchCount;
        lastFileAction = action.name;
    }

    void RefreshControllers(synth::runtime_ui::ControllersPageSurface&)
    {
        ++controllersRefreshCount;
    }

    float DeadlineSamplePercent()
    {
        return deadlinePercent;
    }

    void SaveRuntimeConfiguration()
    {
        ++saveCount;
    }
};

using MainComponent = synth::runtime_ui::RuntimeMainComponent<FakeApp, FakeServices>;

struct Fixture
{
    FakeApp app;
    FakeServices services;
    MainComponent component{app, services};
};

void TestCompositeBoundsPreserveAppAndAddSidebar()
{
    Fixture fixture;
    const synth::ui::NodeTree tree = fixture.component.BuildTree();

    Require(tree.nodes.size() >= 7, "composite contains main, app, and sidebar trees");
    Require(tree.nodes[0].id == synth::ui::NodeId("runtime.main.root"), "composite root is first");
    Require(tree.nodes[1].id == synth::ui::NodeId("app.root"), "application root is second");
    RequireBounds(tree.nodes[0].bounds, 0.0f, 0.0f, 996.0f, 560.0f, "composite bounds");
    RequireBounds(tree.nodes[1].bounds, 0.0f, 0.0f, 900.0f, 560.0f, "application bounds");

    const synth::ui::Node* sidebar =
        FindNodeById(tree, synth::runtime_ui::NodeIds::kSidebarRoot);
    const synth::ui::Node* audio =
        FindNodeById(tree, synth::runtime_ui::NodeIds::kSidebarAudio);
    Require(sidebar != nullptr, "sidebar root exists");
    Require(audio != nullptr, "sidebar audio node exists");
    RequireBounds(sidebar->bounds, 900.0f, 0.0f, 96.0f, 160.0f, "sidebar root translated");
    RequireBounds(audio->bounds, 900.0f, 0.0f, 96.0f, 40.0f, "sidebar descendant translated");
    RequireBounds(fixture.component.IntrinsicBounds(),
                  0.0f,
                  0.0f,
                  996.0f,
                  560.0f,
                  "intrinsic bounds");
}

void TestSidebarOpensEachPageAndBackRestoresApp()
{
    Fixture fixture;

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sidebar.audio"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Audio,
            "audio page opens");
    Require(fixture.component.BuildTree().nodes[1].id ==
                synth::ui::NodeId(synth::runtime_ui::NodeIds::kAudioRoot),
            "audio page root replaces app root");
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.audio.back"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "audio back restores app");

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sidebar.controllers"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Controllers,
            "controllers page opens");
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.controllers.back"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "controllers back restores app");

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sidebar.file"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::File,
            "file page opens");
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.file.back"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "file back restores app");
}

void TestAppActionsRouteOnlyToAppSurface()
{
    Fixture fixture;
    fixture.component.DispatchAction(synth::ui::Action::WithValue("app.change", "42"));

    Require(fixture.app.surface.dispatchCount == 1, "app action reaches app surface once");
    Require(fixture.app.surface.lastAction == "app.change", "app receives original action");
    Require(fixture.services.audioDispatchCount == 0, "app action does not reach audio services");
    Require(fixture.services.fileDispatchCount == 0, "app action does not reach file services");
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "app action does not navigate");
}

void TestRuntimeActionsRouteOnlyToOwningPageOrServices()
{
    Fixture fixture;

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sidebar.audio"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Audio,
            "sidebar action navigates");
    Require(fixture.app.surface.dispatchCount == 0, "sidebar action does not reach app");

    fixture.component.DispatchAction(
        synth::ui::Action::WithValue("runtime.audio.output.select", "system_default"));
    Require(fixture.services.audioDispatchCount == 1, "audio action reaches audio services");
    Require(fixture.services.fileDispatchCount == 0, "audio action does not reach file services");
    Require(fixture.app.surface.dispatchCount == 0, "audio action does not reach app");

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.file.new"));
    Require(fixture.services.fileDispatchCount == 1, "file action reaches file services");
    Require(fixture.services.audioDispatchCount == 1, "file action does not return to audio services");
    Require(fixture.app.surface.dispatchCount == 0, "file action does not reach app");

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.unknown"));
    Require(fixture.app.surface.dispatchCount == 0, "unknown runtime action stays reserved");
}

void TestBackFromConfigurationPageSavesRuntimeConfiguration()
{
    Fixture fixture;

    fixture.component.ShowPage(synth::runtime_ui::RuntimeMainPage::Audio);
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.audio.back"));
    Require(fixture.services.saveCount == 1, "audio back saves runtime configuration");

    fixture.component.ShowPage(synth::runtime_ui::RuntimeMainPage::Controllers);
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.controllers.back"));
    Require(fixture.services.saveCount == 2, "controllers back saves runtime configuration");

    fixture.component.ShowPage(synth::runtime_ui::RuntimeMainPage::File);
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.file.back"));
    Require(fixture.services.saveCount == 2, "file back does not save runtime configuration");
}

void TestRefreshUpdatesRuntimePageModelsAndRollingDeadline()
{
    Fixture fixture;

    fixture.component.Refresh();
    fixture.services.deadlinePercent = 4.0f;
    fixture.component.Refresh();

    Require(fixture.services.audioRefreshCount == 2, "refresh updates audio snapshot");
    Require(fixture.services.fileRefreshCount == 2, "refresh updates file snapshot");
    Require(fixture.services.controllersRefreshCount == 2, "refresh updates controllers surface");
    const synth::ui::Node* deadline = FindNodeById(
        fixture.component.BuildTree(), synth::runtime_ui::NodeIds::kSidebarDeadline);
    Require(deadline != nullptr, "deadline node exists after refresh");
    Require(deadline->text == "12.5%", "sidebar displays rolling deadline maximum");
}

void RequireInvalidTree(synth::ui::NodeTree tree, const char* expectedMessage)
{
    Fixture fixture;
    fixture.app.surface.tree = std::move(tree);
    try
    {
        static_cast<void>(fixture.component.BuildTree());
    }
    catch (const std::invalid_argument& error)
    {
        Require(std::string(error.what()).find(expectedMessage) != std::string::npos,
                "invalid tree diagnostic");
        return;
    }
    throw std::runtime_error("invalid tree was accepted");
}

void TestRejectsRootSizeMismatch()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    tree.nodes.front().bounds.width = 899.0f;
    RequireInvalidTree(std::move(tree), "configured bounds");
}

void TestRejectsDuplicateNodeIds()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    synth::ui::Node duplicate;
    duplicate.id = "app.root";
    duplicate.kind = synth::ui::NodeKind::Label;
    tree.nodes.push_back(std::move(duplicate));
    RequireInvalidTree(std::move(tree), "duplicate node id");
}

void TestRejectsUnknownChild()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    tree.nodes.front().children.push_back(synth::ui::NodeId("app.missing"));
    RequireInvalidTree(std::move(tree), "unknown child");
}

void TestRejectsCycle()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    tree.nodes.front().children.push_back(synth::ui::NodeId("app.child"));
    synth::ui::Node child;
    child.id = "app.child";
    child.kind = synth::ui::NodeKind::Section;
    child.children.push_back(child.id);
    tree.nodes.push_back(std::move(child));
    RequireInvalidTree(std::move(tree), "cycle");
}

void TestRejectsAppRuntimeNamespace()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    tree.nodes.front().id = "runtime.app.root";
    RequireInvalidTree(std::move(tree), "reserved runtime namespace");
}

int failureCount = 0;

template <typename Test>
void Run(const char* name, Test test)
{
    try
    {
        test();
        std::cout << "PASS " << name << '\n';
    }
    catch (const std::exception& error)
    {
        ++failureCount;
        std::cerr << "FAIL " << name << ": " << error.what() << '\n';
    }
}

}  // namespace

int main()
{
    static_assert(synth::SynthApplication<FakeApp>);
    static_assert(synth::runtime_ui::RuntimeMainServices<FakeServices>);

    Run("TestCompositeBoundsPreserveAppAndAddSidebar", TestCompositeBoundsPreserveAppAndAddSidebar);
    Run("TestSidebarOpensEachPageAndBackRestoresApp", TestSidebarOpensEachPageAndBackRestoresApp);
    Run("TestAppActionsRouteOnlyToAppSurface", TestAppActionsRouteOnlyToAppSurface);
    Run("TestRuntimeActionsRouteOnlyToOwningPageOrServices",
        TestRuntimeActionsRouteOnlyToOwningPageOrServices);
    Run("TestBackFromConfigurationPageSavesRuntimeConfiguration",
        TestBackFromConfigurationPageSavesRuntimeConfiguration);
    Run("TestRefreshUpdatesRuntimePageModelsAndRollingDeadline",
        TestRefreshUpdatesRuntimePageModelsAndRollingDeadline);
    Run("TestRejectsRootSizeMismatch", TestRejectsRootSizeMismatch);
    Run("TestRejectsDuplicateNodeIds", TestRejectsDuplicateNodeIds);
    Run("TestRejectsUnknownChild", TestRejectsUnknownChild);
    Run("TestRejectsCycle", TestRejectsCycle);
    Run("TestRejectsAppRuntimeNamespace", TestRejectsAppRuntimeNamespace);
    return failureCount == 0 ? 0 : 1;
}
