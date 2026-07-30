#include "synth/RuntimeMainComponent.hpp"
#include "synth/ControllerWizard.hpp"
#include "synth/ControllerWizardDiscoveryCache.hpp"

#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

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

bool NearlyEqual(float actual, float expected)
{
    const float delta = actual - expected;
    return delta <= 0.001f && delta >= -0.001f;
}

const synth::ui::Node& FindNode(const synth::ui::NodeTree& tree, const char* id)
{
    const synth::ui::Node* node = FindNodeById(tree, id);
    Require(node != nullptr, id);
    return *node;
}

bool IsSidebarDescendant(const synth::ui::NodeTree& tree, const synth::ui::NodeId& id)
{
    if (id.value == synth::runtime_ui::NodeIds::kSidebarRoot)
    {
        return false;
    }

    std::unordered_map<std::string, std::string> parentByChild;
    for (const synth::ui::Node& node : tree.nodes)
    {
        for (const synth::ui::NodeId& child : node.children)
        {
            parentByChild.emplace(child.value, node.id.value);
        }
    }

    std::string current = id.value;
    while (true)
    {
        const auto parentIt = parentByChild.find(current);
        if (parentIt == parentByChild.end())
        {
            return false;
        }
        if (parentIt->second == synth::runtime_ui::NodeIds::kSidebarRoot)
        {
            return true;
        }
        current = parentIt->second;
    }
}

bool IsDeliberatelyZeroExtent(const synth::ui::Node& node)
{
    (void)node;
    return false;
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
    int controllerCommitCount = 0;
    int syncSnapshotCount = 0;
    int syncRefreshCount = 0;
    int syncCommitCount = 0;
    int saveCount = 0;
    bool controllerCommitSucceeds = true;
    bool controllerSaveSucceeds = true;
    std::vector<std::string> controllerPersistenceEvents;
    std::string lastAudioAction;
    std::string lastFileAction;
    float deadlinePercent = 12.5f;
    bool syncCommitSucceeds = true;
    synth::SyncConfig currentSync{};
    synth::SyncConfig lastCommittedSync{};
    synth::runtime_ui::SyncPageStatus syncStatus{};
    synth::MidiInstrumentConfig instrument;
    synth::MidiDeviceList controllerDevices;

    synth::runtime_ui::ControllersPageCallbacks MakeControllersCallbacks(std::function<void()> onBack)
    {
        synth::runtime_ui::ControllersPageCallbacks callbacks;
        callbacks.instrumentSnapshot = [this] { return instrument; };
        callbacks.connectionState = [] { return synth::MidiConnectionState{}; };
        callbacks.enumerateDevices = [this] { return controllerDevices; };
        callbacks.commitInstrument = [this](synth::MidiInstrumentConfig next) {
            ++controllerCommitCount;
            controllerPersistenceEvents.push_back("commit");
            if (!controllerCommitSucceeds)
            {
                return false;
            }
            instrument = std::move(next);
            return true;
        };
        callbacks.saveRuntimeConfiguration = [this] {
            ++saveCount;
            controllerPersistenceEvents.push_back("save");
            return controllerSaveSucceeds;
        };
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

    void RefreshControllers(synth::runtime_ui::ControllersPageSurface& surface)
    {
        ++controllersRefreshCount;
        surface.SetEnumerateDevices(controllerDevices);
        surface.SetDiscovery(
            synth::DiscoverControllerWizards(controllerDevices, instrument, synth::ControllerWizardRegistry()));
    }

    synth::SyncConfig SnapshotSyncConfiguration()
    {
        ++syncSnapshotCount;
        return currentSync;
    }

    void RefreshSyncStatus(synth::runtime_ui::SyncPageStatus& status)
    {
        ++syncRefreshCount;
        status = syncStatus;
    }

    bool CommitSyncConfiguration(const synth::SyncConfig& config)
    {
        ++syncCommitCount;
        lastCommittedSync = config;
        if (syncCommitSucceeds)
        {
            currentSync = config;
        }
        return syncCommitSucceeds;
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

static_assert(!std::is_copy_constructible_v<MainComponent>);
static_assert(!std::is_copy_assignable_v<MainComponent>);
static_assert(!std::is_move_constructible_v<MainComponent>);
static_assert(!std::is_move_assignable_v<MainComponent>);

struct Fixture
{
    FakeApp app;
    FakeServices services;
    MainComponent component{app, services};
};

synth::ui::NodeTree BuildCompositeTree(float width, float height)
{
    Require(NearlyEqual(width, 900.0f) && NearlyEqual(height, 560.0f),
            "BuildCompositeTree matches FakeApp configured size");
    Fixture fixture;
    return fixture.component.BuildTree();
}

void TestPlacingASubtreeRootPlacesEveryDescendant()
{
    const synth::ui::NodeTree composite = BuildCompositeTree(900.0f, 560.0f);
    Require(NearlyEqual(FindNode(composite, "runtime.main.root").bounds.width, 996.0f),
            "runtime chrome is additive: 900 + 96");
    Require(NearlyEqual(FindNode(composite, "runtime.sidebar.root").bounds.x, 900.0f),
            "the sidebar root sits at x 900 relative to the composite root");
    for (const synth::ui::Node& node : composite.nodes)
    {
        if (IsSidebarDescendant(composite, node.id))
        {
            Require(node.bounds.x < 96.0f,
                    "every sidebar descendant carries coordinates relative to its own "
                    "parent, never translated into the 900-996 band");
        }
    }
}

void TestSubtreesArriveFullyResolved()
{
    const synth::ui::NodeTree composite = BuildCompositeTree(900.0f, 560.0f);
    for (const synth::ui::Node& node : composite.nodes)
    {
        if (node.kind == synth::ui::NodeKind::Root)
        {
            continue;
        }
        Require(node.bounds.width > 0.0f || IsDeliberatelyZeroExtent(node),
                "every node arrives laid out by the library, not by a backend");
    }
}

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
    const synth::ui::Node* sync =
        FindNodeById(tree, synth::runtime_ui::NodeIds::kSidebarSync);
    Require(sidebar != nullptr, "sidebar root exists");
    Require(audio != nullptr, "sidebar audio node exists");
    Require(sync != nullptr, "sidebar sync node exists");
    RequireBounds(sidebar->bounds, 900.0f, 0.0f, 96.0f, 200.0f, "sidebar root placed");
    RequireBounds(audio->bounds, 0.0f, 0.0f, 96.0f, 40.0f, "sidebar descendant stays parent-relative");
    RequireBounds(sync->bounds, 0.0f, 80.0f, 96.0f, 40.0f, "sidebar sync stays parent-relative");
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

    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sidebar.sync"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Sync,
            "sync page opens");
    Require(fixture.services.syncSnapshotCount == 1,
            "sync opening snapshots requested configuration once");
    Require(fixture.component.BuildTree().nodes[1].id ==
                synth::ui::NodeId(synth::runtime_ui::NodeIds::kSyncRoot),
            "sync page root replaces app root");
    fixture.component.DispatchAction(synth::ui::Action::Named("runtime.sync.back"));
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "sync back restores app");
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

void TestControllerDraftActionsReachControllerSurface()
{
    Fixture fixture;

    fixture.component.ShowPage(synth::runtime_ui::RuntimeMainPage::Controllers);
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kAddNameDraft, "webctl"));
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kAddKindDraft, "generic"));

    const synth::ui::NodeTree tree = fixture.component.BuildTree();
    const synth::ui::Node* addName =
        FindNodeById(tree, synth::runtime_ui::NodeIds::kAddName);
    const synth::ui::Node* addKind =
        FindNodeById(tree, synth::runtime_ui::NodeIds::kAddKind);
    Require(addName != nullptr && addName->text == "webctl",
            "controller add-name draft routes through runtime component");
    Require(addKind != nullptr && addKind->selectedOption == "generic",
            "controller add-kind draft routes through runtime component");

    fixture.services.controllerDevices.inputs.push_back(
        {.identifier = "twister-in", .name = "Midi Fighter Twister"});
    fixture.services.controllerDevices.outputs.push_back(
        {.identifier = "twister-out", .name = "Midi Fighter Twister"});
    fixture.component.Refresh();
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kWizardOpen));
    Require(FindNodeById(fixture.component.BuildTree(),
                         synth::runtime_ui::NodeIds::kWizardForm) != nullptr,
            "wizard launch routes through runtime component to the Controllers surface");
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue("controller-wizard.twister.encoder-slot", "5"));
    const synth::ui::Node* encoderSlot = FindNodeById(
        fixture.component.BuildTree(), "controller-wizard.twister.encoder-slot");
    Require(encoderSlot != nullptr && encoderSlot->text == "5",
            "wizard form field actions route through runtime component to the session-owned form");
}

void TestThreeClickWizardSubmitCommitsThenSaves()
{
    Fixture fixture;
    fixture.services.controllerDevices.inputs.push_back(
        {.identifier = "twister-in", .name = "Midi Fighter Twister"});
    fixture.services.controllerDevices.outputs.push_back(
        {.identifier = "twister-out", .name = "Midi Fighter Twister"});
    fixture.component.Refresh();

    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSidebarControllers));
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kWizardOpen));
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kWizardSubmit));

    Require(fixture.services.controllerCommitCount == 1,
            "three-click Submit performs exactly one instrument commit");
    Require(fixture.services.saveCount == 1 &&
                fixture.services.controllerPersistenceEvents ==
                    std::vector<std::string>({"commit", "save"}),
            "three-click Submit requests one runtime save after the commit");
    Require(fixture.services.instrument.controllers.size() == 1,
            "three-click Submit installs exactly one controller");
    const synth::MidiControllerSlot& installed =
        fixture.services.instrument.controllers.front();
    Require(installed.disposition == synth::MidiControllerDisposition::Active &&
                installed.wizardId ==
                    std::optional<std::string>("com.sheaf.midi-fighter-twister") &&
                installed.input.identifier == "twister-in" &&
                installed.output.identifier == "twister-out",
            "three-click Submit installs the generated Active record with exact identity");
    Require(installed.config.encoderInput.has_value() &&
                installed.config.encoderInput->turns.size() == 16 &&
                installed.config.systemMessages.size() == 6,
            "three-click Submit installs the complete default Twister profile");

    fixture.component.Refresh();
    Require(FindNodeById(fixture.component.BuildTree(),
                         "runtime.sidebar.controllers.warning") == nullptr,
            "successful Submit immediately removes the claimed candidate warning");
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

void TestSyncStagesRefreshesCommitsAndReopensFromEngineSnapshot()
{
    Fixture fixture;
    fixture.services.currentSync = {.sendClock = false,
                                    .receiveClock = true,
                                    .sendTransport = false,
                                    .receiveTransport = true,
                                    .ppqn = 24};
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSidebarSync));

    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncSendClock, "1"));
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncReceiveClock, "0"));
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncSendTransport, "1"));
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncReceiveTransport, "0"));
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncPpqn, "96"));
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSidebarSync));
    Require(fixture.services.syncSnapshotCount == 1,
            "clicking the already-open Sync tab does not begin a second edit");
    Require(FindNodeById(fixture.component.BuildTree(),
                         synth::runtime_ui::NodeIds::kSyncPpqn)->text == "96",
            "clicking the already-open Sync tab preserves staged PPQN");

    fixture.services.syncStatus = {.currentBpm = 123.5,
                                   .lockState = "Locked",
                                   .sourceName = "Clock Controller",
                                   .outputLatencyMicros = 8'000,
                                   .ignoredInputCount = 2,
                                   .lateEventCount = 3,
                                   .droppedOutputCount = 4};
    fixture.component.Refresh();
    Require(fixture.services.syncRefreshCount == 1, "refresh requests sync diagnostics");
    const synth::ui::NodeTree stagedTree = fixture.component.BuildTree();
    Require(FindNodeById(stagedTree, synth::runtime_ui::NodeIds::kSyncSendClock)->checked,
            "refresh does not overwrite staged send-clock");
    Require(!FindNodeById(stagedTree, synth::runtime_ui::NodeIds::kSyncReceiveClock)->checked,
            "refresh does not overwrite staged receive-clock");
    Require(FindNodeById(stagedTree, synth::runtime_ui::NodeIds::kSyncPpqn)->text == "96",
            "refresh does not overwrite staged PPQN");
    Require(FindNodeById(stagedTree, synth::runtime_ui::NodeIds::kSyncWarning)->text.find(
                "nonstandard") != std::string::npos,
            "staged nonstandard PPQN warning remains visible");
    Require(FindNodeById(stagedTree, synth::runtime_ui::NodeIds::kSyncSource)->text.find(
                "Clock Controller") != std::string::npos,
            "refresh updates source diagnostics");

    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSyncBack));
    Require(fixture.services.syncCommitCount == 1, "Sync Back commits exactly once");
    Require(fixture.services.saveCount == 1, "successful Sync Back saves exactly once");
    Require(fixture.services.lastCommittedSync ==
                synth::SyncConfig{true, false, true, false, 96},
            "Sync Back commits one complete staged config");
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Application,
            "successful Sync Back returns to application");

    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSidebarSync));
    const synth::ui::NodeTree reopenedTree = fixture.component.BuildTree();
    Require(fixture.services.syncSnapshotCount == 2,
            "reopening Sync obtains one fresh committed snapshot");
    Require(FindNodeById(reopenedTree, synth::runtime_ui::NodeIds::kSyncPpqn)->text == "96",
            "reopening Sync starts from committed PPQN");

    fixture.services.syncCommitSucceeds = false;
    fixture.component.DispatchAction(
        synth::ui::Action::WithValue(synth::runtime_ui::Actions::kSyncPpqn, "48"));
    fixture.component.DispatchAction(
        synth::ui::Action::Named(synth::runtime_ui::Actions::kSyncBack));
    Require(fixture.services.syncCommitCount == 2, "rejected Sync Back attempts one commit");
    Require(fixture.services.saveCount == 1, "rejected Sync Back does not save");
    Require(fixture.component.CurrentPage() == synth::runtime_ui::RuntimeMainPage::Sync,
            "rejected Sync Back stays on Sync");
    Require(FindNodeById(fixture.component.BuildTree(),
                         synth::runtime_ui::NodeIds::kSyncValidation)->text.find("apply") !=
                std::string::npos,
            "rejected Sync Back shows an apply error");
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
    Require(fixture.services.syncRefreshCount == 2, "refresh updates sync status only");
    const synth::ui::Node* deadline = FindNodeById(
        fixture.component.BuildTree(), synth::runtime_ui::NodeIds::kSidebarDeadline);
    Require(deadline != nullptr, "deadline node exists after refresh");
    Require(deadline->text == "12.5%", "sidebar displays rolling deadline maximum");
}

void TestSidebarWarningReflectsControllersDiscoverySnapshot()
{
    Fixture fixture;
    fixture.services.controllerDevices.inputs.push_back(
        {.identifier = "twister-input", .name = "Midi Fighter Twister"});
    fixture.services.controllerDevices.outputs.push_back(
        {.identifier = "twister-output", .name = "Midi Fighter Twister"});

    fixture.component.Refresh();

    Require(FindNodeById(fixture.component.BuildTree(),
                         "runtime.sidebar.controllers.warning") != nullptr,
            "unclaimed recognized cached pair warns while application is open");
}

void TestWizardDiscoveryCacheRecomputesOnlyForCachedSnapshotChanges()
{
    synth::ControllerWizardDiscoveryCache cache;
    const synth::MidiDeviceList twisterPair{
        .inputs = {{.identifier = "twister-input", .name = "Midi Fighter Twister"}},
        .outputs = {{.identifier = "twister-output", .name = "Midi Fighter Twister"}},
    };

    Require(cache.UpdateDeviceList(twisterPair), "first device signal updates cached device snapshot");
    const std::uint64_t afterDeviceSignal = cache.Revision();
    Require(afterDeviceSignal == 1, "first device signal recomputes discovery once");
    Require(!cache.UpdateDeviceList(twisterPair), "unchanged device source does not update cache");
    Require(cache.Revision() == afterDeviceSignal,
            "unchanged device source does not recompute discovery");

    synth::MfTwisterControllerWizard wizard;
    synth::MfTwisterConfigForm form;
    const synth::WizardGenerationResult generated = wizard.GenerateProfile(
        form,
        {.name = "claimed", .input = {"twister-input", "Midi Fighter Twister"},
         .output = {"twister-output", "Midi Fighter Twister"}});
    Require(static_cast<bool>(generated), "create instrument snapshot for successful commit");
    synth::MidiInstrumentConfig committed;
    committed.controllers.push_back(*generated.controller);
    cache.UpdateInstrumentSnapshot(std::move(committed));
    Require(cache.Revision() == afterDeviceSignal + 1,
            "successful instrument commit recomputes against cached devices");
    Require(cache.Discovery().available.empty(), "committed claim clears cached candidate");
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

void TestRejectsDisconnectedGraph()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    synth::ui::Node disconnected;
    disconnected.id = "app.disconnected";
    disconnected.kind = synth::ui::NodeKind::Section;
    tree.nodes.push_back(std::move(disconnected));
    RequireInvalidTree(std::move(tree), "exactly one parentless root");
}

void TestRejectsMultiplyParentedDiamondGraph()
{
    synth::ui::NodeTree tree = MakeValidAppTree();
    tree.nodes.front().children = {synth::ui::NodeId("app.left"),
                                   synth::ui::NodeId("app.right")};

    synth::ui::Node left;
    left.id = "app.left";
    left.kind = synth::ui::NodeKind::Section;
    left.children.push_back(synth::ui::NodeId("app.shared"));
    tree.nodes.push_back(std::move(left));

    synth::ui::Node right;
    right.id = "app.right";
    right.kind = synth::ui::NodeKind::Section;
    right.children.push_back(synth::ui::NodeId("app.shared"));
    tree.nodes.push_back(std::move(right));

    synth::ui::Node shared;
    shared.id = "app.shared";
    shared.kind = synth::ui::NodeKind::Label;
    tree.nodes.push_back(std::move(shared));

    RequireInvalidTree(std::move(tree), "reachable exactly once");
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

    Run("TestPlacingASubtreeRootPlacesEveryDescendant",
        TestPlacingASubtreeRootPlacesEveryDescendant);
    Run("TestSubtreesArriveFullyResolved", TestSubtreesArriveFullyResolved);
    Run("TestCompositeBoundsPreserveAppAndAddSidebar", TestCompositeBoundsPreserveAppAndAddSidebar);
    Run("TestSidebarOpensEachPageAndBackRestoresApp", TestSidebarOpensEachPageAndBackRestoresApp);
    Run("TestAppActionsRouteOnlyToAppSurface", TestAppActionsRouteOnlyToAppSurface);
    Run("TestRuntimeActionsRouteOnlyToOwningPageOrServices",
        TestRuntimeActionsRouteOnlyToOwningPageOrServices);
    Run("TestControllerDraftActionsReachControllerSurface",
        TestControllerDraftActionsReachControllerSurface);
    Run("TestThreeClickWizardSubmitCommitsThenSaves",
        TestThreeClickWizardSubmitCommitsThenSaves);
    Run("TestBackFromConfigurationPageSavesRuntimeConfiguration",
        TestBackFromConfigurationPageSavesRuntimeConfiguration);
    Run("TestSyncStagesRefreshesCommitsAndReopensFromEngineSnapshot",
        TestSyncStagesRefreshesCommitsAndReopensFromEngineSnapshot);
    Run("TestRefreshUpdatesRuntimePageModelsAndRollingDeadline",
        TestRefreshUpdatesRuntimePageModelsAndRollingDeadline);
    Run("TestSidebarWarningReflectsControllersDiscoverySnapshot",
        TestSidebarWarningReflectsControllersDiscoverySnapshot);
    Run("TestWizardDiscoveryCacheRecomputesOnlyForCachedSnapshotChanges",
        TestWizardDiscoveryCacheRecomputesOnlyForCachedSnapshotChanges);
    Run("TestRejectsRootSizeMismatch", TestRejectsRootSizeMismatch);
    Run("TestRejectsDuplicateNodeIds", TestRejectsDuplicateNodeIds);
    Run("TestRejectsUnknownChild", TestRejectsUnknownChild);
    Run("TestRejectsCycle", TestRejectsCycle);
    Run("TestRejectsAppRuntimeNamespace", TestRejectsAppRuntimeNamespace);
    Run("TestRejectsDisconnectedGraph", TestRejectsDisconnectedGraph);
    Run("TestRejectsMultiplyParentedDiamondGraph", TestRejectsMultiplyParentedDiamondGraph);
    return failureCount == 0 ? 0 : 1;
}
